import { weatherScopeBlocks, type WeatherScopeKind } from './weatherReadScope.js';
import { InMemoryStartupProgressTracker } from '../monitoring/startupProgressTracker.js';
import { InMemoryWarningCurrentRecoveryTracker } from '../monitoring/warningCurrentRecoveryTracker.js';
import { logPollingConfig } from '../server.js';
import {
  createWeatherWorkerControlService,
  WeatherWorkerRestartError,
} from '../services/weatherWorkerControlService.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  projectWeatherRuntimeStatus,
  resolveNotificationMessage,
  toNotificationDeltaCursor,
  type SystemNotification,
  type MonitoringStatusResponse,
} from '@wx-viewer-poc/shared';
import { createApp, type AppDependencies } from '../app.js';
import {
  loadVenueConfig,
  loadTerminalConfig,
  loadPollingScheduleConfigWithSources,
  validatePollingScheduleConfig,
} from '../config/index.js';
import { resolvePollingPeriod, resolveOnDemandAccess } from '../config/pollingSchedule.js';
import { resolveDatabasePairConfig, validateDatabasePairPaths } from '../database/pairConfig.js';
import { initializeRoleDatabase, openWeatherReader } from '../database/roleDatabase.js';
import type { DatabaseConnection } from '../database/connection.js';
import { createApplicationRuntime } from './createApplicationRuntime.js';
import { AcquisitionWorkerHost } from './acquisitionWorkerHost.js';
import { createWeatherApiService } from '../services/weatherApiService.js';
import { createNowcastApiService } from '../services/nowcastApiService.js';
import { createKikikuruApiService } from '../services/kikikuruApiService.js';
import { createStaticTileDeliveryProfileService } from '../services/tileDeliveryProfileService.js';
import { createImageServices, buildStoppedPollingStatus } from '../polling/index.js';
import { createMonitoringStatusService } from '../monitoring/monitoringStatusService.js';
import { createMonitoringProcessingService } from '../monitoring/monitoringProcessingService.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
  createNotificationDeltaService,
} from '../notifications/index.js';
import { projectStartupCurrentNotifications } from '../notifications/startupCurrentNotificationProjector.js';
import { findMaxNotificationOutputSequence } from '../repositories/notificationOutputHistoryRepository.js';
import { RetainedNotificationSink } from './retainedNotificationSink.js';
import { toNotificationOutputHistoryInput } from '../notifications/notificationOutputHistoryMapper.js';
import { WeatherPublicationGate } from './weatherPublication.js';
import { WeatherRequestRegistry, WeatherRequestError } from './weatherRequestRegistry.js';
import {
  projectUpstreamAccess,
  ImageServicesInitializingError,
} from '../services/tileApiSupport.js';
import { createFetchControlService } from '../services/fetchControlService.js';
import { registerGracefulShutdown } from '../gracefulShutdown.js';
import { unavailableMonitoring } from './unavailableMonitoring.js';
import { createRetainedMonitoringHistory } from './retainedMonitoringHistory.js';
import type { StartServerOptions } from '../server.js';
import type { WeatherEpoch } from './weatherContracts.js';

export async function startWorkerServer(options: StartServerOptions = {}) {
  const port = options.port ?? 3001;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new RangeError('ポートは0以上65535以下の整数で指定してください。');
  const venue = loadVenueConfig({ baseUrl: options.venueConfigUrl });
  const terminal = loadTerminalConfig({
    baseUrl: options.terminalConfigUrl,
    localUrl: options.terminalLocalConfigUrl,
    venueRegistry: venue.registry,
    venueGeneration: venue.response.generation,
  });
  const loaded = options.pollingSchedule
    ? null
    : loadPollingScheduleConfigWithSources(options.configUrl);
  const schedule = validatePollingScheduleConfig(options.pollingSchedule ?? loaded?.config);
  logPollingConfig(loaded);
  const config = validateDatabasePairPaths(
    options.config ?? resolveDatabasePairConfig(process.env, true),
  );
  const serverGenerationId = randomUUID();
  const serverStartedAt = new Date().toISOString();
  const now = options.pollingServiceOptions?.clock ?? (() => new Date().toISOString());
  const enablePolling = options.enablePolling ?? process.env.DISABLE_POLLING !== 'true';
  const retained = initializeRoleDatabase(config, {
    pid: process.pid,
    role: 'retained',
    token: randomUUID(),
    startedAt: serverStartedAt,
    serverGenerationId,
    workerGeneration: null,
    threadId: null,
  });
  let bootHost: AcquisitionWorkerHost | undefined;
  try {
    const sink = new RetainedNotificationSink(retained.connection);
    const serverStartCursor = toNotificationDeltaCursor(
      findMaxNotificationOutputSequence(retained.connection),
    );
    let reader: DatabaseConnection | null = null;
    let application: ReturnType<typeof createApplicationRuntime> | null = null;
    let drainingApplication: ReturnType<typeof createApplicationRuntime> | null = null;
    let publication: WeatherPublicationGate | null = null;
    let deliveryEpoch: WeatherEpoch | null = null;
    let readerImages: ReturnType<typeof createImageServices> | null = null;
    let closed = false;
    const initialization = new StartupNotificationInitialization();
    const emptyProgress = new InMemoryStartupProgressTracker(now, venue.registry);
    const emptyRecovery = new InMemoryWarningCurrentRecoveryTracker(venue.registry);
    const requireApplication = () => {
      if (closed || !application) throw new WeatherRequestError('not_ready');
      return application.dependencies;
    };
    const settings = {
      venues: venue.registry.listVenues(),
      venueGeneration: venue.registry.generation,
      schedule,
      enablePolling,
      desiredRunning: enablePolling,
      serverStartedAt,
      nowcastCacheRoot: options.nowcastCacheRoot ?? resolve(process.cwd(), 'data/cache/nowcast'),
      kikikuruCacheRoot: options.kikikuruCacheRoot ?? resolve(process.cwd(), 'data/cache/kikikuru'),
    };
    const host = new AcquisitionWorkerHost({
      workerEntry: options.acquisitionWorkerEntry,
      onWorkerCreated: options.onAcquisitionWorkerCreated,
      pair: config,
      settings,
      serverGenerationId,
      retainedConnection: retained.connection,
      onReport() {
        const state = host.report?.initialization;
        if (!state) return;
        initialization.replaceStatus({
          ...state,
          evaluatedVenueIds: new Set(state.evaluatedVenueIds),
        });
      },
      onFailure(code, generation) {
        const notification: SystemNotification = {
          notificationId: `weather-worker:${generation}:${code}`,
          origin: 'system',
          category: 'question',
          sourceType: 'weather_worker',
          sourceVersion: generation,
          changeType: code,
          targets: [
            {
              kind: 'equipment',
              codeType: 'wx-viewer-poc/service',
              code: 'weather',
              name: '気象取得Worker',
            },
          ],
          occurredAt: now(),
          detectedAt: now(),
          relatedRefs: [{ type: 'worker_generation', ref: generation }],
          detectionContext: 'normal',
          isTraining: false,
        };
        try {
          sink.record([
            toNotificationOutputHistoryInput(
              notification,
              resolveNotificationMessage(notification, {
                definitionId:
                  code === 'initialization_failed'
                    ? 'system-weather-acquisition-initialization-failed'
                    : code === 'unexpected_exit'
                      ? 'system-weather-acquisition-exited'
                      : code === 'report_stale'
                        ? 'system-weather-acquisition-report-stale'
                        : 'system-weather-acquisition-control-failed',
              }),
              null,
            ),
          ]);
        } catch {
          console.error('取得Worker異常通知の保存に失敗しました。');
        }
      },
      async closeReader() {
        initialization.replaceStatus({
          initialFetchPhase: 'not_started',
          evaluatedVenueIds: new Set(),
          preparationFailures: [],
        });
        const previous = drainingApplication ?? application;
        previous?.close();
        drainingApplication = previous;
        application = null;
        if (previous) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              previous.drain(),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('reader_close_unconfirmed')), 10000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        if (publication && deliveryEpoch)
          publication.replaceEpochs(
            { ...host.epoch, workerGeneration: randomUUID() },
            deliveryEpoch,
          );
        await readerImages?.close();
        readerImages = null;
        if (reader?.open) reader.close();
        reader = null;
        deliveryEpoch = null;
        publication = null;
        drainingApplication = null;
      },
      async databaseReady(generation, schemaVersion, acquisitionEpoch) {
        if (closed) throw new Error('not_ready');
        reader = openWeatherReader(config.weather, generation, schemaVersion);
        deliveryEpoch = {
          ...acquisitionEpoch,
          workerGeneration: randomUUID(),
          readerEpoch: randomUUID(),
        };
        publication = new WeatherPublicationGate(acquisitionEpoch, deliveryEpoch);
        const connection = reader;
        const weatherApi = createWeatherApiService({
          connection,
          venueRegistry: venue.registry,
          getPollingStatus: () => host.report?.polling ?? undefined,
          isScopeReadable: (venueId, status, kind) =>
            !weatherScopeBlocks(host.status().unknownScopes ?? [], venueId, status, kind),
          now,
        });
        readerImages = createImageServices({
          connection,
          schedule,
          enablePolling,
          readOnly: true,
          nowcastCacheRoot: settings.nowcastCacheRoot,
          kikikuruCacheRoot: settings.kikikuruCacheRoot,
        });
        const tileDeliveryProfileService = createStaticTileDeliveryProfileService(
          schedule.tileDeliveryProfile,
        );
        const nowcastApi = createNowcastApiService({
          venueRegistry: venue.registry,
          getService: () => readerImages?.nowcast ?? null,
          enablePolling,
          tileDeliveryProfileService,
          clock: now,
        });
        const kikikuruApi = createKikikuruApiService({
          venueRegistry: venue.registry,
          getService: () => readerImages?.kikikuru ?? null,
          enablePolling,
          tileDeliveryProfileService,
          clock: now,
        });
        const monitoringStatus = createMonitoringStatusService({
          connection,
          venueRegistry: venue.registry,
          terminalRegistry: terminal.registry,
          scheduler: {
            getStatus: () =>
              host.report?.scheduler ?? buildStoppedPollingStatus(new Date(now()), schedule),
            isRunningNow: () => host.report?.running ?? false,
          },
          xmlPollingService: {
            getStatus: () => ({
              initialFetch: host.report?.polling?.initialFetch ?? {
                phase: 'not_started',
                result: null,
              },
            }),
          },
          fetchHealthMonitor: { getLastAggregate: () => host.report?.health ?? null },
          startupInitialization: initialization,
          progressTracker: {
            getVenueReprocessingStatus: (id) =>
              host.report?.venues.find((value) => value.venueId === id)?.reprocessing ??
              emptyProgress.getVenueReprocessingStatus(id),
          },
          recoveryTracker: {
            getStatus: (id, at) =>
              host.report?.venues.find((value) => value.venueId === id)?.recovery ??
              emptyRecovery.getStatus(id, at),
          },
          weatherApi,
          nowcastApi,
          kikikuruApi,
          getTileUpstreamAccess: (layer) =>
            projectUpstreamAccess(
              resolveOnDemandAccess(layer, new Date(now()), schedule),
              enablePolling,
            ),
          fetchHealthConfig: schedule.fetchHealth,
          serverGenerationId,
          serverStartedAt,
          now,
        });
        application = createApplicationRuntime({
          observeRequest: options.weatherRequestObserver,
          weatherApi,
          nowcastApi,
          kikikuruApi,
          monitoringStatus,
          monitoringProcessing: createMonitoringProcessingService({
            connection,
            venueRegistry: venue.registry,
            serverGenerationId,
            now,
          }),
          retainedConnection: retained.connection,
          weatherConnection: reader,
          deliveryEpoch,
          deliveryRegistry: new WeatherRequestRegistry(deliveryEpoch),
          acquisitionEpoch,
          serverGenerationId,
          weatherDatabaseGenerationId: generation,
          terminalRegistry: terminal.registry,
          now,
          acquisitionPort: {
            async request(input) {
              if (input.kind !== 'tile.ensure') throw new WeatherRequestError('invalid_request');
              const value = await host.call('tile.ensure', input.payload, 30000);
              return {
                protocolVersion: 1,
                requestId: input.requestId,
                epoch: input.epoch,
                result: { status: 'completed', value },
              } as never;
            },
          },
        });
      },
    });
    bootHost = host;
    const runtimes = (): MonitoringStatusResponse['weatherRuntimes'] => ({
      acquisition: host.status(),
      delivery: projectWeatherRuntimeStatus(
        {
          role: 'delivery',
          mode: 'inline',
          workerGeneration: deliveryEpoch?.workerGeneration ?? null,
          lifecycle: reader ? 'ready' : 'starting',
          reportedAt: reader ? now() : null,
          receivedAt: reader ? now() : null,
          stopReason: null,
          exitConfirmed: false,
          failureCode: null,
          pendingRequests: 0,
        },
        now(),
      ),
    });
    const fetchControlService = createFetchControlService({
      connection: retained.connection,
      now,
      targets: enablePolling
        ? {
            start: (id) => host.execute('start', id ?? randomUUID()),
            stop: (id) => host.execute('stop', id ?? randomUUID()),
            forceRefresh: (id) => host.execute('force_refresh', id ?? randomUUID()),
            runRecovery: (id) => host.execute('recovery', id ?? randomUUID()),
            isRunning: () => host.report?.running ?? false,
            isUpstreamAllowedNow: () =>
              resolvePollingPeriod(new Date(now()), schedule).xmlSeconds !== null,
          }
        : null,
    });
    const inquire = async (
      input: Parameters<ReturnType<typeof createStartupNotificationService>['inquire']>[0],
      signal?: AbortSignal,
    ) => {
      if (closed) throw new WeatherRequestError('not_ready');
      const service = createStartupNotificationService({
        weatherConnection: reader ?? retained.connection,
        retainedConnection: retained.connection,
        weatherDatabaseGenerationId: host.epoch.weatherDatabaseGenerationId ?? '',
        venueRegistry: venue.registry,
        terminalRegistry: terminal.registry,
        initialization,
        serverGenerationId,
        now,
        getFetchHealth: () => host.report?.health ?? null,
      });
      if (!initialization.isReady(input.venueId) || input.serverGenerationId !== serverGenerationId)
        return service.inquire(input);
      if (
        weatherScopeBlocks(host.decisions.pendingUnit?.scopes ?? [], input.venueId) ||
        weatherScopeBlocks(host.status().unknownScopes ?? [], input.venueId)
      )
        return {
          status: 'initializing' as const,
          terminalId: input.terminalId,
          venueId: input.venueId,
          serverGenerationId,
          weatherState: 'initializing' as const,
        };
      if (!publication || !reader || !application) throw new WeatherRequestError('not_ready');
      const gate = publication;
      const connection = reader;
      const epoch = deliveryEpoch;
      const releaseAdmission = application.registry.reserveStartup();
      try {
        return await gate.publish(async (token) => {
          const running = !host.status().exitConfirmed;
          try {
            if (running)
              await host.call('publication.pause', { token: token.id, expiresAt: token.expiresAt });
            gate.assertValid(token);
            if (host.decisions.pendingUnit || deliveryEpoch !== epoch)
              throw new WeatherRequestError('generation_changed');
            const cursor = findMaxNotificationOutputSequence(retained.connection);
            options.weatherRequestObserver?.({
              protocolVersion: 1,
              requestId: randomUUID(),
              epoch: epoch!,
              deadlineAt: token.expiresAt,
              kind: 'startup.project',
              payload: {
                publicationToken: token,
                venueId: input.venueId,
                inquiredAt: input.inquiredAt,
              },
            });
            const projection = connection.transaction(() =>
              projectStartupCurrentNotifications(connection, {
                venueRegistry: venue.registry,
                venueId: input.venueId,
                now: input.inquiredAt,
                includeWarningCategory: true,
              }),
            )();
            gate.assertValid(token);
            return service.inquire(input, {
              projection,
              cursor,
            });
          } finally {
            if (running) void host.call('publication.release', { token: token.id }).catch(() => {});
          }
        }, signal);
      } finally {
        releaseAdmission();
      }
    };
    const retainedHistory = createRetainedMonitoringHistory(
      retained.connection,
      async (kind, payload) => {
        const app = application;
        if (!app) throw new WeatherRequestError('database_unavailable');
        const reply = await app.readPort.request({
          protocolVersion: 1,
          requestId: randomUUID(),
          epoch: app.epoch,
          deadlineAt: new Date(Date.now() + 5000).toISOString(),
          kind,
          payload,
        });
        if (reply.result.status !== 'completed') throw new WeatherRequestError(reply.result.code);
        return reply.result.value;
      },
      now,
    );
    const workerControl = createWeatherWorkerControlService({
      connection: retained.connection,
      serverGenerationId,
      now,
      getRuntimeStatus: () => host.status(),
      getDesiredRunning: () => host.desiredRunning,
      restart: async () => {
        try {
          await host.restart();
        } catch (error) {
          const code = error instanceof Error ? error.message : 'restart_failed';
          throw new WeatherWorkerRestartError(
            ['exit_unconfirmed', 'initial_accept_timeout'].includes(code) ? 'unknown' : 'failure',
            code,
          );
        }
      },
    });
    const dependencies: AppDependencies = {
      weatherWorkerControl: workerControl,
      venueConfig: venue.response,
      venueRegistry: venue.registry,
      terminalConfig: terminal.response,
      terminalRegistry: terminal.registry,
      fetchControl: fetchControlService,
      notificationDelta: createNotificationDeltaService({
        connection: retained.connection,
        serverStartCursor,
        initialization,
        venueRegistry: venue.registry,
        serverGenerationId,
        now,
      }),
      startupNotifications: { inquire: (input) => inquire(input), inquireWithSignal: inquire },
      weatherApi: {
        getWarnings: (...args) => requireApplication().weatherApi!.getWarnings(...args),
        getWarningTimeseries: (...args) =>
          requireApplication().weatherApi!.getWarningTimeseries(...args),
        getEarlyWarning: (...args) => requireApplication().weatherApi!.getEarlyWarning(...args),
        getAreaTimeseries: (...args) => requireApplication().weatherApi!.getAreaTimeseries(...args),
        getAmedas: (...args) => requireApplication().weatherApi!.getAmedas(...args),
        getBulletins: (...args) => requireApplication().weatherApi!.getBulletins(...args),
      },
      nowcastApi: {
        getTimes: (...args) => {
          if (!application) throw new ImageServicesInitializingError();
          return requireApplication().nowcastApi!.getTimes(...args);
        },
        getTile: (...args) => {
          if (!application) throw new ImageServicesInitializingError();
          return requireApplication().nowcastApi!.getTile(...args);
        },
      },
      kikikuruApi: {
        getTimes: (...args) => {
          if (!application) throw new ImageServicesInitializingError();
          return requireApplication().kikikuruApi!.getTimes(...args);
        },
        getTile: (...args) => {
          if (!application) throw new ImageServicesInitializingError();
          return requireApplication().kikikuruApi!.getTile(...args);
        },
      },
      monitoringProcessing: {
        getProcessing: (...args) =>
          requireApplication().monitoringProcessing!.getProcessing(...args),
      },
      monitoringStatus: {
        getStatus: (t) => {
          if (!application)
            return unavailableMonitoring({
              terminal: t,
              registry: venue.registry,
              schedule,
              generation: serverGenerationId,
              startedAt: serverStartedAt,
              runtimes: runtimes(),
              now: now(),
            });
          const status = application.dependencies.monitoringStatus!.getStatus(t);
          const unknown = host.status().unknownScopes ?? [];
          const kinds: Record<string, WeatherScopeKind> = {
            warning: 'warnings',
            warning_timeseries: 'warning-timeseries',
            early_warning: 'early-warning',
            area_timeseries: 'area-timeseries',
            bosai_bulletin: 'bulletins',
            amedas: 'amedas',
            nowcast: 'nowcast',
            kikikuru: 'kikikuru',
          };
          const blockedInformation = (item: MonitoringStatusResponse['information'][number]) =>
            weatherScopeBlocks(unknown, item.venueId, 'normal', kinds[item.kind]);
          // 未完了unitは最終正常キャッシュより優先し、読取不能を正常0件にしない。
          const blocked = status.information.filter((item) => blockedInformation(item));
          return {
            ...status,
            weatherRuntimes: runtimes(),
            information: status.information.map((item) =>
              blockedInformation(item)
                ? {
                    ...item,
                    availability: 'unavailable' as const,
                    issuedAt: null,
                    validAt: null,
                    fetchedAt: null,
                    lastSuccessAt: null,
                    summaryCount: null,
                  }
                : item,
            ),
            readErrors: [
              ...status.readErrors.filter(
                (item) =>
                  item.section !== 'information' ||
                  !blocked.some(
                    (section) => section.venueId === item.venueId && section.kind === item.kind,
                  ),
              ),
              ...blocked.map((item) => ({
                section: 'information' as const,
                venueId: item.venueId,
                kind: item.kind,
                code: 'weather_data_read_failed' as const,
              })),
            ],
          };
        },
      },
      monitoringHistory: {
        listReceptions: (query) => requireApplication().monitoringHistory!.listReceptions(query),
        getReceptionById: (id) => requireApplication().monitoringHistory!.getReceptionById(id),
        listNotificationOutputs: (query) => retainedHistory.listNotificationOutputs(query),
        getNotificationReceptionById: (id) => retainedHistory.getNotificationReceptionById(id),
        listOperations: (query) => retainedHistory.listOperations(query),
      },
    };
    let closeWhenReady: (() => Promise<void>) | null = null;
    let signalPending = false;
    if (options.shutdownSignalSource)
      registerGracefulShutdown(options.shutdownSignalSource, () => {
        if (closeWhenReady) return closeWhenReady();
        signalPending = true;
        return Promise.resolve();
      });
    const app = createApp(dependencies);
    const server = app.listen(port);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    } catch (error) {
      await host.close();
      retained.close();
      throw error;
    }
    let closing: Promise<void> | null = null;
    let httpClosed: Promise<void> | null = null;
    let shutdownRecorded = false;
    let shutdownReason = false;
    const close = (closeOptions?: { reason?: 'signal' | 'programmatic' }) => {
      if (closing) return closing;
      closed = true;
      if (publication && deliveryEpoch)
        publication.replaceEpochs({ ...host.epoch, workerGeneration: randomUUID() }, deliveryEpoch);
      application?.close();
      workerControl.stopAccepting();
      shutdownReason ||= closeOptions?.reason === 'signal';
      httpClosed ??= new Promise<void>((resolve, reject) => {
        if (!server.listening) resolve();
        else server.close((error) => (error ? reject(error) : resolve()));
      });
      closing = (async () => {
        await workerControl.waitForIdle();
        await host.close();
        if (shutdownReason && !shutdownRecorded) {
          await fetchControlService.recordShutdown();
          shutdownRecorded = true;
        }
        await httpClosed;
        retained.close();
      })().catch((error) => {
        closing = null;
        throw error;
      });
      return closing;
    };
    closeWhenReady = () => close({ reason: 'signal' });
    if (signalPending)
      void closeWhenReady().catch((error) => console.error('取得Worker停止に失敗しました:', error));
    else void host.start().catch(() => {});
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('待受ポートがありません');
    return {
      port: address.port,
      weatherPrepared: host.weatherPrepared,
      fetchControlService,
      close,
      acquisitionHost: host,
    };
  } catch (error) {
    try {
      await bootHost?.close();
    } finally {
      retained.close();
    }
    throw error;
  }
}
