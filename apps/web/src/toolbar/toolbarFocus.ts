import type { ToolbarDefinition, ToolbarId } from './operationToolbarState';

export type ToolbarFocusRequest =
  | { readonly kind: 'first' }
  /** 戻った先で、指定の階層へ進む navigate 項目へフォーカスする。 */
  | { readonly kind: 'navigate'; readonly fromId: ToolbarId };

/** フォーカス先の項目キー（`階層ID:ラベル`）。見つからなければ null。 */
export function toolbarFocusKey<TItem extends { readonly label: string }>(
  definitions: readonly ToolbarDefinition<TItem>[],
  history: readonly ToolbarId[],
  request: ToolbarFocusRequest,
  isNavigateTo: (item: TItem, toolbarId: ToolbarId) => boolean,
): string | null {
  const currentId = history.at(-1);
  const current = definitions.find((definition) => definition.id === currentId);
  if (!current) return null;
  if (request.kind === 'first') {
    const first = current.groups.flat()[0];
    return first ? `${current.id}:${first.label}` : null;
  }
  for (const item of current.groups.flat()) {
    if (isNavigateTo(item, request.fromId)) return `${current.id}:${item.label}`;
  }
  return null;
}

/** 描画直後の Lit 要素は内部の button が未生成のため、更新完了を待ってからフォーカスする。 */
export function focusToolbarItem(key: string): void {
  const element = document.querySelector<HTMLElement>(`[data-toolbar-item="${CSS.escape(key)}"]`);
  if (!element) return;
  const updateComplete = (element as HTMLElement & { updateComplete?: Promise<unknown> })
    .updateComplete;
  if (updateComplete) void updateComplete.then(() => element.focus());
  else element.focus();
}
