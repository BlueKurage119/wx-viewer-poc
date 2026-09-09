import type { DatabaseConnection } from '../database/index.js';
import {
  findTelegramReceptionById,
  findWarningCurrentSnapshot,
  findWarningCurrentStream,
  listWarningCurrentStreams,
  listWarningTelegramReceptionsForRebuild,
  saveWarningCurrentSnapshot,
  upsertWarningCurrentStream,
  deleteWarningCurrentStreams,
  deleteWarningCurrentSnapshot,
} from '../repositories/index.js';
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

export const DEFAULT_WARNING_CURRENT_TARGET_AREA: WarningCurrentTargetArea = {
  municipalCode: '1310800',
  displayName: '江東区',
  prefectureCode: '130000',
};

/**
 * 新規受信した電文を C3 現況へ適用する。
 * 1 つのトランザクション内でストリームポインター更新とスナップショット保存を行う。
 */
export function applyWarningCurrentReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  parsed: ParsedWarningTelegram,
  targetArea: WarningCurrentTargetArea = DEFAULT_WARNING_CURRENT_TARGET_AREA,
): WarningCurrentApplyResult {
  // 1. InfoType の検証（§3.7）
  if (parsed.infoType === '取消') {
    return {
      applied: false,
      reason: 'cancelled',
      detail: 'InfoType=取消 の電文はストリームへ採用しません',
    };
  }
  if (parsed.infoType !== null && parsed.infoType !== '発表' && parsed.infoType !== '訂正') {
    return {
      applied: false,
      reason: 'cancelled',
      detail: `未知の InfoType です: ${parsed.infoType}`,
    };
  }

  // 2. 電文バリデーション（コード・Status・整合性）
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

    // 3.3 ストリームポインターの保存
    const currentStream = upsertWarningCurrentStream(connection, {
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

    // 3.4 VPWS50 ポインターの確認
    const vpws50Stream =
      parsed.telegramType === 'VPWS50'
        ? currentStream
        : findWarningCurrentStream(
            connection,
            targetArea.prefectureCode,
            targetArea.municipalCode,
            parsed.controlStatus,
            'VPWS50',
          );

    if (!vpws50Stream) {
      // VPWS50 がまだない -> snapshot は作成せず uninitialized
      return {
        applied: false,
        reason: 'uninitialized',
        detail: '有効な VPWS50 による初期化が完了していません',
      };
    }

    // 3.5 全ストリームポインターから電文を読み出してパース
    const allStreams = listWarningCurrentStreams(
      connection,
      targetArea.prefectureCode,
      targetArea.municipalCode,
      parsed.controlStatus,
    );

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
    const vpws50Parsed = vpws50ParseResult.value;

    const individualMap = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();
    const streamMap = new Map<WarningTelegramType, WarningCurrentStream>();

    for (const s of allStreams) {
      streamMap.set(s.telegramType, s);
      if (s.telegramType !== 'VPWS50') {
        const indReception = findTelegramReceptionById(connection, s.receptionId);
        if (indReception?.rawBody) {
          const indParseResult = parseWarningTelegram(
            indReception.rawBody,
            indReception,
            targetArea,
          );
          if (indParseResult.ok) {
            individualMap.set(
              s.telegramType as IndividualWarningTelegramType,
              indParseResult.value,
            );
          }
        }
      }
    }

    // 3.6 現況の合成
    let reduction: WarningCurrentReductionResult;
    try {
      reduction = reduceWarningCurrent(vpws50Parsed, individualMap);
    } catch (err) {
      if (err instanceof WarningCurrentConflictError) {
        return { applied: false, reason: 'same_version_conflict', detail: err.message };
      }
      if (err instanceof WarningCurrentUnsupportedError) {
        return { applied: false, reason: err.reasonKind, detail: err.message };
      }
      throw err;
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

    // 3.8 メタ情報の構成
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
            : individualMap.get(type as IndividualWarningTelegramType);
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

    const maxReportDateTime = contributingStreams.reduce(
      (max, s) => (s.reportDateTime > max ? s.reportDateTime : max),
      vpws50Stream.reportDateTime,
    );
    const maxReceivedAt = contributingStreams.reduce(
      (max, s) => (s.receivedAt > max ? s.receivedAt : max),
      vpws50Stream.receivedAt,
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

    return {
      applied: true,
      origin,
      snapshot,
      changes,
    };
  });

  return transaction();
}

/**
 * 保存済み受信履歴から現況スナップショットおよびストリームポインターを再構成する（起動時復旧）。
 * HTTP GET や履歴追記は一切行わず、冪等に動作する。
 */
export function rebuildWarningCurrentFromReceptions(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea = DEFAULT_WARNING_CURRENT_TARGET_AREA,
): WarningCurrentApplyResult {
  // controlStatus ('normal', 'training', 'test') ごとに復旧候補を収集
  const candidatesByStatus = new Map<
    ControlStatus,
    Map<WarningTelegramType, WarningCurrentStreamInput>
  >();

  let after:
    | { readonly reportDateTime: string; readonly controlDateTime: string; readonly id: number }
    | undefined;

  // 100件 keyset pagination で読み込み
  do {
    const page = listWarningTelegramReceptionsForRebuild(connection, { after, limit: 100 });
    for (const reception of page.receptions) {
      if (!reception.rawBody) continue;

      const parseResult = parseWarningTelegram(reception.rawBody, reception, targetArea);
      if (!parseResult.ok) continue;

      const parsed = parseResult.value;
      if (parsed.infoType === '取消') continue;
      if (parsed.infoType !== null && parsed.infoType !== '発表' && parsed.infoType !== '訂正')
        continue;

      try {
        extractActiveKindsByPhenomenon(parsed);
      } catch {
        continue;
      }

      let statusMap = candidatesByStatus.get(parsed.controlStatus);
      if (!statusMap) {
        statusMap = new Map();
        candidatesByStatus.set(parsed.controlStatus, statusMap);
      }

      const existing = statusMap.get(parsed.telegramType);
      if (existing) {
        if (parsed.reportDateTime < existing.reportDateTime) {
          continue;
        }
        if (parsed.reportDateTime === existing.reportDateTime) {
          if (parsed.controlDateTime < existing.controlDateTime) {
            continue;
          }
          if (parsed.controlDateTime === existing.controlDateTime) {
            if (reception.contentHash === existing.contentHash) {
              continue;
            } else {
              throw new WarningCurrentConflictError(
                `復旧中に同時刻かつ異なる contentHash の同版競合を検出しました: telegramType=${parsed.telegramType}`,
              );
            }
          }
        }
      }

      statusMap.set(parsed.telegramType, {
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
    }

    after = page.nextCursor ?? undefined;
  } while (after);

  // トランザクション内で各 controlStatus のポインターとスナップショットを再構成
  const transaction = connection.transaction((): WarningCurrentApplyResult => {
    // 既定の normal の結果を返す
    let normalResult: WarningCurrentApplyResult = {
      applied: false,
      reason: 'uninitialized',
      detail: '有効な VPWS50 による初期化が完了していません',
    };

    const allStatuses: readonly ControlStatus[] = ['normal', 'training', 'test'];

    for (const status of allStatuses) {
      deleteWarningCurrentStreams(
        connection,
        targetArea.prefectureCode,
        targetArea.municipalCode,
        status,
      );

      const statusMap = candidatesByStatus.get(status);
      const vpws50StreamInput = statusMap?.get('VPWS50');

      if (!statusMap || !vpws50StreamInput) {
        // VPWS50 がない場合、スナップショットは作らず既存があれば削除
        deleteWarningCurrentSnapshot(connection, targetArea.municipalCode, status);
        if (status === 'normal') {
          normalResult = {
            applied: false,
            reason: 'uninitialized',
            detail: '有効な VPWS50 による初期化が完了していません',
          };
        }
        // 他の個別ストリームポインターがあれば保存しておく（初期化前ポインター保持）
        if (statusMap) {
          for (const streamInput of statusMap.values()) {
            upsertWarningCurrentStream(connection, streamInput);
          }
        }
        continue;
      }

      // ストリームポインターを一括保存
      const streamEntities = new Map<WarningTelegramType, WarningCurrentStream>();
      for (const streamInput of statusMap.values()) {
        const saved = upsertWarningCurrentStream(connection, streamInput);
        streamEntities.set(saved.telegramType, saved);
      }

      // VPWS50 を再パース
      const vpws50Reception = findTelegramReceptionById(connection, vpws50StreamInput.receptionId);
      if (!vpws50Reception || !vpws50Reception.rawBody) {
        throw new Error(
          `復旧用 VPWS50 電文の取得に失敗しました: receptionId=${vpws50StreamInput.receptionId}`,
        );
      }
      const vpws50ParseResult = parseWarningTelegram(
        vpws50Reception.rawBody,
        vpws50Reception,
        targetArea,
      );
      if (!vpws50ParseResult.ok) {
        throw new Error(`復旧用 VPWS50 電文の再解析に失敗しました: ${vpws50ParseResult.reason}`);
      }
      const vpws50Parsed = vpws50ParseResult.value;

      // 個別ストリームを再パース
      const individualMap = new Map<IndividualWarningTelegramType, ParsedWarningTelegram>();
      for (const [type, s] of statusMap) {
        if (type !== 'VPWS50') {
          const indReception = findTelegramReceptionById(connection, s.receptionId);
          if (indReception?.rawBody) {
            const indParse = parseWarningTelegram(indReception.rawBody, indReception, targetArea);
            if (indParse.ok) {
              individualMap.set(type as IndividualWarningTelegramType, indParse.value);
            }
          }
        }
      }

      // 現況合成
      const reduction = reduceWarningCurrent(vpws50Parsed, individualMap);

      // メタ情報構成
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
        const s = statusMap.get(type);
        if (s) {
          const telegramParsed =
            type === 'VPWS50'
              ? vpws50Parsed
              : individualMap.get(type as IndividualWarningTelegramType);
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

      const maxReportDateTime = contributingStreams.reduce(
        (max, s) => (s.reportDateTime > max ? s.reportDateTime : max),
        vpws50StreamInput.reportDateTime,
      );
      const maxReceivedAt = contributingStreams.reduce(
        (max, s) => (s.receivedAt > max ? s.receivedAt : max),
        vpws50StreamInput.receivedAt,
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

      const existingSnapshot = findWarningCurrentSnapshot(
        connection,
        targetArea.municipalCode,
        status,
      );
      const beforeItems = existingSnapshot ? existingSnapshot.items : [];
      const changes = diffWarningCurrent(beforeItems, reduction.items);

      const snapshot = saveWarningCurrentSnapshot(connection, {
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
          controlStatus: status,
          infoType: primaryMeta.infoType ?? '発表',
          eventId: primaryMeta.eventId ?? null,
          reportDateTime: maxReportDateTime,
          controlDateTime: primaryMeta.controlDateTime,
        },
        items: reduction.items,
      });

      if (status === 'normal') {
        normalResult = {
          applied: true,
          origin: existingSnapshot ? 'normal' : 'initial',
          snapshot,
          changes,
        };
      }
    }

    return normalResult;
  });

  return transaction();
}
