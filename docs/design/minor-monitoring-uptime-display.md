# 取得監視画面への運転時間表示の追加 設計書

## 1. 参照した資料と設計判断の根拠

### 参照資料
- ユーザーヒアリング確定事項（2026-09-21）: バックエンド側基準への変更
- `packages/shared/src/monitoringStatus.ts`
- `apps/api/src/server.ts`
- `apps/api/src/monitoring/monitoringStatusService.ts`
- `apps/web/src/monitoring/MonitoringDashboard.tsx`
- `apps/web/src/monitoring/monitoringTimeFormat.ts`
- `apps/web/src/monitoring/monitoring.css`
- `apps/web/src/api/monitoringStatus.ts`
- `docs/rules/02-design-protocol.md`
- `docs/rules/06-ui-md3-protocol.md`

### ヒアリング確定事項と設計判断
1. **起動の基準点（確定事項）**:
   - **バックエンド側基準（サーバープロセスの起動時刻）** を採用する。
   - サーバープロセス（`startServer()`）起動時に `serverGenerationId` と合わせて記録される起動時刻（`serverStartedAt: UtcIso8601String`）を基準とする。
   - `MonitoringStatusResponse` DTO のルートレベルに `serverStartedAt` を追加し、サーバーからクライアントへ返却する。
   - 画面をリロードしたり別端末から接続した場合でも、サーバーが稼働し続けていればサーバーの同一運転時間が表示される。

2. **表示内容と配置（確定事項）**:
   - 表示文言: `運転時間: hh:mm:ss`
   - 配置場所: 監視画面の更新行（`.monitoring-update-row`）における「最終表示更新」の左側。
   - スタイル: 既存の `.monitoring-update-row` のスタイル（`font-size: 13px; font-variant-numeric: tabular-nums; gap: 16px; justify-content: end;`）を継承し、折り返しを防止（`white-space: nowrap;`）する。
   - 初期ロード中（`data === null`）の表示: サーバーからの応答前は `運転時間: —` と表示する。

3. **カウントアップの更新周期と時刻補正**:
   - 1000ms（1秒）ごとのインターバル更新とする。
   - クライアント側とサーバー側の時計のズレを吸収するため、最新レスポンスの `generatedAt` と `serverStartedAt` の差分を基準運転秒数（`serverElapsedSec`）とし、そのレスポンス受信時からのクライアント経過秒数を加算して表示する。
     - `currentUptimeSec = Math.floor((Date.now() - responseReceivedAtMs) / 1000) + Math.floor((Date.parse(data.generatedAt) - Date.parse(data.serverStartedAt)) / 1000)`
   - 5秒ごとのポーリングで新たなレスポンスを受信するたびに最新値へ補正されるため、端末時計のずれやスリープ復帰時にも正確なサーバー運転時間に追随する。

4. **書式仕様（`hh:mm:ss`）**:
   - 時間（hh）、分（mm）、秒（ss）それぞれを2桁ゼロ埋めで表示する。
   - 経過時間が24時間を超えた場合、日数の分離は行わず時間部を累積する（例: 25時間 → `25:00:00`、100時間 → `100:00:00`）。
   - 負数または無効値の場合は `00:00:00` を返す。

---

## 2. モジュール構成・型定義・具体的なシグネチャ

### 2.1 共有型定義（DTO拡張）
**対象ファイル:** `packages/shared/src/monitoringStatus.ts`

```typescript
export interface MonitoringStatusResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly requestedVenueId: VenueId;
  readonly serverGenerationId: string;
  /** サーバーの起動時刻。監視画面の「運転時間」の基準。 */
  readonly serverStartedAt: UtcIso8601String;
  /** この応答を組み立てた時刻。監視画面の「最終表示更新時刻」の基準(基本設計 §8.2)。 */
  readonly generatedAt: UtcIso8601String;

  readonly operation: MonitoringOperationSection;
  readonly health: MonitoringHealthSection;
  readonly readiness: MonitoringReadinessSection;
  readonly venues: readonly MonitoringVenueSection[];
  readonly information: readonly MonitoringInformationSection[];
  readonly tiles: MonitoringTilesSection;
}
```

### 2.2 バックエンド API サーバー
**対象ファイル:** `apps/api/src/server.ts`
- `createStartupNotificationRuntime` または `startServer` 内で、サーバー起動時刻を記録:
  ```typescript
  const serverStartedAt = clock() as UtcIso8601String;
  ```
- `createMonitoringStatusService` に `serverStartedAt` を注入。

**対象ファイル:** `apps/api/src/monitoring/monitoringStatusService.ts`
- `MonitoringStatusServiceDependencies` に `serverStartedAt: UtcIso8601String` を追加。
- `getStatus()` メソッドの戻り値オブジェクトに `serverStartedAt: deps.serverStartedAt` を含める。

### 2.3 フロントエンド API クライアント（境界バリデーション）
**対象ファイル:** `apps/web/src/api/monitoringStatus.ts`
- `isMonitoringResponse` バリデーションに `isIsoDate(value.serverStartedAt)` の検証を追加。

### 2.4 時刻・経過時間整形関数
**対象ファイル:** `apps/web/src/monitoring/monitoringTimeFormat.ts`
- `formatElapsedTime(elapsedSeconds: number): string` を追加（設計・仕様は前回同様）。
- `apps/web/src/monitoring/monitoringPresentation.ts` から re-export。

### 2.5 監視ダッシュボード
**対象ファイル:** `apps/web/src/monitoring/MonitoringDashboard.tsx`
- `MonitoringDashboardView` 内で、`state.data` が存在する場合は `serverStartedAt` と `generatedAt` を用いて 1秒周期でカウントアップ。
- `state.data === null` の場合は `運転時間: —` を表示。
- 更新行のマークアップ:
  ```tsx
  <div className="monitoring-update-row">
    <span className="monitoring-uptime">
      運転時間: {uptimeText}
    </span>
    <span>
      最終表示更新{' '}
      {state.data ? (
        <time dateTime={state.data.generatedAt}>
          {formatJstDateTime(state.data.generatedAt)}
        </time>
      ) : (
        '—'
      )}
    </span>
  </div>
  ```

### 2.6 スタイルの調整
**対象ファイル:** `apps/web/src/monitoring/monitoring.css`
- `.monitoring-update-row span { white-space: nowrap; }`

### 2.7 テストおよびフィクスチャの更新
1. **フィクスチャ更新**:
   - `apps/web/tests/monitoringFixture.ts`
   - `apps/api/tests/issue42MonitoringApi.test.ts`
   - 各フィクスチャの `MonitoringStatusResponse` に `serverStartedAt: '2026-09-20T00:00:00.000Z'` などの有効な ISO 日時文字列を追加。
2. **単体テスト**:
   - `apps/web/tests/monitoringTimeFormat.test.ts`: `formatElapsedTime` の書式整形テスト。
   - `apps/web/tests/monitoringDashboard.test.ts`: 運転時間の表示・配置テスト、データ有無に応じた表示テスト（`—` vs 実時間）。
   - `apps/api/tests/issue42MonitoringApi.test.ts`: 稼働状態APIが `serverStartedAt` を返し、`generatedAt` 以前の妥当な日時であることを検証。

---

## 3. 受け入れ条件のチェックリスト

- [ ] `packages/shared/src/monitoringStatus.ts` の `MonitoringStatusResponse` に `serverStartedAt: UtcIso8601String` が定義されていること。
- [ ] バックエンドの稼働状態API（`/api/monitoring/status`）の応答に `serverStartedAt` が含まれ、サーバー起動時刻を示す UTC ISO 8601 文字列であること。
- [ ] `apps/web/src/api/monitoringStatus.ts` の境界バリデーションで `serverStartedAt` が正しく検証され、形式不正時は拒否されること。
- [ ] 取得監視画面を表示した際、初回読み込み中（データ未取得時）は `運転時間: —` と表示されること。
- [ ] 監視データ取得後は、最終表示更新の左側に `運転時間: hh:mm:ss` が表示され、サーバー起動からの経過時間が1秒ごとにカウントアップされること。
- [ ] 画面をリロードしても、サーバーが稼働し続けていればサーバーの同一運転時間（起動からの経過時間）が正しく表示されること。
- [ ] 通信失敗時（`phase: 'failed'`）でも、直前に取得したサーバー起動時刻に基づいて運転時間のカウントアップが継続すること。
- [ ] `formatElapsedTime` が秒数を正しく `hh:mm:ss` 形式に整形し、24時間以上でも日数を分けず時間部を累積すること。
- [ ] `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check`、および全テストが合格すること。

---

## 4. 後続Issueへの引き継ぎ事項

- サーバープロセスの再起動（Node.js再起動）が行われた場合、`serverGenerationId` とともに `serverStartedAt` も更新され、運転時間は0から再開されます。

---

## 5. 実挙動未確認事項

- なし。
