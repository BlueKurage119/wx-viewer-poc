import { TERMINAL_DEFINITIONS } from '@wx-viewer-poc/shared';

/** HTMLナビゲーションだけを検証し、API・静的アセットの処理は配信側へ渡す。 */
export function isUnknownTerminalDocument(url: string, accept: string | undefined): boolean {
  if (!accept?.includes('text/html')) return false;
  const path = new URL(url, 'http://localhost').pathname;
  if (path === '/' || path.startsWith('/api/') || path.startsWith('/@')) return false;
  return !TERMINAL_DEFINITIONS.some(
    (terminal) => path === `/${terminal.id}` || path === `/${terminal.id}/`,
  );
}
