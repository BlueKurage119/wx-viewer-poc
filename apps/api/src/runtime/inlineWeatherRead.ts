import { WeatherRequestRegistry, WeatherRequestError } from './weatherRequestRegistry.js';
import {
  assertWeatherData,
  type WeatherEpoch,
  type WeatherOperations,
  type WeatherPort,
  type WeatherRequest,
} from './weatherContracts.js';

export type WeatherHandlers = {
  readonly [K in keyof WeatherOperations]?: (
    payload: WeatherOperations[K]['request'],
  ) => WeatherOperations[K]['response'] | Promise<WeatherOperations[K]['response']>;
};

/** 関数の注入は同一スレッドfactory限定。portを通る値はデータだけにする。 */
export function createInlineWeatherRead(
  epoch: WeatherEpoch,
  handlers: WeatherHandlers,
  now: () => number = Date.now,
): WeatherPort & { readonly registry: WeatherRequestRegistry } {
  const registry = new WeatherRequestRegistry(epoch, now);
  return {
    registry,
    request<K extends keyof WeatherOperations>(request: WeatherRequest<K>) {
      return registry.request(request, async () => {
        const handler = handlers[request.kind] as
          | ((
              payload: WeatherOperations[K]['request'],
            ) => WeatherOperations[K]['response'] | Promise<WeatherOperations[K]['response']>)
          | undefined;
        if (!handler) throw new WeatherRequestError('invalid_request');
        const value = await handler(structuredClone(request.payload));
        assertWeatherData(value);
        return structuredClone(value);
      });
    },
  };
}
