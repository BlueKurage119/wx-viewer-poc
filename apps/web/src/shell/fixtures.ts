import type { NotificationFeedItem } from '@wx-viewer-poc/shared';
export type PreviewScenario = 'empty' | 'long' | 'mixed' | 'result' | 'connection';
export const scenarios: readonly { id: PreviewScenario; label: string }[] = [
  { id: 'empty', label: '通知なし' },
  { id: 'long', label: '長文' },
  { id: 'mixed', label: '複数区分' },
  { id: 'result', label: '操作結果と通知' },
  { id: 'connection', label: '受信異常' },
];
function createPreviewNotice(
  feedKey: string,
  category: NotificationFeedItem['category'],
  origin: NotificationFeedItem['origin'],
  summary: string,
  ackRequired: boolean,
): NotificationFeedItem {
  return {
    feedKey,
    source: 'delta',
    sequence: 1,
    category,
    origin,
    detectionContext: 'normal',
    changeType: 'created',
    sourceType: 'preview',
    sourceVersion: null,
    targets: [{ kind: 'area', codeType: 'preview', code: 'east', name: '表示確認用' }],
    occurredAt: '2026-09-21T00:00:00.000Z',
    detectedAt: '2026-09-21T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired,
    summary,
    display: null,
    messageDefinition: null,
    venueScope: 'venue',
  };
}

export function previewNotices(scenario: PreviewScenario): NotificationFeedItem[] {
  if (scenario === 'empty' || scenario === 'connection') return [];
  const warning = createPreviewNotice(
    'delta:sample-warning',
    'warning',
    'weather',
    '【表示サンプル】対象地域の気象情報が更新されました。',
    false,
  );
  if (scenario === 'long')
    return [
      {
        ...warning,
        summary:
          '【表示サンプル】対象地域に関する気象情報が更新されました。今後の気象状況に留意し、最新の発表内容を確認してください。長い通知文でも操作ボタンや未対応件数が画面外へ押し出されず、全文を確認できることを検証しています。',
      },
    ];
  return [
    warning,
    {
      ...warning,
      feedKey: 'delta:sample-emergency',
      category: 'emergency',
      origin: 'weather',
      summary: '【表示サンプル】非常ブザー区分の通知です。発表内容を確認してください。',
      ackRequired: true,
    },
    {
      ...warning,
      feedKey: 'delta:sample-question',
      category: 'question',
      origin: 'weather',
      summary: '【表示サンプル】追加の問いかけ通知です。',
      ackRequired: true,
    },
    {
      ...warning,
      feedKey: 'delta:sample-system',
      category: 'warning',
      origin: 'system',
      summary: '【表示サンプル】取得処理の遅延を検知しました。',
      ackRequired: true,
    },
  ];
}
