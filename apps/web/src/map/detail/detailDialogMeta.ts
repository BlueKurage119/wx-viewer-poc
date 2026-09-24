/**
 * 詳細ダイアログ共通コンポーネントのメタ情報 (G10 §3.2)。
 *
 * 見出し2行目（対象地域／地点・発表または観測時刻・訓練ラベル）の組み立てを担う。
 * null は「要素ごと省く」（§3.3、確定Q1・Q2）。boolean へ丸めない (07-wx-data-protocol.md)。
 */
import { formatPanelTime } from '../panels/panelTime';

/** 見出し下に出す時刻。発表と観測を型で区別し、値が無い場合も種別は保持する */
export interface DetailDialogTime {
  readonly kind: 'issued' | 'observed';
  readonly value: string | null; // ISO8601。null=時刻不明（取得前・電文に無い等）
}

export interface DetailDialogMeta {
  readonly title: string; // 見出し（例「地域時系列予報」）
  readonly target: string | null; // 対象地域／地点（例「東京地方」「江戸川臨海」）。null=未確定
  readonly time: DetailDialogTime;
  /** 本番/訓練。true=訓練、false=本番、null=不明。boolean に丸めない */
  readonly isTraining: boolean | null;
}

export interface FormattedDetailDialogMeta {
  readonly target: string | null;
  readonly time: string | null; // 例「14:05発表」「9/23 14:05発表」「14:10観測」
  readonly trainingLabel: string | null;
}

/** 見出し2行目の各要素。null は要素ごと省く（§3.3） */
export function formatDetailDialogMeta(
  meta: DetailDialogMeta,
  now: Date = new Date(),
): FormattedDetailDialogMeta {
  return {
    target: meta.target,
    time: meta.time.value === null ? null : formatPanelTime(meta.time.value, meta.time.kind, now),
    // isTraining === true のときだけ表示。false・null は何も出さない（§3.3、確定Q2）
    trainingLabel: meta.isTraining === true ? '訓練' : null,
  };
}
