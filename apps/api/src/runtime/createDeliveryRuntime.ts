import { createTerminalRegistry, createVenueRegistry } from '@wx-viewer-poc/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseConnection } from '../database/connection.js';
import { createWeatherApiService } from '../services/weatherApiService.js';
import { createNowcastApiService } from '../services/nowcastApiService.js';
import { createKikikuruApiService } from '../services/kikikuruApiService.js';
import { createStaticTileDeliveryProfileService } from '../services/tileDeliveryProfileService.js';
import { createImageServices, buildStoppedPollingStatus } from '../polling/index.js';
import { createWeatherReceptionService } from '../monitoring/monitoringHistoryService.js';
import { createMonitoringProcessingService } from '../monitoring/monitoringProcessingService.js';
import { createMonitoringStatusService } from '../monitoring/monitoringStatusService.js';
import { InMemoryStartupProgressTracker } from '../monitoring/startupProgressTracker.js';
import { InMemoryWarningCurrentRecoveryTracker } from '../monitoring/warningCurrentRecoveryTracker.js';
import { StartupNotificationInitialization } from '../notifications/startupNotificationService.js';
import { projectStartupCurrentNotifications } from '../notifications/startupCurrentNotificationProjector.js';
import { resolveOnDemandAccess } from '../config/pollingSchedule.js';
import {
  projectUpstreamAccess,
  ImageServicesInitializingError,
} from '../services/tileApiSupport.js';
import { weatherReadScope, weatherScopeBlocks, type WeatherScopeKind } from './weatherReadScope.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
import type { WeatherEpoch, WeatherOperations } from './weatherContracts.js';
import type { DeliveryReadContext, DeliverySettings } from './deliveryContracts.js';

/** 気象 reader と保存済みデータの投影だけを提供 Worker に閉じ込める。 */
export function createDeliveryRuntime(
  connection: DatabaseConnection,
  settings: DeliverySettings,
  epoch: WeatherEpoch,
) {
  const venue = createVenueRegistry(settings.venues, settings.venueGeneration);
  const terminal = createTerminalRegistry(settings.terminals, settings.terminalGeneration);
  const requestContext = new AsyncLocalStorage<DeliveryReadContext>();
  const currentContext = () =>
    requestContext.getStore() ?? { report: null, unknownScopes: [], validatedScopes: [] };
  const now = () => requestContext.getStore()?.now ?? new Date().toISOString();
  const initialization = new StartupNotificationInitialization();
  const emptyProgress = new InMemoryStartupProgressTracker(now, venue);
  const emptyRecovery = new InMemoryWarningCurrentRecoveryTracker(venue);
  const isScopeReadable = (
    venueId: Parameters<typeof weatherReadScope>[0],
    status: Parameters<typeof weatherReadScope>[1],
    kind: WeatherScopeKind,
  ) =>
    !weatherScopeBlocks(currentContext().unknownScopes, venueId, status, kind) &&
    (kind === 'nowcast' ||
      kind === 'kikikuru' ||
      currentContext().validatedScopes.includes(weatherReadScope(venueId, status, kind)));
  const weatherApi = createWeatherApiService({
    connection,
    venueRegistry: venue,
    getPollingStatus: () => currentContext().report?.polling ?? undefined,
    isScopeReadable,
    now,
  });
  const images = createImageServices({
    connection,
    schedule: settings.schedule,
    enablePolling: settings.enablePolling,
    readOnly: true,
    nowcastCacheRoot: settings.nowcastCacheRoot,
    kikikuruCacheRoot: settings.kikikuruCacheRoot,
  });
  const profile = createStaticTileDeliveryProfileService(settings.schedule.tileDeliveryProfile);
  const nowcastApi = createNowcastApiService({
    venueRegistry: venue,
    getService: () => images.nowcast,
    enablePolling: settings.enablePolling,
    tileDeliveryProfileService: profile,
    clock: now,
  });
  const kikikuruApi = createKikikuruApiService({
    venueRegistry: venue,
    getService: () => images.kikikuru,
    enablePolling: settings.enablePolling,
    tileDeliveryProfileService: profile,
    clock: now,
  });
  const receptions = createWeatherReceptionService({ weatherConnection: connection, now });
  const processing = createMonitoringProcessingService({
    connection,
    venueRegistry: venue,
    serverGenerationId: epoch.serverGenerationId,
    now,
  });
  const monitoring = createMonitoringStatusService({
    connection,
    venueRegistry: venue,
    terminalRegistry: terminal,
    scheduler: {
      getStatus: () =>
        currentContext().report?.scheduler ??
        buildStoppedPollingStatus(new Date(now()), settings.schedule),
      isRunningNow: () => currentContext().report?.running ?? false,
    },
    xmlPollingService: {
      getStatus: () => ({
        initialFetch: currentContext().report?.polling?.initialFetch ?? {
          phase: 'not_started',
          result: null,
        },
      }),
    },
    fetchHealthMonitor: { getLastAggregate: () => currentContext().report?.health ?? null },
    startupInitialization: initialization,
    progressTracker: {
      getVenueReprocessingStatus: (id) =>
        currentContext().report?.venues.find((value) => value.venueId === id)?.reprocessing ??
        emptyProgress.getVenueReprocessingStatus(id),
    },
    recoveryTracker: {
      getStatus: (id, at) =>
        currentContext().report?.venues.find((value) => value.venueId === id)?.recovery ??
        emptyRecovery.getStatus(id, at),
    },
    weatherApi,
    nowcastApi,
    kikikuruApi,
    getTileUpstreamAccess: (layer) =>
      projectUpstreamAccess(
        resolveOnDemandAccess(layer, new Date(now()), settings.schedule),
        settings.enablePolling,
      ),
    fetchHealthConfig: settings.schedule.fetchHealth,
    serverGenerationId: epoch.serverGenerationId,
    serverStartedAt: settings.serverStartedAt,
    now,
  });
  const methods = {
    warnings: 'getWarnings',
    'warning-timeseries': 'getWarningTimeseries',
    'early-warning': 'getEarlyWarning',
    'area-timeseries': 'getAreaTimeseries',
    amedas: 'getAmedas',
    bulletins: 'getBulletins',
  } as const;
  function updateContext(next: DeliveryReadContext) {
    if (next.report?.initialization)
      initialization.replaceStatus({
        ...next.report.initialization,
        evaluatedVenueIds: new Set(next.report.initialization.evaluatedVenueIds),
      });
  }
  async function read<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    nextContext: DeliveryReadContext,
  ): Promise<WeatherOperations[K]['response']> {
    updateContext(nextContext);
    return requestContext.run(nextContext, () => execute(kind, payload));
  }
  async function execute<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
  ): Promise<WeatherOperations[K]['response']> {
    const p = payload as never;
    try {
      switch (kind) {
        case 'weather.read': {
          const input = payload as WeatherOperations['weather.read']['request'];
          return weatherApi[methods[input.kind]](input.terminal, input.controlStatus) as never;
        }
        case 'image.times': {
          const input = payload as WeatherOperations['image.times']['request'];
          return (input.layer === 'nowcast' ? nowcastApi : kikikuruApi).getTimes(
            input.terminal,
            input.controlStatus,
          ) as never;
        }
        case 'tile.read': {
          const input = payload as WeatherOperations['tile.read']['request'];
          const result =
            input.layer === 'nowcast'
              ? await nowcastApi.readTile?.(input.frame, input.coordinate)
              : await kikikuruApi.readTile?.(input.frame, input.coordinate);
          if (!result || result.kind !== 'success') return { kind: 'miss' } as never;
          return {
            kind: 'hit',
            bytes: new Uint8Array(result.buffer),
            contentType: 'image/png',
            storedAt: result.storedAt,
            catalogAvailability: result.catalogAvailability,
          } as never;
        }
        case 'history.receptions':
          return receptions.listReceptions(p) as never;
        case 'history.reception': {
          const input = payload as WeatherOperations['history.reception']['request'];
          if (input.expectedDatabaseGenerationId !== epoch.weatherDatabaseGenerationId)
            throw new WeatherRequestError('generation_changed');
          return receptions.getReceptionById(input.receptionId) as never;
        }
        case 'history.references': {
          const input = payload as WeatherOperations['history.references']['request'];
          if (input.length > 200) throw new WeatherRequestError('invalid_request');
          return input.map((item) => {
            if (item.weatherDatabaseGenerationId === null)
              return { status: 'unavailable', reason: 'generation_unknown' };
            if (item.weatherDatabaseGenerationId !== epoch.weatherDatabaseGenerationId)
              return { status: 'unavailable', reason: 'weather_generation_changed' };
            const detail = receptions.getReceptionById(item.receptionId);
            if (!detail) return { status: 'unavailable', reason: 'reception_missing' };
            if (!detail.reception.rawBody)
              return { status: 'unavailable', reason: 'raw_body_missing' };
            return { status: 'available', receptionId: item.receptionId };
          }) as never;
        }
        case 'monitoring.processing':
          return processing.getProcessing(p) as never;
        case 'monitoring.sample': {
          const input = payload as WeatherOperations['monitoring.sample']['request'];
          return monitoring.getStatus(input.terminal) as never;
        }
        case 'startup.project': {
          const input = payload as WeatherOperations['startup.project']['request'];
          if (
            input.publicationToken.deliveryEpoch.workerGeneration !== epoch.workerGeneration ||
            input.publicationToken.deliveryEpoch.readerEpoch !== epoch.readerEpoch
          )
            throw new WeatherRequestError('generation_changed');
          const projection = connection.transaction(() =>
            projectStartupCurrentNotifications(connection, {
              venueRegistry: venue,
              venueId: input.venueId,
              now: input.inquiredAt,
              includeWarningCategory: true,
            }),
          )();
          return {
            ...projection,
            publicationToken: input.publicationToken,
            weatherDatabaseGenerationId: epoch.weatherDatabaseGenerationId!,
          } as never;
        }
        default:
          throw new WeatherRequestError('invalid_request');
      }
    } catch (error) {
      if (error instanceof ImageServicesInitializingError)
        throw new WeatherRequestError('not_ready');
      throw error;
    }
  }
  return {
    read,
    close: async () => {
      await images.close();
    },
  };
}
