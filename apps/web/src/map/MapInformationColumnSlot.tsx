import { forwardRef, type ReactNode } from 'react';

export interface MapInformationColumnSlotProps {
  children?: ReactNode;
}

/**
 * 右側情報列の予約スロット (F1 / G1)
 *
 * 将来 G1 がダークカード列を配置するためのコンテナ。
 * カード間に地図が見えるよう、スロット自体は不透明な面や境界線・影を持たない。
 * 会場中心補正のための遮蔽領域（幅）を確保し、列の一括スクロール操作面を提供する。
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
