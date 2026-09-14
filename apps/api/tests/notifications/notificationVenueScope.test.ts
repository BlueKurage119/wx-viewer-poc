import assert from 'node:assert/strict';
import test from 'node:test';
import type { NotificationTarget } from '@wx-viewer-poc/shared';
import { resolveNotificationVenueScope } from '../../src/notifications/notificationVenueScope.js';

test('resolveNotificationVenueScope: 規則1 codeType===venue のとき該当会場を解決する', () => {
  const targetsEast: NotificationTarget[] = [
    { kind: 'area', codeType: 'venue', code: 'east', name: '東京ビッグサイト' },
  ];
  const resultEast = resolveNotificationVenueScope(targetsEast);
  assert.deepEqual(resultEast, { kind: 'venue', venueIds: ['east'] });

  const targetsTrc: NotificationTarget[] = [
    { kind: 'area', codeType: 'venue', code: 'trc', name: '東京流通センター' },
  ];
  const resultTrc = resolveNotificationVenueScope(targetsTrc);
  assert.deepEqual(resultTrc, { kind: 'venue', venueIds: ['trc'] });

  // 無効な venueId は規則1に該当せず、後続規則または unresolved になる
  const targetsInvalid: NotificationTarget[] = [
    { kind: 'area', codeType: 'venue', code: 'invalid_venue', name: '無効会場' },
  ];
  const resultInvalid = resolveNotificationVenueScope(targetsInvalid);
  assert.deepEqual(resultInvalid, { kind: 'unresolved' });
});

test('resolveNotificationVenueScope: 規則2 codeType===jma_municipal_warning_area のとき市町村コードから会場を解決する', () => {
  // 1310800 = 江東区 -> east
  const targetsKoto: NotificationTarget[] = [
    { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
  ];
  const resultKoto = resolveNotificationVenueScope(targetsKoto);
  assert.deepEqual(resultKoto, { kind: 'venue', venueIds: ['east'] });

  // 1311100 = 大田区 -> trc
  const targetsOta: NotificationTarget[] = [
    { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1311100', name: '大田区' },
  ];
  const resultOta = resolveNotificationVenueScope(targetsOta);
  assert.deepEqual(resultOta, { kind: 'venue', venueIds: ['trc'] });

  // 両方含まれる場合
  const targetsBoth: NotificationTarget[] = [
    { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
    { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1311100', name: '大田区' },
  ];
  const resultBoth = resolveNotificationVenueScope(targetsBoth);
  assert.deepEqual(resultBoth, { kind: 'venue', venueIds: ['east', 'trc'] });

  // 会場対象外の市町村コード
  const targetsOther: NotificationTarget[] = [
    { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310100', name: '千代田区' },
  ];
  const resultOther = resolveNotificationVenueScope(targetsOther);
  assert.deepEqual(resultOther, { kind: 'unresolved' });
});

test('resolveNotificationVenueScope: 規則3 全要素が kind===equipment のとき global を返す', () => {
  const targetsEquipment: NotificationTarget[] = [
    {
      kind: 'equipment',
      codeType: 'wx-viewer-poc/fetch-source',
      code: 'jma-xml',
      name: '気象庁XML取得元',
    },
  ];
  const result = resolveNotificationVenueScope(targetsEquipment);
  assert.deepEqual(result, { kind: 'global' });
});

test('resolveNotificationVenueScope: 規則4 上記に当たらない場合は unresolved を返す', () => {
  const targetsUnknown: NotificationTarget[] = [
    { kind: 'area', codeType: 'unknown_code_type', code: '999999', name: '未知' },
  ];
  assert.deepEqual(resolveNotificationVenueScope(targetsUnknown), { kind: 'unresolved' });
  assert.deepEqual(resolveNotificationVenueScope([]), { kind: 'unresolved' });
  assert.deepEqual(resolveNotificationVenueScope(null as unknown as NotificationTarget[]), {
    kind: 'unresolved',
  });
});
