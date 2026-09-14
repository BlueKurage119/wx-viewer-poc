import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type {
  WeatherControlStatus as ControlStatus,
  AreaTimeseriesTimeDefineDto as AreaTimeseriesTimeDefine,
  AreaTimeseriesValueDto as AreaTimeseriesValue,
  AmedasTarget,
  BulletinDto as BulletinDetail,
  VenueId,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { createWeatherApiService } from '../src/services/weatherApiService.js';
import { saveAreaTimeseriesSnapshot } from '../src/repositories/areaTimeseriesRepository.js';
import { saveAmedasSnapshot } from '../src/repositories/amedasRepository.js';
import { saveBosaiBulletin } from '../src/repositories/bosaiBulletinRepository.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import type { JmaXmlPollingStatus } from '../src/polling/jmaXmlPollingService.js';
import { startServer } from '../src/server.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function request(app: ReturnType<typeof createApp>) {
  return {
    get: async (path: string) => {
      const server = await new Promise<Server>((resolve, reject) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        listening.once('error', reject);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('missing TCP address');
      try {
        const res = await fetch(`http://127.0.0.1:${address.port}${path}`);
        const text = await res.text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any = text;
        try {
          body = JSON.parse(text);
        } catch {
          // ignore json parse error
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          headers[key.toLowerCase()] = val;
        });
        return {
          status: res.status,
          headers,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          body: body as any,
          text,
        };
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error?: Error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

function createAvailablePollingStatus(): JmaXmlPollingStatus {
  return {
    isRunning: true,
    initialFetch: { phase: 'completed', result: null },
    lastCycleResult: null,
    feedStatuses: {
      regular: {
        feedKind: 'regular',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        lastFailureAt: null,
      },
      extra: {
        feedKind: 'extra',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        lastFailureAt: null,
      },
      regular_l: {
        feedKind: 'regular_l',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        lastFailureAt: null,
      },
      extra_l: {
        feedKind: 'extra_l',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        lastFailureAt: null,
      },
    },
    feedFreshness: {
      regular: {
        availability: 'available',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        staleAfterSeconds: 300,
      },
      extra: {
        availability: 'available',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        staleAfterSeconds: 300,
      },
    },
  };
}

function createTestApp(options?: {
  pollingStatus?: JmaXmlPollingStatus;
  nowIso?: string;
  onInitDb?: (db: ReturnType<typeof initializeDatabase>) => void;
  resolveAmedasTarget?: (venueId: VenueId) => AmedasTarget;
}) {
  const db = initializeDatabase({ databasePath: ':memory:', migrationsDirectory });
  if (options?.onInitDb) {
    options.onInitDb(db);
  }
  const nowIso = options?.nowIso ?? '2026-09-14T06:30:00.000Z';
  const weatherApi = createWeatherApiService({
    connection: db.connection,
    getPollingStatus: () => options?.pollingStatus ?? createAvailablePollingStatus(),
    now: () => nowIso,
    resolveAmedasTarget: options?.resolveAmedasTarget,
  });
  const app = createApp({ weatherApi });
  return { db, app, weatherApi, nowIso };
}

// ---------------------------------------------------------------------------
// B1 端末と対象解決
// ---------------------------------------------------------------------------
test('B1 端末と対象解決: 3 GET で east / trc の端末解決。他区域・他地点の sentinel が混入しない', async () => {
  const { db, app } = createTestApp();

  // #36 地域時系列予報: 東京地方 130010 / 気温 44132 (east/trc共通)
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京（北の丸公園）',
    metadata: {
      source: 'https://www.data.jma.go.jp/developer/xml/data/20260914060000_0_VPFD51_130010.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: '20260914060000_0_VPFD51_130010',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T09:00:00.000Z',
        duration: 'PT3H',
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: '晴れ',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
    ],
  });

  // sentinel: 新潟地方 150010
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '150010',
    areaName: '新潟地方',
    stationCode: '54232',
    stationName: '新潟',
    metadata: {
      source: 'https://www.data.jma.go.jp/developer/xml/data/20260914060000_0_VPFD51_150010.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: '20260914060000_0_VPFD51_150010',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [],
    values: [],
  });

  // #37 アメダス: east=44136(江戸川臨海), trc=44166(羽田), sentinel=44132(東京)
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 25.5,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  saveAmedasSnapshot(db.connection, {
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/44132',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 26.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  // #38 気象防災速報
  // east: includedAreaCodes = ['1310800', '130012', '130010']
  // trc: includedAreaCodes = ['1311100', '130011', '130010']
  // sentinel: '1500000' (新潟)
  saveBosaiBulletin(db.connection, {
    eventId: 'bulletin-east-only',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '江東区気象情報',
    headlineText: '江東区情報',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_bulletin-east.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  saveBosaiBulletin(db.connection, {
    eventId: 'bulletin-trc-only',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '大田区気象情報',
    headlineText: '大田区情報',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_bulletin-trc.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1311100',
        areaName: '大田区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  saveBosaiBulletin(db.connection, {
    eventId: 'bulletin-sentinel',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '新潟気象情報',
    headlineText: '新潟情報',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_bulletin-sentinel.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1500000',
        areaName: '新潟県',
        codeType: '府県予報区',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const client = request(app);

  // #36 east
  const res36East = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res36East.status, 200);
  assert.equal(res36East.body.area.code, '130010');
  assert.equal(res36East.body.data.station.code, '44132');

  // #37 east (44136 exists) / trc (44166 not saved -> data: null, does not use 44136 or 44132)
  const res37East = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res37East.status, 200);
  assert.equal(res37East.body.station.code, '44136');
  assert.equal(res37East.body.data.observations[0].values.temp, 25.5);

  const res37Trc = await client.get('/api/weather/amedas?terminalId=htrcph01&controlStatus=normal');
  assert.equal(res37Trc.status, 200);
  assert.equal(res37Trc.body.station.code, '44166');
  assert.equal(res37Trc.body.data, null);
  assert.equal(res37Trc.body.metadata.availability, 'unavailable');

  // #38 east: only east bulletin returns, no trc or sentinel
  const res38East = await client.get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res38East.status, 200);
  assert.equal(res38East.body.bulletins.length, 1);
  assert.equal(res38East.body.bulletins[0].eventId, 'bulletin-east-only');

  // #38 trc: only trc bulletin returns
  const res38Trc = await client.get(
    '/api/weather/bulletins?terminalId=htrcph01&controlStatus=normal',
  );
  assert.equal(res38Trc.status, 200);
  assert.equal(res38Trc.body.bulletins.length, 1);
  assert.equal(res38Trc.body.bulletins[0].eventId, 'bulletin-trc-only');
});

// ---------------------------------------------------------------------------
// B2 入力検証
// ---------------------------------------------------------------------------
test('B2 入力検証: 3 GET でクエリ検証エラー400、未知端末404、正常200', async () => {
  const { app } = createTestApp();
  const client = request(app);

  const paths = ['/api/weather/area-timeseries', '/api/weather/amedas', '/api/weather/bulletins'];

  for (const path of paths) {
    // 欠落
    const resNoTerm = await client.get(`${path}?controlStatus=normal`);
    assert.equal(resNoTerm.status, 400);
    assert.deepEqual(resNoTerm.body, { status: 'error', code: 'invalid_request' });

    const resNoCtrl = await client.get(`${path}?terminalId=hkeagh01`);
    assert.equal(resNoCtrl.status, 400);
    assert.deepEqual(resNoCtrl.body, { status: 'error', code: 'invalid_request' });

    // 空文字
    const resEmptyTerm = await client.get(`${path}?terminalId=&controlStatus=normal`);
    assert.equal(resEmptyTerm.status, 400);
    assert.deepEqual(resEmptyTerm.body, { status: 'error', code: 'invalid_request' });

    // 未知キー
    const resExtra = await client.get(`${path}?terminalId=hkeagh01&controlStatus=normal&extra=1`);
    assert.equal(resExtra.status, 400);
    assert.deepEqual(resExtra.body, { status: 'error', code: 'invalid_request' });

    // 不正 controlStatus
    const resInvalidCtrl = await client.get(`${path}?terminalId=hkeagh01&controlStatus=unknown`);
    assert.equal(resInvalidCtrl.status, 400);
    assert.deepEqual(resInvalidCtrl.body, { status: 'error', code: 'invalid_request' });

    // 重複キー（配列形式）
    const resDupTerm = await client.get(
      `${path}?terminalId=hkeagh01&terminalId=htrcph01&controlStatus=normal`,
    );
    assert.equal(resDupTerm.status, 400);
    assert.deepEqual(resDupTerm.body, { status: 'error', code: 'invalid_request' });

    const resDupCtrl = await client.get(
      `${path}?terminalId=hkeagh01&controlStatus=normal&controlStatus=training`,
    );
    assert.equal(resDupCtrl.status, 400);
    assert.deepEqual(resDupCtrl.body, { status: 'error', code: 'invalid_request' });

    const resDupBoth = await client.get(
      `${path}?terminalId=hkeagh01&terminalId=htrcph01&controlStatus=normal&controlStatus=training`,
    );
    assert.equal(resDupBoth.status, 400);
    assert.deepEqual(resDupBoth.body, { status: 'error', code: 'invalid_request' });

    // 未知端末
    const resUnknownTerm = await client.get(`${path}?terminalId=unknown99&controlStatus=normal`);
    assert.equal(resUnknownTerm.status, 404);
    assert.deepEqual(resUnknownTerm.body, { status: 'error', code: 'terminal_not_found' });

    // 正常指定
    const resOk = await client.get(`${path}?terminalId=hkeagh01&controlStatus=normal`);
    assert.equal(resOk.status, 200);
  }
});

// ---------------------------------------------------------------------------
// B3 controlStatus 分離（#36/#38）
// ---------------------------------------------------------------------------
test('B3 controlStatus 分離: #36/#38 で normal/training/test 領域が完全分離され、isTraining が整合する', async () => {
  const { db, app } = createTestApp();

  const statuses: ControlStatus[] = ['normal', 'training', 'test'];

  for (const cs of statuses) {
    saveAreaTimeseriesSnapshot(db.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      stationCode: '44132',
      stationName: '東京',
      metadata: {
        source: `https://example.com/timeseries-${cs}`,
        issuedAt: '2026-09-14T06:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T06:01:00.000Z',
        lastSuccessAt: '2026-09-14T06:01:00.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      telegram: {
        controlStatus: cs,
        infoType: '発表',
        eventId: `event-timeseries-${cs}`,
        reportDateTime: '2026-09-14T06:00:00.000Z',
        controlDateTime: '2026-09-14T06:00:00.000Z',
      },
      timeDefines: [
        {
          blockId: 'region-3hour',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-14T06:00:00.000Z',
          timeTo: '2026-09-14T09:00:00.000Z',
          duration: 'PT3H',
        },
      ],
      values: [
        {
          blockId: 'region-3hour',
          refId: '1',
          element: 'weather',
          valueCode: null,
          valueText: `天気-${cs}`,
          valueNumber: null,
          unit: null,
          sequence: 1,
        },
      ],
    });

    saveBosaiBulletin(db.connection, {
      eventId: `bulletin-${cs}`,
      controlStatus: cs,
      infoType: '発表',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
      title: `速報-${cs}`,
      headlineText: `見出し-${cs}`,
      informationTag: null,
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: `https://example.com/_VPBS50_${cs}.xml`,
        issuedAt: '2026-09-14T06:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T06:01:00.000Z',
        lastSuccessAt: '2026-09-14T06:01:00.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: '市町村等',
          sequence: 1,
          informationType: null,
        },
      ],
    });
  }

  const client = request(app);

  for (const cs of statuses) {
    // #36
    const res36 = await client.get(
      `/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=${cs}`,
    );
    assert.equal(res36.status, 200);
    assert.equal(res36.body.controlStatus, cs);
    assert.equal(res36.body.isTraining, cs === 'training');
    assert.equal(res36.body.data.values[0].valueText, `天気-${cs}`);

    // #38
    const res38 = await client.get(
      `/api/weather/bulletins?terminalId=hkeagh01&controlStatus=${cs}`,
    );
    assert.equal(res38.status, 200);
    assert.equal(res38.body.controlStatus, cs);
    assert.equal(res38.body.isTraining, cs === 'training');
    assert.equal(res38.body.bulletins.length, 1);
    assert.equal(res38.body.bulletins[0].eventId, `bulletin-${cs}`);
  }
});

// ---------------------------------------------------------------------------
// B3b #37 controlStatus 非対応（訓練・試験）
// ---------------------------------------------------------------------------
test('B3b #37 controlStatus 非対応: training/test 指定時は常に data: null / availability: unavailable / metadata全時刻等 null になり、DBを読まない', async () => {
  const { db, app } = createTestApp();

  // normal で観測値を保存
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 28.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const client = request(app);

  // normal 対照: 観測値が返る
  const resNormal = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resNormal.status, 200);
  assert.equal(resNormal.body.controlStatus, 'normal');
  assert.equal(resNormal.body.isTraining, false);
  assert.equal(resNormal.body.metadata.availability, 'available');
  assert.equal(resNormal.body.data?.observations[0]?.values?.temp, 28.0);

  // training: data: null, availability: unavailable, metadata時刻等 null
  const resTraining = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=training',
  );
  assert.equal(resTraining.status, 200);
  assert.equal(resTraining.body.controlStatus, 'training');
  assert.equal(resTraining.body.isTraining, true);
  assert.equal(resTraining.body.station.code, '44136');
  assert.equal(resTraining.body.station.name, '江戸川臨海');
  assert.equal(resTraining.body.data, null);
  assert.deepEqual(resTraining.body.metadata, {
    source: null,
    issuedAt: null,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'unavailable',
    sourceVersion: null,
  });
  assert.deepEqual(resTraining.body.capabilities.publicElements, [
    'temp',
    'humidity',
    'windDirection',
    'wind',
    'precipitation1h',
  ]);
  assert.deepEqual(resTraining.body.capabilities.unsupportedElements, []);

  // test: data: null, availability: unavailable, isTraining: false
  const resTest = await client.get('/api/weather/amedas?terminalId=hkeagh01&controlStatus=test');
  assert.equal(resTest.status, 200);
  assert.equal(resTest.body.controlStatus, 'test');
  assert.equal(resTest.body.isTraining, false);
  assert.equal(resTest.body.station.code, '44136');
  assert.equal(resTest.body.data, null);
  assert.equal(resTest.body.metadata.availability, 'unavailable');
  assert.equal(resTest.body.metadata.issuedAt, null);
});

// ---------------------------------------------------------------------------
// B4 未取得・正常空・保持値（#36/#37）
// ---------------------------------------------------------------------------
test('B4 未取得・正常空・保持値: snapshotなしは unavailable、明細0件は正常空、stale snapshot は保持値維持で stale', async () => {
  const { db, app } = createTestApp();
  const client = request(app);

  // 1. snapshot なし -> data: null, availability: unavailable, metadata全時刻 null
  const res36NoSnap = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res36NoSnap.status, 200);
  assert.equal(res36NoSnap.body.data, null);
  assert.equal(res36NoSnap.body.metadata.availability, 'unavailable');
  assert.equal(res36NoSnap.body.metadata.issuedAt, null);

  const res37NoSnap = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res37NoSnap.status, 200);
  assert.equal(res37NoSnap.body.data, null);
  assert.equal(res37NoSnap.body.metadata.availability, 'unavailable');
  assert.equal(res37NoSnap.body.metadata.issuedAt, null);

  // 2. 明細0件の snapshot -> data が存在して空配列
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries-empty',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-empty',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [],
    values: [],
  });

  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/amedas-empty',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [],
  });

  const res36Empty = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res36Empty.status, 200);
  assert.notEqual(res36Empty.body.data, null);
  assert.deepEqual(res36Empty.body.data.values, []);
  assert.deepEqual(res36Empty.body.data.timeDefines, []);
  assert.equal(res36Empty.body.metadata.availability, 'available');

  const res37Empty = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res37Empty.status, 200);
  assert.notEqual(res37Empty.body.data, null);
  assert.deepEqual(res37Empty.body.data.observations, []);
  assert.equal(res37Empty.body.data.latestObservedAt, null);
  assert.equal(res37Empty.body.metadata.availability, 'available');

  // 3. 保存 availability が stale の snapshot -> 保持値と出所時刻をそのまま返し stale
  // まず available で保持値を保存
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries-initial',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-initial',
      reportDateTime: '2026-09-14T05:00:00.000Z',
      controlDateTime: '2026-09-14T05:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T05:00:00.000Z',
        timeTo: '2026-09-14T08:00:00.000Z',
        duration: 'PT3H',
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: '曇り',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
    ],
  });

  // stale で更新（明細は再利用される）
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries-stale',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'stale',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-stale',
      reportDateTime: '2026-09-14T05:00:00.000Z',
      controlDateTime: '2026-09-14T05:00:00.000Z',
    },
    timeDefines: [],
    values: [],
  });

  // アメダスも同様に available で保存してから stale で更新
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/amedas-initial',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T05:00:00.000Z',
        element: 'temp',
        valueNumber: 22.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/amedas-stale',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'stale',
      sourceVersion: '1.0',
    },
    observations: [],
  });

  const res36Stale = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res36Stale.status, 200);
  assert.equal(res36Stale.body.metadata.availability, 'stale');
  assert.equal(res36Stale.body.metadata.issuedAt, '2026-09-14T05:00:00.000Z');
  assert.equal(res36Stale.body.data.values[0].valueText, '曇り');

  const res37Stale = await client.get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res37Stale.status, 200);
  assert.equal(res37Stale.body.metadata.availability, 'stale');
  assert.equal(res37Stale.body.metadata.issuedAt, '2026-09-14T05:00:00.000Z');
  assert.equal(res37Stale.body.data.observations[0].values.temp, 22.0);
});

// ---------------------------------------------------------------------------
// B5 #36 ブロック分離
// ---------------------------------------------------------------------------
test('B5 #36 ブロック分離: region-3hour と temperature-3hour が同じ timeId・開始時刻を持っても分離され、temperature-3hour は duration: null かつ timeFrom === timeTo', async () => {
  const { db, app } = createTestApp();

  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries-blocks',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-blocks',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T09:00:00.000Z',
        duration: 'PT3H',
      },
      {
        blockId: 'temperature-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T06:00:00.000Z',
        duration: null,
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: '雨',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
      {
        blockId: 'temperature-3hour',
        refId: '1',
        element: 'temperature',
        valueCode: null,
        valueText: '20',
        valueNumber: 20,
        unit: '度',
        sequence: 1,
      },
    ],
  });

  const client = request(app);
  const res = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);

  const timeDefines = res.body.data.timeDefines as AreaTimeseriesTimeDefine[];
  assert.equal(timeDefines.length, 2);

  const regionTd = timeDefines.find((td) => td.blockId === 'region-3hour');
  assert.ok(regionTd);
  assert.equal(regionTd.timeId, '1');
  assert.equal(regionTd.timeFrom, '2026-09-14T06:00:00.000Z');
  assert.equal(regionTd.timeTo, '2026-09-14T09:00:00.000Z');
  assert.equal(regionTd.duration, 'PT3H');

  const tempTd = timeDefines.find((td) => td.blockId === 'temperature-3hour');
  assert.ok(tempTd);
  assert.equal(tempTd.timeId, '1');
  assert.equal(tempTd.timeFrom, '2026-09-14T06:00:00.000Z');
  assert.equal(tempTd.timeTo, '2026-09-14T06:00:00.000Z');
  assert.equal(tempTd.duration, null);

  const values = res.body.data.values as AreaTimeseriesValue[];
  assert.equal(values.length, 2);
  const regionVal = values.find((v) => v.blockId === 'region-3hour');
  assert.ok(regionVal);
  assert.equal(regionVal.element, 'weather');
  assert.equal(regionVal.valueText, '雨');
  assert.equal(regionVal.refId, '1');

  const tempVal = values.find((v) => v.blockId === 'temperature-3hour');
  assert.ok(tempVal);
  assert.equal(tempVal.element, 'temperature');
  assert.equal(tempVal.valueNumber, 20);
  assert.equal(tempVal.refId, '1');
});

// ---------------------------------------------------------------------------
// B6 #36 値の完全一致
// ---------------------------------------------------------------------------
test('B6 #36 値の完全一致: weather, wind_direction, wind_speed_rank, temperature の各項目が完全一致し置換されない', async () => {
  const { db, app } = createTestApp();

  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries-exact',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-exact',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T09:00:00.000Z',
        duration: 'PT3H',
      },
      {
        blockId: 'temperature-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T06:00:00.000Z',
        duration: null,
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: 'くもり時々雨',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'wind_direction',
        valueCode: null,
        valueText: '北東',
        valueNumber: null,
        unit: '16方位',
        sequence: 2,
      },
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'wind_speed_rank',
        valueCode: '2',
        valueText: null,
        valueNumber: null,
        unit: null,
        sequence: 3,
      },
      {
        blockId: 'temperature-3hour',
        refId: '1',
        element: 'temperature',
        valueCode: null,
        valueText: '18',
        valueNumber: 18,
        unit: '度',
        sequence: 1,
      },
    ],
  });

  const client = request(app);
  const res = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);

  const values = res.body.data.values;
  assert.deepEqual(values, [
    {
      blockId: 'region-3hour',
      refId: '1',
      element: 'weather',
      valueCode: null,
      valueText: 'くもり時々雨',
      valueNumber: null,
      unit: null,
      sequence: 1,
    },
    {
      blockId: 'temperature-3hour',
      refId: '1',
      element: 'temperature',
      valueCode: null,
      valueText: '18',
      valueNumber: 18,
      unit: '度',
      sequence: 1,
    },
    {
      blockId: 'region-3hour',
      refId: '1',
      element: 'wind_direction',
      valueCode: null,
      valueText: '北東',
      valueNumber: null,
      unit: '16方位',
      sequence: 2,
    },
    {
      blockId: 'region-3hour',
      refId: '1',
      element: 'wind_speed_rank',
      valueCode: '2',
      valueText: null,
      valueNumber: null,
      unit: null,
      sequence: 3,
    },
  ]);
});

// ---------------------------------------------------------------------------
// B7 #36 capabilities
// ---------------------------------------------------------------------------
test('B7 #36 capabilities: data: null でも capabilities が返り、unsupportedFields に weatherCode 等が含まれる', async () => {
  const { app } = createTestApp();
  const client = request(app);

  const res = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data, null);
  assert.deepEqual(res.body.capabilities, {
    blockIds: ['region-3hour', 'temperature-3hour'],
    elements: ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'],
    unsupportedFields: ['weatherCode', 'windSpeedRange', 'windSpeedDescription'],
  });
  // DTO のどこにも weatherCode, windSpeedRange, windSpeedDescription が存在しない
  assert.equal('weatherCode' in res.body, false);
  assert.equal('windSpeedRange' in res.body, false);
  assert.equal('windSpeedDescription' in res.body, false);
});

// ---------------------------------------------------------------------------
// B8 #37 公開要素の限定
// ---------------------------------------------------------------------------
test('B8 #37 公開要素の限定: 公開5要素以外(maxTemp, minTemp, maxTempTime, sun1h, snow, pressure等)はDTOに現れず、quality_flag, is_estimated も存在しない', async () => {
  const { db, app } = createTestApp();

  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136-elements',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 24.1,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'maxTemp',
        valueNumber: 30.5,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'maxTempTime',
        valueNumber: null,
        valueText: '14:30',
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'sun1h',
        valueNumber: 0.8,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'snow',
        valueNumber: 0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'pressure',
        valueNumber: 1012.3,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const client = request(app);
  const res = await client.get('/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(res.status, 200);

  const obs = res.body.data.observations[0];
  assert.deepEqual(obs.values, {
    temp: 24.1,
  });
  assert.equal('maxTemp' in obs.values, false);
  assert.equal('maxTempTime' in obs.values, false);
  assert.equal('sun1h' in obs.values, false);
  assert.equal('snow' in obs.values, false);
  assert.equal('pressure' in obs.values, false);

  const jsonStr = JSON.stringify(res.body);
  assert.equal(jsonStr.includes('quality_flag'), false);
  assert.equal(jsonStr.includes('qualityFlag'), false);
  assert.equal(jsonStr.includes('is_estimated'), false);
  assert.equal(jsonStr.includes('isEstimated'), false);
});

// ---------------------------------------------------------------------------
// B9 #37 非対応要素と欠測の区別
// ---------------------------------------------------------------------------
test('B9 #37 非対応要素と欠測の区別: trc では humidity キーがなく unsupportedElements: [humidity]、east では unsupportedElements: []。欠測は value: null', async () => {
  const { db, app } = createTestApp();

  // east (44136, elems='11112010'): humidity は 1 で対応。temp は欠測 (null)
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: null, // 欠測
        valueText: null,
        qualityFlag: 5,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'humidity',
        valueNumber: 65,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  // trc (44166, elems='11110000'): humidity は 0 で非対応（保存行なし）
  saveAmedasSnapshot(db.connection, {
    stationCode: '44166',
    stationName: '羽田',
    metadata: {
      source: 'https://example.com/44166',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 26.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const client = request(app);

  // east
  const resEast = await client.get('/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(resEast.status, 200);
  assert.deepEqual(resEast.body.capabilities.unsupportedElements, []);
  assert.equal(resEast.body.data.observations[0].values.temp, null); // 欠測は null
  assert.equal(resEast.body.data.observations[0].values.humidity, 65);

  // trc
  const resTrc = await client.get('/api/weather/amedas?terminalId=htrcph01&controlStatus=normal');
  assert.equal(resTrc.status, 200);
  assert.deepEqual(resTrc.body.capabilities.unsupportedElements, ['humidity']);
  assert.equal('humidity' in resTrc.body.data.observations[0].values, false); // 非対応要素はキー自体が存在しない
  assert.equal(resTrc.body.data.observations[0].values.temp, 26.0);

  // 合成 elems 注入: 実在の会場コードや地点番号をハードコードした判定になっていないことの検証
  // elems='10110000' (桁0:temp=1, 桁1:precip1h=0, 桁2:windDir=1, 桁3:wind=1, 桁6:humidity=0)
  // 公開5要素のうち precipitation1h と humidity が非対応 -> unsupportedElements: ['humidity', 'precipitation1h']
  const syntheticTarget: AmedasTarget = {
    stationCode: '44136' as AmedasTarget['stationCode'],
    displayName: '合成地点',
    elements: '10110000',
  };

  const { db: dbSynth, app: appSynth } = createTestApp({
    resolveAmedasTarget: () => syntheticTarget,
  });

  saveAmedasSnapshot(dbSynth.connection, {
    stationCode: '44136',
    stationName: '合成地点',
    metadata: {
      source: 'https://example.com/synthetic',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 22.5,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const resSynth = await request(appSynth).get(
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resSynth.status, 200);
  assert.deepEqual(resSynth.body.capabilities.unsupportedElements, ['humidity', 'precipitation1h']);
  assert.equal('humidity' in resSynth.body.data.observations[0].values, false);
  assert.equal('precipitation1h' in resSynth.body.data.observations[0].values, false);
  assert.equal(resSynth.body.data.observations[0].values.temp, 22.5);
});

// ---------------------------------------------------------------------------
// #37 アメダス 複数観測時点
// ---------------------------------------------------------------------------
test('#37 複数観測時点: observations が observedAt 昇順で返り、latestObservedAt が最終要素と一致する', async () => {
  const { db, app } = createTestApp();

  // 3つの観測時点（05:00, 05:30, 06:00）を持つ snapshot を保存
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T05:00:00.000Z',
        element: 'temp',
        valueNumber: 20.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T05:00:00.000Z',
        element: 'precipitation1h',
        valueNumber: 0.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T05:30:00.000Z',
        element: 'temp',
        valueNumber: 21.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'temp',
        valueNumber: 22.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
      {
        observedAt: '2026-09-14T06:00:00.000Z',
        element: 'humidity',
        valueNumber: 60,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const client = request(app);
  const res = await client.get('/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(res.status, 200);

  const data = res.body.data;
  assert.ok(data);
  assert.equal(data.observations.length, 3);

  // observedAt 昇順の検証
  const timestamps = data.observations.map((o: { observedAt: string }) => o.observedAt);
  assert.deepEqual(timestamps, [
    '2026-09-14T05:00:00.000Z',
    '2026-09-14T05:30:00.000Z',
    '2026-09-14T06:00:00.000Z',
  ]);

  // latestObservedAt が最終要素と完全一致することの検証
  assert.equal(data.latestObservedAt, '2026-09-14T06:00:00.000Z');
  assert.equal(data.latestObservedAt, data.observations[data.observations.length - 1].observedAt);
});

// ---------------------------------------------------------------------------
// B10 #37 鮮度
// ---------------------------------------------------------------------------
test('B10 #37 鮮度: XMLフィードが unavailable でも #37 の鮮度は変わらず、過去の観測時刻でも available。対照として #36 は stale になる', async () => {
  // regular / extra ともに unavailable な polling status
  const unavailablePollingStatus: JmaXmlPollingStatus = {
    isRunning: true,
    initialFetch: { phase: 'completed', result: null },
    lastCycleResult: null,
    feedStatuses: {
      regular: {
        feedKind: 'regular',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 1,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: null,
        lastFailureAt: '2026-09-14T06:00:00.000Z',
      },
      extra: {
        feedKind: 'extra',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 1,
        lastAttemptAt: '2026-09-14T06:00:00.000Z',
        lastSuccessAt: null,
        lastFailureAt: '2026-09-14T06:00:00.000Z',
      },
      regular_l: {
        feedKind: 'regular_l',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      extra_l: {
        feedKind: 'extra_l',
        isWaiting: false,
        waitingReason: null,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
    },
    feedFreshness: {
      regular: { availability: 'unavailable', lastSuccessAt: null, staleAfterSeconds: 300 },
      extra: { availability: 'unavailable', lastSuccessAt: null, staleAfterSeconds: 300 },
    },
  };

  const { db, app } = createTestApp({
    pollingStatus: unavailablePollingStatus,
    nowIso: '2026-09-14T12:00:00.000Z', // 観測時刻よりずっと後
  });

  // #36 snapshot (2026-09-14T06:00:00.000Z)
  saveAreaTimeseriesSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    stationCode: '44132',
    stationName: '東京',
    metadata: {
      source: 'https://example.com/timeseries',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: 'event-36',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T15:00:00.000Z',
        duration: 'PT9H',
      },
    ],
    values: [],
  });

  // #37 snapshot (夜間停止相当で観測時刻が昔)
  saveAmedasSnapshot(db.connection, {
    stationCode: '44136',
    stationName: '江戸川臨海',
    metadata: {
      source: 'https://example.com/44136',
      issuedAt: '2026-09-14T03:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T03:01:00.000Z',
      lastSuccessAt: '2026-09-14T03:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    observations: [
      {
        observedAt: '2026-09-14T03:00:00.000Z',
        element: 'temp',
        valueNumber: 20.0,
        valueText: null,
        qualityFlag: 0,
        isEstimated: false,
      },
    ],
  });

  const client = request(app);

  // #37 は XML フィードの影響を受けず available のまま
  const res37 = await client.get('/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(res37.status, 200);
  assert.equal(res37.body.metadata.availability, 'available');

  // #36 は XML フィード unavailable により stale になる
  const res36 = await client.get(
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res36.status, 200);
  assert.equal(res36.body.metadata.availability, 'stale');
});

// ---------------------------------------------------------------------------
// B11 #38 統合配列と区別
// ---------------------------------------------------------------------------
test('B11 #38 統合配列と区別: VPBS50・VPHW50・VPHW51 が単一配列で reportDateTime 降順に返り、telegramType が source URL / eventId から解決される', async () => {
  const { db, app } = createTestApp();

  // 1. source URL から VPBS50
  saveBosaiBulletin(db.connection, {
    eventId: 'event-vpbs',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T04:00:00.000Z',
    controlDateTime: '2026-09-14T04:00:00.000Z',
    title: '気象情報',
    headlineText: '大雨情報',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914040000_0_VPBS50_130000.xml',
      issuedAt: '2026-09-14T04:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T04:01:00.000Z',
      lastSuccessAt: '2026-09-14T04:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 2. source URL から VPHW50
  saveBosaiBulletin(db.connection, {
    eventId: 'event-vphw50',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '竜巻注意情報',
    headlineText: '竜巻情報',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914060000_0_VPHW50_130000.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: '2026-09-14T07:00:00.000Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 3. source が解決不能で eventId が VPHW51:130010
  saveBosaiBulletin(db.connection, {
    eventId: 'VPHW51:130010',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T05:00:00.000Z',
    controlDateTime: '2026-09-14T05:00:00.000Z',
    title: '竜巻注意情報（目撃あり）',
    headlineText: '竜巻目撃情報',
    informationTag: null,
    hasSighting: true,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/unknown_url_format.xml',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: '2026-09-14T06:00:00.000Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 4. source も eventId も推測不能なもの -> telegramType: null (タイトルから推測しない)
  saveBosaiBulletin(db.connection, {
    eventId: 'custom-event-99',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T03:00:00.000Z',
    controlDateTime: '2026-09-14T03:00:00.000Z',
    title: '竜巻注意情報',
    headlineText: '不明電文',
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/custom.xml',
      issuedAt: '2026-09-14T03:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T03:01:00.000Z',
      lastSuccessAt: '2026-09-14T03:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const client = request(app);
  const res = await client.get('/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(res.status, 200);

  const bulletins = res.body.bulletins;
  assert.equal(bulletins.length, 4);

  // 降順: 06:00 (VPHW50) -> 05:00 (VPHW51) -> 04:00 (VPBS50) -> 03:00 (null)
  assert.equal(bulletins[0].eventId, 'event-vphw50');
  assert.equal(bulletins[0].telegramType, 'VPHW50');
  assert.equal(bulletins[0].reportDateTime, '2026-09-14T06:00:00.000Z');

  assert.equal(bulletins[1].eventId, 'VPHW51:130010');
  assert.equal(bulletins[1].telegramType, 'VPHW51');
  assert.equal(bulletins[1].reportDateTime, '2026-09-14T05:00:00.000Z');

  assert.equal(bulletins[2].eventId, 'event-vpbs');
  assert.equal(bulletins[2].telegramType, 'VPBS50');
  assert.equal(bulletins[2].reportDateTime, '2026-09-14T04:00:00.000Z');

  assert.equal(bulletins[3].eventId, 'custom-event-99');
  assert.equal(bulletins[3].telegramType, null);
  assert.equal(bulletins[3].reportDateTime, '2026-09-14T03:00:00.000Z');
});

// ---------------------------------------------------------------------------
// B12 #38 isDirect / matchedAreaCodes
// ---------------------------------------------------------------------------
test('B12 #38 isDirect / matchedAreaCodes: 会場市区町村等コード一致で isDirect: true、広域コード一致で isDirect: false / matchedAreaCodes 計算。DBに列追加なし', async () => {
  const { db, app } = createTestApp();

  // 1. 江東区 (1310800) + 東京地方 (130010) を含む速報
  saveBosaiBulletin(db.connection, {
    eventId: 'event-koto',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '江東区・東京地方速報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_1.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
      {
        areaCode: '130010',
        areaName: '東京地方',
        codeType: '二次細分区',
        sequence: 2,
        informationType: null,
      },
    ],
  });

  // 2. 東京地方 (130010) のみを含む速報 (広域)
  saveBosaiBulletin(db.connection, {
    eventId: 'event-tokyo-broad',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T05:00:00.000Z',
    controlDateTime: '2026-09-14T05:00:00.000Z',
    title: '東京地方広域速報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_2.xml',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        codeType: '二次細分区',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 3. 大田区 (1311100) のみを含む速報
  saveBosaiBulletin(db.connection, {
    eventId: 'event-ota',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T04:00:00.000Z',
    controlDateTime: '2026-09-14T04:00:00.000Z',
    title: '大田区速報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/_VPBS50_3.xml',
      issuedAt: '2026-09-14T04:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T04:01:00.000Z',
      lastSuccessAt: '2026-09-14T04:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1311100',
        areaName: '大田区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const client = request(app);

  // east (江東区 1310800, 東京地方 130010, 東京南部 130012)
  const resEast = await client.get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEast.status, 200);
  const eastBulletins = resEast.body.bulletins as BulletinDetail[];
  assert.equal(eastBulletins.length, 2); // event-koto, event-tokyo-broad (event-ota は含まれない)

  const eastB1 = eastBulletins.find((b) => b.eventId === 'event-koto');
  assert.ok(eastB1);
  assert.equal(eastB1.isDirect, true);
  assert.deepEqual(eastB1.matchedAreaCodes, ['1310800', '130010']);

  const eastB2 = eastBulletins.find((b) => b.eventId === 'event-tokyo-broad');
  assert.ok(eastB2);
  assert.equal(eastB2.isDirect, false);
  assert.deepEqual(eastB2.matchedAreaCodes, ['130010']);

  // trc (大田区 1311100, 東京地方 130010, 東京23区 130011)
  const resTrc = await client.get(
    '/api/weather/bulletins?terminalId=htrcph01&controlStatus=normal',
  );
  assert.equal(resTrc.status, 200);
  const trcBulletins = resTrc.body.bulletins as BulletinDetail[];
  assert.equal(trcBulletins.length, 3); // event-koto(130010含む), event-tokyo-broad(130010含む), event-ota(1311100含む)

  const trcB1 = trcBulletins.find((b) => b.eventId === 'event-koto');
  assert.ok(trcB1);
  assert.equal(trcB1.isDirect, false); // trc にとっては江東区は direct ではない
  assert.deepEqual(trcB1.matchedAreaCodes, ['130010']); // trc の includedAreaCodes と一致したのは 130010 だけ

  const trcBOta = trcBulletins.find((b) => b.eventId === 'event-ota');
  assert.ok(trcBOta);
  assert.equal(trcBOta.isDirect, true);
  assert.deepEqual(trcBOta.matchedAreaCodes, ['1311100']);

  // DB スキーマ確認: bosai_bulletin テーブルに is_direct や direct 等の列が追加されていないこと
  const columns = db.connection.prepare("PRAGMA table_info('bosai_bulletin')").all() as {
    name: string;
  }[];
  const columnNames = columns.map((c) => c.name);
  assert.equal(columnNames.includes('is_direct'), false);
  assert.equal(columnNames.includes('isDirect'), false);
  assert.equal(columnNames.includes('matched_area_codes'), false);
});

// ---------------------------------------------------------------------------
// B13 #38 目撃・並存・期限
// ---------------------------------------------------------------------------
test('B13 #38 目撃・並存・期限: VPHW51 の hasSighting boolean, VPHW50/VPBS50 の null, VPHW50/51 並存2行返却, validAt は保存値そのまま', async () => {
  const { db, app } = createTestApp();

  // 1. VPHW50 (hasSighting: null)
  saveBosaiBulletin(db.connection, {
    eventId: 'VPHW50:130010',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '竜巻注意情報（目撃なし判定不能）',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914060000_0_VPHW50_130000.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: '2026-09-14T07:10:00.000Z', // ValidDateTime
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 2. VPHW51 (同一細分区域 130010 に並存, hasSighting: true)
  saveBosaiBulletin(db.connection, {
    eventId: 'VPHW51:130010',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:05:00.000Z',
    controlDateTime: '2026-09-14T06:05:00.000Z',
    title: '竜巻注意情報（目撃あり）',
    headlineText: null,
    informationTag: null,
    hasSighting: true,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914060500_0_VPHW51_130000.xml',
      issuedAt: '2026-09-14T06:05:00.000Z',
      validAt: '2026-09-14T07:15:00.000Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:06:00.000Z',
      lastSuccessAt: '2026-09-14T06:06:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 3. VPBS50 (validAt: null, validTo: null)
  saveBosaiBulletin(db.connection, {
    eventId: 'event-vpbs50',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T05:00:00.000Z',
    controlDateTime: '2026-09-14T05:00:00.000Z',
    title: '気象情報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914050000_0_VPBS50_130000.xml',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 4. VPHW51 (目撃なし, hasSighting: false)
  saveBosaiBulletin(db.connection, {
    eventId: 'VPHW51:130010:no-sighting',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:10:00.000Z',
    controlDateTime: '2026-09-14T06:10:00.000Z',
    title: '竜巻注意情報（目撃なし）',
    headlineText: null,
    informationTag: null,
    hasSighting: false,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914061000_0_VPHW51_130000.xml',
      issuedAt: '2026-09-14T06:10:00.000Z',
      validAt: '2026-09-14T07:20:00.000Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:11:00.000Z',
      lastSuccessAt: '2026-09-14T06:11:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const client = request(app);
  const res = await client.get('/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal');
  assert.equal(res.status, 200);

  const bulletins = res.body.bulletins as BulletinDetail[];
  assert.equal(bulletins.length, 4); // 2行並存統合なし + 目撃なし追加で4件

  const b51 = bulletins.find((b) => b.eventId === 'VPHW51:130010');
  assert.ok(b51);
  assert.equal(b51.hasSighting, true);
  assert.equal(b51.metadata.validAt, '2026-09-14T07:15:00.000Z');

  const b51NoSighting = bulletins.find((b) => b.eventId === 'VPHW51:130010:no-sighting');
  assert.ok(b51NoSighting);
  assert.equal(b51NoSighting.hasSighting, false); // null ではなく明示的に false
  assert.equal(b51NoSighting.metadata.validAt, '2026-09-14T07:20:00.000Z');

  const b50 = bulletins.find((b) => b.eventId === 'VPHW50:130010');
  assert.ok(b50);
  assert.equal(b50.hasSighting, null); // false に丸められない
  assert.equal(b50.metadata.validAt, '2026-09-14T07:10:00.000Z');

  const vpbs = bulletins.find((b) => b.eventId === 'event-vpbs50');
  assert.ok(vpbs);
  assert.equal(vpbs.hasSighting, null);
  assert.equal(vpbs.metadata.validAt, null);
  assert.equal(vpbs.metadata.validTo, null);
});

// ---------------------------------------------------------------------------
// B14 #38 鮮度と正常空
// ---------------------------------------------------------------------------
test('B14 #38 鮮度と正常空: 0件は bulletins: [] かつ available。フィード片側 unavailable で stale、行 stale で stale、未対応構造失敗で stale', async () => {
  // 1. 0件正常空: availability は available (unavailable ではない)
  const { db, app } = createTestApp();
  const client = request(app);

  const resEmpty = await client.get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEmpty.status, 200);
  assert.deepEqual(resEmpty.body.bulletins, []);
  assert.equal(resEmpty.body.availability, 'available');

  // 2. 行が存在する状態でフィード片側 unavailable -> stale
  saveBosaiBulletin(db.connection, {
    eventId: 'event-1',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '速報1',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914060000_0_VPBS50_130000.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const stalePollingStatus: JmaXmlPollingStatus = {
    ...createAvailablePollingStatus(),
    feedFreshness: {
      regular: {
        availability: 'available',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        staleAfterSeconds: 300,
      },
      extra: { availability: 'unavailable', lastSuccessAt: null, staleAfterSeconds: 300 },
    },
  };

  const appStaleFeed = createApp({
    weatherApi: createWeatherApiService({
      connection: db.connection,
      getPollingStatus: () => stalePollingStatus,
      now: () => '2026-09-14T06:30:00.000Z',
    }),
  });

  const resStaleFeed = await request(appStaleFeed).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resStaleFeed.status, 200);
  assert.equal(resStaleFeed.body.availability, 'stale');

  // 3. 保存 availability が stale の行を1件混ぜると一覧全体も stale
  saveBosaiBulletin(db.connection, {
    eventId: 'event-stale-row',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T05:00:00.000Z',
    controlDateTime: '2026-09-14T05:00:00.000Z',
    title: '古い速報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914050000_0_VPBS50_130000.xml',
      issuedAt: '2026-09-14T05:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T05:01:00.000Z',
      lastSuccessAt: '2026-09-14T05:01:00.000Z',
      availability: 'stale',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  const resStaleRow = await client.get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resStaleRow.status, 200);
  assert.equal(resStaleRow.body.availability, 'stale');

  // 4. 解析失敗の検証
  // 新しい DB で正常 available な状態を作成
  const { db: db2, app: app2 } = createTestApp();
  saveBosaiBulletin(db2.connection, {
    eventId: 'event-vpbs-clean',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
    title: '正常速報',
    headlineText: null,
    informationTag: null,
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'https://example.com/20260914060000_0_VPBS50_130000.xml',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:01:00.000Z',
      lastSuccessAt: '2026-09-14T06:01:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '市町村等',
        sequence: 1,
        informationType: null,
      },
    ],
  });

  // 未対応構造の失敗を telegram_reception に投入 (VPBS50, 江東区 1310800, baseline 06:00 より新しい 06:10)
  recordTelegramReception(db2.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_VPBS50.xml',
    telegramType: 'VPBS50',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-event-1',
    serial: null,
    controlDateTime: '2026-09-14T06:10:00.000Z',
    reportDateTime: '2026-09-14T06:10:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T06:10:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'east',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T06:10:00.000Z',
      },
    ],
  });

  const resFailure = await request(app2).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resFailure.status, 200);
  assert.equal(resFailure.body.availability, 'stale');

  // 該当種別の行が0件のとき（例: VPHW50 の行が0件）は、古い VPHW50 の失敗があっても stale にならないことを確認
  const { db: db3, app: app3 } = createTestApp();
  recordTelegramReception(db3.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_VPHW50.xml',
    telegramType: 'VPHW50',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-vphw50',
    serial: null,
    controlDateTime: '2026-09-14T01:00:00.000Z',
    reportDateTime: '2026-09-14T01:00:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T01:00:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'east',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T01:00:00.000Z',
      },
    ],
  });

  const resNoTypeFailure = await request(app3).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resNoTypeFailure.status, 200);
  assert.equal(resNoTypeFailure.body.availability, 'available'); // VPHW50 の行がないため判定されず available

  // 5. 否定条件の検証: 別種別・別区域・別会場・過去時刻の解析失敗では availability が変化しない
  const createBaseBulletinDb = () => {
    const instance = createTestApp();
    saveBosaiBulletin(instance.db.connection, {
      eventId: 'event-base-vpbs',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
      title: '正常速報',
      headlineText: null,
      informationTag: null,
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: 'https://example.com/20260914060000_0_VPBS50_130000.xml',
        issuedAt: '2026-09-14T06:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T06:01:00.000Z',
        lastSuccessAt: '2026-09-14T06:01:00.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: '市町村等',
          sequence: 1,
          informationType: null,
        },
      ],
    });
    return instance;
  };

  // 否定条件(a): 別種別 (VPFD51) の未対応構造失敗 -> available
  const { db: dbDiffType, app: appDiffType } = createBaseBulletinDb();
  recordTelegramReception(dbDiffType.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_VPFD51.xml',
    telegramType: 'VPFD51',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-vpfd51',
    serial: null,
    controlDateTime: '2026-09-14T06:10:00.000Z',
    reportDateTime: '2026-09-14T06:10:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T06:10:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'east',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T06:10:00.000Z',
      },
    ],
  });
  const resDiffType = await request(appDiffType).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resDiffType.status, 200);
  assert.equal(resDiffType.body.availability, 'available');

  // 否定条件(b): 別区域 (新潟地方 150010) の未対応構造失敗 -> available
  const { db: dbDiffArea, app: appDiffArea } = createBaseBulletinDb();
  recordTelegramReception(dbDiffArea.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_diff_area.xml',
    telegramType: 'VPBS50',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-diff-area',
    serial: null,
    controlDateTime: '2026-09-14T06:10:00.000Z',
    reportDateTime: '2026-09-14T06:10:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T06:10:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '150010', areaName: '新潟地方', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'east',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T06:10:00.000Z',
      },
    ],
  });
  const resDiffArea = await request(appDiffArea).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resDiffArea.status, 200);
  assert.equal(resDiffArea.body.availability, 'available');

  // 否定条件(c): 別会場 (trc) の未対応構造失敗 (east端末からリクエスト) -> available
  const { db: dbDiffVenue, app: appDiffVenue } = createBaseBulletinDb();
  recordTelegramReception(dbDiffVenue.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_diff_venue.xml',
    telegramType: 'VPBS50',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-diff-venue',
    serial: null,
    controlDateTime: '2026-09-14T06:10:00.000Z',
    reportDateTime: '2026-09-14T06:10:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T06:10:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'trc',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T06:10:00.000Z',
      },
    ],
  });
  const resDiffVenue = await request(appDiffVenue).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resDiffVenue.status, 200);
  assert.equal(resDiffVenue.body.availability, 'available');

  // 否定条件(d): 過去時刻 (baseline 06:00 より前 05:00) の未対応構造失敗 -> available
  const { db: dbPast, app: appPast } = createBaseBulletinDb();
  recordTelegramReception(dbPast.connection, {
    fetchAttemptId: null,
    feedKind: null,
    feedEntryId: null,
    documentUrl: 'https://example.com/failed_past.xml',
    telegramType: 'VPBS50',
    title: null,
    controlStatus: 'normal',
    infoType: null,
    eventId: 'failed-past',
    serial: null,
    controlDateTime: '2026-09-14T05:00:00.000Z',
    reportDateTime: '2026-09-14T05:00:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-14T05:00:00.000Z',
    rawBody: null,
    bodyBytes: null,
    contentHash: null,
    areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    adoptions: [
      {
        venueId: 'east',
        adoptionResult: '未対応構造',
        adoptionReason: 'パース失敗',
        adoptionDecidedAt: '2026-09-14T05:00:00.000Z',
      },
    ],
  });
  const resPast = await request(appPast).get(
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resPast.status, 200);
  assert.equal(resPast.body.availability, 'available');
});

// ---------------------------------------------------------------------------
// B15 副作用なしと結線
// ---------------------------------------------------------------------------
test('B15 副作用なしと結線: GET 前後で行数・通知件数変化なし、Cache-Control: no-store、500エラーハンドリング、server.ts で全6本登録', async () => {
  const { db, app, weatherApi } = createTestApp();
  const client = request(app);

  // 1. GET 前後のテーブル行数
  const countTables = () => {
    const rows = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    let total = 0;
    for (const r of rows) {
      if (r.name.startsWith('sqlite_')) continue;
      const countRow = db.connection.prepare(`SELECT count(*) as c FROM ${r.name}`).get() as {
        c: number;
      };
      total += countRow.c;
    }
    return total;
  };

  const initialCount = countTables();

  const paths = [
    '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
    '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
    '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
  ];

  for (const p of paths) {
    const res = await client.get(p);
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
  }

  const afterCount = countTables();
  assert.equal(afterCount, initialCount);

  // 2. 内部例外を注入すると 500 weather_read_failed になり内部情報が漏れない
  const throwingApi = {
    ...weatherApi,
    getAreaTimeseries: () => {
      throw new Error('Secret SQL Error /var/app/db.sqlite');
    },
    getAmedas: () => {
      throw new Error('Secret Amedas Error');
    },
    getBulletins: () => {
      throw new Error('Secret Bulletin Error');
    },
  };

  const throwingApp = createApp({
    weatherApi: throwingApi as unknown as ReturnType<typeof createWeatherApiService>,
  });
  const throwingClient = request(throwingApp);

  for (const p of paths) {
    const res = await throwingClient.get(p);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { status: 'error', code: 'weather_read_failed' });
    assert.equal(res.text.includes('Secret'), false);
    assert.equal(res.text.includes('/var/app'), false);
  }

  // 3. startServer 経由で全6 GET が登録されていること
  const serverInstance = await startServer({
    port: 0,
    config: { databasePath: ':memory:', migrationsDirectory },
    enablePolling: false,
  });

  try {
    const serverPort = serverInstance.port;
    const checkEndpoints = [
      '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
      '/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal',
      '/api/weather/early-warning?terminalId=hkeagh01&controlStatus=normal',
      '/api/weather/area-timeseries?terminalId=hkeagh01&controlStatus=normal',
      '/api/weather/amedas?terminalId=hkeagh01&controlStatus=normal',
      '/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal',
    ];

    for (const ep of checkEndpoints) {
      const res = await fetch(`http://127.0.0.1:${serverPort}${ep}`);
      assert.equal(res.status, 200);
    }
  } finally {
    await serverInstance.close();
  }
});
