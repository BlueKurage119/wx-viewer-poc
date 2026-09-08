import type { TerminalMode } from './config';
export interface ShellNotice {
  id: string;
  category: 'warning' | 'question' | 'emergency';
  origin: 'weather' | 'equipment';
  summary: string;
  unread: boolean;
  pending: boolean;
}
// 保持する配列を変更せず、表示境界でのみ端末モードによる絞り込みを行う。
export function visibleNotices(
  notices: readonly ShellNotice[],
  mode: TerminalMode,
): readonly ShellNotice[] {
  return notices.filter((notice) => mode === 'K' || notice.origin !== 'equipment');
}
