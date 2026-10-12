import type { ReactNode } from 'react';
import { GbButton, GbIconButton } from '../components/md';

/** 中央に描画する項目。選択型は押すと選択（再度押すと解除）、動作型は押すと即実行する。 */
export type OperationToolbarItem =
  | {
      readonly kind: 'select';
      readonly label: string;
      readonly selected: boolean;
      /** 選べない状態（本物のdisabled）。 */
      readonly disabled?: boolean;
      /** 選べない状態（フォーカスは維持）。 */
      readonly softDisabled?: boolean;
      readonly describedBy?: string;
      readonly onSelect: () => void;
    }
  | { readonly kind: 'action'; readonly label: string; readonly onClick: () => void };

export interface OperationToolbarProps {
  /** 現在の階層ID（項目の `data-toolbar-item` キー `階層ID:ラベル` に使う）。 */
  readonly toolbarId: string;
  readonly title: string;
  readonly atRoot: boolean;
  /** 左の固定群の `aria-label`（例: 監視メニュー移動）。 */
  readonly navigationLabel: string;
  readonly groups: readonly (readonly OperationToolbarItem[])[];
  readonly selectionActive: boolean;
  readonly sendReady: boolean;
  /** 送信ボタンの `aria-label`。 */
  readonly sendLabel: string;
  readonly onBackToRoot: () => void;
  readonly onBack: () => void;
  readonly onClear: () => void;
  readonly onSend: () => void;
}

type ToolbarButtonProps = React.ComponentProps<typeof GbButton> & {
  readonly selected?: boolean;
  readonly sendReady?: boolean;
};

export function ToolbarIcon({ children }: { children: string }) {
  return (
    <span className="monitoring-toolbar-icon" aria-hidden="true">
      {children}
    </span>
  );
}

export function ToolbarButton({
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

function renderItem(toolbarId: string, item: OperationToolbarItem): ReactNode {
  const key = `${toolbarId}:${item.label}`;
  if (item.kind === 'select') {
    return (
      <ToolbarButton
        data-toolbar-item={key}
        color="filled"
        {...(item.softDisabled === undefined
          ? { disabled: item.disabled ?? false }
          : { softDisabled: item.softDisabled })}
        size="sm"
        square
        aria-label={item.selected ? `${item.label}、選択中` : item.label}
        aria-describedby={item.describedBy}
        onClick={item.onSelect}
        key={item.label}
        selected={item.selected}
      >
        {item.label}
      </ToolbarButton>
    );
  }
  return (
    <ToolbarButton
      data-toolbar-item={key}
      color="filled"
      size="sm"
      square
      onClick={item.onClick}
      key={item.label}
    >
      {item.label}
    </ToolbarButton>
  );
}

/**
 * 操作ツールバーの描画（取得監視・訓練で共通）。左に `<<`・`<`・階層名、中央に現在階層の項目、
 * 右にクリア・送信。外枠class・部品は取得監視画面の `.monitoring-toolbar` 系をそのまま使う。
 */
export function OperationToolbar({
  toolbarId,
  title,
  atRoot,
  navigationLabel,
  groups,
  selectionActive,
  sendReady,
  sendLabel,
  onBackToRoot,
  onBack,
  onClear,
  onSend,
}: OperationToolbarProps) {
  return (
    <div className="monitoring-toolbar">
      <div
        className="monitoring-toolbar-group monitoring-toolbar-navigation"
        role="group"
        aria-label={navigationLabel}
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
          onClick={onBackToRoot}
        >
          <ToolbarIcon>keyboard_double_arrow_left</ToolbarIcon>
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
          onClick={onBack}
        >
          <ToolbarIcon>keyboard_arrow_left</ToolbarIcon>
        </GbIconButton>
        {!atRoot && (
          <span className="monitoring-toolbar-title md-typescale-label-large" title={title}>
            {title}
          </span>
        )}
      </div>
      <div className="monitoring-toolbar-scroll">
        {groups.map((group) => (
          <div className="monitoring-toolbar-group" key={group.map((item) => item.label).join('-')}>
            {group.map((item) => renderItem(toolbarId, item))}
          </div>
        ))}
      </div>
      <div className="monitoring-toolbar-group monitoring-toolbar-submit">
        <ToolbarButton
          color="filled"
          softDisabled={!selectionActive}
          size="sm"
          square
          onClick={onClear}
        >
          <ToolbarIcon>close</ToolbarIcon>
          <span className="monitoring-toolbar-button-label">クリア</span>
        </ToolbarButton>
        <ToolbarButton
          color="filled"
          softDisabled={!sendReady}
          size="sm"
          square
          aria-label={sendLabel}
          onClick={onSend}
          sendReady={sendReady}
        >
          <ToolbarIcon>arrow_forward</ToolbarIcon>
          <span className="monitoring-toolbar-button-label">送信</span>
        </ToolbarButton>
      </div>
    </div>
  );
}
