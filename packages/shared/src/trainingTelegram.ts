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

const NOT_SELECTABLE_LANDSLIDE = '江東区の該当基準設定がないため選択できません';
const NOT_SELECTABLE_NO_CRITERIA = '江東区の具体的基準が設定されていないため選択できません';

function item(id: TrainingItemId, label: string, group: string): TrainingItem {
  return { id, label, group, selectable: true, unavailableReason: null };
}

function unavailable(
  id: TrainingItemId,
  label: string,
  group: string,
  reason: string,
): TrainingItem {
  return { id, label, group, selectable: false, unavailableReason: reason };
}

/** 項目表（表示順）。生成可否はここを正本とし、API・画面の双方が参照する。 */
export const TRAINING_ITEMS: readonly TrainingItem[] = Object.freeze([
  item('warning-10', 'レベル２大雨注意報', 'rain'),
  item('warning-03', 'レベル３大雨警報', 'rain'),
  item('warning-43', 'レベル４大雨危険警報', 'rain'),
  item('warning-33', 'レベル５大雨特別警報', 'rain'),
  item('warning-29', 'レベル２土砂災害注意報', 'landslide'),
  unavailable('warning-09', 'レベル３土砂災害警報', 'landslide', NOT_SELECTABLE_LANDSLIDE),
  unavailable('warning-49', 'レベル４土砂災害危険警報', 'landslide', NOT_SELECTABLE_LANDSLIDE),
  unavailable('warning-39', 'レベル５土砂災害特別警報', 'landslide', NOT_SELECTABLE_LANDSLIDE),
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
  unavailable('warning-17', '融雪注意報', 'snowmelt', NOT_SELECTABLE_NO_CRITERIA),
  unavailable('warning-22', 'なだれ注意報', 'avalanche', NOT_SELECTABLE_NO_CRITERIA),
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
  snowmelt: '融雪',
  avalanche: 'なだれ',
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
