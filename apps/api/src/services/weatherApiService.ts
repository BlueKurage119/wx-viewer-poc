import {
  resolveVenueForecastTargets,
  type AmedasCapabilities,
  type AmedasData,
  type AmedasObservationDto,
  type AmedasPublicElement,
  type AmedasResponse,
  type AreaTimeseriesCapabilities,
  type AreaTimeseriesData,
  type AreaTimeseriesResponse,
  type AreaTimeseriesTimeDefineDto,
  type AreaTimeseriesValueDto,
  type BulletinAreaDto,
  type BulletinDto,
  type BulletinsCapabilities,
  type BulletinsResponse,
  type BulletinTelegramType,
  type EarlyWarningCell,
  type EarlyWarningData,
  type EarlyWarningResponse,
  type EarlyWarningTimeDefine,
  type TerminalDefinition,
  type TimeseriesAddition,
  type WarningCurrentData,
  type WarningCurrentItem,
  type WarningsResponse,
  type WarningTimeseriesData,
  type WarningTimeseriesResponse,
  type WarningTimeseriesTimeDefine,
  type WarningTimeseriesValue,
  type WeatherArea,
  type WeatherContext,
  type WeatherControlStatus,
  type WeatherDataset,
  type WeatherMetadata,
  type WeatherStation,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { JmaXmlPollingStatus } from '../polling/jmaXmlPollingService.js';
import { extractTelegramTypeFromUrl } from '../polling/jmaXmlFeedParser.js';
import { findAmedasSnapshot } from '../repositories/amedasRepository.js';
import { findAreaTimeseriesSnapshot } from '../repositories/areaTimeseriesRepository.js';
import { listBosaiBulletins } from '../repositories/bosaiBulletinRepository.js';
import { findEarlyWarningSnapshot } from '../repositories/earlyWarningRepository.js';
import { findWarningCurrentSnapshot } from '../repositories/warningCurrentRepository.js';
import { findWarningCurrentStream } from '../repositories/warningCurrentStreamRepository.js';
import { findWarningTimeseriesSnapshot } from '../repositories/warningTimeseriesRepository.js';
import { hasNewerWeatherParseFailure } from '../repositories/weatherParseFailureRepository.js';
import { WARNING_TELEGRAM_TYPES, type WarningTelegramType } from '../repositories/types.js';
import {
  resolveAmedasTarget,
  resolveAreaTimeseriesForecastTarget,
  resolveEarlyWarningTargetArea,
  resolveWarningCurrentTargetArea,
  resolveWarningTimeseriesTargetArea,
} from '../venueForecastTargets.js';
import { evaluateWeatherAvailability } from './weatherAvailability.js';

export interface WeatherApiServiceDeps {
  readonly connection: DatabaseConnection;
  readonly getPollingStatus?: () => JmaXmlPollingStatus | undefined;
  readonly now?: () => string;
}

export interface WeatherApiService {
  getWarnings(terminal: TerminalDefinition, controlStatus: WeatherControlStatus): WarningsResponse;
  getWarningTimeseries(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): WarningTimeseriesResponse;
  getEarlyWarning(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): EarlyWarningResponse;
  getAreaTimeseries(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): AreaTimeseriesResponse;
  getAmedas(terminal: TerminalDefinition, controlStatus: WeatherControlStatus): AmedasResponse;
  getBulletins(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): BulletinsResponse;
}

function buildUnavailableMetadata(): WeatherMetadata {
  return {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'unavailable',
    sourceVersion: null,
  };
}

function calculateMaxTimeTo(timeDefines: readonly { readonly timeTo: string }[]): string | null {
  if (timeDefines.length === 0) return null;
  let maxTime: string | null = null;
  let maxMs = -Infinity;
  for (const td of timeDefines) {
    const ms = new Date(td.timeTo).getTime();
    if (!Number.isNaN(ms) && ms > maxMs) {
      maxMs = ms;
      maxTime = td.timeTo;
    }
  }
  return maxTime;
}

const AMEDAS_PUBLIC_ELEMENTS: readonly AmedasPublicElement[] = [
  'temp',
  'humidity',
  'windDirection',
  'wind',
  'precipitation1h',
] as const;

function resolveUnsupportedAmedasElements(elements: string): readonly AmedasPublicElement[] {
  const result: AmedasPublicElement[] = [];
  const indexMap: Record<AmedasPublicElement, number> = {
    temp: 0,
    humidity: 6,
    windDirection: 2,
    wind: 3,
    precipitation1h: 1,
  };
  for (const elem of AMEDAS_PUBLIC_ELEMENTS) {
    const idx = indexMap[elem];
    if (idx !== undefined && elements.length > idx && elements.charAt(idx) === '0') {
      result.push(elem);
    }
  }
  return result;
}

export function createWeatherApiService(deps: WeatherApiServiceDeps): WeatherApiService {
  const connection = deps.connection;
  const getNow = deps.now ?? (() => new Date().toISOString());

  return {
    getWarnings(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): WarningsResponse {
      const nowIso = getNow();
      const pollingStatus = deps.getPollingStatus?.();
      const feedFreshness = pollingStatus?.feedFreshness
        ? {
            regular: pollingStatus.feedFreshness.regular.availability,
            extra: pollingStatus.feedFreshness.extra.availability,
          }
        : null;

      const targetArea = resolveWarningCurrentTargetArea(terminal.venueId);

      const tx = connection.transaction(() => {
        const snapshot = findWarningCurrentSnapshot(
          connection,
          targetArea.municipalCode,
          controlStatus,
        );

        const context: WeatherContext = {
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: nowIso,
        };

        const capabilities = {
          unsupportedKindCodes: ['04', '18'] as const,
          supplementSource: 'warning-timeseries' as const,
        };

        const defaultArea: WeatherArea = {
          code: targetArea.municipalCode,
          name: targetArea.displayName,
        };

        if (!snapshot) {
          return {
            ...context,
            area: defaultArea,
            metadata: buildUnavailableMetadata(),
            data: null,
            capabilities,
          };
        }

        // #33 の失敗判定:
        // 種別ごとの warning_current_stream の時刻対、未保存なら snapshot.telegram の時刻対を基準にする
        let hasParseFailure = false;
        for (const type of WARNING_TELEGRAM_TYPES) {
          const stream = findWarningCurrentStream(
            connection,
            targetArea.prefectureCode,
            targetArea.municipalCode,
            controlStatus,
            type as WarningTelegramType,
          );
          const baseline = stream
            ? { reportDateTime: stream.reportDateTime, controlDateTime: stream.controlDateTime }
            : {
                reportDateTime: snapshot.telegram.reportDateTime,
                controlDateTime: snapshot.telegram.controlDateTime,
              };

          if (
            hasNewerWeatherParseFailure(connection, {
              venueId: terminal.venueId,
              controlStatus,
              telegramType: type,
              areaCode: targetArea.municipalCode,
              baseline,
            })
          ) {
            hasParseFailure = true;
            break;
          }
        }

        const availability = evaluateWeatherAvailability({
          hasSnapshot: true,
          savedAvailability: snapshot.metadata.availability,
          feedFreshness,
          nowIso,
          hasParseFailure,
        });

        const items: WarningCurrentItem[] = snapshot.items.map((item) => ({
          sequence: item.sequence,
          kindCode: item.kindCode,
          kindName: item.kindName,
          kindStatus: item.kindStatus,
          lastKindCode: item.lastKindCode,
          lastKindName: item.lastKindName,
          kindIssuedAt: item.kindIssuedAt,
          sourceTelegram: item.sourceTelegram,
        }));

        const data: WarningCurrentData = { items };

        return {
          ...context,
          area: {
            code: snapshot.areaCode,
            name: snapshot.areaName || targetArea.displayName,
          },
          metadata: {
            source: snapshot.metadata.source,
            issuedAt: snapshot.metadata.issuedAt,
            validAt: snapshot.metadata.validAt,
            validFrom: snapshot.metadata.validFrom,
            validTo: snapshot.metadata.validTo,
            fetchedAt: snapshot.metadata.fetchedAt,
            lastSuccessAt: snapshot.metadata.lastSuccessAt,
            availability,
            sourceVersion: snapshot.metadata.sourceVersion,
          },
          data,
          capabilities,
        };
      });

      return tx();
    },

    getWarningTimeseries(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): WarningTimeseriesResponse {
      const nowIso = getNow();
      const pollingStatus = deps.getPollingStatus?.();
      const feedFreshness = pollingStatus?.feedFreshness
        ? {
            regular: pollingStatus.feedFreshness.regular.availability,
            extra: pollingStatus.feedFreshness.extra.availability,
          }
        : null;

      const targetArea = resolveWarningTimeseriesTargetArea(terminal.venueId);

      const tx = connection.transaction(() => {
        const snapshot = findWarningTimeseriesSnapshot(
          connection,
          targetArea.municipalCode,
          controlStatus,
        );

        const context: WeatherContext = {
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: nowIso,
        };

        const defaultArea: WeatherArea = {
          code: targetArea.municipalCode,
          name: targetArea.displayName,
        };

        if (!snapshot) {
          return {
            ...context,
            area: defaultArea,
            metadata: buildUnavailableMetadata(),
            data: null,
          };
        }

        const maxTimeTo = calculateMaxTimeTo(snapshot.timeDefines);

        const hasParseFailure = hasNewerWeatherParseFailure(connection, {
          venueId: terminal.venueId,
          controlStatus,
          telegramType: 'VPWP50',
          areaCode: targetArea.municipalCode,
          baseline: {
            reportDateTime: snapshot.telegram.reportDateTime,
            controlDateTime: snapshot.telegram.controlDateTime,
          },
        });

        const availability = evaluateWeatherAvailability({
          hasSnapshot: true,
          savedAvailability: snapshot.metadata.availability,
          feedFreshness,
          maxTimeTo,
          nowIso,
          hasParseFailure,
        });

        const timeDefines: WarningTimeseriesTimeDefine[] = snapshot.timeDefines.map((td) => ({
          blockId: td.blockId,
          timeId: td.timeId,
          sequence: td.sequence,
          timeFrom: td.timeFrom,
          timeTo: td.timeTo,
          duration: td.duration,
        }));

        const values: WarningTimeseriesValue[] = snapshot.values.map((v) => ({
          blockId: v.blockId,
          refId: v.refId,
          kindCode: v.kindCode,
          kindName: v.kindName,
          kindStatus: v.kindStatus,
          kindDateTime: v.kindDateTime,
          valueCategory: v.valueCategory as 'risk' | 'quantity',
          propertyType: v.propertyType,
          valueType: v.valueType,
          valueCode: v.valueCode,
          valueText: v.valueText,
          unit: v.unit,
          description: v.description,
          condition: v.condition,
          areaDivision: v.areaDivision,
          sequence: v.sequence,
          scope: v.scope,
        }));

        const additions: readonly TimeseriesAddition[] | null = snapshot.additions
          ? snapshot.additions.map((a) => ({
              blockId: a.blockId,
              scope: a.scope,
              propertyType: a.propertyType,
              kindStatus: a.kindStatus,
              kindDateTime: a.kindDateTime,
              areaDivision: a.areaDivision,
              additionIndex: a.additionIndex,
              noteIndex: a.noteIndex,
              text: a.text,
            }))
          : null;

        const data: WarningTimeseriesData = {
          timeDefines,
          values,
          additions,
        };

        return {
          ...context,
          area: {
            code: snapshot.areaCode,
            name: snapshot.areaName || targetArea.displayName,
          },
          metadata: {
            source: snapshot.metadata.source,
            issuedAt: snapshot.metadata.issuedAt,
            validAt: snapshot.metadata.validAt,
            validFrom: snapshot.metadata.validFrom,
            validTo: snapshot.metadata.validTo,
            fetchedAt: snapshot.metadata.fetchedAt,
            lastSuccessAt: snapshot.metadata.lastSuccessAt,
            availability,
            sourceVersion: snapshot.metadata.sourceVersion,
          },
          data,
        };
      });

      return tx();
    },

    getEarlyWarning(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): EarlyWarningResponse {
      const nowIso = getNow();
      const pollingStatus = deps.getPollingStatus?.();
      const feedFreshness = pollingStatus?.feedFreshness
        ? {
            regular: pollingStatus.feedFreshness.regular.availability,
            extra: pollingStatus.feedFreshness.extra.availability,
          }
        : null;

      const broadTarget = resolveEarlyWarningTargetArea(terminal.venueId);

      const tx = connection.transaction(() => {
        const nearSnapshot = findEarlyWarningSnapshot(
          connection,
          broadTarget.forecastAreaCode,
          'near',
          controlStatus,
        );

        const farSnapshot = findEarlyWarningSnapshot(
          connection,
          broadTarget.forecastAreaCode,
          'far',
          controlStatus,
        );

        const context: WeatherContext = {
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: nowIso,
        };

        const defaultArea: WeatherArea = {
          code: broadTarget.forecastAreaCode,
          name: broadTarget.displayName,
        };

        // near のデータセット構築
        let nearDataset: WeatherDataset<EarlyWarningData>;
        if (!nearSnapshot) {
          nearDataset = {
            area: defaultArea,
            metadata: buildUnavailableMetadata(),
            data: null,
          };
        } else {
          const nearMaxTimeTo = calculateMaxTimeTo(nearSnapshot.timeDefines);
          const nearHasParseFailure = hasNewerWeatherParseFailure(connection, {
            venueId: terminal.venueId,
            controlStatus,
            telegramType: 'VPFD61',
            areaCode: broadTarget.forecastAreaCode,
            baseline: {
              reportDateTime: nearSnapshot.telegram.reportDateTime,
              controlDateTime: nearSnapshot.telegram.controlDateTime,
            },
          });
          const nearAvailability = evaluateWeatherAvailability({
            hasSnapshot: true,
            savedAvailability: nearSnapshot.metadata.availability,
            feedFreshness,
            maxTimeTo: nearMaxTimeTo,
            nowIso,
            hasParseFailure: nearHasParseFailure,
          });

          const timeDefines: EarlyWarningTimeDefine[] = nearSnapshot.timeDefines.map((td) => ({
            timeId: td.timeId,
            sequence: td.sequence,
            timeFrom: td.timeFrom,
            timeTo: td.timeTo,
            duration: td.duration,
          }));

          const cells: EarlyWarningCell[] = nearSnapshot.cells.map((c) => ({
            refId: c.refId,
            phenomenonCode: c.phenomenonCode,
            phenomenonName: c.phenomenonName,
            rankValue: c.rankValue,
            condition: c.condition,
          }));

          nearDataset = {
            area: {
              code: nearSnapshot.areaCode,
              name: nearSnapshot.areaName || broadTarget.displayName,
            },
            metadata: {
              source: nearSnapshot.metadata.source,
              issuedAt: nearSnapshot.metadata.issuedAt,
              validAt: nearSnapshot.metadata.validAt,
              validFrom: nearSnapshot.metadata.validFrom,
              validTo: nearSnapshot.metadata.validTo,
              fetchedAt: nearSnapshot.metadata.fetchedAt,
              lastSuccessAt: nearSnapshot.metadata.lastSuccessAt,
              availability: nearAvailability,
              sourceVersion: nearSnapshot.metadata.sourceVersion,
            },
            data: {
              segment: 'near',
              telegramType: nearSnapshot.telegramType,
              timeDefines,
              cells,
            },
          };
        }

        // far のデータセット構築
        let farDataset: WeatherDataset<EarlyWarningData>;
        if (!farSnapshot) {
          farDataset = {
            area: defaultArea,
            metadata: buildUnavailableMetadata(),
            data: null,
          };
        } else {
          const farMaxTimeTo = calculateMaxTimeTo(farSnapshot.timeDefines);
          const farHasParseFailure = hasNewerWeatherParseFailure(connection, {
            venueId: terminal.venueId,
            controlStatus,
            telegramType: 'VPFW60',
            areaCode: broadTarget.forecastAreaCode,
            baseline: {
              reportDateTime: farSnapshot.telegram.reportDateTime,
              controlDateTime: farSnapshot.telegram.controlDateTime,
            },
          });
          const farAvailability = evaluateWeatherAvailability({
            hasSnapshot: true,
            savedAvailability: farSnapshot.metadata.availability,
            feedFreshness,
            maxTimeTo: farMaxTimeTo,
            nowIso,
            hasParseFailure: farHasParseFailure,
          });

          const timeDefines: EarlyWarningTimeDefine[] = farSnapshot.timeDefines.map((td) => ({
            timeId: td.timeId,
            sequence: td.sequence,
            timeFrom: td.timeFrom,
            timeTo: td.timeTo,
            duration: td.duration,
          }));

          const cells: EarlyWarningCell[] = farSnapshot.cells.map((c) => ({
            refId: c.refId,
            phenomenonCode: c.phenomenonCode,
            phenomenonName: c.phenomenonName,
            rankValue: c.rankValue,
            condition: c.condition,
          }));

          farDataset = {
            area: {
              code: farSnapshot.areaCode,
              name: farSnapshot.areaName || broadTarget.displayName,
            },
            metadata: {
              source: farSnapshot.metadata.source,
              issuedAt: farSnapshot.metadata.issuedAt,
              validAt: farSnapshot.metadata.validAt,
              validFrom: farSnapshot.metadata.validFrom,
              validTo: farSnapshot.metadata.validTo,
              fetchedAt: farSnapshot.metadata.fetchedAt,
              lastSuccessAt: farSnapshot.metadata.lastSuccessAt,
              availability: farAvailability,
              sourceVersion: farSnapshot.metadata.sourceVersion,
            },
            data: {
              segment: 'far',
              telegramType: farSnapshot.telegramType,
              timeDefines,
              cells,
            },
          };
        }

        return {
          ...context,
          near: nearDataset,
          far: farDataset,
        };
      });

      return tx();
    },

    getAreaTimeseries(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): AreaTimeseriesResponse {
      const nowIso = getNow();
      const pollingStatus = deps.getPollingStatus?.();
      const feedFreshness = pollingStatus?.feedFreshness
        ? {
            regular: pollingStatus.feedFreshness.regular.availability,
            extra: pollingStatus.feedFreshness.extra.availability,
          }
        : null;

      const target = resolveAreaTimeseriesForecastTarget(terminal.venueId);

      const tx = connection.transaction(() => {
        const snapshot = findAreaTimeseriesSnapshot(
          connection,
          target.forecastAreaCode,
          target.temperatureStationCode,
          controlStatus,
        );

        const context: WeatherContext = {
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: nowIso,
        };

        const capabilities: AreaTimeseriesCapabilities = {
          blockIds: ['region-3hour', 'temperature-3hour'],
          elements: ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'],
          unsupportedFields: ['weatherCode', 'windSpeedRange', 'windSpeedDescription'],
        };

        const defaultArea: WeatherArea = {
          code: target.forecastAreaCode,
          name: target.forecastAreaName,
        };

        if (!snapshot) {
          return {
            ...context,
            area: defaultArea,
            metadata: buildUnavailableMetadata(),
            data: null,
            capabilities,
          };
        }

        const maxTimeTo = calculateMaxTimeTo(snapshot.timeDefines);

        const hasParseFailure = hasNewerWeatherParseFailure(connection, {
          venueId: terminal.venueId,
          controlStatus,
          telegramType: 'VPFD51',
          areaCode: target.forecastAreaCode,
          baseline: {
            reportDateTime: snapshot.telegram.reportDateTime,
            controlDateTime: snapshot.telegram.controlDateTime,
          },
        });

        const availability = evaluateWeatherAvailability({
          hasSnapshot: true,
          savedAvailability: snapshot.metadata.availability,
          feedFreshness,
          maxTimeTo,
          nowIso,
          hasParseFailure,
        });

        const timeDefines: AreaTimeseriesTimeDefineDto[] = snapshot.timeDefines.map((td) => ({
          blockId: td.blockId,
          timeId: td.timeId,
          sequence: td.sequence,
          timeFrom: td.timeFrom,
          timeTo: td.timeTo,
          duration: td.duration,
        }));

        const values: AreaTimeseriesValueDto[] = snapshot.values.map((v) => ({
          blockId: v.blockId,
          refId: v.refId,
          element: v.element as AreaTimeseriesValueDto['element'],
          valueCode: v.valueCode,
          valueText: v.valueText,
          valueNumber: v.valueNumber,
          unit: v.unit,
          sequence: v.sequence,
        }));

        const station: WeatherStation = {
          code: snapshot.stationCode,
          name: snapshot.stationName || target.temperatureStationName,
        };

        const data: AreaTimeseriesData = {
          station,
          timeDefines,
          values,
        };

        return {
          ...context,
          area: {
            code: snapshot.areaCode,
            name: snapshot.areaName || target.forecastAreaName,
          },
          metadata: {
            source: snapshot.metadata.source,
            issuedAt: snapshot.metadata.issuedAt,
            validAt: snapshot.metadata.validAt,
            validFrom: snapshot.metadata.validFrom,
            validTo: snapshot.metadata.validTo,
            fetchedAt: snapshot.metadata.fetchedAt,
            lastSuccessAt: snapshot.metadata.lastSuccessAt,
            availability,
            sourceVersion: snapshot.metadata.sourceVersion,
          },
          data,
          capabilities,
        };
      });

      return tx();
    },

    getAmedas(terminal: TerminalDefinition, controlStatus: WeatherControlStatus): AmedasResponse {
      const nowIso = getNow();
      const target = resolveAmedasTarget(terminal.venueId);

      const context: WeatherContext = {
        terminalId: terminal.id,
        venueId: terminal.venueId,
        controlStatus,
        isTraining: controlStatus === 'training',
        evaluatedAt: nowIso,
      };

      const unsupportedElements = resolveUnsupportedAmedasElements(target.elements);
      const capabilities: AmedasCapabilities = {
        publicElements: AMEDAS_PUBLIC_ELEMENTS,
        unsupportedElements,
      };

      // 案B: normal 以外（training / test）は DB を読まず常に unavailable
      if (controlStatus !== 'normal') {
        return {
          ...context,
          station: {
            code: target.stationCode,
            name: target.displayName,
          },
          metadata: buildUnavailableMetadata(),
          data: null,
          capabilities,
        };
      }

      const tx = connection.transaction(() => {
        const snapshot = findAmedasSnapshot(connection, target.stationCode);

        if (!snapshot) {
          return {
            ...context,
            station: {
              code: target.stationCode,
              name: target.displayName,
            },
            metadata: buildUnavailableMetadata(),
            data: null,
            capabilities,
          };
        }

        const obsMap = new Map<
          string,
          {
            temp?: number | null;
            humidity?: number | null;
            windDirection?: number | null;
            wind?: number | null;
            precipitation1h?: number | null;
          }
        >();

        for (const obs of snapshot.observations) {
          let entry = obsMap.get(obs.observedAt);
          if (!entry) {
            entry = {};
            obsMap.set(obs.observedAt, entry);
          }
          if (obs.element === 'temp') {
            entry.temp = obs.valueNumber;
          } else if (obs.element === 'humidity') {
            entry.humidity = obs.valueNumber;
          } else if (obs.element === 'windDirection') {
            entry.windDirection = obs.valueNumber;
          } else if (obs.element === 'wind') {
            entry.wind = obs.valueNumber;
          } else if (obs.element === 'precipitation1h') {
            entry.precipitation1h = obs.valueNumber;
          }
        }

        const observations: AmedasObservationDto[] = [];
        for (const [observedAt, values] of obsMap.entries()) {
          observations.push({
            observedAt,
            values,
          });
        }

        const lastObs = observations[observations.length - 1];
        const latestObservedAt = lastObs ? lastObs.observedAt : null;

        const data: AmedasData = {
          latestObservedAt,
          observations,
        };

        const station: WeatherStation = {
          code: snapshot.stationCode,
          name: snapshot.stationName || target.displayName,
        };

        return {
          ...context,
          station,
          metadata: {
            source: snapshot.metadata.source,
            issuedAt: snapshot.metadata.issuedAt,
            validAt: snapshot.metadata.validAt,
            validFrom: snapshot.metadata.validFrom,
            validTo: snapshot.metadata.validTo,
            fetchedAt: snapshot.metadata.fetchedAt,
            lastSuccessAt: snapshot.metadata.lastSuccessAt,
            availability: snapshot.metadata.availability,
            sourceVersion: snapshot.metadata.sourceVersion,
          },
          data,
          capabilities,
        };
      });

      return tx();
    },

    getBulletins(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): BulletinsResponse {
      const nowIso = getNow();
      const pollingStatus = deps.getPollingStatus?.();
      const feedFreshness = pollingStatus?.feedFreshness
        ? {
            regular: pollingStatus.feedFreshness.regular.availability,
            extra: pollingStatus.feedFreshness.extra.availability,
          }
        : null;

      const venueTargets = resolveVenueForecastTargets(terminal.venueId);
      const includedAreaCodes = venueTargets.bosaiBulletin.includedAreaCodes;
      const municipalCode = venueTargets.warning.municipalCode;

      const context: WeatherContext = {
        terminalId: terminal.id,
        venueId: terminal.venueId,
        controlStatus,
        isTraining: controlStatus === 'training',
        evaluatedAt: nowIso,
      };

      const defaultArea: WeatherArea = {
        code: municipalCode,
        name: venueTargets.warning.displayName,
      };

      const capabilities: BulletinsCapabilities = {
        telegramTypes: ['VPBS50', 'VPHW50', 'VPHW51'],
        sightingUndeterminableTypes: ['VPHW50', 'VPBS50'],
        unsupportedFields: ['editorialOffice', 'publishingOffice'],
        deduplicated: false,
      };

      const tx = connection.transaction(() => {
        const rows = listBosaiBulletins(connection, {
          controlStatus,
          includedAreaCodes,
        });

        const bulletins: BulletinDto[] = rows.map((b) => {
          let telegramType: BulletinTelegramType | null = null;
          if (b.metadata.source) {
            const extracted = extractTelegramTypeFromUrl(b.metadata.source);
            if (extracted === 'VPBS50' || extracted === 'VPHW50' || extracted === 'VPHW51') {
              telegramType = extracted;
            }
          }
          if (telegramType === null) {
            if (b.eventId.startsWith('VPHW50:')) {
              telegramType = 'VPHW50';
            } else if (b.eventId.startsWith('VPHW51:')) {
              telegramType = 'VPHW51';
            }
          }

          const isDirect = b.areas.some((a) => a.areaCode === municipalCode);

          const matchedAreaCodes: string[] = [];
          const matchedSet = new Set<string>();
          for (const a of b.areas) {
            if (
              (includedAreaCodes as readonly string[]).includes(a.areaCode) &&
              !matchedSet.has(a.areaCode)
            ) {
              matchedSet.add(a.areaCode);
              matchedAreaCodes.push(a.areaCode);
            }
          }

          const areas: BulletinAreaDto[] = b.areas.map((a) => ({
            areaCode: a.areaCode,
            areaName: a.areaName,
            codeType: a.codeType,
            sequence: a.sequence,
            informationType: a.informationType,
          }));

          return {
            eventId: b.eventId,
            telegramType,
            infoType: b.infoType,
            isCancelled: b.isCancelled,
            reportDateTime: b.reportDateTime,
            controlDateTime: b.controlDateTime,
            title: b.title,
            headlineText: b.headlineText,
            informationTag: b.informationTag,
            hasSighting: b.hasSighting,
            areas,
            isDirect,
            matchedAreaCodes,
            metadata: {
              source: b.metadata.source,
              issuedAt: b.metadata.issuedAt,
              validAt: b.metadata.validAt,
              validFrom: b.metadata.validFrom,
              validTo: b.metadata.validTo,
              fetchedAt: b.metadata.fetchedAt,
              lastSuccessAt: b.metadata.lastSuccessAt,
              availability: b.metadata.availability,
              sourceVersion: b.metadata.sourceVersion,
            },
          };
        });

        const hasStaleRow = rows.some((r) => r.metadata.availability !== 'available');
        const savedAvailability = hasStaleRow ? 'stale' : 'available';

        let hasParseFailure = false;
        const targetTelegramTypes: readonly BulletinTelegramType[] = [
          'VPBS50',
          'VPHW50',
          'VPHW51',
        ] as const;

        for (const tType of targetTelegramTypes) {
          const matchingBulletins = bulletins.filter((b) => b.telegramType === tType);
          const firstBulletin = matchingBulletins[0];
          if (!firstBulletin) {
            continue;
          }

          let maxReport = firstBulletin.reportDateTime;
          let maxControl = firstBulletin.controlDateTime;
          for (const mb of matchingBulletins) {
            if (
              mb.reportDateTime > maxReport ||
              (mb.reportDateTime === maxReport && mb.controlDateTime > maxControl)
            ) {
              maxReport = mb.reportDateTime;
              maxControl = mb.controlDateTime;
            }
          }
          const baseline = { reportDateTime: maxReport, controlDateTime: maxControl };

          for (const areaCode of includedAreaCodes) {
            if (
              hasNewerWeatherParseFailure(connection, {
                venueId: terminal.venueId,
                controlStatus,
                telegramType: tType,
                areaCode,
                baseline,
              })
            ) {
              hasParseFailure = true;
              break;
            }
          }
          if (hasParseFailure) break;
        }

        const availability = evaluateWeatherAvailability({
          hasSnapshot: true,
          savedAvailability,
          feedFreshness,
          nowIso,
          hasParseFailure,
        });

        return {
          ...context,
          area: defaultArea,
          availability,
          bulletins,
          capabilities,
        };
      });

      return tx();
    },
  };
}
