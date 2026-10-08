import { randomUUID } from 'node:crypto';
import {
  ForceRefreshAbortedError,
  ForceRefreshFailedError,
  type FetchControlTargets,
} from '../services/fetchControlService.js';
import { createInlineWeatherAcquisition } from './inlineWeatherAcquisition.js';
import type { WeatherEpoch, WeatherOperations } from './weatherContracts.js';

/** 操作履歴・合流レーンはメインに残し、実行だけデータ要求へ変換する。 */
export function createAcquisitionControlTargets(
  targets: FetchControlTargets | null,
  epoch: WeatherEpoch,
): FetchControlTargets | null {
  if (!targets) return null;
  const methods = {
    start: 'start',
    stop: 'stop',
    force_refresh: 'forceRefresh',
    recovery: 'runRecovery',
  } as const;
  const port = createInlineWeatherAcquisition(epoch, {
    'fetch.execute': async (request) => {
      try {
        await targets[methods[request.operation]](request.operationId);
        return { completed: true, running: targets.isRunning(), failure: null, sources: [] };
      } catch (error) {
        if (error instanceof ForceRefreshAbortedError)
          return {
            completed: false,
            running: targets.isRunning(),
            failure: 'aborted',
            sources: error.abortedSources,
          };
        if (error instanceof ForceRefreshFailedError)
          return {
            completed: false,
            running: targets.isRunning(),
            failure: 'failed',
            sources: error.failedSources,
          };
        return { completed: false, running: targets.isRunning(), failure: 'failed', sources: [] };
      }
    },
  });
  async function execute(
    operation: WeatherOperations['fetch.execute']['request']['operation'],
    operationId: string = randomUUID(),
  ) {
    const reply = await port.request({
      protocolVersion: 1,
      requestId: randomUUID(),
      epoch,
      kind: 'fetch.execute',
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      payload: { operationId, operation },
    });
    if (reply.result.status !== 'completed') throw new Error('取得操作の応答がありません');
    if (reply.result.value.failure === 'aborted')
      throw new ForceRefreshAbortedError(reply.result.value.sources);
    if (!reply.result.value.completed)
      throw new ForceRefreshFailedError(reply.result.value.sources);
  }
  return {
    start: (id) => execute('start', id),
    stop: (id) => execute('stop', id),
    forceRefresh: (id) => execute('force_refresh', id),
    runRecovery: (id) => execute('recovery', id),
    isRunning: () => targets.isRunning(),
    isUpstreamAllowedNow: () => targets.isUpstreamAllowedNow(),
  };
}
