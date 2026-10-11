import {
  listWarningMessagePreferenceOptions,
  type NotificationFeedItem,
} from '@wx-viewer-poc/shared';

export interface NotificationPreferences {
  readonly schemaVersion: 1;
  readonly autoConfirmMessageDefinitionIds: readonly string[];
}
export interface NotificationPreferencesRepository {
  load(): NotificationPreferences;
  save(value: NotificationPreferences): { readonly saved: boolean };
}
export interface WarningPresentationPolicy {
  readonly autoConfirmAfterMs: 5000 | null;
  readonly tone: 'level2' | 'level3';
}
export const EMPTY_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  schemaVersion: 1,
  autoConfirmMessageDefinitionIds: [],
};
export const NOTIFICATION_PREFERENCES_KEY = 'wx-viewer:notification-preferences:v1';
const knownIds = new Set<string>(listWarningMessagePreferenceOptions().map(({ id }) => id));

export function validateNotificationPreferences(value: unknown): NotificationPreferences {
  if (typeof value !== 'object' || value === null) return EMPTY_NOTIFICATION_PREFERENCES;
  const candidate = value as Partial<NotificationPreferences>;
  if (
    candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.autoConfirmMessageDefinitionIds) ||
    !candidate.autoConfirmMessageDefinitionIds.every((id) => typeof id === 'string')
  ) {
    return EMPTY_NOTIFICATION_PREFERENCES;
  }
  return {
    schemaVersion: 1,
    autoConfirmMessageDefinitionIds: [
      ...new Set(candidate.autoConfirmMessageDefinitionIds.filter((id) => knownIds.has(id))),
    ],
  };
}

export function createNotificationPreferencesRepository(
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => window.localStorage,
): NotificationPreferencesRepository {
  return {
    load() {
      try {
        const saved = storage().getItem(NOTIFICATION_PREFERENCES_KEY);
        return saved === null
          ? EMPTY_NOTIFICATION_PREFERENCES
          : validateNotificationPreferences(JSON.parse(saved));
      } catch {
        return EMPTY_NOTIFICATION_PREFERENCES;
      }
    },
    save(value) {
      try {
        storage().setItem(
          NOTIFICATION_PREFERENCES_KEY,
          JSON.stringify(validateNotificationPreferences(value)),
        );
        return { saved: true };
      } catch {
        return { saved: false };
      }
    },
  };
}

export function resolveWarningPresentationPolicy(
  item: NotificationFeedItem,
  preferences: NotificationPreferences,
): WarningPresentationPolicy | null {
  if (item.category !== 'warning') return null;
  const id = item.messageDefinition?.id;
  const automatic =
    id !== undefined &&
    knownIds.has(id) &&
    preferences.autoConfirmMessageDefinitionIds.includes(id);
  return automatic
    ? { autoConfirmAfterMs: 5000, tone: 'level2' }
    : { autoConfirmAfterMs: null, tone: 'level3' };
}
