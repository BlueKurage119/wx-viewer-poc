import type { TrainingItemId, TrainingTelegramType } from '@wx-viewer-poc/shared';

/**
 * 訓練電文生成（Issue #69 J1）の固定シナリオ定義。
 *
 * 根拠は設計書 docs/design/issue-69-training-telegram-generator.md の「生成項目表」「XML共通規則」。
 * 参照資料: 気象警報・注意報（R06）解説資料 別表3–6、気象解説情報形式解説資料 §2–3、
 * 竜巻注意情報解説資料 pp.3–6、気象庁XML公式サンプル 15_16_01〜07・19_08_03・82_01_02。
 * 出力は公式電文ではなく synthetic（訓練用合成）。数値・時間幅は訓練シナリオの固定値であり、
 * 公式の発表基準や運用周期を意味しない。
 */

export const AREA_CODE_TYPE_FORECAST = '気象情報／府県予報区・細分区域等';
export const AREA_CODE_TYPE_MUNICIPAL = '気象・地震・火山情報／市町村等';

export interface TrainingArea {
  readonly name: string;
  readonly code: string;
  readonly codeType: string;
}

/** 東京ビッグサイト周辺。上3層は府県予報区・細分区域、最下層が市町村等。 */
export const TRAINING_AREA_PREFECTURE: TrainingArea = {
  name: '東京都',
  code: '130000',
  codeType: AREA_CODE_TYPE_FORECAST,
};
export const TRAINING_AREA_PRIMARY: TrainingArea = {
  name: '東京地方',
  code: '130010',
  codeType: AREA_CODE_TYPE_FORECAST,
};
export const TRAINING_AREA_GROUP: TrainingArea = {
  name: '２３区東部',
  code: '130012',
  codeType: AREA_CODE_TYPE_FORECAST,
};
export const TRAINING_AREA_MUNICIPAL: TrainingArea = {
  name: '江東区',
  code: '1310800',
  codeType: AREA_CODE_TYPE_MUNICIPAL,
};

/** parser呼出しに渡す訓練用固定の対象区域（実監視の会場設定とは独立）。 */
export const TRAINING_PARSER_MUNICIPAL_TARGET = {
  municipalCode: TRAINING_AREA_MUNICIPAL.code,
  displayName: TRAINING_AREA_MUNICIPAL.name,
} as const;
export const TRAINING_PARSER_BULLETIN_TARGET = {
  includedAreaCodes: [
    TRAINING_AREA_MUNICIPAL.code,
    TRAINING_AREA_GROUP.code,
    TRAINING_AREA_PRIMARY.code,
  ],
} as const;

export const WARNING_INFORMATION_TIERS: readonly {
  readonly type: string;
  readonly area: TrainingArea;
  /** 上3層。FullStatus/EditingMarkを持ち、Propertyを持たない。 */
  readonly upper: boolean;
}[] = [
  { type: '気象警報・注意報（府県予報区等）', area: TRAINING_AREA_PREFECTURE, upper: true },
  { type: '気象警報・注意報（一次細分区域等）', area: TRAINING_AREA_PRIMARY, upper: true },
  {
    type: '気象警報・注意報（市町村等をまとめた地域等）',
    area: TRAINING_AREA_GROUP,
    upper: true,
  },
  { type: '気象警報・注意報（市町村等）', area: TRAINING_AREA_MUNICIPAL, upper: false },
];

export const TORNADO_INFORMATION_TIERS: readonly {
  readonly type: string;
  readonly area: TrainingArea;
}[] = [
  { type: '竜巻注意情報（発表細分）', area: TRAINING_AREA_PREFECTURE },
  { type: '竜巻注意情報（一次細分区域等）', area: TRAINING_AREA_PRIMARY },
  { type: '竜巻注意情報（市町村等をまとめた地域等）', area: TRAINING_AREA_GROUP },
  { type: '竜巻注意情報（市町村等）', area: TRAINING_AREA_MUNICIPAL },
];
export const TORNADO_SIGHTING_INFORMATION_TYPE = '竜巻注意情報（目撃情報あり）';

export type WarningTelegramType = Extract<
  TrainingTelegramType,
  'VPWW55' | 'VPWW56' | 'VPWW57' | 'VPWW58' | 'VPWW59' | 'VPWW60' | 'VPWW61'
>;

export type Phenomenon =
  | 'rain'
  | 'landslide'
  | 'surge'
  | 'wind'
  | 'wave'
  | 'snow'
  | 'thunder'
  | 'fog'
  | 'dry'
  | 'cold'
  | 'frost'
  | 'icing'
  | 'snow-accretion';

export type Severity = 'advisory' | 'warning' | 'special';

export interface PhenomenonDefinition {
  readonly telegramType: WarningTelegramType;
  /** 危険度Property/Typeおよび Significancy@type（同一文字列）。 */
  readonly riskType: string;
  /** VPWW61 の Head/Title に連結する現象名。 */
  readonly shortName: string;
}

export const PHENOMENA: Readonly<Record<Phenomenon, PhenomenonDefinition>> = {
  rain: { telegramType: 'VPWW55', riskType: '大雨浸水危険度', shortName: '大雨' },
  landslide: { telegramType: 'VPWW56', riskType: '土砂災害危険度', shortName: '土砂災害' },
  surge: { telegramType: 'VPWW57', riskType: '高潮危険度', shortName: '高潮' },
  wind: { telegramType: 'VPWW58', riskType: '風危険度', shortName: '暴風' },
  wave: { telegramType: 'VPWW59', riskType: '波危険度', shortName: '波浪' },
  snow: { telegramType: 'VPWW60', riskType: '雪危険度', shortName: '大雪' },
  thunder: { telegramType: 'VPWW61', riskType: '雷危険度', shortName: '雷' },
  fog: { telegramType: 'VPWW61', riskType: '濃霧危険度', shortName: '濃霧' },
  dry: { telegramType: 'VPWW61', riskType: '乾燥危険度', shortName: '乾燥' },
  cold: { telegramType: 'VPWW61', riskType: '低温危険度', shortName: '低温' },
  frost: { telegramType: 'VPWW61', riskType: '霜危険度', shortName: '霜' },
  icing: { telegramType: 'VPWW61', riskType: '着氷危険度', shortName: '着氷' },
  'snow-accretion': { telegramType: 'VPWW61', riskType: '着雪危険度', shortName: '着雪' },
};

export const WARNING_CONTROL_TITLE_SUFFIX: Readonly<Record<WarningTelegramType, string>> = {
  VPWW55: '大雨',
  VPWW56: '土砂',
  VPWW57: '高潮',
  VPWW58: '暴風',
  VPWW59: '波浪',
  VPWW60: '大雪',
  VPWW61: 'その他注意報',
};

/** VPWW61以外の Head/Title。VPWW61は選択現象名から組み立てる。 */
export const WARNING_HEAD_TITLE: Readonly<Record<Exclude<WarningTelegramType, 'VPWW61'>, string>> =
  {
    VPWW55: '東京都大雨警報・注意報',
    VPWW56: '東京都土砂災害警報・注意報',
    VPWW57: '東京都高潮警報・注意報',
    VPWW58: '東京都暴風警報・注意報',
    VPWW59: '東京都波浪警報・注意報',
    VPWW60: '東京都大雪警報・注意報',
  };

export interface WarningDefinition {
  readonly itemId: TrainingItemId;
  /** 警報・注意報種別コード（別表3）。2桁。 */
  readonly code: string;
  readonly name: string;
  readonly phenomenon: Phenomenon;
  readonly severity: Severity;
  /** 警戒レベル（大雨・土砂・高潮のみ）。 */
  readonly level: 2 | 3 | 4 | 5 | null;
  /** 風雪系（風向を北とし、風向・風速に condition="風雪" を付す）。 */
  readonly snowWind: boolean;
}

function warning(
  code: string,
  name: string,
  phenomenon: Phenomenon,
  severity: Severity,
  level: WarningDefinition['level'] = null,
  snowWind = false,
): WarningDefinition {
  return {
    itemId: `warning-${code}` as TrainingItemId,
    code,
    name,
    phenomenon,
    severity,
    level,
    snowWind,
  };
}

/** 生成可能な警報・注意報（選択不可のものは含めない）。 */
export const WARNING_DEFINITIONS: readonly WarningDefinition[] = [
  warning('10', 'レベル２大雨注意報', 'rain', 'advisory', 2),
  warning('03', 'レベル３大雨警報', 'rain', 'warning', 3),
  warning('43', 'レベル４大雨危険警報', 'rain', 'warning', 4),
  warning('33', 'レベル５大雨特別警報', 'rain', 'special', 5),
  warning('29', 'レベル２土砂災害注意報', 'landslide', 'advisory', 2),
  warning('19', 'レベル２高潮注意報', 'surge', 'advisory', 2),
  warning('08', 'レベル３高潮警報', 'surge', 'warning', 3),
  warning('48', 'レベル４高潮危険警報', 'surge', 'warning', 4),
  warning('38', 'レベル５高潮特別警報', 'surge', 'special', 5),
  warning('15', '強風注意報', 'wind', 'advisory'),
  warning('05', '暴風警報', 'wind', 'warning'),
  warning('35', '暴風特別警報', 'wind', 'special'),
  warning('13', '風雪注意報', 'wind', 'advisory', null, true),
  warning('02', '暴風雪警報', 'wind', 'warning', null, true),
  warning('32', '暴風雪特別警報', 'wind', 'special', null, true),
  warning('16', '波浪注意報', 'wave', 'advisory'),
  warning('07', '波浪警報', 'wave', 'warning'),
  warning('37', '波浪特別警報', 'wave', 'special'),
  warning('12', '大雪注意報', 'snow', 'advisory'),
  warning('06', '大雪警報', 'snow', 'warning'),
  warning('36', '大雪特別警報', 'snow', 'special'),
  warning('14', '雷注意報', 'thunder', 'advisory'),
  warning('20', '濃霧注意報', 'fog', 'advisory'),
  warning('21', '乾燥注意報', 'dry', 'advisory'),
  warning('23', '低温注意報', 'cold', 'advisory'),
  warning('24', '霜注意報', 'frost', 'advisory'),
  warning('25', '着氷注意報', 'icing', 'advisory'),
  warning('26', '着雪注意報', 'snow-accretion', 'advisory'),
];

const warningDefinitionById: ReadonlyMap<string, WarningDefinition> = new Map(
  WARNING_DEFINITIONS.map((definition) => [definition.itemId, definition]),
);

export function findWarningDefinition(itemId: string): WarningDefinition | null {
  return warningDefinitionById.get(itemId) ?? null;
}

/** 危険度コード（別表5）。大雨・土砂・高潮は警戒レベル、その他は注意報級/警報級/特別警報級。 */
export function significancyOf(definition: WarningDefinition): { name: string; code: string } {
  switch (definition.level) {
    case 2:
      return { name: '警戒レベル２', code: '21' };
    case 3:
      return { name: '警戒レベル３相当', code: '31' };
    case 4:
      return { name: '警戒レベル４相当', code: '41' };
    case 5:
      return { name: '警戒レベル５相当', code: '51' };
    default:
      break;
  }
  if (definition.severity === 'advisory') return { name: '注意報級', code: '20' };
  if (definition.severity === 'warning') return { name: '警報級', code: '30' };
  return { name: '特別警報級', code: '50' };
}

/** 量Property（危険度とは別の、風・雪・波・濃霧・乾燥）のType。 */
export function quantityPropertyType(phenomenon: Phenomenon): string | null {
  switch (phenomenon) {
    case 'wind':
      return '風';
    case 'snow':
      return '雪';
    case 'wave':
      return '波';
    case 'fog':
      return '濃霧';
    case 'dry':
      return '乾燥';
    default:
      return null;
  }
}

/** 市町村Kindに生成されるProperty/Typeの期待順（検証用）。 */
export function expectedPropertyTypes(definition: WarningDefinition): readonly string[] {
  const risk = PHENOMENA[definition.phenomenon].riskType;
  if (definition.phenomenon === 'surge') return [risk, '高潮基準超過', '高潮ピーク'];
  const quantity = quantityPropertyType(definition.phenomenon);
  return quantity === null ? [risk] : [risk, quantity];
}

export type BulletinKind = 'linear-occurrence' | 'linear-imminent' | 'record-rain';

export interface BulletinDefinition {
  readonly itemId: TrainingItemId;
  readonly kind: BulletinKind;
  /** Headline/Information@type=情報タグ の Kind/Condition。 */
  readonly condition: '線状降水帯発生' | '線状降水帯直前' | '記録雨';
  /** Head/Title の括弧内。 */
  readonly titleLabel: string;
  /** EventID末尾の項目別英字。 */
  readonly eventIdSuffix: 'A' | 'B' | 'C';
}

export const BULLETIN_DEFINITIONS: readonly BulletinDefinition[] = [
  {
    itemId: 'bulletin-linear-occurrence',
    kind: 'linear-occurrence',
    condition: '線状降水帯発生',
    titleLabel: '線状降水帯発生',
    eventIdSuffix: 'A',
  },
  {
    itemId: 'bulletin-linear-imminent',
    kind: 'linear-imminent',
    condition: '線状降水帯直前',
    titleLabel: '線状降水帯直前予測',
    eventIdSuffix: 'B',
  },
  {
    itemId: 'bulletin-record-rain',
    kind: 'record-rain',
    condition: '記録雨',
    titleLabel: '記録的短時間大雨',
    eventIdSuffix: 'C',
  },
];

export interface TornadoDefinition {
  readonly itemId: TrainingItemId;
  readonly telegramType: 'VPHW50' | 'VPHW51';
  readonly controlTitle: string;
  readonly version: string;
  readonly titleLabel: string;
  readonly sighting: boolean;
}

export const TORNADO_DEFINITIONS: readonly TornadoDefinition[] = [
  {
    itemId: 'bulletin-tornado',
    telegramType: 'VPHW50',
    controlTitle: '竜巻注意情報',
    version: '1.0_0',
    titleLabel: '竜巻注意',
    sighting: false,
  },
  {
    itemId: 'bulletin-tornado-observed',
    telegramType: 'VPHW51',
    controlTitle: '竜巻注意情報（目撃情報付き）',
    version: '1.1_0',
    titleLabel: '竜巻目撃',
    sighting: true,
  },
];

export const WARNING_INFO_KIND_VERSION = '1.5_0';
export const BULLETIN_INFO_KIND_VERSION = '1.5_0';

/** 訓練用VPBS50のEventID。公式官署由来IDを装わない。 */
export function bulletinEventId(generationId: string, definition: BulletinDefinition): string {
  return `TRAIN${generationId.replace(/-/g, '')}${definition.eventIdSuffix}`;
}
