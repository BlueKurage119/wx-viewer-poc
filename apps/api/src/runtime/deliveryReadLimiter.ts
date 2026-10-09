/** 提供読取の実行・待機枠を管理する。実行中の同期処理は取消後も完了まで枠を保持する。 */
export class DeliveryReadLimiter {
  private active = 0;
  private tiles = 0;
  private suspended = false;
  private readonly queue: {
    id: string;
    tile: boolean;
    deadline: number;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  private readonly idleWaiters: (() => void)[] = [];

  get status() {
    return { active: this.active, tiles: this.tiles, queued: this.queue.length };
  }

  acquire(id: string, tile: boolean, deadline: number): Promise<() => void> {
    if (this.suspended) return Promise.reject(new Error('not_ready'));
    if (!Number.isFinite(deadline) || Date.now() >= deadline)
      return Promise.reject(new Error('deadline_exceeded'));
    if (this.queue.length === 0 && this.active < 16 && (!tile || this.tiles < 4)) {
      this.active++;
      if (tile) this.tiles++;
      return Promise.resolve(this.releaseOnce(tile));
    }
    if (this.queue.length >= 48) return Promise.reject(new Error('busy'));
    return new Promise((resolve, reject) => {
      const entry = {
        id,
        tile,
        deadline,
        resolve,
        reject,
        timer: setTimeout(
          () => this.cancel(id, 'deadline_exceeded'),
          Math.max(0, deadline - Date.now()),
        ),
      };
      this.queue.push(entry);
    });
  }

  cancel(id: string, reason = 'deadline_exceeded') {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const [entry] = this.queue.splice(index, 1);
    clearTimeout(entry!.timer);
    entry!.reject(new Error(reason));
    this.drain();
  }

  suspend() {
    this.suspended = true;
    for (const entry of this.queue.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(new Error('not_ready'));
    }
  }

  resume() {
    this.suspended = false;
  }

  waitForIdle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private releaseOnce(tile: boolean): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (tile) this.tiles--;
      this.drain();
      if (this.active === 0) while (this.idleWaiters.length) this.idleWaiters.shift()?.();
    };
  }

  private drain() {
    while (this.queue.length && this.active < 16) {
      const entry = this.queue[0]!;
      if (entry.tile && this.tiles >= 4) break;
      this.queue.shift();
      clearTimeout(entry.timer);
      if (Date.now() >= entry.deadline) {
        entry.reject(new Error('deadline_exceeded'));
        continue;
      }
      this.active++;
      if (entry.tile) this.tiles++;
      entry.resolve(this.releaseOnce(entry.tile));
    }
  }
}
