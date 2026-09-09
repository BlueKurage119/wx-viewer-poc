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
import {
  VPWP50_TELEGRAM_TYPE,
  WARNING_TELEGRAM_TYPES,
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
}

interface HttpGetResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly bodyText: string | null;
  readonly responseBytes: number | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
}

function sanitizeErrorMessage(msg: string): string {
  // 秘密情報やヘッダ情報、認証情報が漏れないようにサニタイズ
  return msg.replace(/:\/\/([^:]+):([^@]+)@/g, '://***:***@').slice(0, 500);
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function performHttpGet(
  url: string,
  options?: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<HttpGetResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([timeoutSignal, controller.signal]);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/xml, text/xml, */*',
        'User-Agent': 'wx-viewer-poc/0.1.0',
      },
      signal: combinedSignal,
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        bodyText: null,
        responseBytes: null,
        errorKind: 'http_status',
        errorMessage: sanitizeErrorMessage(`HTTP ${res.status} ${res.statusText}`),
      };
    }

    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf-8');

    return {
      ok: true,
      status: res.status,
      bodyText: text,
      responseBytes: bytes,
      errorKind: null,
      errorMessage: null,
    };
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string; code?: string };
    const isTimeout =
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      err?.code === 'UND_ERR_CONNECT_TIMEOUT';

    return {
      ok: false,
      status: null,
      bodyText: null,
      responseBytes: null,
      errorKind: isTimeout ? 'timeout' : 'network',
      errorMessage: sanitizeErrorMessage(err?.message ?? String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

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
