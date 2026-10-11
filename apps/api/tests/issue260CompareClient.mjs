import { performance } from 'node:perf_hooks';

const [port, output, series, tileTime] = process.argv.slice(2);
const root = `http://127.0.0.1:${port}`;
const paths = {
  health: '/api/health',
  monitoring: '/api/monitoring/status?terminalId=hkeagh01',
  systemDelta: '/api/notifications/delta?origin=system&terminalId=hkeagh01',
  weather: '/api/weather/warnings?terminalId=hkeagh01&controlStatus=normal',
  tileHit: `/api/weather/nowcast/N1/tiles/10/0/0.png?terminalId=hkeagh01&controlStatus=normal&baseTime=${tileTime}&validTime=${tileTime}`,
};
if (!paths[series]) throw new Error('比較対象のAPI系列が不正です');
const startedAt = new Date().toISOString();
const started = performance.now();
const samples = [];
const requests = Array.from(
  { length: 600 },
  (_, i) =>
    new Promise((resolve) => {
      setTimeout(async () => {
        const at = performance.now();
        try {
          const response = await fetch(root + paths[series], {
            signal: AbortSignal.timeout(30000),
          });
          const body = await response.arrayBuffer();
          const hash = await crypto.subtle.digest('SHA-256', body);
          samples.push({
            index: i,
            offsetMs: at - started,
            latencyMs: performance.now() - at,
            status: response.status,
            bytes: body.byteLength,
            bodyHash: Buffer.from(hash).toString('hex'),
            tileResult: response.headers.get('x-wx-tile-result'),
            responseBody:
              response.status === 200 ? null : Buffer.from(body).toString('utf8').slice(0, 200),
          });
        } catch (error) {
          const cause = error instanceof Error ? error.cause : null;
          samples.push({
            index: i,
            offsetMs: at - started,
            latencyMs: performance.now() - at,
            status: null,
            bytes: 0,
            error: String(error),
            cause: cause ? String(cause) : null,
            causeCode: cause && typeof cause === 'object' && 'code' in cause ? cause.code : null,
            causeErrors:
              cause instanceof AggregateError
                ? cause.errors.slice(0, 5).map((item) => String(item))
                : null,
          });
        }
        resolve();
      }, i * 100);
    }),
);
await Promise.all(requests);
samples.sort((a, b) => a.index - b.index);
const fs = await import('node:fs');
fs.writeFileSync(
  output,
  JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), samples }, null, 2),
);
