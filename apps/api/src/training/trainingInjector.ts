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
    const needBaseline = warningTelegrams.length > 0 && existingStream === null;

    if (needBaseline) {
      const minReportMs = Math.min(...warningTelegrams.map((t) => Date.parse(t.reportDateTime)));
      const tbMs = Math.floor((minReportMs - 60_000) / 60_000) * 60_000;
      const tbIso = new Date(tbMs).toISOString();
      const controlDateTime = deps.clock();

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
      const sequence = needBaseline ? entry.order + 1 : entry.order;
      const documentUrl = trainingDocumentUrl(command.trainingId, sequence, entry.telegramType);
      const receivedAt = deps.clock();
      const contentHash = crypto.createHash('sha256').update(entry.xml).digest('hex');
      const bodyBytes = Buffer.byteLength(entry.xml, 'utf8');

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
          xml: entry.xml,
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
