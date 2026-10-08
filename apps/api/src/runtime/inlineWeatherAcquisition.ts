import type { WeatherHandlers } from './inlineWeatherRead.js';
import {
  assertWeatherData,
  sameWeatherEpoch,
  type WeatherEpoch,
  type WeatherOperations,
  type WeatherPort,
  type WeatherReply,
  type WeatherRequest,
} from './weatherContracts.js';

/** 長い取得処理の完了を読取RPCの5秒期限で失敗にしない。操作合流はメインが所有する。 */
export function createInlineWeatherAcquisition(
  epoch: WeatherEpoch,
  handlers: WeatherHandlers,
): WeatherPort {
  return {
    async request<K extends keyof WeatherOperations>(
      request: WeatherRequest<K>,
    ): Promise<WeatherReply<K>> {
      const reply = (result: WeatherReply<K>['result']): WeatherReply<K> => ({
        protocolVersion: 1,
        requestId: request.requestId,
        epoch,
        result,
      });
      try {
        assertWeatherData(request);
        if (!sameWeatherEpoch(epoch, request.epoch))
          return reply({ status: 'failed', code: 'generation_changed' });
        const handler = handlers[request.kind] as
          | ((
              payload: WeatherOperations[K]['request'],
            ) => WeatherOperations[K]['response'] | Promise<WeatherOperations[K]['response']>)
          | undefined;
        if (!handler) return reply({ status: 'failed', code: 'invalid_request' });
        const value = await handler(structuredClone(request.payload));
        assertWeatherData(value);
        return reply({ status: 'completed', value: structuredClone(value) });
      } catch {
        return reply({ status: 'failed', code: 'read_failed' });
      }
    },
  };
}
