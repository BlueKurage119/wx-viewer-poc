import type { TerminalMode } from '@wx-viewer-poc/shared';
import type { NotificationPhase } from '../notifications/notificationStore';
import { WarningListFilters } from './WarningListFilters';
import { filterWarningListItems, type WarningListSearchState } from './warningListFilterModel';
import {
  formatWarningOccurredAt,
  selectWarningHistory,
  warningSourceTypeLabel,
  type WarningHistoryEntry,
} from './warningListModel';

interface WarningListViewProps {
  readonly entries: readonly WarningHistoryEntry[];
  readonly mode: TerminalMode;
  readonly nowMs: number;
  readonly phase: NotificationPhase;
  readonly search: WarningListSearchState;
  readonly onSearchChange: (search: WarningListSearchState) => void;
}

const categoryLabels = { warning: '警報', question: '問いかけ', emergency: '非常' } as const;

export function WarningListView({
  entries,
  mode,
  nowMs,
  phase,
  search,
  onSearchChange,
}: WarningListViewProps) {
  const visibleItems = selectWarningHistory(entries, mode, nowMs);
  const items = filterWarningListItems(visibleItems, search.applied);
  return (
    <section className="warning-list" aria-label="警報一覧">
      <WarningListFilters items={visibleItems} search={search} onSearchChange={onSearchChange} />
      <div className="warning-list-scroll" tabIndex={0} aria-label="通知履歴">
        <table className="warning-list-table">
          <thead>
            <tr>
              {['発生日時', '通知区分', '対象サービス', '情報種別', '内容'].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.feedKey} data-feed-key={item.feedKey}>
                <td>
                  <time dateTime={item.occurredAt}>{formatWarningOccurredAt(item.occurredAt)}</time>
                </td>
                <td>{categoryLabels[item.category]}</td>
                <td>防災気象情報</td>
                <td>{warningSourceTypeLabel(item.sourceType)}</td>
                <td className="warning-list-content">
                  {(item.source === 'startup' || item.isTraining) && (
                    <span className="warning-list-flags">
                      {item.source === 'startup' && <span>起動時</span>}
                      {item.isTraining && <span>訓練</span>}
                    </span>
                  )}
                  <span className="warning-list-summary">
                    {item.summary.replace(/\r\n|[\r\n\u2028\u2029]/g, '　')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="warning-list-empty" role="status">
            {phase === 'starting'
              ? '通知を読み込んでいます'
              : visibleItems.length === 0
                ? '通知はありません'
                : '条件に一致する通知はありません'}
          </p>
        )}
      </div>
    </section>
  );
}
