import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticTileDeliveryProfileService } from '../src/services/tileDeliveryProfileService.js';
import { createNowcastApiService } from '../src/services/nowcastApiService.js';
import { createKikikuruApiService } from '../src/services/kikikuruApiService.js';

const eastTerminal = {
  id: 'hkeagh01',
  venueId: 'east' as const,
  mode: 'H' as const,
};
const trcTerminal = {
  id: 'htrcph01',
  venueId: 'trc' as const,
  mode: 'H' as const,
};

test('静的タイル配信プロファイルは端末によらず設定値を返すこと', () => {
  const proxy = createStaticTileDeliveryProfileService('proxy');
  const direct = createStaticTileDeliveryProfileService('jma-direct');
  assert.equal(proxy.getProfile(eastTerminal), 'proxy');
  assert.equal(proxy.getProfile(trcTerminal), 'proxy');
  assert.equal(direct.getProfile(eastTerminal), 'jma-direct');
  assert.equal(direct.getProfile(trcTerminal), 'jma-direct');
});

test('unsupported_control_status 応答にも注入したプロファイルを含めること', () => {
  const profileService = createStaticTileDeliveryProfileService('jma-direct');
  const nowcast = createNowcastApiService({
    getService: () => null,
    enablePolling: true,
    tileDeliveryProfileService: profileService,
  });
  const kikikuru = createKikikuruApiService({
    getService: () => null,
    enablePolling: true,
    tileDeliveryProfileService: profileService,
  });
  assert.equal(nowcast.getTimes(eastTerminal, 'training').tileDeliveryProfile, 'jma-direct');
  assert.equal(kikikuru.getTimes(trcTerminal, 'test').tileDeliveryProfile, 'jma-direct');
});
