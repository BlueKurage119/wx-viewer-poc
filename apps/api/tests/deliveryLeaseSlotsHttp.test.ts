import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, ServerResponse } from 'node:http';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { createApp } from '../src/app.js';
import { DeliveryTransport } from '../src/runtime/deliveryTransport.js';
import type { DeliveryHttpResult } from '../src/runtime/deliveryContracts.js';

const epoch = {
  serverGenerationId: 'server',
  workerGeneration: 'delivery',
  weatherDatabaseGenerationId: 'database',
  readerEpoch: 'reader',
};

for (const kind of ['json', 'png'] as const) {
  test(
    `遅い小${kind === 'json' ? 'JSON' : 'PNG'} HTTP送信は64要求枠を保持し65件目を拒否する`,
    { timeout: 10_000 },
    async () => {
      const { port1, port2 } = new MessageChannel();
      const bytes =
        kind === 'json'
          ? new TextEncoder().encode('{"status":"ok"}')
          : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const contentType = kind === 'json' ? 'application/json; charset=utf-8' : 'image/png';
      const serverTransport = new DeliveryTransport(
        port2,
        async () => ({ __deliveryHttp: { statusCode: 200, contentType, bytes, headers: {} } }),
        () => {},
      );
      const clientTransport = new DeliveryTransport(
        port1,
        async () => null,
        () => {},
      );
      const read = () =>
        clientTransport.call<DeliveryHttpResult>(
          randomUUID(),
          epoch,
          'read.http',
          { kind },
          5000,
          true,
        );
      const originalEnd = ServerResponse.prototype.end;
      const held: Array<() => void> = [];
      const heldCount = () => held.length;
      const activeCount = () => clientTransport.size;
      ServerResponse.prototype.end = function (
        this: ServerResponse,
        chunk?: unknown,
        ...args: unknown[]
      ) {
        if (chunk instanceof Uint8Array && chunk.byteLength === bytes.byteLength) {
          held.push(() => {
            originalEnd.apply(this, [chunk, ...args] as Parameters<typeof originalEnd>);
          });
          return this;
        }
        return originalEnd.apply(this, [chunk, ...args] as Parameters<typeof originalEnd>);
      } as typeof originalEnd;
      const registry = {
        resolveTerminal: (id: string) =>
          id === 'hkeagh01' ? { id, name: '試験端末', mode: 'H', venueId: 'east' } : null,
      };
      const http = createServer(
        createApp({
          terminalRegistry: registry as never,
          weatherApi: { getWarnings: () => null } as never,
          weatherHttp: async () => read(),
          nowcastApi: {
            async getTile() {
              const result = await read();
              return {
                kind: 'success',
                buffer: result.bytes,
                release: result.release,
                catalogAvailability: 'available',
                tileResult: 'cached',
                storedAt: '2026-10-09T00:00:00.000Z',
              };
            },
          } as never,
        }),
      );
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const url =
        kind === 'json'
          ? `${base}/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal`
          : `${base}/api/weather/nowcast/N1/tiles/10/1/1.png?terminalId=hkeagh01&controlStatus=normal&baseTime=2026-10-09T00:00:00.000Z&validTime=2026-10-09T00:00:00.000Z`;
      try {
        const requests = Array.from({ length: 64 }, () => fetch(url));
        const deadline = performance.now() + 3000;
        while (held.length < 64) {
          assert.ok(performance.now() < deadline, `保持数=${held.length}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(clientTransport.size, 64);
        const overflow = await fetch(url, { signal: AbortSignal.timeout(1200) });
        assert.equal(overflow.status, 503);
        assert.equal(held.length, 64);
        for (const send of held.splice(0)) send();
        const responses = await Promise.all(requests);
        assert.deepEqual([...new Set(responses.map((response) => response.status))], [200]);
        await Promise.all(responses.map((response) => response.arrayBuffer()));
        const released = performance.now() + 1000;
        while (activeCount() !== 0) {
          assert.ok(performance.now() < released, '送信完了後に要求枠が解放されません');
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const nextRequest = fetch(url);
        const nextDeadline = performance.now() + 1000;
        while (heldCount() === 0) {
          assert.ok(performance.now() < nextDeadline, '解放後の次要求が送信段階へ進みません');
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        for (const send of held.splice(0)) send();
        const next = await nextRequest;
        assert.equal(next.status, 200);
        await next.arrayBuffer();
      } finally {
        ServerResponse.prototype.end = originalEnd;
        for (const send of held.splice(0)) send();
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
        clientTransport.close();
        serverTransport.close();
        port1.close();
        port2.close();
      }
    },
  );
}
