import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  evaluateFreshness,
  type FreshnessConfig,
  type FreshnessPolicy,
} from '../src/polling/freshnessPolicy.js';

describe('freshnessPolicy (受け入れ条件 10)', () => {
  const policy300: FreshnessPolicy = { staleAfterSeconds: 300 };
  const policy600: FreshnessPolicy = { staleAfterSeconds: 600 };

  const defaultConfig: FreshnessConfig = {
    xml: policy300,
    imageCatalog: policy300,
  };

  test('lastSuccessAt が null の場合は未取得・失敗とも unavailable', () => {
    const res1 = evaluateFreshness(
      {
        now: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        lastSuccessAt: null,
        latestAttemptFailed: false,
      },
      policy300,
    );
    assert.equal(res1, 'unavailable');

    const res2 = evaluateFreshness(
      {
        now: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        lastSuccessAt: null,
        latestAttemptFailed: true,
      },
      policy300,
    );
    assert.equal(res2, 'unavailable');
  });

  test('正常取得歴があり直近取得失敗なら経過時間にかかわらず即 stale', () => {
    const res = evaluateFreshness(
      {
        now: '2026-09-12T10:00:10.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String, // 10秒前
        latestAttemptFailed: true,
      },
      policy300,
    );
    assert.equal(res, 'stale');
  });

  test('正常取得後 299,999 ms は available、300,000 ms は stale と完全一致する (>= 境界)', () => {
    const baseTimeMs = new Date('2026-09-12T10:00:00.000Z').getTime();

    // 299,999 ms 経過 (300秒未満) -> available
    const time299999 = new Date(baseTimeMs + 299_999).toISOString() as UtcIso8601String;
    const resAvailable = evaluateFreshness(
      {
        now: time299999,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      policy300,
    );
    assert.equal(resAvailable, 'available');

    // 300,000 ms 経過 (ちょうど300秒) -> stale
    const time300000 = new Date(baseTimeMs + 300_000).toISOString() as UtcIso8601String;
    const resStale = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      policy300,
    );
    assert.equal(resStale, 'stale');
  });

  test('負の経過時間は閾値未満として available 扱い', () => {
    const res = evaluateFreshness(
      {
        now: '2026-09-12T09:59:50.000Z' as UtcIso8601String, // 10秒前
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      policy300,
    );
    assert.equal(res, 'available');
  });

  test('freshness.xml と freshness.imageCatalog の独立設定と境界検証', () => {
    const baseTimeMs = new Date('2026-09-12T10:00:00.000Z').getTime();
    const time300000 = new Date(baseTimeMs + 300_000).toISOString() as UtcIso8601String;

    // 既定値 (双方300) では 300,000ms で双方 stale
    const xmlDefault = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      defaultConfig.xml,
    );
    const catalogDefault = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      defaultConfig.imageCatalog,
    );
    assert.equal(xmlDefault, 'stale');
    assert.equal(catalogDefault, 'stale');

    // freshness.xml を 600 へ変更 -> XML だけ available、索引は stale のまま
    const configXml600: FreshnessConfig = {
      xml: policy600,
      imageCatalog: policy300,
    };
    const xml600 = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      configXml600.xml,
    );
    const catalogStayStale = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      configXml600.imageCatalog,
    );
    assert.equal(xml600, 'available');
    assert.equal(catalogStayStale, 'stale');

    // 逆に imageCatalog だけ 600 へ変更 -> 索引だけ available、XML は stale のまま
    const configCatalog600: FreshnessConfig = {
      xml: policy300,
      imageCatalog: policy600,
    };
    const xmlStayStale = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      configCatalog600.xml,
    );
    const catalog600 = evaluateFreshness(
      {
        now: time300000,
        lastSuccessAt: '2026-09-12T10:00:00.000Z' as UtcIso8601String,
        latestAttemptFailed: false,
      },
      configCatalog600.imageCatalog,
    );
    assert.equal(xmlStayStale, 'stale');
    assert.equal(catalog600, 'available');
  });
});
