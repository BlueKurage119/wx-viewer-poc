import express, { type Express } from 'express';
import {
  parseStartupNotificationRequest,
  parseWeatherApiQuery,
  resolveTerminalDefinition,
} from '@wx-viewer-poc/shared';
import type { StartupNotificationService } from './notifications/index.js';
import type { WeatherApiService } from './services/weatherApiService.js';

export interface AppDependencies {
  readonly startupNotifications?: StartupNotificationService;
  readonly weatherApi?: WeatherApiService;
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

  // JSON 構文エラーは入力値を返さず、起動 API の契約どおり 400 に統一する。
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error instanceof SyntaxError && 'body' in error) {
        res.status(400).json({ status: 'error', code: 'invalid_request' });
        return;
      }
      next(error);
    },
  );

  return app;
}
