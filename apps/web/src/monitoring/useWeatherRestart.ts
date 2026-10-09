import { useEffect, useRef, useState } from 'react';
import { createWeatherWorkerClient } from '../api/weatherWorkers';
import { createRequestId } from './createRequestId';
import type { WeatherRole } from '@wx-viewer-poc/shared';
import {
  createWeatherRestartController,
  type WeatherRestartState,
} from './weatherRestartController';

export interface WeatherRestartModel {
  readonly state: WeatherRestartState;
  readonly refreshVersion: number;
  restart(generation: string): void;
  recheck(): void;
}
/** 監視画面を離れても要求IDと結果照会を保持する。 */
export function useWeatherRestart(role: WeatherRole = 'acquisition'): WeatherRestartModel {
  const [state, setState] = useState<WeatherRestartState>({ phase: 'idle' });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const controller = useRef<ReturnType<typeof createWeatherRestartController> | null>(null);
  useEffect(() => {
    const current = createWeatherRestartController({
      role,
      client: createWeatherWorkerClient({ fetch: window.fetch.bind(window) }),
      requestIdFactory: createRequestId,
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (id) => window.clearTimeout(id),
      onRefresh: () => setRefreshVersion((value) => value + 1),
    });
    controller.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    return () => {
      unsubscribe();
      current.dispose();
      controller.current = null;
    };
  }, [role]);
  return {
    state,
    refreshVersion,
    restart: (generation) => controller.current?.restart(generation),
    recheck: () => controller.current?.recheck(),
  };
}
