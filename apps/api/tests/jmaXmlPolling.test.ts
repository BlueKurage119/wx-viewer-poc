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
  listWarningCurrentStreams,
  listNotificationOutputHistory,
} from '../src/repositories/index.js';
import {
  JMA_XML_FEED_DEFINITIONS,
  getFeedDefinitionsForTrigger,
} from '../src/polling/jmaXmlFeeds.js';
import { FeedBackoffManager, calculateBackoffDelaySeconds } from '../src/polling/retryBackoff.js';
import {
  parseAtomFeed,
  parseTelegramXml,
  extractTelegramTypeFromUrl,
} from '../src/polling/jmaXmlFeedParser.js';
import { JmaXmlPollingService } from '../src/polling/jmaXmlPollingService.js';
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
      discoveredCount: 2,
      skippedDuplicateCount: 1,
      downloadedCount: 1,
      failedDocumentCount: 0,
    });

    // extra フィード: 発見1, スキップ1 (既処理), ダウンロード0
    const extraResult = cycleResult.feedResults.find((r) => r.feedKind === 'extra');
    assert.deepEqual(extraResult, {
      feedKind: 'extra',
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
    assert.equal(reception.adoptionResult, '未対応構造');
    assert.ok(reception.adoptionReason && reception.adoptionReason.length > 0);
    assert.equal(reception.adoptionDecidedAt, '2026-09-09T01:00:00Z');
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
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      clock: () => '2026-09-09T01:00:00Z',
    });

    await service.pollOnce('scheduled');

    const receptions = listTelegramReceptions(db.connection);
    assert.equal(receptions.length, 3);

    // 3件とも C2 の種別固有検証で未対応構造として記録されていること
    for (const rSummary of receptions) {
      assert.equal(rSummary.adoptionResult, '未対応構造');
      assert.ok(rSummary.adoptionReason && rSummary.adoptionReason.length > 0);
      const detail = findTelegramReceptionById(db.connection, rSummary.id);
      assert.ok(detail?.rawBody); // 原文が保持されていること
    }

    // それぞれの失敗理由の確認
    const r1 = receptions.find((r) => r.documentUrl.includes('invalid_ns'));
    assert.match(r1?.adoptionReason ?? '', /ルート要素|名前空間/);

    const r2 = receptions.find((r) => r.documentUrl.includes('no_control'));
    assert.match(r2?.adoptionReason ?? '', /Control/);

    const r3 = receptions.find((r) => r.documentUrl.includes('no_area'));
    assert.match(r3?.adoptionReason ?? '', /Warning|地域/);
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
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
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

    const service = new JmaXmlPollingService(db.connection, {
      fetchFn: customFetch,
      allowedUrlPrefixes: [server.baseUrl],
      allowHttpForTesting: true,
      intervalMs: 50, // テスト用に短縮
      clock: () => '2026-09-09T01:00:00Z',
    });

    // 複数回 start() を呼ぶ
    service.start();
    service.start();
    service.start();

    const statusBefore = service.getStatus();
    assert.equal(statusBefore.isRunning, true);

    // 初回即時実行完了を待つ
    await new Promise((resolve) => setTimeout(resolve, 80));

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
// 11. 既定の startServer() でポーリングが開始され、高頻度 2 フィードの定期取得が行われる
// -------------------------------------------------------------------------------------------------
test('11. 既定の startServer() でポーリングが開始され、高頻度 2 フィードの定期取得が行われる', async () => {
  const { databasePath, cleanup } = createTempDb();
  const server = await createTestHttpServer();

  try {
    const config = { databasePath, migrationsDirectory };
    const feedXml = createSampleAtomFeed([]);

    server.setHandler((req, res) => {
      if (req.url === '/feed/regular.xml' || req.url === '/feed/extra.xml') {
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
      assert.equal(
        apiServer.pollingService.getStatus().isRunning,
        true,
        '既定でポーリングが開始されている',
      );

      // 初回実行完了を少し待機
      await new Promise((resolve) => setTimeout(resolve, 80));

      // 高頻度 2 フィード (regular, extra) が要求されたこと
      assert.equal(server.requestCounts.get('/feed/regular.xml'), 1);
      assert.equal(server.requestCounts.get('/feed/extra.xml'), 1);
    } finally {
      await apiServer.close();
    }

    assert.equal(apiServer.pollingService?.getStatus().isRunning, false, 'close 後に停止している');
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
    assert.equal(vpwwReception.adoptionResult, '警報・注意報として解析済み');

    const vpwpReception = receptions.find((r) => r.telegramType === 'VPWP50');
    assert.ok(vpwpReception);
    assert.equal(vpwpReception.adoptionResult, '警報等時系列として解析済み');

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
    assert.equal(vpwwReception.adoptionResult, '警報・注意報として解析済み');

    const vpwpReception = receptions.find((r) => r.telegramType === 'VPWP50');
    assert.ok(vpwpReception);
    assert.equal(vpwpReception.adoptionResult, '警報等時系列として解析済み');

    const vpfdReception = receptions.find((r) => r.telegramType === 'VPFD61');
    assert.ok(vpfdReception);
    assert.equal(vpfdReception.adoptionResult, '早期注意情報として解析済み');

    const vpfwReception = receptions.find((r) => r.telegramType === 'VPFW60');
    assert.ok(vpfwReception);
    assert.equal(vpfwReception.adoptionResult, '早期注意情報として解析済み');

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
    assert.equal(vpfd51Reception.adoptionResult, '地域時系列予報として解析済み');

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
    assert.equal(vpbs50Reception.adoptionResult, '気象防災速報として解析済み');

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
