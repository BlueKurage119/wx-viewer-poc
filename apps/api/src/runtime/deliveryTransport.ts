import type { MessagePort, Worker } from 'node:worker_threads';
import { WeatherRequestError } from './weatherRequestRegistry.js';
import { sameWeatherEpoch, type WeatherEpoch } from './weatherContracts.js';
import type { DeliveryHttpResult } from './deliveryContracts.js';

type Endpoint = Pick<MessagePort | Worker, 'postMessage' | 'on' | 'off'>;
const FRAME_BYTES = 256 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
type Packet =
  | { type: 'call'; id: string; epoch: WeatherEpoch; method: string; value: unknown }
  | { type: 'reply'; id: string; epoch: WeatherEpoch; value: unknown; error?: string }
  | {
      type: 'begin';
      id: string;
      epoch: WeatherEpoch;
      byteLength: number;
      statusCode: number;
      contentType: DeliveryHttpResult['contentType'];
      headers: Readonly<Record<string, string>>;
    }
  | { type: 'reserve'; id: string; accepted: boolean }
  | {
      type: 'frame';
      id: string;
      epoch: WeatherEpoch;
      index: number;
      final: boolean;
      bytes: Uint8Array;
    }
  | { type: 'ack'; id: string; index: number }
  | { type: 'cancel'; id: string };

interface Pending {
  readonly epoch: WeatherEpoch;
  readonly http: boolean;
  readonly startup: boolean;
  readonly lane: 'payload' | 'control' | 'lifecycle';
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  byteLength?: number;
  received?: number;
  nextIndex?: number;
  chunks?: Uint8Array[];
  result?: Omit<DeliveryHttpResult, 'bytes'>;
}

/** 提供応答を独立 ArrayBuffer に移して転送する。容量予約がなければ frame を送らない。 */
export class DeliveryTransport {
  private readonly pending = new Map<string, Pending>();
  private readonly waiters = new Map<
    string,
    { resolve: (accepted: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly frameAcks = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private activeFrames = 0;
  private readonly frameWaiters: {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  private reservedBytes = 0;
  private sendingBytes = 0;
  private readonly leases = new Set<() => void>();
  private readonly inFlight = new Set<string>();
  private closed = false;
  constructor(
    private readonly endpoint: Endpoint,
    private readonly handler: (
      method: string,
      value: unknown,
      id: string,
      epoch: WeatherEpoch,
    ) => unknown | Promise<unknown>,
    private readonly onProtocolFailure: (code: string) => void,
  ) {
    endpoint.on('message', this.onMessage);
  }
  get size() {
    return this.pending.size;
  }
  isCancelled(id: string) {
    return this.cancelled.has(id);
  }
  private readonly onMessage = (message: unknown) => {
    void this.receive(message).catch(() => this.onProtocolFailure('protocol_error'));
  };
  private async receive(message: unknown) {
    if (this.closed || !message || typeof message !== 'object') return;
    const packet = message as Packet;
    if (typeof packet.id !== 'string' || packet.id.length > 128) throw new Error('invalid_id');
    if (packet.type === 'cancel') {
      // 同期 SQLite 処理の中断はできない。結果送信時に取消済みか確認する。
      if (this.inFlight.has(packet.id)) this.cancelled.add(packet.id);
      return;
    }
    if (packet.type === 'reserve') {
      const waiter = this.waiters.get(packet.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.delete(packet.id);
        waiter.resolve(packet.accepted);
      }
      return;
    }
    if (packet.type === 'ack') {
      const key = `${packet.id}:${packet.index}`;
      const waiter = this.frameAcks.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.frameAcks.delete(key);
        waiter.resolve();
      }
      return;
    }
    if (packet.type === 'call') {
      this.inFlight.add(packet.id);
      try {
        const value = await this.handler(packet.method, packet.value, packet.id, packet.epoch);
        if (this.cancelled.has(packet.id)) return;
        if (value && typeof value === 'object' && '__deliveryHttp' in value) {
          await this.sendHttp(
            packet.id,
            packet.epoch,
            (value as { __deliveryHttp: DeliveryHttpResult }).__deliveryHttp,
          );
        } else {
          this.endpoint.postMessage({
            type: 'reply',
            id: packet.id,
            epoch: packet.epoch,
            value,
          } satisfies Packet);
        }
      } catch (error) {
        if (!this.cancelled.has(packet.id))
          this.endpoint.postMessage({
            type: 'reply',
            id: packet.id,
            epoch: packet.epoch,
            value: null,
            error: error instanceof Error ? error.message : 'read_failed',
          } satisfies Packet);
      } finally {
        this.inFlight.delete(packet.id);
        this.cancelled.delete(packet.id);
      }
      return;
    }
    const pending = this.pending.get(packet.id);
    if (!pending) return;
    if (packet.type === 'reply') {
      if (!sameWeatherEpoch(packet.epoch, pending.epoch)) return;
      this.finish(packet.id, packet.error ? new Error(packet.error) : null, packet.value);
      return;
    }
    if (packet.type === 'begin') {
      const headerNames = Object.keys(packet.headers ?? {});
      const envelopeValid =
        (packet.statusCode === 200 || packet.statusCode === 404) &&
        (packet.contentType === 'application/json; charset=utf-8' ||
          packet.contentType === 'image/png') &&
        headerNames.every((name) =>
          ['content-type', 'x-weather-stored-at', 'x-weather-catalog-availability'].includes(name),
        ) &&
        (!packet.headers['content-type'] || packet.headers['content-type'] === packet.contentType);
      const valid =
        envelopeValid &&
        pending.http &&
        sameWeatherEpoch(packet.epoch, pending.epoch) &&
        Number.isInteger(packet.byteLength) &&
        packet.byteLength >= 0 &&
        packet.byteLength <= MAX_BYTES &&
        this.reservedBytes + packet.byteLength <= MAX_BYTES &&
        !pending.chunks;
      this.endpoint.postMessage({
        type: 'reserve',
        id: packet.id,
        accepted: valid,
      } satisfies Packet);
      if (!valid) {
        this.finish(packet.id, new WeatherRequestError('busy'));
        return;
      }
      pending.byteLength = packet.byteLength;
      pending.received = 0;
      pending.nextIndex = 0;
      pending.chunks = [];
      pending.result = {
        statusCode: packet.statusCode,
        contentType: packet.contentType,
        headers: packet.headers,
      };
      this.reservedBytes += packet.byteLength;
      if (packet.byteLength === 0)
        this.finish(packet.id, null, { ...pending.result, bytes: new Uint8Array(0) });
      return;
    }
    if (packet.type === 'frame') {
      if (
        !pending.chunks ||
        !sameWeatherEpoch(packet.epoch, pending.epoch) ||
        !(packet.bytes instanceof Uint8Array) ||
        packet.bytes.byteLength > FRAME_BYTES ||
        packet.index !== pending.nextIndex ||
        (pending.received ?? 0) + packet.bytes.byteLength > (pending.byteLength ?? 0)
      ) {
        this.finish(packet.id, new Error('protocol_error'));
        this.onProtocolFailure('protocol_error');
        return;
      }
      pending.chunks.push(packet.bytes);
      pending.received = (pending.received ?? 0) + packet.bytes.byteLength;
      pending.nextIndex = packet.index + 1;
      this.endpoint.postMessage({
        type: 'ack',
        id: packet.id,
        index: packet.index,
      } satisfies Packet);
      if (packet.final) {
        if (pending.received !== pending.byteLength) {
          this.finish(packet.id, new Error('protocol_error'));
          return;
        }
        const bytes = new Uint8Array(pending.byteLength);
        let offset = 0;
        for (const chunk of pending.chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const heldBytes = pending.byteLength;
        pending.byteLength = 0;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.reservedBytes -= heldBytes;
          this.leases.delete(release);
        };
        this.leases.add(release);
        this.finish(packet.id, null, { ...pending.result!, bytes, release });
      }
    }
  }
  private readonly cancelled = new Set<string>();
  private acquireFrame(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('not_ready'));
    if (this.activeFrames < 2) {
      this.activeFrames++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => this.frameWaiters.push({ resolve, reject }));
  }
  private releaseFrame() {
    const next = this.frameWaiters.shift();
    if (next) next.resolve();
    else this.activeFrames--;
  }
  private finish(id: string, error: Error | null, value?: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    this.reservedBytes -= pending.byteLength ?? 0;
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
  call<T>(
    id: string,
    epoch: WeatherEpoch,
    method: string,
    value: unknown,
    timeoutMs = 5000,
    http = false,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new WeatherRequestError('not_ready'));
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > FRAME_BYTES)
      return Promise.reject(new WeatherRequestError('invalid_request'));
    const lane =
      method === 'read' || method === 'read.http'
        ? 'payload'
        : method === 'status.report'
          ? 'control'
          : 'lifecycle';
    const laneLimit = lane === 'payload' ? 64 : lane === 'control' ? 8 : 2;
    if ([...this.pending.values()].filter((pending) => pending.lane === lane).length >= laneLimit)
      return Promise.reject(new WeatherRequestError('busy'));
    const startup =
      (method === 'read' || method === 'read.http') &&
      typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'startup.project';
    if (startup && [...this.pending.values()].filter((pending) => pending.startup).length >= 8)
      return Promise.reject(new WeatherRequestError('busy'));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.endpoint.postMessage({ type: 'cancel', id } satisfies Packet);
        this.finish(id, new WeatherRequestError('deadline_exceeded'));
      }, timeoutMs);
      this.pending.set(id, {
        epoch,
        http,
        startup,
        lane,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.endpoint.postMessage({ type: 'call', id, epoch, method, value } satisfies Packet);
    });
  }
  cancel(id: string) {
    if (!this.pending.has(id)) return;
    this.endpoint.postMessage({ type: 'cancel', id } satisfies Packet);
    this.finish(id, new WeatherRequestError('deadline_exceeded'));
  }
  private async sendHttp(id: string, epoch: WeatherEpoch, result: DeliveryHttpResult) {
    if (result.bytes.byteLength > MAX_BYTES) throw new Error('payload_too_large');
    if (this.sendingBytes + result.bytes.byteLength > MAX_BYTES) throw new Error('busy');
    this.sendingBytes += result.bytes.byteLength;
    try {
      this.endpoint.postMessage({
        type: 'begin',
        id,
        epoch,
        byteLength: result.bytes.byteLength,
        statusCode: result.statusCode,
        contentType: result.contentType,
        headers: result.headers,
      } satisfies Packet);
      const accepted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(id);
          this.onProtocolFailure('handshake_timeout');
          resolve(false);
        }, 5000);
        this.waiters.set(id, { resolve, timer });
      });
      if (!accepted) throw new Error('busy');
      let batch: Promise<void>[] = [];
      for (
        let offset = 0, index = 0;
        offset < result.bytes.byteLength;
        offset += FRAME_BYTES, index++
      ) {
        if (this.closed || this.cancelled.has(id)) throw new Error('not_ready');
        await this.acquireFrame();
        const chunk = new Uint8Array(result.bytes.subarray(offset, offset + FRAME_BYTES));
        const ack = new Promise<void>((resolve, reject) => {
          const key = `${id}:${index}`;
          const timer = setTimeout(() => {
            this.frameAcks.delete(key);
            this.onProtocolFailure('handshake_timeout');
            reject(new Error('handshake_timeout'));
          }, 5000);
          this.frameAcks.set(key, { resolve, reject, timer });
        });
        this.endpoint.postMessage(
          {
            type: 'frame',
            id,
            epoch,
            index,
            final: offset + FRAME_BYTES >= result.bytes.byteLength,
            bytes: chunk,
          } satisfies Packet,
          [chunk.buffer],
        );
        batch.push(ack.finally(() => this.releaseFrame()));
        if (batch.length === 2) {
          await Promise.all(batch);
          batch = [];
        }
      }
      await Promise.all(batch);
    } finally {
      this.sendingBytes -= result.bytes.byteLength;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.endpoint.off('message', this.onMessage);
    for (const id of this.pending.keys()) this.finish(id, new WeatherRequestError('not_ready'));
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
    this.waiters.clear();
    for (const waiter of this.frameAcks.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('not_ready'));
    }
    this.frameAcks.clear();
    for (const waiter of this.frameWaiters.splice(0)) waiter.reject(new Error('not_ready'));
    for (const release of [...this.leases]) release();
  }
}
