import { isTerminalConfigResponse } from '@wx-viewer-poc/shared';

/** HTMLナビゲーションだけを検証し、API・静的アセットの処理は配信側へ渡す。 */
export function isTerminalDocument(url: string, accept: string | undefined): boolean {
  if (!accept?.includes('text/html')) return false;
  const path = new URL(url, 'http://localhost').pathname;
  return (
    path !== '/' &&
    !path.startsWith('/api/') &&
    !path.startsWith('/@') &&
    !path.startsWith('/assets/') &&
    !['/index.html', '/favicon.ico', '/robots.txt'].includes(path)
  );
}

export function isUnknownTerminalDocument(
  url: string,
  accept: string | undefined,
  ids: readonly string[],
): boolean {
  if (!isTerminalDocument(url, accept)) return false;
  const path = new URL(url, 'http://localhost').pathname;
  return !ids.some((id) => path === `/${id}` || path === `/${id}/`);
}

export async function fetchTerminalIds(apiOrigin: string): Promise<readonly string[]> {
  const response = await fetch(new URL('/api/config/terminals', apiOrigin), {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('端末設定を取得できません');
  const body: unknown = await response.json();
  if (!isTerminalConfigResponse(body)) throw new Error('端末設定の応答が不正です');
  return body.terminals.map((terminal) => terminal.id);
}
