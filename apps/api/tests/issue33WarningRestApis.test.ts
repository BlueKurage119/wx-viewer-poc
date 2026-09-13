import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';

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
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

import type { ControlStatus, VenueId } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';
import { createWeatherApiService } from '../src/services/weatherApiService.js';
import { evaluateWeatherAvailability } from '../src/services/weatherAvailability.js';
import { hasNewerWeatherParseFailure } from '../src/repositories/weatherParseFailureRepository.js';
import { saveWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import {
  saveWarningTimeseriesSnapshot,
  findWarningTimeseriesSnapshot,
} from '../src/repositories/warningTimeseriesRepository.js';
import { saveEarlyWarningSnapshot } from '../src/repositories/earlyWarningRepository.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import { parseVpwp50 } from '../src/polling/jmaVpwp50Parser.js';
import type { JmaXmlPollingStatus } from '../src/polling/jmaXmlPollingService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const fixturesDir = join(apiRoot, 'tests/fixtures/jma');
const migrationsDirectory = join(apiRoot, 'migrations');

function createAvailablePollingStatus(): JmaXmlPollingStatus {
  return {
    isRunning: true,
    initialFetch: { phase: 'completed', result: null },
    lastCycleResult: null,
    feedStatuses: {
      regular: {
        isWaiting: false,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
      },
      extra: {
        isWaiting: false,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
      },
      long_term: {
        isWaiting: false,
        nextAllowedFetchAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
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
  });
  const app = createApp({ weatherApi });
  return { db, app, weatherApi, nowIso };
}

// ---------------------------------------------------------------------------
// A1: 各 GET に既知の east/trc の端末を指定。台帳の対象のみ返る。早期注意は共通広域。
// ---------------------------------------------------------------------------
test('A1: 会場別解決 - east (江東区), trc (大田区) のみ返り、他区域 sentinel は混ざらない。早期注意は共通広域', async () => {
  const { db, app } = createTestApp();

  // 江東区 (east: 1310800), 大田区 (trc: 1311100), 新潟市 (sentinel: 1510000)
  for (const [code, name] of [
    ['1310800', '江東区'],
    ['1311100', '大田区'],
    ['1510000', '新潟市'],
  ]) {
    saveWarningCurrentSnapshot(db.connection, {
      areaCode: code,
      areaName: name,
      metadata: {
        source: `https://example.com/${code}`,
        issuedAt: '2026-09-14T06:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T06:00:10.000Z',
        lastSuccessAt: '2026-09-14T06:00:10.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: '2026-09-14T06:00:00.000Z',
        controlDateTime: '2026-09-14T06:00:00.000Z',
      },
      items: [
        {
          sequence: 1,
          kindCode: '03',
          kindName: '大雨警報',
          kindStatus: '発表',
          lastKindCode: null,
          lastKindName: null,
          kindIssuedAt: '2026-09-14T06:00:00.000Z',
          sourceTelegram: 'VPWW53',
        },
      ],
    });

    saveWarningTimeseriesSnapshot(db.connection, {
      areaCode: code,
      areaName: name,
      metadata: {
        source: `https://example.com/ts/${code}`,
        issuedAt: '2026-09-14T06:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T06:00:10.000Z',
        lastSuccessAt: '2026-09-14T06:00:10.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: '2026-09-14T06:00:00.000Z',
        controlDateTime: '2026-09-14T06:00:00.000Z',
      },
      timeDefines: [
        {
          blockId: 'block-1',
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-14T06:00:00.000Z',
          timeTo: '2026-09-14T09:00:00.000Z',
          duration: 'PT3H',
        },
      ],
      values: [
        {
          blockId: 'block-1',
          refId: '1',
          kindCode: null,
          kindName: null,
          kindStatus: '発表',
          valueCategory: 'risk',
          propertyType: '大雨浸水危険度',
          valueType: '大雨浸水危険度',
          valueCode: '11',
          valueText: '注意',
          unit: null,
          areaDivision: null,
          sequence: 1,
        },
      ],
      additionsParsed: true,
      additions: [],
    });
  }

  // 早期注意: 東京地方 (130010: east/trc 共通), 新潟県 (150000: sentinel)
  for (const [code, name] of [
    ['130010', '東京地方'],
    ['150000', '新潟県'],
  ]) {
    for (const segment of ['near', 'far'] as const) {
      saveEarlyWarningSnapshot(db.connection, {
        areaCode: code,
        areaName: name,
        segment,
        telegramType: segment === 'near' ? 'VPFD61' : 'VPFW60',
        metadata: {
          source: `https://example.com/ew/${code}`,
          issuedAt: '2026-09-14T06:00:00.000Z',
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: '2026-09-14T06:00:10.000Z',
          lastSuccessAt: '2026-09-14T06:00:10.000Z',
          availability: 'available',
          sourceVersion: '1.0',
        },
        telegram: {
          controlStatus: 'normal',
          infoType: '発表',
          eventId: null,
          reportDateTime: '2026-09-14T06:00:00.000Z',
          controlDateTime: '2026-09-14T06:00:00.000Z',
        },
        timeDefines: [
          {
            timeId: '1',
            sequence: 1,
            timeFrom: '2026-09-14T06:00:00.000Z',
            timeTo: '2026-09-14T12:00:00.000Z',
            duration: 'PT6H',
          },
        ],
        cells: [
          {
            refId: '1',
            phenomenonCode: '03',
            phenomenonName: '大雨',
            rankValue: '中',
            condition: null,
          },
        ],
      });
    }
  }

  // east (hkeagh01) -> 江東区 (1310800)
  const resEastWarn = await request(app).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEastWarn.status, 200);
  assert.equal(resEastWarn.body.area.code, '1310800');
  assert.equal(resEastWarn.body.area.name, '江東区');

  const resEastTs = await request(app).get(
    '/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEastTs.status, 200);
  assert.equal(resEastTs.body.area.code, '1310800');

  // trc (htrcph01) -> 大田区 (1311100)
  const resTrcWarn = await request(app).get(
    '/api/weather/warnings?terminalId=htrcph01&controlStatus=normal',
  );
  assert.equal(resTrcWarn.status, 200);
  assert.equal(resTrcWarn.body.area.code, '1311100');
  assert.equal(resTrcWarn.body.area.name, '大田区');

  const resTrcTs = await request(app).get(
    '/api/weather/warning-timeseries?terminalId=htrcph01&controlStatus=normal',
  );
  assert.equal(resTrcTs.status, 200);
  assert.equal(resTrcTs.body.area.code, '1311100');

  // 早期注意: east/trc 双方とも共通広域 130010 (東京地方) を返す
  const resEastEw = await request(app).get(
    '/api/weather/early-warning?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEastEw.status, 200);
  assert.equal(resEastEw.body.near.area.code, '130010');
  assert.equal(resEastEw.body.far.area.code, '130010');

  const resTrcEw = await request(app).get(
    '/api/weather/early-warning?terminalId=htrcph01&controlStatus=normal',
  );
  assert.equal(resTrcEw.status, 200);
  assert.equal(resTrcEw.body.near.area.code, '130010');
  assert.equal(resTrcEw.body.far.area.code, '130010');

  db.close();
});

// ---------------------------------------------------------------------------
// A2: 入力バリデーション - 欠落・空・重複・未知キー・不正controlStatusは400、未知端末は404、正常は200
// ---------------------------------------------------------------------------
test('A2: 入力バリデーション - 3 API 共通の厳格な検証 (400, 404, 200)', async () => {
  const { db, app } = createTestApp();

  const endpoints = [
    '/api/weather/warnings',
    '/api/weather/warning-timeseries',
    '/api/weather/early-warning',
  ];

  for (const ep of endpoints) {
    // 正常指定 -> 200 (未取得データでも 200)
    const resOk = await request(app).get(`${ep}?terminalId=hkeagh01&controlStatus=normal`);
    assert.equal(resOk.status, 200);

    // terminalId 欠落 -> 400
    const resNoTerm = await request(app).get(`${ep}?controlStatus=normal`);
    assert.equal(resNoTerm.status, 400);
    assert.deepEqual(resNoTerm.body, { status: 'error', code: 'invalid_request' });

    // controlStatus 欠落 -> 400
    const resNoCtrl = await request(app).get(`${ep}?terminalId=hkeagh01`);
    assert.equal(resNoCtrl.status, 400);
    assert.deepEqual(resNoCtrl.body, { status: 'error', code: 'invalid_request' });

    // 空文字 -> 400
    const resEmptyTerm = await request(app).get(`${ep}?terminalId=&controlStatus=normal`);
    assert.equal(resEmptyTerm.status, 400);

    // 未知キー -> 400
    const resUnknownKey = await request(app).get(
      `${ep}?terminalId=hkeagh01&controlStatus=normal&extra=foo`,
    );
    assert.equal(resUnknownKey.status, 400);

    // venueId 上書き指定 -> 400
    const resVenueOverride = await request(app).get(
      `${ep}?terminalId=hkeagh01&controlStatus=normal&venueId=trc`,
    );
    assert.equal(resVenueOverride.status, 400);

    // 重複指定 (配列) -> 400
    const resDup = await request(app).get(
      `${ep}?terminalId=hkeagh01&terminalId=htrcph01&controlStatus=normal`,
    );
    assert.equal(resDup.status, 400);

    // 不正な controlStatus -> 400
    const resBadCtrl = await request(app).get(`${ep}?terminalId=hkeagh01&controlStatus=invalid`);
    assert.equal(resBadCtrl.status, 400);

    // 未知端末文字列 -> 404
    const resUnknownTerm = await request(app).get(
      `${ep}?terminalId=unknown99&controlStatus=normal`,
    );
    assert.equal(resUnknownTerm.status, 404);
    assert.deepEqual(resUnknownTerm.body, { status: 'error', code: 'terminal_not_found' });
  }

  db.close();
});

// ---------------------------------------------------------------------------
// A3: normal/training/test の分離とフォールバック禁止
// ---------------------------------------------------------------------------
test('A3: normal/training/test に異なる値を保存し指定領域のみ返る。フォールバック禁止。isTraining/controlStatus整合', async () => {
  const { db, app } = createTestApp();

  // normal のみ保存
  saveWarningCurrentSnapshot(db.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'https://example.com/normal',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:10.000Z',
      lastSuccessAt: '2026-09-14T06:00:10.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    items: [
      {
        sequence: 1,
        kindCode: '03',
        kindName: '大雨警報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        kindIssuedAt: '2026-09-14T06:00:00.000Z',
        sourceTelegram: 'VPWW53',
      },
    ],
  });

  // normal 指定 -> 取得成功
  const resNorm = await request(app).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resNorm.status, 200);
  assert.equal(resNorm.body.controlStatus, 'normal');
  assert.equal(resNorm.body.isTraining, false);
  assert.notEqual(resNorm.body.data, null);
  assert.equal(resNorm.body.data.items.length, 1);

  // training 指定 -> normal にフォールバックせず未取得 (data: null, unavailable)
  const resTrain = await request(app).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=training',
  );
  assert.equal(resTrain.status, 200);
  assert.equal(resTrain.body.controlStatus, 'training');
  assert.equal(resTrain.body.isTraining, true);
  assert.equal(resTrain.body.data, null);
  assert.equal(resTrain.body.metadata.availability, 'unavailable');

  // test 指定 -> normal にフォールバックせず未取得。isTraining は false
  const resTest = await request(app).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=test',
  );
  assert.equal(resTest.status, 200);
  assert.equal(resTest.body.controlStatus, 'test');
  assert.equal(resTest.body.isTraining, false);
  assert.equal(resTest.body.data, null);
  assert.equal(resTest.body.metadata.availability, 'unavailable');

  db.close();
});

// ---------------------------------------------------------------------------
// A4: snapshot なし、正常空、保持値あり障害時
// ---------------------------------------------------------------------------
test('A4: snapshot なしは data=null・unavailable・日時null。正常空は data 存在し空一覧。障害時はデータと出所時刻保持し stale', async () => {
  // 1. snapshot なし
  const { db: db1, app: app1 } = createTestApp();
  const resNone = await request(app1).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resNone.status, 200);
  assert.equal(resNone.body.data, null);
  assert.equal(resNone.body.metadata.availability, 'unavailable');
  assert.equal(resNone.body.metadata.source, null);
  assert.equal(resNone.body.metadata.issuedAt, null);
  assert.equal(resNone.body.metadata.fetchedAt, null);
  assert.equal(resNone.body.metadata.lastSuccessAt, null);
  assert.equal(resNone.body.area.code, '1310800');
  db1.close();

  // 2. 正常空一覧 (items: [])
  const { db: db2, app: app2 } = createTestApp();
  saveWarningCurrentSnapshot(db2.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'https://example.com/empty',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:10.000Z',
      lastSuccessAt: '2026-09-14T06:00:10.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    items: [],
  });
  const resEmpty = await request(app2).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resEmpty.status, 200);
  assert.notEqual(resEmpty.body.data, null);
  assert.deepEqual(resEmpty.body.data.items, []);
  assert.equal(resEmpty.body.metadata.availability, 'available');
  db2.close();

  // 3. 保持値ありでフィード障害時 -> 保持値と出所時刻を維持して stale
  const failStatus: JmaXmlPollingStatus = {
    ...createAvailablePollingStatus(),
    feedFreshness: {
      regular: { availability: 'stale', lastSuccessAt: null, staleAfterSeconds: 300 },
      extra: {
        availability: 'available',
        lastSuccessAt: '2026-09-14T06:00:00.000Z',
        staleAfterSeconds: 300,
      },
    },
  };
  const { db: db3, app: app3 } = createTestApp({ pollingStatus: failStatus });
  saveWarningCurrentSnapshot(db3.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'https://example.com/item1',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:10.000Z',
      lastSuccessAt: '2026-09-14T06:00:10.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    items: [
      {
        sequence: 1,
        kindCode: '03',
        kindName: '大雨警報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        kindIssuedAt: '2026-09-14T06:00:00.000Z',
        sourceTelegram: 'VPWW53',
      },
    ],
  });
  const resStale = await request(app3).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resStale.status, 200);
  assert.equal(resStale.body.metadata.availability, 'stale');
  assert.equal(resStale.body.metadata.source, 'https://example.com/item1');
  assert.equal(resStale.body.metadata.issuedAt, '2026-09-14T06:00:00.000Z');
  assert.notEqual(resStale.body.data, null);
  assert.equal(resStale.body.data.items.length, 1);
  db3.close();
});

// ---------------------------------------------------------------------------
// A5: #33 で未抽出補足・DB ID・raw XML が露出しない。capabilities に 04/18
// ---------------------------------------------------------------------------
test('A5: #33 の allowlist と capabilities（04, 18 未対応明示、内部IDや未抽出項目の排除）', async () => {
  const { db, app } = createTestApp();

  saveWarningCurrentSnapshot(db.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'https://example.com/warn',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:10.000Z',
      lastSuccessAt: '2026-09-14T06:00:10.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    items: [
      {
        sequence: 1,
        kindCode: '03',
        kindName: '大雨警報',
        kindStatus: '発表',
        lastKindCode: null,
        lastKindName: null,
        kindIssuedAt: '2026-09-14T06:00:00.000Z',
        sourceTelegram: 'VPWW53',
      },
    ],
  });

  const res = await request(app).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);

  // capabilities の検証
  assert.deepEqual(res.body.capabilities, {
    unsupportedKindCodes: ['04', '18'],
    supplementSource: 'warning-timeseries',
  });

  // item allowlist の検証
  const item = res.body.data.items[0];
  const allowedKeys = [
    'sequence',
    'kindCode',
    'kindName',
    'kindStatus',
    'lastKindCode',
    'lastKindName',
    'kindIssuedAt',
    'sourceTelegram',
  ];
  assert.deepEqual(Object.keys(item).sort(), allowedKeys.sort());
  assert.equal('id' in item, false);
  assert.equal('snapshotId' in item, false);
  assert.equal('significancyCode' in item, false);
  assert.equal('warningLevel' in item, false);
  assert.equal('attentionText' in item, false);
  assert.equal('rawXml' in res.body, false);

  db.close();
});

// ---------------------------------------------------------------------------
// A6: ユーザー指定 VPWP50 実電文の fixture 化と新潟市パース検証（雷の竜巻・ひょう、出現順、時間ref捏造なし）
// ---------------------------------------------------------------------------
test('A6: 公式 VPWP50 実電文 fixture で新潟市（1510000）の雷危険度付加事項（竜巻、ひょう）の出現順パースと API 提供', async () => {
  const fixturePath = join(fixturesDir, '20260913214231_0_VPWP50_150000.xml');
  const rawXml = readFileSync(fixturePath, 'utf8');

  const niigataTarget = {
    municipalCode: '1510000',
    displayName: '新潟市',
  };

  const expected = {
    telegramType: 'VPWP50' as const,
    controlStatus: 'normal' as const,
    reportDateTime: '2026-09-13T21:42:00.000Z',
    controlDateTime: '2026-09-13T21:42:30.000Z',
  };

  const parseResult = parseVpwp50(rawXml, expected, niigataTarget);
  assert.equal(parseResult.ok, true);
  if (!parseResult.ok) return;

  const { additions, values } = parseResult.value;

  // 雷危険度の付加事項を抽出
  const thunderAdditions = additions.filter((a) => a.propertyType === '雷危険度');
  assert.equal(thunderAdditions.length, 2);

  // 出現順: 「竜巻」が 0、 「ひょう」が 1
  assert.equal(thunderAdditions[0].text, '竜巻');
  assert.equal(thunderAdditions[0].additionIndex, 0);
  assert.equal(thunderAdditions[0].noteIndex, 0);
  assert.equal(thunderAdditions[0].areaDivision, null); // Base 直下
  assert.equal(thunderAdditions[0].scope.localIndex, null);

  assert.equal(thunderAdditions[1].text, 'ひょう');
  assert.equal(thunderAdditions[1].additionIndex, 0);
  assert.equal(thunderAdditions[1].noteIndex, 1);
  assert.equal(thunderAdditions[1].areaDivision, null);

  // 時間 ref が捏造されていない（TimeseriesAddition 型には timeId や refId は存在しない）
  assert.equal('timeId' in thunderAdditions[0], false);
  assert.equal('refId' in thunderAdditions[0], false);

  // values に scope が付与されている
  const thunderValues = values.filter((v) => v.propertyType === '雷危険度');
  assert.ok(thunderValues.length > 0);
  for (const val of thunderValues) {
    assert.notEqual(val.scope, null);
    assert.equal(val.scope?.partName, 'SignificancyPart');
  }
});

// ---------------------------------------------------------------------------
// A7: 合成 XML による scope 分離・Local の areaDivision 独立・重複 Note 保持
// ---------------------------------------------------------------------------
test('A7: 境界検証 - 同一 block 内の同名 Property、複数 Local、重複 Note の保持と scope 独立', () => {
  const syntheticXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control>
<DateTime>2026-09-14T00:00:00Z</DateTime>
<Status>通常</Status>
</Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
<ReportDateTime>2026-09-14T09:00:00+09:00</ReportDateTime>
<InfoType>発表</InfoType>
<InfoKind>気象警報・注意報時系列</InfoKind>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines>
<TimeDefine timeId="1"><DateTime>2026-09-14T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine>
</TimeDefines>
<Item>
<Kind>
<Status>発表</Status>
<Property>
<Type>風</Type>
<WindSpeedPart>
<Base>
<Local>
<AreaName>陸上</AreaName>
<jmx_eb:WindSpeed refID="1" type="最大風速" unit="m/s">10</jmx_eb:WindSpeed>
<Addition>
<Note>突風</Note>
<Note>突風</Note>
</Addition>
</Local>
<Local>
<AreaName>海上</AreaName>
<jmx_eb:WindSpeed refID="1" type="最大風速" unit="m/s">15</jmx_eb:WindSpeed>
</Local>
</Base>
</WindSpeedPart>
</Property>
</Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

  const expected = {
    telegramType: 'VPWP50' as const,
    controlStatus: 'normal' as const,
    reportDateTime: '2026-09-14T00:00:00.000Z',
    controlDateTime: '2026-09-14T00:00:00.000Z',
  };

  const result = parseVpwp50(syntheticXml, expected, {
    municipalCode: '1310800',
    displayName: '江東区',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { additions, values } = result.value;

  // 重複 Note 「突風」「突風」が保持される
  assert.equal(additions.length, 2);
  assert.equal(additions[0].text, '突風');
  assert.equal(additions[0].noteIndex, 0);
  assert.equal(additions[0].areaDivision, '陸上');
  assert.equal(additions[0].scope.localIndex, 0);

  assert.equal(additions[1].text, '突風');
  assert.equal(additions[1].noteIndex, 1);
  assert.equal(additions[1].areaDivision, '陸上');
  assert.equal(additions[1].scope.localIndex, 0);

  // 海上の value に陸上の AreaName が漏れない
  const landVal = values.find((v) => v.areaDivision === '陸上');
  const seaVal = values.find((v) => v.areaDivision === '海上');
  assert.ok(landVal);
  assert.ok(seaVal);
  assert.equal(landVal.scope?.localIndex, 0);
  assert.equal(seaVal.scope?.localIndex, 1);
});

// ---------------------------------------------------------------------------
// A8: 異なる名前空間の Addition の非採用、未対応 Note 構造の電文非採用と既存値保持
// ---------------------------------------------------------------------------
test('A8: 異なる名前空間の Addition は非採用。未対応 Note 構造は未対応構造となり既存値を保持', () => {
  // 1. 他名前空間の Addition はスキップされる
  const otherNsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><DateTime>2026-09-14T00:00:00Z</DateTime><Status>通常</Status></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
<ReportDateTime>2026-09-14T09:00:00+09:00</ReportDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/" xmlns:custom="http://example.com/custom">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-14T09:00:00+09:00</DateTime><Duration>PT3H</Duration></TimeDefine></TimeDefines>
<Item>
<Kind><Status>発表</Status><Property><Type>雨</Type><PrecipitationPart><Base>
<jmx_eb:Precipitation refID="1" type="１時間最大雨量" unit="mm">10</jmx_eb:Precipitation>
<custom:Addition><custom:Note>他名前空間</custom:Note></custom:Addition>
</Base></PrecipitationPart></Property></Kind>
<Area><Name>江東区</Name><Code>1310800</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;

  const expected = {
    telegramType: 'VPWP50' as const,
    controlStatus: 'normal' as const,
    reportDateTime: '2026-09-14T00:00:00.000Z',
    controlDateTime: '2026-09-14T00:00:00.000Z',
  };

  const resOther = parseVpwp50(otherNsXml, expected, {
    municipalCode: '1310800',
    displayName: '江東区',
  });
  assert.equal(resOther.ok, true);
  if (resOther.ok) {
    assert.equal(resOther.value.additions.length, 0); // 他名前空間は採用されない
  }

  // 2. 未対応 Note 構造 (属性付き Note)
  const invalidNoteXml = otherNsXml.replace(
    '<custom:Addition><custom:Note>他名前空間</custom:Note></custom:Addition>',
    '<Addition><Note refID="1">不正属性</Note></Addition>',
  );
  const resInvalid = parseVpwp50(invalidNoteXml, expected, {
    municipalCode: '1310800',
    displayName: '江東区',
  });
  assert.equal(resInvalid.ok, false);
  if (!resInvalid.ok) {
    assert.equal(resInvalid.disposition, '未対応構造');
  }
});

// ---------------------------------------------------------------------------
// A9: 単位、値なし condition、空 valueText、区域区分、危険度コード、duration の一致
// ---------------------------------------------------------------------------
test('A9: 単位・condition・空文字・区域区分・duration が保存値と DTO で一致し、同一 block のみに解決', async () => {
  const { db, app } = createTestApp();

  saveWarningTimeseriesSnapshot(db.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'https://example.com/ts',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:10.000Z',
      lastSuccessAt: '2026-09-14T06:00:10.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'block-1',
        timeId: 't1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T09:00:00.000Z',
        duration: 'PT3H',
      },
    ],
    values: [
      {
        blockId: 'block-1',
        refId: 't1',
        kindCode: null,
        kindName: null,
        kindStatus: '発表',
        valueCategory: 'quantity',
        propertyType: '乾燥',
        valueType: '実効湿度',
        valueCode: null,
        valueText: '',
        unit: '%',
        description: null,
        condition: '値なし',
        areaDivision: null,
        sequence: 1,
        scope: {
          kindIndex: 0,
          propertyIndex: 0,
          partName: 'HumidityPart',
          partIndex: 0,
          baseIndex: 0,
          localIndex: null,
        },
      },
    ],
    additionsParsed: true,
    additions: [],
  });

  const res = await request(app).get(
    '/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);

  const td = res.body.data.timeDefines[0];
  assert.equal(td.duration, 'PT3H');

  const val = res.body.data.values[0];
  assert.equal(val.unit, '%');
  assert.equal(val.condition, '値なし');
  assert.equal(val.valueText, '');
  assert.equal(val.blockId, 'block-1');
  assert.equal(val.refId, 't1');
  assert.equal(val.scope.partName, 'HumidityPart');

  db.close();
});

// ---------------------------------------------------------------------------
// A10: 旧スキーマからの migration、既存値維持、additions=null/scope=null、新規採用後
// ---------------------------------------------------------------------------
test('A10: 旧 schema からのマイグレーションで既存値維持 (additions=null, scope=null)、新規正常採用で配列へ移行、foreign_key_check 空', () => {
  const db = new Database(':memory:');

  // 0001〜0022 までの migration を適用
  const migrationsDir = join(apiRoot, 'migrations');
  const files = [
    '0001_create_warning_current.sql',
    '0002_create_warning_timeseries.sql',
    '0010_create_telegram_reception.sql',
    '0014_extend_warning_timeseries_for_vpwp50.sql',
    '0018_create_telegram_reception_adoption.sql',
  ];

  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec(sql);
  }

  // 旧スキーマにデータを保存
  db.prepare(
    `
    INSERT INTO warning_timeseries_snapshot (
      id, area_code, area_name, control_status, info_type, report_datetime, control_datetime,
      source, issued_at, fetched_at, availability
    ) VALUES (1, '1310800', '江東区', 'normal', '発表', '2026-09-14T06:00:00Z', '2026-09-14T06:00:00Z', 'src', '2026-09-14T06:00:00Z', '2026-09-14T06:00:00Z', 'available')
  `,
  ).run();

  db.prepare(
    `
    INSERT INTO warning_timeseries_time_define (
      id, snapshot_id, block_id, time_id, sequence, time_from, time_to
    ) VALUES (1, 1, 'b1', '1', 1, '2026-09-14T06:00:00Z', '2026-09-14T09:00:00Z')
  `,
  ).run();

  db.prepare(
    `
    INSERT INTO warning_timeseries_value (
      snapshot_id, block_id, ref_id, kind_code, kind_name, kind_status, value_category, property_type, value_type, value_text, sequence
    ) VALUES (1, 'b1', '1', '03', '大雨注意報', '発表', 'risk', '大雨', '大雨', '注意', 1)
  `,
  ).run();

  // 0023 migration を適用
  const mig0023 = readFileSync(
    join(migrationsDir, '0023_add_warning_timeseries_addition_and_scope.sql'),
    'utf8',
  );
  db.exec(mig0023);

  // foreign_key_check が空
  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(fkCheck.length, 0);

  // 旧データ取得: additions は null、scope は null
  const snapshot = findWarningTimeseriesSnapshot(db, '1310800', 'normal');
  assert.ok(snapshot);
  assert.equal(snapshot.additionsParsed, false);
  assert.equal(snapshot.additions, null);
  assert.equal(snapshot.values[0].scope, null);

  // 新規正常採用を保存 (additions なし -> additions: [])
  saveWarningTimeseriesSnapshot(db, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'src2',
      issuedAt: '2026-09-14T07:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T07:00:00.000Z',
      lastSuccessAt: '2026-09-14T07:00:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T07:00:00.000Z',
      controlDateTime: '2026-09-14T07:00:00.000Z',
    },
    timeDefines: [],
    values: [],
    additionsParsed: true,
    additions: [],
  });

  const updated = findWarningTimeseriesSnapshot(db, '1310800', 'normal');
  assert.ok(updated);
  assert.equal(updated.additionsParsed, true);
  assert.deepEqual(updated.additions, []);

  db.close();
});

// ---------------------------------------------------------------------------
// A11: トランザクションロールバック原子性・stale 保存時の全明細保持
// ---------------------------------------------------------------------------
test('A11: 保存途中の例外で rollback され不整合が混在しない。stale 保存では明細・Note・scope 全体を保持', () => {
  const { db } = createTestApp();

  // 初期スナップショットを正常保存
  saveWarningTimeseriesSnapshot(db.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'src',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:00.000Z',
      lastSuccessAt: '2026-09-14T06:00:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        blockId: 'b1',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T06:00:00.000Z',
        timeTo: '2026-09-14T09:00:00.000Z',
        duration: 'PT3H',
      },
    ],
    values: [
      {
        blockId: 'b1',
        refId: '1',
        kindCode: null,
        kindName: null,
        kindStatus: '発表',
        valueCategory: 'risk',
        propertyType: '大雨',
        valueType: '大雨',
        valueText: '注意',
        areaDivision: null,
        sequence: 1,
        scope: {
          kindIndex: 0,
          propertyIndex: 0,
          partName: 'SignificancyPart',
          partIndex: 0,
          baseIndex: 0,
          localIndex: null,
        },
      },
    ],
    additionsParsed: true,
    additions: [
      {
        blockId: 'b1',
        scope: {
          kindIndex: 0,
          propertyIndex: 0,
          partName: 'SignificancyPart',
          partIndex: 0,
          baseIndex: 0,
          localIndex: null,
        },
        propertyType: '大雨',
        kindStatus: '発表',
        kindDateTime: null,
        areaDivision: null,
        additionIndex: 0,
        noteIndex: 0,
        text: '補足Note',
      },
    ],
  });

  // 不正値による失敗注入
  assert.throws(() => {
    saveWarningTimeseriesSnapshot(db.connection, {
      areaCode: '1310800',
      areaName: '江東区',
      metadata: {
        source: 'src_bad',
        issuedAt: '2026-09-14T07:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-14T07:00:00.000Z',
        lastSuccessAt: '2026-09-14T07:00:00.000Z',
        availability: 'available',
        sourceVersion: '1.0',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: '2026-09-14T07:00:00.000Z',
        controlDateTime: '2026-09-14T07:00:00.000Z',
      },
      timeDefines: [
        {
          blockId: 'b1',
          timeId: '1',
          sequence: 1,
          timeFrom: 'invalid-date', // ここでバリデーション例外
          timeTo: '2026-09-14T09:00:00.000Z',
          duration: 'PT3H',
        },
      ],
      values: [],
    });
  });

  // ロールバックされて前の値が維持されている
  const snap1 = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
  assert.ok(snap1);
  assert.equal(snap1.metadata.source, 'src');
  assert.equal(snap1.values.length, 1);
  assert.equal(snap1.additions?.length, 1);

  // stale 保存 -> 明細・Note・scope 全体を保持
  saveWarningTimeseriesSnapshot(db.connection, {
    areaCode: '1310800',
    areaName: '江東区',
    metadata: {
      source: 'src',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:00.000Z',
      lastSuccessAt: '2026-09-14T06:00:00.000Z',
      availability: 'stale',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [],
    values: [],
  });

  const snapStale = findWarningTimeseriesSnapshot(db.connection, '1310800', 'normal');
  assert.ok(snapStale);
  assert.equal(snapStale.metadata.availability, 'stale');
  assert.equal(snapStale.values.length, 1);
  assert.equal(snapStale.values[0].scope?.partName, 'SignificancyPart');
  assert.equal(snapStale.additions?.length, 1);
  assert.equal(snapStale.additions?.[0].text, '補足Note');

  db.close();
});

// ---------------------------------------------------------------------------
// A12: 鮮度評価 - feed 失敗・300秒境界・再起動後未成功、現況の継続性
// ---------------------------------------------------------------------------
test('A12: feed 鮮度低下と境界（300秒直前はavailable、一致・超過はstale）。#33 は古い発表でも新着なしなら available', () => {
  const baseInput = {
    hasSnapshot: true,
    savedAvailability: 'available' as const,
    nowIso: '2026-09-14T06:05:00.000Z',
    hasParseFailure: false,
  };

  // 1. feed 失敗 (regular が stale)
  const avail1 = evaluateWeatherAvailability({
    ...baseInput,
    feedFreshness: { regular: 'stale', extra: 'available' },
  });
  assert.equal(avail1, 'stale');

  // 2. snapshot なしで feed 失敗 -> unavailable
  const avail2 = evaluateWeatherAvailability({
    ...baseInput,
    hasSnapshot: false,
    feedFreshness: { regular: 'stale', extra: 'available' },
  });
  assert.equal(avail2, 'unavailable');

  // 3. feed 正常時 -> available
  const avail3 = evaluateWeatherAvailability({
    ...baseInput,
    feedFreshness: { regular: 'available', extra: 'available' },
  });
  assert.equal(avail3, 'available');

  // 4. #33 は 300秒以上前の古い発表（例: 24時間前）でも新着なしで feed 正常なら available
  const availWarning = evaluateWeatherAvailability({
    hasSnapshot: true,
    savedAvailability: 'available',
    feedFreshness: { regular: 'available', extra: 'available' },
    nowIso: '2026-09-15T06:00:00.000Z',
    hasParseFailure: false,
    // #33 は maxTimeTo を渡さない
  });
  assert.equal(availWarning, 'available');
});

// ---------------------------------------------------------------------------
// A13: #34/#35 timeTo 期限切れ判定、near/far 独立性
// ---------------------------------------------------------------------------
test('A13: #34/#35 timeTo 判定（直前 available、一致・経過後は stale）。near 期限切れ/far 有効、near 未取得/far 有効の独立性', () => {
  // 最後の timeTo が 12:00:00.000Z
  const maxTimeTo = '2026-09-14T12:00:00.000Z';

  // 直前 (11:59:59.999Z) -> available
  assert.equal(
    evaluateWeatherAvailability({
      hasSnapshot: true,
      savedAvailability: 'available',
      feedFreshness: { regular: 'available', extra: 'available' },
      maxTimeTo,
      nowIso: '2026-09-14T11:59:59.999Z',
      hasParseFailure: false,
    }),
    'available',
  );

  // 一致 (12:00:00.000Z) -> stale
  assert.equal(
    evaluateWeatherAvailability({
      hasSnapshot: true,
      savedAvailability: 'available',
      feedFreshness: { regular: 'available', extra: 'available' },
      maxTimeTo,
      nowIso: '2026-09-14T12:00:00.000Z',
      hasParseFailure: false,
    }),
    'stale',
  );

  // 経過後 (12:00:00.001Z) -> stale
  assert.equal(
    evaluateWeatherAvailability({
      hasSnapshot: true,
      savedAvailability: 'available',
      feedFreshness: { regular: 'available', extra: 'available' },
      maxTimeTo,
      nowIso: '2026-09-14T12:00:00.001Z',
      hasParseFailure: false,
    }),
    'stale',
  );

  // near 期限切れ / far 有効の独立性
  const nearAvail = evaluateWeatherAvailability({
    hasSnapshot: true,
    savedAvailability: 'available',
    feedFreshness: { regular: 'available', extra: 'available' },
    maxTimeTo: '2026-09-14T12:00:00.000Z',
    nowIso: '2026-09-14T13:00:00.000Z',
    hasParseFailure: false,
  });
  const farAvail = evaluateWeatherAvailability({
    hasSnapshot: true,
    savedAvailability: 'available',
    feedFreshness: { regular: 'available', extra: 'available' },
    maxTimeTo: '2026-09-15T00:00:00.000Z',
    nowIso: '2026-09-14T13:00:00.000Z',
    hasParseFailure: false,
  });
  assert.equal(nearAvail, 'stale');
  assert.equal(farAvail, 'available');
});

// ---------------------------------------------------------------------------
// A14: #35 の明後日 JST 境界・null rank・condition の維持
// ---------------------------------------------------------------------------
test('A14: #35 早期注意 - timeFrom/timeTo と near/far 区分が不変。null rank と condition が維持される', async () => {
  const { db, app } = createTestApp();

  saveEarlyWarningSnapshot(db.connection, {
    areaCode: '130010',
    areaName: '東京地方',
    segment: 'near',
    telegramType: 'VPFD61',
    metadata: {
      source: 'src_near',
      issuedAt: '2026-09-14T06:00:00.000Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-14T06:00:00.000Z',
      lastSuccessAt: '2026-09-14T06:00:00.000Z',
      availability: 'available',
      sourceVersion: '1.0',
    },
    telegram: {
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      reportDateTime: '2026-09-14T06:00:00.000Z',
      controlDateTime: '2026-09-14T06:00:00.000Z',
    },
    timeDefines: [
      {
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-14T15:00:00.000Z',
        timeTo: '2026-09-15T15:00:00.000Z',
        duration: 'P1D',
      },
    ],
    cells: [
      {
        refId: '1',
        phenomenonCode: '03',
        phenomenonName: '大雨',
        rankValue: null, // null rank
        condition: '可能性なし',
      },
      {
        refId: '1',
        phenomenonCode: '04',
        phenomenonName: '暴風',
        rankValue: '高',
        condition: null,
      },
    ],
  });

  const res = await request(app).get(
    '/api/weather/early-warning?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(res.status, 200);

  const near = res.body.near;
  assert.equal(near.data.segment, 'near');
  assert.equal(near.data.timeDefines[0].timeFrom, '2026-09-14T15:00:00.000Z');
  assert.equal(near.data.timeDefines[0].timeTo, '2026-09-15T15:00:00.000Z');

  // null rank と condition の維持（ゼロや「低」に補完しない）
  assert.equal(near.data.cells[0].rankValue, null);
  assert.equal(near.data.cells[0].condition, '可能性なし');
  assert.equal(near.data.cells[1].rankValue, '高');
  assert.equal(near.data.cells[1].condition, null);

  db.close();
});

// ---------------------------------------------------------------------------
// A15: GET の副作用なし・安全な 500・server 結線
// ---------------------------------------------------------------------------
test('A15: GET 前後で DB 件数不変、安全な 500、startServer での結線確認', async () => {
  const { db, app } = createTestApp();

  const countQuery = 'SELECT COUNT(*) as count FROM warning_current_snapshot';
  const beforeCount = (db.connection.prepare(countQuery).get() as { count: number }).count;

  await request(app).get('/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal');
  await request(app).get(
    '/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal',
  );
  await request(app).get('/api/weather/early-warning?terminalId=hkeagh01&controlStatus=normal');

  const afterCount = (db.connection.prepare(countQuery).get() as { count: number }).count;
  assert.equal(afterCount, beforeCount);

  // 内部障害時の 500 ハンドリング（内部例外やSQLを出さない）
  const brokenApp = createApp({
    weatherApi: {
      getWarnings() {
        throw new Error('Database disk image is malformed');
      },
      getWarningTimeseries() {
        throw new Error('Database disk image is malformed');
      },
      getEarlyWarning() {
        throw new Error('Database disk image is malformed');
      },
    },
  });

  const resErr = await request(brokenApp).get(
    '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  );
  assert.equal(resErr.status, 500);
  assert.deepEqual(resErr.body, { status: 'error', code: 'weather_read_failed' });
  assert.equal(JSON.stringify(resErr.body).includes('disk image'), false);

  db.close();

  // startServer での 3 GET 結線確認
  const started = await startServer({
    port: 0,
    enablePolling: false,
  });

  try {
    const resWarn = await fetch(
      `http://localhost:${started.port}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`,
    );
    assert.equal(resWarn.status, 200);

    const resTs = await fetch(
      `http://localhost:${started.port}/api/weather/warning-timeseries?terminalId=hkeagh01&controlStatus=normal`,
    );
    assert.equal(resTs.status, 200);

    const resEw = await fetch(
      `http://localhost:${started.port}/api/weather/early-warning?terminalId=hkeagh01&controlStatus=normal`,
    );
    assert.equal(resEw.status, 200);
  } finally {
    await started.close();
  }
});

// ---------------------------------------------------------------------------
// A17: 未対応構造失敗による stale 評価・ミリ秒境界・条件独立性・正常採用での回復
// ---------------------------------------------------------------------------
test('A17: hasNewerWeatherParseFailure - 時刻比較（.000Z vs Z 等値、.001Z 新規、.999Z 過去）、種別・会場・区域条件独立性と回復', () => {
  const { db } = createTestApp();

  const baseline = {
    reportDateTime: '2026-09-14T06:00:00.000Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
  };

  // 失敗レコードを挿入するヘルパー
  function insertFailure(options: {
    telegramType: string;
    controlStatus: ControlStatus;
    venueId: VenueId;
    areaCode: string;
    reportDateTime: string;
    controlDateTime: string;
    adoptionResult?: string;
  }) {
    const rec = recordTelegramReception(db.connection, {
      fetchAttemptId: null,
      feedKind: null,
      feedEntryId: null,
      documentUrl: `https://example.com/fail/${Math.random()}`,
      telegramType: options.telegramType,
      title: null,
      controlStatus: options.controlStatus,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: options.controlDateTime,
      reportDateTime: options.reportDateTime,
      targetDateTime: null,
      receivedAt: '2026-09-14T06:00:00.000Z',
      rawBody: null,
      bodyBytes: null,
      contentHash: null,
      areas: [{ areaCode: options.areaCode, sequence: 1 }],
      adoptions: [
        {
          venueId: options.venueId,
          adoptionResult: options.adoptionResult ?? '未対応構造',
          adoptionDecidedAt: '2026-09-14T06:00:00.000Z',
        },
      ],
    });
    return rec.id;
  }

  // 1. 同時刻（.000Z と Z は等値） -> 新しい失敗と断定しない (false)
  insertFailure({
    telegramType: 'VPWP50',
    controlStatus: 'normal',
    venueId: 'east',
    areaCode: '1310800',
    reportDateTime: '2026-09-14T06:00:00Z',
    controlDateTime: '2026-09-14T06:00:00Z',
  });
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline,
    }),
    false,
  );

  // 2. 過去時刻 (.999Z) -> 新しい失敗ではない (false)
  insertFailure({
    telegramType: 'VPWP50',
    controlStatus: 'normal',
    venueId: 'east',
    areaCode: '1310800',
    reportDateTime: '2026-09-14T05:59:59.999Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
  });
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline,
    }),
    false,
  );

  // 3. より新しい時刻 (.001Z) -> 新しい失敗 (true)
  insertFailure({
    telegramType: 'VPWP50',
    controlStatus: 'normal',
    venueId: 'east',
    areaCode: '1310800',
    reportDateTime: '2026-09-14T06:00:00.001Z',
    controlDateTime: '2026-09-14T06:00:00.000Z',
  });
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline,
    }),
    true,
  );

  // 条件の独立性:
  // 別会場 (trc) では false
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'trc',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline,
    }),
    false,
  );

  // 別領域 (training) では false
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'training',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline,
    }),
    false,
  );

  // 別区域 (1311100) では false
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1311100',
      baseline,
    }),
    false,
  );

  // 別種別 (VPFD61) では false
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPFD61',
      areaCode: '1310800',
      baseline,
    }),
    false,
  );

  // 回復: baseline を失敗時刻以上 ('2026-09-14T06:00:00.001Z') に更新すると false に回復
  assert.equal(
    hasNewerWeatherParseFailure(db.connection, {
      venueId: 'east',
      controlStatus: 'normal',
      telegramType: 'VPWP50',
      areaCode: '1310800',
      baseline: {
        reportDateTime: '2026-09-14T06:00:00.001Z',
        controlDateTime: '2026-09-14T06:00:00.000Z',
      },
    }),
    false,
  );

  db.close();
});
