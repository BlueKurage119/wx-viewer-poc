import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVenueRegistry, type VenueForecastTargets } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { loadVenueConfig } from '../src/config/venueConfigLoader.js';
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
  return {
    connection: database.connection,
    close: () => {
      database.close();
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
  rawBody: string,
  areaCode: '130010' | '040010',
) {
  const input: TelegramReceptionInput = {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `${telegramType}-${areaCode}-entry`,
    documentUrl: `https://example.test/${telegramType}/${areaCode}`,
    telegramType,
    title: telegramType === 'VPFD51' ? '東京都府県天気予報' : '早期注意情報',
    controlStatus: 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: xmlDate(rawBody, 'DateTime'),
    reportDateTime: xmlDate(rawBody, 'ReportDateTime'),
    targetDateTime: null,
    receivedAt,
    rawBody,
    bodyBytes: Buffer.byteLength(rawBody),
    contentHash: `${telegramType}-${areaCode}`,
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
