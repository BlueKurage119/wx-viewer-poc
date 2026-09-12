import type { ControlStatus } from '../repositories/types.js';

/**
 * プロセス起動単位の初期取得済み判定（非永続・メモリのみ）。
 * キー = `${areaCode}|${controlStatus}`。
 */
export class InitialWarningNotificationTracker {
  private readonly processedKeys = new Set<string>();

  /**
   * 未処理（初期取得通知がまだ行われていない）かどうかを返す。
   */
  isPending(areaCode: string, controlStatus: ControlStatus): boolean {
    return !this.processedKeys.has(`${areaCode}|${controlStatus}`);
  }

  /**
   * 処理完了としてマークする。
   */
  markDone(areaCode: string, controlStatus: ControlStatus): void {
    this.processedKeys.add(`${areaCode}|${controlStatus}`);
  }

  /**
   * テスト用。プロセス再起動の等価物。
   */
  reset(): void {
    this.processedKeys.clear();
  }
}
