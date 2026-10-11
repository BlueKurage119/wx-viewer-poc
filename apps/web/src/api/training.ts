import type {
  TrainingGenerateResponse,
  TrainingItem,
  TrainingItemId,
  TrainingItemsResponse,
  TrainingTelegramPreview,
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
