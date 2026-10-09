import type { WeatherWorkerControlService } from './services/weatherWorkerControlService.js';
import express, { type Express } from 'express';
import {
  parseKikikuruTileRequest,
  parseMonitoringNotificationOutputQuery,
  parseMonitoringOperationQuery,
  parseMonitoringProcessingQuery,
  parseMonitoringReceptionIdParam,
  parseMonitoringReceptionQuery,
  parseMonitoringStatusQuery,
  parseNowcastTileRequest,
  parseNotificationDeltaQuery,
  parseStartupNotificationRequest,
  parseWeatherApiQuery,
  type TerminalConfigResponse,
  type TerminalRegistry,
  type UtcIso8601String,
  type VenueConfigResponse,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import type {
  NotificationDeltaService,
  StartupNotificationService,
} from './notifications/index.js';
import type { WeatherApiService } from './services/weatherApiService.js';
import type { NowcastApiService } from './services/nowcastApiService.js';
import type { KikikuruApiService } from './services/kikikuruApiService.js';
import { ImageServicesInitializingError } from './services/tileApiSupport.js';
import type { MonitoringStatusService } from './monitoring/monitoringStatusService.js';
import type { MonitoringProcessingService } from './monitoring/monitoringProcessingService.js';
import type { MonitoringHistoryService } from './monitoring/monitoringHistoryService.js';
import type { FetchControlService } from './services/fetchControlService.js';
import { isFetchControlRequestId, parseFetchControlRequest } from '@wx-viewer-poc/shared';

/** HTTPは同期実装と非同期port facadeのどちらも受け取れる。 */
export type AsyncCompatible<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : T[K];
};

export interface AppDependencies {
  readonly weatherWorkerControl?: WeatherWorkerControlService;
  readonly venueConfig?: VenueConfigResponse;
  readonly terminalConfig?: TerminalConfigResponse;
  readonly terminalRegistry?: TerminalRegistry;
  readonly venueRegistry?: VenueRegistry;
  readonly startupNotifications?: AsyncCompatible<StartupNotificationService> & {
    inquireWithSignal?(
      input: Parameters<StartupNotificationService['inquire']>[0],
      signal: AbortSignal,
    ):
      | ReturnType<StartupNotificationService['inquire']>
      | Promise<ReturnType<StartupNotificationService['inquire']>>;
  };
  readonly notificationDelta?: NotificationDeltaService;
  readonly weatherApi?: AsyncCompatible<WeatherApiService>;
  readonly nowcastApi?: AsyncCompatible<NowcastApiService>;
  readonly kikikuruApi?: AsyncCompatible<KikikuruApiService>;
  readonly monitoringStatus?: MonitoringStatusService;
  readonly monitoringProcessing?: AsyncCompatible<MonitoringProcessingService>;
  readonly monitoringHistory?: AsyncCompatible<MonitoringHistoryService>;
  readonly fetchControl?: FetchControlService;
}

function sendJsonNoStore(res: express.Response, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(body));
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();

  app.use(express.json());

  const resolveConfiguredVenueId = (terminalId: string) => {
    const terminal = dependencies.terminalRegistry?.resolveTerminal(terminalId) ?? null;
    const venueId = terminal && dependencies.venueRegistry?.resolveVenueId(terminal.venueId);
    if (!venueId) throw new Error('端末の会場 ID が設定にありません');
    return venueId;
  };

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  if (dependencies.weatherWorkerControl) {
    const control = dependencies.weatherWorkerControl;
    app.post('/api/control/weather-workers/:role/restart', (req, res) => {
      if (req.params.role !== 'acquisition') {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const result = control.request(req.body);
      sendJsonNoStore(res, result.statusCode, result.body);
    });
    app.get('/api/control/weather-workers/operations/:requestId', (req, res) => {
      const result = control.get(req.params.requestId);
      sendJsonNoStore(res, result.statusCode, result.body);
    });
    app.get('/api/monitoring/weather-worker-operations', (req, res) => {
      if (
        Object.keys(req.query).some((key) => !['limit', 'beforeId'].includes(key)) ||
        Object.values(req.query).some(
          (value) => typeof value !== 'string' || !/^[0-9]+$/.test(value),
        )
      ) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const result = control.history({
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
        beforeId: req.query.beforeId === undefined ? undefined : Number(req.query.beforeId),
      });
      sendJsonNoStore(res, result.statusCode, result.body);
    });
  }

  if (dependencies.venueConfig) {
    app.get('/api/config/venues', (_req, res) => {
      sendJsonNoStore(res, 200, dependencies.venueConfig);
    });
  }

  if (dependencies.terminalConfig) {
    app.get('/api/config/terminals', (_req, res) => {
      sendJsonNoStore(res, 200, dependencies.terminalConfig);
    });
  }

  if (dependencies.weatherApi) {
    const weatherApi = dependencies.weatherApi;

    app.get('/api/weather/warnings', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getWarnings(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/warning-timeseries', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getWarningTimeseries(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/early-warning', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getEarlyWarning(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/area-timeseries', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getAreaTimeseries(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/amedas', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getAmedas(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/bulletins', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await weatherApi.getBulletins(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });
  }

  if (dependencies.startupNotifications) {
    const startupNotifications = dependencies.startupNotifications;
    app.post('/api/notifications/startup', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!req.is('application/json')) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const parsed = parseStartupNotificationRequest(req.body);
      if (parsed === null) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = dependencies.terminalRegistry?.resolveTerminal(parsed.terminalId) ?? null;
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once('close', onClose);
      try {
        const input = {
          terminalId: parsed.terminalId,
          venueId: resolveConfiguredVenueId(terminal.id),
          sessionId: parsed.sessionId,
          serverGenerationId: parsed.serverGenerationId,
          inquiredAt: new Date().toISOString(),
        };
        const result = await (startupNotifications.inquireWithSignal
          ? startupNotifications.inquireWithSignal(input, controller.signal)
          : startupNotifications.inquire(input));
        res
          .status(result.status === 'error' ? 409 : result.status === 'initializing' ? 202 : 200)
          .json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'startup_notification_failed' });
      } finally {
        res.off('close', onClose);
      }
    });
  }

  if (dependencies.notificationDelta) {
    const notificationDelta = dependencies.notificationDelta;
    app.get('/api/notifications/delta', async (req, res) => {
      const parsed = parseNotificationDeltaQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = dependencies.terminalRegistry?.resolveTerminal(parsed.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = notificationDelta.query({
          ...parsed,
          venueId: resolveConfiguredVenueId(terminal.id),
          requestedAt: new Date().toISOString() as UtcIso8601String,
        });
        if (result.status === 'cursor_out_of_range') {
          sendJsonNoStore(res, 409, {
            status: 'error',
            code: 'cursor_out_of_range',
            cursor: result.cursor,
            origin: result.origin,
            serverGenerationId: result.serverGenerationId,
          });
          return;
        }
        sendJsonNoStore(
          res,
          result.status === 'error' ? 409 : result.status === 'initializing' ? 202 : 200,
          result,
        );
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'notification_delta_failed' });
      }
    });
  }

  if (dependencies.nowcastApi) {
    const nowcastApi = dependencies.nowcastApi;

    app.get('/api/weather/nowcast/times', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await nowcastApi.getTimes(terminal, parsed.value.controlStatus);
        sendJsonNoStore(res, 200, result);
      } catch (err) {
        if (err instanceof ImageServicesInitializingError) {
          sendJsonNoStore(res, 503, { status: 'error', code: 'image_services_initializing' });
          return;
        }
        sendJsonNoStore(res, 500, { status: 'error', code: 'weather_read_failed' });
      }
    });

    app.head('/api/weather/nowcast/:product/tiles/:z/:x/:y.png', (_req, res) => {
      res.setHeader('Allow', 'GET');
      sendJsonNoStore(res, 405, { status: 'error', code: 'method_not_allowed' });
    });

    app.get('/api/weather/nowcast/:product/tiles/:z/:x/:y.png', async (req, res) => {
      const parsed = parseNowcastTileRequest(req.params, req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      if (parsed.value.controlStatus !== 'normal') {
        sendJsonNoStore(res, 422, { status: 'error', code: 'unsupported_control_status' });
        return;
      }
      try {
        const result = await nowcastApi.getTile(parsed.value.frame, parsed.value.coordinate);
        if (result.kind === 'success') {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Wx-Catalog-Availability', result.catalogAvailability);
          res.setHeader('X-Wx-Tile-Result', result.tileResult);
          res.setHeader('X-Wx-Tile-Stored-At', result.storedAt);
          res.status(200).end(result.buffer);
        } else {
          sendJsonNoStore(res, result.httpStatus, result.error);
        }
      } catch (err) {
        if (err instanceof ImageServicesInitializingError) {
          sendJsonNoStore(res, 503, { status: 'error', code: 'image_services_initializing' });
          return;
        }
        sendJsonNoStore(res, 500, { status: 'error', code: 'tile_read_failed' });
      }
    });
  }

  if (dependencies.kikikuruApi) {
    const kikikuruApi = dependencies.kikikuruApi;

    app.get('/api/weather/kikikuru/times', async (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await kikikuruApi.getTimes(terminal, parsed.value.controlStatus);
        sendJsonNoStore(res, 200, result);
      } catch (err) {
        if (err instanceof ImageServicesInitializingError) {
          sendJsonNoStore(res, 503, { status: 'error', code: 'image_services_initializing' });
          return;
        }
        sendJsonNoStore(res, 500, { status: 'error', code: 'weather_read_failed' });
      }
    });

    app.head('/api/weather/kikikuru/:layer/tiles/:z/:x/:y.png', (_req, res) => {
      res.setHeader('Allow', 'GET');
      sendJsonNoStore(res, 405, { status: 'error', code: 'method_not_allowed' });
    });

    app.get('/api/weather/kikikuru/:layer/tiles/:z/:x/:y.png', async (req, res) => {
      const parsed = parseKikikuruTileRequest(req.params, req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal =
        dependencies.terminalRegistry?.resolveTerminal(parsed.value.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      if (parsed.value.controlStatus !== 'normal') {
        sendJsonNoStore(res, 422, { status: 'error', code: 'unsupported_control_status' });
        return;
      }
      try {
        const result = await kikikuruApi.getTile(parsed.value.frame, parsed.value.coordinate);
        if (result.kind === 'success') {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Wx-Catalog-Availability', result.catalogAvailability);
          res.setHeader('X-Wx-Tile-Result', result.tileResult);
          res.setHeader('X-Wx-Tile-Stored-At', result.storedAt);
          res.status(200).end(result.buffer);
        } else {
          sendJsonNoStore(res, result.httpStatus, result.error);
        }
      } catch (err) {
        if (err instanceof ImageServicesInitializingError) {
          sendJsonNoStore(res, 503, { status: 'error', code: 'image_services_initializing' });
          return;
        }
        sendJsonNoStore(res, 500, { status: 'error', code: 'tile_read_failed' });
      }
    });
  }

  if (dependencies.monitoringStatus) {
    const monitoringStatus = dependencies.monitoringStatus;
    app.get('/api/monitoring/status', async (req, res) => {
      const parsed = parseMonitoringStatusQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = dependencies.terminalRegistry?.resolveTerminal(parsed.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = monitoringStatus.getStatus(terminal);
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_status_failed' });
      }
    });
  }

  if (dependencies.monitoringProcessing) {
    const monitoringProcessing = dependencies.monitoringProcessing;
    app.get('/api/monitoring/processing', async (req, res) => {
      const parsed = parseMonitoringProcessingQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = dependencies.terminalRegistry?.resolveTerminal(parsed.terminalId) ?? null;
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = await monitoringProcessing.getProcessing(terminal);
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_processing_failed' });
      }
    });
  }

  if (dependencies.monitoringHistory) {
    const monitoringHistory = dependencies.monitoringHistory;

    app.get('/api/monitoring/receptions', async (req, res) => {
      const parsed = parseMonitoringReceptionQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const result = await monitoringHistory.listReceptions(parsed);
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_history_failed' });
      }
    });

    app.get('/api/monitoring/receptions/:id', async (req, res) => {
      const id = parseMonitoringReceptionIdParam(req.params.id);
      if (Object.keys(req.query).length > 0) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      if (id === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const result = await monitoringHistory.getReceptionById(id);
        if (result === null) {
          sendJsonNoStore(res, 404, { status: 'error', code: 'reception_not_found' });
          return;
        }
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_history_failed' });
      }
    });

    app.get('/api/monitoring/notification-outputs', async (req, res) => {
      const parsed = parseMonitoringNotificationOutputQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const result = await monitoringHistory.listNotificationOutputs(parsed);
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_history_failed' });
      }
    });

    app.get('/api/monitoring/notification-outputs/:id/reception', async (req, res) => {
      const id = parseMonitoringReceptionIdParam(req.params.id);
      if (id === null || Object.keys(req.query).length > 0) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const result = await monitoringHistory.getNotificationReceptionById(id);
        if (result.kind === 'not_found') {
          sendJsonNoStore(res, 404, { status: 'error', code: 'notification_output_not_found' });
        } else if (result.kind === 'unavailable') {
          sendJsonNoStore(res, 410, {
            status: 'error',
            code: 'notification_reception_unavailable',
            reason: result.reason,
          });
        } else {
          sendJsonNoStore(res, 200, result.response);
        }
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_history_failed' });
      }
    });

    app.get('/api/monitoring/operations', async (req, res) => {
      const parsed = parseMonitoringOperationQuery(req.query);
      if (parsed === null) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const result = await monitoringHistory.listOperations(parsed);
        sendJsonNoStore(res, 200, result);
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'monitoring_history_failed' });
      }
    });
  }

  if (dependencies.fetchControl) {
    const fetchControl = dependencies.fetchControl;

    const handleOperation = (kind: 'start' | 'stop' | 'force_refresh'): express.RequestHandler => {
      return (req, res) => {
        void (async () => {
          if (!fetchControl.isAvailable()) {
            sendJsonNoStore(res, 503, { status: 'error', code: 'fetch_control_unavailable' });
            return;
          }
          const parsed = parseFetchControlRequest(req.body);
          if (parsed === null) {
            sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
            return;
          }
          try {
            const outcome = await fetchControl.request(kind, parsed.requestId);
            if (outcome.kind === 'completed') {
              sendJsonNoStore(res, 200, outcome.response);
              return;
            }
            if (outcome.kind === 'in_progress') {
              sendJsonNoStore(res, 202, outcome.response);
              return;
            }
            if (outcome.kind === 'conflict') {
              sendJsonNoStore(res, 409, { status: 'error', code: 'operation_kind_conflict' });
              return;
            }
            sendJsonNoStore(res, 404, { status: 'error', code: 'unknown_request' });
          } catch {
            sendJsonNoStore(res, 500, { status: 'error', code: 'fetch_control_failed' });
          }
        })();
      };
    };

    app.post('/api/control/fetch/start', handleOperation('start'));
    app.post('/api/control/fetch/stop', handleOperation('stop'));
    app.post('/api/control/fetch/force-refresh', handleOperation('force_refresh'));

    app.get('/api/control/operations/:requestId', async (req, res) => {
      if (!fetchControl.isAvailable()) {
        sendJsonNoStore(res, 503, { status: 'error', code: 'fetch_control_unavailable' });
        return;
      }
      if (!isFetchControlRequestId(req.params.requestId) || Object.keys(req.query).length > 0) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      try {
        const outcome = fetchControl.find(req.params.requestId);
        if (outcome.kind === 'completed') {
          sendJsonNoStore(res, 200, outcome.response);
          return;
        }
        if (outcome.kind === 'in_progress') {
          sendJsonNoStore(res, 202, outcome.response);
          return;
        }
        sendJsonNoStore(res, 404, { status: 'error', code: 'unknown_request' });
      } catch {
        sendJsonNoStore(res, 500, { status: 'error', code: 'fetch_control_failed' });
      }
    });
  }

  // 不正 percent encoding は 400 invalid_request に正規化する（§3.1）
  // JSON 構文エラーは入力値を返さず、起動 API の契約どおり 400 に統一する。
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error instanceof URIError) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      if (error instanceof SyntaxError && 'body' in error) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      next(error);
    },
  );

  return app;
}
