import {
  parseTrainingInjectResponse,
  parseTrainingInjectionsResponse,
  parseTrainingRetractResponse,
  type TrainingGenerateResponse,
  type TrainingInjectResponse,
  type TrainingInjectTelegram,
  type TrainingInjectionsResponse,
  type TrainingRetractRequest,
  type TrainingRetractResponse,
  type TrainingItem,
  type TrainingItemId,
  type TrainingItemsResponse,
  type TrainingTelegramPreview,
} from '@wx-viewer-poc/shared';

/** 利用者へ表示してよい日本語メッセージを持つエラー。 */
export class TrainingApiError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isItem(value: unknown): value is TrainingItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.group === 'string' &&
    typeof value.selectable === 'boolean' &&
    (typeof value.unavailableReason === 'string' || value.unavailableReason === null)
  );
}

export function parseTrainingItemsResponse(body: unknown): TrainingItemsResponse | null {
  if (!isRecord(body) || typeof body.targetLabel !== 'string') return null;
  if (!Array.isArray(body.items) || !body.items.every(isItem)) return null;
  return { items: body.items, targetLabel: body.targetLabel };
}

function isPreview(value: unknown): value is TrainingTelegramPreview {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStringArray(value.itemIds) &&
    typeof value.telegramType === 'string' &&
    typeof value.title === 'string' &&
    typeof value.xml === 'string' &&
    typeof value.reportDateTime === 'string' &&
    typeof value.targetDateTime === 'string' &&
    (typeof value.validDateTime === 'string' || value.validDateTime === null) &&
    isStringArray(value.areaNames) &&
    value.provenance === 'synthetic' &&
    value.isTraining === true
  );
}

export function parseTrainingGenerateResponse(body: unknown): TrainingGenerateResponse | null {
  if (!isRecord(body)) return null;
  if (typeof body.generationId !== 'string' || typeof body.generatedAt !== 'string') return null;
  if (!Array.isArray(body.telegrams) || !body.telegrams.every(isPreview)) return null;
  return {
    generationId: body.generationId,
    generatedAt: body.generatedAt,
    telegrams: body.telegrams,
  };
}

export async function fetchTrainingItems(
  terminalId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrainingItemsResponse> {
  const response = await fetcher(
    `/api/training/items?terminalId=${encodeURIComponent(terminalId)}`,
    {
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new TrainingApiError(`項目の取得に失敗しました（${response.status}）`);
  const parsed = parseTrainingItemsResponse(await response.json());
  if (parsed === null) throw new TrainingApiError('項目の応答形式が不正です');
  return parsed;
}

export async function requestTrainingPreview(
  terminalId: string,
  itemIds: readonly TrainingItemId[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrainingGenerateResponse> {
  const response = await fetcher('/api/training/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ terminalId, itemIds }),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new TrainingApiError(`電文の生成に失敗しました（${response.status}）`);
  const parsed = parseTrainingGenerateResponse(await response.json());
  if (parsed === null) throw new TrainingApiError('生成結果の形式が不正です');
  return parsed;
}

export async function requestTrainingInject(
  terminalId: string,
  telegrams: readonly TrainingInjectTelegram[],
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrainingInjectResponse> {
  let response: Response;
  try {
    response = await fetcher('/api/training/inject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terminalId, telegrams }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof TrainingApiError) throw error;
    throw new TrainingApiError('電文投入できませんでした');
  }

  if (!response.ok) {
    if (response.status === 400) {
      throw new TrainingApiError('電文投入できませんでした（要求が不正です）');
    }
    if (response.status === 403) {
      throw new TrainingApiError('電文投入できませんでした（この端末では操作できません）');
    }
    if (response.status === 413) {
      throw new TrainingApiError('電文投入できませんでした（電文が大きすぎます）');
    }
    if (response.status === 422) {
      throw new TrainingApiError('電文投入できませんでした（電文の検証に失敗しました）');
    }
    if (response.status === 503) {
      throw new TrainingApiError('電文投入できませんでした（取得処理が利用できません）');
    }
    if (response.status === 504) {
      throw new TrainingApiError('電文投入の結果を確認できませんでした');
    }
    throw new TrainingApiError('電文投入できませんでした');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TrainingApiError('電文投入できませんでした');
  }

  const parsed = parseTrainingInjectResponse(body);
  if (parsed === null) {
    throw new TrainingApiError('電文投入できませんでした');
  }
  return parsed;
}

/** 投入済み一覧（同じ会場のK端末が投入した完了済みの注入）。失敗・形式不正は例外。 */
export async function fetchTrainingInjections(
  terminalId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrainingInjectionsResponse> {
  const response = await fetcher(
    `/api/training/injections?terminalId=${encodeURIComponent(terminalId)}`,
    { signal, cache: 'no-store' },
  );
  if (!response.ok) {
    throw new TrainingApiError(`投入済みの一覧を取得できませんでした（${response.status}）`);
  }
  const parsed = parseTrainingInjectionsResponse(await response.json());
  if (parsed === null) throw new TrainingApiError('投入済みの一覧の形式が不正です');
  return parsed;
}

/** 訓練データの抹消（論理取消）。失敗は利用者へ表示してよい日本語メッセージの TrainingApiError。 */
export async function requestTrainingRetract(
  request: TrainingRetractRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TrainingRetractResponse> {
  const failed = (reason?: string) =>
    new TrainingApiError(reason ? `抹消できませんでした（${reason}）` : '抹消できませんでした');
  let response: Response;
  try {
    response = await fetcher('/api/training/retract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
      cache: 'no-store',
    });
  } catch {
    throw failed();
  }

  if (!response.ok) {
    if (response.status === 400) throw failed('要求が不正です');
    if (response.status === 403) throw failed('この端末では操作できません');
    if (response.status === 404) throw failed('対象の訓練が見つかりません');
    if (response.status === 409) throw failed('既に抹消済みです');
    if (response.status === 503) throw failed('取得処理が利用できません');
    if (response.status === 504) throw new TrainingApiError('抹消の結果を確認できませんでした');
    throw failed();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw failed();
  }
  const parsed = parseTrainingRetractResponse(body);
  if (parsed === null) throw failed();
  return parsed;
}
