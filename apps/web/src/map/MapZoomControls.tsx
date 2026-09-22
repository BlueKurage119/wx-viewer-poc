export interface MapZoomControlsProps {
  currentZoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReturnToVenue: () => void;
}

/**
 * 地図ズーム操作および会場復帰コントロール (F6 §7, §9.5)
 *
 * 左下に、上から拡大 (＋)、縮小 (－)、現在地形アイコン (会場復帰) の順で縦配置。
 * ボタンの視覚ラベルは ＋、－、アイコンのみとし、補足テキストを常時表示しない。
 */
export function MapZoomControls({
  currentZoom,
  minZoom = 9,
  maxZoom = 18,
  onZoomIn,
  onZoomOut,
  onReturnToVenue,
}: MapZoomControlsProps) {
  const canZoomIn = currentZoom < maxZoom;
  const canZoomOut = currentZoom > minZoom;

  return (
    <div
      className="map-zoom-controls"
      aria-label="地図拡大縮小と会場復帰"
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="map-zoom-button"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        aria-label="地図を拡大"
        title="拡大"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <button
        type="button"
        className="map-zoom-button"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        aria-label="地図を縮小"
        title="縮小"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <button
        type="button"
        className="map-zoom-button map-return-button"
        onClick={onReturnToVenue}
        aria-label="会場の初期位置に戻る"
        title="会場の初期位置に戻る"
      >
        {/* 現在地形アイコン（照準 / my_location / 標的ピン風アイコン） */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="8" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
        </svg>
      </button>
    </div>
  );
}
