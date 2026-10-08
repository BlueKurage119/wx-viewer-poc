/**
 * Issue #43 §6.1: graceful shutdown フックのシグナル購読を切り出したもの。
 * 実processは持続購読し、onceだけを備えた既存fakeも受け取る。
 */
export interface SignalSource {
  on?(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * SIGTERM / SIGINTのどちらが先に来てもhandlerを1回だけ実行する。
 * 実processの持続購読は停止中の重複signalを吸収し、fakeはonceへfallbackする。
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
  // 実processでは停止中も購読を残し、重複signalの既定即終了を防ぐ。
  const subscribe = emitter.on?.bind(emitter) ?? emitter.once.bind(emitter);
  subscribe('SIGTERM', wrapped);
  subscribe('SIGINT', wrapped);
}
