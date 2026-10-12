import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { InitialWarningNotificationTracker } from '../src/notifications/initialWarningNotificationTracker.js';
import { JMA_XML_FEED_DEFINITIONS } from '../src/polling/jmaXmlFeeds.js';
import { pollSingleFeed } from '../src/polling/jmaXmlPoller.js';
import { listNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import { buildTrainingCancelTelegram } from '../src/training/trainingCancelTelegram.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { generateTrainingWarningBaseline } from '../src/training/trainingWarningBaseline.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

/**
 * 訓練抹消の「通知しない」分岐は抹消処理の呼出し側だけにある（Issue #71）。
 * 通常（normal）の警報の取消電文を pollSingleFeed 経由で流したとき、従来どおり取消通知が出ることを固定する。
 */
test('通常の警報の取消電文は pollSingleFeed 経由で従来どおり取消通知を出す', async () => {
  const db = initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    const normal = (xml: string) => xml.replace('<Status>訓練</Status>', '<Status>通常</Status>');
    const baseline = normal(
      generateTrainingWarningBaseline({
        reportDateTime: '2026-10-12T09:49:00.000Z',
        controlDateTime: '2026-10-12T09:49:00.000Z',
      }),
    );
    const warning = normal(
      generateTrainingTelegrams(['warning-03'], {
        now: '2026-10-12T10:00:00.000Z',
        generationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      })[0]!.xml,
    );
    const cancel = buildTrainingCancelTelegram(warning, {
      controlDateTime: '2026-10-12T10:30:00.000Z',
    });
    const prefix = 'https://example.com/xml/';
    const docs: Record<string, string> = {
      [`${prefix}a_VPWS50_x.xml`]: baseline,
      [`${prefix}b_VPWW55_x.xml`]: warning,
      [`${prefix}c_VPWW55_x.xml`]: cancel,
    };
    const feedDef = JMA_XML_FEED_DEFINITIONS.find((d) => d.kind === 'extra')!;
    const feedOf = (urls: string[]) =>
      `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>f</title><updated>2026-10-12T10:00:00Z</updated>${urls
        .map(
          (u, i) =>
            `<entry><title>t</title><id>${u}-${i}</id><updated>2026-10-12T10:00:00Z</updated><link rel="alternate" type="application/xml" href="${u}"/></entry>`,
        )
        .join('')}</feed>`;
    let currentFeed = feedOf([]);
    const fetchFn: typeof fetch = async (url) => {
      const key = String(url);
      if (key === feedDef.url) return new Response(currentFeed, { status: 200 });
      const body = docs[key];
      return body ? new Response(body, { status: 200 }) : new Response('x', { status: 404 });
    };
    const tracker = new InitialWarningNotificationTracker();
    tracker.markDone('1310800', 'normal');
    const options = {
      venueRegistry: testVenueRegistry,
      fetchFn,
      allowedUrlPrefixes: [prefix],
      clock: () => '2026-10-12T10:31:00.000Z' as const,
      warningNotificationEmitDeps: {
        retainedConnection: db.retained.connection,
        weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
        tracker,
        now: () => '2026-10-12T10:31:00.000Z' as const,
      },
    };
    const poll = (urls: string[]) => {
      currentFeed = feedOf(urls);
      return pollSingleFeed(db.weather.connection, feedDef, 'manual', 1, new Set(), options);
    };
    await poll([...Object.keys(docs).slice(0, 2)]);
    const afterIssue = listNotificationOutputHistory(db.retained.connection);
    assert.equal(afterIssue.length, 1);
    assert.equal(afterIssue[0]!.isTraining, false);
    assert.equal(afterIssue[0]!.summary, '気象警報発表\n江東区\nレベル３大雨警報');

    await poll([Object.keys(docs)[2]!]);
    const afterCancel = listNotificationOutputHistory(db.retained.connection);
    assert.equal(afterCancel.length, 2, '取消通知が1件増える');
    assert.equal(afterCancel[0]!.summary, '気象警報等取消\n江東区\nレベル３大雨警報');
    assert.equal(afterCancel[0]!.isTraining, false);
  } finally {
    db.close();
  }
});
