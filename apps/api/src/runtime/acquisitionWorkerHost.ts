import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { projectWeatherRuntimeStatus, type WeatherRuntimeStatus } from '@wx-viewer-poc/shared';
import type { DatabasePairConfig } from '../database/pairConfig.js';
import { releaseOwnedRoleLease, type WriterLeaseOwner } from '../database/roleDatabase.js';
import { WeatherTransport } from './weatherTransport.js';
import type { AcquisitionWorkerData } from './acquisitionWorker.js';
import type { AcquisitionReport, AcquisitionSettings } from './createAcquisitionRuntime.js';
import { WeatherDecisionState } from './weatherDecisionState.js';
import { RetainedNotificationSink } from './retainedNotificationSink.js';
import type { DatabaseConnection } from '../database/connection.js';
import { sameWeatherEpoch, type WeatherEpoch, type DecisionBatch } from './weatherContracts.js';
import type { WeatherUpdateUnit } from './weatherDecisionState.js';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';

export type WeatherPreparationOutcome =
  { status: 'ready'; workerGeneration: string } | { status: 'failed'; code: string };
export class AcquisitionWorkerHost {
  private worker: Worker | null = null;
  private transport: WeatherTransport | null = null;
  private owner: WriterLeaseOwner | null = null;
  private exited = true;
  private exitPromise: Promise<void> = Promise.resolve();
  private lifecycle: WeatherRuntimeStatus['lifecycle'] = 'starting';
  private stopReason: WeatherRuntimeStatus['stopReason'] = null;
  private failureCode: WeatherRuntimeStatus['failureCode'] = null;
  private receivedAt: string | null = null;
  private shuttingDown = false;
  private intentional = false;
  private authorized = false;
  private readonly faults = new Set<string>();
  private readonly notificationIds = new Set<string>();
  private preparedResolve: (outcome: WeatherPreparationOutcome) => void = () => {};
  private acceptedResolve: () => void = () => {};
  private acceptedReject: (error: Error) => void = () => {};
  private acceptanceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly staleTimer: ReturnType<typeof setInterval>;
  readonly decisions: WeatherDecisionState;
  private readonly sink: RetainedNotificationSink;
  epoch: WeatherEpoch;
  report: AcquisitionReport | null = null;
  preparationCompleted = false;
  desiredRunning: boolean;
  private intentRevision = 0;
  weatherPrepared: Promise<WeatherPreparationOutcome>;
  constructor(
    private readonly options: {
      pair: DatabasePairConfig;
      settings: AcquisitionSettings;
      serverGenerationId: string;
      retainedConnection: DatabaseConnection;
      databaseReady: (
        generation: string,
        schemaVersion: number,
        epoch: WeatherEpoch,
      ) => Promise<void>;
      closeReader: () => Promise<void>;
      onReport: () => void;
      onFailure: (code: string, generation: string) => void;
      workerEntry?: URL;
      onWorkerCreated?: (worker: Worker) => void;
    },
  ) {
    this.epoch = {
      serverGenerationId: options.serverGenerationId,
      workerGeneration: randomUUID(),
      weatherDatabaseGenerationId: null,
      readerEpoch: null,
    };
    this.decisions = new WeatherDecisionState(this.epoch);
    this.sink = new RetainedNotificationSink(options.retainedConnection, this.decisions);
    this.desiredRunning = options.settings.desiredRunning;
    this.weatherPrepared = new Promise((resolve) => {
      this.preparedResolve = resolve;
    });
    this.staleTimer = setInterval(() => {
      if (!this.exited && this.status().reportFreshness === 'stale' && !this.intentional)
        this.notify('report_stale');
    }, 1000);
    this.staleTimer.unref();
  }
  private notify(code: string) {
    const key = `${this.epoch.workerGeneration}:${code}`;
    if (this.faults.has(key)) return;
    this.faults.add(key);
    this.options.onFailure(code, this.epoch.workerGeneration);
  }
  private fail(code: WeatherRuntimeStatus['failureCode']) {
    if (this.shuttingDown || this.intentional) return;
    this.lifecycle = 'failed';
    this.failureCode ??= code;
    void this.transport?.call('runtime.fail', { code }).catch(() => {});
    this.notify(code ?? 'protocol_error');
    this.preparedResolve({ status: 'failed', code: code ?? 'protocol_error' });
  }
  status(): WeatherRuntimeStatus {
    const status = projectWeatherRuntimeStatus(
      {
        role: 'acquisition',
        mode: 'worker',
        workerGeneration: this.epoch.workerGeneration,
        lifecycle: this.lifecycle,
        reportedAt: this.report?.reportedAt ?? null,
        receivedAt: this.receivedAt,
        stopReason: this.stopReason,
        exitConfirmed: this.exited,
        failureCode: this.failureCode,
        unknownScopes: [
          ...new Set([
            ...(this.decisions.pendingUnit?.scopes ?? []),
            ...this.decisions
              .getUnknownUnits()
              .flatMap((unit) =>
                unit.scopes.filter(
                  (scope) =>
                    unit.epoch.workerGeneration === this.epoch.workerGeneration ||
                    !this.report?.locallyValidatedScopes?.includes(scope),
                ),
              ),
          ]),
        ],
        pendingRequests: this.transport?.size ?? 0,
        prepared: this.preparationCompleted && this.stopReason !== 'initialization_failed',
      },
      new Date().toISOString(),
    );
    return this.shuttingDown ? { ...status, restartAllowed: false } : status;
  }
  async start(): Promise<void> {
    if (!this.exited || this.shuttingDown) throw new Error('not_ready');
    this.faults.clear();
    this.intentional = false;
    this.authorized = false;
    this.exited = false;
    this.lifecycle = 'starting';
    this.stopReason = null;
    this.failureCode = null;
    this.report = null;
    this.preparationCompleted = false;
    this.receivedAt = null;
    const nonce = randomUUID();
    const authorizeUntil = Date.now() + 5000;
    this.owner = {
      pid: process.pid,
      role: 'weather',
      token: randomUUID(),
      startedAt: new Date().toISOString(),
      serverGenerationId: this.epoch.serverGenerationId,
      workerGeneration: this.epoch.workerGeneration,
      threadId: null,
    };
    const data: AcquisitionWorkerData = {
      pair: this.options.pair,
      owner: this.owner,
      settings: { ...this.options.settings, desiredRunning: this.desiredRunning },
      epoch: this.epoch,
      checkpoint: this.decisions.snapshot(),
      nonce,
      authorizeUntil,
    };
    const entry = this.options.workerEntry ?? new URL('./acquisitionWorker.js', import.meta.url);
    const source =
      entry.pathname.endsWith('.ts') ||
      (import.meta.url.endsWith('.ts') && !this.options.workerEntry);
    const sourceEntry =
      this.options.workerEntry ?? new URL('./acquisitionWorker.ts', import.meta.url);
    const worker = source
      ? new Worker(
          new URL(
            `data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register(); await import(${JSON.stringify(sourceEntry.href)});`)}`,
          ),
          { workerData: data, execArgv: [] },
        )
      : new Worker(entry, { workerData: data, execArgv: [] });
    this.options.onWorkerCreated?.(worker);
    this.worker = worker;
    this.owner = { ...this.owner, threadId: worker.threadId };
    const accepted = new Promise<void>((resolve, reject) => {
      this.acceptedResolve = resolve;
      this.acceptedReject = reject;
    });
    this.acceptanceTimer = setTimeout(() => {
      this.fail('initial_accept_timeout');
      this.acceptedReject(new Error('initial_accept_timeout'));
    }, 5000);
    this.transport = new WeatherTransport(
      worker,
      this.epoch.workerGeneration,
      async (method, value) => {
        if (method === 'runtime.accepting') {
          const input = value as { nonce: string; epoch: WeatherEpoch };
          if (
            input.nonce !== nonce ||
            !sameWeatherEpoch(input.epoch, this.epoch) ||
            Date.now() >= authorizeUntil ||
            this.lifecycle === 'failed' ||
            this.intentional
          )
            throw new Error('initial_accept_timeout');
          clearTimeout(this.acceptanceTimer);
          this.authorized = true;
          this.lifecycle = 'ready';
          this.acceptedResolve();
          return { nonce, epoch: this.epoch, authorizeUntil };
        }
        if (!this.authorized || this.intentional) throw new Error('not_ready');
        if (method === 'database.ready') {
          const input = value as { epoch: WeatherEpoch; generation: string; schemaVersion: number };
          if (
            !sameWeatherEpoch(input.epoch, this.epoch) ||
            this.epoch.weatherDatabaseGenerationId !== null
          )
            throw new Error('protocol_error');
          const next = { ...this.epoch, weatherDatabaseGenerationId: input.generation };
          await this.options.databaseReady(input.generation, input.schemaVersion, next);
          this.epoch = next;
          this.decisions.replaceEpoch(this.epoch);
          return this.epoch;
        }
        if (method === 'notification.record') {
          const record = value as NotificationOutputHistoryInput;
          const id = record.notificationId;
          if (!this.notificationIds.has(id)) {
            this.notificationIds.add(id);
            this.sink.record([record]);
          }
          return null;
        }
        const input = value as { epoch: WeatherEpoch };
        if (!sameWeatherEpoch(input.epoch, this.epoch)) throw new Error('generation_changed');
        if (method === 'status') {
          const status = value as {
            report: AcquisitionReport | null;
            failureCode: WeatherRuntimeStatus['failureCode'];
          };
          this.receivedAt = new Date().toISOString();
          this.report = status.report;
          if (status.failureCode) this.fail(status.failureCode);
          this.options.onReport();
          return null;
        }
        if (method === 'initialization.failed') {
          this.preparationCompleted = true;
          this.options.onReport();
          this.lifecycle = 'failed';
          this.stopReason = 'initialization_failed';
          this.notify('initialization_failed');
          this.preparedResolve({ status: 'failed', code: 'initialization_failed' });
          return null;
        }
        if (this.failureCode) throw new Error(this.failureCode);
        if (method === 'prepared') {
          this.preparationCompleted = true;
          this.options.onReport();
          this.preparedResolve({ status: 'ready', workerGeneration: this.epoch.workerGeneration });
          return null;
        }
        if (method === 'update.begin') {
          this.decisions.begin(value as WeatherUpdateUnit);
          return null;
        }
        if (method === 'decision.batch') return this.sink.receive(value as DecisionBatch);
        if (method === 'update.complete') {
          this.decisions.complete((value as { unitId: string }).unitId);
          return null;
        }
        throw new Error('invalid_request');
      },
      (code) => this.fail(code),
    );
    worker.on('error', () => {
      this.acceptedReject(new Error('worker_start_failed'));
    });
    this.exitPromise = new Promise((resolve) =>
      worker.once('exit', () => {
        clearTimeout(this.acceptanceTimer);
        this.exited = true;
        this.transport?.close();
        if (!this.intentional && this.stopReason !== 'initialization_failed' && !this.failureCode) {
          this.lifecycle = 'failed';
          this.stopReason = 'unexpected_exit';
          this.notify('unexpected_exit');
        }
        this.acceptedReject(new Error('worker_exited'));
        this.preparedResolve({ status: 'failed', code: this.stopReason ?? 'worker_exited' });
        resolve();
      }),
    );
    return accepted;
  }
  async call<T>(method: string, value: unknown, timeout = 5000, signal?: AbortSignal): Promise<T> {
    if (!this.transport || this.exited || this.shuttingDown || this.lifecycle !== 'ready')
      throw new Error('not_ready');
    return this.transport.call<T>(method, value, timeout, signal);
  }
  async execute(
    operation: 'start' | 'stop' | 'force_refresh' | 'recovery',
    operationId: string,
  ): Promise<void> {
    if (!this.transport || this.exited || this.shuttingDown || this.lifecycle !== 'ready')
      throw new Error('not_ready');
    const previousIntent = this.desiredRunning;
    const intentRevision = ++this.intentRevision;
    let awaitingAcceptance = true;
    if (operation === 'start' || operation === 'stop') this.desiredRunning = operation === 'start';
    try {
      try {
        await this.call('fetch.execute', { operation, operationId });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'handshake_timeout') throw error;
        // 受付応答を失っても同じ操作IDを照会し、実行を再送しない。
      }
      awaitingAcceptance = false;
      for (;;) {
        const result = await this.call<{ status: string; error: string | null } | null>(
          'operation.query',
          { operationId, operation },
        ).catch(() => {
          // 照会拒否は未実行の証拠ではないため、受付済み意図を維持する。
          throw new Error('operation_result_unknown');
        });
        if (!result) throw new Error('operation_result_unknown');
        if (result.status === 'completed') {
          if (result.error) throw new Error(result.error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'failed';
      if (
        awaitingAcceptance &&
        ['not_ready', 'busy', 'invalid_request'].includes(code) &&
        this.intentRevision === intentRevision
      )
        this.desiredRunning = previousIntent;
      if (this.exited || ['handshake_timeout', 'operation_result_unknown'].includes(code))
        throw new Error('operation_result_unknown');
      throw error;
    }
  }
  private async stopWorker() {
    this.intentional = true;
    if (!this.exited) {
      void this.transport?.call('runtime.close', { reason: 'requested' }).catch(() => {});
      const wait = async (ms: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            this.exitPromise.then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), ms);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      if (!(await wait(10_000))) {
        void this.worker?.terminate();
        if (!(await wait(10_000))) throw new Error('exit_unconfirmed');
      }
    }
    await this.options.closeReader();
    if (this.owner) releaseOwnedRoleLease(this.options.pair.weather, this.owner);
  }
  async restart(): Promise<void> {
    if (!this.status().restartAllowed) throw new Error('restart_not_allowed');
    this.lifecycle = 'restarting';
    try {
      await this.stopWorker();
      this.epoch = {
        ...this.epoch,
        workerGeneration: randomUUID(),
        weatherDatabaseGenerationId: null,
      };
      this.decisions.replaceEpoch(this.epoch);
      await this.start();
    } catch (error) {
      this.lifecycle = 'failed';
      throw error;
    }
  }
  async close() {
    this.preparedResolve({ status: 'failed', code: 'shutdown' });
    this.shuttingDown = true;
    this.lifecycle = 'stopping';
    clearInterval(this.staleTimer);
    await this.stopWorker();
    this.lifecycle = 'stopped';
    this.stopReason = 'requested';
  }
}
