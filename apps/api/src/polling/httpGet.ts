export interface HttpGetOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly accept?: string;
}

export interface HttpGetResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly bodyText: string | null;
  readonly responseBytes: number | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
}

export function sanitizeErrorMessage(msg: string): string {
  // 秘密情報やヘッダ情報、認証情報が漏れないようにサニタイズ
  return msg.replace(/:\/\/([^:]+):([^@]+)@/g, '://***:***@').slice(0, 500);
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export async function performHttpGet(
  url: string,
  options?: HttpGetOptions,
): Promise<HttpGetResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const accept = options?.accept ?? 'application/xml, text/xml, */*';

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = AbortSignal.any([timeoutSignal, controller.signal]);

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: accept,
        'User-Agent': 'wx-viewer-poc/0.1.0',
      },
      signal: combinedSignal,
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        bodyText: null,
        responseBytes: null,
        errorKind: 'http_status',
        errorMessage: sanitizeErrorMessage(`HTTP ${res.status} ${res.statusText}`),
      };
    }

    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf-8');

    return {
      ok: true,
      status: res.status,
      bodyText: text,
      responseBytes: bytes,
      errorKind: null,
      errorMessage: null,
    };
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string; code?: string };
    const isTimeout =
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      err?.code === 'UND_ERR_CONNECT_TIMEOUT';

    return {
      ok: false,
      status: null,
      bodyText: null,
      responseBytes: null,
      errorKind: isTimeout ? 'timeout' : 'network',
      errorMessage: sanitizeErrorMessage(err?.message ?? String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}
