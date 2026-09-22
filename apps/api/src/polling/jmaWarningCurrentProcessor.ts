import type { DatabaseConnection } from '../database/index.js';
import {
  findTelegramReceptionById,
  findWarningCurrentSnapshot,
  findWarningCurrentStream,
  listWarningCurrentStreams,
  listWarningRecoveryCandidates,
  saveWarningCurrentSnapshot,
  upsertWarningCurrentStream,
  deleteWarningCurrentStreams,
  deleteWarningCurrentSnapshot,
} from '../repositories/index.js';
import type { VenueWarningContext } from '../venueForecastTargets.js';
import {
  INDIVIDUAL_WARNING_TELEGRAM_TYPES,
  type ControlStatus,
  type IndividualWarningTelegramType,
  type ParsedWarningTelegram,
  type TelegramReception,
  type WarningCurrentApplyResult,
  type WarningCurrentChange,
  type WarningCurrentReductionResult,
  type WarningCurrentSnapshotInput,
  type WarningCurrentStream,
  type WarningCurrentStreamInput,
  type WarningCurrentTargetArea,
  type WarningTelegramType,
} from '../repositories/types.js';
import { parseWarningTelegram } from './jmaWarningTelegramParser.js';
import {
  computeSourceVersion,
  diffWarningCurrent,
  extractActiveKindsByPhenomenon,
  reduceWarningCurrent,
  WarningCurrentConflictError,
  WarningCurrentUnsupportedError,
} from './jmaWarningCurrentReducer.js';

/**
 * 新規受信した電文を C3 現況へ適用する。
 * 1 つのトランザクション内でストリームポインター更新とスナップショット保存を行う。
 */
export function applyWarningCurrentReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  parsed: ParsedWarningTelegram,
  targetArea: WarningCurrentTargetArea,
): WarningCurrentApplyResult {
  // 1. InfoType の検証（§3.7）
  if (
    parsed.infoType !== null &&
    parsed.infoType !== '発表' &&
    parsed.infoType !== '訂正' &&
    parsed.infoType !== '取消'
  ) {
    return {
      applied: false,
      reason: 'cancelled',
      detail: `未知の InfoType です: ${parsed.infoType}`,
    };
  }

  // 2. 電文バリデーション（コード・Status・整合性）
  // 取消電文の本文 Kind は一切解釈しない（§4.6.1）
  if (parsed.infoType !== '取消') {
    try {
      extractActiveKindsByPhenomenon(parsed);
    } catch (err) {
      if (err instanceof WarningCurrentUnsupportedError) {
        return { applied: false, reason: err.reasonKind, detail: err.message };
      }
      if (err instanceof WarningCurrentConflictError) {
        return { applied: false, reason: 'same_version_conflict', detail: err.message };
      }
      throw err;
    }
  }

  const transaction = connection.transaction((): WarningCurrentApplyResult => {
    // 3.1 既存のストリームポインターを確認
    const existingStream = findWarningCurrentStream(
      connection,
      targetArea.prefectureCode,
      targetArea.municipalCode,
      parsed.controlStatus,
      parsed.telegramType,
    );

    // 3.2 版比較（§3.4）
    if (existingStream) {
      if (parsed.reportDateTime < existingStream.reportDateTime) {
        return {
          applied: false,
          reason: 'stale',
          detail: `より新しい reportDateTime のストリームが既に存在します (既存: ${existingStream.reportDateTime}, 入力: ${parsed.reportDateTime})`,
        };
      }
      if (parsed.reportDateTime === existingStream.reportDateTime) {
        if (parsed.controlDateTime < existingStream.controlDateTime) {
          return {
            applied: false,
            reason: 'stale',
            detail: `より新しい controlDateTime のストリームが既に存在します (既存: ${existingStream.controlDateTime}, 入力: ${parsed.controlDateTime})`,
          };
        }
        if (parsed.controlDateTime === existingStream.controlDateTime) {
          if (reception.contentHash === existingStream.contentHash) {
            return {
              applied: false,
              reason: 'duplicate',
              detail: '同一時刻かつ同一 contentHash の重複受信です',
            };
          } else {
            return {
              applied: false,
              reason: 'same_version_conflict',
              detail: '同一時刻で contentHash が異なる同版競合です',
            };
          }
        }
      }
    }

    // 3.3 今回のストリーム候補（メモリ上で準備し、検証完了まで DB へ書き込まない）
    const candidateStream: WarningCurrentStream = {
      id: existingStream?.id ?? 0,
      prefectureCode: targetArea.prefectureCode,
      areaCode: targetArea.municipalCode,
      controlStatus: parsed.controlStatus,
      telegramType: parsed.telegramType,
      receptionId: reception.id,
      reportDateTime: parsed.reportDateTime,
      controlDateTime: parsed.controlDateTime,
      receivedAt: reception.receivedAt,
      contentHash: reception.contentHash ?? '',
    };

    // 3.4 VPWS50 ポインターの確認
    const vpws50Stream =
      parsed.telegramType === 'VPWS50'
        ? candidateStream
        : findWarningCurrentStream(
            connection,
            targetArea.prefectureCode,
            targetArea.municipalCode,
            parsed.controlStatus,
            'VPWS50',
          );

    if (!vpws50Stream) {
      // VPWS50 がまだない -> snapshot は作成せず uninitialized
      // （初期化前に受け取った個別ストリームはポインターへ保存する: §3.3）
      upsertWarningCurrentStream(connection, {
        prefectureCode: targetArea.prefectureCode,
        areaCode: targetArea.municipalCode,
        controlStatus: parsed.controlStatus,
        telegramType: parsed.telegramType,
        receptionId: reception.id,
        reportDateTime: parsed.reportDateTime,
        controlDateTime: parsed.controlDateTime,
        receivedAt: reception.receivedAt,
        contentHash: reception.contentHash ?? '',
      });
      return {
        applied: false,
        reason: 'uninitialized',
        detail: '有効な VPWS50 による初期化が完了していません',
      };
    }

    // 3.5 全ストリームポインターをメモリ上で構築し、電文を読み出してパース
    const allExistingStreams = listWarningCurrentStreams(
      connection,
      targetArea.prefectureCode,
      targetArea.municipalCode,
      parsed.controlStatus,
    );

    const streamMap = new Map<WarningTelegramType, WarningCurrentStream>();
    for (const s of allExistingStreams) {
      streamMap.set(s.telegramType, s);
    }
    // 今回の電文でストリームポインターを上書き（メモリ上）
    streamMap.set(parsed.telegramType, candidateStream);

    let vpws50Parsed: ParsedWarningTelegram;
    if (parsed.telegramType === 'VPWS50') {
      vpws50Parsed = parsed;
    } else {
      const vpws50Reception = findTelegramReceptionById(connection, vpws50Stream.receptionId);
      if (!vpws50Reception || !vpws50Reception.rawBody) {
        throw new Error(`VPWS50 電文の取得に失敗しました: receptionId=${vpws50Stream.receptionId}`);
      }
      const vpws50ParseResult = parseWarningTelegram(
        vpws50Reception.rawBody,
        vpws50Reception,
        targetArea,
      );
      if (!vpws50ParseResult.ok) {
        throw new Error(`VPWS50 電文の再解析に失敗しました: ${vpws50ParseResult.reason}`);
      }
      vpws50Parsed = vpws50ParseResult.value;
    }

    const individualMap = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();
    const cancelledMap = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();

    for (const [type, s] of streamMap) {
      if (type !== 'VPWS50') {
        if (type === parsed.telegramType) {
          if (parsed.infoType === '取消') {
            cancelledMap.set(type as IndividualWarningTelegramType, parsed);
          } else {
            individualMap.set(type as IndividualWarningTelegramType, parsed);
          }
        } else {
          const indReception = findTelegramReceptionById(connection, s.receptionId);
          if (indReception?.rawBody) {
            const indParseResult = parseWarningTelegram(
              indReception.rawBody,
              indReception,
              targetArea,
            );
            if (indParseResult.ok) {
              if (indParseResult.value.infoType === '取消') {
                cancelledMap.set(type as IndividualWarningTelegramType, indParseResult.value);
              } else {
                individualMap.set(type as IndividualWarningTelegramType, indParseResult.value);
              }
            }
          }
        }
      }
    }

    // 3.6 現況の合成
    let reduction: WarningCurrentReductionResult;
    if (vpws50Parsed.infoType === '取消') {
      // H1 / §4.6.1: VPWS50 取消時は現況を空にする
      reduction = {
        items: [],
        contributingTelegramTypes: ['VPWS50'],
      };
    } else {
      try {
        reduction = reduceWarningCurrent(vpws50Parsed, individualMap, cancelledMap);
      } catch (err) {
        if (err instanceof WarningCurrentConflictError) {
          return { applied: false, reason: 'same_version_conflict', detail: err.message };
        }
        if (err instanceof WarningCurrentUnsupportedError) {
          return { applied: false, reason: err.reasonKind, detail: err.message };
        }
        throw err;
      }
    }

    // 3.7 差分計算
    const existingSnapshot = findWarningCurrentSnapshot(
      connection,
      targetArea.municipalCode,
      parsed.controlStatus,
    );

    const origin = existingSnapshot ? 'normal' : 'initial';
    const beforeItems = existingSnapshot ? existingSnapshot.items : [];

    let changes: readonly WarningCurrentChange[];
    try {
      changes = diffWarningCurrent(beforeItems, reduction.items);
    } catch (err) {
      if (err instanceof WarningCurrentConflictError) {
        return { applied: false, reason: 'same_version_conflict', detail: err.message };
      }
      throw err;
    }

    // 3.8 すべての競合・検証チェックを通過した後にストリームポインターを永続化（原子性保証）
    upsertWarningCurrentStream(connection, {
      prefectureCode: targetArea.prefectureCode,
      areaCode: targetArea.municipalCode,
      controlStatus: parsed.controlStatus,
      telegramType: parsed.telegramType,
      receptionId: reception.id,
      reportDateTime: parsed.reportDateTime,
      controlDateTime: parsed.controlDateTime,
      receivedAt: reception.receivedAt,
      contentHash: reception.contentHash ?? '',
    });

    // 3.9 メタ情報の構成
    const contributingStreams: Array<{
      telegramType: WarningTelegramType;
      reportDateTime: string;
      controlDateTime: string;
      contentHash: string;
      receivedAt: string;
      infoType: string | null;
      eventId: string | null;
    }> = [];

    for (const type of reduction.contributingTelegramTypes) {
      const s = streamMap.get(type);
      if (s) {
        const telegramParsed =
          type === 'VPWS50'
            ? vpws50Parsed
            : (individualMap.get(type as IndividualWarningTelegramType) ??
              cancelledMap.get(type as IndividualWarningTelegramType));
        contributingStreams.push({
          telegramType: type,
          reportDateTime: s.reportDateTime,
          controlDateTime: s.controlDateTime,
          contentHash: s.contentHash,
          receivedAt: s.receivedAt,
          infoType: telegramParsed?.infoType ?? null,
          eventId: telegramParsed?.eventId ?? null,
        });
      }
    }

    const sourceVersion = computeSourceVersion(contributingStreams);

    const baseReportDateTime =
      contributingStreams[0]?.reportDateTime ?? vpws50Stream.reportDateTime;
    const maxReportDateTime = contributingStreams.reduce(
      (max, s) => (s.reportDateTime > max ? s.reportDateTime : max),
      baseReportDateTime,
    );
    const baseReceivedAt = contributingStreams[0]?.receivedAt ?? vpws50Stream.receivedAt;
    const maxReceivedAt = contributingStreams.reduce(
      (max, s) => (s.receivedAt > max ? s.receivedAt : max),
      baseReceivedAt,
    );

    const candidates = contributingStreams.filter((s) => s.reportDateTime === maxReportDateTime);
    const streamOrder: readonly WarningTelegramType[] = [
      'VPWS50',
      ...INDIVIDUAL_WARNING_TELEGRAM_TYPES,
    ];
    candidates.sort(
      (a, b) => streamOrder.indexOf(a.telegramType) - streamOrder.indexOf(b.telegramType),
    );
    const primaryMeta = candidates.at(-1) ?? contributingStreams[0]!;

    const snapshotInput: WarningCurrentSnapshotInput = {
      areaCode: targetArea.municipalCode,
      areaName: targetArea.displayName,
      metadata: {
        source: 'jma_xml_warning_current',
        issuedAt: maxReportDateTime,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: maxReceivedAt,
        lastSuccessAt: maxReceivedAt,
        availability: 'available',
        sourceVersion,
      },
      telegram: {
        controlStatus: parsed.controlStatus,
        infoType: primaryMeta.infoType ?? '発表',
        eventId: primaryMeta.eventId ?? null,
        reportDateTime: maxReportDateTime,
        controlDateTime: primaryMeta.controlDateTime,
      },
      items: reduction.items,
    };

    const snapshot = saveWarningCurrentSnapshot(connection, snapshotInput);

    const normalizedInfoType =
      parsed.infoType === '訂正' || parsed.infoType === '取消' ? parsed.infoType : '発表';

    return {
      applied: true,
      origin,
      snapshot,
      changes,
      infoType: normalizedInfoType,
    };
  });

  return transaction();
}

export interface WarningCurrentRecoveryOptions {
  readonly yieldEveryParsedReceptions: number;
  readonly candidatePageSize?: number;
  readonly yieldControl?: () => Promise<void>;
  readonly onProgress?: (progress: WarningCurrentRecoveryProgress) => void;
}

export interface WarningCurrentRecoveryProgress {
  readonly venueId: VenueWarningContext['venueId'];
  readonly controlStatus: ControlStatus;
  readonly phase: 'validating' | 'searching' | 'committing';
  readonly parsedReceptionCount: number;
  readonly reused: boolean | null;
}

export interface WarningCurrentRecoveryStatusResult {
  readonly controlStatus: ControlStatus;
  readonly outcome: 'reused' | 'rebuilt' | 'uninitialized';
  readonly parsedReceptionCount: number;
  readonly selectedReceptionIds: readonly number[];
}

export interface WarningCurrentRecoveryResult {
  readonly venueId: VenueWarningContext['venueId'];
  readonly statuses: readonly WarningCurrentRecoveryStatusResult[];
  readonly parsedReceptionCount: number;
  readonly elapsedMs: number;
}

const RECOVERY_STATUSES: readonly ControlStatus[] = ['normal', 'training', 'test'];

function logicalSnapshot(snapshot: ReturnType<typeof findWarningCurrentSnapshot>): unknown {
  if (!snapshot) return null;
  return JSON.parse(JSON.stringify(snapshot, (key, value) => (key === 'id' ? undefined : value)));
}

function logicalStreams(streams: readonly WarningCurrentStream[]): unknown {
  return JSON.parse(JSON.stringify(streams, (key, value) => (key === 'id' ? undefined : value)));
}

/** 選択済みポインターだけから1 statusを原子的に作り直す。 */
function replaceRecoveryStatus(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea,
  status: ControlStatus,
  selected: ReadonlyMap<WarningTelegramType, WarningCurrentStreamInput>,
): void {
  deleteWarningCurrentStreams(
    connection,
    targetArea.prefectureCode,
    targetArea.municipalCode,
    status,
  );
  deleteWarningCurrentSnapshot(connection, targetArea.municipalCode, status);
  const ordered = ['VPWS50', ...INDIVIDUAL_WARNING_TELEGRAM_TYPES] as const;
  for (const type of ordered) {
    const stream = selected.get(type);
    if (!stream) continue;
    const reception = findTelegramReceptionById(connection, stream.receptionId);
    if (!reception?.rawBody) throw new Error(`復旧候補の原文がありません: ${stream.receptionId}`);
    const parsed = parseWarningTelegram(reception.rawBody, reception, targetArea);
    if (!parsed.ok) throw new Error(`復旧候補の解析に失敗しました: ${parsed.reason}`);
    const applied = applyWarningCurrentReception(connection, reception, parsed.value, targetArea);
    if (!applied.applied && applied.reason === 'same_version_conflict') {
      throw new WarningCurrentConflictError(applied.detail);
    }
  }
}

class RecoveryValidationRollback extends Error {
  constructor(readonly valid: boolean) {
    super('復旧検証用rollback');
  }
}

async function validateSavedRecoveryStatus(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea,
  status: ControlStatus,
  onParsed: () => Promise<void>,
): Promise<{
  readonly valid: boolean;
  readonly selected: Map<WarningTelegramType, WarningCurrentStreamInput>;
}> {
  const streams = listWarningCurrentStreams(
    connection,
    targetArea.prefectureCode,
    targetArea.municipalCode,
    status,
  );
  const selected = new Map<WarningTelegramType, WarningCurrentStreamInput>();
  for (const stream of streams) {
    if (selected.has(stream.telegramType)) return { valid: false, selected };
    const reception = findTelegramReceptionById(connection, stream.receptionId);
    if (
      !reception?.rawBody ||
      reception.contentHash !== stream.contentHash ||
      reception.reportDateTime !== stream.reportDateTime ||
      reception.controlDateTime !== stream.controlDateTime
    ) {
      return { valid: false, selected };
    }
    const parsed = parseWarningTelegram(reception.rawBody, reception, targetArea);
    await onParsed();
    if (
      !parsed.ok ||
      parsed.value.controlStatus !== status ||
      parsed.value.telegramType !== stream.telegramType ||
      parsed.value.reportDateTime !== stream.reportDateTime ||
      parsed.value.controlDateTime !== stream.controlDateTime
    ) {
      return { valid: false, selected };
    }
    selected.set(stream.telegramType, stream);
  }
  const before = JSON.stringify({
    streams: logicalStreams(streams),
    snapshot: logicalSnapshot(
      findWarningCurrentSnapshot(connection, targetArea.municipalCode, status),
    ),
  });
  try {
    connection.transaction(() => {
      replaceRecoveryStatus(connection, targetArea, status, selected);
      const after = JSON.stringify({
        streams: logicalStreams(
          listWarningCurrentStreams(
            connection,
            targetArea.prefectureCode,
            targetArea.municipalCode,
            status,
          ),
        ),
        snapshot: logicalSnapshot(
          findWarningCurrentSnapshot(connection, targetArea.municipalCode, status),
        ),
      });
      throw new RecoveryValidationRollback(before === after);
    })();
  } catch (error) {
    if (error instanceof RecoveryValidationRollback) return { valid: error.valid, selected };
    return { valid: false, selected };
  }
  return { valid: false, selected };
}

/** 保存済み状態を優先し、不整合statusだけを新しい候補から限定再構築する。 */
export async function recoverWarningCurrent(
  connection: DatabaseConnection,
  venue: VenueWarningContext,
  options: WarningCurrentRecoveryOptions,
): Promise<WarningCurrentRecoveryResult> {
  const started = Date.now();
  const yieldControl =
    options.yieldControl ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const pageSize = options.candidatePageSize ?? 100;
  let parsedReceptionCount = 0;
  let sinceYield = 0;
  const countParsed = () => {
    parsedReceptionCount += 1;
    sinceYield += 1;
  };
  const maybeYield = async () => {
    if (sinceYield >= options.yieldEveryParsedReceptions) {
      sinceYield = 0;
      await yieldControl();
    }
  };
  const results: WarningCurrentRecoveryStatusResult[] = [];
  for (const status of RECOVERY_STATUSES) {
    const statusParsedStart = parsedReceptionCount;
    options.onProgress?.({
      venueId: venue.venueId,
      controlStatus: status,
      phase: 'validating',
      parsedReceptionCount,
      reused: null,
    });
    const validation = await validateSavedRecoveryStatus(
      connection,
      venue.targetArea,
      status,
      async () => {
        countParsed();
        await maybeYield();
      },
    );
    if (validation.valid && validation.selected.size > 0) {
      results.push({
        controlStatus: status,
        outcome: validation.selected.has('VPWS50') ? 'reused' : 'uninitialized',
        parsedReceptionCount: parsedReceptionCount - statusParsedStart,
        selectedReceptionIds: [...validation.selected.values()].map((s) => s.receptionId),
      });
      options.onProgress?.({
        venueId: venue.venueId,
        controlStatus: status,
        phase: 'committing',
        parsedReceptionCount,
        reused: true,
      });
      await yieldControl();
      continue;
    }

    const selected = new Map<WarningTelegramType, WarningCurrentStreamInput>();
    options.onProgress?.({
      venueId: venue.venueId,
      controlStatus: status,
      phase: 'searching',
      parsedReceptionCount,
      reused: false,
    });
    for (const telegramType of ['VPWS50', ...INDIVIDUAL_WARNING_TELEGRAM_TYPES] as const) {
      let before: Parameters<typeof listWarningRecoveryCandidates>[1]['before'];
      let selectedVersion: {
        reportDateTime: string;
        controlDateTime: string;
        hash: string;
      } | null = null;
      let reachedOlderVersion = false;
      do {
        const page = listWarningRecoveryCandidates(connection, {
          controlStatus: status,
          telegramType,
          before,
          limit: pageSize,
        });
        for (const reception of page.receptions) {
          const parsed = parseWarningTelegram(reception.rawBody!, reception, venue.targetArea);
          countParsed();
          await maybeYield();
          if (
            !parsed.ok ||
            parsed.value.controlStatus !== status ||
            parsed.value.telegramType !== telegramType
          )
            continue;
          if (parsed.value.infoType !== '取消') {
            try {
              extractActiveKindsByPhenomenon(parsed.value);
            } catch {
              continue;
            }
          }
          const version = {
            reportDateTime: parsed.value.reportDateTime,
            controlDateTime: parsed.value.controlDateTime,
            hash: reception.contentHash ?? '',
          };
          if (!selectedVersion) {
            selectedVersion = version;
            selected.set(telegramType, {
              prefectureCode: venue.targetArea.prefectureCode,
              areaCode: venue.targetArea.municipalCode,
              controlStatus: status,
              telegramType,
              receptionId: reception.id,
              reportDateTime: version.reportDateTime,
              controlDateTime: version.controlDateTime,
              receivedAt: reception.receivedAt,
              contentHash: version.hash,
            });
          } else if (
            version.reportDateTime === selectedVersion.reportDateTime &&
            version.controlDateTime === selectedVersion.controlDateTime &&
            version.hash !== selectedVersion.hash
          ) {
            throw new WarningCurrentConflictError(
              `復旧中に同版競合を検出しました: ${telegramType}`,
            );
          } else if (
            version.reportDateTime !== selectedVersion.reportDateTime ||
            version.controlDateTime !== selectedVersion.controlDateTime
          ) {
            reachedOlderVersion = true;
            break;
          }
        }
        if (reachedOlderVersion || !page.nextCursor) break;
        before = page.nextCursor;
      } while (before);
    }
    options.onProgress?.({
      venueId: venue.venueId,
      controlStatus: status,
      phase: 'committing',
      parsedReceptionCount,
      reused: false,
    });
    connection.transaction(() =>
      replaceRecoveryStatus(connection, venue.targetArea, status, selected),
    )();
    results.push({
      controlStatus: status,
      outcome: selected.has('VPWS50') ? 'rebuilt' : 'uninitialized',
      parsedReceptionCount: parsedReceptionCount - statusParsedStart,
      selectedReceptionIds: [...selected.values()].map((s) => s.receptionId),
    });
    await yieldControl();
  }
  return {
    venueId: venue.venueId,
    statuses: results,
    parsedReceptionCount,
    elapsedMs: Date.now() - started,
  };
}
