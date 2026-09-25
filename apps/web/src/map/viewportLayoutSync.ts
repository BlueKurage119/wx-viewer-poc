import type { ViewPlacement } from './types';

/**
 * 地図コンテナ・右列・時間カードの実測寸法 (Issue #212 §4.3)
 *
 * DOM に依存しない純粋モジュールが受け取る計測結果の形。
 */
export interface ViewportLayoutMeasurement {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly rightColumnWidth: number;
  readonly bottomCardHeight: number;
}

export type ViewportLayoutAction = 'skip' | 'resize-only' | 'align-venue';

/**
 * §4.2 の表を返す純関数。
 *
 * 地図コンテナの幅または高さが 0 のときは何もしない。
 * `initial`・`returning` は会場中心補正まで行い、`manual` はサイズ追従のみ行う。
 */
export function decideViewportLayoutAction(
  placement: ViewPlacement,
  measurement: ViewportLayoutMeasurement,
): ViewportLayoutAction {
  if (measurement.containerWidth <= 0 || measurement.containerHeight <= 0) {
    return 'skip';
  }
  if (placement === 'manual') {
    return 'resize-only';
  }
  return 'align-venue';
}

export interface ViewportLayoutSyncDependencies {
  measure(): ViewportLayoutMeasurement;
  getPlacement(): ViewPlacement;
  /** map.invalidateSize({ pan: false }) */
  invalidateSize(): void;
  /** measurement の R/B で会場を可視矩形の中心へ置く(ズーム 11、アニメーションなし) */
  alignVenue(measurement: ViewportLayoutMeasurement): void;
  /** returning で補正した後に呼ぶ(setPlacement('initial')) */
  onReturningAligned(): void;
}

export interface ViewportLayoutSync {
  /** 計測して §4.2 の動作を同期実行する。dispose 後は何もしない */
  sync(): void;
  dispose(): void;
}

/**
 * `MapViewport` の中心補正・リサイズ追従処理を一本化した同期処理 (Issue #212 §4.1・§4.3)
 *
 * 描画フレームやタイマーへ処理を委ねず、呼び出された時点で
 * 依存先の測定・Leaflet 操作をすべて同期的に完了させる。
 */
export function createViewportLayoutSync(
  dependencies: ViewportLayoutSyncDependencies,
): ViewportLayoutSync {
  let disposed = false;

  return {
    sync() {
      if (disposed) return;

      const measurement = dependencies.measure();
      const placement = dependencies.getPlacement();
      const action = decideViewportLayoutAction(placement, measurement);

      if (action === 'skip') return;

      dependencies.invalidateSize();

      if (action === 'align-venue') {
        dependencies.alignVenue(measurement);
        if (placement === 'returning') {
          dependencies.onReturningAligned();
        }
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
