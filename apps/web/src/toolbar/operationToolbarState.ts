/** 操作ツールバー（取得監視・訓練で共通）の階層・選択状態。画面固有の型は含まない。 */

export type ToolbarId = string;

export interface ToolbarDefinition<TItem> {
  readonly id: ToolbarId;
  readonly title: string;
  readonly groups: readonly (readonly TItem[])[];
}

export interface ToolbarLocalState<TSelection, TDialog> {
  readonly history: readonly ToolbarId[];
  readonly selectedOperation: TSelection | null;
  readonly openDialog: TDialog | null;
}

export function createToolbarLocalState<TSelection, TDialog>(
  rootId: ToolbarId,
): ToolbarLocalState<TSelection, TDialog> {
  return { history: [rootId], selectedOperation: null, openDialog: null };
}

export function currentToolbar<TItem>(
  state: { readonly history: readonly ToolbarId[] },
  definitions: readonly ToolbarDefinition<TItem>[],
  missingMessage = 'ツールバーのルート定義が見つかりません',
): ToolbarDefinition<TItem> {
  const currentId = state.history.at(-1);
  const current = definitions.find((definition) => definition.id === currentId);
  if (!current) throw new Error(missingMessage);
  return current;
}

/** 選択のトグル。同じ選択を再度指定すると解除する。 */
export function toggleToolbarSelection<
  S extends ToolbarLocalState<TSelection, TDialog>,
  TSelection,
  TDialog,
>(
  state: S,
  selection: TSelection,
  isSame: (current: TSelection, next: TSelection) => boolean = (a, b) => a === b,
): S {
  const current = state.selectedOperation;
  return {
    ...state,
    selectedOperation: current !== null && isSame(current, selection) ? null : selection,
  };
}

export function clearToolbarSelection<S extends { readonly selectedOperation: unknown }>(
  state: S,
): S {
  return { ...state, selectedOperation: null };
}

export function navigateToolbar<TItem, S extends ToolbarLocalState<unknown, unknown>>(
  state: S,
  definitions: readonly ToolbarDefinition<TItem>[],
  toolbarId: ToolbarId,
): S {
  const currentId = state.history.at(-1);
  if (toolbarId === currentId || !definitions.some((definition) => definition.id === toolbarId)) {
    return state;
  }
  return {
    ...state,
    history: [...state.history, toolbarId],
    selectedOperation: null,
    openDialog: null,
  };
}

export function backToolbar<S extends ToolbarLocalState<unknown, unknown>>(state: S): S {
  if (state.history.length <= 1) return state;
  return {
    ...state,
    history: state.history.slice(0, -1),
    selectedOperation: null,
    openDialog: null,
  };
}

export function backToolbarToRoot<S extends ToolbarLocalState<unknown, unknown>>(state: S): S {
  if (state.history.length <= 1) return state;
  return { ...state, history: [state.history[0]!], selectedOperation: null, openDialog: null };
}

/** 画面から離れたとき。階層・選択・ダイアログをすべて破棄してルートへ戻す。 */
export function resetToolbarToRoot<S extends ToolbarLocalState<unknown, unknown>>(state: S): S {
  if (state.history.length <= 1 && state.selectedOperation === null && state.openDialog === null)
    return state;
  return { ...state, history: [state.history[0]!], selectedOperation: null, openDialog: null };
}
