export const ALERTED_FEED_KEYS_STORAGE_KEY = 'wx-viewer:notification-alerted:v1';
export const ALERTED_FEED_KEYS_LIMIT = 1000;
export const ALERTED_FEED_KEYS_DURATION_MS = 24 * 60 * 60 * 1000;

export interface StoredAlert {
  readonly feedKey: string;
  readonly alertedAtMs: number;
}

export interface StoredAlerts {
  readonly serverGenerationId: string;
  readonly entries: readonly StoredAlert[];
}

function isSavableSystemFeedKey(feedKey: unknown): feedKey is string {
  if (typeof feedKey !== 'string') return false;
  if (!feedKey.startsWith('delta:')) return false;
  if (feedKey === 'delta:weather' || feedKey.startsWith('delta:weather:')) return false;
  return true;
}

export function createAlertedFeedKeyRepository(
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => window.localStorage,
): {
  /** 世代一致なら期限内のキーを返す。不一致なら保存を削除して []。失敗時は []。 */
  load(serverGenerationId: string, nowMs: number): readonly string[];
  /** delta: キーのみ、期限内・新しい順に上限まで保存。失敗は握りつぶす。 */
  save(value: StoredAlerts, nowMs: number): void;
  clear(): void;
} {
  return {
    load(serverGenerationId: string, nowMs: number): readonly string[] {
      try {
        const raw = storage().getItem(ALERTED_FEED_KEYS_STORAGE_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          typeof parsed.serverGenerationId !== 'string' ||
          !Array.isArray(parsed.entries)
        ) {
          return [];
        }
        if (parsed.serverGenerationId !== serverGenerationId) {
          try {
            storage().removeItem(ALERTED_FEED_KEYS_STORAGE_KEY);
          } catch {
            // 失敗は握りつぶす
          }
          return [];
        }
        const validFeedKeys: string[] = [];
        for (const item of parsed.entries) {
          if (
            typeof item === 'object' &&
            item !== null &&
            isSavableSystemFeedKey(item.feedKey) &&
            typeof item.alertedAtMs === 'number' &&
            nowMs - item.alertedAtMs <= ALERTED_FEED_KEYS_DURATION_MS
          ) {
            validFeedKeys.push(item.feedKey);
          }
        }
        return validFeedKeys;
      } catch {
        return [];
      }
    },

    save(value: StoredAlerts, nowMs: number): void {
      try {
        if (
          typeof value !== 'object' ||
          value === null ||
          typeof value.serverGenerationId !== 'string'
        ) {
          return;
        }
        if (!Array.isArray(value.entries)) return;

        const entriesMap = new Map<string, number>();
        for (const entry of value.entries) {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            isSavableSystemFeedKey(entry.feedKey) &&
            typeof entry.alertedAtMs === 'number' &&
            nowMs - entry.alertedAtMs <= ALERTED_FEED_KEYS_DURATION_MS
          ) {
            const prev = entriesMap.get(entry.feedKey);
            if (prev === undefined || entry.alertedAtMs > prev) {
              entriesMap.set(entry.feedKey, entry.alertedAtMs);
            }
          }
        }

        const entries: StoredAlert[] = Array.from(entriesMap.entries())
          .map(([feedKey, alertedAtMs]) => ({ feedKey, alertedAtMs }))
          .sort((a, b) => b.alertedAtMs - a.alertedAtMs)
          .slice(0, ALERTED_FEED_KEYS_LIMIT);

        storage().setItem(
          ALERTED_FEED_KEYS_STORAGE_KEY,
          JSON.stringify({
            serverGenerationId: value.serverGenerationId,
            entries,
          }),
        );
      } catch {
        // 失敗は握りつぶす
      }
    },

    clear(): void {
      try {
        storage().removeItem(ALERTED_FEED_KEYS_STORAGE_KEY);
      } catch {
        // 失敗は握りつぶす
      }
    },
  };
}
