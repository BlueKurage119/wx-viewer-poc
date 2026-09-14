import type { Availability } from './availability.js';
import type { UtcIso8601String } from './types.js';
import type { VenueId } from './venueForecastTargets.js';

export type WeatherControlStatus = 'normal' | 'training' | 'test';

export interface WeatherMetadata {
  readonly source: string | null;
  readonly issuedAt: UtcIso8601String | null;
  readonly validAt: UtcIso8601String | null;
  readonly validFrom: UtcIso8601String | null;
  readonly validTo: UtcIso8601String | null;
  readonly fetchedAt: UtcIso8601String | null;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly availability: Availability;
  readonly sourceVersion: string | null;
}

export interface WeatherContext {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly controlStatus: WeatherControlStatus;
  readonly isTraining: boolean;
  readonly evaluatedAt: UtcIso8601String;
}

export interface WeatherArea {
  readonly code: string;
  readonly name: string;
}

export interface WeatherDataset<T> {
  readonly area: WeatherArea;
  readonly metadata: WeatherMetadata;
  readonly data: T | null;
}

// ==========================================
// #33 現況警報・注意報
// ==========================================

export interface WarningCurrentItem {
  readonly sequence: number;
  readonly kindCode: string;
  readonly kindName: string;
  readonly kindStatus: string;
  readonly lastKindCode: string | null;
  readonly lastKindName: string | null;
  readonly kindIssuedAt: UtcIso8601String | null;
  readonly sourceTelegram: string;
}

export interface WarningCurrentData {
  readonly items: readonly WarningCurrentItem[];
}

export interface WarningCapabilities {
  readonly unsupportedKindCodes: readonly ['04', '18'];
  readonly supplementSource: 'warning-timeseries';
}

export type WarningsResponse = WeatherContext &
  WeatherDataset<WarningCurrentData> & {
    readonly capabilities: WarningCapabilities;
  };

// ==========================================
// #34 警報等時系列
// ==========================================

export interface TimeseriesScope {
  readonly kindIndex: number;
  readonly propertyIndex: number;
  readonly partName: string;
  readonly partIndex: number;
  readonly baseIndex: number;
  readonly localIndex: number | null;
}

export interface TimeseriesAddition {
  readonly blockId: string;
  readonly scope: TimeseriesScope;
  readonly propertyType: string;
  readonly kindStatus: string;
  readonly kindDateTime: UtcIso8601String | null;
  readonly areaDivision: string | null;
  readonly additionIndex: number;
  readonly noteIndex: number;
  readonly text: string;
}

export interface WarningTimeseriesTimeDefine {
  readonly blockId: string;
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface WarningTimeseriesValue {
  readonly blockId: string;
  readonly refId: string;
  readonly kindCode: string | null;
  readonly kindName: string | null;
  readonly kindStatus: string;
  readonly kindDateTime: UtcIso8601String | null;
  readonly valueCategory: 'risk' | 'quantity';
  readonly propertyType: string;
  readonly valueType: string;
  readonly valueCode: string | null;
  readonly valueText: string;
  readonly unit: string | null;
  readonly description: string | null;
  readonly condition: string | null;
  readonly areaDivision: string | null;
  readonly sequence: number;
  readonly scope: TimeseriesScope | null;
}

export interface WarningTimeseriesData {
  readonly timeDefines: readonly WarningTimeseriesTimeDefine[];
  readonly values: readonly WarningTimeseriesValue[];
  readonly additions: readonly TimeseriesAddition[] | null;
}

export type WarningTimeseriesResponse = WeatherContext & WeatherDataset<WarningTimeseriesData>;

// ==========================================
// #35 早期注意情報（警報級の可能性）
// ==========================================

export interface EarlyWarningTimeDefine {
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface EarlyWarningCell {
  readonly refId: string;
  readonly phenomenonCode: string;
  readonly phenomenonName: string;
  readonly rankValue: string | null;
  readonly condition: string | null;
}

export interface EarlyWarningData {
  readonly segment: 'near' | 'far';
  readonly telegramType: string;
  readonly timeDefines: readonly EarlyWarningTimeDefine[];
  readonly cells: readonly EarlyWarningCell[];
}

export type EarlyWarningResponse = WeatherContext & {
  readonly near: WeatherDataset<EarlyWarningData>;
  readonly far: WeatherDataset<EarlyWarningData>;
};

// ==========================================
// 共通観測地点型
// ==========================================

export interface WeatherStation {
  readonly code: string;
  readonly name: string;
}

// ==========================================
// #36 地域時系列予報
// ==========================================

export interface AreaTimeseriesTimeDefineDto {
  readonly blockId: string; // 'region-3hour' | 'temperature-3hour'
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String; // 時点値ブロックでは timeFrom と同値
  readonly duration: string | null; // 時点値ブロックでは null
}

export interface AreaTimeseriesValueDto {
  readonly blockId: string;
  readonly refId: string;
  readonly element: 'weather' | 'wind_direction' | 'wind_speed_rank' | 'temperature';
  readonly valueCode: string | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly sequence: number;
}

export interface AreaTimeseriesData {
  readonly station: WeatherStation; // 気温予報地点（44132 東京）
  readonly timeDefines: readonly AreaTimeseriesTimeDefineDto[];
  readonly values: readonly AreaTimeseriesValueDto[];
}

export interface AreaTimeseriesCapabilities {
  readonly blockIds: readonly ['region-3hour', 'temperature-3hour'];
  readonly elements: readonly ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'];
  readonly unsupportedFields: readonly ['weatherCode', 'windSpeedRange', 'windSpeedDescription'];
}

export type AreaTimeseriesResponse = WeatherContext &
  WeatherDataset<AreaTimeseriesData> & {
    readonly capabilities: AreaTimeseriesCapabilities;
  };

// ==========================================
// #37 アメダス
// ==========================================

export type AmedasPublicElement =
  'temp' | 'humidity' | 'windDirection' | 'wind' | 'precipitation1h';

/** 公開5要素のみ。地点が提供しない要素はキー自体を持たない（欠測は null）。 */
export interface AmedasElementValues {
  readonly temp?: number | null;
  readonly humidity?: number | null;
  readonly windDirection?: number | null;
  readonly wind?: number | null;
  readonly precipitation1h?: number | null;
}

export interface AmedasObservationDto {
  readonly observedAt: UtcIso8601String;
  readonly values: AmedasElementValues;
}

export interface AmedasData {
  readonly latestObservedAt: UtcIso8601String | null;
  readonly observations: readonly AmedasObservationDto[]; // observedAt 昇順
}

export interface AmedasCapabilities {
  /** 公開契約上の要素順。表示順の指示ではない。 */
  readonly publicElements: readonly AmedasPublicElement[];
  /** 会場の elems から導いた、この地点が提供しない公開要素。 */
  readonly unsupportedElements: readonly AmedasPublicElement[];
}

export type AmedasResponse = WeatherContext & {
  readonly station: WeatherStation;
  readonly metadata: WeatherMetadata;
  readonly data: AmedasData | null;
  readonly capabilities: AmedasCapabilities;
};

// ==========================================
// #38 気象防災速報
// ==========================================

export type BulletinTelegramType = 'VPBS50' | 'VPHW50' | 'VPHW51';

export interface BulletinAreaDto {
  readonly areaCode: string;
  readonly areaName: string;
  readonly codeType: string;
  readonly sequence: number;
  readonly informationType: string | null;
}

export interface BulletinDto {
  /** C7 は原文 EventID、C8 は合成キー `${telegramType}:${発表細分区域コード}`。 */
  readonly eventId: string;
  /** source URL から解決した電文種別。解決できない場合は null。 */
  readonly telegramType: BulletinTelegramType | null;
  readonly infoType: string; // 発表 / 訂正 / 取消
  readonly isCancelled: boolean;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly title: string;
  readonly headlineText: string | null;
  readonly informationTag: string | null; // 線状降水帯発生 / 線状降水帯直前 / 記録雨 / null
  /** VPHW51 のみ true/false。VPHW50 と VPBS50 は常に null（判定不能／該当なし）。 */
  readonly hasSighting: boolean | null;
  readonly areas: readonly BulletinAreaDto[];
  /** 会場の市区町村等コードが areas に現れるか（サービス層で都度計算）。 */
  readonly isDirect: boolean;
  /** 会場の includedAreaCodes と交差した区域コード（areas の sequence 順、重複なし）。 */
  readonly matchedAreaCodes: readonly string[];
  readonly metadata: WeatherMetadata;
}

export interface BulletinsCapabilities {
  readonly telegramTypes: readonly ['VPBS50', 'VPHW50', 'VPHW51'];
  /** この種別では目撃有無を構造的に判定できない（hasSighting=null の意味）。 */
  readonly sightingUndeterminableTypes: readonly ['VPHW50', 'VPBS50'];
  /** 保存していないため提供しない項目。 */
  readonly unsupportedFields: readonly ['editorialOffice', 'publishingOffice'];
  /** VPHW50/VPHW51 の同一区域2行並存を統合していない。 */
  readonly deduplicated: false;
}

export type BulletinsResponse = WeatherContext & {
  readonly area: WeatherArea; // 会場の市区町村等（判定の基準）
  readonly availability: Availability; // 一覧全体の鮮度（§4.3）
  readonly bulletins: readonly BulletinDto[]; // 0件は「発表なし」であり異常ではない
  readonly capabilities: BulletinsCapabilities;
};

// ==========================================
// Query 検証
// ==========================================

export interface WeatherApiQuery {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}

export type WeatherApiQueryParseResult =
  | { readonly ok: true; readonly value: WeatherApiQuery }
  | { readonly ok: false; readonly error: 'invalid_request' };

/**
 * 気象 REST API の共通クエリパラメーターを厳格に検証する。
 * - terminalId と controlStatus の2キーのみ許可（未知キー、欠落は不可）
 * - 文字列型かつ非空
 * - 配列やオブジェクト等の重複・複合指定は不可
 * - controlStatus は 'normal' | 'training' | 'test' のみ
 */
export function parseWeatherApiQuery(query: unknown): WeatherApiQueryParseResult {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return { ok: false, error: 'invalid_request' };
  }

  const record = query as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length !== 2) {
    return { ok: false, error: 'invalid_request' };
  }

  if (!Object.prototype.hasOwnProperty.call(record, 'terminalId')) {
    return { ok: false, error: 'invalid_request' };
  }

  if (!Object.prototype.hasOwnProperty.call(record, 'controlStatus')) {
    return { ok: false, error: 'invalid_request' };
  }

  const rawTerminalId = record.terminalId;
  if (typeof rawTerminalId !== 'string' || rawTerminalId.trim().length === 0) {
    return { ok: false, error: 'invalid_request' };
  }

  const rawControlStatus = record.controlStatus;
  if (
    rawControlStatus !== 'normal' &&
    rawControlStatus !== 'training' &&
    rawControlStatus !== 'test'
  ) {
    return { ok: false, error: 'invalid_request' };
  }

  return {
    ok: true,
    value: {
      terminalId: rawTerminalId,
      controlStatus: rawControlStatus,
    },
  };
}
