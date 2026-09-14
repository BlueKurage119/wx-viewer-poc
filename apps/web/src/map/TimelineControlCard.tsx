import { forwardRef, type ReactNode, type ChangeEvent, type KeyboardEvent } from 'react';
import type { TimelineViewModel, TimelineIntent, TimelineFrameKind } from './types';

export interface TimelineControlCardProps {
  viewModel: TimelineViewModel;
  onIntent: (intent: TimelineIntent) => void;
  layerSelector?: ReactNode;
  statusSlot?: ReactNode;
}

function getKindLabel(kind?: TimelineFrameKind): string {
  switch (kind) {
    case 'observed':
      return '実況';
    case 'forecast':
      return '予報';
    case 'reference':
      return '基準';
    default:
      return '';
  }
}

/**
 * 時間操作カードコンポーネント (F4 §5, §9.3)
 *
 * 右列を除く地図領域の下部中央に常設されるダークテーマ操作面。
 * 表示モデル (TimelineViewModel) に基づいて描画し、入力操作を TimelineIntent として上位へ通知する。
 */
export const TimelineControlCard = forwardRef<HTMLDivElement, TimelineControlCardProps>(
  function TimelineControlCard({ viewModel, onIntent, layerSelector, statusSlot }, ref) {
    const { selectedFrameId, selectedFrameLabel, frames, playing, latestAvailable } = viewModel;

    const isEmpty = frames.length === 0;
    const currentIndex = selectedFrameId ? frames.findIndex((f) => f.id === selectedFrameId) : -1;
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const currentFrame = currentIndex >= 0 ? frames[currentIndex] : undefined;

    const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextIndex = Number(event.target.value);
      const targetFrame = frames[nextIndex];
      if (targetFrame && targetFrame.enabled) {
        onIntent({ type: 'select-frame', frameId: targetFrame.id });
      }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (isEmpty) return;
      if (event.key === 'Home') {
        const first = frames[0];
        if (first) {
          event.preventDefault();
          onIntent({ type: 'select-frame', frameId: first.id });
        }
      } else if (event.key === 'End') {
        const last = frames[frames.length - 1];
        if (last) {
          event.preventDefault();
          onIntent({ type: 'select-frame', frameId: last.id });
        }
      }
    };

    const ariaValueText = currentFrame
      ? `${getKindLabel(currentFrame.kind)} ${currentFrame.displayTime}`
      : '利用可能な時刻はありません';

    return (
      <section
        ref={ref}
        className="timeline-control-card"
        aria-label="時間操作"
        onWheel={(event) => event.stopPropagation()}
      >
        {/* 上段: レイヤー選択と選択日時サマリー */}
        <div className="timeline-summary-row">
          <div className="timeline-layer-slot">{layerSelector}</div>

          <div className="timeline-frame-summary">
            {isEmpty ? (
              <span className="timeline-empty-message">利用可能な時刻はありません</span>
            ) : (
              <>
                {currentFrame && (
                  <span className={`timeline-kind-badge kind-${currentFrame.kind}`}>
                    {getKindLabel(currentFrame.kind)}
                  </span>
                )}
                <span className="timeline-selected-time">{selectedFrameLabel}</span>
              </>
            )}
            {statusSlot && <div className="timeline-status-slot">{statusSlot}</div>}
          </div>
        </div>

        {/* 中段: フレームスライダー */}
        <div className="timeline-slider-row">
          {isEmpty ? (
            <div className="timeline-slider-empty" aria-disabled="true" />
          ) : (
            <div className="timeline-slider-track-wrapper">
              <input
                type="range"
                className="timeline-slider"
                min={0}
                max={frames.length - 1}
                step={1}
                value={safeIndex}
                disabled={isEmpty}
                onChange={handleSliderChange}
                onKeyDown={handleKeyDown}
                aria-label="時刻スライダー"
                aria-valuemin={0}
                aria-valuemax={frames.length - 1}
                aria-valuenow={safeIndex}
                aria-valuetext={ariaValueText}
              />
              {/* 区間インジケーター（実況・予報等の区間色を示唆、文字は書かない） */}
              <div className="timeline-track-segments" aria-hidden="true">
                {frames.map((frame, i) => (
                  <div
                    key={frame.id}
                    className={`timeline-segment segment-${frame.kind} ${
                      i === safeIndex ? 'is-active' : ''
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 下段: トランスポート操作ボタン（前、再生／停止、次、最新へ） */}
        <div className="timeline-transport-row">
          <button
            type="button"
            className="timeline-transport-button"
            disabled={isEmpty || safeIndex <= 0}
            onClick={() => onIntent({ type: 'previous-frame' })}
            aria-label="前のコマへ"
            title="前へ"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          <button
            type="button"
            className="timeline-transport-button timeline-play-button"
            disabled={isEmpty}
            onClick={() => onIntent({ type: 'toggle-play' })}
            aria-label={playing ? '停止' : '再生'}
            title={playing ? '停止' : '再生'}
          >
            {playing ? (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
              </svg>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="timeline-transport-button"
            disabled={isEmpty || safeIndex >= frames.length - 1}
            onClick={() => onIntent({ type: 'next-frame' })}
            aria-label="次のコマへ"
            title="次へ"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="m6 18 8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          <button
            type="button"
            className="timeline-transport-button timeline-latest-button"
            disabled={isEmpty || !latestAvailable}
            onClick={() => onIntent({ type: 'select-latest' })}
            aria-label="最新へ"
            title="最新へ"
          >
            <span className="latest-button-text">最新へ</span>
          </button>
        </div>
      </section>
    );
  },
);
