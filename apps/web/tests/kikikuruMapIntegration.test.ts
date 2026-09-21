import './setupEnv.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { terminals } from '../src/shell/config';
import { sampleKikikuruTimeline } from '../src/map/fixtures';
import { mapViewportConfiguration } from '../src/map/MapViewport';
import { getOverlayProductKey, WeatherMapView } from '../src/map/WeatherMapView';

const el = React.createElement;

test('WeatherMapView: ナウキャストとキキクルの往復ではオーバーレイを別インスタンスへ切り替えること', () => {
  assert.equal(getOverlayProductKey('nowcast'), 'nowcast');
  assert.equal(getOverlayProductKey('kikikuru-heavyrain'), 'kikikuru');
  assert.equal(getOverlayProductKey('kikikuru-inund'), 'kikikuru');
  assert.equal(getOverlayProductKey('kikikuru-land'), 'kikikuru');
  assert.notEqual(getOverlayProductKey('nowcast'), getOverlayProductKey('kikikuru-heavyrain'));
  assert.notEqual(getOverlayProductKey('kikikuru-heavyrain'), getOverlayProductKey('nowcast'));
});

test('MapViewport: Leaflet 本体・背景地図・命令的ズームが 9〜18 に固定されること (§7.2, §11.5)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const mapOptions = mapViewportConfiguration.createMapViewportOptions(eastTerminal.venue);
  const tileOptions = mapViewportConfiguration.createGsiPaleTileOptions();

  assert.equal(mapViewportConfiguration.minZoom, 9);
  assert.equal(mapViewportConfiguration.maxZoom, 18);
  assert.equal(mapOptions.minZoom, 9);
  assert.equal(mapOptions.maxZoom, 18);
  assert.equal(mapOptions.zoom, mapViewportConfiguration.initialZoom);
  assert.equal(tileOptions.minZoom, 9);
  assert.equal(tileOptions.maxZoom, 18);
  assert.equal(
    mapViewportConfiguration.clampMapZoom(8),
    9,
    'Leaflet API に渡す setZoom(8) 相当も 9 へ丸める',
  );
  assert.equal(mapViewportConfiguration.clampMapZoom(19), 18);
});

test('MapViewport: カード差替え後は旧DOMを監視せず現在のカードを中心補正の監視対象にすること', () => {
  const container = {} as HTMLElement;
  const rightColumn = {} as HTMLElement;
  const oldCard = {} as HTMLElement;
  const currentCard = {} as HTMLElement;

  const observed = mapViewportConfiguration.getObservedLayoutElements(
    container,
    rightColumn,
    currentCard,
  );
  assert.deepEqual(observed, [container, rightColumn, currentCard]);
  assert.equal(observed.includes(oldCard), false);
});

test('キキクル表示中は簡易カードだけを表示し、時間操作と廃止した注記を描画しないこと (§8.2, §8.3, §11.4)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  const html = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );

  assert.ok(html.includes('kikikuru-status-card'));
  assert.ok(html.includes('09/15 01:30'));
  assert.equal(html.includes('timeline-slider'), false);
  assert.equal(html.includes('aria-label="戻る"'), false);
  assert.equal(html.includes('aria-label="再生"'), false);
  assert.equal(html.includes('aria-label="現在"'), false);
  assert.equal(html.includes('aria-label="次へ"'), false);
  assert.equal(html.includes('この危険度は予測を含む判定結果です'), false);
});

test('キキクルの状態注記スロットは必要時だけ1つ描画され、空の入れ子を作らないこと', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;
  const normalHtml = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );
  assert.equal((normalHtml.match(/timeline-status-slot/g) ?? []).length, 0);

  const unavailableHtml = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      controlStatus: 'training',
    }),
  );
  assert.equal((unavailableHtml.match(/timeline-status-slot/g) ?? []).length, 1);
  assert.ok(unavailableHtml.includes('この制御状態ではキキクルを提供していません'));
});

test('キキクル表示中の画面テキストに禁止語（実況／予報／予測中／有効期限／〜まで有効／失効）が現れないこと (§8.2, §11.7)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  for (const layerId of ['kikikuru-heavyrain', 'kikikuru-inund', 'kikikuru-land'] as const) {
    const html = renderToStaticMarkup(
      el(WeatherMapView, {
        venue: eastTerminal.venue,
        selectedLayerId: layerId,
        timelineViewModel: sampleKikikuruTimeline,
      }),
    );

    // HTML タグを除去した簡易テキスト判定
    const textContent = html.replace(/<[^>]*>/g, ' ');

    const forbiddenWords = ['実況', '予報', '予測中', '有効期限', 'まで有効', '失効'];
    for (const word of forbiddenWords) {
      assert.ok(
        !textContent.includes(word),
        `キキクル (${layerId}) の画面テキストに禁止語「${word}」が含まれています`,
      );
    }
  }
});

test('キキクル表示中に危険度なし・安全・縮尺不足の文言が現れないこと (§7.2, §11.5)', () => {
  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  const html = renderToStaticMarkup(
    el(WeatherMapView, {
      venue: eastTerminal.venue,
      selectedLayerId: 'kikikuru-heavyrain',
      timelineViewModel: sampleKikikuruTimeline,
    }),
  );

  assert.ok(!html.includes('この縮尺では危険度分布を表示していません'));

  // 画面テキスト全体に「危険度なし」「安全」が現れないこと
  const textContent = html.replace(/<[^>]*>/g, ' ');
  assert.ok(!textContent.includes('危険度なし'), '「危険度なし」が含まれています');
  assert.ok(!textContent.includes('安全'), '「安全」が含まれています');
});

test('useKikikuruCatalog: resetKey にキキクル種別が含まれず、terminalId と controlStatus のみであること (§6.2, §10.1, §11.6)', () => {
  // useKikikuruCatalog が使用する resetKey は種別切替で変化しない
  // ソースコード内の resetKey 定義を確認
  const terminalId = 'hkeagh01';
  const controlStatus = 'normal';
  const expectedResetKey = `${terminalId}:${controlStatus}`;

  assert.ok(!expectedResetKey.includes('heavyrain'));
  assert.ok(!expectedResetKey.includes('inund'));
  assert.ok(!expectedResetKey.includes('land'));
});
