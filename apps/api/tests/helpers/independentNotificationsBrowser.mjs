import './venueConfigPreload.ts';
import express from 'express';
import Database from 'better-sqlite3';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  createTestDatabasePairConfig,
} from './databasePair.ts';
import { createAlwaysOnTestPollingSchedule } from './pollingSchedule.ts';
import { startServer } from '../../src/server.ts';
import {
  recordNotificationOutputHistory,
  saveWarningCurrentSnapshot,
} from '../../src/repositories/index.ts';

const fixture = createTemporaryTestDatabaseFixture();
const pair = createTestDatabasePairConfig(fixture.config);
const apiPort = Number(process.env.WX_FIXTURE_API_PORT ?? 39153);
const webPort = Number(process.env.WX_FIXTURE_WEB_PORT ?? 39154);
const fixedNow = '2026-10-09T03:00:00.000Z';
let release;
let failed = false;
const gate = new Promise((resolve) => {
  release = resolve;
});
const fetchFn = async () => {
  await gate;
  return failed
    ? new Response('fixture failure', { status: 503 })
    : new Response(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>fixture</title><updated>2026-10-09T03:00:00Z</updated></feed>',
      );
};
const adapter = (source) => ({ source, runScheduled: async () => {}, runManual: async () => {} });
const starting = startServer({
  ...createTestServerDatabaseOptions(fixture.config),
  port: apiPort,
  enablePolling: true,
  pollingSchedule: createAlwaysOnTestPollingSchedule(),
  pollingServiceOptions: { clock: () => fixedNow, fetchFn },
  schedulerOptions: {
    now: () => new Date(fixedNow),
    adapters: ['nowcast', 'kikikuru', 'amedas'].map(adapter),
  },
});
let systemId = 0;
const system = () => {
  const retained = new Database(pair.retained.databasePath);
  try {
    recordNotificationOutputHistory(retained, {
      notificationId: `fixture-system-${++systemId}`,
      weatherDatabaseGenerationId: null,
      category: 'question',
      sourceType: 'fixture',
      sourceVersion: null,
      targetAreaJson: JSON.stringify([
        { kind: 'equipment', codeType: 'venue', code: 'east', name: '東地区' },
      ]),
      occurredAt: fixedNow,
      detectedAt: fixedNow,
      changeType: 'fixture',
      ackRequired: true,
      summary: '検収用システム通知',
      relatedRefsJson: '[]',
      origin: 'system',
      detectionContext: 'initial',
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
    });
  } finally {
    retained.close();
  }
};
const app = express();
app.post('/__fixture/system', (_req, res) => {
  system();
  res.json({ status: 'ok' });
});
app.post('/__fixture/ready', (_req, res) => {
  const weather = new Database(pair.weather.databasePath);
  try {
    saveWarningCurrentSnapshot(weather, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'fixture',
        issuedAt: fixedNow,
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: fixedNow,
        lastSuccessAt: fixedNow,
        availability: 'available',
        sourceVersion: 'fixture-1',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: 'fixture',
        reportDateTime: fixedNow,
        controlDateTime: fixedNow,
      },
      items: [
        {
          sequence: 1,
          kindCode: '02',
          kindName: '暴風警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          significancyCode: null,
          significancyName: null,
          warningLevel: null,
          attentionText: null,
          kindIssuedAt: fixedNow,
          sourceTelegram: 'VPWW53',
        },
      ],
    });
  } finally {
    weather.close();
  }
  failed = false;
  release();
  res.json({ status: 'ok' });
});
app.post('/__fixture/fail', (_req, res) => {
  failed = true;
  release();
  res.json({ status: 'ok' });
});
app.use('/api', (req, res) => {
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      path: req.originalUrl,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).end();
  });
  req.pipe(upstream);
});
const dist = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
const server = app.listen(webPort, '127.0.0.1', () => {
  system();
  console.log(`検収PID ${process.pid}、一時DB ${fixture.config.databasePath}`);
  console.log(`検収URL http://127.0.0.1:${webPort}/kkeagh01 と /hkeagh01`);
  console.log('制御POST /__fixture/ready、/__fixture/fail、/__fixture/system。終了はSIGTERM。');
});
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  failed = true;
  release();
  const api = await starting;
  await api.close();
  await new Promise((resolve) => server.close(resolve));
  fixture.cleanup();
  console.log('検収fixture終了: DB/leaseを解放し一時ディレクトリを削除しました。');
};
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
