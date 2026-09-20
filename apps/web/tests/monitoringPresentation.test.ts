import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonitoringCards } from '../src/monitoring/monitoringPresentation.ts';
import { monitoringResponseFixture } from './monitoringFixture.ts';

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
