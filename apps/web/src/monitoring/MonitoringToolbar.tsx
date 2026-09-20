import { FilledButton } from '../components/md';

const buttonGroups = [
  ['取得開始', '取得停止'],
  ['強制更新'],
  ['受信履歴', '電文履歴', '出力履歴'],
  ['状態診断'],
] as const;

/** K2以降で操作とダイアログを接続するための、K1の固定ツールバー配置。 */
export function MonitoringToolbar() {
  return (
    <div className="monitoring-toolbar">
      {buttonGroups.map((group) => (
        <div className="monitoring-toolbar-group" key={group.join('-')}>
          {group.map((label) => (
            <FilledButton key={label} disabled>
              {label}
            </FilledButton>
          ))}
        </div>
      ))}
      <div className="monitoring-toolbar-group monitoring-toolbar-submit">
        <FilledButton disabled>送信</FilledButton>
      </div>
    </div>
  );
}
