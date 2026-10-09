import { useMemo, useRef } from 'react';
import type { MonitoringStatusResponse, WeatherRole } from '@wx-viewer-poc/shared';
import type { WeatherRestartState } from './weatherRestartController';

export interface BaselineEntry {
  requestId: string | null;
  /** 完了を受領した時点で保持していた監視応答。これより後の応答を基準にする。 */
  seen: MonitoringStatusResponse | null;
  baseline: string | null;
}

/** 完了受領後の基準時刻を1回分進める。完了受領時点の応答と別の応答が来たら、それを基準にする。 */
export function nextBaselineEntry(
  entry: BaselineEntry,
  state: WeatherRestartState,
  data: MonitoringStatusResponse | null,
): BaselineEntry {
  const requestId = state.phase === 'completed' ? state.request.requestId : null;
  if (entry.requestId !== requestId) return { requestId, seen: data, baseline: null };
  if (requestId !== null && entry.baseline === null && data !== null && data !== entry.seen) {
    return { ...entry, baseline: data.generatedAt };
  }
  return entry;
}

/**
 * 再起動の完了を受領した後に最初に得た監視応答の generatedAt を、役割ごとに保持する。
 * 完了受領の再取得で応答が置き換わるため、受領時点と別の応答が来たものを基準とする。
 */
export function useRestartBaselines(
  restarts: Readonly<Record<WeatherRole, WeatherRestartState>>,
  data: MonitoringStatusResponse | null,
): Readonly<Record<WeatherRole, string | null>> {
  const entries = useRef<Record<WeatherRole, BaselineEntry>>({
    acquisition: { requestId: null, seen: null, baseline: null },
    delivery: { requestId: null, seen: null, baseline: null },
  });
  for (const role of ['acquisition', 'delivery'] as const) {
    const state = restarts[role];
    const requestId = state.phase === 'completed' ? state.request.requestId : null;
    const entry = entries.current[role];
    if (entry.requestId !== requestId) {
      entries.current[role] = { requestId, seen: data, baseline: null };
    } else if (
      requestId !== null &&
      entry.baseline === null &&
      data !== null &&
      data !== entry.seen
    ) {
      entry.baseline = data.generatedAt;
    }
  }
  const acquisition = entries.current.acquisition.baseline;
  const delivery = entries.current.delivery.baseline;
  return useMemo(() => ({ acquisition, delivery }), [acquisition, delivery]);
}

/** 文面が変わった順序を数える。同じ文面のままなら順序は進めない。 */
export function useChangeSequence(texts: Readonly<Record<string, string | null>>) {
  const previous = useRef<Record<string, string | null>>({});
  const sequence = useRef<Record<string, number>>({});
  const counter = useRef(0);
  for (const [key, text] of Object.entries(texts)) {
    if (previous.current[key] !== text) {
      previous.current[key] = text;
      sequence.current[key] = ++counter.current;
    }
  }
  return (key: string) => sequence.current[key] ?? 0;
}
