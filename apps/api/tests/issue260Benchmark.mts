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
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

const seed = 260;
const count = 50_000;
const tileCount = 1_024;
const time = '2026-10-11T00:00:00.000Z';
// 提供 Worker は実時刻を使うため、タイル時刻を表示窓内に置く。
const tileTime = new Date().toISOString();
const durationSeconds = Number(process.env.BENCH_DURATION_SECONDS ?? 60);
const requests = Number(process.env.BENCH_REQUESTS ?? 100);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 1);
const rate = Number(process.env.BENCH_RATE ?? 10);
const seriesName = process.env.BENCH_SERIES ?? 'health';
const loadKind = process.env.BENCH_LOAD ?? 'parser';
const effectiveRequests = Math.max(requests, Math.ceil(rate * durationSeconds));
const output = process.env.BENCH_OUTPUT;
if (
  !output ||
  !Number.isInteger(requests) ||
  requests < 100 ||
  ![1, 8].includes(concurrency) ||
  ![1, 10].includes(rate) ||
  !['health', 'monitoring', 'systemDelta', 'weather', 'tileHit'].includes(seriesName) ||
  !['parser', 'write', 'recovery'].includes(loadKind) ||
  durationSeconds < 60
) {
  throw new Error(
    'BENCH_OUTPUT、BENCH_REQUESTS>=100、BENCH_CONCURRENCY=1|8、BENCH_RATE=1|10、BENCH_SERIES、BENCH_LOAD=parser|write|recovery、BENCH_DURATION_SECONDS>=60 を指定してください。',
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
  config: {
    requestedMinimum: requests,
    requests: effectiveRequests,
    concurrency,
    rate,
    seriesName,
    loadKind,
    durationSeconds,
  },
  fixture: {
    receptionCount: count,
    rawBytesEach: 1_024,
    rawHash,
    tileCount,
    tileBytesEach: png.length,
    pngHash,
    tileTime,
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
        issuedAt: tileTime,
        validAt: tileTime,
        validFrom: tileTime,
        validTo: tileTime,
        fetchedAt: tileTime,
        lastSuccessAt: tileTime,
        availability: 'available',
        sourceVersion: String(seed),
      },
      frames: [
        { baseTime: tileTime, validTime: tileTime, element: 'hrpns', member: 'none', sequence: 0 },
      ],
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
          byteSize: png.length,
          contentHash: pngHash,
          storedAt: tileTime,
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
    enablePolling: true,
    pollingSchedule: (() => {
      const schedule = createTestPollingSchedule();
      return {
        ...schedule,
        periods: schedule.periods.map((period) => ({
          ...period,
          xmlSeconds: null,
          imageCatalogSeconds: null,
          amedasSeconds: null,
          nowcastEnabled: false,
          kikikuruEnabled: false,
        })),
      };
    })(),
    pollingServiceOptions: { clock: () => time },
    acquisitionWorkerEntry: new URL('./fixtures/worker/issue260-load.ts', import.meta.url),
    onAcquisitionWorkerCreated: (worker) => {
      acquisitionWorker = worker;
    },
  });
  const preparation = await server.weatherPrepared;
  if (preparation.status !== 'ready')
    throw new Error(`気象 Worker の準備失敗: ${preparation.status}`);
  if (!acquisitionWorker) throw new Error('取得 Worker が作成されませんでした。');
  const activeWorker: Worker = acquisitionWorker;
  const loadStarted = performance.now();
  let measurementCompleted = false;
  let firstStartedResolve!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstStartedResolve = resolve;
  });
  const workerLoad = (async () => {
    let items = 0;
    let cpuMs = 0;
    let busyMs = 0;
    let runs = 0;
    while (performance.now() - loadStarted < durationSeconds * 1000 || !measurementCompleted) {
      const result = await new Promise<{ items: number; cpuMs: number; elapsedMs: number }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`${loadKind} 負荷の終了待機が期限切れ`)),
            loadKind === 'recovery' ? 180_000 : 20_000,
          );
          const onMessage = (message: {
            test?: string;
            items?: number;
            cpuMs?: number;
            elapsedMs?: number;
            error?: string;
          }) => {
            if (message.test === 'load-started' && runs === 0) firstStartedResolve();
            if (message.test !== 'load-ended' && message.test !== 'load-failed') return;
            clearTimeout(timer);
            activeWorker.off('message', onMessage);
            if (message.test === 'load-failed')
              reject(new Error(message.error ?? `${loadKind} 負荷が失敗`));
            else
              resolve({
                items: message.items ?? 0,
                cpuMs: message.cpuMs ?? 0,
                elapsedMs: message.elapsedMs ?? 0,
              });
          };
          activeWorker.on('message', onMessage);
          activeWorker.postMessage({ test: 'issue260-load', kind: loadKind });
        },
      );
      items += result.items;
      cpuMs += result.cpuMs;
      busyMs += result.elapsedMs;
      runs++;
    }
    return {
      runs,
      items,
      cpuMs,
      busyMs,
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
  await Promise.race([
    firstStarted,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${loadKind} 負荷の開始待機が期限切れ`)), 10_000),
    ),
  ]);
  const root = `http://127.0.0.1:${server.port}`;
  const paths: Record<string, string> = {
    health: '/api/health',
    monitoring: '/api/monitoring/status?terminalId=hkeagh01',
    systemDelta: '/api/notifications/delta?origin=system&terminalId=hkeagh01',
    weather: '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
    tileHit: `/api/weather/nowcast/N1/tiles/10/0/0.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${tileTime}&validTime=${tileTime}`,
  };
  const samples: Record<
    string,
    {
      offsetMs: number;
      latencyMs: number;
      status: number | null;
      bytes: number;
      tileResult: string | null;
      responseBody: string | null;
      error: string | null;
    }[]
  > = {};
  for (const [name, path] of Object.entries(paths).filter(([name]) => name === seriesName)) {
    const series: (typeof samples)[string] = [];
    for (let offset = 0; offset < effectiveRequests; offset += concurrency) {
      const scheduled = loadStarted + (offset / rate) * 1000;
      const wait = scheduled - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await Promise.all(
        Array.from({ length: Math.min(concurrency, effectiveRequests - offset) }, async () => {
          const started = performance.now();
          try {
            const response = await fetch(root + path, { signal: AbortSignal.timeout(30_000) });
            const body = await response.arrayBuffer();
            const tileResult = response.headers.get('x-wx-tile-result');
            series.push({
              offsetMs: started - loadStarted,
              latencyMs: performance.now() - started,
              status: response.status,
              bytes: body.byteLength,
              tileResult,
              responseBody:
                response.status !== 200 ? Buffer.from(body).toString('utf8').slice(0, 500) : null,
              error: null,
            });
          } catch (error) {
            series.push({
              offsetMs: started - loadStarted,
              latencyMs: performance.now() - started,
              status: null,
              bytes: 0,
              tileResult: null,
              responseBody: null,
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
      const offsets = entries.map((entry) => entry.offsetMs);
      const firstOffsetMs = Math.min(...offsets);
      const lastOffsetMs = Math.max(...offsets);
      const observedWindowSeconds =
        (lastOffsetMs - firstOffsetMs + (concurrency / rate) * 1000) / 1000;
      return [
        name,
        {
          entries,
          p50: quantile(latencies, 0.5),
          p95: quantile(latencies, 0.95),
          p99: quantile(latencies, 0.99),
          max: Math.max(...latencies),
          failures: entries.filter((entry) => entry.status !== 200).length,
          firstOffsetMs,
          lastOffsetMs,
          observedRate: entries.length / observedWindowSeconds,
        },
      ];
    }),
  );
  const loadResult = await workerLoad;
  results.workerLoad = loadResult;
  const entries = samples[seriesName] ?? [];
  const firstOffsetMs = Math.min(...entries.map((entry) => entry.offsetMs));
  const lastOffsetMs = Math.max(...entries.map((entry) => entry.offsetMs));
  const observedWindowSeconds = (lastOffsetMs - firstOffsetMs + (concurrency / rate) * 1000) / 1000;
  const observedRate = entries.length / observedWindowSeconds;
  const targetMs = {
    health: 500,
    monitoring: 1000,
    systemDelta: 2000,
    weather: 2000,
    tileHit: 2000,
  }[seriesName]!;
  const reasons: string[] = [];
  if (
    !('elapsedMs' in loadResult) ||
    loadResult.elapsedMs < durationSeconds * 1000 ||
    loadResult.busyMs < durationSeconds * 1000 ||
    loadResult.items < 1 ||
    loadResult.cpuMs < 1
  )
    reasons.push(`${loadKind}_load_failed`);
  if (entries.length !== effectiveRequests) reasons.push('request_count_mismatch');
  if (entries.some((entry) => entry.status !== 200 || entry.bytes < 1))
    reasons.push('http_failure');
  if (seriesName === 'tileHit' && entries.some((entry) => entry.tileResult !== 'cached'))
    reasons.push('tile_cache_hit_not_confirmed');
  if (entries.some((entry) => entry.latencyMs > targetMs)) reasons.push('latency_target_exceeded');
  if (observedRate < rate * 0.95) reasons.push('rate_target_not_met');
  if (lastOffsetMs - firstOffsetMs < durationSeconds * 1000 - 2000)
    reasons.push('load_window_not_covered');
  results.judgment = { passed: reasons.length === 0, reasons, targetMs, observedRate };
  results.stage = reasons.length === 0 ? 'measurement_completed' : 'measurement_failed';
  results.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(results, null, 2));
  if (reasons.length > 0) process.exitCode = 1;
} catch (error) {
  results.stage = 'measurement_failed';
  results.error = error instanceof Error ? error.message : String(error);
  results.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(results, null, 2));
  console.error(results.error);
  process.exitCode = 1;
} finally {
  await server?.close();
  rmSync(directory, { recursive: true, force: true });
}
