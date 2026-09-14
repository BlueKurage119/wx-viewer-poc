import type { ChangeEvent } from 'react';
import type { MapLayerId } from './types';

export interface LayerSelectorProps {
  selectedLayerId: MapLayerId;
  onLayerSelect: (layerId: MapLayerId) => void;
  legendOpen: boolean;
  onOpenLegend: () => void;
}

/**
 * 時間操作カード内のレイヤー選択および凡例再表示ボタン (F5 §6, §9.4)
 *
 * 単一選択であり、洪水・雷・竜巻・複数同時選択は除外されている。
 * 凡例が閉じられているときはアイコンのみの「凡例を表示」ボタンを隣に提供する。
 */
export function LayerSelector({
  selectedLayerId,
  onLayerSelect,
  legendOpen,
  onOpenLegend,
}: LayerSelectorProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onLayerSelect(event.target.value as MapLayerId);
  };

  return (
    <div className="layer-selector-container">
      <label className="layer-selector-label">
        <span className="visually-hidden">表示レイヤー選択</span>
        <select
          value={selectedLayerId}
          onChange={handleChange}
          className="layer-select-dropdown"
          aria-label="表示レイヤー選択"
        >
          <option value="nowcast">雨雲ナウキャスト</option>
          <optgroup label="キキクル（危険度分布）">
            <option value="kikikuru-heavyrain">キキクル（大雨）</option>
            <option value="kikikuru-inund">キキクル（浸水）</option>
            <option value="kikikuru-land">キキクル（土砂）</option>
          </optgroup>
        </select>
      </label>

      {!legendOpen && (
        <button
          type="button"
          className="legend-open-button"
          aria-label="凡例を表示"
          title="凡例を表示"
          onClick={onOpenLegend}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 8h10M7 12h10M7 16h6" />
          </svg>
        </button>
      )}
    </div>
  );
}
