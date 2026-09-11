import type { UtcIso8601String } from '@wx-viewer-poc/shared';

export const AMEDAS_LATEST_TIME_URL = 'https://www.jma.go.jp/bosai/amedas/data/latest_time.txt';

export const AMEDAS_LATEST_TIME_SOURCE_KIND = 'amedas_latest_time';
export const AMEDAS_POINT_SOURCE_KIND = 'amedas_point';

/**
 * 値が数値でも欠測相当として扱う AQC 値（§3.4.2、基本設計 §5.10 追記）。
 * 5 = 休止中、6 = ×。
 */
export const AMEDAS_MISSING_EQUIVALENT_AQC: readonly number[] = [5, 6];

/**
 * elems の桁順（気温/降水/風向/風速/日照/積雪/湿度/気圧）と、各系列に属する
 * JSON 要素キーの対応表（§3.4.1）。添字が桁位置に対応する。
 */
export const AMEDAS_ELEMENT_SERIES: readonly (readonly string[])[] = [
  ['temp', 'maxTemp', 'minTemp', 'maxTempTime', 'minTempTime'], // 0: 気温
  ['precipitation10m', 'precipitation1h', 'precipitation3h', 'precipitation24h'], // 1: 降水
  ['windDirection', 'gustDirection'], // 2: 風向
  ['wind', 'gust', 'gustTime'], // 3: 風速
  ['sun10m', 'sun1h'], // 4: 日照
  ['snow', 'snow1h', 'snow6h', 'snow12h', 'snow24h'], // 5: 積雪
  ['humidity'], // 6: 湿度
  ['pressure', 'normalPressure'], // 7: 気圧
];

const ELEMENTS_PATTERN = /^[0-9]{8}$/;

function validateElements(elements: string): void {
  if (!ELEMENTS_PATTERN.test(elements)) {
    throw new Error(`Amedas elements must match ^[0-9]{8}$, received: "${elements}"`);
  }
}

/**
 * 地点表 elems（8桁）から、その地点が提供しない要素キーの集合を導出する（§3.4.1）。
 * 桁が '0' の系列に属するキーだけを返す。'1'（観測）も '2'（推計）も非対応ではないため
 * 含めない（推計かどうかは resolveEstimatedElements が別に返す）。
 * elems が /^[0-9]{8}$/ に一致しない場合は例外を投げる（会場定義の誤り）。
 */
export function resolveUnsupportedElements(elements: string): ReadonlySet<string> {
  validateElements(elements);
  const unsupported = new Set<string>();
  for (let i = 0; i < 8; i++) {
    if (elements[i] === '0') {
      const keys = AMEDAS_ELEMENT_SERIES[i];
      if (keys) {
        for (const key of keys) {
          unsupported.add(key);
        }
      }
    }
  }
  return unsupported;
}

/**
 * 地点表 elems（8桁）から、その地点が推計で提供する要素キーの集合を導出する（§3.4.3）。
 * 桁が '2' の系列に属するキーだけを返す。'0'（非対応）・'1'（観測）・その他の桁は含まない。
 * 形式検証と例外送出は resolveUnsupportedElements と同一規則。
 */
export function resolveEstimatedElements(elements: string): ReadonlySet<string> {
  validateElements(elements);
  const estimated = new Set<string>();
  for (let i = 0; i < 8; i++) {
    if (elements[i] === '2') {
      const keys = AMEDAS_ELEMENT_SERIES[i];
      if (keys) {
        for (const key of keys) {
          estimated.add(key);
        }
      }
    }
  }
  return estimated;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の最新観測時刻から 3 時間ブロックキー `YYYYMMDD_HH` を求める（§2.3.2 で実測検証）。 */
export function resolveBlockKey(latestTimeUtc: UtcIso8601String): string {
  const utcMs = Date.parse(latestTimeUtc);
  if (Number.isNaN(utcMs)) {
    throw new Error(`Invalid UTC ISO 8601 string: "${latestTimeUtc}"`);
  }
  const jstDate = new Date(utcMs + JST_OFFSET_MS);

  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  const jstHour = jstDate.getUTCHours();

  const blockHour = Math.floor(jstHour / 3) * 3;
  const hh = String(blockHour).padStart(2, '0');

  return `${year}${month}${day}_${hh}`;
}

/** 地点コードはリテラルで埋め込まず引数で受け取る（§3.6）。 */
export function buildPointBlockUrl(stationCode: string, blockKey: string): string {
  return `https://www.jma.go.jp/bosai/amedas/data/point/${stationCode}/${blockKey}.json`;
}
