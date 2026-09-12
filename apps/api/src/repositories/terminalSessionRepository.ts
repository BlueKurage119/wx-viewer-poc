import type { DatabaseConnection } from '../database/index.js';
import {
  isTerminalSessionId,
  type TerminalSessionId,
  type TerminalSessionInquiryKind,
} from '@wx-viewer-poc/shared';
import { validateUtcIso8601String } from './snapshot.js';

export interface TerminalSessionInquiryResult {
  readonly sessionId: TerminalSessionId;
  readonly kind: TerminalSessionInquiryKind;
  readonly firstInquiredAt: string;
}

interface TerminalSessionRow {
  readonly session_id: string;
  readonly first_inquired_at: string;
}

export function recordTerminalSessionInquiry(
  connection: DatabaseConnection,
  sessionId: TerminalSessionId,
  inquiredAt: string,
): TerminalSessionInquiryResult {
  if (!isTerminalSessionId(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
  validateUtcIso8601String(inquiredAt, 'inquiredAt');

  const insertStmt = connection.prepare(
    `INSERT INTO terminal_session (session_id, first_inquired_at)
     VALUES (?, ?)
     ON CONFLICT(session_id) DO NOTHING`,
  );
  const selectStmt = connection.prepare(
    `SELECT session_id, first_inquired_at
     FROM terminal_session
     WHERE session_id = ?`,
  );

  const tx = connection.transaction(
    (sId: TerminalSessionId, at: string): TerminalSessionInquiryResult => {
      const info = insertStmt.run(sId, at);
      const kind: TerminalSessionInquiryKind = info.changes === 1 ? 'startup' : 'continuation';

      const row = selectStmt.get(sId) as TerminalSessionRow | undefined;
      if (!row) {
        throw new Error(`Failed to read terminal session row after inquiry: ${sId}`);
      }

      return {
        sessionId: row.session_id,
        kind,
        firstInquiredAt: row.first_inquired_at,
      };
    },
  ).immediate;

  return tx(sessionId, inquiredAt);
}
