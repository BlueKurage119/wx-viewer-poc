import { resolveVenueForecastTargets, type VenueId } from '@wx-viewer-poc/shared';
import type {
  AreaTimeseriesForecastTarget,
  EarlyWarningTargetArea,
  WarningCurrentTargetArea,
  WarningTargetArea,
  WarningTimeseriesTargetArea,
} from './repositories/types.js';

/** C2 用の市町村等警報対象を会場定義から解決する。 */
export function resolveWarningTargetArea(venueId: VenueId): WarningTargetArea {
  const target = resolveVenueForecastTargets(venueId).warning;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C3 用の市町村等・府県予報区対象を会場定義から解決する。 */
export function resolveWarningCurrentTargetArea(venueId: VenueId): WarningCurrentTargetArea {
  const target = resolveVenueForecastTargets(venueId).warning;
  return {
    municipalCode: target.municipalCode,
    displayName: target.displayName,
    prefectureCode: target.prefectureCode,
  };
}

/** C4 用の警報等時系列対象を会場定義から解決する。 */
export function resolveWarningTimeseriesTargetArea(venueId: VenueId): WarningTimeseriesTargetArea {
  const target = resolveVenueForecastTargets(venueId).warningTimeseries;
  return { municipalCode: target.municipalCode, displayName: target.displayName };
}

/** C5 用の広域予報対象を会場定義から解決する。 */
export function resolveEarlyWarningTargetArea(venueId: VenueId): EarlyWarningTargetArea {
  const target = resolveVenueForecastTargets(venueId).broadForecast;
  return { forecastAreaCode: target.areaCode, displayName: target.displayName };
}

/** C6 用の地域時系列予報対象（広域予報区域＋気温予報地点）を会場定義から解決する。 */
export function resolveAreaTimeseriesForecastTarget(
  venueId: VenueId,
): AreaTimeseriesForecastTarget {
  const targets = resolveVenueForecastTargets(venueId);
  return {
    forecastAreaCode: targets.broadForecast.areaCode,
    forecastAreaName: targets.broadForecast.displayName,
    temperatureStationCode: targets.temperatureForecast.stationCode,
    temperatureStationName: targets.temperatureForecast.displayName,
  };
}
