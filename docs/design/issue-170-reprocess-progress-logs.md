# Issue #170 設計: 未処理電文再処理および初期同期時の進捗ログ出力

対象Issue: [#170](https://github.com/BlueKurage119/wx-viewer-poc/issues/170)
親Issue: [#168](https://github.com/BlueKurage119/wx-viewer-poc/issues/168)
基準コミット: `main`

---

## 1. 目的と確定事項

### 1.1 目的

Issue #168 の調査により、APIサーバー起動時（`apps/api/src/server.ts`）において、蓄積された未処理電文の再処理中や気象庁XML長期フィードの初回同期中にコンソールへ進捗ログが一切出力されないため、運用者・開発者からプロセスがフリーズ・停止しているように見える問題が判明した。

本Issueでは以下を実現する。
1. 未処理電文の再処理（`reprocessPendingWarningTelegramReceptions`）の開始・バッチ進捗（100件ごと）・完了・所要時間をコンソールログに出力する。
2. 通常起動時（未処理電文0件）には、不要なノイズを出さず、確認用の最小限のログ（0件である旨の1行）に留める。
3. 初回XMLフィード取得フェーズの開始・完了・所要時間（および失敗時）のコンソールログを出力する。
4. 将来的なクラウド環境への移植（Cloud Run, ECS, Kubernetes等）を考慮し、標準出力ログだけでなく、監視端末・ダッシュボードからAPI経由でリアルタイムに進捗状況（未処理件数、処理済み件数、実行状態、所要時間等）を取得可能なインメモリ進捗追跡構造（`StartupProgressTracker`）を導入し、監視API（`/api/monitoring/status`）と連携させる。

### 1.2 統括担当のヒアリングで確定した判断

| # | 論点 | 確定事項 |
|---|---|---|
| 1 | 未処理電文総数（`${total}`）の取得方法 | `telegramReceptionRepository.ts` に `countPendingWarningTelegramReceptions(connection, venueId)` を新設し、再処理ループ前に `COUNT(1)` クエリで総数を事前取得する。 |
| 2 | 進捗ログの出力先・DI（テスト時の静穏性） | `reprocessPendingWarningTelegramReceptions` にオプション引数（`options?: ReprocessPendingWarningOptions`）を追加し、`logger?: (message: string) => void` を受け取れるようにする。テストコードからは空関数等を渡して静穏化を可能とする。 |
| 3 | 初回XML取得フェーズのログ出力場所とフォーマット | `apps/api/src/server.ts` の `connectPolling`（`pollingService.onInitialFetchPhaseChange` のリスナー内）でフェーズ遷移を検知し、所要時間（`elapsedMs`）を計測して出力する。サービス層（`JmaXmlPollingService`）はコンソール出力から疎結合に保つ。 |
| 4 | 通常時（未処理電文0件）のログ出力 | `total === 0` の場合は、`[api] found 0 pending warning telegrams for venue '${venueId}'` を1行のみ出力する（論点4の対案を採用）。 |
| 5 | クラウド移植を考慮した監視端末向けAPI構造 | インメモリの進捗管理（`StartupProgressTracker`）を新設し、再処理の進捗状態を保持する。これを `MonitoringStatusService` に連携させ、`GET /api/monitoring/status` の `venues[i].reprocessing` セクションとして監視端末からAPI経由で取得可能にする。 |

---

## 2. 参照資料と実物調査

| 参照資料 | 確認した内容 |
|---|---|
| `apps/api/src/server.ts` | 起動シーケンス、`evaluateVenues` での再処理呼び出し、`connectPolling` での初期取得フェーズ監視、`createApp` での監視サービス登録。 |
| `apps/api/src/polling/jmaWarningTelegramProcessor.ts` | `reprocessPendingWarningTelegramReceptions` の実装。100件単位で `listPendingWarningTelegramReceptions` を呼び出している。 |
| `apps/api/src/repositories/telegramReceptionRepository.ts` | `listPendingWarningTelegramReceptions` の未処理判定SQL（`telegram_type IN (...) AND NOT EXISTS (SELECT 1 FROM telegram_reception_adoption a WHERE ...)`）。インデックス `idx_telegram_reception_adoption_pending` が存在することを確認。 |
| `apps/api/src/polling/jmaXmlPollingService.ts` | `InitialFetchPhase`（`not_started` \| `running` \| `completed` \| `failed`）およびリスナー登録機構（`onInitialFetchPhaseChange`, `onInitialFetchCompleted`）。 |
| `apps/api/src/monitoring/monitoringStatusService.ts` | `MonitoringStatusService` の依存関係と `buildVenues` の構成。`StartupNotificationInitialization` から `startupStatus` を取得している。 |
| `packages/shared/src/monitoringStatus.ts` | `MonitoringStatusResponse`、`MonitoringVenueSection`、`MonitoringReadinessSection` の型定義。 |
| `docs/design/issue-42-monitoring-rest-apis.md` | 監視画面向けAPI設計。セクション分離（AD-H063）の原則。 |

---

## 3. モジュール構成と具体的なシグネチャ

### 3.1 型定義の拡張（`packages/shared/src/monitoringStatus.ts`）

会場ごとの電文再処理進捗を表す型 `MonitoringVenueReprocessingStatus` を新設し、`MonitoringVenueSection` に追加する。

```typescript
export type MonitoringReprocessingPhase = 'idle' | 'running' | 'completed';

export interface MonitoringVenueReprocessingStatus {
  /** 再処理の進行フェーズ */
  readonly status: MonitoringReprocessingPhase;
  /** 再処理対象の未処理電文総数（0件の場合は0） */
  readonly total: number;
  /** 処理済み件数 */
  readonly processedCount: number;
  /** 再処理開始時刻（未開始時は null） */
  readonly startedAt: UtcIso8601String | null;
  /** 再処理完了時刻（未完了時は null） */
  readonly finishedAt: UtcIso8601String | null;
  /** 再処理所要時間（ミリ秒、未完了時は null） */
  readonly elapsedMs: number | null;
}

export interface MonitoringVenueSection {
  readonly venueId: VenueId;
  readonly startupEvaluated: boolean;
  /** 会場ごとの未処理電文再処理ステータス */
  readonly reprocessing: MonitoringVenueReprocessingStatus;
  readonly recentAdoptions: readonly {
    readonly adoptionResult: string;
    readonly count: number;
    readonly latestDecidedAt: UtcIso8601String | null;
  }[];
  readonly adoptionWindowHours: number;
}
```

### 3.2 リポジトリ関数の新設（`apps/api/src/repositories/telegramReceptionRepository.ts`）

未処理電文の総件数を高速に取得する関数を追加する。

```typescript
/**
 * 指定された会場における未判定（pending）の警報電文総数を返す。
 */
export function countPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venueId: VenueId,
): number {
  if (!isVenueId(venueId)) {
    throw new Error(`venueId must be a known VenueId: ${String(venueId)}`);
  }
  const typePlaceholders = WARNING_TELEGRAM_TYPES.map(() => '?').join(', ');
  const row = connection
    .prepare(
      `SELECT COUNT(1) AS count FROM telegram_reception t
       WHERE telegram_type IN (${typePlaceholders})
         AND NOT EXISTS (
           SELECT 1 FROM telegram_reception_adoption a
           WHERE a.reception_id = t.id AND a.venue_id = ? AND a.adoption_decided_at IS NOT NULL
         )`,
    )
    .get(...WARNING_TELEGRAM_TYPES, venueId) as { count: number };

  return row.count;
}
```

### 3.3 起動時進捗トラッカーの新設（`apps/api/src/monitoring/startupProgressTracker.ts`）

再処理の進捗状態をインメモリで保持・更新し、監視サービスへ提供するトラッカーを導入する。

```typescript
import {
  VENUE_IDS,
  type MonitoringVenueReprocessingStatus,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';

export interface StartupProgressTracker {
  startVenueReprocessing(venueId: VenueId, total: number, startedAt?: UtcIso8601String): void;
  updateVenueReprocessing(venueId: VenueId, processedCount: number): void;
  completeVenueReprocessing(
    venueId: VenueId,
    processedCount: number,
    elapsedMs: number,
    finishedAt?: UtcIso8601String,
  ): void;
  getVenueReprocessingStatus(venueId: VenueId): MonitoringVenueReprocessingStatus;
}

export class InMemoryStartupProgressTracker implements StartupProgressTracker {
  private readonly statusMap = new Map<VenueId, MonitoringVenueReprocessingStatus>();

  constructor(private readonly nowFn: () => UtcIso8601String = () => new Date().toISOString() as UtcIso8601String) {
    for (const venueId of VENUE_IDS) {
      this.statusMap.set(venueId, {
        status: 'idle',
        total: 0,
        processedCount: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
      });
    }
  }

  startVenueReprocessing(venueId: VenueId, total: number, startedAt?: UtcIso8601String): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      status: total === 0 ? 'completed' : 'running',
      total,
      processedCount: 0,
      startedAt: startedAt ?? this.nowFn(),
      finishedAt: total === 0 ? (startedAt ?? this.nowFn()) : null,
      elapsedMs: total === 0 ? 0 : null,
    });
  }

  updateVenueReprocessing(venueId: VenueId, processedCount: number): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      processedCount,
    });
  }

  completeVenueReprocessing(
    venueId: VenueId,
    processedCount: number,
    elapsedMs: number,
    finishedAt?: UtcIso8601String,
  ): void {
    const current = this.getVenueReprocessingStatus(venueId);
    this.statusMap.set(venueId, {
      ...current,
      status: 'completed',
      processedCount,
      finishedAt: finishedAt ?? this.nowFn(),
      elapsedMs,
    });
  }

  getVenueReprocessingStatus(venueId: VenueId): MonitoringVenueReprocessingStatus {
    return (
      this.statusMap.get(venueId) ?? {
        status: 'idle',
        total: 0,
        processedCount: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
      }
    );
  }
}
```

### 3.4 電文プロセッサの改修（`apps/api/src/polling/jmaWarningTelegramProcessor.ts`）

`reprocessPendingWarningTelegramReceptions` のシグネチャを拡張し、進捗ログ出力およびトラッカー連携を組み込む。

```typescript
export interface ReprocessPendingWarningOptions {
  /** ログ出力用関数。省略時はログ出力なし（テスト時の静穏性担保）。サーバー起動時は console.log を渡す。 */
  readonly logger?: (message: string) => void;
  /** 進捗トラッカー。省略可能。 */
  readonly progressTracker?: Pick<
    StartupProgressTracker,
    'startVenueReprocessing' | 'updateVenueReprocessing' | 'completeVenueReprocessing'
  >;
  /** バッチログ出力のインターバル件数（既定: 100） */
  readonly batchLogInterval?: number;
  /**
   * ページ処理間でイベントループへ制御を戻す関数。
   * 既定値は setImmediate による制御返却（Node.js イベントループ解放）。
   * レビュー指摘対応: 同期的な SQLite 処理が長時間ループして監視 API 要求をブロックするのを防ぐ。
   */
  readonly yieldEventLoop?: () => Promise<void>;
}

export async function reprocessPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venue: VenueWarningContext,
  clock: () => UtcIso8601String,
  emitDeps?: WarningNotificationEmitDeps,
  options?: ReprocessPendingWarningOptions,
): Promise<{ readonly processedCount: number; readonly elapsedMs: number }> {
  const logger = options?.logger;
  const tracker = options?.progressTracker;
  const batchLogInterval = options?.batchLogInterval ?? 100;
  const yieldEventLoop =
    options?.yieldEventLoop ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const venueId = venue.venueId;

  const total = countPendingWarningTelegramReceptions(connection, venueId);
  const startMs = Date.now();

  // 未処理が0件の場合: 確定事項4により1行のみ出力し終了
  if (total === 0) {
    logger?.(`[api] found 0 pending warning telegrams for venue '${venueId}'`);
    tracker?.startVenueReprocessing(venueId, 0);
    return { processedCount: 0, elapsedMs: 0 };
  }

  // 開始時ログ
  logger?.(`[api] found ${total} pending warning telegrams for venue '${venueId}', reprocessing...`);
  tracker?.startVenueReprocessing(venueId, total);

  let after: { readonly receivedAt: UtcIso8601String; readonly id: number } | undefined;
  let processedCount = 0;

  do {
    const page = listPendingWarningTelegramReceptions(connection, venueId, {
      after,
      limit: 100,
    });
    for (const reception of page.receptions) {
      processWarningTelegramReception(connection, reception, clock(), venue, emitDeps);
      processedCount += 1;

      // 100件ごとの進捗ログとトラッカー更新（最終件数未満）
      if (processedCount % batchLogInterval === 0 && processedCount < total) {
        logger?.(`[api] reprocessed ${processedCount}/${total} telegrams for venue '${venueId}'...`);
        tracker?.updateVenueReprocessing(venueId, processedCount);
      }
    }
    after = page.nextCursor ?? undefined;
    if (after) {
      await yieldEventLoop();
    }
  } while (after);

  const elapsedMs = Math.max(0, Date.now() - startMs);

  // 完了時ログ
  logger?.(
    `[api] finished reprocessing pending warning telegrams for venue '${venueId}' (${processedCount} items, ${elapsedMs}ms)`,
  );
  tracker?.completeVenueReprocessing(venueId, processedCount, elapsedMs);

  return { processedCount, elapsedMs };
}
```

### 3.5 監視サービスへの注入（`apps/api/src/monitoring/monitoringStatusService.ts`）

`MonitoringStatusServiceDependencies` に `progressTracker?: StartupProgressTracker` を追加し、`buildVenues` 内で `venues[i].reprocessing` を設定する。

```typescript
export interface MonitoringStatusServiceDependencies {
  // ...既存の依存関係...
  readonly progressTracker?: StartupProgressTracker;
}

// buildVenues 内の組み立て:
const reprocessing = deps.progressTracker
  ? deps.progressTracker.getVenueReprocessingStatus(venueId)
  : {
      status: 'idle' as const,
      total: 0,
      processedCount: 0,
      startedAt: null,
      finishedAt: null,
      elapsedMs: null,
    };

return {
  venueId,
  startupEvaluated,
  reprocessing,
  recentAdoptions,
  adoptionWindowHours,
};
```

### 3.6 サーバー起動処理の接続（`apps/api/src/server.ts`）

1. `StartupRuntime` 内で `progressTracker: new InMemoryStartupProgressTracker(clock)` を保持・公開する。
2. `evaluateVenues` 内の `reprocessPendingWarningTelegramReceptions` 呼び出しに `{ logger: console.log, progressTracker }` を渡す。
3. `server.ts` 内の `createApp` 引数で `monitoringStatus` 生成時に `progressTracker` を渡す。
4. `connectPolling` で初期XMLフィード取得フェーズのログを出力する：
   ```typescript
   let initialFetchStartMs: number | null = null;
   pollingService.onInitialFetchPhaseChange((phase) => {
     initialization.setInitialFetchPhase(phase);
     if (phase === 'running') {
       initialFetchStartMs = Date.now();
       console.log('[api] starting initial JMA XML feed fetch...');
     } else if (phase === 'completed') {
       const elapsedMs = initialFetchStartMs !== null ? Math.max(0, Date.now() - initialFetchStartMs) : 0;
       console.log(`[api] completed initial JMA XML feed fetch (${elapsedMs}ms)`);
     } else if (phase === 'failed') {
       const elapsedMs = initialFetchStartMs !== null ? Math.max(0, Date.now() - initialFetchStartMs) : 0;
       console.error(`[api] failed initial JMA XML feed fetch (${elapsedMs}ms)`);
     }
   });
   ```

---

## 4. 受け入れ条件のチェックリスト（検収担当向け）

検収担当がそのまま1項目ずつ実行して合否判定できるチェックリスト。

### 4.1 未処理電文カウント（`countPendingWarningTelegramReceptions`）
- [ ] 未処理電文が0件のとき、`countPendingWarningTelegramReceptions(conn, venueId)` が `0` を返すこと。
- [ ] 未処理電文が3件挿入されているとき、`3` を返すこと。
- [ ] `east` 会場のみ採用判定済みの電文がある場合、`east` に対しては `0`、`trc` に対しては `1` を正しく返すこと（会場別の判定分離）。

### 4.2 再処理進捗ログ出力（`reprocessPendingWarningTelegramReceptions`）
- [ ] **通常時（0件）**: 未処理電文が0件の場合に `logger` を渡して実行したとき、`[api] found 0 pending warning telegrams for venue '<venueId>'` が1回だけ出力され、開始・進捗・完了ログが出力されないこと。
- [ ] **件数あり（例: 250件）**: 未処理電文が250件ある状態で `logger` を渡して実行したとき、以下の順序でログが出力されること：
  1. 開始時: `[api] found 250 pending warning telegrams for venue '<venueId>', reprocessing...`
  2. バッチ進捗: `[api] reprocessed 100/250 telegrams for venue '<venueId>'...`
  3. バッチ進捗: `[api] reprocessed 200/250 telegrams for venue '<venueId>'...`
  4. 完了時: `[api] finished reprocessing pending warning telegrams for venue '<venueId>' (250 items, <elapsedMs>ms)`
- [ ] **静穏性**: `options` または `logger` を指定しない場合、コンソールに一切ログが出力されないこと（既存テストが汚染されないこと）。
- [ ] **イベントループ解放（レビュー指摘対応）**: 複数ページ処理時にページ間でイベントループへ制御が戻り（`yieldEventLoop` / `setImmediate`）、再処理実行中であっても並行するタスク（HTTPリクエスト処理等）がブロックされないこと。

### 4.3 初回XMLフィード取得フェーズのログ出力
- [ ] `JmaXmlPollingService` の初期取得が `running` に遷移した際、`[api] starting initial JMA XML feed fetch...` がコンソールに出力されること。
- [ ] 初期取得が `completed` に遷移した際、`[api] completed initial JMA XML feed fetch (<elapsedMs>ms)` がコンソールに出力されること。
- [ ] 初期取得が `failed` に遷移した際、`[api] failed initial JMA XML feed fetch (<elapsedMs>ms)` が出力されること。

### 4.4 クラウド移植・監視端末向けAPI構造（進捗トラッカーと `/api/monitoring/status`）
- [ ] `InMemoryStartupProgressTracker` 単体で、開始・更新・完了に応じたステータス（`status`, `total`, `processedCount`, `elapsedMs` 等）が正しく記録・取得できること。
- [ ] `GET /api/monitoring/status?terminalId=T1` のレスポンスにおいて、各 `venues` 要素に `reprocessing` オブジェクトが含まれ、型定義（`MonitoringVenueReprocessingStatus`）通りのプロパティ（`status`, `total`, `processedCount`, `startedAt`, `finishedAt`, `elapsedMs`）が返されること。
- [ ] 再処理中の会場がある場合、監視APIのレスポンスでその会場の `reprocessing.status` が `'running'` となり、`processedCount` が反映されていること。
- [ ] 再処理完了後、`reprocessing.status` が `'completed'` となり、`elapsedMs` に0以上の数値が入っていること。

### 4.5 回帰テストと静的検査
- [ ] `npm run typecheck` が全ワークスペースでエラーなく成功すること。
- [ ] `npm run lint` がエラーなく成功すること（`--max-warnings 0`）。
- [ ] `npm run format:check` で整形差分がないこと。
- [ ] `npm run test -w apps/api` が全件成功すること。

---

## 5. 後続Issueへの引き継ぎ事項

1. **Issue #169（未処理電文再処理のトランザクションバッチ化）**:
   - 本Issueで改修する `reprocessPendingWarningTelegramReceptions` の100件単位のページ取得ループ構造（`listPendingWarningTelegramReceptions`）に、100件単位のトランザクション一括コミットをそのまま組み込むことができる。
2. **Issue #171（APIサーバー起動待受ログの早期出力と初回同期の非同期化）**:
   - 本Issueで導入する `StartupProgressTracker` および `/api/monitoring/status` の `venues[i].reprocessing` により、Issue #171で `app.listen()` が早期にポートを開いた後でも、監視端末から初期同期・電文再処理の進行状況をAPI経由でリアルタイムにポーリング監視できる基盤となる。

---

## 6. 実挙動未確認の明記

- 本設計書の作成時点において、実環境の5GB超のデータベース（20,000件超の蓄積DB）を用いた実際の数十万ミリ秒単位での長期コンソール出力は実挙動未確認である（テスト用SQLiteインメモリ／小規模DBでの検証を前提とする）。
