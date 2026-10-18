import { initializeTestDatabases } from './helpers/databasePair.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listFetchAttempts, listTelegramReceptions } from '../src/repositories/index.js';
import { findWarningTimeseriesSnapshot } from '../src/repositories/index.js';
import type { JmaXmlFeedDefinition, JmaXmlPollTrigger } from '../src/polling/jmaXmlFeeds.js';
import { pollSingleFeed } from '../src/polling/jmaXmlPoller.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

const BASE = 'https://www.data.jma.go.jp/developer/xml/data/';
const FEED_URL = 'https://example.com/xml/feed/regular_l.xml';
const LONG_FEED: JmaXmlFeedDefinition = {
  kind: 'regular_l',
  url: FEED_URL,
  sourceKind: 'xml_feed_regular_long',
  role: 'long_term',
};

/** 電文時刻 20260909 の hh 時台（JST ではなく URL 上の時刻）。hh が大きいほど新しい */
function hourOf(hh: number): string {
  return `202609090${hh}0000`;
}
function docUrl(hh: number, type: string, office = '130000'): string {
  return `${BASE}${hourOf(hh)}_0_${type}_${office}.xml`;
}
function reportDateTimeOf(hh: number): string {
  return `2026-09-09T0${hh}:00:00+09:00`;
}

function vpwwXml(hh: number, type: string): string {
  const r = reportDateTimeOf(hh);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T0${hh}:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>${r}</ReportDateTime><TargetDateTime>${r}</TargetDateTime><InfoType>発表</InfoType><Serial>${hh}</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>
<!-- ${type} -->`;
}

function vpwpXml(hh: number): string {
  const r = reportDateTimeOf(hh);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報時系列情報（Ｒ０６）</Title><DateTime>2026-09-09T0${hh}:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都警戒・注意事項時系列情報</Title><ReportDateTime>${r}</ReportDateTime><TargetDateTime>${r}</TargetDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>${r}</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Status>発表</Status><Property><Type>大雨浸水危険度</Type><SignificancyPart><Base><Significancy refID="1" type="大雨浸水危険度"><Name>警戒レベル２未満</Name><Code>11</Code></Significancy></Base></SignificancyPart></Property></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;
}

function vpfd51Xml(hh: number): string {
  const r = reportDateTimeOf(hh);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>府県天気予報（Ｒ１）</Title><DateTime>2026-09-09T0${hh}:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁予報部</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都府県天気予報</Title><ReportDateTime>${r}</ReportDateTime><TargetDateTime>${r}</TargetDateTime><InfoType>発表</InfoType><InfoKind>府県天気予報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>${r}</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間内卓越天気</Type><WeatherPart><jmx_eb:Weather refID="1" type="天気">くもり</jmx_eb:Weather></WeatherPart></Property></Kind>
<Kind><Property><Type>３時間内代表風</Type><WindDirectionPart><jmx_eb:WindDirection refID="1" type="風向" unit="８方位漢字">北</jmx_eb:WindDirection></WindDirectionPart><WindSpeedPart><WindSpeedLevel refID="1" type="風速階級">3</WindSpeedLevel></WindSpeedPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
<MeteorologicalInfos type="地点予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>${r}</DateTime></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間毎気温</Type><TemperaturePart><jmx_eb:Temperature refID="1" type="気温" unit="度">25</jmx_eb:Temperature></TemperaturePart></Property></Kind>
<Station><Name>東京</Name><Code>44132</Code></Station>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;
}

/** VPFD61(近)・VPFW60(遠) の早期注意情報 */
function earlyWarningXml(hh: number, type: 'VPFD61' | 'VPFW60'): string {
  const r = reportDateTimeOf(hh);
  const near = type === 'VPFD61';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control><Title>${near ? '早期注意情報（明後日まで）' : '警報級の可能性（明後日以降）'}</Title><DateTime>2026-09-09T0${hh}:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都早期注意情報</Title><ReportDateTime>${r}</ReportDateTime><TargetDateTime>${r}</TargetDateTime><InfoType>発表</InfoType><InfoKind>${near ? '警報級の可能性（明日まで）' : '警報級の可能性（明後日以降）'}</InfoKind><InfoKindVersion>${near ? '1.5_0' : '1.2_0'}</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>${near ? r : '2026-09-11T00:00:00+09:00'}</DateTime><Duration>${near ? 'PT6H' : 'P1D'}</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>${near ? '大雨の警報級の可能性' : '雨の警報級の可能性'}</Type><PossibilityRankOfWarningPart><jmx_eb:PossibilityRankOfWarning refID="1" type="${near ? '大雨の警報級の可能性' : '雨の警報級の可能性'}">${near ? '中' : '高'}</jmx_eb:PossibilityRankOfWarning></PossibilityRankOfWarningPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;
}

function xmlFor(url: string): string {
  const hh = Number(/\d{9}(\d)0000_0_/.exec(url)![1]);
  const type = /_([A-Z]{4}\d{2})_/.exec(url)![1]!;
  if (type === 'VPWP50') return vpwpXml(hh);
  if (type === 'VPFD51') return vpfd51Xml(hh);
  if (type === 'VPFD61' || type === 'VPFW60') return earlyWarningXml(hh, type);
  return vpwwXml(hh, type);
}

function atomFeed(urls: readonly string[]): string {
  const entries = urls
    .map(
      (
        u,
        i,
      ) => `<entry><title>t${i}</title><id>urn:e-${i}</id><updated>2026-09-09T00:00:00Z</updated>
<link rel="alternate" type="application/xml" href="${u}" /></entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>f</title><updated>2026-09-09T00:00:00Z</updated><id>feed:t</id>
${entries}
</feed>`;
}

interface Harness {
  readonly db: ReturnType<typeof initializeTestDatabases>;
  readonly fetched: string[];
  poll(
    trigger: JmaXmlPollTrigger,
    feedUrls: readonly string[],
    failUrls?: ReadonlySet<string>,
  ): ReturnType<typeof pollSingleFeed>;
  cleanup(): void;
}

function createHarness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-backfill-test-'));
  const db = initializeTestDatabases({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  const fetched: string[] = [];
  return {
    db,
    fetched,
    poll(trigger, feedUrls, failUrls = new Set()) {
      const fetchFn: typeof fetch = async (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === FEED_URL) {
          return new Response(atomFeed(feedUrls), { status: 200 });
        }
        fetched.push(url);
        if (failUrls.has(url)) return new Response('Server Error', { status: 500 });
        return new Response(xmlFor(url), { status: 200 });
      };
      return pollSingleFeed(db.weather.connection, LONG_FEED, trigger, 1, new Set<string>(), {
        fetchFn,
        venueRegistry: testVenueRegistry,
        clock: () => '2026-09-09T00:00:00.000Z',
      });
    },
    cleanup() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** 同一官署 hh=5..1 の新しい順 */
function fiveOf(type: string): string[] {
  return [5, 4, 3, 2, 1].map((hh) => docUrl(hh, type));
}

function recordedDocUrls(h: Harness): { attempts: string[]; receptions: string[] } {
  return {
    attempts: listFetchAttempts(h.db.weather.connection)
      .filter((a) => a.sourceKind === 'xml_document')
      .map((a) => a.requestUrl),
    receptions: listTelegramReceptions(h.db.weather.connection).map((r) => r.documentUrl),
  };
}

test('initial: VPWP50 同一官署5件＋VPWW55 5件のうち、GETは VPWP50 3件＋VPWW55 5件だけで、除外2件は記録されない', async () => {
  const h = createHarness();
  try {
    const vpwp = fiveOf('VPWP50');
    const vpww = fiveOf('VPWW55');
    const { feedResult } = await h.poll('initial', [...vpwp, ...vpww]);

    assert.deepEqual([...h.fetched].sort(), [...vpwp.slice(0, 3), ...vpww].sort());
    assert.equal(feedResult.skippedBackfillLimitCount, 2);
    assert.equal(feedResult.discoveredCount, 10);
    assert.equal(feedResult.downloadedCount, 8);

    // AC-4: 除外URLは fetch_attempt・telegram_reception のどちらにも無い
    const { attempts, receptions } = recordedDocUrls(h);
    for (const excluded of vpwp.slice(3)) {
      assert.equal(attempts.includes(excluded), false);
      assert.equal(receptions.includes(excluded), false);
    }
    assert.equal(attempts.length, 8);
    assert.equal(receptions.length, 8);
  } finally {
    h.cleanup();
  }
});

test('recovery も initial と同様に絞り込まれる', async () => {
  const h = createHarness();
  try {
    const vpwp = fiveOf('VPWP50');
    const { feedResult } = await h.poll('recovery', vpwp);
    assert.equal(h.fetched.length, 3);
    assert.equal(feedResult.skippedBackfillLimitCount, 2);
  } finally {
    h.cleanup();
  }
});

test('scheduled: 同じフィードを全件GETし、skippedBackfillLimitCount は 0', async () => {
  const h = createHarness();
  try {
    const all = [...fiveOf('VPWP50'), ...fiveOf('VPWW55')];
    const { feedResult } = await h.poll('scheduled', all);
    assert.equal(h.fetched.length, 10);
    assert.equal(feedResult.skippedBackfillLimitCount, 0);
    assert.equal(feedResult.downloadedCount, 10);
  } finally {
    h.cleanup();
  }
});

test('manual: 全件GETし、skippedBackfillLimitCount は 0', async () => {
  const h = createHarness();
  try {
    const { feedResult } = await h.poll('manual', fiveOf('VPWP50'));
    assert.equal(h.fetched.length, 5);
    assert.equal(feedResult.skippedBackfillLimitCount, 0);
  } finally {
    h.cleanup();
  }
});

test('recovery: 最新1件が既受信なら、GETは残り2件だけ（既受信を3件に数える）', async () => {
  const h = createHarness();
  try {
    const vpwp = fiveOf('VPWP50');
    await h.poll('scheduled', [vpwp[0]!]);
    assert.deepEqual(h.fetched, [vpwp[0]]);
    h.fetched.length = 0;

    const { feedResult } = await h.poll('recovery', vpwp);
    assert.deepEqual([...h.fetched].sort(), [vpwp[1]!, vpwp[2]!].sort());
    assert.equal(feedResult.skippedBackfillLimitCount, 2);
    assert.equal(feedResult.skippedDuplicateCount, 1);
  } finally {
    h.cleanup();
  }
});

test('initial: 最新の VPWP50 の取得が失敗しても2・3番目が取得され、snapshot は2番目の内容になる。4番目以降はGETされない', async () => {
  const h = createHarness();
  try {
    const vpwp = fiveOf('VPWP50');
    const { feedResult } = await h.poll('initial', vpwp, new Set([vpwp[0]!]));
    assert.deepEqual(h.fetched, [vpwp[0], vpwp[1], vpwp[2]]);
    assert.equal(feedResult.failedDocumentCount, 1);
    assert.equal(feedResult.downloadedCount, 2);

    const snapshot = findWarningTimeseriesSnapshot(h.db.weather.connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.telegram.reportDateTime, new Date(reportDateTimeOf(4)).toISOString());
  } finally {
    h.cleanup();
  }
});

/** 現況・snapshot 系テーブルの全行（採番ID・受信ID列を除く）を安定した文字列で返す */
function dumpDerivedTables(h: Harness): Record<string, string[]> {
  const tables = [
    'warning_current_snapshot',
    'warning_current_item',
    'warning_current_stream',
    'warning_timeseries_snapshot',
    'warning_timeseries_time_define',
    'warning_timeseries_value',
    'warning_timeseries_addition',
    'early_warning_snapshot',
    'early_warning_time_define',
    'early_warning_cell',
    'area_timeseries_snapshot',
    'area_timeseries_time_define',
    'area_timeseries_value',
  ];
  const dropped = new Set(['id', 'snapshot_id', 'reception_id']);
  const result: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = h.db.weather.connection.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      unknown
    >[];
    result[table] = rows
      .map((row) => JSON.stringify(Object.entries(row).filter(([key]) => !dropped.has(key))))
      .sort();
  }
  return result;
}

test('絞り込みあり（initial）と絞り込みなし（scheduled）で、現況・snapshot の全行が一致する', async () => {
  const limited = createHarness();
  const full = createHarness();
  try {
    // 新しい順。VPWS50 は WW 系と同形式の電文で現況ストリームを作る
    const feed = [
      ...fiveOf('VPWP50'),
      ...fiveOf('VPWS50'),
      ...fiveOf('VPWW55'),
      ...fiveOf('VPWW56'),
      ...fiveOf('VPFD51'),
      ...fiveOf('VPFD61'),
      ...fiveOf('VPFW60'),
    ];
    await limited.poll('initial', feed);
    await full.poll('scheduled', feed);
    assert.equal(limited.fetched.length, 5 * 2 + 3 * 5);
    assert.equal(full.fetched.length, 35);

    const a = dumpDerivedTables(limited);
    const b = dumpDerivedTables(full);
    assert.deepEqual(a, b);

    // 比較対象が空でないこと（空同士の一致で通過させない）。各 snapshot 系テーブルの行数が0でない
    for (const table of [
      'warning_current_snapshot',
      'warning_current_item',
      'warning_current_stream',
      'warning_timeseries_snapshot',
      'warning_timeseries_time_define',
      'warning_timeseries_value',
      'early_warning_snapshot',
      'early_warning_time_define',
      'early_warning_cell',
      'area_timeseries_snapshot',
      'area_timeseries_time_define',
      'area_timeseries_value',
    ]) {
      assert.ok(a[table]!.length > 0, `${table} が空`);
    }
  } finally {
    limited.cleanup();
    full.cleanup();
  }
});
