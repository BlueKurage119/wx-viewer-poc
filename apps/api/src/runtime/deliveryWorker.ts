import { parentPort, threadId, workerData } from 'node:worker_threads';
import { openWeatherReader } from '../database/roleDatabase.js';
import type { DatabasePairConfig } from '../database/pairConfig.js';
import { createDeliveryRuntime } from './createDeliveryRuntime.js';
import { DeliveryTransport } from './deliveryTransport.js';
import { DeliveryReadLimiter } from './deliveryReadLimiter.js';
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
const readLimiter = new DeliveryReadLimiter();
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
      readLimiter.suspend();
      if (readLimiter.status.active > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            readLimiter.waitForIdle(),
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
      readLimiter.resume();
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
    if (method === 'status')
      return { epoch, ready: runtime !== null, pendingRequests: readLimiter.status.active };
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
      if (method === 'read' && input.kind === 'tile.read') throw new Error('invalid_request');
      const tile = input.kind === 'tile.read';
      const releaseRead = await readLimiter.acquire(
        input.requestId,
        tile,
        Date.parse(input.deadlineAt),
      );
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
          if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 8 * 1024 * 1024)
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
        releaseRead();
      }
    }
    throw new Error('invalid_request');
  },
  (code) => {
    workerFailure ??= code;
    void report();
  },
  (id) => readLimiter.cancel(id),
);

async function report() {
  try {
    await transport.call(
      `status:${Date.now()}`,
      epoch,
      'status.report',
      {
        epoch,
        ready: runtime !== null,
        pendingRequests: readLimiter.status.active,
        failureCode: workerFailure,
      },
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
