/**
 * データ色スケールの 1 階級。色そのものは CSS トークンだけが持つ（06-ui-md3-protocol）
 */
export interface DataColorStep {
  /** CSS カスタムプロパティ名。例 '--wx-data-nowcast-1' */
  readonly token: string;
  /** 凡例に出す階級ラベル。例 '0〜1' */
  readonly label: string;
}

export interface DataColorScale {
  /** 凡例の見出しに使う単位。例 'mm/h' */
  readonly unit: string;
  /** 出典表記。例 '気象庁 高解像度降水ナウキャスト' */
  readonly sourceLabel: string;
  /** 弱い側から強い側への昇順 */
  readonly steps: readonly DataColorStep[];
}
