import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DOMParser } from '@xmldom/xmldom';
import Database from 'better-sqlite3';
import type { Worker } from 'node:worker_threads';
import { createRealPollFixture } from './issue260RealPollFixture.mjs';

const root = resolve(process.env.BENCH_ROOT ?? '.');
const mode = process.env.BENCH_MODE!;
const output = process.env.BENCH_OUTPUT!;
const fixedItems = Number(process.env.BENCH_FIXED_ITEMS ?? 0);
const realPoll = process.env.BENCH_REAL_POLL === '1';
const series = process.env.BENCH_SERIES ?? 'health';
if (
  !root ||
  !['old', 'new'].includes(mode) ||
  !output ||
  !Number.isInteger(fixedItems) ||
  fixedItems < 1 ||
  !['health', 'monitoring', 'systemDelta', 'weather', 'tileHit'].includes(series)
)
  throw new Error('BENCH_ROOT、BENCH_MODE、BENCH_OUTPUT、BENCH_FIXED_ITEMS を指定');
const imp = async (relative: string) => import(pathToFileURL(join(root, relative)).href);
const { startServer } = await imp('apps/api/src/server.ts');
const { initializeTestDatabases, createTestServerDatabaseOptions } = await imp(
  'apps/api/tests/helpers/databasePair.ts',
);
const { mergeRadarSnapshot, upsertRadarTile } = await imp('apps/api/src/repositories/index.ts');
const { saveWarningCurrentSnapshot } = await imp(
  'apps/api/src/repositories/warningCurrentRepository.ts',
);
const { createTestPollingSchedule } = await imp('apps/api/tests/helpers/pollingSchedule.ts');
const directory = mkdtempSync(join(tmpdir(), 'wx260-dual-'));
const config = {
  databasePath: join(directory, 'weather.sqlite3'),
  migrationsDirectory: join(root, 'apps/api/migrations'),
};
const options = createTestServerDatabaseOptions(config);
const raw = `<Report seed="260"><Body>${'A'.repeat(1_024 - 41)}</Body></Report>`;
const tileTime = process.env.BENCH_TILE_TIME ?? new Date().toISOString();
function crc32(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function png64KiB() {
  const base = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const data = Buffer.alloc(65_536 - base.length - 12, 65);
  data[0] = 107;
  data[1] = 0;
  const name = Buffer.from('tEXt');
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), chunk.length - 4);
  return Buffer.concat([base.subarray(0, -12), chunk, base.subarray(-12)]);
}
const png = png64KiB();
const pngHash = createHash('sha256').update(png).digest('hex');
const pollFixture = realPoll && mode === 'old' ? createRealPollFixture(fixedItems) : undefined;
const results: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  mode,
  series,
  workload: realPoll ? 'real_poll' : 'synthetic_parser',
  rootCommit: process.env.BENCH_COMMIT ?? '未指定',
  requestPlan: { count: 600, intervalMs: 100, timeoutMs: 30_000, oldYieldEvery: 25, fixedItems },
  environment: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuCount: cpus().length,
    totalmem: totalmem(),
    node: process.version,
  },
  fixture: {
    seed: 260,
    receptionCount: 50_000,
    rawBytes: Buffer.byteLength(raw),
    rawHash: createHash('sha256').update(raw).digest('hex'),
    tileCount: 1_024,
    tileBytes: 65_536,
    tileTime,
    pngHash,
    telegramType: 'VPXX99',
  },
};
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let acquisitionWorker: Worker | undefined;
let rssSampler: NodeJS.Timeout | undefined;
try {
  const pair = initializeTestDatabases(config);
  try {
    const insert = pair.weather.connection.prepare(`INSERT INTO telegram_reception
      (document_url, telegram_type, control_status, received_at, raw_body, body_bytes)
      VALUES (?, 'VPXX99', ?, ?, ?, 1024)`);
    pair.weather.connection.transaction(() => {
      for (let i = 0; i < 50_000; i++)
        insert.run(
          `https://example.invalid/fixture/260/${i}`,
          ['normal', 'training', 'test'][i % 3],
          '2026-10-11T00:00:00.000Z',
          raw,
        );
    })();
    if (series === 'weather') {
      saveWarningCurrentSnapshot(pair.weather.connection, {
        areaCode: '1310800',
        areaName: '江東区',
        metadata: {
          source: 'benchmark',
          issuedAt: tileTime,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: tileTime,
          lastSuccessAt: tileTime,
          availability: 'available',
          sourceVersion: '260',
        },
        telegram: {
          controlStatus: 'normal',
          infoType: '発表',
          eventId: null,
          reportDateTime: tileTime,
          controlDateTime: tileTime,
        },
        items: [
          {
            sequence: 1,
            kindCode: '03',
            kindName: '大雨警報',
            kindStatus: '発表',
            lastKindCode: null,
            lastKindName: null,
            significancyCode: null,
            significancyName: null,
            warningLevel: null,
            attentionText: null,
            kindIssuedAt: tileTime,
            sourceTelegram: 'VPWW53',
          },
        ],
      });
    }
    mergeRadarSnapshot(pair.weather.connection, {
      product: 'N1',
      metadata: {
        source: 'test',
        issuedAt: tileTime,
        validAt: tileTime,
        validFrom: tileTime,
        validTo: tileTime,
        fetchedAt: tileTime,
        lastSuccessAt: tileTime,
        availability: 'available',
        sourceVersion: '260',
      },
      frames: [
        { baseTime: tileTime, validTime: tileTime, element: 'hrpns', member: 'none', sequence: 0 },
      ],
    });
    mkdirSync(join(options.nowcastCacheRoot, 'benchmark'), { recursive: true });
    for (let i = 0; i < 1_024; i++) {
      const x = i % 32,
        y = Math.floor(i / 32);
      const filePath = `benchmark/${x}-${y}.png`;
      writeFileSync(join(options.nowcastCacheRoot, filePath), png);
      upsertRadarTile(
        pair.weather.connection,
        {
          product: 'N1',
          baseTime: tileTime,
          validTime: tileTime,
          element: 'hrpns',
          member: 'none',
        },
        {
          zoom: 10,
          tileX: x,
          tileY: y,
          filePath,
          byteSize: 65_536,
          contentHash: pngHash,
          storedAt: tileTime,
        },
      );
    }
    results.database = {
      sqliteVersion: pair.weather.connection.prepare('SELECT sqlite_version() AS version').get(),
      weatherJournalMode: pair.weather.connection.prepare('PRAGMA journal_mode').get(),
      retainedJournalMode: pair.retained.connection.prepare('PRAGMA journal_mode').get(),
      receptionCount: pair.weather.connection
        .prepare('SELECT COUNT(*) AS count FROM telegram_reception')
        .get(),
    };
  } finally {
    pair.close();
  }
  results.fixture = {
    ...(results.fixture as object),
    weatherDbBytes: statSync(config.databasePath).size,
    retainedDbBytes: statSync(options.config.retained.databasePath).size,
  };
  const schedule = createTestPollingSchedule();
  const disabledSchedule = {
    ...schedule,
    periods: schedule.periods.map((period: Record<string, unknown>) => ({
      ...period,
      xmlSeconds: null,
      imageCatalogSeconds: null,
      amedasSeconds: null,
      nowcastEnabled: false,
      kikikuruEnabled: false,
    })),
  };
  server = await startServer({
    ...options,
    port: 0,
    enablePolling: true,
    pollingSchedule: disabledSchedule,
    pollingServiceOptions: {
      clock: () => tileTime,
      ...(pollFixture ? { fetchFn: pollFixture.fetchFn } : {}),
    },
    ...(mode === 'new'
      ? {
          acquisitionWorkerEntry: pathToFileURL(
            join(
              process.cwd(),
              realPoll
                ? 'apps/api/tests/fixtures/worker/issue260-real-poll.ts'
                : 'apps/api/tests/fixtures/worker/issue260-compare-load.ts',
            ),
          ),
          onAcquisitionWorkerCreated: (worker: Worker) => {
            acquisitionWorker = worker;
          },
        }
      : {}),
  });
  if (mode === 'new') {
    const prepared = await (
      server as typeof server & { weatherPrepared: Promise<{ status: string }> }
    ).weatherPrepared;
    if (prepared.status !== 'ready' || !acquisitionWorker) throw new Error('取得 Worker 準備失敗');
  }
  const preflightPaths: Record<string, string> = {
    health: '/api/health',
    monitoring: '/api/monitoring/status?terminalId=hkeagh01',
    systemDelta: '/api/notifications/delta?origin=system&terminalId=hkeagh01',
    weather: '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
    tileHit: `/api/weather/nowcast/N1/tiles/10/0/0.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${tileTime}&validTime=${tileTime}`,
  };
  const preflight = await fetch(`http://127.0.0.1:${server.port}` + preflightPaths[series]);
  const preflightBody = await preflight.arrayBuffer();
  results.preflight = {
    status: preflight.status,
    bytes: preflightBody.byteLength,
    bodyHash: createHash('sha256').update(Buffer.from(preflightBody)).digest('hex'),
    tileResult: preflight.headers.get('x-wx-tile-result'),
    body:
      preflight.status === 200 ? null : Buffer.from(preflightBody).toString('utf8').slice(0, 200),
  };
  if (
    preflight.status !== 200 ||
    (series === 'tileHit' && preflight.headers.get('x-wx-tile-result') !== 'cached')
  )
    throw new Error('計測前のAPI応答が想定と異なる');
  const cpuBefore = process.cpuUsage();
  const rssBefore = process.memoryUsage().rss;
  let rssPeakDuring = rssBefore;
  rssSampler = setInterval(() => {
    rssPeakDuring = Math.max(rssPeakDuring, process.memoryUsage().rss);
  }, 100);
  const started = performance.now();
  const clientFile = join(directory, 'client.json');
  const client = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./issue260CompareClient.mjs', import.meta.url)),
      String(server.port),
      clientFile,
      series,
      tileTime,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const clientExited = new Promise<number | null>((resolve) => client.on('exit', resolve));
  let clientError = '';
  client.stderr.on('data', (chunk: Buffer) => {
    clientError += chunk.toString();
  });
  let items = 0;
  let loadCpuMs = 0;
  let pollOperation: Record<string, unknown> | undefined;
  if (realPoll) {
    if (mode === 'old') pollFixture!.activate();
    else {
      await new Promise<void>((resolve, reject) => {
        const worker = acquisitionWorker!;
        const timeout = setTimeout(
          () => reject(new Error('実取得fixture有効化の期限切れ')),
          10_000,
        );
        const onMessage = (message: { test?: string }) => {
          if (message.test !== 'issue260-real-poll-active') return;
          clearTimeout(timeout);
          worker.off('message', onMessage);
          resolve();
        };
        worker.on('message', onMessage);
        worker.postMessage({ test: 'issue260-real-poll-activate' });
      });
    }
    const requestId = randomUUID();
    const operation = await fetch(
      `http://127.0.0.1:${server.port}/api/control/fetch/force-refresh`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      },
    );
    pollOperation = { status: operation.status, body: await operation.json() };
    if (operation.status === 202) {
      const limit = Date.now() + 60_000;
      while (Date.now() < limit) {
        const query = await fetch(
          `http://127.0.0.1:${server.port}/api/control/operations/${requestId}`,
        );
        const body = await query.json();
        pollOperation = { status: query.status, body };
        if (query.status !== 202) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const read = new Database(config.databasePath, { readonly: true });
    try {
      items = (
        read
          .prepare(
            "SELECT COUNT(*) AS count FROM telegram_reception WHERE telegram_type = 'VPWW55'",
          )
          .get() as { count: number }
      ).count;
    } finally {
      read.close();
    }
  } else if (mode === 'old') {
    const telegram = `<Report><Body>${'<Item><Area>固定負荷資料</Area><Value>123</Value></Item>'.repeat(500)}</Body></Report>`;
    while (items < fixedItems) {
      for (let i = 0; i < Math.min(25, fixedItems - items); i++)
        new DOMParser().parseFromString(telegram, 'text/xml');
      items += Math.min(25, fixedItems - items);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } else {
    const worker: Worker = acquisitionWorker!;
    while (items < fixedItems) {
      const message = await new Promise<{ items: number; cpuMs: number }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker 負荷期限切れ')), 20_000);
        const onMessage = (
          value: Partial<{ test: string; items: number; cpuMs: number; error: string }>,
        ) => {
          if (value.test !== 'load-ended' && value.test !== 'load-failed') return;
          clearTimeout(timeout);
          worker.off('message', onMessage);
          if (value.test === 'load-failed') reject(new Error(value.error));
          else resolve({ items: value.items ?? 0, cpuMs: value.cpuMs ?? 0 });
        };
        worker.on('message', onMessage);
        worker.postMessage({
          test: 'issue260-load',
          kind: 'parser',
          count: Math.min(1000, fixedItems - items),
        });
      });
      items += message.items;
      loadCpuMs += message.cpuMs;
    }
  }
  const loadEndedMs = performance.now() - started;
  const clientExit = await clientExited;
  clearInterval(rssSampler);
  rssPeakDuring = Math.max(rssPeakDuring, process.memoryUsage().rss);
  const cpu = process.cpuUsage(cpuBefore);
  const clientData = JSON.parse((await import('node:fs')).readFileSync(clientFile, 'utf8')) as {
    samples: Array<{ latencyMs: number; status: number | null }>;
  };
  const latency = clientData.samples
    .map((sample) => sample.latencyMs)
    .sort((a: number, b: number) => a - b);
  const quantile = (fraction: number) => latency[Math.ceil(latency.length * fraction) - 1];
  results.measurement = {
    loadItems: items,
    pollOperation,
    loadEndedMs,
    loadCpuMs: realPoll ? null : mode === 'new' ? loadCpuMs : null,
    processCpuMs: (cpu.user + cpu.system) / 1000,
    processCpuUserMs: cpu.user / 1000,
    processCpuSystemMs: cpu.system / 1000,
    rssBefore,
    rssAfter: process.memoryUsage().rss,
    rssPeakDuring,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    clientExit,
    clientError,
    requests: latency.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
    maxMs: latency.at(-1),
    failures: clientData.samples.filter((sample) => sample.status !== 200).length,
    clientSamples: clientData.samples,
  };
  results.judgment = {
    validDuration: loadEndedMs >= 60_000,
    validRequestCount: latency.length === 600,
    clientExited: clientExit === 0,
  };
  results.finishedAt = new Date().toISOString();
  results.stage =
    (realPoll ? items === fixedItems : loadEndedMs >= 60_000) &&
    latency.length === 600 &&
    clientExit === 0
      ? 'completed'
      : 'invalid';
  if (results.stage !== 'completed') process.exitCode = 1;
} catch (error) {
  results.stage = 'failed';
  results.error = error instanceof Error ? error.stack : String(error);
  results.finishedAt = new Date().toISOString();
  process.exitCode = 1;
} finally {
  if (rssSampler) clearInterval(rssSampler);
  writeFileSync(output, JSON.stringify(results, null, 2));
  await server?.close();
  rmSync(directory, { recursive: true, force: true });
}
