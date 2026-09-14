import { useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const options: ReadonlyArray<{ id: MapLayerId; label: string }> = [
    { id: 'nowcast', label: '雨雲ナウキャスト' },
    { id: 'kikikuru-heavyrain', label: 'キキクル（大雨）' },
    { id: 'kikikuru-inund', label: 'キキクル（浸水）' },
    { id: 'kikikuru-land', label: 'キキクル（土砂）' },
  ];

  const handleSelect = (layerId: MapLayerId) => {
    onLayerSelect(layerId);
    setOpen(false);
  };

  return (
    <div className="map-layer-selector-floating" onWheel={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="map-layer-selector-fab"
        aria-label="表示レイヤーを選択"
        aria-haspopup="menu"
        aria-expanded={open}
        title="表示レイヤーを選択"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3 3 7.5l9 4.5 9-4.5L12 3Zm-9 9 9 4.5 9-4.5M3 16.5 12 21l9-4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="map-layer-selector-menu" role="menu" hidden={!open} aria-label="表示レイヤー">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={selectedLayerId === option.id}
            className="map-layer-selector-option"
            onClick={() => handleSelect(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
