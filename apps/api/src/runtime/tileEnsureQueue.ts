import type { TileInput, WeatherOperations } from './weatherContracts.js';
import { WeatherRequestError } from './weatherRequestRegistry.js';
type Result = WeatherOperations['tile.ensure']['response'];
type Waiting = { start: () => void; cancel: () => void };
/** 保存済み読取のレーンを使わず、同一画像取得を合流する。 */
export class TileEnsureQueue {
  private readonly inFlight = new Map<string, Promise<Result>>();
  private readonly waiting: Waiting[] = [];
  private running = 0;
  private logical = 0;
  private closed = false;
  async ensure(input: TileInput, work: () => Promise<Result>): Promise<Result> {
    if (this.closed) throw new WeatherRequestError('not_ready');
    if (this.logical >= 16) throw new WeatherRequestError('busy');
    this.logical++;
    const key = JSON.stringify(input);
    try {
      let task = this.inFlight.get(key);
      if (!task) {
        task = this.run(work);
        this.inFlight.set(key, task);
        void task.finally(() => this.inFlight.delete(key)).catch(() => {});
      }
      return await task;
    } finally {
      this.logical--;
    }
  }
  private async run(work: () => Promise<Result>): Promise<Result> {
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
            if (Date.now() >= expiresAt) {
              reject(new WeatherRequestError('deadline_exceeded'));
              this.release();
            } else resolve();
          },
          cancel: () => {
            remove();
            reject(new WeatherRequestError('not_ready'));
          },
        };
        const timer = setTimeout(() => {
          remove();
          reject(new WeatherRequestError('deadline_exceeded'));
        }, 30000);
        this.waiting.push(entry);
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
