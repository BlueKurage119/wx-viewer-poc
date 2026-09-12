import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  countFetchAttempts,
  countTelegramReceptions,
  deleteFetchAttempt,
  deleteTelegramReception,
  findFetchAttemptById,
  findTelegramReceptionById,
  listFetchAttempts,
  listTelegramReceptions,
  recordFetchAttempt,
  recordTelegramReception,
  upsertTelegramReceptionAdoption,
  type FetchAttemptInput,
  type TelegramReceptionInput,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-history-repo-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const sampleFetchAttemptInput: FetchAttemptInput = {
  sourceKind: 'xml_feed_regular',
  targetRef: null,
  requestUrl: 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml',
  triggerKind: 'scheduled',
  attemptNo: 1,
  startedAt: '2026-09-09T00:00:00Z',
  finishedAt: '2026-09-09T00:00:01Z',
  durationMs: 1000,
  outcome: 'success',
  httpStatus: 200,
  responseBytes: 12345,
  itemCount: null,
  failedItemCount: null,
  contentHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  errorKind: null,
  errorMessage: null,
};

const sampleTelegramInput: TelegramReceptionInput = {
  fetchAttemptId: null,
  feedKind: 'regular',
  feedEntryId: 'urn:uuid:12345',
  documentUrl: 'https://www.data.jma.go.jp/developer/xml/data/20260909000000_0_VPWW55_130000.xml',
  telegramType: 'VPWW55',
  title: '気象警報・注意報',
  controlStatus: 'normal',
  infoType: '発表',
  eventId: '20260909000000_130000',
  serial: '1',
  controlDateTime: '2026-09-09T00:00:00Z',
  reportDateTime: '2026-09-09T00:00:00Z',
  targetDateTime: '2026-09-09T00:00:00Z',
  receivedAt: '2026-09-09T00:00:02Z',
  rawBody: '<Report>...</Report>',
  bodyBytes: 20,
  contentHash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
  areas: [
    {
      areaCode: '1310800',
      areaName: '江東区',
      codeType: '気象情報／細分区域等',
      sequence: 1,
    },
  ],
  adoptions: [
    {
      venueId: 'east',
      adoptionResult: '採用',
      adoptionReason: '最新の発表',
      adoptionDecidedAt: '2026-09-09T00:00:03Z',
    },
  ],
};

test('1. recordFetchAttempt した内容を findFetchAttemptById で完全一致取得できる。NULL 許容列が null のまま往復する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const input: FetchAttemptInput = {
      sourceKind: 'xml_document',
      targetRef: null,
      requestUrl: 'https://example.com/doc.xml',
      triggerKind: 'manual',
      attemptNo: 1,
      startedAt: '2026-09-09T01:00:00Z',
      finishedAt: '2026-09-09T01:00:01Z',
      durationMs: 1000,
      outcome: 'success',
      httpStatus: null,
      responseBytes: null,
      itemCount: null,
      failedItemCount: null,
      contentHash: null,
      errorKind: null,
      errorMessage: null,
    };

    const created = recordFetchAttempt(context.connection, input);
    assert.ok(created.id > 0);
    assert.deepEqual(created, { id: created.id, ...input });

    const found = findFetchAttemptById(context.connection, created.id);
    assert.deepEqual(found, created);

    // 存在しない ID
    assert.equal(findFetchAttemptById(context.connection, 999999), null);

    context.close();
  } finally {
    cleanup();
  }
});

test('2. 失敗行（outcome=failure, httpStatus=null, errorKind=timeout）を保存・取得できる。httpStatus が 0 に変換されない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const input: FetchAttemptInput = {
      sourceKind: 'amedas_point',
      targetRef: '44136',
      requestUrl: 'https://example.com/amedas/point.json',
      triggerKind: 'retry',
      attemptNo: 2,
      startedAt: '2026-09-09T02:00:00Z',
      finishedAt: '2026-09-09T02:00:10Z',
      durationMs: 10000,
      outcome: 'failure',
      httpStatus: null,
      responseBytes: null,
      itemCount: null,
      failedItemCount: null,
      contentHash: null,
      errorKind: 'timeout',
      errorMessage: 'Connection timed out after 10000ms',
    };

    const created = recordFetchAttempt(context.connection, input);
    assert.strictEqual(created.httpStatus, null);
    assert.strictEqual(created.outcome, 'failure');
    assert.strictEqual(created.errorKind, 'timeout');

    const found = findFetchAttemptById(context.connection, created.id);
    assert.ok(found);
    assert.strictEqual(found.httpStatus, null);
    assert.notStrictEqual(found.httpStatus, 0);
    assert.strictEqual(found.outcome, 'failure');

    context.close();
  } finally {
    cleanup();
  }
});

test('3. listFetchAttempts が startedAt の新しい順に返る。同一 startedAt の 2 行は id の大きい順に返る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const row1 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      startedAt: '2026-09-09T01:00:00Z',
      finishedAt: '2026-09-09T01:00:01Z',
    });
    const row2 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      startedAt: '2026-09-09T03:00:00Z',
      finishedAt: '2026-09-09T03:00:01Z',
    });
    const row3 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      startedAt: '2026-09-09T02:00:00Z',
      finishedAt: '2026-09-09T02:00:01Z',
    });
    const row4 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      startedAt: '2026-09-09T02:00:00Z',
      finishedAt: '2026-09-09T02:00:01Z',
    });

    const list = listFetchAttempts(context.connection);
    assert.equal(list.length, 4);
    assert.equal(list[0].id, row2.id); // 03:00:00
    assert.equal(list[1].id, row4.id); // 02:00:00 (id larger)
    assert.equal(list[2].id, row3.id); // 02:00:00 (id smaller)
    assert.equal(list[3].id, row1.id); // 01:00:00

    context.close();
  } finally {
    cleanup();
  }
});

test('4. sourceKind / outcome / startedAtFrom / startedAtTo の各絞り込みが期待どおりに効き、countFetchAttempts が全件数を返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      sourceKind: 'xml_feed_regular',
      outcome: 'success',
      startedAt: '2026-09-09T01:00:00Z',
      finishedAt: '2026-09-09T01:00:01Z',
    });
    recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      sourceKind: 'xml_feed_regular',
      outcome: 'failure',
      startedAt: '2026-09-09T02:00:00Z',
      finishedAt: '2026-09-09T02:00:01Z',
    });
    recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      sourceKind: 'radar_target_times',
      outcome: 'success',
      startedAt: '2026-09-09T03:00:00Z',
      finishedAt: '2026-09-09T03:00:01Z',
    });

    // 全件
    assert.equal(countFetchAttempts(context.connection), 3);
    assert.equal(listFetchAttempts(context.connection).length, 3);

    // sourceKind 絞り込み
    assert.equal(countFetchAttempts(context.connection, { sourceKind: 'xml_feed_regular' }), 2);
    assert.equal(
      listFetchAttempts(context.connection, { sourceKind: 'xml_feed_regular' }).length,
      2,
    );

    // outcome 絞り込み
    assert.equal(countFetchAttempts(context.connection, { outcome: 'failure' }), 1);
    assert.equal(listFetchAttempts(context.connection, { outcome: 'failure' }).length, 1);

    // startedAtFrom / To 絞り込み
    const rangeOpts = {
      startedAtFrom: '2026-09-09T01:30:00Z',
      startedAtTo: '2026-09-09T02:30:00Z',
    };
    assert.equal(countFetchAttempts(context.connection, rangeOpts), 1);
    assert.equal(listFetchAttempts(context.connection, rangeOpts).length, 1);

    // 複合
    const combinedOpts = {
      sourceKind: 'xml_feed_regular',
      outcome: 'success' as const,
    };
    assert.equal(countFetchAttempts(context.connection, combinedOpts), 1);
    assert.equal(listFetchAttempts(context.connection, combinedOpts).length, 1);

    context.close();
  } finally {
    cleanup();
  }
});

test('5. limit / offset でページングでき、limit 未指定が 100 件、limit=5000 が 1000 件に丸められ、limit<=0 が例外になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    for (let i = 0; i < 5; i++) {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        startedAt: `2026-09-09T0${i}:00:00Z`,
        finishedAt: `2026-09-09T0${i}:00:01Z`,
      });
    }

    const page1 = listFetchAttempts(context.connection, { limit: 2, offset: 0 });
    assert.equal(page1.length, 2);

    const page2 = listFetchAttempts(context.connection, { limit: 2, offset: 2 });
    assert.equal(page2.length, 2);
    assert.notEqual(page1[0].id, page2[0].id);

    // 1005 件を一括挿入して limit > 1000 の丸め（1000件で頭打ち）を厳密に検証
    const insertManyTx = context.connection.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        recordFetchAttempt(context.connection, {
          ...sampleFetchAttemptInput,
          startedAt: '2026-09-09T00:00:00Z',
          finishedAt: '2026-09-09T00:00:01Z',
        });
      }
    });
    insertManyTx();

    const largeList = listFetchAttempts(context.connection, { limit: 5000 });
    assert.equal(largeList.length, 1000);

    // limit <= 0 や offset < 0 は例外
    assert.throws(() => listFetchAttempts(context.connection, { limit: 0 }), /limit/);
    assert.throws(() => listFetchAttempts(context.connection, { limit: -1 }), /limit/);
    assert.throws(() => listFetchAttempts(context.connection, { offset: -1 }), /offset/);

    context.close();
  } finally {
    cleanup();
  }
});

test('6. outcome に不正値、attemptNo=0、durationMs=-1、startedAt が非 ISO 8601 の入力が例外になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    // outcome 不正
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outcome: 'invalid' as any,
      });
    }, /outcome/);

    // attemptNo <= 0
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        attemptNo: 0,
      });
    }, /attemptNo/);

    // durationMs < 0
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        durationMs: -1,
      });
    }, /durationMs/);

    // startedAt 不正
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        startedAt: 'invalid-date',
      });
    }, /startedAt/);

    // sourceKind 空文字
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...sampleFetchAttemptInput,
        sourceKind: '',
      });
    }, /sourceKind/);

    context.close();
  } finally {
    cleanup();
  }
});

test('6b. フレーム単位の記録: itemCount / failedItemCount が完全一致往復。片方 NULL、failedItemCount > itemCount、itemCount: 0、failedItemCount: -1 は例外', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const frameInput: FetchAttemptInput = {
      sourceKind: 'radar_tile_frame',
      targetRef: 'nowc_hrpns_20260909000000',
      requestUrl: 'https://example.com/tiles/nowc/20260909000000/0/0/0.png',
      triggerKind: 'scheduled',
      attemptNo: 1,
      startedAt: '2026-09-09T00:00:00Z',
      finishedAt: '2026-09-09T00:00:02Z',
      durationMs: 2000,
      outcome: 'success',
      httpStatus: 200,
      responseBytes: 50000,
      itemCount: 12,
      failedItemCount: 3,
      contentHash: null,
      errorKind: null,
      errorMessage: null,
    };

    const saved = recordFetchAttempt(context.connection, frameInput);
    assert.equal(saved.itemCount, 12);
    assert.equal(saved.failedItemCount, 3);

    const found = findFetchAttemptById(context.connection, saved.id);
    assert.deepEqual(found, saved);

    // 片方だけ NULL
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...frameInput,
        itemCount: 12,
        failedItemCount: null,
      });
    }, /failedItemCount/);

    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...frameInput,
        itemCount: null,
        failedItemCount: 3,
      });
    }, /itemCount/);

    // failedItemCount > itemCount
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...frameInput,
        itemCount: 12,
        failedItemCount: 13,
      });
    }, /failedItemCount/);

    // itemCount <= 0
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...frameInput,
        itemCount: 0,
        failedItemCount: 0,
      });
    }, /itemCount/);

    // failedItemCount < 0
    assert.throws(() => {
      recordFetchAttempt(context.connection, {
        ...frameInput,
        itemCount: 12,
        failedItemCount: -1,
      });
    }, /failedItemCount/);

    context.close();
  } finally {
    cleanup();
  }
});

test('6c. 部分失敗と outcome を結合しない: failedItemCount: 3 かつ outcome: success を保存でき、failedItemCount: 0 かつ failure も保存できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    // failedItemCount = 3, outcome = success
    const res1 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      itemCount: 12,
      failedItemCount: 3,
      outcome: 'success',
    });
    assert.strictEqual(res1.outcome, 'success');
    assert.strictEqual(res1.failedItemCount, 3);
    const found1 = findFetchAttemptById(context.connection, res1.id);
    assert.strictEqual(found1?.outcome, 'success');

    // failedItemCount = 0, outcome = failure
    const res2 = recordFetchAttempt(context.connection, {
      ...sampleFetchAttemptInput,
      itemCount: 12,
      failedItemCount: 0,
      outcome: 'failure',
    });
    assert.strictEqual(res2.outcome, 'failure');
    assert.strictEqual(res2.failedItemCount, 0);
    const found2 = findFetchAttemptById(context.connection, res2.id);
    assert.strictEqual(found2?.outcome, 'failure');

    context.close();
  } finally {
    cleanup();
  }
});

test('7. deleteFetchAttempt で単件が消え、他の行が残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const row1 = recordFetchAttempt(context.connection, sampleFetchAttemptInput);
    const row2 = recordFetchAttempt(context.connection, sampleFetchAttemptInput);

    assert.equal(deleteFetchAttempt(context.connection, row1.id), true);
    assert.equal(deleteFetchAttempt(context.connection, row1.id), false); // 既に存在しない

    assert.equal(findFetchAttemptById(context.connection, row1.id), null);
    assert.ok(findFetchAttemptById(context.connection, row2.id));

    context.close();
  } finally {
    cleanup();
  }
});

test('8. recordTelegramReception した内容を findTelegramReceptionById で完全一致取得でき、rawBody と areas が往復する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const created = recordTelegramReception(context.connection, sampleTelegramInput);
    assert.ok(created.id > 0);
    assert.strictEqual(created.hasRawBody, true);
    assert.strictEqual(created.rawBody, '<Report>...</Report>');
    assert.equal(created.areas.length, 1);
    assert.ok(created.areas[0].id > 0);
    assert.equal(created.areas[0].areaCode, '1310800');

    const found = findTelegramReceptionById(context.connection, created.id);
    assert.deepEqual(found, created);

    assert.equal(findTelegramReceptionById(context.connection, 999999), null);

    context.close();
  } finally {
    cleanup();
  }
});

test('9. listTelegramReceptions の結果に rawBody プロパティが含まれず、hasRawBody が true になる。findTelegramReceptionById では原文が取れる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const created = recordTelegramReception(context.connection, sampleTelegramInput);

    const list = listTelegramReceptions(context.connection);
    assert.equal(list.length, 1);
    const summary = list[0];

    assert.strictEqual('rawBody' in summary, false);
    assert.strictEqual(summary.hasRawBody, true);
    assert.equal(summary.areas.length, 1);
    assert.equal(summary.id, created.id);

    const detailed = findTelegramReceptionById(context.connection, created.id);
    assert.ok(detailed);
    assert.strictEqual(detailed.rawBody, '<Report>...</Report>');

    context.close();
  } finally {
    cleanup();
  }
});

test('10. 原文なし（rawBody: null, bodyBytes: null）の行を保存でき、hasRawBody が false になる。空文字に変換されない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const noBodyInput: TelegramReceptionInput = {
      ...sampleTelegramInput,
      rawBody: null,
      bodyBytes: null,
      contentHash: null,
    };

    const created = recordTelegramReception(context.connection, noBodyInput);
    assert.strictEqual(created.rawBody, null);
    assert.strictEqual(created.hasRawBody, false);

    const found = findTelegramReceptionById(context.connection, created.id);
    assert.ok(found);
    assert.strictEqual(found.rawBody, null);
    assert.notStrictEqual(found.rawBody, '');
    assert.strictEqual(found.hasRawBody, false);

    const list = listTelegramReceptions(context.connection);
    assert.equal(list.length, 1);
    assert.strictEqual(list[0].hasRawBody, false);

    context.close();
  } finally {
    cleanup();
  }
});

test('11. 訓練の分離: controlStatus 指定時に normal の 1 行だけを返し、null 行を含まない。未指定では 4 行すべて返る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const rowNormal = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      controlStatus: 'normal',
      documentUrl: 'https://example.com/normal.xml',
    });
    recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      controlStatus: 'training',
      documentUrl: 'https://example.com/training.xml',
    });
    recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      controlStatus: 'test',
      documentUrl: 'https://example.com/test.xml',
    });
    recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      controlStatus: null,
      documentUrl: 'https://example.com/null.xml',
    });

    // controlStatus: 'normal' 指定
    const normalList = listTelegramReceptions(context.connection, { controlStatus: 'normal' });
    assert.equal(normalList.length, 1);
    assert.equal(normalList[0].id, rowNormal.id);
    assert.equal(countTelegramReceptions(context.connection, { controlStatus: 'normal' }), 1);

    // controlStatus 未指定（全件）
    const allList = listTelegramReceptions(context.connection);
    assert.equal(allList.length, 4);
    assert.equal(countTelegramReceptions(context.connection), 4);

    context.close();
  } finally {
    cleanup();
  }
});

test('12. 解析失敗相当の行を保存・取得でき、NULL が既定値に置き換わらない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const parseFailInput: TelegramReceptionInput = {
      fetchAttemptId: null,
      feedKind: 'regular',
      feedEntryId: null,
      documentUrl: 'https://example.com/broken.xml',
      telegramType: null,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: '2026-09-09T00:00:00Z',
      rawBody: '<UnknownXml>content</UnknownXml>',
      bodyBytes: 32,
      contentHash: 'hash123',
      areas: [],
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未対応形式',
          adoptionReason: 'ルートタグが未知のフォーマット',
          adoptionDecidedAt: '2026-09-09T00:00:01Z',
        },
      ],
    };

    const created = recordTelegramReception(context.connection, parseFailInput);
    assert.strictEqual(created.telegramType, null);
    assert.strictEqual(created.controlStatus, null);
    assert.strictEqual(created.reportDateTime, null);
    assert.deepEqual(created.adoptions, [
      {
        receptionId: created.id,
        venueId: 'east',
        adoptionResult: '未対応形式',
        adoptionReason: 'ルートタグが未知のフォーマット',
        adoptionDecidedAt: '2026-09-09T00:00:01Z',
      },
    ]);

    const found = findTelegramReceptionById(context.connection, created.id);
    assert.ok(found);
    assert.strictEqual(found.telegramType, null);
    assert.strictEqual(found.controlStatus, null);
    assert.strictEqual(found.reportDateTime, null);

    context.close();
  } finally {
    cleanup();
  }
});

test('13. 同一 documentUrl を 2 回 recordTelegramReception すると 2 行になり、id が異なり、1 行目の内容が変化しない（追記ログ）', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const row1 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      receivedAt: '2026-09-09T00:00:00Z',
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '未判定',
          adoptionReason: null,
          adoptionDecidedAt: null,
        },
      ],
    });
    const row2 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      receivedAt: '2026-09-09T00:10:00Z',
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '重複受信',
          adoptionReason: null,
          adoptionDecidedAt: null,
        },
      ],
    });

    assert.notEqual(row1.id, row2.id);

    const found1 = findTelegramReceptionById(context.connection, row1.id);
    assert.ok(found1);
    assert.equal(found1.receivedAt, '2026-09-09T00:00:00Z');
    assert.equal(found1.adoptions[0]?.adoptionResult, '未判定');

    assert.equal(
      countTelegramReceptions(context.connection, { documentUrl: sampleTelegramInput.documentUrl }),
      2,
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('14. areaCode 絞り込みで 1310800 のみ返り、130010 検索時に 1300100 は誤ヒットしない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const rowKoto = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      documentUrl: 'https://example.com/koto.xml',
      areas: [{ areaCode: '1310800', areaName: '江東区', codeType: null, sequence: 1 }],
    });
    const row130010 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      documentUrl: 'https://example.com/130010.xml',
      areas: [{ areaCode: '130010', areaName: '東京地方', codeType: null, sequence: 1 }],
    });
    const row1300100 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      documentUrl: 'https://example.com/1300100.xml',
      areas: [{ areaCode: '1300100', areaName: '伊豆諸島北部', codeType: null, sequence: 1 }],
    });

    // 1310800 検索
    const kotoList = listTelegramReceptions(context.connection, { areaCode: '1310800' });
    assert.equal(kotoList.length, 1);
    assert.equal(kotoList[0].id, rowKoto.id);

    // 130010 検索 (1300100 はヒットしてはならない)
    const list130010 = listTelegramReceptions(context.connection, { areaCode: '130010' });
    assert.equal(list130010.length, 1);
    assert.equal(list130010[0].id, row130010.id);
    assert.ok(!list130010.some((r) => r.id === row1300100.id));

    context.close();
  } finally {
    cleanup();
  }
});

test('15. 1 電文に複数区域を保存でき sequence 順に往復する。同一 (receptionId, sequence) の重複挿入が一意制約違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const multiAreaInput: TelegramReceptionInput = {
      ...sampleTelegramInput,
      areas: [
        { areaCode: '1310800', areaName: '江東区', codeType: '細分', sequence: 2 },
        { areaCode: '1310100', areaName: '千代田区', codeType: '細分', sequence: 1 },
      ],
    };

    const created = recordTelegramReception(context.connection, multiAreaInput);
    assert.equal(created.areas.length, 2);
    assert.equal(created.areas[0].sequence, 1);
    assert.equal(created.areas[0].areaCode, '1310100');
    assert.equal(created.areas[1].sequence, 2);
    assert.equal(created.areas[1].areaCode, '1310800');

    // 重複 sequence の挿入で一意制約違反
    assert.throws(() => {
      recordTelegramReception(context.connection, {
        ...sampleTelegramInput,
        areas: [
          { areaCode: '1310800', areaName: '江東区', codeType: '細分', sequence: 1 },
          { areaCode: '1310100', areaName: '千代田区', codeType: '細分', sequence: 1 },
        ],
      });
    });

    context.close();
  } finally {
    cleanup();
  }
});

test('16. telegramType / infoType / receivedAtFrom/To / reportDateTimeFrom/To / adoptionResult の絞り込みが効く。reportDateTime が null の行は reportDateTimeFrom 指定時に返らない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const row1 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      telegramType: 'VPWW55',
      infoType: '発表',
      adoptions: [
        { venueId: 'east', adoptionResult: '採用', adoptionReason: null, adoptionDecidedAt: null },
      ],
      receivedAt: '2026-09-09T01:00:00Z',
      reportDateTime: '2026-09-09T01:00:00Z',
      documentUrl: 'https://example.com/1.xml',
    });
    recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      telegramType: 'VPWW56',
      infoType: '訂正',
      adoptions: [
        {
          venueId: 'east',
          adoptionResult: '不採用',
          adoptionReason: null,
          adoptionDecidedAt: null,
        },
      ],
      receivedAt: '2026-09-09T02:00:00Z',
      reportDateTime: '2026-09-09T02:00:00Z',
      documentUrl: 'https://example.com/2.xml',
    });
    recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      telegramType: null,
      infoType: null,
      adoptions: [],
      receivedAt: '2026-09-09T03:00:00Z',
      reportDateTime: null,
      documentUrl: 'https://example.com/3.xml',
    });

    // telegramType
    assert.equal(listTelegramReceptions(context.connection, { telegramType: 'VPWW55' }).length, 1);
    assert.equal(countTelegramReceptions(context.connection, { telegramType: 'VPWW55' }), 1);

    // infoType
    assert.equal(listTelegramReceptions(context.connection, { infoType: '訂正' }).length, 1);

    // adoptionResult
    assert.equal(listTelegramReceptions(context.connection, { adoptionResult: '採用' }).length, 1);

    // receivedAtFrom / To
    assert.equal(
      listTelegramReceptions(context.connection, {
        receivedAtFrom: '2026-09-09T00:30:00Z',
        receivedAtTo: '2026-09-09T01:30:00Z',
      }).length,
      1,
    );

    // reportDateTimeFrom 指定時は reportDateTime が null の行は返らない
    const reportList = listTelegramReceptions(context.connection, {
      reportDateTimeFrom: '2026-09-09T00:00:00Z',
    });
    assert.equal(reportList.length, 2);
    assert.ok(!reportList.some((r) => r.reportDateTime === null));

    // documentUrl
    assert.equal(
      listTelegramReceptions(context.connection, { documentUrl: 'https://example.com/1.xml' })[0]
        .id,
      row1.id,
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('17. upsertTelegramReceptionAdoption で対象会場の採用結果・理由・判定時刻だけが変わり、rawBody を含む他の列と areas が変化しない。存在しない reception_id は外部キー制約違反になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const created = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      adoptions: [],
    });

    const updated = upsertTelegramReceptionAdoption(context.connection, created.id, {
      venueId: 'east',
      adoptionResult: '採用（集約版）',
      adoptionReason: '全域カバーのため',
      adoptionDecidedAt: '2026-09-09T00:01:00Z',
    });

    assert.deepEqual(updated, {
      receptionId: created.id,
      venueId: 'east',
      adoptionResult: '採用（集約版）',
      adoptionReason: '全域カバーのため',
      adoptionDecidedAt: '2026-09-09T00:01:00Z',
    });

    const found = findTelegramReceptionById(context.connection, created.id);
    assert.ok(found);
    assert.equal(found.rawBody, created.rawBody);
    assert.equal(found.documentUrl, created.documentUrl);
    assert.deepEqual(found.areas, created.areas);
    assert.deepEqual(found.adoptions, [updated]);

    // 同一 (reception_id, venue_id) への再 upsert は上書きする
    const reupserted = upsertTelegramReceptionAdoption(context.connection, created.id, {
      venueId: 'east',
      adoptionResult: '再判定',
      adoptionReason: null,
      adoptionDecidedAt: '2026-09-09T00:02:00Z',
    });
    assert.deepEqual(findTelegramReceptionById(context.connection, created.id)?.adoptions, [
      reupserted,
    ]);

    // 存在しない reception_id は外部キー制約違反になる
    assert.throws(() => {
      upsertTelegramReceptionAdoption(context.connection, 999999, {
        venueId: 'east',
        adoptionResult: '採用',
        adoptionReason: null,
        adoptionDecidedAt: null,
      });
    });

    context.close();
  } finally {
    cleanup();
  }
});

test('18. deleteTelegramReception で親と明細が消え、再取得が null になる。他の電文行は残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const row1 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      documentUrl: 'https://example.com/1.xml',
    });
    const row2 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      documentUrl: 'https://example.com/2.xml',
    });

    assert.equal(deleteTelegramReception(context.connection, row1.id), true);
    assert.equal(deleteTelegramReception(context.connection, row1.id), false);

    assert.equal(findTelegramReceptionById(context.connection, row1.id), null);
    assert.ok(findTelegramReceptionById(context.connection, row2.id));

    // 明細も消えている
    const areaCount = context.connection
      .prepare('SELECT COUNT(*) as c FROM telegram_reception_area WHERE reception_id = ?')
      .get(row1.id) as { c: number };
    assert.equal(areaCount.c, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('19. 2 表の独立性（リポジトリ経由）: 電文行に紐づく fetch_attempt を消しても電文行が変わらない。電文行を消しても通信履歴行が残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    const fetchAttempt = recordFetchAttempt(context.connection, sampleFetchAttemptInput);
    const telegram = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      fetchAttemptId: fetchAttempt.id,
    });

    // fetch_attempt を削除
    assert.equal(deleteFetchAttempt(context.connection, fetchAttempt.id), true);

    // telegram_reception は完全一致でそのまま取得できる
    const telAfter = findTelegramReceptionById(context.connection, telegram.id);
    assert.deepEqual(telAfter, telegram);

    // 新たに fetch_attempt と telegram を作成して、telegram を削除
    const fetchAttempt2 = recordFetchAttempt(context.connection, sampleFetchAttemptInput);
    const telegram2 = recordTelegramReception(context.connection, {
      ...sampleTelegramInput,
      fetchAttemptId: fetchAttempt2.id,
      documentUrl: 'https://example.com/tel2.xml',
    });

    assert.equal(deleteTelegramReception(context.connection, telegram2.id), true);
    // fetch_attempt2 は残っている
    assert.deepEqual(findFetchAttemptById(context.connection, fetchAttempt2.id), fetchAttempt2);

    context.close();
  } finally {
    cleanup();
  }
});
