import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NotificationMessageResolutionError,
  resolveNotificationMessage,
  type NotificationCategory,
  type NotificationMessageDefinitionId,
  type SystemNotification,
} from '../src/index.ts';

function workerNotification(category: NotificationCategory): SystemNotification {
  return {
    notificationId: 'weather-worker:acquisition:g1:code',
    category,
    origin: 'system',
    changeType: 'code',
    sourceType: 'weather_worker',
    sourceVersion: 'g1',
    targets: [
      { kind: 'equipment', codeType: 'wx-viewer-poc/service', code: 'weather', name: '気象Worker' },
    ],
    occurredAt: '2026-10-09T00:00:00Z',
    detectedAt: '2026-10-09T00:00:00Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
  };
}

const rows: readonly {
  id: NotificationMessageDefinitionId;
  category: NotificationCategory;
  detail?: string;
  summary: string;
  ackRequired: boolean;
}[] = [
  {
    id: 'system-weather-acquisition-initialization-failed',
    category: 'question',
    summary: '取得系準備失敗\n気象Worker',
    ackRequired: true,
  },
  {
    id: 'system-weather-acquisition-exited',
    category: 'question',
    detail: '予期しない終了',
    summary: '取得系停止\n気象Worker\n予期しない終了',
    ackRequired: true,
  },
  {
    id: 'system-weather-acquisition-report-stale',
    category: 'warning',
    summary: '取得系応答不明\n気象Worker',
    ackRequired: false,
  },
  {
    id: 'system-weather-acquisition-restart-completed',
    category: 'warning',
    summary: '取得系再起動完了\n気象Worker',
    ackRequired: false,
  },
  {
    id: 'system-weather-delivery-initialization-failed',
    category: 'question',
    summary: '提供系準備失敗\n気象Worker',
    ackRequired: true,
  },
  {
    id: 'system-weather-delivery-exited',
    category: 'question',
    detail: '通信手順の異常',
    summary: '提供系停止\n気象Worker\n通信手順の異常',
    ackRequired: true,
  },
  {
    id: 'system-weather-delivery-report-stale',
    category: 'warning',
    summary: '提供系応答不明\n気象Worker',
    ackRequired: false,
  },
  {
    id: 'system-weather-delivery-restart-completed',
    category: 'warning',
    summary: '提供系再起動完了\n気象Worker',
    ackRequired: false,
  },
  {
    id: 'system-fetch-operation-unknown',
    category: 'warning',
    summary: '取得操作の結果不明\n気象Worker',
    ackRequired: false,
  },
];

for (const row of rows) {
  test(`Worker系通知 ${row.id}: 題名・対象・内容・区分・確認の扱いが設計どおり`, () => {
    const output = resolveNotificationMessage(workerNotification(row.category), {
      definitionId: row.id,
      detail: row.detail,
    });
    assert.equal(output.summary, row.summary);
    assert.equal(output.ackRequired, row.ackRequired);
    assert.equal(output.summary.includes('してください'), false);
    const otherCategory = row.category === 'warning' ? 'question' : 'warning';
    assert.throws(
      () => resolveNotificationMessage(workerNotification(otherCategory), { definitionId: row.id }),
      (error) =>
        error instanceof NotificationMessageResolutionError &&
        error.code === 'notification_mismatch',
    );
  });
}

test('統合で使わなくなった定義は残り、従来の区分・文面のまま解決できる', () => {
  const legacy: readonly [NotificationMessageDefinitionId, string][] = [
    [
      'system-weather-acquisition-control-failed',
      '気象取得Workerの処理失敗\n気象Worker\n気象取得Workerの処理を継続できません。監視画面で状態を確認してください。',
    ],
    [
      'system-weather-delivery-control-failed',
      '気象情報提供Workerの処理失敗\n気象Worker\n気象情報提供Workerの処理を継続できません。監視画面で状態を確認してください。',
    ],
    [
      'system-initial-sync-failed',
      '気象情報の初回準備失敗\n気象Worker\n気象情報の初回準備に失敗しました。監視とシステム通知は継続しています。',
    ],
  ];
  for (const [id, summary] of legacy) {
    assert.equal(
      resolveNotificationMessage(workerNotification('question'), { definitionId: id }).summary,
      summary,
    );
  }
});
