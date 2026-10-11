import { useEffect, useRef, useState } from 'react';
import {
  TRAINING_GROUP_LABELS,
  type TrainingItem,
  type TrainingItemId,
} from '@wx-viewer-poc/shared';
import { CircularProgress, GbButton } from '../components/md';
import {
  INITIAL_TRAINING_STATE,
  TRAINING_HISTORY_LIMIT,
  createTrainingController,
  type TrainingController,
  type TrainingHistoryEntry,
  type TrainingState,
} from './trainingController';
import { formatTrainingJstTime } from './trainingFormat';
import { TrainingXmlDialog } from './TrainingXmlDialog';

interface Section {
  readonly title: string;
  readonly groups: readonly { readonly group: string; readonly items: readonly TrainingItem[] }[];
}

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
    if (groups.length > 0) sections.push({ title, groups });
  }
  return sections;
}

interface GroupFieldsetProps {
  readonly group: string;
  readonly items: readonly TrainingItem[];
  readonly selected: readonly TrainingItemId[];
  readonly disabled: boolean;
  readonly onSelect: (group: string, itemId: TrainingItemId | null) => void;
}

function GroupRow({ group, items, selected, disabled, onSelect }: GroupFieldsetProps) {
  const legend = TRAINING_GROUP_LABELS[group] ?? group;
  const noneSelected = !items.some((item) => selected.includes(item.id));
  const name = `training-${group}`;
  const labelId = `${name}-label`;
  return (
    <div className="training-category" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="training-category-name">
        {legend}
      </span>
      <div className="training-choices">
        {items.length === 1 ? (
          <label className="training-option">
            <input
              type="checkbox"
              name={name}
              checked={selected.includes(items[0]!.id)}
              disabled={disabled}
              onChange={(event) =>
                onSelect(group, event.currentTarget.checked ? items[0]!.id : null)
              }
            />
            <span>{items[0]!.label}</span>
          </label>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

export interface TrainingContentProps {
  readonly state: TrainingState;
  readonly onSelect: (group: string, itemId: TrainingItemId | null) => void;
  readonly onGenerate: () => void;
  readonly onReset: () => void;
  readonly onReload: () => void;
  readonly onOpenEntry: (entry: TrainingHistoryEntry) => void;
}

function HistoryRow({
  entry,
  selected,
  onOpen,
}: {
  readonly entry: TrainingHistoryEntry;
  readonly selected: boolean;
  readonly onOpen: (entry: TrainingHistoryEntry) => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className="training-row"
      data-entry-id={entry.id}
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen(entry);
      }}
    >
      <span className="training-row-time">{formatTrainingJstTime(entry.generatedAt)}</span>
      <span className="training-row-items">{entry.itemLabels.join('、')}</span>
      <span className="training-row-type">{entry.telegram.telegramType}</span>
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
  onOpenEntry,
}: TrainingContentProps) {
  const sending = state.generation.phase === 'sending';
  const ready = state.load === 'ready';
  const canGenerate = ready && !sending && state.selected.length > 0;
  const canReset = ready && !sending && state.selected.length > 0;
  const sections = buildSections(state.items);
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
                {section.groups.map(({ group, items }) => (
                  <GroupRow
                    key={group}
                    group={group}
                    items={items}
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
            {state.history.length}／{TRAINING_HISTORY_LIMIT}件
          </span>
          {sending ? (
            <span className="training-progress" role="status">
              <CircularProgress indeterminate aria-hidden="true" />
              生成中
            </span>
          ) : null}
          {state.generation.phase === 'failed' ? (
            <span className="training-error" role="alert">
              {state.generation.message}
            </span>
          ) : null}
        </div>
        <ul className="training-list" role="listbox" aria-label="生成した電文の一覧">
          {state.history.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              selected={entry.id === state.selectedEntryId}
              onOpen={onOpenEntry}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

export function TrainingView({ terminalId }: { readonly terminalId: string }) {
  const [state, setState] = useState<TrainingState>(INITIAL_TRAINING_STATE);
  const [openEntry, setOpenEntry] = useState<TrainingHistoryEntry | null>(null);
  const controllerRef = useRef<TrainingController | null>(null);
  useEffect(() => {
    const controller = createTrainingController(terminalId, setState);
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [terminalId]);
  return (
    <>
      <TrainingContent
        state={state}
        onSelect={(group, itemId) => controllerRef.current?.selectInGroup(group, itemId)}
        onGenerate={() => controllerRef.current?.generate()}
        onReset={() => controllerRef.current?.reset()}
        onReload={() => controllerRef.current?.start()}
        onOpenEntry={(entry) => {
          controllerRef.current?.selectEntry(entry.id);
          setOpenEntry(entry);
        }}
      />
      <TrainingXmlDialog entry={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}
