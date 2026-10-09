import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { MonitoringStatusResponse, SystemNotification } from '@wx-viewer-poc/shared';
import { resolveNotificationMessage, toNotificationDeltaCursor } from '@wx-viewer-poc/shared';
import { createApp, type AppDependencies } from '../app.js';
import {
  loadVenueConfig,
  loadTerminalConfig,
  loadPollingScheduleConfigWithSources,
  validatePollingScheduleConfig,
} from '../config/index.js';
import { resolvePollingPeriod } from '../config/pollingSchedule.js';
import { resolveDatabasePairConfig, validateDatabasePairPaths } from '../database/pairConfig.js';
import { initializeRoleDatabase } from '../database/roleDatabase.js';
import { createDeliveryApplicationRuntime } from './createApplicationRuntime.js';
import { AcquisitionWorkerHost } from './acquisitionWorkerHost.js';
import { DeliveryWorkerHost } from './deliveryWorkerHost.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
  createNotificationDeltaService,
} from '../notifications/index.js';
import { findMaxNotificationOutputSequence } from '../repositories/notificationOutputHistoryRepository.js';
import { RetainedNotificationSink } from './retainedNotificationSink.js';
import { toNotificationOutputHistoryInput } from '../notifications/notificationOutputHistoryMapper.js';
import { WeatherPublicationGate } from './weatherPublication.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
import { weatherReadScope, weatherScopeBlocks, type WeatherScopeKind } from './weatherReadScope.js';
import { createFetchControlService } from '../services/fetchControlService.js';
import {
  createWeatherWorkerControlService,
  WeatherWorkerRestartError,
} from '../services/weatherWorkerControlService.js';
import { registerGracefulShutdown } from '../gracefulShutdown.js';
import { unavailableMonitoring } from './unavailableMonitoring.js';
import { createRetainedMonitoringHistory } from './retainedMonitoringHistory.js';
import {
  buildHealthSection,
  buildOperationSection,
  buildReadinessSection,
} from '../monitoring/monitoringStatusService.js';
import { buildStoppedPollingStatus } from '../polling/index.js';
import { logPollingConfig, type StartServerOptions } from '../server.js';
import { sameWeatherEpoch, type WeatherEpoch, type WeatherOperations } from './weatherContracts.js';

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
  const sink = new RetainedNotificationSink(retained.connection);
  const serverStartCursor = toNotificationDeltaCursor(
    findMaxNotificationOutputSequence(retained.connection),
  );
  const initialization = new StartupNotificationInitialization();
  let closed = false;
  let application: ReturnType<typeof createDeliveryApplicationRuntime> | null = null;
  const lastSamples = new Map<string, MonitoringStatusResponse>();
  const lastSampleReceivedAt = new Map<string, string>();
  let publication: WeatherPublicationGate | null = null;
  let validatedDatabaseGeneration: string | null = null;
  let validatedSchemaVersion: number | null = null;
  let deliveryStarted: Promise<void> = Promise.resolve();
  let generationTransition: Promise<void> = Promise.resolve();
  let readerSuspendedForAcquisition = true;
  let connectedAcquisitionEpoch: WeatherEpoch | null = null;
  const withGenerationTransition = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = generationTransition;
    let release!: () => void;
    generationTransition = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const locallyValidatedScopes = new Set<string>();
  const host: AcquisitionWorkerHost = new AcquisitionWorkerHost({
    workerEntry: options.acquisitionWorkerEntry,
    onWorkerCreated: options.onAcquisitionWorkerCreated,
    pair: config,
    settings: {
      venues: venue.registry.listVenues(),
      venueGeneration: venue.registry.generation,
      schedule,
      enablePolling,
      desiredRunning: enablePolling,
      serverStartedAt,
      nowcastCacheRoot: options.nowcastCacheRoot ?? resolve(process.cwd(), 'data/cache/nowcast'),
      kikikuruCacheRoot: options.kikikuruCacheRoot ?? resolve(process.cwd(), 'data/cache/kikikuru'),
    },
    serverGenerationId,
    retainedConnection: retained.connection,
    onReport() {
      if (host.preparationCompleted) locallyValidatedScopes.clear();
      for (const scope of host.report?.locallyValidatedScopes ?? [])
        locallyValidatedScopes.add(scope);
      const state = host.report?.initialization;
      if (state)
        initialization.replaceStatus({
          ...state,
          evaluatedVenueIds: new Set(state.evaluatedVenueIds),
        });
    },
    onFailure(code, generation) {
      recordFailure('acquisition', code, generation);
    },
    async closeReader() {
      await withGenerationTransition(async () => {
        readerSuspendedForAcquisition = true;
        connectedAcquisitionEpoch = null;
        initialization.replaceStatus({
          initialFetchPhase: 'not_started',
          evaluatedVenueIds: new Set(),
          preparationFailures: [],
        });
        for (const [id, sample] of application?.samples ?? []) lastSamples.set(id, sample);
        for (const [id, at] of application?.sampleReceivedAt ?? [])
          lastSampleReceivedAt.set(id, at);
        application?.close();
        application = null;
        if (publication)
          publication.replaceEpochs(
            { ...host.epoch, workerGeneration: randomUUID() },
            delivery.epoch,
          );
        await delivery.suspendReader();
        publication = null;
      });
    },
    async databaseReady(generation, schemaVersion, acquisitionEpoch) {
      await withGenerationTransition(async () => {
        if (closed) throw new Error('not_ready');
        if (validatedDatabaseGeneration !== generation) locallyValidatedScopes.clear();
        validatedDatabaseGeneration = generation;
        validatedSchemaVersion = schemaVersion;
        const readerEpoch = randomUUID();
        try {
          await deliveryStarted;
          await delivery.connectReader({
            generation,
            schemaVersion,
            acquisitionEpoch,
            readerEpoch,
          });
        } catch {
          // 取得DBは接続可能なので、提供側の手動再開で接続を再試行できる。
          readerSuspendedForAcquisition = false;
          return;
        }
        publication = new WeatherPublicationGate(acquisitionEpoch, delivery.epoch);
        connectedAcquisitionEpoch = acquisitionEpoch;
        readerSuspendedForAcquisition = false;
        application?.close();
        application = createDeliveryApplicationRuntime({
          read,
          // cache miss待機中のHTTP中断を取得要求の予約解除へ伝える。
          ensureTile: (input, timeoutMs, signal) =>
            host.call('tile.ensure', input, timeoutMs ?? 30000, signal),
          retainedConnection: retained.connection,
          terminalRegistry: terminal.registry,
          weatherDatabaseGenerationId: generation,
          now,
        });
      });
    },
  });
  const context = () => ({
    report: host.report,
    unknownScopes: host.status().unknownScopes ?? [],
    validatedScopes: [...locallyValidatedScopes],
    now: now(),
  });
  const delivery = new DeliveryWorkerHost({
    pair: config,
    settings: {
      venues: venue.registry.listVenues(),
      venueGeneration: venue.registry.generation,
      terminals: terminal.registry.listTerminals(),
      terminalGeneration: terminal.response.generation,
      schedule,
      enablePolling,
      serverStartedAt,
      nowcastCacheRoot: options.nowcastCacheRoot ?? resolve(process.cwd(), 'data/cache/nowcast'),
      kikikuruCacheRoot: options.kikikuruCacheRoot ?? resolve(process.cwd(), 'data/cache/kikikuru'),
    },
    serverGenerationId,
    workerEntry: options.deliveryWorkerEntry,
    onWorkerCreated: options.onDeliveryWorkerCreated,
    onFailure(code, generation) {
      recordFailure('delivery', code, generation);
    },
  });
  function recordFailure(role: 'acquisition' | 'delivery', code: string, generation: string) {
    const notification: SystemNotification = {
      notificationId: `weather-worker:${role}:${generation}:${code}`,
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
          name: role === 'delivery' ? '気象提供Worker' : '気象取得Worker',
        },
      ],
      occurredAt: now(),
      detectedAt: now(),
      relatedRefs: [{ type: 'worker_generation', ref: generation }],
      detectionContext: 'normal',
      isTraining: false,
    };
    const definitionId =
      role === 'delivery'
        ? code === 'initialization_failed'
          ? 'system-weather-delivery-initialization-failed'
          : code === 'unexpected_exit'
            ? 'system-weather-delivery-exited'
            : code === 'report_stale'
              ? 'system-weather-delivery-report-stale'
              : 'system-weather-delivery-control-failed'
        : code === 'initialization_failed'
          ? 'system-weather-acquisition-initialization-failed'
          : code === 'unexpected_exit'
            ? 'system-weather-acquisition-exited'
            : code === 'report_stale'
              ? 'system-weather-acquisition-report-stale'
              : 'system-weather-acquisition-control-failed';
    try {
      sink.record([
        toNotificationOutputHistoryInput(
          notification,
          resolveNotificationMessage(notification, { definitionId }),
          null,
        ),
      ]);
    } catch {
      console.error(`${role === 'delivery' ? '提供' : '取得'}Worker異常通知の保存に失敗しました。`);
    }
  }
  const isScopeReadable = (
    venueId: Parameters<typeof weatherReadScope>[0],
    status: Parameters<typeof weatherReadScope>[1],
    kind: WeatherScopeKind,
  ) =>
    !weatherScopeBlocks(host.status().unknownScopes ?? [], venueId, status, kind) &&
    (kind === 'nowcast' ||
      kind === 'kikikuru' ||
      locallyValidatedScopes.has(weatherReadScope(venueId, status, kind)));
  function assertCurrentRead<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    initialContext: ReturnType<typeof context>,
    acquisitionEpoch: typeof host.epoch,
    deliveryEpoch: typeof delivery.epoch,
  ): void {
    if (
      closed ||
      readerSuspendedForAcquisition ||
      !sameWeatherEpoch(connectedAcquisitionEpoch ?? host.epoch, acquisitionEpoch) ||
      !sameWeatherEpoch(delivery.epoch, deliveryEpoch)
    )
      throw new WeatherRequestError('generation_changed');
    const currentUnknown = host.status().unknownScopes ?? [];
    const currentValidated = new Set(locallyValidatedScopes);
    const scopes: string[] = [];
    if (kind === 'weather.read') {
      const request = payload as WeatherOperations['weather.read']['request'];
      scopes.push(weatherReadScope(request.terminal.venueId, request.controlStatus, request.kind));
    } else if (kind === 'image.times') {
      const request = payload as WeatherOperations['image.times']['request'];
      scopes.push(weatherReadScope(request.terminal.venueId, request.controlStatus, request.layer));
    } else if (kind === 'monitoring.processing' || kind === 'monitoring.sample') {
      const request = payload as WeatherOperations['monitoring.sample']['request'];
      for (const scopeKind of [
        'warnings',
        'warning-timeseries',
        'early-warning',
        'area-timeseries',
        'amedas',
        'bulletins',
        'nowcast',
        'kikikuru',
      ] as const)
        scopes.push(weatherReadScope(request.terminal.venueId, 'normal', scopeKind));
    } else if (kind === 'startup.project') {
      const request = payload as WeatherOperations['startup.project']['request'];
      for (const status of ['normal', 'training'] as const)
        for (const scopeKind of ['warnings', 'bulletins'] as const)
          scopes.push(weatherReadScope(request.venueId, status, scopeKind));
    }
    for (const scope of scopes) {
      const [venueId, status, scopeKind] = scope.split('|') as [
        Parameters<typeof weatherReadScope>[0],
        Parameters<typeof weatherReadScope>[1],
        WeatherScopeKind,
      ];
      if (
        (weatherScopeBlocks(currentUnknown, venueId, status, scopeKind) &&
          !weatherScopeBlocks(initialContext.unknownScopes, venueId, status, scopeKind)) ||
        (!['nowcast', 'kikikuru'].includes(scopeKind) &&
          initialContext.validatedScopes.includes(scope) &&
          !currentValidated.has(scope))
      )
        throw new WeatherRequestError('generation_changed');
    }
  }
  async function read<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    timeoutMs = 5000,
    signal?: AbortSignal,
  ): Promise<WeatherOperations[K]['response']> {
    if (closed) throw new WeatherRequestError('not_ready');
    options.weatherRequestObserver?.({
      protocolVersion: 1,
      requestId: randomUUID(),
      epoch: delivery.epoch,
      deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
      kind,
      payload,
    } as never);
    const acquisitionEpoch = connectedAcquisitionEpoch ?? host.epoch;
    const deliveryEpoch = delivery.epoch;
    const initialContext = context();
    const result = await delivery.read(kind, payload, initialContext, signal, timeoutMs);
    try {
      assertCurrentRead(kind, payload, initialContext, acquisitionEpoch, deliveryEpoch);
    } catch (error) {
      if (kind === 'tile.read' && result && typeof result === 'object' && 'release' in result)
        (result.release as (() => void) | undefined)?.();
      throw error;
    }
    return result;
  }
  async function readHttp<K extends Parameters<NonNullable<AppDependencies['weatherHttp']>>[0]>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    signal?: AbortSignal,
  ) {
    options.weatherRequestObserver?.({
      protocolVersion: 1,
      requestId: randomUUID(),
      epoch: delivery.epoch,
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      kind,
      payload,
    } as never);
    if (closed) throw new WeatherRequestError('not_ready');
    const acquisitionEpoch = connectedAcquisitionEpoch ?? host.epoch;
    const deliveryEpoch = delivery.epoch;
    const initialContext = context();
    const result = await delivery.readHttp(kind, payload, initialContext, signal);
    try {
      assertCurrentRead(kind, payload, initialContext, acquisitionEpoch, deliveryEpoch);
    } catch (error) {
      result.release?.();
      throw error;
    }
    return result;
  }
  const runtimes = (): MonitoringStatusResponse['weatherRuntimes'] => ({
    acquisition: host.status(),
    delivery: delivery.status(),
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
      weatherConnection: retained.connection,
      retainedConnection: retained.connection,
      weatherDatabaseGenerationId: host.epoch.weatherDatabaseGenerationId ?? '',
      venueRegistry: venue.registry,
      terminalRegistry: terminal.registry,
      initialization,
      serverGenerationId,
      now,
      getFetchHealth: () => host.report?.health ?? null,
      projector: () => {
        throw new WeatherRequestError('not_ready');
      },
    });
    if (!initialization.isReady(input.venueId) || input.serverGenerationId !== serverGenerationId)
      return service.inquire(input);
    const validated = () =>
      (['normal', 'training'] as const).every((status) =>
        (['warnings', 'bulletins'] as const).every((kind) =>
          isScopeReadable(input.venueId, status, kind),
        ),
      );
    if (
      !validated() ||
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
    if (!publication || !application) throw new WeatherRequestError('not_ready');
    const gate = publication;
    const epoch = delivery.epoch;
    return gate.publish(async (token) => {
      const running = !host.status().exitConfirmed;
      try {
        if (running)
          await host.call('publication.pause', { token: token.id, expiresAt: token.expiresAt });
        gate.assertValid(token);
        if (!validated() || host.decisions.pendingUnit || delivery.epoch !== epoch)
          throw new WeatherRequestError('generation_changed');
        const cursor = findMaxNotificationOutputSequence(retained.connection);
        const projection = await read('startup.project', {
          publicationToken: token,
          venueId: input.venueId,
          inquiredAt: input.inquiredAt,
        });
        gate.assertValid(token);
        return service.inquire(input, { projection, cursor });
      } finally {
        if (running) void host.call('publication.release', { token: token.id }).catch(() => {});
      }
    }, signal);
  };
  const retainedHistory = createRetainedMonitoringHistory(retained.connection, read, now);
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
    delivery: {
      getRuntimeStatus: () => delivery.status(),
      restart: async () => {
        try {
          await withGenerationTransition(async () => {
            if (closed) throw new WeatherRequestError('not_ready');
            publication?.replaceEpochs(host.epoch, {
              ...delivery.epoch,
              workerGeneration: randomUUID(),
            });
            await delivery.restart();
            if (
              !readerSuspendedForAcquisition &&
              host.epoch.weatherDatabaseGenerationId &&
              validatedDatabaseGeneration === host.epoch.weatherDatabaseGenerationId &&
              validatedSchemaVersion !== null
            ) {
              try {
                await delivery.connectReader({
                  generation: validatedDatabaseGeneration,
                  schemaVersion: validatedSchemaVersion,
                  acquisitionEpoch: host.epoch,
                  readerEpoch: randomUUID(),
                });
              } catch {
                // 再開操作は新Workerの受付で確定する。reader接続障害はruntimeの異常状態に残す。
                return;
              }
              connectedAcquisitionEpoch = host.epoch;
              publication = new WeatherPublicationGate(host.epoch, delivery.epoch);
              for (const [id, sample] of application?.samples ?? []) lastSamples.set(id, sample);
              for (const [id, at] of application?.sampleReceivedAt ?? [])
                lastSampleReceivedAt.set(id, at);
              application?.close();
              application = createDeliveryApplicationRuntime({
                read,
                ensureTile: (input, timeoutMs, signal) =>
                  host.call('tile.ensure', input, timeoutMs ?? 30000, signal),
                retainedConnection: retained.connection,
                terminalRegistry: terminal.registry,
                weatherDatabaseGenerationId: validatedDatabaseGeneration,
                now,
              });
            }
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : 'restart_failed';
          throw new WeatherWorkerRestartError(
            code === 'exit_unconfirmed' ? 'unknown' : 'failure',
            code,
          );
        }
      },
    },
  });
  const dependencies: AppDependencies = {
    getWeatherDatabaseGenerationId: () => host.epoch.weatherDatabaseGenerationId,
    weatherHttp: readHttp,
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
      getTimes: (...args) => requireApplication().nowcastApi!.getTimes(...args),
      getTile: (...args) => requireApplication().nowcastApi!.getTile(...args),
    },
    kikikuruApi: {
      getTimes: (...args) => requireApplication().kikikuruApi!.getTimes(...args),
      getTile: (...args) => requireApplication().kikikuruApi!.getTile(...args),
    },
    monitoringProcessing: {
      getProcessing: (...args) => requireApplication().monitoringProcessing!.getProcessing(...args),
    },
    monitoringHistory: {
      listReceptions: (...args) => requireApplication().monitoringHistory!.listReceptions(...args),
      getReceptionById: (...args) =>
        requireApplication().monitoringHistory!.getReceptionById(...args),
      listNotificationOutputs: (query) => retainedHistory.listNotificationOutputs(query),
      getNotificationReceptionById: (id) => retainedHistory.getNotificationReceptionById(id),
      resolveNotificationReceptionById: (id) =>
        retainedHistory.resolveNotificationReceptionById(id),
      listOperations: (query) => retainedHistory.listOperations(query),
    },
    monitoringStatus: {
      getStatus: (t) => {
        const sample = application?.samples.get(t.id) ?? lastSamples.get(t.id);
        if (!sample)
          return {
            ...unavailableMonitoring({
              terminal: t,
              registry: venue.registry,
              schedule,
              generation: serverGenerationId,
              startedAt: serverStartedAt,
              runtimes: runtimes(),
              now: now(),
            }),
            weatherSampleReceivedAt: null,
          };
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
          !isScopeReadable(item.venueId, 'normal', kinds[item.kind]!);
        const blocked = sample.information.filter(blockedInformation);
        return {
          ...sample,
          generatedAt: now(),
          weatherRuntimes: runtimes(),
          weatherSampleReceivedAt:
            application?.sampleReceivedAt.get(t.id) ?? lastSampleReceivedAt.get(t.id) ?? null,
          operation: buildOperationSection(
            host.report?.scheduler ?? buildStoppedPollingStatus(new Date(now()), schedule),
            host.report?.running ?? false,
          ),
          health: buildHealthSection(host.report?.health ?? null, schedule.fetchHealth),
          readiness: buildReadinessSection(
            {
              initialFetch: host.report?.polling?.initialFetch ?? {
                phase: 'not_started',
                result: null,
              },
            },
            initialization.getStatus().preparationFailures,
          ),
          venues: sample.venues.map((item) => {
            const report = host.report?.venues.find((value) => value.venueId === item.venueId);
            return report
              ? { ...item, reprocessing: report.reprocessing, recovery: report.recovery }
              : item;
          }),
          information: sample.information.map((item) =>
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
            ...sample.readErrors.filter(
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
  };
  function requireApplication() {
    if (closed || !application) throw new WeatherRequestError('not_ready');
    return application.dependencies;
  }
  let closeWhenReady: (() => Promise<void>) | null = null;
  let signalPending = false;
  if (options.shutdownSignalSource)
    registerGracefulShutdown(options.shutdownSignalSource, () => {
      if (closeWhenReady) return closeWhenReady();
      signalPending = true;
      return Promise.resolve();
    });
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  try {
    server = createApp(dependencies).listen(port);
  } catch (error) {
    await host.close();
    await delivery.close();
    retained.close();
    throw error;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    await host.close();
    await delivery.close();
    retained.close();
    throw error;
  }
  let closing: Promise<void> | null = null;
  const close = (closeOptions?: { reason?: 'signal' | 'programmatic' }) => {
    if (closing) return closing;
    closed = true;
    application?.close();
    workerControl.stopAccepting();
    const httpClosed = new Promise<void>((resolve, reject) => {
      if (!server.listening) resolve();
      else server.close((error) => (error ? reject(error) : resolve()));
    });
    closing = (async () => {
      await workerControl.waitForIdle();
      await host.close();
      await delivery.close();
      if (closeOptions?.reason === 'signal') await fetchControlService.recordShutdown();
      await httpClosed;
      retained.close();
    })();
    return closing;
  };
  closeWhenReady = () => close({ reason: 'signal' });
  if (signalPending)
    void closeWhenReady().catch((error) => console.error('Worker停止に失敗しました:', error));
  else {
    deliveryStarted = delivery.start().catch(() => {});
    void host.start().catch(() => {});
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('待受ポートがありません');
  return {
    port: address.port,
    weatherPrepared: host.weatherPrepared,
    fetchControlService,
    close,
    acquisitionHost: host,
    deliveryHost: delivery,
  };
}
