/**
 * Issue #43 §6.1: graceful shutdown フックのシグナル購読を切り出したもの。
 * テスト容易性のため、`process` そのものではなく `once` だけを要求する最小のインターフェースを受け取る。
 */
export interface SignalSource {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * SIGTERM / SIGINT を一度だけ購読し、どちらが先に来ても handler を1回だけ呼ぶ。
 */
export function registerGracefulShutdown(
  emitter: SignalSource,
  handler: () => void | Promise<void>,
): void {
  let called = false;
  const wrapped = (): void => {
    if (called) {
      return;
    }
    called = true;
    void handler();
  };
  emitter.once('SIGTERM', wrapped);
  emitter.once('SIGINT', wrapped);
}
