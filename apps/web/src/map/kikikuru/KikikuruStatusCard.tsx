import { forwardRef, type ReactNode } from 'react';
import type { TimelineViewModel } from '../types';

export interface KikikuruStatusCardProps {
  readonly viewModel: TimelineViewModel;
  readonly statusSlot?: ReactNode;
}

/** キキクルの最新時刻だけを表示する、時間操作を持たない簡易カード。 */
export const KikikuruStatusCard = forwardRef<HTMLDivElement, KikikuruStatusCardProps>(
  function KikikuruStatusCard({ viewModel, statusSlot }, ref) {
    const hasFrame = viewModel.selectedFrameId !== null;
    return (
      <section
        ref={ref}
        className="timeline-control-card kikikuru-status-card"
        aria-label="キキクルの表示時刻"
      >
        <div className="timeline-summary-row">
          <div className="timeline-frame-summary">
            <span>{viewModel.layerLabel}</span>
            {hasFrame ? (
              <span className="timeline-selected-time">{viewModel.selectedFrameLabel}</span>
            ) : (
              <span className="timeline-empty-message">利用可能な時刻はありません</span>
            )}
            {statusSlot && <div className="timeline-status-slot">{statusSlot}</div>}
          </div>
        </div>
      </section>
    );
  },
);
