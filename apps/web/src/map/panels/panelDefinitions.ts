/**
 * 右側情報パネル (G1) の型・パネル定義。
 *
 * 基本設計 §5.2 の配置順・§5 の状態別表示区分をコードで固定する。
 * 実データの取得・結線は G2〜G7 の責務であり、ここでは枠の入出力のみを定義する。
 */
import type { ReactNode } from 'react';
import type { Availability } from '@wx-viewer-poc/shared';

export type InfoPanelId =
  | 'bosaiBulletin' // 気象防災速報（竜巻含む）
  | 'warning' // 警報・注意報
  | 'warningTimeSeries' // 警報等時系列
  | 'earlyWarning' // 警報級の可能性
  | 'amedas' // アメダス
  | 'areaForecast'; // 地域時系列予報

/** always: 常時あるべき情報 / occasional: 常時あるとは限らない情報 */
export type InfoPanelPresence = 'always' | 'occasional';

export interface InfoPanelDefinition {
  readonly id: InfoPanelId;
  readonly title: string; // UI表示名（§5.2の名称）
  readonly presence: InfoPanelPresence;
}

/** 6パネルの配置順（基本設計 §5.2）。この配列順が唯一の正である。 */
export const PANEL_DEFINITIONS: readonly InfoPanelDefinition[] = Object.freeze([
  Object.freeze({ id: 'bosaiBulletin', title: '気象防災速報', presence: 'occasional' }),
  Object.freeze({ id: 'warning', title: '警報・注意報', presence: 'occasional' }),
  Object.freeze({ id: 'warningTimeSeries', title: '警報等時系列', presence: 'always' }),
  Object.freeze({ id: 'earlyWarning', title: '警報級の可能性', presence: 'always' }),
  Object.freeze({ id: 'amedas', title: 'アメダス', presence: 'always' }),
  Object.freeze({ id: 'areaForecast', title: '地域時系列予報', presence: 'always' }),
]);

/** パネルへ渡す状態入力。G2〜G7の結線時に各パネルが組み立てる */
export type InfoPanelStatus =
  | { readonly kind: 'loading' } // 初回取得中（保持値なし）
  | { readonly kind: 'failed' } // 取得失敗かつ保持値なし
  | { readonly kind: 'empty' } // 正常取得・発表なし（occasional用）
  | {
      readonly kind: 'data';
      readonly availability: Extract<Availability, 'available' | 'stale'>;
      readonly time: string; // 発表／観測時刻 ISO8601
      readonly timeKind: 'issued' | 'observed';
    };

export type InfoPanelDisplay =
  | { readonly mode: 'hidden' }
  | { readonly mode: 'skeleton' }
  | { readonly mode: 'failed' }
  | { readonly mode: 'content'; readonly time: string; readonly timeKind: 'issued' | 'observed' };

/** 1カード分の入力 */
export interface InfoPanelCardInput {
  readonly key: string; // Reactのkey（速報は電文ID等）
  readonly heading?: string; // 省略時は definition.title（速報は Report/Head/Title）
  readonly status: InfoPanelStatus;
  readonly content?: ReactNode;
}

/** 種別ごとの入力。always 種別は常に1件、occasional 種別は0件以上 */
export type InfoPanelColumnInput = Readonly<Record<InfoPanelId, readonly InfoPanelCardInput[]>>;
