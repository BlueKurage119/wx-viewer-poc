import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNowcastTileUrlTemplate } from '../src/map/nowcast/nowcastTileUrl';

const frame = {
  id: 'N1:2024-02-29T03:04:05.000Z:2024-02-29T03:09:05.000Z',
  product: 'N1' as const,
  kind: 'observed' as const,
  baseTime: '2024-02-29T03:04:05.000Z',
  validTime: '2024-02-29T03:09:05.000Z',
  hasSameValidTimeAlternative: false,
  representative: true,
};

test('nowcastTileUrl: proxy と jma-direct のURLを完全一致で生成すること', () => {
  assert.equal(
    buildNowcastTileUrlTemplate({
      frame,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      tileDeliveryProfile: 'proxy',
    }),
    '/api/weather/nowcast/N1/tiles/{z}/{x}/{y}.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2024-02-29T03%3A04%3A05.000Z&validTime=2024-02-29T03%3A09%3A05.000Z',
  );
  assert.equal(
    buildNowcastTileUrlTemplate({
      frame,
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      tileDeliveryProfile: 'jma-direct',
    }),
    'https://www.jma.go.jp/bosai/jmatile/data/nowc/20240229030405/none/20240229030905/surf/hrpns/{z}/{x}/{y}.png',
  );
});

test('nowcastTileUrl: jma-direct は不正ISO日時を拒否すること', () => {
  assert.equal(
    buildNowcastTileUrlTemplate({
      frame: { ...frame, baseTime: '2024-02-30T03:04:05.000Z' },
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      tileDeliveryProfile: 'jma-direct',
    }),
    null,
  );
});
