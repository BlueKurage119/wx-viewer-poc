import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  countNotificationOutputHistory,
  deleteNotificationOutputHistory,
  findNotificationOutputHistoryById,
  findNotificationOutputHistoryByNotificationId,
  listNotificationOutputHistory,
  recordNotificationOutputHistory,
  type NotificationDetectionContext,
  type NotificationOutputHistoryInput,
  type NotificationOutputOrigin,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-notification-repo-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const sampleWeatherNotificationInput: NotificationOutputHistoryInput = {
  notificationId: 'notif-20260909-001',
  category: 'warning',
  sourceType: 'warning_current',
  sourceVersion: '20260909000000_0_VPWW55_130000',
  targetAreaJson: JSON.stringify({ areaCode: '130010', areaName: '東京都' }),
  occurredAt: '2026-09-09T00:00:00Z',
  detectedAt: '2026-09-09T00:00:02Z',
  changeType: 'new',
  ackRequired: false,
  summary: '大雨警報発表',
  relatedRefsJson: JSON.stringify([{ type: 'telegram', ref: '20260909000000_0_VPWW55_130000' }]),
  origin: 'weather',
  detectionContext: 'normal',
  isTraining: false,
  messageDefinitionId: 'msg-weather-warn-001',
  messageDefinitionVersion: 'v1.0.0',
};

const sampleSystemNotificationInput: NotificationOutputHistoryInput = {
  notificationId: 'notif-20260909-002',
  category: 'emergency',
  sourceType: 'fetch_attempt',
  sourceVersion: null,
  targetAreaJson: null,
  occurredAt: '2026-09-09T00:01:00Z',
  detectedAt: '2026-09-09T00:01:05Z',
  changeType: 'connection_lost',
  ackRequired: true,
  summary: '気象データ取得失敗：接続途絶',
  relatedRefsJson: '[]',
  origin: 'system',
  detectionContext: 'initial',
  isTraining: false,
  messageDefinitionId: null,
  messageDefinitionVersion: null,
};

test('1. 全列を埋めた気象通知（weather + normal、定義 ID／版あり）を記録し、数値 id と notificationId の両方から完全一致で取得できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const recorded = recordNotificationOutputHistory(
      context.connection,
      sampleWeatherNotificationInput,
    );
    assert.ok(recorded.id > 0);
    assert.equal(recorded.notificationId, sampleWeatherNotificationInput.notificationId);
    assert.equal(recorded.category, sampleWeatherNotificationInput.category);
    assert.equal(recorded.sourceType, sampleWeatherNotificationInput.sourceType);
    assert.equal(recorded.sourceVersion, sampleWeatherNotificationInput.sourceVersion);
    assert.equal(recorded.targetAreaJson, sampleWeatherNotificationInput.targetAreaJson);
    assert.equal(recorded.occurredAt, sampleWeatherNotificationInput.occurredAt);
    assert.equal(recorded.detectedAt, sampleWeatherNotificationInput.detectedAt);
    assert.equal(recorded.changeType, sampleWeatherNotificationInput.changeType);
    assert.equal(recorded.ackRequired, sampleWeatherNotificationInput.ackRequired);
    assert.equal(recorded.summary, sampleWeatherNotificationInput.summary);
    assert.equal(recorded.relatedRefsJson, sampleWeatherNotificationInput.relatedRefsJson);
    assert.equal(recorded.origin, sampleWeatherNotificationInput.origin);
    assert.equal(recorded.detectionContext, sampleWeatherNotificationInput.detectionContext);
    assert.equal(recorded.isTraining, sampleWeatherNotificationInput.isTraining);
    assert.equal(recorded.messageDefinitionId, sampleWeatherNotificationInput.messageDefinitionId);
    assert.equal(
      recorded.messageDefinitionVersion,
      sampleWeatherNotificationInput.messageDefinitionVersion,
    );

    // ID で取得
    const byId = findNotificationOutputHistoryById(context.connection, recorded.id);
    assert.deepEqual(byId, recorded);

    // notificationId で取得
    const byNotifId = findNotificationOutputHistoryByNotificationId(
      context.connection,
      sampleWeatherNotificationInput.notificationId,
    );
    assert.deepEqual(byNotifId, recorded);

    // 存在しない場合
    assert.equal(findNotificationOutputHistoryById(context.connection, 99999), null);
    assert.equal(
      findNotificationOutputHistoryByNotificationId(context.connection, 'not-exists'),
      null,
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('2. 装置異常通知（system + initial、sourceVersion / targetAreaJson / 定義 ID／版が NULL）を保存でき、NULL が空文字へ変換されない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const recorded = recordNotificationOutputHistory(
      context.connection,
      sampleSystemNotificationInput,
    );
    assert.equal(recorded.sourceVersion, null);
    assert.equal(recorded.targetAreaJson, null);
    assert.equal(recorded.messageDefinitionId, null);
    assert.equal(recorded.messageDefinitionVersion, null);
    assert.equal(recorded.origin, 'system');
    assert.equal(recorded.detectionContext, 'initial');

    const fetched = findNotificationOutputHistoryById(context.connection, recorded.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.sourceVersion, null);
    assert.strictEqual(fetched.targetAreaJson, null);
    assert.strictEqual(fetched.messageDefinitionId, null);
    assert.strictEqual(fetched.messageDefinitionVersion, null);

    context.close();
  } finally {
    cleanup();
  }
});

test('3. targetAreaJson と relatedRefsJson が妥当な JSON なら文字列が再整形されず完全一致で往復し、不正 JSON は保存前に例外になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // キーの順序や空白が特殊な JSON 文字列
    const rawTargetAreaJson = '{"b": 2,  "a": "test"}';
    const rawRelatedRefsJson = '[  {"ref":"x",\n"kind":1}  ]';

    const input: NotificationOutputHistoryInput = {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-json-exact',
      targetAreaJson: rawTargetAreaJson,
      relatedRefsJson: rawRelatedRefsJson,
    };

    const recorded = recordNotificationOutputHistory(context.connection, input);
    assert.strictEqual(recorded.targetAreaJson, rawTargetAreaJson);
    assert.strictEqual(recorded.relatedRefsJson, rawRelatedRefsJson);

    const fetched = findNotificationOutputHistoryById(context.connection, recorded.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.targetAreaJson, rawTargetAreaJson);
    assert.strictEqual(fetched.relatedRefsJson, rawRelatedRefsJson);

    // 不正 JSON (targetAreaJson)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          notificationId: 'notif-invalid-json-1',
          targetAreaJson: '{invalid json',
        });
      },
      { message: /targetAreaJson must be a valid JSON string/ },
    );

    // 不正 JSON (relatedRefsJson)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          notificationId: 'notif-invalid-json-2',
          relatedRefsJson: 'not a json',
        });
      },
      { message: /relatedRefsJson must be a valid JSON string/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('4. ackRequired / isTraining の true / false が 1 / 0 を経由して完全一致で往復する', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const notifTrue = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-bool-true',
      ackRequired: true,
      isTraining: true,
    });

    const notifFalse = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-bool-false',
      ackRequired: false,
      isTraining: false,
    });

    const fetchedTrue = findNotificationOutputHistoryById(context.connection, notifTrue.id);
    assert.ok(fetchedTrue);
    assert.strictEqual(fetchedTrue.ackRequired, true);
    assert.strictEqual(fetchedTrue.isTraining, true);

    const fetchedFalse = findNotificationOutputHistoryById(context.connection, notifFalse.id);
    assert.ok(fetchedFalse);
    assert.strictEqual(fetchedFalse.ackRequired, false);
    assert.strictEqual(fetchedFalse.isTraining, false);

    // DB 上の値が 1 / 0 であることを直接確認
    const rowTrue = context.connection
      .prepare('SELECT ack_required, is_training FROM notification_output_history WHERE id = ?')
      .get(notifTrue.id) as { ack_required: number; is_training: number };
    assert.strictEqual(rowTrue.ack_required, 1);
    assert.strictEqual(rowTrue.is_training, 1);

    const rowFalse = context.connection
      .prepare('SELECT ack_required, is_training FROM notification_output_history WHERE id = ?')
      .get(notifFalse.id) as { ack_required: number; is_training: number };
    assert.strictEqual(rowFalse.ack_required, 0);
    assert.strictEqual(rowFalse.is_training, 0);

    context.close();
  } finally {
    cleanup();
  }
});

test('5. summary に完成済み文言 気象警報発表　レベル3大雨警報 を保存できる。同じ定義 ID の別通知に異なる summary を保存しても、先の履歴が変化しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const firstSummary = '気象警報発表　レベル3大雨警報';
    const secondSummary = '気象警報発表　レベル4土砂災害警戒情報';

    const notif1 = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-summary-1',
      summary: firstSummary,
      messageDefinitionId: 'msg-def-shared',
      messageDefinitionVersion: 'v1.0.0',
    });

    const notif2 = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-summary-2',
      summary: secondSummary,
      messageDefinitionId: 'msg-def-shared',
      messageDefinitionVersion: 'v1.0.0',
    });

    const fetched1 = findNotificationOutputHistoryById(context.connection, notif1.id);
    const fetched2 = findNotificationOutputHistoryById(context.connection, notif2.id);

    assert.ok(fetched1);
    assert.ok(fetched2);
    assert.strictEqual(fetched1.summary, firstSummary);
    assert.strictEqual(fetched2.summary, secondSummary);

    context.close();
  } finally {
    cleanup();
  }
});

test('6. listNotificationOutputHistory は detectedAt の新しい順、同時刻は id の大きい順で返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // 順不同で登録
    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-order-1',
      detectedAt: '2026-09-09T01:00:00Z',
    });
    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-order-2',
      detectedAt: '2026-09-09T03:00:00Z',
    });
    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-order-3',
      detectedAt: '2026-09-09T02:00:00Z',
    });
    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-order-4',
      detectedAt: '2026-09-09T02:00:00Z',
    });

    const list = listNotificationOutputHistory(context.connection);
    assert.equal(list.length, 4);
    assert.equal(list[0].notificationId, 'notif-order-2'); // 03:00:00Z
    assert.equal(list[1].notificationId, 'notif-order-4'); // 02:00:00Z (id が大きい)
    assert.equal(list[2].notificationId, 'notif-order-3'); // 02:00:00Z (id が小さい)
    assert.equal(list[3].notificationId, 'notif-order-1'); // 01:00:00Z

    context.close();
  } finally {
    cleanup();
  }
});

test('7. category / sourceType / changeType / origin / detectionContext / isTraining / detectedAtFrom / detectedAtTo の各条件と複合条件が完全一致で効く。countNotificationOutputHistory が同じ条件のページング前件数を返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'n-1',
      category: 'warning',
      sourceType: 'warning_current',
      changeType: 'new',
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: false,
      detectedAt: '2026-09-09T10:00:00Z',
    });

    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'n-2',
      category: 'emergency',
      sourceType: 'risk',
      changeType: 'escalate',
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: true,
      detectedAt: '2026-09-09T11:00:00Z',
    });

    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'n-3',
      category: 'question',
      sourceType: 'fetch_attempt',
      changeType: 'failure',
      origin: 'system',
      detectionContext: 'initial',
      isTraining: false,
      detectedAt: '2026-09-09T12:00:00Z',
    });

    // category
    assert.equal(
      listNotificationOutputHistory(context.connection, { category: 'warning' }).length,
      1,
    );
    assert.equal(countNotificationOutputHistory(context.connection, { category: 'warning' }), 1);

    // sourceType
    assert.equal(
      listNotificationOutputHistory(context.connection, { sourceType: 'risk' }).length,
      1,
    );
    assert.equal(countNotificationOutputHistory(context.connection, { sourceType: 'risk' }), 1);

    // changeType
    assert.equal(
      listNotificationOutputHistory(context.connection, { changeType: 'failure' }).length,
      1,
    );
    assert.equal(countNotificationOutputHistory(context.connection, { changeType: 'failure' }), 1);

    // origin
    assert.equal(listNotificationOutputHistory(context.connection, { origin: 'system' }).length, 1);
    assert.equal(countNotificationOutputHistory(context.connection, { origin: 'system' }), 1);

    // detectionContext
    assert.equal(
      listNotificationOutputHistory(context.connection, { detectionContext: 'initial' }).length,
      1,
    );
    assert.equal(
      countNotificationOutputHistory(context.connection, {
        detectionContext: 'initial',
      }),
      1,
    );

    // isTraining
    assert.equal(listNotificationOutputHistory(context.connection, { isTraining: true }).length, 1);
    assert.equal(countNotificationOutputHistory(context.connection, { isTraining: true }), 1);

    // detectedAtFrom / To (inclusive)
    assert.equal(
      listNotificationOutputHistory(context.connection, {
        detectedAtFrom: '2026-09-09T10:00:00Z',
        detectedAtTo: '2026-09-09T11:00:00Z',
      }).length,
      2,
    );
    assert.equal(
      countNotificationOutputHistory(context.connection, {
        detectedAtFrom: '2026-09-09T10:00:00Z',
        detectedAtTo: '2026-09-09T11:00:00Z',
      }),
      2,
    );

    // 複合条件: weather + normal + isTraining: false
    const complexList = listNotificationOutputHistory(context.connection, {
      origin: 'weather',
      detectionContext: 'normal',
      isTraining: false,
    });
    assert.equal(complexList.length, 1);
    assert.equal(complexList[0].notificationId, 'n-1');
    assert.equal(
      countNotificationOutputHistory(context.connection, {
        origin: 'weather',
        detectionContext: 'normal',
        isTraining: false,
      }),
      1,
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('8. isTraining: false が通常通知だけを返し、訓練通知を混入させない。オプション未指定では両方を返す', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-normal',
      isTraining: false,
    });
    recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-training',
      isTraining: true,
    });

    // isTraining: false 指定
    const normalOnly = listNotificationOutputHistory(context.connection, {
      isTraining: false,
    });
    assert.equal(normalOnly.length, 1);
    assert.equal(normalOnly[0].notificationId, 'notif-normal');

    // countNotificationOutputHistory with isTraining: false
    assert.equal(countNotificationOutputHistory(context.connection, { isTraining: false }), 1);

    // 未指定
    const all = listNotificationOutputHistory(context.connection);
    assert.equal(all.length, 2);
    assert.equal(countNotificationOutputHistory(context.connection), 2);

    context.close();
  } finally {
    cleanup();
  }
});

test('9. limit / offset でページングでき、既定 100、limit=5000 は 1000、0・負値は例外になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    for (let i = 1; i <= 5; i++) {
      recordNotificationOutputHistory(context.connection, {
        ...sampleWeatherNotificationInput,
        notificationId: `notif-page-${i}`,
        detectedAt: `2026-09-09T0${i}:00:00Z`,
      });
    }

    const page1 = listNotificationOutputHistory(context.connection, { limit: 2, offset: 0 });
    assert.equal(page1.length, 2);
    assert.equal(page1[0].notificationId, 'notif-page-5');
    assert.equal(page1[1].notificationId, 'notif-page-4');

    const page2 = listNotificationOutputHistory(context.connection, { limit: 2, offset: 2 });
    assert.equal(page2.length, 2);
    assert.equal(page2[0].notificationId, 'notif-page-3');
    assert.equal(page2[1].notificationId, 'notif-page-2');

    // 1000 件を一括挿入して合計 1005 件にし、limit > 1000 の丸め（1000件上限）を厳密に検証
    const insertManyTx = context.connection.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          notificationId: `notif-bulk-${i}`,
          detectedAt: '2026-09-09T00:00:00Z',
        });
      }
    });
    insertManyTx();

    // limit=5000 は 1000 に丸められる（エラーにならず 1000 件が返る）
    const largeLimit = listNotificationOutputHistory(context.connection, { limit: 5000 });
    assert.equal(largeLimit.length, 1000);

    // limit <= 0 は例外
    assert.throws(
      () => {
        listNotificationOutputHistory(context.connection, { limit: 0 });
      },
      { message: /limit must be a positive integer/ },
    );
    assert.throws(
      () => {
        listNotificationOutputHistory(context.connection, { limit: -1 });
      },
      { message: /limit must be a positive integer/ },
    );

    // offset < 0 は例外
    assert.throws(
      () => {
        listNotificationOutputHistory(context.connection, { offset: -1 });
      },
      { message: /offset must be a non-negative integer/ },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('10. 重複 notificationId の記録が失敗し、UPSERT で既存 summary を変更しない', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const initial = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'notif-unique',
      summary: '初期サマリ',
    });

    assert.throws(() => {
      recordNotificationOutputHistory(context.connection, {
        ...sampleWeatherNotificationInput,
        notificationId: 'notif-unique',
        summary: '更新サマリ',
      });
    });

    const fetched = findNotificationOutputHistoryById(context.connection, initial.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.summary, '初期サマリ');

    context.close();
  } finally {
    cleanup();
  }
});

test('11. 非 ISO 時刻、空の必須文字列、不正 origin / detectionContext、定義 ID／版の片方だけを入力すると保存前に例外になる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // 非 ISO 時刻 (occurredAt)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          occurredAt: '2026/09/09 00:00:00',
        });
      },
      { message: /occurredAt must be a UTC ISO 8601 string/ },
    );

    // 非 ISO 時刻 (detectedAt)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          detectedAt: 'invalid-time',
        });
      },
      { message: /detectedAt must be a UTC ISO 8601 string/ },
    );

    // 空の必須文字列 (notificationId)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          notificationId: '   ',
        });
      },
      { message: /notificationId must be a non-empty string/ },
    );

    // 空の必須文字列 (summary)
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          summary: '',
        });
      },
      { message: /summary must be a non-empty string/ },
    );

    // 不正 origin
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          origin: 'invalid_origin' as unknown as NotificationOutputOrigin,
        });
      },
      { message: /Invalid notification origin/ },
    );

    // 不正 detectionContext
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          detectionContext: 'invalid_context' as unknown as NotificationDetectionContext,
        });
      },
      { message: /Invalid notification detectionContext/ },
    );

    // 定義 ID のみ非 NULL
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          messageDefinitionId: 'def-001',
          messageDefinitionVersion: null,
        });
      },
      {
        message:
          /messageDefinitionId and messageDefinitionVersion must both be null or both non-null/,
      },
    );

    // 定義版のみ非 NULL
    assert.throws(
      () => {
        recordNotificationOutputHistory(context.connection, {
          ...sampleWeatherNotificationInput,
          messageDefinitionId: null,
          messageDefinitionVersion: 'v1.0.0',
        });
      },
      {
        message:
          /messageDefinitionId and messageDefinitionVersion must both be null or both non-null/,
      },
    );

    context.close();
  } finally {
    cleanup();
  }
});

test('12. deleteNotificationOutputHistory で対象 1 行だけが消え、存在しない id では false、他の履歴は完全一致で残る', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    const notif1 = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'del-notif-1',
    });
    const notif2 = recordNotificationOutputHistory(context.connection, {
      ...sampleWeatherNotificationInput,
      notificationId: 'del-notif-2',
    });

    // 存在しない ID 削除
    const deleteNonExistent = deleteNotificationOutputHistory(context.connection, 999999);
    assert.strictEqual(deleteNonExistent, false);

    // notif1 を削除
    const deleteResult = deleteNotificationOutputHistory(context.connection, notif1.id);
    assert.strictEqual(deleteResult, true);

    // notif1 は消えている
    assert.strictEqual(findNotificationOutputHistoryById(context.connection, notif1.id), null);

    // notif2 は完全一致で残っている
    const remaining = findNotificationOutputHistoryById(context.connection, notif2.id);
    assert.deepEqual(remaining, notif2);

    context.close();
  } finally {
    cleanup();
  }
});
