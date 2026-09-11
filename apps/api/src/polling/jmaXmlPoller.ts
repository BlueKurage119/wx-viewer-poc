import crypto from 'node:crypto';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { recordFetchAttempt } from '../repositories/fetchAttemptRepository.js';
import {
  hasTelegramReception,
  recordTelegramReception,
} from '../repositories/telegramReceptionRepository.js';
import type { FetchAttemptInput, TelegramReceptionInput } from '../repositories/types.js';
import type { FeedPollResult, JmaXmlFeedDefinition, JmaXmlPollTrigger } from './jmaXmlFeeds.js';
import { parseAtomFeed, parseTelegramXml, type ParseAtomFeedOptions } from './jmaXmlFeedParser.js';
import {
  DEFAULT_WARNING_TARGET_AREA,
  processWarningTelegramReception,
} from './jmaWarningTelegramProcessor.js';
import { DEFAULT_VPWP50_TARGET_AREA } from './jmaVpwp50Parser.js';
import { processVpwp50Reception } from './jmaVpwp50Processor.js';
import { DEFAULT_EARLY_WARNING_TARGET_AREA } from './jmaEarlyWarningParser.js';
import { processEarlyWarningReception } from './jmaEarlyWarningProcessor.js';
import { DEFAULT_AREA_TIMESERIES_FORECAST_TARGET } from './jmaVpfd51Parser.js';
import { processVpfd51Reception } from './jmaVpfd51Processor.js';
import { DEFAULT_BOSAI_BULLETIN_TARGET } from './jmaVpbs50Parser.js';
import { processVpbs50Reception } from './jmaVpbs50Processor.js';
import { processVphwReception } from './jmaVphwProcessor.js';
import {
  VPHW50_TELEGRAM_TYPE,
  VPHW51_TELEGRAM_TYPE,
  VPBS50_TELEGRAM_TYPE,
  VPFD51_TELEGRAM_TYPE,
  VPFD61_TELEGRAM_TYPE,
  VPFW60_TELEGRAM_TYPE,
  VPWP50_TELEGRAM_TYPE,
  WARNING_TELEGRAM_TYPES,
  type AreaTimeseriesForecastTarget,
  type BosaiBulletinTarget,
  type EarlyWarningTargetArea,
  type WarningCurrentTargetArea,
  type WarningTargetArea,
  type WarningTimeseriesTargetArea,
} from '../repositories/types.js';

export interface PollerContextOptions extends ParseAtomFeedOptions {
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;
  readonly warningTargetArea?: WarningTargetArea | WarningCurrentTargetArea;
  readonly warningTimeseriesTargetArea?: WarningTimeseriesTargetArea;
  readonly earlyWarningTargetArea?: EarlyWarningTargetArea;
  readonly areaTimeseriesForecastTarget?: AreaTimeseriesForecastTarget;
  readonly bosaiBulletinTarget?: BosaiBulletinTarget;
}
import { performHttpGet, sanitizeErrorMessage, sanitizeUrl } from './httpGet.js';

export async function pollSingleFeed(
  connection: DatabaseConnection,
  feedDef: JmaXmlFeedDefinition,
  trigger: JmaXmlPollTrigger,
  attemptNo: number,
  processedUrlsInCycle: Set<string>,
  options?: PollerContextOptions,
): Promise<{
  readonly feedResult: FeedPollResult;
  readonly isFeedFetchSuccess: boolean;
  readonly errorReason: string | null;
}> {
  const nowFn = options?.clock ?? (() => new Date().toISOString());
  const startedAt = nowFn();
  const startTimeMs = Date.now();

  const sanitizedFeedUrl = sanitizeUrl(feedDef.url);

  // 1. フィードの HTTP GET
  const feedHttpResult = await performHttpGet(sanitizedFeedUrl, {
    fetchFn: options?.fetchFn,
    timeoutMs: options?.timeoutMs,
  });

  const durationMs = Math.max(0, Date.now() - startTimeMs);
  const finishedAt = nowFn();

  if (!feedHttpResult.ok || !feedHttpResult.bodyText) {
    // フィードの HTTP 取得失敗を記録
    const attemptInput: FetchAttemptInput = {
      sourceKind: feedDef.sourceKind,
      targetRef: feedDef.kind,
      requestUrl: sanitizedFeedUrl,
      triggerKind: trigger,
      attemptNo,
      startedAt,
      finishedAt,
      durationMs,
      outcome: 'failure',
      httpStatus: feedHttpResult.status,
      responseBytes: feedHttpResult.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: null,
      errorKind: feedHttpResult.errorKind,
      errorMessage: feedHttpResult.errorMessage,
    };
    recordFetchAttempt(connection, attemptInput);

    return {
      feedResult: {
        feedKind: feedDef.kind,
        discoveredCount: 0,
        skippedDuplicateCount: 0,
        downloadedCount: 0,
        failedDocumentCount: 0,
      },
      isFeedFetchSuccess: false,
      errorReason: feedHttpResult.errorMessage,
    };
  }

  // フィード本文の SHA-256
  const feedHash = crypto.createHash('sha256').update(feedHttpResult.bodyText).digest('hex');

  // 2. Atom フィードの解析
  let entries;
  try {
    entries = parseAtomFeed(feedHttpResult.bodyText, options);
  } catch (error: unknown) {
    const parseErrMsg = sanitizeErrorMessage(String(error));
    // パース失敗を記録
    const attemptInput: FetchAttemptInput = {
      sourceKind: feedDef.sourceKind,
      targetRef: feedDef.kind,
      requestUrl: sanitizedFeedUrl,
      triggerKind: trigger,
      attemptNo,
      startedAt,
      finishedAt,
      durationMs,
      outcome: 'failure',
      httpStatus: feedHttpResult.status,
      responseBytes: feedHttpResult.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: feedHash,
      errorKind: 'parse',
      errorMessage: parseErrMsg,
    };
    recordFetchAttempt(connection, attemptInput);

    return {
      feedResult: {
        feedKind: feedDef.kind,
        discoveredCount: 0,
        skippedDuplicateCount: 0,
        downloadedCount: 0,
        failedDocumentCount: 0,
      },
      isFeedFetchSuccess: false,
      errorReason: parseErrMsg,
    };
  }

  // フィード取得成功を記録
  recordFetchAttempt(connection, {
    sourceKind: feedDef.sourceKind,
    targetRef: feedDef.kind,
    requestUrl: sanitizedFeedUrl,
    triggerKind: trigger,
    attemptNo,
    startedAt,
    finishedAt,
    durationMs,
    outcome: 'success',
    httpStatus: feedHttpResult.status,
    responseBytes: feedHttpResult.responseBytes,
    itemCount: null,
    failedItemCount: null,
    contentHash: feedHash,
    errorKind: null,
    errorMessage: null,
  });

  let discoveredCount = 0;
  let skippedDuplicateCount = 0;
  let downloadedCount = 0;
  let failedDocumentCount = 0;

  // 3. 各エントリの処理
  for (const entry of entries) {
    discoveredCount++;
    const docUrl = sanitizeUrl(entry.documentUrl);

    // サイクル内重複抑止
    if (processedUrlsInCycle.has(docUrl)) {
      skippedDuplicateCount++;
      continue;
    }

    // DB既受信抑止
    if (hasTelegramReception(connection, docUrl)) {
      processedUrlsInCycle.add(docUrl);
      skippedDuplicateCount++;
      continue;
    }

    // このサイクルで処理済みとしてマーク
    processedUrlsInCycle.add(docUrl);

    // 個別電文 XML の GET
    const docStartedAt = nowFn();
    const docStartTimeMs = Date.now();

    const docHttpResult = await performHttpGet(docUrl, {
      fetchFn: options?.fetchFn,
      timeoutMs: options?.timeoutMs,
    });

    const docDurationMs = Math.max(0, Date.now() - docStartTimeMs);
    const docFinishedAt = nowFn();

    if (!docHttpResult.ok || !docHttpResult.bodyText) {
      failedDocumentCount++;
      // 個別電文の HTTP 失敗を fetch_attempt に記録（telegram_reception の空行は作らない）
      recordFetchAttempt(connection, {
        sourceKind: 'xml_document',
        targetRef: feedDef.kind,
        requestUrl: docUrl,
        triggerKind: trigger,
        attemptNo: 1,
        startedAt: docStartedAt,
        finishedAt: docFinishedAt,
        durationMs: docDurationMs,
        outcome: 'failure',
        httpStatus: docHttpResult.status,
        responseBytes: docHttpResult.responseBytes,
        itemCount: null,
        failedItemCount: null,
        contentHash: null,
        errorKind: docHttpResult.errorKind,
        errorMessage: docHttpResult.errorMessage,
      });
      continue;
    }

    downloadedCount++;
    const docHash = crypto.createHash('sha256').update(docHttpResult.bodyText).digest('hex');

    // 電文取得の成功を fetch_attempt に記録
    const docAttempt = recordFetchAttempt(connection, {
      sourceKind: 'xml_document',
      targetRef: feedDef.kind,
      requestUrl: docUrl,
      triggerKind: trigger,
      attemptNo: 1,
      startedAt: docStartedAt,
      finishedAt: docFinishedAt,
      durationMs: docDurationMs,
      outcome: 'success',
      httpStatus: docHttpResult.status,
      responseBytes: docHttpResult.responseBytes,
      itemCount: null,
      failedItemCount: null,
      contentHash: docHash,
      errorKind: null,
      errorMessage: null,
    });

    // 共通エンベロープの解析
    const parsed = parseTelegramXml(docHttpResult.bodyText, docUrl);

    // telegram_reception への保存
    const receptionInput: TelegramReceptionInput = {
      fetchAttemptId: docAttempt.id,
      feedKind: feedDef.kind,
      feedEntryId: entry.id,
      documentUrl: docUrl,
      telegramType: parsed.telegramType,
      title: parsed.title,
      controlStatus: parsed.controlStatus,
      infoType: parsed.infoType,
      eventId: parsed.eventId,
      serial: parsed.serial,
      controlDateTime: parsed.controlDateTime,
      reportDateTime: parsed.reportDateTime,
      targetDateTime: parsed.targetDateTime,
      receivedAt: docFinishedAt,
      adoptionResult: parsed.isValidEnvelope ? null : '未対応形式',
      adoptionReason: parsed.isValidEnvelope ? null : parsed.validationErrorReason,
      adoptionDecidedAt: null,
      rawBody: docHttpResult.bodyText,
      bodyBytes: docHttpResult.responseBytes,
      contentHash: docHash,
      areas: parsed.areas,
    };

    const reception = recordTelegramReception(connection, receptionInput);
    if (
      reception.telegramType &&
      (WARNING_TELEGRAM_TYPES as readonly string[]).includes(reception.telegramType)
    ) {
      processWarningTelegramReception(
        connection,
        reception,
        docFinishedAt,
        options?.warningTargetArea ?? DEFAULT_WARNING_TARGET_AREA,
      );
    } else if (reception.telegramType === VPWP50_TELEGRAM_TYPE) {
      processVpwp50Reception(
        connection,
        reception,
        docFinishedAt,
        options?.warningTimeseriesTargetArea ?? DEFAULT_VPWP50_TARGET_AREA,
      );
    } else if (
      reception.telegramType === VPFD61_TELEGRAM_TYPE ||
      reception.telegramType === VPFW60_TELEGRAM_TYPE
    ) {
      processEarlyWarningReception(
        connection,
        reception,
        docFinishedAt,
        options?.earlyWarningTargetArea ?? DEFAULT_EARLY_WARNING_TARGET_AREA,
      );
    } else if (reception.telegramType === VPFD51_TELEGRAM_TYPE) {
      processVpfd51Reception(
        connection,
        reception,
        docFinishedAt,
        options?.areaTimeseriesForecastTarget ?? DEFAULT_AREA_TIMESERIES_FORECAST_TARGET,
      );
    } else if (reception.telegramType === VPBS50_TELEGRAM_TYPE) {
      processVpbs50Reception(
        connection,
        reception,
        docFinishedAt,
        options?.bosaiBulletinTarget ?? DEFAULT_BOSAI_BULLETIN_TARGET,
      );
    } else if (
      reception.telegramType === VPHW50_TELEGRAM_TYPE ||
      reception.telegramType === VPHW51_TELEGRAM_TYPE
    ) {
      processVphwReception(
        connection,
        reception,
        docFinishedAt,
        options?.bosaiBulletinTarget ?? DEFAULT_BOSAI_BULLETIN_TARGET,
      );
    }
  }

  return {
    feedResult: {
      feedKind: feedDef.kind,
      discoveredCount,
      skippedDuplicateCount,
      downloadedCount,
      failedDocumentCount,
    },
    isFeedFetchSuccess: true,
    errorReason: null,
  };
}
