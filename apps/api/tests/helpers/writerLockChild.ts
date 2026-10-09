import { acquireWriterLock } from '../../src/database/writerLock.js';

const [lockPath] = process.argv.slice(2) as [string];

function attempt(): void {
  try {
    acquireWriterLock(lockPath, {
      pid: process.pid,
      role: 'retained',
      token: `child-${process.pid}`,
      startedAt: new Date().toISOString(),
      serverGenerationId: 'g',
      workerGeneration: null,
      threadId: null,
    });
    process.stdout.write(`OK ${process.pid}\n`);
    // 取得者は生存したまま終了する(他の子が奪えないことの確認のため lock は残す)
  } catch (error) {
    process.stdout.write(`FAIL ${(error as NodeJS.ErrnoException).code ?? 'unknown'}\n`);
  }
  // 取得者が終了すると別の子が正当に引き継ぐため、親が kill するまで生存し続ける
  setInterval(() => undefined, 1000);
}

// 全子プロセスの読み込み完了後に親が開始時刻(epoch ms)を stdin へ送る。その時刻まで待って同時に取得へ入る。
process.stdout.write('READY\n');
process.stdin.once('data', (chunk: Buffer) => {
  const startAt = Number(chunk.toString().trim());
  while (Date.now() < startAt) {
    // busy wait
  }
  attempt();
});
