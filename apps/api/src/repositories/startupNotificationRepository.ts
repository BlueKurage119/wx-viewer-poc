import type { TerminalSessionInquiryKind, VenueId } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';

export interface StartupWarningClaimInput {
  readonly serverGenerationId: string;
  readonly venueId: VenueId;
  readonly claimedAt: string;
  readonly sessionId: string;
}

export interface StartupNotificationInquiryRecord {
  readonly serverGenerationId: string;
  readonly venueId: VenueId;
  readonly terminalId: string;
  readonly sessionId: string;
  readonly sessionKind: TerminalSessionInquiryKind;
  readonly inquiredAt: string;
  readonly warningClaimed: boolean;
  readonly responseJson: string;
}

/** 同じ起動世代・会場に対する warning 出力権を原子的に取得する。 */
export function claimStartupWarning(
  connection: DatabaseConnection,
  input: StartupWarningClaimInput,
): boolean {
  const result = connection
    .prepare(
      `INSERT INTO startup_warning_claim (server_generation_id, venue_id, claimed_at, session_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (server_generation_id, venue_id) DO NOTHING`,
    )
    .run(input.serverGenerationId, input.venueId, input.claimedAt, input.sessionId);
  return result.changes === 1;
}

export function recordStartupNotificationInquiry(
  connection: DatabaseConnection,
  input: StartupNotificationInquiryRecord,
): void {
  connection
    .prepare(
      `INSERT INTO startup_notification_inquiry (
         server_generation_id, venue_id, terminal_id, session_id, session_kind,
         inquired_at, warning_claimed, response_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.serverGenerationId,
      input.venueId,
      input.terminalId,
      input.sessionId,
      input.sessionKind,
      input.inquiredAt,
      input.warningClaimed ? 1 : 0,
      input.responseJson,
    );
}
