import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import type { VenueRegistry } from '@wx-viewer-poc/shared';
import {
  planBosaiBulletinNotifications,
  resolveBosaiTargetName,
} from '../src/notifications/bosaiBulletinNotificationPlanner.js';
import { projectStartupCurrentNotifications } from '../src/notifications/startupCurrentNotificationProjector.js';
import { saveBosaiBulletin } from '../src/repositories/bosaiBulletinRepository.js';
import type {
  BosaiBulletin,
  BosaiBulletinArea,
  BosaiBulletinAreaInput,
} from '../src/repositories/types.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { eastVenueId, testVenueRegistry, trcVenueId } from './helpers/venueConfigPreload.js';

const DETECTED_AT = '2026-09-10T07:05:00.000Z';
const REPORT_AT = '2026-09-10T07:00:00.000Z';

const area = (areaCode: string, areaName: string, informationType: string | null = null) =>
  ({
    id: 0,
    areaCode,
    areaName,
    codeType: 'test',
    sequence: 0,
    informationType,
  }) satisfies BosaiBulletinArea;

const TOKYO_CITY_AREAS = {
  tokyoPrefecture: area('130000', '東京都'),
  tokyoRegion: area('130010', '東京地方'),
  east23: area('130012', '２３区東部'),
  koto: area('1310800', '江東区'),
  west23: area('130011', '２３区西部'),
  ota: area('1311100', '大田区'),
};

function bulletin(overrides: Partial<BosaiBulletin> & Pick<BosaiBulletin, 'areas'>): BosaiBulletin {
  return {
    id: 1,
    eventId: 'EVENT_1',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: REPORT_AT,
    controlDateTime: REPORT_AT,
    title: '東京都気象防災速報',
    headlineText: '本文',
    informationTag: '線状降水帯発生',
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'test',
      issuedAt: REPORT_AT,
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: REPORT_AT,
      lastSuccessAt: REPORT_AT,
      availability: 'available',
      sourceVersion: null,
    },
    ...overrides,
  } as BosaiBulletin;
}

function plan(
  current: BosaiBulletin,
  venue: 'east' | 'trc' = 'east',
  previous: BosaiBulletin | null = null,
  registry: VenueRegistry = testVenueRegistry,
) {
  return planBosaiBulletinNotifications({
    venueRegistry: registry,
    current,
    previous,
    venueId: venue === 'east' ? eastVenueId : trcVenueId,
    detectionContext: 'normal',
    detectedAt: DETECTED_AT,
    notificationIdFactory: () => 'nid',
  });
}

test('resolveBosaiTargetName: includedAreaCodes の並びで最初に一致した区域名。一致なしは null', () => {
  const codes = ['1310800', '130012', '130010'];
  assert.equal(resolveBosaiTargetName([TOKYO_CITY_AREAS.tokyoRegion], codes), '東京地方');
  assert.equal(
    resolveBosaiTargetName([TOKYO_CITY_AREAS.tokyoRegion, TOKYO_CITY_AREAS.koto], codes),
    '江東区',
  );
  // areas の並びではなく includedAreaCodes の並びが優先される
  assert.equal(
    resolveBosaiTargetName([TOKYO_CITY_AREAS.east23, TOKYO_CITY_AREAS.tokyoRegion], codes),
    '２３区東部',
  );
  assert.equal(resolveBosaiTargetName([TOKYO_CITY_AREAS.ota], codes), null);
  assert.equal(resolveBosaiTargetName([], codes), null);
});

test('planner: 広域速報は元の区域名を targets[0].name にし、kind・codeType・code は会場のまま', () => {
  // 線状降水帯（東京地方のみ）
  const linear = plan(bulletin({ areas: [TOKYO_CITY_AREAS.tokyoRegion] }));
  assert.equal(linear.notifications.length, 1);
  assert.deepStrictEqual(linear.notifications[0]!.notification.targets, [
    { kind: 'area', codeType: 'venue', code: eastVenueId, name: '東京地方' },
  ]);
  assert.equal(linear.notifications[0]!.output.summary.split('\n')[1], '東京地方');

  // 記録的短時間大雨（Headline 東京地方 + Body 江東区）
  const record = plan(
    bulletin({
      informationTag: '記録雨',
      areas: [TOKYO_CITY_AREAS.tokyoRegion, TOKYO_CITY_AREAS.koto],
    }),
  );
  assert.equal(record.notifications[0]!.notification.targets[0].name, '江東区');
  assert.equal(record.notifications[0]!.output.summary.split('\n')[1], '江東区');

  // 竜巻（4階層）east
  const tornado = plan(
    bulletin({
      eventId: 'VPHW51:130010',
      title: '東京都竜巻注意情報',
      informationTag: '竜巻注意情報',
      metadata: { ...bulletin({ areas: [] }).metadata, validAt: '2026-09-10T08:10:00.000Z' },
      areas: [
        TOKYO_CITY_AREAS.tokyoPrefecture,
        TOKYO_CITY_AREAS.tokyoRegion,
        TOKYO_CITY_AREAS.east23,
        TOKYO_CITY_AREAS.koto,
      ].map((a) => ({ ...a, informationType: '竜巻注意情報' })),
    } as never),
  );
  assert.equal(tornado.notifications.length, 1);
  assert.equal(tornado.notifications[0]!.notification.targets[0].name, '江東区');

  // trc: 線状降水帯は東京地方、記録雨は大田区
  const trcLinear = plan(bulletin({ areas: [TOKYO_CITY_AREAS.tokyoRegion] }), 'trc');
  assert.deepStrictEqual(trcLinear.notifications[0]!.notification.targets, [
    { kind: 'area', codeType: 'venue', code: trcVenueId, name: '東京地方' },
  ]);
  const trcRecord = plan(
    bulletin({
      informationTag: '記録雨',
      areas: [TOKYO_CITY_AREAS.tokyoRegion, TOKYO_CITY_AREAS.ota],
    }),
    'trc',
  );
  assert.equal(trcRecord.notifications[0]!.notification.targets[0].name, '大田区');
});

test('planner: 取消で区域が無い場合は previous の区域から名前を決める', () => {
  const previous = bulletin({
    informationTag: '記録雨',
    areas: [TOKYO_CITY_AREAS.tokyoRegion, TOKYO_CITY_AREAS.koto],
  });
  const cancelled = bulletin({
    infoType: '取消',
    isCancelled: true,
    informationTag: null,
    areas: [],
  });
  const result = plan(cancelled, 'east', previous);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0]!.notification.changeType, 'cancelled');
  assert.deepStrictEqual(result.notifications[0]!.notification.targets, [
    { kind: 'area', codeType: 'venue', code: eastVenueId, name: '江東区' },
  ]);
});

test('planner: 一致する区域が無い入力は会場名にフォールバックせず、通知を出さず target_name_unresolved を返す', () => {
  // 採用判定（includes）は通すが区域名を引けない会場設定を作る
  const base = testVenueRegistry.getVenue(eastVenueId);
  const hollowCodes = Object.assign([] as string[], { includes: () => true });
  const registry = {
    ...testVenueRegistry,
    getVenue: () => ({
      ...base,
      bosaiBulletin: { ...base.bosaiBulletin, includedAreaCodes: hollowCodes },
    }),
  } as unknown as VenueRegistry;
  const result = plan(bulletin({ areas: [TOKYO_CITY_AREAS.tokyoRegion] }), 'east', null, registry);
  assert.equal(result.notifications.length, 0);
  assert.deepEqual(
    result.skipped.map((s) => s.reason),
    ['target_name_unresolved'],
  );
});

test('起動時現況投影: 区域名が targets[0].name と summary の2行目になり、kind・codeType・code は会場のまま', () => {
  const db = initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    const save = (
      eventId: string,
      informationTag: string,
      areas: readonly BosaiBulletinAreaInput[],
      title = '東京都気象防災速報',
      validAt: string | null = null,
    ) =>
      saveBosaiBulletin(db.weather.connection, {
        eventId,
        controlStatus: 'normal',
        infoType: '発表',
        reportDateTime: REPORT_AT,
        controlDateTime: REPORT_AT,
        title,
        headlineText: '本文',
        informationTag,
        hasSighting: null,
        isCancelled: false,
        metadata: {
          source: 'test',
          issuedAt: REPORT_AT,
          validAt,
          validFrom: null,
          validTo: null,
          fetchedAt: REPORT_AT,
          lastSuccessAt: REPORT_AT,
          availability: 'available',
          sourceVersion: null,
        },
        areas,
      });
    save('EV_LINEAR', '線状降水帯発生', [TOKYO_CITY_AREAS.tokyoRegion]);
    save('EV_RECORD', '記録雨', [TOKYO_CITY_AREAS.tokyoRegion, TOKYO_CITY_AREAS.koto]);
    save(
      'VPHW51:130010',
      '竜巻注意情報',
      [
        TOKYO_CITY_AREAS.tokyoPrefecture,
        TOKYO_CITY_AREAS.tokyoRegion,
        TOKYO_CITY_AREAS.east23,
        TOKYO_CITY_AREAS.koto,
      ].map((a) => ({ ...a, informationType: '竜巻注意情報' })),
      '東京都竜巻注意情報',
      '2026-09-10T08:10:00.000Z',
    );
    const result = projectStartupCurrentNotifications(
      db.weather.connection,
      {
        venueRegistry: testVenueRegistry,
        venueId: eastVenueId,
        now: DETECTED_AT,
        includeWarningCategory: false,
      },
      (() => {
        let n = 0;
        return () => `out-${++n}`;
      })(),
    );
    const byEvent = (eventId: string) =>
      result.notifications.find((n) => n.relatedRefs.some((r) => r.ref === eventId))!;
    for (const [eventId, name] of [
      ['EV_LINEAR', '東京地方'],
      ['EV_RECORD', '江東区'],
      ['VPHW51:130010', '江東区'],
    ] as const) {
      const notification = byEvent(eventId);
      assert.deepStrictEqual(notification.targets, [
        { kind: 'area', codeType: 'venue', code: eastVenueId, name },
      ]);
      assert.equal(notification.output.summary.split('\n')[1], name, eventId);
    }
  } finally {
    db.close();
  }
});
