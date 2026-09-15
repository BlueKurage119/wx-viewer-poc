import type { TileApiError, WeatherControlStatus } from '@wx-viewer-poc/shared';

export type TileCatalogFailure =
  | { readonly kind: 'network' }
  | {
      readonly kind: 'http';
      readonly httpStatus: number;
      readonly code: TileApiError['code'] | null;
    };

export type TileCatalogResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: TileCatalogFailure };

/**
 * 索引 API を 1 回呼ぶ。path は呼び出し側が渡す。
 * terminalId / controlStatus 以外のクエリを組み立てない。
 */
export async function fetchTileCatalog<T>(params: {
  readonly path: string;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly parse: (body: unknown) => T | null;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<T>> {
  const fetchFn = params.fetchImpl ?? fetch;
  const query = new URLSearchParams({
    terminalId: params.terminalId,
    controlStatus: params.controlStatus,
  });
  const url = `${params.path}?${query.toString()}`;

  let response: Response;
  try {
    response = await fetchFn(url, { signal: params.signal });
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }

  if (!response.ok) {
    let code: TileApiError['code'] | null = null;
    try {
      const errBody = (await response.json()) as unknown;
      if (
        typeof errBody === 'object' &&
        errBody !== null &&
        'status' in errBody &&
        errBody.status === 'error' &&
        'code' in errBody &&
        typeof (errBody as { code: unknown }).code === 'string'
      ) {
        code = (errBody as { code: TileApiError['code'] }).code;
      }
    } catch {
      // JSON 以外のエラー応答では code=null
    }
    return {
      ok: false,
      failure: {
        kind: 'http',
        httpStatus: response.status,
        code,
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'http',
        httpStatus: response.status,
        code: null,
      },
    };
  }

  const parsed = params.parse(body);
  if (parsed === null) {
    return {
      ok: false,
      failure: {
        kind: 'http',
        httpStatus: response.status,
        code: null,
      },
    };
  }

  return { ok: true, value: parsed };
}
