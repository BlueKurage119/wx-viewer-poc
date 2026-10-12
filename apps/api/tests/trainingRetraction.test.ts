import assert from 'node:assert/strict';
import test from 'node:test';
import { findWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import { findWarningCurrentStream } from '../src/repositories/warningCurrentStreamRepository.js';
import { findTelegramReceptionById } from '../src/repositories/telegramReceptionRepository.js';
import { listTrainingInjectionReceptions } from '../src/repositories/trainingInjectionRepository.js';
import {
  inject,
  fixedClock,
  retract,
  retractionCommand,
  setupDb,
} from './helpers/trainingRetraction.js';

const GEN_TIME = '2026-10-12T09:00:00.000Z';
const FOUR_ITEMS = [
  'warning-03',
  'bulletin-linear-occurrence',
  'bulletin-tornado',
  'bulletin-tornado-observed',
];

function warningItems(db: ReturnType<typeof setupDb>) {
  return (
    findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training')?.items.map(
      (item) => item.kindName,
    ) ?? []
  );
}

test('行抹消: 警報現況が空になり、訓練の速報3行が取消され、基準電文は残る', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const { command, result } = await inject(db.weather.connection, FOUR_ITEMS, {
      now: GEN_TIME,
      clock,
    });
    assert.ok(result.baseline);
    assert.deepEqual(warningItems(db), ['レベル３大雨警報']);
    const baselineStream = findWarningCurrentStream(
      db.weather.connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    );
    assert.equal(baselineStream?.receptionId, result.baseline.receptionId);

    const response = await retract(
      db.weather.connection,
      retractionCommand('training', [command.trainingId]),
      clock,
    );
    assert.equal(response.telegrams.length, 4);
    assert.ok(response.telegrams.every((t) => t.outcome === 'cancelled'));
    for (const telegram of response.telegrams) {
      assert.ok(
        telegram.adoptions.some(
          (a) => a.venueId === 'east' && /として解析済み/.test(a.adoptionResult ?? ''),
        ),
        JSON.stringify(telegram),
      );
    }
    assert.deepEqual(warningItems(db), []);
    const rows = db.weather.connection
      .prepare(
        "SELECT info_type AS t, is_cancelled AS c FROM bosai_bulletin WHERE control_status = 'training'",
      )
      .all() as { t: string; c: number }[];
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.t === '取消' && r.c === 1));
    // 基準電文は取消されず、ストリームも基準電文を指したまま
    const after = findWarningCurrentStream(
      db.weather.connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    );
    assert.equal(after?.receptionId, result.baseline.receptionId);
    assert.equal(
      findTelegramReceptionById(db.weather.connection, result.baseline.receptionId)?.infoType,
      '発表',
    );
    assert.equal(
      response.telegrams.some((t) => t.role === 'baseline'),
      false,
    );
  } finally {
    db.close();
  }
});

test('行抹消後に新しい警報を注入すると、基準電文は再投入されずに警報が現況に出る', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const first = await inject(db.weather.connection, ['warning-03'], { now: GEN_TIME, clock });
    await retract(
      db.weather.connection,
      retractionCommand('training', [first.command.trainingId]),
      clock,
    );
    assert.deepEqual(warningItems(db), []);
    const second = await inject(db.weather.connection, ['warning-14'], {
      now: '2026-10-12T09:10:00.000Z',
      clock,
    });
    assert.equal(second.result.baseline, null);
    assert.deepEqual(warningItems(db), ['雷注意報']);
  } finally {
    db.close();
  }
});

test('上書き済み: 訓練A→訓練B の順に注入し A を抹消すると A は superseded で B の警報・竜巻は残る', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const a = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    const b = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: '2026-10-12T09:30:00.000Z',
      clock,
    });
    const response = await retract(
      db.weather.connection,
      retractionCommand('training', [a.command.trainingId]),
      clock,
    );
    assert.deepEqual(response.telegrams.map((t) => [t.telegramType, t.outcome]).sort(), [
      ['VPHW50', 'superseded'],
      ['VPWW55', 'superseded'],
    ]);
    assert.ok(response.telegrams.every((t) => t.receptionId === null && t.adoptions.length === 0));
    assert.deepEqual(warningItems(db), ['レベル３大雨警報']);
    const tornado = db.weather.connection
      .prepare("SELECT is_cancelled AS c FROM bosai_bulletin WHERE control_status = 'training'")
      .all() as { c: number }[];
    assert.deepEqual(tornado, [{ c: 0 }]);
    // B の抹消では取消される
    const second = await retract(
      db.weather.connection,
      retractionCommand('training', [b.command.trainingId]),
      clock,
    );
    assert.ok(second.telegrams.every((t) => t.outcome === 'cancelled'));
    assert.deepEqual(warningItems(db), []);
  } finally {
    db.close();
  }
});

test('二重抹消の取消は already_cancelled（ストリームの指す電文が取消）', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    await inject(db.weather.connection, ['warning-03'], { now: GEN_TIME, clock });
    const all1 = await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.equal(all1.telegrams.at(-1)?.role, 'baseline');
    // 抹消済みの訓練は全抹消の対象から外れ、基準電文だけが already_cancelled になる
    const all2 = await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.deepEqual(all2.trainingIds, []);
    assert.deepEqual(
      all2.telegrams.map((t) => [t.role, t.outcome]),
      [['baseline', 'already_cancelled']],
    );
  } finally {
    db.close();
  }
});

test('全抹消: 全訓練の個別ストリーム・速報が取消され、基準電文も取消されて現況が空。抹消後の注入で基準電文が再投入される', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    await inject(db.weather.connection, ['warning-14', 'bulletin-linear-occurrence'], {
      now: '2026-10-12T09:20:00.000Z',
      clock,
    });
    const response = await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.equal(response.trainingIds.length, 2);
    const baselineItem = response.telegrams.at(-1)!;
    assert.deepEqual([baselineItem.role, baselineItem.outcome], ['baseline', 'cancelled']);
    assert.deepEqual(warningItems(db), []);
    const cancelledCount = db.weather.connection
      .prepare(
        "SELECT COUNT(*) AS c FROM bosai_bulletin WHERE control_status='training' AND is_cancelled = 1",
      )
      .get() as { c: number };
    assert.equal(cancelledCount.c, 2);

    // 実測5の回帰: 抹消後に新しい警報を注入すると基準電文が再投入され、警報が出る
    const again = await inject(db.weather.connection, ['warning-03'], {
      now: '2026-10-12T09:40:00.000Z',
      clock,
    });
    assert.ok(again.result.baseline, '基準電文が再投入される');
    assert.deepEqual(again.result.baseline.adoptions.map((a) => a.venueId).includes('east'), true);
    assert.deepEqual(warningItems(db), ['レベル３大雨警報']);
  } finally {
    db.close();
  }
});

test('全抹消後、取消済みストリームの ReportDateTime 以前の警報は採用されず、注入は completed', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    // 基準電文 Tb = 09:59。全抹消で Tb の VPWS50 取消がストリームに入る
    await inject(db.weather.connection, ['warning-03'], { now: '2026-10-12T10:00:00.000Z', clock });
    await retract(db.weather.connection, retractionCommand('all'), clock);
    const stream = findWarningCurrentStream(
      db.weather.connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    )!;
    // 取消済みストリームの ReportDateTime 以前に発表された警報
    const old = await inject(db.weather.connection, ['warning-14'], {
      now: '2026-10-12T09:00:00.000Z',
      clock,
    });
    assert.ok(old.result.baseline);
    assert.equal(old.result.baseline.reportDateTime, stream.reportDateTime);
    assert.equal(
      (
        db.weather.connection
          .prepare('SELECT status FROM training_injection WHERE training_id = ?')
          .get(old.command.trainingId) as { status: string } | undefined
      )?.status,
      'completed',
    );
    const baselineReception = findTelegramReceptionById(
      db.weather.connection,
      old.result.baseline.receptionId,
    )!;
    assert.equal(baselineReception.reportDateTime, stream.reportDateTime);
    assert.ok(
      Date.parse(baselineReception.controlDateTime!) > Date.parse(stream.controlDateTime),
      'Control/DateTime は取消より新しい',
    );
    assert.ok(
      old.result.baseline.adoptions.some((a) => /として解析済み/.test(a.adoptionResult ?? '')),
      JSON.stringify(old.result.baseline.adoptions),
    );
    assert.deepEqual(warningItems(db), []);
    assert.ok(
      listTrainingInjectionReceptions(db.weather.connection, old.command.trainingId).length === 2,
    );
  } finally {
    db.close();
  }
});
