import type React from 'react';
import { CircularProgress } from '../../components/md';
import { useDelayedFlag, SPINNER_SHOW_DELAY_MS, SPINNER_MIN_VISIBLE_MS } from './useDelayedFlag';

export { SPINNER_SHOW_DELAY_MS, SPINNER_MIN_VISIBLE_MS };

export interface NowcastLoadingSpinnerProps {
  readonly loading: boolean;
}

/**
 * ナウキャスト読込中スピナーコンポーネント (§9.4.8)
 *
 * - 表示開始遅延 (250ms) と最小表示時間 (400ms) によるちらつき防止 (useDelayedFlag に委任)
 * - 時間操作カードの高さを動かさないための領域確保 (非表示時は visibility: hidden)
 * - pointer-events: none により下層の操作を妨げない
 * - aria-hidden="true" により支援技術から隠し、文言は表示しない
 * - 色は MD3 トークン (--md-sys-color-primary) を使用
 */
export function NowcastLoadingSpinner({ loading }: NowcastLoadingSpinnerProps) {
  const visible = useDelayedFlag(loading);

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
