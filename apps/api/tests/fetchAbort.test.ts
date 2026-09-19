import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import { FetchAbortController } from '../src/polling/fetchAbort.js';
import { pollSingleFeed } from '../src/polling/jmaXmlPoller.js';
import type { JmaXmlFeedDefinition } from '../src/polling/jmaXmlFeeds.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-fetch-abort-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const sampleAtomXmlWith3Entries = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象警報・注意報</title>
  <updated>2026-09-19T00:00:00Z</updated>
  <id>feed-id</id>
  <entry>
    <title>気象警報・注意報（東京都）1</title>
    <id>entry-1</id>
    <updated>2026-09-19T00:00:00Z</updated>
    <link rel="alternate" type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/doc1.xml"/>
  </entry>
  <entry>
    <title>気象警報・注意報（東京都）2</title>
    <id>entry-2</id>
    <updated>2026-09-19T00:01:00Z</updated>
    <link rel="alternate" type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/doc2.xml"/>
  </entry>
  <entry>
    <title>気象警報・注意報（東京都）3</title>
    <id>entry-3</id>
    <updated>2026-09-19T00:02:00Z</updated>
    <link rel="alternate" type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/doc3.xml"/>
  </entry>
</feed>`;

const sampleTelegramXml = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象特別警報・警報・注意報</Title>
    <DateTime>2026-09-19T00:00:00Z</DateTime>
    <Status>通常</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>2026-09-19T09:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-19T09:00:00+09:00</TargetDateTime>
    <EventID>EVENT01</EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>同一報</InfoKind>
    <Infos>
      <TimeSeriesInfo>
        <TimeDef>
          <TimeId>1</TimeId>
          <DateTime>2026-09-19T09:00:00+09:00</DateTime>
        </TimeDef>
        <Item>
          <Kind>
            <Name>大雨注意報</Name>
            <Code>10</Code>
            <Status>発表</Status>
          </Kind>
          <Area>
            <Name>東京地方</Name>
            <Code>130010</Code>
          </Area>
        </Item>
      </TimeSeriesInfo>
    </Infos>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"/>
</Report>`;

test('AC11-(a): FetchAbortController の abort/reset の冪等性', () => {
  const controller = new FetchAbortController();

  // 初期状態
  assert.equal(controller.signal.aborted, false);
  assert.equal(controller.signal.reason, null);

  // 初回 abort('stop')
  controller.abort('stop');
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, 'stop');

  // 冪等性: 既に中断済みなら理由を上書きしない ('shutdown' を渡しても 'stop' のまま)
  controller.abort('shutdown');
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, 'stop');

  // reset() で中断状態を解除
  controller.reset();
  assert.equal(controller.signal.aborted, false);
  assert.equal(controller.signal.reason, null);

  // 冪等性: 連続 reset() でも安全
  controller.reset();
  assert.equal(controller.signal.aborted, false);
  assert.equal(controller.signal.reason, null);

  // 再度 abort('shutdown')
  controller.abort('shutdown');
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, 'shutdown');
});

test('AC11-(b): 中断後の pollSingleFeed が残りの電文を GET しない（fetchFn のスタブ呼び出し回数で検証）', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({
      databasePath: tempDb.databasePath,
      migrationsDirectory,
    });

    const feedDef: JmaXmlFeedDefinition = {
      kind: 'regular',
      url: 'https://example.com/xml/feed/regular.xml',
      sourceKind: 'xml_feed_regular',
      role: 'high_frequency',
    };

    const controller = new FetchAbortController();
    const fetchedUrls: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);

      if (url === feedDef.url) {
        return new Response(sampleAtomXmlWith3Entries, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }

      if (url === 'https://www.data.jma.go.jp/developer/xml/data/doc1.xml') {
        // 1件目の電文 GET 処理中に中断指示を発行
        controller.abort('stop');
        return new Response(sampleTelegramXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        });
      }

      // doc2.xml, doc3.xml は呼ばれてはならない
      return new Response(sampleTelegramXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    const processedUrls = new Set<string>();
    const result = await pollSingleFeed(
      db.connection,
      feedDef,
      'initial',
      1,
      processedUrls,
      { fetchFn: mockFetch },
      controller.signal,
    );

    // 1. 結果の outcome が 'aborted' であること
    assert.equal(result.feedResult.feedFetchOutcome, 'aborted');
    assert.equal(result.feedResult.downloadedCount, 1);
    assert.equal(result.feedResult.discoveredCount, 1);
    assert.equal(result.feedResult.failedDocumentCount, 0);

    // 2. fetchFn の呼び出し回数と URL の検証:
    // フィード本体 + doc1.xml の 2回のみであり、doc2.xml / doc3.xml は GET されていないこと
    assert.equal(fetchedUrls.length, 2);
    assert.deepEqual(fetchedUrls, [
      'https://example.com/xml/feed/regular.xml',
      'https://www.data.jma.go.jp/developer/xml/data/doc1.xml',
    ]);

    db.close();
  } finally {
    tempDb.cleanup();
  }
});
