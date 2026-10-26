import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NotificationDeltaCursor,
  NotificationFeedItem,
  NotificationTarget,
} from '@wx-viewer-poc/shared';
import {
  createNotificationUiState,
  discardPreviousGeneration,
  displayedNoticeForRow,
  markAlerted,
  notificationCounts,
  receiveNotifications,
  resolvedAbnormalFeedKeys,
  restoreAlertedFeedKeys,
} from '../src/notifications/notificationStore.ts';
import {
  ALERTED_FEED_KEYS_LIMIT,
  ALERTED_FEED_KEYS_STORAGE_KEY,
  createAlertedFeedKeyRepository,
} from '../src/notifications/alertedFeedKeyStore.ts';
import { createNotificationFeedController } from '../src/notifications/notificationFeedController.ts';
import type { NotificationDeltaClientResult } from '../src/api/notificationDelta.ts';

function createSystemNotice(params: {
  feedKey: string;
  sourceType: string;
  changeType: string;
  category?: NotificationFeedItem['category'];
  targets?: readonly [NotificationTarget, ...NotificationTarget[]];
  occurredAt?: string;
  sequence?: number | null;
  ackRequired?: boolean;
}): NotificationFeedItem {
  return {
    feedKey: params.feedKey,
    source: 'delta',
    sequence: params.sequence ?? 1,
    category:
      params.category ??
      (params.changeType.includes('failed') || params.changeType.includes('abnormal')
        ? 'question'
        : 'warning'),
    origin: 'system',
    detectionContext: 'normal',
    changeType: params.changeType,
    sourceType: params.sourceType,
    sourceVersion: null,
    targets: params.targets ?? [
      {
        kind: 'equipment',
        codeType: 'wx-viewer-poc/fetch-source',
        code: 'jma_xml_feed',
        name: '気象庁XMLフィード',
      },
    ],
    occurredAt: params.occurredAt ?? '2026-10-26T00:00:00.000Z',
    detectedAt: params.occurredAt ?? '2026-10-26T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired:
      params.ackRequired ??
      (params.changeType.includes('failed') || params.changeType.includes('abnormal')),
    summary: params.feedKey,
    display: null,
    messageDefinition: null,
    venueScope: 'venue',
  };
}

function createWeatherNotice(params: {
  feedKey: string;
  category?: NotificationFeedItem['category'];
  occurredAt?: string;
}): NotificationFeedItem {
  return {
    feedKey: params.feedKey,
    source: params.feedKey.startsWith('startup:') ? 'startup' : 'delta',
    sequence: params.feedKey.startsWith('startup:') ? null : 1,
    category: params.category ?? 'warning',
    origin: 'weather',
    detectionContext: 'normal',
    changeType: 'new',
    sourceType: 'warning_current',
    sourceVersion: null,
    targets: [{ kind: 'area', codeType: 'test', code: '1', name: '対象' }],
    occurredAt: params.occurredAt ?? '2026-10-26T00:00:00.000Z',
    detectedAt: params.occurredAt ?? '2026-10-26T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired: true,
    summary: params.feedKey,
    display: null,
    messageDefinition: null,
    venueScope: 'venue',
  };
}

// ---------------------------------------------------------------------------
// 1. 単体: 解消済み異常は鳴らない
// ---------------------------------------------------------------------------
test('受け入れ条件1: 単体: 解消済み異常は鳴らない', () => {
  const abnormal = createSystemNotice({
    feedKey: 'delta:abnormal-1',
    sourceType: 'fetch_health',
    changeType: 'fetch_abnormal',
    category: 'question',
    occurredAt: '2026-10-26T01:00:00.000Z',
    sequence: 1,
    ackRequired: true,
  });
  const recovered = createSystemNotice({
    feedKey: 'delta:recovered-1',
    sourceType: 'fetch_health',
    changeType: 'fetch_recovered',
    category: 'warning',
    occurredAt: '2026-10-26T01:00:30.000Z',
    sequence: 2,
    ackRequired: false,
  });

  const state = createNotificationUiState();
  const { state: nextState, chime } = receiveNotifications(
    state,
    [abnormal, recovered],
    'K',
    Date.parse('2026-10-26T01:01:00.000Z'),
    undefined,
    { initialFetch: true },
  );

  // 異常の feedKey が historyOnlyFeedKeys に入る
  assert.equal(nextState.historyOnlyFeedKeys.has(abnormal.feedKey), true);
  assert.equal(nextState.historyOnlyFeedKeys.has(recovered.feedKey), false);

  // chime 候補に現れず (chime は recovered のものになる)
  assert.equal(chime?.feedKey, recovered.feedKey);

  // displayedNoticeForRow に現れず
  assert.equal(displayedNoticeForRow(nextState, 'K', 'question'), undefined);

  // 未確認件数に現れず (pending は 0)
  const counts = notificationCounts(nextState, 'K');
  assert.equal(counts.pending, 0);

  // warningHistory には含まれる
  const inHistory = nextState.warningHistory.some((e) => e.item.feedKey === abnormal.feedKey);
  assert.equal(inHistory, true);
});

// ---------------------------------------------------------------------------
// 2. 単体: 未解消の異常は鳴る
// ---------------------------------------------------------------------------
test('受け入れ条件2: 単体: 未解消の異常は鳴る (単独・逆順・別系統)', () => {
  const time1 = '2026-10-26T01:00:00.000Z';
  const time2 = '2026-10-26T01:00:30.000Z';

  // (a) fetch_abnormal だけの取得分
  {
    const abnormal = createSystemNotice({
      feedKey: 'delta:abnormal-only',
      sourceType: 'fetch_health',
      changeType: 'fetch_abnormal',
      category: 'question',
      occurredAt: time1,
      sequence: 1,
    });
    const state = createNotificationUiState();
    const { state: nextState, chime } = receiveNotifications(
      state,
      [abnormal],
      'K',
      Date.parse('2026-10-26T01:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    assert.equal(chime?.feedKey, abnormal.feedKey);
    assert.equal(displayedNoticeForRow(nextState, 'K', 'question')?.feedKey, abnormal.feedKey);
    assert.equal(nextState.historyOnlyFeedKeys.has(abnormal.feedKey), false);
  }

  // (b) 順序が逆 (復帰が先、異常が後) の場合
  {
    const recoveredEarlier = createSystemNotice({
      feedKey: 'delta:recovered-early',
      sourceType: 'fetch_health',
      changeType: 'fetch_recovered',
      category: 'warning',
      occurredAt: time1,
      sequence: 1,
    });
    const abnormalLater = createSystemNotice({
      feedKey: 'delta:abnormal-late',
      sourceType: 'fetch_health',
      changeType: 'fetch_abnormal',
      category: 'question',
      occurredAt: time2,
      sequence: 2,
    });
    const state = createNotificationUiState();
    const { state: nextState, chime } = receiveNotifications(
      state,
      [recoveredEarlier, abnormalLater],
      'K',
      Date.parse('2026-10-26T01:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    // 異常の方が後なので未解消として鳴る
    assert.equal(nextState.historyOnlyFeedKeys.has(abnormalLater.feedKey), false);
    assert.equal(chime?.feedKey, abnormalLater.feedKey);
    assert.equal(displayedNoticeForRow(nextState, 'K', 'question')?.feedKey, abnormalLater.feedKey);
  }

  // (c) 別系統の復帰しかない場合
  {
    const targetSourceA: readonly [NotificationTarget, ...NotificationTarget[]] = [
      {
        kind: 'equipment',
        codeType: 'wx-viewer-poc/fetch-source',
        code: 'source-a',
        name: '系統A',
      },
    ];
    const targetSourceB: readonly [NotificationTarget, ...NotificationTarget[]] = [
      {
        kind: 'equipment',
        codeType: 'wx-viewer-poc/fetch-source',
        code: 'source-b',
        name: '系統B',
      },
    ];
    const abnormalA = createSystemNotice({
      feedKey: 'delta:abnormal-a',
      sourceType: 'fetch_health',
      changeType: 'fetch_abnormal',
      category: 'question',
      targets: targetSourceA,
      occurredAt: time1,
      sequence: 1,
    });
    const recoveredB = createSystemNotice({
      feedKey: 'delta:recovered-b',
      sourceType: 'fetch_health',
      changeType: 'fetch_recovered',
      category: 'warning',
      targets: targetSourceB,
      occurredAt: time2,
      sequence: 2,
    });
    const state = createNotificationUiState();
    const { state: nextState, chime } = receiveNotifications(
      state,
      [abnormalA, recoveredB],
      'K',
      Date.parse('2026-10-26T01:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    // 系統が異なるため abnormalA は解消されず鳴る
    assert.equal(nextState.historyOnlyFeedKeys.has(abnormalA.feedKey), false);
    assert.equal(displayedNoticeForRow(nextState, 'K', 'question')?.feedKey, abnormalA.feedKey);
    assert.equal(chime?.feedKey, abnormalA.feedKey);
  }
});

// ---------------------------------------------------------------------------
// 3. 単体: 情報系は一度だけ鳴る
// ---------------------------------------------------------------------------
test('受け入れ条件3: 単体: 情報系は一度だけ鳴る', () => {
  const forceFetchNotice = createSystemNotice({
    feedKey: 'delta:force-fetch-1',
    sourceType: 'fetch_control',
    changeType: 'force_fetch_completed',
    category: 'warning',
    ackRequired: false,
  });

  const state = createNotificationUiState();
  const first = receiveNotifications(
    state,
    [forceFetchNotice],
    'K',
    Date.parse('2026-10-26T01:00:00.000Z'),
    undefined,
    { initialFetch: true },
  );

  // chime が返る
  assert.equal(first.chime?.feedKey, forceFetchNotice.feedKey);
  // ブザーの対象にした時点で alertedFeedKeys に入る
  assert.equal(first.state.alertedFeedKeys.has(forceFetchNotice.feedKey), true);

  // 新着に chime 候補が複数ある場合 (例: 復帰2件と DB初期化開始1件)
  const recoveryA = createSystemNotice({
    feedKey: 'delta:rec-a',
    sourceType: 'fetch_health',
    changeType: 'fetch_recovered',
    category: 'warning',
    occurredAt: '2026-10-26T01:00:00.000Z',
    sequence: 1,
  });
  const recoveryB = createSystemNotice({
    feedKey: 'delta:rec-b',
    sourceType: 'fetch_health',
    changeType: 'fetch_recovered',
    category: 'warning',
    targets: [
      {
        kind: 'equipment',
        codeType: 'wx-viewer-poc/fetch-source',
        code: 'jma_xml_feed_2',
        name: '2',
      },
    ],
    occurredAt: '2026-10-26T01:00:01.000Z',
    sequence: 2,
  });
  const dbStart = createSystemNotice({
    feedKey: 'delta:db-start',
    sourceType: 'database_recovery',
    changeType: 'database_recovery_started',
    category: 'warning',
    occurredAt: '2026-10-26T01:00:02.000Z',
    sequence: 3,
  });

  const multiArrival = receiveNotifications(
    state,
    [recoveryA, recoveryB, dbStart],
    'K',
    Date.parse('2026-10-26T01:01:00.000Z'),
    undefined,
    { initialFetch: true },
  );

  // 鳴るのは1件だが、候補全件が記録される
  assert.notEqual(multiArrival.chime, null);
  assert.equal(multiArrival.state.alertedFeedKeys.has(recoveryA.feedKey), true);
  assert.equal(multiArrival.state.alertedFeedKeys.has(recoveryB.feedKey), true);
  assert.equal(multiArrival.state.alertedFeedKeys.has(dbStart.feedKey), true);

  // 同じ feedKey を含む取得分を再度 (initialFetch の有無の両方で) 受信させても、chime === null で通知エリアに出ない
  // 鳴動済み記録を持つ状態（リロード復元時）での再受信検証:
  const restoredState = restoreAlertedFeedKeys(
    createNotificationUiState(),
    Array.from(first.state.alertedFeedKeys),
  );

  // (1) initialFetch: true で再受信
  {
    const rerun = receiveNotifications(
      restoredState,
      [forceFetchNotice],
      'K',
      Date.parse('2026-10-26T01:02:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    assert.equal(rerun.chime, null);
    assert.equal(displayedNoticeForRow(rerun.state, 'K', 'warning'), undefined);
  }

  // (2) initialFetch: false / 省略で再受信
  {
    const rerun = receiveNotifications(
      restoredState,
      [forceFetchNotice],
      'K',
      Date.parse('2026-10-26T01:02:00.000Z'),
    );
    assert.equal(rerun.chime, null);
    assert.equal(displayedNoticeForRow(rerun.state, 'K', 'warning'), undefined);
  }
});

// ---------------------------------------------------------------------------
// 4. 単体: 対応表
// ---------------------------------------------------------------------------
test('受け入れ条件4: 単体: 対応表の各行パラメータ化テスト', () => {
  const venueTargets: readonly [NotificationTarget, ...NotificationTarget[]] = [
    { kind: 'equipment', codeType: 'venue', code: 'east', name: '東会場' },
  ];
  const workerTargets: readonly [NotificationTarget, ...NotificationTarget[]] = [
    { kind: 'equipment', codeType: 'wx-viewer-poc/service', code: 'delivery', name: '提供系' },
  ];

  interface MatrixTestCase {
    name: string;
    abnormal: NotificationFeedItem;
    resolver?: NotificationFeedItem;
    shouldBeResolved: boolean;
  }

  const cases: MatrixTestCase[] = [
    // fetch_health
    {
      name: 'fetch_abnormal + fetch_recovered',
      abnormal: createSystemNotice({
        feedKey: 'delta:ab-1',
        sourceType: 'fetch_health',
        changeType: 'fetch_abnormal',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:rec-1',
        sourceType: 'fetch_health',
        changeType: 'fetch_recovered',
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    {
      name: 'fetch_delayed + fetch_recovered',
      abnormal: createSystemNotice({
        feedKey: 'delta:del-1',
        sourceType: 'fetch_health',
        changeType: 'fetch_delayed',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:rec-1',
        sourceType: 'fetch_health',
        changeType: 'fetch_recovered',
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    // database_recovery
    {
      name: 'database_recovery_delayed + database_recovery_completed',
      abnormal: createSystemNotice({
        feedKey: 'delta:db-del-1',
        sourceType: 'database_recovery',
        changeType: 'database_recovery_delayed',
        targets: venueTargets,
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:db-comp-1',
        sourceType: 'database_recovery',
        changeType: 'database_recovery_completed',
        targets: venueTargets,
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    {
      name: 'database_recovery_failed (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:db-fail-1',
        sourceType: 'database_recovery',
        changeType: 'database_recovery_failed',
        targets: venueTargets,
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:db-comp-1',
        sourceType: 'database_recovery',
        changeType: 'database_recovery_completed',
        targets: venueTargets,
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: false,
    },
    // weather_worker
    {
      name: 'weather_worker report_stale + restart_completed',
      abnormal: createSystemNotice({
        feedKey: 'delta:ww-stale',
        sourceType: 'weather_worker',
        changeType: 'report_stale',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:ww-rest',
        sourceType: 'weather_worker',
        changeType: 'restart_completed',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    {
      name: 'weather_worker initialization_failed + restart_completed',
      abnormal: createSystemNotice({
        feedKey: 'delta:ww-init-fail',
        sourceType: 'weather_worker',
        changeType: 'initialization_failed',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:ww-rest',
        sourceType: 'weather_worker',
        changeType: 'restart_completed',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    {
      name: 'weather_worker worker_exited (任意停止理由コード) + restart_completed',
      abnormal: createSystemNotice({
        feedKey: 'delta:ww-exit',
        sourceType: 'weather_worker',
        changeType: 'worker_exited',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      resolver: createSystemNotice({
        feedKey: 'delta:ww-rest',
        sourceType: 'weather_worker',
        changeType: 'restart_completed',
        targets: workerTargets,
        occurredAt: '2026-10-26T00:00:02.000Z',
        sequence: 2,
      }),
      shouldBeResolved: true,
    },
    // fetch_control (対応先なし)
    {
      name: 'fetch_operation_unknown (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:fc-op-unk',
        sourceType: 'fetch_control',
        changeType: 'fetch_operation_unknown',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
    {
      name: 'force_fetch_failed (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:fc-ff-fail',
        sourceType: 'fetch_control',
        changeType: 'force_fetch_failed',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
    {
      name: 'force_fetch_aborted (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:fc-ff-ab',
        sourceType: 'fetch_control',
        changeType: 'force_fetch_aborted',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
    {
      name: 'service_stopped (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:fc-srv-stop',
        sourceType: 'fetch_control',
        changeType: 'service_stopped',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
    // initial_sync (対応先なし)
    {
      name: 'initial_sync_failed (対応先なし)',
      abnormal: createSystemNotice({
        feedKey: 'delta:is-fail',
        sourceType: 'initial_sync',
        changeType: 'initial_sync_failed',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
    // 架空の種別
    {
      name: '架空の sourceType (unknown_source)',
      abnormal: createSystemNotice({
        feedKey: 'delta:unk-source',
        sourceType: 'unknown_source',
        changeType: 'unknown_abnormal',
        occurredAt: '2026-10-26T00:00:01.000Z',
        sequence: 1,
      }),
      shouldBeResolved: false,
    },
  ];

  for (const tc of cases) {
    const items = tc.resolver ? [tc.abnormal, tc.resolver] : [tc.abnormal];
    const resolved = resolvedAbnormalFeedKeys(items);
    assert.equal(resolved.has(tc.abnormal.feedKey), tc.shouldBeResolved, `Case failed: ${tc.name}`);

    const state = createNotificationUiState();
    const { state: nextState } = receiveNotifications(
      state,
      items,
      'K',
      Date.parse('2026-10-26T00:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    assert.equal(
      nextState.historyOnlyFeedKeys.has(tc.abnormal.feedKey),
      tc.shouldBeResolved,
      `historyOnly check failed for: ${tc.name}`,
    );
  }

  // database_recovery_started は、後に database_recovery_completed があっても鳴る
  {
    const started = createSystemNotice({
      feedKey: 'delta:db-started',
      sourceType: 'database_recovery',
      changeType: 'database_recovery_started',
      category: 'warning',
      targets: venueTargets,
      occurredAt: '2026-10-26T00:00:01.000Z',
      sequence: 1,
    });
    const completed = createSystemNotice({
      feedKey: 'delta:db-completed',
      sourceType: 'database_recovery',
      changeType: 'database_recovery_completed',
      category: 'warning',
      targets: venueTargets,
      occurredAt: '2026-10-26T00:00:02.000Z',
      sequence: 2,
    });
    const resolved = resolvedAbnormalFeedKeys([started, completed]);
    assert.equal(resolved.has(started.feedKey), false);

    const state = createNotificationUiState();
    const { state: nextState } = receiveNotifications(
      state,
      [started, completed],
      'K',
      Date.parse('2026-10-26T00:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    assert.equal(nextState.historyOnlyFeedKeys.has(started.feedKey), false);
  }

  // fetch_recovered は、対になる fetch_abnormal が履歴のみになった取得分の中でも鳴る
  {
    const abnormal = createSystemNotice({
      feedKey: 'delta:ab-pair',
      sourceType: 'fetch_health',
      changeType: 'fetch_abnormal',
      category: 'question',
      occurredAt: '2026-10-26T00:00:01.000Z',
      sequence: 1,
    });
    const recovered = createSystemNotice({
      feedKey: 'delta:rec-pair',
      sourceType: 'fetch_health',
      changeType: 'fetch_recovered',
      category: 'warning',
      occurredAt: '2026-10-26T00:00:02.000Z',
      sequence: 2,
    });
    const state = createNotificationUiState();
    const { state: nextState, chime } = receiveNotifications(
      state,
      [abnormal, recovered],
      'K',
      Date.parse('2026-10-26T00:01:00.000Z'),
      undefined,
      { initialFetch: true },
    );
    assert.equal(nextState.historyOnlyFeedKeys.has(abnormal.feedKey), true);
    assert.equal(nextState.historyOnlyFeedKeys.has(recovered.feedKey), false);
    assert.equal(chime?.feedKey, recovered.feedKey);
  }
});

// ---------------------------------------------------------------------------
// 5. 単体: 後続ポーリング・cursor_out_of_range
// ---------------------------------------------------------------------------
test('受け入れ条件5: 単体: 後続ポーリング・cursor_out_of_range (コントローラ)', async () => {
  let timerId = 0;
  const timers = new Map<number, { task: () => void; delay: number }>();
  const receiveCalls: Array<{
    items: readonly NotificationFeedItem[];
    options?: { initialFetch?: boolean };
  }> = [];
  const generationCalls: Array<{ id: string; reason: 'page_open' | 'changed' }> = [];

  let deltaResponseIndex = 0;
  const deltaResponses: NotificationDeltaClientResult[] = [
    // 1回目 system poll (初回取得)
    {
      status: 'ready',
      response: {
        serverGenerationId: 'gen-1',
        cursor: 100 as unknown as NotificationDeltaCursor,
        notifications: [
          {
            notificationId: 'notif-1',
            category: 'warning',
            origin: 'system',
            detectionContext: 'normal',
            changeType: 'force_fetch_completed',
            sourceType: 'fetch_control',
            sourceVersion: null,
            targets: [{ kind: 'equipment', codeType: 'sys', code: 'main', name: 'M' }],
            occurredAt: '2026-10-26T00:00:00.000Z',
            sequence: 1,
            output: { ackRequired: false, summary: 's1', display: null, messageDefinition: null },
            venueScope: 'venue',
          },
        ],
      },
    },
    // 2回目 system poll (後続ポーリング)
    {
      status: 'ready',
      response: {
        serverGenerationId: 'gen-1',
        cursor: 101 as unknown as NotificationDeltaCursor,
        notifications: [
          {
            notificationId: 'notif-2',
            category: 'warning',
            origin: 'system',
            detectionContext: 'normal',
            changeType: 'force_fetch_completed',
            sourceType: 'fetch_control',
            sourceVersion: null,
            targets: [{ kind: 'equipment', codeType: 'sys', code: 'main', name: 'M' }],
            occurredAt: '2026-10-26T00:00:15.000Z',
            sequence: 2,
            output: { ackRequired: false, summary: 's2', display: null, messageDefinition: null },
            venueScope: 'venue',
          },
        ],
      },
    },
    // 3回目 system poll: cursor_out_of_range
    {
      status: 'cursor_out_of_range',
    },
    // 4回目 system poll: 再取得 (cursor_out_of_range 後の再取得)
    {
      status: 'ready',
      response: {
        serverGenerationId: 'gen-1',
        cursor: 105 as unknown as NotificationDeltaCursor,
        notifications: [
          // notif-2 は既に受信済み、notif-3 が新しい
          {
            notificationId: 'notif-2',
            category: 'warning',
            origin: 'system',
            detectionContext: 'normal',
            changeType: 'force_fetch_completed',
            sourceType: 'fetch_control',
            sourceVersion: null,
            targets: [{ kind: 'equipment', codeType: 'sys', code: 'main', name: 'M' }],
            occurredAt: '2026-10-26T00:00:15.000Z',
            sequence: 2,
            output: { ackRequired: false, summary: 's2', display: null, messageDefinition: null },
            venueScope: 'venue',
          },
          {
            notificationId: 'notif-3',
            category: 'warning',
            origin: 'system',
            detectionContext: 'normal',
            changeType: 'force_fetch_completed',
            sourceType: 'fetch_control',
            sourceVersion: null,
            targets: [{ kind: 'equipment', codeType: 'sys', code: 'main', name: 'M' }],
            occurredAt: '2026-10-26T00:00:30.000Z',
            sequence: 3,
            output: { ackRequired: false, summary: 's3', display: null, messageDefinition: null },
            venueScope: 'venue',
          },
        ],
      },
    },
  ];

  const runAllTimersWithDelay = (delay: number) => {
    const matching = Array.from(timers.entries()).filter(([, t]) => t.delay === delay);
    for (const [id, timer] of matching) {
      timers.delete(id);
      timer.task();
    }
  };

  const controller = createNotificationFeedController({
    terminalId: 'k-term',
    fetchDelta: async (request) => {
      if (request.origin === 'weather') {
        return { status: 'initializing' };
      }
      const res = deltaResponses[deltaResponseIndex++];
      return res!;
    },
    fetchStartup: async () => ({ status: 'initializing' }),
    receive: (items, options) => {
      receiveCalls.push({ items, options });
    },
    onGeneration: (id, reason) => {
      generationCalls.push({ id, reason });
    },
    onTransportState: () => {},
    setTimer: (task, delay) => {
      const id = ++timerId;
      timers.set(id, { task, delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
  });

  controller.start();
  // 1回目 system 完了待ち
  await new Promise((r) => setImmediate(r));

  assert.equal(generationCalls.length, 1);
  assert.deepEqual(generationCalls[0], { id: 'gen-1', reason: 'page_open' });
  assert.equal(receiveCalls.length, 1);
  assert.deepEqual(receiveCalls[0]?.options, { initialFetch: true });

  // 2回目 system 応答 (15秒タイマーを実行)
  runAllTimersWithDelay(15000);
  await new Promise((r) => setImmediate(r));

  assert.equal(generationCalls.length, 1); // 2回目は onGeneration 呼ばれない
  assert.equal(receiveCalls.length, 2);
  assert.equal(receiveCalls[1]?.options?.initialFetch, undefined); // initialFetch が付かない

  // 3回目: cursor_out_of_range (15秒タイマー実行)
  runAllTimersWithDelay(15000);
  await new Promise((r) => setImmediate(r));

  // 1000ms 後に再取得スケジュール
  runAllTimersWithDelay(1000);
  await new Promise((r) => setImmediate(r));

  // 4回目 (cursor_out_of_range 後の再取得)
  assert.equal(generationCalls.length, 1); // onGeneration は呼ばれない
  assert.equal(receiveCalls.length, 3);
  assert.equal(receiveCalls[2]?.options?.initialFetch, undefined); // initialFetch が付かない

  // ストア側で受信済み feedKey が新着として扱われないことの検証
  let state = createNotificationUiState();
  const res1 = receiveNotifications(
    state,
    receiveCalls[0]!.items,
    'K',
    1000,
    undefined,
    receiveCalls[0]!.options,
  );
  state = res1.state;
  const res2 = receiveNotifications(
    state,
    receiveCalls[1]!.items,
    'K',
    2000,
    undefined,
    receiveCalls[1]!.options,
  );
  state = res2.state;
  const res4 = receiveNotifications(
    state,
    receiveCalls[2]!.items,
    'K',
    3000,
    undefined,
    receiveCalls[2]!.options,
  );

  // notif-2 はすでに受信済みなので、notif-3 のみが新着として chime 候補になる
  assert.equal(res4.chime?.feedKey, 'delta:notif-3');
});

// ---------------------------------------------------------------------------
// 6. 単体: 世代の扱い (コントローラ)
// ---------------------------------------------------------------------------
test('受け入れ条件6: 単体: 世代の扱い (コントローラ)', async () => {
  let timerId = 0;
  const timers = new Map<number, { task: () => void; delay: number }>();
  const calls: Array<{ type: 'generation' | 'receive'; detail: unknown }> = [];

  let step = 0;
  const responses: NotificationDeltaClientResult[] = [
    // 1: 最初の応答
    {
      status: 'ready',
      response: {
        serverGenerationId: 'G1',
        cursor: 1 as unknown as NotificationDeltaCursor,
        notifications: [],
      },
    },
    // 2: server_generation_changed
    {
      status: 'server_generation_changed',
    },
    // 3: 世代変更後の最初の応答
    {
      status: 'ready',
      response: {
        serverGenerationId: 'G2',
        cursor: 1 as unknown as NotificationDeltaCursor,
        notifications: [],
      },
    },
    // 4: 世代不一致の応答 (G2 想定で G3 が返る)
    {
      status: 'ready',
      response: {
        serverGenerationId: 'G3',
        cursor: 1 as unknown as NotificationDeltaCursor,
        notifications: [],
      },
    },
    // 5: 再取得時の応答 (G3)
    {
      status: 'ready',
      response: {
        serverGenerationId: 'G3',
        cursor: 1 as unknown as NotificationDeltaCursor,
        notifications: [],
      },
    },
  ];

  const controller = createNotificationFeedController({
    terminalId: 'k-term',
    fetchDelta: async (req) => {
      if (req.origin === 'weather') return { status: 'initializing' };
      return responses[step++]!;
    },
    fetchStartup: async () => ({ status: 'initializing' }),
    receive: (items, options) => {
      calls.push({ type: 'receive', detail: { items, options } });
    },
    onGeneration: (id, reason) => {
      calls.push({ type: 'generation', detail: { id, reason } });
    },
    onTransportState: () => {},
    setTimer: (task, delay) => {
      const id = ++timerId;
      timers.set(id, { task, delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
  });

  const runAllTimersWithDelay = (delay: number) => {
    const matching = Array.from(timers.entries()).filter(([, t]) => t.delay === delay);
    for (const [id, timer] of matching) {
      timers.delete(id);
      timer.task();
    }
  };

  controller.start();
  await new Promise((r) => setImmediate(r));

  // start() 後の最初の応答: onGeneration(id, 'page_open') が receive(..., { initialFetch: true }) より先に呼ばれる
  assert.equal(calls.length >= 2, true);
  assert.deepEqual(calls[0], { type: 'generation', detail: { id: 'G1', reason: 'page_open' } });
  assert.deepEqual(calls[1], {
    type: 'receive',
    detail: { items: [], options: { initialFetch: true } },
  });

  calls.length = 0;
  // step 2: server_generation_changed を発生させる (15秒タイマー実行)
  runAllTimersWithDelay(15000);
  await new Promise((r) => setImmediate(r)); // server_generation_changed で restart() が走り、step 3 の poll('system') が実行される
  await new Promise((r) => setImmediate(r));

  // server_generation_changed 後: onGeneration(newId, 'changed') と initialFetch: true
  assert.equal(calls.length >= 2, true);
  assert.deepEqual(calls[0], { type: 'generation', detail: { id: 'G2', reason: 'changed' } });
  assert.deepEqual(calls[1], {
    type: 'receive',
    detail: { items: [], options: { initialFetch: true } },
  });

  calls.length = 0;
  // step 4: 世代不一致の応答 (15秒タイマー実行)
  runAllTimersWithDelay(15000);
  await new Promise((r) => setImmediate(r)); // G3 不一致で restart() が走り、step 5 が実行される
  await new Promise((r) => setImmediate(r));

  // 世代不一致後: onGeneration(newId, 'changed') と initialFetch: true
  assert.equal(calls.length >= 2, true);
  assert.deepEqual(calls[0], { type: 'generation', detail: { id: 'G3', reason: 'changed' } });
  assert.deepEqual(calls[1], {
    type: 'receive',
    detail: { items: [], options: { initialFetch: true } },
  });
});

// ---------------------------------------------------------------------------
// 7. 単体: 世代変更の破棄 (ストア)
// ---------------------------------------------------------------------------
test('受け入れ条件7: 単体: 世代変更の破棄 (ストア)', () => {
  const sys1Alerted = createSystemNotice({
    feedKey: 'delta:sys-alerted',
    sourceType: 'fetch_control',
    changeType: 'force_fetch_completed',
  });
  const sys2Confirmed = createSystemNotice({
    feedKey: 'delta:sys-confirmed',
    sourceType: 'fetch_health',
    changeType: 'fetch_abnormal',
  });
  const weatherNotice = createWeatherNotice({
    feedKey: 'delta:weather-keep',
  });

  let state = createNotificationUiState();
  const init = receiveNotifications(state, [sys1Alerted, sys2Confirmed, weatherNotice], 'K', 1000);
  state = init.state;
  // sys2 を確認済みにする
  state = {
    ...state,
    confirmedFeedKeys: new Set([...state.confirmedFeedKeys, sys2Confirmed.feedKey]),
  };
  // sys1 を鳴動済みにする
  state = markAlerted(state, [sys1Alerted.feedKey]);

  assert.equal(state.items.length, 3);
  assert.equal(state.warningHistory.length, 3);
  assert.equal(state.confirmedFeedKeys.has(sys2Confirmed.feedKey), true);
  assert.equal(state.alertedFeedKeys.has(sys1Alerted.feedKey), true);

  // discardPreviousGeneration を適用
  const discarded = discardPreviousGeneration(state, 'K');

  // system 2件が items・warningHistory・各集合から消え、weather は残る
  assert.equal(discarded.items.length, 1);
  assert.equal(discarded.items[0]?.feedKey, weatherNotice.feedKey);
  assert.equal(discarded.warningHistory.length, 1);
  assert.equal(discarded.warningHistory[0]?.item.feedKey, weatherNotice.feedKey);
  assert.equal(discarded.confirmedFeedKeys.has(sys2Confirmed.feedKey), false);
  assert.equal(discarded.alertedFeedKeys.has(sys1Alerted.feedKey), false);
  assert.equal(discarded.historyOnlyFeedKeys.has(sys1Alerted.feedKey), false);
  assert.equal(discarded.unreadFeedKeys.has(sys1Alerted.feedKey), false);

  // 続けて取り直し分 (未解消の異常1・解消済み異常の組1) を initialFetch: true で受信
  const unresolvableAbnormal = createSystemNotice({
    feedKey: 'delta:unresolved-ab',
    sourceType: 'initial_sync',
    changeType: 'initial_sync_failed',
    category: 'question',
    occurredAt: '2026-10-26T02:00:00.000Z',
    sequence: 1,
  });
  const resolvedAbnormal = createSystemNotice({
    feedKey: 'delta:res-ab',
    sourceType: 'fetch_health',
    changeType: 'fetch_abnormal',
    category: 'question',
    occurredAt: '2026-10-26T02:00:00.000Z',
    sequence: 1,
  });
  const resolver = createSystemNotice({
    feedKey: 'delta:res-rec',
    sourceType: 'fetch_health',
    changeType: 'fetch_recovered',
    category: 'warning',
    occurredAt: '2026-10-26T02:00:30.000Z',
    sequence: 2,
  });

  const redone = receiveNotifications(
    discarded,
    [unresolvableAbnormal, resolvedAbnormal, resolver],
    'K',
    2000,
    undefined,
    { initialFetch: true },
  );

  // 前者 (未解消の異常) だけが鳴る (chime が unresolvableAbnormal になる。question は level 4、warning は level 3)
  assert.equal(redone.chime?.feedKey, unresolvableAbnormal.feedKey);
  assert.equal(redone.state.historyOnlyFeedKeys.has(resolvedAbnormal.feedKey), true);
  assert.equal(redone.state.historyOnlyFeedKeys.has(unresolvableAbnormal.feedKey), false);
  assert.equal(
    displayedNoticeForRow(redone.state, 'K', 'question')?.feedKey,
    unresolvableAbnormal.feedKey,
  );
});

// ---------------------------------------------------------------------------
// 8. 単体: 保存 (alertedFeedKeyStore)
// ---------------------------------------------------------------------------
test('受け入れ条件8: 単体: 保存 (alertedFeedKeyStore)', () => {
  const store = new Map<string, string>();
  const fakeStorage = () => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });

  const repo = createAlertedFeedKeyRepository(fakeStorage);
  const now = 1_000_000_000;

  // (i) G1 で保存し load('G1') で復元できる
  repo.save(
    {
      serverGenerationId: 'G1',
      entries: [
        { feedKey: 'delta:notif-1', alertedAtMs: now - 1000 },
        { feedKey: 'delta:notif-2', alertedAtMs: now - 2000 },
      ],
    },
    now,
  );
  assert.deepEqual(repo.load('G1', now), ['delta:notif-1', 'delta:notif-2']);

  // (ii) weather・startup: のキーは保存されない
  repo.save(
    {
      serverGenerationId: 'G1',
      entries: [
        { feedKey: 'startup:out-1', alertedAtMs: now - 500 },
        { feedKey: 'delta:weather', alertedAtMs: now - 600 },
        { feedKey: 'delta:weather:warning', alertedAtMs: now - 700 },
        { feedKey: 'weather', alertedAtMs: now - 800 },
        { feedKey: 'delta:valid-sys', alertedAtMs: now - 900 },
      ],
    },
    now,
  );
  assert.deepEqual(repo.load('G1', now), ['delta:valid-sys']);

  // (iii) 1,001件を保存すると最古の1件が落ちる。24時間を超えた項目は load で返らない
  const largeEntries = [];
  for (let i = 0; i <= ALERTED_FEED_KEYS_LIMIT; i++) {
    largeEntries.push({
      feedKey: `delta:item-${i}`,
      alertedAtMs: now - i * 10, // i=0 が最新、i=1000 が最古
    });
  }
  repo.save({ serverGenerationId: 'G1', entries: largeEntries }, now);
  const loadedLarge = repo.load('G1', now);
  assert.equal(loadedLarge.length, ALERTED_FEED_KEYS_LIMIT);
  assert.equal(loadedLarge[0], 'delta:item-0'); // 最新
  assert.equal(loadedLarge.includes(`delta:item-${ALERTED_FEED_KEYS_LIMIT}`), false); // 最古が落ちている

  // 24時間を超えた項目 (duration = 24*60*60*1000 = 86_400_000)
  const expiredNow = now + 86_400_000 + 1000;
  assert.deepEqual(repo.load('G1', expiredNow), []);

  // (iv) load('G2') は [] を返し、保存キーが削除される
  repo.save(
    {
      serverGenerationId: 'G1',
      entries: [{ feedKey: 'delta:k1', alertedAtMs: now }],
    },
    now,
  );
  assert.equal(store.has(ALERTED_FEED_KEYS_STORAGE_KEY), true);
  const resultG2 = repo.load('G2', now);
  assert.deepEqual(resultG2, []);
  assert.equal(store.has(ALERTED_FEED_KEYS_STORAGE_KEY), false);

  // (v) 破損 JSON・型不一致・getItem/setItem/removeItem の例外で [] を返し、例外を出さない
  // 破損 JSON
  store.set(ALERTED_FEED_KEYS_STORAGE_KEY, '{ invalid json');
  assert.deepEqual(repo.load('G1', now), []);

  // 型不一致
  store.set(
    ALERTED_FEED_KEYS_STORAGE_KEY,
    JSON.stringify({ serverGenerationId: 123, entries: 'not-array' }),
  );
  assert.deepEqual(repo.load('G1', now), []);

  // storage 例外
  const throwingStorage = () => ({
    getItem: () => {
      throw new Error('Storage read error');
    },
    setItem: () => {
      throw new Error('Storage write error');
    },
    removeItem: () => {
      throw new Error('Storage remove error');
    },
  });
  const throwingRepo = createAlertedFeedKeyRepository(throwingStorage);
  assert.doesNotThrow(() => {
    assert.deepEqual(throwingRepo.load('G1', now), []);
    throwingRepo.save({ serverGenerationId: 'G1', entries: [] }, now);
    throwingRepo.clear();
  });
});
