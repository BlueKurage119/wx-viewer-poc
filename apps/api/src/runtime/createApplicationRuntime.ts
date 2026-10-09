import { projectWeatherRuntimeStatus, type WeatherRole } from '@wx-viewer-poc/shared';
import { createRetainedMonitoringHistory } from './retainedMonitoringHistory.js';
import { createWeatherReceptionService } from '../monitoring/monitoringHistoryService.js';
import type { DatabaseConnection } from '../database/index.js';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';
import { createInlineWeatherAcquisition } from './inlineWeatherAcquisition.js';
import type { TileDeliveryResult } from '../services/tileApiSupport.js';
import { randomUUID } from 'node:crypto';
import type { AppDependencies } from '../app.js';
import type { WeatherApiService } from '../services/weatherApiService.js';
import type { NowcastApiService } from '../services/nowcastApiService.js';
import type { KikikuruApiService } from '../services/kikikuruApiService.js';
import type { MonitoringProcessingService } from '../monitoring/monitoringProcessingService.js';
import { ImageServicesInitializingError } from '../services/tileApiSupport.js';
import { createInlineWeatherRead } from './inlineWeatherRead.js';
import { WeatherRequestError, type WeatherRequestRegistry } from './weatherRequestRegistry.js';
import type {
  WeatherEpoch,
  WeatherOperations,
  WeatherPort,
  WeatherReadKind,
  WeatherResponses,
  TileInput,
  WeatherRequest,
} from './weatherContracts.js';

export interface ApplicationRuntimeDependencies extends Omit<
  AppDependencies,
  'weatherApi' | 'nowcastApi' | 'kikikuruApi' | 'monitoringHistory' | 'monitoringProcessing'
> {
  readonly weatherApi: WeatherApiService;
  readonly nowcastApi: NowcastApiService;
  readonly kikikuruApi: KikikuruApiService;
  readonly monitoringProcessing: MonitoringProcessingService;
  readonly retainedConnection: DatabaseConnection;
  readonly weatherConnection: DatabaseConnection;
  readonly deliveryEpoch: WeatherEpoch;
  readonly deliveryRegistry: WeatherRequestRegistry;
  readonly acquisitionEpoch: WeatherEpoch;
  readonly serverGenerationId: string;
  readonly weatherDatabaseGenerationId: string;
  readonly now?: () => string;
  readonly readPort?: WeatherPort;
  readonly acquisitionPort?: WeatherPort;
  readonly observeRequest?: (request: WeatherRequest) => void;
}
/** 両起動入口が使用するローカル構成。DB/service実体はここからHTTPへ渡さない。 */
export function createApplicationRuntime(deps: ApplicationRuntimeDependencies) {
  const epoch = deps.deliveryEpoch;
  const now = deps.now ?? (() => new Date().toISOString());
  const methods = {
    warnings: 'getWarnings',
    'warning-timeseries': 'getWarningTimeseries',
    'early-warning': 'getEarlyWarning',
    'area-timeseries': 'getAreaTimeseries',
    amedas: 'getAmedas',
    bulletins: 'getBulletins',
  } as const;
  const receptions = createWeatherReceptionService({
    weatherConnection: deps.weatherConnection,
    now,
  });
  const inline = createInlineWeatherRead(
    epoch,
    {
      'weather.read': (p) => deps.weatherApi[methods[p.kind]](p.terminal, p.controlStatus),
      'image.times': (p) => {
        try {
          return (p.layer === 'nowcast' ? deps.nowcastApi : deps.kikikuruApi).getTimes(
            p.terminal,
            p.controlStatus,
          );
        } catch (error) {
          if (error instanceof ImageServicesInitializingError)
            throw new WeatherRequestError('not_ready');
          throw error;
        }
      },
      'tile.read': async (p) => {
        try {
          const result =
            p.layer === 'nowcast'
              ? await deps.nowcastApi.readTile?.(p.frame, p.coordinate)
              : await deps.kikikuruApi.readTile?.(p.frame, p.coordinate);
          if (!result || result.kind !== 'success') return { kind: 'miss' };
          return {
            kind: 'hit',
            bytes: new Uint8Array(result.buffer),
            contentType: 'image/png',
            storedAt: result.storedAt,
            catalogAvailability: result.catalogAvailability,
          };
        } catch (error) {
          if (error instanceof ImageServicesInitializingError)
            throw new WeatherRequestError('not_ready');
          throw error;
        }
      },
      'history.references': (requests) => {
        if (requests.length > 200) throw new WeatherRequestError('invalid_request');
        return requests.map((request) => {
          if (request.weatherDatabaseGenerationId === null)
            return { status: 'unavailable', reason: 'generation_unknown' };
          if (request.weatherDatabaseGenerationId !== epoch.weatherDatabaseGenerationId)
            return { status: 'unavailable', reason: 'weather_generation_changed' };
          const detail = receptions.getReceptionById(request.receptionId);
          if (!detail) return { status: 'unavailable', reason: 'reception_missing' };
          if (!detail.reception.rawBody)
            return { status: 'unavailable', reason: 'raw_body_missing' };
          return { status: 'available', receptionId: request.receptionId };
        });
      },
      'history.receptions': (p) => receptions.listReceptions(p),
      'history.reception': (p) => {
        if (p.expectedDatabaseGenerationId !== epoch.weatherDatabaseGenerationId)
          throw new WeatherRequestError('generation_changed');
        return receptions.getReceptionById(p.receptionId);
      },
      'monitoring.sample': (p) => {
        if (!deps.monitoringStatus) throw new WeatherRequestError('not_ready');
        return deps.monitoringStatus.getStatus(p.terminal);
      },
      'monitoring.processing': (p) => deps.monitoringProcessing.getProcessing(p.terminal),
    },
    Date.now,
    deps.deliveryRegistry,
  );
  const readPort = deps.readPort ?? inline;
  const acquisitionEpoch = deps.acquisitionEpoch;
  const acquisitionPort =
    deps.acquisitionPort ??
    createInlineWeatherAcquisition(acquisitionEpoch, {
      'tile.ensure': async (p) => {
        const result =
          p.layer === 'nowcast'
            ? await deps.nowcastApi.getTile(p.frame, p.coordinate)
            : await deps.kikikuruApi.getTile(p.frame, p.coordinate);
        return result.kind === 'success'
          ? { kind: 'stored', tileResult: result.tileResult }
          : { kind: 'unavailable', httpStatus: result.httpStatus, error: result.error };
      },
    });
  async function tile(input: TileInput): Promise<TileDeliveryResult> {
    let result = await read('tile.read', input);
    let tileResult: 'cached' | 'downloaded' = 'cached';
    if (result.kind === 'miss') {
      const request = {
        protocolVersion: 1,
        requestId: randomUUID(),
        epoch: acquisitionEpoch,
        deadlineAt: new Date(Date.now() + 30000).toISOString(),
        kind: 'tile.ensure',
        payload: { ...input, explicit: false },
      } as const;
      deps.observeRequest?.(request);
      const ensured = await acquisitionPort.request(request);
      if (ensured.result.status !== 'completed') throw new WeatherRequestError(ensured.result.code);
      if (ensured.result.value.kind === 'unavailable')
        return {
          kind: 'error',
          httpStatus: ensured.result.value.httpStatus,
          error: ensured.result.value.error,
        };
      tileResult = ensured.result.value.tileResult;
      result = await read('tile.read', input);
    }
    if (result.kind === 'miss')
      return {
        kind: 'error',
        httpStatus: 500,
        error: { status: 'error', code: 'tile_read_failed' },
      };
    return {
      kind: 'success',
      buffer: Buffer.from(result.bytes),
      catalogAvailability: result.catalogAvailability,
      tileResult,
      storedAt: result.storedAt,
    };
  }
  async function read<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
  ): Promise<WeatherOperations[K]['response']> {
    const request = {
      protocolVersion: 1,
      requestId: randomUUID(),
      epoch,
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      kind,
      payload,
    } as const;
    deps.observeRequest?.(request);
    const reply = await readPort.request(request);
    if (reply.result.status !== 'completed') {
      if (reply.result.code === 'not_ready') throw new ImageServicesInitializingError();
      throw new WeatherRequestError(reply.result.code);
    }
    return reply.result.value;
  }
  function weather<K extends WeatherReadKind>(
    kind: K,
    terminal: Parameters<WeatherApiService['getWarnings']>[0],
    controlStatus: Parameters<WeatherApiService['getWarnings']>[1],
  ): Promise<WeatherResponses[K]> {
    return read('weather.read', {
      kind,
      terminal,
      controlStatus,
      requestedAt: new Date().toISOString(),
    }) as Promise<WeatherResponses[K]>;
  }
  const monitoringSamples = new Map<string, MonitoringStatusResponse>();
  for (const terminal of deps.terminalRegistry?.listTerminals() ?? []) {
    if (deps.monitoringStatus)
      monitoringSamples.set(terminal.id, deps.monitoringStatus.getStatus(terminal));
  }
  let deliveryReceivedAt: string | null = null;
  let acquisitionReceivedAt: string | null = null;
  let sampling = false;
  let closed = false;
  async function sampleMonitoring(): Promise<void> {
    if (sampling || closed) return;
    sampling = true;
    acquisitionReceivedAt = new Date().toISOString();
    try {
      for (const terminal of deps.terminalRegistry?.listTerminals() ?? []) {
        try {
          const sample = await read('monitoring.sample', {
            terminal,
            requestedAt: new Date().toISOString(),
          });
          if (!closed) {
            monitoringSamples.set(terminal.id, sample);
            deliveryReceivedAt = new Date().toISOString();
          }
        } catch {
          /* 最終正常報告を保持し、監視GETを読取待ちにしない。 */
        }
      }
    } finally {
      sampling = false;
    }
  }
  const sampleTimer = setInterval(() => {
    void sampleMonitoring();
  }, 5000);
  sampleTimer.unref();
  setImmediate(() => {
    void sampleMonitoring();
  });
  const retainedHistory = createRetainedMonitoringHistory(deps.retainedConnection, read, now);
  const dependencies: AppDependencies = {
    ...deps,
    monitoringStatus: deps.monitoringStatus
      ? {
          getStatus: (terminal) => {
            const cached = monitoringSamples.get(terminal.id);
            if (!cached) throw new Error('監視報告が未受領です');
            return deps.monitoringStatus!.getStatus(terminal, cached);
          },
        }
      : undefined,
    weatherApi: {
      getWarnings: (t, s) => weather('warnings', t, s),
      getWarningTimeseries: (t, s) => weather('warning-timeseries', t, s),
      getEarlyWarning: (t, s) => weather('early-warning', t, s),
      getAreaTimeseries: (t, s) => weather('area-timeseries', t, s),
      getAmedas: (t, s) => weather('amedas', t, s),
      getBulletins: (t, s) => weather('bulletins', t, s),
    },
    nowcastApi: {
      getTimes: (terminal, controlStatus) =>
        read('image.times', {
          layer: 'nowcast',
          terminal,
          controlStatus,
          requestedAt: new Date().toISOString(),
        }) as Promise<ReturnType<NowcastApiService['getTimes']>>,
      getTile: (frame, coordinate) => tile({ layer: 'nowcast', frame, coordinate }),
    },
    kikikuruApi: {
      getTimes: (terminal, controlStatus) =>
        read('image.times', {
          layer: 'kikikuru',
          terminal,
          controlStatus,
          requestedAt: new Date().toISOString(),
        }) as Promise<ReturnType<KikikuruApiService['getTimes']>>,
      getTile: (frame, coordinate) => tile({ layer: 'kikikuru', frame, coordinate }),
    },
    monitoringProcessing: {
      getProcessing: (terminal) => read('monitoring.processing', { terminal }),
    },
    monitoringHistory: {
      listReceptions: (query) => read('history.receptions', query),
      getReceptionById: (receptionId) =>
        read('history.reception', {
          receptionId,
          expectedDatabaseGenerationId: deps.weatherDatabaseGenerationId,
        }),
      listNotificationOutputs: (query) => retainedHistory.listNotificationOutputs(query),
      getNotificationReceptionById: (id) => retainedHistory.getNotificationReceptionById(id),
      listOperations: (query) => retainedHistory.listOperations(query),
    },
  };
  const runtimeStatus = (role: WeatherRole) => {
    const receivedAt = role === 'delivery' ? deliveryReceivedAt : acquisitionReceivedAt;
    return projectWeatherRuntimeStatus(
      {
        role,
        mode: 'inline',
        exitConfirmed: closed,
        failureCode: null,
        workerGeneration:
          role === 'delivery' ? epoch.workerGeneration : acquisitionEpoch.workerGeneration,
        lifecycle: closed ? 'stopped' : 'ready',
        reportedAt: receivedAt,
        receivedAt,
        stopReason: closed ? 'requested' : null,
        pendingRequests: role === 'delivery' ? inline.registry.size : 0,
      },
      new Date().toISOString(),
    );
  };
  return {
    dependencies,
    runtimeStatus,
    databaseOwnership: {
      weatherWriter: {
        role: 'acquisition' as const,
        epoch: acquisitionEpoch,
        lease: 'pair_factory' as const,
      },
      weatherReader: { role: 'delivery' as const, epoch, placement: 'main' as const },
      retainedWriter: { role: 'main' as const, lease: 'pair_factory' as const },
    },
    readPort,
    registry: inline.registry,
    acquisitionPort,
    epoch,
    sampleMonitoring,
    drain: () => inline.drain(),
    close: () => {
      closed = true;
      clearInterval(sampleTimer);
      inline.registry.close();
    },
  };
}

/** 実提供 Worker の読取だけを公開する構成。メインは気象DBを所有しない。 */
export function createDeliveryApplicationRuntime(input: {
  readonly read: <K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<WeatherOperations[K]['response']>;
  readonly ensureTile: (
    input: TileInput & { readonly explicit: boolean },
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<WeatherOperations['tile.ensure']['response']>;
  readonly retainedConnection: DatabaseConnection;
  readonly terminalRegistry: NonNullable<AppDependencies['terminalRegistry']>;
  readonly weatherDatabaseGenerationId: string;
  readonly now: () => string;
}) {
  const { read, ensureTile, now } = input;
  const samples = new Map<string, MonitoringStatusResponse>();
  const sampleReceivedAt = new Map<string, string>();
  let closed = false;
  let sampling = false;
  async function sampleMonitoring() {
    if (sampling || closed) return;
    sampling = true;
    try {
      for (const terminal of input.terminalRegistry.listTerminals()) {
        try {
          const sample = await read('monitoring.sample', { terminal, requestedAt: now() });
          if (!closed) {
            samples.set(terminal.id, sample);
            sampleReceivedAt.set(terminal.id, new Date().toISOString());
          }
        } catch {
          // 監視GETは最終正常報告を使う。
        }
      }
    } finally {
      sampling = false;
    }
  }
  const timer = setInterval(() => void sampleMonitoring(), 5000);
  timer.unref();
  void sampleMonitoring();
  async function tile(
    payload: TileInput,
    signal?: AbortSignal,
    deadline = Date.now() + 30000,
  ): Promise<TileDeliveryResult> {
    const remaining = () => {
      const value = deadline - Date.now();
      if (value <= 0) throw new WeatherRequestError('deadline_exceeded');
      return value;
    };
    let result = await read('tile.read', payload, Math.min(5000, remaining()), signal);
    let tileResult: 'cached' | 'downloaded' = 'cached';
    if (result.kind === 'miss') {
      const ensured = await ensureTile({ ...payload, explicit: false }, remaining(), signal);
      if (ensured.kind === 'unavailable')
        return { kind: 'error', httpStatus: ensured.httpStatus, error: ensured.error };
      tileResult = ensured.tileResult;
      result = await read('tile.read', payload, Math.min(5000, remaining()), signal);
    }
    if (result.kind === 'miss')
      return {
        kind: 'error',
        httpStatus: 500,
        error: { status: 'error', code: 'tile_read_failed' },
      };
    return {
      kind: 'success',
      buffer: Buffer.from(result.bytes),
      catalogAvailability: result.catalogAvailability,
      tileResult,
      storedAt: result.storedAt,
      release: result.release,
    };
  }
  const history = createRetainedMonitoringHistory(input.retainedConnection, read, now);
  const dependencies: AppDependencies = {
    weatherApi: {
      getWarnings: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'warnings',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getWarnings']>>,
      getWarningTimeseries: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'warning-timeseries',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getWarningTimeseries']>>,
      getEarlyWarning: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'early-warning',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getEarlyWarning']>>,
      getAreaTimeseries: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'area-timeseries',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getAreaTimeseries']>>,
      getAmedas: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'amedas',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getAmedas']>>,
      getBulletins: (terminal, controlStatus) =>
        read('weather.read', {
          kind: 'bulletins',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<WeatherApiService['getBulletins']>>,
    },
    nowcastApi: {
      getTimes: (terminal, controlStatus) =>
        read('image.times', {
          layer: 'nowcast',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<NowcastApiService['getTimes']>>,
      getTile: (frame, coordinate, signal, deadlineAt) =>
        tile({ layer: 'nowcast', frame, coordinate }, signal, deadlineAt),
    },
    kikikuruApi: {
      getTimes: (terminal, controlStatus) =>
        read('image.times', {
          layer: 'kikikuru',
          terminal,
          controlStatus,
          requestedAt: now(),
        }) as Promise<ReturnType<KikikuruApiService['getTimes']>>,
      getTile: (frame, coordinate, signal, deadlineAt) =>
        tile({ layer: 'kikikuru', frame, coordinate }, signal, deadlineAt),
    },
    monitoringProcessing: {
      getProcessing: (terminal) => read('monitoring.processing', { terminal }),
    },
    monitoringHistory: {
      listReceptions: (query) => read('history.receptions', query),
      getReceptionById: (receptionId) =>
        read('history.reception', {
          receptionId,
          expectedDatabaseGenerationId: input.weatherDatabaseGenerationId,
        }),
      listNotificationOutputs: history.listNotificationOutputs,
      getNotificationReceptionById: history.getNotificationReceptionById,
      listOperations: history.listOperations,
    },
  };
  return {
    dependencies,
    samples,
    sampleReceivedAt,
    sampleMonitoring,
    close: () => {
      closed = true;
      clearInterval(timer);
    },
  };
}
