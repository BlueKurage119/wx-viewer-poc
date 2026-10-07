import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MonitoringNotificationOutputSummary } from '@wx-viewer-poc/shared';
import {
  createNotificationOutputHistoryController,
  type NotificationOutputHistoryState,
} from '../src/monitoring/notificationOutputHistoryController.ts';
import { MonitoringDialogHost } from '../src/monitoring/MonitoringDialogHost.tsx';
import { NotificationOutputHistoryRows } from '../src/monitoring/NotificationOutputHistoryPanel.tsx';
(globalThis as unknown as { React: typeof React }).React = React;
const row: MonitoringNotificationOutputSummary = {
  id: 1,
  detectedAt: '2026-10-07T12:00:00.000Z',
  summary: '旧通知',
  isTraining: true,
  receptionReference: { status: 'available', receptionId: 1 },
};
const list = () =>
  Response.json({
    status: 'ready',
    generatedAt: row.detectedAt,
    totalCount: 1,
    limit: 100,
    offset: 0,
    items: [row],
  });

function renderOutputDialog(state: NotificationOutputHistoryState): string {
  return renderToStaticMarkup(
    React.createElement(MonitoringDialogHost, {
      dialogId: 'output',
      onClose: () => {},
      renderContent: ({ dialogId }) => {
        assert.equal(dialogId, 'output');
        return React.createElement(NotificationOutputHistoryRows, {
          items: state.items,
          onReception: () => {},
        });
      },
    }),
  );
}

// 時刻表記・Materialラッパー属性は環境依存なので、実dialogの本文・操作だけを抽出する。
function dialogContent(html: string) {
  assert.match(html, /^<dialog /);
  assert.match(html, /id="monitoring-dialog-title"[^>]*>出力履歴<\/h2>/);
  const body = html.match(
    /<div class="monitoring-dialog-body md-typescale-body-medium">(.*?)<div class="monitoring-dialog-actions">/s,
  )?.[1];
  assert.ok(body !== undefined);
  return {
    summaries: [...body.matchAll(/<p>(.*?)<\/p>/g)].map((match) => match[1]),
    originalButtons: [...body.matchAll(/<md-gb-button\b[^>]*>原文<\/md-gb-button>/g)].length,
    unavailable: [...body.matchAll(/<span>原文参照不可<\/span>/g)].length,
  };
}

test('AC6 原文成功・410切替・500と消失の区別・破棄後反映抑止', async () => {
  const states: NotificationOutputHistoryState[] = [];
  const calls: string[] = [];
  let next: Response = Response.json({ reception: { rawBody: '<xml>&amp;</xml>' } });
  const controller = createNotificationOutputHistoryController(
    (state) => states.push(state),
    async (input) => {
      calls.push(String(input));
      return String(input).includes('/reception') ? next : list();
    },
  );
  await controller.load();
  assert.deepEqual(dialogContent(renderOutputDialog(states.at(-1)!)), {
    summaries: ['旧通知'],
    originalButtons: 1,
    unavailable: 0,
  });
  await controller.openReception(1);
  assert.equal(states.at(-1)?.rawBody, '<xml>&amp;</xml>');
  next = Response.json({ status: 'error' }, { status: 500 });
  await controller.openReception(1);
  assert.equal(states.at(-1)?.receptionPhase, 'failed');
  assert.deepEqual(states.at(-1)?.items[0]?.receptionReference, {
    status: 'available',
    receptionId: 1,
  });
  next = Response.json({ reason: 'weather_generation_changed' }, { status: 410 });
  await controller.openReception(1);
  assert.deepEqual(states.at(-1)?.items[0]?.receptionReference, {
    status: 'unavailable',
    reason: 'weather_generation_changed',
  });
  const count = calls.length;
  await controller.openReception(1);
  assert.equal(calls.length, count);
  assert.deepEqual(dialogContent(renderOutputDialog(states.at(-1)!)), {
    summaries: ['旧通知'],
    originalButtons: 0,
    unavailable: 1,
  });
  controller.dispose();
  const published = states.length;
  await controller.load();
  assert.equal(states.length, published);
  assert.deepEqual(calls.slice(0, 2), [
    '/api/monitoring/notification-outputs?limit=100&offset=0',
    '/api/monitoring/notification-outputs/1/reception',
  ]);
});

test('AC6 切替で自分のfetchを中止し遅延応答を閉じた表示に反映しない', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  const states: NotificationOutputHistoryState[] = [];
  const controller = createNotificationOutputHistoryController(
    (state) => states.push(state),
    async (_input, options) => {
      signal = options?.signal;
      return await new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  );
  const pending = controller.load();
  controller.dispose();
  assert.equal(signal?.aborted, true);
  finish(list());
  await pending;
  assert.deepEqual(
    states.map((state) => state.phase),
    ['loading'],
  );
});
