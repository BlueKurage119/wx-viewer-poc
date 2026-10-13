import type {
  TrainingInjectionListItem,
  TrainingInjectTelegram,
  TrainingRetractRequest,
  TrainingItem,
  TrainingItemId,
} from '@wx-viewer-poc/shared';
import {
  TRAINING_STOCK_LIMIT,
  createTrainingStockRepository,
  type TrainingInjectionStatus,
  type TrainingStockEntry,
  type TrainingStockRepository,
} from './trainingStock';
import {
  TrainingApiError,
  fetchTrainingInjections,
  fetchTrainingItems,
  requestTrainingInject,
  requestTrainingInjectionsHide,
  requestTrainingRetract,
  requestTrainingPreview,
} from '../api/training';
import { trainingDeletedMessage } from './trainingToolbarState';
import {
  formatTrainingInjectSuccessMessage,
  formatTrainingRetractSuccessMessage,
} from './trainingFormat';

export type { TrainingStockEntry } from './trainingStock';

/** 投入済み一覧の定期再読込の間隔。 */
export const TRAINING_INJECTED_POLL_MS = 30_000;
export const TRAINING_GENERATE_FAILED_MESSAGE = '訓練電文を生成できませんでした。';
export const TRAINING_INJECTED_LOAD_FAILED_MESSAGE = '投入済みの一覧を取得できませんでした';
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
  /** 訓練電文の投入処理中。 */
  readonly injecting: boolean;
  /** 投入済みの注入（サーバーの記録）。新しい順。読込失敗中は直近の成功分を保持する。 */
  readonly injected: readonly TrainingInjectionListItem[];
  /** 直近の投入済み一覧の読込が失敗した。次に成功すると false に戻る。 */
  readonly injectedLoadFailed: boolean;
  /** 投入済みの行でチェックされた訓練ID（抹消済みは含まない）。保存しない。 */
  readonly checkedInjected: readonly string[];
  /** 訓練データの抹消処理中。 */
  readonly retracting: boolean;
  /** 抹消済みの訓練を一覧から外す処理中。 */
  readonly hiding: boolean;
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
  /** 投入済み一覧を読み込み、以後30秒ごとに再読込する。 */
  startInjectedWatch(): void;
  /** 投入済み一覧を1回読み込む。 */
  loadInjected(): void;
  /** チェックされた電文を投入APIへ送信する。 */
  injectChecked(venueId?: string): Promise<{ readonly success: boolean; readonly message: string }>;
  /** 投入済みの行のチェックを切り替える（抹消済みの行を含む）。存在しない行は無視する。 */
  setCheckedInjected(trainingId: string, checked: boolean): void;
  /** チェックされた投入済みの訓練を抹消する（確認なし、選択→送信の2段階で呼ばれる）。 */
  retractChecked(): Promise<{ readonly success: boolean; readonly message: string }>;
  /**
   * リスト消去・リスト全消。ローカル行をストックから消し、抹消済みの投入済み行があれば
   * 先に hide API で一覧から外す（失敗時はローカル行も消さずチェックを維持する）。
   */
  clearList(
    scope: 'checked' | 'all',
  ): Promise<{ readonly success: boolean; readonly message: string }>;
  /** 会場を問わず全ての訓練データを抹消する。 */
  retractAll(): Promise<{ readonly success: boolean; readonly message: string }>;
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
  injecting: false,
  injected: [],
  injectedLoadFailed: false,
  checkedInjected: [],
  retracting: false,
  hiding: false,
};

/** チェックされた投入済みの行を、未抹消と抹消済みに分ける。 */
export function splitCheckedInjected(state: Pick<TrainingState, 'checkedInjected' | 'injected'>): {
  readonly pending: readonly string[];
  readonly retracted: readonly string[];
} {
  const pending: string[] = [];
  const retracted: string[] = [];
  for (const id of state.checkedInjected) {
    const row = state.injected.find((i) => i.trainingId === id);
    if (!row) continue;
    (row.retractedAt === null ? pending : retracted).push(id);
  }
  return { pending, retracted };
}

/** 1回の生成結果を一覧の先頭へAPI順で挿入し、最大件数を超えた分を最古から捨てる。 */
export function prependHistory(
  history: readonly TrainingStockEntry[],
  added: readonly TrainingStockEntry[],
): TrainingStockEntry[] {
  return [...added, ...history].slice(0, TRAINING_STOCK_LIMIT);
}

function withInjectionStatus(
  history: readonly TrainingStockEntry[],
  ids: ReadonlySet<string>,
  injectionStatus: TrainingInjectionStatus,
): TrainingStockEntry[] {
  return history.map((entry) => (ids.has(entry.id) ? { ...entry, injectionStatus } : entry));
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
  let injectedRequest: AbortController | null = null;
  let injectedTimer: ReturnType<typeof setInterval> | null = null;

  const update = (patch: Partial<TrainingState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    publish(state);
  };

  const loadInjected = () => {
    if (!active) return;
    injectedRequest?.abort();
    const request = new AbortController();
    injectedRequest = request;
    fetchTrainingInjections(terminalId, request.signal, fetcher).then(
      (response) => {
        if (request.signal.aborted || !active) return;
        // 一覧から消えた行のチェックは外す（抹消済みの行は一覧から外すためにチェックを残す）。
        const selectable = new Set(response.injections.map((i) => i.trainingId));
        update({
          injected: response.injections,
          injectedLoadFailed: false,
          checkedInjected: state.checkedInjected.filter((id) => selectable.has(id)),
        });
      },
      () => {
        if (request.signal.aborted || !active) return;
        update({ injectedLoadFailed: true });
      },
    );
  };

  const deleteChecked = (): number => {
    if (!active || state.checked.length === 0) return 0;
    const removed = new Set(state.checked);
    const history = state.history.filter((entry) => !removed.has(entry.id));
    const count = state.history.length - history.length;
    update({ history, checked: [], saveFailed: !stock.save(terminalId, history).saved });
    return count;
  };
  const deleteAll = (): number => {
    if (!active || state.history.length === 0) return 0;
    const count = state.history.length;
    update({ history: [], checked: [], saveFailed: !stock.save(terminalId, []).saved });
    return count;
  };

  const retract = async (
    request: TrainingRetractRequest,
  ): Promise<{ readonly success: boolean; readonly message: string }> => {
    update({ retracting: true });
    try {
      const response = await requestTrainingRetract(request, undefined, fetcher);
      const message = formatTrainingRetractSuccessMessage(
        response.scope,
        response.trainingIds.length,
      );
      // 画面離脱・端末切替後は状態を変えない。
      if (!active) return { success: true, message };
      // 抹消した行は「抹消済み」としてサーバーの一覧に残る。チェックは外し、直後に再読込する。
      update({ retracting: false, checkedInjected: [] });
      loadInjected();
      return { success: true, message };
    } catch (error) {
      const message = error instanceof TrainingApiError ? error.message : '抹消できませんでした';
      if (!active) return { success: false, message };
      // 失敗時もチェックを維持し、一覧を再読込する（既に抹消済み等を反映する）。
      update({ retracting: false });
      loadInjected();
      return { success: false, message };
    }
  };

  return {
    loadInjected,
    startInjectedWatch() {
      if (!active) return;
      loadInjected();
      if (injectedTimer === null) {
        injectedTimer = setInterval(loadInjected, TRAINING_INJECTED_POLL_MS);
      }
    },
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
            injectionStatus: 'pending',
          }));
          // 削除済みの行の上に積み、先頭行にチェックは付けない。押し出された行のチェックは消える。
          // 成功時は項目選択を全解除する（失敗時は再試行のため維持）。
          const history = prependHistory(state.history, added);
          const ids = new Set(history.map((entry) => entry.id));
          update({
            selected: [],
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
    deleteChecked,
    deleteAll,
    async injectChecked(venueId?: string) {
      if (
        !active ||
        state.injecting ||
        state.retracting ||
        state.hiding ||
        state.checked.length === 0
      ) {
        return { success: false, message: '電文投入できませんでした' };
      }
      const targetEntries = state.history.filter((entry) => state.checked.includes(entry.id));
      if (targetEntries.length === 0) {
        return { success: false, message: '電文投入できませんでした' };
      }
      update({ injecting: true });
      const telegrams: TrainingInjectTelegram[] = targetEntries.map((entry) => ({
        previewId: entry.telegram.id,
        generatedAt: entry.generatedAt,
        itemIds: entry.telegram.itemIds,
        telegramType: entry.telegram.telegramType,
        xml: entry.telegram.xml,
      }));
      try {
        const response = await requestTrainingInject(terminalId, telegrams, undefined, fetcher);
        // 画面離脱・端末切替後は状態も保存も変えない。
        if (!active)
          return { success: true, message: formatTrainingInjectSuccessMessage(response, venueId) };
        // 投入済みの行はローカルから消し、サーバーの一覧に出す（直後に再読込する）。
        const removed = new Set(targetEntries.map((entry) => entry.id));
        const history = state.history.filter((entry) => !removed.has(entry.id));
        update({
          injecting: false,
          checked: state.checked.filter((id) => !removed.has(id)),
          history,
          saveFailed: !stock.save(terminalId, history).saved,
        });
        loadInjected();
        const message = formatTrainingInjectSuccessMessage(response, venueId);
        return { success: true, message };
      } catch (error) {
        const message =
          error instanceof TrainingApiError ? error.message : '電文投入できませんでした';
        if (!active) return { success: false, message };
        const failedIds = new Set(targetEntries.map((entry) => entry.id));
        const history = withInjectionStatus(state.history, failedIds, 'failed');
        update({
          injecting: false,
          history,
          saveFailed: !stock.save(terminalId, history).saved,
        });
        return { success: false, message };
      }
    },
    setCheckedInjected(trainingId, checked) {
      if (!active) return;
      if (!state.injected.some((i) => i.trainingId === trainingId)) return;
      const others = state.checkedInjected.filter((id) => id !== trainingId);
      update({ checkedInjected: checked ? [...others, trainingId] : others });
    },
    async clearList(scope) {
      const failure = { success: false, message: 'リストから消去できませんでした' };
      if (!active || state.injecting || state.retracting || state.hiding) return failure;
      const retractedIds =
        scope === 'all'
          ? state.injected.filter((i) => i.retractedAt !== null).map((i) => i.trainingId)
          : splitCheckedInjected(state).retracted;
      const clearLocal = () => (scope === 'all' ? deleteAll() : deleteChecked());
      if (retractedIds.length === 0) {
        return { success: true, message: trainingDeletedMessage(clearLocal()) };
      }
      update({ hiding: true });
      try {
        await requestTrainingInjectionsHide(terminalId, retractedIds, undefined, fetcher);
        if (!active) {
          return {
            success: true,
            message: trainingDeletedMessage(retractedIds.length),
          };
        }
        const message = trainingDeletedMessage(clearLocal() + retractedIds.length);
        const hidden = new Set(retractedIds);
        update({
          hiding: false,
          checkedInjected: state.checkedInjected.filter((id) => !hidden.has(id)),
        });
        loadInjected();
        return { success: true, message };
      } catch (error) {
        const message =
          error instanceof TrainingApiError ? error.message : 'リストから消去できませんでした';
        if (!active) return { success: false, message };
        update({ hiding: false });
        loadInjected();
        return { success: false, message };
      }
    },
    async retractChecked() {
      const pendingIds = splitCheckedInjected(state).pending;
      if (
        !active ||
        state.injecting ||
        state.retracting ||
        state.hiding ||
        pendingIds.length === 0
      ) {
        return { success: false, message: '抹消できませんでした' };
      }
      return retract({ terminalId, scope: 'training', trainingIds: pendingIds });
    },
    async retractAll() {
      if (!active || state.injecting || state.retracting || state.hiding) {
        return { success: false, message: '抹消できませんでした' };
      }
      return retract({ terminalId, scope: 'all' });
    },
    dispose() {
      active = false;
      sequence += 1;
      loadRequest?.abort();
      generateRequest?.abort();
      injectedRequest?.abort();
      if (injectedTimer !== null) clearInterval(injectedTimer);
      injectedTimer = null;
    },
  };
}
