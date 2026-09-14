import { forwardRef, type ReactNode } from 'react';

export interface MapInformationColumnSlotProps {
  children?: ReactNode;
}

const defaultPlaceholderCards = (
  <>
    <div className="map-info-placeholder-card" onWheel={(event) => event.stopPropagation()}>
      <span className="map-info-placeholder-label">情報カード（プレースホルダー 1）</span>
    </div>
    <div className="map-info-placeholder-card" onWheel={(event) => event.stopPropagation()}>
      <span className="map-info-placeholder-label">情報カード（プレースホルダー 2）</span>
    </div>
    <div className="map-info-placeholder-card" onWheel={(event) => event.stopPropagation()}>
      <span className="map-info-placeholder-label">情報カード（プレースホルダー 3）</span>
    </div>
  </>
);

/**
 * 右側情報列の予約スロット (F1 / G1)
 *
 * 実カードの前段として不透明なダークテーマのプレースホルダーカードを配置する。
 * 列全体は一枚の面で覆わず、カード群より下に見える地図はドラッグ・ホイール等で操作可能とする。
 * カード自体はポインターイベントを消費し、初期の中心補正のために実測幅を提供する。
 */
export const MapInformationColumnSlot = forwardRef<HTMLElement, MapInformationColumnSlotProps>(
  function MapInformationColumnSlot({ children }, ref) {
    return (
      <aside ref={ref} className="map-information-column-slot" aria-label="気象情報詳細">
        {children ?? defaultPlaceholderCards}
      </aside>
    );
  },
);
