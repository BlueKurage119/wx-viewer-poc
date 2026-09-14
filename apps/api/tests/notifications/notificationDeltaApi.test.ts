import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import test from 'node:test';

import {
  toNotificationDeltaCursor,
  type NotificationDeltaReadyResponse,
  type NotificationTarget,
  type StartupNotificationReadyResponse,
  type UtcIso8601String,
} from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../../src/database/index.js';
import { createApp } from '../../src/app.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
} from '../../src/notifications/startupNotificationService.js';
import { createNotificationDeltaService } from '../../src/notifications/notificationDeltaService.js';
import { recordNotificationOutputHistory } from '../../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const fixedNow = '2026-09-14T10:00:00.000Z';
const serverGenId = '00000000-0000-4000-8000-000000000001';

function createDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-delta-notification-'));
  const context = initializeDatabase({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  return { context, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function startTestServer(app: ReturnType<typeof createApp>): Promise<{
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const baseUrl = `http://localhost:${port}`;
      resolve({
        server,
        baseUrl,
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

function insertSampleHistoryRow(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  params: {
    notificationId: string;
    category?: string;
    sourceType?: string;
    sourceVersion?: string | null;
    targetAreaJson?: string | null;
    occurredAt?: string;
    detectedAt?: string;
    changeType?: string;
    ackRequired?: boolean;
    summary?: string;
    relatedRefsJson?: string;
    origin?: 'weather' | 'system';
    detectionContext?: 'normal' | 'initial';
    isTraining?: boolean;
    messageDefinitionId?: string | null;
    messageDefinitionVersion?: string | null;
  },
) {
  return recordNotificationOutputHistory(connection, {
    notificationId: params.notificationId,
    category: params.category ?? 'warning',
    sourceType: params.sourceType ?? 'warning_current',
    sourceVersion: params.sourceVersion ?? 'v1',
    targetAreaJson:
      params.targetAreaJson !== undefined
        ? params.targetAreaJson
        : JSON.stringify([
            {
              kind: 'area',
              codeType: 'jma_municipal_warning_area',
              code: '1310800',
              name: '江東区',
            },
          ]),
    occurredAt: params.occurredAt ?? fixedNow,
    detectedAt: params.detectedAt ?? fixedNow,
    changeType: params.changeType ?? 'new',
    ackRequired: params.ackRequired ?? true,
    summary: params.summary ?? '大雨警報\n江東区\n大雨警報が発表されました。',
    relatedRefsJson: params.relatedRefsJson ?? JSON.stringify([{ type: 'telegram', ref: 'tel-1' }]),
    origin: params.origin ?? 'weather',
    detectionContext: params.detectionContext ?? 'normal',
    isTraining: params.isTraining ?? false,
    messageDefinitionId:
      params.messageDefinitionId !== undefined ? params.messageDefinitionId : 'warn-01',
    messageDefinitionVersion:
      params.messageDefinitionVersion !== undefined ? params.messageDefinitionVersion : '1.0',
  });
}

test('AC1 cursorの書式と検証', async () => {
  const { context, cleanup } = createDb();
  try {
    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      const invalidQueryList = [
        '', // 欠落
        'cursor=0', // terminalId 欠落
        'terminalId=hkeagh01', // cursor 欠落
        'terminalId=hkeagh01&cursor=0&limit=10', // 余剰クエリキー limit=10
        'terminalId=hkeagh01&cursor=0&extra=foo', // 余剰クエリキー extra=foo
        'terminalId=hkeagh01&cursor=0&cursor=1', // 同名キー重複
        'terminalId=hkeagh01&terminalId=hkeagh02&cursor=0', // 同名キー重複
        'terminalId=&cursor=0', // terminalId 空文字
        'terminalId=hkeagh01&cursor=', // cursor 空文字
        'terminalId=hkeagh01&cursor=01', // 前ゼロ
        'terminalId=hkeagh01&cursor=00', // 前ゼロ
        'terminalId=hkeagh01&cursor=-1', // 負数
        'terminalId=hkeagh01&cursor=+1', // 符号
        'terminalId=hkeagh01&cursor=1.5', // 小数
        'terminalId=hkeagh01&cursor=12345678901234567', // 17桁
        'terminalId=hkeagh01&cursor=１', // 全角数字
      ];

      for (const query of invalidQueryList) {
        const res = await fetch(`${baseUrl}/api/notifications/delta?${query}`);
        assert.equal(res.status, 400, `query "${query}" should return 400`);
        const json = await res.json();
        assert.deepEqual(json, { status: 'error', code: 'invalid_request' });
      }

      // 未知 terminalId は 404
      const notFoundRes = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=unknown_terminal&cursor=0`,
      );
      assert.equal(notFoundRes.status, 404);
      const notFoundJson = await notFoundRes.json();
      assert.deepEqual(notFoundJson, { status: 'error', code: 'terminal_not_found' });

      // "0" と "1" は受理される（行が存在する場合または空の場合）
      const validRes0 = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`,
      );
      assert.equal(validRes0.status, 200);

      insertSampleHistoryRow(context.connection, { notificationId: 'notif-1' });
      const validRes1 = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=1`,
      );
      assert.equal(validRes1.status, 200);
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC2 startup応答へのcursor追加', async () => {
  const { context, cleanup } = createDb();
  try {
    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');

    const startupService = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ startupNotifications: startupService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      // 1. B4が空のとき cursor は "0"
      const resEmpty = await fetch(`${baseUrl}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000001',
        }),
      });
      assert.equal(resEmpty.status, 200);
      const bodyEmpty = (await resEmpty.json()) as StartupNotificationReadyResponse;
      assert.equal(bodyEmpty.status, 'ready');
      assert.equal(bodyEmpty.cursor, '0');

      // 2. B4に n 件仕込んだとき cursor は "n"（MAX(id) の10進文字列表現）
      insertSampleHistoryRow(context.connection, { notificationId: 'notif-1' });
      insertSampleHistoryRow(context.connection, { notificationId: 'notif-2' });
      insertSampleHistoryRow(context.connection, { notificationId: 'notif-3' });

      const resN = await fetch(`${baseUrl}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000002',
        }),
      });
      assert.equal(resN.status, 200);
      const bodyN = (await resN.json()) as StartupNotificationReadyResponse;
      assert.equal(bodyN.status, 'ready');
      assert.equal(bodyN.cursor, '3');

      // 監査表 startup_notification_inquiry の response_json に cursor が保存されていること
      const inquiryRow = context.connection
        .prepare('SELECT response_json FROM startup_notification_inquiry WHERE session_id = ?')
        .get('00000000-0000-4000-8000-000000000002') as { response_json: string };
      const parsedAudit = JSON.parse(inquiryRow.response_json);
      assert.equal(parsedAudit.cursor, '3');

      // 監査表のスキーマが変わっていないこと
      const tableInfo = context.connection
        .prepare('PRAGMA table_info(startup_notification_inquiry)')
        .all() as { name: string }[];
      const colNames = tableInfo.map((c) => c.name);
      assert.deepEqual(colNames, [
        'id',
        'server_generation_id',
        'venue_id',
        'terminal_id',
        'session_id',
        'session_kind',
        'inquired_at',
        'warning_claimed',
        'response_json',
      ]);

      // 3. 202（initializing）応答には cursor キーが存在しない
      const unreadyInit = new StartupNotificationInitialization(); // not_started
      const unreadyService = createStartupNotificationService({
        connection: context.connection,
        initialization: unreadyInit,
        serverGenerationId: serverGenId,
        now: () => fixedNow as UtcIso8601String,
      });
      const unreadyApp = createApp({ startupNotifications: unreadyService });
      const { baseUrl: unreadyUrl, close: closeUnready } = await startTestServer(unreadyApp);
      try {
        const res202 = await fetch(`${unreadyUrl}/api/notifications/startup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            terminalId: 'hkeagh01',
            sessionId: '00000000-0000-4000-8000-000000000003',
          }),
        });
        assert.equal(res202.status, 202);
        const body202 = (await res202.json()) as Record<string, unknown>;
        assert.equal('cursor' in body202, false);
      } finally {
        await closeUnready();
      }
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC3 起動→差分の欠落と二重表示の防止', async () => {
  const { context, cleanup } = createDb();
  try {
    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');

    // B4に既存行を2件登録
    insertSampleHistoryRow(context.connection, { notificationId: 'notif-1' });
    insertSampleHistoryRow(context.connection, { notificationId: 'notif-2' });

    const startupService = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({
      startupNotifications: startupService,
      notificationDelta: deltaService,
    });
    const { baseUrl, close } = await startTestServer(app);

    try {
      // 起動APIを呼んで cursor=C ("2") を取得
      const startupRes = await fetch(`${baseUrl}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000001',
        }),
      });
      const startupBody = (await startupRes.json()) as StartupNotificationReadyResponse;
      assert.equal(startupBody.cursor, '2');

      // (a) 起動応答直後に差分を cursor=C で呼ぶと notifications が0件、応答 cursor は C
      const deltaResA = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=2`,
      );
      assert.equal(deltaResA.status, 200);
      const deltaBodyA = (await deltaResA.json()) as NotificationDeltaReadyResponse;
      assert.equal(deltaBodyA.notifications.length, 0);
      assert.equal(deltaBodyA.cursor, '2');

      // (b) 起動応答の後にB4へ1件INSERTしてから差分を呼ぶと、その1件だけが返り応答cursorが1増える
      insertSampleHistoryRow(context.connection, { notificationId: 'notif-3' });
      const deltaResB = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=2`,
      );
      const deltaBodyB = (await deltaResB.json()) as NotificationDeltaReadyResponse;
      assert.equal(deltaBodyB.notifications.length, 1);
      assert.equal(deltaBodyB.notifications[0]!.notificationId, 'notif-3');
      assert.equal(deltaBodyB.cursor, '3');

      // (c) 起動応答に含まれていた現況（B4既存行 notif-1, notif-2）が差分に重複して現れないこと
      const allIds = deltaBodyB.notifications.map((n) => n.notificationId);
      assert.equal(allIds.includes('notif-1'), false);
      assert.equal(allIds.includes('notif-2'), false);

      // (d) 差分を同じcursorで2回呼んでも結果が完全一致する（冪等）
      const deltaResD = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=2`,
      );
      const deltaBodyD = (await deltaResD.json()) as NotificationDeltaReadyResponse;
      assert.deepEqual({ ...deltaBodyD, generatedAt: '' }, { ...deltaBodyB, generatedAt: '' });

      // サービス直接呼出しでは requestedAt を固定して完全一致を検証
      const serviceDirect1 = deltaService.query({
        terminalId: 'hkeagh01',
        venueId: 'east',
        cursor: toNotificationDeltaCursor(2),
        requestedAt: fixedNow as UtcIso8601String,
      });
      const serviceDirect2 = deltaService.query({
        terminalId: 'hkeagh01',
        venueId: 'east',
        cursor: toNotificationDeltaCursor(2),
        requestedAt: fixedNow as UtcIso8601String,
      });
      assert.deepEqual(serviceDirect1, serviceDirect2);
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC4 会場スコープおよび端末モード非依存性', async () => {
  const { context, cleanup } = createDb();
  try {
    // 1. codeType='venue', code='east' (速報通知 D10形式)
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-venue-east',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'venue', code: 'east', name: '東京ビッグサイト' },
      ]),
    });
    // 2. codeType='venue', code='trc' (速報通知 D10形式)
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-venue-trc',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'venue', code: 'trc', name: '東京流通センター' },
      ]),
    });
    // 3. codeType='jma_municipal_warning_area', code='1310800' (江東区/east)
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-warn-east',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
      ]),
    });
    // 4. codeType='jma_municipal_warning_area', code='1311100' (大田区/trc)
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-warn-trc',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1311100', name: '大田区' },
      ]),
    });
    // 5. kind='equipment' (system通知 D7形式)
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-sys-global',
      origin: 'system',
      targetAreaJson: JSON.stringify([
        {
          kind: 'equipment',
          codeType: 'wx-viewer-poc/fetch-source',
          code: 'jma-xml',
          name: '気象庁XML取得元',
        },
      ]),
    });
    // 6. 未知 codeType
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-unresolved',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'unknown_type', code: '999999', name: '未知' },
      ]),
    });
    // 7. 末尾に trc のみの速報通知（east 端末から見て末尾が他会場）
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-venue-trc-tail',
      targetAreaJson: JSON.stringify([
        { kind: 'area', codeType: 'venue', code: 'trc', name: '東京流通センター' },
      ]),
    });

    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      // east 端末 (hkeagh01) で取得
      const resEastH = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`,
      );
      const bodyEastH = (await resEastH.json()) as NotificationDeltaReadyResponse;

      // trc 端末 (htrcph01) で取得
      const resTrcH = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=htrcph01&cursor=0`,
      );
      const bodyTrcH = (await resTrcH.json()) as NotificationDeltaReadyResponse;

      // (a) codeType='venue' 速報通知
      const eastVenueItem = bodyEastH.notifications.find(
        (n) => n.notificationId === 'notif-venue-east',
      );
      assert.ok(eastVenueItem);
      assert.equal(eastVenueItem.venueScope, 'venue');
      assert.equal(
        bodyTrcH.notifications.some((n) => n.notificationId === 'notif-venue-east'),
        false,
      );

      const trcVenueItem = bodyTrcH.notifications.find(
        (n) => n.notificationId === 'notif-venue-trc',
      );
      assert.ok(trcVenueItem);
      assert.equal(trcVenueItem.venueScope, 'venue');
      assert.equal(
        bodyEastH.notifications.some((n) => n.notificationId === 'notif-venue-trc'),
        false,
      );

      // (b) codeType='jma_municipal_warning_area' 警報通知
      assert.ok(bodyEastH.notifications.some((n) => n.notificationId === 'notif-warn-east'));
      assert.equal(
        bodyTrcH.notifications.some((n) => n.notificationId === 'notif-warn-east'),
        false,
      );

      assert.ok(bodyTrcH.notifications.some((n) => n.notificationId === 'notif-warn-trc'));
      assert.equal(
        bodyEastH.notifications.some((n) => n.notificationId === 'notif-warn-trc'),
        false,
      );

      // (c) kind='equipment' system通知は両端末に現れ venueScope='global'
      const eastSys = bodyEastH.notifications.find((n) => n.notificationId === 'notif-sys-global');
      assert.ok(eastSys);
      assert.equal(eastSys.venueScope, 'global');

      const trcSys = bodyTrcH.notifications.find((n) => n.notificationId === 'notif-sys-global');
      assert.ok(trcSys);
      assert.equal(trcSys.venueScope, 'global');

      // (d) 未知 codeType は両端末に現れ venueScope='unresolved'
      const eastUnres = bodyEastH.notifications.find(
        (n) => n.notificationId === 'notif-unresolved',
      );
      assert.ok(eastUnres);
      assert.equal(eastUnres.venueScope, 'unresolved');

      const trcUnres = bodyTrcH.notifications.find((n) => n.notificationId === 'notif-unresolved');
      assert.ok(trcUnres);
      assert.equal(trcUnres.venueScope, 'unresolved');

      // 両端末の応答 cursor は他会場行も含めた同じ MAX(id) = "7"
      assert.equal(bodyEastH.cursor, '7');
      assert.equal(bodyTrcH.cursor, '7');
      assert.equal(
        bodyEastH.notifications.some((n) => n.notificationId === 'notif-venue-trc-tail'),
        false,
      );

      // (e) 端末モードで出し分けないこと (確定事項8): 同一会場 H/K 端末で比較
      const resEastK = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=kkeagh01&cursor=0`,
      );
      const bodyEastK = (await resEastK.json()) as NotificationDeltaReadyResponse;

      const resTrcK = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=ktrcph01&cursor=0`,
      );
      const bodyTrcK = (await resTrcK.json()) as NotificationDeltaReadyResponse;

      // terminalId, generatedAt 以外の応答（notifications, cursor, skippedCount, venueId, serverGenerationId, status）が完全一致すること
      assert.deepEqual(
        { ...bodyEastH, terminalId: '', generatedAt: '' },
        { ...bodyEastK, terminalId: '', generatedAt: '' },
      );
      assert.deepEqual(
        { ...bodyTrcH, terminalId: '', generatedAt: '' },
        { ...bodyTrcK, terminalId: '', generatedAt: '' },
      );

      // global / unresolved が H 端末の応答からも除外されていないこと
      assert.ok(bodyEastH.notifications.some((n) => n.venueScope === 'global'));
      assert.ok(bodyEastH.notifications.some((n) => n.venueScope === 'unresolved'));
      assert.ok(bodyEastK.notifications.some((n) => n.venueScope === 'global'));
      assert.ok(bodyEastK.notifications.some((n) => n.venueScope === 'unresolved'));
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC5 origin/detectionContextの2軸独立（AD-H069）', async () => {
  const { context, cleanup } = createDb();
  try {
    // 4通りの通知を行として準備
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-weather-normal',
      origin: 'weather',
      detectionContext: 'normal',
    });
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-weather-initial',
      origin: 'weather',
      detectionContext: 'initial',
    });
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-system-normal',
      origin: 'system',
      detectionContext: 'normal',
      targetAreaJson: JSON.stringify([
        { kind: 'equipment', codeType: 'wx-viewer-poc/fetch-source', code: 'jma-xml', name: 'JMA' },
      ]),
    });
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-system-initial',
      origin: 'system',
      detectionContext: 'initial',
      targetAreaJson: JSON.stringify([
        { kind: 'equipment', codeType: 'wx-viewer-poc/fetch-source', code: 'jma-xml', name: 'JMA' },
      ]),
    });

    // さらに system を 100 件挟む
    for (let i = 1; i <= 100; i++) {
      insertSampleHistoryRow(context.connection, {
        notificationId: `notif-sys-bulk-${i}`,
        origin: 'system',
        detectionContext: 'normal',
        targetAreaJson: JSON.stringify([
          {
            kind: 'equipment',
            codeType: 'wx-viewer-poc/fetch-source',
            code: 'jma-xml',
            name: 'JMA',
          },
        ]),
      });
    }

    // 最後に weather を 1 件
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-weather-after-bulk',
      origin: 'weather',
      detectionContext: 'normal',
    });

    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      for (const terminalId of ['hkeagh01', 'kkeagh01']) {
        const res = await fetch(
          `${baseUrl}/api/notifications/delta?terminalId=${terminalId}&cursor=0`,
        );
        const body = (await res.json()) as NotificationDeltaReadyResponse;

        // 4通りすべてが含まれること
        assert.ok(body.notifications.some((n) => n.notificationId === 'notif-weather-normal'));
        assert.ok(body.notifications.some((n) => n.notificationId === 'notif-weather-initial'));
        assert.ok(body.notifications.some((n) => n.notificationId === 'notif-system-normal'));
        assert.ok(body.notifications.some((n) => n.notificationId === 'notif-system-initial'));

        // 100件挟んだ後の weather 1件が同じ1回の呼出しで取得でき、応答cursorが最大sequence (105) まで進む
        const lastWeather = body.notifications.find(
          (n) => n.notificationId === 'notif-weather-after-bulk',
        );
        assert.ok(lastWeather);
        assert.equal(body.cursor, '105');
        assert.equal(body.notifications.length, 105);
      }
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC6 件数上限なし（確定事項2）', async () => {
  const { context, cleanup } = createDb();
  try {
    // 1000件仕込む
    context.connection.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        insertSampleHistoryRow(context.connection, {
          notificationId: `notif-1000-${i}`,
          targetAreaJson: JSON.stringify([
            {
              kind: 'area',
              codeType: 'jma_municipal_warning_area',
              code: '1310800',
              name: '江東区',
            },
          ]),
        });
      }
    })();

    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as NotificationDeltaReadyResponse;

      // 1000件全件が返ること
      assert.equal(body.notifications.length, 1000);
      assert.equal(body.cursor, '1000');
      assert.equal(body.skippedCount, 0);
      assert.equal('hasMore' in body, false);
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC7 表示3要素の配信方式（AD-H024・確定事項4）', async () => {
  const { context, cleanup } = createDb();
  try {
    const rawSummary = '大雨警報\n江東区\n詳細な警報本文テキスト';
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-summary-test',
      summary: rawSummary,
      messageDefinitionId: 'warn-def-01',
      messageDefinitionVersion: '2.1',
    });
    insertSampleHistoryRow(context.connection, {
      notificationId: 'notif-null-msg-def',
      summary: '文面のみ',
      messageDefinitionId: null,
      messageDefinitionVersion: null,
    });

    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`);
      const body = (await res.json()) as NotificationDeltaReadyResponse;

      const item1 = body.notifications.find((n) => n.notificationId === 'notif-summary-test');
      assert.ok(item1);
      assert.equal(item1.output.summary, rawSummary);
      assert.deepEqual(item1.output.messageDefinition, { id: 'warn-def-01', version: '2.1' });
      // title, target, content キーが存在しないこと
      assert.equal('title' in item1.output, false);
      assert.equal('target' in item1.output, false);
      assert.equal('content' in item1.output, false);

      const item2 = body.notifications.find((n) => n.notificationId === 'notif-null-msg-def');
      assert.ok(item2);
      assert.equal(item2.output.summary, '文面のみ');
      assert.equal(item2.output.messageDefinition, null);
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC8 cursor_out_of_range と破損行', async () => {
  const { context, cleanup } = createDb();
  try {
    insertSampleHistoryRow(context.connection, { notificationId: 'notif-1' });
    insertSampleHistoryRow(context.connection, { notificationId: 'notif-2' });

    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      // (a) MAX(id) = 2 より大きい cursor=3 で呼ぶと 409 cursor_out_of_range
      const res409 = await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=3`);
      assert.equal(res409.status, 409);
      const body409 = await res409.json();
      assert.deepEqual(body409, {
        status: 'error',
        code: 'cursor_out_of_range',
        cursor: '2',
      });
      assert.equal('notifications' in body409, false);

      // (b) target_area_json を壊した行を1件挿入
      // 直接 SQL で壊れた JSON を INSERT する
      context.connection
        .prepare(
          `INSERT INTO notification_output_history (
            notification_id, category, source_type, source_version, target_area_json,
            occurred_at, detected_at, change_type, ack_required, summary,
            related_refs_json, origin, detection_context, is_training
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'notif-corrupted-3',
          'warning',
          'warning_current',
          'v1',
          '{invalid json}',
          fixedNow,
          fixedNow,
          'new',
          1,
          '破損行サマリ',
          '[]',
          'weather',
          'normal',
          0,
        );

      // さらに正常行を1件挿入
      insertSampleHistoryRow(context.connection, { notificationId: 'notif-4' });

      // さらに末尾に破損行をもう1件挿入 (id=5)
      context.connection
        .prepare(
          `INSERT INTO notification_output_history (
            notification_id, category, source_type, source_version, target_area_json,
            occurred_at, detected_at, change_type, ack_required, summary,
            related_refs_json, origin, detection_context, is_training
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'notif-corrupted-5',
          'warning',
          'warning_current',
          'v1',
          'null', // targets 空/null
          fixedNow,
          fixedNow,
          'new',
          1,
          '末尾破損行サマリ',
          '[]',
          'weather',
          'normal',
          0,
        );

      // cursor=0 で取得
      const resSkipped = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`,
      );
      assert.equal(resSkipped.status, 200);
      const bodySkipped = (await resSkipped.json()) as NotificationDeltaReadyResponse;

      // 破損行は2件除外され skippedCount=2、正常行 notif-1, notif-2, notif-4 は返り、cursor は末尾破損行も含めた "5"
      assert.equal(bodySkipped.skippedCount, 2);
      assert.equal(bodySkipped.cursor, '5');
      assert.deepEqual(
        bodySkipped.notifications.map((n) => n.notificationId),
        ['notif-1', 'notif-2', 'notif-4'],
      );
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC9 副作用がないこと（確定事項1）', async () => {
  const { context, cleanup } = createDb();
  try {
    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');

    insertSampleHistoryRow(context.connection, { notificationId: 'notif-1' });

    const startupService = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({
      startupNotifications: startupService,
      notificationDelta: deltaService,
    });
    const { baseUrl, close } = await startTestServer(app);

    try {
      const getCounts = () => ({
        terminalSession: context.connection
          .prepare('SELECT COUNT(*) as c FROM terminal_session')
          .get() as { c: number },
        startupWarningClaim: context.connection
          .prepare('SELECT COUNT(*) as c FROM startup_warning_claim')
          .get() as { c: number },
        startupNotificationInquiry: context.connection
          .prepare('SELECT COUNT(*) as c FROM startup_notification_inquiry')
          .get() as { c: number },
        notificationOutputHistory: context.connection
          .prepare('SELECT COUNT(*) as c FROM notification_output_history')
          .get() as { c: number },
      });

      const beforeCounts = getCounts();

      // 差分APIを複数回呼ぶ
      await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`);
      await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=1`);
      await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=1`);

      const afterCounts = getCounts();
      assert.deepEqual(afterCounts, beforeCounts);

      // 差分呼出し後に初回 session で startup を呼ぶと warningClaimed = true
      const startupRes = await fetch(`${baseUrl}/api/notifications/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: 'hkeagh01',
          sessionId: '00000000-0000-4000-8000-000000000001',
        }),
      });
      const startupBody = (await startupRes.json()) as StartupNotificationReadyResponse;
      assert.equal(startupBody.warningClaimed, true);
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC11 HTTP実挙動', async () => {
  const { context, cleanup } = createDb();
  try {
    const deltaService = createNotificationDeltaService({
      connection: context.connection,
      serverGenerationId: serverGenId,
      now: () => fixedNow as UtcIso8601String,
    });
    const app = createApp({ notificationDelta: deltaService });
    const { baseUrl, close } = await startTestServer(app);

    try {
      // 1. ヘッダー検証 (Cache-Control: no-store, Content-Type: application/json; charset=utf-8)
      const res = await fetch(`${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
      assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');

      // 2. POST /api/notifications/delta は 404 (登録されていないメソッド)
      const postRes = await fetch(
        `${baseUrl}/api/notifications/delta?terminalId=hkeagh01&cursor=0`,
        {
          method: 'POST',
        },
      );
      assert.equal(postRes.status, 404);

      // 3. /api/health は 200 ok
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      assert.deepEqual(await healthRes.json(), { status: 'ok' });

      // 4. dependencies.notificationDelta なしの createApp では差分エンドポイントが登録されない (404)
      const appWithoutDelta = createApp({});
      const { baseUrl: urlNoDelta, close: closeNoDelta } = await startTestServer(appWithoutDelta);
      try {
        const noDeltaRes = await fetch(
          `${urlNoDelta}/api/notifications/delta?terminalId=hkeagh01&cursor=0`,
        );
        assert.equal(noDeltaRes.status, 404);
      } finally {
        await closeNoDelta();
      }
    } finally {
      await close();
    }
  } finally {
    context.close();
    cleanup();
  }
});

test('AC10 共通store合流の変換契約', async () => {
  const startupNotification = {
    outputId: 'out-001',
    category: 'warning' as const,
    origin: 'weather' as const,
    sourceType: 'warning_current' as const,
    sourceVersion: 'v1',
    targets: [
      {
        kind: 'area' as const,
        codeType: 'jma_municipal_warning_area',
        code: '1310800',
        name: '江東区',
      },
    ] as const,
    occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
    relatedRefs: [{ type: 'telegram', ref: 'tel-001' }],
    isTraining: false,
    output: {
      ackRequired: true,
      summary: '大雨警報\n江東区\n大雨警報が発表されました。',
      messageDefinition: { id: 'warn-01', version: '1.0' },
      display: {
        title: '大雨警報',
        target: '江東区',
        content: '大雨警報が発表されました。',
      },
      action: { kind: 'acknowledge' as const, label: '確認' as const },
    },
  };

  const deltaItem = {
    sequence: 42,
    notificationId: 'notif-001',
    category: 'warning' as const,
    origin: 'weather' as const,
    detectionContext: 'normal' as const,
    sourceType: 'warning_current',
    sourceVersion: 'v1',
    changeType: 'new',
    targets: [
      {
        kind: 'area' as const,
        codeType: 'jma_municipal_warning_area',
        code: '1310800',
        name: '江東区',
      },
    ] as readonly [NotificationTarget, ...NotificationTarget[]] as [
      NotificationTarget,
      ...NotificationTarget[],
    ],
    occurredAt: '2026-09-14T10:00:00Z' as UtcIso8601String,
    detectedAt: '2026-09-14T10:00:05Z' as UtcIso8601String,
    relatedRefs: [{ type: 'telegram', ref: 'tel-001' }],
    isTraining: false,
    venueScope: 'venue' as const,
    output: {
      ackRequired: true,
      summary: '大雨警報\n江東区\n大雨警報が発表されました。',
      messageDefinition: { id: 'warn-01', version: '1.0' },
    },
  };

  const {
    toNotificationFeedItemFromStartup,
    toNotificationFeedItemFromDelta,
    mergeNotificationFeedItems,
  } = await import('@wx-viewer-poc/shared');

  const feedStartup = toNotificationFeedItemFromStartup(startupNotification);
  const feedDelta = toNotificationFeedItemFromDelta(deltaItem);

  assert.equal(feedStartup.feedKey, 'startup:out-001');
  assert.equal(feedStartup.sequence, null);
  assert.equal(feedStartup.detectedAt, null);
  assert.equal(feedStartup.detectionContext, null);
  assert.equal(feedStartup.changeType, null);
  assert.notEqual(feedStartup.summary, '');

  assert.equal(feedDelta.feedKey, 'delta:notif-001');
  assert.equal(feedDelta.sequence, 42);
  assert.equal(feedDelta.display, null);
  assert.notEqual(feedDelta.summary, '');

  // 同じ気象事象に由来する起動項目と差分項目を渡しても統合されず2件のまま残る
  const merged = mergeNotificationFeedItems([feedStartup], [feedDelta]);
  assert.equal(merged.length, 2);

  // 同じ feedKey は1件に重複排除
  const deduplicated = mergeNotificationFeedItems([feedStartup], [feedStartup]);
  assert.equal(deduplicated.length, 1);
});

test('AC12 境界（作りすぎていないこと）', async () => {
  // apps/api および packages/shared のコード内に terminalMode による通知除外ロジックが存在しないこと
  const { resolveNotificationVenueScope } =
    await import('../../src/notifications/notificationVenueScope.js');
  assert.equal(typeof resolveNotificationVenueScope, 'function');
  // terminalMode 引数を取らない（targets のみ）
  assert.equal(resolveNotificationVenueScope.length, 1);
});
