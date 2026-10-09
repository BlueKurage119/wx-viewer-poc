import {
  createTemporaryTestDatabaseFixture,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { pollSingleFeed } from '../src/polling/jmaXmlPoller.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramWeatherScopes, weatherScopeBlocks } from '../src/runtime/weatherReadScope.js';
import { testVenueRegistry, eastVenueId, trcVenueId } from './helpers/venueConfigPreload.js';

test('地域コードを会場×運用区分×情報種へ変換し対象外の会場を含めない', () => {
  const cases = [
    ['VPWW55', '1310800', ['east|training|warnings']],
    ['VPWS50', '1311100', ['trc|training|warnings']],
    ['VPWP50', '1310800', ['east|training|warning-timeseries']],
    ['VPFD61', '130010', ['east|training|early-warning', 'trc|training|early-warning']],
    ['VPFW60', '130010', ['east|training|early-warning', 'trc|training|early-warning']],
    ['VPFD51', '130010', ['east|training|area-timeseries', 'trc|training|area-timeseries']],
    ['VPBS50', '1310800', ['east|training|bulletins']],
    ['VPHW50', '1311100', ['trc|training|bulletins']],
    ['VPHW51', '130010', ['east|training|bulletins', 'trc|training|bulletins']],
    ['VPWW55', '9999999', []],
  ] as const;
  for (const [telegramType, areaCode, expected] of cases) {
    assert.deepEqual(
      telegramWeatherScopes(testVenueRegistry, {
        telegramType,
        controlStatus: 'training',
        areas: [{ sequence: 1, areaCode, areaName: '試験地域', codeType: '試験' }],
      }),
      expected,
    );
  }
});

test('scopeの一致は会場・運用区分・情報種を区別し起動現況は会場内の未完了を検出する', () => {
  const scopes = ['east|normal|warnings'];
  assert.equal(weatherScopeBlocks(scopes, eastVenueId, 'normal', 'warnings'), true);
  assert.equal(weatherScopeBlocks(scopes, eastVenueId, 'training', 'warnings'), false);
  assert.equal(weatherScopeBlocks(scopes, eastVenueId, 'normal', 'bulletins'), false);
  assert.equal(weatherScopeBlocks(scopes, trcVenueId, 'normal', 'warnings'), false);
  assert.equal(weatherScopeBlocks(scopes, eastVenueId), true);
  assert.equal(weatherScopeBlocks(['east'], eastVenueId, 'training', 'bulletins'), true);
});

test('通常XML取得経路が地域コードではなく読取scopeをupdate.beginへ渡す', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const db = initializeTestDatabases(fixture.config);
  const captured: unknown[] = [];
  const documentUrl =
    'https://www.data.jma.go.jp/developer/xml/data/20261009000000_0_VPWW55_130000.xml';
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>試験</title><id>fixture</id><updated>2026-10-09T00:00:00Z</updated><entry><id>fixture-warning</id><title>試験警報</title><updated>2026-10-09T00:00:00Z</updated><link rel="alternate" type="application/xml" href="${documentUrl}"/></entry></feed>`;
  const xml = `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/"><Control><Title>試験警報</Title><DateTime>2026-10-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>試験</EditorialOffice><PublishingOffice>試験</PublishingOffice></Control><Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>試験警報</Title><ReportDateTime>2026-10-09T00:00:00Z</ReportDateTime><InfoType>発表</InfoType><InfoKind>試験</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion><Headline><Information type="気象警報・注意報"><Item><Areas codeType="気象情報／細分区域等"><Area><Name>江東区</Name><Code>1310800</Code></Area></Areas></Item></Information></Headline></Head><Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"/></Report>`;
  try {
    const result = await pollSingleFeed(
      db.weather.connection,
      {
        kind: 'extra',
        sourceKind: 'xml_feed_extra',
        role: 'high_frequency',
        url: 'https://example.test/feed.xml',
      },
      'manual',
      1,
      new Set(),
      {
        venueRegistry: testVenueRegistry,
        fetchFn: async (input) =>
          new Response(String(input) === documentUrl ? xml : feed, {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
        runWeatherUpdate: async (work, scope) => {
          captured.push(scope?.scopes);
          return work();
        },
      },
    );
    assert.equal(result.feedResult.downloadedCount, 1);
    assert.deepEqual(captured, [['east|normal|warnings']]);
  } finally {
    db.close();
    fixture.cleanup();
  }
});
