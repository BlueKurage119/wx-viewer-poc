/** 訓練電文生成（Issue #69 J1）の公開契約。項目表の正本は設計書 issue-69 の「生成項目表」。 */

export type TrainingItemId = `warning-${string}` | `bulletin-${string}`;

export type TrainingTelegramType =
  | 'VPWW55'
  | 'VPWW56'
  | 'VPWW57'
  | 'VPWW58'
  | 'VPWW59'
  | 'VPWW60'
  | 'VPWW61'
  | 'VPBS50'
  | 'VPHW50'
  | 'VPHW51';

export interface TrainingItem {
  readonly id: TrainingItemId;
  readonly label: string;
  readonly group: string;
  readonly selectable: boolean;
  readonly unavailableReason: string | null;
}

export interface TrainingGenerateRequest {
  readonly terminalId: string;
  readonly itemIds: readonly TrainingItemId[];
}

export interface TrainingTelegramPreview {
  readonly id: string;
  readonly itemIds: readonly TrainingItemId[];
  readonly telegramType: TrainingTelegramType;
  readonly title: string;
  readonly xml: string;
  readonly reportDateTime: string;
  readonly targetDateTime: string;
  readonly validDateTime: string | null;
  readonly areaNames: readonly string[];
  readonly provenance: 'synthetic';
  readonly isTraining: true;
}

export interface TrainingGenerateResponse {
  readonly generationId: string;
  readonly generatedAt: string;
  readonly telegrams: readonly TrainingTelegramPreview[];
}

export interface TrainingItemsResponse {
  readonly items: readonly TrainingItem[];
  readonly targetLabel: string;
}

export const TRAINING_TARGET_LABEL = '東京ビッグサイト周辺';
export const TRAINING_MAX_ITEMS = 16;
export const TRAINING_MAX_ITEM_ID_LENGTH = 64;
/** trainingルートの本文上限（UTF-8でJSON.stringifyした長さ）。 */
export const TRAINING_MAX_BODY_BYTES = 16 * 1024;

function item(id: TrainingItemId, label: string, group: string): TrainingItem {
  return { id, label, group, selectable: true, unavailableReason: null };
}

/**
 * 項目表（表示順）。2026年10月12日のUI監修で、江東区に基準のない項目（土砂災害L3以上・融雪・なだれ）は
 * 項目ごと削除した。全項目が選択可能で、selectable/unavailableReason は型として残すが値は常に true/null。
 */
export const TRAINING_ITEMS: readonly TrainingItem[] = Object.freeze([
  item('warning-10', 'レベル２大雨注意報', 'rain'),
  item('warning-03', 'レベル３大雨警報', 'rain'),
  item('warning-43', 'レベル４大雨危険警報', 'rain'),
  item('warning-33', 'レベル５大雨特別警報', 'rain'),
  item('warning-29', 'レベル２土砂災害注意報', 'landslide'),
  item('warning-19', 'レベル２高潮注意報', 'surge'),
  item('warning-08', 'レベル３高潮警報', 'surge'),
  item('warning-48', 'レベル４高潮危険警報', 'surge'),
  item('warning-38', 'レベル５高潮特別警報', 'surge'),
  item('warning-15', '強風注意報', 'wind'),
  item('warning-05', '暴風警報', 'wind'),
  item('warning-35', '暴風特別警報', 'wind'),
  item('warning-13', '風雪注意報', 'wind'),
  item('warning-02', '暴風雪警報', 'wind'),
  item('warning-32', '暴風雪特別警報', 'wind'),
  item('warning-16', '波浪注意報', 'wave'),
  item('warning-07', '波浪警報', 'wave'),
  item('warning-37', '波浪特別警報', 'wave'),
  item('warning-12', '大雪注意報', 'snow'),
  item('warning-06', '大雪警報', 'snow'),
  item('warning-36', '大雪特別警報', 'snow'),
  item('warning-14', '雷注意報', 'thunder'),
  item('warning-20', '濃霧注意報', 'fog'),
  item('warning-21', '乾燥注意報', 'dry'),
  item('warning-23', '低温注意報', 'cold'),
  item('warning-24', '霜注意報', 'frost'),
  item('warning-25', '着氷注意報', 'icing'),
  item('warning-26', '着雪注意報', 'snow-accretion'),
  item('bulletin-linear-occurrence', '線状降水帯発生', 'linear'),
  item('bulletin-linear-imminent', '線状降水帯直前予測', 'linear'),
  item('bulletin-record-rain', '記録的短時間大雨', 'record-rain'),
  item('bulletin-tornado', '竜巻注意', 'tornado'),
  item('bulletin-tornado-observed', '竜巻目撃', 'tornado'),
]);

/** 画面のfieldset見出し。 */
export const TRAINING_GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  rain: '大雨',
  landslide: '土砂災害',
  surge: '高潮',
  wind: '風',
  wave: '波浪',
  snow: '大雪',
  thunder: '雷',
  fog: '濃霧',
  dry: '乾燥',
  cold: '低温',
  frost: '霜',
  icing: '着氷',
  'snow-accretion': '着雪',
  linear: '線状降水帯',
  'record-rain': '記録的短時間大雨',
  tornado: '竜巻',
});

const trainingItemById: ReadonlyMap<string, TrainingItem> = new Map(
  TRAINING_ITEMS.map((value) => [value.id, value]),
);

export function findTrainingItem(id: string): TrainingItem | null {
  return trainingItemById.get(id) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 項目選択の厳密検証。既知・選択可能・重複なし・group内1個を要求し、
 * 満たさなければ null（部分採用しない）。
 */
export function parseTrainingItemIds(value: unknown): readonly TrainingItemId[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > TRAINING_MAX_ITEMS) return null;
  const seenIds = new Set<string>();
  const seenGroups = new Set<string>();
  const result: TrainingItemId[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return null;
    if (entry.length > TRAINING_MAX_ITEM_ID_LENGTH) return null;
    const definition = findTrainingItem(entry);
    if (definition === null || !definition.selectable) return null;
    if (seenIds.has(entry) || seenGroups.has(definition.group)) return null;
    seenIds.add(entry);
    seenGroups.add(definition.group);
    result.push(definition.id);
  }
  return result;
}

export function parseTrainingGenerateRequest(value: unknown): TrainingGenerateRequest | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('terminalId') || !keys.includes('itemIds')) return null;
  if (typeof value.terminalId !== 'string' || value.terminalId.length === 0) return null;
  const itemIds = parseTrainingItemIds(value.itemIds);
  if (itemIds === null) return null;
  return { terminalId: value.terminalId, itemIds };
}

/** GET /api/training/items のquery。terminalIdだけを許可し、配列・重複・未知キーを拒否する。 */
export function parseTrainingItemsQuery(query: unknown): { readonly terminalId: string } | null {
  if (!isPlainObject(query)) return null;
  const keys = Object.keys(query);
  if (keys.length !== 1 || keys[0] !== 'terminalId') return null;
  const terminalId = query.terminalId;
  if (typeof terminalId !== 'string' || terminalId.length === 0) return null;
  return { terminalId };
}

// ---------------------------------------------------------------------------
// 訓練電文注入（Issue #70 J2）
// ---------------------------------------------------------------------------

export const TRAINING_INJECT_MAX_TELEGRAMS = 20; // ストック上限と同じ
export const TRAINING_INJECT_MAX_XML_BYTES = 32 * 1024; // 実測最大 13,927 bytes の2倍超
export const TRAINING_INJECT_MAX_BODY_BYTES = 384 * 1024; // 20通×実測最大約15KB に余裕

export const TRAINING_TELEGRAM_TYPES: readonly TrainingTelegramType[] = Object.freeze([
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
  'VPBS50',
  'VPHW50',
  'VPHW51',
]);

export function isTrainingTelegramType(value: unknown): value is TrainingTelegramType {
  return (
    typeof value === 'string' && (TRAINING_TELEGRAM_TYPES as readonly string[]).includes(value)
  );
}

export interface TrainingInjectTelegram {
  /** J1 の TrainingTelegramPreview.id（`${generationId}:${index}`、index は 0〜9）。 */
  readonly previewId: string;
  /** J1 の TrainingGenerateResponse.generatedAt（UTC ISO、ミリ秒付き）。 */
  readonly generatedAt: string;
  readonly itemIds: readonly TrainingItemId[];
  readonly telegramType: TrainingTelegramType;
  readonly xml: string;
}

export interface TrainingInjectRequest {
  readonly terminalId: string;
  readonly telegrams: readonly TrainingInjectTelegram[]; // 1〜20、previewId 重複なし
}

export interface TrainingInjectAdoption {
  readonly venueId: string;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
}

export interface TrainingInjectedTelegram {
  readonly previewId: string;
  /** 注入内の投入順（基準電文を投入した場合は基準電文が 0、要求電文は 1 から。投入しない場合は要求電文が 0 から）。 */
  readonly sequence: number;
  readonly telegramType: TrainingTelegramType;
  readonly receptionId: number;
  readonly documentUrl: string;
  readonly adoptions: readonly TrainingInjectAdoption[]; // venueId 昇順
}

export interface TrainingInjectResponse {
  readonly trainingId: string; // UUID v4
  readonly injectedAt: string; // UTC ISO。Worker が受け付けた時刻
  readonly telegrams: readonly TrainingInjectedTelegram[]; // 要求電文のみ、sequence 昇順
  /** サーバーが生成・投入した訓練用 VPWS50 基準電文。投入しなかった場合は null。 */
  readonly baseline: {
    readonly sequence: 0;
    readonly receptionId: number;
    readonly documentUrl: string;
    readonly reportDateTime: string; // UTC ISO
    readonly adoptions: readonly TrainingInjectAdoption[];
  } | null;
}

export type TrainingInjectRejectReason =
  | 'regeneration_mismatch' // 再生成XMLと不一致
  | 'verification_failed'; // 生成検証の不合格

const PREVIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function parseInjectTelegram(value: unknown): TrainingInjectTelegram | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 5 ||
    !keys.includes('previewId') ||
    !keys.includes('generatedAt') ||
    !keys.includes('itemIds') ||
    !keys.includes('telegramType') ||
    !keys.includes('xml')
  ) {
    return null;
  }
  if (typeof value.previewId !== 'string' || !PREVIEW_ID_PATTERN.test(value.previewId)) {
    return null;
  }
  if (!isValidUtcIso(value.generatedAt)) {
    return null;
  }
  const itemIds = parseTrainingItemIds(value.itemIds);
  if (itemIds === null) return null;
  if (!isTrainingTelegramType(value.telegramType)) return null;
  if (typeof value.xml !== 'string' || value.xml.length === 0) return null;
  const byteLength = new TextEncoder().encode(value.xml).length;
  if (byteLength > TRAINING_INJECT_MAX_XML_BYTES) return null;

  return {
    previewId: value.previewId,
    generatedAt: value.generatedAt,
    itemIds,
    telegramType: value.telegramType,
    xml: value.xml,
  };
}

export function parseTrainingInjectRequest(value: unknown): TrainingInjectRequest | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('terminalId') || !keys.includes('telegrams')) {
    return null;
  }
  if (typeof value.terminalId !== 'string' || value.terminalId.length === 0) return null;
  if (
    !Array.isArray(value.telegrams) ||
    value.telegrams.length < 1 ||
    value.telegrams.length > TRAINING_INJECT_MAX_TELEGRAMS
  ) {
    return null;
  }
  const seenPreviewIds = new Set<string>();
  const telegrams: TrainingInjectTelegram[] = [];
  for (const entry of value.telegrams) {
    const telegram = parseInjectTelegram(entry);
    if (telegram === null) return null;
    if (seenPreviewIds.has(telegram.previewId)) return null;
    seenPreviewIds.add(telegram.previewId);
    telegrams.push(telegram);
  }
  return { terminalId: value.terminalId, telegrams };
}

function parseInjectAdoption(value: unknown): TrainingInjectAdoption | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('venueId') ||
    !keys.includes('adoptionResult') ||
    !keys.includes('adoptionReason')
  ) {
    return null;
  }
  if (typeof value.venueId !== 'string' || value.venueId.length === 0) return null;
  if (value.adoptionResult !== null && typeof value.adoptionResult !== 'string') return null;
  if (value.adoptionReason !== null && typeof value.adoptionReason !== 'string') return null;
  return {
    venueId: value.venueId,
    adoptionResult: value.adoptionResult,
    adoptionReason: value.adoptionReason,
  };
}

export function parseTrainingInjectResponse(value: unknown): TrainingInjectResponse | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    !keys.includes('trainingId') ||
    !keys.includes('injectedAt') ||
    !keys.includes('telegrams') ||
    !keys.includes('baseline')
  ) {
    return null;
  }
  if (typeof value.trainingId !== 'string' || !UUID_V4_PATTERN.test(value.trainingId)) {
    return null;
  }
  if (!isValidUtcIso(value.injectedAt)) {
    return null;
  }
  if (!Array.isArray(value.telegrams)) return null;
  const telegrams: TrainingInjectedTelegram[] = [];
  for (const entry of value.telegrams) {
    if (!isPlainObject(entry)) return null;
    const tKeys = Object.keys(entry);
    if (
      tKeys.length !== 6 ||
      !tKeys.includes('previewId') ||
      !tKeys.includes('sequence') ||
      !tKeys.includes('telegramType') ||
      !tKeys.includes('receptionId') ||
      !tKeys.includes('documentUrl') ||
      !tKeys.includes('adoptions')
    ) {
      return null;
    }
    if (typeof entry.previewId !== 'string') return null;
    if (
      typeof entry.sequence !== 'number' ||
      !Number.isInteger(entry.sequence) ||
      entry.sequence < 0
    ) {
      return null;
    }
    if (!isTrainingTelegramType(entry.telegramType)) return null;
    if (
      typeof entry.receptionId !== 'number' ||
      !Number.isInteger(entry.receptionId) ||
      entry.receptionId <= 0
    ) {
      return null;
    }
    if (typeof entry.documentUrl !== 'string' || entry.documentUrl.length === 0) return null;
    if (!Array.isArray(entry.adoptions)) return null;
    const adoptions: TrainingInjectAdoption[] = [];
    for (const a of entry.adoptions) {
      const adoption = parseInjectAdoption(a);
      if (adoption === null) return null;
      adoptions.push(adoption);
    }
    telegrams.push({
      previewId: entry.previewId,
      sequence: entry.sequence,
      telegramType: entry.telegramType,
      receptionId: entry.receptionId,
      documentUrl: entry.documentUrl,
      adoptions,
    });
  }

  let baseline: TrainingInjectResponse['baseline'] = null;
  if (value.baseline !== null) {
    if (!isPlainObject(value.baseline)) return null;
    const bKeys = Object.keys(value.baseline);
    if (
      bKeys.length !== 5 ||
      !bKeys.includes('sequence') ||
      !bKeys.includes('receptionId') ||
      !bKeys.includes('documentUrl') ||
      !bKeys.includes('reportDateTime') ||
      !bKeys.includes('adoptions')
    ) {
      return null;
    }
    if (value.baseline.sequence !== 0) return null;
    if (
      typeof value.baseline.receptionId !== 'number' ||
      !Number.isInteger(value.baseline.receptionId) ||
      value.baseline.receptionId <= 0
    ) {
      return null;
    }
    if (typeof value.baseline.documentUrl !== 'string' || value.baseline.documentUrl.length === 0) {
      return null;
    }
    if (typeof value.baseline.reportDateTime !== 'string') return null;
    if (!Array.isArray(value.baseline.adoptions)) return null;
    const adoptions: TrainingInjectAdoption[] = [];
    for (const a of value.baseline.adoptions) {
      const adoption = parseInjectAdoption(a);
      if (adoption === null) return null;
      adoptions.push(adoption);
    }
    baseline = {
      sequence: 0,
      receptionId: value.baseline.receptionId,
      documentUrl: value.baseline.documentUrl,
      reportDateTime: value.baseline.reportDateTime,
      adoptions,
    };
  }

  return {
    trainingId: value.trainingId,
    injectedAt: value.injectedAt,
    telegrams,
    baseline,
  };
}
