import test from 'node:test';
import assert from 'node:assert/strict';
import { type WeatherNotification, resolveNotificationMessage } from '@wx-viewer-poc/shared';
import { classifyWarningNotificationCategory } from '../src/notifications/warningNotificationCategoryClassifier.js';
import {
  selectIssuedNotificationDefinitionId,
  selectWarningNotificationDefinitionId,
} from '../src/notifications/warningNotificationDefinitionSelector.js';

// AC7: D2 区分表と定義 ID 表の整合（総当たり）
test('AC7: classifyWarningNotificationCategory が classified を返す全 36 コードで定義 ID が引け、resolveNotificationMessage が通る', () => {
  const ALL_CLASSIFIED_CODES = [
    // emergency (10)
    '32',
    '33',
    '35',
    '36',
    '37',
    '38',
    '39',
    '43',
    '48',
    '49',
    // question (11)
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '19',
    '29',
    // warning (15)
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
  ];

  assert.equal(ALL_CLASSIFIED_CODES.length, 36);

  for (const code of ALL_CLASSIFIED_CODES) {
    const classification = classifyWarningNotificationCategory(code);
    assert.equal(classification.kind, 'classified', `code ${code} should be classified in D2`);
    if (classification.kind !== 'classified') continue;

    const definitionId = selectIssuedNotificationDefinitionId(code);
    assert.ok(definitionId !== null, `code ${code} should map to a definitionId`);

    // 擬似 Notification で resolveNotificationMessage を呼び出して整合性を確認
    const dummyNotification: WeatherNotification = {
      notificationId: `test-notif-${code}`,
      category: classification.category,
      origin: 'weather',
      changeType: 'new',
      sourceType: 'warning_current',
      sourceVersion: 'v1',
      targets: [
        {
          kind: 'area',
          codeType: 'jma_municipal_warning_area',
          code: '1310800',
          name: '江東区',
        },
      ],
      occurredAt: '2026-09-12T00:00:00Z',
      detectedAt: '2026-09-12T00:00:00Z',
      relatedRefs: [{ type: 'warning_current', ref: '1310800' }],
      detectionContext: 'normal',
      isTraining: false,
    };

    const resolved = resolveNotificationMessage(dummyNotification, {
      definitionId,
      detail: 'レベル３大雨警報',
    });

    assert.equal(resolved.messageDefinition.id, definitionId);
  }
});

test('selectIssuedNotificationDefinitionId: 未定義コードや 00 は null を返す', () => {
  assert.equal(selectIssuedNotificationDefinitionId('00'), null);
  assert.equal(selectIssuedNotificationDefinitionId('99'), null);
  assert.equal(selectIssuedNotificationDefinitionId('XX'), null);
});

test('selectWarningNotificationDefinitionId: 各 changeType に対応する定義 ID を返す', () => {
  assert.equal(selectWarningNotificationDefinitionId('new', '03'), 'weather-warning-issued');
  assert.equal(
    selectWarningNotificationDefinitionId('new', '33'),
    'weather-special-warning-issued',
  );
  assert.equal(selectWarningNotificationDefinitionId('new', '14'), 'weather-advisory-issued');
  assert.equal(selectWarningNotificationDefinitionId('new', null), null);
  assert.equal(
    selectWarningNotificationDefinitionId('strengthened', null),
    'weather-warning-strengthened',
  );
  assert.equal(selectWarningNotificationDefinitionId('weakened', null), 'weather-warning-weakened');
  assert.equal(selectWarningNotificationDefinitionId('released', null), 'weather-warning-released');
  assert.equal(
    selectWarningNotificationDefinitionId('corrected', null),
    'weather-warning-corrected',
  );
  assert.equal(
    selectWarningNotificationDefinitionId('cancelled', null),
    'weather-warning-cancelled',
  );
});
