import { GbButton } from '../components/md/GbButton';

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
            <GbButton color="filled" disabled size="sm" square key={label}>
              {label}
            </GbButton>
          ))}
        </div>
      ))}
      <div className="monitoring-toolbar-group monitoring-toolbar-submit">
        <GbButton color="filled" disabled size="sm" square>
          送信
        </GbButton>
      </div>
    </div>
  );
}
