import {
  assertWeatherData,
  sameWeatherEpoch,
  WEATHER_LIMITS,
  type WeatherEpoch,
  type WeatherFailureCode,
  type WeatherOperations,
  type WeatherReply,
  type WeatherRequest,
} from './weatherContracts.js';

export class WeatherRequestError extends Error {
  constructor(readonly code: WeatherFailureCode) {
    super(code);
  }
}
interface Pending {
  readonly fingerprint: string;
  readonly startup: boolean;
  readonly cancel: (code: WeatherFailureCode) => void;
  readonly promise: Promise<WeatherReply>;
}
/** 保持DB transactionを開かず、待機時間込みで受付数と応答の寿命を管理する。 */
export class WeatherRequestRegistry {
  private readonly pending = new Map<string, Pending>();
  constructor(
    private epoch: WeatherEpoch,
    private readonly now: () => number = Date.now,
  ) {}
  get size(): number {
    return this.pending.size;
  }
  replaceEpoch(epoch: WeatherEpoch): void {
    this.epoch = { ...epoch };
    for (const entry of this.pending.values()) entry.cancel('generation_changed');
  }
  close(): void {
    for (const entry of this.pending.values()) entry.cancel('not_ready');
  }
  request<K extends keyof WeatherOperations>(
    request: WeatherRequest<K>,
    execute: () => Promise<WeatherOperations[K]['response']>,
  ): Promise<WeatherReply<K>> {
    const fail = (code: WeatherFailureCode): WeatherReply<K> => ({
      protocolVersion: 1,
      requestId: request.requestId,
      epoch: request.epoch,
      result: { status: 'failed', code },
    });
    try {
      assertWeatherData(request);
    } catch {
      return Promise.resolve(fail('invalid_request'));
    }
    if (
      request.protocolVersion !== 1 ||
      !request.requestId ||
      !Number.isFinite(Date.parse(request.deadlineAt))
    )
      return Promise.resolve(fail('invalid_request'));
    if (!sameWeatherEpoch(request.epoch, this.epoch))
      return Promise.resolve(fail('generation_changed'));
    const fingerprint = JSON.stringify(request);
    const previous = this.pending.get(request.requestId);
    if (previous)
      return previous.fingerprint === fingerprint
        ? (previous.promise as Promise<WeatherReply<K>>)
        : Promise.resolve(fail('invalid_request'));
    const startup = request.kind === 'startup.project';
    if (
      this.pending.size >= WEATHER_LIMITS.requests ||
      (startup &&
        [...this.pending.values()].filter((p) => p.startup).length >= WEATHER_LIMITS.startups)
    )
      return Promise.resolve(fail('busy'));
    const deadline = Math.min(
      Date.parse(request.deadlineAt),
      this.now() + WEATHER_LIMITS.readTimeoutMs,
    );
    if (this.now() >= deadline) return Promise.resolve(fail('deadline_exceeded'));
    let finish!: (reply: WeatherReply<K>) => void;
    let settled = false;
    const promise = new Promise<WeatherReply<K>>((resolve) => {
      finish = resolve;
    });
    const settle = (reply: WeatherReply<K>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish(reply);
    };
    const timer = setTimeout(
      () => settle(fail('deadline_exceeded')),
      Math.max(0, deadline - this.now()),
    );
    this.pending.set(request.requestId, {
      fingerprint,
      startup,
      promise,
      cancel: (code) => settle(fail(code)),
    });
    void Promise.resolve().then(async () => {
      if (settled) {
        this.pending.delete(request.requestId);
        return;
      }
      try {
        const value = await execute();
        this.pending.delete(request.requestId);
        if (!sameWeatherEpoch(request.epoch, this.epoch)) return settle(fail('generation_changed'));
        if (this.now() >= deadline) return settle(fail('deadline_exceeded'));
        assertWeatherData(value);
        settle({
          protocolVersion: 1,
          requestId: request.requestId,
          epoch: request.epoch,
          result: { status: 'completed', value },
        });
      } catch (error) {
        this.pending.delete(request.requestId);
        settle(fail(error instanceof WeatherRequestError ? error.code : 'read_failed'));
      }
    });
    return promise;
  }
}
