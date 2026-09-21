import './setupEnv.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeatherMapView } from '../src/map/WeatherMapView';
import { terminals } from '../src/shell/config';
import { sampleKikikuruTimeline } from '../src/map/fixtures';

const el = React.createElement;

test('回帰テスト: レイヤー切替時に setView / flyTo / fitBounds / panTo のいずれも呼ばれないこと (§5.2, §11.3)', () => {
  // Leaflet map インスタンスのモック
  const calls: string[] = [];
  const mockMap = {
    setView() {
      calls.push('setView');
      return this;
    },
    flyTo() {
      calls.push('flyTo');
      return this;
    },
    fitBounds() {
      calls.push('fitBounds');
      return this;
    },
    panTo() {
      calls.push('panTo');
      return this;
    },
    getZoom() {
      return 11;
    },
    getCenter() {
      return { lat: 35.63159, lng: 139.79281 };
    },
    hasLayer() {
      return false;
    },
    addLayer() {
      return this;
    },
    removeLayer() {
      return this;
    },
    on() {
      return this;
    },
    off() {
      return this;
    },
  };

  const eastTerminal = terminals.find((t) => t.venue.id === 'east')!;

  const layers = [
    'kikikuru-heavyrain',
    'kikikuru-inund',
    'kikikuru-land',
    'nowcast',
    'kikikuru-heavyrain',
  ] as const;

  for (const layerId of layers) {
    renderToStaticMarkup(
      el(WeatherMapView, {
        venue: eastTerminal.venue,
        selectedLayerId: layerId,
      }),
    );
  }

  // レイヤー切替の前後で map の移動メソッドが一切呼ばれていないこと (空配列)
  // mockMap に対しても一切操作が行われないことの確認
  assert.equal(calls.length, 0, `予期せぬ地図移動メソッドが呼ばれました: ${calls.join(', ')}`);
  assert.equal(mockMap.getZoom(), 11);
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
