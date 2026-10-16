import { startWorkerServer } from '../../src/runtime/startWorkerServer.js';
import { testTerminalConfigUrl, testVenueConfigUrl } from './venueConfigPreload.js';

// src/server.ts 末尾の本番エントリ相当。会場・端末設定だけテスト用fixtureを明示注入する。
void startWorkerServer({
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  shutdownSignalSource: process,
  venueConfigUrl: testVenueConfigUrl,
  terminalConfigUrl: testTerminalConfigUrl,
})
  .then((server) => {
    console.log(`[api] listening on http://localhost:${server.port} (initial sync in progress)`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
