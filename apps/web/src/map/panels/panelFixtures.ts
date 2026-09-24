/**
 * 実データ結線前の仮データ (G1 §6)。
 *
 * 開発ビルド限定で `?panelFixture=<名前>` から状態セットを切り替える。
 * 本番ビルドでは `resolvePanelFixtureInput` が常に `undefined` を返す。
 */
import type { InfoPanelCardInput, InfoPanelColumnInput } from './panelDefinitions';

const DUMMY_CONTENT = '（G2〜G7で実装）';

function todayAt(hour: number, minute: number): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  jst.setUTCHours(hour, minute, 0, 0);
  return new Date(jst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

function contentCard(
  key: string,
  time: string,
  timeKind: 'issued' | 'observed',
  availability: 'available' | 'stale',
  heading?: string,
): InfoPanelCardInput {
  return {
    key,
    heading,
    status: { kind: 'data', availability, time, timeKind },
    content: DUMMY_CONTENT,
  };
}

const LOADING_CARD: InfoPanelCardInput = { key: 'default', status: { kind: 'loading' } };
const FAILED_CARD: InfoPanelCardInput = { key: 'default', status: { kind: 'failed' } };

/** 既定値: 全パネル loading（always 4枚はスケルトン、occasional 2枚は非表示） */
export const DEFAULT_INFO_PANEL_INPUT: InfoPanelColumnInput = Object.freeze({
  bosaiBulletin: Object.freeze([]),
  warning: Object.freeze([LOADING_CARD]),
  warningTimeSeries: Object.freeze([LOADING_CARD]),
  earlyWarning: Object.freeze([LOADING_CARD]),
  amedas: Object.freeze([LOADING_CARD]),
  areaForecast: Object.freeze([LOADING_CARD]),
});

function buildAllContentFixture(): InfoPanelColumnInput {
  return Object.freeze({
    // 入力は古い順に渡す（並べ替えロジックの確認用、§6）
    bosaiBulletin: Object.freeze([
      contentCard(
        'bosai-2',
        todayAt(13, 40),
        'issued',
        'available',
        '東京都気象防災速報（記録的短時間大雨）',
      ),
      contentCard(
        'bosai-1',
        todayAt(14, 5),
        'issued',
        'available',
        '東京都気象防災速報（竜巻注意）',
      ),
    ]),
    warning: Object.freeze([contentCard('warning', todayAt(14, 0), 'issued', 'available')]),
    warningTimeSeries: Object.freeze([
      contentCard('warningTimeSeries', todayAt(14, 0), 'issued', 'available'),
    ]),
    earlyWarning: Object.freeze([
      contentCard('earlyWarning', todayAt(14, 0), 'issued', 'available'),
    ]),
    amedas: Object.freeze([contentCard('amedas', todayAt(14, 10), 'observed', 'available')]),
    areaForecast: Object.freeze([
      contentCard('areaForecast', todayAt(14, 0), 'issued', 'available'),
    ]),
  });
}

function buildMixedFixture(): InfoPanelColumnInput {
  return Object.freeze({
    bosaiBulletin: Object.freeze([]),
    warning: Object.freeze([contentCard('warning', todayAt(13, 0), 'issued', 'stale')]),
    warningTimeSeries: Object.freeze([FAILED_CARD]),
    earlyWarning: Object.freeze([LOADING_CARD]),
    amedas: Object.freeze([contentCard('amedas', todayAt(13, 10), 'observed', 'stale')]),
    areaForecast: Object.freeze([
      contentCard('areaForecast', todayAt(14, 0), 'issued', 'available'),
    ]),
  });
}

function buildFailedFixture(): InfoPanelColumnInput {
  return Object.freeze({
    bosaiBulletin: Object.freeze([FAILED_CARD]),
    warning: Object.freeze([FAILED_CARD]),
    warningTimeSeries: Object.freeze([FAILED_CARD]),
    earlyWarning: Object.freeze([FAILED_CARD]),
    amedas: Object.freeze([FAILED_CARD]),
    areaForecast: Object.freeze([FAILED_CARD]),
  });
}

const FIXTURE_BUILDERS: Readonly<Record<string, () => InfoPanelColumnInput>> = Object.freeze({
  'all-content': buildAllContentFixture,
  mixed: buildMixedFixture,
  failed: buildFailedFixture,
});

export const PANEL_FIXTURE_NAMES: readonly string[] = Object.freeze(Object.keys(FIXTURE_BUILDERS));

/**
 * 開発ビルド限定で `?panelFixture=<名前>` からフィクスチャを取得する。
 * 本番ビルド・該当クエリなし・未知の名前のときは `undefined`。
 */
export function resolvePanelFixtureInput(): InfoPanelColumnInput | undefined {
  if (!import.meta.env?.DEV) {
    return undefined;
  }
  if (typeof window === 'undefined' || !window.location) {
    return undefined;
  }
  const name = new URLSearchParams(window.location.search).get('panelFixture');
  if (name === null) {
    return undefined;
  }
  const builder = FIXTURE_BUILDERS[name];
  return builder ? builder() : undefined;
}
