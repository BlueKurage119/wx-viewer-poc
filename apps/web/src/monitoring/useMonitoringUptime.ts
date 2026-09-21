import { useEffect, useState } from 'react';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';

/**
 * サーバーから受け取った serverStartedAt / generatedAt を基準に、
 * 1秒周期でサーバー稼働秒数（Uptime）をカウントアップして返すフック。
 *
 * @param data 稼働状態APIの最新レスポンス（未取得時は null）
 * @returns サーバー稼働秒数（未取得時は null）
 */
export function useMonitoringUptime(data: MonitoringStatusResponse | null): number | null {
  const [snapshot, setSnapshot] = useState<{
    readonly baseUptimeSec: number;
    readonly receivedAtMs: number;
  } | null>(() => {
    if (!data) return null;
    const baseUptimeSec = Math.max(
      0,
      Math.floor((Date.parse(data.generatedAt) - Date.parse(data.serverStartedAt)) / 1000),
    );
    return { baseUptimeSec, receivedAtMs: Date.now() };
  });

  const [currentUptime, setCurrentUptime] = useState<number | null>(
    () => snapshot?.baseUptimeSec ?? null,
  );

  useEffect(() => {
    if (!data) {
      setSnapshot(null);
      setCurrentUptime(null);
      return;
    }
    const baseUptimeSec = Math.max(
      0,
      Math.floor((Date.parse(data.generatedAt) - Date.parse(data.serverStartedAt)) / 1000),
    );
    const receivedAtMs = Date.now();
    setSnapshot({ baseUptimeSec, receivedAtMs });
    setCurrentUptime(baseUptimeSec);
  }, [data]);

  useEffect(() => {
    if (!snapshot) {
      setCurrentUptime(null);
      return;
    }

    const timer = window.setInterval(() => {
      const elapsedSinceResponse = Math.floor((Date.now() - snapshot.receivedAtMs) / 1000);
      setCurrentUptime(snapshot.baseUptimeSec + Math.max(0, elapsedSinceResponse));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [snapshot]);

  return currentUptime;
}
