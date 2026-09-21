import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

test('buildNowcastCatalog: 正常応答からカタログを構築し、N1/N2 重複で N1 実況を代表とする (案 A)', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  assert.equal(catalog.context.terminalId, 'hkeagh01');
  assert.equal(catalog.context.venueId, 'east');
  assert.equal(catalog.context.controlStatus, 'normal');
  assert.equal(catalog.context.isTraining, false);
  assert.deepEqual(catalog.allowedZooms, [10]);

  // 全コマ数: N1 13件 + N2 12件 = 25コマ
  assert.equal(catalog.frames.length, 25);
  assert.equal(catalog.excludedCount, 0);

  // 重複 validTime (2026-09-15T03:00:00.000Z) の検証
  const dupValidTime = '2026-09-15T03:00:00.000Z';
  const dupFrames = catalog.frames.filter((f) => f.validTime === dupValidTime);
  assert.equal(dupFrames.length, 2, '同一 validTime のコマが2件保持されていること');

  const n1Dup = dupFrames.find((f) => f.product === 'N1')!;
  const n2Dup = dupFrames.find((f) => f.product === 'N2')!;
  assert.ok(n1Dup);
  assert.ok(n2Dup);

  // 案 A: N1 実況側が代表
  assert.equal(n1Dup.representative, true);
  assert.equal(n1Dup.hasSameValidTimeAlternative, true);
  assert.equal(n1Dup.kind, 'observed');

  // N2 予測側は非代表としてカタログに保持
  assert.equal(n2Dup.representative, false);
  assert.equal(n2Dup.hasSameValidTimeAlternative, true);
  assert.equal(n2Dup.kind, 'forecast');

  // 代表コマの合計数は 25 - 1 = 24 コマ
  const representativeFrames = catalog.frames.filter((f) => f.representative);
  assert.equal(representativeFrames.length, 24);

  // 重複しないコマの検証
  const nonDupFrame = catalog.frames.find((f) => f.validTime === '2026-09-15T02:00:00.000Z')!;
  assert.ok(nonDupFrame);
  assert.equal(nonDupFrame.representative, true);
  assert.equal(nonDupFrame.hasSameValidTimeAlternative, false);
});

test('buildNowcastCatalog: 表示窓外のコマは除外され excludedCount に加算される', () => {
  const response = createSampleNowcastResponse();
  // 窓外コマを追加 (window は 02:00〜04:00)
  const outsideFrame = {
    product: 'N1' as const,
    baseTime: '2026-09-15T01:00:00.000Z',
    validTime: '2026-09-15T01:00:00.000Z',
    element: 'hrpns' as const,
    member: 'none' as const,
  };
  const modifiedResponse = {
    ...response,
    products: {
      ...response.products,
      N1: {
        ...response.products.N1,
        data: {
          frames: [outsideFrame, ...response.products.N1.data!.frames],
        },
      },
    },
  };

  const catalog = buildNowcastCatalog(modifiedResponse);
  assert.equal(catalog.excludedCount, 1);
  assert.equal(
    catalog.frames.some((f) => f.validTime === '2026-09-15T01:00:00.000Z'),
    false,
  );
});

test('buildNowcastCatalog: 表示窓が120分を超える場合は evaluatedAt ± 60分にクランプされる (§4.2)', () => {
  const response = createSampleNowcastResponse({
    evaluatedAt: '2026-09-15T03:00:00.000Z',
    window: {
      from: '2026-09-15T00:00:00.000Z',
      to: '2026-09-15T05:00:00.000Z', // 5時間 (120分超過)
    },
  });

  const catalog = buildNowcastCatalog(response);
  assert.deepEqual(catalog.window, {
    from: '2026-09-15T02:00:00.000Z',
    to: '2026-09-15T04:00:00.000Z',
  });
});

test('buildNowcastCatalog: 欠けた時刻のコマは生成・補間されない (§4.2)', () => {
  const response = createSampleNowcastResponse();
  // N1 の 02:15 を除外して欠けを作成
  const filteredN1 = response.products.N1.data!.frames.filter(
    (f) => f.validTime !== '2026-09-15T02:15:00.000Z',
  );

  const catalog = buildNowcastCatalog({
    ...response,
    products: {
      ...response.products,
      N1: {
        ...response.products.N1,
        data: { frames: filteredN1 },
      },
    },
  });

  assert.equal(
    catalog.frames.some((f) => f.validTime === '2026-09-15T02:15:00.000Z'),
    false,
  );
});

test('buildNowcastCatalog: N1/N2 の片系障害でも残りのコマだけでカタログを構成する (§4.4, §11.2)', () => {
  // N2 が障害 (data=null, availability=unavailable)
  const n2FailedResponse = createSampleNowcastResponse({
    products: {
      N1: createSampleNowcastResponse().products.N1,
      N2: {
        metadata: {
          source: 'jma_nowcast',
          availability: 'unavailable',
          issuedAt: null,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: '2026-09-15T03:00:00.000Z',
          lastSuccessAt: null,
          sourceVersion: null,
        },
        data: null,
      },
    },
  });

  const catalogN2Failed = buildNowcastCatalog(n2FailedResponse);
  assert.equal(catalogN2Failed.products.N2.metadata.availability, 'unavailable');
  assert.equal(catalogN2Failed.products.N2.data, null);
  assert.equal(catalogN2Failed.products.N1.metadata.availability, 'available');
  assert.ok(catalogN2Failed.frames.length > 0);
  assert.ok(catalogN2Failed.frames.every((f) => f.product === 'N1'));

  // N1 が障害
  const n1FailedResponse = createSampleNowcastResponse({
    products: {
      N1: {
        metadata: {
          source: 'jma_nowcast',
          availability: 'unavailable',
          issuedAt: null,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: '2026-09-15T03:00:00.000Z',
          lastSuccessAt: null,
          sourceVersion: null,
        },
        data: null,
      },
      N2: createSampleNowcastResponse().products.N2,
    },
  });

  const catalogN1Failed = buildNowcastCatalog(n1FailedResponse);
  assert.equal(catalogN1Failed.products.N1.metadata.availability, 'unavailable');
  assert.equal(catalogN1Failed.products.N2.metadata.availability, 'available');
  assert.ok(catalogN1Failed.frames.length > 0);
  assert.ok(catalogN1Failed.frames.every((f) => f.product === 'N2'));
});

test('buildNowcastCatalog: data={frames:[]} (正常空) と data=null (未取得) で異なる状態を保持する (§11.2)', () => {
  const emptyFramesResponse = createSampleNowcastResponse({
    products: {
      N1: {
        metadata: createSampleNowcastResponse().products.N1.metadata,
        data: { frames: [] },
      },
      N2: createSampleNowcastResponse().products.N2,
    },
  });

  const nullDataResponse = createSampleNowcastResponse({
    products: {
      N1: {
        metadata: createSampleNowcastResponse().products.N1.metadata,
        data: null,
      },
      N2: createSampleNowcastResponse().products.N2,
    },
  });

  const catalogEmpty = buildNowcastCatalog(emptyFramesResponse);
  const catalogNull = buildNowcastCatalog(nullDataResponse);

  assert.deepEqual(catalogEmpty.products.N1.data, { frames: [] });
  assert.equal(catalogNull.products.N1.data, null);
});

test('buildNowcastCatalog: unsupported_control_status や window=null では空のコマ一覧を返す (§4.1, §11.7)', () => {
  const response = createSampleNowcastResponse({
    status: 'unsupported_control_status',
    window: null,
    allowedZooms: [],
  });

  const catalog = buildNowcastCatalog(response);
  assert.equal(catalog.window, null);
  assert.deepEqual(catalog.allowedZooms, []);
  assert.deepEqual(catalog.frames, []);
  assert.equal(catalog.excludedCount, 0);
});
