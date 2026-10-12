import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { toNotificationFeedItemFromDelta } from '@wx-viewer-poc/shared';
import { fetchNotificationDelta } from '../src/api/notificationDelta.ts';
import {
  createNotificationUiState,
  receiveNotifications,
} from '../src/notifications/notificationStore.ts';

/**
 * 実Workerの結合試験(apps/api の trainingInjectionRealWorker.test.ts)で通知差分APIが返した形の
 * 訓練通知（速報・警報）を、web の差分応答パース → フィード項目への変換 → 通知storeへ流し、
 * isTraining:true が項目まで保たれることを確認する。
 */
function deltaItem(overrides: Record<string, unknown>) {
  return {
    sequence: 6,
    notificationId: 'b69e3d24-bb8d-42fb-babd-addea27f7e00',
    category: 'question',
    origin: 'weather',
    detectionContext: 'normal',
    sourceType: 'bosai_bulletin',
    sourceVersion: '["VPHW50:130000","training","2026-10-12T16:18:14.000Z","発表"]',
    changeType: 'new',
    targets: [{ kind: 'area', codeType: 'venue', code: 'east', name: '江東区' }],
    occurredAt: '2026-10-12T16:18:00.000Z',
    detectedAt: '2026-10-12T16:18:14.087Z',
    relatedRefs: [{ type: 'telegram_reception', ref: '1' }],
    isTraining: true,
    venueScope: 'venue',
    output: {
      ackRequired: true,
      summary: '気象防災速報発表\n江東区\n竜巻注意',
      messageDefinition: { id: 'weather-bosai-bulletin-tornado-warning', version: '1' },
    },
    ...overrides,
  };
}

async function receiveThroughStore(notifications: Record<string, unknown>[]) {
  const originalFetch = window.fetch;
  window.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'ready',
        origin: 'weather',
        terminalId: 'kkeagh01',
        venueId: 'east',
        serverGenerationId: 'gen-1',
        generatedAt: '2026-10-12T16:18:14.127Z',
        cursor: String(notifications.length + 6),
        notifications,
        skippedCount: 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  try {
    const result = await fetchNotificationDelta({
      terminalId: 'kkeagh01',
      origin: 'weather',
      cursor: '0',
      serverGenerationId: 'gen-1',
    });
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw new Error('unreachable');
    const items = result.response.notifications.map(toNotificationFeedItemFromDelta);
    return receiveNotifications(createNotificationUiState(), items, 'K', 0);
  } finally {
    window.fetch = originalFetch;
  }
}

test('訓練通知の isTraining:true が、差分応答のパース・変換・通知storeの項目まで保たれる', async () => {
  const { state, chime } = await receiveThroughStore([
    deltaItem({}),
    deltaItem({
      sequence: 7,
      notificationId: 'ffffffff-0000-4000-8000-000000000001',
      category: 'warning',
      sourceType: 'warning_current',
      isTraining: false,
      output: {
        ackRequired: true,
        summary: '気象警報発表\n江東区\nレベル３大雨警報',
        messageDefinition: { id: 'weather-warning', version: '1' },
      },
    }),
  ]);
  const byKind = new Map(state.items.map((item) => [item.sourceType, item]));
  assert.equal(byKind.get('bosai_bulletin')?.isTraining, true);
  assert.equal(byKind.get('warning_current')?.isTraining, false);
  assert.equal(byKind.get('bosai_bulletin')?.summary, '気象防災速報発表\n江東区\n竜巻注意');
  assert.ok(chime, '訓練通知を含む到着でも鳴動要求が出る');
});

test('訓練通知と通常通知は、同じ区分・内容で同じ鳴動要求(レベル)になる', async () => {
  const training = await receiveThroughStore([deltaItem({})]);
  const normal = await receiveThroughStore([deltaItem({ isTraining: false })]);
  assert.deepEqual(training.chime, normal.chime);
  assert.ok(training.chime);
});
