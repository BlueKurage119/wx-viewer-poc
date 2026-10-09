import type { TileInput, WeatherOperations } from './weatherContracts.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
type Result = WeatherOperations['tile.ensure']['response'];
type Waiting = { start: () => void; cancel: () => void };
type Task = { promise: Promise<Result>; users: number; cancelQueued: (() => void) | null };
/** 保存済み読取のレーンを使わず、同一画像取得を合流する。 */
export class TileEnsureQueue {
  private readonly inFlight = new Map<string, Task>();
  private readonly waiting: Waiting[] = [];
  private running = 0;
  private logical = 0;
  private closed = false;
  async ensure(
    input: TileInput,
    work: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    if (this.closed) throw new WeatherRequestError('not_ready');
    if (signal?.aborted) throw new WeatherRequestError('deadline_exceeded');
    if (this.logical >= 16) throw new WeatherRequestError('busy');
    this.logical++;
    const key = JSON.stringify(input);
    try {
      let task = this.inFlight.get(key);
      if (!task) {
        task = { promise: Promise.resolve(null as never), users: 0, cancelQueued: null };
        task.promise = this.run(work, task);
        this.inFlight.set(key, task);
        void task.promise
          .finally(() => {
            if (this.inFlight.get(key) === task) this.inFlight.delete(key);
          })
          .catch(() => {});
      }
      task.users++;
      try {
        if (!signal) return await task.promise;
        return await new Promise<Result>((resolve, reject) => {
          const onAbort = () => reject(new WeatherRequestError('deadline_exceeded'));
          signal.addEventListener('abort', onAbort, { once: true });
          void task.promise
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort));
          if (signal.aborted) onAbort();
        });
      } finally {
        task.users--;
        if (task.users === 0 && task.cancelQueued) {
          task.cancelQueued();
          this.inFlight.delete(key);
        }
      }
    } finally {
      this.logical--;
    }
  }
  private async run(work: () => Promise<Result>, task: Task): Promise<Result> {
    if (this.running >= 4) {
      await new Promise<void>((resolve, reject) => {
        const expiresAt = Date.now() + 30000;
        const remove = () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          clearTimeout(timer);
        };
        const entry: Waiting = {
          start: () => {
            remove();
            task.cancelQueued = null;
            if (Date.now() >= expiresAt) {
              reject(new WeatherRequestError('deadline_exceeded'));
              this.release();
            } else resolve();
          },
          cancel: () => {
            remove();
            task.cancelQueued = null;
            reject(new WeatherRequestError('not_ready'));
          },
        };
        const timer = setTimeout(() => {
          remove();
          reject(new WeatherRequestError('deadline_exceeded'));
        }, 30000);
        this.waiting.push(entry);
        task.cancelQueued = entry.cancel;
      });
    } else this.running++;
    try {
      if (this.closed) throw new WeatherRequestError('not_ready');
      return await work();
    } finally {
      this.release();
    }
  }
  private release() {
    const next = this.waiting.shift();
    if (next) next.start();
    else this.running--;
  }
  close() {
    this.closed = true;
    for (const entry of [...this.waiting]) entry.cancel();
  }
}
