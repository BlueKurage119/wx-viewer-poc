import type { LayerPresentation } from './types';

export interface MapLegendProps {
  presentation: LayerPresentation;
  open: boolean;
  onClose: () => void;
}

/**
 * 地図凡例カード (F5 §6, §9.4)
 *
 * 地図左上に固定配置される不透明ダークカード。
 * 閉じるボタンを持ち、閉じた後は時間カード内の再表示ボタンから復帰可能。
 */
export function MapLegend({ presentation, open, onClose }: MapLegendProps) {
  if (!open) return null;

  return (
    <div className="map-legend" aria-label="地図凡例" onWheel={(event) => event.stopPropagation()}>
      <div className="legend-header">
        <span className="legend-title">{presentation.legendTitle}</span>
        <button
          type="button"
          className="legend-close-button"
          aria-label="凡例を閉じる"
          onClick={onClose}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <ul className="legend-items">
        {presentation.legendItems.map((item, index) => (
          <li key={index} className="legend-item">
            <span
              className="legend-swatch"
              style={{ backgroundColor: item.swatchToken }}
              aria-hidden="true"
            />
            <span className="legend-label">{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="legend-footer">
        <span className="legend-source">出典: {presentation.sourceLabel}</span>
      </div>
    </div>
  );
}
