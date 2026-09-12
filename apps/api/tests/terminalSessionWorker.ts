import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../src/database/index.js';
import { recordTerminalSessionInquiry } from '../src/repositories/terminalSessionRepository.js';

interface WorkerData {
  databasePath: string;
  sessionId: string;
  inquiredAt: string;
  syncBuffer: SharedArrayBuffer;
}

const { databasePath, sessionId, inquiredAt, syncBuffer } = workerData as WorkerData;
const syncArray = new Int32Array(syncBuffer);

// 親スレッドからの開始シグナル（値が 1 になる）を待機
Atomics.wait(syncArray, 0, 0);

const connection = openDatabase(databasePath);
let result;
const maxAttempts = 100;

for (let attempt = 0; attempt < maxAttempts; attempt++) {
  try {
    result = recordTerminalSessionInquiry(connection, sessionId, inquiredAt);
    break;
  } catch (err: unknown) {
    if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_BUSY') {
      // SQLite BUSY は成功値に変換せず、テスト側（worker内）でバックオフ再試行
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        5 + Math.floor(Math.random() * 10),
      );
      continue;
    }
    connection.close();
    throw err;
  }
}

connection.close();

if (!result) {
  throw new Error('Exceeded maxAttempts to record terminal session inquiry due to SQLITE_BUSY');
}

parentPort?.postMessage(result);
