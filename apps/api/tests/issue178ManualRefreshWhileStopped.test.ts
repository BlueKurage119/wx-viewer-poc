import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { JmaXmlPollingService } from '../src/polling/jmaXmlPollingService.js';
import {
  TimeBasedPollingScheduler,
  type ScheduledPollAdapter,
} from '../src/polling/timeBasedPollingScheduler.js';
import { loadPollingScheduleConfig } from '../src/config/pollingScheduleLoader.js';
import type { PollingScheduleConfig, ScheduledSource } from '../src/config/pollingSchedule.js';
import {
  createFetchControlService,
  ForceRefreshAbortedError,
  ForceRefreshFailedError,
  type FetchControlTargets,
} from '../src/services/fetchControlService.js';
import { findOperationHistoryByRequestId } from '../src/repositories/operationHistoryRepository.js';
import { listNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-issue178-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dummyAdapter(source: ScheduledSource): ScheduledPollAdapter {
  return {
    source,
    async runScheduled() {},
    async runManual() {},
    hasLastRunFailed: () => false,
  };
}

const emptyAtomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象警報・注意報（空）</title>
  <updated>2026-09-19T00:00:00Z</updated>
  <id>empty-feed-id</id>
</feed>`;

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

test('T1: 停止中の手動サイクルがXML取得を行う', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });
    let fetchCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      fetchCount += 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('.xml') || url.includes('/feed/')) {
        return new Response(emptyAtomXml, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      return new Response(sampleTelegramXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: mockFetch,
    });

    await service.start();
    await service.stop();
    const countAfterStop = fetchCount;

    // 停止中に手動サイクル実行
    const result = await service.pollOnce('manual');

    // fetchFn の呼び出し回数が増加し、2フィード（regular, extra）で全て success
    assert.ok(fetchCount > countAfterStop, 'fetchCount should increase after manual poll');
    assert.equal(result.feedResults.length, 2);
    assert.equal(result.feedResults[0]!.feedKind, 'regular');
    assert.equal(result.feedResults[0]!.feedFetchOutcome, 'success');
    assert.equal(result.feedResults[1]!.feedKind, 'extra');
    assert.equal(result.feedResults[1]!.feedFetchOutcome, 'success');

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T2: 手動サイクル後も自動取得が再開しない', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('.xml') || url.includes('/feed/')) {
        return new Response(emptyAtomXml, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      return new Response(sampleTelegramXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    let scheduledTimerCount = 0;
    const timerScheduler = {
      setTimeout: (cb: () => void, ms: number) => {
        scheduledTimerCount += 1;
        return setTimeout(cb, ms);
      },
      clearTimeout: (id: unknown) => {
        clearTimeout(id as ReturnType<typeof setTimeout>);
      },
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: mockFetch,
      timerScheduler,
    });

    await service.start();
    await service.stop();
    const timerCountAfterStop = scheduledTimerCount;

    // 停止中に手動サイクル実行
    await service.pollOnce('manual');

    // タイマースタブに登録された setTimeout が増えていない
    assert.equal(scheduledTimerCount, timerCountAfterStop, 'setTimeout count should not increase');
    assert.equal(service.getStatus().isRunning, false);
    assert.equal(service.getNextRunAt(), null);

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T3: 手動サイクル中の stop() が電文境界で中断する', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });
    let service: JmaXmlPollingService | null = null;
    const fetchedUrls: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);

      if (url.includes('/feed/regular.xml')) {
        return new Response(sampleAtomXmlWith3Entries, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      if (url.includes('/feed/extra.xml')) {
        return new Response(emptyAtomXml, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }

      if (url === 'https://www.data.jma.go.jp/developer/xml/data/doc1.xml') {
        return new Response(sampleTelegramXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        });
      }

      if (url === 'https://www.data.jma.go.jp/developer/xml/data/doc2.xml') {
        // 2件目の処理中に stop() を呼ぶ
        void service?.stop('stop');
        return new Response(sampleTelegramXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        });
      }

      return new Response(sampleTelegramXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: mockFetch,
    });

    const result = await service.pollOnce('manual');

    // regular フィードが aborted
    const regularResult = result.feedResults.find((r) => r.feedKind === 'regular');
    assert.ok(regularResult);
    assert.equal(regularResult.feedFetchOutcome, 'aborted');
    // 以降の電文 GET (doc3.xml) が発生していない
    assert.equal(
      fetchedUrls.includes('https://www.data.jma.go.jp/developer/xml/data/doc3.xml'),
      false,
    );
    // extra フィードはループ先頭で break されるため feedResults に入っていない
    assert.equal(
      result.feedResults.find((r) => r.feedKind === 'extra'),
      undefined,
    );

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T4: シャットダウン後は手動サイクルを開始しない', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });
    let fetchCount = 0;
    const mockFetch: typeof fetch = async () => {
      fetchCount += 1;
      return new Response(emptyAtomXml, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    };

    const service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: mockFetch,
    });

    await service.stop('shutdown');
    assert.equal(fetchCount, 0);

    const result = await service.pollOnce('manual');
    assert.equal(fetchCount, 0, 'fetchFn should not be called at all');
    assert.deepEqual(result.feedResults, [], 'feedResults should be empty array');
    assert.equal(result.trigger, 'manual');

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T5: 中断済み in-flight へ合流しない', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });
    let service: JmaXmlPollingService | null = null;
    const deferred = makeDeferred<void>();

    let cycleCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/feed/regular.xml')) {
        cycleCount += 1;
        if (cycleCount === 1) {
          return new Response(sampleAtomXmlWith3Entries, {
            status: 200,
            headers: { 'content-type': 'application/atom+xml' },
          });
        }
        return new Response(emptyAtomXml, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      if (url.includes('/feed/extra.xml')) {
        return new Response(emptyAtomXml, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      if (url === 'https://www.data.jma.go.jp/developer/xml/data/doc1.xml') {
        // 1件目取得中に stop() を呼んで中断させる
        void service?.stop('stop');
        await deferred.promise;
        return new Response(sampleTelegramXml, {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        });
      }
      return new Response(sampleTelegramXml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    service = new JmaXmlPollingService(db.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      fetchFn: mockFetch,
    });

    const firstCyclePromise = service.pollOnce('manual');
    // doc1.xml 中に stop() が走るまで少し待機
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 中断中の in-flight がある状態で第2の手動サイクルを呼ぶ
    const secondCyclePromise = service.pollOnce('manual');

    // 1件目の待機を解除
    deferred.resolve();

    const [firstResult, secondResult] = await Promise.all([firstCyclePromise, secondCyclePromise]);

    assert.notEqual(firstResult, secondResult, 'PollCycleResult should be distinct objects');
    assert.equal(firstResult.feedResults[0]!.feedFetchOutcome, 'aborted');
    assert.equal(
      secondResult.feedResults.some((r) => r.feedFetchOutcome === 'success'),
      true,
    );

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T6: runManualOnce() の中断判定', async () => {
  const dummySchedule: PollingScheduleConfig = loadPollingScheduleConfig();

  // (a) feedResults: []
  {
    const fakeXmlService = {
      pollOnce: async () => ({
        trigger: 'manual' as const,
        startedAt: '2026-09-19T00:00:00Z',
        finishedAt: '2026-09-19T00:00:01Z',
        feedResults: [],
      }),
    } as unknown as JmaXmlPollingService;

    const scheduler = new TimeBasedPollingScheduler({
      schedule: dummySchedule,
      adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
      xmlPollingService: fakeXmlService,
    });

    const result = await scheduler.runManualOnce();
    assert.deepEqual(result.abortedSources, ['xml']);
    assert.deepEqual(result.failedSources, []);
  }

  // (b) 'aborted' を含む
  {
    const fakeXmlService = {
      pollOnce: async () => ({
        trigger: 'manual' as const,
        startedAt: '2026-09-19T00:00:00Z',
        finishedAt: '2026-09-19T00:00:01Z',
        feedResults: [
          {
            feedKind: 'regular' as const,
            feedFetchOutcome: 'aborted' as const,
            feedTitle: 'regular',
            discoveredCount: 0,
            downloadedCount: 0,
            failedDocumentCount: 0,
            skippedDocumentCount: 0,
          },
        ],
      }),
    } as unknown as JmaXmlPollingService;

    const scheduler = new TimeBasedPollingScheduler({
      schedule: dummySchedule,
      adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
      xmlPollingService: fakeXmlService,
    });

    const result = await scheduler.runManualOnce();
    assert.deepEqual(result.abortedSources, ['xml']);
    assert.deepEqual(result.failedSources, []);
  }

  // (c) 'failure' と 'aborted' の両方
  {
    const fakeXmlService = {
      pollOnce: async () => ({
        trigger: 'manual' as const,
        startedAt: '2026-09-19T00:00:00Z',
        finishedAt: '2026-09-19T00:00:01Z',
        feedResults: [
          {
            feedKind: 'regular' as const,
            feedFetchOutcome: 'failure' as const,
            feedTitle: 'regular',
            discoveredCount: 0,
            downloadedCount: 0,
            failedDocumentCount: 1,
            skippedDocumentCount: 0,
          },
          {
            feedKind: 'extra' as const,
            feedFetchOutcome: 'aborted' as const,
            feedTitle: 'extra',
            discoveredCount: 0,
            downloadedCount: 0,
            failedDocumentCount: 0,
            skippedDocumentCount: 0,
          },
        ],
      }),
    } as unknown as JmaXmlPollingService;

    const scheduler = new TimeBasedPollingScheduler({
      schedule: dummySchedule,
      adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
      xmlPollingService: fakeXmlService,
    });

    const result = await scheduler.runManualOnce();
    assert.deepEqual(result.failedSources, ['xml']);
    assert.deepEqual(result.abortedSources, []);
  }
});

test('T7: 強制更新APIの errorCode', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });

    // 中断ケース
    const abortedTargets: FetchControlTargets = {
      start: async () => {},
      stop: async () => {},
      forceRefresh: async () => {
        throw new ForceRefreshAbortedError(['xml']);
      },
      runRecovery: async () => {},
      isRunning: () => false,
      isUpstreamAllowedNow: () => true,
    };

    const serviceAborted = createFetchControlService({
      connection: db.connection,
      targets: abortedTargets,
      now: () => '2026-09-19T00:00:00.000Z' as UtcIso8601String,
    });

    const abortedOutcome = await serviceAborted.request('force_refresh', 'req-aborted-1');
    assert.equal(abortedOutcome.kind, 'completed');
    if (abortedOutcome.kind === 'completed') {
      assert.equal(abortedOutcome.response.result, 'failure');
      assert.equal(abortedOutcome.response.errorCode, 'force_refresh_aborted');
      assert.equal(abortedOutcome.response.errorMessage, 'xml');
    }

    const opAborted = findOperationHistoryByRequestId(db.connection, 'req-aborted-1');
    assert.ok(opAborted);
    assert.equal(opAborted.result, 'failure');
    assert.equal(opAborted.errorCode, 'force_refresh_aborted');
    assert.equal(opAborted.errorMessage, 'xml');

    // 取得失敗ケース
    const failedTargets: FetchControlTargets = {
      start: async () => {},
      stop: async () => {},
      forceRefresh: async () => {
        throw new ForceRefreshFailedError(['xml']);
      },
      runRecovery: async () => {},
      isRunning: () => false,
      isUpstreamAllowedNow: () => true,
    };

    const serviceFailed = createFetchControlService({
      connection: db.connection,
      targets: failedTargets,
      now: () => '2026-09-19T00:00:01.000Z' as UtcIso8601String,
    });

    const failedOutcome = await serviceFailed.request('force_refresh', 'req-failed-1');
    assert.equal(failedOutcome.kind, 'completed');
    if (failedOutcome.kind === 'completed') {
      assert.equal(failedOutcome.response.result, 'failure');
      assert.equal(failedOutcome.response.errorCode, 'force_refresh_failed');
    }

    const opFailed = findOperationHistoryByRequestId(db.connection, 'req-failed-1');
    assert.ok(opFailed);
    assert.equal(opFailed.result, 'failure');
    assert.equal(opFailed.errorCode, 'force_refresh_failed');

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T8: 中断時の通知が中断専用定義になる', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });

    const abortedTargets: FetchControlTargets = {
      start: async () => {},
      stop: async () => {},
      forceRefresh: async () => {
        throw new ForceRefreshAbortedError(['xml']);
      },
      runRecovery: async () => {},
      isRunning: () => false,
      isUpstreamAllowedNow: () => true,
    };

    const serviceAborted = createFetchControlService({
      connection: db.connection,
      targets: abortedTargets,
      now: () => '2026-09-19T00:00:00.000Z' as UtcIso8601String,
    });

    await serviceAborted.request('force_refresh', 'req-t8-aborted');

    const abortedNotifications = listNotificationOutputHistory(db.connection, {
      changeType: 'force_fetch_aborted',
    });
    assert.equal(abortedNotifications.length, 1);
    const notifAborted = abortedNotifications[0]!;
    assert.equal(notifAborted.messageDefinitionId, 'system-force-fetch-aborted');
    assert.equal(notifAborted.messageDefinitionVersion, '1');
    assert.equal(notifAborted.ackRequired, false);
    assert.equal(notifAborted.changeType, 'force_fetch_aborted');
    assert.equal(notifAborted.summary, '強制取得中断');

    // DB の生値でも ack_required === 0 であることを確認
    const rowAborted = db.connection
      .prepare(
        'select ack_required from notification_output_history where message_definition_id = ?',
      )
      .get('system-force-fetch-aborted') as { ack_required: number };
    assert.equal(rowAborted.ack_required, 0);

    // 同一 request_id に対して system-force-fetch-failed の行が存在しない
    const failedForSameReq = listNotificationOutputHistory(db.connection, {
      changeType: 'force_fetch_failed',
    });
    assert.equal(failedForSameReq.length, 0);

    db.close();
  } finally {
    tempDb.cleanup();
  }
});

test('T9: 取得失敗時の通知が退行しない', async () => {
  const tempDb = createTempDb();
  try {
    const db = initializeDatabase({ databasePath: tempDb.databasePath, migrationsDirectory });

    const failedTargets: FetchControlTargets = {
      start: async () => {},
      stop: async () => {},
      forceRefresh: async () => {
        throw new ForceRefreshFailedError(['xml']);
      },
      runRecovery: async () => {},
      isRunning: () => false,
      isUpstreamAllowedNow: () => true,
    };

    const serviceFailed = createFetchControlService({
      connection: db.connection,
      targets: failedTargets,
      now: () => '2026-09-19T00:00:01.000Z' as UtcIso8601String,
    });

    await serviceFailed.request('force_refresh', 'req-t9-failed');

    const failedNotifications = listNotificationOutputHistory(db.connection, {
      changeType: 'force_fetch_failed',
    });
    assert.equal(failedNotifications.length, 1);
    const notifFailed = failedNotifications[0]!;
    assert.equal(notifFailed.messageDefinitionId, 'system-force-fetch-failed');
    assert.equal(notifFailed.ackRequired, true);

    // DB の生値でも ack_required === 1 であることを確認
    const rowFailed = db.connection
      .prepare(
        'select ack_required from notification_output_history where message_definition_id = ?',
      )
      .get('system-force-fetch-failed') as { ack_required: number };
    assert.equal(rowFailed.ack_required, 1);

    db.close();
  } finally {
    tempDb.cleanup();
  }
});
