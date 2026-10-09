import { homedir } from 'node:os';

interface CloseOptions {
  readonly reason?: 'signal' | 'programmatic';
}

/** ログへ出すエラーメッセージから絶対パス(cwd・ホーム)を除く。 */
function sanitizeMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const [path, replacement] of [
    [process.cwd(), '.'],
    [homedir(), '~'],
  ] as const) {
    if (path.length > 1) text = text.split(path).join(replacement);
  }
  return JSON.stringify(text);
}

export function logShutdownStart(reason?: string): void {
  console.warn(`[api-shutdown] start${reason ? ` reason=${reason}` : ''}`);
}

export function logShutdownStageFailed(stage: 'stop' | 'close_database', error: unknown): void {
  console.error(`[api-shutdown] stage_failed stage=${stage} error=${sanitizeMessage(error)}`);
}

export function logShutdownComplete(startedAt: number): void {
  console.warn(`[api-shutdown] complete elapsedMs=${Date.now() - startedAt}`);
}

/** 停止処理は一度だけ完了させ、DB終了の失敗分は次のcloseで再試行する。 */
export function createRetryableDatabaseClose(
  stop: (options?: CloseOptions) => Promise<void>,
  closeDatabase: () => void,
): (options?: CloseOptions) => Promise<void> {
  let stopping: Promise<void> | undefined;
  let pending: Promise<void> | undefined;
  let complete = false;
  return (options) => {
    if (pending) return pending;
    if (complete) return Promise.resolve();
    const startedAt = Date.now();
    logShutdownStart(options?.reason);
    stopping ??= Promise.resolve()
      .then(() => stop(options))
      .catch((error: unknown) => {
        logShutdownStageFailed('stop', error);
        throw error;
      });
    pending = stopping
      .then(() => {
        try {
          closeDatabase();
        } catch (error) {
          logShutdownStageFailed('close_database', error);
          throw error;
        }
        complete = true;
        logShutdownComplete(startedAt);
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
