import { useState, useEffect, useRef } from 'react';
import { CircularProgress } from '../../components/md';

export const SPINNER_SHOW_DELAY_MS = 250;
export const SPINNER_MIN_VISIBLE_MS = 400;

export interface NowcastLoadingSpinnerProps {
  readonly loading: boolean;
}

/**
 * ナウキャスト読込中スピナーコンポーネント (§9.4.8)
 *
 * - 表示開始遅延 (250ms) と最小表示時間 (400ms) によるちらつき防止
 * - 時間操作カードの高さを動かさないための領域確保 (非表示時は visibility: hidden)
 * - pointer-events: none により下層の操作を妨げない
 * - aria-hidden="true" により支援技術から隠し、文言は表示しない
 * - 色は MD3 トークン (--md-sys-color-primary) を使用
 */
export function NowcastLoadingSpinner({ loading }: NowcastLoadingSpinnerProps) {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      // 消灯タイマーが動いていればキャンセル（表示継続）
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (!visible && showTimerRef.current === null) {
        // 250ms の表示遅延タイマーを開始
        showTimerRef.current = setTimeout(() => {
          setVisible(true);
          showStartTimeRef.current = performance.now();
          showTimerRef.current = null;
        }, SPINNER_SHOW_DELAY_MS);
      }
    } else {
      // 読込終了時: 表示タイマーが動いていればキャンセル（スピナーは出ない）
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      if (visible) {
        // 既に表示されている場合、最小表示時間 (400ms) を満たすよう消灯をスケジュール
        const now = performance.now();
        const elapsed =
          showStartTimeRef.current !== null
            ? now - showStartTimeRef.current
            : SPINNER_MIN_VISIBLE_MS;
        const remaining = SPINNER_MIN_VISIBLE_MS - elapsed;

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
  }, [loading, visible]);

  // アンマウント時のタイマークリア
  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return (
    <div
      className="nowcast-loading-spinner-container"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        pointerEvents: 'none',
        visibility: visible ? 'visible' : 'hidden',
      }}
      aria-hidden="true"
    >
      <CircularProgress
        indeterminate
        aria-hidden="true"
        style={
          {
            '--md-circular-progress-size': '16px',
            '--md-circular-progress-active-indicator-width': '2px',
            '--md-circular-progress-active-indicator-color': 'var(--md-sys-color-primary)',
            pointerEvents: 'none',
          } as React.CSSProperties
        }
      />
    </div>
  );
}
