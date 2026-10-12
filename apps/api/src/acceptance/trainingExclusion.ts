import type { DatabaseConnection } from '../database/index.js';
import { findFetchAttemptById } from '../repositories/fetchAttemptRepository.js';
import { findNotificationOutputHistoryById } from '../repositories/notificationOutputHistoryRepository.js';
import { findTelegramReceptionById } from '../repositories/telegramReceptionRepository.js';
import type {
  FetchAttempt,
  NotificationOutputHistory,
  TelegramReception,
} from '../repositories/types.js';

/**
 * 受入条件検証（Epic L）が受信・取得試行・出力履歴を検証対象として取り出すときの、
 * 訓練データ除外の共通関数（Issue #73 J5）。
 * アプリの実行時（API・画面）からは呼ばない。L の受入検証テストとスクリプト専用。
 * control_status='test'（試験）は除外しない（対象は訓練のみ）。
 */

/** 訓練由来の取得試行の sourceKind。新しい訓練由来の sourceKind を足すときはここへ追加する。 */
export const TRAINING_SOURCE_KINDS = ['training_injection', 'training_retraction'] as const;
export const TRAINING_FEED_KIND = 'training';

export interface AcceptanceRange {
  readonly from: string;
  readonly to: string;
}

/** 受信: control_status='training'（気象庁の実配信訓練を含む）または feed_kind='training'（注入・取消）。 */
export function isTrainingReception(r: {
  readonly controlStatus: string | null;
  readonly feedKind: string | null;
}): boolean {
  return r.controlStatus === 'training' || r.feedKind === TRAINING_FEED_KIND;
}

/** 取得試行: sourceKind が TRAINING_SOURCE_KINDS。 */
export function isTrainingFetchAttempt(a: { readonly sourceKind: string }): boolean {
  return (TRAINING_SOURCE_KINDS as readonly string[]).includes(a.sourceKind);
}

/** 通知・出力履歴: isTraining=true。 */
export function isTrainingNotification(n: { readonly isTraining: boolean }): boolean {
  return n.isTraining;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** 範囲は received_at の両端を含む。受信の古い順。 */
export function listAcceptanceReceptions(
  weather: DatabaseConnection,
  range: AcceptanceRange,
): TelegramReception[] {
  const ids = weather
    .prepare(
      `
      SELECT id FROM telegram_reception
      WHERE received_at >= ? AND received_at <= ?
        AND (control_status IS NULL OR control_status <> 'training')
        AND (feed_kind IS NULL OR feed_kind <> '${TRAINING_FEED_KIND}')
      ORDER BY received_at ASC, id ASC
    `,
    )
    .all(range.from, range.to) as { id: number }[];
  return ids.map((row) => findTelegramReceptionById(weather, row.id)!);
}

/** 範囲は started_at の両端を含む。古い順。 */
export function listAcceptanceFetchAttempts(
  weather: DatabaseConnection,
  range: AcceptanceRange,
): FetchAttempt[] {
  const ids = weather
    .prepare(
      `
      SELECT id FROM fetch_attempt
      WHERE started_at >= ? AND started_at <= ?
        AND source_kind NOT IN (${placeholders(TRAINING_SOURCE_KINDS.length)})
      ORDER BY started_at ASC, id ASC
    `,
    )
    .all(range.from, range.to, ...TRAINING_SOURCE_KINDS) as { id: number }[];
  return ids.map((row) => findFetchAttemptById(weather, row.id)!);
}

/** 保持DBの出力履歴。範囲は detected_at の両端を含む。古い順。 */
export function listAcceptanceOutputHistory(
  retained: DatabaseConnection,
  range: AcceptanceRange,
): NotificationOutputHistory[] {
  const ids = retained
    .prepare(
      `
      SELECT id FROM notification_output_history
      WHERE detected_at >= ? AND detected_at <= ? AND is_training = 0
      ORDER BY detected_at ASC, id ASC
    `,
    )
    .all(range.from, range.to) as { id: number }[];
  return ids.map((row) => findNotificationOutputHistoryById(retained, row.id)!);
}
