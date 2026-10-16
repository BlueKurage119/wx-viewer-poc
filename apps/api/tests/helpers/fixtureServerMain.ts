import { startWorkerServer } from '../../src/runtime/startWorkerServer.js';
import {
  testPollingConfigUrl,
  testTerminalConfigUrl,
  testVenueConfigUrl,
} from './venueConfigPreload.js';

// src/server.ts 末尾の本番エントリ相当。会場・端末設定だけテスト用fixtureを明示注入する。
void startWorkerServer({
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  shutdownSignalSource: process,
  venueConfigUrl: testVenueConfigUrl,
  terminalConfigUrl: testTerminalConfigUrl,
  // 既定のpolling設定読込そのものを検証する子プロセス(pollingConfigPreload.mjs併用)は既定URLを使う
  configUrl: process.env.WX_TEST_DEFAULT_POLLING_CONFIG === '1' ? undefined : testPollingConfigUrl,
})
  .then((server) => {
    console.log(`[api] listening on http://localhost:${server.port} (initial sync in progress)`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
