import test from 'node:test';
import assert from 'node:assert/strict';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  evaluateFetchSourceHealth,
  aggregateFetchHealth,
  type EvaluateFetchSourceInput,
  type FetchSourceHealthResult,
} from '../src/monitoring/fetchHealthEvaluator.js';
import type { FetchHealthConfig } from '../src/monitoring/fetchHealthConfig.js';

const sampleConfig: FetchHealthConfig = {
  evaluationIntervalSeconds: 30,
  delayedConsecutiveFailures: 2,
  delayedIntervalMultiplier: 3,
  abnormalConsecutiveFailures: 5,
  abnormalElapsedSeconds: 600,
  maxScanAttempts: 50,
};

test('evaluateFetchSourceHealth: 正常系（連続失敗 0 回、経過時間内）', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'normal');
  assert.equal(result.reasons.length, 0);
  assert.equal(result.maxConsecutiveFailures, 0);
  assert.equal(result.lastAttemptAt, '2026-09-09T00:00:50.000Z');
  assert.equal(result.lastSuccessAt, '2026-09-09T00:00:50.000Z');
});

test('evaluateFetchSourceHealth: 連続失敗 1 回は正常', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        consecutiveFailures: 1,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'normal');
  assert.equal(result.reasons.length, 0);
  assert.equal(result.maxConsecutiveFailures, 1);
});

test('evaluateFetchSourceHealth: 連続失敗 2 回で遅延', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        consecutiveFailures: 2,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'delayed');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].kind, 'consecutive_failures');
  assert.equal(result.reasons[0].status, 'delayed');
  assert.equal(result.reasons[0].text, '連続2回失敗');
});

test('evaluateFetchSourceHealth: 連続失敗 5 回で異常', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        consecutiveFailures: 5,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'abnormal');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].kind, 'consecutive_failures');
  assert.equal(result.reasons[0].status, 'abnormal');
  assert.equal(result.reasons[0].text, '連続5回失敗');
});

test('evaluateFetchSourceHealth: 経過時間による遅延（適用周期×3 超過）', () => {
  // intervalSeconds: 60, delayedIntervalMultiplier: 3 -> 180秒超過で遅延
  const lastSuccessAt = '2026-09-09T00:00:00.000Z' as UtcIso8601String;
  const now = '2026-09-09T00:03:01.000Z' as UtcIso8601String; // +181秒

  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: lastSuccessAt,
        lastSuccessAt,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'delayed');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].kind, 'last_success_elapsed');
  assert.equal(result.reasons[0].status, 'delayed');
});

test('evaluateFetchSourceHealth: 経過時間による異常（固定 10 分超過）', () => {
  // abnormalElapsedSeconds: 600 -> +601秒で異常
  const lastSuccessAt = '2026-09-09T00:00:00.000Z' as UtcIso8601String;
  const now = '2026-09-09T00:10:01.000Z' as UtcIso8601String; // +601秒

  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: lastSuccessAt,
        lastSuccessAt,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'abnormal');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].kind, 'last_success_elapsed');
  assert.equal(result.reasons[0].status, 'abnormal');
});

test('evaluateFetchSourceHealth: appliesElapsedCondition: false（amedas_point）は経過時間で判定されない', () => {
  // 8時間前の成功
  const lastSuccessAt = '2026-09-09T00:00:00.000Z' as UtcIso8601String;
  const now = '2026-09-09T08:00:00.000Z' as UtcIso8601String;

  const input: EvaluateFetchSourceInput = {
    sourceId: 'amedas_point',
    now,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: false,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'amedas_point',
        lastAttemptAt: lastSuccessAt,
        lastSuccessAt,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'normal', '8時間成功が無くても連続失敗がなければ normal');
  assert.equal(result.reasons.length, 0);

  // 連続失敗 2 回で delayed
  const delayedResult = evaluateFetchSourceHealth(
    {
      ...input,
      streams: [
        {
          ...input.streams[0],
          consecutiveFailures: 2,
        },
      ],
    },
    sampleConfig,
  );
  assert.equal(delayedResult.status, 'delayed');
  assert.equal(delayedResult.reasons[0].kind, 'consecutive_failures');

  // 連続失敗 5 回で abnormal
  const abnormalResult = evaluateFetchSourceHealth(
    {
      ...input,
      streams: [
        {
          ...input.streams[0],
          consecutiveFailures: 5,
        },
      ],
    },
    sampleConfig,
  );
  assert.equal(abnormalResult.status, 'abnormal');
  assert.equal(abnormalResult.reasons[0].kind, 'consecutive_failures');
});

test('evaluateFetchSourceHealth: suspended: true のときは status: "suspended"', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now: '2026-09-09T00:10:00.000Z' as UtcIso8601String,
    suspended: true,
    intervalSeconds: null,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        consecutiveFailures: 10,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'suspended');
  assert.equal(result.reasons.length, 0);
  assert.equal(result.maxConsecutiveFailures, 10);
  assert.equal(result.intervalSeconds, null);
});

test('evaluateFetchSourceHealth: activeSinceAt による経過時間の下限（夜間停止明け誤検知防止）', () => {
  // 最終成功が 8 時間前だが、activeSinceAt（稼働再開時刻）が 10 秒前
  const lastSuccessAt = '2026-09-09T00:00:00.000Z' as UtcIso8601String;
  const activeSinceAt = '2026-09-09T08:00:00.000Z' as UtcIso8601String;
  const now = '2026-09-09T08:00:10.000Z' as UtcIso8601String;

  const input: EvaluateFetchSourceInput = {
    sourceId: 'xml_regular',
    now,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt,
    streams: [
      {
        sourceKind: 'xml_feed_regular',
        lastAttemptAt: lastSuccessAt,
        lastSuccessAt,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'normal', '稼働再開直後は経過時間条件で異常にならない');
  assert.equal(result.reasons.length, 0);
});

test('evaluateFetchSourceHealth: 複数ストリーム（雨雲 N1/N2）の最悪値判定', () => {
  const input: EvaluateFetchSourceInput = {
    sourceId: 'nowcast_target_times',
    now: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    suspended: false,
    intervalSeconds: 60,
    appliesElapsedCondition: true,
    activeSinceAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    streams: [
      {
        sourceKind: 'radar_times_N1',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        consecutiveFailures: 5,
        consecutiveFailuresCapped: false,
      },
      {
        sourceKind: 'radar_times_N2',
        lastAttemptAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        lastSuccessAt: '2026-09-09T00:00:50.000Z' as UtcIso8601String,
        consecutiveFailures: 0,
        consecutiveFailuresCapped: false,
      },
    ],
  };

  const result = evaluateFetchSourceHealth(input, sampleConfig);
  assert.equal(result.status, 'abnormal', 'N1 が異常なら取得元全体が abnormal');
  assert.equal(result.maxConsecutiveFailures, 5);
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].sourceKind, 'radar_times_N1');
});

test('aggregateFetchHealth: 表示用集約の最悪値と順序固定', () => {
  const evaluatedAt = '2026-09-09T00:01:00.000Z' as UtcIso8601String;

  const makeResult = (
    sourceId: FetchSourceHealthResult['sourceId'],
    status: FetchSourceHealthResult['status'],
  ): FetchSourceHealthResult => ({
    sourceId,
    status,
    reasons: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    maxConsecutiveFailures: 0,
    intervalSeconds: 60,
  });

  const results: FetchSourceHealthResult[] = [
    makeResult('xml_extra', 'normal'),
    makeResult('amedas_point', 'abnormal'),
    makeResult('xml_regular', 'delayed'),
    makeResult('kikikuru_target_times', 'normal'),
    makeResult('nowcast_target_times', 'suspended'),
    makeResult('amedas_latest_time', 'normal'),
  ];

  const aggregate = aggregateFetchHealth(results, evaluatedAt);

  assert.equal(aggregate.status, 'abnormal');
  assert.deepEqual(aggregate.worstSourceIds, ['amedas_point']);
  assert.equal(aggregate.evaluatedAt, evaluatedAt);
  // 固定順（MONITORED_FETCH_SOURCES の順）で 6 件並んでいること
  assert.deepEqual(
    aggregate.sources.map((s) => s.sourceId),
    [
      'xml_regular',
      'xml_extra',
      'nowcast_target_times',
      'kikikuru_target_times',
      'amedas_latest_time',
      'amedas_point',
    ],
  );
});

test('aggregateFetchHealth: 全件 suspended の場合は status: "suspended"', () => {
  const evaluatedAt = '2026-09-09T00:01:00.000Z' as UtcIso8601String;

  const makeResult = (sourceId: FetchSourceHealthResult['sourceId']): FetchSourceHealthResult => ({
    sourceId,
    status: 'suspended',
    reasons: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    maxConsecutiveFailures: 0,
    intervalSeconds: null,
  });

  const results: FetchSourceHealthResult[] = [
    makeResult('xml_regular'),
    makeResult('xml_extra'),
    makeResult('nowcast_target_times'),
    makeResult('kikikuru_target_times'),
    makeResult('amedas_latest_time'),
    makeResult('amedas_point'),
  ];

  const aggregate = aggregateFetchHealth(results, evaluatedAt);
  assert.equal(aggregate.status, 'suspended');
  assert.deepEqual(aggregate.worstSourceIds, []);
});
