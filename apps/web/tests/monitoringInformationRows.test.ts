import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonitoringStatusResponse, VenueForecastTargets } from '@wx-viewer-poc/shared';
import { VENUE_FORECAST_TARGETS } from '@wx-viewer-poc/shared';
import {
  buildInformationRows,
  type InformationRow,
} from '../src/monitoring/monitoringInformationRows.ts';
import { normalMonitoringResponseFixture } from './monitoringFixture.ts';
import {
  createDefaultInformation,
  createDefaultVenueInformation,
  createInformationSection,
} from './monitoringInformationFixture.ts';

test('buildInformationRows: data === null のときは全セル — の固定 8 行を返す (AC-12)', () => {
  const rows = buildInformationRows(null);
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((r) => ({
      kind: r.kind,
      name: r.name,
      target: r.target,
      stateLabel: r.stateLabel,
      stateTone: r.stateTone,
      validAtText: r.validAtText,
      validAt: r.validAt,
      fetchedAtText: r.fetchedAtText,
      fetchedAt: r.fetchedAt,
      summaryCountText: r.summaryCountText,
    })),
    [
      {
        kind: 'bosai_bulletin',
        name: '気象防災速報',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'warning',
        name: '気象警報・注意報',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'warning_timeseries',
        name: '警報等時系列',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'early_warning',
        name: '警報級の可能性',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'amedas',
        name: 'アメダス',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'area_timeseries',
        name: '地域時系列予報',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'nowcast',
        name: '雨雲',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
      {
        kind: 'kikikuru',
        name: 'キキクル',
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      },
    ],
  );
});

test('buildInformationRows: 会場フィルタと固定8行順序 (AC-1, AC-2)', () => {
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: createDefaultInformation(),
  };

  const rows = buildInformationRows(data);
  assert.equal(rows.length, 8);

  // AC-2: 固定順 (気象防災速報 / 気象警報・注意報 / 警報等時系列 / 警報級の可能性 / アメダス / 地域時系列予報 / 雨雲 / キキクル)
  const expectedNames = [
    '気象防災速報',
    '気象警報・注意報',
    '警報等時系列',
    '警報級の可能性',
    'アメダス',
    '地域時系列予報',
    '雨雲',
    'キキクル',
  ];
  assert.deepEqual(
    rows.map((r) => r.name),
    expectedNames,
  );

  // AC-1: 対象地域・地点に「大田区」「羽田」（trcの値）が1つも現れない
  const targets = rows.map((r) => r.target);
  assert.equal(targets.includes('大田区'), false);
  assert.equal(targets.includes('羽田'), false);
});

test('buildInformationRows: 反映状態3値の1対1マッピングと縮退なし (AC-3)', () => {
  const availabilities = ['available', 'stale', 'unavailable'] as const;
  const expectedLabels = ['利用可能', '情報なし', '未取得'];
  const expectedTones = ['normal', 'neutral', 'neutral'];

  for (let i = 0; i < availabilities.length; i++) {
    const data: MonitoringStatusResponse = {
      ...normalMonitoringResponseFixture,
      requestedVenueId: 'east',
      information: [
        createInformationSection('warning', 'east', {
          availability: availabilities[i],
        }),
      ],
    };
    const rows = buildInformationRows(data);
    const warningRow = rows.find((r) => r.kind === 'warning') as InformationRow;
    assert.equal(warningRow.stateLabel, expectedLabels[i]);
    assert.equal(warningRow.stateTone, expectedTones[i]);
  }
});

test('buildInformationRows: 片方の失敗を隠さない (AC-4)', () => {
  for (const compositeKind of ['early_warning', 'nowcast', 'kikikuru'] as const) {
    const data: MonitoringStatusResponse = {
      ...normalMonitoringResponseFixture,
      requestedVenueId: 'east',
      information: [
        createInformationSection(compositeKind, 'east', {
          availability: 'unavailable',
          summaryCount: 3,
        }),
      ],
    };
    const rows = buildInformationRows(data);
    const row = rows.find((r) => r.kind === compositeKind) as InformationRow;
    assert.equal(row.stateLabel, '未取得');
    assert.equal(row.stateTone, 'neutral');
    assert.equal(row.summaryCountText, '3');
  }
});

test('buildInformationRows: 時刻列の書式と validAt (基準時刻) 採用 (AC-5)', () => {
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    generatedAt: '2026-09-21T00:20:00.000Z',
    information: [
      createInformationSection('warning', 'east', {
        issuedAt: '2026-09-21T00:10:00.000Z',
        validAt: '2026-09-21T00:12:00.000Z',
        fetchedAt: '2026-09-21T00:13:45.000Z',
      }),
    ],
  };

  const rows = buildInformationRows(data);
  const row = rows.find((r) => r.kind === 'warning') as InformationRow;

  // JSTで同日でも日付が出る (MM/DD HH:mm:ss)
  // 2026-09-21T00:12:00.000Z -> JST 2026-09-21 09:12:00 -> "09/21 09:12:00"
  // 2026-09-21T00:13:45.000Z -> JST 2026-09-21 09:13:45 -> "09/21 09:13:45"
  assert.equal(row.validAtText, '09/21 09:12:00');
  assert.equal(row.validAt, '2026-09-21T00:12:00.000Z');
  assert.equal(row.fetchedAtText, '09/21 09:13:45');
  assert.equal(row.fetchedAt, '2026-09-21T00:13:45.000Z');

  // issuedAt の値 (09/21 09:10:00) が validAtText に現れないこと
  assert.notEqual(row.validAtText, '09/21 09:10:00');
});

test('buildInformationRows: 古い情報を異常にしない (AC-6)', () => {
  // validAt / fetchedAt が generatedAt より 24 時間以上前で summaryCount: 0
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    generatedAt: '2026-09-21T00:20:00.000Z',
    information: [
      createInformationSection('warning', 'east', {
        availability: 'available',
        validAt: '2026-09-19T00:00:00.000Z',
        fetchedAt: '2026-09-19T00:05:00.000Z',
        summaryCount: 0,
      }),
    ],
  };

  const rows = buildInformationRows(data);
  const row = rows.find((r) => r.kind === 'warning') as InformationRow;
  assert.equal(row.stateLabel, '利用可能');
  assert.equal(row.stateTone, 'normal');
  assert.equal(row.summaryCountText, '0');
});

test('buildInformationRows: null と 0 の区別 (AC-7)', () => {
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: [
      createInformationSection('warning', 'east', {
        summaryCount: null,
        validAt: null,
        fetchedAt: null,
      }),
      createInformationSection('warning_timeseries', 'east', {
        summaryCount: 0,
        validAt: '2026-09-20T05:25:00.000Z',
        fetchedAt: '2026-09-20T05:25:15.000Z',
      }),
    ],
  };

  const rows = buildInformationRows(data);
  const warningRow = rows.find((r) => r.kind === 'warning') as InformationRow;
  const warningTsRow = rows.find((r) => r.kind === 'warning_timeseries') as InformationRow;

  assert.equal(warningRow.summaryCountText, '—');
  assert.equal(warningRow.validAtText, '—');
  assert.equal(warningRow.validAt, null);
  assert.equal(warningRow.fetchedAtText, '—');
  assert.equal(warningRow.fetchedAt, null);

  assert.equal(warningTsRow.summaryCountText, '0');
  assert.notEqual(warningRow.summaryCountText, warningTsRow.summaryCountText);
});

test('buildInformationRows: 気象防災速報の既知の制約 (AC-8)', () => {
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: [
      createInformationSection('bosai_bulletin', 'east', {
        availability: 'available',
        issuedAt: null,
        validAt: null,
        fetchedAt: null,
        lastSuccessAt: null,
        summaryCount: 5,
      }),
    ],
  };

  const rows = buildInformationRows(data);
  const row = rows.find((r) => r.kind === 'bosai_bulletin') as InformationRow;
  assert.equal(row.stateLabel, '利用可能');
  assert.equal(row.stateTone, 'normal');
  assert.equal(row.validAtText, '—');
  assert.equal(row.validAt, null);
  assert.equal(row.fetchedAtText, '—');
  assert.equal(row.fetchedAt, null);
  assert.equal(row.summaryCountText, '5');
});

test('buildInformationRows: 対象地域・地点 (案C) east / trc (AC-9)', () => {
  // east
  const eastData: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: createDefaultVenueInformation('east'),
  };
  const eastRows = buildInformationRows(eastData);
  assert.deepEqual(
    eastRows.map((r) => ({ name: r.name, target: r.target })),
    [
      { name: '気象防災速報', target: '江東区' },
      { name: '気象警報・注意報', target: '江東区' },
      { name: '警報等時系列', target: '江東区' },
      { name: '警報級の可能性', target: '東京地方' },
      { name: 'アメダス', target: '江戸川臨海' },
      { name: '地域時系列予報', target: '東京地方' },
      { name: '雨雲', target: '—' },
      { name: 'キキクル', target: '—' },
    ],
  );

  // trc
  const trcData: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'trc',
    information: createDefaultVenueInformation('trc'),
  };
  const trcRows = buildInformationRows(trcData);
  assert.deepEqual(
    trcRows.map((r) => ({ name: r.name, target: r.target })),
    [
      { name: '気象防災速報', target: '大田区' },
      { name: '気象警報・注意報', target: '大田区' },
      { name: '警報等時系列', target: '大田区' },
      { name: '警報級の可能性', target: '東京地方' },
      { name: 'アメダス', target: '羽田' },
      { name: '地域時系列予報', target: '東京地方' },
      { name: '雨雲', target: '—' },
      { name: 'キキクル', target: '—' },
    ],
  );

  // 地域コードの数字（1310800 等）が target に含まれないこと
  for (const r of [...eastRows, ...trcRows]) {
    assert.equal(/\d/.test(r.target), false);
  }
});

test('buildInformationRows: 気象防災速報の流用条件の例外 (AC-10)', () => {
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: [createInformationSection('bosai_bulletin', 'east')],
  };

  // warning.municipalCode が includedAreaCodes に含まれない場合
  const customResolver = (venueId: string): VenueForecastTargets | undefined => {
    if (venueId === 'east') {
      const base = VENUE_FORECAST_TARGETS.east;
      return {
        ...base,
        bosaiBulletin: {
          // municipalCode を含まない配列にする
          includedAreaCodes: base.bosaiBulletin.includedAreaCodes.filter(
            (code) => (code as string) !== (base.warning.municipalCode as string),
          ),
        },
      };
    }
    return undefined;
  };

  const rows = buildInformationRows(data, customResolver);
  const row = rows.find((r) => r.kind === 'bosai_bulletin') as InformationRow;
  assert.equal(row.target, '—');
});

test('buildInformationRows: 要素欠落時に行が残り全セル — になる (AC-11)', () => {
  // kikikuru を除外した情報リスト
  const data: MonitoringStatusResponse = {
    ...normalMonitoringResponseFixture,
    requestedVenueId: 'east',
    information: createDefaultVenueInformation('east').filter((s) => s.kind !== 'kikikuru'),
  };

  const rows = buildInformationRows(data);
  assert.equal(rows.length, 8);

  const kikikuruRow = rows.find((r) => r.kind === 'kikikuru') as InformationRow;
  assert.ok(kikikuruRow);
  assert.deepEqual(kikikuruRow, {
    kind: 'kikikuru',
    name: 'キキクル',
    target: '—',
    stateLabel: '—',
    stateTone: 'unknown',
    validAtText: '—',
    validAt: null,
    fetchedAtText: '—',
    fetchedAt: null,
    summaryCountText: '—',
  });
});
