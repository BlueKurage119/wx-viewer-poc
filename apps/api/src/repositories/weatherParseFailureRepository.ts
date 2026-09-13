import type { VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { ControlStatus } from './types.js';

export interface WeatherParseFailureCheckBaseline {
  readonly reportDateTime: string;
  readonly controlDateTime: string;
}

export interface WeatherParseFailureCheckParams {
  readonly venueId: VenueId;
  readonly controlStatus: ControlStatus;
  readonly telegramType: string;
  readonly areaCode: string;
  readonly baseline: WeatherParseFailureCheckBaseline;
}

/**
 * 要求された会場・controlStatus・電文種別・対象区域コードについて、
 * 指定された baseline 時刻対 (reportDateTime, controlDateTime) より新しい
 * 「未対応構造」の解析失敗履歴が存在するかを判定する。
 *
 * 設計書 §4 準拠:
 * - telegram_reception, telegram_reception_adoption, telegram_reception_area を結合
 * - adoption_result = '未対応構造'
 * - 数値時刻（ミリ秒精度）による順序比較。UTC 文字列直接比較は禁止。
 * - reportDateTime が等しい場合のみ controlDateTime を比較
 * - 同時刻・不明時刻は「新しい失敗」とは判定しない
 * - SQL EXISTS を使用して高速に評価
 */
export function hasNewerWeatherParseFailure(
  connection: DatabaseConnection,
  params: WeatherParseFailureCheckParams,
): boolean {
  const stmt = connection.prepare(`
    SELECT EXISTS(
      SELECT 1
      FROM telegram_reception r
      JOIN telegram_reception_adoption a ON a.reception_id = r.id
      JOIN telegram_reception_area area ON area.reception_id = r.id
      WHERE r.telegram_type = :telegramType
        AND r.control_status = :controlStatus
        AND a.venue_id = :venueId
        AND a.adoption_result = '未対応構造'
        AND area.area_code = :areaCode
        AND r.report_datetime IS NOT NULL
        AND r.control_datetime IS NOT NULL
        AND unixepoch(r.report_datetime, 'subsec') IS NOT NULL
        AND unixepoch(r.control_datetime, 'subsec') IS NOT NULL
        AND unixepoch(:baselineReport, 'subsec') IS NOT NULL
        AND unixepoch(:baselineControl, 'subsec') IS NOT NULL
        AND (
          unixepoch(r.report_datetime, 'subsec') > unixepoch(:baselineReport, 'subsec')
          OR (
            unixepoch(r.report_datetime, 'subsec') = unixepoch(:baselineReport, 'subsec')
            AND unixepoch(r.control_datetime, 'subsec') > unixepoch(:baselineControl, 'subsec')
          )
        )
    ) AS has_failure
  `);

  const row = stmt.get({
    telegramType: params.telegramType,
    controlStatus: params.controlStatus,
    venueId: params.venueId,
    areaCode: params.areaCode,
    baselineReport: params.baseline.reportDateTime,
    baselineControl: params.baseline.controlDateTime,
  }) as { has_failure: number } | undefined;

  return row?.has_failure === 1;
}
