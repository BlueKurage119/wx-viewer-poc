import { useEffect, useRef, useState } from 'react';
import {
  TRAINING_GROUP_LABELS,
  type TrainingItem,
  type TrainingItemId,
  type TrainingTelegramPreview,
} from '@wx-viewer-poc/shared';
import { CircularProgress, GbButton } from '../components/md';
import {
  INITIAL_TRAINING_STATE,
  createTrainingController,
  type TrainingController,
  type TrainingState,
} from './trainingController';
import { formatTrainingJst } from './trainingFormat';

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

function GroupFieldset({ group, items, selected, disabled, onSelect }: GroupFieldsetProps) {
  const legend = TRAINING_GROUP_LABELS[group] ?? group;
  const single = items.length === 1;
  const noneSelected = !items.some((item) => selected.includes(item.id));
  return (
    <fieldset className="training-group" disabled={disabled}>
      <legend>{legend}</legend>
      {single ? (
        <TrainingOption
          item={items[0]!}
          type="checkbox"
          name={`training-${group}`}
          checked={selected.includes(items[0]!.id)}
          onChange={(checked) => onSelect(group, checked ? items[0]!.id : null)}
        />
      ) : (
        <>
          <label className="training-option">
            <input
              type="radio"
              name={`training-${group}`}
              checked={noneSelected}
              onChange={() => onSelect(group, null)}
            />
            <span>選択なし</span>
          </label>
          {items.map((item) => (
            <TrainingOption
              key={item.id}
              item={item}
              type="radio"
              name={`training-${group}`}
              checked={selected.includes(item.id)}
              onChange={() => onSelect(group, item.id)}
            />
          ))}
        </>
      )}
    </fieldset>
  );
}

function TrainingOption({
  item,
  type,
  name,
  checked,
  onChange,
}: {
  readonly item: TrainingItem;
  readonly type: 'radio' | 'checkbox';
  readonly name: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="training-option" data-unavailable={item.selectable ? undefined : ''}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={!item.selectable}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{item.label}</span>
      {item.unavailableReason ? (
        <span className="training-reason">{item.unavailableReason}</span>
      ) : null}
    </label>
  );
}

function TelegramCard({
  telegram,
  items,
}: {
  readonly telegram: TrainingTelegramPreview;
  readonly items: readonly TrainingItem[];
}) {
  const labels = telegram.itemIds.map((id) => items.find((item) => item.id === id)?.label ?? id);
  return (
    <article className="training-telegram">
      <header>
        <h3>{telegram.title}</h3>
        <span className="training-badge">訓練用合成</span>
      </header>
      <dl>
        <div>
          <dt>項目</dt>
          <dd>{labels.join('、')}</dd>
        </div>
        <div>
          <dt>区域</dt>
          <dd>{telegram.areaNames.join('／')}</dd>
        </div>
        <div>
          <dt>発表</dt>
          <dd>{formatTrainingJst(telegram.reportDateTime)}</dd>
        </div>
        {telegram.validDateTime ? (
          <div>
            <dt>失効</dt>
            <dd>{formatTrainingJst(telegram.validDateTime)}</dd>
          </div>
        ) : null}
      </dl>
      <details>
        <summary>XML</summary>
        <pre>{telegram.xml}</pre>
      </details>
    </article>
  );
}

export interface TrainingContentProps {
  readonly state: TrainingState;
  readonly onSelect: (group: string, itemId: TrainingItemId | null) => void;
  readonly onGenerate: () => void;
  readonly onReload: () => void;
}

/** 状態から描画するだけの表示部。通信・状態遷移はコントローラが担う。 */
export function TrainingContent({ state, onSelect, onGenerate, onReload }: TrainingContentProps) {
  if (state.load === 'loading') {
    return (
      <div className="training-view training-status" role="status">
        <CircularProgress indeterminate aria-hidden="true" />
      </div>
    );
  }
  if (state.load === 'failed') {
    return (
      <div className="training-view training-status">
        <p role="alert">項目を取得できませんでした。</p>
        <GbButton color="tonal" size="sm" type="button" onClick={onReload}>
          再読込
        </GbButton>
      </div>
    );
  }
  const sending = state.generation.phase === 'sending';
  const sections = buildSections(state.items);
  return (
    <div className="training-view">
      <div className="training-target">{state.targetLabel}</div>
      {sections.map((section) => (
        <section key={section.title} className="training-section">
          <h2>{section.title}</h2>
          <div className="training-groups">
            {section.groups.map(({ group, items }) => (
              <GroupFieldset
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
      <div className="training-actions">
        <GbButton
          color="filled"
          size="sm"
          type="button"
          disabled={state.selected.length === 0 || sending}
          onClick={onGenerate}
        >
          {state.generation.phase === 'failed' ? '再実行' : '生成'}
        </GbButton>
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
      {state.generation.phase === 'done' ? (
        <section className="training-results">
          {state.generation.result.telegrams.map((telegram) => (
            <TelegramCard key={telegram.id} telegram={telegram} items={state.items} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function TrainingView({ terminalId }: { readonly terminalId: string }) {
  const [state, setState] = useState<TrainingState>(INITIAL_TRAINING_STATE);
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
    <TrainingContent
      state={state}
      onSelect={(group, itemId) => controllerRef.current?.selectInGroup(group, itemId)}
      onGenerate={() => controllerRef.current?.generate()}
      onReload={() => controllerRef.current?.start()}
    />
  );
}
