import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import {
  ingestTelegramDocument,
  pollSingleFeed,
  type TelegramDocumentInput,
} from '../src/polling/jmaXmlPoller.js';
import { JMA_XML_FEED_DEFINITIONS } from '../src/polling/jmaXmlFeeds.js';
import { listFetchAttempts, listTelegramReceptions } from '../src/repositories/index.js';
import { listTelegramReceptionAdoptions } from '../src/repositories/telegramReceptionRepository.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

function setupDb() {
  return initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
}

test('ingestTelegramDocument 切り出し検証: pollSingleFeed 経由と ingestTelegramDocument 直接呼出しで受信・採用・通知が一致する', async () => {
  // 1. 固定XMLを J1 生成で用意（大雨警報）
  const generated = generateTrainingTelegrams(['warning-03'], {
    now: '2026-10-12T10:00:00.000Z',
    generationId: 'test-gen-1',
  });
  assert.equal(generated.length, 1);
  const sampleXml = generated[0]!.xml;
  const sampleHash = crypto.createHash('sha256').update(sampleXml).digest('hex');
  const sampleBytes = Buffer.byteLength(sampleXml, 'utf8');

  const docUrl = 'https://example.com/xml/20261012_VPWW55_test.xml';
  const feedXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>高頻度（随時）フィード</title>
  <updated>2026-10-12T10:00:00Z</updated>
  <entry>
    <title>気象警報・注意報</title>
    <id>entry-test-1</id>
    <updated>2026-10-12T10:00:00Z</updated>
    <link rel="alternate" type="application/xml" href="${docUrl}"/>
  </entry>
</feed>`;

  // A. pollSingleFeed 経由
  const db1 = setupDb();
  try {
    const feedDef = JMA_XML_FEED_DEFINITIONS.find((d) => d.kind === 'extra')!;
    const mockFetch: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr === feedDef.url) {
        return new Response(feedXml, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      if (urlStr === docUrl) {
        return new Response(sampleXml, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const pollResult = await pollSingleFeed(
      db1.weather.connection,
      feedDef,
      'manual',
      1,
      new Set(),
      {
        venueRegistry: testVenueRegistry,
        fetchFn: mockFetch,
        allowedUrlPrefixes: ['https://example.com/'],
        clock: () => '2026-10-12T10:00:05.000Z',
      },
    );

    assert.equal(pollResult.feedResult.feedFetchOutcome, 'success');
    assert.equal(pollResult.feedResult.downloadedCount, 1);

    // fetch_attempt の確認
    const attempts = listFetchAttempts(db1.weather.connection);
    assert.equal(attempts.length, 2); // フィード行 + xml_document 行
    const feedAttempt = attempts.find((a) => a.sourceKind === 'xml_feed_extra');
    const docAttempt = attempts.find((a) => a.sourceKind === 'xml_document');
    assert.ok(feedAttempt);
    assert.ok(docAttempt);
    assert.equal(feedAttempt.outcome, 'success');
    assert.equal(docAttempt.outcome, 'success');
    assert.equal(docAttempt.responseBytes, sampleBytes);
    assert.equal(docAttempt.contentHash, sampleHash);

    // telegram_reception の確認
    const receptions = listTelegramReceptions(db1.weather.connection);
    assert.equal(receptions.length, 1);
    const rec1 = receptions[0]!;
    assert.equal(rec1.feedKind, 'extra');
    assert.equal(rec1.feedEntryId, 'entry-test-1');
    assert.equal(rec1.fetchAttemptId, docAttempt.id);
    assert.equal(rec1.documentUrl, docUrl);
    assert.equal(rec1.telegramType, 'VPWW55');
    assert.equal(rec1.controlStatus, 'training');
    assert.equal(rec1.contentHash, sampleHash);

    const adoptions1 = listTelegramReceptionAdoptions(db1.weather.connection, rec1.id);
    assert.ok(adoptions1.length > 0);

    // B. ingestTelegramDocument を直接呼出し
    const db2 = setupDb();
    try {
      const directInput: TelegramDocumentInput = {
        documentUrl: 'training://direct-test/1_VPWW55_training.xml',
        xml: sampleXml,
        feedKind: 'training',
        feedEntryId: 'direct-entry-1',
        fetchAttemptId: null,
        receivedAt: '2026-10-12T10:00:05.000Z',
        bodyBytes: sampleBytes,
        contentHash: sampleHash,
      };

      const directRec = await ingestTelegramDocument(db2.weather.connection, directInput, {
        venueRegistry: testVenueRegistry,
        clock: () => '2026-10-12T10:00:05.000Z',
      });

      // fetch_attempt_id, feed_kind, document_url を除き一致すること
      assert.equal(directRec.telegramType, rec1.telegramType);
      assert.equal(directRec.title, rec1.title);
      assert.equal(directRec.controlStatus, rec1.controlStatus);
      assert.equal(directRec.infoType, rec1.infoType);
      assert.equal(directRec.reportDateTime, rec1.reportDateTime);
      assert.equal(directRec.controlDateTime, rec1.controlDateTime);
      assert.equal(directRec.contentHash, rec1.contentHash);
      assert.equal(directRec.bodyBytes, rec1.bodyBytes);

      const adoptions2 = listTelegramReceptionAdoptions(db2.weather.connection, directRec.id);
      assert.equal(adoptions2.length, adoptions1.length);
      for (let i = 0; i < adoptions1.length; i++) {
        assert.equal(adoptions2[i]!.venueId, adoptions1[i]!.venueId);
        assert.equal(adoptions2[i]!.adoptionResult, adoptions1[i]!.adoptionResult);
        assert.equal(adoptions2[i]!.adoptionReason, adoptions1[i]!.adoptionReason);
      }
    } finally {
      db2.close();
    }
  } finally {
    db1.close();
  }
});
