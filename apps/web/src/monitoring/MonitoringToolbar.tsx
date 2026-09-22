import { GbButton, GbIconButton } from '../components/md';
import type { MonitoringToolbarModel } from './useMonitoringToolbar';

type ToolbarButtonProps = React.ComponentProps<typeof GbButton> & {
  readonly selected?: boolean;
  readonly sendReady?: boolean;
};

function Icon({ children }: { children: string }) {
  return (
    <span className="monitoring-toolbar-icon" aria-hidden="true">
      {children}
    </span>
  );
}

function ToolbarButton({
  children,
  className,
  disabled = false,
  selected = false,
  sendReady = false,
  ...props
}: ToolbarButtonProps) {
  const hostClassName = [
    className,
    selected ? 'monitoring-toolbar-selected' : undefined,
    sendReady ? 'monitoring-send-ready' : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const contentClassName = [
    'monitoring-toolbar-button-content',
    sendReady ? 'monitoring-toolbar-button-content-send-ready' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <GbButton {...props} className={hostClassName || undefined} disabled={disabled}>
      <span aria-hidden="true" className="monitoring-toolbar-button-container" slot="container" />
      <span className={contentClassName}>{children}</span>
    </GbButton>
  );
}

/** K2の操作表示。送信・照会の実行は親のTerminalAppに保持する。 */
export function MonitoringToolbar({ model }: { readonly model: MonitoringToolbarModel }) {
  const { localState, currentToolbar, busy } = model;
  const atRoot = localState.history.length <= 1;
  const sendReady = !busy && localState.selectedOperation !== null;
  return (
    <div className="monitoring-toolbar">
      <div
        className="monitoring-toolbar-group monitoring-toolbar-navigation"
        role="group"
        aria-label="監視メニュー移動"
      >
        <GbIconButton
          className="monitoring-toolbar-icon-button"
          color="filled"
          disabled={atRoot}
          size="sm"
          square
          type="button"
          aria-label="最初のメニューへ戻る"
          title="最初のメニューへ戻る"
          onClick={model.backToRoot}
        >
          <Icon>keyboard_double_arrow_left</Icon>
        </GbIconButton>
        <GbIconButton
          className="monitoring-toolbar-icon-button"
          color="filled"
          disabled={atRoot}
          size="sm"
          square
          type="button"
          aria-label="一つ前のメニューへ戻る"
          title="一つ前のメニューへ戻る"
          onClick={model.back}
        >
          <Icon>keyboard_arrow_left</Icon>
        </GbIconButton>
        {!atRoot && (
          <span className="monitoring-toolbar-title" title={currentToolbar.title}>
            {currentToolbar.title}
          </span>
        )}
      </div>
      <div className="monitoring-toolbar-scroll">
        {currentToolbar.groups.map((group) => (
          <div className="monitoring-toolbar-group" key={group.map((item) => item.label).join('-')}>
            {group.map((item) => {
              if (item.kind === 'operation') {
                const selected = localState.selectedOperation === item.operation;
                return (
                  <ToolbarButton
                    color="filled"
                    disabled={busy}
                    size="sm"
                    square
                    aria-label={selected ? `${item.label}、選択中` : item.label}
                    onClick={() => model.selectOperation(item.operation)}
                    key={item.label}
                    selected={selected}
                  >
                    {item.label}
                  </ToolbarButton>
                );
              }
              if (item.kind === 'dialog') {
                return (
                  <ToolbarButton
                    color="filled"
                    size="sm"
                    square
                    onClick={() => model.openDialog(item.dialogId)}
                    key={item.label}
                  >
                    {item.label}
                  </ToolbarButton>
                );
              }
              return (
                <ToolbarButton
                  color="filled"
                  size="sm"
                  square
                  onClick={() => model.navigate(item.toolbarId)}
                  key={item.label}
                >
                  {item.label}
                </ToolbarButton>
              );
            })}
          </div>
        ))}
      </div>
      <div className="monitoring-toolbar-group monitoring-toolbar-submit">
        <ToolbarButton
          color="filled"
          disabled={busy || localState.selectedOperation === null}
          size="sm"
          square
          onClick={model.clearSelection}
        >
          <Icon>close</Icon>
          <span className="monitoring-toolbar-button-label">クリア</span>
        </ToolbarButton>
        <ToolbarButton
          color="filled"
          disabled={busy || localState.selectedOperation === null}
          size="sm"
          square
          aria-label="取得操作を送信"
          onClick={model.submit}
          sendReady={sendReady}
        >
          <Icon>arrow_forward</Icon>
          <span className="monitoring-toolbar-button-label">送信</span>
        </ToolbarButton>
      </div>
    </div>
  );
}
