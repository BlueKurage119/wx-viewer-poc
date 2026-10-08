interface CloseOptions {
  readonly reason?: 'signal' | 'programmatic';
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
    stopping ??= Promise.resolve().then(() => stop(options));
    pending = stopping
      .then(() => {
        closeDatabase();
        complete = true;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
