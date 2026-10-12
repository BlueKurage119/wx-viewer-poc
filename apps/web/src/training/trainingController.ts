import type { TrainingItem, TrainingItemId } from '@wx-viewer-poc/shared';
import {
  TRAINING_STOCK_LIMIT,
  createTrainingStockRepository,
  type TrainingStockEntry,
  type TrainingStockRepository,
} from './trainingStock';
import { fetchTrainingItems, requestTrainingPreview } from '../api/training';

export type { TrainingStockEntry } from './trainingStock';

export const TRAINING_GENERATE_FAILED_MESSAGE = '訓練電文を生成できませんでした。';
export const TRAINING_SAVE_FAILED_MESSAGE = '一覧を保存できませんでした';

export type TrainingGenerationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending' }
  | { readonly phase: 'failed'; readonly message: string };

export interface TrainingState {
  readonly load: 'loading' | 'ready' | 'failed';
  readonly items: readonly TrainingItem[];
  readonly selected: readonly TrainingItemId[];
  readonly generation: TrainingGenerationState;
  /** 一覧（ストック）。新しい順。最大 TRAINING_STOCK_LIMIT 件。localStorageに保存される。 */
  readonly history: readonly TrainingStockEntry[];
  /** 一覧でチェックされた行のID。保存しない。 */
  readonly checked: readonly string[];
  /** 直近の保存が失敗した。次に保存が成功すると false に戻る。 */
  readonly saveFailed: boolean;
}

export interface TrainingController {
  start(): void;
  /** groupの選択を置き換える（nullで選択なし）。同一現象内は単一段階。送信中は無視する。 */
  selectInGroup(group: string, itemId: TrainingItemId | null): void;
  /** 押下即実行。1項目以上選択・読込済み・非送信中のときだけ送信する。 */
  generate(): void;
  /** 項目選択をすべて解除する。一覧は変えない。 */
  reset(): void;
  /** 一覧の行のチェックを切り替える（複数可）。 */
  setChecked(entryId: string, checked: boolean): void;
  /** チェックされた行を確認なしで一覧から除き、直後に保存する。生成中でも実行できる。除いた件数を返す。 */
  deleteChecked(): number;
  /** 一覧を全件消し、空配列を保存する。チェックも消える。生成中でも実行できる。消した件数を返す。 */
  deleteAll(): number;
  dispose(): void;
}

export const INITIAL_TRAINING_STATE: TrainingState = {
  load: 'loading',
  items: [],
  selected: [],
  generation: { phase: 'idle' },
  history: [],
  checked: [],
  saveFailed: false,
};

/** 1回の生成結果を一覧の先頭へAPI順で挿入し、最大件数を超えた分を最古から捨てる。 */
export function prependHistory(
  history: readonly TrainingStockEntry[],
  added: readonly TrainingStockEntry[],
): TrainingStockEntry[] {
  return [...added, ...history].slice(0, TRAINING_STOCK_LIMIT);
}

/**
 * 訓練画面の状態機械。リクエストごとに連番とAbortControllerを持ち、再読込・画面離脱で
 * abortと連番更新を行う。古い成功・失敗応答は状態にも一覧にも反映しない。
 */
export function createTrainingController(
  terminalId: string,
  publish: (state: TrainingState) => void,
  fetcher: typeof fetch = fetch,
  stock: TrainingStockRepository = createTrainingStockRepository(),
): TrainingController {
  // 保存済みの一覧は項目取得と独立に、同期で読み込む（端末ごとのキー）。
  let state: TrainingState = { ...INITIAL_TRAINING_STATE, history: stock.load(terminalId) };
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
          const added = result.telegrams.map<TrainingStockEntry>((telegram) => ({
            id: telegram.id,
            generatedAt: result.generatedAt,
            itemLabels: telegram.itemIds.map(
              (id) => state.items.find((item) => item.id === id)?.label ?? id,
            ),
            telegram,
          }));
          // 削除済みの行の上に積み、先頭行にチェックは付けない。押し出された行のチェックは消える。
          const history = prependHistory(state.history, added);
          const ids = new Set(history.map((entry) => entry.id));
          update({
            generation: { phase: 'idle' },
            history,
            checked: state.checked.filter((id) => ids.has(id)),
            saveFailed: !stock.save(terminalId, history).saved,
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
    setChecked(entryId, checked) {
      if (!active || !state.history.some((entry) => entry.id === entryId)) return;
      const others = state.checked.filter((id) => id !== entryId);
      update({ checked: checked ? [...others, entryId] : others });
    },
    deleteChecked() {
      if (!active || state.checked.length === 0) return 0;
      const removed = new Set(state.checked);
      const history = state.history.filter((entry) => !removed.has(entry.id));
      const count = state.history.length - history.length;
      update({ history, checked: [], saveFailed: !stock.save(terminalId, history).saved });
      return count;
    },
    deleteAll() {
      if (!active || state.history.length === 0) return 0;
      const count = state.history.length;
      update({ history: [], checked: [], saveFailed: !stock.save(terminalId, []).saved });
      return count;
    },
    dispose() {
      active = false;
      sequence += 1;
      loadRequest?.abort();
      generateRequest?.abort();
    },
  };
}
