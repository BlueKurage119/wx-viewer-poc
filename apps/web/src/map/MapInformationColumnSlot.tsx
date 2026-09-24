import { forwardRef, type ReactNode } from 'react';

export interface MapInformationColumnSlotProps {
  children?: ReactNode;
}

/**
 * 右側情報列の予約スロット (F1 / G1)
 *
 * G1以降は `InfoPanelColumn` を children として渡す（`WeatherMapView` が結線する）。
 * 列全体は一枚の面で覆わず、カード群より下に見える地図はドラッグ・ホイール等で操作可能とする。
 * カード自体はポインターイベントを消費し、初期の中心補正のために実測幅を提供する。
 */
export const MapInformationColumnSlot = forwardRef<HTMLElement, MapInformationColumnSlotProps>(
  function MapInformationColumnSlot({ children }, ref) {
    return (
      <aside ref={ref} className="map-information-column-slot" aria-label="気象情報詳細">
        {children}
      </aside>
    );
  },
);
