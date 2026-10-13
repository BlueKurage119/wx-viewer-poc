import crypto from 'node:crypto';
import type { TrainingTelegramType, UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import {
  findTelegramReceptionById,
  listTelegramReceptionAdoptions,
} from '../repositories/telegramReceptionRepository.js';
import {
  findTrainingInjection,
  insertTrainingInjection,
  insertTrainingInjectionReception,
  listTrainingInjectionReceptions,
  updateTrainingInjectionStatus,
} from '../repositories/trainingInjectionRepository.js';
import { findBosaiBulletin } from '../repositories/bosaiBulletinRepository.js';
import { resolveBosaiBulletinTarget } from '../venueForecastTargets.js';
import { parseTelegramXml } from '../polling/jmaXmlFeedParser.js';
import { setTrainingControlDateTime } from './trainingCancelTelegram.js';
import { resolveBulletinEventId } from './trainingRetractor.js';
import { findWarningCurrentStream } from '../repositories/warningCurrentStreamRepository.js';
import { ingestTelegramDocument, type PollerContextOptions } from '../polling/jmaXmlPoller.js';
import {
  TRAINING_FEED_KIND,
  TRAINING_SOURCE_KIND,
  TRAINING_TRIGGER_KIND,
  trainingDocumentUrl,
  type TrainingInjectionCommand,
  type TrainingInjectionResult,
} from './trainingInjectionContracts.js';
import {
  generateTrainingWarningBaseline,
  verifyTrainingWarningBaseline,
} from './trainingWarningBaseline.js';

/**
 * 抹消（取消電文）で取消済みの状態を更新する電文は、Control/DateTime が取消電文以下だと
 * 「重複または旧版」で採用されない。その場合に限り Control/DateTime だけを取消の1秒後以上へ書き換える
 * （J2 の「XML は書き換えない」の例外。生成検証は書き換え前の XML に対して済んでいる）。
 */
function adjustForCancelledState(
  connection: DatabaseConnection,
  xml: string,
  telegramType: string,
  deps: TrainingInjectorDeps,
): string {
  const documentUrl = `training://adjust/_${telegramType}_.xml`;
  const envelope = parseTelegramXml(xml, documentUrl);
  if (!envelope.isValidEnvelope || !envelope.controlDateTime) return xml;
  const own = Date.parse(envelope.controlDateTime);
  let cancelControlMs: number | null = null;
  if (telegramType.startsWith('VPWW')) {
    const stream = findWarningCurrentStream(
      connection,
      '130000',
      '1310800',
      'training',
      telegramType as never,
    );
    if (stream && findTelegramReceptionById(connection, stream.receptionId)?.infoType === '取消') {
      cancelControlMs = Date.parse(stream.controlDateTime);
    }
  } else {
    const target =
      deps.bosaiBulletinTarget ??
      (deps.venueRegistry
        ? resolveBosaiBulletinTarget(deps.venueRegistry)
        : { includedAreaCodes: [] });
    const eventId = resolveBulletinEventId(
      {
        telegramType,
        controlStatus: 'training',
        reportDateTime: envelope.reportDateTime,
        controlDateTime: envelope.controlDateTime,
        rawBody: xml,
      } as never,
      target,
    );
    const bulletin = eventId === null ? null : findBosaiBulletin(connection, eventId, 'training');
    if (bulletin?.isCancelled) cancelControlMs = Date.parse(bulletin.controlDateTime);
  }
  if (cancelControlMs === null || own > cancelControlMs) return xml;
  return setTrainingControlDateTime(xml, new Date(cancelControlMs + 1000).toISOString());
}

export interface TrainingInjectorDeps extends PollerContextOptions {
  readonly clock: () => UtcIso8601String;
}

function buildInjectionResult(
  connection: DatabaseConnection,
  trainingId: string,
  injectedAt: string,
): TrainingInjectionResult {
  const receptions = listTrainingInjectionReceptions(connection, trainingId);

  const baselineRow = receptions.find((r) => r.role === 'baseline');
  let baseline: TrainingInjectionResult['baseline'] = null;
  if (baselineRow) {
    const baselineReception = findTelegramReceptionById(connection, baselineRow.receptionId);
    const adoptions = listTelegramReceptionAdoptions(connection, baselineRow.receptionId).map(
      (a) => ({
        venueId: a.venueId,
        adoptionResult: a.adoptionResult,
        adoptionReason: a.adoptionReason,
      }),
    );
    baseline = {
      sequence: 0,
      receptionId: baselineRow.receptionId,
      documentUrl: trainingDocumentUrl(trainingId, 0, 'VPWS50'),
      reportDateTime: baselineReception?.reportDateTime ?? '',
      adoptions,
    };
  }

  const requestedRows = receptions.filter((r) => r.role === 'requested');
  const telegrams = requestedRows.map((r) => {
    const adoptions = listTelegramReceptionAdoptions(connection, r.receptionId).map((a) => ({
      venueId: a.venueId,
      adoptionResult: a.adoptionResult,
      adoptionReason: a.adoptionReason,
    }));
    return {
      previewId: r.previewId!,
      sequence: r.sequence,
      telegramType: r.telegramType as TrainingTelegramType,
      receptionId: r.receptionId,
      documentUrl: trainingDocumentUrl(
        trainingId,
        r.sequence,
        r.telegramType as TrainingTelegramType,
      ),
      adoptions,
    };
  });

  return {
    trainingId,
    injectedAt,
    telegrams,
    baseline,
  };
}

/**
 * Worker 側の訓練電文注入処理。
 * 通常の取得・検証・正規化・通知判定パイプライン（ingestTelegramDocument）を経由する。
 */
export async function injectTrainingTelegrams(
  connection: DatabaseConnection,
  command: TrainingInjectionCommand,
  deps: TrainingInjectorDeps,
): Promise<TrainingInjectionResult> {
  // 1. 冪等性チェック
  const existing = findTrainingInjection(connection, command.trainingId);
  if (existing) {
    if (existing.status === 'completed') {
      return buildInjectionResult(connection, command.trainingId, existing.acceptedAt);
    }
    const err = new Error('training_injection_failed');
    (err as unknown as { trainingId: string }).trainingId = command.trainingId;
    throw err;
  }

  const acceptedAt = deps.clock();

  // 2. 注入記録の作成（in_progress）
  insertTrainingInjection(connection, {
    trainingId: command.trainingId,
    terminalId: command.terminalId,
    requestedAt: command.requestedAt,
    acceptedAt,
    telegramCount: command.telegrams.length,
    status: 'in_progress',
  });

  try {
    // 3. 基準電文の判定と投入（H1）
    const warningTelegrams = command.telegrams.filter((t) => t.telegramType.startsWith('VPWW'));
    const existingStream = findWarningCurrentStream(
      connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    );
    // 全抹消で基準電文が取消済み（ストリームが取消電文を指す）の場合も再投入する（Issue #71 J3）
    const cancelledStream =
      existingStream !== null &&
      findTelegramReceptionById(connection, existingStream.receptionId)?.infoType === '取消'
        ? existingStream
        : null;
    const needBaseline =
      warningTelegrams.length > 0 && (existingStream === null || cancelledStream !== null);

    if (needBaseline) {
      const minReportMs = Math.min(...warningTelegrams.map((t) => Date.parse(t.reportDateTime)));
      const normalTbMs = Math.floor((minReportMs - 60_000) / 60_000) * 60_000;
      // 取消済みストリームより古い発表時刻にはしない（同時刻は Control/DateTime の新しさで採用させる）
      const tbMs = cancelledStream
        ? Math.max(normalTbMs, Date.parse(cancelledStream.reportDateTime))
        : normalTbMs;
      const tbIso = new Date(tbMs).toISOString();
      // Control/DateTime は秒精度で書き出すため、検証の期待値も秒に切り捨てて揃える
      let controlMs = Math.floor(Date.parse(deps.clock()) / 1000) * 1000;
      if (cancelledStream) {
        controlMs = Math.max(controlMs, Date.parse(cancelledStream.controlDateTime) + 1000);
      }
      const controlDateTime = new Date(controlMs).toISOString();

      const baselineXml = generateTrainingWarningBaseline({
        reportDateTime: tbIso,
        controlDateTime,
      });

      verifyTrainingWarningBaseline(baselineXml, {
        reportDateTime: tbIso,
        controlDateTime,
      });

      const sequence = 0;
      const documentUrl = trainingDocumentUrl(command.trainingId, sequence, 'VPWS50');
      const receivedAt = deps.clock();
      const contentHash = crypto.createHash('sha256').update(baselineXml).digest('hex');
      const bodyBytes = Buffer.byteLength(baselineXml, 'utf8');

      const docAttempt = recordFetchAttempt(connection, {
        sourceKind: TRAINING_SOURCE_KIND,
        targetRef: command.trainingId,
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
          xml: baselineXml,
          feedKind: TRAINING_FEED_KIND,
          feedEntryId: `${command.trainingId}:baseline`,
          fetchAttemptId: docAttempt.id,
          receivedAt,
          bodyBytes,
          contentHash,
        },
        deps,
        {
          afterRecord: (r) => {
            insertTrainingInjectionReception(connection, {
              trainingId: command.trainingId,
              sequence,
              receptionId: r.id,
              role: 'baseline',
              previewId: null,
              telegramType: 'VPWS50',
            });
          },
        },
      );
    }

    // 4. 要求電文の投入
    const sortedTelegrams = [...command.telegrams].sort((a, b) => a.order - b.order);

    for (const entry of sortedTelegrams) {
      const xml = adjustForCancelledState(connection, entry.xml, entry.telegramType, deps);
      const sequence = needBaseline ? entry.order + 1 : entry.order;
      const documentUrl = trainingDocumentUrl(command.trainingId, sequence, entry.telegramType);
      const receivedAt = deps.clock();
      const contentHash = crypto.createHash('sha256').update(xml).digest('hex');
      const bodyBytes = Buffer.byteLength(xml, 'utf8');

      const docAttempt = recordFetchAttempt(connection, {
        sourceKind: TRAINING_SOURCE_KIND,
        targetRef: command.trainingId,
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
          feedEntryId: entry.previewId,
          fetchAttemptId: docAttempt.id,
          receivedAt,
          bodyBytes,
          contentHash,
        },
        deps,
        {
          afterRecord: (r) => {
            insertTrainingInjectionReception(connection, {
              trainingId: command.trainingId,
              sequence,
              receptionId: r.id,
              role: 'requested',
              previewId: entry.previewId,
              telegramType: entry.telegramType,
            });
          },
        },
      );
    }

    // 5. 完了記録
    const finishedAt = deps.clock();
    updateTrainingInjectionStatus(connection, command.trainingId, {
      status: 'completed',
      finishedAt,
    });

    return buildInjectionResult(connection, command.trainingId, acceptedAt);
  } catch (error) {
    const finishedAt = deps.clock();
    const errorCode = error instanceof Error ? error.message : 'failed';
    updateTrainingInjectionStatus(connection, command.trainingId, {
      status: 'failed',
      finishedAt,
      errorCode,
    });
    const failureError = new Error('training_injection_failed');
    (failureError as unknown as { trainingId: string }).trainingId = command.trainingId;
    throw failureError;
  }
}
