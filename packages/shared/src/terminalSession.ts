export type TerminalSessionId = string;
export type TerminalSessionInquiryKind = 'startup' | 'continuation';

const TERMINAL_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isTerminalSessionId(value: unknown): value is TerminalSessionId {
  if (typeof value !== 'string' || value.length !== 36) {
    return false;
  }
  return TERMINAL_SESSION_ID_PATTERN.test(value);
}
