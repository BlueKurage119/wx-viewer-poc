import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';
import { parseTelegramXml } from '../src/polling/jmaXmlFeedParser.js';
import { pollSingleFeed } from '../src/polling/jmaXmlPoller.js';
import { JMA_XML_FEED_DEFINITIONS } from '../src/polling/jmaXmlFeeds.js';
import { reprocessPendingVenueForecastReceptions } from '../src/polling/jmaVenueForecastReprocessor.js';
import { processVpwp50ReceptionForAllVenues } from '../src/polling/jmaVpwp50Processor.js';
import { processEarlyWarningReceptionForVenues } from '../src/polling/jmaEarlyWarningProcessor.js';
import { processVpfd51ReceptionForVenues } from '../src/polling/jmaVpfd51Processor.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import {
  findWarningTimeseriesSnapshot,
  saveWarningTimeseriesSnapshot,
} from '../src/repositories/warningTimeseriesRepository.js';
import {
  findEarlyWarningSnapshot,
  saveEarlyWarningSnapshot,
} from '../src/repositories/earlyWarningRepository.js';
import {
  findAreaTimeseriesSnapshot,
  saveAreaTimeseriesSnapshot,
} from '../src/repositories/areaTimeseriesRepository.js';
import type { DatabaseConnection } from '../src/database/index.js';
import type {
  ControlStatus,
  TelegramMetadataInput,
  SnapshotMetadataInput,
} from '../src/repositories/types.js';

const receivedAt = '2026-10-08T09:00:00.000Z';
const latest = '2026-10-08T08:00:00.000Z';
const older = '2026-10-03T02:00:00.000Z';
const cases = [
  {
    type: 'VPWP50',
    file: '81_01_01_260129_VPWP50.xml',
    table: 'warning_timeseries_snapshot',
    from: '0121400',
    area: '1310800',
  },
  {
    type: 'VPFD61',
    file: '90_01_01_241031_VPFD61.xml',
    table: 'early_warning_snapshot',
    from: '370000',
    area: '130010',
  },
  {
    type: 'VPFW60',
    file: '69_01_01_241031_VPFW60.xml',
    table: 'early_warning_snapshot',
    from: '370000',
    area: '130010',
  },
  {
    type: 'VPFD51',
    file: '24_11_03_190925_VPFD51.xml',
    table: 'area_timeseries_snapshot',
    from: '130010',
    area: '130010',
  },
] as const;
type ForecastCase = (typeof cases)[number];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-forecast-latest-'));
  const db = initializeTestDatabases({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  return {
    connection: db.weather.connection,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function xml(c: ForecastCase, report = latest, control = report) {
  return readFileSync(join(import.meta.dirname, 'fixtures/jma', c.file), 'utf8')
    .replaceAll(c.from, c.area)
    .replace(
      /<ReportDateTime>[^<]+<\/ReportDateTime>/,
      `<ReportDateTime>${report}</ReportDateTime>`,
    )
    .replace(/<DateTime>[^<]+<\/DateTime>/, `<DateTime>${control}</DateTime>`);
}
function record(connection: DatabaseConnection, c: ForecastCase, body: string, suffix: string) {
  const url = `https://example.test/${suffix}_0_${c.type}_130000.xml`;
  return recordTelegramReception(connection, {
    ...parseTelegramXml(body, url),
    fetchAttemptId: null,
    feedKind: 'regular',
    feedEntryId: url,
    documentUrl: url,
    receivedAt,
    rawBody: body,
    bodyBytes: Buffer.byteLength(body),
    contentHash: suffix,
    adoptions: [],
  });
}
function process(
  connection: DatabaseConnection,
  c: ForecastCase,
  reception: ReturnType<typeof record>,
) {
  if (c.type === 'VPWP50')
    processVpwp50ReceptionForAllVenues(connection, reception, receivedAt, testVenueRegistry);
  else if (c.type === 'VPFD51')
    processVpfd51ReceptionForVenues(connection, reception, receivedAt, testVenueRegistry);
  else processEarlyWarningReceptionForVenues(connection, reception, receivedAt, testVenueRegistry);
}
function find(connection: DatabaseConnection, c: ForecastCase, status: ControlStatus = 'normal') {
  if (c.type === 'VPWP50') return findWarningTimeseriesSnapshot(connection, c.area, status);
  if (c.type === 'VPFD51') return findAreaTimeseriesSnapshot(connection, c.area, '44132', status);
  return findEarlyWarningSnapshot(connection, c.area, c.type === 'VPFD61' ? 'near' : 'far', status);
}
function resave(
  connection: DatabaseConnection,
  c: ForecastCase,
  telegram: TelegramMetadataInput,
  metadata: SnapshotMetadataInput,
) {
  const saved = find(connection, c)!;
  if ('stationCode' in saved)
    return saveAreaTimeseriesSnapshot(connection, { ...saved, telegram, metadata });
  if ('segment' in saved)
    return saveEarlyWarningSnapshot(connection, { ...saved, telegram, metadata });
  return saveWarningTimeseriesSnapshot(connection, {
    ...saved,
    additions: saved.additions ?? undefined,
    telegram,
    metadata,
  });
}
for (const c of cases) {
  test(`${c.type}: 新旧判定・Control同刻比較・UTC表記揺れ・stale・status分離`, () => {
    const db = setup();
    try {
      process(db.connection, c, record(db.connection, c, xml(c), 'latest'));
      const saved = find(db.connection, c);
      assert.ok(saved);
      process(db.connection, c, record(db.connection, c, xml(c, older), 'old'));
      assert.deepEqual(find(db.connection, c), saved);
      const metadata = {
        ...saved.metadata,
        fetchedAt: '2026-10-08T10:00:00.000Z',
        availability: 'stale' as const,
      };
      assert.deepEqual(
        resave(db.connection, c, { ...saved.telegram, controlDateTime: older }, metadata),
        saved,
      );
      // 秒精度とミリ秒精度で同じReportを比較し、Controlだけが古い場合も拒否する。
      assert.deepEqual(
        resave(
          db.connection,
          c,
          { ...saved.telegram, reportDateTime: '2026-10-08T08:00:00Z', controlDateTime: older },
          metadata,
        ),
        saved,
      );
      const stale = resave(
        db.connection,
        c,
        { ...saved.telegram, reportDateTime: '2026-10-08T08:00:00Z' },
        metadata,
      );
      assert.deepEqual(stale.metadata, metadata);
      assert.deepEqual(stale.timeDefines, saved.timeDefines);
      if ('values' in stale && 'values' in saved) assert.deepEqual(stale.values, saved.values);
      if ('cells' in stale && 'cells' in saved) assert.deepEqual(stale.cells, saved.cells);
      const corrected = resave(
        db.connection,
        c,
        { ...saved.telegram, controlDateTime: '2026-10-08T08:00:01Z' },
        saved.metadata,
      );
      assert.equal(corrected.telegram.controlDateTime, '2026-10-08T08:00:01Z');
      const newer = resave(
        db.connection,
        c,
        { ...saved.telegram, reportDateTime: '2026-10-08T08:01:00Z', controlDateTime: older },
        saved.metadata,
      );
      assert.equal(newer.telegram.reportDateTime, '2026-10-08T08:01:00Z');
      for (const status of ['training', 'test'] as const) {
        resave(
          db.connection,
          c,
          { ...saved.telegram, controlStatus: status, reportDateTime: older },
          metadata,
        );
        assert.equal(find(db.connection, c, status)?.telegram.reportDateTime, older);
        assert.deepEqual(find(db.connection, c), newer);
      }
      const other = {
        ...saved,
        areaCode: '040010',
        telegram: { ...saved.telegram, reportDateTime: older },
      };
      if ('stationCode' in other) {
        saveAreaTimeseriesSnapshot(db.connection, other);
        saveAreaTimeseriesSnapshot(db.connection, {
          ...other,
          areaCode: c.area,
          stationCode: '47590',
        });
      } else if ('segment' in other) {
        saveEarlyWarningSnapshot(db.connection, other);
        saveEarlyWarningSnapshot(db.connection, {
          ...other,
          areaCode: c.area,
          segment: other.segment === 'near' ? 'far' : 'near',
        });
      } else
        saveWarningTimeseriesSnapshot(db.connection, {
          ...other,
          additions: other.additions ?? undefined,
        });
      assert.deepEqual(find(db.connection, c), newer);
    } finally {
      db.close();
    }
  });
  test(`${c.type}: 採用済みの巻戻りを原受信時刻で復旧し、再実行は完全不変`, () => {
    const db = setup();
    try {
      process(db.connection, c, record(db.connection, c, xml(c), 'latest'));
      const saved = find(db.connection, c)!;
      assert.ok(saved);
      // 修正前の巻戻り済みDBをSQLで再現する。
      db.connection
        .prepare(`UPDATE ${c.table} SET report_datetime = ?, control_datetime = ?, issued_at = ?`)
        .run(older, older, older);
      assert.equal(
        reprocessPendingVenueForecastReceptions(
          db.connection,
          '2026-10-09T00:00:00Z',
          testVenueRegistry,
        ),
        1,
      );
      assert.deepEqual(find(db.connection, c), saved);
      assert.equal(
        reprocessPendingVenueForecastReceptions(
          db.connection,
          '2026-10-10T00:00:00Z',
          testVenueRegistry,
        ),
        0,
      );
      assert.deepEqual(find(db.connection, c), saved);
      process(db.connection, c, record(db.connection, c, xml(c, older), 'old'));
      assert.equal(
        reprocessPendingVenueForecastReceptions(db.connection, receivedAt, testVenueRegistry),
        0,
      );
      assert.deepEqual(find(db.connection, c), saved);
    } finally {
      db.close();
    }
  });
  test(`${c.type}: 通常pollの新→旧と受信済みskipでも最新を保持`, async () => {
    const db = setup();
    try {
      const urls = ['latest', 'old'].map((s) => `https://example.test/${s}_0_${c.type}_130000.xml`);
      let entries = [urls[0]!];
      const fetchFn: typeof fetch = async (input) =>
        new Response(
          String(input).endsWith('/regular.xml')
            ? `<feed xmlns="http://www.w3.org/2005/Atom">${entries.map((u) => `<entry><id>${u}</id><title>予報</title><link href="${u}"/></entry>`).join('')}</feed>`
            : xml(c, String(input) === urls[0] ? latest : older),
          { status: 200 },
        );
      const options = {
        venueRegistry: testVenueRegistry,
        fetchFn,
        allowedUrlPrefixes: ['https://example.test/'],
        clock: () => receivedAt,
      };
      await pollSingleFeed(
        db.connection,
        JMA_XML_FEED_DEFINITIONS[0]!,
        'scheduled',
        1,
        new Set(),
        options,
      );
      const saved = find(db.connection, c);
      assert.ok(saved);
      entries = [...urls];
      await pollSingleFeed(
        db.connection,
        JMA_XML_FEED_DEFINITIONS[0]!,
        'scheduled',
        1,
        new Set(),
        options,
      );
      assert.deepEqual(find(db.connection, c), saved);
      const result = await pollSingleFeed(
        db.connection,
        JMA_XML_FEED_DEFINITIONS[0]!,
        'scheduled',
        1,
        new Set(),
        options,
      );
      assert.equal(result.feedResult.downloadedCount, 0);
      assert.deepEqual(find(db.connection, c), saved);
    } finally {
      db.close();
    }
  });
}

for (const c of cases) {
  test(`${c.type}: 復旧候補の原文欠落・解析不可・対象区域外・日時欠落では既存値を保持`, () => {
    for (const condition of ['原文欠落', '解析不可', '対象区域外', '日時欠落'] as const) {
      const db = setup();
      try {
        const reception = record(db.connection, c, xml(c), condition);
        process(db.connection, c, reception);
        const saved = find(db.connection, c);
        assert.ok(saved);
        db.connection
          .prepare(
            'UPDATE telegram_reception SET report_datetime = ?, control_datetime = ? WHERE id = ?',
          )
          .run('2026-10-09T08:00:00.000Z', '2026-10-09T08:00:00.000Z', reception.id);
        if (condition === '原文欠落' || condition === '解析不可') {
          db.connection
            .prepare('UPDATE telegram_reception SET raw_body = ? WHERE id = ?')
            .run(condition === '原文欠落' ? null : '<Report/>', reception.id);
        } else if (condition === '対象区域外') {
          db.connection
            .prepare('DELETE FROM telegram_reception_area WHERE reception_id = ?')
            .run(reception.id);
        } else
          db.connection
            .prepare('UPDATE telegram_reception SET report_datetime = NULL WHERE id = ?')
            .run(reception.id);
        assert.equal(
          reprocessPendingVenueForecastReceptions(
            db.connection,
            '2026-10-10T00:00:00Z',
            testVenueRegistry,
          ),
          condition === '解析不可' ? 1 : 0,
        );
        assert.deepEqual(find(db.connection, c), saved);
      } finally {
        db.close();
      }
    }
  });
}

for (const c of cases) {
  test(`${c.type}: 採用未記録の会場が同居しても元受信時刻で復旧する`, () => {
    const db = setup();
    try {
      const reception = record(db.connection, c, xml(c), 'mixed');
      process(db.connection, c, reception);
      const saved = find(db.connection, c);
      assert.ok(saved);
      db.connection
        .prepare(`UPDATE ${c.table} SET report_datetime = ?, control_datetime = ?, issued_at = ?`)
        .run(older, older, older);
      db.connection
        .prepare('DELETE FROM telegram_reception_adoption WHERE reception_id = ? AND venue_id = ?')
        .run(reception.id, 'trc');
      assert.equal(
        reprocessPendingVenueForecastReceptions(
          db.connection,
          '2026-10-10T00:00:00Z',
          testVenueRegistry,
        ),
        1,
      );
      assert.deepEqual(find(db.connection, c), saved);
      assert.equal(
        reprocessPendingVenueForecastReceptions(
          db.connection,
          '2026-10-11T00:00:00Z',
          testVenueRegistry,
        ),
        0,
      );
      assert.deepEqual(find(db.connection, c), saved);
    } finally {
      db.close();
    }
  });
}
