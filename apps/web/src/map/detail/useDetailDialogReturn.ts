/**
 * 詳細ダイアログの開閉復帰 (G10 §4.2 D2)。
 *
 * 開く前のフォーカス要素・スクロールコンテナの scrollTop を保存し、閉じた後に復帰する。
 */
import { useCallback, useRef } from 'react';

export interface DetailDialogReturnController {
  /** open が true になるとき（showModal の直前）に呼ぶ */
  readonly save: () => void;
  /** 閉じた後（queueMicrotask 後）に呼ぶ */
  readonly restore: () => void;
}

export function useDetailDialogReturn(
  scrollContainer: HTMLElement | null | undefined,
): DetailDialogReturnController {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousScrollTopRef = useRef<number | null>(null);

  const save = useCallback(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousScrollTopRef.current = scrollContainer ? scrollContainer.scrollTop : null;
  }, [scrollContainer]);

  const restore = useCallback(() => {
    // (a) フォーカス復帰
    const fallback = document.getElementById('view-content');
    const target = previousFocusRef.current?.isConnected ? previousFocusRef.current : fallback;
    target?.focus({ preventScroll: true });
    // (b) スクロール位置復帰。フォーカスによる自動スクロールを上書きするため(a)の後に行う
    if (scrollContainer && previousScrollTopRef.current !== null) {
      scrollContainer.scrollTop = previousScrollTopRef.current;
    }
  }, [scrollContainer]);

  return { save, restore };
}
