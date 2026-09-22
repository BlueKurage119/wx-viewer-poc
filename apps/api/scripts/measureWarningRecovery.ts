import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initializeDatabase } from '../src/database/index.js';
import { startServer } from '../src/server.js';
import { recoverWarningCurrent } from '../src/polling/jmaWarningCurrentProcessor.js';

const rowCount = Number(process.argv[2] ?? 50000);
if (!Number.isSafeInteger(rowCount) || rowCount < 1)
  throw new Error('rowCount は正の整数で指定してください');
const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const directory = mkdtempSync(join(tmpdir(), 'wx-recovery-benchmark-'));
const databasePath = join(directory, 'benchmark.sqlite3');
const port = 32000 + Math.floor(Math.random() * 1000);
const context = initializeDatabase({ databasePath, migrationsDirectory });

const rawBody = `<?xml version="1.0"?><Report xmlns="http://xml.kishou.go.jp/jmaxml1/"><Control><Title>気象警報・注意報</Title><DateTime>2026-09-01T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control><Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-01T00:00:00Z</ReportDateTime><TargetDateTime>2026-09-01T00:00:00Z</TargetDateTime><EventID>BENCH</EventID><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion><Headline><Text>benchmark</Text></Headline></Head><Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"><Warning type="気象警報・注意報（市町村等）"><Item><Area><Name>札幌市</Name><Code>0110000</Code></Area><Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind></Item></Warning></Body></Report>`;
const hash = crypto.createHash('sha256').update(rawBody).digest('hex');
const insert = context.connection.prepare(`INSERT INTO telegram_reception (
  fetch_attempt_id, feed_kind, feed_entry_id, document_url, telegram_type, title,
  control_status, info_type, event_id, serial, control_datetime, report_datetime,
  target_datetime, received_at, raw_body, body_bytes, content_hash
) VALUES (NULL, 'extra', ?, ?, 'VPWS50', 'benchmark', 'normal', '発表', 'BENCH', '1',
  '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
  '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, ?, ?)`);
context.connection.transaction(() => {
  for (let i = 0; i < rowCount; i += 1)
    insert.run(
      `bench-${i}`,
      `https://example.invalid/${i}`,
      rawBody,
      Buffer.byteLength(rawBody),
      hash,
    );
})();
context.close();

const recoveryResults: Array<{ venueId: string; elapsedMs: number; parsedReceptionCount: number }> =
  [];
let completed = false;
const startedAt = performance.now();
const startedPromise = startServer({
  config: { databasePath, migrationsDirectory },
  port,
  enablePolling: false,
  recoveryInternals: {
    recover: async (connection, venue, options) => {
      const result = await recoverWarningCurrent(connection, venue, options);
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
  const report = {
    executedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: process.env.PROCESSOR_IDENTIFIER ?? 'see host system profile',
    rowCount,
    rawBodyBytes: Buffer.byteLength(rawBody),
    databaseBytes: statSync(databasePath).size,
    totalRecoveryWallMs: performance.now() - startedAt,
    recoveryResults,
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
