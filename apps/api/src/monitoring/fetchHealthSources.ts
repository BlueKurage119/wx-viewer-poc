import type { ScheduledSource } from '../config/pollingSchedule.js';

export type MonitoredFetchSourceId =
  | 'xml_regular'
  | 'xml_extra'
  | 'nowcast_target_times'
  | 'kikikuru_target_times'
  | 'amedas_latest_time'
  | 'amedas_point';

export interface MonitoredFetchSourceDefinition {
  readonly id: MonitoredFetchSourceId;
  /** 通知本文・監視画面に出す日本語名。 */
  readonly displayName: string;
  /** fetch_attempt.source_kind の集合。1 取得元が複数ストリームを持つ場合がある。 */
  readonly sourceKinds: readonly [string, ...string[]];
  /** 適用周期と停止状態の参照先（scheduler の status キー）。 */
  readonly scheduledSource: ScheduledSource;
  /** 経過時間条件（周期×3・固定10分）を適用するか。 */
  readonly appliesElapsedCondition: boolean;
}

/**
 * 判定対象から除外する source_kind の理由:
 * - xml_feed_regular_long, xml_feed_extra_long: 長期フィード。initial / recovery 時のみ取得され（role: 'long_term'）、周期取得されないため周期ベース閾値になじまない。
 * - xml_document: 個別電文取得。フィード新着に応じたオンデマンド取得であり周期を持たない（電文処理エラーは処理状態側の話題）。
 * - radar_tile, risk_tile_frame: タイル画像本体。オンデマンド取得のため周期ベースの判定になじまない未確定事項（別基準検討中）。
 */
export const MONITORED_FETCH_SOURCES: readonly MonitoredFetchSourceDefinition[] = [
  {
    id: 'xml_regular',
    displayName: 'XML 定時フィード',
    sourceKinds: ['xml_feed_regular'],
    scheduledSource: 'xml',
    appliesElapsedCondition: true,
  },
  {
    id: 'xml_extra',
    displayName: 'XML 随時フィード',
    sourceKinds: ['xml_feed_extra'],
    scheduledSource: 'xml',
    appliesElapsedCondition: true,
  },
  {
    id: 'nowcast_target_times',
    displayName: '雨雲時刻一覧',
    sourceKinds: ['radar_times_N1', 'radar_times_N2'],
    scheduledSource: 'nowcast',
    appliesElapsedCondition: true,
  },
  {
    id: 'kikikuru_target_times',
    displayName: 'キキクル時刻一覧',
    sourceKinds: ['risk_target_times'],
    scheduledSource: 'kikikuru',
    appliesElapsedCondition: true,
  },
  {
    id: 'amedas_latest_time',
    displayName: 'アメダス（時刻）',
    sourceKinds: ['amedas_latest_time'],
    scheduledSource: 'amedas',
    appliesElapsedCondition: true,
  },
  {
    id: 'amedas_point',
    displayName: 'アメダス（地点）',
    sourceKinds: ['amedas_point'],
    scheduledSource: 'amedas',
    appliesElapsedCondition: false,
  },
] as const;
