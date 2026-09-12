import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';

import {
  loadPollingScheduleConfig,
  resolvePollingPeriod,
  getNextEnabledAt,
  type PollingScheduleConfig,
} from '../src/config/index.js';
import { initializeDatabase } from '../src/database/index.js';
import { NowcastService, JmaXmlPollingService, createImageServices } from '../src/polling/index.js';
import { FeedBackoffManager } from '../src/polling/retryBackoff.js';
import { startServer } from '../src/server.js';

const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/nowcast');
const n1SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n1_synthetic.json'),
  'utf-8',
);
const n2SyntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'nowcast_target_times_n2_synthetic.json'),
  'utf-8',
);

function setupTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-test-'));
  const databasePath = path.join(tmpDir, 'test.sqlite3');
  const database = initializeDatabase({
    databasePath,
    migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
  });

  const cleanup = () => {
    database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, database, cleanup };
}

test('受け入れ条件 4: XML周期・索引周期の独立変更、夜間数値化、画像Enabledの独立性、次回予定計算、カスタム境界', () => {
  const baseSchedule = loadPollingScheduleConfig();

  // 1. XML周期だけ変更して索引周期が変わらない
  const xmlModifiedSchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) => (p.start === '04:00' ? { ...p, xmlSeconds: 45 } : p)),
  };
  const periodXmlMod = resolvePollingPeriod(
    new Date('2026-09-07T04:30:00+09:00'),
    xmlModifiedSchedule,
  );
  assert.equal(periodXmlMod.xmlSeconds, 45);
  assert.equal(periodXmlMod.imageCatalogSeconds, 120);

  // 2. 索引周期だけ変更してXML周期が変わらない
  const catalogModifiedSchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) =>
      p.start === '04:00' ? { ...p, imageCatalogSeconds: 80 } : p,
    ),
  };
  const periodCatMod = resolvePollingPeriod(
    new Date('2026-09-07T04:30:00+09:00'),
    catalogModifiedSchedule,
  );
  assert.equal(periodCatMod.xmlSeconds, 120);
  assert.equal(periodCatMod.imageCatalogSeconds, 80);

  // 3. 20:00〜04:00のxmlSeconds / imageCatalogSeconds / amedasSecondsを数値へ変更すると各対象が夜間起動で取得
  const nightActiveSchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) =>
      p.start === '20:00'
        ? {
            ...p,
            xmlSeconds: 60,
            imageCatalogSeconds: 90,
            amedasSeconds: 180,
            nowcastEnabled: true,
            kikikuruEnabled: true,
          }
        : p,
    ),
  };
  const nightActivePeriod = resolvePollingPeriod(
    new Date('2026-09-07T23:00:00+09:00'),
    nightActiveSchedule,
  );
  assert.equal(nightActivePeriod.xmlSeconds, 60);
  assert.equal(nightActivePeriod.imageCatalogSeconds, 90);
  assert.equal(nightActivePeriod.amedasSeconds, 180);
  assert.equal(nightActivePeriod.nowcastEnabled, true);
  assert.equal(nightActivePeriod.kikikuruEnabled, true);

  // 4. それぞれnullならXML / 両索引 / アメダスだけが停止
  const xmlOnlyNightSchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) =>
      p.start === '20:00'
        ? {
            ...p,
            xmlSeconds: 60,
            imageCatalogSeconds: null,
            amedasSeconds: null,
          }
        : p,
    ),
  };
  const xmlOnlyPeriod = resolvePollingPeriod(
    new Date('2026-09-07T23:00:00+09:00'),
    xmlOnlyNightSchedule,
  );
  assert.equal(xmlOnlyPeriod.xmlSeconds, 60);
  assert.equal(xmlOnlyPeriod.imageCatalogSeconds, null);
  assert.equal(xmlOnlyPeriod.amedasSeconds, null);

  // 5. 画像Enabledのfalse/trueは索引回数を変えず画像HTTPだけを制御
  const imageDisabledDaySchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) =>
      p.start === '05:00'
        ? {
            ...p,
            nowcastEnabled: false,
            kikikuruEnabled: false,
          }
        : p,
    ),
  };
  const imgDisabledPeriod = resolvePollingPeriod(
    new Date('2026-09-07T10:00:00+09:00'),
    imageDisabledDaySchedule,
  );
  assert.equal(imgDisabledPeriod.imageCatalogSeconds, 60);
  assert.equal(imgDisabledPeriod.nowcastEnabled, false);
  assert.equal(imgDisabledPeriod.kikikuruEnabled, false);

  // 6. 04:00〜05:00も停止にすると次回予定は05:00、全日停止ならnull
  const stopEarlySchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) =>
      p.start === '04:00'
        ? {
            ...p,
            xmlSeconds: null,
            imageCatalogSeconds: null,
            amedasSeconds: null,
          }
        : p,
    ),
  };
  const nextEnabledAtEarly = getNextEnabledAt(
    { kind: 'scheduled', source: 'xml' },
    new Date('2026-09-07T04:30:00+09:00'),
    stopEarlySchedule,
  );
  assert.equal(
    nextEnabledAtEarly?.toISOString(),
    new Date('2026-09-07T05:00:00+09:00').toISOString(),
  );

  const allStopSchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: baseSchedule.periods.map((p) => ({
      ...p,
      xmlSeconds: null,
      imageCatalogSeconds: null,
      amedasSeconds: null,
      nowcastEnabled: false,
      kikikuruEnabled: false,
    })),
  };
  const nextAllStop = getNextEnabledAt(
    { kind: 'scheduled', source: 'xml' },
    new Date('2026-09-07T12:00:00+09:00'),
    allStopSchedule,
  );
  assert.equal(nextAllStop, null);

  // 7. 境界時刻を編集した設定でも04:00固定が残らない
  const customBoundarySchedule: PollingScheduleConfig = {
    ...baseSchedule,
    periods: [
      {
        start: '03:00',
        end: '21:00',
        xmlSeconds: 60,
        imageCatalogSeconds: 60,
        amedasSeconds: 60,
        nowcastEnabled: true,
        kikikuruEnabled: true,
      },
      {
        start: '21:00',
        end: '03:00',
        xmlSeconds: null,
        imageCatalogSeconds: null,
        amedasSeconds: null,
        nowcastEnabled: false,
        kikikuruEnabled: false,
      },
    ],
  };
  const nextCustom = getNextEnabledAt(
    { kind: 'scheduled', source: 'xml' },
    new Date('2026-09-07T22:00:00+09:00'),
    customBoundarySchedule,
  );
  assert.equal(nextCustom?.toISOString(), new Date('2026-09-08T03:00:00+09:00').toISOString());
});

test('受け入れ条件 9: 閲覧readCatalog複数回呼出で索引HTTP不変、共用インスタンスによる保存フレーム画像取得', async () => {
  const { tmpDir, database, cleanup } = setupTestDb();
  try {
    let fetchCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      fetchCount += 1;
      if (url.includes('targetTimes_N1.json')) {
        return new Response(n1SyntheticJson, { status: 200 });
      }
      if (url.includes('targetTimes_N2.json')) {
        return new Response(n2SyntheticJson, { status: 200 });
      }
      if (url.endsWith('.png')) {
        return new Response(VALID_1X1_PNG, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    const currentTime = new Date('2026-09-07T03:00:00.000Z');
    const imageServices = createImageServices({
      connection: database.connection,
      nowcastCacheRoot: tmpDir,
      kikikuruCacheRoot: tmpDir,
      schedule: loadPollingScheduleConfig(),
      fetchFn: mockFetch,
      now: () => currentTime,
    });

    // 1. readCatalog() を複数回呼んでも索引HTTPは増えない（0回）
    const catalog1 = imageServices.nowcast.readCatalog();
    const catalog2 = imageServices.nowcast.readCatalog();
    const catalog3 = imageServices.nowcast.readCatalog();
    assert.equal(fetchCount, 0);
    assert.equal(catalog1.products.N1.availability, 'unavailable');
    assert.equal(catalog2.products.N1.availability, 'unavailable');
    assert.equal(catalog3.products.N1.availability, 'unavailable');

    // 2. 索引の更新（refreshTimes）を実行すると上流HTTPが実行され、readCatalogに反映される
    const refreshResult = await imageServices.nowcast.refreshTimes();
    assert.equal(refreshResult.products.N1.availability, 'available');
    assert.equal(fetchCount, 2); // N1 and N2

    const catalogAfterRefresh = imageServices.nowcast.readCatalog();
    assert.equal(catalogAfterRefresh.products.N1.availability, 'available');
    assert.ok(catalogAfterRefresh.products.N1.frames.length > 0);

    // 3. 同じサービスの readCatalog から得られた保存フレームに対して fetchFrameTiles で画像取得できる
    const targetFrame = catalogAfterRefresh.products.N1.frames[0];
    const tileResults = await imageServices.nowcast.fetchFrameTiles(targetFrame, [
      { zoom: 10, tileX: 908, tileY: 403 },
    ]);
    assert.equal(tileResults.length, 1);
    assert.equal(tileResults[0].kind, 'downloaded');
    assert.equal(fetchCount, 3); // 2 index + 1 tile

    await imageServices.close();
  } finally {
    cleanup();
  }
});

test('受け入れ条件 11: 実インスタンスでのXMLおよび索引の鮮度判定境界、夜間経過判定、状態変更なし', async () => {
  const { tmpDir, database, cleanup } = setupTestDb();
  try {
    let currentTimeIso = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
    const clock = () => currentTimeIso;

    // --- XML 実インスタンス検証 ---
    const xmlService = new JmaXmlPollingService(database.connection, {
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
      fetchFn: async () => new Response('Not found', { status: 404 }),
    });

    // 1. 初期未取得: lastSuccessAt=null -> regular=unavailable, extra=unavailable
    const initialStatus = xmlService.getStatus();
    assert.equal(initialStatus.feedFreshness.regular.availability, 'unavailable');
    assert.equal(initialStatus.feedFreshness.extra.availability, 'unavailable');
    assert.equal(initialStatus.feedFreshness.regular.lastSuccessAt, null);
    assert.equal(initialStatus.feedFreshness.extra.lastSuccessAt, null);
    // feedFreshness に regular, extra 以外の集約キーが存在しないこと
    assert.deepEqual(Object.keys(initialStatus.feedFreshness).sort(), ['extra', 'regular']);

    // 2. regular 成功 / extra 失敗のシミュレーション
    const backoffManager = (xmlService as unknown as { backoffManager: FeedBackoffManager })
      .backoffManager;
    backoffManager.recordSuccess('regular', currentTimeIso);
    backoffManager.recordFailure('extra', currentTimeIso, 'Failed');

    let status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'available');
    assert.equal(status.feedFreshness.extra.availability, 'unavailable'); // extra は未成功なので unavailable

    // extra も成功
    backoffManager.recordSuccess('extra', currentTimeIso);
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.extra.availability, 'available');

    // 3. 成功後の失敗（直近失敗 consecutiveFailures > 0）-> 即 stale
    const failTimeIso = '2026-09-07T03:01:00.000Z' as UtcIso8601String;
    currentTimeIso = failTimeIso;
    backoffManager.recordFailure('regular', failTimeIso, 'Temporary failure');
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'stale');

    // 4. 回復成功 -> consecutiveFailures=0, lastFailureAt が残っていても available
    const recoverTimeIso = '2026-09-07T03:02:00.000Z' as UtcIso8601String;
    currentTimeIso = recoverTimeIso;
    backoffManager.recordSuccess('regular', recoverTimeIso);
    assert.ok(backoffManager.getStatus('regular', recoverTimeIso).lastFailureAt !== null);
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'available');

    // 5. 経過時間判定: 299,999 ms は available, 300,000 ms は stale
    const lastSuccessMs = new Date(recoverTimeIso).getTime();
    currentTimeIso = new Date(lastSuccessMs + 299_999).toISOString() as UtcIso8601String;
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'available');

    currentTimeIso = new Date(lastSuccessMs + 300_000).toISOString() as UtcIso8601String;
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'stale');

    // 6. 夜間に進めても最終成功時刻から判定を継続（停止直後の一律staleや停止起点への変更なし）
    currentTimeIso = '2026-09-07T20:00:01.000+09:00' as UtcIso8601String; // 11:00:01Z
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'stale');

    // 夜間に新しく成功を記録した場合、直後は available であること
    const nightSuccessIso = '2026-09-07T21:00:00.000+09:00' as UtcIso8601String; // 12:00:00Z
    backoffManager.recordSuccess('regular', nightSuccessIso);
    currentTimeIso = '2026-09-07T21:04:59.000+09:00' as UtcIso8601String; // 299秒後
    status = xmlService.getStatus();
    assert.equal(status.feedFreshness.regular.availability, 'available');

    // getStatus 読取で DB や backoff 状態が変更されないこと
    const statusBefore = xmlService.getStatus();
    const statusAfter = xmlService.getStatus();
    assert.deepEqual(statusBefore, statusAfter);

    // --- 索引 (NowcastService) 実インスタンス検証 ---
    let nowcastFetchSuccess = true;
    const nowcastService = new NowcastService(database.connection, {
      cacheRoot: tmpDir,
      allowedZooms: [10],
      freshnessPolicy: { staleAfterSeconds: 300 },
      clock,
      getCatalogAccess: () => ({ allowed: true, nextChangeAt: null }),
      getImageAccess: () => ({ allowed: true, nextChangeAt: null }),
      fetchFn: async (input) => {
        const url = String(input);
        if (!nowcastFetchSuccess) {
          return new Response('Server error', { status: 500 });
        }
        if (url.includes('targetTimes_N1.json')) {
          return new Response(n1SyntheticJson, { status: 200 });
        }
        if (url.includes('targetTimes_N2.json')) {
          return new Response(n2SyntheticJson, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      },
    });

    // 初期状態: unavailable
    let nowcastCatalog = nowcastService.readCatalog();
    assert.equal(nowcastCatalog.products.N1.availability, 'unavailable');

    // 成功時: available
    currentTimeIso = '2026-09-07T05:00:00.000Z' as UtcIso8601String;
    const refResult = await nowcastService.refreshTimes();
    assert.equal(refResult.products.N1.availability, 'available');
    nowcastCatalog = nowcastService.readCatalog();
    assert.equal(nowcastCatalog.products.N1.availability, 'available');

    // 失敗時: 直近失敗で即 stale
    currentTimeIso = '2026-09-07T05:01:00.000Z' as UtcIso8601String;
    nowcastFetchSuccess = false;
    await nowcastService.refreshTimes();
    nowcastCatalog = nowcastService.readCatalog();
    assert.equal(nowcastCatalog.products.N1.availability, 'stale');

    // 回復時: available
    currentTimeIso = '2026-09-07T05:02:00.000Z' as UtcIso8601String;
    nowcastFetchSuccess = true;
    await nowcastService.refreshTimes();
    nowcastCatalog = nowcastService.readCatalog();
    assert.equal(nowcastCatalog.products.N1.availability, 'available');

    // 経過時間判定: 299,999 ms は available, 300,000 ms は stale
    const nowcastSuccessMs = new Date(currentTimeIso).getTime();
    currentTimeIso = new Date(nowcastSuccessMs + 299_999).toISOString() as UtcIso8601String;
    assert.equal(nowcastService.readCatalog().products.N1.availability, 'available');

    currentTimeIso = new Date(nowcastSuccessMs + 300_000).toISOString() as UtcIso8601String;
    assert.equal(nowcastService.readCatalog().products.N1.availability, 'stale');

    // readCatalog 呼出しで状態変更がないこと
    const catalogA = nowcastService.readCatalog();
    const catalogB = nowcastService.readCatalog();
    assert.deepEqual(catalogA, catalogB);
  } finally {
    cleanup();
  }
});

test('受け入れ条件 15: startServer経由のimageServices結線、日中/夜間/カスタム夜間許可、無通信起動、close終了処理', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startserver-acceptance-'));
  const databasePath = path.join(tmpDir, 'test.sqlite3');

  try {
    const dummyFetch: typeof fetch = async () => new Response('Not found', { status: 404 });
    const createDummyAdapter = (source: 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      runScheduled: async () => {},
    });
    const schedulerSafeOptions = {
      adapters: [
        createDummyAdapter('nowcast'),
        createDummyAdapter('kikikuru'),
        createDummyAdapter('amedas'),
      ],
      setTimer: () => 1,
      clearTimer: () => {},
    };

    // 1. 日中時刻（12:00 JST）での起動と独立ポリシー注入検証
    let clockTime = new Date('2026-09-07T12:00:00+09:00');
    const baseSchedule = loadPollingScheduleConfig();
    const dayScheduleWithCustomFreshness: PollingScheduleConfig = {
      ...baseSchedule,
      freshness: {
        xml: { staleAfterSeconds: 600 },
        imageCatalog: { staleAfterSeconds: 300 },
      },
    };
    const dayServer = await startServer({
      config: {
        databasePath,
        migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
      },
      port: 0,
      enablePolling: true,
      pollingSchedule: dayScheduleWithCustomFreshness,
      pollingServiceOptions: { fetchFn: dummyFetch },
      schedulerOptions: {
        ...schedulerSafeOptions,
        now: () => clockTime,
      },
    });

    assert.ok(dayServer.imageServices);
    assert.ok(dayServer.pollingService);
    // XMLには freshness.xml (600秒) が注入されていること
    assert.equal(dayServer.pollingService.getStatus().feedFreshness.regular.staleAfterSeconds, 600);
    const dayNowcastCatalog = dayServer.imageServices.nowcast.readCatalog();
    assert.equal(dayNowcastCatalog.imageAccess.allowed, true);
    assert.equal(dayNowcastCatalog.catalogAccess.allowed, true);
    await dayServer.close();

    // 2. 夜間時刻（22:00 JST）での起動
    clockTime = new Date('2026-09-07T22:00:00+09:00');
    const nightServer = await startServer({
      config: {
        databasePath,
        migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
      },
      port: 0,
      enablePolling: true,
      pollingServiceOptions: { fetchFn: dummyFetch },
      schedulerOptions: {
        ...schedulerSafeOptions,
        now: () => clockTime,
      },
    });

    assert.ok(nightServer.imageServices);
    const nightNowcastCatalog = nightServer.imageServices.nowcast.readCatalog();
    assert.equal(nightNowcastCatalog.imageAccess.allowed, false);
    assert.equal(nightNowcastCatalog.catalogAccess.allowed, false);
    await nightServer.close();

    // 3. カスタム夜間許可設定での起動
    const customNightSchedule: PollingScheduleConfig = {
      ...baseSchedule,
      periods: baseSchedule.periods.map((p) =>
        p.start === '20:00'
          ? {
              ...p,
              xmlSeconds: 60,
              imageCatalogSeconds: 60,
              amedasSeconds: 60,
              nowcastEnabled: true,
              kikikuruEnabled: true,
            }
          : p,
      ),
    };
    const customNightServer = await startServer({
      config: {
        databasePath,
        migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
      },
      port: 0,
      enablePolling: true,
      pollingSchedule: customNightSchedule,
      pollingServiceOptions: { fetchFn: dummyFetch },
      schedulerOptions: {
        ...schedulerSafeOptions,
        now: () => clockTime,
      },
    });

    assert.ok(customNightServer.imageServices);
    const customCatalog = customNightServer.imageServices.nowcast.readCatalog();
    assert.equal(customCatalog.imageAccess.allowed, true);
    assert.equal(customCatalog.catalogAccess.allowed, true);
    await customNightServer.close();

    // 4. enablePolling: false での無通信起動
    const disabledServer = await startServer({
      config: {
        databasePath,
        migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
      },
      port: 0,
      enablePolling: false,
    });

    assert.ok(disabledServer.imageServices);
    const disabledCatalog = disabledServer.imageServices.nowcast.readCatalog();
    assert.equal(disabledCatalog.catalogAccess.allowed, false);
    assert.equal(disabledCatalog.imageAccess.allowed, false);

    // close 後は新規呼出が終了済みエラーとなること
    await disabledServer.close();
    await assert.rejects(
      async () => {
        await disabledServer.imageServices?.nowcast.refreshTimes();
      },
      { message: /ImageService is already closed/ },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
