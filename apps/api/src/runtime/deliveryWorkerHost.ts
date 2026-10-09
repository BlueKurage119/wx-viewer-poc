import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { projectWeatherRuntimeStatus, type WeatherRuntimeStatus } from '@wx-viewer-poc/shared';
import type { DatabasePairConfig } from '../database/pairConfig.js';
import { DeliveryTransport } from './deliveryTransport.js';
import type {
  DeliveryConnectionSpec,
  DeliveryHttpResult,
  DeliveryReadContext,
  DeliveryReadInput,
  DeliverySettings,
} from './deliveryContracts.js';
import type { DeliveryWorkerData } from './deliveryWorker.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
import type { WeatherEpoch, WeatherOperations } from './weatherContracts.js';

export interface DeliveryWorkerHostOptions {
  readonly pair: DatabasePairConfig;
  readonly settings: DeliverySettings;
  readonly serverGenerationId: string;
  readonly onFailure: (code: string, generation: string) => void;
  readonly onReport?: () => void;
  readonly workerEntry?: URL;
  readonly onWorkerCreated?: (worker: Worker) => void;
}

/** 提供 Worker の世代と reader 接続を保持する。異常終了後は手動再開のみ。 */
export class DeliveryWorkerHost {
  private worker: Worker | null = null;
  private transport: DeliveryTransport | null = null;
  private exitPromise: Promise<void> = Promise.resolve();
  private exitConfirmed = true;
  private lifecycle: WeatherRuntimeStatus['lifecycle'] = 'starting';
  private failureCode: WeatherRuntimeStatus['failureCode'] = null;
  private reportedAt: string | null = null;
  private receivedAt: string | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private readonly failures = new Set<string>();
  private readonly staleTimer: ReturnType<typeof setInterval>;
  epoch: WeatherEpoch;
  constructor(private readonly options: DeliveryWorkerHostOptions) {
    this.epoch = {
      serverGenerationId: options.serverGenerationId,
      workerGeneration: randomUUID(),
      weatherDatabaseGenerationId: null,
      readerEpoch: null,
    };
    this.staleTimer = setInterval(() => {
      if (
        !this.exitConfirmed &&
        this.receivedAt &&
        Date.now() - Date.parse(this.receivedAt) > 15000
      )
        this.notice('report_stale');
    }, 1000);
    this.staleTimer.unref();
  }
  private notice(code: string) {
    if (this.closing) return;
    const key = `${this.epoch.workerGeneration}:${code}`;
    if (!this.failures.has(key)) {
      this.failures.add(key);
      this.options.onFailure(code, this.epoch.workerGeneration);
      this.options.onReport?.();
    }
  }
  private fail(code: string) {
    if (this.closing) return;
    this.failureCode ??= code as WeatherRuntimeStatus['failureCode'];
    this.lifecycle = 'failed';
    this.notice(code);
    this.options.onReport?.();
  }
  status(): WeatherRuntimeStatus {
    return projectWeatherRuntimeStatus(
      {
        role: 'delivery',
        mode: 'worker',
        workerGeneration: this.epoch.workerGeneration,
        lifecycle: this.lifecycle,
        reportedAt: this.reportedAt,
        receivedAt: this.receivedAt,
        stopReason: this.closing ? 'requested' : null,
        exitConfirmed: this.exitConfirmed,
        failureCode: this.failureCode,
        pendingRequests: this.transport?.size ?? 0,
      },
      new Date().toISOString(),
    );
  }
  async start(): Promise<void> {
    if (!this.exitConfirmed || this.closing) throw new Error('not_ready');
    this.lifecycle = 'starting';
    this.failureCode = null;
    this.receivedAt = null;
    this.reportedAt = null;
    this.exitConfirmed = false;
    const nonce = randomUUID();
    const authorizeUntil = Date.now() + 5000;
    const data: DeliveryWorkerData = {
      pair: this.options.pair,
      settings: this.options.settings,
      epoch: this.epoch,
      nonce,
      authorizeUntil,
    };
    const entry = this.options.workerEntry ?? new URL('./deliveryWorker.js', import.meta.url);
    const source =
      entry.pathname.endsWith('.ts') ||
      (import.meta.url.endsWith('.ts') && !this.options.workerEntry);
    const sourceEntry = this.options.workerEntry ?? new URL('./deliveryWorker.ts', import.meta.url);
    let worker: Worker;
    try {
      worker = source
        ? new Worker(
            new URL(
              `data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register(); await import(${JSON.stringify(sourceEntry.href)});`)}`,
            ),
            { workerData: data, execArgv: [] },
          )
        : new Worker(entry, { workerData: data, execArgv: [] });
    } catch (error) {
      this.exitConfirmed = true;
      this.fail('initialization_failed');
      throw error;
    }
    this.worker = worker;
    this.options.onWorkerCreated?.(worker);
    this.exitPromise = new Promise((resolve) => {
      worker.once('exit', () => {
        this.exitConfirmed = true;
        this.transport?.close();
        if (!this.closing && this.lifecycle !== 'stopping' && !this.failureCode)
          this.fail('unexpected_exit');
        resolve();
      });
    });
    worker.on('error', () => this.fail('protocol_error'));
    this.transport = new DeliveryTransport(
      worker,
      async (method, value) => {
        if (method !== 'status.report') throw new Error('invalid_request');
        const input = value as { epoch: WeatherEpoch; ready: boolean; failureCode?: string | null };
        if (input.epoch.workerGeneration !== this.epoch.workerGeneration)
          throw new Error('generation_changed');
        this.reportedAt = new Date().toISOString();
        this.receivedAt = new Date().toISOString();
        if (input.failureCode) this.fail(input.failureCode);
        if (!this.failureCode) this.lifecycle = input.ready ? 'ready' : 'starting';
        this.options.onReport?.();
        return { accepted: true };
      },
      (code) => this.fail(code),
    );
    try {
      await this.transport.call<{ threadId: number }>(
        randomUUID(),
        this.epoch,
        'runtime.authorize',
        { nonce, authorizeUntil },
        Math.max(1, authorizeUntil - Date.now()),
      );
      this.receivedAt = new Date().toISOString();
      this.reportedAt = this.receivedAt;
      this.options.onReport?.();
    } catch (error) {
      if (!this.failureCode) this.fail('initialization_failed');
      throw error;
    }
  }
  async connectReader(spec: DeliveryConnectionSpec): Promise<void> {
    if (!this.transport || this.exitConfirmed || this.failureCode)
      throw new WeatherRequestError('not_ready');
    try {
      const reply = await this.transport.call<{ epoch: WeatherEpoch }>(
        randomUUID(),
        this.epoch,
        'reader.connect',
        spec,
        5000,
      );
      if (
        reply.epoch.weatherDatabaseGenerationId !== spec.generation ||
        reply.epoch.readerEpoch !== spec.readerEpoch ||
        reply.epoch.workerGeneration !== this.epoch.workerGeneration
      )
        throw new Error('generation_changed');
      this.epoch = reply.epoch;
      this.lifecycle = 'ready';
      this.options.onReport?.();
    } catch (error) {
      this.fail('initialization_failed');
      throw error;
    }
  }
  async suspendReader(): Promise<void> {
    if (!this.transport || this.exitConfirmed) return;
    this.lifecycle = 'starting';
    await this.transport.call(randomUUID(), this.epoch, 'reader.suspend', null, 10000);
    this.epoch = { ...this.epoch, weatherDatabaseGenerationId: null, readerEpoch: null };
    this.lifecycle = 'starting';
    this.options.onReport?.();
  }
  async read<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    context: DeliveryReadContext,
    signal?: AbortSignal,
    timeoutMs = 5000,
  ): Promise<WeatherOperations[K]['response']> {
    if (kind === 'tile.read') {
      const response = (await this.request(
        kind,
        payload,
        context,
        true,
        signal,
        timeoutMs,
      )) as DeliveryHttpResult;
      if (response.contentType !== 'image/png') {
        response.release?.();
        return { kind: 'miss' } as WeatherOperations[K]['response'];
      }
      const storedAt = response.headers['x-weather-stored-at'];
      const catalogAvailability = response.headers['x-weather-catalog-availability'];
      if (!storedAt || !['available', 'stale', 'unavailable'].includes(catalogAvailability ?? '')) {
        response.release?.();
        throw new Error('protocol_error');
      }
      return {
        kind: 'hit',
        bytes: response.bytes,
        contentType: 'image/png',
        storedAt,
        catalogAvailability,
        release: response.release,
      } as WeatherOperations[K]['response'];
    }
    return this.request(kind, payload, context, false, signal, timeoutMs) as Promise<
      WeatherOperations[K]['response']
    >;
  }
  async readHttp<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    context: DeliveryReadContext,
    signal?: AbortSignal,
    timeoutMs = 5000,
  ): Promise<DeliveryHttpResult> {
    return this.request(
      kind,
      payload,
      context,
      true,
      signal,
      timeoutMs,
    ) as Promise<DeliveryHttpResult>;
  }
  private async request<K extends keyof WeatherOperations>(
    kind: K,
    payload: WeatherOperations[K]['request'],
    context: DeliveryReadContext,
    http: boolean,
    signal?: AbortSignal,
    timeoutMs = 5000,
  ): Promise<unknown> {
    if (
      !this.transport ||
      this.exitConfirmed ||
      this.lifecycle !== 'ready' ||
      this.failureCode ||
      !this.epoch.readerEpoch
    )
      throw new WeatherRequestError('not_ready');
    if (signal?.aborted) throw new WeatherRequestError('deadline_exceeded');
    timeoutMs = Math.min(5000, timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new WeatherRequestError('deadline_exceeded');
    const id = randomUUID();
    const input: DeliveryReadInput<K> = {
      requestId: id,
      epoch: this.epoch,
      deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
      kind,
      payload,
      context,
    };
    const promise = this.transport.call(
      id,
      this.epoch,
      http ? 'read.http' : 'read',
      input,
      timeoutMs,
      http,
    );
    const onAbort = () => this.transport?.cancel(id);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await promise;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
  async restart(): Promise<void> {
    await this.stopWorker();
    this.epoch = {
      serverGenerationId: this.options.serverGenerationId,
      workerGeneration: randomUUID(),
      weatherDatabaseGenerationId: null,
      readerEpoch: null,
    };
    await this.start();
  }
  private async stopWorker() {
    const worker = this.worker;
    if (!worker || this.exitConfirmed) return;
    this.lifecycle = 'stopping';
    try {
      await this.transport?.call(randomUUID(), this.epoch, 'runtime.close', null, 5000);
    } catch {
      /* exitで確認する。 */
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.exitPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('exit_timeout')), 10000);
        }),
      ]);
    } catch {
      await worker.terminate();
      await Promise.race([
        this.exitPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('exit_unconfirmed')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!this.exitConfirmed) throw new Error('exit_unconfirmed');
    this.transport?.close();
    this.transport = null;
    this.worker = null;
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    clearInterval(this.staleTimer);
    this.closePromise = this.stopWorker();
    return this.closePromise;
  }
}
