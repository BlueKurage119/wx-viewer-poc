import type { TrainingItem, TrainingItemId, TrainingTelegramPreview } from '@wx-viewer-poc/shared';
import { fetchTrainingItems, requestTrainingPreview } from '../api/training';

/** 一覧に保持する最大件数。超過は最古から自動削除する。 */
export const TRAINING_HISTORY_LIMIT = 20;

export const TRAINING_GENERATE_FAILED_MESSAGE = '訓練電文を生成できませんでした。';

/** 一覧の1行＝生成した電文1通。画面のメモリ上だけに保持する。 */
export interface TrainingHistoryEntry {
  readonly id: string;
  /** 生成時刻（UTC ISO）。 */
  readonly generatedAt: string;
  /** その電文に含まれる選択項目のラベル。 */
  readonly itemLabels: readonly string[];
  readonly telegram: TrainingTelegramPreview;
}

export type TrainingGenerationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending' }
  | { readonly phase: 'failed'; readonly message: string };

export interface TrainingState {
  readonly load: 'loading' | 'ready' | 'failed';
  readonly items: readonly TrainingItem[];
  readonly selected: readonly TrainingItemId[];
  readonly generation: TrainingGenerationState;
  /** 新しい順。最大 TRAINING_HISTORY_LIMIT 件。 */
  readonly history: readonly TrainingHistoryEntry[];
  readonly selectedEntryId: string | null;
}

export interface TrainingController {
  start(): void;
  /** groupの選択を置き換える（nullで選択なし）。同一現象内は単一段階。送信中は無視する。 */
  selectInGroup(group: string, itemId: TrainingItemId | null): void;
  /** 押下即実行。1項目以上選択・読込済み・非送信中のときだけ送信する。 */
  generate(): void;
  /** 項目選択をすべて解除する。一覧は変えない。 */
  reset(): void;
  /** 一覧の行を選択する（null で解除）。 */
  selectEntry(entryId: string | null): void;
  dispose(): void;
}

export const INITIAL_TRAINING_STATE: TrainingState = {
  load: 'loading',
  items: [],
  selected: [],
  generation: { phase: 'idle' },
  history: [],
  selectedEntryId: null,
};

/** 1回の生成結果を一覧の先頭へAPI順で挿入し、最大件数を超えた分を最古から捨てる。 */
export function prependHistory(
  history: readonly TrainingHistoryEntry[],
  added: readonly TrainingHistoryEntry[],
): TrainingHistoryEntry[] {
  return [...added, ...history].slice(0, TRAINING_HISTORY_LIMIT);
}

/**
 * 訓練画面の状態機械。リクエストごとに連番とAbortControllerを持ち、再読込・画面離脱で
 * abortと連番更新を行う。古い成功・失敗応答は状態にも一覧にも反映しない。
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
          update({ load: 'ready', items: response.items });
        },
        () => {
          if (request.signal.aborted || !active) return;
          update({ load: 'failed' });
        },
      );
    },
    selectInGroup(group, itemId) {
      if (!active || state.load !== 'ready' || state.generation.phase === 'sending') return;
      if (itemId !== null) {
        const item = state.items.find((candidate) => candidate.id === itemId);
        if (!item || !item.selectable || item.group !== group) return;
      }
      const others = state.selected.filter(
        (id) => state.items.find((candidate) => candidate.id === id)?.group !== group,
      );
      update({ selected: itemId === null ? others : [...others, itemId] });
    },
    generate() {
      if (!active || state.load !== 'ready') return;
      if (state.selected.length === 0 || state.generation.phase === 'sending') return;
      generateRequest?.abort();
      sequence += 1;
      const current = sequence;
      const request = new AbortController();
      generateRequest = request;
      const itemIds = state.selected;
      // 操作直後に送信中状態を描画し、応答を待たない。失敗表示はここで消す。
      update({ generation: { phase: 'sending' } });
      requestTrainingPreview(terminalId, itemIds, request.signal, fetcher).then(
        (result) => {
          if (current !== sequence || request.signal.aborted || !active) return;
          const added = result.telegrams.map<TrainingHistoryEntry>((telegram) => ({
            id: telegram.id,
            generatedAt: result.generatedAt,
            itemLabels: telegram.itemIds.map(
              (id) => state.items.find((item) => item.id === id)?.label ?? id,
            ),
            telegram,
          }));
          const history = prependHistory(state.history, added);
          // 新しい先頭行を自動選択する（ダイアログは開かない）。
          update({
            generation: { phase: 'idle' },
            history,
            selectedEntryId: history[0]?.id ?? null,
          });
        },
        () => {
          if (current !== sequence || request.signal.aborted || !active) return;
          update({ generation: { phase: 'failed', message: TRAINING_GENERATE_FAILED_MESSAGE } });
        },
      );
    },
    reset() {
      if (!active || state.load !== 'ready' || state.generation.phase === 'sending') return;
      if (state.selected.length === 0) return;
      update({
        selected: [],
        generation: state.generation.phase === 'failed' ? { phase: 'idle' } : state.generation,
      });
    },
    selectEntry(entryId) {
      if (!active) return;
      if (entryId !== null && !state.history.some((entry) => entry.id === entryId)) return;
      update({ selectedEntryId: entryId });
    },
    dispose() {
      active = false;
      sequence += 1;
      loadRequest?.abort();
      generateRequest?.abort();
    },
  };
}
