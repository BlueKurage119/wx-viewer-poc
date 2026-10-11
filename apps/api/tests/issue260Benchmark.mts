import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Worker } from 'node:worker_threads';
import { startServer } from '../src/server.js';
import {
  initializeTestDatabases,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import { mergeRadarSnapshot, upsertRadarTile } from '../src/repositories/index.js';

const seed = 260;
const count = 50_000;
const tileCount = 1_024;
const time = '2026-10-11T00:00:00.000Z';
const durationSeconds = Number(process.env.BENCH_DURATION_SECONDS ?? 60);
const requests = Number(process.env.BENCH_REQUESTS ?? 100);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 1);
const rate = Number(process.env.BENCH_RATE ?? 10);
const seriesName = process.env.BENCH_SERIES ?? 'health';
const output = process.env.BENCH_OUTPUT;
if (
  !output ||
  !Number.isInteger(requests) ||
  requests < 100 ||
  ![1, 8].includes(concurrency) ||
  ![1, 10].includes(rate) ||
  !['health', 'monitoring', 'systemDelta', 'weather', 'tileHit'].includes(seriesName) ||
  durationSeconds < 60
) {
  throw new Error(
    'BENCH_OUTPUT、BENCH_REQUESTS>=100、BENCH_CONCURRENCY=1|8、BENCH_RATE=1|10、BENCH_SERIES、BENCH_DURATION_SECONDS>=60 を指定してください。',
  );
}

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
function quantile(values: number[], probability: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * probability) - 1] ?? null;
}

const directory = mkdtempSync(join(tmpdir(), 'wx260-benchmark-'));
const config = {
  databasePath: join(directory, 'weather.sqlite3'),
  migrationsDirectory: join(import.meta.dirname, '../migrations'),
};
const options = createTestServerDatabaseOptions(config);
const raw = `<Report seed="${seed}"><Body>${'A'.repeat(1_024 - 41)}</Body></Report>`;
if (Buffer.byteLength(raw) !== 1_024) throw new Error(`原文長が不正: ${Buffer.byteLength(raw)}`);
const png = png64KiB();
const pngHash = createHash('sha256').update(png).digest('hex');
const rawHash = createHash('sha256').update(raw).digest('hex');
const results: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  seed,
  environment: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuCount: cpus().length,
    totalmem: totalmem(),
    node: process.version,
  },
  config: { requests, concurrency, rate, seriesName, durationSeconds },
  fixture: {
    receptionCount: count,
    rawBytesEach: 1_024,
    rawHash,
    tileCount,
    tileBytesEach: png.length,
    pngHash,
  },
};
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let acquisitionWorker: Worker | undefined;
try {
  const pair = initializeTestDatabases(config);
  try {
    const insert = pair.weather.connection.prepare(`INSERT INTO telegram_reception
      (document_url, telegram_type, control_status, received_at, raw_body, body_bytes)
      VALUES (?, 'VPWS50', ?, ?, ?, 1024)`);
    pair.weather.connection.transaction(() => {
      for (let i = 0; i < count; i++) {
        insert.run(
          `https://example.invalid/fixture/${seed}/${i}`,
          ['normal', 'training', 'test'][i % 3],
          time,
          raw,
        );
      }
    })();
    mergeRadarSnapshot(pair.weather.connection, {
      product: 'N1',
      metadata: {
        source: 'test',
        issuedAt: time,
        validAt: time,
        validFrom: time,
        validTo: time,
        fetchedAt: time,
        lastSuccessAt: time,
        availability: 'available',
        sourceVersion: String(seed),
      },
      frames: [{ baseTime: time, validTime: time, element: 'hrpns', member: 'none', sequence: 0 }],
    });
    for (let i = 0; i < tileCount; i++) {
      const x = i % 32;
      const y = Math.floor(i / 32);
      const filePath = `benchmark/${x}-${y}.png`;
      const fullPath = join(options.nowcastCacheRoot, filePath);
      mkdirSync(join(options.nowcastCacheRoot, 'benchmark'), { recursive: true });
      writeFileSync(fullPath, png);
      upsertRadarTile(
        pair.weather.connection,
        { product: 'N1', baseTime: time, validTime: time, element: 'hrpns', member: 'none' },
        {
          zoom: 10,
          tileX: x,
          tileY: y,
          filePath,
          byteSize: png.length,
          contentHash: pngHash,
          storedAt: time,
        },
      );
    }
    results.database = {
      sqliteVersion: pair.weather.connection.prepare('SELECT sqlite_version() AS version').get(),
      weatherJournalMode: pair.weather.connection.prepare('PRAGMA journal_mode').get(),
      retainedJournalMode: pair.retained.connection.prepare('PRAGMA journal_mode').get(),
      controlStatusCounts: pair.weather.connection
        .prepare(
          'SELECT control_status, COUNT(*) AS count FROM telegram_reception GROUP BY control_status ORDER BY control_status',
        )
        .all(),
    };
  } finally {
    pair.close();
  }
  results.fixture = {
    ...(results.fixture as object),
    weatherDbBytes: statSync(config.databasePath).size,
    retainedDbBytes: statSync(options.config.retained.databasePath).size,
  };
  results.stage = 'fixture_created';
  writeFileSync(output, JSON.stringify(results, null, 2));
  server = await startServer({
    ...options,
    port: 0,
    enablePolling: false,
    acquisitionWorkerEntry: new URL('./fixtures/worker/load.ts', import.meta.url),
    onAcquisitionWorkerCreated: (worker) => {
      acquisitionWorker = worker;
    },
  });
  if (!acquisitionWorker) throw new Error('取得 Worker が作成されませんでした。');
  const activeWorker: Worker = acquisitionWorker;
  const loadStarted = performance.now();
  let measurementCompleted = false;
  const parserLoad = (async () => {
    let iterations = 0;
    let runs = 0;
    while (performance.now() - loadStarted < durationSeconds * 1000 || !measurementCompleted) {
      const result = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('XML 負荷の終了待機が期限切れ')), 10_000);
        const onMessage = (message: { test?: string; iterations?: number }) => {
          if (message.test !== 'load-ended') return;
          clearTimeout(timer);
          activeWorker.off('message', onMessage);
          resolve(message.iterations ?? 0);
        };
        activeWorker.on('message', onMessage);
        activeWorker.postMessage({ test: 'xml-load' });
      });
      iterations += result;
      runs++;
    }
    return {
      runs,
      iterations,
      elapsedMs: performance.now() - loadStarted,
      eventLoopUtilization: activeWorker.performance.eventLoopUtilization(),
    };
  })().then(
    (value) => ({ ok: true, ...value }),
    (error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  const root = `http://127.0.0.1:${server.port}`;
  const paths: Record<string, string> = {
    health: '/api/health',
    monitoring: '/api/monitoring/status?terminalId=hkeagh01',
    systemDelta: '/api/notifications/delta?origin=system&terminalId=hkeagh01',
    weather: '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
    tileHit: `/api/weather/nowcast/N1/tiles/10/0/0.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${time}&validTime=${time}`,
  };
  const samples: Record<
    string,
    {
      offsetMs: number;
      latencyMs: number;
      status: number | null;
      bytes: number;
      error: string | null;
    }[]
  > = {};
  for (const [name, path] of Object.entries(paths).filter(([name]) => name === seriesName)) {
    const series: (typeof samples)[string] = [];
    for (let offset = 0; offset < requests; offset += concurrency) {
      const scheduled = loadStarted + (offset / rate) * 1000;
      const wait = scheduled - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await Promise.all(
        Array.from({ length: Math.min(concurrency, requests - offset) }, async () => {
          const started = performance.now();
          try {
            const response = await fetch(root + path, { signal: AbortSignal.timeout(30_000) });
            const body = await response.arrayBuffer();
            series.push({
              offsetMs: started - loadStarted,
              latencyMs: performance.now() - started,
              status: response.status,
              bytes: body.byteLength,
              error: null,
            });
          } catch (error) {
            series.push({
              offsetMs: started - loadStarted,
              latencyMs: performance.now() - started,
              status: null,
              bytes: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );
    }
    samples[name] = series;
  }
  measurementCompleted = true;
  results.series = Object.fromEntries(
    Object.entries(samples).map(([name, entries]) => {
      const latencies = entries.map((entry) => entry.latencyMs);
      return [
        name,
        {
          entries,
          p50: quantile(latencies, 0.5),
          p95: quantile(latencies, 0.95),
          p99: quantile(latencies, 0.99),
          max: Math.max(...latencies),
          failures: entries.filter((entry) => entry.status !== 200).length,
        },
      ];
    }),
  );
  const loadResult = await parserLoad;
  results.parserLoad = loadResult;
  results.stage = loadResult.ok ? 'measurement_completed' : 'load_failed';
  results.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(results, null, 2));
} finally {
  await server?.close();
  rmSync(directory, { recursive: true, force: true });
}
