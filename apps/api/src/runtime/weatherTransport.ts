import { randomUUID } from 'node:crypto';
import type { MessagePort, Worker } from 'node:worker_threads';
import { WEATHER_LIMITS, assertWeatherData } from './weatherContracts.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';

type Lane = 'payload' | 'control' | 'stop' | 'lifecycle';
const requestLimits: Record<Lane, number> = { payload: 64, control: 8, stop: 2, lifecycle: 2 };

type Endpoint = Pick<MessagePort | Worker, 'postMessage' | 'on' | 'off'>;
type Packet = {
  kind: 'call' | 'reply';
  id: string;
  method: string;
  value: unknown;
  error: string | null;
};
/** 両方向のACK付き通信。巨大候補も1フレームずつ送り、未確認の更新を進めない。 */
export class WeatherTransport {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      lane: Lane;
    }
  >();
  private readonly frames = new Map<
    string,
    { chunks: Uint8Array[]; bytes: number; index: number }
  >();
  private readonly acknowledgements = new Map<string, () => void>();
  private closed = false;
  private readonly sendingBytes: Record<Lane, number> = {
    payload: 0,
    control: 0,
    stop: 0,
    lifecycle: 0,
  };
  private readonly frameLanes = {
    payload: { active: 0, waiters: [] as (() => void)[] },
    control: { active: 0, waiters: [] as (() => void)[] },
    stop: { active: 0, waiters: [] as (() => void)[] },
    lifecycle: { active: 0, waiters: [] as (() => void)[] },
  };
  private laneFor(method: string, value: unknown): Lane {
    if (method === 'runtime.close' || method === 'runtime.fail') return 'lifecycle';
    if (
      (method === 'fetch.execute' || method === 'operation.query') &&
      (value as { operation?: string } | null)?.operation === 'stop'
    )
      return 'stop';
    return [
      'runtime.accepting',
      'database.ready',
      'prepared',
      'status',
      'initialization.failed',
      'update.begin',
      'update.complete',
      'publication.pause',
      'publication.release',
      'operation.query',
    ].includes(method)
      ? 'control'
      : 'payload';
  }
  private async acquireFrameSlot(name: Lane) {
    const lane = this.frameLanes[name];
    if (lane.active >= WEATHER_LIMITS.unackedFrames)
      await new Promise<void>((resolve) => lane.waiters.push(resolve));
    else lane.active++;
  }
  private releaseFrameSlot(name: Lane) {
    const lane = this.frameLanes[name];
    const next = lane.waiters.shift();
    if (next) next();
    else lane.active--;
  }
  constructor(
    private readonly endpoint: Endpoint,
    private readonly generation: string,
    private readonly handle: (method: string, value: unknown) => unknown | Promise<unknown>,
    private readonly failure: (
      code: 'protocol_error' | 'payload_too_large' | 'handshake_timeout',
    ) => void,
  ) {
    endpoint.on('message', this.onMessage);
  }
  private readonly onMessage = (message: unknown) => {
    void this.receive(message).catch(() => this.failure('protocol_error'));
  };
  private async receive(message: unknown) {
    if (this.closed || !message || typeof message !== 'object') return;
    const m = message as {
      protocolVersion: number;
      generation: string;
      type: string;
      id: string;
      index: number;
      final: boolean;
      bytes: Uint8Array;
    };
    if (m.generation !== this.generation) return;
    if (m.protocolVersion !== 1) throw new Error('protocol_version');
    if (m.type === 'ack') {
      this.acknowledgements.get(`${m.id}:${m.index}`)?.();
      return;
    }
    if (
      !['frame', 'control'].includes(m.type) ||
      !(m.bytes instanceof Uint8Array) ||
      m.bytes.length > WEATHER_LIMITS.frameBytes
    )
      throw new Error('frame');
    const control = m.type === 'control';
    if (control && (!m.final || m.index !== 0)) throw new Error('control_frame');
    const assembly = this.frames.get(m.id) ?? { chunks: [], bytes: 0, index: 0 };
    if (
      m.index !== assembly.index ||
      (!control &&
        [...this.frames.values()].reduce((total, item) => total + item.bytes, 0) + m.bytes.length >
          WEATHER_LIMITS.bulkBytes) ||
      (!control && !this.frames.has(m.id) && this.frames.size >= 64)
    ) {
      this.failure('payload_too_large');
      return;
    }
    assembly.chunks.push(m.bytes);
    assembly.bytes += m.bytes.length;
    assembly.index++;
    this.frames.set(m.id, assembly);
    this.endpoint.postMessage({
      protocolVersion: 1,
      type: 'ack',
      generation: this.generation,
      id: m.id,
      index: m.index,
    });
    if (!m.final) return;
    this.frames.delete(m.id);
    const packet = JSON.parse(Buffer.concat(assembly.chunks).toString('utf8')) as Packet;
    assertWeatherData(packet);
    if (
      packet.id !== m.id ||
      !['call', 'reply'].includes(packet.kind) ||
      typeof packet.method !== 'string'
    )
      throw new Error('packet');
    if (packet.kind === 'reply') {
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(packet.id);
      if (packet.error) pending.reject(new Error(packet.error));
      else pending.resolve(packet.value);
      return;
    }
    // 応答内容にはoperationが残らないため、元要求のレーンで返信する。
    const lane = this.laneFor(packet.method, packet.value);
    try {
      const value = await this.handle(packet.method, packet.value);
      await this.send({ ...packet, kind: 'reply', value: value ?? null, error: null }, lane);
    } catch (error) {
      await this.send(
        {
          ...packet,
          kind: 'reply',
          value: null,
          error: error instanceof Error ? error.message : 'protocol_error',
        },
        lane,
      );
    }
  }
  private async send(packet: Packet, lane: Lane): Promise<void> {
    assertWeatherData(packet);
    const bytes = Buffer.from(JSON.stringify(packet));
    const control = lane !== 'payload';
    if (
      control
        ? bytes.length > WEATHER_LIMITS.frameBytes ||
          bytes.length + this.sendingBytes[lane] > requestLimits[lane] * WEATHER_LIMITS.frameBytes
        : bytes.length + this.sendingBytes[lane] > WEATHER_LIMITS.bulkBytes
    ) {
      this.failure('payload_too_large');
      throw new Error('payload_too_large');
    }
    this.sendingBytes[lane] += bytes.length;
    try {
      for (
        let offset = 0, index = 0;
        offset < bytes.length;
        offset += WEATHER_LIMITS.frameBytes, index++
      ) {
        if (this.closed) throw new WeatherRequestError('not_ready');
        await this.acquireFrameSlot(lane);
        try {
          if (this.closed) throw new WeatherRequestError('not_ready');
          await new Promise<void>((resolve, reject) => {
            const key = `${packet.id}:${index}`;
            const timer = setTimeout(() => {
              this.acknowledgements.delete(key);
              reject(new Error('handshake_timeout'));
              this.failure('handshake_timeout');
            }, 5000);
            this.acknowledgements.set(key, () => {
              clearTimeout(timer);
              this.acknowledgements.delete(key);
              resolve();
            });
            this.endpoint.postMessage({
              protocolVersion: 1,
              type: control ? 'control' : 'frame',
              generation: this.generation,
              id: packet.id,
              index,
              final: offset + WEATHER_LIMITS.frameBytes >= bytes.length,
              bytes: new Uint8Array(bytes.subarray(offset, offset + WEATHER_LIMITS.frameBytes)),
            });
          });
        } finally {
          this.releaseFrameSlot(lane);
        }
      }
    } finally {
      this.sendingBytes[lane] -= bytes.length;
    }
  }
  call<T>(method: string, value: unknown, timeoutMs = 5000): Promise<T> {
    if (this.closed) return Promise.reject(new WeatherRequestError('not_ready'));
    const lane = this.laneFor(method, value);
    if (
      [...this.pending.values()].filter((entry) => entry.lane === lane).length >=
      requestLimits[lane]
    )
      return Promise.reject(new WeatherRequestError('busy'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('handshake_timeout'));
        if (method !== 'status' && method !== 'fetch.execute' && method !== 'operation.query')
          this.failure('handshake_timeout');
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer, lane });
      void this.send({ kind: 'call', id, method, value, error: null }, lane).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  get size() {
    return this.pending.size;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.endpoint.off('message', this.onMessage);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new WeatherRequestError('operation_result_unknown'));
    }
    this.pending.clear();
    this.frames.clear();
    for (const ack of this.acknowledgements.values()) ack();
    this.acknowledgements.clear();
    for (const lane of Object.values(this.frameLanes))
      for (const wake of lane.waiters.splice(0)) wake();
  }
}
