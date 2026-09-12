import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  listFetchAttempts,
  listTelegramReceptions,
  findTelegramReceptionById,
  findWarningTimeseriesSnapshot,
  findEarlyWarningSnapshot,
  findAreaTimeseriesSnapshot,
  findBosaiBulletin,
  listBosaiBulletins,
  listWarningCurrentStreams,
  listNotificationOutputHistory,
} from '../src/repositories/index.js';
import {
  JMA_XML_FEED_DEFINITIONS,
  getFeedDefinitionsForTrigger,
} from '../src/polling/jmaXmlFeeds.js';
import {
  FeedBackoffManager,
  calculateBackoffDelaySeconds,
  classifyNotificationLevel,
} from '../src/polling/retryBackoff.js';
import {
  parseAtomFeed,
  parseTelegramXml,
  extractTelegramTypeFromUrl,
} from '../src/polling/jmaXmlFeedParser.js';
import { performHttpGet, sanitizeUrl, sanitizeErrorMessage } from '../src/polling/httpGet.js';
import {
  JmaXmlPollingService,
  type PollingTimerScheduler,
} from '../src/polling/jmaXmlPollingService.js';
import { startServer } from '../src/server.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-polling-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

interface TestHttpServer {
  readonly baseUrl: string;
  readonly port: number;
  readonly requestCounts: Map<string, number>;
  setHandler(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): void;
  close(): Promise<void>;
}

const defaultXmlFreshnessPolicy = { staleAfterSeconds: 300 };

async function createTestHttpServer(): Promise<TestHttpServer> {
  const requestCounts = new Map<string, number>();
  let currentHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (
    _req,
    res,
  ) => {
    res.statusCode = 404;
    res.end('Not found');
  };

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);
    currentHandler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as { port: number };

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requestCounts,
    setHandler(handler) {
      currentHandler = handler;
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function createSampleAtomFeed(entries: Array<{ id: string; title: string; href: string }>): string {
  const entryTags = entries
    .map(
      (e) => `
    <entry>
      <title>${e.title}</title>
      <id>${e.id}</id>
      <updated>2026-09-09T00:00:00Z</updated>
      <link rel="alternate" type="application/xml" href="${e.href}" />
    </entry>
  `,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象庁XMLフィード</title>
  <updated>2026-09-09T00:00:00Z</updated>
  <id>feed:test</id>
  ${entryTags}
</feed>`;
}

function createSampleTelegramXml(options?: {
  controlStatus?: string;
  title?: string;
  reportDateTime?: string;
  areas?: Array<{ code: string; name: string; codeType?: string }>;
  omitControl?: boolean;
  omitHead?: boolean;
  invalidNamespace?: boolean;
}): string {
  if (options?.invalidNamespace) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://invalid.example.com/xml">
  <Control><Status>通常</Status><DateTime>2026-09-09T00:00:00Z</DateTime></Control>
  <Head><Title>テスト</Title><ReportDateTime>2026-09-09T00:00:00Z</ReportDateTime></Head>
</Report>`;
  }

  const status = options?.controlStatus ?? '通常';
  const title = options?.title ?? '気象警報・注意報（テスト）';
  const reportDateTime = options?.reportDateTime ?? '2026-09-09T09:00:00+09:00';
  const areas = options?.areas ?? [
    { code: '1310800', name: '江東区', codeType: '気象情報／細分区域等' },
  ];

  const controlBlock = options?.omitControl
    ? ''
    : `<Control>
  <Title>${title}</Title>
  <DateTime>2026-09-09T00:00:00Z</DateTime>
  <Status>${status}</Status>
  <EditorialOffice>気象庁</EditorialOffice>
  <PublishingOffice>気象庁</PublishingOffice>
</Control>`;

  const areaBlocks = areas
    .map(
      (a) => `
    <Areas codeType="${a.codeType ?? ''}">
      <Area>
        <Name>${a.name}</Name>
        <Code>${a.code}</Code>
      </Area>
    </Areas>
  `,
    )
    .join('\n');

  const headBlock = options?.omitHead
    ? ''
    : `<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
  <Title>${title}</Title>
  <ReportDateTime>${reportDateTime}</ReportDateTime>
  <TargetDateTime>${reportDateTime}</TargetDateTime>
  <EventID>20260909000000</EventID>
  <InfoType>発表</InfoType>
  <Serial>1</Serial>
  <InfoKind>気象警報・注意報</InfoKind>
  <Headline>
    <Information type="気象警報・注意報（市町村等）">
      <Item>
        <Kind><Name>大雨警報</Name><Code>03</Code></Kind>
        ${areaBlocks}
      </Item>
    </Information>
  </Headline>
</Head>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
  ${controlBlock}
  ${headBlock}
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
  </Body>
</Report>`;
}

// -------------------------------------------------------------------------------------------------
// 1. 4 フィード定義の完全一致と通常・初期化サイクルの対象フィード
// -------------------------------------------------------------------------------------------------
test('1. 4 フィード定義の URL・sourceKind・役割が完全一致し、通常サイクルが高頻度 2 フィードだけ、初期化サイクルが 4 フィードを取得する', () => {
  assert.equal(JMA_XML_FEED_DEFINITIONS.length, 4);

  const regularDef = JMA_XML_FEED_DEFINITIONS.find((f) => f.kind === 'regular');
  assert.deepEqual(regularDef, {
    kind: 'regular',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml',
    sourceKind: 'xml_feed_regular',
    role: 'high_frequency',
  });

  const extraDef = JMA_XML_FEED_DEFINITIONS.find((f) => f.kind === 'extra');
  assert.deepEqual(extraDef, {
    kind: 'extra',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml',
    sourceKind: 'xml_feed_extra',
    role: 'high_frequency',
  });

  const regularLDef = JMA_XML_FEED_DEFINITIONS.find((f) => f.kind === 'regular_l');
  assert.deepEqual(regularLDef, {
    kind: 'regular_l',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml',
    sourceKind: 'xml_feed_regular_long',
    role: 'long_term',
  });

  const extraLDef = JMA_XML_FEED_DEFINITIONS.find((f) => f.kind === 'extra_l');
  assert.deepEqual(extraLDef, {
    kind: 'extra_l',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml',
    sourceKind: 'xml_feed_extra_long',
    role: 'long_term',
  });

  // scheduled / manual は高頻度 2 フィードのみ
  const scheduledDefs = getFeedDefinitionsForTrigger('scheduled');
  assert.deepEqual(
    scheduledDefs.map((f) => f.kind),
    ['regular', 'extra'],
  );
  const manualDefs = getFeedDefinitionsForTrigger('manual');
  assert.deepEqual(
    manualDefs.map((f) => f.kind),
    ['regular', 'extra'],
  );

  // initial / recovery は 4 フィードすべて
  const initialDefs = getFeedDefinitionsForTrigger('initial');
  assert.deepEqual(
    initialDefs.map((f) => f.kind),
    ['regular', 'extra', 'regular_l', 'extra_l'],
  );
  const recoveryDefs = getFeedDefinitionsForTrigger('recovery');
  assert.deepEqual(
    recoveryDefs.map((f) => f.kind),
    ['regular', 'extra', 'regular_l', 'extra_l'],
  );
});

// -------------------------------------------------------------------------------------------------
// 1b. XMLパーサーが Atom と電文 XML の名前空間・属性・繰返し要素を正しく区別すること
// -------------------------------------------------------------------------------------------------
test('1b. XMLパーサーが Atom と電文 XML の名前空間・属性・繰返し要素を正しく区別する', () => {
  // Atom名前空間の識別
  const noNsAtomXml =
    '<feed><entry><link href="https://www.data.jma.go.jp/developer/xml/data/doc.xml"/></entry></feed>';
  assert.throws(
    () => parseAtomFeed(noNsAtomXml),
    /Atomフィードのルート要素が <feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"> ではありません/,
  );

  // 繰返し要素と属性の抽出
  const validAtomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:1</id>
    <title>タイトル1</title>
    <link rel="alternate" type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/1.xml" />
  </entry>
  <entry>
    <id>urn:2</id>
    <title>タイトル2</title>
    <link rel="alternate" type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/2.xml" />
  </entry>
</feed>`;
  const entries = parseAtomFeed(validAtomXml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.documentUrl, 'https://www.data.jma.go.jp/developer/xml/data/1.xml');
  assert.equal(entries[1]?.documentUrl, 'https://www.data.jma.go.jp/developer/xml/data/2.xml');

  // 電文XMLの名前空間と属性・地域繰返し要素の識別
  const sampleDocUrl =
    'https://www.data.jma.go.jp/developer/xml/data/20260909000000_0_VPWW55_130000.xml';
  assert.equal(extractTelegramTypeFromUrl(sampleDocUrl), 'VPWW55');

  const parsed = parseTelegramXml(createSampleTelegramXml(), sampleDocUrl);
  assert.equal(parsed.isValidEnvelope, true);
  assert.equal(parsed.telegramType, 'VPWW55');
  assert.equal(parsed.controlStatus, 'normal');
  assert.equal(parsed.areas.length, 1);
  assert.equal(parsed.areas[0]?.codeType, '気象情報／細分区域等');
});

// -------------------------------------------------------------------------------------------------
// 2. Atom エントリの link.href でだけ個別電文を取得する
// -------------------------------------------------------------------------------------------------
test('2. Atom エントリの link.href でだけ個別電文を取得する。題名・日時・官署コードから URL を組み立てる実装では成功しないフィクスチャを用いる', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const arbitraryDocPath = '/arbitrary-opaque-token-not-constructible-from-metadata.xml';
    const docUrl = `${server.baseUrl}${arbitraryDocPath}`;

    const telegramXml = createSampleTelegramXml({
      title: '東京都気象警報・注意報（自作不可能フィクスチャ）',
    });

    const feedXml = createSampleAtomFeed([
      {
        id: 'urn:uuid:custom-entry-1',
        title: '気象警報・注意報',
        href: docUrl,
      },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/xml');
        res.end(feedXml);
        return;
      }
      if (req.url === arbitraryDocPath) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/xml');
        res.end(telegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    // テストサーバーの URL にリダイレクト・差し替えるカスタム fetch を注入
    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    const result = await service.pollOnce('scheduled');
    assert.equal(result.feedResults.length, 2);

    // arbitraryDocPath への GET が 1 回発生したことを検証
    assert.equal(server.requestCounts.get(arbitraryDocPath), 1);

    // telegram_reception に保存された document_url が完全一致すること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 1);
    assert.equal(receptions[0].documentUrl, docUrl);
    assert.equal(receptions[0].title, '東京都気象警報・注意報（自作不可能フィクスチャ）');
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 3. 同じ document_url が複数フィードまたは同一フィードに掲載されても、個別 GET と追記が各 1 回だけ
// -------------------------------------------------------------------------------------------------
test('3. 同じ document_url が複数フィードまたは同一フィードに掲載されても、個別 GET と telegram_reception 追記が各 1 回だけである', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const sharedDocPath = '/data/shared-20260909_0_VPWW55_130000.xml';
    const sharedDocUrl = `${server.baseUrl}${sharedDocPath}`;
    const telegramXml = createSampleTelegramXml();

    // regular に 2 件（重複）、extra にも同じ 1 件が含まれるフィード
    const regularFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-1', title: '警報1', href: sharedDocUrl },
      { id: 'urn:entry-2', title: '警報2(同一URL)', href: sharedDocUrl },
    ]);
    const extraFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-3', title: '警報3(別フィード同一URL)', href: sharedDocUrl },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(extraFeedXml);
        return;
      }
      if (req.url === sharedDocPath) {
        res.statusCode = 200;
        res.end(telegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    const cycleResult = await service.pollOnce('scheduled');

    // regular フィード: 発見2, スキップ1, ダウンロード1
    const regularResult = cycleResult.feedResults.find((r) => r.feedKind === 'regular');
    assert.deepEqual(regularResult, {
      feedKind: 'regular',
      feedFetchOutcome: 'success',
      discoveredCount: 2,
      skippedDuplicateCount: 1,
      downloadedCount: 1,
      failedDocumentCount: 0,
    });

    // extra フィード: 発見1, スキップ1 (既処理), ダウンロード0
    const extraResult = cycleResult.feedResults.find((r) => r.feedKind === 'extra');
    assert.deepEqual(extraResult, {
      feedKind: 'extra',
      feedFetchOutcome: 'success',
      discoveredCount: 1,
      skippedDuplicateCount: 1,
      downloadedCount: 0,
      failedDocumentCount: 0,
    });

    // 個別電文 URL への GET リクエストは完全一致で 1 回だけ
    assert.equal(server.requestCounts.get(sharedDocPath), 1);

    // telegram_reception テーブルへの追記も 1 回だけ
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 1);
    assert.equal(receptions[0].documentUrl, sharedDocUrl);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 4. 前サイクルで受信済みの URL は、次サイクルで個別 GET を行わず、フィード取得試行だけを追記する
// -------------------------------------------------------------------------------------------------
test('4. 前サイクルで受信済みの URL は、次サイクルで個別 GET を行わず、フィード取得試行だけを追記する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPath = '/data/test_doc_20260909_0_VPWW55_130000.xml';
    const docUrl = `${server.baseUrl}${docPath}`;
    const telegramXml = createSampleTelegramXml();

    const feedXml = createSampleAtomFeed([{ id: 'urn:entry-1', title: '警報', href: docUrl }]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === docPath) {
        res.statusCode = 200;
        res.end(telegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    let currentTime = '2026-09-09T01:00:00Z';
    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => currentTime,
    });

    // サイクル 1 回目
    const cycle1 = await service.pollOnce('scheduled');
    assert.equal(server.requestCounts.get(docPath), 1);
    const regularResult1 = cycle1.feedResults.find((r) => r.feedKind === 'regular');
    assert.equal(regularResult1?.downloadedCount, 1);
    assert.equal(regularResult1?.skippedDuplicateCount, 0);

    const receptions1 = listTelegramReceptions(db.connection);
    assert.equal(receptions1.length, 1);

    const fetchAttempts1 = listFetchAttempts(db.connection);
    // regular(feed), doc, extra(feed) => 計 3 件
    assert.equal(fetchAttempts1.length, 3);

    // サイクル 2 回目（60秒後）
    currentTime = '2026-09-09T01:01:00Z';
    const cycle2 = await service.pollOnce('scheduled');
    // 個別電文への GET は増えない（1 回のまま）
    assert.equal(server.requestCounts.get(docPath), 1);

    const regularResult2 = cycle2.feedResults.find((r) => r.feedKind === 'regular');
    assert.equal(regularResult2?.downloadedCount, 0);
    assert.equal(regularResult2?.skippedDuplicateCount, 1);

    // telegram_reception も増えない
    const receptions2 = listTelegramReceptions(db.connection);
    assert.equal(receptions2.length, 1);

    // フィードの fetch_attempt だけが追記される（regular, extra の2件追加で計 5 件）
    const fetchAttempts2 = listFetchAttempts(db.connection);
    assert.equal(fetchAttempts2.length, 5);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 5. 正常な名前空間、Control、Head、地域要素を持つ本文が完全一致で往復する
// -------------------------------------------------------------------------------------------------
test('5. 正常な名前空間、Control、Head、地域要素を持つ本文が、原文、SHA-256、Atom ID、由来フィード、共通ヘッダ、地域明細を含んで完全一致で往復する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPath = '/data/20260909000000_0_VPWW55_130000.xml';
    const docUrl = `${server.baseUrl}${docPath}`;

    const areasInput = [
      { code: '1310800', name: '江東区', codeType: '気象情報／細分区域等' },
      { code: '130010', name: '東京地方', codeType: '気象情報／府県予報区等' },
    ];
    const telegramXml = createSampleTelegramXml({
      controlStatus: '通常',
      title: '東京都大雨警報・注意報',
      reportDateTime: '2026-09-09T10:00:00+09:00',
      areas: areasInput,
    });
    const expectedHash = crypto.createHash('sha256').update(telegramXml).digest('hex');

    const feedXml = createSampleAtomFeed([
      { id: 'urn:uuid:entry-rec-5', title: '大雨警報', href: docUrl },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === docPath) {
        res.statusCode = 200;
        res.end(telegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    await service.pollOnce('scheduled');

    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 1);
    const reception = findTelegramReceptionById(db.connection, receptions[0].id);
    assert.ok(reception);

    // 完全一致検証
    assert.equal(reception.feedKind, 'regular');
    assert.equal(reception.feedEntryId, 'urn:uuid:entry-rec-5');
    assert.equal(reception.documentUrl, docUrl);
    assert.equal(reception.telegramType, 'VPWW55');
    assert.equal(reception.title, '東京都大雨警報・注意報');
    assert.equal(reception.controlStatus, 'normal');
    assert.equal(reception.infoType, '発表');
    assert.equal(reception.eventId, '20260909000000');
    assert.equal(reception.serial, '1');
    assert.equal(reception.controlDateTime, '2026-09-09T00:00:00.000Z');
    assert.equal(reception.reportDateTime, '2026-09-09T01:00:00.000Z');
    assert.equal(reception.targetDateTime, '2026-09-09T01:00:00.000Z');
    // 会場に依存しない構造不正のため east/trc 両方に同じ判定が記録される
    assert.deepEqual(
      reception.adoptions.map((a) => a.adoptionResult),
      ['未対応構造', '未対応構造'],
    );
    for (const adoption of reception.adoptions) {
      assert.ok(adoption.adoptionReason && adoption.adoptionReason.length > 0);
      assert.equal(adoption.adoptionDecidedAt, '2026-09-09T01:00:00Z');
    }
    assert.equal(reception.contentHash, expectedHash);
    assert.equal(reception.rawBody, telegramXml);

    // 地域明細の検証 (sequence順)
    assert.equal(reception.areas.length, 2);
    assert.deepEqual(reception.areas[0], {
      id: reception.areas[0].id,
      areaCode: '1310800',
      areaName: '江東区',
      codeType: '気象情報／細分区域等',
      sequence: 1,
    });
    assert.deepEqual(reception.areas[1], {
      id: reception.areas[1].id,
      areaCode: '130010',
      areaName: '東京地方',
      codeType: '気象情報／府県予報区等',
      sequence: 2,
    });
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 6. 本文の名前空間・共通構造・地域要素が不正なら、原文と種別固有の不採用理由が残る
// -------------------------------------------------------------------------------------------------
test('6. title だけが対象らしく見えても、本文の名前空間・共通構造・地域要素が不正なら、空の正常情報へ変換せず、原文と種別固有の不採用理由が残る', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    // 不正な3つの電文
    // doc1: 名前空間不正
    // doc2: Control 要素なし
    // doc3: 地域要素なし
    const docPath1 = '/data/20260909_0_VPWW55_invalid_ns.xml';
    const docPath2 = '/data/20260909_0_VPWW56_no_control.xml';
    const docPath3 = '/data/20260909_0_VPWW57_no_area.xml';

    const xml1 = createSampleTelegramXml({ invalidNamespace: true });
    const xml2 = createSampleTelegramXml({ omitControl: true });
    const xml3 = createSampleTelegramXml({ areas: [] });

    const feedXml = createSampleAtomFeed([
      { id: 'urn:entry-bad-1', title: '不正名前空間', href: `${server.baseUrl}${docPath1}` },
      { id: 'urn:entry-bad-2', title: 'Control欠損', href: `${server.baseUrl}${docPath2}` },
      { id: 'urn:entry-bad-3', title: '地域欠損', href: `${server.baseUrl}${docPath3}` },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === docPath1) {
        res.statusCode = 200;
        res.end(xml1);
        return;
      }
      if (req.url === docPath2) {
        res.statusCode = 200;
        res.end(xml2);
        return;
      }
      if (req.url === docPath3) {
        res.statusCode = 200;
        res.end(xml3);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    await service.pollOnce('scheduled');

    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 3);

    // 3件とも C2 の種別固有検証で未対応構造として記録されていること（会場に依存しない構造不正のため east/trc 両方）
    for (const rSummary of receptions) {
      assert.deepEqual(
        rSummary.adoptions.map((a) => a.adoptionResult),
        ['未対応構造', '未対応構造'],
      );
      for (const adoption of rSummary.adoptions) {
        assert.ok(adoption.adoptionReason && adoption.adoptionReason.length > 0);
      }
      const detail = findTelegramReceptionById(db.connection, rSummary.id);
      assert.ok(detail?.rawBody); // 原文が保持されていること
    }

    // それぞれの失敗理由の確認（east 側で代表確認）
    const r1 = receptions.find((r) => r.documentUrl.includes('invalid_ns'));
    assert.match(
      r1?.adoptions.find((a) => a.venueId === 'east')?.adoptionReason ?? '',
      /ルート要素|名前空間/,
    );

    const r2 = receptions.find((r) => r.documentUrl.includes('no_control'));
    assert.match(r2?.adoptions.find((a) => a.venueId === 'east')?.adoptionReason ?? '', /Control/);

    const r3 = receptions.find((r) => r.documentUrl.includes('no_area'));
    assert.match(
      r3?.adoptions.find((a) => a.venueId === 'east')?.adoptionReason ?? '',
      /Warning|地域/,
    );
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 7. HTTP 非成功、ネットワーク例外、10 秒 timeout が fetch_attempt に記録され、timeout の httpStatus が null
// -------------------------------------------------------------------------------------------------
test('7. フィード・個別電文の HTTP 非成功、ネットワーク例外、10 秒 timeout が fetch_attempt に失敗として記録され、timeout の httpStatus が null である', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPathTimeout = '/data/20260909_0_VPWW55_timeout.xml';
    const docPath500 = '/data/20260909_0_VPWW55_500.xml';

    const feedXml = createSampleAtomFeed([
      { id: 'urn:timeout', title: 'タイムアウト電文', href: `${server.baseUrl}${docPathTimeout}` },
      { id: 'urn:server-error', title: '500電文', href: `${server.baseUrl}${docPath500}` },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        // フィード自体の HTTP 503 エラー
        res.statusCode = 503;
        res.end('Service Unavailable');
        return;
      }
      if (req.url === docPath500) {
        res.statusCode = 500;
        res.end('Internal Server Error');
        return;
      }
      if (req.url === docPathTimeout) {
        // レスポンスを返さずハング（カスタムfetchでTimeoutErrorを発生させる）
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes(docPathTimeout)) {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        return Promise.reject(timeoutErr);
      }
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    await service.pollOnce('scheduled');

    const attempts = listFetchAttempts(db.connection);

    // 1. extra.xml の HTTP 503
    const extraAttempt = attempts.find((a) => a.sourceKind === 'xml_feed_extra');
    assert.ok(extraAttempt);
    assert.equal(extraAttempt.outcome, 'failure');
    assert.equal(extraAttempt.httpStatus, 503);
    assert.equal(extraAttempt.errorKind, 'http_status');

    // 2. docPathTimeout のタイムアウト (httpStatus は null)
    const timeoutAttempt = attempts.find((a) => a.requestUrl.includes(docPathTimeout));
    assert.ok(timeoutAttempt);
    assert.equal(timeoutAttempt.outcome, 'failure');
    assert.equal(timeoutAttempt.httpStatus, null);
    assert.equal(timeoutAttempt.errorKind, 'timeout');

    // 3. docPath500 の HTTP 500
    const serverErrAttempt = attempts.find((a) => a.requestUrl.includes(docPath500));
    assert.ok(serverErrAttempt);
    assert.equal(serverErrAttempt.outcome, 'failure');
    assert.equal(serverErrAttempt.httpStatus, 500);
    assert.equal(serverErrAttempt.errorKind, 'http_status');

    // 失敗した電文の telegram_reception 空行は作られないこと
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 0);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 8. 指数バックオフ (60, 120, 240, 300, 300秒) とフィード独立性
// -------------------------------------------------------------------------------------------------
test('8. 同一フィードの連続失敗で待機値が 60、120、240、300、300 秒となり、成功後は 60 秒へ戻る。一方の待機が他方の取得を止めない', () => {
  // バックオフ計算関数の検証
  assert.equal(calculateBackoffDelaySeconds(0), 0);
  assert.equal(calculateBackoffDelaySeconds(1), 60);
  assert.equal(calculateBackoffDelaySeconds(2), 120);
  assert.equal(calculateBackoffDelaySeconds(3), 240);
  assert.equal(calculateBackoffDelaySeconds(4), 300);
  assert.equal(calculateBackoffDelaySeconds(5), 300);
  assert.equal(calculateBackoffDelaySeconds(6), 300);

  const manager = new FeedBackoffManager();
  const baseTime = '2026-09-09T00:00:00.000Z';

  // 1回目失敗 (regular)
  manager.recordFailure('regular', baseTime, 'error1');
  const status1 = manager.getStatus('regular', baseTime);
  assert.equal(status1.consecutiveFailures, 1);
  assert.equal(status1.isWaiting, true);
  assert.equal(status1.nextAllowedFetchAt, '2026-09-09T00:01:00.000Z'); // 60秒後

  // 2回目失敗
  manager.recordFailure('regular', '2026-09-09T00:01:00.000Z', 'error2');
  const status2 = manager.getStatus('regular', '2026-09-09T00:01:00.000Z');
  assert.equal(status2.consecutiveFailures, 2);
  assert.equal(status2.nextAllowedFetchAt, '2026-09-09T00:03:00.000Z'); // 120秒後

  // 3回目失敗
  manager.recordFailure('regular', '2026-09-09T00:03:00.000Z', 'error3');
  const status3 = manager.getStatus('regular', '2026-09-09T00:03:00.000Z');
  assert.equal(status3.consecutiveFailures, 3);
  assert.equal(status3.nextAllowedFetchAt, '2026-09-09T00:07:00.000Z'); // 240秒後

  // 4回目失敗
  manager.recordFailure('regular', '2026-09-09T00:07:00.000Z', 'error4');
  const status4 = manager.getStatus('regular', '2026-09-09T00:07:00.000Z');
  assert.equal(status4.consecutiveFailures, 4);
  assert.equal(status4.nextAllowedFetchAt, '2026-09-09T00:12:00.000Z'); // 300秒後

  // 5回目失敗
  manager.recordFailure('regular', '2026-09-09T00:12:00.000Z', 'error5');
  const status5 = manager.getStatus('regular', '2026-09-09T00:12:00.000Z');
  assert.equal(status5.consecutiveFailures, 5);
  assert.equal(status5.nextAllowedFetchAt, '2026-09-09T00:17:00.000Z'); // 300秒後

  // 一方の待機が他方の取得を止めない: extra は待機中ではない
  const extraStatus = manager.getStatus('extra', '2026-09-09T00:12:00.000Z');
  assert.equal(extraStatus.isWaiting, false);
  assert.equal(extraStatus.consecutiveFailures, 0);

  // 成功でリセット
  manager.recordSuccess('regular', '2026-09-09T00:17:00.000Z');
  const statusSuccess = manager.getStatus('regular', '2026-09-09T00:17:00.000Z');
  assert.equal(statusSuccess.consecutiveFailures, 0);
  assert.equal(statusSuccess.isWaiting, false);
  assert.equal(statusSuccess.nextAllowedFetchAt, null);

  // 再度失敗したら 60 秒へ戻る
  manager.recordFailure('regular', '2026-09-09T00:18:00.000Z', 'error_new');
  const statusReset = manager.getStatus('regular', '2026-09-09T00:18:00.000Z');
  assert.equal(statusReset.consecutiveFailures, 1);
  assert.equal(statusReset.nextAllowedFetchAt, '2026-09-09T00:19:00.000Z'); // 再び60秒後
});

// -------------------------------------------------------------------------------------------------
// 9. 同時の pollOnce は同一 Promise を共有し、上流 GET が 1 回だけ
// -------------------------------------------------------------------------------------------------
test('9. 同時の pollOnce は同一 Promise を共有し、上流のフィード GET がフィードごとに 1 回だけである', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      // 少し応答を遅延させることで並行呼出しの集約をテスト
      setTimeout(() => {
        if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
          res.statusCode = 200;
          res.end(feedXml);
          return;
        }
        res.statusCode = 404;
        res.end('Not found');
      }, 30);
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    // 3 つの pollOnce を同時に呼び出す
    const p1 = service.pollOnce('scheduled');
    const p2 = service.pollOnce('scheduled');
    const p3 = service.pollOnce('scheduled');

    // 同一の Promise インスタンスであること
    assert.strictEqual(p1, p2);
    assert.strictEqual(p2, p3);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.strictEqual(r1, r2);
    assert.strictEqual(r2, r3);

    // 上流のフィード GET が regular, extra それぞれ 1 回だけ行われたこと
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 10. start() の複数呼出しがタイマーを増やさず、stop() 後は追加サイクルを開始しない
// -------------------------------------------------------------------------------------------------
test('10. start() の複数呼出しがタイマーを増やさず、stop() 後は追加サイクルを開始しない。実行中サイクルと DB を安全に終了する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      intervalMs: 50, // テスト用に短縮
      clock: () => '2026-09-09T01:00:00Z',
    });

    // 複数回 start() を呼ぶ
    const p1 = service.start();
    const p2 = service.start();
    const p3 = service.start();

    const statusBefore = service.getStatus();
    assert.equal(statusBefore.isRunning, true);

    // 初回実行完了を待つ
    await Promise.all([p1, p2, p3]);

    // stop() を呼ぶ
    await service.stop();

    const statusAfter = service.getStatus();
    assert.equal(statusAfter.isRunning, false);

    const regularCountsAtStop = server.requestCounts.get('/feed/regular.xml') ?? 0;

    // stop() 後に追加サイクルが開始されないことを確認
    await new Promise((resolve) => setTimeout(resolve, 150));
    const regularCountsAfterWait = server.requestCounts.get('/feed/regular.xml') ?? 0;

    assert.equal(regularCountsAfterWait, regularCountsAtStop);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 11. startServer() の既定起動で 4 フィードの初期サイクルが実行され、enablePolling=false では外部リクエストが 0 件
// -------------------------------------------------------------------------------------------------
test('11. startServer() の既定起動で 4 フィードの初期サイクルが実行され、enablePolling=false では外部リクエストが 0 件', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const config = { databasePath, migrationsDirectory };
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    // enablePolling を明示指定せず（既定値で起動）テストダブル fetch を注入
    const apiServer = await startServer({
      config,
      port: 0,
      pollingServiceOptions: {
        fetchFn: customFetch,
        allowedUrlPrefixes: [server.baseUrl],
        allowHttpForTesting: true,
        clock: () => '2026-09-09T01:00:00Z',
      },
    });

    try {
      assert.ok(apiServer.pollingService, 'pollingService が存在する');
      const status = apiServer.pollingService.getStatus();
      assert.equal(status.isRunning, true, '既定でポーリングが開始されている');
      assert.equal(status.initialFetch.phase, 'completed');
      assert.equal(status.initialFetch.result?.completed, true);

      // 4 フィード (regular, extra, regular_l, extra_l) が各 1 回要求されたこと
      assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
      assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
      assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
      assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);
    } finally {
      await apiServer.close();
    }

    assert.equal(apiServer.pollingService?.getStatus().isRunning, false, 'close 後に停止している');

    // enablePolling=false の場合
    server.requestCounts.clear();
    const disabledServer = await startServer({
      config,
      port: 0,
      enablePolling: false,
    });
    try {
      assert.equal(disabledServer.pollingService, undefined);
      assert.equal(server.requestCounts.size, 0);
    } finally {
      await disabledServer.close();
    }
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 15. VPWP50 と VPWW55 の混在フィードをポーリングしたとき、種別ごとに正しくディスパッチされる
// -------------------------------------------------------------------------------------------------
test('15. VPWP50 と VPWW55 の混在フィードをポーリングしたとき、種別ごとに正しくディスパッチされ、各スナップショットが更新される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const vpwwUrl = `${server.baseUrl}/data/20260909_0_VPWW55_130000.xml`;
    const vpwpUrl = `${server.baseUrl}/data/20260909_0_VPWP50_130000.xml`;

    const vpwwXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>`;

    const vpwpXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報時系列情報（Ｒ０６）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都警戒・注意事項時系列情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Status>発表</Status><Property><Type>大雨浸水危険度</Type><SignificancyPart><Base><Significancy refID="1" type="大雨浸水危険度"><Name>警戒レベル２未満</Name><Code>11</Code></Significancy></Base></SignificancyPart></Property></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const regularFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-vpww', title: '警報発表', href: vpwwUrl },
      { id: 'urn:entry-vpwp', title: '警報時系列', href: vpwpUrl },
    ]);
    const emptyFeedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(emptyFeedXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWW55_130000.xml') {
        res.statusCode = 200;
        res.end(vpwwXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWP50_130000.xml') {
        res.statusCode = 200;
        res.end(vpwpXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T00:00:00.000Z',
    });

    const result = await service.pollOnce('scheduled');
    assert.equal(result.feedResults[0].downloadedCount, 2);

    // telegram_reception に 2 件保存されていること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 2);

    const vpwwReception = receptions.find((r) => r.telegramType === 'VPWW55');
    assert.ok(vpwwReception);
    assert.equal(
      vpwwReception.adoptions.find((a) => a.venueId === 'east')?.adoptionResult,
      '警報・注意報として解析済み',
    );

    const vpwpReception = receptions.find((r) => r.telegramType === 'VPWP50');
    assert.ok(vpwpReception);
    assert.equal(
      vpwpReception.adoptions.find((a) => a.venueId === 'east')?.adoptionResult,
      '警報等時系列として解析済み',
    );

    // 警報ストリームが保存されていること（個別報のため未初期化ストリームとして保存）
    const streams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].telegramType, 'VPWW55');

    // 時系列スナップショットが保存されていること
    const timeseries = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
    assert.ok(timeseries);
    assert.equal(timeseries.values.length, 1);
    assert.equal(timeseries.values[0].valueText, '警戒レベル２未満');
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 16. VPWW55, VPWP50, VPFD61, VPFW60 の混在フィードをポーリングしたとき、
//     種別ごとに正しくディスパッチされ、早期注意情報スナップショット（near/far）が更新され、
//     他種別に干渉しない。重複URLも1回だけ処理される。
// -------------------------------------------------------------------------------------------------
test('16. 混在フィードで VPFD61/VPFW60 は早期注意 processor にだけ dispatch され、他情報種別に非干渉、重複URLは抑止される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const vpwwUrl = `${server.baseUrl}/data/20260909_0_VPWW55_130000.xml`;
    const vpwpUrl = `${server.baseUrl}/data/20260909_0_VPWP50_130000.xml`;
    const vpfdUrl = `${server.baseUrl}/data/20260909_0_VPFD61_130000.xml`;
    const vpfwUrl = `${server.baseUrl}/data/20260909_0_VPFW60_130000.xml`;

    const vpwwXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>`;

    const vpwpXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報時系列情報（Ｒ０６）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都警戒・注意事項時系列情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Status>発表</Status><Property><Type>大雨浸水危険度</Type><SignificancyPart><Base><Significancy refID="1" type="大雨浸水危険度"><Name>警戒レベル２未満</Name><Code>11</Code></Significancy></Base></SignificancyPart></Property></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const vpfdXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control><Title>早期注意情報（明後日まで）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都早期注意情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>警報級の可能性（明日まで）</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT6H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>大雨の警報級の可能性</Type><PossibilityRankOfWarningPart><jmx_eb:PossibilityRankOfWarning refID="1" type="大雨の警報級の可能性">中</jmx_eb:PossibilityRankOfWarning></PossibilityRankOfWarningPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const vpfwXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control><Title>警報級の可能性（明後日以降）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都早期注意情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>警報級の可能性（明後日以降）</InfoKind><InfoKindVersion>1.2_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-11T00:00:00+09:00</DateTime><Duration>P1D</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>雨の警報級の可能性</Type><PossibilityRankOfWarningPart><jmx_eb:PossibilityRankOfWarning refID="1" type="雨の警報級の可能性">高</jmx_eb:PossibilityRankOfWarning></PossibilityRankOfWarningPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    // regularFeed: 4 電文
    const regularFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-vpww', title: '警報発表', href: vpwwUrl },
      { id: 'urn:entry-vpwp', title: '警報時系列', href: vpwpUrl },
      { id: 'urn:entry-vpfd', title: '早期注意(近)', href: vpfdUrl },
      { id: 'urn:entry-vpfw', title: '早期注意(遠)', href: vpfwUrl },
    ]);
    // extraFeed: vpfdUrl が重複して含まれている
    const extraFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-vpfd-dup', title: '早期注意(近)重複', href: vpfdUrl },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(extraFeedXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWW55_130000.xml') {
        res.statusCode = 200;
        res.end(vpwwXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWP50_130000.xml') {
        res.statusCode = 200;
        res.end(vpwpXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFD61_130000.xml') {
        res.statusCode = 200;
        res.end(vpfdXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFW60_130000.xml') {
        res.statusCode = 200;
        res.end(vpfwXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T00:00:00.000Z',
    });

    const result = await service.pollOnce('scheduled');

    // regularFeed: 4件ダウンロード, extraFeed: 重複1件スキップ
    assert.equal(result.feedResults[0].downloadedCount, 4);
    assert.equal(result.feedResults[1].skippedDuplicateCount, 1);
    assert.equal(result.feedResults[1].downloadedCount, 0);

    // telegram_reception に 4 件保存されていること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 4);

    const vpwwReception = receptions.find((r) => r.telegramType === 'VPWW55');
    assert.ok(vpwwReception);
    assert.equal(
      vpwwReception.adoptions.find((a) => a.venueId === 'east')?.adoptionResult,
      '警報・注意報として解析済み',
    );

    const vpwpReception = receptions.find((r) => r.telegramType === 'VPWP50');
    assert.ok(vpwpReception);
    assert.equal(
      vpwpReception.adoptions.find((a) => a.venueId === 'east')?.adoptionResult,
      '警報等時系列として解析済み',
    );

    const vpfdReception = receptions.find((r) => r.telegramType === 'VPFD61');
    assert.ok(vpfdReception);
    assert.deepEqual(
      vpfdReception.adoptions.map((a) => a.adoptionResult),
      ['早期注意情報として解析済み', '早期注意情報として解析済み'],
    );

    const vpfwReception = receptions.find((r) => r.telegramType === 'VPFW60');
    assert.ok(vpfwReception);
    assert.deepEqual(
      vpfwReception.adoptions.map((a) => a.adoptionResult),
      ['早期注意情報として解析済み', '早期注意情報として解析済み'],
    );

    // 早期注意スナップショット (near) が保存されていること
    const nearSnap = findEarlyWarningSnapshot(db.connection, '130010', 'near', 'normal');
    assert.ok(nearSnap);
    assert.equal(nearSnap.telegramType, 'VPFD61');
    assert.equal(nearSnap.cells[0].phenomenonCode, '大雨の警報級の可能性');
    assert.equal(nearSnap.cells[0].rankValue, '中');

    // 早期注意スナップショット (far) が保存されていること
    const farSnap = findEarlyWarningSnapshot(db.connection, '130010', 'far', 'normal');
    assert.ok(farSnap);
    assert.equal(farSnap.telegramType, 'VPFW60');
    assert.equal(farSnap.cells[0].phenomenonCode, '雨の警報級の可能性');
    assert.equal(farSnap.cells[0].rankValue, '高');

    // 現況警報・時系列・通知出力表への非干渉
    const streams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].telegramType, 'VPWW55');

    const timeseries = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
    assert.ok(timeseries);
    assert.equal(timeseries.values[0].valueText, '警戒レベル２未満');

    const notifications = listNotificationOutputHistory(db.connection);
    assert.equal(notifications.length, 0);

    // サーバーへのリクエスト回数: vpfdUrl は1回のみ（重複抑止）
    assert.equal(server.requestCounts.get('/data/20260909_0_VPFD61_130000.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 17. VPWW55, VPWP50, VPFD61, VPFW60, VPFD51 の混在フィードをポーリングしたとき、
//     VPFD51 は地域時系列予報 processor にだけ dispatch され、他情報種別に非干渉、重複URLは抑止される
// -------------------------------------------------------------------------------------------------
test('17. 混在フィードで VPFD51 は地域時系列予報 processor にだけ dispatch され、他情報種別に非干渉、重複URLは抑止される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const vpwwUrl = `${server.baseUrl}/data/20260909_0_VPWW55_130000.xml`;
    const vpwpUrl = `${server.baseUrl}/data/20260909_0_VPWP50_130000.xml`;
    const vpfd61Url = `${server.baseUrl}/data/20260909_0_VPFD61_130000.xml`;
    const vpfw60Url = `${server.baseUrl}/data/20260909_0_VPFW60_130000.xml`;
    const vpfd51Url = `${server.baseUrl}/data/20260909_0_VPFD51_130000.xml`;

    const vpwwXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>`;

    const vpwpXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報時系列情報（Ｒ０６）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都警戒・注意事項時系列情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Status>発表</Status><Property><Type>大雨浸水危険度</Type><SignificancyPart><Base><Significancy refID="1" type="大雨浸水危険度"><Name>警戒レベル２未満</Name><Code>11</Code></Significancy></Base></SignificancyPart></Property></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const vpfd61Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control><Title>早期注意情報（明後日まで）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都早期注意情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>警報級の可能性（明日まで）</InfoKind><InfoKindVersion>1.5_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT6H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>大雨の警報級の可能性</Type><PossibilityRankOfWarningPart><jmx_eb:PossibilityRankOfWarning refID="1" type="大雨の警報級の可能性">中</jmx_eb:PossibilityRankOfWarning></PossibilityRankOfWarningPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const vpfw60Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control><Title>警報級の可能性（明後日以降）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都早期注意情報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>警報級の可能性（明後日以降）</InfoKind><InfoKindVersion>1.2_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-11T00:00:00+09:00</DateTime><Duration>P1D</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>雨の警報級の可能性</Type><PossibilityRankOfWarningPart><jmx_eb:PossibilityRankOfWarning refID="1" type="雨の警報級の可能性">高</jmx_eb:PossibilityRankOfWarning></PossibilityRankOfWarningPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    const vpfd51Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>府県天気予報（Ｒ１）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁予報部</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都府県天気予報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>府県天気予報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間内卓越天気</Type><WeatherPart><jmx_eb:Weather refID="1" type="天気">くもり</jmx_eb:Weather></WeatherPart></Property></Kind>
<Kind><Property><Type>３時間内代表風</Type><WindDirectionPart><jmx_eb:WindDirection refID="1" type="風向" unit="８方位漢字">北</jmx_eb:WindDirection></WindDirectionPart><WindSpeedPart><WindSpeedLevel refID="1" type="風速階級">3</WindSpeedLevel></WindSpeedPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
<MeteorologicalInfos type="地点予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間毎気温</Type><TemperaturePart><jmx_eb:Temperature refID="1" type="気温" unit="度">25</jmx_eb:Temperature></TemperaturePart></Property></Kind>
<Station><Name>東京</Name><Code>44132</Code></Station>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    // regularFeed: 5 電文
    const regularFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-vpww', title: '警報発表', href: vpwwUrl },
      { id: 'urn:entry-vpwp', title: '警報時系列', href: vpwpUrl },
      { id: 'urn:entry-vpfd61', title: '早期注意(近)', href: vpfd61Url },
      { id: 'urn:entry-vpfw60', title: '早期注意(遠)', href: vpfw60Url },
      { id: 'urn:entry-vpfd51', title: '地域時系列予報', href: vpfd51Url },
    ]);
    // extraFeed: vpfd51Url が重複して含まれている
    const extraFeedXml = createSampleAtomFeed([
      { id: 'urn:entry-vpfd51-dup', title: '地域時系列予報重複', href: vpfd51Url },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(extraFeedXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWW55_130000.xml') {
        res.statusCode = 200;
        res.end(vpwwXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWP50_130000.xml') {
        res.statusCode = 200;
        res.end(vpwpXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFD61_130000.xml') {
        res.statusCode = 200;
        res.end(vpfd61Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFW60_130000.xml') {
        res.statusCode = 200;
        res.end(vpfw60Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFD51_130000.xml') {
        res.statusCode = 200;
        res.end(vpfd51Xml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T00:00:00.000Z',
    });

    const result = await service.pollOnce('scheduled');

    // regularFeed: 5件ダウンロード, extraFeed: 重複1件スキップ
    assert.equal(result.feedResults[0].downloadedCount, 5);
    assert.equal(result.feedResults[1].skippedDuplicateCount, 1);
    assert.equal(result.feedResults[1].downloadedCount, 0);

    // telegram_reception に 5 件保存されていること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 5);

    const vpfd51Reception = receptions.find((r) => r.telegramType === 'VPFD51');
    assert.ok(vpfd51Reception);
    assert.deepEqual(
      vpfd51Reception.adoptions.map((a) => a.adoptionResult),
      ['地域時系列予報として解析済み', '地域時系列予報として解析済み'],
    );

    // 地域時系列予報スナップショットが保存されていること
    const areaSnap = findAreaTimeseriesSnapshot(db.connection, '130010', '44132', 'normal');
    assert.ok(areaSnap);
    assert.equal(areaSnap.areaCode, '130010');
    assert.equal(areaSnap.stationCode, '44132');
    assert.equal(areaSnap.timeDefines.length, 2);
    assert.equal(areaSnap.values.length, 4);

    // 早期注意・現況警報・時系列・通知出力表への非干渉
    const nearSnap = findEarlyWarningSnapshot(db.connection, '130010', 'near', 'normal');
    assert.ok(nearSnap);

    const farSnap = findEarlyWarningSnapshot(db.connection, '130010', 'far', 'normal');
    assert.ok(farSnap);

    const streams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(streams.length, 1);

    const timeseries = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
    assert.ok(timeseries);

    const notifications = listNotificationOutputHistory(db.connection);
    assert.equal(notifications.length, 0);

    // サーバーへのリクエスト回数: vpfd51Url は1回のみ（重複抑止）
    assert.equal(server.requestCounts.get('/data/20260909_0_VPFD51_130000.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

test('7. 混在フィード（regular + extra）ポーリングで VPBS50（気象防災速報）が C7 processor にのみ dispatch され、他テーブルを変更せず重複 URL が 1 回だけ処理される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const db = initializeDatabase({ databasePath, migrationsDirectory });
  const server = await createTestHttpServer();

  try {
    const vpbs50Url = `${server.baseUrl}/data/20260909_0_VPBS50_130000.xml`;
    const vpww53Url = `${server.baseUrl}/data/20260909_0_VPWW53_130000.xml`;
    const vpfd51Url = `${server.baseUrl}/data/20260909_0_VPFD51_130000.xml`;

    const regularFeedXml = createSampleAtomFeed([
      {
        id: 'urn:uuid:entry-regular-vpbs50',
        title: '気象防災速報（線状降水帯発生）',
        href: vpbs50Url,
      },
      {
        id: 'urn:uuid:entry-regular-vpww53',
        title: '気象警報・注意報',
        href: vpww53Url,
      },
      {
        id: 'urn:uuid:entry-regular-vpfd51',
        title: '地域時系列予報',
        href: vpfd51Url,
      },
    ]);

    // extra に同じ VPBS50 を含めて重複抑止を検証
    const extraFeedXml = createSampleAtomFeed([
      {
        id: 'urn:uuid:entry-extra-vpbs50-dup',
        title: '気象防災速報（重複）',
        href: vpbs50Url,
      },
    ]);

    const vpbs50Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>府県気象防災速報</Title>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
    <Status>通常</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象防災速報（線状降水帯発生）</Title>
    <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
    <EventID>JPTE202609090001_202609090001</EventID>
    <InfoType>発表</InfoType>
    <InfoKind>気象解説情報</InfoKind>
    <InfoKindVersion>1.5_0</InfoKindVersion>
    <Headline>
      <Text>東京都江東区で線状降水帯が発生しました。</Text>
      <Information type="情報タグ">
        <Item>
          <Kind>
            <Name>情報タグ</Name>
            <Condition>線状降水帯発生</Condition>
          </Kind>
          <Areas codeType="気象・地震・火山情報／市町村等">
            <Area>
              <Name>江東区</Name>
              <Code>1310800</Code>
            </Area>
          </Areas>
        </Item>
      </Information>
    </Headline>
  </Head>
</Report>`;

    const vpww53Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象警報・注意報</Title>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
    <Status>通常</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
    <EventID>202609090001</EventID>
    <InfoType>発表</InfoType>
    <InfoKind>気象警報・注意報</InfoKind>
    <InfoKindVersion>1.0_0</InfoKindVersion>
    <Headline><Text>大雨警報</Text></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="気象警報・注意報">
      <Item>
        <Kind>
          <Name>大雨警報</Name>
          <Code>03</Code>
          <Status>発表</Status>
        </Kind>
        <Area>
          <Name>江東区</Name>
          <Code>1310800</Code>
        </Area>
      </Item>
    </Warning>
  </Body>
</Report>`;

    const vpfd51Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>府県天気予報（Ｒ１）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁予報部</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都府県天気予報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>府県天気予報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間内卓越天気</Type><WeatherPart><jmx_eb:Weather refID="1" type="天気">くもり</jmx_eb:Weather></WeatherPart></Property></Kind>
<Kind><Property><Type>３時間内代表風</Type><WindDirectionPart><jmx_eb:WindDirection refID="1" type="風向" unit="８方位漢字">北</jmx_eb:WindDirection></WindDirectionPart><WindSpeedPart><WindSpeedLevel refID="1" type="風速階級">3</WindSpeedLevel></WindSpeedPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
<MeteorologicalInfos type="地点予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間毎気温</Type><TemperaturePart><jmx_eb:Temperature refID="1" type="気温" unit="度">25</jmx_eb:Temperature></TemperaturePart></Property></Kind>
<Station><Name>東京</Name><Code>44132</Code></Station>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(extraFeedXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPBS50_130000.xml') {
        res.statusCode = 200;
        res.end(vpbs50Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPWW53_130000.xml') {
        res.statusCode = 200;
        res.end(vpww53Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFD51_130000.xml') {
        res.statusCode = 200;
        res.end(vpfd51Xml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T00:00:00.000Z',
    });

    const result = await service.pollOnce('scheduled');

    // regularFeed: 3件ダウンロード, extraFeed: 重複1件スキップ
    assert.equal(result.feedResults[0].downloadedCount, 3);
    assert.equal(result.feedResults[1].skippedDuplicateCount, 1);
    assert.equal(result.feedResults[1].downloadedCount, 0);

    // telegram_reception に 3 件保存されていること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 3);

    const vpbs50Reception = receptions.find((r) => r.telegramType === 'VPBS50');
    assert.ok(vpbs50Reception);
    assert.deepEqual(
      vpbs50Reception.adoptions.map((a) => a.adoptionResult),
      ['気象防災速報として解析済み', '気象防災速報として解析済み'],
    );

    // bosai_bulletin が保存されていること
    const bulletin = findBosaiBulletin(db.connection, 'JPTE202609090001_202609090001', 'normal');
    assert.ok(bulletin);
    assert.equal(bulletin.headlineText, '東京都江東区で線状降水帯が発生しました。');
    assert.equal(bulletin.informationTag, '線状降水帯発生');
    assert.equal(bulletin.areas.length, 1);
    assert.equal(bulletin.areas[0]!.areaCode, '1310800');

    // 地域時系列予報スナップショットが保存されていること
    const areaSnap = findAreaTimeseriesSnapshot(db.connection, '130010', '44132', 'normal');
    assert.ok(areaSnap);

    // 他テーブルへの非干渉
    const earlyNear = findEarlyWarningSnapshot(db.connection, '130010', 'near', 'normal');
    assert.equal(earlyNear, null);

    const earlyFar = findEarlyWarningSnapshot(db.connection, '130010', 'far', 'normal');
    assert.equal(earlyFar, null);

    const timeseries = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
    assert.equal(timeseries, null);

    const notifications = listNotificationOutputHistory(db.connection);
    assert.equal(notifications.length, 0);

    // サーバーへのリクエスト回数: vpbs50Url は1回のみ（重複抑止）
    assert.equal(server.requestCounts.get('/data/20260909_0_VPBS50_130000.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

test('8. 混在フィード（regular + extra）ポーリングで VPHW50/51（竜巻注意情報）が C8 processor にのみ dispatch され、他テーブルを変更せず重複 URL が 1 回だけ処理される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const db = initializeDatabase({ databasePath, migrationsDirectory });
  const server = await createTestHttpServer();

  try {
    const vphw50Url = `${server.baseUrl}/data/20260909_0_VPHW50_130000.xml`;
    const vphw51Url = `${server.baseUrl}/data/20260909_0_VPHW51_130000.xml`;
    const vpbs50Url = `${server.baseUrl}/data/20260909_0_VPBS50_130000.xml`;
    const vpfd51Url = `${server.baseUrl}/data/20260909_0_VPFD51_130000.xml`;

    const regularFeedXml = createSampleAtomFeed([
      {
        id: 'urn:uuid:entry-regular-vphw50',
        title: '竜巻注意情報',
        href: vphw50Url,
      },
      {
        id: 'urn:uuid:entry-regular-vphw51',
        title: '竜巻注意情報（目撃情報付き）',
        href: vphw51Url,
      },
      {
        id: 'urn:uuid:entry-regular-vpbs50',
        title: '気象防災速報（線状降水帯発生）',
        href: vpbs50Url,
      },
      {
        id: 'urn:uuid:entry-regular-vpfd51',
        title: '地域時系列予報',
        href: vpfd51Url,
      },
    ]);

    // extra に同じ VPHW50 を含めて重複抑止を検証
    const extraFeedXml = createSampleAtomFeed([
      {
        id: 'urn:uuid:entry-extra-vphw50-dup',
        title: '竜巻注意情報（重複）',
        href: vphw50Url,
      },
    ]);

    const vphw50Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>竜巻注意情報</Title>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
    <Status>通常</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都竜巻注意情報</Title>
    <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
    <EventID></EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>竜巻注意情報</InfoKind>
    <InfoKindVersion>1.0_0</InfoKindVersion>
    <ValidDateTime>2026-09-09T10:10:00+09:00</ValidDateTime>
    <Headline>
      <Text>東京地方は竜巻に注意してください。</Text>
      <Information type="竜巻注意情報（発表細分）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>東京地方</Name><Code>130010</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（一次細分区域等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>東京地方</Name><Code>130010</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（市町村等をまとめた地域等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>２３区東部</Name><Code>130012</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（市町村等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象・地震・火山情報／市町村等">
            <Area><Name>江東区</Name><Code>1310800</Code></Area>
          </Areas>
        </Item>
      </Information>
    </Headline>
  </Head>
</Report>`;

    const vphw51Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>竜巻注意情報（目撃情報付き）</Title>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
    <Status>通常</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象防災速報（竜巻目撃）</Title>
    <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
    <EventID></EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>竜巻注意情報</InfoKind>
    <InfoKindVersion>1.1_0</InfoKindVersion>
    <ValidDateTime>2026-09-09T10:10:00+09:00</ValidDateTime>
    <Headline>
      <Text>【目撃情報あり】東京地方で竜巻が目撃されました。</Text>
      <Information type="竜巻注意情報（発表細分）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>東京地方</Name><Code>130010</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（一次細分区域等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>東京地方</Name><Code>130010</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（市町村等をまとめた地域等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>２３区東部</Name><Code>130012</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（市町村等）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象・地震・火山情報／市町村等">
            <Area><Name>江東区</Name><Code>1310800</Code></Area>
          </Areas>
        </Item>
      </Information>
      <Information type="竜巻注意情報（目撃情報あり）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>江東区</Name><Code>1310800</Code></Area>
          </Areas>
        </Item>
      </Information>
    </Headline>
  </Head>
</Report>`;

    const vpbs50Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>府県気象防災速報</Title>
    <DateTime>2026-09-09T00:00:00Z</DateTime>
    <Status>通常</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象防災速報（線状降水帯発生）</Title>
    <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
    <EventID>JPTE202609090001_202609090001</EventID>
    <InfoType>発表</InfoType>
    <InfoKind>気象解説情報</InfoKind>
    <InfoKindVersion>1.5_0</InfoKindVersion>
    <Headline>
      <Text>東京都江東区で線状降水帯が発生しました。</Text>
      <Information type="情報タグ">
        <Item>
          <Kind>
            <Name>情報タグ</Name>
            <Condition>線状降水帯発生</Condition>
          </Kind>
          <Areas codeType="気象・地震・火山情報／市町村等">
            <Area>
              <Name>江東区</Name>
              <Code>1310800</Code>
            </Area>
          </Areas>
        </Item>
      </Information>
    </Headline>
  </Head>
</Report>`;

    const vpfd51Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>府県天気予報（Ｒ１）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁予報部</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都府県天気予報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><InfoKind>府県天気予報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="区域予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間内卓越天気</Type><WeatherPart><jmx_eb:Weather refID="1" type="天気">くもり</jmx_eb:Weather></WeatherPart></Property></Kind>
<Kind><Property><Type>３時間内代表風</Type><WindDirectionPart><jmx_eb:WindDirection refID="1" type="風向" unit="８方位漢字">北</jmx_eb:WindDirection></WindDirectionPart><WindSpeedPart><WindSpeedLevel refID="1" type="風速階級">3</WindSpeedLevel></WindSpeedPart></Property></Kind>
<Area><Name>東京地方</Name><Code>130010</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
<MeteorologicalInfos type="地点予報">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime></TimeDefine></TimeDefines>
<Item>
<Kind><Property><Type>３時間毎気温</Type><TemperaturePart><jmx_eb:Temperature refID="1" type="気温" unit="度">25</jmx_eb:Temperature></TemperaturePart></Property></Kind>
<Station><Name>東京</Name><Code>44132</Code></Station>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(regularFeedXml);
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(extraFeedXml);
        return;
      }
      if (req.url === '/data/20260909_0_VPHW50_130000.xml') {
        res.statusCode = 200;
        res.end(vphw50Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPHW51_130000.xml') {
        res.statusCode = 200;
        res.end(vphw51Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPBS50_130000.xml') {
        res.statusCode = 200;
        res.end(vpbs50Xml);
        return;
      }
      if (req.url === '/data/20260909_0_VPFD51_130000.xml') {
        res.statusCode = 200;
        res.end(vpfd51Xml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T00:00:00.000Z',
    });

    const result = await service.pollOnce('scheduled');

    // regularFeed: 4件ダウンロード, extraFeed: 重複1件スキップ
    assert.equal(result.feedResults[0].downloadedCount, 4);
    assert.equal(result.feedResults[1].skippedDuplicateCount, 1);
    assert.equal(result.feedResults[1].downloadedCount, 0);

    // telegram_reception に 4 件保存されていること
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 4);

    const vphw50Reception = receptions.find((r) => r.telegramType === 'VPHW50');
    assert.ok(vphw50Reception);
    assert.deepEqual(
      vphw50Reception.adoptions.map((a) => a.adoptionResult),
      ['気象防災速報として解析済み', '気象防災速報として解析済み'],
    );

    const vphw51Reception = receptions.find((r) => r.telegramType === 'VPHW51');
    assert.ok(vphw51Reception);
    assert.deepEqual(
      vphw51Reception.adoptions.map((a) => a.adoptionResult),
      ['気象防災速報として解析済み', '気象防災速報として解析済み'],
    );

    const vpbs50Reception = receptions.find((r) => r.telegramType === 'VPBS50');
    assert.ok(vpbs50Reception);
    assert.deepEqual(
      vpbs50Reception.adoptions.map((a) => a.adoptionResult),
      ['気象防災速報として解析済み', '気象防災速報として解析済み'],
    );

    // bosai_bulletin に VPHW50, VPHW51, VPBS50 の3件が保存されていること
    const allBulletins = listBosaiBulletins(db.connection, { controlStatus: 'normal' });
    assert.equal(allBulletins.length, 3);

    const b50 = findBosaiBulletin(db.connection, 'VPHW50:130010', 'normal');
    assert.ok(b50);
    assert.equal(b50.hasSighting, null);
    assert.equal(b50.metadata.validTo, null);
    assert.equal(b50.metadata.validAt, '2026-09-09T01:10:00.000Z');

    const b51 = findBosaiBulletin(db.connection, 'VPHW51:130010', 'normal');
    assert.ok(b51);
    assert.equal(b51.hasSighting, true);
    assert.equal(b51.metadata.validTo, null);
    assert.equal(b51.metadata.validAt, '2026-09-09T01:10:00.000Z');

    const bVpbs = findBosaiBulletin(db.connection, 'JPTE202609090001_202609090001', 'normal');
    assert.ok(bVpbs);
    assert.equal(bVpbs.hasSighting, null);

    // 地域時系列予報スナップショットが保存されていること
    const areaSnap = findAreaTimeseriesSnapshot(db.connection, '130010', '44132', 'normal');
    assert.ok(areaSnap);

    // 他テーブルへの非干渉
    const earlyNear = findEarlyWarningSnapshot(db.connection, '130010', 'near', 'normal');
    assert.equal(earlyNear, null);

    const timeseries = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
    assert.equal(timeseries, null);

    const notifications = listNotificationOutputHistory(db.connection);
    assert.equal(notifications.length, 0);

    // サーバーへのリクエスト回数: vphw50Url は1回のみ（重複抑止）
    assert.equal(server.requestCounts.get('/data/20260909_0_VPHW50_130000.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// =================================================================================================
// Issue #22 (C12) 長期フィードによる初期取得・復旧処理のテスト群
// =================================================================================================

// -------------------------------------------------------------------------------------------------
// 22-1. 新しいサービスの状態が not_started / result=null であり、DB に初期取得状態を保存する行・migration がない
// -------------------------------------------------------------------------------------------------
test('22-1. 新規 JmaXmlPollingService の initialFetch は not_started / result=null であり、DB に初期取得状態を保存するテーブルや列が存在しない', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      freshnessPolicy: defaultXmlFreshnessPolicy,
    });
    const status = service.getStatus();

    assert.deepEqual(status.initialFetch, {
      phase: 'not_started',
      result: null,
    });
    assert.equal(status.isRunning, false);
    assert.equal(status.lastCycleResult, null);

    // DB に initial_fetch 関連テーブルや列が存在しないことを確認
    const tables = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    assert.equal(
      tableNames.some((name) => name.includes('initial') || name.includes('recovery')),
      false,
    );
  } finally {
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-2. start() で 4 フィードが順に取得され、全成功時のみ completed=true となり、通常周期タイマーが高頻度 2 フィードだけを継続する
// -------------------------------------------------------------------------------------------------
test('22-2. start() で regular, extra, regular_l, extra_l が各 1 回要求され、4本すべて成功時のみ completed=true となり、完了後のタイマーは高頻度 2 フィードのみを取得する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);
    const requestedFeeds: string[] = [];

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        requestedFeeds.push(req.url);
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    let fakeNow = '2026-09-09T01:00:00.000Z';
    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      intervalMs: 40,
      clock: () => fakeNow,
    });

    assert.deepEqual(service.getStatus().initialFetch, {
      phase: 'not_started',
      result: null,
    });

    const startPromise = service.start();
    // 実行中は running
    assert.equal(service.getStatus().initialFetch.phase, 'running');
    assert.equal(service.getStatus().initialFetch.result, null);

    const initResult = await startPromise;
    assert.equal(initResult.completed, true);
    assert.deepEqual(initResult.failedFeedKinds, []);
    assert.equal(initResult.startedAt, '2026-09-09T01:00:00.000Z');
    assert.equal(initResult.finishedAt, '2026-09-09T01:00:00.000Z');
    assert.equal(initResult.errorReason, null);
    assert.equal(initResult.cycleResult?.trigger, 'initial');
    assert.equal(initResult.cycleResult?.feedResults.length, 4);

    // 4 フィードの要求順序が regular, extra, regular_l, extra_l の各 1 回
    assert.deepEqual(requestedFeeds, [
      '/feed/regular.xml',
      '/feed/extra.xml',
      '/feed/regular_l.xml',
      '/feed/extra_l.xml',
    ]);

    const statusAfter = service.getStatus();
    assert.equal(statusAfter.initialFetch.phase, 'completed');
    assert.deepEqual(statusAfter.initialFetch.result, initResult);

    // タイマーによる通常ポーリングの動作確認（高頻度 2 フィードのみ増える）
    fakeNow = '2026-09-09T01:01:00.000Z';
    await new Promise((resolve) => setTimeout(resolve, 80));

    await service.stop();

    // regular, extra は 2 回以上要求されたが、長期フィード regular_l, extra_l は 1 回のまま
    assert.ok((server.requestCounts.get('/feed/regular.xml') ?? 0) >= 2);
    assert.ok((server.requestCounts.get('/feed/extra.xml') ?? 0) >= 2);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-3. 先頭・中間・末尾フィードの部分失敗時に 4 本すべて試行され、failed となり失敗フィードが完全一致で残る
// -------------------------------------------------------------------------------------------------
test('22-3. 先頭・中間・末尾フィードの部分失敗時に 4 本すべて試行され、phase=failed, completed=false となり、通常ポーリング成功後も failed のままで長期自動再試行はない', async () => {
  const failurePatterns: Array<{
    name: string;
    failKind: 'regular' | 'extra' | 'regular_l' | 'extra_l';
    failUrl: string;
  }> = [
    { name: '先頭 regular 失敗', failKind: 'regular', failUrl: '/feed/regular.xml' },
    { name: '中間 extra_l 失敗', failKind: 'regular_l', failUrl: '/feed/regular_l.xml' },
    { name: '末尾 extra_l 失敗', failKind: 'extra_l', failUrl: '/feed/extra_l.xml' },
  ];

  for (const pattern of failurePatterns) {
    const { databasePath, cleanup } = createTempDb();
    const server = await createTestHttpServer();

    try {
      const db = initializeDatabase({ databasePath, migrationsDirectory });
      const feedXml = createSampleAtomFeed([]);
      const triedFeeds: string[] = [];

      server.setHandler((req, res) => {
        if (
          req.url === '/feed/regular.xml' ||
          req.url === '/feed/extra.xml' ||
          req.url === '/feed/regular_l.xml' ||
          req.url === '/feed/extra_l.xml'
        ) {
          triedFeeds.push(req.url);
          if (req.url === pattern.failUrl) {
            res.statusCode = 500;
            res.end('Server Error');
            return;
          }
          res.statusCode = 200;
          res.end(feedXml);
          return;
        }
        res.statusCode = 404;
        res.end('Not found');
      });

      const customFetch: typeof fetch = (input, init) => {
        const urlStr = String(input);
        if (urlStr.includes('/developer/xml/feed/regular.xml')) {
          return fetch(`${server.baseUrl}/feed/regular.xml`, init);
        }
        if (urlStr.includes('/developer/xml/feed/extra.xml')) {
          return fetch(`${server.baseUrl}/feed/extra.xml`, init);
        }
        if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
          return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
        }
        if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
          return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
        }
        return fetch(input, init);
      };

      const service = new JmaXmlPollingService(db.connection, {
        freshnessPolicy: defaultXmlFreshnessPolicy,
        fetchFn: customFetch,
        allowedUrlPrefixes: [server.baseUrl],
        allowHttpForTesting: true,
        intervalMs: 40,
        clock: () => '2026-09-09T01:00:00.000Z',
      });

      const initResult = await service.start();
      assert.equal(initResult.completed, false, `${pattern.name}: completed は false`);
      assert.deepEqual(
        initResult.failedFeedKinds,
        [pattern.failKind],
        `${pattern.name}: failedFeedKinds が完全一致`,
      );

      // 失敗しても 4 本すべて試行されたこと
      assert.equal(triedFeeds.length, 4, `${pattern.name}: 4本すべて試行される`);

      const status = service.getStatus();
      assert.equal(status.initialFetch.phase, 'failed');
      assert.equal(status.initialFetch.result?.completed, false);

      // fetch_attempt に失敗が記録されていること
      const attempts = listFetchAttempts(db.connection);
      const failAttempt = attempts.find(
        (a) => a.outcome === 'failure' && a.targetRef === pattern.failKind,
      );
      assert.ok(failAttempt, `${pattern.name}: fetch_attempt に失敗が記録される`);

      // 通常タイマーを動かして scheduled が走っても初期状態は failed のまま
      await new Promise((resolve) => setTimeout(resolve, 80));
      await service.stop();

      const statusAfterScheduled = service.getStatus();
      assert.equal(
        statusAfterScheduled.initialFetch.phase,
        'failed',
        `${pattern.name}: 通常取得後も failed のまま`,
      );
      // 長期フィードの自動再試行は発生せず各 1 回のまま
      assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
      assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);
    } finally {
      await server.close();
      cleanup();
    }
  }
});

// -------------------------------------------------------------------------------------------------
// 22-4. 正常な空 Atom と取得失敗が feedFetchOutcome で区別され、前者だけで構成された 4 フィードは初期取得済みになる
// -------------------------------------------------------------------------------------------------
test('22-4. 正常な空 Atom と取得失敗が feedFetchOutcome で区別され、4 フィードすべて空 Atom の場合は completed=true になる', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const emptyFeedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(emptyFeedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    const initResult = await service.start();
    await service.stop();

    assert.equal(initResult.completed, true);
    assert.deepEqual(initResult.failedFeedKinds, []);
    for (const feedRes of initResult.cycleResult?.feedResults ?? []) {
      assert.equal(feedRes.feedFetchOutcome, 'success');
      assert.equal(feedRes.discoveredCount, 0);
      assert.equal(feedRes.downloadedCount, 0);
      assert.equal(feedRes.failedDocumentCount, 0);
    }
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-5. 個別電文 GET 失敗とフィード取得成否の分離
// -------------------------------------------------------------------------------------------------
test('22-5. フィードは成功し個別電文 GET だけが失敗した場合、feedFetchOutcome=success, failedDocumentCount=1 となり 4 フィードの初期取得は completed=true になる', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const failDocUrl = `${server.baseUrl}/data/fail_doc.xml`;
    const feedWithDocXml = createSampleAtomFeed([
      { id: 'urn:entry-fail-doc', title: '警報', href: failDocUrl },
    ]);
    const emptyFeedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(feedWithDocXml);
        return;
      }
      if (
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(emptyFeedXml);
        return;
      }
      if (req.url === '/data/fail_doc.xml') {
        // 個別電文の取得失敗
        res.statusCode = 500;
        res.end('Document Not Found');
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      if (urlStr === failDocUrl) {
        return fetch(failDocUrl, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    const initResult = await service.start();
    await service.stop();

    // フィード本体の HTTP/Atom はすべて成功しているため completed=true
    assert.equal(initResult.completed, true);
    assert.deepEqual(initResult.failedFeedKinds, []);
    assert.equal(service.getStatus().initialFetch.phase, 'completed');

    // regular フィードの結果: feedFetchOutcome='success', failedDocumentCount=1
    const regResult = initResult.cycleResult?.feedResults.find((r) => r.feedKind === 'regular');
    assert.equal(regResult?.feedFetchOutcome, 'success');
    assert.equal(regResult?.downloadedCount, 0);
    assert.equal(regResult?.failedDocumentCount, 1);

    // fetch_attempt に個別電文の失敗が記録されていること
    const attempts = listFetchAttempts(db.connection);
    const docFailAttempt = attempts.find(
      (a) => a.sourceKind === 'xml_document' && a.outcome === 'failure',
    );
    assert.ok(docFailAttempt);
    assert.equal(docFailAttempt.httpStatus, 500);

    // telegram_reception に空行などは作られていないこと
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 0);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-6. 同時複数 start() の集約と、stop() 後の再 start() での長期フィード非再取得
// -------------------------------------------------------------------------------------------------
test('22-6. 同時複数 start() で 4 フィードは各 1 回のみ要求され、stop() 後の再 start() では長期フィードを再取得せず通常タイマーだけを再開する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      intervalMs: 40,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    // 1. 同時 3 回 start()
    const [r1, r2, r3] = await Promise.all([service.start(), service.start(), service.start()]);
    assert.deepEqual(r1, r2);
    assert.deepEqual(r2, r3);
    assert.equal(r1.completed, true);

    // 各フィードの要求数は 1 回のみ
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);

    // 2. stop()
    await service.stop();
    assert.equal(service.getStatus().isRunning, false);
    assert.equal(service.getStatus().initialFetch.phase, 'completed');

    // 3. 再度 start()
    const restartResult = await service.start();
    assert.deepEqual(restartResult, r1);
    assert.equal(service.getStatus().isRunning, true);

    // 長期フィードのリクエスト数は増えない（各 1 回のまま）
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);

    // タイマーにより通常ポーリング（高頻度）だけが再開される
    await new Promise((resolve) => setTimeout(resolve, 80));
    await service.stop();

    assert.ok((server.requestCounts.get('/feed/regular.xml') ?? 0) >= 2);
    assert.ok((server.requestCounts.get('/feed/extra.xml') ?? 0) >= 2);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-7. 同じ DB で新しいサービスインスタンスを作成すると初期状態は not_started に戻り、4 フィードを再取得する
// -------------------------------------------------------------------------------------------------
test('22-7. 同じ DB で新しいサービスインスタンスを作成すると not_started に戻り 4 フィードを再取得する。既受信電文は再 GET を抑止する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPath = '/data/test_doc_22_7.xml';
    const docUrl = `${server.baseUrl}${docPath}`;
    const docXml = createSampleTelegramXml();

    const feedXml = createSampleAtomFeed([{ id: 'urn:entry-22-7', title: '警報', href: docUrl }]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === docPath) {
        res.statusCode = 200;
        res.end(docXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      if (urlStr === docUrl) {
        return fetch(docUrl, init);
      }
      return fetch(input, init);
    };

    // サービス 1 回目
    const service1 = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    const r1 = await service1.start();
    await service1.stop();
    assert.equal(r1.completed, true);
    assert.equal(server.requestCounts.get(docPath), 1);

    // 同じ DB を使って新しいサービスインスタンスを作成
    const service2 = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    // 初期状態は必ず not_started に戻る
    assert.deepEqual(service2.getStatus().initialFetch, {
      phase: 'not_started',
      result: null,
    });

    // 再度 start() を呼ぶと 4 フィードを取得するが、個別電文は DB 既受信によりダウンロードされない
    const r2 = await service2.start();
    await service2.stop();
    assert.equal(r2.completed, true);

    // フィードの GET は各 2 回（service1 で 1 回、service2 で 1 回）
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 2);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 2);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 2);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 2);

    // 個別電文の GET は 1 回のまま増えない（重複抑止）
    assert.equal(server.requestCounts.get(docPath), 1);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-8. pollOnce('recovery') は 4 フィード、scheduled/manual は高頻度 2 フィードだけを取得し、initialFetch に非干渉
// -------------------------------------------------------------------------------------------------
test('22-8. pollOnce(trigger) の直接呼出しは initialFetch を変更せず、recovery は 4 フィード、scheduled/manual は高頻度 2 フィードを取得する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    // 1. pollOnce('recovery') を直接実行
    const recoveryResult = await service.pollOnce('recovery');
    assert.equal(recoveryResult.trigger, 'recovery');
    assert.equal(recoveryResult.feedResults.length, 4);
    assert.deepEqual(
      recoveryResult.feedResults.map((r) => r.feedKind),
      ['regular', 'extra', 'regular_l', 'extra_l'],
    );
    // initialFetch は not_started のまま変化しない
    assert.deepEqual(service.getStatus().initialFetch, {
      phase: 'not_started',
      result: null,
    });

    // 2. pollOnce('scheduled') を直接実行
    const scheduledResult = await service.pollOnce('scheduled');
    assert.equal(scheduledResult.trigger, 'scheduled');
    assert.equal(scheduledResult.feedResults.length, 2);
    assert.deepEqual(
      scheduledResult.feedResults.map((r) => r.feedKind),
      ['regular', 'extra'],
    );
    assert.deepEqual(service.getStatus().initialFetch, {
      phase: 'not_started',
      result: null,
    });

    // 3. pollOnce('manual') を直接実行
    const manualResult = await service.pollOnce('manual');
    assert.equal(manualResult.trigger, 'manual');
    assert.equal(manualResult.feedResults.length, 2);
    assert.deepEqual(
      manualResult.feedResults.map((r) => r.feedKind),
      ['regular', 'extra'],
    );
    assert.deepEqual(service.getStatus().initialFetch, {
      phase: 'not_started',
      result: null,
    });
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-9. 初期取得中の内部例外は failed を記録して reject し、startServer() がクリーンアップする
// -------------------------------------------------------------------------------------------------
test('22-9. 初期取得中の内部例外は phase=failed を記録して reject し、startServer() が全リソースを閉じる', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const config = { databasePath, migrationsDirectory };

    // 1. JmaXmlPollingService 自体が内部例外時に phase=failed を記録して再 throw することの検証
    const db = initializeDatabase(config);
    db.connection.prepare('DROP TABLE fetch_attempt').run();

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    await assert.rejects(() => service.start(), /no such table: fetch_attempt/);

    const status = service.getStatus();
    assert.equal(status.initialFetch.phase, 'failed');
    assert.equal(status.initialFetch.result?.completed, false);
    assert.deepEqual(status.initialFetch.result?.failedFeedKinds, [
      'regular',
      'extra',
      'regular_l',
      'extra_l',
    ]);
    assert.equal(status.initialFetch.result?.cycleResult, null);
    assert.match(status.initialFetch.result?.errorReason ?? '', /no such table: fetch_attempt/);

    db.close();

    // 2. startServer() が start() の内部例外で reject され、HTTP サーバーや DB を閉じることの検証
    const fresh = createTempDb();
    try {
      const freshDb = initializeDatabase({
        databasePath: fresh.databasePath,
        migrationsDirectory,
      });
      const crashingService = new JmaXmlPollingService(freshDb.connection, {
        freshnessPolicy: defaultXmlFreshnessPolicy,
        freshnessPolicy: defaultXmlFreshnessPolicy,
      });
      crashingService.start = async () => {
        throw new Error('Database/Internal fatal invariant violation');
      };

      await assert.rejects(
        () =>
          startServer({
            config: { databasePath: fresh.databasePath, migrationsDirectory },
            port: 0,
            pollingService: crashingService,
            schedulerOptions: {
              now: () => new Date('2026-09-09T12:00:00+09:00'),
            },
          }),
        /Database\/Internal fatal invariant violation/,
      );
    } finally {
      fresh.cleanup();
    }
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-9b. 待受失敗は初期取得より先に処理する
// -------------------------------------------------------------------------------------------------
test('22-9b. HTTP待受失敗時は初期取得を開始せず、DBを解放して起動に失敗する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const occupiedServer = http.createServer();

  await new Promise<void>((resolve) => occupiedServer.listen(0, resolve));
  const address = occupiedServer.address();
  assert.ok(address !== null && typeof address !== 'string');

  let initialFetchStarted = false;
  const pollingService = {
    start: async () => {
      initialFetchStarted = true;
      throw new Error('初期取得は開始されてはならない');
    },
    stop: async () => undefined,
  } as unknown as JmaXmlPollingService;

  try {
    await assert.rejects(
      () =>
        startServer({
          config: { databasePath, migrationsDirectory },
          port: address.port,
          pollingService,
        }),
      /EADDRINUSE/,
    );
    assert.equal(initialFetchStarted, false);

    const database = initializeDatabase({ databasePath, migrationsDirectory });
    database.close();
  } finally {
    await new Promise<void>((resolve, reject) => {
      occupiedServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 22-10. 保存済み履歴の復元、初期サイクルでの未受信電文復元、通知履歴の非生成
// -------------------------------------------------------------------------------------------------
test('22-10. 保存済み履歴の C3 再構成後に初期サイクルが未受信電文を反映し、notification_output_history を増やさない', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    // 初期サイクルで届く新しい電文
    const docPath = '/data/20260909000000_0_VPWW55_130000.xml';
    const docUrl = `${server.baseUrl}${docPath}`;
    const newTelegramXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>`;

    const feedXml = createSampleAtomFeed([
      { id: 'urn:uuid:entry-init-vpww55', title: '大雨注意報', href: docUrl },
    ]);
    const emptyFeedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(emptyFeedXml);
        return;
      }
      if (req.url === docPath) {
        res.statusCode = 200;
        res.end(newTelegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      if (urlStr === docUrl) {
        return fetch(docUrl, init);
      }
      return fetch(input, init);
    };

    const notificationsBefore = listNotificationOutputHistory(db.connection);
    assert.equal(notificationsBefore.length, 0);

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    const initResult = await service.start();
    await service.stop();

    assert.equal(initResult.completed, true);

    // C3 の現況ストリームに大雨注意報が反映されていること
    const streams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].telegramType, 'VPWW55');

    // notification_output_history が 0 件のままであること（通知は生成されない）
    const notificationsAfter = listNotificationOutputHistory(db.connection);
    assert.equal(notificationsAfter.length, 0);
  } finally {
    await server.close();
    cleanup();
  }
});

// =================================================================================================
// Issue #23: 指数バックオフ・再試行処理 (C13)
// =================================================================================================

class ManualTimerScheduler implements PollingTimerScheduler {
  private currentTimeMs: number;
  private nextTimerId = 1;
  private timers = new Map<number, { callback: () => void; dueTimeMs: number }>();

  constructor(initialTimeMs = 0) {
    this.currentTimeMs = initialTimeMs;
  }

  getCurrentTimeMs(): number {
    return this.currentTimeMs;
  }

  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = this.nextTimerId++;
    this.timers.set(id, {
      callback,
      dueTimeMs: this.currentTimeMs + ms,
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    this.timers.delete(Number(id));
  }

  async advanceTime(ms: number): Promise<void> {
    const targetTimeMs = this.currentTimeMs + ms;
    while (true) {
      let earliestId: number | null = null;
      let earliestDueTimeMs = Infinity;
      for (const [id, timer] of this.timers.entries()) {
        if (timer.dueTimeMs <= targetTimeMs && timer.dueTimeMs < earliestDueTimeMs) {
          earliestDueTimeMs = timer.dueTimeMs;
          earliestId = id;
        }
      }

      if (earliestId === null) {
        this.currentTimeMs = targetTimeMs;
        break;
      }

      this.currentTimeMs = earliestDueTimeMs;
      const timer = this.timers.get(earliestId)!;
      this.timers.delete(earliestId);
      timer.callback();
      // 非同期キューのフラッシュ
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  hasPendingTimers(): boolean {
    return this.timers.size > 0;
  }
}

// -------------------------------------------------------------------------------------------------
// 23-1. performHttpGet の 10 秒 timeout と通信失敗分類（timeout/network/http_status）、URLサニタイズ
// -------------------------------------------------------------------------------------------------
test('23-1. performHttpGet の 10 秒 timeout と通信失敗分類（timeout/network/http_status）、URLサニタイズ', async () => {
  const server = await createTestHttpServer();

  try {
    server.setHandler((req, res) => {
      if (req.url === '/ok') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/xml');
        res.end('<root>ok</root>');
        return;
      }
      if (req.url === '/error-500') {
        res.statusCode = 500;
        res.end('Internal Server Error');
        return;
      }
      if (req.url === '/slow') {
        // タイムアウト検証用（300ms待機）
        setTimeout(() => {
          res.statusCode = 200;
          res.end('<root>slow</root>');
        }, 300);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    // 1. 正常系
    const resOk = await performHttpGet(`${server.baseUrl}/ok`);
    assert.equal(resOk.ok, true);
    assert.equal(resOk.status, 200);
    assert.equal(resOk.bodyText, '<root>ok</root>');
    assert.equal(resOk.errorKind, null);
    assert.equal(resOk.errorMessage, null);

    // 2. HTTP 500 失敗 (http_status)
    const res500 = await performHttpGet(`${server.baseUrl}/error-500`);
    assert.equal(res500.ok, false);
    assert.equal(res500.status, 500);
    assert.equal(res500.bodyText, null);
    assert.equal(res500.errorKind, 'http_status');
    assert.match(res500.errorMessage ?? '', /HTTP 500/);

    // 3. Timeout 失敗 (timeout)
    const resTimeout = await performHttpGet(`${server.baseUrl}/slow`, { timeoutMs: 50 });
    assert.equal(resTimeout.ok, false);
    assert.equal(resTimeout.status, null);
    assert.equal(resTimeout.errorKind, 'timeout');
    assert.ok(resTimeout.errorMessage);

    // 4. ネットワーク例外 (network) - 存在しないポート
    const resNetwork = await performHttpGet('http://127.0.0.1:65530/test', { timeoutMs: 500 });
    assert.equal(resNetwork.ok, false);
    assert.equal(resNetwork.status, null);
    assert.equal(resNetwork.errorKind, 'network');

    // 5. URLサニタイズ
    const sanitizedUrl = sanitizeUrl('http://admin:secret123@example.com/feed.xml');
    assert.equal(sanitizedUrl, 'http://example.com/feed.xml');
    assert.ok(!sanitizedUrl.includes('secret123'));

    // 6. エラーメッセージサニタイズ
    const sanitizedMsg = sanitizeErrorMessage(
      'Error fetching https://user:pass123@example.com/path',
    );
    assert.ok(!sanitizedMsg.includes('pass123'));
    assert.match(sanitizedMsg, /:\/\/\*\*\*:\*\*\*@/);
  } finally {
    await server.close();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-2. 連続失敗による 60→120→240→300→300秒の指数バックオフと成功時リセット、成功後失敗の60秒再開
// -------------------------------------------------------------------------------------------------
test('23-2. 連続失敗による 60→120→240→300→300秒の指数バックオフと成功時リセット、成功後失敗の60秒再開', () => {
  // calculateBackoffDelaySeconds の純粋計算検証
  assert.equal(calculateBackoffDelaySeconds(0), 0);
  assert.equal(calculateBackoffDelaySeconds(1), 60);
  assert.equal(calculateBackoffDelaySeconds(2), 120);
  assert.equal(calculateBackoffDelaySeconds(3), 240);
  assert.equal(calculateBackoffDelaySeconds(4), 300);
  assert.equal(calculateBackoffDelaySeconds(5), 300);
  assert.equal(calculateBackoffDelaySeconds(10), 300);

  const manager = new FeedBackoffManager();
  const t0 = '2026-09-09T01:00:00.000Z';
  const t0Ms = new Date(t0).getTime();

  // 初期状態
  const initialStatus = manager.getStatus('regular', t0);
  assert.equal(initialStatus.consecutiveFailures, 0);
  assert.equal(initialStatus.isWaiting, false);
  assert.equal(initialStatus.waitingReason, null);
  assert.equal(initialStatus.nextAllowedFetchAt, null);

  // 1回目失敗 (60秒待機)
  manager.recordFailure('regular', t0, 'HTTP 503');
  const s1 = manager.getStatus('regular', t0);
  assert.equal(s1.consecutiveFailures, 1);
  assert.equal(s1.isWaiting, true);
  assert.equal(s1.nextAllowedFetchAt, new Date(t0Ms + 60_000).toISOString());
  assert.match(s1.waitingReason ?? '', /連続1回失敗のため60秒待機中/);

  // 59秒後はまだ待機中
  assert.equal(manager.isWaiting('regular', new Date(t0Ms + 59_000).toISOString()), true);
  // 60秒後は待機終了
  assert.equal(manager.isWaiting('regular', new Date(t0Ms + 60_000).toISOString()), false);

  // 2回目失敗 (120秒待機)
  const t1 = new Date(t0Ms + 60_000).toISOString();
  manager.recordFailure('regular', t1, 'HTTP 503');
  const s2 = manager.getStatus('regular', t1);
  assert.equal(s2.consecutiveFailures, 2);
  assert.equal(s2.nextAllowedFetchAt, new Date(t0Ms + 180_000).toISOString());

  // 3回目失敗 (240秒待機)
  const t2 = new Date(t0Ms + 180_000).toISOString();
  manager.recordFailure('regular', t2, 'HTTP 503');
  const s3 = manager.getStatus('regular', t2);
  assert.equal(s3.consecutiveFailures, 3);
  assert.equal(s3.nextAllowedFetchAt, new Date(t0Ms + 420_000).toISOString());

  // 4回目失敗 (300秒待機)
  const t3 = new Date(t0Ms + 420_000).toISOString();
  manager.recordFailure('regular', t3, 'HTTP 503');
  const s4 = manager.getStatus('regular', t3);
  assert.equal(s4.consecutiveFailures, 4);
  assert.equal(s4.nextAllowedFetchAt, new Date(t0Ms + 720_000).toISOString());

  // 5回目失敗 (300秒上限)
  const t4 = new Date(t0Ms + 720_000).toISOString();
  manager.recordFailure('regular', t4, 'HTTP 503');
  const s5 = manager.getStatus('regular', t4);
  assert.equal(s5.consecutiveFailures, 5);
  assert.equal(s5.nextAllowedFetchAt, new Date(t0Ms + 1020_000).toISOString());

  // 成功時のリセット
  const tSuccess = new Date(t0Ms + 1020_000).toISOString();
  manager.recordSuccess('regular', tSuccess);
  const sSuccess = manager.getStatus('regular', tSuccess);
  assert.equal(sSuccess.consecutiveFailures, 0);
  assert.equal(sSuccess.isWaiting, false);
  assert.equal(sSuccess.waitingReason, null);
  assert.equal(sSuccess.nextAllowedFetchAt, null);
  assert.equal(sSuccess.lastSuccessAt, tSuccess);

  // 成功後の新たな失敗は 60秒から再開
  const tNextFail = new Date(t0Ms + 1100_000).toISOString();
  manager.recordFailure('regular', tNextFail, 'HTTP 500');
  const sNextFail = manager.getStatus('regular', tNextFail);
  assert.equal(sNextFail.consecutiveFailures, 1);
  assert.equal(
    sNextFail.nextAllowedFetchAt,
    new Date(new Date(tNextFail).getTime() + 60_000).toISOString(),
  );
});

// -------------------------------------------------------------------------------------------------
// 23-3. 一方のフィードが再試行待ちでも他方は通常周期で取得され、待機中フィードに余計なHTTP・fetch_attemptが発生しない
// -------------------------------------------------------------------------------------------------
test('23-3. 一方のフィードが再試行待ちでも他方は通常周期で取得され、待機中フィードに余計なHTTP・fetch_attemptが発生しない', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = 503;
        res.end('Service Unavailable');
        return;
      }
      if (req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    let currentTime = '2026-09-09T01:00:00.000Z';
    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => currentTime,
    });

    // サイクル 1: regular は失敗、extra は成功
    const cycle1 = await service.pollOnce('scheduled');
    assert.equal(cycle1.feedResults.length, 2);
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);

    const status1 = service.getStatus();
    assert.equal(status1.feedStatuses.regular.isWaiting, true);
    assert.equal(status1.feedStatuses.regular.consecutiveFailures, 1);
    assert.equal(status1.feedStatuses.extra.isWaiting, false);
    assert.equal(status1.feedStatuses.extra.consecutiveFailures, 0);

    // サイクル 2 (30秒後): regular は待機中のためスキップされる！
    currentTime = '2026-09-09T01:00:30.000Z';
    const cycle2 = await service.pollOnce('scheduled');
    assert.equal(cycle2.feedResults.length, 1);
    assert.equal(cycle2.feedResults[0]?.feedKind, 'extra');

    // regular はスキップされたので feedResults には extra のみ、または regular への新規 HTTP 要求なし
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1); // 増えていない！
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 2); // extra は正常取得

    // fetch_attempt を確認: regular の試行は増えていないこと
    const attempts = listFetchAttempts(db.connection);
    const regularAttempts = attempts.filter((a) => a.targetRef === 'regular');
    assert.equal(regularAttempts.length, 1); // 1回目の失敗のみ
  } finally {
    await server.close();
    cleanup();
  }
});

test('23-3b. 再試行時刻が通常周期より早い場合、失敗していないフィードを早期取得しない', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);
    let regularStatus = 200;
    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml') {
        res.statusCode = regularStatus;
        res.end(regularStatus === 200 ? feedXml : 'Service Unavailable');
        return;
      }
      if (
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml' ||
        req.url === '/feed/extra_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });
    const customFetch: typeof fetch = (input, init) => {
      const url = String(input);
      for (const kind of ['regular', 'extra', 'regular_l', 'extra_l']) {
        if (url.includes(`/developer/xml/feed/${kind}.xml`)) {
          return fetch(`${server.baseUrl}/feed/${kind}.xml`, init);
        }
      }
      return fetch(input, init);
    };
    const scheduler = new ManualTimerScheduler(new Date('2026-09-09T01:00:00.000Z').getTime());
    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      intervalMs: 300_000,
      timerScheduler: scheduler,
      clock: () => new Date(scheduler.getCurrentTimeMs()).toISOString(),
    });

    const initial = await service.start();
    assert.equal(initial.completed, true);
    regularStatus = 503;

    await scheduler.advanceTime(300_000);
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 2);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 2);

    await scheduler.advanceTime(60_000);
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 3);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 2);

    const internals = service as unknown as {
      nextScheduledPollAtMs: number | null;
      pollFeeds: () => Promise<never>;
      runScheduledOrRetryCycle: () => Promise<void>;
    };
    let internalFailureCount = 0;
    internals.nextScheduledPollAtMs = scheduler.getCurrentTimeMs();
    internals.pollFeeds = async () => {
      internalFailureCount += 1;
      throw new Error('simulated database failure');
    };

    await internals.runScheduledOrRetryCycle();
    assert.equal(internalFailureCount, 1);
    await scheduler.advanceTime(0);
    assert.equal(internalFailureCount, 1);
    await scheduler.advanceTime(300_000);
    assert.equal(internalFailureCount, 2);
  } finally {
    if (service) await service.stop();
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-4. フィード取得失敗およびAtom構造不正時に既存の正常snapshot・受信履歴が空値で上書きされず保持される
// -------------------------------------------------------------------------------------------------
test('23-4. フィード取得失敗およびAtom構造不正時に既存の正常snapshot・受信履歴が空値で上書きされず保持される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPath = '/data/20260909000000_0_VPWW55_130000.xml';
    const docUrl = `${server.baseUrl}${docPath}`;
    const telegramXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象警報・注意報（市町村等）</Title><DateTime>2026-09-09T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>気象庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime><InfoType>発表</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion></Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</Warning>
</Body>
</Report>`;

    let feedResponseStatusCode = 200;
    let feedResponseBody = createSampleAtomFeed([
      { id: 'urn:entry-1', title: '大雨警報', href: docUrl },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = feedResponseStatusCode;
        res.end(feedResponseBody);
        return;
      }
      if (req.url === docPath) {
        res.statusCode = 200;
        res.end(telegramXml);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    let currentTime = '2026-09-09T01:00:00.000Z';
    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => currentTime,
    });

    // 1. 初回ポーリングで正常に電文を受信
    await service.pollOnce('scheduled');
    const initialReceptions = listTelegramReceptions(db.connection);
    assert.equal(initialReceptions.length, 1);
    const initialStreams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(initialStreams.length, 1);

    // 2. 次のサイクルで HTTP 503 エラー（フィード取得失敗）
    currentTime = '2026-09-09T01:02:00.000Z'; // 待機解除後
    feedResponseStatusCode = 503;
    feedResponseBody = 'Service Unavailable';
    await service.pollOnce('scheduled');

    // 既存の受信履歴・スナップショットが保持されていること（空で上書きされていない）
    const receptionsAfter503 = listTelegramReceptions(db.connection);
    assert.equal(receptionsAfter503.length, 1);
    assert.deepEqual(receptionsAfter503[0], initialReceptions[0]);
    const streamsAfter503 = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    assert.equal(streamsAfter503.length, 1);

    // 3. その次のサイクルで 不正XML（Atomパース失敗）
    currentTime = '2026-09-09T01:05:00.000Z'; // 待機解除後
    feedResponseStatusCode = 200;
    feedResponseBody = '<invalid-xml>ルートがAtomでない</invalid-xml>';
    await service.pollOnce('scheduled');

    // 既存の受信履歴・スナップショットが依然として保持されていること
    const receptionsAfterParseErr = listTelegramReceptions(db.connection);
    assert.equal(receptionsAfterParseErr.length, 1);
    const streamsAfterParseErr = listWarningCurrentStreams(
      db.connection,
      '130000',
      '1310800',
      'normal',
    );
    assert.equal(streamsAfterParseErr.length, 1);
  } finally {
    if (service) {
      await service.stop();
    }
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-5. 個別電文のHTTP失敗・未対応構造・未対応コードはフィードの成功やバックオフ状態に影響せず独立して記録される
// -------------------------------------------------------------------------------------------------
test('23-5. 個別電文のHTTP失敗・未対応構造・未対応コードはフィードの成功やバックオフ状態に影響せず独立して記録される', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const docPath500 = '/data/doc-500.xml';
    const docPathBadNs = '/data/doc-bad-ns.xml';

    const feedXml = createSampleAtomFeed([
      { id: 'urn:entry-500', title: '500電文', href: `${server.baseUrl}${docPath500}` },
      {
        id: 'urn:entry-bad-ns',
        title: '名前空間不正電文',
        href: `${server.baseUrl}${docPathBadNs}`,
      },
    ]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === docPath500) {
        res.statusCode = 500;
        res.end('Document Error');
        return;
      }
      if (req.url === docPathBadNs) {
        res.statusCode = 200;
        res.end('<Report xmlns="http://invalid.com"><Body/></Report>');
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      return fetch(input, init);
    };

    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    const cycleResult = await service.pollOnce('scheduled');
    const regularResult = cycleResult.feedResults.find((r) => r.feedKind === 'regular');

    // フィード自体は成功！
    assert.equal(regularResult?.feedFetchOutcome, 'success');
    assert.equal(regularResult?.failedDocumentCount, 1);
    assert.equal(regularResult?.downloadedCount, 1);

    // フィードのバックオフは増加しない（0のまま、待機なし）
    const status = service.getStatus();
    assert.equal(status.feedStatuses.regular.consecutiveFailures, 0);
    assert.equal(status.feedStatuses.regular.isWaiting, false);

    // 個別電文の 500 失敗は fetch_attempt に記録
    const attempts = listFetchAttempts(db.connection);
    const docAttemptFail = attempts.find(
      (a) => a.sourceKind === 'xml_document' && a.outcome === 'failure',
    );
    assert.ok(docAttemptFail);
    assert.equal(docAttemptFail.httpStatus, 500);

    // 未対応形式は telegram_reception に記録
    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 1);
    assert.deepEqual(
      receptions[0].adoptions.map((a) => a.adoptionResult),
      ['未対応形式', '未対応形式'],
    );
  } finally {
    if (service) {
      await service.stop();
    }
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-6. 失敗分類に応じた通知レベル案（警報/問いかけ/非通知）の完全一致と、C13単体での通知非生成
// -------------------------------------------------------------------------------------------------
test('23-6. 失敗分類に応じた通知レベル案（警報/問いかけ/非通知）の完全一致と、C13単体での通知非生成', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });

    // 1. classifyNotificationLevel の完全一致検証
    assert.equal(classifyNotificationLevel({ scope: 'feed', errorKind: 'timeout' }), '警報（案）');
    assert.equal(classifyNotificationLevel({ scope: 'feed', errorKind: 'network' }), '警報（案）');
    assert.equal(
      classifyNotificationLevel({ scope: 'feed', errorKind: 'http_status' }),
      '警報（案）',
    );
    assert.equal(classifyNotificationLevel({ scope: 'feed', errorKind: 'parse' }), '警報（案）');
    // 異常閾値到達時
    assert.equal(
      classifyNotificationLevel({
        scope: 'feed',
        errorKind: 'timeout',
        isAnomalyThresholdReached: true,
      }),
      '問いかけ（案）',
    );
    // 個別電文失敗
    assert.equal(
      classifyNotificationLevel({ scope: 'document', errorKind: 'timeout' }),
      '非通知（案）',
    );
    assert.equal(
      classifyNotificationLevel({ scope: 'document', errorKind: 'http_status' }),
      '非通知（案）',
    );
    assert.equal(
      classifyNotificationLevel({ scope: 'document', adoptionResult: '未対応形式' }),
      '非通知（案）',
    );
    assert.equal(
      classifyNotificationLevel({ scope: 'document', adoptionResult: '未対応構造' }),
      '非通知（案）',
    );
    assert.equal(
      classifyNotificationLevel({ scope: 'document', adoptionResult: '未対応コード' }),
      '非通知（案）',
    );

    // 2. サービス実行により通知出力履歴が作成されないことの検証
    server.setHandler((_req, res) => {
      res.statusCode = 503;
      res.end('Fail');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/fail`, init);
      }
      return fetch(input, init);
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00.000Z',
    });

    await service.pollOnce('scheduled');

    // notification_output_history は 0 件のまま！
    const notifications = listNotificationOutputHistory(db.connection);
    assert.equal(notifications.length, 0);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-7. 初期取得失敗時に待機終了後に失敗フィードだけが再試行され、4フィードすべて成功時に completed へ遷移する
// -------------------------------------------------------------------------------------------------
test('23-7. 初期取得失敗時に待機終了後に失敗フィードだけが再試行され、4フィードすべて成功時に completed へ遷移する', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    let extraLStatus = 500; // 初回は extra_l のみ失敗

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === '/feed/extra_l.xml') {
        res.statusCode = extraLStatus;
        if (extraLStatus === 200) {
          res.end(feedXml);
        } else {
          res.end('Server Error');
        }
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const initialTimeMs = new Date('2026-09-09T01:00:00.000Z').getTime();
    const scheduler = new ManualTimerScheduler(initialTimeMs);

    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      timerScheduler: scheduler,
      clock: () => new Date(scheduler.getCurrentTimeMs()).toISOString(),
    });

    // 初期取得 start()
    const initResult = await service.start();
    assert.equal(initResult.completed, false);
    assert.deepEqual(initResult.failedFeedKinds, ['extra_l']);

    // 4フィードが各 1 回リクエストされた
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);

    // 30秒経過（待機中）
    await scheduler.advanceTime(30_000);
    // extra_l はまだ再試行されない
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);
    assert.equal(service.getStatus().initialFetch.phase, 'failed');

    // extra_l を 200 OK に復元
    extraLStatus = 200;

    // さらに 30秒経過（計 60秒経過、バックオフ待機解除）
    await scheduler.advanceTime(30_000);

    // 失敗した extra_l だけが再試行される！
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 2);
    // 成功済みだった regular, extra, regular_l は再取得されない！
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);

    // 4フィードすべて成功したため、completed に遷移する！
    const finalStatus = service.getStatus();
    assert.equal(finalStatus.initialFetch.phase, 'completed');
    assert.equal(finalStatus.initialFetch.result?.completed, true);
    assert.deepEqual(finalStatus.initialFetch.result?.failedFeedKinds, []);
  } finally {
    if (service) {
      await service.stop();
    }
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-8. 初期取得失敗の再試行が再度失敗した場合の指数バックオフ延長と、成功済みフィードの再取得抑止
// -------------------------------------------------------------------------------------------------
test('23-8. 初期取得失敗の再試行が再度失敗した場合の指数バックオフ延長と、成功済みフィードの再取得抑止', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    let extraLStatus = 500;

    server.setHandler((req, res) => {
      if (
        req.url === '/feed/regular.xml' ||
        req.url === '/feed/extra.xml' ||
        req.url === '/feed/regular_l.xml'
      ) {
        res.statusCode = 200;
        res.end(feedXml);
        return;
      }
      if (req.url === '/feed/extra_l.xml') {
        res.statusCode = extraLStatus;
        if (extraLStatus === 200) {
          res.end(feedXml);
        } else {
          res.end('Server Error');
        }
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const initialTimeMs = new Date('2026-09-09T01:00:00.000Z').getTime();
    const scheduler = new ManualTimerScheduler(initialTimeMs);

    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      timerScheduler: scheduler,
      clock: () => new Date(scheduler.getCurrentTimeMs()).toISOString(),
    });

    // 1. 初回 start(): extra_l が失敗
    await service.start();
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 1);

    // 2. 60秒後: 1回目の再試行 -> 再び失敗
    await scheduler.advanceTime(60_000);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 2);
    // consecutiveFailures は 2、待機は 120秒
    const status1 = service.getStatus();
    assert.equal(status1.feedStatuses.extra_l.consecutiveFailures, 2);
    assert.equal(status1.initialFetch.phase, 'failed');

    // 3. 60秒後（累計120秒後）: まだ120秒待機中なので再試行されない！
    await scheduler.advanceTime(60_000);
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 2);

    // 4. extra_l を 200 OK に回復し、さらに 60秒後（累計180秒後、120秒経過）
    extraLStatus = 200;
    await scheduler.advanceTime(60_000);

    // 2回目の再試行が実行され成功！
    assert.equal(server.requestCounts.get('/feed/extra_l.xml'), 3);
    assert.equal(service.getStatus().initialFetch.phase, 'completed');

    // 成功済みだった他3フィードは再取得されていないこと
    assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
    assert.equal(server.requestCounts.get('/feed/regular_l.xml'), 1);
  } finally {
    if (service) {
      await service.stop();
    }
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-9. stop() 後の通常・再試行取得停止と、重複 start によるタイマー多重化防止
// -------------------------------------------------------------------------------------------------
test('23-9. stop() 後の通常・再試行取得停止と、重複 start によるタイマー多重化防止', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((_req, res) => {
      res.statusCode = 200;
      res.end(feedXml);
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular.xml')) {
        return fetch(`${server.baseUrl}/feed/regular.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra.xml')) {
        return fetch(`${server.baseUrl}/feed/extra.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      if (urlStr.includes('/developer/xml/feed/extra_l.xml')) {
        return fetch(`${server.baseUrl}/feed/extra_l.xml`, init);
      }
      return fetch(input, init);
    };

    const initialTimeMs = new Date('2026-09-09T01:00:00.000Z').getTime();
    const scheduler = new ManualTimerScheduler(initialTimeMs);

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      timerScheduler: scheduler,
      clock: () => new Date(scheduler.getCurrentTimeMs()).toISOString(),
    });

    // 重複 start()
    const [r1, r2] = await Promise.all([service.start(), service.start()]);
    assert.equal(r1.completed, true);
    assert.equal(r2.completed, true);

    // stop() を呼ぶ
    await service.stop();
    assert.equal(service.getStatus().isRunning, false);

    const regularCountsBefore = server.requestCounts.get('/feed/regular.xml');

    // 時間を大幅に進めても新しいポーリングは一切走らない
    await scheduler.advanceTime(600_000);
    assert.equal(server.requestCounts.get('/feed/regular.xml'), regularCountsBefore);
  } finally {
    await server.close();
    cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// 23-10. pollFeeds による型安全なフィード限定取得と attemptNo の連続失敗数追従
// -------------------------------------------------------------------------------------------------
test('23-10. pollFeeds による型安全なフィード限定取得と attemptNo の連続失敗数追従', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();
  let service: JmaXmlPollingService | null = null;

  try {
    const db = initializeDatabase({ databasePath, migrationsDirectory });
    let regularLStatus = 500;

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular_l.xml') {
        res.statusCode = regularLStatus;
        if (regularLStatus === 200) {
          res.end(createSampleAtomFeed([]));
        } else {
          res.end('Fail');
        }
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    const customFetch: typeof fetch = (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('/developer/xml/feed/regular_l.xml')) {
        return fetch(`${server.baseUrl}/feed/regular_l.xml`, init);
      }
      return fetch(input, init);
    };

    let currentTime = '2026-09-09T01:00:00.000Z';
    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: defaultXmlFreshnessPolicy,
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => currentTime,
    });

    // 1. regular_l のみ取得 (1回目失敗 -> attemptNo=1)
    await service.pollFeeds('recovery', ['regular_l']);
    let attempts = listFetchAttempts(db.connection);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].attemptNo, 1);
    assert.equal(attempts[0].targetRef, 'regular_l');
    assert.equal(attempts[0].outcome, 'failure');

    // 2. 60秒後、2回目失敗 -> attemptNo=2
    currentTime = '2026-09-09T01:01:00.000Z';
    await service.pollFeeds('recovery', ['regular_l']);
    attempts = listFetchAttempts(db.connection);
    assert.equal(attempts.length, 2);
    // listFetchAttempts は降順 (DESC) のため attempts[0] が最新
    assert.equal(attempts[0].attemptNo, 2);
    assert.equal(attempts[1].attemptNo, 1);

    // 3. 120秒後、3回目成功 -> attemptNo=3
    regularLStatus = 200;
    currentTime = '2026-09-09T01:03:00.000Z';
    await service.pollFeeds('recovery', ['regular_l']);
    attempts = listFetchAttempts(db.connection);
    assert.equal(attempts.length, 3);
    assert.equal(attempts[0].attemptNo, 3);
    assert.equal(attempts[0].outcome, 'success');

    // 4. その後の試行は attemptNo=1 に戻る
    currentTime = '2026-09-09T01:04:00.000Z';
    await service.pollFeeds('recovery', ['regular_l']);
    attempts = listFetchAttempts(db.connection);
    assert.equal(attempts.length, 4);
    assert.equal(attempts[0].attemptNo, 1);
  } finally {
    if (service) {
      await service.stop();
    }
    await server.close();
    cleanup();
  }
});
