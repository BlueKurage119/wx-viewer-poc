import type { NotificationCategory, NotificationFeedItem } from '@wx-viewer-poc/shared';
import { GbButton } from '../components/md';
import {
  applyWarningListSearch,
  createWarningListSearchState,
  type WarningListSearchState,
} from './warningListFilterModel';
import { warningSourceTypeLabel } from './warningListModel';

export interface WarningListFiltersProps {
  readonly items: readonly NotificationFeedItem[];
  readonly search: WarningListSearchState;
  readonly onSearchChange: (search: WarningListSearchState) => void;
}

export function WarningListFilters({ items, search, onSearchChange }: WarningListFiltersProps) {
  const sourceTypes = new Set(items.map((item) => item.sourceType));
  if (search.draft.sourceType !== 'all') sourceTypes.add(search.draft.sourceType);
  if (search.applied.sourceType !== 'all') sourceTypes.add(search.applied.sourceType);
  const updateDraft = (change: Partial<WarningListSearchState['draft']>) =>
    onSearchChange({ ...search, draft: { ...search.draft, ...change } });
  const submit = () => onSearchChange(applyWarningListSearch(search));
  return (
    <form
      className="warning-list-filters"
      aria-label="警報一覧の検索条件"
      noValidate
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || (event.target as HTMLElement).tagName !== 'INPUT') return;
        event.preventDefault();
        submit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label>
        開始日時
        <input
          type="datetime-local"
          step="1"
          value={search.draft.fromLocal}
          aria-describedby={search.error ? 'warning-list-filter-error' : undefined}
          onChange={(event) => updateDraft({ fromLocal: event.target.value })}
        />
      </label>
      <label>
        終了日時
        <input
          type="datetime-local"
          step="1"
          value={search.draft.toLocal}
          aria-describedby={search.error ? 'warning-list-filter-error' : undefined}
          onChange={(event) => updateDraft({ toLocal: event.target.value })}
        />
      </label>
      <label>
        通知区分
        <select
          value={search.draft.category}
          onChange={(event) =>
            updateDraft({ category: event.target.value as NotificationCategory | 'all' })
          }
        >
          <option value="all">すべて</option>
          <option value="warning">警報</option>
          <option value="question">問いかけ</option>
          <option value="emergency">非常</option>
        </select>
      </label>
      <label>
        情報種別
        <select
          value={search.draft.sourceType}
          onChange={(event) => updateDraft({ sourceType: event.target.value })}
        >
          <option value="all">すべて</option>
          {[...sourceTypes].sort().map((sourceType) => (
            <option key={sourceType} value={sourceType}>
              {warningSourceTypeLabel(sourceType)}
            </option>
          ))}
        </select>
      </label>
      <div className="warning-list-filter-actions">
        <GbButton color="filled" size="sm" type="button" onClick={submit}>
          検索
        </GbButton>
        <GbButton
          color="outlined"
          size="sm"
          type="button"
          onClick={() => onSearchChange(createWarningListSearchState())}
        >
          条件クリア
        </GbButton>
      </div>
      {search.error && (
        <p id="warning-list-filter-error" className="warning-list-filter-error" role="alert">
          {search.error}
        </p>
      )}
    </form>
  );
}
