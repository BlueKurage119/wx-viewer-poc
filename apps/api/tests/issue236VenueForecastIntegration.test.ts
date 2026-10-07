import {
  initializeTestDatabases,
  createTestServerDatabaseOptions,
} from './helpers/databasePair.js';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVenueRegistry, type VenueForecastTargets } from '@wx-viewer-poc/shared';

import { loadVenueConfig } from '../src/config/venueConfigLoader.js';
import { createWeatherApiService } from '../src/services/weatherApiService.js';
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
  const database = initializeTestDatabases({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  let databaseClosed = false;
  return {
    connection: database.weather.connection,
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
  telegramType: 'VPFD61' | 'VPFD51' | 'VPFW60',
  rawBody: string | null,
  areaCode: string,
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
      ...createTestServerDatabaseOptions({
        databasePath: db.databasePath,
        migrationsDirectory: db.migrationsDirectory,
      }),
      enablePolling: false,
      port: 0,
    });
    await server.close();

    const reopened = initializeTestDatabases({
      databasePath: db.databasePath,
      migrationsDirectory: db.migrationsDirectory,
    });
    try {
      assert.deepEqual(
        [c5, c6].map((saved) =>
          listTelegramReceptionAdoptions(reopened.weather.connection, saved.id).map(
            (row) => row.venueId,
          ),
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

test('短期は南部、長期は府県単位で取得し、旧対象地域外の長期電文も復旧する', () => {
  const db = setup();
  try {
    const base = loadVenueConfig({ environment: 'production' }).registry.listVenues();
    const east = base[0]!;
    const third: VenueForecastTargets = {
      ...east,
      venueId: 'saitama-test' as typeof east.venueId,
      broadForecast: {
        areaCode: '110010' as typeof east.broadForecast.areaCode,
        displayName: '南部',
      },
      warning: { ...east.warning, prefectureCode: '110000' as typeof east.warning.prefectureCode },
    };
    const venues = createVenueRegistry([...base, third], 'early-warning-test');
    const nearXml = sample('VPFD61', '130010')
      .replaceAll('130010', '110010')
      .replaceAll('香川県', '南部');
    const farOriginal = readFileSync(
      join(import.meta.dirname, 'fixtures/jma/69_01_01_241031_VPFW60.xml'),
      'utf8',
    );
    const farXml = farOriginal.replaceAll('370000', '110000').replaceAll('香川県', '埼玉県');
    const near = reception(db.connection, 'VPFD61', nearXml, '110010');
    assert.equal(
      processEarlyWarningReceptionForVenues(db.connection, near, receivedAt, venues).find(
        (x) => x.venueId === third.venueId,
      )?.result.ok,
      true,
    );
    const far = reception(db.connection, 'VPFW60', farXml, '110000');
    // 修正前に全会場で対象地域外と記録されていた状態を再現する。
    const oldVenues = createVenueRegistry(
      [...base, { ...third, warning: east.warning }],
      'old-target',
    );
    assert.ok(
      processEarlyWarningReceptionForVenues(db.connection, far, receivedAt, oldVenues).every(
        (x) => !x.result.ok,
      ),
    );
    assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 1);
    assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 0);
    const service = createWeatherApiService({
      connection: db.connection,
      venueRegistry: venues,
      now: () => '2024-10-14T03:00:00.000Z',
    });
    const result = service.getEarlyWarning(
      { id: 'test-terminal', name: '試験端末', mode: 'H', venueId: third.venueId },
      'normal',
    );
    assert.equal(result.near.area.code, '110010');
    assert.equal(result.far.area.code, '110000');
    assert.equal(result.far.area.name, '埼玉県');
    assert.notEqual(result.far.data, null);
    const newer = reception(
      db.connection,
      'VPFW60',
      withReportDate(farXml, '2024-10-15T11:00:00+09:00'),
      '110000',
      { suffix: '-newer' },
    );
    processEarlyWarningReceptionForVenues(db.connection, newer, receivedAt, venues);
    const older = reception(
      db.connection,
      'VPFW60',
      withReportDate(farXml, '2024-10-13T11:00:00+09:00'),
      '110000',
      { suffix: '-older' },
    );
    processEarlyWarningReceptionForVenues(db.connection, older, receivedAt, oldVenues);
    assert.equal(reprocessPendingVenueForecastReceptions(db.connection, receivedAt, venues), 1);
    assert.equal(
      service.getEarlyWarning(
        { id: 'test-terminal', name: '試験端末', mode: 'H', venueId: third.venueId },
        'normal',
      ).far.metadata.issuedAt,
      '2024-10-15T02:00:00.000Z',
    );
    // 両候補が残る区域構成変更でも、候補順より発表時刻を優先する。
    const broadFar = reception(
      db.connection,
      'VPFW60',
      withReportDate(farXml.replaceAll('110000', '110010'), '2024-10-14T11:00:00+09:00'),
      '110010',
      { suffix: '-broad' },
    );
    processEarlyWarningReceptionForVenues(db.connection, broadFar, receivedAt, venues);
    const terminal = {
      id: 'test-terminal',
      name: '試験端末',
      mode: 'H' as const,
      venueId: third.venueId,
    };
    assert.equal(service.getEarlyWarning(terminal, 'normal').far.area.code, '110000');
    // 発表時刻が同じ場合は更新時刻（Control/DateTime）が新しい広域区域を選ぶ。
    const newerControlXml = withReportDate(
      farXml.replaceAll('110000', '110010'),
      '2024-10-15T11:00:00+09:00',
    ).replace(/<DateTime>[^<]+<\/DateTime>/, '<DateTime>2024-10-15T03:00:00Z</DateTime>');
    const newerControl = reception(db.connection, 'VPFW60', newerControlXml, '110010', {
      suffix: '-broad-newer-control',
    });
    processEarlyWarningReceptionForVenues(db.connection, newerControl, receivedAt, venues);
    assert.equal(service.getEarlyWarning(terminal, 'normal').far.area.code, '110010');
    // 同一発表・更新時刻では従来の候補順（広域区域優先）を維持する。
    const tied = reception(
      db.connection,
      'VPFW60',
      newerControlXml.replaceAll('110010', '110000'),
      '110000',
      { suffix: '-prefecture-tied' },
    );
    processEarlyWarningReceptionForVenues(db.connection, tied, receivedAt, venues);
    assert.equal(service.getEarlyWarning(terminal, 'normal').far.area.code, '110010');
    // 東京都は従来どおり東京地方単位の長期電文を使う。
    const tokyoXml = farOriginal.replaceAll('370000', '130010').replaceAll('香川県', '東京地方');
    const tokyo = reception(db.connection, 'VPFW60', tokyoXml, '130010', { suffix: '-tokyo' });
    assert.equal(
      processEarlyWarningReceptionForVenues(db.connection, tokyo, receivedAt, venues)[0]?.result.ok,
      true,
    );
    assert.equal(
      service.getEarlyWarning(
        { id: 'tokyo-test', name: '試験端末', mode: 'H', venueId: east.venueId },
        'normal',
      ).far.area.code,
      '130010',
    );
  } finally {
    db.close();
  }
});
