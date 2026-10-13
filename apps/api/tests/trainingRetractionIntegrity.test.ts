import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  isTrainingFetchAttempt,
  isTrainingNotification,
  isTrainingReception,
  listAcceptanceFetchAttempts,
  listAcceptanceOutputHistory,
  listAcceptanceReceptions,
  TRAINING_SOURCE_KINDS,
} from '../src/acceptance/trainingExclusion.js';
import type { DatabaseConnection } from '../src/database/index.js';
import { ingestTelegramDocument } from '../src/polling/jmaXmlPoller.js';
import { listBosaiBulletins } from '../src/repositories/bosaiBulletinRepository.js';
import { recordNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import { findWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import { listWarningCurrentStreams } from '../src/repositories/warningCurrentStreamRepository.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { generateTrainingWarningBaseline } from '../src/training/trainingWarningBaseline.js';
import {
  count,
  fixedClock,
  inject,
  retract,
  retractionCommand,
  setupDb,
} from './helpers/trainingRetraction.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

const GEN_TIME = '2026-10-12T09:00:00.000Z';
const WINDOW = { from: '2026-10-12T00:00:00.000Z', to: '2026-10-12T23:59:59.999Z' };

/** 通常の電文として投入する（Status を通常にし、通常フィード扱い）。 */
async function ingestNormal(
  db: ReturnType<typeof setupDb>,
  xml: string,
  type: string,
  id: string,
  feedKind = 'regular',
) {
  const normalXml = xml.replace('<Status>訓練</Status>', '<Status>通常</Status>');
  const reception = await ingestTelegramDocument(
    db.weather.connection,
    {
      documentUrl: `https://www.data.jma.go.jp/developer/xml/data/20261012${id}_0_${type}_130000.xml`,
      xml: normalXml,
      feedKind,
      feedEntryId: id,
      fetchAttemptId: null,
      receivedAt: '2026-10-12T09:30:00.000Z',
      bodyBytes: Buffer.byteLength(normalXml),
      contentHash: createHash('sha256').update(normalXml).digest('hex'),
    },
    { venueRegistry: testVenueRegistry, clock: fixedClock() },
  );
  return reception;
}

function addHistory(db: ReturnType<typeof setupDb>, id: string, isTraining: boolean) {
  recordNotificationOutputHistory(db.retained.connection, {
    weatherDatabaseGenerationId: db.weatherDatabaseGenerationId,
    notificationId: id,
    category: 'warning',
    sourceType: 'weather_warning',
    sourceVersion: null,
    targetAreaJson: null,
    occurredAt: '2026-10-12T09:30:00.000Z',
    detectedAt: '2026-10-12T09:30:00.000Z',
    changeType: 'issued',
    ackRequired: false,
    summary: id,
    relatedRefsJson: '[]',
    origin: 'weather',
    detectionContext: 'normal',
    isTraining,
    messageDefinitionId: null,
    messageDefinitionVersion: null,
  });
}

/** 通常（normal）側の状態と、訓練以外の記録のダンプ。 */
function dumpNormal(db: ReturnType<typeof setupDb>) {
  const w = db.weather.connection;
  const rows = (sql: string) => w.prepare(sql).all();
  return JSON.stringify({
    snapshot: findWarningCurrentSnapshot(w, '1310800', 'normal'),
    streams: listWarningCurrentStreams(w, '130000', '1310800', 'normal'),
    bulletins: listBosaiBulletins(w, { controlStatus: 'normal' }),
    receptions: rows("SELECT * FROM telegram_reception WHERE feed_kind <> 'training' ORDER BY id"),
    attempts: rows(
      "SELECT * FROM fetch_attempt WHERE source_kind NOT IN ('training_injection','training_retraction') ORDER BY id",
    ),
    history: db.retained.connection
      .prepare('SELECT * FROM notification_output_history WHERE is_training = 0 ORDER BY id')
      .all(),
  });
}

const PRESERVED_TABLES: readonly [string, 'weather' | 'retained'][] = [
  ['telegram_reception', 'weather'],
  ['telegram_reception_adoption', 'weather'],
  ['fetch_attempt', 'weather'],
  ['training_injection', 'weather'],
  ['training_injection_reception', 'weather'],
  ['notification_output_history', 'retained'],
];

function snapshotTables(db: ReturnType<typeof setupDb>) {
  const result = new Map<string, unknown[]>();
  for (const [table, which] of PRESERVED_TABLES) {
    const connection: DatabaseConnection = db[which].connection;
    result.set(table, connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }
  return result;
}

test('行抹消・全抹消の前後で受信・取得試行・注入記録・出力履歴は物理削除されず、既存行の内容も不変', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    addHistory(db, 'normal-1', false);
    addHistory(db, 'training-1', true);
    const a = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    await inject(db.weather.connection, ['warning-14', 'bulletin-linear-occurrence'], {
      now: '2026-10-12T09:20:00.000Z',
      clock,
    });
    const bulletinRowsBefore = count(db.weather.connection, 'bosai_bulletin');

    let before = snapshotTables(db);
    await retract(
      db.weather.connection,
      retractionCommand('training', [a.command.trainingId]),
      clock,
    );
    let after = snapshotTables(db);
    for (const [table] of PRESERVED_TABLES) {
      const prev = before.get(table)!;
      const next = after.get(table)!;
      assert.ok(next.length >= prev.length, `${table} の行数が減っていない`);
      assert.deepEqual(next.slice(0, prev.length), prev, `${table} の既存行が不変`);
    }
    assert.ok(count(db.weather.connection, 'bosai_bulletin') >= bulletinRowsBefore);

    before = after;
    await retract(db.weather.connection, retractionCommand('all'), clock);
    after = snapshotTables(db);
    for (const [table] of PRESERVED_TABLES) {
      const prev = before.get(table)!;
      const next = after.get(table)!;
      assert.ok(next.length >= prev.length);
      assert.deepEqual(next.slice(0, prev.length), prev);
    }
    // 取消電文の分だけ増えている（受信・取得試行は増加のみ）
    assert.ok(after.get('telegram_reception')!.length > before.get('telegram_reception')!.length);
    assert.ok(count(db.weather.connection, 'bosai_bulletin') >= bulletinRowsBefore);
  } finally {
    db.close();
  }
});

test('本番データ不変: 通常の現況・速報・出力履歴・通常フィード由来の記録は 注入→行抹消→全抹消 で変わらない', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const [warning, tornado] = generateTrainingTelegrams(['warning-03', 'bulletin-tornado'], {
      now: '2026-10-12T08:00:00.000Z',
      generationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    const baseline = generateTrainingWarningBaseline({
      reportDateTime: '2026-10-12T07:50:00.000Z',
      controlDateTime: '2026-10-12T07:50:00.000Z',
    });
    await ingestNormal(db, baseline, 'VPWS50', '0750');
    await ingestNormal(db, warning!.xml, 'VPWW55', '0800');
    await ingestNormal(db, tornado!.xml, 'VPHW50', '0801');
    addHistory(db, 'normal-1', false);
    addHistory(db, 'training-1', true);

    const initial = dumpNormal(db);
    // 通常側にデータが実在する（空同士の比較になっていない）
    const parsed = JSON.parse(initial);
    assert.equal(parsed.snapshot.items.length, 1);
    assert.equal(parsed.bulletins.length, 1);
    assert.equal(parsed.history.length, 1);
    assert.ok(parsed.receptions.length >= 3);

    const first = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    assert.equal(dumpNormal(db), initial, '注入後');
    await retract(
      db.weather.connection,
      retractionCommand('training', [first.command.trainingId]),
      clock,
    );
    assert.equal(dumpNormal(db), initial, '行抹消後');
    await inject(db.weather.connection, ['warning-14'], {
      now: '2026-10-12T09:40:00.000Z',
      clock,
    });
    await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.equal(dumpNormal(db), initial, '全抹消後');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 直接削除の経路が無いこと
// ---------------------------------------------------------------------------

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : [],
  );
}

test('抹消の実装に DELETE 文・.delete( 呼び出しが無い', () => {
  const src = join(import.meta.dirname, '../src');
  const files = [
    ...sourceFiles(join(src, 'training')),
    join(src, 'services/trainingRetractionService.ts'),
    join(src, 'repositories/trainingRetractionRepository.ts'),
    join(src, 'repositories/trainingInjectionRepository.ts'),
    join(src, 'services/trainingInjectionHideService.ts'),
  ];
  assert.ok(files.length >= 10);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /DELETE|\.delete\(/, file);
  }
});

// ---------------------------------------------------------------------------
// J5: 受入条件検証の除外関数
// ---------------------------------------------------------------------------

test('一覧から外す実装は INSERT だけ: training_injection の status 更新以外に UPDATE が無い', () => {
  const src = join(import.meta.dirname, '../src');
  const text = readFileSync(join(src, 'repositories/trainingInjectionRepository.ts'), 'utf8');
  assert.equal((text.match(/UPDATE/g) ?? []).length, 1);
  assert.match(text, /UPDATE training_injection\s+SET status/);
  assert.doesNotMatch(text, /UPDATE[^`]*training_injection_list_hidden/);
});

test('J5: listAcceptance* は訓練（注入・取消・気象庁実配信の訓練）を除き、述語関数は SQL の結果と一致する。抹消の前後で結果は不変', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const [warning, tornado, real] = generateTrainingTelegrams(
      ['warning-03', 'bulletin-tornado', 'warning-14'],
      { now: '2026-10-12T08:00:00.000Z', generationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    );
    // 通常: 通常の警報・速報
    const normalBaseline = generateTrainingWarningBaseline({
      reportDateTime: '2026-10-12T07:50:00.000Z',
      controlDateTime: '2026-10-12T07:50:00.000Z',
    });
    await ingestNormal(db, normalBaseline, 'VPWS50', '0750');
    const normalWarning = await ingestNormal(db, warning!.xml, 'VPWW55', '0800');
    await ingestNormal(db, tornado!.xml, 'VPHW50', '0801');
    // 気象庁の実配信の訓練（feed_kind は通常値、Status=訓練）
    const realTraining = await ingestTelegramDocument(
      db.weather.connection,
      {
        documentUrl:
          'https://www.data.jma.go.jp/developer/xml/data/202610120802_0_VPWW56_130000.xml',
        xml: real!.xml,
        feedKind: 'regular',
        feedEntryId: '0802',
        fetchAttemptId: null,
        receivedAt: '2026-10-12T09:30:00.000Z',
        bodyBytes: 1,
        contentHash: createHash('sha256').update(real!.xml).digest('hex'),
      },
      { venueRegistry: testVenueRegistry, clock },
    );
    // Control が読めず control_status が NULL の電文: feed_kind が training なら除外、通常値なら対象に残る
    const invalid = async (feedKind: string, id: string) =>
      ingestTelegramDocument(
        db.weather.connection,
        {
          documentUrl: `https://www.data.jma.go.jp/developer/xml/data/20261012${id}_0_VPWW55_130000.xml`,
          xml: '<broken/>',
          feedKind,
          feedEntryId: id,
          fetchAttemptId: null,
          receivedAt: '2026-10-12T09:30:00.000Z',
          bodyBytes: 9,
          contentHash: createHash('sha256').update('<broken/>').digest('hex'),
        },
        { venueRegistry: testVenueRegistry, clock },
      );
    const invalidTraining = await invalid('training', '0810');
    const invalidRegular = await invalid('regular', '0811');
    assert.equal(invalidTraining.controlStatus, null);
    assert.equal(invalidRegular.controlStatus, null);
    // 通常の取得試行（フィード取得）
    db.weather.connection
      .prepare(
        `INSERT INTO fetch_attempt (source_kind, target_ref, request_url, trigger_kind, attempt_no, started_at, finished_at, duration_ms, outcome)
         VALUES ('jma_xml_feed', 'regular', 'https://example.invalid/feed', 'scheduled', 1, '2026-10-12T09:30:00.000Z', '2026-10-12T09:30:01.000Z', 1000, 'success')`,
      )
      .run();
    addHistory(db, 'normal-1', false);
    addHistory(db, 'training-1', true);
    // 注入と取消
    const injected = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });

    const list = () => ({
      receptions: listAcceptanceReceptions(db.weather.connection, WINDOW),
      attempts: listAcceptanceFetchAttempts(db.weather.connection, WINDOW),
      history: listAcceptanceOutputHistory(db.retained.connection, WINDOW),
    });
    const beforeRetract = list();
    assert.ok(beforeRetract.receptions.length >= 3);
    assert.ok(
      beforeRetract.receptions.every(
        (r) => r.controlStatus !== 'training' && r.feedKind !== 'training',
      ),
    );
    assert.ok(beforeRetract.receptions.some((r) => r.id === normalWarning.id));
    assert.ok(beforeRetract.receptions.every((r) => r.id !== realTraining.id));
    assert.ok(beforeRetract.receptions.every((r) => r.id !== invalidTraining.id));
    assert.ok(beforeRetract.receptions.some((r) => r.id === invalidRegular.id));
    assert.ok(beforeRetract.attempts.length >= 1);
    assert.ok(
      beforeRetract.attempts.every((a) => !TRAINING_SOURCE_KINDS.includes(a.sourceKind as never)),
    );
    assert.deepEqual(
      beforeRetract.history.map((h) => h.notificationId),
      ['normal-1'],
    );

    // 述語関数は SQL の絞り込みと一致する（全件に対する判定の突き合わせ）
    const allReceptions = db.weather.connection
      .prepare(
        'SELECT id, control_status AS controlStatus, feed_kind AS feedKind FROM telegram_reception',
      )
      .all() as { id: number; controlStatus: string | null; feedKind: string | null }[];
    assert.deepEqual(
      allReceptions
        .filter((r) => !isTrainingReception(r))
        .map((r) => r.id)
        .sort((a, b) => a - b),
      beforeRetract.receptions.map((r) => r.id).sort((a, b) => a - b),
    );
    assert.ok(allReceptions.some((r) => isTrainingReception(r)));
    const allAttempts = db.weather.connection
      .prepare('SELECT id, source_kind AS sourceKind FROM fetch_attempt')
      .all() as { id: number; sourceKind: string }[];
    assert.deepEqual(
      allAttempts.filter((a) => !isTrainingFetchAttempt(a)).map((a) => a.id),
      beforeRetract.attempts.map((a) => a.id),
    );
    assert.ok(allAttempts.some((a) => isTrainingFetchAttempt(a)));
    assert.equal(isTrainingNotification({ isTraining: true }), true);
    assert.equal(isTrainingNotification({ isTraining: false }), false);

    await retract(
      db.weather.connection,
      retractionCommand('training', [injected.command.trainingId]),
      clock,
    );
    await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.deepEqual(list(), beforeRetract, '抹消が受入対象に影響しない');
    // 抹消で訓練由来の取得試行が増えていても、除外されている
    assert.ok(
      allAttempts.length <
        (
          db.weather.connection.prepare('SELECT COUNT(*) AS c FROM fetch_attempt').get() as {
            c: number;
          }
        ).c,
    );
  } finally {
    db.close();
  }
});

test('J5: 実行時コードは acceptance/trainingExclusion を参照しない', () => {
  const src = join(import.meta.dirname, '../src');
  for (const file of sourceFiles(src)) {
    if (file.endsWith('acceptance/trainingExclusion.ts')) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /acceptance\/trainingExclusion/, file);
  }
});
