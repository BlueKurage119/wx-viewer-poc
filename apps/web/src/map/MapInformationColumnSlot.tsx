import { forwardRef, type ReactNode } from 'react';

export interface MapInformationColumnSlotProps {
  children?: ReactNode;
}

/**
 * 右側情報列の予約スロット (F1 / G1)
 *
 * G1 が後から実カード列を渡すまで同じ位置・幅を占め、会場中心補正のための測定基準となる。
 * 情報カードの見出し、アイコン、データ、スクロール内容は持たない。
 */
export const MapInformationColumnSlot = forwardRef<HTMLElement, MapInformationColumnSlotProps>(
  function MapInformationColumnSlot({ children }, ref) {
    return (
      <aside
        ref={ref}
        className="map-information-column-slot"
        aria-label="気象情報詳細"
        onWheel={(event) => event.stopPropagation()}
      >
        {children}
      </aside>
    );
  },
);
