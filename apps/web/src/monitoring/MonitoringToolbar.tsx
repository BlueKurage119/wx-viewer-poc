import { GbButton } from '../components/md';
import type { MonitoringToolbarModel } from './useMonitoringToolbar';

function Icon({ children }: { children: string }) {
  return (
    <span className="monitoring-toolbar-icon" aria-hidden="true">
      {children}
    </span>
  );
}

/** K2の操作表示。送信・照会の実行は親のTerminalAppに保持する。 */
export function MonitoringToolbar({ model }: { readonly model: MonitoringToolbarModel }) {
  const { localState, currentToolbar, busy } = model;
  const atRoot = localState.history.length <= 1;
  return (
    <div className="monitoring-toolbar">
      <div
        className="monitoring-toolbar-group monitoring-toolbar-navigation"
        aria-label="監視メニュー移動"
      >
        <GbButton
          className="monitoring-toolbar-icon-button"
          color="filled"
          disabled={atRoot}
          size="sm"
          square
          aria-label="最初のメニューへ戻る"
          title="最初のメニューへ戻る"
          onClick={model.backToRoot}
        >
          <Icon>keyboard_double_arrow_left</Icon>
        </GbButton>
        <GbButton
          className="monitoring-toolbar-icon-button"
          color="filled"
          disabled={atRoot}
          size="sm"
          square
          aria-label="一つ前のメニューへ戻る"
          title="一つ前のメニューへ戻る"
          onClick={model.back}
        >
          <Icon>keyboard_arrow_left</Icon>
        </GbButton>
        <span className="monitoring-toolbar-title" title={currentToolbar.title}>
          {currentToolbar.title}
        </span>
      </div>
      {currentToolbar.groups.map((group) => (
        <div className="monitoring-toolbar-group" key={group.map((item) => item.label).join('-')}>
          {group.map((item) => {
            if (item.kind === 'operation') {
              const selected = localState.selectedOperation === item.operation;
              return (
                <GbButton
                  className={selected ? 'monitoring-toolbar-selected' : undefined}
                  color="filled"
                  disabled={busy}
                  size="sm"
                  square
                  aria-label={selected ? `${item.label}、選択中` : item.label}
                  onClick={() => model.selectOperation(item.operation)}
                  key={item.label}
                >
                  {item.label}
                </GbButton>
              );
            }
            if (item.kind === 'dialog') {
              return (
                <GbButton
                  color="filled"
                  size="sm"
                  square
                  onClick={() => model.openDialog(item.dialogId)}
                  key={item.label}
                >
                  {item.label}
                </GbButton>
              );
            }
            return (
              <GbButton
                color="filled"
                size="sm"
                square
                onClick={() => model.navigate(item.toolbarId)}
                key={item.label}
              >
                {item.label}
              </GbButton>
            );
          })}
        </div>
      ))}
      <div className="monitoring-toolbar-group monitoring-toolbar-submit">
        <GbButton
          color="filled"
          disabled={busy || localState.selectedOperation === null}
          size="sm"
          square
          onClick={model.clearSelection}
        >
          <Icon>close</Icon>クリア
        </GbButton>
        <GbButton
          color="filled"
          disabled={busy || localState.selectedOperation === null}
          size="sm"
          square
          aria-label="取得操作を送信"
          onClick={model.submit}
        >
          <Icon>arrow_forward</Icon>送信
        </GbButton>
      </div>
    </div>
  );
}
