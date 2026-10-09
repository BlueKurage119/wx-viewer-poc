import { TileEnsureQueue } from './tileEnsureQueue.js';
import { parentPort, threadId, workerData } from 'node:worker_threads';
import { initializeRoleDatabase, type WriterLeaseOwner } from '../database/roleDatabase.js';
import type { DatabasePairConfig } from '../database/pairConfig.js';
import { createAcquisitionRuntime, type AcquisitionSettings } from './createAcquisitionRuntime.js';
import { WeatherTransport } from './weatherTransport.js';
import {
  sameWeatherEpoch,
  type DecisionCheckpoint,
  type WeatherEpoch,
  type TileInput,
} from './weatherContracts.js';
import { createNowcastApiService } from '../services/nowcastApiService.js';
import { createKikikuruApiService } from '../services/kikikuruApiService.js';
import { createVenueRegistry } from '@wx-viewer-poc/shared';
import { createStaticTileDeliveryProfileService } from '../services/tileDeliveryProfileService.js';

export interface AcquisitionWorkerData {
  readonly pair: DatabasePairConfig;
  readonly owner: WriterLeaseOwner;
  readonly settings: AcquisitionSettings;
  readonly epoch: WeatherEpoch;
  readonly checkpoint: DecisionCheckpoint;
  readonly nonce: string;
  readonly authorizeUntil: number;
}
if (!parentPort) throw new Error('取得Worker専用入口です');
const port = parentPort;
const data = workerData as AcquisitionWorkerData;
let epoch = data.epoch;
let database: ReturnType<typeof initializeRoleDatabase> | undefined;
let runtime: ReturnType<typeof createAcquisitionRuntime> | undefined;
let closing = false;
let failureCode: string | null = null;
let reportTimer: ReturnType<typeof setInterval> | undefined;
let reportPending = false;
const tiles = new TileEnsureQueue();
const operations = new Map<string, { status: 'in_progress' | 'completed'; error: string | null }>();
const transport = new WeatherTransport(
  port,
  epoch.workerGeneration,
  async (method, value) => {
    if (method === 'runtime.fail') {
      failureCode ??= (value as { code: string }).code;
      void runtime?.suspend();
      return null;
    }
    if (method === 'runtime.close') {
      if (!closing) {
        closing = true;
        setImmediate(() => {
          void close();
        });
      }
      return { accepted: true };
    }
    if (method === 'operation.query') {
      const input = value as { operationId: string; operation: string };
      return operations.get(`${input.operationId}:${input.operation}`) ?? null;
    }
    if (!runtime || closing || failureCode) throw new Error('not_ready');
    if (method === 'fetch.execute') {
      const input = value as {
        operationId: string;
        operation: 'start' | 'stop' | 'force_refresh' | 'recovery';
      };
      const operationKey = `${input.operationId}:${input.operation}`;
      if (operations.has(operationKey)) return operations.get(operationKey);
      if (
        [...operations.values()].filter((v) => v.status === 'in_progress').length >=
        (input.operation === 'stop' ? 17 : 16)
      )
        throw new Error('busy');
      operations.set(operationKey, { status: 'in_progress', error: null });
      void runtime
        .execute(input.operation)
        .then(
          () => {
            operations.set(operationKey, { status: 'completed', error: null });
          },
          (error) => {
            operations.set(operationKey, {
              status: 'completed',
              error: error instanceof Error ? error.message : 'failed',
            });
          },
        )
        .finally(() => {
          if (operations.size > 200)
            for (const [key, result] of operations) {
              if (result.status === 'completed') {
                operations.delete(key);
                break;
              }
            }
          void report();
        });
      return { status: 'in_progress', error: null };
    }
    if (method === 'publication.pause') {
      const input = value as { token: string; expiresAt: string };
      return runtime.decisions.pause(input.token, input.expiresAt);
    }
    if (method === 'publication.release')
      return runtime.decisions.release((value as { token: string }).token);
    if (method === 'tile.ensure') {
      const input = value as TileInput;
      return tiles.ensure(input, async () => {
        const registry = createVenueRegistry(data.settings.venues, data.settings.venueGeneration);
        const profile = createStaticTileDeliveryProfileService(
          data.settings.schedule.tileDeliveryProfile,
        );
        const result =
          input.layer === 'nowcast'
            ? await createNowcastApiService({
                venueRegistry: registry,
                getService: () => runtime!.imageServices.nowcast,
                enablePolling: data.settings.enablePolling,
                tileDeliveryProfileService: profile,
              }).getTile(input.frame, input.coordinate)
            : await createKikikuruApiService({
                venueRegistry: registry,
                getService: () => runtime!.imageServices.kikikuru,
                enablePolling: data.settings.enablePolling,
                tileDeliveryProfileService: profile,
              }).getTile(input.frame, input.coordinate);
        return result.kind === 'success'
          ? { kind: 'stored', tileResult: result.tileResult }
          : { kind: 'unavailable', httpStatus: result.httpStatus, error: result.error };
      });
    }
    throw new Error('invalid_request');
  },
  (code) => {
    failureCode ??= code;
    void runtime?.suspend();
    void report();
  },
);
async function report() {
  if (reportPending || closing) return;
  reportPending = true;
  try {
    await transport.call('status', { epoch, report: runtime?.status() ?? null, failureCode });
  } catch {
    /* 報告失敗はメインの鮮度判定でも観測する。 */
  } finally {
    reportPending = false;
  }
}
async function close() {
  clearInterval(reportTimer);
  tiles.close();
  try {
    await runtime?.close();
    database?.close();
  } finally {
    transport.close();
    port.close();
  }
}
async function prepare() {
  const permit = await transport.call<{
    nonce: string;
    epoch: WeatherEpoch;
    authorizeUntil: number;
  }>('runtime.accepting', { epoch, nonce: data.nonce, threadId });
  if (
    closing ||
    permit.nonce !== data.nonce ||
    !sameWeatherEpoch(permit.epoch, epoch) ||
    Date.now() >= permit.authorizeUntil ||
    Date.now() >= data.authorizeUntil
  )
    throw new Error('initial_accept_timeout');
  reportTimer = setInterval(() => {
    void report();
  }, 5000);
  await report();
  database = initializeRoleDatabase(data.pair, { ...data.owner, threadId });
  epoch = await transport.call<WeatherEpoch>('database.ready', {
    epoch,
    generation: database.generation,
    schemaVersion: database.schemaVersion,
  });
  runtime = createAcquisitionRuntime(
    database.connection,
    data.settings,
    epoch,
    data.checkpoint,
    transport,
  );
  await report();
  await runtime.prepare();
  await report();
  await transport.call('prepared', { epoch });
}
void prepare().catch(async () => {
  try {
    await transport.call('initialization.failed', {
      epoch,
      code: failureCode ?? 'initialization_failed',
    });
  } finally {
    closing = true;
    await close();
  }
});
