import express, { type Express } from 'express';
import {
  parseKikikuruTileRequest,
  parseNowcastTileRequest,
  parseStartupNotificationRequest,
  parseWeatherApiQuery,
  resolveTerminalDefinition,
} from '@wx-viewer-poc/shared';
import type { StartupNotificationService } from './notifications/index.js';
import type { WeatherApiService } from './services/weatherApiService.js';
import type { NowcastApiService } from './services/nowcastApiService.js';
import type { KikikuruApiService } from './services/kikikuruApiService.js';
import { ImageServicesInitializingError } from './services/tileApiSupport.js';

export interface AppDependencies {
  readonly startupNotifications?: StartupNotificationService;
  readonly weatherApi?: WeatherApiService;
  readonly nowcastApi?: NowcastApiService;
  readonly kikikuruApi?: KikikuruApiService;
}

function sendJsonNoStore(res: express.Response, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(body));
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  if (dependencies.weatherApi) {
    const weatherApi = dependencies.weatherApi;

    app.get('/api/weather/warnings', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getWarnings(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/warning-timeseries', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getWarningTimeseries(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/early-warning', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getEarlyWarning(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/area-timeseries', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getAreaTimeseries(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/amedas', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getAmedas(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });

    app.get('/api/weather/bulletins', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = weatherApi.getBulletins(terminal, parsed.value.controlStatus);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'weather_read_failed' });
      }
    });
  }

  if (dependencies.startupNotifications) {
    const startupNotifications = dependencies.startupNotifications;
    app.post('/api/notifications/startup', (req, res) => {
      if (!req.is('application/json')) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const parsed = parseStartupNotificationRequest(req.body);
      if (parsed === null) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.terminalId);
      if (terminal === null) {
        res.status(404).json({ status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = startupNotifications.inquire({
          terminalId: parsed.terminalId,
          venueId: terminal.venueId,
          sessionId: parsed.sessionId,
          inquiredAt: new Date().toISOString(),
        });
        res.status(result.status === 'initializing' ? 202 : 200).json(result);
      } catch {
        res.status(500).json({ status: 'error', code: 'startup_notification_failed' });
      }
    });
  }

  if (dependencies.nowcastApi) {
    const nowcastApi = dependencies.nowcastApi;

    app.get('/api/weather/nowcast/times', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = nowcastApi.getTimes(terminal, parsed.value.controlStatus);
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
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
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

    app.get('/api/weather/kikikuru/times', (req, res) => {
      const parsed = parseWeatherApiQuery(req.query);
      if (!parsed.ok) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
      if (terminal === null) {
        sendJsonNoStore(res, 404, { status: 'error', code: 'terminal_not_found' });
        return;
      }
      try {
        const result = kikikuruApi.getTimes(terminal, parsed.value.controlStatus);
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
      const terminal = resolveTerminalDefinition(parsed.value.terminalId);
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

  // 不正 percent encoding は 400 invalid_request に正規化する（§3.1）
  // JSON 構文エラーは入力値を返さず、起動 API の契約どおり 400 に統一する。
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error instanceof URIError) {
        sendJsonNoStore(res, 400, { status: 'error', code: 'invalid_request' });
        return;
      }
      if (error instanceof SyntaxError && 'body' in error) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      next(error);
    },
  );

  return app;
}
