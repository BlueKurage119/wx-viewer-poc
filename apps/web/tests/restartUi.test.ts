import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createToolbarLocalState,
  isSelectionSubmittable,
  monitoringToolbarDefinitions,
  navigateToolbar,
  selectToolbarOperation,
  selectToolbarWorkerRestart,
  toolbarSelectionLabel,
} from '../src/monitoring/monitoringToolbarState.ts';
import { toolbarFocusKey } from '../src/monitoring/useMonitoringToolbar.ts';
import {
  fetchOperationText,
  monitoringOperationMessage,
  selectOperationLine,
} from '../src/monitoring/monitoringOperationMessage.ts';
import { nextBaselineEntry } from '../src/monitoring/useRestartCompletion.ts';
import { workerHistoryResult } from '../src/monitoring/weatherRestartResult.ts';
import {
  completedOperation,
  completedRestart,
} from '../src/monitoring/__fixtures__/workerStates.ts';
import { normalMonitoringResponseFixture as base } from './monitoringFixture.ts';

const defs = monitoringToolbarDefinitions;
const labelsOf = (id: string) =>
  defs.find((item) => item.id === id)!.groups.map((group) => group.map((item) => item.label));

test('§6.1 階層定義: ルート・Worker・履歴の項目と、全角5文字以内の文言', () => {
  assert.deepEqual(labelsOf('monitor-root'), [
    ['取得開始', '取得停止', '強制更新'],
    ['Worker', '履歴'],
    ['状態診断'],
  ]);
  assert.deepEqual(labelsOf('monitor-worker'), [['取得再起動', '提供再起動']]);
  assert.deepEqual(labelsOf('monitor-history'), [['受信', '電文', '通知出力'], ['Worker']]);
  for (const definition of defs)
    for (const item of definition.groups.flat())
      assert.equal(
        [...item.label].reduce((sum, char) => sum + (char.charCodeAt(0) < 128 ? 0.5 : 1), 0) <= 5,
        true,
        item.label,
      );
  // 再起動項目は Worker 階層だけにある
  const withRestart = defs.filter((definition) =>
    definition.groups.flat().some((item) => item.kind === 'workerRestart'),
  );
  assert.deepEqual(
    withRestart.map((definition) => definition.id),
    ['monitor-worker'],
  );
  // 「出力履歴」は「通知出力」へ改名され、旧文言は残らない
  assert.equal(
    defs.some((definition) => definition.groups.flat().some((item) => item.label === '出力履歴')),
    false,
  );
});

test('選択の型: 再起動と取得操作は同時に選べず、読み上げ名と送信可否が独立する', () => {
  let state = createToolbarLocalState('monitor-root');
  state = selectToolbarWorkerRestart(state, 'acquisition');
  assert.deepEqual(state.selectedOperation, { kind: 'workerRestart', role: 'acquisition' });
  assert.equal(toolbarSelectionLabel(state.selectedOperation!), '取得再起動');
  // 同じ項目を再選択すると解除、別の項目は置き換え
  assert.equal(selectToolbarWorkerRestart(state, 'acquisition').selectedOperation, null);
  assert.deepEqual(selectToolbarWorkerRestart(state, 'delivery').selectedOperation, {
    kind: 'workerRestart',
    role: 'delivery',
  });
  state = selectToolbarOperation(state, 'stop');
  assert.equal(state.selectedOperation, 'stop');
  assert.equal(toolbarSelectionLabel('force_refresh'), '強制更新');
  // C16: 取得操作の照会中でも再起動は送れる。取得操作は照会中に送れない。
  assert.equal(isSelectionSubmittable({ kind: 'workerRestart', role: 'delivery' }, true), true);
  assert.equal(isSelectionSubmittable('start', true), false);
  assert.equal(isSelectionSubmittable('start', false), true);
  assert.equal(isSelectionSubmittable(null, false), false);
  // 階層移動で選択は解除される
  state = selectToolbarWorkerRestart(createToolbarLocalState('monitor-root'), 'delivery');
  assert.equal(navigateToolbar(state, defs, 'monitor-history').selectedOperation, null);
});

test('§8 フォーカス: 進むと先頭の項目、戻ると移動元の navigate 項目へ移る', () => {
  assert.equal(
    toolbarFocusKey(defs, ['monitor-root', 'monitor-worker'], { kind: 'first' }),
    'monitor-worker:取得再起動',
  );
  assert.equal(
    toolbarFocusKey(defs, ['monitor-root', 'monitor-history'], { kind: 'first' }),
    'monitor-history:受信',
  );
  assert.equal(
    toolbarFocusKey(defs, ['monitor-root'], { kind: 'navigate', fromId: 'monitor-history' }),
    'monitor-root:履歴',
  );
  assert.equal(
    toolbarFocusKey(defs, ['monitor-root'], { kind: 'navigate', fromId: 'monitor-worker' }),
    'monitor-root:Worker',
  );
  assert.equal(toolbarFocusKey(defs, ['monitor-root'], { kind: 'navigate', fromId: 'none' }), null);
});

test('§6.4 操作行: 選択中を最優先し、複数件は最後に変わった方を表示して title に全件を並べる', () => {
  const local = createToolbarLocalState('monitor-root');
  assert.equal(selectOperationLine(local, []), null);
  assert.equal(selectOperationLine(local, [{ text: null, changedSeq: 1 }]), null);
  assert.deepEqual(
    selectOperationLine(local, [{ text: '取得開始が完了しました', changedSeq: 1 }]),
    {
      text: '取得開始が完了しました',
    },
  );
  const entries = [
    { text: '取得停止が完了しました', changedSeq: 1 },
    { text: '提供再起動が完了しました', changedSeq: 3 },
    { text: '取得再起動: 結果不明', changedSeq: 2 },
  ];
  assert.deepEqual(selectOperationLine(local, entries), {
    text: '提供再起動が完了しました',
    title: '取得停止が完了しました／提供再起動が完了しました／取得再起動: 結果不明',
  });
  const selecting = selectToolbarWorkerRestart(local, 'delivery');
  assert.deepEqual(selectOperationLine(selecting, entries), {
    text: '提供再起動を選択中／送信で実行',
  });
  assert.deepEqual(selectOperationLine(selectToolbarOperation(local, 'start'), entries), {
    text: '取得開始を選択中／送信で実行',
  });
  // 取得操作の既存文面は変わらない
  assert.equal(fetchOperationText({ phase: 'idle' }), null);
  assert.equal(monitoringOperationMessage(local, { phase: 'idle' }), null);
});

test('提供再起動の基準時刻: 完了受領時点と別の応答が来たものを一度だけ基準にする', () => {
  const idle = { requestId: null, seen: null, baseline: null };
  const old = { ...base, generatedAt: '2026-09-20T05:25:00.000Z' };
  const next = { ...base, generatedAt: '2026-09-20T05:25:05.000Z' };
  const later = { ...base, generatedAt: '2026-09-20T05:25:10.000Z' };
  const done = completedRestart('delivery');
  // 完了を受領した時点で保持していた応答は基準にしない
  let entry = nextBaselineEntry(idle, done, old);
  assert.deepEqual(entry, { requestId: 'restart-delivery', seen: old, baseline: null });
  assert.equal(nextBaselineEntry(entry, done, old).baseline, null);
  entry = nextBaselineEntry(entry, done, null);
  assert.equal(entry.baseline, null);
  entry = nextBaselineEntry(entry, done, next);
  assert.equal(entry.baseline, next.generatedAt);
  // 一度決めた基準は動かさない
  assert.equal(nextBaselineEntry(entry, done, later).baseline, next.generatedAt);
  // 完了でなくなれば解除
  assert.deepEqual(nextBaselineEntry(entry, { phase: 'idle' }, later), {
    requestId: null,
    seen: later,
    baseline: null,
  });
});

test('Worker履歴ダイアログの結果語は記録された結果だけを示す', () => {
  assert.equal(workerHistoryResult(completedOperation('delivery')), '起動済み');
  assert.equal(
    workerHistoryResult(completedOperation('delivery', { result: 'failure' })),
    '再起動失敗',
  );
  assert.equal(
    workerHistoryResult(completedOperation('acquisition', { result: 'unknown' })),
    '再起動結果不明',
  );
  assert.equal(
    workerHistoryResult({
      status: 'in_progress',
      requestId: 'r',
      role: 'acquisition',
      historyRecorded: true,
    }),
    '再起動中',
  );
});

test('D10: 監視UIのソースに <md-*> 生タグ・HEX/RGB直書き・bare import がない', () => {
  const files = [
    'MonitoringDashboard.tsx',
    'MonitoringToolbar.tsx',
    'WorkerRestartHistoryDialog.tsx',
    'MonitoringDialogHost.tsx',
    'monitoring.css',
    'useMonitoringToolbar.ts',
    '__fixtures__/workerStates.ts',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/monitoring/${file}`, import.meta.url), 'utf8');
    assert.equal(/<md-[a-z]/.test(source), false, `${file}: md生タグ`);
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(source.replace(/&#\d+;/g, '')), false, `${file}: HEX`);
    assert.equal(/\brgba?\(/.test(source), false, `${file}: rgb`);
    assert.equal(
      /^import\s+['"][^'"]+(?<!\.css)['"];?$/m.test(source),
      false,
      `${file}: bare import`,
    );
  }
});

test('D7: 警報へ区分を変えたWorker通知は警報の行に出て警報の鳴動となり、確認必須にならない', async () => {
  const { receiveNotifications, createNotificationUiState, noticesForRow, notificationCounts } =
    await import('../src/notifications/notificationStore.ts');
  const item = (feedKey: string, category: 'warning' | 'question') => ({
    feedKey,
    source: 'delta' as const,
    sequence: 1,
    category,
    origin: 'system' as const,
    detectionContext: 'normal' as const,
    changeType: 'report_stale',
    sourceType: 'weather_worker',
    sourceVersion: 'g1',
    targets: [
      {
        kind: 'equipment' as const,
        codeType: 'wx-viewer-poc/service',
        code: 'weather',
        name: '気象Worker',
      },
    ],
    occurredAt: '2026-10-09T00:00:00.000Z',
    detectedAt: '2026-10-09T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired: category === 'question',
    summary: '取得系応答不明\n気象Worker',
    display: null,
    messageDefinition: { id: 'system-weather-acquisition-report-stale', version: '1' as const },
    venueScope: 'global' as const,
  });
  // 端末ごとの見え方は変わらない: systemの通知は K 端末だけに出る。
  const hallView = receiveNotifications(
    createNotificationUiState(),
    [item('delta:stale', 'warning')],
    'H',
    1791072000000,
  );
  assert.equal(noticesForRow(hallView.state, 'H', 'warning').length, 0);
  assert.equal(hallView.chime, null);
  for (const mode of ['K'] as const) {
    const received = receiveNotifications(
      createNotificationUiState(),
      [item('delta:stale', 'warning')],
      mode,
      1791072000000,
    );
    assert.equal(received.chime?.category, 'warning', mode);
    assert.equal(noticesForRow(received.state, mode, 'warning').length, 1, mode);
    assert.equal(noticesForRow(received.state, mode, 'question').length, 0, mode);
    assert.equal(notificationCounts(received.state, mode).pending, 0, mode);
    // 問いかけだった頃は確認が必要だった
    const question = receiveNotifications(
      createNotificationUiState(),
      [item('delta:old', 'question')],
      mode,
      1791072000000,
    );
    assert.equal(question.chime?.category, 'question', mode);
    assert.equal(notificationCounts(question.state, mode).pending, 1, mode);
  }
});
