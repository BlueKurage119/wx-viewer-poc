import { parentPort, workerData } from 'node:worker_threads';
import { DOMParser } from '@xmldom/xmldom';
import Database from 'better-sqlite3';
import { createVenueRegistry, type UtcIso8601String } from '@wx-viewer-poc/shared';
import { resolveVenueWarningContext } from '../../../src/venueForecastTargets.js';
import { reprocessPendingWarningTelegramReceptions } from '../../../src/polling/jmaWarningTelegramProcessor.js';
import { recoverWarningCurrent } from '../../../src/polling/jmaWarningCurrentProcessor.js';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';
import '../../../src/runtime/acquisitionWorker.js';

const data = workerData as AcquisitionWorkerData;
const telegram = `<Report><Body>${'<Item><Area>固定負荷資料</Area><Value>123</Value></Item>'.repeat(500)}</Body></Report>`;
let sequence = 0;

parentPort!.on('message', async (message: { test?: string; kind?: string }) => {
  if (message.test !== 'issue260-load') return;
  const kind = message.kind;
  const startedAt = Date.now();
  const cpuStart = process.threadCpuUsage();
  parentPort!.postMessage({ test: 'load-started', kind });
  let items = 0;
  let connection: Database.Database | undefined;
  try {
    if (kind === 'parser') {
      while (Date.now() - startedAt < 5000) {
        new DOMParser().parseFromString(telegram, 'text/xml');
        items++;
      }
    } else if (kind === 'write') {
      connection = new Database(data.pair.weather.databasePath);
      const update = connection.prepare(
        'UPDATE telegram_reception SET title = ? WHERE id BETWEEN ? AND ?',
      );
      while (Date.now() - startedAt < 5000) {
        const begin = (sequence++ % 50) * 1000 + 1;
        const title = `検証書込-${sequence % 2}`;
        items += update.run(title, begin, begin + 999).changes;
      }
    } else if (kind === 'recovery') {
      connection = new Database(data.pair.weather.databasePath);
      const registry = createVenueRegistry(data.settings.venues, data.settings.venueGeneration);
      const venueId = registry.listVenueIds()[0];
      if (!venueId) throw new Error('復旧対象会場がありません。');
      const venue = resolveVenueWarningContext(registry, venueId);
      const insert = connection.prepare(`INSERT INTO telegram_reception
        (document_url, telegram_type, control_status, received_at, raw_body, body_bytes)
        VALUES (?, 'VPWS50', 'normal', ?, ?, ?)`);
      while (Date.now() - startedAt < 5000) {
        const at = new Date().toISOString();
        for (let i = 0; i < 100; i++) {
          const url = `https://example.invalid/issue260/recovery/${sequence++}`;
          insert.run(url, at, telegram, Buffer.byteLength(telegram));
        }
        const reprocessed = await reprocessPendingWarningTelegramReceptions(
          connection,
          venue,
          () => new Date().toISOString() as UtcIso8601String,
        );
        const recovered = await recoverWarningCurrent(connection, venue, {
          yieldEveryParsedReceptions: 25,
        });
        items += reprocessed.processedCount + recovered.parsedReceptionCount;
      }
    } else {
      throw new Error('未対応の負荷種別です。');
    }
    const cpu = process.threadCpuUsage(cpuStart);
    parentPort!.postMessage({
      test: 'load-ended',
      kind,
      items,
      elapsedMs: Date.now() - startedAt,
      cpuMs: (cpu.user + cpu.system) / 1000,
    });
  } catch (error) {
    parentPort!.postMessage({
      test: 'load-failed',
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    connection?.close();
  }
});
