import crypto from 'node:crypto';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { ingestTelegramDocument, type PollerContextOptions } from '../polling/jmaXmlPoller.js';
import { parseVphw } from '../polling/jmaVphwParser.js';
import { parseVpbs50 } from '../polling/jmaVpbs50Parser.js';
import { findBosaiBulletin } from '../repositories/bosaiBulletinRepository.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import {
  findTelegramReceptionById,
  listTelegramReceptionAdoptions,
} from '../repositories/telegramReceptionRepository.js';
import {
  findTrainingInjection,
  findTrainingInjectionReceptionByReceptionId,
  listAllTrainingInjections,
  listTrainingInjectionReceptions,
} from '../repositories/trainingInjectionRepository.js';
import {
  findTrainingRetraction,
  insertTrainingRetraction,
  insertTrainingRetractionItem,
  insertTrainingRetractionTarget,
  listTrainingRetractionItems,
  listTrainingRetractionTargets,
  mapRetractedTrainingIds,
  updateTrainingRetractionStatus,
  type TrainingRetractionOutcome,
} from '../repositories/trainingRetractionRepository.js';
import type {
  BosaiBulletinTarget,
  TelegramReception,
  WarningTelegramType,
} from '../repositories/types.js';
import { findWarningCurrentStream } from '../repositories/warningCurrentStreamRepository.js';
import { resolveBosaiBulletinTarget } from '../venueForecastTargets.js';
import {
  TRAINING_FEED_KIND,
  TRAINING_RETRACTION_ALREADY_RETRACTED,
  TRAINING_RETRACTION_FAILED,
  TRAINING_RETRACTION_NOT_FOUND,
  TRAINING_RETRACTION_SOURCE_KIND,
  TRAINING_TRIGGER_KIND,
  encodeRetractionRejection,
  trainingRetractionDocumentUrl,
  type TrainingRetractionCommand,
  type TrainingRetractionResult,
} from './trainingInjectionContracts.js';
import {
  buildTrainingCancelTelegram,
  verifyTrainingCancelTelegram,
} from './trainingCancelTelegram.js';

export interface TrainingRetractorDeps extends PollerContextOptions {
  readonly clock: () => UtcIso8601String;
}

const WARNING_PREFECTURE_CODE = '130000';
const WARNING_MUNICIPAL_CODE = '1310800';
const CANCEL_INFO_TYPE = '取消';
const BULLETIN_TYPES: readonly string[] = ['VPBS50', 'VPHW50', 'VPHW51'];

interface PlannedItem {
  readonly itemNo: number;
  readonly trainingId: string;
  readonly targetSequence: number;
  readonly role: 'requested' | 'baseline';
  readonly target: TelegramReception;
  readonly outcome: TrainingRetractionOutcome;
  /** 取消対象の速報の EventID（速報のみ）。 */
  readonly eventId: string | null;
  xml?: string;
  documentUrl?: string;
}

function buildResult(
  connection: DatabaseConnection,
  retractionId: string,
): TrainingRetractionResult {
  const record = findTrainingRetraction(connection, retractionId)!;
  const items = listTrainingRetractionItems(connection, retractionId);
  return {
    retractionId,
    scope: record.scope,
    acceptedAt: record.acceptedAt,
    trainingIds: [...listTrainingRetractionTargets(connection, retractionId)],
    telegrams: items.map((item) => {
      const owner = findTrainingInjectionReceptionByReceptionId(connection, item.targetReceptionId);
      return {
        trainingId: owner?.trainingId ?? '',
        targetSequence: owner?.sequence ?? 0,
        telegramType: item.telegramType,
        role: owner?.role ?? 'baseline',
        outcome: item.outcome,
        receptionId: item.cancelReceptionId,
        adoptions:
          item.cancelReceptionId === null
            ? []
            : listTelegramReceptionAdoptions(connection, item.cancelReceptionId).map((a) => ({
                venueId: a.venueId,
                adoptionResult: a.adoptionResult,
                adoptionReason: a.adoptionReason,
              })),
      };
    }),
  };
}

export function resolveBulletinEventId(
  reception: TelegramReception,
  target: BosaiBulletinTarget,
): string | null {
  if (!reception.rawBody) return null;
  const result =
    reception.telegramType === 'VPBS50'
      ? parseVpbs50(reception.rawBody, reception, target)
      : parseVphw(reception.rawBody, reception, target);
  return result.ok ? result.value.eventId : null;
}

/** 現在その状態を作っている受信が対象の受信か（上書き済み判定）。 */
function classifyRequested(
  connection: DatabaseConnection,
  reception: TelegramReception,
  bulletinTarget: BosaiBulletinTarget,
): { outcome: TrainingRetractionOutcome; eventId: string | null } {
  const type = reception.telegramType ?? '';
  if (BULLETIN_TYPES.includes(type)) {
    const eventId = resolveBulletinEventId(reception, bulletinTarget);
    if (eventId === null) return { outcome: 'already_cancelled', eventId: null };
    const bulletin = findBosaiBulletin(connection, eventId, 'training');
    if (bulletin === null || bulletin.isCancelled) return { outcome: 'already_cancelled', eventId };
    if (bulletin.metadata.source !== reception.documentUrl)
      return { outcome: 'superseded', eventId };
    return { outcome: 'cancelled', eventId };
  }
  const stream = findWarningCurrentStream(
    connection,
    WARNING_PREFECTURE_CODE,
    WARNING_MUNICIPAL_CODE,
    'training',
    type as WarningTelegramType,
  );
  if (stream === null) return { outcome: 'already_cancelled', eventId: null };
  if (stream.receptionId === reception.id) return { outcome: 'cancelled', eventId: null };
  const current = findTelegramReceptionById(connection, stream.receptionId);
  if (current?.infoType === CANCEL_INFO_TYPE)
    return { outcome: 'already_cancelled', eventId: null };
  return { outcome: 'superseded', eventId: null };
}

function secondsFloorMs(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000) * 1000;
}

/**
 * Worker 側の訓練データ抹消処理（論理取消のみ）。
 * 取消電文を合成し、通常の取得・検証・正規化・状態更新パイプライン（ingestTelegramDocument）へ投入する。
 * 通知判定だけは行わない（通知 emit deps を外して渡す）。物理削除はしない。
 */
export async function retractTrainingTelegrams(
  connection: DatabaseConnection,
  command: TrainingRetractionCommand,
  deps: TrainingRetractorDeps,
): Promise<TrainingRetractionResult> {
  // 1. 冪等性
  const existing = findTrainingRetraction(connection, command.retractionId);
  if (existing) {
    if (existing.status === 'completed') return buildResult(connection, command.retractionId);
    throw new Error(TRAINING_RETRACTION_FAILED);
  }

  // 2. 対象訓練の決定と拒否判定
  const retracted = mapRetractedTrainingIds(connection);
  let targetIds: string[];
  if (command.scope === 'training') {
    const notFound: string[] = [];
    const already: string[] = [];
    for (const id of command.trainingIds) {
      const injection = findTrainingInjection(connection, id);
      if (
        !injection ||
        injection.status !== 'completed' ||
        !command.allowedTerminalIds.includes(injection.terminalId)
      ) {
        notFound.push(id);
      } else if (retracted.has(id)) {
        already.push(id);
      }
    }
    if (notFound.length > 0) {
      throw new Error(encodeRetractionRejection(TRAINING_RETRACTION_NOT_FOUND, notFound));
    }
    if (already.length > 0) {
      throw new Error(encodeRetractionRejection(TRAINING_RETRACTION_ALREADY_RETRACTED, already));
    }
    targetIds = [...command.trainingIds];
  } else {
    targetIds = listAllTrainingInjections(connection)
      .map((i) => i.trainingId)
      .filter((id) => !retracted.has(id));
  }
  targetIds.sort();

  const acceptedAt = deps.clock();
  const bulletinTarget =
    deps.bosaiBulletinTarget ??
    (deps.venueRegistry
      ? resolveBosaiBulletinTarget(deps.venueRegistry)
      : { includedAreaCodes: [] });

  // 3. 抹消記録
  insertTrainingRetraction(connection, {
    retractionId: command.retractionId,
    scope: command.scope,
    terminalId: command.terminalId,
    requestedAt: command.requestedAt,
    acceptedAt,
  });
  for (const id of targetIds) insertTrainingRetractionTarget(connection, command.retractionId, id);

  const fail = (code: string): never => {
    updateTrainingRetractionStatus(connection, command.retractionId, {
      status: 'failed',
      finishedAt: deps.clock(),
      errorCode: code,
    });
    throw new Error(TRAINING_RETRACTION_FAILED);
  };

  try {
    // 4. 候補の列挙と上書き済み判定
    const injections = new Map(listAllTrainingInjections(connection).map((i) => [i.trainingId, i]));
    const candidates = targetIds
      .flatMap((trainingId) =>
        listTrainingInjectionReceptions(connection, trainingId)
          .filter((r) => r.role === 'requested')
          .map((r) => ({
            trainingId,
            record: r,
            acceptedAt: injections.get(trainingId)!.acceptedAt,
          })),
      )
      .sort(
        (a, b) =>
          a.acceptedAt.localeCompare(b.acceptedAt) ||
          a.trainingId.localeCompare(b.trainingId) ||
          a.record.sequence - b.record.sequence,
      );

    const planned: PlannedItem[] = [];
    for (const candidate of candidates) {
      const reception = findTelegramReceptionById(connection, candidate.record.receptionId);
      if (!reception) continue;
      const { outcome, eventId } = classifyRequested(connection, reception, bulletinTarget);
      planned.push({
        itemNo: planned.length,
        trainingId: candidate.trainingId,
        targetSequence: candidate.record.sequence,
        role: 'requested',
        target: reception,
        outcome,
        eventId,
      });
    }

    if (command.scope === 'all') {
      const stream = findWarningCurrentStream(
        connection,
        WARNING_PREFECTURE_CODE,
        WARNING_MUNICIPAL_CODE,
        'training',
        'VPWS50',
      );
      const reception = stream ? findTelegramReceptionById(connection, stream.receptionId) : null;
      if (reception) {
        const owner = findTrainingInjectionReceptionByReceptionId(connection, reception.id);
        let outcome: TrainingRetractionOutcome;
        if (reception.infoType === CANCEL_INFO_TYPE) outcome = 'already_cancelled';
        else if (!owner || owner.role !== 'baseline') outcome = 'baseline_not_owned';
        else outcome = 'cancelled';
        planned.push({
          itemNo: planned.length,
          trainingId: owner?.trainingId ?? '',
          targetSequence: 0,
          role: 'baseline',
          target: reception,
          outcome,
          eventId: null,
        });
      }
    }

    // 5. 取消電文の合成と投入前検証（1通でも不合格なら何も投入しない）
    for (const item of planned) {
      if (item.outcome !== 'cancelled') continue;
      try {
        const telegramType = item.target.telegramType ?? '';
        // 既存より新しい Control/DateTime でなければ採用されないため、最低でも対象の1秒後にする
        const controlMs = Math.max(
          secondsFloorMs(deps.clock()),
          secondsFloorMs(item.target.controlDateTime ?? deps.clock()) + 1000,
        );
        const xml = buildTrainingCancelTelegram(item.target.rawBody ?? '', {
          controlDateTime: new Date(controlMs).toISOString(),
        });
        const documentUrl = trainingRetractionDocumentUrl(
          command.retractionId,
          item.itemNo,
          telegramType,
        );
        verifyTrainingCancelTelegram(xml, {
          documentUrl,
          telegramType,
          expectedEventId: item.eventId,
          originalXml: item.target.rawBody ?? '',
          bulletinTarget,
        });
        item.xml = xml;
        item.documentUrl = documentUrl;
      } catch {
        return fail('cancel_verification_failed');
      }
    }

    // 6. 投入（通知 emit deps を外し、状態更新だけを通常経路で行う）
    const { warningNotificationEmitDeps, bosaiNotificationEmitDeps, ...stateOnly } = deps;
    void warningNotificationEmitDeps;
    void bosaiNotificationEmitDeps;

    for (const item of planned) {
      const telegramType = item.target.telegramType ?? '';
      if (item.outcome !== 'cancelled') {
        insertTrainingRetractionItem(connection, {
          retractionId: command.retractionId,
          itemNo: item.itemNo,
          targetReceptionId: item.target.id,
          telegramType,
          outcome: item.outcome,
          cancelReceptionId: null,
        });
        continue;
      }
      const xml = item.xml!;
      const documentUrl = item.documentUrl!;
      const receivedAt = deps.clock();
      const contentHash = crypto.createHash('sha256').update(xml).digest('hex');
      const bodyBytes = Buffer.byteLength(xml, 'utf8');
      const attempt = recordFetchAttempt(connection, {
        sourceKind: TRAINING_RETRACTION_SOURCE_KIND,
        targetRef: command.retractionId,
        requestUrl: documentUrl,
        triggerKind: TRAINING_TRIGGER_KIND,
        attemptNo: 1,
        startedAt: receivedAt,
        finishedAt: receivedAt,
        durationMs: 0,
        outcome: 'success',
        httpStatus: null,
        responseBytes: bodyBytes,
        itemCount: null,
        failedItemCount: null,
        contentHash,
        errorKind: null,
        errorMessage: null,
      });
      await ingestTelegramDocument(
        connection,
        {
          documentUrl,
          xml,
          feedKind: TRAINING_FEED_KIND,
          feedEntryId: `${command.retractionId}:${item.itemNo}`,
          fetchAttemptId: attempt.id,
          receivedAt,
          bodyBytes,
          contentHash,
        },
        stateOnly,
        {
          afterRecord: (r) => {
            insertTrainingRetractionItem(connection, {
              retractionId: command.retractionId,
              itemNo: item.itemNo,
              targetReceptionId: item.target.id,
              telegramType,
              outcome: 'cancelled',
              cancelReceptionId: r.id,
            });
          },
        },
      );
    }

    // 7. 完了記録
    updateTrainingRetractionStatus(connection, command.retractionId, {
      status: 'completed',
      finishedAt: deps.clock(),
    });
    return buildResult(connection, command.retractionId);
  } catch (error) {
    if (error instanceof Error && error.message === TRAINING_RETRACTION_FAILED) throw error;
    return fail(error instanceof Error ? error.message || 'failed' : 'failed');
  }
}
