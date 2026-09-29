import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVenueRegistry, type VenueForecastTargets } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { loadVenueConfig } from '../src/config/venueConfigLoader.js';
import { startServer } from '../src/server.js';
import { processEarlyWarningReceptionForVenues } from '../src/polling/jmaEarlyWarningProcessor.js';
import { processVpfd51ReceptionForVenues } from '../src/polling/jmaVpfd51Processor.js';
import { reprocessPendingVenueForecastReceptions } from '../src/polling/jmaVenueForecastReprocessor.js';
import {
  recordTelegramReception,
  listTelegramReceptionAdoptions,
} from '../src/repositories/telegramReceptionRepository.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';

const receivedAt = '2026-09-09T00:00:01.000Z';
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-issue236-'));
  const database = initializeDatabase({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  let databaseClosed = false;
  return {
    connection: database.connection,
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
    closeDatabase: () => {
      if (!databaseClosed) {
        database.close();
        databaseClosed = true;
      }
    },
    close: () => {
      if (!databaseClosed) database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function registry() {
  const base = loadVenueConfig({ environment: 'production' }).registry.listVenues();
  const east = base[0]!;
  const third: VenueForecastTargets = {
    ...east,
    venueId: 'sendai' as typeof east.venueId,
    venueName: '仙台試験会場',
    broadForecast: {
      areaCode: '040010' as typeof east.broadForecast.areaCode,
      displayName: '宮城県東部',
    },
    temperatureForecast: {
      stationCode: '47590' as typeof east.temperatureForecast.stationCode,
      displayName: '仙台',
    },
  };
  return createVenueRegistry([...base, third], 'issue236-test');
}
function sample(telegramType: 'VPFD61' | 'VPFD51', areaCode: '130010' | '040010') {
  const filename =
    telegramType === 'VPFD61' ? '90_01_01_241031_VPFD61.xml' : '24_11_03_190925_VPFD51.xml';
  const original = readFileSync(join(import.meta.dirname, 'fixtures/jma', filename), 'utf8');
  if (telegramType === 'VPFD61') return original.replaceAll('370000', areaCode);
  return areaCode === '130010'
    ? original
    : original.replaceAll('130010', areaCode).replaceAll('44132', '47590');
}
function withReportDate(rawBody: string, reportDateTime: string): string {
  return rawBody.replace(
    /<ReportDateTime>[^<]+<\/ReportDateTime>/,
    `<ReportDateTime>${reportDateTime}</ReportDateTime>`,
  );
}
function xmlDate(rawBody: string, element: 'DateTime' | 'ReportDateTime'): string {
  const value = new RegExp(`<${element}>([^<]+)</${element}>`).exec(rawBody)?.[1];
  assert.ok(value);
  return new Date(value).toISOString();
}
function countRows(
  connection: ReturnType<typeof setup>['connection'],
  table: 'early_warning_snapshot' | 'area_timeseries_snapshot',
): number {
  return (connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count;
}
function reception(
  connection: ReturnType<typeof setup>['connection'],
  telegramType: 'VPFD61' | 'VPFD51',
  rawBody: string | null,
  areaCode: '130010' | '040010',
  options: {
    readonly suffix?: string;
    readonly receivedAt?: string;
    readonly reportDateTime?: string;
  } = {},
) {
  const suffix = options.suffix ?? '';
  const input: TelegramReceptionInput = {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `${telegramType}-${areaCode}-entry${suffix}`,
    documentUrl: `https://example.test/${telegramType}/${areaCode}${suffix}`,
    telegramType,
    title: telegramType === 'VPFD51' ? '東京都府県天気予報' : '早期注意情報',
    controlStatus: 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: rawBody === null ? null : xmlDate(rawBody, 'DateTime'),
    reportDateTime:
      options.reportDateTime ?? (rawBody === null ? null : xmlDate(rawBody, 'ReportDateTime')),
    targetDateTime: null,
    receivedAt: options.receivedAt ?? receivedAt,
    rawBody,
    bodyBytes: rawBody === null ? 0 : Buffer.byteLength(rawBody),
    contentHash: `${telegramType}-${areaCode}${suffix}`,
    areas: [{ sequence: 1, areaCode, areaName: areaCode, codeType: null }],
    adoptions: [],
  };
  return recordTelegramReception(connection, input);
}

test('C5/C6 は対象キー別に保存し、旧2会場は snapshot を共有する', () => {
  const db = setup();
  try {
    const venues = registry();
    for (const telegramType of ['VPFD61', 'VPFD51'] as const) {
      for (const areaCode of ['130010', '040010'] as const) {
        const saved = reception(
          db.connection,
          telegramType,
          sample(telegramType, areaCode),
          areaCode,
        );
        const outcomes =
          telegramType === 'VPFD61'
            ? processEarlyWarningReceptionForVenues(db.connection, saved, receivedAt, venues)
            : processVpfd51ReceptionForVenues(db.connection, saved, receivedAt, venues);
        assert.deepEqual(
          outcomes.map(({ venueId, result }) => [venueId, result.ok]),
          areaCode === '130010'
            ? [
                ['east', true],
                ['trc', true],
                ['sendai', false],
              ]
            : [
                ['east', false],
                ['trc', false],
                ['sendai', true],
              ],
        );
        assert.deepEqual(
          listTelegramReceptionAdoptions(db.connection, saved.id).map((row) => [
            row.venueId,
            row.adoptionResult,
          ]),
          areaCode === '130010'
            ? [
                [
                  'east',
                  telegramType === 'VPFD61'
                    ? '早期注意情報として解析済み'
                    : '地域時系列予報として解析済み',
                ],
                ['sendai', '対象地域外'],
                [
                  'trc',
                  telegramType === 'VPFD61'
                    ? '早期注意情報として解析済み'
                    : '地域時系列予報として解析済み',
                ],
              ]
            : [
                ['east', '対象地域外'],
                [
                  'sendai',
                  telegramType === 'VPFD61'
                    ? '早期注意情報として解析済み'
                    : '地域時系列予報として解析済み',
                ],
                ['trc', '対象地域外'],
              ],
        );
      }
    }
    assert.equal(countRows(db.connection, 'early_warning_snapshot'), 2);
    assert.equal(countRows(db.connection, 'area_timeseries_snapshot'), 2);
    assert.deepEqual(
      (
        db.connection
          .prepare('SELECT area_code FROM early_warning_snapshot ORDER BY area_code')
          .all() as { area_code: string }[]
      ).map((row) => row.area_code),
      ['040010', '130010'],
    );
    assert.deepEqual(
      (
        db.connection
          .prepare(
            'SELECT area_code, station_code FROM area_timeseries_snapshot ORDER BY area_code',
          )
          .all() as { area_code: string; station_code: string }[]
      ).map((row) => [row.area_code, row.station_code]),
      [
        ['040010', '47590'],
        ['130010', '44132'],
      ],
    );
  } finally {
    db.close();
  }
});

test('起動前C5再処理は受信時刻の昇順でページをまたぎ、最新snapshotを残す', () => {
  const db = setup();
  try {
    const venues = registry();
    const old = reception(
      db.connection,
      'VPFD61',
      withReportDate(sample('VPFD61', '130010'), '2026-09-09T00:00:00.000Z'),
      '130010',
      { suffix: '-old', receivedAt: '2026-09-09T00:00:00.000Z' },
    );
    for (let index = 0; index < 999; index += 1) {
      reception(db.connection, 'VPFD61', null, '130010', {
        suffix: `-page-${index}`,
        receivedAt: '2026-09-09T00:01:00.000Z',
      });
    }
    const latest = reception(
      db.connection,
      'VPFD61',
      withReportDate(sample('VPFD61', '130010'), '2026-09-09T00:02:00.000Z'),
      '130010',
      { suffix: '-latest', receivedAt: '2026-09-09T00:02:00.000Z' },
    );

    assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 1001);
    assert.deepEqual(
      db.connection
        .prepare('SELECT area_code, segment, report_datetime FROM early_warning_snapshot')
        .all(),
      [{ area_code: '130010', segment: 'near', report_datetime: '2026-09-09T00:02:00.000Z' }],
    );
    assert.deepEqual(
      [old, latest].map((saved) =>
        listTelegramReceptionAdoptions(db.connection, saved.id).map((row) => row.venueId),
      ),
      [
        ['east', 'sendai', 'trc'],
        ['east', 'sendai', 'trc'],
      ],
    );
  } finally {
    db.close();
  }
});

test('起動前C6再処理は同一受信時刻では登録順で再生する', () => {
  const db = setup();
  try {
    const venues = registry();
    reception(
      db.connection,
      'VPFD51',
      withReportDate(sample('VPFD51', '130010'), '2026-09-09T00:00:00.000Z'),
      '130010',
      { suffix: '-old', receivedAt: '2026-09-09T00:00:00.000Z' },
    );
    reception(
      db.connection,
      'VPFD51',
      withReportDate(sample('VPFD51', '130010'), '2026-09-09T00:01:00.000Z'),
      '130010',
      { suffix: '-latest', receivedAt: '2026-09-09T00:00:00.000Z' },
    );

    assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 2);
    assert.deepEqual(
      db.connection
        .prepare('SELECT area_code, station_code, report_datetime FROM area_timeseries_snapshot')
        .all(),
      [
        {
          area_code: '130010',
          station_code: '44132',
          report_datetime: '2026-09-09T00:01:00.000Z',
        },
      ],
    );
  } finally {
    db.close();
  }
});

test('startServer は警報復旧より前に未採用のC5/C6原文を再処理する', async () => {
  const db = setup();
  try {
    const c5 = reception(db.connection, 'VPFD61', sample('VPFD61', '130010'), '130010', {
      suffix: '-startup-c5',
    });
    const c6 = reception(db.connection, 'VPFD51', sample('VPFD51', '130010'), '130010', {
      suffix: '-startup-c6',
    });
    db.closeDatabase();

    const server = await startServer({
      config: { databasePath: db.databasePath, migrationsDirectory: db.migrationsDirectory },
      enablePolling: false,
      port: 0,
    });
    await server.close();

    const reopened = initializeDatabase({
      databasePath: db.databasePath,
      migrationsDirectory: db.migrationsDirectory,
    });
    try {
      assert.deepEqual(
        [c5, c6].map((saved) =>
          listTelegramReceptionAdoptions(reopened.connection, saved.id).map((row) => row.venueId),
        ),
        [
          ['east', 'trc'],
          ['east', 'trc'],
        ],
      );
    } finally {
      reopened.close();
    }
  } finally {
    db.close();
  }
});

test('起動時再処理は不足した採用行を追加し、繰返しても snapshot と採用行を増殖させない', () => {
  const db = setup();
  try {
    const venues = registry();
    const oldVenues = createVenueRegistry(venues.listVenues().slice(0, 2), 'issue236-before');
    for (const telegramType of ['VPFD61', 'VPFD51'] as const) {
      const saved = reception(
        db.connection,
        telegramType,
        sample(telegramType, '040010'),
        '040010',
      );
      if (telegramType === 'VPFD61')
        processEarlyWarningReceptionForVenues(db.connection, saved, receivedAt, oldVenues);
      else processVpfd51ReceptionForVenues(db.connection, saved, receivedAt, oldVenues);
      const prior = listTelegramReceptionAdoptions(db.connection, saved.id);
      assert.deepEqual(
        prior.map((row) => row.venueId),
        ['east', 'trc'],
      );
      assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 1);
      const after = listTelegramReceptionAdoptions(db.connection, saved.id);
      assert.equal(after.length, 3);
      assert.deepEqual(
        after.filter((row) => row.venueId !== venues.resolveVenueId('sendai')),
        prior,
      );
      assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 0);
    }
    assert.equal(countRows(db.connection, 'early_warning_snapshot'), 1);
    assert.equal(countRows(db.connection, 'area_timeseries_snapshot'), 1);
  } finally {
    db.close();
  }
});
