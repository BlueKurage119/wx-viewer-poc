import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type NotificationCategory,
  type NotificationTarget,
  type ResolvedNotificationOutputSnapshot,
  type SystemNotification,
  type WeatherNotification,
  type NotificationMessageDefinitionId,
  NotificationMessageResolutionError,
  resolveNotificationMessage,
} from '../src/index.js';

function createWeatherNotification(
  overrides: Partial<WeatherNotification> = {},
): WeatherNotification {
  const defaultTarget: NotificationTarget = {
    kind: 'area',
    codeType: 'jma_municipality',
    code: '1310800',
    name: '江東区',
  };

  return {
    notificationId: 'notif-weather-test-001',
    category: 'question',
    origin: 'weather',

    changeType: 'new',
    sourceType: 'warning_current',
    sourceVersion: 'v1',
    targets: [defaultTarget],
    occurredAt: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:01Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
    ...overrides,
  };
}

function createSystemNotification(overrides: Partial<SystemNotification> = {}): SystemNotification {
  const defaultTarget: NotificationTarget = {
    kind: 'equipment',
    codeType: 'system_component',
    code: 'database-main',
    name: 'メインDB',
  };

  return {
    notificationId: 'notif-system-test-001',
    category: 'warning',
    origin: 'system',
    changeType: 'initialized',
    sourceType: 'database',
    sourceVersion: null,
    targets: [defaultTarget],
    occurredAt: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:02Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
    ...overrides,
  };
}

test('受け入れ条件 1: weather-warning-issued に江東区 target、detail レベル3大雨警報 を渡すと §5.1 と表示3要素・操作・ackRequired・summary・定義ID/版が完全一致する', () => {
  const notification = createWeatherNotification({
    category: 'question',
    origin: 'weather',
    changeType: 'new',
    targets: [
      {
        kind: 'area',
        codeType: 'jma_municipality',
        code: '1310800',
        name: '江東区',
      },
    ],
  });

  const resolved = resolveNotificationMessage(notification, {
    definitionId: 'weather-warning-issued',
    detail: 'レベル3大雨警報',
  });

  // 型テスト: ResolvedNotificationOutputSnapshot の契約を満たすことを静的・動的に確認
  const snapshot: ResolvedNotificationOutputSnapshot = resolved;
  assert.equal(snapshot.messageDefinition.id, 'weather-warning-issued');

  assert.deepEqual(resolved, {
    display: {
      title: '気象警報発表',
      target: '江東区',
      content: 'レベル3大雨警報',
    },
    action: { kind: 'acknowledge', label: '確認' },
    ackRequired: true,
    summary: '気象警報発表\n江東区\nレベル3大雨警報',
    messageDefinition: {
      id: 'weather-warning-issued',
      version: '1',
    },
  });
});

test('受け入れ条件 2: 江東区・大田区の順で targets を渡すと target === "江東区、大田区"、summary === "気象警報発表\\n江東区、大田区\\nレベル3大雨警報" となり順序変更・重複排除がない', () => {
  const targets: readonly [NotificationTarget, NotificationTarget, NotificationTarget] = [
    {
      kind: 'area',
      codeType: 'jma_municipality',
      code: '1310800',
      name: '江東区',
    },
    {
      kind: 'area',
      codeType: 'jma_municipality',
      code: '1311100',
      name: '大田区',
    },
    {
      kind: 'area',
      codeType: 'jma_municipality',
      code: '1310800',
      name: '江東区',
    },
  ];

  const notification = createWeatherNotification({
    category: 'question',
    targets,
  });

  const resolved = resolveNotificationMessage(notification, {
    definitionId: 'weather-warning-issued',
    detail: 'レベル3大雨警報',
  });

  assert.equal(resolved.display.target, '江東区、大田区、江東区');
  assert.equal(resolved.summary, '気象警報発表\n江東区、大田区、江東区\nレベル3大雨警報');

  // 2要素の標準ケースも完全一致確認
  const twoTargetsNotification = createWeatherNotification({
    category: 'question',
    targets: [targets[0], targets[1]],
  });
  const twoTargetsResolved = resolveNotificationMessage(twoTargetsNotification, {
    definitionId: 'weather-warning-issued',
    detail: 'レベル3大雨警報',
  });
  assert.equal(twoTargetsResolved.display.target, '江東区、大田区');
  assert.equal(twoTargetsResolved.summary, '気象警報発表\n江東区、大田区\nレベル3大雨警報');
});

test('受け入れ条件 3: 5つの気象防災速報定義がすべて title "気象防災速報発表" を生成し、content がそれぞれ固定タイトルに完全一致。任意詳細追加で "固定タイトル：任意詳細" になる', () => {
  const testCases: Array<{
    definitionId: NotificationMessageDefinitionId;
    expectedContent: string;
  }> = [
    {
      definitionId: 'weather-bosai-bulletin-linear-rainband-observed',
      expectedContent: '線状降水帯発生',
    },
    {
      definitionId: 'weather-bosai-bulletin-linear-rainband-forecast',
      expectedContent: '線状降水帯直前予測',
    },
    {
      definitionId: 'weather-bosai-bulletin-record-short-rain',
      expectedContent: '記録的短時間大雨',
    },
    {
      definitionId: 'weather-bosai-bulletin-tornado-warning',
      expectedContent: '竜巻注意',
    },
    {
      definitionId: 'weather-bosai-bulletin-tornado-sighting',
      expectedContent: '竜巻目撃',
    },
  ];

  for (const { definitionId, expectedContent } of testCases) {
    const notification = createWeatherNotification({
      category: 'question',
      changeType: 'new',
    });

    const resolvedWithoutDetail = resolveNotificationMessage(notification, {
      definitionId,
    });

    assert.equal(resolvedWithoutDetail.display.title, '気象防災速報発表');
    assert.equal(resolvedWithoutDetail.display.content, expectedContent);
    assert.equal(resolvedWithoutDetail.action?.kind, 'acknowledge');
    assert.equal(resolvedWithoutDetail.action?.label, '確認');
    assert.equal(resolvedWithoutDetail.ackRequired, true);
    assert.equal(
      resolvedWithoutDetail.summary,
      `気象防災速報発表\n${notification.targets[0].name}\n${expectedContent}`,
    );
  }

  // 任意詳細「東京都東部」を追加した1ケース
  const notificationWithDetail = createWeatherNotification({
    category: 'question',
    changeType: 'new',
  });
  const resolvedWithDetail = resolveNotificationMessage(notificationWithDetail, {
    definitionId: 'weather-bosai-bulletin-linear-rainband-observed',
    detail: '東京都東部',
  });
  assert.equal(resolvedWithDetail.display.title, '気象防災速報発表');
  assert.equal(resolvedWithDetail.display.content, '線状降水帯発生：東京都東部');
  assert.equal(
    resolvedWithDetail.summary,
    `気象防災速報発表\n${notificationWithDetail.targets[0].name}\n線状降水帯発生：東京都東部`,
  );
});

test('受け入れ条件 4: weather-advisory-issued と weather-warning-released は操作なし/ackRequired false、weather-special-warning-issued は確認操作/ackRequired true', () => {
  const advisoryNotif = createWeatherNotification({ category: 'warning', changeType: 'new' });
  const advisoryResolved = resolveNotificationMessage(advisoryNotif, {
    definitionId: 'weather-advisory-issued',
  });
  assert.equal(advisoryResolved.action, null);
  assert.equal(advisoryResolved.ackRequired, false);
  assert.equal(advisoryResolved.display.title, '気象注意報発表');

  const releasedNotif = createWeatherNotification({ category: 'warning', changeType: 'released' });
  const releasedResolved = resolveNotificationMessage(releasedNotif, {
    definitionId: 'weather-warning-released',
  });
  assert.equal(releasedResolved.action, null);
  assert.equal(releasedResolved.ackRequired, false);
  assert.equal(releasedResolved.display.title, '気象警報等解除');

  const specialNotif = createWeatherNotification({ category: 'emergency', changeType: 'new' });
  const specialResolved = resolveNotificationMessage(specialNotif, {
    definitionId: 'weather-special-warning-issued',
  });
  assert.deepEqual(specialResolved.action, { kind: 'acknowledge', label: '確認' });
  assert.equal(specialResolved.ackRequired, true);
  assert.equal(specialResolved.display.title, '気象特別警報発表');
});

test('受け入れ条件 5: weather-warning-strengthened / weather-warning-weakened は category に応じて操作と ackRequired を決定し、changeType 不一致を拒否する', () => {
  const definitions: readonly ['weather-warning-strengthened', 'weather-warning-weakened'] = [
    'weather-warning-strengthened',
    'weather-warning-weakened',
  ];

  for (const definitionId of definitions) {
    const changeType =
      definitionId === 'weather-warning-strengthened' ? 'strengthened' : 'weakened';

    // warning => action: null, ackRequired: false
    const warnNotif = createWeatherNotification({ category: 'warning', changeType });
    const warnResolved = resolveNotificationMessage(warnNotif, { definitionId });
    assert.equal(warnResolved.action, null);
    assert.equal(warnResolved.ackRequired, false);

    // question => action: acknowledge, ackRequired: true
    const questionNotif = createWeatherNotification({ category: 'question', changeType });
    const questionResolved = resolveNotificationMessage(questionNotif, { definitionId });
    assert.deepEqual(questionResolved.action, { kind: 'acknowledge', label: '確認' });
    assert.equal(questionResolved.ackRequired, true);

    // emergency => action: acknowledge, ackRequired: true
    const emergencyNotif = createWeatherNotification({ category: 'emergency', changeType });
    const emergencyResolved = resolveNotificationMessage(emergencyNotif, { definitionId });
    assert.deepEqual(emergencyResolved.action, { kind: 'acknowledge', label: '確認' });
    assert.equal(emergencyResolved.ackRequired, true);

    // 異なる changeType は拒否 (notification_mismatch)
    const mismatchNotif = createWeatherNotification({ category: 'warning', changeType: 'new' });
    assert.throws(
      () => resolveNotificationMessage(mismatchNotif, { definitionId }),
      (err: unknown) => {
        assert.ok(err instanceof NotificationMessageResolutionError);
        assert.equal(err.code, 'notification_mismatch');
        assert.equal(err.definitionId, definitionId);
        return true;
      },
    );
  }
});

test('受け入れ条件 6: システム通知10種の表駆動テスト（title, 許容category, 操作, 確認要否, 対象方式, 定義ID/版）', () => {
  interface SystemTestCase {
    readonly definitionId: NotificationMessageDefinitionId;
    readonly category: NotificationCategory;
    readonly expectedTitle: string;
    readonly expectedAckRequired: boolean;
    readonly expectedAction: { kind: 'acknowledge'; label: '確認' } | null;
    readonly targetMode: 'notificationTargets' | 'notificationTargetsOmittable' | 'fixed';
  }

  const cases: readonly SystemTestCase[] = [
    {
      definitionId: 'system-data-fetch-delayed',
      category: 'warning',
      expectedTitle: 'データ取得遅延',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'notificationTargets',
    },
    {
      definitionId: 'system-data-fetch-failed',
      category: 'question',
      expectedTitle: 'データ取得異常',
      expectedAckRequired: true,
      expectedAction: { kind: 'acknowledge', label: '確認' },
      targetMode: 'notificationTargets',
    },
    {
      definitionId: 'system-database-initialized',
      category: 'warning',
      expectedTitle: 'DB初期化完了',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'notificationTargetsOmittable',
    },
    {
      definitionId: 'system-database-initialization-failed',
      category: 'question',
      expectedTitle: 'DB初期化異常終了',
      expectedAckRequired: true,
      expectedAction: { kind: 'acknowledge', label: '確認' },
      targetMode: 'notificationTargets',
    },
    {
      definitionId: 'system-service-stopped',
      category: 'question',
      expectedTitle: 'サービス停止',
      expectedAckRequired: true,
      expectedAction: { kind: 'acknowledge', label: '確認' },
      targetMode: 'fixed',
    },
    {
      definitionId: 'system-operation-mode-changed',
      category: 'warning',
      expectedTitle: '運転モード切替',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'fixed',
    },
    {
      definitionId: 'system-fetch-manually-stopped',
      category: 'warning',
      expectedTitle: '取得手動停止',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'notificationTargetsOmittable',
    },
    {
      definitionId: 'system-fetch-manually-started',
      category: 'warning',
      expectedTitle: '取得手動開始',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'notificationTargetsOmittable',
    },
    {
      definitionId: 'system-force-fetch-completed',
      category: 'warning',
      expectedTitle: '強制取得完了',
      expectedAckRequired: false,
      expectedAction: null,
      targetMode: 'notificationTargetsOmittable',
    },
    {
      definitionId: 'system-force-fetch-failed',
      category: 'question',
      expectedTitle: '強制取得失敗',
      expectedAckRequired: true,
      expectedAction: { kind: 'acknowledge', label: '確認' },
      targetMode: 'notificationTargets',
    },
  ];

  for (const tc of cases) {
    const notification = createSystemNotification({
      category: tc.category,
      targets: [
        {
          kind: 'equipment',
          codeType: 'system_component',
          code: 'target-01',
          name: '対象名A',
        },
      ],
    });

    const resolved = resolveNotificationMessage(notification, {
      definitionId: tc.definitionId,
    });

    assert.equal(resolved.display.title, tc.expectedTitle);
    assert.equal(resolved.ackRequired, tc.expectedAckRequired);
    assert.deepEqual(resolved.action, tc.expectedAction);
    assert.deepEqual(resolved.messageDefinition, {
      id: tc.definitionId,
      version: '1',
    });

    if (tc.targetMode === 'fixed') {
      assert.equal(resolved.display.target, '防災気象情報');
      assert.equal(resolved.summary, `${tc.expectedTitle}\n防災気象情報`);
    } else {
      assert.equal(resolved.display.target, '対象名A');
      assert.equal(resolved.summary, `${tc.expectedTitle}\n対象名A`);
    }
  }
});

test('受け入れ条件 7: サービス停止と運転モード切替は Notification.targets の名称にかかわらず target "防災気象情報" を生成する。運転モード切替の detail を省略でき、渡された場合は改変しない', () => {
  const stoppedNotif = createSystemNotification({
    category: 'question',
    targets: [
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'random-equipment',
        name: '任意装置名',
      },
    ],
  });
  const stoppedResolved = resolveNotificationMessage(stoppedNotif, {
    definitionId: 'system-service-stopped',
  });
  assert.equal(stoppedResolved.display.target, '防災気象情報');
  assert.equal(stoppedResolved.display.content, null);
  assert.equal(stoppedResolved.summary, 'サービス停止\n防災気象情報');

  // 運転モード切替: detail 省略
  const modeNotif = createSystemNotification({
    category: 'warning',
    targets: [
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'random-equipment',
        name: '任意装置名',
      },
    ],
  });
  const modeResolvedNoDetail = resolveNotificationMessage(modeNotif, {
    definitionId: 'system-operation-mode-changed',
  });
  assert.equal(modeResolvedNoDetail.display.target, '防災気象情報');
  assert.equal(modeResolvedNoDetail.display.content, null);
  assert.equal(modeResolvedNoDetail.summary, '運転モード切替\n防災気象情報');

  // 運転モード切替: detail "モード：手動" を渡した場合、改変しない
  const modeResolvedWithDetail = resolveNotificationMessage(modeNotif, {
    definitionId: 'system-operation-mode-changed',
    detail: 'モード：手動',
  });
  assert.equal(modeResolvedWithDetail.display.target, '防災気象情報');
  assert.equal(modeResolvedWithDetail.display.content, 'モード：手動');
  assert.equal(modeResolvedWithDetail.summary, '運転モード切替\n防災気象情報\nモード：手動');
});

test('受け入れ条件 8: DB初期化完了、取得手動停止、取得手動開始、強制取得完了は omitTarget: true で target null。他の定義で同指定を行うと target_omission_not_allowed になる', () => {
  const omittableIds: readonly NotificationMessageDefinitionId[] = [
    'system-database-initialized',
    'system-fetch-manually-stopped',
    'system-fetch-manually-started',
    'system-force-fetch-completed',
  ];

  for (const definitionId of omittableIds) {
    const notification = createSystemNotification({ category: 'warning' });
    const resolved = resolveNotificationMessage(notification, {
      definitionId,
      omitTarget: true,
    });
    assert.equal(resolved.display.target, null);
    assert.equal(resolved.summary, resolved.display.title);
  }

  // 他の定義で omitTarget: true を指定した場合は target_omission_not_allowed
  const notOmittableWeather = createWeatherNotification({ category: 'question' });
  assert.throws(
    () =>
      resolveNotificationMessage(notOmittableWeather, {
        definitionId: 'weather-warning-issued',
        omitTarget: true,
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'target_omission_not_allowed');
      assert.equal(err.definitionId, 'weather-warning-issued');
      return true;
    },
  );

  const notOmittableSystem = createSystemNotification({ category: 'question' });
  assert.throws(
    () =>
      resolveNotificationMessage(notOmittableSystem, {
        definitionId: 'system-database-initialization-failed',
        omitTarget: true,
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'target_omission_not_allowed');
      assert.equal(err.definitionId, 'system-database-initialization-failed');
      return true;
    },
  );

  const fixedSystem = createSystemNotification({ category: 'question' });
  assert.throws(
    () =>
      resolveNotificationMessage(fixedSystem, {
        definitionId: 'system-service-stopped',
        omitTarget: true,
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'target_omission_not_allowed');
      assert.equal(err.definitionId, 'system-service-stopped');
      return true;
    },
  );
});

test('受け入れ条件 9: detail 省略許容、空文字/空白のみ/CRLF は invalid_detail、対象名の空白のみ/CRLF は invalid_target_name', () => {
  const notification = createWeatherNotification({ category: 'question' });

  // detail 省略は許容
  const okResolved = resolveNotificationMessage(notification, {
    definitionId: 'weather-warning-issued',
  });
  assert.equal(okResolved.display.content, null);

  // 空文字
  assert.throws(
    () =>
      resolveNotificationMessage(notification, {
        definitionId: 'weather-warning-issued',
        detail: '',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_detail');
      assert.equal(err.definitionId, 'weather-warning-issued');
      return true;
    },
  );

  // 空白のみ
  assert.throws(
    () =>
      resolveNotificationMessage(notification, {
        definitionId: 'weather-warning-issued',
        detail: '   \t  ',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_detail');
      return true;
    },
  );

  // LF を含む detail
  assert.throws(
    () =>
      resolveNotificationMessage(notification, {
        definitionId: 'weather-warning-issued',
        detail: '警報\n詳細',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_detail');
      return true;
    },
  );

  // CR を含む detail
  assert.throws(
    () =>
      resolveNotificationMessage(notification, {
        definitionId: 'weather-warning-issued',
        detail: '警報\r詳細',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_detail');
      return true;
    },
  );

  // 対象名が空白のみ
  const blankTargetNotif = createWeatherNotification({
    category: 'question',
    targets: [{ kind: 'area', codeType: 'test', code: '01', name: '   ' }],
  });
  assert.throws(
    () =>
      resolveNotificationMessage(blankTargetNotif, {
        definitionId: 'weather-warning-issued',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_target_name');
      assert.equal(err.definitionId, 'weather-warning-issued');
      return true;
    },
  );

  // 対象名に LF を含む
  const lfTargetNotif = createWeatherNotification({
    category: 'question',
    targets: [{ kind: 'area', codeType: 'test', code: '01', name: '江東\n区' }],
  });
  assert.throws(
    () =>
      resolveNotificationMessage(lfTargetNotif, {
        definitionId: 'weather-warning-issued',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_target_name');
      return true;
    },
  );

  // 対象名に CR を含む
  const crTargetNotif = createWeatherNotification({
    category: 'question',
    targets: [{ kind: 'area', codeType: 'test', code: '01', name: '江東\r区' }],
  });
  assert.throws(
    () =>
      resolveNotificationMessage(crTargetNotif, {
        definitionId: 'weather-warning-issued',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'invalid_target_name');
      return true;
    },
  );
});

test('受け入れ条件 10: 存在しない定義 ID は definition_not_found、origin/category/changeType 不一致は notification_mismatch', () => {
  const weatherNotif = createWeatherNotification({ category: 'question', changeType: 'new' });

  // 存在しない定義 ID
  assert.throws(
    () =>
      resolveNotificationMessage(weatherNotif, {
        definitionId: 'unknown-definition-id' as NotificationMessageDefinitionId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'definition_not_found');
      assert.equal(err.definitionId, 'unknown-definition-id');
      return true;
    },
  );

  // weather 定義に origin: 'system' を渡す
  const systemNotif = createSystemNotification({ category: 'question' });
  assert.throws(
    () =>
      resolveNotificationMessage(systemNotif, {
        definitionId: 'weather-warning-issued',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'notification_mismatch');
      assert.equal(err.definitionId, 'weather-warning-issued');
      return true;
    },
  );

  // system 定義に origin: 'weather' を渡す
  assert.throws(
    () =>
      resolveNotificationMessage(weatherNotif, {
        definitionId: 'system-database-initialized',
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'notification_mismatch');
      assert.equal(err.definitionId, 'system-database-initialized');
      return true;
    },
  );

  // category 不一致
  const emergencyWeather = createWeatherNotification({ category: 'emergency', changeType: 'new' });
  assert.throws(
    () =>
      resolveNotificationMessage(emergencyWeather, {
        definitionId: 'weather-advisory-issued', // 要求は warning
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'notification_mismatch');
      return true;
    },
  );

  // 気象系 changeType 不一致
  const strengthenedWeather = createWeatherNotification({
    category: 'question',
    changeType: 'strengthened',
  });
  assert.throws(
    () =>
      resolveNotificationMessage(strengthenedWeather, {
        definitionId: 'weather-warning-issued', // 要求は new
      }),
    (err: unknown) => {
      assert.ok(err instanceof NotificationMessageResolutionError);
      assert.equal(err.code, 'notification_mismatch');
      return true;
    },
  );
});

test('受け入れ条件 11: isTraining: true と false で同じ定義・表示文言を生成し、入力の isTraining 自体は変更しない', () => {
  const regularNotif = createWeatherNotification({
    category: 'question',
    changeType: 'new',
    isTraining: false,
  });
  const trainingNotif = createWeatherNotification({
    category: 'question',
    changeType: 'new',
    isTraining: true,
  });

  const resolvedRegular = resolveNotificationMessage(regularNotif, {
    definitionId: 'weather-warning-issued',
    detail: 'レベル3大雨警報',
  });
  const resolvedTraining = resolveNotificationMessage(trainingNotif, {
    definitionId: 'weather-warning-issued',
    detail: 'レベル3大雨警報',
  });

  assert.deepEqual(resolvedRegular, resolvedTraining);
  assert.equal(regularNotif.isTraining, false);
  assert.equal(trainingNotif.isTraining, true);
});

test('設計書 §4.2: 例外メッセージに任意詳細や対象名が含まれず、ログへの露出がない', () => {
  const sensitiveDetail = 'SECRET_DETAIL_INFORMATION';
  const sensitiveTargetName = 'SECRET_TARGET_NAME';

  const notif = createWeatherNotification({
    category: 'question',
    targets: [{ kind: 'area', codeType: 'test', code: '01', name: `${sensitiveTargetName}\nLF` }],
  });

  try {
    resolveNotificationMessage(notif, {
      definitionId: 'weather-warning-issued',
      detail: `${sensitiveDetail}\nLF`,
    });
    assert.fail('Should throw');
  } catch (err) {
    assert.ok(err instanceof NotificationMessageResolutionError);
    assert.equal(err.message.includes(sensitiveDetail), false);
    assert.equal(err.message.includes(sensitiveTargetName), false);
  }
});
