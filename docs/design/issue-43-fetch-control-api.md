# Issue #43 設計書: E11. 取得制御API（開始・停止・強制更新、要求識別子による重複防止）

## 1. 目的と範囲

基本設計 §8.1 / §8.2 に基づき、監視画面（K2）から送る「開始」「停止」「強制更新」の3操作をHTTPで受け付け、要求識別子（requestId）で重複実行を防ぎ、結果をB5（`operation_history`）へ記録し、結果不明時に同じrequestIdで再照会できるAPIを実装する。あわせて、AD-H068 の結論に従いプロセスの正常終了（OSシグナル）を捕捉して最終状態を記録・通知する。

### 1.1 やること

- 取得制御エンドポイント3種（開始・停止・強制更新）と、結果照会エンドポイント1種の新設
- requestId による重複防止（同一requestIdでジョブを増やさない）と、強制更新の同時実行集約
- 操作結果のB5記録（1要求＝1行、`recordOperationHistory` を結果確定時に1回だけ呼ぶ）
- 操作成功時の system 操作系通知（B4 `notification_output_history` へ記録 → E9差分APIで配信される）
- graceful shutdown フック（SIGTERM/SIGINT）による最終状態のB5記録と「サービス停止」通知
- 強制更新に限り、夜間帯の索引取得停止を迂回する経路（§9-A）
- 停止30分以上からの再開時に、長期フィードによる復旧を1回実行する（§9-B）

### 1.2 やらないこと

- 監視画面のツールバーUI（K2 #75）、操作履歴の閲覧UI・一覧API（K5 #78 / E10 #42）
- 取得元単位の個別操作（基本設計 §8.2 で全体一括のみと確定済み）
- 操作者認証・認可（AuthGate連携側。本Issueでは `actorId` / `actorDisplayName` は常に NULL）
- **手動DB初期化・削除操作・削除権限（AD-H013）**。棚卸しの結論どおり、旧削除API申し送りは採用しない。本Issueでは削除系の入口を1つも作らない
- 異常終了（クラッシュ）・フリーズの検知と、それに伴う停止通知（AD-H068 の確定事項どおり対象外）
- 設定のホットリロード、時間帯設定の変更API

## 2. 参照した資料と、設計判断の根拠

| 参照 | 本設計への反映 |
| --- | --- |
| Issue #43 本文（受け入れ条件） | エンドポイント構成・重複防止・集約・B5記録・結果再照会をそのまま実装対象とした |
| 統括担当からのヒアリング確定事項 (1) AD-H064 | 強制更新はバックオフ待機中でも割り込んで実行する。ただしスケジューラの次回自動取得タイミング（夜間帯を含む定期ポーリング間隔）には影響を与えない独立した単発実行とする（§5.3・§5.5） |
| 統括担当からのヒアリング確定事項 (2) AD-H068 | graceful shutdown フックでB5へ最終状態を記録し `system-service-stopped` を生成する。明示停止操作は `system-fetch-manually-stopped` で別物として扱い、`fetch_health` の遷移とは連動させない（§6） |
| 統括担当からのヒアリング確定事項 (3) AD-H013 | 削除系は対象外のまま（§1.2） |
| `docs/basic-design.md` §8.2 操作の動作案 | 停止は新規投入を止め実行中は完了させる／手動停止は時間帯が変わっても維持する／**強制更新は停止中でも実行できるが自動取得は再開しない**／全体一括のみ、を仕様として採用（§5.2・§5.3） |
| `docs/design/issue-9-operation-history.md` §8 | 受理時刻を保持し結果確定時に `requestedAt`/`completedAt` を揃えて1回だけ記録。未完了行のUPDATEはしない。タイムアウト時は同じrequestIdを照会し新規行を追加しない。B5の success/failure から取得元別の詳細成否を導出しない（§5.4・§5.6） |
| `docs/design/issue-24-time-based-polling-scheduler.md` §8 | 「現在の停止設定を迂回する入口を本Issueで作らない」との申し送りがある。本Issueのヒアリング確定事項(4)により、**手動操作（強制更新）に限りこの申し送りの明示的な例外**を置く。定期取得のスケジュール・オンデマンド画像取得の停止設定は迂回しない（§9-A） |
| 統括担当からのヒアリング確定事項 (4) 9-A | 夜間帯の強制更新は、雨雲・キキクルの時刻一覧を含む全取得元を1回だけ実行する（手動操作のときだけ夜間停止を迂回する）（§5.3・§9-A） |
| 統括担当からのヒアリング確定事項 (5) 9-B | 停止時間が30分以上なら、開始操作の中で長期フィードによる復旧を自動実行する。30分未満は通常取得1回のみ。しきい値30分は固定値（§5.2・§9-B） |
| 統括担当からのヒアリング確定事項 (6) 9-B | 夜間帯に開始操作を行った場合、停止30分以上でも長期フィード復旧は走らせない。未消化の `lastStoppedAt` は次の明示的な開始操作まで保留する。夜間明けの境界での自動復旧フックはPoCでは実装しない（§9-B・§8・§11） |
| `apps/api/src/polling/imageServices.ts` / `nowcastService.ts` / `kikikuruService.ts`（実コード確認） | `refreshTimes` 冒頭の `getCatalogAccess().allowed === false` が夜間の索引取得を止めている。`getCatalogAccess` は「夜間（`imageCatalogSeconds === null`）」と「`isClosed` / `enablePolling:false`」を同じ `allowed:false` にまとめているため、迂回は前者だけに限定する必要がある（§9-A） |
| `apps/api/src/polling/jmaXmlFeeds.ts` `getFeedDefinitionsForTrigger`（実コード確認） | `trigger:'recovery'` のみが長期フィード（`regular_l`/`extra_l`）を含む全フィード定義を返す。`scheduled`/`manual` は `high_frequency` のみ。よって復旧は `pollFeeds('recovery')` で実現できる（§9-B） |
| `apps/api/src/polling/jmaXmlPollingService.ts`（実コード確認） | `pollOnce('manual')` が既存。`executePollCycle` はバックオフ待機スキップを `trigger === 'scheduled' \|\| 'recovery'` に限定しているため、`manual` は待機中フィードでも実行される＝確定事項(1)を既存コードのまま満たす。また `pollFeeds` は `nextScheduledPollAtMs` を書き換えないため定期予定に影響しない |
| `apps/api/src/polling/timeBasedPollingScheduler.ts`（実コード確認） | `start()`/`stop()` が全体一括の開始・停止として既に存在し、`stop()` は実行中ジョブの完了を待つ（＝基本設計の「実行中の処理は完了させる」に一致）。`stop()` は境界タイマーも解除するため、手動停止は時間帯境界を跨いでも維持される |
| `apps/api/src/repositories/operationHistoryRepository.ts` / `apps/api/migrations/0012_create_operation_history.sql`（実コード確認） | `request_id` に UNIQUE 制約があり、`findOperationHistoryByRequestId` が既存。`operationKind` は `start`/`stop`/`force_refresh`、`targetKind` は `all` のみ。`actorId`/`actorDisplayName` は NULL 以外を渡すと例外 |
| `apps/api/src/notifications/fetchHealthNotificationPlanner.ts` / `fetchHealthNotificationEmitter.ts`（実コード確認） | planner（純粋関数）→ emitter（記録・例外を外に出さない）の既存パターンを踏襲する |
| `packages/shared/src/notificationMessageDefinitions.ts`（実コード確認） | `system-fetch-manually-started` / `system-fetch-manually-stopped` / `system-force-fetch-completed` / `system-force-fetch-failed` / `system-service-stopped` の5定義が既にあり、追加・変更は不要。`targets` は空配列不可なので `omitTarget` を使う場合でも1件は積む |

## 3. モジュール構成

新規・変更するファイルは以下。既存ファイルの構造変更は行わない。

| 種別 | パス | 役割 |
| --- | --- | --- |
| 新規 | `packages/shared/src/fetchControl.ts` | リクエスト/レスポンスの型と `parseFetchControlRequest` |
| 変更 | `packages/shared/src/index.ts` | 上記の再エクスポート |
| 新規 | `apps/api/src/services/fetchControlService.ts` | 操作の直列実行・重複防止・集約・B5記録・通知発行 |
| 新規 | `apps/api/src/notifications/operationNotificationPlanner.ts` | 操作結果 → `SystemNotification` + 出力スナップショットの決定（純粋関数） |
| 新規 | `apps/api/src/notifications/operationNotificationEmitter.ts` | 上記を B4 へ記録（例外を外へ出さない） |
| 変更 | `apps/api/src/app.ts` | 4エンドポイントの追加（`dependencies.fetchControl` がある場合のみ） |
| 変更 | `apps/api/src/polling/timeBasedPollingScheduler.ts` | `runManualOnce()` / `runRecoveryOnce()` の追加と、各アダプタへの `runManual()` 追加 |
| 変更 | `apps/api/src/polling/nowcastTypes.ts` / `kikikuruTypes.ts` | `*AttemptOptions` へ `bypassScheduleStop?: boolean`、`*Options` へ `getManualCatalogAccess?: () => UpstreamAccess` を追加（§9-A） |
| 変更 | `apps/api/src/polling/nowcastService.ts` / `kikikuruService.ts` | `refreshTimes` の索引許可判定のみ、上記フラグで参照先を切り替える（§9-A）。画像取得（`getImageAccess`）側は一切変更しない |
| 変更 | `apps/api/src/polling/imageServices.ts` | `getManualCatalogAccess` の実装と両サービスへの注入（§9-A） |
| 変更 | `apps/api/src/server.ts` | `FetchControlService` の生成・注入、graceful shutdown フックの登録 |
| 新規 | `apps/api/tests/issue43FetchControlApi.test.ts` | 受け入れ条件の検証（`tests/` 直下フラット配置。`npm run test -w apps/api` の glob `tests/*.test.ts` に入れるため） |

## 4. 型定義・シグネチャ

### 4.1 shared

```ts
// packages/shared/src/fetchControl.ts
export type FetchControlOperationKind = 'start' | 'stop' | 'force_refresh';
export type FetchControlState = 'starting' | 'running' | 'stopping' | 'stopped';

export interface FetchControlRequest {
  readonly requestId: string; // RFC4122 UUID 文字列（クライアント生成）
}

export interface FetchControlCompletedResponse {
  readonly status: 'completed';
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
  readonly targetKind: 'all';
  readonly result: 'success' | 'failure';
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly duplicate: boolean; // 既存記録の再生なら true
  readonly fetchControlState: FetchControlState;
}

export interface FetchControlInProgressResponse {
  readonly status: 'in_progress';
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
  readonly targetKind: 'all';
  readonly requestedAt: UtcIso8601String;
  readonly fetchControlState: FetchControlState;
}

/** 本文が {requestId: <UUID>} ちょうど1キーでなければ null。 */
export function parseFetchControlRequest(value: unknown): FetchControlRequest | null;
/** パス変数 :requestId の検証にも使う。 */
export function isFetchControlRequestId(value: unknown): value is string;
```

`isFetchControlRequestId` は `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` で判定する。UUIDに限定する理由は、`request_id` の長さと文字種を境界で確定させ、B5の UNIQUE キーに任意長文字列が入らないようにするため。

### 4.2 FetchControlService

```ts
// apps/api/src/services/fetchControlService.ts
export interface FetchControlTargets {
  /** scheduler.start() 相当。冪等。 */
  start(): Promise<void>;
  /** scheduler.stop() 相当。実行中ジョブの完了を待つ。冪等。 */
  stop(): Promise<void>;
  /** 定期予定に影響しない全取得元の単発実行。夜間帯でも実行する（§9-A）。 */
  forceRefresh(): Promise<void>;
  /** 長期フィードを含む復旧取得を1回行う（§9-B）。scheduler.runRecoveryOnce() 相当。 */
  runRecovery(): Promise<void>;
  /** 現在の運転状態（スケジューラの isRunning 由来）。 */
  isRunning(): boolean;
  /** 現在時刻が上流取得を許す時間帯か（`resolvePollingPeriod(now).xmlSeconds !== null`）。§9-B の復旧判定に使う。 */
  isUpstreamAllowedNow(): boolean;
}

export interface FetchControlServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly targets: FetchControlTargets;
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}

export type FetchControlOutcome =
  | { readonly kind: 'completed'; readonly response: FetchControlCompletedResponse }
  | { readonly kind: 'in_progress'; readonly response: FetchControlInProgressResponse }
  | { readonly kind: 'conflict'; readonly recordedOperationKind: FetchControlOperationKind }
  | { readonly kind: 'not_found' };

export interface FetchControlService {
  request(kind: FetchControlOperationKind, requestId: string): Promise<FetchControlOutcome>;
  find(requestId: string): FetchControlOutcome;
  getState(): FetchControlState;
  /** graceful shutdown 用。B5記録 + サービス停止通知を1回だけ行う。 */
  recordShutdown(): Promise<void>;
}

export function createFetchControlService(
  dependencies: FetchControlServiceDependencies,
): FetchControlService;
```

### 4.3 スケジューラ拡張

```ts
// apps/api/src/polling/timeBasedPollingScheduler.ts
export interface ScheduledPollAdapter {
  readonly source: ScheduledSource;
  runScheduled(): Promise<void>;
  /** 強制更新用の単発実行。未実装のアダプタは runScheduled と同じ取得を triggerKind:'manual' で行う。 */
  runManual(): Promise<void>;
}

export interface ManualRunResult {
  /** 例外が起きた取得元（順不同）。空なら全件正常終了。 */
  readonly failedSources: readonly (ScheduledSource | 'xml')[];
}

export class TimeBasedPollingScheduler {
  /** 定期タイマー・世代・lastCompletedAt を一切変更せずに全取得元を1回実行する。夜間帯でも実行する。 */
  runManualOnce(): Promise<ManualRunResult>;
  /** 長期フィードを含む復旧取得を1回行う（XMLのみ）。定期タイマー・世代を変更しない。 */
  runRecoveryOnce(): Promise<void>;
  isRunning(): boolean;
}
```

`runManualOnce()` の実装契約（製造時に必ず守る）:

- `this.generation` を進めない。`this.timerIds` を触らない。`this.lastCompletedAtMap` / `this.nextRunAtMap` / `this.sourceStates` を更新しない。
- XML は `xmlPollingService.pollOnce('manual')` を呼ぶ。
- non-XML は、`inFlightPromises` に同じ source の定期実行があればそれを `await` して合流し（二重取得防止）、無ければ `adapter.runManual()` を呼ぶ。`runManual()` の Promise は `inFlightPromises` に入れない（定期側の完了処理を誘発させないため）。
- 4系統を `Promise.allSettled` で並行実行し、reject した source 名を `failedSources` に集める。例外は外へ投げない。
- `AmedasScheduledAdapter.runManual()` は `runAmedasFetchCycle(..., { triggerKind: 'manual', backfillBlocks: 0, pointFetchPolicy: 'always' })` を呼び、`lastPointFetchStartedAtMs` を更新しない。
- `NowcastScheduledAdapter` / `KikikuruScheduledAdapter` の `runManual()` は `refreshTimes({ triggerKind: 'manual', bypassScheduleStop: true })` を呼ぶ（§9-A）。

`runRecoveryOnce()` の実装契約:

- `xmlPollingService.pollFeeds('recovery')` を呼ぶだけとする。`recovery` トリガは `getFeedDefinitionsForTrigger` により長期フィード（`regular_l`/`extra_l`）を含む全フィード定義を対象とする（実コードで確認）。
- 非XML取得元（アメダス・雨雲・キキクル索引）は長期フィードに相当する復旧経路を持たないため、復旧対象に含めない。停止中の取りこぼしは次回の定期取得で最新化される。
- タイマー・世代・`nextRunAt` を変更しない（`pollFeeds` は `nextScheduledPollAtMs` を書き換えない）。
- 索引の夜間ゲートは迂回しない（そもそも索引を触らない）。

## 5. 振る舞い

### 5.1 エンドポイント

| メソッド | パス | 用途 |
| --- | --- | --- |
| POST | `/api/control/fetch/start` | 自動取得の開始／再開 |
| POST | `/api/control/fetch/stop` | 自動取得の停止 |
| POST | `/api/control/fetch/force-refresh` | 強制更新（単発） |
| GET | `/api/control/operations/:requestId` | 結果照会 |

- 本文は `{"requestId": "<UUID>"}` のみ。他のキーがあれば 400。
- 全レスポンスに `Cache-Control: no-store` を付ける（既存API方針と同一）。
- ステータスコード
  - 200: `status: "completed"`（新規完了・重複再生のどちらも）
  - 202: `status: "in_progress"`（同一requestIdが実行中、または照会時に実行中）
  - 400: `{"status":"error","code":"invalid_request"}`（本文・パス変数の不正）
  - 404: `{"status":"error","code":"unknown_request"}`（照会時、B5にもメモリにも無い）
  - 409: `{"status":"error","code":"operation_kind_conflict"}`（同じrequestIdが別種の操作として既に使われている）
  - 503: `{"status":"error","code":"fetch_control_unavailable"}`（ポーリング無効起動でスケジューラが無い）
- 操作系3つは冪等ではなく「requestId単位で1回だけ実行」である。K2は操作ごとに新しいUUIDを発行し、送信失敗・タイムアウト時は**同じUUIDで再送または照会**する。

### 5.2 開始・停止の意味

- **開始**: `scheduler.start()` を呼ぶ。既に稼働中なら何もせず success（状態は `running`）。XMLは `immediateScheduled: true` 相当で即時1回の定期取得が走る（既存実装）。
  - **停止時間が30分以上なら、続けて長期フィードによる復旧（`targets.runRecovery()`）を1回実行する**（§9-B、確定事項(5)）。30分未満なら復旧を実行せず、再開直後の通常取得1回で足りるものとする。
- **停止**: `scheduler.stop()` を呼ぶ。新規投入を止め、実行中ジョブの完了を待ってから結果を確定する。よって `completedAt` は「停止完了時刻」を意味する。待機中は `fetchControlState: "stopping"`。
- 手動停止は時間帯境界を跨いでも維持される（`stop()` が境界タイマーを解除し `isRunning=false` にするため、境界到来時の自動再開は起きない）。保存データ・履歴は削除しない。

### 5.3 強制更新の意味【確定事項(1)の反映】

- 次回予定を待たず、全取得元（XML定時・随時、雨雲時刻一覧、キキクル時刻一覧、アメダス）を**1回だけ**取得する。
- **指数バックオフの待機中でも割り込んで実行する。** 既存の `executePollCycle` はバックオフ待機スキップを `scheduled`/`recovery` に限定しているため、`manual` トリガで呼ぶだけでこの要件を満たす。バックオフの内部状態（連続失敗回数・`nextAllowedFetchAt`）は強制更新の結果に応じて通常どおり更新される（成功ならリセット、失敗なら加算）。これは「取得に成功したのに待機し続ける」ことを避けるための既存挙動であり、変更しない。
- **スケジューラの次回自動取得タイミングを変えない。** §4.3 の実装契約で、タイマー・世代・`lastCompletedAt` を触らないことを担保する。
- **停止中でも実行できる。自動取得は再開しない**（基本設計 §8.2）。実行後も `fetchControlState` は `stopped` のまま。
- **夜間帯（既定 20:00〜翌04:00 JST）でも、雨雲・キキクルの時刻一覧を含む全取得元を1回だけ実行する**（§9-A、確定事項(4)）。迂回するのは手動操作のときだけで、定期取得のスケジュールとオンデマンド画像取得の停止設定は迂回しない。
- 取得済み全XMLの再ダウンロードはしない（通常の定期取得と同じ取得範囲。長期フィードは含まない＝`trigger:'manual'` は `high_frequency` のみ）。強制更新は「今すぐ最新にする」操作であり、取りこぼしの埋め戻しは開始操作側の復旧（§9-B）が担う。

### 5.4 重複防止と集約

サービス内部に「単一の直列レーン（Promise チェーン）」と「実行中エントリの表」を持つ。

1. **同一requestIdが完了済み**（B5に行がある、またはメモリの完了表にある）→ 実行せず、記録内容をそのまま `duplicate: true` で返す（200）。記録の `operationKind` が要求と異なれば 409。
2. **同一requestIdが実行中** → 新しいジョブを起こさず 202 を返す。
3. **別requestIdの強制更新が実行中** → 実行中の単発取得へ**合流**する。上流取得は1回しか走らない。合流した各requestIdは、**自分の受理時刻（`requestedAt`）** と、**共有実行の `completedAt` / `result` / `errorCode` / `errorMessage`** でB5へ1行ずつ記録される。
4. **開始・停止**は直列レーンで順に実行する（同時に届いた場合はキューイングし、先着から順に実行）。強制更新もレーンを共有し、3の合流条件に当たる場合のみレーンを取らずに合流する。
5. B5の `request_id` UNIQUE 制約を最後の砦とする。制約違反（別経路での同時挿入）は 409 として扱い、行を二重に作らない。

### 5.5 結果照会

- `GET /api/control/operations/:requestId` は、B5 → メモリ完了表 → 実行中表 の順に探す。
- 見つからなければ 404 `unknown_request`。**プロセス再起動でメモリを失い、かつB5記録前に落ちた要求は結果不明のまま 404 になる。** これは許容し、K2側は「結果不明」として表示する（§8へ申し送り）。
- メモリ完了表は最大200件のFIFO（B5書き込みが失敗した場合のフォールバック用）。B5が正であり、両者が食い違う場合はB5を返す。

### 5.6 result の意味

- `result` は「**操作が実行できたか**」を表す。個々の取得元のHTTP成否は `fetch_attempt`（B3）が持つ（issue-9 §8 の申し送りどおり、B5の success/failure から取得元別の詳細成否を導出しない）。
- 強制更新は、`runManualOnce()` が返す `failedSources` が空なら success、1件以上なら failure（`errorCode: "force_refresh_failed"`、`errorMessage` は失敗した取得元IDをカンマ区切りで並べた文字列。改行・URL・上流応答本文を含めない、最大200文字で切り詰め）。
- 開始・停止は例外が出なければ success、例外なら failure（`errorCode: "start_failed"` / `"stop_failed"`、`errorMessage` は `sanitize` 済みの例外メッセージを200文字で切り詰め）。
- 開始に伴う復旧（§9-B）の失敗は**開始操作の failure にしない**。復旧は「自動取得を再開できたか」とは別の付随処理であり、上記「result は操作が実行できたか」の原則に従う。取得元別の成否はB3（`fetch_attempt`、`trigger_kind='recovery'`）に残る。復旧中の例外は捕捉して `console.error` に残すだけとする。
- `actorId` / `actorDisplayName` は常に `null`（AuthGate連携まで。リポジトリ側も非nullを拒否する）。

## 6. 通知の発生源【確定事項(2)・AD-H068 の結論】

| 契機 | 定義ID | category | changeType | 備考 |
| --- | --- | --- | --- | --- |
| 開始 success | `system-fetch-manually-started` | warning | `fetch_manually_started` | `omitTarget: true` |
| 停止 success | `system-fetch-manually-stopped` | warning | `fetch_manually_stopped` | `omitTarget: true` |
| 強制更新 success | `system-force-fetch-completed` | warning | `force_fetch_completed` | `omitTarget: true` |
| 強制更新 failure | `system-force-fetch-failed` | question | `force_fetch_failed` | 対象省略不可。`detail` に失敗取得元名 |
| プロセス正常終了（SIGTERM/SIGINT） | `system-service-stopped` | question | `service_stopped` | 定義側で対象は固定文言 |

- 開始・停止の **failure には対応する通知定義が存在しない**ため、通知を生成せずB5へfailureを記録するだけとする（定義を勝手に増やさない）。
- 通知事実の共通項目: `origin: 'system'`、`sourceType: 'fetch_control'`、`sourceVersion: null`、`targets: [{ kind:'equipment', codeType:'wx-viewer-poc/fetch-control', code:'all', name:'防災気象情報' }]`、`relatedRefs: [{ type:'operation_request', ref: requestId }]`、`occurredAt = detectedAt = completedAt`、`detectionContext: 'normal'`、`isTraining: false`（操作は実機操作であり訓練注入の対象外）。
- 記録先は B4 `notification_output_history`（`toNotificationOutputHistoryInput` + `recordNotificationOutputHistory`）。E9差分API（#41）は同テーブルを読むため、追加の配線なしで端末へ届く。
- **`fetch_health` とは連動させない**（AD-H068 の分離）。E11の停止操作は `system-fetch-manually-stopped` のみを出し、`system-service-stopped` は出さない。逆に、停止に伴って `fetch_health` が `suspended` へ遷移しても、既存 planner が `suspended_transition` として通知を抑止するため二重通知にならない（`fetchHealthNotificationPlanner.decideTransition` で確認済み）。
- 通知の記録失敗は操作の失敗にしない（emitter が例外を外へ出さず `console.error` で残す。既存 `emitFetchHealthNotification` と同じ扱い）。

### 6.1 graceful shutdown フック

- `server.ts` の実行系エントリ（`startApiServer`）で `process.once('SIGINT'|'SIGTERM')` から呼ばれる停止シーケンスに、`fetchControl.recordShutdown()` を **`scheduler.stop()` の後、`database.close()` の前** に挿入する。
- `recordShutdown()` は、B5へ `operationKind: 'stop'`、`targetKind: 'all'`、`result: 'success'`、`requestId: 'shutdown-<uuid>'`、`requestedAt`（シグナル受信時刻）、`completedAt`（記録直前の時刻）で1行記録し、続けて `system-service-stopped` を B4 に記録する。2回以上呼ばれても1回しか記録しない。
- テスト容易性のため、シグナル購読は `registerGracefulShutdown(emitter: NodeJS.EventEmitter | Pick<NodeJS.Process,'once'>, handler)` の形で切り出し、テストは偽のEventEmitterへ `SIGTERM` を流して検証する。
- `startServer()`（テスト用エントリ）の `close()` は**シグナル由来でない限り記録しない**（`close({ reason: 'signal' | 'programmatic' })` で分岐）。既存テストのDBに停止行が混ざるのを避けるため。
- **異常終了（SIGKILL・クラッシュ・フリーズ）では記録も通知もされない。** 確定事項(2)どおり許容する。停止通知は「正常終了したこと」の記録であり、「サービスが生きていること」の保証には使わない。
- シャットダウン時に記録した通知は、HTTPサーバーが閉じるまでの短時間しか配信機会がないため、実質的には次回起動後の起動時通知API（#29）／差分API（#41）経由で端末に届く。これは仕様として受け入れる。

## 7. 既存実装との境界（Issue #139 追加受け入れ条件への対応）

| 事項 | 現状 | 本Issueでの扱い |
| --- | --- | --- |
| 全体開始・停止 | `TimeBasedPollingScheduler.start()/stop()` は実装済み、HTTP未接続 | HTTPから呼べるようにする。スケジューラ本体の停止・再開ロジックは変更しない |
| 強制更新 | 未実装（`pollOnce('manual')` は存在するがXMLのみ、非XMLに手動入口なし） | `runManualOnce()` と各アダプタの `runManual()` を新設する |
| 夜間帯の索引取得ゲート | `refreshTimes` 冒頭で `getCatalogAccess()` により一律停止 | 手動強制更新のときだけ迂回できる経路を追加する（§9-A）。定期経路・画像取得・close後・`enablePolling:false` は迂回できない |
| 停止→再開時の復旧 | 未実装（`start()` は初期取得完了済みなら再予約のみ） | 停止30分以上かつ日中帯なら `pollFeeds('recovery')` を1回実行する（§9-B）。スケジューラの周期・次回予定は変更しない |
| B5リポジトリ | 実装済み（UNIQUE・NULL制約含む） | 利用するだけ。マイグレーション `0012` は編集しない |
| 操作系通知 | 定義registryのみ存在し、生成は未接続 | planner/emitter を新設して接続する |
| 停止検知 | 未実装 | graceful shutdown フックを新設する。異常終了検知は作らない |
| 削除・DB初期化 | 未実装 | 作らない（AD-H013） |
| 認証・認可 | 未実装 | 作らない。`actor*` は NULL 固定 |

共通メタ情報の維持: 本Issueが触るのは操作記録と system 通知のみで、気象データの共通メタ情報（発表時刻等）・availability 3状態・会場スコープ・本番/訓練の区別を変更しない。操作は全体一括のため会場に依存せず、通知の `isTraining` は常に `false`、時刻はすべてUTCのISO8601（`Z` 終端）で `requestedAt ≤ completedAt` を守る。

## 8. 後続Issueへの引き継ぎ

- **C14 #24（スケジューラ）への差分**: 本Issueは「手動操作のときだけ夜間停止を迂回する」例外を1か所だけ追加する（索引の `refreshTimes` に `bypassScheduleStop`）。#24 の設定項目・既定値・周期解決・境界タイマー・鮮度判定は変更しない。将来 #24 側で夜間ゲートの実装を変える場合は、この迂回経路（`getManualCatalogAccess`）も併せて見直すこと。
- **夜間明けの復旧消化（PoCでは対応しないことが確定・確定事項(6)）**: 夜間帯の開始操作で保持された `lastStoppedAt` は夜間明けに自動消化されず、次の明示的な開始操作まで保留される（§9-B）。これはPoCの仕様として確定しており、#24 の時間帯境界処理へのフック追加は行わない。将来必要になった場合に別Issueで検討する。
- **K2 #75（ツールバー）**: requestIdはクライアント生成のUUID。開始操作は復旧を伴うと完了まで時間がかかるため、202 `in_progress` を受け取って同一requestIdで照会する導線を必ず用意する。送信失敗・タイムアウトは「結果不明」とし、同じUUIDで再送または `GET /api/control/operations/:requestId` で照会する。202は「処理中」、404は「結果不明（サーバー再起動等）」として区別して表示する。選択だけでは実状態を変えない。
- **K5 #78（操作履歴表示）**: B5の `actorId` は当面NULL。`errorMessage` は診断用の短文で、上流応答本文やURLは含まない。取得元別の詳細成否はB5ではなくB3（`fetch_attempt`）を見る。
- **E10 #42（監視API）**: `fetchControlState`（starting/running/stopping/stopped）は本サービスが持つ。E10は運転状態（この値）と取得健全性（`fetch_health`）を別々に表示する。
- **AuthGate連携**: 認証実装後に `actorId`/`actorDisplayName` を渡す。既存のNULL行を後追い更新しない。操作APIの権限はK端末へ移せるよう、ルーティングを `/api/control/` 配下にまとめてある。
- **H2 #64（通知表示）**: 操作系5種の通知は origin=system として通常の通知経路に乗る。操作結果の表示（K2）と通知表示（H2）の優先順は本Issueでは決めない（AD-H023、後続で確定）。

## 9. 追加確定事項（夜間帯の強制更新・再開時の復旧）

### 9-A. 夜間帯（運用外時間）における強制更新【確定】

**確定**: 夜間帯（既定 20:00〜翌04:00 JST）でも、**雨雲・キキクルの時刻一覧を含む全取得元を1回だけ実行する**。夜間帯の強制更新は、`docs/design/issue-24-time-based-polling-scheduler.md` §8 の「E11は現在の停止設定を迂回する入口を本Issueで作らない」という申し送りに対する**明示的な例外**として本Issueで定義する。迂回するのは強制更新という手動操作の場合のみであり、定期自動取得のスケジュールには一切影響を与えない。

手当てをしない場合、夜間の強制更新は取得元ごとに挙動が不揃いになる（コード読解に基づく。実挙動未確認）:

| 取得元 | 手当てをしない場合の夜間挙動 | 本設計での扱い |
| --- | --- | --- |
| XML定時・随時 | 夜間ゲートが `JmaXmlPollingService` 側に無いため取得しに行く | そのまま取得する（変更不要） |
| アメダス | 同上、取得しに行く | そのまま取得する（変更不要） |
| 雨雲・キキクル時刻一覧 | `refreshTimes` 冒頭の `getCatalogAccess().allowed === false` で、何も取得せず保存済み索引を返す（失敗記録も残らない） | 手動時のみゲートを迂回して取得する（下記の実装契約） |

**実装契約（迂回の範囲を最小にするための必須事項）**:

1. `NowcastAttemptOptions` / `KikikuruAttemptOptions` に `bypassScheduleStop?: boolean`（既定 `false`）を追加する。
2. `NowcastOptions` / `KikikuruOptions` に `getManualCatalogAccess?: () => UpstreamAccess` を追加する。`refreshTimes` は `bypassScheduleStop === true` かつ本関数が注入されているときだけこれを参照し、それ以外は従来どおり `getCatalogAccess()` を参照する（**未注入なら従来挙動にフォールバック**する）。
3. `imageServices.ts` の `getManualCatalogAccess` は、`isClosed || !enablePolling` のときは `allowed:false` を返し、それ以外は時間帯によらず `allowed:true` を返す。すなわち迂回できるのは**時間帯由来の停止だけ**であり、クローズ後・ポーリング無効起動は迂回できない。
4. 迂回するのは**時刻一覧（索引）の取得のみ**。画像タイルの取得許可（`getImageAccess` / `resolveOnDemandAccess`）は一切変更しない。よって夜間の強制更新後は「索引は最新・タイルは未取得（`scheduled_stopped`）」という状態があり得る。これは基本設計の夜間全停止方針（画像上流は止める）と整合する意図的な結果である。
5. 定期経路（`refreshTimes()` を引数なし、または `bypassScheduleStop` を渡さずに呼ぶ経路）の挙動は一切変えない。

**Issue #24 との整合（コンフリクト確認）**:

- #24 受け入れ条件3「既定夜間起動で全上流HTTPは0回」— 強制更新は手動操作でしか起こらず、同条件は無操作の起動を見るため影響しない。
- #24 受け入れ条件13「夜間の `refreshTimes` / `fetchFrameTiles` 直接呼出しで上流0回」— `bypassScheduleStop` の既定は `false` で、既存の呼び出しは引数を渡さないため挙動不変。`fetchFrameTiles`（画像）は本Issueで触らない。
- #24 §4.2「許可中に開始した定期ジョブは完了を許可し、停止後に新しい索引ジョブを開始しない」— 手動の索引ジョブは定期ジョブではないため、この規則の対象外である。なお `refreshTimes` は既存のレイヤー別キューを通るため、定期ジョブと手動ジョブが同時に走ることはない。
- #24 §5.2 の鮮度判定（経過時間ベース、`scheduledStopped` は判定入力に含めない）は変更しない。夜間に強制更新で実取得が成功すれば `lastSuccessAt` が更新され、その結果として鮮度が回復するのは実取得を行った当然の帰結である。
- 設定ファイル（YAML）の項目・既定値・解決規則は変更しない。夜間の許可設定を変える手段は従来どおり設定ファイルのみで、画面からは変更できない。

### 9-B. 停止→開始の再開時の復旧【確定】

**確定**: **停止時間が30分以上なら、開始操作の中で長期フィードによる復旧を自動実行する**。30分未満なら復旧せず、再開直後の通常取得1回で足りるものとする。しきい値30分は固定値として実装し、設定化はしない（必要になれば別Issueで扱う）。

**実装契約**:

1. `FetchControlService` は、停止操作が success で確定した時刻（その要求の `completedAt`）を `lastStoppedAt` としてメモリに保持する。graceful shutdown による停止記録も同様に保持するが、プロセスが終了するため実質的に使われない。
2. 開始操作の処理は「`targets.start()` を await → 判定 → 条件を満たせば `targets.runRecovery()` を await → 結果確定」の順とする。`completedAt` は復旧完了後の時刻となる。復旧待ちの間、同一requestIdの再送は 202 `in_progress` を返す。
3. 判定式は `lastStoppedAt !== null && (開始要求の requestedAt - lastStoppedAt) >= 30 * 60 * 1000`。**30分ちょうどは復旧する**（「以上」）。判定に用いる定数は `fetchControlService.ts` に `RESUME_RECOVERY_THRESHOLD_MS = 30 * 60_000` として置く。
4. ただし、**開始時点が夜間帯（当該時刻の `period.xmlSeconds === null`）なら復旧を実行しない**。9-A で承認された夜間停止の迂回は「強制更新という手動操作」に限られており、開始操作に付随する復旧まで広げない。この場合 `lastStoppedAt` はクリアせず保持し、次の開始操作が夜間帯外で行われたときに復旧する。判定に必要な時間帯情報は `FetchControlTargets` に `isUpstreamAllowedNow(): boolean`（scheduler の `resolvePollingPeriod(now).xmlSeconds !== null` 相当）を1つ追加して取得する。
5. 復旧を実行した場合は `lastStoppedAt` を `null` に戻す。よって連続した開始操作で復旧が二重に走らない。
6. **プロセス再起動をまたいだ復旧は本Issueの対象外**。`lastStoppedAt` はプロセス内メモリのみで、B5から復元しない。起動時の初期取得（`initialFetchPhase` が `not_started`）は既存実装が長期フィードを含む `initial` 取得を行うため、そもそも本条件の対象にならない。
7. 復旧は `xmlPollingService.pollFeeds('recovery')` の1回呼び出しで、長期フィードを含む全フィードを対象とする。バックオフ待機中のフィードは既存実装どおりスキップされる（`recovery` はスキップ対象トリガ）。これは本Issueで変更しない。
8. 復旧の失敗は開始操作の `result` を変えない（§5.6）。

**Issue #24 との整合（コンフリクト確認）**:

- `pollFeeds` は `nextScheduledPollAtMs` を書き換えないため、#24 が管理する次回予定・時間帯境界タイマーに影響しない。
- 復旧は XML のみを対象とし、#24 が管理する索引・アメダスの周期には触れない。
- **夜間帯の開始操作では復旧を実行しない**（上記実装契約4）。`TimeBasedPollingScheduler.start()` は `period.xmlSeconds === null` のとき `xmlPollingService.start()` を呼ばず周期をnullにするだけなので（実コードで確認）、夜間の開始操作は「スケジューラを再開状態にし、夜間明けの境界から定期取得を始める」だけになる。復旧だけがそこへ割り込むと #24 の夜間全停止方針と食い違うため、揃えて抑止する。

**夜間明けの自動復旧【確定：PoCでは対応しない】**

夜間の開始操作で保持された `lastStoppedAt` は、夜間明けに自動では消化されない（次の明示的な開始操作が行われるまで未消化のまま保留される）。

**確定**: この挙動をPoCの仕様として受け入れる。夜間明けの時間帯境界で復旧を自動実行するフック（#24 の境界処理への追加）は本Issueのスコープ外とし、**追加実装を行わない**。理由は以下のとおり。

- 夜間に停止・開始を行うのは運用者の明示的な操作であり、その後の復旧タイミングも運用者の明示的な開始操作に委ねるほうが、挙動が予測しやすい。
- 夜間明けの境界処理へ復旧フックを足すと、#24 が管理する境界タイマーの責務に本Issueの状態（`lastStoppedAt`）が混入し、#24 との境界が曖昧になる。
- 取りこぼしは、夜間明け以降に運用者が開始操作（または強制更新）を行えば復旧される。PoCの想定運用では夜間明けに運用者が画面を操作するため、実害は小さいと判断した。

将来、無操作でも自動的に埋め戻す必要が生じた場合は、#24 の時間帯境界処理へフックを足す別Issueで扱う。**本Issueでは、この保留動作を仕様どおりの正しい振る舞いとして検証する**（受け入れ条件25の後半）。

## 10. 受け入れ条件

検収担当は以下を1項目ずつ実行する。テストは `npm run test -w apps/api` で実行し、新規テストは `apps/api/tests/issue43FetchControlApi.test.ts`（フラット配置）に置く。**§9-A・§9-B は確定済みであり、保留項目は無い。全項目の通過を必須とする。**

1. **静的検査**: リポジトリルートで `npm run lint` / `npm run typecheck` / `npm run format:check` を実行し、いずれも終了コード0（エラー・警告0件）であること。
2. **テスト実行**: `npm run test -w apps/api` が終了コード0で、`issue43FetchControlApi.test.ts` のテストが実行されていること（実行ログにファイル名が現れる）。
3. **開始操作の記録**: 新しいUUIDで `POST /api/control/fetch/start` を呼ぶと 200・`status:"completed"`・`result:"success"`・`duplicate:false` が返り、`SELECT * FROM operation_history WHERE request_id=?` が1行で `operation_kind='start'`、`target_kind='all'`、`actor_id IS NULL`、`actor_display_name IS NULL`、`requested_at <= completed_at`、両者が `Z` 終端のUTC ISO8601であること。
4. **停止操作の記録**: 同様に `POST /api/control/fetch/stop` が 200 を返し、B5に `operation_kind='stop'` の行が1件増えること。呼び出し後 `scheduler.isRunning()` が false であること。
5. **重複防止（ジョブを増やさない）**: `start()` の呼び出し回数を数えるスタブを注入し、**同一requestId** で `POST /api/control/fetch/start` を3回呼ぶ。1回目200(`duplicate:false`)、2・3回目200(`duplicate:true`)で、スタブの呼び出し回数が1、B5の該当行数が1であること。
6. **実行中の重複要求**: 解決を保留できるPromiseを返すスタブを使い、同一requestIdで2回目を呼ぶと 202・`status:"in_progress"` が返り、スタブ呼び出し回数が1のままであること。
7. **強制更新の同時実行集約**: 上流取得回数を数えるスタブで、**別々のrequestId** の `POST /api/control/fetch/force-refresh` を、1回目の実行中に2件投げる。上流取得の実行回数が1、B5には2行（各々のrequest_id）ができ、2行の `completed_at` と `result` が一致し、`requested_at` はそれぞれの受理時刻であること。
8. **バックオフ割り込み**: あるXMLフィードをバックオフ待機状態にしたうえで強制更新を実行し、そのフィードに対する取得試行が実際に行われること（`fetch_attempt` に `trigger_kind='manual'` の行が増える、またはスタブのfetch呼び出しに当該URLが含まれる）を確認する。同じ状態で定期サイクル（`trigger='scheduled'`）を回した場合は取得試行が行われないことも併せて確認し、割り込みが `manual` 固有であることを示すこと。
9. **定期予定への非影響**: 強制更新の実行直前と直後で `scheduler.getStatus()` の各 `sources[*].nextRunAt` と `period` が変化しないこと（4取得元すべてについて等値比較）。日中帯・夜間帯の双方で確認すること。
10. **停止中の強制更新**: 停止操作の後に強制更新を実行すると `result:"success"` が返り、かつ実行後も `scheduler.isRunning()` が false（自動取得が再開していない）であること。
11. **手動停止の維持**: 疑似時計で時間帯境界を跨がせても、手動停止後は `scheduler.isRunning()` が false のままで、境界後に定期取得が起動しないこと（アダプタの実行回数が増えない）。
12. **結果照会**: 完了済みrequestIdへ `GET /api/control/operations/:requestId` を送ると 200 で POST と同じ `result`/`requestedAt`/`completedAt` が返ること。未知のUUIDでは 404 `unknown_request`、実行中のrequestIdでは 202 `in_progress` が返ること。
13. **入力検証**: 本文なし／`{}`／`{"requestId":"abc"}`（非UUID）／`{"requestId":"<UUID>","extra":1}` の4パターンすべてで 400 `invalid_request` が返り、B5に行が増えないこと。`GET /api/control/operations/not-a-uuid` も 400 になること。
14. **操作種別の衝突**: 同じrequestIdで `start` の後に `force-refresh` を呼ぶと 409 `operation_kind_conflict` が返り、B5の行数が増えないこと。
15. **通知生成**: 開始・停止・強制更新の各成功後に `notification_output_history` へ1件ずつ行が増え、`message_definition_id` がそれぞれ `system-fetch-manually-started` / `system-fetch-manually-stopped` / `system-force-fetch-completed`、`origin='system'`、`is_training=0`、`related_refs_json` に当該requestIdが含まれること。強制更新を失敗させた場合は `system-force-fetch-failed` で `ack_required=1` になること。
16. **AD-H068 の分離**: 停止操作で `system-service-stopped` の行が**作られない**こと（`SELECT COUNT(*) ... WHERE message_definition_id='system-service-stopped'` が0）。
17. **停止フック**: 偽のEventEmitterに `SIGTERM` を流すと、B5に `operation_kind='stop'` かつ `request_id` が `shutdown-` で始まる行が1件、`notification_output_history` に `system-service-stopped` が1件記録されること。同じシグナルを2回流しても件数が増えないこと。記録がDBクローズ前に完了していること（記録後に読み出せる）。
18. **通知記録失敗の隔離**: 通知記録を必ず失敗させたとき（B4への書き込みを例外にするスタブ）でも、操作APIは 200 `result:"success"` を返し、B5には行が記録されること。
19. **ポーリング無効時**: `enablePolling:false` で起動したサーバーに操作APIを送ると 503 `fetch_control_unavailable` が返り、B5に行が増えないこと。
20. **境界の確認（未対応を実装済みと扱わない）**: 本設計 §7 の表の各行について、実際にコード・APIを実行して現状と一致することを確認し、削除API・認証・異常終了検知・取得元単位操作のエンドポイントが**存在しない**こと（`/api/control/` 配下のルート一覧に無いこと）を確認して報告すること。
21. **夜間の強制更新（9-A）**: 疑似時計を夜間帯（既定設定で 21:00 JST 相当）に置き、fetch をスタブしたうえで強制更新を1回実行すると、**4取得元すべてで上流取得が1回ずつ行われる**こと。とくに雨雲の時刻一覧URL（N1/N2）とキキクルの時刻一覧URLがスタブの呼び出し先に現れ、B5の行が `result:"success"` であること。
22. **夜間迂回の範囲（9-A）**: 同じ夜間設定で、(a) `refreshTimes()` を引数なしで呼ぶと上流取得が0回のままであること（#24 受け入れ条件13の非退行）、(b) 夜間の画像タイル取得（`fetchFrameTiles` 相当のオンデマンド取得）は強制更新の前後いずれでも上流画像HTTPが0回であること、(c) `enablePolling:false` 起動では強制更新自体が 503 になり索引の上流取得も0回であること、を確認すること。
23. **再開時の復旧（9-B・しきい値）**: 疑似時計で停止→開始を行い、(a) 停止から**29分**後の開始では `pollFeeds('recovery')` 相当の呼び出しが0回であること、(b) 停止から**30分ちょうど**後の開始では1回であること、(c) その復旧で長期フィード（`regular_l`/`extra_l`）のURLが取得対象に含まれること（`fetch_attempt` の `trigger_kind='recovery'` 行、またはスタブの呼び出し先で確認）、(d) 続けて同条件の開始操作をもう一度行っても復旧が再実行されないこと（合計1回のまま）、を確認すること。いずれも日中帯で実施する。
24. **復旧失敗の隔離（9-B）**: 復旧を必ず例外にするスタブを用いても、開始操作は 200 `result:"success"`・`error_code IS NULL` でB5に記録されること。
25. **夜間の開始操作と保留（9-B・確定事項(6)）**: 夜間帯に停止30分以上の状態から開始操作を行うと、復旧の呼び出しが0回であること。その後、**開始操作を行わずに疑似時計だけを夜間明け（日中帯）へ進めても、復旧の呼び出しは0回のままである**こと（夜間明けの境界で自動復旧が走らない＝PoCの確定仕様）。さらにその状態で改めて開始操作を行うと、復旧が1回実行されること（`lastStoppedAt` が保留されていた）。

## 11. 実挙動未確認の箇所

- 夜間帯における強制更新の実挙動（§9-A の表）は、コード読解に基づく推定である。実サーバーを夜間設定で走らせた確認は行っていない。受け入れ条件21・22は疑似時計とスタブ fetch による検証であり、実上流に対する夜間取得の可否（気象庁側が夜間に索引を返すか）は確認していない。
- 長期フィードによる復旧（§9-B）の所要時間は未計測である。開始操作のレスポンスが復旧完了まで待つ設計のため、実上流では 202 `in_progress` を経由する可能性が高い。
- 夜間明けに `lastStoppedAt` が自動消化されないこと（§9-B）は、PoCの仕様として確定済み（確定事項(6)）である。ただし、この保留が実運用で不便になるかは未検証のまま受け入れている。
- 実プロセスへの本物のSIGTERM送出による停止記録は未確認（受け入れ条件17は偽EventEmitterによる検証）。実運用のプロセス管理（systemd等）がシグナルではなく即時killを行う場合、停止記録は残らない。
- 強制更新と定期取得が同一取得元で同時に走った場合の合流（§4.3 の `inFlightPromises` 合流）は、実上流に対する挙動を未確認。テストはスタブで検証する。
- `system-service-stopped` 通知が、プロセス終了前に端末へ配信されるかは未確認。§6.1 のとおり次回起動後の配信を前提とする。

設計: Claude Opus 5 (1M context)
