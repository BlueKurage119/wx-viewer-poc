import { useState, useEffect, useRef } from 'react';

export const SPINNER_SHOW_DELAY_MS = 250;
export const SPINNER_MIN_VISIBLE_MS = 400;

export interface UseDelayedFlagOptions {
  readonly showDelayMs?: number;
  readonly minVisibleMs?: number;
}

/**
 * 表示遅延と最小表示時間を持つフラグ制御フック (§9.4.8)
 *
 * - active が true になってから showDelayMs (既定 250ms) 経過後に true を返す (ちらつき防止)
 * - showDelayMs 未満で active が false に戻った場合は true にならない
 * - 一度 true になった後は、active が false に戻っても minVisibleMs (既定 400ms) 経過するまで true を維持する (最小表示時間)
 * - Lit 要素や DOM に依存せず、純粋な React 状態機械として動作する
 */
export function useDelayedFlag(active: boolean, options: UseDelayedFlagOptions = {}): boolean {
  const showDelayMs = options.showDelayMs ?? SPINNER_SHOW_DELAY_MS;
  const minVisibleMs = options.minVisibleMs ?? SPINNER_MIN_VISIBLE_MS;

  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      // 消灯タイマーが動いていればキャンセル (表示継続)
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (!visible && showTimerRef.current === null) {
        // 表示遅延タイマーを開始
        showTimerRef.current = setTimeout(() => {
          setVisible(true);
          showStartTimeRef.current = performance.now();
          showTimerRef.current = null;
        }, showDelayMs);
      }
    } else {
      // 読込終了時: 表示タイマーが動いていればキャンセル (スピナーは出ない)
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      if (visible) {
        // 既に表示されている場合、最小表示時間を満たすよう消灯をスケジュール
        const now = performance.now();
        const elapsed =
          showStartTimeRef.current !== null ? now - showStartTimeRef.current : minVisibleMs;
        const remaining = minVisibleMs - elapsed;

        if (remaining > 0) {
          if (hideTimerRef.current === null) {
            hideTimerRef.current = setTimeout(() => {
              setVisible(false);
              showStartTimeRef.current = null;
              hideTimerRef.current = null;
            }, remaining);
          }
        } else {
          setVisible(false);
          showStartTimeRef.current = null;
        }
      }
    }
  }, [active, visible, showDelayMs, minVisibleMs]);

  // アンマウント時のタイマークリア
  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return visible;
}
