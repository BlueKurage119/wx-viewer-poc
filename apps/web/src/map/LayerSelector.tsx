import type { ChangeEvent } from 'react';
import type { MapLayerId } from './types';

export interface LayerSelectorProps {
  selectedLayerId: MapLayerId;
  onLayerSelect: (layerId: MapLayerId) => void;
}

/**
 * 左下の独立フローティングレイヤー選択コントロール (F5 §6, §9.4)
 *
 * 単一選択であり、洪水・雷・竜巻・複数同時選択は除外されている。
 * 画面上の冗長なラベルは表示せず、aria-label によるアクセシビリティを確保する。
 */
export function LayerSelector({ selectedLayerId, onLayerSelect }: LayerSelectorProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onLayerSelect(event.target.value as MapLayerId);
  };

  return (
    <div className="map-layer-selector-floating" onWheel={(event) => event.stopPropagation()}>
      <select
        value={selectedLayerId}
        onChange={handleChange}
        className="map-layer-select-dropdown"
        aria-label="表示レイヤー選択"
      >
        <option value="nowcast">雨雲ナウキャスト</option>
        <optgroup label="キキクル（危険度分布）">
          <option value="kikikuru-heavyrain">キキクル（大雨）</option>
          <option value="kikikuru-inund">キキクル（浸水）</option>
          <option value="kikikuru-land">キキクル（土砂）</option>
        </optgroup>
      </select>
    </div>
  );
}
