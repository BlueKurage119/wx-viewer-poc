import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NotificationFeedItem } from '@wx-viewer-poc/shared';
import { TrainingBadge } from '../src/components/TrainingBadge.tsx';
import { NotificationArea } from '../src/shell/NotificationArea.tsx';
import { WarningListView } from '../src/warnings/WarningListView.tsx';
import { mergeWarningHistory } from '../src/warnings/warningListModel.ts';
import { createWarningListSearchState } from '../src/warnings/warningListFilterModel.ts';
import { DetailDialogInner } from '../src/map/detail/DetailDialog.tsx';
import type { DetailDialogMeta } from '../src/map/detail/detailDialogMeta.ts';
import { InfoPanelFrame } from '../src/map/panels/InfoPanelFrame.tsx';
import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn.tsx';
import type {
  InfoPanelColumnInput,
  InfoPanelDefinition,
} from '../src/map/panels/panelDefinitions.ts';
import {
  buildTrainingBadgesFixture,
  PANEL_FIXTURE_NAMES,
} from '../src/map/panels/panelFixtures.ts';
import { eastVenue } from './venueConfigPreload.ts';
import {
  createNotificationUiState,
  receiveNotifications,
  notificationChimeLevel,
  selectNewArrivalChime,
} from '../src/notifications/notificationStore.ts';

const el = React.createElement;

function makeNotice(
  key: string,
  overrides: Partial<NotificationFeedItem> = {},
): NotificationFeedItem {
  return {
    feedKey: key,
    source: 'delta',
    sequence: 1,
    category: 'warning',
    origin: 'weather',
    detectionContext: 'normal',
    changeType: 'new',
    sourceType: 'warning_current',
    sourceVersion: null,
    targets: [{ kind: 'area', codeType: 'test', code: '1', name: '対象A' }],
    occurredAt: '2026-10-12T00:00:00.000Z',
    detectedAt: '2026-10-12T00:00:00.000Z',
    relatedRefs: [],
    isTraining: false,
    ackRequired: true,
    summary: 'テスト通知内容',
    display: null,
    messageDefinition: null,
    venueScope: null,
    ...overrides,
  };
}

// ----------------------------------------------------
// 1. TrainingBadge 単体
// ----------------------------------------------------
test('TrainingBadge: 「訓練」を training-badge クラスで描画する', () => {
  const html = renderToStaticMarkup(el(TrainingBadge));
  assert.equal(html, '<span class="training-badge">訓練</span>');
});

test('TrainingBadge: className が追加される', () => {
  const html = renderToStaticMarkup(el(TrainingBadge, { className: 'custom-class' }));
  assert.equal(html, '<span class="training-badge custom-class">訓練</span>');
});

// ----------------------------------------------------
// 2. NotificationArea: 下部通知領域での表示/非表示
// ----------------------------------------------------
test('NotificationArea: notice.isTraining === true のときバッジが .notice-text の直前に描画される', () => {
  const trainingNotice = makeNotice('delta:training-1', {
    isTraining: true,
    summary: '【訓練】大雨警報が発表されました',
  });
  const normalNotice = makeNotice('delta:normal-1', {
    isTraining: false,
    summary: '洪水注意報が発表されました',
  });

  const { state } = receiveNotifications(
    createNotificationUiState(),
    [trainingNotice, normalNotice],
    'K',
    Date.now(),
  );

  const html = renderToStaticMarkup(
    el(NotificationArea, {
      state,
      mode: 'K',
      onConfirm: () => {},
      onSelectQuestion: () => {},
      onSendQuestion: () => {},
      onOpenDetail: () => {},
      onOpenPreferences: () => {},
    }),
  );

  // trainingNotice の行には <span class="training-badge">訓練</span> がある
  assert.ok(html.includes('<span class="training-badge">訓練</span>'));
  // バッジの位置が notice-text の前にあること
  const badgeIndex = html.indexOf('<span class="training-badge">訓練</span>');
  const trainingTextIndex = html.indexOf('【訓練】大雨警報が発表されました');
  assert.ok(badgeIndex < trainingTextIndex, 'バッジは通知文言の直前に配置される');
});

test('NotificationArea: 通常通知のみのときはバッジが描画されない', () => {
  const normalNotice = makeNotice('delta:normal-1', {
    isTraining: false,
    summary: '通常警報発表',
  });

  const { state } = receiveNotifications(
    createNotificationUiState(),
    [normalNotice],
    'K',
    Date.now(),
  );

  const html = renderToStaticMarkup(
    el(NotificationArea, {
      state,
      mode: 'K',
      onConfirm: () => {},
      onSelectQuestion: () => {},
      onSendQuestion: () => {},
      onOpenDetail: () => {},
      onOpenPreferences: () => {},
    }),
  );

  assert.equal(html.includes('training-badge'), false, '通常通知にはバッジが出ない');
});

// ----------------------------------------------------
// 3. WarningListView: 警報一覧での表示/非表示
// ----------------------------------------------------
test('WarningListView: isTraining: true の行に TrainingBadge が描画され、通常行には出ない', () => {
  const trainingItem = makeNotice('delta:training-1', {
    isTraining: true,
    summary: '訓練警報',
  });
  const normalItem = makeNotice('delta:normal-1', {
    isTraining: false,
    summary: '通常警報',
  });

  const nowMs = Date.now();
  const entries = mergeWarningHistory([], [trainingItem, normalItem], nowMs);

  const html = renderToStaticMarkup(
    el(WarningListView, {
      entries,
      mode: 'K',
      nowMs,
      phase: 'ready',
      search: createWarningListSearchState(),
      onSearchChange: () => {},
    }),
  );

  const trainingRowIndex = html.indexOf('data-feed-key="delta:training-1"');
  const normalRowIndex = html.indexOf('data-feed-key="delta:normal-1"');
  assert.ok(trainingRowIndex >= 0 && normalRowIndex >= 0);

  const trainingRow = html.slice(trainingRowIndex, normalRowIndex);
  const normalRow = html.slice(normalRowIndex);

  assert.ok(
    trainingRow.includes('<span class="training-badge">訓練</span>'),
    '訓練行にはバッジがある',
  );
  assert.equal(normalRow.includes('training-badge'), false, '通常行にはバッジが出ない');
});

// ----------------------------------------------------
// 4. DetailDialog: 詳細ダイアログでの表示
// ----------------------------------------------------
test('DetailDialogInner: isTraining: true で TrainingBadge が描画される', () => {
  const meta: DetailDialogMeta = {
    title: '警報詳細',
    target: '江東区',
    time: { kind: 'issued', value: '2026-10-12T00:00:00.000Z' },
    isTraining: true,
  };

  const html = renderToStaticMarkup(
    el(DetailDialogInner, {
      open: true,
      meta,
      onClose: () => {},
    }),
  );

  assert.ok(html.includes('<span class="training-badge">訓練</span>'));
  assert.equal(html.includes('detail-dialog-training-label'), false, '旧クラスは使われない');
});

test('DetailDialogInner: isTraining: false では TrainingBadge が描画されない', () => {
  const meta: DetailDialogMeta = {
    title: '警報詳細',
    target: '江東区',
    time: { kind: 'issued', value: '2026-10-12T00:00:00.000Z' },
    isTraining: false,
  };

  const html = renderToStaticMarkup(
    el(DetailDialogInner, {
      open: true,
      meta,
      onClose: () => {},
    }),
  );

  assert.equal(html.includes('training-badge'), false);
});

// ----------------------------------------------------
// 5. InfoPanelFrame / InfoPanelColumn: パネル見出しでの表示/非表示
// ----------------------------------------------------
const DEFINITION: InfoPanelDefinition = {
  id: 'warning',
  title: '警報・注意報',
  presence: 'occasional',
};

test('InfoPanelFrame: contentモードかつ isTraining: true で見出しにバッジが出る', () => {
  const html = renderToStaticMarkup(
    el(InfoPanelFrame, {
      definition: DEFINITION,
      status: {
        kind: 'data',
        availability: 'available',
        time: '2026-10-12T00:00:00.000Z',
        timeKind: 'issued',
      },
      isTraining: true,
    }),
  );

  assert.ok(
    html.includes(
      '<span class="info-panel-card-title">警報・注意報<span class="training-badge">訓練</span></span>',
    ),
  );
});

test('InfoPanelFrame: isTraining: false または未指定ではバッジが出ない', () => {
  const htmlFalse = renderToStaticMarkup(
    el(InfoPanelFrame, {
      definition: DEFINITION,
      status: {
        kind: 'data',
        availability: 'available',
        time: '2026-10-12T00:00:00.000Z',
        timeKind: 'issued',
      },
      isTraining: false,
    }),
  );
  assert.equal(htmlFalse.includes('training-badge'), false);

  const htmlUndefined = renderToStaticMarkup(
    el(InfoPanelFrame, {
      definition: DEFINITION,
      status: {
        kind: 'data',
        availability: 'available',
        time: '2026-10-12T00:00:00.000Z',
        timeKind: 'issued',
      },
    }),
  );
  assert.equal(htmlUndefined.includes('training-badge'), false);
});

test('InfoPanelFrame: loading/failed/empty モードでは isTraining: true でもバッジが出ない', () => {
  const htmlFailed = renderToStaticMarkup(
    el(InfoPanelFrame, {
      definition: { ...DEFINITION, presence: 'always' },
      status: { kind: 'failed' },
      isTraining: true,
    }),
  );
  assert.equal(htmlFailed.includes('training-badge'), false);

  const htmlSkeleton = renderToStaticMarkup(
    el(InfoPanelFrame, {
      definition: { ...DEFINITION, presence: 'always' },
      status: { kind: 'loading' },
      isTraining: true,
    }),
  );
  assert.equal(htmlSkeleton.includes('training-badge'), false);
});

test('InfoPanelColumn: card.isTraining が InfoPanelFrame に伝播する', () => {
  const input: InfoPanelColumnInput = {
    bosaiBulletin: [],
    warning: [
      {
        key: 'w-training',
        heading: '気象警報・注意報',
        status: {
          kind: 'data',
          availability: 'available',
          time: '2026-10-12T00:00:00.000Z',
          timeKind: 'issued',
        },
        content: 'content',
        isTraining: true,
      },
    ],
    warningTimeSeries: [
      {
        key: 'wt-normal',
        status: {
          kind: 'data',
          availability: 'available',
          time: '2026-10-12T00:00:00.000Z',
          timeKind: 'issued',
        },
        content: 'content',
        isTraining: false,
      },
    ],
    earlyWarning: [{ key: 'e', status: { kind: 'loading' } }],
    amedas: [{ key: 'a', status: { kind: 'loading' } }],
    areaForecast: [{ key: 'f', status: { kind: 'loading' } }],
  };

  const html = renderToStaticMarkup(el(InfoPanelColumn, { venue: eastVenue, input }));

  // warning パネルにはバッジがあり、warningTimeSeries にはない
  const warningSection = html.slice(
    html.indexOf('data-panel-id="warning"'),
    html.indexOf('data-panel-id="warningTimeSeries"'),
  );
  const timeSeriesSection = html.slice(html.indexOf('data-panel-id="warningTimeSeries"'));

  assert.ok(warningSection.includes('<span class="training-badge">訓練</span>'));
  assert.equal(timeSeriesSection.includes('training-badge'), false);
});

test('InfoPanelColumn: 訓練の重ね表示カードだけ data-training-overlay が付き、通常カードには付かない', () => {
  const status = {
    kind: 'data' as const,
    availability: 'available' as const,
    time: '2026-10-12T00:00:00.000Z',
    timeKind: 'issued' as const,
  };
  const input: InfoPanelColumnInput = {
    bosaiBulletin: [],
    warning: [
      { key: 'normal', heading: '気象警報・注意報', status, content: 'n', isTraining: false },
      {
        key: 'training-overlay-warning',
        status,
        content: 't',
        isTraining: true,
        trainingOverlay: true,
      },
    ],
    warningTimeSeries: [],
    earlyWarning: [],
    amedas: [],
    areaForecast: [],
  };
  const html = renderToStaticMarkup(el(InfoPanelColumn, { venue: eastVenue, input }));
  assert.equal(html.match(/data-training-overlay="true"/g)?.length, 1);
  const cards = html.split('<article').slice(1);
  const normal = cards.find((card) => card.includes('>n<'))!;
  const overlay = cards.find((card) => card.includes('>t<'))!;
  assert.ok(!normal.includes('data-training-overlay') && !normal.includes('training-badge'));
  assert.ok(overlay.includes('data-training-overlay="true"'));
  assert.ok(overlay.includes('<span class="training-badge">訓練</span>'));
  assert.match(overlay, /class="info-panel-card-title">警報・注意報</, '見出しはパネル名');
});

test('訓練の重ね表示カードのCSS: tertiary系トークンの2px枠で、通常カードと高さを揃え、HEX・黄色系を使わない', () => {
  const css = readFileSync(new URL('../src/map/panels/panels.css', import.meta.url), 'utf8');
  const block = css.match(/\.info-panel-card\[data-training-overlay='true'\] \{[^}]*\}/)![0];
  assert.match(block, /border: 2px solid var\(--md-sys-color-tertiary\)/);
  assert.match(block, /background: var\(--md-sys-color-tertiary-container\)/);
  assert.match(block, /padding: 11px 15px/, '枠が1px太る分を余白から引く(通常は12px 16px)');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block));
  assert.ok(!/warning|caution|yellow|amber/i.test(block));
});

// ----------------------------------------------------
// 6. panelFixtures: training-badges フィクスチャ
// ----------------------------------------------------
test('panelFixtures: training-badges で全6パネルの全カードに isTraining: true が設定される', () => {
  assert.ok(PANEL_FIXTURE_NAMES.includes('training-badges'));

  const fixtureInput = buildTrainingBadgesFixture();
  assert.ok(fixtureInput, 'training-badges フィクスチャが生成される');

  const panelIds: (keyof InfoPanelColumnInput)[] = [
    'bosaiBulletin',
    'warning',
    'warningTimeSeries',
    'earlyWarning',
    'amedas',
    'areaForecast',
  ];

  for (const id of panelIds) {
    const cards = fixtureInput[id];
    assert.ok(cards.length > 0, `${id} にカードが存在する`);
    for (const card of cards) {
      assert.equal(card.isTraining, true, `${id} のカード ${card.key} で isTraining が true`);
    }
  }
});

// ----------------------------------------------------
// 7. ブザー: 訓練通知でも通常通知と同じ鳴動要求になること (確定事項9・10)
// ----------------------------------------------------
test('ブザー: isTraining: true の通知でも通常通知と同じ鳴動要求(level)になり、確認で停止できる', () => {
  const trainingEmergencyNotice = makeNotice('delta:training-emergency', {
    category: 'emergency',
    isTraining: true,
    summary: '【訓練】大雨特別警報発表',
  });
  const normalEmergencyNotice = makeNotice('delta:normal-emergency', {
    category: 'emergency',
    isTraining: false,
    summary: '大雨特別警報発表',
  });

  const nowMs = Date.now();
  const { state: stateEmergency } = receiveNotifications(
    createNotificationUiState(),
    [trainingEmergencyNotice, normalEmergencyNotice],
    'K',
    nowMs,
  );

  // notificationChimeLevel の計算において isTraining の有無で level が変化しないこと
  const trainingLevel = notificationChimeLevel(stateEmergency, trainingEmergencyNotice);
  const normalLevel = notificationChimeLevel(stateEmergency, normalEmergencyNotice);

  assert.equal(trainingLevel, 5, '訓練特別警報はレベル5');
  assert.equal(normalLevel, 5, '通常特別警報もレベル5');
  assert.equal(trainingLevel, normalLevel, '訓練通知と通常通知のchimeLevelが同一');

  // selectNewArrivalChime でも同様に新着鳴動要求が生成されること
  const chimeReq = selectNewArrivalChime([trainingEmergencyNotice], stateEmergency, 'K');
  assert.ok(chimeReq);
  assert.equal(chimeReq.level, 5);
  assert.equal(chimeReq.category, 'emergency');
  assert.equal(chimeReq.feedKey, 'delta:training-emergency');

  // warning カテゴリでも確認
  const trainingWarningNotice = makeNotice('delta:training-warning', {
    category: 'warning',
    isTraining: true,
  });
  const normalWarningNotice = makeNotice('delta:normal-warning', {
    category: 'warning',
    isTraining: false,
  });

  const { state: stateWarning } = receiveNotifications(
    createNotificationUiState(),
    [trainingWarningNotice, normalWarningNotice],
    'K',
    nowMs,
  );

  assert.equal(
    notificationChimeLevel(stateWarning, trainingWarningNotice),
    notificationChimeLevel(stateWarning, normalWarningNotice),
    'warning カテゴリでも chimeLevel は一致',
  );
});
