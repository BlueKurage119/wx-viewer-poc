import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  backToolbar,
  backToolbarToRoot,
  clearToolbarSelection,
  createToolbarLocalState,
  currentToolbar,
  navigateToolbar,
  resetToolbarToRoot,
  type ToolbarDefinition,
  type ToolbarId,
  type ToolbarLocalState,
} from './operationToolbarState';
import { focusToolbarItem, toolbarFocusKey, type ToolbarFocusRequest } from './toolbarFocus';

export interface UseToolbarNavigationOptions<TItem> {
  /** false の間（画面を離れている間）は、階層・選択・ダイアログをルートへ破棄する。 */
  readonly active: boolean;
  readonly definitions: readonly ToolbarDefinition<TItem>[];
  readonly rootId: ToolbarId;
  readonly isNavigateTo: (item: TItem, toolbarId: ToolbarId) => boolean;
  readonly missingMessage?: string;
}

export interface ToolbarNavigation<TItem, TSelection, TDialog> {
  readonly localState: ToolbarLocalState<TSelection, TDialog>;
  readonly setLocalState: Dispatch<SetStateAction<ToolbarLocalState<TSelection, TDialog>>>;
  readonly currentToolbar: ToolbarDefinition<TItem>;
  readonly definitions: readonly ToolbarDefinition<TItem>[];
  clearSelection(): void;
  navigate(toolbarId: ToolbarId): void;
  back(): void;
  backToRoot(): void;
}

/** 階層移動・選択破棄・移動後のフォーカスを持つ、画面共通のツールバー状態。 */
export function useToolbarNavigation<
  TItem extends { readonly label: string },
  TSelection,
  TDialog,
>({
  active,
  definitions,
  rootId,
  isNavigateTo,
  missingMessage,
}: UseToolbarNavigationOptions<TItem>): ToolbarNavigation<TItem, TSelection, TDialog> {
  const definitionsRef = useRef(definitions);
  const rootIdRef = useRef(rootId);
  const isNavigateToRef = useRef(isNavigateTo);
  isNavigateToRef.current = isNavigateTo;
  const [localState, setLocalState] = useState<ToolbarLocalState<TSelection, TDialog>>(() =>
    createToolbarLocalState(rootIdRef.current),
  );

  useEffect(() => {
    if (active) return;
    // 画面を離れたら、戻ったときに常に最初のメニュー（ルート）から始める。
    setLocalState((state) => resetToolbarToRoot(state));
  }, [active]);

  // 階層移動後のフォーカス: 進むときは先頭の項目、戻るときは移動元の navigate 項目へ。
  const focusRequest = useRef<ToolbarFocusRequest | null>(null);
  const historyKey = localState.history.join('>');
  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) return;
    const key = toolbarFocusKey(
      definitionsRef.current,
      localState.history,
      request,
      isNavigateToRef.current,
    );
    if (key) focusToolbarItem(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  return {
    localState,
    setLocalState,
    currentToolbar: currentToolbar(localState, definitionsRef.current, missingMessage),
    definitions: definitionsRef.current,
    clearSelection() {
      setLocalState(clearToolbarSelection);
    },
    navigate(toolbarId) {
      focusRequest.current = { kind: 'first' };
      setLocalState((state) => navigateToolbar(state, definitionsRef.current, toolbarId));
    },
    back() {
      const history = localState.history;
      if (history.length > 1) focusRequest.current = { kind: 'navigate', fromId: history.at(-1)! };
      setLocalState(backToolbar);
    },
    backToRoot() {
      const history = localState.history;
      if (history.length > 1) focusRequest.current = { kind: 'navigate', fromId: history[1]! };
      setLocalState(backToolbarToRoot);
    },
  };
}
