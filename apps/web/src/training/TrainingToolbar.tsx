import { GbButton } from '../components/md';

/**
 * J1のツールバー。操作は「削除」だけ（押下即実行・確認なし）。外枠・部品・classは取得監視画面の
 * `.monitoring-toolbar` 系をそのまま使う。右端の固定群はJ2用に空けてある。
 */
export function TrainingToolbar({
  canDelete,
  onDelete,
}: {
  readonly canDelete: boolean;
  readonly onDelete: () => void;
}) {
  return (
    <div className="monitoring-toolbar">
      <div className="monitoring-toolbar-scroll">
        <div className="monitoring-toolbar-group">
          <GbButton
            color="filled"
            size="sm"
            square
            type="button"
            softDisabled={!canDelete}
            aria-disabled={!canDelete}
            onClick={() => {
              if (canDelete) onDelete();
            }}
          >
            <span
              aria-hidden="true"
              className="monitoring-toolbar-button-container"
              slot="container"
            />
            <span className="monitoring-toolbar-button-content">
              <span className="monitoring-toolbar-icon" aria-hidden="true">
                delete
              </span>
              <span className="monitoring-toolbar-button-label">削除</span>
            </span>
          </GbButton>
        </div>
      </div>
    </div>
  );
}
