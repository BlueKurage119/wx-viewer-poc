import type { TrainingGenerateResponse, TrainingItem, TrainingItemId } from '@wx-viewer-poc/shared';
import { TrainingApiError, fetchTrainingItems, requestTrainingPreview } from '../api/training';

export type TrainingGenerationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending' }
  | { readonly phase: 'done'; readonly result: TrainingGenerateResponse }
  | { readonly phase: 'failed'; readonly message: string };

export interface TrainingState {
  readonly load: 'loading' | 'ready' | 'failed';
  readonly items: readonly TrainingItem[];
  readonly targetLabel: string;
  readonly selected: readonly TrainingItemId[];
  readonly generation: TrainingGenerationState;
}

export interface TrainingController {
  start(): void;
  /** groupの選択を置き換える（nullで選択なし）。同一現象内は単一段階。 */
  selectInGroup(group: string, itemId: TrainingItemId | null): void;
  generate(): void;
  dispose(): void;
}

export const INITIAL_TRAINING_STATE: TrainingState = {
  load: 'loading',
  items: [],
  targetLabel: '',
  selected: [],
  generation: { phase: 'idle' },
};

/**
 * 訓練画面の状態機械。リクエストごとに連番とAbortControllerを持ち、選択変更・再読込・画面離脱で
 * abortと連番更新を行う。古い成功・失敗応答は状態へ反映しない。
 */
export function createTrainingController(
  terminalId: string,
  publish: (state: TrainingState) => void,
  fetcher: typeof fetch = fetch,
): TrainingController {
  let state = INITIAL_TRAINING_STATE;
  let active = true;
  let sequence = 0;
  let loadRequest: AbortController | null = null;
  let generateRequest: AbortController | null = null;

  const update = (patch: Partial<TrainingState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    publish(state);
  };

  const invalidateGeneration = () => {
    sequence += 1;
    generateRequest?.abort();
    generateRequest = null;
  };

  return {
    start() {
      if (!active) return;
      loadRequest?.abort();
      const request = new AbortController();
      loadRequest = request;
      update({ load: 'loading' });
      fetchTrainingItems(terminalId, request.signal, fetcher).then(
        (response) => {
          if (request.signal.aborted || !active) return;
          update({ load: 'ready', items: response.items, targetLabel: response.targetLabel });
        },
        () => {
          if (request.signal.aborted || !active) return;
          update({ load: 'failed' });
        },
      );
    },
    selectInGroup(group, itemId) {
      if (!active || state.load !== 'ready') return;
      if (itemId !== null) {
        const item = state.items.find((candidate) => candidate.id === itemId);
        if (!item || !item.selectable || item.group !== group) return;
      }
      const others = state.selected.filter(
        (id) => state.items.find((candidate) => candidate.id === id)?.group !== group,
      );
      const selected = itemId === null ? others : [...others, itemId];
      // 選択変更時は進行中の生成を無効化し、旧プレビュー・旧エラーを消す。
      invalidateGeneration();
      update({ selected, generation: { phase: 'idle' } });
    },
    generate() {
      if (!active || state.load !== 'ready') return;
      if (state.selected.length === 0 || state.generation.phase === 'sending') return;
      invalidateGeneration();
      const request = new AbortController();
      generateRequest = request;
      const current = sequence;
      const itemIds = state.selected;
      // 操作直後に送信中状態を描画し、応答を待たない。
      update({ generation: { phase: 'sending' } });
      requestTrainingPreview(terminalId, itemIds, request.signal, fetcher).then(
        (result) => {
          if (current !== sequence || request.signal.aborted || !active) return;
          update({ generation: { phase: 'done', result } });
        },
        (error: unknown) => {
          if (current !== sequence || request.signal.aborted || !active) return;
          update({
            generation: {
              phase: 'failed',
              message:
                error instanceof TrainingApiError
                  ? error.message
                  : '電文の生成に失敗しました（通信エラー）',
            },
          });
        },
      );
    },
    dispose() {
      active = false;
      sequence += 1;
      loadRequest?.abort();
      generateRequest?.abort();
    },
  };
}
