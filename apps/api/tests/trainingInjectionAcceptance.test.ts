import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import {
  TRAINING_INJECT_MAX_TELEGRAMS,
  TRAINING_INJECT_MAX_XML_BYTES,
  type TrainingInjectRequest,
} from '@wx-viewer-poc/shared';
import { createApp } from '../src/app.js';
import type { DatabaseConnection } from '../src/database/index.js';
import { ingestTelegramDocument } from '../src/polling/jmaXmlPoller.js';
import { findWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import { findWarningCurrentStream } from '../src/repositories/warningCurrentStreamRepository.js';
import {
  findTrainingInjection,
  listTrainingInjectionReceptions,
} from '../src/repositories/trainingInjectionRepository.js';
import { createTrainingInjectionService } from '../src/services/trainingInjectionService.js';
import type {
  TrainingInjectionCommand,
  TrainingInjectionPort,
} from '../src/training/trainingInjectionContracts.js';
import { injectTrainingTelegrams } from '../src/training/trainingInjector.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { generateTrainingWarningBaseline } from '../src/training/trainingWarningBaseline.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { testTerminalRegistry, testVenueRegistry } from './helpers/venueConfigPreload.js';

const K_EAST = 'kkeagh01';
const NOW = '2026-10-12T10:00:00.000Z';
const FIXED_CLOCK = () => '2026-10-12T10:00:00.000Z' as const;

const GEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GEN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GEN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GEN_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FAIL_ID = 'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0';
const BASELINE_FAIL_ID = 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1';

function setupDb() {
  return initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
}

function count(connection: DatabaseConnection, table: string): number {
  return (connection.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

/** 注入関連の4表の行数。 */
function countsOf(connection: DatabaseConnection) {
  return {
    telegram_reception: count(connection, 'telegram_reception'),
    fetch_attempt: count(connection, 'fetch_attempt'),
    training_injection: count(connection, 'training_injection'),
    training_injection_reception: count(connection, 'training_injection_reception'),
  };
}

function generate(itemId: string, now: string, generationId: string) {
  const telegram = generateTrainingTelegrams([itemId as never], { now, generationId })[0]!;
  return {
    telegram,
    previewId: `${generationId}:0`,
    generatedAt: now,
    request: {
      previewId: `${generationId}:0`,
      generatedAt: now,
      itemIds: telegram.itemIds,
      telegramType: telegram.telegramType,
      xml: telegram.xml,
    },
  };
}

function toCommandTelegram(g: ReturnType<typeof generate>, order: number) {
  return {
    order,
    previewId: g.previewId,
    reportDateTime: g.telegram.reportDateTime,
    telegramType: g.telegram.telegramType,
    xml: g.telegram.xml,
  };
}

type Caller = (
  method: string,
  path: string,
  body?: string,
) => Promise<{ status: number; cacheControl: string | null; json: any; raw: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function withApp<T>(
  port: TrainingInjectionPort,
  idFactory: (() => string) | undefined,
  run: (call: Caller) => Promise<T>,
): Promise<T> {
  const service = createTrainingInjectionService({
    terminalRegistry: testTerminalRegistry,
    port,
    now: () => NOW,
    idFactory,
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = createApp({ trainingInjection: service }).listen(0, '127.0.0.1', () =>
      resolve(listening),
    );
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  const call: Caller = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body,
    });
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // JSON でない応答
    }
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      json,
      raw,
    } as Awaited<ReturnType<Caller>>;
  };
  try {
    return await run(call);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/** 検証を通過して呼ばれたことだけを記録し、未準備(503)を返すポート。 */
const reachedPort = { calls: 0 };
const noopPort: TrainingInjectionPort = {
  inject: async () => {
    reachedPort.calls += 1;
    throw new Error('not_ready');
  },
};

// ---------------------------------------------------------------------------
// 2. 422 の後に DB の行が1行も増えない／2日前の generatedAt は投入される
// ---------------------------------------------------------------------------

test('422: 正しい電文を同梱しても、受信・取得記録・注入記録が1行も増えず、ポートも呼ばれない', async () => {
  const db = setupDb();
  try {
    let portCalls = 0;
    const port: TrainingInjectionPort = {
      inject: async (command) => {
        portCalls += 1;
        return injectTrainingTelegrams(db.weather.connection, command, {
          venueRegistry: testVenueRegistry,
          clock: FIXED_CLOCK,
        });
      },
    };
    const good = generate('warning-03', '2026-10-12T09:00:00.000Z', GEN_A);
    const badXml = generate('warning-14', '2026-10-12T09:00:00.000Z', GEN_B);
    const badItem = generate('warning-14', '2026-10-12T09:00:00.000Z', GEN_C);
    // 秒境界（.999Z）で1ms変えると Control/DateTime（秒精度）が変わり、再生成XMLと不一致になる
    const edgeMs = Date.parse('2026-10-12T09:00:00.999Z');
    const badTime = generate('warning-03', new Date(edgeMs).toISOString(), GEN_D);

    const before = countsOf(db.weather.connection);
    await withApp(port, undefined, async (call) => {
      const body: TrainingInjectRequest = {
        terminalId: K_EAST,
        telegrams: [
          good.request,
          // Headline 本文を1文字変えたもの
          {
            ...badXml.request,
            xml: badXml.request.xml.replace(
              '＊＊＊これは訓練です＊＊＊',
              '＊＊＊これは訓練です＊＊',
            ),
          },
          // itemIds を別項目に変えたもの
          { ...badItem.request, itemIds: ['warning-03'] },
          // generatedAt を1ms変えたもの
          { ...badTime.request, generatedAt: new Date(edgeMs + 1).toISOString() },
        ],
      };
      const response = await call('POST', '/api/training/inject', JSON.stringify(body));
      assert.equal(response.status, 422);
      assert.equal(response.cacheControl, 'no-store');
      assert.equal(response.json.code, 'training_verification_failed');
      assert.deepEqual(
        [...(response.json.failures as { previewId: string }[])].sort((a, b) =>
          a.previewId.localeCompare(b.previewId),
        ),
        [
          { previewId: badXml.previewId, reason: 'regeneration_mismatch' },
          { previewId: badItem.previewId, reason: 'regeneration_mismatch' },
          { previewId: badTime.previewId, reason: 'regeneration_mismatch' },
        ].sort((a, b) => a.previewId.localeCompare(b.previewId)),
      );
    });
    assert.equal(portCalls, 0);
    assert.deepEqual(countsOf(db.weather.connection), before);
    assert.deepEqual(before, {
      telegram_reception: 0,
      fetch_attempt: 0,
      training_injection: 0,
      training_injection_reception: 0,
    });
  } finally {
    db.close();
  }
});

test('2日前の generatedAt で生成した電文も 422 にならず投入され、受信の時刻がXMLの値と一致する', async () => {
  const db = setupDb();
  try {
    const port: TrainingInjectionPort = {
      inject: (command) =>
        injectTrainingTelegrams(db.weather.connection, command, {
          venueRegistry: testVenueRegistry,
          clock: FIXED_CLOCK,
        }),
    };
    // 現在 NOW(2026-10-12T10:00Z) の 2 日前
    const old = generate('bulletin-tornado', '2026-10-10T10:00:00.000Z', GEN_A);
    const xml = old.request.xml;
    // XML の時刻を、生成関数とは別に正規表現で取り出す
    const reportJst = /<ReportDateTime>([^<]+)<\/ReportDateTime>/.exec(xml)![1]!;
    const controlUtc = /<Control>[\s\S]*?<DateTime>([^<]+)<\/DateTime>/.exec(xml)![1]!;
    assert.equal(reportJst, '2026-10-10T19:00:00+09:00');
    assert.equal(controlUtc, '2026-10-10T10:00:00Z');

    await withApp(port, undefined, async (call) => {
      const response = await call(
        'POST',
        '/api/training/inject',
        JSON.stringify({ terminalId: K_EAST, telegrams: [old.request] }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.json.telegrams.length, 1);
      assert.ok(response.json.telegrams[0].adoptions.length > 0);
    });
    const row = db.weather.connection
      .prepare('SELECT report_datetime AS r, control_datetime AS c FROM telegram_reception')
      .get() as { r: string; c: string };
    assert.equal(Date.parse(row.r), Date.parse(reportJst));
    assert.equal(Date.parse(row.c), Date.parse(controlUtc));
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. 途中の電文で例外 → failed・error_code、それ以前の受信は残る
// ---------------------------------------------------------------------------

test('途中の電文で例外: 記録は failed・error_code 付き、以前の受信は残り、HTTP は 500', async () => {
  const db = setupDb();
  try {
    const first = generate('bulletin-tornado', '2026-10-12T09:00:00.000Z', GEN_A);
    const second = generate('bulletin-record-rain', '2026-10-12T09:01:00.000Z', GEN_B);
    // clock の呼出し: 1=acceptedAt, 2=1通目の受信時刻, 3=2通目の受信時刻（ここで例外）, 4以降=失敗記録
    let calls = 0;
    const clock = () => {
      calls += 1;
      if (calls === 3) throw new Error('clock exploded');
      return NOW as `${number}-${number}-${number}T${string}Z`;
    };
    const port: TrainingInjectionPort = {
      inject: (command) =>
        injectTrainingTelegrams(db.weather.connection, command, {
          venueRegistry: testVenueRegistry,
          clock,
        }),
    };
    await withApp(
      port,
      () => FAIL_ID,
      async (call) => {
        const response = await call(
          'POST',
          '/api/training/inject',
          JSON.stringify({ terminalId: K_EAST, telegrams: [first.request, second.request] }),
        );
        assert.equal(response.status, 500);
        assert.equal(response.cacheControl, 'no-store');
        assert.deepEqual(response.json, {
          status: 'error',
          code: 'training_injection_failed',
          trainingId: FAIL_ID,
        });
      },
    );
    const record = findTrainingInjection(db.weather.connection, FAIL_ID);
    assert.equal(record?.status, 'failed');
    assert.equal(record?.errorCode, 'clock exploded');
    assert.equal(record?.telegramCount, 2);
    // 1通目の受信と対応行は残り、2通目は無い
    assert.equal(count(db.weather.connection, 'telegram_reception'), 1);
    const receptions = listTrainingInjectionReceptions(db.weather.connection, FAIL_ID);
    assert.deepEqual(
      receptions.map((r) => [r.sequence, r.role, r.previewId, r.telegramType]),
      [[0, 'requested', first.previewId, 'VPHW50']],
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4. 発表時刻の異なる複数警報 → 基準は最も早い警報の60秒前
// ---------------------------------------------------------------------------

test('発表時刻の異なる複数警報: 基準の発表時刻は最も早い警報の60秒前で、全警報が現況に反映される', async () => {
  const db = setupDb();
  try {
    const early = generate('warning-03', '2026-10-12T09:00:00.000Z', GEN_A); // 発表 09:00Z
    const late = generate('warning-14', '2026-10-12T09:10:00.000Z', GEN_B); // 発表 09:10Z
    assert.equal(early.telegram.reportDateTime, '2026-10-12T09:00:00.000Z');
    assert.equal(late.telegram.reportDateTime, '2026-10-12T09:10:00.000Z');
    // 配列の先頭に遅い発表を置いても、基準は最小の発表時刻から決まる
    const command: TrainingInjectionCommand = {
      trainingId: '12121212-1212-4212-8212-121212121212',
      terminalId: K_EAST,
      requestedAt: NOW,
      telegrams: [toCommandTelegram(late, 1), toCommandTelegram(early, 0)],
    };
    const result = await injectTrainingTelegrams(db.weather.connection, command, {
      venueRegistry: testVenueRegistry,
      clock: FIXED_CLOCK,
    });
    assert.ok(result.baseline);
    assert.equal(result.baseline.reportDateTime, '2026-10-12T08:59:00.000Z');
    assert.deepEqual(
      result.telegrams.map((t) => [t.sequence, t.previewId]),
      [
        [1, early.previewId],
        [2, late.previewId],
      ],
    );
    for (const telegram of result.telegrams) {
      for (const adoption of telegram.adoptions) {
        assert.doesNotMatch(String(adoption.adoptionReason), /conflict|競合|古/);
      }
    }
    const snapshot = findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training');
    assert.deepEqual(snapshot?.items.map((item) => item.kindName).sort(), [
      'レベル３大雨警報',
      '雷注意報',
    ]);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 5. 訓練 VPWS50 既存時 baseline:null／基準電文の生成失敗時の 500 と受信0行
// ---------------------------------------------------------------------------

test('訓練VPWS50ストリームが既にあれば、警報を注入しても baseline:null で VPWS50 の受信は増えない', async () => {
  const db = setupDb();
  try {
    // 気象庁が配信した訓練 VPWS50 に相当するものを、通常の取り込み経路で事前に用意する
    const preparedXml = generateTrainingWarningBaseline({
      reportDateTime: '2026-10-12T08:00:00.000Z',
      controlDateTime: '2026-10-12T08:00:30.000Z',
    });
    await ingestTelegramDocument(
      db.weather.connection,
      {
        documentUrl: 'https://example.invalid/data/20261012080030_0_VPWS50_130000.xml',
        xml: preparedXml,
        feedKind: 'extra',
        feedEntryId: 'prepared-vpws50',
        fetchAttemptId: null,
        receivedAt: '2026-10-12T08:00:31.000Z',
        bodyBytes: Buffer.byteLength(preparedXml),
        contentHash: 'prepared',
      },
      { venueRegistry: testVenueRegistry },
    );
    assert.ok(
      findWarningCurrentStream(db.weather.connection, '130000', '1310800', 'training', 'VPWS50'),
    );
    const vpws50Before = count(
      db.weather.connection,
      "telegram_reception WHERE telegram_type = 'VPWS50'",
    );
    assert.equal(vpws50Before, 1);

    const warning = generate('warning-03', '2026-10-12T09:00:00.000Z', GEN_A);
    const result = await injectTrainingTelegrams(
      db.weather.connection,
      {
        trainingId: '34343434-3434-4434-8434-343434343434',
        terminalId: K_EAST,
        requestedAt: NOW,
        telegrams: [toCommandTelegram(warning, 0)],
      },
      { venueRegistry: testVenueRegistry, clock: FIXED_CLOCK },
    );
    assert.equal(result.baseline, null);
    assert.equal(result.telegrams[0]!.sequence, 0);
    assert.equal(
      count(db.weather.connection, "telegram_reception WHERE telegram_type = 'VPWS50'"),
      vpws50Before,
    );
    const roles = listTrainingInjectionReceptions(
      db.weather.connection,
      '34343434-3434-4434-8434-343434343434',
    ).map((r) => r.role);
    assert.deepEqual(roles, ['requested']);
    const snapshot = findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training');
    assert.deepEqual(
      snapshot?.items.map((item) => item.kindName),
      ['レベル３大雨警報'],
    );
  } finally {
    db.close();
  }
});

test('基準電文の生成が失敗すると、要求電文は1行も投入されず、記録は failed、HTTP は 500', async () => {
  const db = setupDb();
  try {
    const warning = generate('warning-03', '2026-10-12T09:00:00.000Z', GEN_A);
    const port: TrainingInjectionPort = {
      // 発表時刻を不正な値にして、基準電文の時刻計算（生成）を失敗させる
      inject: (command) =>
        injectTrainingTelegrams(
          db.weather.connection,
          {
            ...command,
            telegrams: command.telegrams.map((t) => ({ ...t, reportDateTime: 'not-a-date' })),
          },
          { venueRegistry: testVenueRegistry, clock: FIXED_CLOCK },
        ),
    };
    await withApp(
      port,
      () => BASELINE_FAIL_ID,
      async (call) => {
        const response = await call(
          'POST',
          '/api/training/inject',
          JSON.stringify({ terminalId: K_EAST, telegrams: [warning.request] }),
        );
        assert.equal(response.status, 500);
        assert.deepEqual(response.json, {
          status: 'error',
          code: 'training_injection_failed',
          trainingId: BASELINE_FAIL_ID,
        });
      },
    );
    assert.deepEqual(countsOf(db.weather.connection), {
      telegram_reception: 0,
      fetch_attempt: 0,
      training_injection: 1,
      training_injection_reception: 0,
    });
    const record = findTrainingInjection(db.weather.connection, BASELINE_FAIL_ID);
    assert.equal(record?.status, 'failed');
    assert.ok(record?.errorCode);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 7. HTTP 入力検証の不足ケース
// ---------------------------------------------------------------------------

test('HTTP入力検証: 21件・generatedAt形式違い・未知itemId・32KiB超xml・query付き・512kb超ボディ', async () => {
  const one = generate('warning-03', '2026-10-12T09:00:00.000Z', GEN_A);
  await withApp(noopPort, undefined, async (call) => {
    const post = (body: unknown, path = '/api/training/inject') =>
      call('POST', path, typeof body === 'string' ? body : JSON.stringify(body));
    const expect400 = async (label: string, response: Awaited<ReturnType<Caller>>) => {
      assert.equal(response.status, 400, label);
      assert.equal(response.cacheControl, 'no-store', label);
      assert.deepEqual(response.json, { status: 'error', code: 'invalid_request' }, label);
    };

    // 21件（上限 20 の次）。previewId は形式を満たす別々の値
    const many = Array.from({ length: TRAINING_INJECT_MAX_TELEGRAMS + 1 }, (_, i) => ({
      ...one.request,
      previewId: `${GEN_A.slice(0, -2)}${String(i).padStart(2, '0')}:0`,
    }));
    assert.equal(many.length, 21);
    await expect400('21件', await post({ terminalId: K_EAST, telegrams: many }));

    // 上限ちょうどの20件は形式検証と受理検証を通り、ポート（未準備）まで進む
    const twenty = many.slice(0, TRAINING_INJECT_MAX_TELEGRAMS);
    reachedPort.calls = 0;
    const res20 = await post({ terminalId: K_EAST, telegrams: twenty });
    assert.equal(res20.status, 503, res20.raw);
    assert.equal(reachedPort.calls, 1);
    reachedPort.calls = 0;

    // generatedAt の形式違い（ミリ秒なし・オフセット付き・日付のみ）
    for (const generatedAt of [
      '2026-10-12T09:00:00Z',
      '2026-10-12T18:00:00.000+09:00',
      '2026-10-12',
      'invalid',
    ]) {
      await expect400(
        `generatedAt=${generatedAt}`,
        await post({ terminalId: K_EAST, telegrams: [{ ...one.request, generatedAt }] }),
      );
    }

    // 未知の itemId
    await expect400(
      '未知itemId',
      await post({
        terminalId: K_EAST,
        telegrams: [{ ...one.request, itemIds: ['no-such-item'] }],
      }),
    );

    // 32KiB 超の xml（上限ちょうどは形式検証を通る）
    const bigXml = 'x'.repeat(TRAINING_INJECT_MAX_XML_BYTES + 1);
    await expect400(
      '32KiB超xml',
      await post({ terminalId: K_EAST, telegrams: [{ ...one.request, xml: bigXml }] }),
    );
    const exactXml = 'x'.repeat(TRAINING_INJECT_MAX_XML_BYTES);
    const resExact = await post({
      terminalId: K_EAST,
      telegrams: [{ ...one.request, xml: exactXml }],
    });
    assert.equal(resExact.status, 422, '32KiBちょうどは形式検証を通り、再生成不一致になる');

    // query 付き
    await expect400(
      'query付き',
      await post({ terminalId: K_EAST, telegrams: [one.request] }, '/api/training/inject?x=1'),
    );

    // 注入ルート専用の 512kb パーサー: 全体の既定上限(100KB)を超える 384KiB 以下のボディは 413 にならない
    // （32KiB 以下の xml を 10 通＝約 300KB。再生成不一致で 422 まで進む）
    const bulky = Array.from({ length: 10 }, (_, i) => ({
      ...one.request,
      previewId: `${GEN_B.slice(0, -2)}${String(i).padStart(2, '0')}:0`,
      xml: 'x'.repeat(30 * 1024),
    }));
    const resBulky = await post({ terminalId: K_EAST, telegrams: bulky });
    assert.equal(resBulky.status, 422, resBulky.raw);

    // 512kb 超のボディはパーサーが拒否し 413（no-store）
    const huge = await post({
      terminalId: K_EAST,
      telegrams: [one.request],
      _pad: ' '.repeat(520 * 1024),
    });
    assert.equal(huge.status, 413);
    assert.equal(huge.cacheControl, 'no-store');

    // 他のルートのボディ上限（100KB）は変わらない: 同じ大きさでも訓練注入以外は 413 のまま
    // （注入ルートだけが 512kb まで解析する）。384KiB 超 512kb 以下は注入ルートの 413 `request_too_large`
    const mid = await post({
      terminalId: K_EAST,
      telegrams: [one.request],
      _pad: ' '.repeat(400 * 1024),
    });
    assert.equal(mid.status, 413);
    assert.equal(mid.json.code, 'request_too_large');
    assert.equal(mid.cacheControl, 'no-store');
    assert.equal(reachedPort.calls, 0, '400/413/422 の要求はポートへ届かない');
  });
});
