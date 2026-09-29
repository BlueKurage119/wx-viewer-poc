import {
  resolveVenueForecastTargets,
  type AmedasStationCode,
  type RegionalForecastAreaCode,
  type VenueId,
} from './venueForecastTargets.js';

const targets = resolveVenueForecastTargets('east');

// @ts-expect-error アメダス地点を市町村等警報コードとして渡してはならない。
const invalidMunicipalCode: typeof targets.warning.municipalCode = targets.amedas.stationCode;
// @ts-expect-error 気温予報地点を広域予報区域として渡してはならない。
const invalidRegionalCode: RegionalForecastAreaCode = targets.temperatureForecast.stationCode;

void invalidMunicipalCode;
void invalidRegionalCode;
void (null as unknown as VenueId);
void (null as unknown as AmedasStationCode);
