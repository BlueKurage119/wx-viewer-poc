import type { TrainingTelegramPreview, TrainingTelegramType } from '@wx-viewer-poc/shared';

/** 一覧（ストック）に保持する最大件数。超過は最古から自動削除する。 */
export const TRAINING_STOCK_LIMIT = 20;
export const TRAINING_STOCK_VERSION = 2;
export const TRAINING_STOCK_KEY_PREFIX = 'wx-viewer:training-stock:v1:';

/** 電文投入の状態。pending=未投入、injected=投入済み、failed=投入失敗。 */
export type TrainingInjectionStatus = 'pending' | 'injected' | 'failed';

/** 一覧の1行＝生成した電文1通。 */
export interface TrainingStockEntry {
  readonly id: string;
  /** 生成時刻（UTC ISO）。 */
  readonly generatedAt: string;
  /** その電文に含まれる選択項目のラベル。 */
  readonly itemLabels: readonly string[];
  readonly telegram: TrainingTelegramPreview;
  readonly injectionStatus: TrainingInjectionStatus;
}

type StockStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface TrainingStockRepository {
  /** 保存済みの一覧（新しい順）。壊れていれば空を返し、保存内容を捨てる。例外を投げない。 */
  load(terminalId: string): TrainingStockEntry[];
  /** 一覧全体を保存する。失敗しても例外を投げず saved:false を返す。 */
  save(terminalId: string, entries: readonly TrainingStockEntry[]): { readonly saved: boolean };
}

const KNOWN_TELEGRAM_TYPES: ReadonlySet<string> = new Set<TrainingTelegramType>([
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
  'VPBS50',
  'VPHW50',
  'VPHW51',
]);

export function trainingStockKey(terminalId: string): string {
  return `${TRAINING_STOCK_KEY_PREFIX}${terminalId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseEntry(value: unknown, version: 1 | 2): TrainingStockEntry | null {
  if (!isRecord(value) || !isRecord(value.telegram)) return null;
  if (
    version === 2 &&
    value.injectionStatus !== 'pending' &&
    value.injectionStatus !== 'injected' &&
    value.injectionStatus !== 'failed'
  ) {
    return null;
  }
  const t = value.telegram;
  if (
    typeof value.id !== 'string' ||
    typeof value.generatedAt !== 'string' ||
    !isStringArray(value.itemLabels) ||
    typeof t.id !== 'string' ||
    typeof t.title !== 'string' ||
    typeof t.xml !== 'string' ||
    typeof t.telegramType !== 'string' ||
    !KNOWN_TELEGRAM_TYPES.has(t.telegramType) ||
    !isStringArray(t.itemIds) ||
    typeof t.reportDateTime !== 'string' ||
    typeof t.targetDateTime !== 'string' ||
    (typeof t.validDateTime !== 'string' && t.validDateTime !== null) ||
    !isStringArray(t.areaNames) ||
    t.provenance !== 'synthetic' ||
    t.isTraining !== true
  ) {
    return null;
  }
  return {
    id: value.id,
    generatedAt: value.generatedAt,
    itemLabels: value.itemLabels,
    telegram: {
      id: t.id,
      itemIds: t.itemIds as TrainingTelegramPreview['itemIds'],
      telegramType: t.telegramType as TrainingTelegramType,
      title: t.title,
      xml: t.xml,
      reportDateTime: t.reportDateTime,
      targetDateTime: t.targetDateTime,
      validDateTime: t.validDateTime,
      areaNames: t.areaNames,
      provenance: 'synthetic',
      isTraining: true,
    },
    // version 1 は投入状態を持たないので全行を未投入として読む。
    injectionStatus: version === 2 ? (value.injectionStatus as TrainingInjectionStatus) : 'pending',
  };
}

/**
 * 保存内容の検証。version違い・配列でない・1件でも不正な要素があれば null（全体を捨てる。部分救済しない）。
 */
export function parseTrainingStock(
  value: unknown,
): { readonly entries: TrainingStockEntry[]; readonly migrated: boolean } | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  if (value.version !== 1 && value.version !== 2) return null;
  const version = value.version;
  const entries: TrainingStockEntry[] = [];
  for (const raw of value.entries) {
    const entry = parseEntry(raw, version);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { entries, migrated: version === 1 };
}

/** 保存先を関数で差し替えられるリポジトリ（既存 notificationPreferences.ts と同じ形）。 */
export function createTrainingStockRepository(
  storage: () => StockStorage = () => window.localStorage,
): TrainingStockRepository {
  const write = (terminalId: string, entries: readonly TrainingStockEntry[]) => {
    try {
      storage().setItem(
        trainingStockKey(terminalId),
        JSON.stringify({ version: TRAINING_STOCK_VERSION, entries }),
      );
      return { saved: true };
    } catch {
      return { saved: false };
    }
  };
  return {
    load(terminalId) {
      const key = trainingStockKey(terminalId);
      let raw: string | null;
      try {
        raw = storage().getItem(key);
      } catch {
        return [];
      }
      if (raw === null) return [];
      let parsed: ReturnType<typeof parseTrainingStock>;
      try {
        parsed = parseTrainingStock(JSON.parse(raw));
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        try {
          storage().removeItem(key);
        } catch {
          // 消せなくても空から始める。
        }
        return [];
      }
      let entries = parsed.entries;
      const truncated = entries.length > TRAINING_STOCK_LIMIT;
      if (truncated) entries = entries.slice(0, TRAINING_STOCK_LIMIT);
      // 超過の切り詰め、または version 1 からの移行は直ちに version 2 で書き戻す。
      if (truncated || parsed.migrated) write(terminalId, entries);
      return entries;
    },
    save: write,
  };
}
