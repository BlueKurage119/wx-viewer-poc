import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonitoringStatusResponse, WeatherRole } from '@wx-viewer-poc/shared';
import {
  presentSampleFreshness,
  presentWorker,
} from '../src/monitoring/weatherWorkerPresentation.ts';
import { buildMonitoringCards } from '../src/monitoring/monitoringPresentation.ts';
import {
  composeRestartResult,
  isRestartCompleted,
  nextCompletionLatch,
} from '../src/monitoring/weatherRestartResult.ts';
import {
  applyWorkerState,
  completedOperation,
  completedRestart,
  runtimeFixture,
  telegramStateFixtures,
  WORKER_FIXTURE_NOW,
  workerStateFixtures,
} from '../src/monitoring/__fixtures__/workerStates.ts';
import { normalMonitoringResponseFixture as base } from './monitoringFixture.ts';

const idle = { phase: 'idle' } as const;
function view(role: WeatherRole, name: string) {
  const fixture = workerStateFixtures.find((item) => item.name === name)!;
  const applied = applyWorkerState(base, fixture);
  return presentWorker(role, {
    data: applied.data,
    monitoringFailed: false,
    restart: applied.restarts[role],
    baselineGeneratedAt: null,
  });
}

test('D2: Worker状態の優先順位に従い、状態・トーン・再開可否・ボタン押下可否が決まる', () => {
  const table: readonly [string, WeatherRole, string, string, string, boolean][] = [
    ['正常', 'acquisition', '稼働中', 'normal', '再起動不要（稼働中）', false],
    ['準備中', 'acquisition', '準備中', 'attention', '再起動不可: 準備中', false],
    ['取得のみ通常停止', 'acquisition', '停止', 'neutral', '再起動可', true],
    ['取得のみ異常停止', 'acquisition', '異常停止', 'error', '再起動可', true],
    ['取得のみ異常停止', 'delivery', '稼働中', 'normal', '再起動不要（稼働中）', false],
    ['提供のみ異常停止', 'delivery', '異常停止', 'error', '再起動可', true],
    ['再起動中', 'acquisition', '再起動中', 'attention', '再起動中', false],
    ['再起動中', 'delivery', '再起動中', 'attention', '再起動中', false],
    ['再起動失敗', 'acquisition', '異常停止', 'error', '再起動可', true],
    [
      '再起動結果不明',
      'acquisition',
      '異常停止',
      'error',
      '再起動不可: 結果確認待ち（再読込で解除）',
      false,
    ],
    ['再起動受付後の接続失敗', 'delivery', '異常停止', 'error', '再起動可', true],
    ['報告途絶', 'acquisition', '稼働中', 'attention', '再起動可', true],
    ['報告途絶', 'delivery', '稼働中', 'attention', '再起動可', true],
  ];
  for (const [name, role, state, tone, restartability, canRestart] of table) {
    const actual = view(role, name);
    assert.deepEqual(
      [actual.state, actual.tone, actual.restartability, actual.canRestart],
      [state, tone, restartability, canRestart],
      `${name}/${role}`,
    );
  }
});

test('優先順位の個別行: 状態不明・Worker未使用・停止確認中・報告待ち・サーバー不許可', () => {
  const data = (overrides: Partial<ReturnType<typeof runtimeFixture>>) =>
    applyWorkerState(base, { acquisition: overrides, delivery: {} }).data;
  const present = (d: MonitoringStatusResponse | null, failed = false) =>
    presentWorker('acquisition', {
      data: d,
      monitoringFailed: failed,
      restart: idle,
      baselineGeneratedAt: null,
    });
  assert.deepEqual(
    [present(null).state, present(null).restartability, present(null).canRestart],
    ['状態不明', '再起動不可: 監視の応答待ち', false],
  );
  assert.equal(present(data({}), true).state, '状態不明');
  const inline = present(data({ mode: 'inline' }));
  assert.deepEqual(
    [inline.state, inline.tone, inline.restartability, inline.canRestart],
    ['Worker未使用', 'neutral', '再起動不可: Worker未使用', false],
  );
  const stopping = present(data({ lifecycle: 'stopping' }));
  assert.deepEqual(
    [stopping.state, stopping.tone, stopping.restartability],
    ['停止を確認中', 'attention', '再起動不可: 停止確認中'],
  );
  const waiting = present(data({ reportFreshness: 'unknown', receivedAt: null }));
  assert.deepEqual(
    [waiting.state, waiting.tone, waiting.restartability],
    ['報告待ち', 'neutral', '再起動不可: 報告待ち'],
  );
  const denied = present(data({ lifecycle: 'failed', failureCode: 'unexpected_exit' }));
  assert.deepEqual(
    [denied.state, denied.canRestart, denied.restartability],
    ['異常停止', false, '再起動不可: サーバーが許可していません'],
  );
  const noGeneration = present(
    data({ lifecycle: 'failed', restartAllowed: true, workerGeneration: null }),
  );
  assert.equal(noGeneration.canRestart, false);
  const abnormalStop = present(
    data({ lifecycle: 'stopped', stopReason: 'unexpected_exit', restartAllowed: true }),
  );
  assert.deepEqual([abnormalStop.state, abnormalStop.tone], ['異常停止', 'error']);
});

test('D3: 報告途絶（ready+stale）は稼働中のまま attention で「応答を確認できません」を示し、normal の稼働中を出さない', () => {
  const stale = view('acquisition', '報告途絶');
  assert.equal(stale.tone, 'attention');
  assert.equal(stale.canRestart, true);
  assert.equal(stale.lines[0]!.text.startsWith('応答を確認できません（最終報告 '), true);
  const normal = view('acquisition', '正常');
  assert.equal(normal.lines[0]!.text.startsWith('最終報告 '), true);
  assert.equal(normal.lines[0]!.text.includes('応答を確認できません'), false);
  // 異常停止（error）とは文言・トーンで区別できる
  const failed = view('acquisition', '取得のみ異常停止');
  assert.notEqual(failed.state, stale.state);
  assert.notEqual(failed.tone, stale.tone);
});

test('C26: 集計の受領状況は正常（15秒以内）では出さず、16秒前は鮮度低下、nullは未受領を attention で出す', () => {
  const freshness = (sampleSecondsAgo: number | null) =>
    presentSampleFreshness(
      applyWorkerState(base, { acquisition: {}, delivery: {}, sampleSecondsAgo }).data,
    );
  assert.equal(freshness(3), null);
  assert.equal(freshness(15), null);
  assert.deepEqual(freshness(16), { text: '集計 鮮度低下', tone: 'attention' });
  assert.deepEqual(freshness(null), { text: '集計 未受領', tone: 'attention' });
  assert.equal(presentSampleFreshness(null), null);
  // 提供Workerを使わない（inline）構成では集計を受け取らないのが正常
  const inline = applyWorkerState(base, {
    acquisition: {},
    delivery: {},
    sampleSecondsAgo: null,
  }).data;
  assert.equal(
    presentSampleFreshness({
      ...inline,
      weatherRuntimes: {
        ...inline.weatherRuntimes,
        delivery: { ...inline.weatherRuntimes.delivery, mode: 'inline' },
      },
    }),
    null,
  );
  // 集計の行は Worker カードの詳細に含まれない
  for (const role of ['acquisition', 'delivery'] as const)
    assert.equal(
      view(role, '正常').lines.some((line) => line.text.includes('集計')),
      false,
    );
});

test('C25改訂: Worker詳細は1行。再起動結果→理由→結果不明→応答不明→最終報告 の優先度で1つ', () => {
  const acquisition = view('acquisition', '取得のみ異常停止');
  assert.deepEqual(acquisition.lines, [{ text: '理由 予期しない終了', kind: 'reason' }]);
  // 結果行は理由より優先される
  const failedRestart = view('acquisition', '再起動失敗');
  assert.deepEqual(failedRestart.lines, [
    { text: '再起動失敗（サーバーが許可していません）', kind: 'restart-result' },
  ]);
  // 結果不明 n件（理由がないとき）
  const unknownScopes = presentWorker('acquisition', {
    data: applyWorkerState(base, {
      acquisition: { unknownScopes: ['a', 'b'] },
      delivery: {},
    }).data,
    monitoringFailed: false,
    restart: idle,
    baselineGeneratedAt: null,
  });
  assert.deepEqual(unknownScopes.lines, [{ text: '結果不明 2件', kind: 'unknown' }]);
  assert.deepEqual(
    view('delivery', '提供のみ異常停止').lines.map((line) => line.kind),
    ['reason'],
  );
  // 何もなければ最終報告。再開可否は詳細に出さない
  for (const role of ['acquisition', 'delivery'] as const) {
    const healthy = view(role, '正常');
    assert.deepEqual(
      healthy.lines.map((line) => line.kind),
      ['report'],
    );
    assert.equal(healthy.lines[0]!.text.startsWith('最終報告 '), true);
  }
  assert.equal(view('delivery', '再起動受付後の接続失敗').lines[0]!.kind, 'restart-result');
  for (const name of workerStateFixtures.map((item) => item.name)) {
    for (const role of ['acquisition', 'delivery'] as const) {
      const lines = view(role, name).lines;
      assert.equal(lines.length <= 1, true, `${name}/${role}`);
      assert.equal(
        lines.some((line) => line.kind === 'restartability' && line.text.startsWith('再起動')),
        false,
        `${name}/${role}`,
      );
    }
  }
});

test('D2: 電文処理カード6状態の主値・トーン・補足行', () => {
  const card = (name: string) => {
    const fixture = telegramStateFixtures.find((item) => item.name === name)!;
    return buildMonitoringCards({
      data: fixture.apply(base),
      monitoringFailed: false,
      restarts: { acquisition: idle, delivery: idle },
      baselines: { acquisition: null, delivery: null },
    }).find((item) => item.id === 'telegram')!;
  };
  const shape = (name: string) => {
    const c = card(name);
    return [c.value, c.tone, c.details.map((detail) => detail.text)];
  };
  assert.deepEqual(shape('準備失敗'), ['準備失敗（1件）', 'error', ['サービスの準備に失敗']]);
  assert.deepEqual(shape('初回同期中'), ['初回同期中', 'attention', ['初回同期 実行中']]);
  assert.deepEqual(shape('再処理中'), ['再処理中 60/150', 'attention', ['初回同期 完了']]);
  assert.deepEqual(shape('未判定あり'), ['未判定 3件', 'attention', ['起動時再処理 完了']]);
  assert.deepEqual(shape('未判定なし'), ['未判定なし', 'normal', ['起動時再処理 完了']]);
  const failed = card('読取失敗');
  assert.equal(failed.value, '未判定 —');
  assert.deepEqual(
    failed.details.map((detail) => [detail.text, detail.tone]),
    [['気象データを読み取れません', 'error']],
  );
  // 読取失敗でも主値（再処理中）は維持され、補足1行は読取失敗が優先される
  const running = telegramStateFixtures.find((item) => item.name === '再処理中')!;
  const kept = buildMonitoringCards({
    data: { ...running.apply(base), warningTelegrams: null },
    monitoringFailed: false,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  }).find((item) => item.id === 'telegram')!;
  assert.equal(kept.value, '再処理中 60/150');
  assert.deepEqual(
    kept.details.map((detail) => detail.text),
    ['気象データを読み取れません'],
  );
});

test('他会場の準備失敗は自会場の電文処理カードに出ない', () => {
  const data: MonitoringStatusResponse = {
    ...base,
    readiness: {
      ...base.readiness,
      preparationFailures: [
        {
          stage: 'venue_evaluation',
          venueId: 'trc',
          failedAt: WORKER_FIXTURE_NOW,
          code: 'weather_preparation_failed',
        },
      ],
    },
  };
  const card = buildMonitoringCards({
    data,
    monitoringFailed: false,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  }).find((item) => item.id === 'telegram')!;
  assert.equal(card.value, '未判定なし');
});

test('カードは常に4枚で、取得健全性・スケジュールの独立カードを持たない（自動取得へ統合）', () => {
  const cards = buildMonitoringCards({
    data: base,
    monitoringFailed: false,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  });
  assert.deepEqual(
    cards.map((card) => card.id),
    ['acquisitionWorker', 'deliveryWorker', 'autoFetch', 'telegram'],
  );
  const auto = cards.find((card) => card.id === 'autoFetch')!;
  assert.deepEqual(
    [auto.value, auto.tone, auto.details.map((detail) => detail.text)],
    ['有効', 'normal', ['時間帯 09:00–18:00']],
  );
  const nothing = buildMonitoringCards({
    data: null,
    monitoringFailed: true,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  });
  assert.equal(nothing.length, 4);
  assert.equal(nothing[0]!.value, '状態不明');
  const noPeriod = buildMonitoringCards({
    data: {
      ...base,
      operation: {
        ...base.operation,
        schedulerRunning: false,
        period: {
          ...base.operation.period,
          xmlSeconds: null,
          imageCatalogSeconds: null,
          amedasSeconds: null,
        },
      },
    },
    monitoringFailed: false,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  }).find((card) => card.id === 'autoFetch')!;
  assert.deepEqual(
    [noPeriod.value, noPeriod.tone, noPeriod.details.map((detail) => detail.text)],
    ['停止', 'neutral', ['定期取得の設定なし']],
  );
  const unreported = buildMonitoringCards({
    data: applyWorkerState(base, {
      acquisition: { reportFreshness: 'unknown', receivedAt: null },
      delivery: {},
    }).data,
    monitoringFailed: false,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  }).find((card) => card.id === 'autoFetch')!;
  assert.equal(unreported.value, '—');
});

test('監視取得の失敗中は正常・稼働の緑をneutralに抑え、attention/errorは維持する', () => {
  const failedCards = buildMonitoringCards({
    data: base,
    monitoringFailed: true,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  });
  for (const card of failedCards) assert.notEqual(card.tone, 'normal', card.id);
  const errorCards = buildMonitoringCards({
    data: telegramStateFixtures.find((item) => item.name === '準備失敗')!.apply(base),
    monitoringFailed: true,
    restarts: { acquisition: idle, delivery: idle },
    baselines: { acquisition: null, delivery: null },
  });
  assert.equal(errorCards.find((card) => card.id === 'telegram')!.tone, 'error');
});

// --- 再起動の結果合成（D6） ---

const accepted = (
  role: WeatherRole,
  runtime: Parameters<typeof runtimeFixture>[1],
  extra: Partial<MonitoringStatusResponse> = {},
  sampleSecondsAgo: number | null = 3,
) => ({
  ...applyWorkerState(base, {
    acquisition: role === 'acquisition' ? runtime : {},
    delivery: role === 'delivery' ? runtime : {},
    sampleSecondsAgo,
  }).data,
  ...extra,
});

test('D6: 取得再起動の結果行・カード結果（受付→準備中→完了）を監視更新だけで進める', () => {
  const restart = completedRestart('acquisition');
  const compose = (data: MonitoringStatusResponse | null) =>
    composeRestartResult('acquisition', restart, data, null);
  // 世代が一致する前（旧世代のまま）は完了にしない
  const old = compose(accepted('acquisition', {}));
  assert.deepEqual([old.cardText, old.rowText], ['起動済み', '取得再起動: 準備中']);
  const preparing = compose(
    accepted(
      'acquisition',
      { workerGeneration: 'acquisition-2' },
      { readiness: { ...base.readiness, initialFetchPhase: 'running' } },
    ),
  );
  assert.deepEqual(
    [preparing.stage, preparing.cardText, preparing.rowText],
    ['preparing', '起動済み・気象準備中', '取得再起動: 準備中'],
  );
  const prepFailed = compose(
    accepted(
      'acquisition',
      { workerGeneration: 'acquisition-2' },
      { readiness: { ...base.readiness, initialFetchPhase: 'failed' } },
    ),
  );
  assert.equal(prepFailed.cardText, '起動済み・気象準備に失敗');
  const done = compose(accepted('acquisition', { workerGeneration: 'acquisition-2' }));
  assert.deepEqual(
    [done.stage, done.cardText, done.rowText],
    ['completed', '起動済み・準備完了', '取得再起動が完了しました'],
  );
});

test('C21: 自動取得が停止のままの取得再起動は、Workerの準備完了で完了し「自動取得は停止のまま」と示す', () => {
  const restart = completedRestart('acquisition', { desiredRunning: false });
  const notPrepared = composeRestartResult(
    'acquisition',
    restart,
    accepted(
      'acquisition',
      { workerGeneration: 'acquisition-2', prepared: false },
      { readiness: { ...base.readiness, initialFetchPhase: 'not_started' } },
    ),
    null,
  );
  assert.equal(notPrepared.stage, 'preparing');
  const prepared = composeRestartResult(
    'acquisition',
    restart,
    accepted(
      'acquisition',
      { workerGeneration: 'acquisition-2', prepared: true },
      { readiness: { ...base.readiness, initialFetchPhase: 'not_started' } },
    ),
    null,
  );
  assert.deepEqual(
    [prepared.stage, prepared.cardText, prepared.rowText],
    ['completed', '起動済み・自動取得は停止のまま', '取得再起動が完了しました'],
  );
});

test('D6: 受付後の接続失敗（同じ世代がfailed）は完了にせず、失敗として示す', () => {
  for (const role of ['acquisition', 'delivery'] as const) {
    const result = composeRestartResult(
      role,
      completedRestart(role),
      accepted(role, {
        workerGeneration: `${role}-2`,
        lifecycle: 'failed',
        failureCode: 'initialization_failed',
      }),
      null,
    );
    const label = role === 'acquisition' ? '取得' : '提供';
    assert.deepEqual(
      [result.stage, result.cardText, result.rowText],
      ['failed', '起動済み・接続に失敗（初期化失敗）', `${label}再起動が失敗しました`],
    );
  }
});

test('完了に到達した再起動は、後から同じ世代が失敗しても結果を完了のまま残し、カードの状態は異常になる', () => {
  for (const role of ['acquisition', 'delivery'] as const) {
    const restart = completedRestart(role);
    const label = role === 'acquisition' ? '取得' : '提供';
    const healthy = accepted(role, { workerGeneration: `${role}-2` });
    const failed = accepted(role, {
      workerGeneration: `${role}-2`,
      lifecycle: 'failed',
      failureCode: 'worker_exited',
    });
    const baseline = '2000-01-01T00:00:00.000Z';
    const done = composeRestartResult(role, restart, healthy, baseline, null);
    assert.equal(done.stage, 'completed');
    const latched = nextCompletionLatch(null, restart, done);
    assert.equal(latched, `restart-${role}`);
    // 完了前に failed になった場合は、これまでどおり接続失敗
    assert.equal(composeRestartResult(role, restart, failed, baseline, null).stage, 'failed');
    // 完了到達後の failed は結果を書き換えない
    const after = composeRestartResult(role, restart, failed, baseline, latched);
    assert.equal(after.stage, 'completed');
    assert.equal(after.rowText, `${label}再起動が完了しました`);
    const worker = presentWorker(role, {
      data: failed,
      monitoringFailed: false,
      restart,
      baselineGeneratedAt: baseline,
      completedRequestId: latched,
    });
    assert.equal(worker.result.rowText, `${label}再起動が完了しました`);
    assert.equal(worker.tone, 'error');
    assert.notEqual(worker.state, '稼働中');
    // 保持は要求ごと: 新しい要求が出れば置き換わる
    const next = { ...restart, request: { ...restart.request, requestId: 'restart-next' } };
    assert.equal(nextCompletionLatch(latched, next, done), 'restart-next');
    assert.equal(
      nextCompletionLatch(latched, next, composeRestartResult(role, next, failed, baseline, null)),
      null,
    );
    assert.equal(
      nextCompletionLatch(latched, idle, { stage: 'none', cardText: null, rowText: null }),
      null,
    );
  }
});

test('D6: 提供再起動は旧標本の引き継ぎを完了と誤認せず、再起動後に作られた標本で完了する', () => {
  const restart = completedRestart('delivery');
  const baseline = '2026-09-20T05:25:20.000Z';
  const compose = (sampleAt: string | null) =>
    composeRestartResult(
      'delivery',
      restart,
      {
        ...accepted('delivery', { workerGeneration: 'delivery-2' }),
        weatherSampleReceivedAt: sampleAt,
      },
      baseline,
    );
  // 基準より前に受領した標本（旧Workerから引き継いだもの）
  assert.equal(compose('2026-09-20T05:25:19.000Z').stage, 'preparing');
  assert.equal(compose('2026-09-20T05:25:20.000Z').stage, 'preparing');
  assert.equal(compose(null).cardText, '起動済み・提供準備中');
  const done = compose('2026-09-20T05:25:25.000Z');
  assert.deepEqual(
    [done.stage, done.cardText, done.rowText],
    ['completed', '起動済み・提供中', '提供再起動が完了しました'],
  );
  // 基準時刻が未取得ならまだ完了にしない
  assert.equal(
    composeRestartResult(
      'delivery',
      restart,
      { ...accepted('delivery', { workerGeneration: 'delivery-2' }) },
      null,
    ).stage,
    'preparing',
  );
  // 鮮度が15秒を超えた標本は完了にしない
  const staleSample = composeRestartResult(
    'delivery',
    restart,
    {
      ...accepted('delivery', { workerGeneration: 'delivery-2' }),
      weatherSampleReceivedAt: '2026-09-20T05:25:10.000Z',
    },
    '2026-09-20T05:25:00.000Z',
  );
  assert.equal(staleSample.stage, 'preparing');
  const operation = completedOperation('delivery');
  assert.equal(
    isRestartCompleted(
      'delivery',
      operation,
      accepted('delivery', { lifecycle: 'starting', workerGeneration: 'delivery-2' }),
      baseline,
    ),
    false,
  );
});

test('D6: 受付済み・失敗・結果不明・409・400・履歴未記録の文面が§6.4/§5.4と完全一致する', () => {
  const request = { requestId: 'r1', expectedWorkerGeneration: 'g1' };
  for (const [role, label] of [
    ['acquisition', '取得'],
    ['delivery', '提供'],
  ] as const) {
    const cases = [
      [{ phase: 'sending', request }, '再起動を確認中', `${label}再起動: 受付済み`],
      [{ phase: 'checking', request }, '再起動を確認中', `${label}再起動: 受付済み`],
      [{ phase: 'unverifiable', request }, '再起動結果不明', `${label}再起動: 結果不明`],
      [
        { phase: 'conflict', request },
        '状態が変わったため再起動せず',
        `${label}再起動: 実行できません`,
      ],
      [{ phase: 'rejected', request }, '再起動要求を受付不可', `${label}再起動が失敗しました`],
      [
        completedRestart(role, { result: 'failure', errorCode: 'exit_unconfirmed' }),
        '再起動失敗（終了を確認できません）',
        `${label}再起動が失敗しました`,
      ],
      [
        completedRestart(role, { result: 'unknown', errorCode: 'exit_unconfirmed' }),
        '再起動結果不明',
        `${label}再起動: 結果不明`,
      ],
    ] as const;
    for (const [state, card, row] of cases) {
      const result = composeRestartResult(role, state, base, null);
      assert.deepEqual([result.cardText, result.rowText], [card, row], `${role}/${state.phase}`);
    }
    const unrecorded = composeRestartResult(
      role,
      completedRestart(role, { result: 'failure', historyRecorded: false }),
      base,
      null,
    );
    assert.deepEqual(
      [unrecorded.cardText, unrecorded.rowText],
      [`再起動失敗・履歴未記録`, `${label}再起動が失敗しました・履歴未記録`],
    );
    const mismatch = composeRestartResult(
      role,
      completedRestart(role, { workerGeneration: null, historyRecorded: false }),
      base,
      null,
    );
    assert.deepEqual(
      [mismatch.cardText, mismatch.rowText],
      ['起動済み・履歴未記録', `${label}再起動: 準備中・履歴未記録`],
    );
    assert.deepEqual(composeRestartResult(role, { phase: 'idle' }, base, null), {
      stage: 'none',
      cardText: null,
      rowText: null,
    });
  }
});

test('処理中の範囲（pendingScopes）は結果不明に数えず、画面に出さない。結果不明は unknownScopes だけを数える', () => {
  const present = (acquisition: Record<string, unknown>) =>
    presentWorker('acquisition', {
      data: applyWorkerState(base, { acquisition, delivery: {} }).data,
      monitoringFailed: false,
      restart: idle,
      baselineGeneratedAt: null,
    });
  const pendingOnly = present({
    pendingScopes: ['east', 'east|normal|warnings'],
    unknownScopes: [],
  });
  assert.equal(
    pendingOnly.lines.some((line) => line.kind === 'unknown' || line.text.includes('結果不明')),
    false,
  );
  assert.equal(
    pendingOnly.lines.some((line) => line.text.includes('east')),
    false,
  );
  const both = present({ pendingScopes: ['east', 'trc', 'x'], unknownScopes: ['a'] });
  assert.deepEqual(both.lines, [{ text: '結果不明 1件', kind: 'unknown' }]);
});

test('取得Workerの準備中に報告が途絶えても「応答を確認できません」を出さず、準備中を示す（再開可否は変えない）', () => {
  const present = (acquisition: Record<string, unknown>) =>
    presentWorker('acquisition', {
      data: applyWorkerState(base, { acquisition, delivery: {} }).data,
      monitoringFailed: false,
      restart: idle,
      baselineGeneratedAt: null,
    });
  const preparing = present({
    lifecycle: 'starting',
    reportFreshness: 'stale',
    prepared: false,
    restartAllowed: true,
  });
  assert.deepEqual([preparing.state, preparing.tone], ['準備中', 'attention']);
  assert.equal(preparing.canRestart, true);
  assert.equal(preparing.lines[0]!.text.includes('応答を確認できません'), false);
  assert.equal(
    preparing.lines.some((line) => line.text.includes('応答を確認できません')),
    false,
  );
  // サーバーが許可しなければ押せない（再開可否はサーバー値のまま）
  assert.equal(
    present({
      lifecycle: 'starting',
      reportFreshness: 'stale',
      prepared: false,
      restartAllowed: false,
    }).canRestart,
    false,
  );
  // 準備完了後の途絶は従来どおり
  const afterPrepared = present({
    lifecycle: 'ready',
    reportFreshness: 'stale',
    prepared: true,
    restartAllowed: true,
  });
  assert.deepEqual([afterPrepared.state, afterPrepared.tone], ['稼働中', 'attention']);
  assert.equal(afterPrepared.lines[0]!.text.startsWith('応答を確認できません（最終報告 '), true);
});
