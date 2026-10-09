import { parentPort, threadId, workerData } from 'node:worker_threads';
import { openWeatherReader } from '../database/roleDatabase.js';
import type { DatabasePairConfig } from '../database/pairConfig.js';
import { createDeliveryRuntime } from './createDeliveryRuntime.js';
import { DeliveryTransport } from './deliveryTransport.js';
import type {
  DeliveryConnectionSpec,
  DeliveryReadInput,
  DeliverySettings,
} from './deliveryContracts.js';
import { sameWeatherEpoch, type WeatherEpoch, type WeatherOperations } from './weatherContracts.js';

export interface DeliveryWorkerData {
  readonly pair: DatabasePairConfig;
  readonly settings: DeliverySettings;
  readonly epoch: WeatherEpoch;
  readonly nonce: string;
  readonly authorizeUntil: number;
}

if (!parentPort) throw new Error('提供Worker専用入口です');
const port = parentPort;
const data = workerData as DeliveryWorkerData;
let epoch = data.epoch;
let connection: ReturnType<typeof openWeatherReader> | null = null;
let runtime: ReturnType<typeof createDeliveryRuntime> | null = null;
let closing = false;
let accepted = false;
let workerFailure: string | null = null;
let reportTimer: ReturnType<typeof setInterval> | undefined;
let active = 0;
let activeTiles = 0;
let suspending = false;
const idleWaiters: (() => void)[] = [];
const readQueue: {
  readonly tile: boolean;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}[] = [];
function releaseRead(tile: boolean) {
  active--;
  if (tile) activeTiles--;
  for (let index = 0; index < readQueue.length && active < 16;) {
    const queued = readQueue[index]!;
    if (queued.tile && activeTiles >= 4) {
      index++;
      continue;
    }
    readQueue.splice(index, 1);
    active++;
    if (queued.tile) activeTiles++;
    queued.resolve();
  }
  if (active === 0) while (idleWaiters.length) idleWaiters.shift()?.();
}
function acquireRead(tile: boolean): Promise<void> {
  if (suspending) return Promise.reject(new Error('not_ready'));
  if (active < 16 && (!tile || activeTiles < 4)) {
    active++;
    if (tile) activeTiles++;
    return Promise.resolve();
  }
  if (readQueue.length >= 48) return Promise.reject(new Error('busy'));
  return new Promise<void>((resolve, reject) => readQueue.push({ tile, resolve, reject }));
}
const transport = new DeliveryTransport(
  port,
  async (method, value, _id, requestEpoch) => {
    if (method === 'runtime.authorize') {
      const input = value as { nonce: string; authorizeUntil: number };
      if (
        accepted ||
        input.nonce !== data.nonce ||
        Date.now() >= data.authorizeUntil ||
        Date.now() >= input.authorizeUntil
      )
        throw new Error('initial_accept_timeout');
      accepted = true;
      reportTimer = setInterval(() => {
        void report();
      }, 5000);
      reportTimer.unref();
      return { threadId };
    }
    if (!accepted || closing) throw new Error('not_ready');
    if (method === 'reader.suspend') {
      suspending = true;
      for (const queued of readQueue.splice(0)) queued.reject(new Error('not_ready'));
      if (active > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            new Promise<void>((resolve) => idleWaiters.push(resolve)),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('reader_close_unconfirmed')), 10000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      await runtime?.close();
      runtime = null;
      connection?.close();
      connection = null;
      epoch = { ...epoch, weatherDatabaseGenerationId: null, readerEpoch: null };
      suspending = false;
      return { closed: true };
    }
    if (method === 'reader.connect') {
      const spec = value as DeliveryConnectionSpec;
      if (connection || runtime) throw new Error('reader_already_open');
      if (
        spec.acquisitionEpoch.serverGenerationId !== epoch.serverGenerationId ||
        !spec.readerEpoch
      )
        throw new Error('generation_changed');
      const opened = openWeatherReader(data.pair.weather, spec.generation, spec.schemaVersion);
      const nextEpoch = {
        ...epoch,
        weatherDatabaseGenerationId: spec.generation,
        readerEpoch: spec.readerEpoch,
      };
      try {
        const nextRuntime = createDeliveryRuntime(opened, data.settings, nextEpoch);
        connection = opened;
        runtime = nextRuntime;
        epoch = nextEpoch;
        await report();
        return { epoch };
      } catch (error) {
        opened.close();
        throw error;
      }
    }
    if (method === 'runtime.close') {
      closing = true;
      setImmediate(() => {
        void close();
      });
      return { accepted: true };
    }
    if (method === 'status') return { epoch, ready: runtime !== null, pendingRequests: active };
    if (method === 'read' || method === 'read.http') {
      if (workerFailure) throw new Error('not_ready');
      const input = value as DeliveryReadInput;
      if (
        !runtime ||
        !sameWeatherEpoch(input.epoch, epoch) ||
        !sameWeatherEpoch(requestEpoch, epoch)
      )
        throw new Error('generation_changed');
      if (Date.now() >= Date.parse(input.deadlineAt)) throw new Error('deadline_exceeded');
      const tile = input.kind === 'tile.read';
      await acquireRead(tile);
      try {
        if (transport.isCancelled(input.requestId)) throw new Error('deadline_exceeded');
        const output = await runtime.read(
          input.kind as keyof WeatherOperations,
          input.payload,
          input.context,
        );
        if (!sameWeatherEpoch(input.epoch, epoch) || Date.now() >= Date.parse(input.deadlineAt))
          throw new Error('generation_changed');
        if (method === 'read') {
          if (
            input.kind === 'tile.read' &&
            output &&
            typeof output === 'object' &&
            'kind' in output &&
            output.kind === 'hit'
          ) {
            if (output.bytes.byteLength > 8 * 1024 * 1024) throw new Error('payload_too_large');
          } else if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 8 * 1024 * 1024)
            throw new Error('payload_too_large');
          return output;
        }
        if (input.kind === 'history.reception' && output === null) {
          return {
            __deliveryHttp: {
              statusCode: 404,
              contentType: 'application/json; charset=utf-8',
              bytes: new TextEncoder().encode(
                JSON.stringify({ status: 'error', code: 'reception_not_found' }),
              ),
              headers: { 'content-type': 'application/json; charset=utf-8' },
            },
          };
        }
        if (
          input.kind === 'tile.read' &&
          output &&
          typeof output === 'object' &&
          'kind' in output &&
          output.kind === 'hit'
        ) {
          return {
            __deliveryHttp: {
              statusCode: 200,
              contentType: 'image/png',
              bytes: output.bytes,
              headers: {
                'content-type': 'image/png',
                'x-weather-stored-at': output.storedAt,
                'x-weather-catalog-availability': output.catalogAvailability,
              },
            },
          };
        }
        const text = JSON.stringify(output);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('payload_too_large');
        return {
          __deliveryHttp: {
            statusCode: 200,
            contentType: 'application/json; charset=utf-8',
            bytes,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          },
        };
      } finally {
        releaseRead(tile);
      }
    }
    throw new Error('invalid_request');
  },
  (code) => {
    workerFailure ??= code;
    void report();
  },
);

async function report() {
  try {
    await transport.call(
      `status:${Date.now()}`,
      epoch,
      'status.report',
      { epoch, ready: runtime !== null, pendingRequests: active, failureCode: workerFailure },
      5000,
    );
  } catch {
    /* メイン側の鮮度判定へ委ねる。 */
  }
}
async function close() {
  clearInterval(reportTimer);
  try {
    await runtime?.close();
    runtime = null;
    connection?.close();
    connection = null;
  } finally {
    transport.close();
    port.close();
  }
}
