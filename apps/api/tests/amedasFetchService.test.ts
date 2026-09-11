import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import { AmedasFetchState, runAmedasFetchCycle } from '../src/polling/amedasFetchService.js';
import { findAmedasSnapshot } from '../src/repositories/amedasRepository.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const fixturesDir = join(fileURLToPath(import.meta.url), '../fixtures/jma/amedas');

const latestTimeText = readFileSync(join(fixturesDir, 'amedas_latest_time.txt'), 'utf-8');
const point44136Json = readFileSync(join(fixturesDir, 'amedas_point_44136_block.json'), 'utf-8');
const point44166Json = readFileSync(join(fixturesDir, 'amedas_point_44166_block.json'), 'utf-8');

function setupDb() {
  const context = initializeDatabase({
    databasePath: ':memory:',
    migrationsDirectory,
  });
  return {
    connection: context.connection,
    cleanup: () => context.close(),
  };
}

test('1. 正常系: east の取得・保存・availability', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');
    const calls: string[] = [];

    const mockFetch: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('latest_time.txt')) {
        return new Response(latestTimeText, { status: 200 });
      }
      return new Response(point44136Json, { status: 200 });
    };

    const result = await runAmedasFetchCycle(connection, state, {
      fetchFn: mockFetch,
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    assert.equal(result.latestTime.succeeded, true);
    assert.equal(result.latestTime.availability, 'available');
    assert.equal(result.pointData.succeeded, true);
    assert.equal(result.pointData.availability, 'available');
    assert.ok(result.snapshot);
    assert.equal(result.snapshot.metadata.availability, 'available');

    // fetch_attempt の確認
    const attempts = connection
      .prepare('SELECT source_kind, target_ref, outcome FROM fetch_attempt ORDER BY id ASC')
      .all() as Array<{ source_kind: string; target_ref: string | null; outcome: string }>;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.source_kind, 'amedas_latest_time');
    assert.equal(attempts[0]?.target_ref, null);
    assert.equal(attempts[0]?.outcome, 'success');
    assert.equal(attempts[1]?.source_kind, 'amedas_point');
    assert.equal(attempts[1]?.target_ref, '44136');
    assert.equal(attempts[1]?.outcome, 'success');

    // DB の snapshot
    const saved = findAmedasSnapshot(connection, '44136');
    assert.ok(saved);
    assert.equal(saved.stationCode, '44136');
    assert.equal(saved.stationName, '江戸川臨海');
    assert.equal(saved.metadata.availability, 'available');
    assert.equal(saved.metadata.issuedAt, '2026-09-11T11:40:00.000Z');
    assert.ok(saved.observations.length > 0);
  } finally {
    cleanup();
  }
});

test('2. 地点だけ失敗: 前回正常値の保持と stale availability', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // 1回目: 成功
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    const snap1 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap1);
    const obsCount1 = snap1.observations.length;
    const lastSuccess1 = snap1.metadata.lastSuccessAt;

    // 2回目: 地点ブロックのみ HTTP 500
    const result2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
      },
      clock: () => '2026-09-11T12:05:00.000Z',
    });

    // (a) latestTime.availability === 'available'
    assert.equal(result2.latestTime.availability, 'available');
    // (b) pointData.availability === 'stale'
    assert.equal(result2.pointData.availability, 'stale');
    assert.equal(result2.pointData.errorKind, 'http_status');

    // (c) findAmedasSnapshot の観測行が1回目と同一件数・同一内容で残っている
    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    assert.equal(snap2.metadata.availability, 'stale');
    assert.equal(snap2.observations.length, obsCount1);
    // (d) amedas_snapshot.last_success_at が1回目の時刻のままであること
    assert.equal(snap2.metadata.lastSuccessAt, lastSuccess1);
  } finally {
    cleanup();
  }
});

test('3. 時刻だけ失敗: 地点ブロックを要求せず stale 保持', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // 1回目: 成功
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    const requestedUrls: string[] = [];
    // 2回目: latest_time.txt のみタイムアウト
    const result2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes('latest_time.txt')) {
          const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
          throw err;
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:05:00.000Z',
    });

    // (a) latestTime.availability === 'stale', consecutiveFailures === 1
    assert.equal(result2.latestTime.availability, 'stale');
    assert.equal(result2.latestTime.consecutiveFailures, 1);
    assert.equal(result2.latestTime.errorKind, 'timeout');
    // (b) 地点ブロックへの HTTP リクエストが発行されていないこと
    assert.equal(
      requestedUrls.some((u) => u.includes('/point/')),
      false,
    );
    // (c) skipReason === 'latest_time_failed'
    assert.equal(result2.pointData.skipReason, 'latest_time_failed');
    // (d) 観測行が1回目のまま残っていること
    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    assert.ok(snap2.observations.length > 0);
  } finally {
    cleanup();
  }
});

test('4. 初回から両方失敗: unavailable となり例外を投げない', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    const result = await runAmedasFetchCycle(connection, state, {
      fetchFn: async () => {
        throw new Error('Network failure');
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    assert.equal(result.latestTime.availability, 'unavailable');
    assert.equal(result.pointData.availability, 'unavailable');
    const snap = findAmedasSnapshot(connection, '44136');
    assert.ok(snap);
    assert.equal(snap.metadata.availability, 'unavailable');
    assert.equal(snap.observations.length, 0);
  } finally {
    cleanup();
  }
});

test('5. unavailable でデータを消さない: 正常後に両方失敗しても stale にとどまる', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // 1回目: 正常
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    const snap1 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap1);
    const count1 = snap1.observations.length;

    // 2回目: 両方失敗 (12:15:00 で staleAfterSeconds 600秒を超過)
    const result2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async () => {
        throw new Error('Network failure');
      },
      clock: () => '2026-09-11T12:15:00.000Z',
    });

    assert.equal(result2.latestTime.availability, 'stale');
    assert.equal(result2.pointData.availability, 'stale');
    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    assert.equal(snap2.metadata.availability, 'stale');
    assert.equal(snap2.observations.length, count1, '観測行が消えないこと');
  } finally {
    cleanup();
  }
});

test('6. stale の期限: staleAfterSeconds を超えると stale へ落ち fetched_at が更新される', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // 1回目: 正常 (12:00:00)
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
      staleAfterSeconds: 600,
    });

    // 2回目: 12:15:00 (900秒後 > 600秒) で時刻取得失敗
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async () => {
        throw new Error('Network failure');
      },
      clock: () => '2026-09-11T12:15:00.000Z',
      staleAfterSeconds: 600,
    });

    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    assert.equal(snap2.metadata.availability, 'stale');
    assert.equal(snap2.metadata.fetchedAt, '2026-09-11T12:15:00.000Z');
    assert.ok(snap2.observations.length > 0, '観測行は保持される');
  } finally {
    cleanup();
  }
});

test('7. 構造異常の検出: invalid_structure と outcome failure', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    const result = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response(latestTimeText, { status: 200 });
        }
        // 不正なJSON
        return new Response('{"badKey": 123}', { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    assert.equal(result.pointData.errorKind, 'invalid_structure');
    const attempt = connection
      .prepare("SELECT error_kind, outcome FROM fetch_attempt WHERE source_kind = 'amedas_point'")
      .get() as { error_kind: string; outcome: string };
    assert.equal(attempt.error_kind, 'invalid_structure');
    assert.equal(attempt.outcome, 'failure');
  } finally {
    cleanup();
  }
});

test('8. 蓄積とマージ: 重複排除、上書き、保持期間超過の prune', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // 1回目
    await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
      retentionHours: 25,
    });

    const snap1 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap1);
    const count1 = snap1.observations.length;

    // 2回目: 同じブロックだが、1つの値（20260911204000 の temp）を書き換えたデータ
    const modifiedObj = JSON.parse(point44136Json) as Record<string, Record<string, unknown>>;
    modifiedObj['20260911204000']!['temp'] = [99.9, 0];
    const modifiedJson = JSON.stringify(modifiedObj);

    const result2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(modifiedJson, { status: 200 });
      },
      clock: () => '2026-09-11T12:05:00.000Z',
      retentionHours: 25,
    });
    assert.equal(result2.pointData.succeeded, true);

    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    // 重複せず件数は同じ
    assert.equal(snap2.observations.length, count1);
    // 新しい値で上書きされていること
    const updatedTemp = snap2.observations.find(
      (o) => o.observedAt === '2026-09-11T11:40:00.000Z' && o.element === 'temp',
    );
    assert.ok(updatedTemp);
    assert.equal(updatedTemp.valueNumber, 99.9);

    // 保持期間超過の prune 検証: retentionHours = 1 に設定して実行
    // 最新観測時刻（11:40Z）から1時間以上前の観測行が除外される
    const result3 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(modifiedJson, { status: 200 });
      },
      clock: () => '2026-09-11T12:10:00.000Z',
      retentionHours: 1,
    });
    assert.ok(result3.pointData.prunedObservationCount! > 0);
    const snap3 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap3);
    assert.ok(snap3.observations.length < count1);
  } finally {
    cleanup();
  }
});

test('9. trc（羽田）のサイクル: 44136 へのリクエストが一切なく、44166 のみ保存される', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('trc');
    const requestedUrls: string[] = [];

    const mockFetch: typeof fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes('latest_time.txt')) {
        return new Response(latestTimeText, { status: 200 });
      }
      return new Response(point44166Json, { status: 200 });
    };

    const result = await runAmedasFetchCycle(connection, state, {
      fetchFn: mockFetch,
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    assert.equal(result.pointData.succeeded, true);
    // 発行された URL に 44136 が一度も現れないこと
    assert.equal(
      requestedUrls.some((u) => u.includes('44136')),
      false,
    );
    assert.ok(requestedUrls.some((u) => u.includes('44166')));

    // amedas_snapshot の確認
    const snapTrc = findAmedasSnapshot(connection, '44166');
    assert.ok(snapTrc);
    assert.equal(snapTrc.stationCode, '44166');
    assert.equal(snapTrc.stationName, '羽田');
    // 羽田には humidity がないこと
    assert.equal(
      snapTrc.observations.some((o) => o.element === 'humidity'),
      false,
    );
    // is_estimated === true の行が1件も無いこと
    assert.equal(
      snapTrc.observations.some((o) => o.isEstimated),
      false,
    );

    // fetch_attempt の target_ref が 44166
    const attempt = connection
      .prepare("SELECT target_ref FROM fetch_attempt WHERE source_kind = 'amedas_point'")
      .get() as { target_ref: string };
    assert.equal(attempt.target_ref, '44166');
  } finally {
    cleanup();
  }
});

test('10. pointFetchPolicy: onLatestTimeChange によるスキップ', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');
    let pointFetchCount = 0;

    const mockFetch: typeof fetch = async (url) => {
      if (String(url).includes('latest_time.txt')) {
        return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
      }
      pointFetchCount++;
      return new Response(point44136Json, { status: 200 });
    };

    // 1回目
    await runAmedasFetchCycle(connection, state, {
      fetchFn: mockFetch,
      pointFetchPolicy: 'onLatestTimeChange',
    });
    assert.equal(pointFetchCount, 1);

    // 2回目: latest_time が同じ
    const res2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: mockFetch,
      pointFetchPolicy: 'onLatestTimeChange',
    });
    assert.equal(pointFetchCount, 1, 'ブロック取得がスキップされること');
    assert.equal(res2.pointData.skipReason, 'latest_time_unchanged');
  } finally {
    cleanup();
  }
});

test('11. 連続する2ブロックの蓄積と valid_at / valid_from / valid_to の検証', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const state = new AmedasFetchState('east');

    // _15 ブロック相当のデータを作成（キーを 20260911150000 〜 20260911175000 にしたデータ）
    const parsed18 = JSON.parse(point44136Json) as Record<string, unknown>;
    const block15Data: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed18)) {
      const h = parseInt(key.slice(8, 10), 10);
      if (h <= 18) {
        // 時刻を 3時間引いたキーにする
        const newKey = `${key.slice(0, 8)}${String(h - 3).padStart(2, '0')}${key.slice(10)}`;
        block15Data[newKey] = val;
      }
    }
    const block15Json = JSON.stringify(block15Data);

    // 1回目: _15 ブロック（最新 17:50 JST = 08:50 UTC）
    const res1 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T17:50:00+09:00', { status: 200 });
        }
        return new Response(block15Json, { status: 200 });
      },
      clock: () => '2026-09-11T09:00:00.000Z',
      retentionHours: 25,
    });
    assert.ok(res1.snapshot);
    const count1 = res1.snapshot.observations.length;

    // 2回目: _18 ブロック（最新 20:40 JST = 11:40 UTC）
    const res2 = await runAmedasFetchCycle(connection, state, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
      retentionHours: 25,
    });
    assert.equal(res2.pointData.succeeded, true);

    const snap2 = findAmedasSnapshot(connection, '44136');
    assert.ok(snap2);
    // 両ブロックの観測行が蓄積されていること
    assert.ok(snap2.observations.length > count1);

    // valid_from, valid_to, valid_at, issued_at の検証
    const obsList = snap2.observations;
    const oldestObsAt = obsList[0]?.observedAt;
    const latestObsAt = obsList[obsList.length - 1]?.observedAt;

    assert.equal(snap2.metadata.validFrom, oldestObsAt);
    assert.equal(snap2.metadata.validTo, latestObsAt);
    assert.equal(snap2.metadata.validAt, latestObsAt);
    assert.equal(snap2.metadata.issuedAt, '2026-09-11T11:40:00.000Z');
  } finally {
    cleanup();
  }
});

test('12. 推計フラグ保存結果のDBクエリ検証', async () => {
  const { connection, cleanup } = setupDb();
  try {
    const stateEast = new AmedasFetchState('east');
    await runAmedasFetchCycle(connection, stateEast, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(point44136Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    // east で保存後、SELECT DISTINCT element FROM amedas_observation WHERE is_estimated = 1 が sun10m / sun1h のみを返すこと
    const eastEstimatedElements = (
      connection
        .prepare(
          'SELECT DISTINCT element FROM amedas_observation WHERE is_estimated = 1 ORDER BY element ASC',
        )
        .all() as Array<{ element: string }>
    ).map((r) => r.element);
    assert.deepEqual(eastEstimatedElements, ['sun10m', 'sun1h']);

    // trc のサイクルを実行
    const stateTrc = new AmedasFetchState('trc');
    await runAmedasFetchCycle(connection, stateTrc, {
      fetchFn: async (url) => {
        if (String(url).includes('latest_time.txt')) {
          return new Response('2026-09-11T20:40:00+09:00', { status: 200 });
        }
        return new Response(point44166Json, { status: 200 });
      },
      clock: () => '2026-09-11T12:00:00.000Z',
    });

    // trc（44166）のスナップショットに紐づく amedas_observation で is_estimated = 1 の行が0件であること
    const trcEstimatedCount = (
      connection
        .prepare(
          `SELECT COUNT(*) as count FROM amedas_observation obs
           JOIN amedas_snapshot snap ON obs.snapshot_id = snap.id
           WHERE snap.station_code = '44166' AND obs.is_estimated = 1`,
        )
        .get() as { count: number }
    ).count;
    assert.equal(trcEstimatedCount, 0);
  } finally {
    cleanup();
  }
});
