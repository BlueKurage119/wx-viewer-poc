import type {
  EarlyWarningCell,
  EarlyWarningData,
  EarlyWarningResponse,
  EarlyWarningTimeDefine,
  TerminalDefinition,
  TimeseriesAddition,
  WarningCurrentData,
  WarningCurrentItem,
  WarningsResponse,
  WarningTimeseriesData,
  WarningTimeseriesResponse,
  WarningTimeseriesTimeDefine,
  WarningTimeseriesValue,
  WeatherArea,
  WeatherContext,
  WeatherControlStatus,
  WeatherDataset,
  WeatherMetadata,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { JmaXmlPollingStatus } from '../polling/jmaXmlPollingService.js';
import { findEarlyWarningSnapshot } from '../repositories/earlyWarningRepository.js';
import { findWarningCurrentSnapshot } from '../repositories/warningCurrentRepository.js';
import { findWarningCurrentStream } from '../repositories/warningCurrentStreamRepository.js';
import { findWarningTimeseriesSnapshot } from '../repositories/warningTimeseriesRepository.js';
import { hasNewerWeatherParseFailure } from '../repositories/weatherParseFailureRepository.js';
import { WARNING_TELEGRAM_TYPES, type WarningTelegramType } from '../repositories/types.js';
import {
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
  };
}
