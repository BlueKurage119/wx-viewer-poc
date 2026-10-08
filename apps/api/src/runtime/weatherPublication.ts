import { randomUUID } from 'node:crypto';
import {
  sameWeatherEpoch,
  WEATHER_LIMITS,
  type PublicationToken,
  type WeatherEpoch,
} from './weatherContracts.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';

/** 更新単位と起動公開をFIFOで直列化する。上流取得・探索はrunUpdateの外で行う。 */
export class WeatherPublicationGate {
  private tail: Promise<void> = Promise.resolve();
  private revision = 0;
  private token: PublicationToken | null = null;
  private releaseCurrent: (() => void) | null = null;
  private startups = 0;
  constructor(
    private acquisition: WeatherEpoch,
    private delivery: WeatherEpoch,
    private readonly now: () => number = Date.now,
  ) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  runUpdate<T>(work: () => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const value = await work();
      this.revision += 1;
      return value;
    });
  }
  async publish<T>(
    work: (token: PublicationToken) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.startups >= WEATHER_LIMITS.startups) throw new WeatherRequestError('busy');
    this.startups += 1;
    const deadline = this.now() + WEATHER_LIMITS.readTimeoutMs;
    let abandoned = false;
    let waitingTimer: ReturnType<typeof setTimeout> | undefined;
    let waitingAbort: (() => void) | undefined;
    const waiting = new Promise<never>((_resolve, reject) => {
      const cancel = () => {
        abandoned = true;
        reject(new WeatherRequestError('deadline_exceeded'));
      };
      waitingTimer = setTimeout(cancel, WEATHER_LIMITS.readTimeoutMs);
      waitingAbort = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
    });
    try {
      const queued = this.enqueue(async () => {
        if (abandoned || signal?.aborted || this.now() >= deadline)
          throw new WeatherRequestError('deadline_exceeded');
        const expires = Math.min(deadline, this.now() + WEATHER_LIMITS.gateTimeoutMs);
        const token: PublicationToken = {
          id: randomUUID(),
          acquisitionEpoch: { ...this.acquisition },
          deliveryEpoch: { ...this.delivery },
          revision: this.revision,
          expiresAt: new Date(expires).toISOString(),
        };
        this.token = token;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: (() => void) | undefined;
        const canceled = new Promise<never>((_resolve, reject) => {
          this.releaseCurrent = () => reject(new WeatherRequestError('generation_changed'));
          timer = setTimeout(
            () => {
              this.token = null;
              reject(new WeatherRequestError('deadline_exceeded'));
            },
            Math.max(0, expires - this.now()),
          );
          abort = () => {
            this.token = null;
            reject(new WeatherRequestError('deadline_exceeded'));
          };
          signal?.addEventListener('abort', abort, { once: true });
        });
        try {
          const result = await Promise.race([work(token), canceled]);
          this.assertValid(token);
          return result;
        } finally {
          clearTimeout(timer);
          if (abort) signal?.removeEventListener('abort', abort);
          this.token = null;
          this.releaseCurrent = null;
        }
      });
      return await Promise.race([queued, waiting]);
    } finally {
      clearTimeout(waitingTimer);
      if (waitingAbort) signal?.removeEventListener('abort', waitingAbort);
      this.startups -= 1;
    }
  }
  assertValid(token: PublicationToken): void {
    if (
      this.token?.id !== token.id ||
      !sameWeatherEpoch(token.acquisitionEpoch, this.acquisition) ||
      !sameWeatherEpoch(token.deliveryEpoch, this.delivery)
    )
      throw new WeatherRequestError('generation_changed');
    if (this.now() >= Date.parse(token.expiresAt))
      throw new WeatherRequestError('deadline_exceeded');
  }
  replaceEpochs(acquisition: WeatherEpoch, delivery: WeatherEpoch): void {
    this.acquisition = { ...acquisition };
    this.delivery = { ...delivery };
    this.token = null;
    this.releaseCurrent?.();
  }
}
