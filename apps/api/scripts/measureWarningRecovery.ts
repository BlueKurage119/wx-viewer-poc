import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { cpus, freemem, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initializeDatabase } from '../src/database/index.js';
import { startServer } from '../src/server.js';
import { recoverWarningCurrent } from '../src/polling/jmaWarningCurrentProcessor.js';
import { applyWarningCurrentReception } from '../src/polling/jmaWarningCurrentProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import {
  deleteWarningCurrentSnapshot,
  deleteWarningCurrentStreams,
  findTelegramReceptionById,
} from '../src/repositories/index.js';

const rowCount = Number(process.argv[2] ?? 50000);
const injectedYieldDelayMs = Number(process.argv[3] ?? 100);
if (!Number.isSafeInteger(rowCount) || rowCount < 1)
  throw new Error('rowCount は正の整数で指定してください');
if (!Number.isSafeInteger(injectedYieldDelayMs) || injectedYieldDelayMs < 0)
  throw new Error('injectedYieldDelayMs は0以上の整数で指定してください');
const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const directory = mkdtempSync(join(tmpdir(), 'wx-recovery-benchmark-'));
const databasePath = join(directory, 'benchmark.sqlite3');
const port = 32000 + Math.floor(Math.random() * 1000);
const context = initializeDatabase({ databasePath, migrationsDirectory });

const rawBodyTemplate = `<?xml version="1.0"?><Report xmlns="http://xml.kishou.go.jp/jmaxml1/"><Control><Title>気象警報・注意報</Title><DateTime>__DATETIME__</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control><Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>__DATETIME__</ReportDateTime><TargetDateTime>__DATETIME__</TargetDateTime><EventID>BENCH</EventID><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion><Headline><Text>benchmark</Text></Headline></Head><Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"><Warning type="気象警報・注意報（市町村等）"><Item><Area><Name>__AREA_NAME__</Name><Code>__AREA_CODE__</Code></Area><Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind></Item></Warning></Body></Report>`;
const insert = context.connection.prepare(`INSERT INTO telegram_reception (
  fetch_attempt_id, feed_kind, feed_entry_id, document_url, telegram_type, title,
  control_status, info_type, event_id, serial, control_datetime, report_datetime,
  target_datetime, received_at, raw_body, body_bytes, content_hash
) VALUES (NULL, 'extra', ?, ?, 'VPWS50', 'benchmark', 'normal', '発表', 'BENCH', '1',
  ?, ?, ?, ?, ?, ?, ?)`);
context.connection.transaction(() => {
  for (let i = 0; i < rowCount; i += 1) {
    const dateTime = new Date(Date.UTC(2026, 8, 1) + i * 1000).toISOString();
    const east = i % 2 === 0;
    const sentinel = rowCount > 5000 && i >= rowCount - 2500;
    const rawBody = rawBodyTemplate
      .replaceAll('__DATETIME__', dateTime)
      .replace('__AREA_NAME__', sentinel ? '対象外' : east ? '江東区' : '大田区')
      .replace('__AREA_CODE__', sentinel ? '9999999' : east ? '1310800' : '1311100');
    const hash = crypto.createHash('sha256').update(rawBody).digest('hex');
    insert.run(
      `bench-${i}`,
      `https://example.invalid/${i}`,
      dateTime,
      dateTime,
      dateTime,
      dateTime,
      rawBody,
      Buffer.byteLength(rawBody),
      hash,
    );
  }
})();

const dumpCurrent = () =>
  JSON.stringify({
    streams: context.connection
      .prepare(
        `SELECT prefecture_code, area_code, control_status, telegram_type,
         report_datetime, control_datetime, received_at, content_hash
         FROM warning_current_stream ORDER BY prefecture_code, area_code, control_status, telegram_type`,
      )
      .all(),
    snapshots: context.connection
      .prepare(
        `SELECT area_code, area_name, control_status, info_type, event_id, report_datetime,
         control_datetime, source, issued_at, valid_at, valid_from, valid_to, fetched_at,
         last_success_at, availability, source_version
         FROM warning_current_snapshot ORDER BY area_code, control_status`,
      )
      .all(),
    items: context.connection
      .prepare(
        `SELECT s.area_code, s.control_status, i.sequence, i.kind_code, i.kind_name,
         i.kind_status, i.last_kind_code, i.last_kind_name, i.significancy_code,
         i.significancy_name, i.warning_level, i.attention_text, i.kind_issued_at,
         i.source_telegram FROM warning_current_item i
         JOIN warning_current_snapshot s ON s.id = i.snapshot_id
         ORDER BY s.area_code, s.control_status, i.sequence`,
      )
      .all(),
  });

// e9d312e時点の全履歴復旧と同じく、全警報原文を古い順に解析・適用する比較基準。
const baselineStartedAt = performance.now();
let baselineParsedReceptionCount = 0;
let singleXmlParseReduceMaxMs = 0;
for (const venueId of ['east', 'trc'] as const) {
  const venue = resolveVenueWarningContext(venueId);
  const ids = context.connection
    .prepare(
      `SELECT id FROM telegram_reception
       WHERE raw_body IS NOT NULL AND report_datetime IS NOT NULL AND control_datetime IS NOT NULL
       ORDER BY report_datetime ASC, control_datetime ASC, id ASC`,
    )
    .all() as Array<{ id: number }>;
  for (const { id } of ids) {
    const reception = findTelegramReceptionById(context.connection, id)!;
    baselineParsedReceptionCount += 1;
    const singleStartedAt = performance.now();
    const parsed = parseWarningTelegram(reception.rawBody!, reception, venue.targetArea);
    if (parsed.ok)
      applyWarningCurrentReception(context.connection, reception, parsed.value, venue.targetArea);
    singleXmlParseReduceMaxMs = Math.max(
      singleXmlParseReduceMaxMs,
      performance.now() - singleStartedAt,
    );
  }
}
const baselineWallMs = performance.now() - baselineStartedAt;
const baselineDump = dumpCurrent();
for (const venueId of ['east', 'trc'] as const) {
  const target = resolveVenueWarningContext(venueId).targetArea;
  for (const status of ['normal', 'training', 'test'] as const) {
    deleteWarningCurrentStreams(
      context.connection,
      target.prefectureCode,
      target.municipalCode,
      status,
    );
    deleteWarningCurrentSnapshot(context.connection, target.municipalCode, status);
  }
}
const receptionDistribution = context.connection
  .prepare(
    `SELECT control_status AS controlStatus, telegram_type AS telegramType, COUNT(*) AS count
     FROM telegram_reception GROUP BY control_status, telegram_type ORDER BY control_status, telegram_type`,
  )
  .all();
context.close();

const recoveryResults: Array<{ venueId: string; elapsedMs: number; parsedReceptionCount: number }> =
  [];
let optimizedYieldCount = 0;
let completed = false;
const startedAt = performance.now();
const startedPromise = startServer({
  config: { databasePath, migrationsDirectory },
  port,
  enablePolling: false,
  recoveryInternals: {
    recover: async (connection, venue, options) => {
      const result = await recoverWarningCurrent(connection, venue, {
        ...options,
        yieldControl: async () => {
          optimizedYieldCount += 1;
          await new Promise<void>((resolve) => {
            if (injectedYieldDelayMs === 0) setImmediate(resolve);
            else setTimeout(resolve, injectedYieldDelayMs);
          });
        },
      });
      recoveryResults.push({
        venueId: result.venueId,
        elapsedMs: result.elapsedMs,
        parsedReceptionCount: result.parsedReceptionCount,
      });
      return result;
    },
  },
}).then((server) => {
  completed = true;
  return server;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const samples: Array<{ healthMs: number; monitoringMs: number }> = [];
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {
      /* 待受待ち */
    }
    await sleep(20);
  }
  while (!completed && samples.length < 20) {
    const healthStart = performance.now();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthMs = performance.now() - healthStart;
    const monitoringStart = performance.now();
    const monitoring = await fetch(
      `http://127.0.0.1:${port}/api/monitoring/status?terminalId=hkeagh01`,
    );
    const monitoringMs = performance.now() - monitoringStart;
    if (!health.ok || !monitoring.ok)
      throw new Error(`HTTP失敗: health=${health.status}, monitoring=${monitoring.status}`);
    samples.push({ healthMs, monitoringMs });
    await sleep(1000);
  }
  const server = await startedPromise;
  await server.close();
  const verify = initializeDatabase({ databasePath, migrationsDirectory });
  const optimizedDump = JSON.stringify({
    streams: verify.connection
      .prepare(
        `SELECT prefecture_code, area_code, control_status, telegram_type,
         report_datetime, control_datetime, received_at, content_hash
         FROM warning_current_stream ORDER BY prefecture_code, area_code, control_status, telegram_type`,
      )
      .all(),
    snapshots: verify.connection
      .prepare(
        `SELECT area_code, area_name, control_status, info_type, event_id, report_datetime,
         control_datetime, source, issued_at, valid_at, valid_from, valid_to, fetched_at,
         last_success_at, availability, source_version
         FROM warning_current_snapshot ORDER BY area_code, control_status`,
      )
      .all(),
    items: verify.connection
      .prepare(
        `SELECT s.area_code, s.control_status, i.sequence, i.kind_code, i.kind_name,
         i.kind_status, i.last_kind_code, i.last_kind_name, i.significancy_code,
         i.significancy_name, i.warning_level, i.attention_text, i.kind_issued_at,
         i.source_telegram FROM warning_current_item i
         JOIN warning_current_snapshot s ON s.id = i.snapshot_id
         ORDER BY s.area_code, s.control_status, i.sequence`,
      )
      .all(),
  });
  verify.close();
  const cpuUsage = process.cpuUsage();
  const report = {
    executedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtEnd: freemem(),
    processMaxRssKb: process.resourceUsage().maxRSS,
    processCpuUserMs: cpuUsage.user / 1000,
    processCpuSystemMs: cpuUsage.system / 1000,
    rowCount,
    rawBodyBytes: Buffer.byteLength(rawBodyTemplate),
    databaseBytes: statSync(databasePath).size,
    receptionDistribution,
    baselineWallMs,
    baselineParsedReceptionCount,
    singleXmlParseReduceMaxMs,
    totalRecoveryWallMs: performance.now() - startedAt,
    recoveryResults,
    optimizedCandidateParsedCount: recoveryResults.reduce(
      (total, result) => total + result.parsedReceptionCount,
      0,
    ),
    optimizedYieldCount,
    injectedYieldDelayMs,
    recoveryStateMatchesBaseline: optimizedDump === baselineDump,
    sampleCount: samples.length,
    healthMaxMs: Math.max(...samples.map((s) => s.healthMs)),
    monitoringMaxMs: Math.max(...samples.map((s) => s.monitoringMs)),
    samples,
    workerDecision:
      samples.length >= 20 &&
      Math.max(...samples.map((s) => s.healthMs)) <= 500 &&
      Math.max(...samples.map((s) => s.monitoringMs)) <= 1000
        ? '不採用'
        : '後続Issueで要検討',
  };
  console.log(JSON.stringify(report, null, 2));
  if (samples.length < 20) process.exitCode = 2;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
