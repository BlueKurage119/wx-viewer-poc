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
