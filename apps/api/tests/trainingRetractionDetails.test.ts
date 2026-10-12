import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import test from 'node:test';
import { ingestTelegramDocument } from '../src/polling/jmaXmlPoller.js';
import { findWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import { findWarningCurrentStream } from '../src/repositories/warningCurrentStreamRepository.js';
import {
  buildTrainingCancelTelegram,
  verifyTrainingCancelTelegram,
} from '../src/training/trainingCancelTelegram.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { generateTrainingWarningBaseline } from '../src/training/trainingWarningBaseline.js';
import {
  fixedClock,
  inject,
  retract,
  retractionCommand,
  setupDb,
  count,
} from './helpers/trainingRetraction.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

const GEN_TIME = '2026-10-12T09:00:00.000Z';
const ALL_TYPE_ITEMS = [
  'warning-03',
  'bulletin-linear-occurrence',
  'bulletin-tornado',
  'bulletin-tornado-observed',
];

// ---------------------------------------------------------------------------
// 取消電文の合成（純粋処理）
// ---------------------------------------------------------------------------

/** 要素ごとに比較するための写し。InfoType と Control/DateTime の本文は伏せる。 */
function describeTree(node: Node, path: string, out: string[]): void {
  if (node.nodeType === 1) {
    const el = node as Element;
    const attrs = Array.from({ length: el.attributes.length }, (_, i) => {
      const a = el.attributes.item(i)!;
      return `${a.name}=${a.value}`;
    }).sort();
    const here = `${path}/${el.nodeName}[${attrs.join(',')}]`;
    const hasElementChild = Array.from({ length: el.childNodes.length }, (_, i) =>
      el.childNodes.item(i),
    ).some((c) => c?.nodeType === 1);
    const parent = el.parentNode?.nodeName;
    const masked =
      (el.nodeName === 'InfoType' && parent === 'Head') ||
      (el.nodeName === 'DateTime' && parent === 'Control');
    if (!hasElementChild) out.push(`${here}=${masked ? '*' : (el.textContent ?? '')}`);
    for (let i = 0; i < el.childNodes.length; i += 1)
      describeTree(el.childNodes.item(i)!, here, out);
  }
}

function describe(xml: string): { lines: string[]; infoType: string; control: string } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lines: string[] = [];
  describeTree(doc.documentElement!, '', lines);
  const text = (name: string, parent: string) => {
    const p = Array.from(doc.documentElement!.getElementsByTagName(parent))[0]!;
    return Array.from(p.getElementsByTagName(name))[0]!.textContent ?? '';
  };
  return { lines, infoType: text('InfoType', 'Head'), control: text('DateTime', 'Control') };
}

test('取消電文の原文は、元の電文と InfoType・Control/DateTime 以外が要素ごとに一致する', () => {
  const telegrams = generateTrainingTelegrams(ALL_TYPE_ITEMS as never, {
    now: GEN_TIME,
    generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const baseline = generateTrainingWarningBaseline({
    reportDateTime: '2026-10-12T08:59:00.000Z',
    controlDateTime: '2026-10-12T09:00:00.000Z',
  });
  const xmls = [...telegrams.map((t) => t.xml), baseline];
  assert.equal(xmls.length, 5);
  for (const original of xmls) {
    const cancel = buildTrainingCancelTelegram(original, {
      controlDateTime: '2026-10-12T10:00:05.678Z',
    });
    const before = describe(original);
    const after = describe(cancel);
    assert.deepEqual(after.lines, before.lines);
    assert.equal(after.infoType, '取消');
    assert.equal(after.control, '2026-10-12T10:00:05Z');
    assert.notEqual(before.infoType, '取消');
    assert.ok(cancel.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  }
});

test('取消電文の投入前検証: 種別・InfoType・EventID・元との差異が違えば例外', () => {
  const [telegram] = generateTrainingTelegrams(['bulletin-linear-occurrence'], {
    now: GEN_TIME,
    generationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  const original = telegram!.xml;
  const documentUrl = 'training://x/r0_VPBS50_training.xml';
  const cancel = buildTrainingCancelTelegram(original, { controlDateTime: '2026-10-12T10:00:00Z' });
  const eventId = /<EventID>([^<]+)<\/EventID>/.exec(original)![1]!;
  const ok = {
    documentUrl,
    telegramType: 'VPBS50',
    expectedEventId: eventId,
    originalXml: original,
  };
  verifyTrainingCancelTelegram(cancel, ok);
  // InfoType が取消でない
  assert.throws(() => verifyTrainingCancelTelegram(original, ok), /InfoType/);
  // 電文種別が一致しない
  assert.throws(
    () => verifyTrainingCancelTelegram(cancel, { ...ok, telegramType: 'VPHW50' }),
    /種別/,
  );
  // EventID が元と異なる
  assert.throws(
    () => verifyTrainingCancelTelegram(cancel, { ...ok, expectedEventId: 'other' }),
    /EventID/,
  );
  // 元との差異（Headline を書き換え）
  assert.throws(
    () => verifyTrainingCancelTelegram(cancel.replace('<Headline>', '<Headline x="1">'), ok),
    /異なります|不合格/,
  );
  // 訓練でない Status
  assert.throws(
    () =>
      verifyTrainingCancelTelegram(
        cancel.replace('<Status>訓練</Status>', '<Status>通常</Status>'),
        ok,
      ),
    /訓練/,
  );
  // 壊れた XML は書き換え自体が例外
  assert.throws(() =>
    buildTrainingCancelTelegram('<Report>', { controlDateTime: '2026-10-12T10:00:00Z' }),
  );
});

// ---------------------------------------------------------------------------
// 記録・冪等性
// ---------------------------------------------------------------------------

test('取消電文の受信・取得試行は feed_kind=training・source_kind=training_retraction・documentUrl 規約で記録される', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const { command } = await inject(db.weather.connection, ALL_TYPE_ITEMS, {
      now: GEN_TIME,
      clock,
    });
    const cmd = retractionCommand('training', [command.trainingId]);
    const response = await retract(db.weather.connection, cmd, clock);
    assert.equal(response.telegrams.length, 4);
    const rows = db.weather.connection
      .prepare(
        `SELECT r.document_url AS url, r.feed_kind AS feed, r.feed_entry_id AS entry, r.info_type AS info,
                r.control_status AS status, f.source_kind AS source, f.trigger_kind AS trigger, f.target_ref AS ref
         FROM telegram_reception r JOIN fetch_attempt f ON f.id = r.fetch_attempt_id
         WHERE f.source_kind = 'training_retraction' ORDER BY r.id`,
      )
      .all() as Record<string, string>[];
    assert.equal(rows.length, 4);
    rows.forEach((row, i) => {
      assert.match(
        row.url!,
        new RegExp(
          `^training://${cmd.retractionId}/r${i}_(VPWW55|VPBS50|VPHW50|VPHW51)_training\\.xml$`,
        ),
      );
      assert.equal(row.feed, 'training');
      assert.equal(row.entry, `${cmd.retractionId}:${i}`);
      assert.equal(row.info, '取消');
      assert.equal(row.status, 'training');
      assert.equal(row.trigger, 'training');
      assert.equal(row.ref, cmd.retractionId);
      assert.equal(row.source, 'training_retraction');
    });
    // 取得試行のハッシュ・バイト数は投入した原文と一致する
    const attempt = db.weather.connection
      .prepare(
        `SELECT f.content_hash AS h, f.response_bytes AS b, r.raw_body AS raw FROM fetch_attempt f
         JOIN telegram_reception r ON r.fetch_attempt_id = f.id WHERE f.source_kind='training_retraction' LIMIT 1`,
      )
      .get() as { h: string; b: number; raw: string };
    assert.equal(attempt.h, createHash('sha256').update(attempt.raw).digest('hex'));
    assert.equal(attempt.b, Buffer.byteLength(attempt.raw, 'utf8'));
  } finally {
    db.close();
  }
});

test('同じ retractionId で2回呼んでも受信行は増えず、同じ結果が返る', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const { command } = await inject(db.weather.connection, ALL_TYPE_ITEMS, {
      now: GEN_TIME,
      clock,
    });
    const cmd = retractionCommand('training', [command.trainingId]);
    const first = await retract(db.weather.connection, cmd, clock);
    const receptions = count(db.weather.connection, 'telegram_reception');
    const attempts = count(db.weather.connection, 'fetch_attempt');
    const second = await retract(db.weather.connection, cmd, clock);
    assert.deepEqual(second, first);
    assert.equal(count(db.weather.connection, 'telegram_reception'), receptions);
    assert.equal(count(db.weather.connection, 'fetch_attempt'), attempts);
  } finally {
    db.close();
  }
});

test('検証不合格を起こす入力（受信原文が壊れている）では1通も投入されず、抹消記録は failed', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const { command } = await inject(db.weather.connection, ALL_TYPE_ITEMS, {
      now: GEN_TIME,
      clock,
    });
    // 警報の受信原文を、Head/InfoType を欠く壊れた形にする
    const victim = db.weather.connection
      .prepare("SELECT id, raw_body AS raw FROM telegram_reception WHERE telegram_type = 'VPWW55'")
      .get() as { id: number; raw: string };
    db.weather.connection
      .prepare('UPDATE telegram_reception SET raw_body = ? WHERE id = ?')
      .run(victim.raw.replace(/<InfoType>[^<]*<\/InfoType>/, ''), victim.id);
    const before = {
      reception: count(db.weather.connection, 'telegram_reception'),
      attempt: count(db.weather.connection, 'fetch_attempt'),
    };
    const cmd = retractionCommand('training', [command.trainingId]);
    await assert.rejects(retract(db.weather.connection, cmd, clock), /training_retraction_failed/);
    assert.equal(count(db.weather.connection, 'telegram_reception'), before.reception);
    assert.equal(count(db.weather.connection, 'fetch_attempt'), before.attempt);
    const record = db.weather.connection
      .prepare('SELECT status, error_code AS code FROM training_retraction WHERE retraction_id = ?')
      .get(cmd.retractionId);
    assert.deepEqual(record, { status: 'failed', code: 'cancel_verification_failed' });
    // 現況は取消されないまま
    assert.equal(
      findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training')?.items.length,
      1,
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 全抹消の対象範囲
// ---------------------------------------------------------------------------

test('failed の注入記録の受信が作った状態も全抹消で取消される', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const { command } = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    db.weather.connection
      .prepare(
        "UPDATE training_injection SET status = 'failed', error_code = 'x' WHERE training_id = ?",
      )
      .run(command.trainingId);
    const response = await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.deepEqual(response.trainingIds, [command.trainingId]);
    assert.equal(response.telegrams.filter((t) => t.outcome === 'cancelled').length, 3);
    assert.deepEqual(
      findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training')?.items,
      [],
    );
  } finally {
    db.close();
  }
});

test('気象庁の実配信を模した訓練電文（feed_kind が通常値）は全抹消で取消されず、baseline_not_owned が記録される', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const real = async (xml: string, name: string, id: string) => {
      await ingestTelegramDocument(
        db.weather.connection,
        {
          documentUrl: `https://www.data.jma.go.jp/developer/xml/data/20261012${id}_0_${name}_130000.xml`,
          xml,
          feedKind: 'extra',
          feedEntryId: id,
          fetchAttemptId: null,
          receivedAt: '2026-10-12T10:00:00.000Z',
          bodyBytes: Buffer.byteLength(xml),
          contentHash: createHash('sha256').update(xml).digest('hex'),
        },
        { venueRegistry: testVenueRegistry, clock },
      );
    };
    await real(
      generateTrainingWarningBaseline({
        reportDateTime: '2026-10-12T08:50:00.000Z',
        controlDateTime: '2026-10-12T08:50:00.000Z',
      }),
      'VPWS50',
      '0850',
    );
    const [warning] = generateTrainingTelegrams(['warning-03'], {
      now: GEN_TIME,
      generationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    await real(warning!.xml, 'VPWW55', '0900');
    assert.deepEqual(
      findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training')?.items.map(
        (i) => i.kindName,
      ),
      ['レベル３大雨警報'],
    );
    const response = await retract(db.weather.connection, retractionCommand('all'), clock);
    assert.deepEqual(response.trainingIds, []);
    assert.deepEqual(
      response.telegrams.map((t) => [t.role, t.outcome, t.trainingId, t.receptionId]),
      [['baseline', 'baseline_not_owned', '', null]],
    );
    assert.deepEqual(
      findWarningCurrentSnapshot(db.weather.connection, '1310800', 'training')?.items.map(
        (i) => i.kindName,
      ),
      ['レベル３大雨警報'],
    );
    const stream = findWarningCurrentStream(
      db.weather.connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    )!;
    assert.equal(stream.telegramType, 'VPWS50');
    assert.equal(count(db.weather.connection, 'training_retraction_item'), 1);
  } finally {
    db.close();
  }
});
