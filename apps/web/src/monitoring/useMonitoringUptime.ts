import { useEffect, useRef, useState } from 'react';
import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';

interface UptimeSnapshot {
  readonly serverGenerationId: string;
  readonly baseUptimeSec: number;
  readonly receivedAtPerfMs: number;
}

/**
 * サーバーから受け取った serverStartedAt / generatedAt を基準に、
 * 1秒周期でサーバー稼働秒数（Uptime）をカウントアップして返すフック。
 * - 単調増加クロック（performance.now()）を使用して端末の壁時計変更によるズレを防止。
 * - 同一 serverGenerationId において、応答受信遅延による運転時間の巻き戻りを防止。
 *
 * @param data 稼働状態APIの最新レスポンス（未取得時は null）
 * @returns サーバー稼働秒数（未取得時は null）
 */
export function useMonitoringUptime(data: MonitoringStatusResponse | null): number | null {
  const currentUptimeRef = useRef<number | null>(null);
  const snapshotRef = useRef<UptimeSnapshot | null>(null);

  const [currentUptime, setCurrentUptime] = useState<number | null>(() => {
    if (!data) return null;
    const baseUptimeSec = Math.max(
      0,
      Math.floor((Date.parse(data.generatedAt) - Date.parse(data.serverStartedAt)) / 1000),
    );
    currentUptimeRef.current = baseUptimeSec;
    snapshotRef.current = {
      serverGenerationId: data.serverGenerationId,
      baseUptimeSec,
      receivedAtPerfMs: performance.now(),
    };
    return baseUptimeSec;
  });

  useEffect(() => {
    if (!data) {
      snapshotRef.current = null;
      currentUptimeRef.current = null;
      setCurrentUptime(null);
      return;
    }

    const calculatedUptimeSec = Math.max(
      0,
      Math.floor((Date.parse(data.generatedAt) - Date.parse(data.serverStartedAt)) / 1000),
    );

    // 同一 generationId の場合は直前の推定値を下回らないように保護（巻き戻り防止）
    const prevSnapshot = snapshotRef.current;
    const isSameGeneration = prevSnapshot?.serverGenerationId === data.serverGenerationId;
    const prevUptime = currentUptimeRef.current;
    const baseUptimeSec =
      isSameGeneration && prevUptime !== null
        ? Math.max(prevUptime, calculatedUptimeSec)
        : calculatedUptimeSec;

    const receivedAtPerfMs = performance.now();
    snapshotRef.current = {
      serverGenerationId: data.serverGenerationId,
      baseUptimeSec,
      receivedAtPerfMs,
    };
    currentUptimeRef.current = baseUptimeSec;
    setCurrentUptime(baseUptimeSec);
  }, [data]);

  const hasData = data !== null;
  useEffect(() => {
    if (!hasData) return;

    const timer = window.setInterval(() => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;

      const elapsedSinceResponse = Math.max(
        0,
        Math.floor((performance.now() - snapshot.receivedAtPerfMs) / 1000),
      );
      const nextUptime = snapshot.baseUptimeSec + elapsedSinceResponse;
      const prev = currentUptimeRef.current;
      const guaranteedUptime = prev !== null ? Math.max(prev, nextUptime) : nextUptime;

      currentUptimeRef.current = guaranteedUptime;
      setCurrentUptime(guaranteedUptime);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [hasData]);

  return currentUptime;
}
