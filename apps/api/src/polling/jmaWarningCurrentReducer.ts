import crypto from 'node:crypto';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  INDIVIDUAL_WARNING_TELEGRAM_TYPES,
  type IndividualWarningTelegramType,
  type ParsedIssuedWarningKind,
  type ParsedWarningKind,
  type ParsedWarningTelegram,
  type WarningCurrentChange,
  type WarningCurrentChangeType,
  type WarningCurrentItemInput,
  type WarningCurrentReductionResult,
  type WarningPhenomenonKey,
  type WarningTelegramType,
} from '../repositories/types.js';

export interface PhenomenonDefinition {
  readonly phenomenonKey: WarningPhenomenonKey;
  readonly telegramType: IndividualWarningTelegramType;
  readonly level: 1 | 2 | 3 | 4; // 注意報=1, 警報=2, 危険警報=3, 特別警報=4
}

// 設計書 §3.3 および §3.6 に基づく明示コード表（Issue #26 により段階逆転を是正）
export const WARNING_CODE_TABLE: Readonly<Record<string, PhenomenonDefinition>> = {
  // VPWW55: heavy_rain
  '10': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 1 }, // 大雨注意報
  '03': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 2 }, // 大雨警報
  '43': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 3 }, // 大雨危険警報
  '33': { phenomenonKey: 'heavy_rain', telegramType: 'VPWW55', level: 4 }, // 大雨特別警報

  // VPWW56: landslide
  '29': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 1 }, // 土砂災害注意報
  '09': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 2 }, // 土砂災害警報
  '49': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 3 }, // 土砂災害危険警報
  '39': { phenomenonKey: 'landslide', telegramType: 'VPWW56', level: 4 }, // 土砂災害特別警報

  // VPWW57: storm_surge
  '19': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 1 }, // 高潮注意報
  '08': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 2 }, // 高潮警報
  '48': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 3 }, // 高潮危険警報
  '38': { phenomenonKey: 'storm_surge', telegramType: 'VPWW57', level: 4 }, // 高潮特別警報

  // VPWW58: snowstorm / storm
  '13': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 1 }, // 風雪注意報
  '02': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 2 }, // 暴風雪警報
  '32': { phenomenonKey: 'snowstorm', telegramType: 'VPWW58', level: 4 }, // 暴風雪特別警報
  '15': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 1 }, // 強風注意報
  '05': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 2 }, // 暴風警報
  '35': { phenomenonKey: 'storm', telegramType: 'VPWW58', level: 4 }, // 暴風特別警報

  // VPWW59: waves
  '16': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 1 }, // 波浪注意報
  '07': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 2 }, // 波浪警報
  '37': { phenomenonKey: 'waves', telegramType: 'VPWW59', level: 4 }, // 波浪特別警報

  // VPWW60: heavy_snow
  '12': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 1 }, // 大雪注意報
  '06': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 2 }, // 大雪警報
  '36': { phenomenonKey: 'heavy_snow', telegramType: 'VPWW60', level: 4 }, // 大雪特別警報

  // VPWW61: 独立現象
  '14': { phenomenonKey: 'thunder', telegramType: 'VPWW61', level: 1 }, // 雷注意報
  '17': { phenomenonKey: 'snowmelt', telegramType: 'VPWW61', level: 1 }, // 融雪注意報
  '20': { phenomenonKey: 'fog', telegramType: 'VPWW61', level: 1 }, // 濃霧注意報
  '21': { phenomenonKey: 'dry_air', telegramType: 'VPWW61', level: 1 }, // 乾燥注意報
  '22': { phenomenonKey: 'avalanche', telegramType: 'VPWW61', level: 1 }, // なだれ注意報
  '23': { phenomenonKey: 'low_temperature', telegramType: 'VPWW61', level: 1 }, // 低温注意報
  '24': { phenomenonKey: 'frost', telegramType: 'VPWW61', level: 1 }, // 霜注意報
  '25': { phenomenonKey: 'icing', telegramType: 'VPWW61', level: 1 }, // 着氷注意報
  '26': { phenomenonKey: 'snow_accumulation', telegramType: 'VPWW61', level: 1 }, // 着雪注意報
  '27': { phenomenonKey: 'other_advisory', telegramType: 'VPWW61', level: 1 }, // その他注意報
};

export const SUPPORTED_ACTIVE_STATUSES = new Set([
  '発表',
  '継続',
  '特別警報から危険警報',
  '特別警報から警報',
  '特別警報から注意報',
  '危険警報から警報',
  '危険警報から注意報',
  '警報から注意報',
]);

export class WarningCurrentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarningCurrentConflictError';
  }
}

export class WarningCurrentUnsupportedError extends Error {
  constructor(
    public readonly reasonKind: 'unsupported_code' | 'unsupported_status',
    message: string,
  ) {
    super(message);
    this.name = 'WarningCurrentUnsupportedError';
  }
}

/**
 * 1 つの ParsedWarningTelegram を現象別の発表中 Kind マップへ変換する。
 * 未対応コードや未対応 Status、整合エラーがある場合は例外を投げる。
 */
export function extractActiveKindsByPhenomenon(
  telegram: ParsedWarningTelegram,
): Map<
  WarningPhenomenonKey,
  { readonly kind: ParsedIssuedWarningKind; readonly sourceTelegramType: WarningTelegramType }
> {
  const result = new Map<
    WarningPhenomenonKey,
    { readonly kind: ParsedIssuedWarningKind; readonly sourceTelegramType: WarningTelegramType }
  >();

  // no_warning の場合は空のマップを返す
  if (telegram.kinds.some((k) => k.kindType === 'no_warning')) {
    return result;
  }

  const isAggregate = telegram.telegramType === 'VPWS50';

  for (const rawKind of telegram.kinds) {
    if (rawKind.kindType !== 'warning') continue;

    // 市町村単位の Code === '00' の判定
    if (rawKind.code === '00') {
      if (isAggregate) {
        throw new WarningCurrentUnsupportedError(
          'unsupported_code',
          'VPWS50 で Code=00 はサポートされていません',
        );
      }
      // 個別電文での Code=00 はストリーム全解除なので全クリア
      result.clear();
      return result;
    }

    const def = WARNING_CODE_TABLE[rawKind.code];
    if (!def) {
      throw new WarningCurrentUnsupportedError(
        'unsupported_code',
        `未対応の警報等コードです: ${rawKind.code}`,
      );
    }

    // 個別電文の場合、担当ストリームとコードの所属が一致しているか検証
    if (!isAggregate && def.telegramType !== telegram.telegramType) {
      throw new WarningCurrentUnsupportedError(
        'unsupported_code',
        `電文種別 ${telegram.telegramType} とコード ${rawKind.code} の所属ストリーム ${def.telegramType} が一致しません`,
      );
    }

    if (rawKind.status === '解除') {
      // 解除対象コードの現象キーと lastKind.code の現象キーが整合するか検証
      if (rawKind.lastKind?.code) {
        const lastDef = WARNING_CODE_TABLE[rawKind.lastKind.code];
        if (!lastDef || lastDef.phenomenonKey !== def.phenomenonKey) {
          throw new WarningCurrentConflictError(
            `解除コード ${rawKind.code} と lastKind.code ${rawKind.lastKind.code} の現象キーが一致しません`,
          );
        }
      }
      // 発表中マップからは除外（すでにマップに入っていれば削除）
      result.delete(def.phenomenonKey);
      continue;
    }

    if (!SUPPORTED_ACTIVE_STATUSES.has(rawKind.status)) {
      throw new WarningCurrentUnsupportedError(
        'unsupported_status',
        `未対応の Status です: ${rawKind.status}`,
      );
    }

    // 発表中の場合、同一現象キーに複数 Kind が存在しないか検証
    if (result.has(def.phenomenonKey)) {
      throw new WarningCurrentConflictError(
        `同一現象キー ${def.phenomenonKey} に複数の発表中 Kind が存在します: ${rawKind.code}`,
      );
    }

    result.set(def.phenomenonKey, {
      kind: rawKind,
      sourceTelegramType: telegram.telegramType,
    });
  }

  return result;
}

/**
 * VPWS50 から各個別ストリーム（VPWW55〜VPWW61）の基準時刻を計算する。
 */
export function calculateAggregateBaselines(
  aggregate: ParsedWarningTelegram,
): Map<IndividualWarningTelegramType, UtcIso8601String> {
  const baselines = new Map<IndividualWarningTelegramType, UtcIso8601String>();
  const reportTime = aggregate.reportDateTime;

  const noWarning = aggregate.kinds.find(
    (k): k is ParsedWarningKind & { readonly kindType: 'no_warning' } =>
      k.kindType === 'no_warning',
  );
  if (noWarning) {
    const baseline = noWarning.dateTime ?? reportTime;
    for (const type of INDIVIDUAL_WARNING_TELEGRAM_TYPES) {
      baselines.set(type, baseline);
    }
    return baselines;
  }

  // Warning Kind からストリームごとの最大要素時刻を抽出
  for (const rawKind of aggregate.kinds) {
    if (rawKind.kindType !== 'warning') continue;
    if (rawKind.code === '00') continue;
    const def = WARNING_CODE_TABLE[rawKind.code];
    if (!def) continue;

    const kindTime = rawKind.dateTime ?? reportTime;
    const current = baselines.get(def.telegramType);
    if (!current || kindTime > current) {
      baselines.set(def.telegramType, kindTime);
    }
  }

  // Kind が存在しなかったストリームは VPWS50.reportDateTime を基準時刻とする
  for (const type of INDIVIDUAL_WARNING_TELEGRAM_TYPES) {
    if (!baselines.has(type)) {
      baselines.set(type, reportTime);
    }
  }

  return baselines;
}

/**
 * 純粋関数: VPWS50 を基準に、最新の現象別電文群を合成する。
 */
export function reduceWarningCurrent(
  aggregate: ParsedWarningTelegram,
  individuals: ReadonlyMap<IndividualWarningTelegramType, ParsedWarningTelegram>,
  /** InfoType=取消 のポインターを持つ個別ストリーム。既定は空。`individuals` とは排他。 */
  cancelledStreams?: ReadonlyMap<IndividualWarningTelegramType, ParsedWarningTelegram>,
): WarningCurrentReductionResult {
  if (aggregate.telegramType !== 'VPWS50') {
    throw new Error(`aggregate は VPWS50 である必要があります: ${aggregate.telegramType}`);
  }

  const aggregateBaselines = calculateAggregateBaselines(aggregate);
  const aggregateActiveMap = extractActiveKindsByPhenomenon(aggregate);

  // 最終的な現象別発表中 Kind マップ
  const finalActiveMap = new Map<
    WarningPhenomenonKey,
    { readonly kind: ParsedIssuedWarningKind; readonly sourceTelegramType: WarningTelegramType }
  >();

  const contributingTypes = new Set<WarningTelegramType>();

  // ストリームごとに集約か個別かを判定
  for (const streamType of INDIVIDUAL_WARNING_TELEGRAM_TYPES) {
    const cancel = cancelledStreams?.get(streamType);
    if (cancel && cancel.reportDateTime >= aggregateBaselines.get(streamType)!) {
      contributingTypes.add(streamType); // 取消電文は現況の根拠として記録する
      continue; // 集約側フォールバックへ落とさない = 当該ストリームの現象キーは一切採用しない
    }

    const individual = individuals.get(streamType);
    const baseline = aggregateBaselines.get(streamType)!;

    if (individual && individual.reportDateTime > baseline) {
      // 個別ストリームのほうが新しい -> 個別の完全状態で置き換える
      contributingTypes.add(streamType);
      const indActiveMap = extractActiveKindsByPhenomenon(individual);
      for (const [key, val] of indActiveMap) {
        finalActiveMap.set(key, val);
      }
    } else if (individual && individual.reportDateTime === baseline) {
      // 同時刻の場合: 内容が一致することを期待する
      const indActiveMap = extractActiveKindsByPhenomenon(individual);
      // 集約側の当該ストリームの現象キー群を抽出
      const aggKeysForStream = new Set<WarningPhenomenonKey>();
      for (const def of Object.values(WARNING_CODE_TABLE)) {
        if (def.telegramType === streamType && aggregateActiveMap.has(def.phenomenonKey)) {
          aggKeysForStream.add(def.phenomenonKey);
        }
      }
      // 個別側と集約側のキー集合・コードが一致するか確認
      let matches = aggKeysForStream.size === indActiveMap.size;
      if (matches) {
        for (const key of aggKeysForStream) {
          const aggKind = aggregateActiveMap.get(key)!.kind;
          const indKind = indActiveMap.get(key)?.kind;
          if (!indKind || indKind.code !== aggKind.code) {
            matches = false;
            break;
          }
        }
      }
      if (!matches) {
        throw new WarningCurrentConflictError(
          `同一時刻 (${baseline}) において集約 (${aggregate.telegramType}) と個別 (${streamType}) の内容が競合しています`,
        );
      }
      if (aggKeysForStream.size > 0) {
        contributingTypes.add(aggregate.telegramType);
      }
      for (const key of aggKeysForStream) {
        finalActiveMap.set(key, aggregateActiveMap.get(key)!);
      }
    } else {
      // 集約側の状態を採用
      let addedFromAggregate = false;
      for (const def of Object.values(WARNING_CODE_TABLE)) {
        if (def.telegramType === streamType && aggregateActiveMap.has(def.phenomenonKey)) {
          finalActiveMap.set(def.phenomenonKey, aggregateActiveMap.get(def.phenomenonKey)!);
          addedFromAggregate = true;
        }
      }
      if (addedFromAggregate) {
        contributingTypes.add(aggregate.telegramType);
      }
    }
  }

  // どの個別ストリームからも貢献がなく、集約からも採用現象がない場合（集約による正常な発表なし）
  if (contributingTypes.size === 0) {
    contributingTypes.add(aggregate.telegramType);
  }

  // 最終明細 items を sequence 順に整形
  // ソート基準: telegramType 順（VPWW55〜VPWW61）、同一ストリーム内は sequence または code 順
  const streamOrder = new Map<string, number>(
    INDIVIDUAL_WARNING_TELEGRAM_TYPES.map((t, idx) => [t, idx]),
  );

  const entries = Array.from(finalActiveMap.values()).sort((a, b) => {
    const defA = WARNING_CODE_TABLE[a.kind.code]!;
    const defB = WARNING_CODE_TABLE[b.kind.code]!;
    const streamDiff =
      (streamOrder.get(defA.telegramType) ?? 0) - (streamOrder.get(defB.telegramType) ?? 0);
    if (streamDiff !== 0) return streamDiff;
    return a.kind.sequence - b.kind.sequence;
  });

  const items: WarningCurrentItemInput[] = entries.map((entry, index) => ({
    sequence: index + 1,
    kindCode: entry.kind.code,
    kindName: entry.kind.name,
    kindStatus: entry.kind.status,
    lastKindCode: entry.kind.lastKind?.code ?? null,
    lastKindName: entry.kind.lastKind?.name ?? null,
    significancyCode: null,
    significancyName: null,
    warningLevel: null,
    attentionText: null,
    kindIssuedAt:
      entry.kind.dateTime ??
      (entry.sourceTelegramType === aggregate.telegramType
        ? aggregate.reportDateTime
        : (individuals.get(entry.sourceTelegramType as IndividualWarningTelegramType)
            ?.reportDateTime ?? aggregate.reportDateTime)),
    sourceTelegram: entry.sourceTelegramType,
  }));

  return {
    items,
    contributingTelegramTypes: Array.from(contributingTypes),
  };
}

/**
 * 前後の発表中 Kind 集合から現象キー単位で差分を計算する。
 */
export function diffWarningCurrent(
  before: readonly WarningCurrentItemInput[],
  after: readonly WarningCurrentItemInput[],
): readonly WarningCurrentChange[] {
  const beforeMap = new Map<WarningPhenomenonKey, WarningCurrentItemInput>();
  for (const item of before) {
    const def = WARNING_CODE_TABLE[item.kindCode];
    if (def) beforeMap.set(def.phenomenonKey, item);
  }

  const afterMap = new Map<WarningPhenomenonKey, WarningCurrentItemInput>();
  for (const item of after) {
    const def = WARNING_CODE_TABLE[item.kindCode];
    if (def) afterMap.set(def.phenomenonKey, item);
  }

  const allKeys = new Set<WarningPhenomenonKey>([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: WarningCurrentChange[] = [];

  for (const key of allKeys) {
    const b = beforeMap.get(key) ?? null;
    const a = afterMap.get(key) ?? null;

    if (!b && a) {
      changes.push({
        phenomenonKey: key,
        changeType: 'new',
        before: null,
        after: a,
      });
    } else if (b && !a) {
      changes.push({
        phenomenonKey: key,
        changeType: 'released',
        before: b,
        after: null,
      });
    } else if (b && a) {
      if (b.kindCode === a.kindCode) {
        changes.push({
          phenomenonKey: key,
          changeType: 'continued',
          before: b,
          after: a,
        });
      } else {
        const bDef = WARNING_CODE_TABLE[b.kindCode]!;
        const aDef = WARNING_CODE_TABLE[a.kindCode]!;

        // lastKind が指定されている場合、直前のコードと一致するか整合確認
        if (a.lastKindCode !== null && a.lastKindCode !== b.kindCode) {
          throw new WarningCurrentConflictError(
            `更新後の lastKindCode (${a.lastKindCode}) が前状態のコード (${b.kindCode}) と矛盾しています`,
          );
        }

        let changeType: WarningCurrentChangeType;
        if (aDef.level > bDef.level) {
          changeType = 'strengthened';
        } else if (aDef.level < bDef.level) {
          changeType = 'weakened';
        } else {
          // 前後コードが異なるのに同じ段階である場合は conflict
          throw new WarningCurrentConflictError(
            `前後コードが異なるのに同一段階 (${aDef.level}) です: ${b.kindCode} -> ${a.kindCode}`,
          );
        }

        changes.push({
          phenomenonKey: key,
          changeType,
          before: b,
          after: a,
        });
      }
    }
  }

  return changes;
}

/**
 * 寄与したストリーム情報から sourceVersion (SHA-256) を計算する。
 */
export function computeSourceVersion(
  contributingStreams: readonly {
    readonly telegramType: WarningTelegramType;
    readonly reportDateTime: UtcIso8601String;
    readonly controlDateTime: UtcIso8601String;
    readonly contentHash: string;
  }[],
): string {
  const sorted = [...contributingStreams].sort((a, b) =>
    a.telegramType.localeCompare(b.telegramType),
  );

  const joined = sorted
    .map((s) => `${s.telegramType}:${s.reportDateTime}:${s.controlDateTime}:${s.contentHash}`)
    .join('\n');

  return crypto.createHash('sha256').update(joined, 'utf-8').digest('hex');
}
