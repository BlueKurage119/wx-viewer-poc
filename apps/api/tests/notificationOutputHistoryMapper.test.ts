import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  NotificationOutputSnapshot,
  NotificationTarget,
  SystemNotification,
  WeatherNotification,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { toNotificationOutputHistoryInput } from '../src/notifications/notificationOutputHistoryMapper.js';
import {
  findNotificationOutputHistoryById,
  recordNotificationOutputHistory,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-notification-mapper-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('受け入れ条件 2: 大田区・江東区を含む気象通知を mapper に渡すと、targetAreaJson が二要素の JSON 配列、relatedRefsJson が配列 JSON になり、全 B4 入力値が完全一致する', () => {
  const targets: readonly [NotificationTarget, NotificationTarget] = [
    {
      kind: 'area',
      codeType: 'jma_municipality',
      code: '131113',
      name: '大田区',
    },
    {
      kind: 'area',
      codeType: 'jma_municipality',
      code: '131083',
      name: '江東区',
    },
  ];

  const notification: WeatherNotification = {
    notificationId: 'notif-weather-c2-001',
    category: 'warning',
    origin: 'weather',
    changeType: 'strengthened',
    sourceType: 'warning_current',
    sourceVersion: '20260912000000_0_VPWW55_130000',
    targets,
    occurredAt: '2026-09-12T00:00:00Z',
    detectedAt: '2026-09-12T00:00:02Z',
    relatedRefs: [
      { type: 'telegram', ref: '20260912000000_0_VPWW55_130000' },
      { type: 'station', ref: '130010' },
    ],
    detectionContext: 'normal',
    isTraining: false,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: false,
    summary: '大雨警報（引き上げ）',
    messageDefinition: {
      id: 'msg-weather-warn-001',
      version: 'v1.0.0',
    },
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.notificationId, 'notif-weather-c2-001');
  assert.equal(input.category, 'warning');
  assert.equal(input.sourceType, 'warning_current');
  assert.equal(input.sourceVersion, '20260912000000_0_VPWW55_130000');
  assert.equal(input.targetAreaJson, JSON.stringify(targets));
  assert.equal(input.occurredAt, '2026-09-12T00:00:00Z');
  assert.equal(input.detectedAt, '2026-09-12T00:00:02Z');
  assert.equal(input.changeType, 'strengthened');
  assert.equal(input.ackRequired, false);
  assert.equal(input.summary, '大雨警報（引き上げ）');
  assert.equal(input.relatedRefsJson, JSON.stringify(notification.relatedRefs));
  assert.equal(input.origin, 'weather');
  assert.equal(input.detectionContext, 'normal');
  assert.equal(input.isTraining, false);
  assert.equal(input.messageDefinitionId, 'msg-weather-warn-001');
  assert.equal(input.messageDefinitionVersion, 'v1.0.0');
});

test('受け入れ条件 3: 単一の設備 target を持つ装置通知を mapper に渡すと、targetAreaJson が一要素の JSON 配列、origin === "system"、sourceVersion === null を保持する', () => {
  const notification: SystemNotification = {
    notificationId: 'notif-system-c3-001',
    category: 'emergency',
    origin: 'system',
    changeType: 'connection_lost',
    sourceType: 'fetch_attempt',
    sourceVersion: null,
    targets: [
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'jma-feed-connection',
        name: '気象庁フィード接続',
      },
    ],
    occurredAt: '2026-09-12T01:00:00Z',
    detectedAt: '2026-09-12T01:00:05Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: true,
    summary: '気象データ取得接続切断',
    messageDefinition: null,
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.notificationId, 'notif-system-c3-001');
  assert.equal(input.category, 'emergency');
  assert.equal(input.sourceType, 'fetch_attempt');
  assert.equal(input.sourceVersion, null);
  assert.equal(
    input.targetAreaJson,
    JSON.stringify([
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'jma-feed-connection',
        name: '気象庁フィード接続',
      },
    ]),
  );
  assert.equal(input.occurredAt, '2026-09-12T01:00:00Z');
  assert.equal(input.detectedAt, '2026-09-12T01:00:05Z');
  assert.equal(input.changeType, 'connection_lost');
  assert.equal(input.ackRequired, true);
  assert.equal(input.summary, '気象データ取得接続切断');
  assert.equal(input.relatedRefsJson, '[]');
  assert.equal(input.origin, 'system');
  assert.equal(input.detectionContext, 'normal');
  assert.equal(input.isTraining, false);
  assert.equal(input.messageDefinitionId, null);
  assert.equal(input.messageDefinitionVersion, null);
});

test('受け入れ条件 4: detectionContext: "initial" の気象通知で、changeType を変更せずに B4 入力へ渡る（初期取得を状態変化値へ混在させない）', () => {
  const notification: WeatherNotification = {
    notificationId: 'notif-weather-c4-001',
    category: 'warning',
    origin: 'weather',
    changeType: 'new',
    sourceType: 'warning_current',
    sourceVersion: 'v1',
    targets: [
      {
        kind: 'area',
        codeType: 'jma_forecast_area',
        code: '130010',
        name: '東京都',
      },
    ],
    occurredAt: '2026-09-12T02:00:00Z',
    detectedAt: '2026-09-12T02:00:01Z',
    relatedRefs: [],
    detectionContext: 'initial',
    isTraining: false,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: false,
    summary: '大雨警報（初期取得）',
    messageDefinition: null,
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.changeType, 'new');
  assert.equal(input.detectionContext, 'initial');
});

test('受け入れ条件 5: isTraining: true が mapper を通過して B4 入力まで true のまま保存される（本番相当へ変換しない）', () => {
  const notification: WeatherNotification = {
    notificationId: 'notif-weather-c5-001',
    category: 'warning',
    origin: 'weather',
    changeType: 'new',
    sourceType: 'warning_current',
    sourceVersion: 'v1_training',
    targets: [
      {
        kind: 'area',
        codeType: 'jma_forecast_area',
        code: '130010',
        name: '東京都',
      },
    ],
    occurredAt: '2026-09-12T03:00:00Z',
    detectedAt: '2026-09-12T03:00:01Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: true,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: false,
    summary: '【訓練】大雨警報',
    messageDefinition: null,
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.isTraining, true);
});

test('受け入れ条件 6: messageDefinition: null の出力スナップショットが B4 の ID／版をともに null にする（片方だけ非 null を生成しない）', () => {
  const notification: SystemNotification = {
    notificationId: 'notif-system-c6-001',
    category: 'question',
    origin: 'system',
    changeType: 'stale_check',
    sourceType: 'fetch_attempt',
    sourceVersion: null,
    targets: [
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'data-freshness',
        name: 'データ鮮度監視',
      },
    ],
    occurredAt: '2026-09-12T04:00:00Z',
    detectedAt: '2026-09-12T04:00:01Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: true,
    summary: 'データ鮮度低下の確認',
    messageDefinition: null,
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.messageDefinitionId, null);
  assert.equal(input.messageDefinitionVersion, null);
});

test('受け入れ条件 7: messageDefinition がある出力スナップショットでは、ID と版がそれぞれ B4 入力へ完全一致で渡る', () => {
  const notification: WeatherNotification = {
    notificationId: 'notif-weather-c7-001',
    category: 'emergency',
    origin: 'weather',
    changeType: 'new',
    sourceType: 'bosai_bulletin',
    sourceVersion: '20260912_VPBS50',
    targets: [
      {
        kind: 'area',
        codeType: 'bosai_bulletin_area',
        code: '130000',
        name: '東京都',
      },
    ],
    occurredAt: '2026-09-12T05:00:00Z',
    detectedAt: '2026-09-12T05:00:02Z',
    relatedRefs: [{ type: 'telegram', ref: '20260912_VPBS50' }],
    detectionContext: 'normal',
    isTraining: false,
  };

  const output: NotificationOutputSnapshot = {
    ackRequired: true,
    summary: '線状降水帯発生情報',
    messageDefinition: {
      id: 'msg-emergency-001',
      version: 'v2.1.0',
    },
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.messageDefinitionId, 'msg-emergency-001');
  assert.equal(input.messageDefinitionVersion, 'v2.1.0');
});

test('受け入れ条件 8: summary と ackRequired が NotificationOutputSnapshot の入力値どおりであり、category による書換えや D1 独自の文言生成がない', () => {
  const notification: WeatherNotification = {
    notificationId: 'notif-weather-c8-001',
    category: 'emergency', // emergency でも ackRequired が false であればそのまま維持
    origin: 'weather',
    changeType: 'new',
    sourceType: 'bosai_bulletin',
    sourceVersion: 'v1',
    targets: [
      {
        kind: 'equipment',
        codeType: 'system_component',
        code: 'message-renderer',
        name: 'メッセージ生成',
      },
    ],
    occurredAt: '2026-09-12T06:00:00Z',
    detectedAt: '2026-09-12T06:00:01Z',
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
  };

  const rawSummary = '独自の文言生成をせず、スナップショットをそのまま通すテスト';
  const output: NotificationOutputSnapshot = {
    ackRequired: false,
    summary: rawSummary,
    messageDefinition: null,
  };

  const input = toNotificationOutputHistoryInput(notification, output);

  assert.equal(input.summary, rawSummary);
  assert.equal(input.ackRequired, false);
});

test('受け入れ条件 2〜8 のインテグレーション: mapper の出力を B4 recordNotificationOutputHistory へ記録し完全一致で取得できる', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({
      databasePath,
      migrationsDirectory,
    });

    // 1. 気象通知（定義あり）
    const weatherTarget: NotificationTarget = {
      kind: 'point',
      codeType: 'amedas_station',
      code: '44132',
      name: '東京',
    };
    const weatherNotification: WeatherNotification = {
      notificationId: 'notif-db-001',
      category: 'warning',
      origin: 'weather',
      changeType: 'strengthened',
      sourceType: 'amedas',
      sourceVersion: '20260912070000',
      targets: [weatherTarget],
      occurredAt: '2026-09-12T07:00:00Z',
      detectedAt: '2026-09-12T07:00:02Z',
      relatedRefs: [{ type: 'station', ref: '44132' }],
      detectionContext: 'normal',
      isTraining: false,
    };
    const weatherOutput: NotificationOutputSnapshot = {
      ackRequired: false,
      summary: 'アメダス風速基準超過',
      messageDefinition: {
        id: 'msg-amedas-001',
        version: 'v1.0.0',
      },
    };

    const weatherInput = toNotificationOutputHistoryInput(weatherNotification, weatherOutput);
    const recordedWeather = recordNotificationOutputHistory(context.connection, weatherInput);
    assert.ok(recordedWeather.id > 0);

    const fetchedWeather = findNotificationOutputHistoryById(
      context.connection,
      recordedWeather.id,
    );
    assert.ok(fetchedWeather !== null);
    assert.equal(fetchedWeather.notificationId, weatherInput.notificationId);
    assert.equal(fetchedWeather.category, weatherInput.category);
    assert.equal(fetchedWeather.sourceType, weatherInput.sourceType);
    assert.equal(fetchedWeather.sourceVersion, weatherInput.sourceVersion);
    assert.equal(fetchedWeather.targetAreaJson, weatherInput.targetAreaJson);
    assert.equal(fetchedWeather.occurredAt, weatherInput.occurredAt);
    assert.equal(fetchedWeather.detectedAt, weatherInput.detectedAt);
    assert.equal(fetchedWeather.changeType, weatherInput.changeType);
    assert.equal(fetchedWeather.ackRequired, weatherInput.ackRequired);
    assert.equal(fetchedWeather.summary, weatherInput.summary);
    assert.equal(fetchedWeather.relatedRefsJson, weatherInput.relatedRefsJson);
    assert.equal(fetchedWeather.origin, weatherInput.origin);
    assert.equal(fetchedWeather.detectionContext, weatherInput.detectionContext);
    assert.equal(fetchedWeather.isTraining, weatherInput.isTraining);
    assert.equal(fetchedWeather.messageDefinitionId, weatherInput.messageDefinitionId);
    assert.equal(fetchedWeather.messageDefinitionVersion, weatherInput.messageDefinitionVersion);

    // 2. 装置・訓練通知（定義なし: ID/版ともに null）
    const systemNotification: SystemNotification = {
      notificationId: 'notif-db-002',
      category: 'emergency',
      origin: 'system',
      changeType: 'link_down',
      sourceType: 'equipment_monitor',
      sourceVersion: null,
      targets: [
        { kind: 'equipment', codeType: 'system_component', code: 'network-link', name: '回線監視' },
      ],
      occurredAt: '2026-09-12T07:10:00Z',
      detectedAt: '2026-09-12T07:10:03Z',
      relatedRefs: [],
      detectionContext: 'initial',
      isTraining: true,
    };
    const systemOutput: NotificationOutputSnapshot = {
      ackRequired: true,
      summary: '【訓練】回線断検知',
      messageDefinition: null,
    };

    const systemInput = toNotificationOutputHistoryInput(systemNotification, systemOutput);
    const recordedSystem = recordNotificationOutputHistory(context.connection, systemInput);
    assert.ok(recordedSystem.id > 0);

    const fetchedSystem = findNotificationOutputHistoryById(context.connection, recordedSystem.id);
    assert.ok(fetchedSystem !== null);
    assert.equal(fetchedSystem.notificationId, systemInput.notificationId);
    assert.equal(fetchedSystem.targetAreaJson, systemInput.targetAreaJson);
    assert.equal(fetchedSystem.sourceVersion, null);
    assert.equal(fetchedSystem.origin, 'system');
    assert.equal(fetchedSystem.detectionContext, 'initial');
    assert.equal(fetchedSystem.isTraining, true);
    assert.equal(fetchedSystem.messageDefinitionId, null);
    assert.equal(fetchedSystem.messageDefinitionVersion, null);
  } finally {
    cleanup();
  }
});
