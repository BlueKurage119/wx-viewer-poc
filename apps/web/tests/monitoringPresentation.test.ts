import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMonitoringCards,
  buildSourceStatusRows,
  formatDurationMs,
  formatIntervalSeconds,
} from '../src/monitoring/monitoringPresentation.ts';
import {
  abnormalMonitoringResponseFixture,
  createDefaultSources,
  delayedMonitoringResponseFixture,
  manualStoppedMonitoringResponseFixture,
  monitoringResponseFixture,
  normalMonitoringResponseFixture,
  scheduledStoppedMonitoringResponseFixture,
  stoppedSchedulerMonitoringResponseFixture,
  suspendedMonitoringResponseFixture,
  unevaluatedMonitoringResponseFixture,
} from './monitoringFixture.ts';

test('K1: 停止・判定待ち・初回同期失敗と会場別再処理を断定せず表示する', () => {
  const cards = buildMonitoringCards(monitoringResponseFixture);

  assert.deepEqual(cards, [
    {
      id: 'operation',
      title: '取得運転',
      value: '自動取得停止',
      details: ['初回同期失敗'],
      tone: 'neutral',
      detailTone: 'error',
    },
    {
      id: 'health',
      title: '取得健全性',
      value: '判定待ち',
      details: ['評価時刻 —'],
      tone: 'neutral',
    },
    {
      id: 'schedule',
      title: 'スケジュール',
      value: '09:00 – 18:00',
      details: ['次の切替 18:00'],
      tone: 'neutral',
    },
    {
      id: 'processing',
      title: '処理待ち',
      value: '起動時再処理',
      details: ['東地区 再処理完了 0件', 'TRC 再処理中 3 / 8'],
      tone: 'active',
    },
  ]);
});

test('buildSourceStatusRows: data === null のときは全セル — の 6 行を返す', () => {
  const rows = buildSourceStatusRows(null);
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.map((r) => r.name),
    [
      'XML定時フィード',
      'XML随時フィード',
      '雨雲時刻一覧',
      'キキクル時刻一覧',
      'アメダス最新時刻',
      'アメダス地点データ',
    ],
  );
  for (const row of rows) {
    assert.equal(row.state.text, '—');
    assert.equal(row.interval.text, '—');
    assert.equal(row.lastAttempt.text, '—');
    assert.equal(row.lastSuccess.text, '—');
    assert.equal(row.nextRun.text, '—');
    assert.equal(row.duration.text, '—');
    assert.equal(row.consecutiveFailures.text, '—');
  }
});

test('buildSourceStatusRows: 通常運転時の全行表示・時刻書式・実値表示', () => {
  const rows = buildSourceStatusRows(normalMonitoringResponseFixture);
  assert.equal(rows.length, 6);

  // 全行「待機」
  for (const row of rows) {
    assert.equal(row.state.text, '待機');
    assert.equal(row.state.tone, 'normal');
  }

  // XML定時フィードの各列検証
  const xmlReg = rows[0]!;
  assert.equal(xmlReg.name, 'XML定時フィード');
  assert.equal(xmlReg.interval.text, '1分');
  assert.equal(xmlReg.lastAttempt.text, '09/20 14:25:00');
  assert.equal(xmlReg.lastSuccess.text, '09/20 14:25:00');
  assert.equal(xmlReg.nextRun.text, '09/20 14:26:00');
  assert.equal(xmlReg.duration.text, '350 ms');
  assert.equal(xmlReg.consecutiveFailures.text, '0 / 5');
  assert.equal(xmlReg.consecutiveFailures.tone, undefined);
});

test('buildSourceStatusRows: 状態語の優先順位と文字による区別', () => {
  // 1. 未評価 -> 判定待ち
  const unevalRows = buildSourceStatusRows(unevaluatedMonitoringResponseFixture);
  for (const r of unevalRows) {
    assert.equal(r.state.text, '判定待ち');
    assert.equal(r.state.tone, 'neutral');
  }

  // 2. 異常 -> 異常
  const abnormalRows = buildSourceStatusRows(abnormalMonitoringResponseFixture);
  assert.equal(abnormalRows[0]!.state.text, '異常');
  assert.equal(abnormalRows[0]!.state.tone, 'error');

  // 3. 遅延 -> 遅延
  const delayedRows = buildSourceStatusRows(delayedMonitoringResponseFixture);
  assert.equal(delayedRows[0]!.state.text, '遅延');
  assert.equal(delayedRows[0]!.state.tone, 'attention');

  // 4. スケジュール停止 (suspended / scheduled_stopped)
  const suspendedRows = buildSourceStatusRows(suspendedMonitoringResponseFixture);
  for (const r of suspendedRows) {
    assert.equal(r.state.text, 'スケジュール停止');
    assert.equal(r.state.tone, 'neutral');
  }
  const schedStoppedRows = buildSourceStatusRows(scheduledStoppedMonitoringResponseFixture);
  assert.equal(schedStoppedRows[2]!.name, '雨雲時刻一覧');
  assert.equal(schedStoppedRows[2]!.state.text, 'スケジュール停止');
  assert.equal(schedStoppedRows[0]!.state.text, '待機');

  // 5. schedulerRunning: false -> 停止
  const stoppedRows = buildSourceStatusRows(stoppedSchedulerMonitoringResponseFixture);
  for (const r of stoppedRows) {
    assert.equal(r.state.text, '停止');
    assert.equal(r.state.tone, 'neutral');
  }

  // 5b. 手動停止（実APIの組み合わせ）-> 全行「停止」。スケジュール停止に化けない
  const manualStoppedRows = buildSourceStatusRows(manualStoppedMonitoringResponseFixture);
  for (const r of manualStoppedRows) {
    assert.equal(r.state.text, '停止');
    assert.equal(r.state.tone, 'neutral');
  }

  // 5c. 時間帯による停止（schedulerRunning: true）-> 全行「スケジュール停止」のまま
  const scheduleStoppedRows = buildSourceStatusRows({
    ...manualStoppedMonitoringResponseFixture,
    operation: { ...manualStoppedMonitoringResponseFixture.operation, schedulerRunning: true },
  });
  for (const r of scheduleStoppedRows) {
    assert.equal(r.state.text, 'スケジュール停止');
  }

  // 6. schedulerRunning: false かつ status === 'abnormal' -> 異常が優先（停止で上書きされない）
  const stoppedWithAbnormal = buildSourceStatusRows({
    ...stoppedSchedulerMonitoringResponseFixture,
    health: abnormalMonitoringResponseFixture.health,
  });
  assert.equal(stoppedWithAbnormal[0]!.state.text, '異常');
  assert.equal(stoppedWithAbnormal[0]!.state.tone, 'error');
  assert.equal(stoppedWithAbnormal[1]!.state.text, '停止');

  // 7. running -> 取得中
  const runningRows = buildSourceStatusRows({
    ...normalMonitoringResponseFixture,
    operation: {
      ...normalMonitoringResponseFixture.operation,
      scheduledSources: normalMonitoringResponseFixture.operation.scheduledSources.map((s) =>
        s.source === 'xml' ? { ...s, state: 'running' as const } : s,
      ),
    },
  });
  assert.equal(runningRows[0]!.state.text, '取得中');
  assert.equal(runningRows[0]!.state.tone, 'active');
  assert.equal(runningRows[1]!.state.text, '取得中'); // xml随時もxmlグループ
});

test('buildSourceStatusRows: 「再試行待ち」が出ないこと', () => {
  const allJson = JSON.stringify([
    buildSourceStatusRows(normalMonitoringResponseFixture),
    buildSourceStatusRows(abnormalMonitoringResponseFixture),
    buildSourceStatusRows(delayedMonitoringResponseFixture),
    buildSourceStatusRows(suspendedMonitoringResponseFixture),
    buildSourceStatusRows(scheduledStoppedMonitoringResponseFixture),
    buildSourceStatusRows(stoppedSchedulerMonitoringResponseFixture),
    buildSourceStatusRows(unevaluatedMonitoringResponseFixture),
  ]);
  assert.equal(allJson.includes('再試行待ち'), false);
});

test('buildSourceStatusRows: 次回予定の特例（確定事項1）', () => {
  const rows = buildSourceStatusRows(normalMonitoringResponseFixture);
  const xmlRegular = rows.find((r) => r.sourceId === 'xml_regular')!;
  const xmlExtra = rows.find((r) => r.sourceId === 'xml_extra')!;
  const amedasLatest = rows.find((r) => r.sourceId === 'amedas_latest_time')!;
  const amedasPoint = rows.find((r) => r.sourceId === 'amedas_point')!;

  // XML定時と随時は同じ次回予定
  assert.equal(xmlRegular.nextRun.text, '09/20 14:26:00');
  assert.equal(xmlExtra.nextRun.text, '09/20 14:26:00');

  // アメダス最新時刻には次回予定が入り、アメダス地点データは常に '—'
  assert.equal(amedasLatest.nextRun.text, '09/20 14:26:00');
  assert.equal(amedasPoint.nextRun.text, '—');
});

test('buildSourceStatusRows: 適用周期は health 側の値を表示し、scheduledSources 側の値を使わない（§4.3）', () => {
  const data = {
    ...normalMonitoringResponseFixture,
    health: {
      ...normalMonitoringResponseFixture.health,
      sources: normalMonitoringResponseFixture.health.sources.map((source) =>
        source.sourceId === 'xml_regular' ? { ...source, intervalSeconds: 120 } : source,
      ),
    },
    operation: {
      ...normalMonitoringResponseFixture.operation,
      scheduledSources: normalMonitoringResponseFixture.operation.scheduledSources.map((source) =>
        source.source === 'xml' ? { ...source, intervalSeconds: 600 } : source,
      ),
    },
  };

  const rows = buildSourceStatusRows(data);
  const xmlRegular = rows.find((r) => r.sourceId === 'xml_regular')!;
  const xmlExtra = rows.find((r) => r.sourceId === 'xml_extra')!;

  // health 側の 120 秒（2分）が表示され、scheduledSources 側の 600 秒（10分）は使われない
  assert.equal(xmlRegular.interval.text, '2分');
  // 値を変えていない随時フィードは health 側の 60 秒のまま
  assert.equal(xmlExtra.interval.text, '1分');
});

test('buildSourceStatusRows: タイル行の列限定（確定事項3）', () => {
  const rows = buildSourceStatusRows(normalMonitoringResponseFixture);
  const nowcastRow = rows.find((r) => r.sourceId === 'nowcast_target_times')!;
  const kikikuruRow = rows.find((r) => r.sourceId === 'kikikuru_target_times')!;

  for (const r of [nowcastRow, kikikuruRow]) {
    // 状態・最終試行・最終成功・次回予定は値が出る
    assert.equal(r.state.text, '待機');
    assert.equal(r.lastAttempt.text, '09/20 14:25:00');
    assert.equal(r.lastSuccess.text, '09/20 14:25:00');
    assert.equal(r.nextRun.text, '09/20 14:26:00');

    // 適用周期・直近処理時間・連続失敗回数は常に '—'
    assert.equal(r.interval.text, '—');
    assert.equal(r.duration.text, '—');
    assert.equal(r.consecutiveFailures.text, '—');
  }
});

test('buildSourceStatusRows: 連続失敗回数の表示・分母追随・アメダス地点の補足（確定事項4）', () => {
  const rows = buildSourceStatusRows(normalMonitoringResponseFixture);
  const amedasPoint = rows.find((r) => r.sourceId === 'amedas_point')!;
  assert.equal(amedasPoint.consecutiveFailures.text, '0 / 5');
  assert.equal(
    amedasPoint.consecutiveFailures.note,
    '経過時間による判定は行わない（失敗回数のみで判定）',
  );

  // 分母が thresholds.abnormalConsecutiveFailures に追随すること
  const customThresholdRows = buildSourceStatusRows({
    ...normalMonitoringResponseFixture,
    health: {
      ...normalMonitoringResponseFixture.health,
      thresholds: {
        ...normalMonitoringResponseFixture.health.thresholds,
        abnormalConsecutiveFailures: 7,
      },
    },
  });
  const amedasPointCustom = customThresholdRows.find((r) => r.sourceId === 'amedas_point')!;
  assert.equal(amedasPointCustom.consecutiveFailures.text, '0 / 7');

  // consecutiveFailures: null のとき '—'
  const nullFailuresRows = buildSourceStatusRows({
    ...normalMonitoringResponseFixture,
    health: {
      ...normalMonitoringResponseFixture.health,
      sources: createDefaultSources().map((s) =>
        s.sourceId === 'xml_regular' ? { ...s, consecutiveFailures: null } : s,
      ),
    },
  });
  assert.equal(
    nullFailuresRows.find((r) => r.sourceId === 'xml_regular')!.consecutiveFailures.text,
    '—',
  );

  // tone の判定
  const delayedFailuresRows = buildSourceStatusRows(delayedMonitoringResponseFixture);
  assert.equal(
    delayedFailuresRows.find((r) => r.sourceId === 'xml_regular')!.consecutiveFailures.tone,
    'attention',
  );
  const abnormalFailuresRows = buildSourceStatusRows(abnormalMonitoringResponseFixture);
  assert.equal(
    abnormalFailuresRows.find((r) => r.sourceId === 'xml_regular')!.consecutiveFailures.tone,
    'error',
  );
});

test('formatIntervalSeconds: 秒数から文字列表現への変換', () => {
  assert.equal(formatIntervalSeconds(null), '—');
  assert.equal(formatIntervalSeconds(0), '0秒');
  assert.equal(formatIntervalSeconds(30), '30秒');
  assert.equal(formatIntervalSeconds(60), '1分');
  assert.equal(formatIntervalSeconds(120), '2分');
  assert.equal(formatIntervalSeconds(90), '90秒');
});

test('formatDurationMs: ミリ秒から文字列表現への変換（nullは—、0は0 ms）', () => {
  assert.equal(formatDurationMs(null), '—');
  assert.equal(formatDurationMs(0), '0 ms');
  assert.equal(formatDurationMs(250), '250 ms');
  assert.equal(formatDurationMs(999), '999 ms');
  assert.equal(formatDurationMs(1000), '1.0 秒');
  assert.equal(formatDurationMs(1500), '1.5 秒');
});
