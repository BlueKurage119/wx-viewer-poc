import type { ShellNotice } from './notifications';
export type PreviewScenario = 'empty' | 'long' | 'mixed' | 'result' | 'connection';
export const scenarios: readonly { id: PreviewScenario; label: string }[] = [
  { id: 'empty', label: '通知なし' },
  { id: 'long', label: '長文' },
  { id: 'mixed', label: '複数区分' },
  { id: 'result', label: '操作結果と通知' },
  { id: 'connection', label: '受信異常' },
];
export function previewNotices(scenario: PreviewScenario): ShellNotice[] {
  if (scenario === 'empty' || scenario === 'connection') return [];
  const warning: ShellNotice = {
    id: 'sample-warning',
    category: 'warning',
    origin: 'weather',
    summary: '【表示サンプル】対象地域の気象情報が更新されました。',
    unread: true,
    pending: false,
  };
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
      id: 'sample-emergency',
      category: 'emergency',
      origin: 'weather',
      summary: '【表示サンプル】非常ブザー区分の通知です。発表内容を確認してください。',
      unread: true,
      pending: true,
    },
    {
      id: 'sample-question',
      category: 'question',
      origin: 'weather',
      summary: '【表示サンプル】追加の問いかけ通知です。',
      unread: true,
      pending: true,
    },
    {
      id: 'sample-equipment',
      category: 'warning',
      origin: 'equipment',
      summary: '【表示サンプル】取得処理の遅延を検知しました。',
      unread: true,
      pending: true,
    },
  ];
}
