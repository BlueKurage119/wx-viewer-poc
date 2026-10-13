import { useState } from 'react';
import {
  TRAINING_GROUP_LABELS,
  type TrainingInjectionListItem,
  type TrainingItem,
  type TrainingItemId,
} from '@wx-viewer-poc/shared';
import { CircularProgress, GbButton } from '../components/md';
import {
  TRAINING_STOCK_LIMIT,
  type TrainingInjectionStatus,
  type TrainingStockEntry,
} from './trainingStock';
import {
  TRAINING_INJECTED_LOAD_FAILED_MESSAGE,
  TRAINING_SAVE_FAILED_MESSAGE,
  type TrainingState,
} from './trainingController';
import type { TrainingActions } from './useTrainingScreen';
import { formatTrainingJstTime, orderTrainingRows } from './trainingFormat';
import { TrainingXmlDialog } from './TrainingXmlDialog';

interface CategoryGroup {
  readonly group: string;
  readonly items: readonly TrainingItem[];
}
interface CategoryRow {
  readonly key: string;
  readonly name: string;
  readonly groups: readonly CategoryGroup[];
}
interface Section {
  readonly title: string;
  readonly rows: readonly CategoryRow[];
}

/** 画面側の対応表: VPWW61系のgroupを「その他」1行へ寄せる（APIの項目・groupは変えない）。 */
const OTHER_ROW_GROUPS: ReadonlySet<string> = new Set([
  'thunder',
  'fog',
  'dry',
  'cold',
  'frost',
  'icing',
  'snow-accretion',
]);

function buildSections(items: readonly TrainingItem[]): Section[] {
  const sections: Section[] = [];
  for (const [title, prefix] of [
    ['警報・注意報', 'warning-'],
    ['気象防災速報', 'bulletin-'],
  ] as const) {
    const groups: { group: string; items: TrainingItem[] }[] = [];
    for (const item of items) {
      if (!item.id.startsWith(prefix)) continue;
      const existing = groups.find((entry) => entry.group === item.group);
      if (existing) existing.items.push(item);
      else groups.push({ group: item.group, items: [item] });
    }
    const rows: CategoryRow[] = [];
    const others = groups.filter(({ group }) => OTHER_ROW_GROUPS.has(group));
    for (const entry of groups) {
      if (OTHER_ROW_GROUPS.has(entry.group)) {
        if (entry === others[0]) rows.push({ key: 'other', name: 'その他', groups: others });
        continue;
      }
      rows.push({
        key: entry.group,
        name: TRAINING_GROUP_LABELS[entry.group] ?? entry.group,
        groups: [entry],
      });
    }
    if (rows.length > 0) sections.push({ title, rows });
  }
  return sections;
}

interface CategoryRowProps {
  readonly row: CategoryRow;
  readonly selected: readonly TrainingItemId[];
  readonly disabled: boolean;
  readonly onSelect: (group: string, itemId: TrainingItemId | null) => void;
}

function CategoryRowView({ row, selected, disabled, onSelect }: CategoryRowProps) {
  const labelId = `training-${row.key}-label`;
  return (
    <div className="training-category" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="training-category-name">
        {row.name}
      </span>
      <div className="training-choices">
        {row.groups.map(({ group, items }) => {
          const name = `training-${group}`;
          if (items.length === 1) {
            const item = items[0]!;
            return (
              <label key={group} className="training-option">
                <input
                  type="checkbox"
                  name={name}
                  checked={selected.includes(item.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    onSelect(group, event.currentTarget.checked ? item.id : null)
                  }
                />
                <span>{item.label}</span>
              </label>
            );
          }
          const noneSelected = !items.some((item) => selected.includes(item.id));
          return (
            <div key={group} className="training-choices-group">
              <label className="training-option">
                <input
                  type="radio"
                  name={name}
                  checked={noneSelected}
                  disabled={disabled}
                  onChange={() => onSelect(group, null)}
                />
                <span>なし</span>
              </label>
              {items.map((item) => (
                <label key={item.id} className="training-option">
                  <input
                    type="radio"
                    name={name}
                    checked={selected.includes(item.id)}
                    disabled={disabled}
                    onChange={() => onSelect(group, item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface TrainingContentProps {
  readonly state: TrainingState;
  readonly onSelect: TrainingActions['select'];
  readonly onGenerate: () => void;
  readonly onReset: () => void;
  readonly onReload: () => void;
  readonly onSetChecked: TrainingActions['setChecked'];
  readonly onSetCheckedInjected: TrainingActions['setCheckedInjected'];
  readonly onOpenEntry: (entry: TrainingStockEntry) => void;
}

const INJECTION_STATUS_LABELS: Readonly<Record<TrainingInjectionStatus, string>> = {
  pending: '未投入',
  failed: '投入失敗',
};

/**
 * 投入済みの行（サーバーの注入記録1回につき1行）。押しても何も開かない。
 * 抹消済みの行はステータスを「抹消済み」にする。チェック欄は両方にあり、抹消済みの行は
 * リスト消去・リスト全消で一覧から外せる（電文抹消の対象にはならない）。
 */
function InjectedRow({
  injection,
  checked,
  disabled,
  onSetChecked,
}: {
  readonly injection: TrainingInjectionListItem;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onSetChecked: TrainingActions['setCheckedInjected'];
}) {
  const retracted = injection.retractedAt !== null;
  const time = formatTrainingJstTime(injection.acceptedAt);
  const types = injection.telegrams.map((t) => t.telegramType).join('、');
  return (
    <li className="training-row" data-training-id={injection.trainingId}>
      <input
        type="checkbox"
        className="training-row-check"
        aria-label={`${time} ${types} を選択`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onSetChecked(injection.trainingId, event.currentTarget.checked)}
      />
      <div className="training-row-open training-row-static">
        <span className="training-row-time">{time}</span>
        <span className="training-row-items">
          {injection.telegrams.map((t) => t.title ?? t.telegramType).join('、')}
        </span>
        <span className="training-row-type">{types}</span>
        <span className="training-row-status" data-status={retracted ? 'retracted' : 'injected'}>
          {retracted ? '抹消済み' : '投入済み'}
        </span>
      </div>
    </li>
  );
}

function StockRow({
  entry,
  checked,
  disabled = false,
  onSetChecked,
  onOpen,
}: {
  readonly entry: TrainingStockEntry;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onSetChecked: TrainingActions['setChecked'];
  readonly onOpen: (entry: TrainingStockEntry) => void;
}) {
  const time = formatTrainingJstTime(entry.generatedAt);
  return (
    <li className="training-row" data-entry-id={entry.id}>
      <input
        type="checkbox"
        className="training-row-check"
        aria-label={`${time} ${entry.telegram.telegramType} を選択`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onSetChecked(entry.id, event.currentTarget.checked)}
      />
      <button type="button" className="training-row-open" onClick={() => onOpen(entry)}>
        <span className="training-row-time">{time}</span>
        <span className="training-row-items">{entry.itemLabels.join('、')}</span>
        <span className="training-row-type">{entry.telegram.telegramType}</span>
        <span className="training-row-status" data-status={entry.injectionStatus}>
          {INJECTION_STATUS_LABELS[entry.injectionStatus]}
        </span>
      </button>
    </li>
  );
}

/** 状態から描画するだけの表示部。通信・状態遷移はコントローラが担う。 */
export function TrainingContent({
  state,
  onSelect,
  onGenerate,
  onReset,
  onReload,
  onSetChecked,
  onSetCheckedInjected,
  onOpenEntry,
}: TrainingContentProps) {
  const sending = state.generation.phase === 'sending';
  const ready = state.load === 'ready';
  const canGenerate = ready && !sending && state.selected.length > 0;
  const canReset = ready && !sending && state.selected.length > 0;
  const sections = buildSections(state.items);
  const rows = orderTrainingRows(state.history, state.injected);
  const busy = state.injecting || state.retracting || state.hiding;
  return (
    <div className="training-view">
      <section className="training-left" aria-label="電文の作成">
        <div className="training-items">
          {state.load === 'loading' ? (
            <div className="training-status" role="status">
              <CircularProgress indeterminate aria-hidden="true" />
            </div>
          ) : null}
          {state.load === 'failed' ? (
            <div className="training-status">
              <p role="alert">項目を取得できませんでした。</p>
              <GbButton color="tonal" size="sm" type="button" onClick={onReload}>
                再読込
              </GbButton>
            </div>
          ) : null}
          {sections.map((section) => (
            <section key={section.title} className="training-section">
              <h2>{section.title}</h2>
              <div className="training-groups">
                {section.rows.map((row) => (
                  <CategoryRowView
                    key={row.key}
                    row={row}
                    selected={state.selected}
                    disabled={sending}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="training-actions">
          <GbButton
            color="filled"
            size="sm"
            type="button"
            softDisabled={!canGenerate}
            aria-disabled={!canGenerate}
            onClick={() => {
              if (canGenerate) onGenerate();
            }}
          >
            生成
          </GbButton>
          <GbButton
            color="text"
            size="sm"
            type="button"
            softDisabled={!canReset}
            aria-disabled={!canReset}
            onClick={() => {
              if (canReset) onReset();
            }}
          >
            リセット
          </GbButton>
        </div>
      </section>
      <section className="training-right" aria-label="生成した電文">
        <div className="training-statusbar">
          <span className="training-count">
            {state.history.length}／{TRAINING_STOCK_LIMIT}件
          </span>
          {sending ? (
            <span className="training-progress" role="status">
              <CircularProgress indeterminate aria-hidden="true" />
              生成中
            </span>
          ) : state.generation.phase === 'failed' ? (
            <span className="training-error" role="alert">
              {state.generation.message}
            </span>
          ) : state.saveFailed ? (
            <span className="training-error" role="alert">
              {TRAINING_SAVE_FAILED_MESSAGE}
            </span>
          ) : state.injectedLoadFailed ? (
            <span className="training-error" role="alert">
              {TRAINING_INJECTED_LOAD_FAILED_MESSAGE}
            </span>
          ) : null}
        </div>
        <ul className="training-list" aria-label="生成した電文の一覧">
          {rows.local.map((entry) => (
            <StockRow
              key={entry.id}
              entry={entry}
              checked={state.checked.includes(entry.id)}
              disabled={busy}
              onSetChecked={onSetChecked}
              onOpen={onOpenEntry}
            />
          ))}
          {rows.injected.map((injection) => (
            <InjectedRow
              key={injection.trainingId}
              injection={injection}
              checked={state.checkedInjected.includes(injection.trainingId)}
              disabled={busy}
              onSetChecked={onSetCheckedInjected}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

export function TrainingView({
  state,
  actions,
}: {
  readonly state: TrainingState;
  readonly actions: TrainingActions;
}) {
  const [openEntry, setOpenEntry] = useState<TrainingStockEntry | null>(null);
  return (
    <>
      <TrainingContent
        state={state}
        onSelect={actions.select}
        onGenerate={actions.generate}
        onReset={actions.reset}
        onReload={actions.reload}
        onSetChecked={actions.setChecked}
        onSetCheckedInjected={actions.setCheckedInjected}
        onOpenEntry={(entry) => {
          actions.onDialogOpen();
          setOpenEntry(entry);
        }}
      />
      <TrainingXmlDialog entry={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}
