// 実の取得Workerを、外部通信だけ空のAtomフィードを返す偽の fetch に差し替えて起動する結合試験用入口。
const emptyFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>空のフィード</title>
  <updated>2026-01-01T00:00:00Z</updated>
  <id>training-test-empty-feed</id>
</feed>`;

globalThis.fetch = (async () =>
  new Response(emptyFeed, {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  })) as typeof fetch;

await import('../../../src/runtime/acquisitionWorker.js');
