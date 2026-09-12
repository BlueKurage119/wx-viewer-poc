# Issue #29「D5. 起動時通知出力 API（pull 方式）」設計

作成日: 2026-09-13  
状態: 設計中（製造未承認）  
設計担当: Codex (GPT-6 Astra)

## 1. 目的と範囲

端末が起動時に 1 回呼ぶ現況取得 API を完成させる。API は端末 ID から会場をサーバー側で解決し、現在発表中の警報・注意報と表示期間内の気象防災速報を、その時点の通知区分と表示文言にして返す。

ヒアリングで、通知区分 `warning`（画面上の「警報」）だけは「サーバー起動世代 × 会場」ごとに最初の新規端末セッションへ 1 回だけ返し、`question`（問いかけ）と `emergency`（非常ブザー）は有効な起動時問い合わせのたびに返すと確定した。`warning` の出力権は SQLite トランザクション内で原子的に消費する。応答送信後の受信確認は行わず、通信断後の再問い合わせでは `warning` を再提示しない at-most-once とする。

#29 で起動時現況取得エンドポイントまで完成させる。Issue #41（E9）は同 API を作り直さず、通常ポーリング用差分取得と、起動応答から通常ポーリングへ合流する結合確認を担当する。

### 1.1 対象

- 起動時問い合わせの共有 request/response 型と実行時 validator
- 端末 ID のサーバー側検証および会場解決
- 警報・注意報現況と、表示期間内の気象防災速報から起動応答を構築する純粋な projector
- 初期化中応答、入力・DB・内部データ異常時の HTTP 応答
- #30 の端末セッション初回判定、`warning` 出力権の原子的な消費、問い合わせ結果の監査記録
- web の実画面からの起動時 1 回の問い合わせ。sessionStorage 不能時のメモリ縮退を含む
- API、リポジトリ、web 呼び出しのテスト

### 1.2 対象外

- 通常運用中の差分取得 API、15 秒ポーリング、cursor（#41）
- 通知の鳴動、下部通知領域への表示、確認・回答、受領監視、確実な再送
- AuthGate、SSO、認可、物理端末の恒久識別
- 気象防災速報の通常受信時通知生成器。#29 は保存済みの現況を起動時に投影するだけとする
- VPHW50/51（竜巻）の正規化・表示期限。現行 DB に実装済みの VPBS50 だけを扱い、未実装の情報を推測で補わない
- 装置異常通知（D7/D8）、監視画面の一覧 API（E10）、通知 UI
- `availability` を新設・縮退すること。起動応答は通知用データだけを返し、情報種別 API の `available/stale/unavailable` は後続 Issue がそのまま扱う

## 2. 参照資料と判断根拠

### 2.1 参照資料

- [Issue #29](https://github.com/BlueKurage119/wx-viewer-poc/issues/29)、[Issue 下書き](../issues-draft.md) D5 / E9
- [基本設計](../basic-design.md) §3.4、§5.5〜5.6、§6.2〜6.3、§7.3〜7.7、§8.1、§9.3
- [Issue #30 設計](issue-30-terminal-session.md) と `main` の実装: UUID v4、`sessionStorage`/メモリ保持、`terminal_session`、`recordTerminalSessionInquiry`
- [Issue #28 設計](issue-28-warning-notification-generation-rules.md) およびマージ済み PR #137（merge commit `96bca5a47c1159db3cedf628827b302ddad0dec4`）: D2/D3/D4 の配線、`InitialWarningNotificationTracker`、`planWarningNotifications`、`emitInitialWarningNotifications`、受信・復元テスト
- [Issue #17 設計](issue-17-bosai-bulletin.md) と `bosaiBulletinRepository.ts`: VPBS50 の保存、会場別区域絞り込み、取消、`reportDateTime`
- [Issue #25 設計](issue-25-notification-data-model.md)、[Issue #103 設計](issue-103-notification-message-definitions.md): 通知型、出力スナップショット、型付きメッセージ定義
- [Issue #8 設計](issue-8-notification-output-history.md): `notification_output_history` は通知判定で生成した通知事実であり、端末の鳴動・受領履歴ではない
- `apps/web/src/shell/config.ts`: 4 端末と会場・モードの対応
- `apps/api/src/app.ts` / `server.ts`: 現在は health endpoint だけで、Express は DB や初期化状態を受け取らず、待受開始後に現況復元する

### 2.2 ヒアリング確定事項

1. #29 が起動時現況取得 endpoint を完成させ、#41 は通常ポーリング差分と結合を担当する。
2. `warning` は「サーバー起動世代 × 会場」ごとに最初の**新規**端末セッションへ一度だけ返す。
3. 出力権は DB トランザクションで消費する at-most-once。応答喪失後の同一セッション再問い合わせでは `warning` は返さず、`question` / `emergency` の現況だけを再提示する。受領監視・確実な再送は対象外。

### 2.3 現行実装調査からの判断

- #30 は `recordTerminalSessionInquiry(connection, sessionId, inquiredAt)` を `INSERT ... ON CONFLICT DO NOTHING` と `transaction(...).immediate` で実装済みである。外側 transaction から呼べ、rollback 後は同じ ID が再び `startup` になることも #30 の受け入れ条件で固定されている。#29 は同じ接続の外側 immediate transaction にセッション判定・出力権・監査記録をまとめる。
- #30 の ID は端末 ID ごとの `sessionStorage` キーで保持されるが、API への配線は未実装である。`getOrCreateTerminalSession(terminal.id)` の `ready` 結果だけを送る。
- C12 の `JmaXmlPollingService` は新しいサービス instance ごとに `initialFetch.phase='not_started'` から始まり、4 feed の取得がすべて成功したときだけ `completed`、1 本でも失敗すれば `failed` とする。feed 本文が正常な空一覧であることや対象地域の警報電文が 0 件であることは失敗ではない。C13 の recovery が不足 feed をすべて成功させた場合も `completed` へ遷移する。通常 scheduled poll の成功だけでは completed にしない。
- PR #137 は `InitialWarningNotificationTracker` をプロセス内に生成し、会場・`normal/training` ごとに現況復元後の通知生成を 1 回にする。`test` は `planWarningNotifications` が明示的に通知対象外にする。#29 は snapshot の有無ではなく、上記 `initialFetch.completed` の後に全会場の D4 初期評価を明示的に完了したことを readiness の根拠とする。正常な発表なしで snapshot が 0 件でも ready にできる。
- PR #137 の `emitInitialWarningNotifications` は検知した通知事実を `notification_output_history` に記録する。起動時 API の各応答を同じ表へ再 INSERT すると「通知判定の履歴」と「端末への再提示」が混ざるため、同表は変更せず、起動問い合わせは専用監査表へ保存する。
- 警報現況は `findWarningCurrentSnapshot(areaCode, controlStatus)` で得られ、解除・取消された item は C3/D4 の現況から外れる。起動時に過去履歴を逆算せず、現在 item を D2 のコード分類と #103 の発表メッセージ定義へ投影する。
- `bosai_bulletin` は `(eventId, controlStatus)` の最新状態を持ち、`isCancelled` と `reportDateTime`、会場別 `includedAreaCodes` 絞り込みを提供する。§5.5 で確定した表示期間は `reportDateTime` から 3 時間であり、取得・訂正時刻で延長しない。`reportDateTime <= now < reportDateTime + 3h`、`isCancelled=false` の VPBS50 だけを返す。境界のちょうど 3 時間後は期間外とする。
- 現行端末台帳は web 内だけにあり、API が信用できる会場 ID を request から受け取ると spoof できる。端末 ID・mode・venue の最小台帳を `packages/shared` に移し、web と API が同じ resolver を使う。
- PR #137 は設計中に `main` へマージされた。最終 HEAD `25aae0ed6341b3a1323ccd466428c0b8408ea811` の追加修正は、VPWS50 訂正時の `sourceTelegram` 不一致現象を訂正対象から除外するもので、#29 の現況投影契約を変更しないことを確認した。#29 の設計ブランチは #28 と #30 の両方を含む merge commit `96bca5a47c1159db3cedf628827b302ddad0dec4` へ追従済みである。

## 3. API 契約

### 3.1 endpoint

`POST /api/notifications/startup`

`POST` とするのは、読み取りに見えても端末セッション記録、`warning` 出力権、監査行を原子的に追記する非冪等操作を含むためである。認証情報や session ID を URL/query に残さない。

Request header: `Content-Type: application/json`

```ts
export interface StartupNotificationRequest {
  readonly terminalId: string;
  readonly sessionId: TerminalSessionId;
}
```

body は上記 2 key だけを持つ plain object とし、余剰 key、空文字、非文字列、不正 UUID v4 を 400 にする。`venueId`、端末 mode、`isTraining`、時刻は request から受け取らない。

### 3.2 200 応答

```ts
export type StartupCurrentSource = 'warning_current' | 'bosai_bulletin';

export interface StartupCurrentNotification {
  readonly outputId: string; // 応答内一意の UUID v4。検知通知の notificationId とは別
  readonly category: NotificationCategory;
  readonly origin: 'weather';
  readonly sourceType: StartupCurrentSource;
  readonly sourceVersion: string | null;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export interface StartupNotificationReadyResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  readonly session: {
    readonly kind: TerminalSessionInquiryKind;
    readonly firstInquiredAt: UtcIso8601String;
  };
  readonly warningClaimed: boolean;
  readonly notifications: readonly StartupCurrentNotification[];
}
```

- `notifications` は `occurredAt` 昇順、同時刻は `sourceType`、`relatedRefs[0].ref`、`outputId` の順で固定する。DB の偶然の行順に依存しない。
- `warningClaimed=true` は、この request が当該起動世代・会場の権利を新規取得したことを表す。対象 `warning` が 0 件でも権利は消費する。これにより、最初の端末問い合わせ後に発生した通常更新の `warning` を別端末の「起動時初回」として横取りしない。通常更新は #41 の差分経路で通知する。
- `session.kind='continuation'` では `warningClaimed` は必ず false。ただし `question` / `emergency` は現況から再構成して返す。
- `notifications=[]` は正常な現況なしであり 200。`unavailable` を空配列へ縮退した結果ではない。

### 3.3 初期化中とエラー

| HTTP | body | 条件・副作用 |
|---|---|---|
| 202 | `{status:'initializing', venueId}` | `initialFetch` が `not_started` / `running` / `failed`、または `completed` 後の当該会場 D4 初期評価が未完了。session・claim・監査を一切書かない |
| 400 | `{status:'error', code:'invalid_request'}` | JSON 不正、body 不正、session ID 不正。入力値や例外詳細を返さない |
| 404 | `{status:'error', code:'terminal_not_found'}` | 形式上妥当だが台帳にない terminal ID。session・claim を書かない |
| 500 | `{status:'error', code:'startup_notification_failed'}` | DB、保存データ検証、投影、監査の失敗。transaction を rollback し claim を消費しない |

202 に推定の再試行秒数を付けない。web は同じ session ID で限定的に再試行できる client を用意するが、周期・打切り・通常ポーリングとの統合は #41 で確定する。#29 の実画面接続では初回 1 回だけ呼び、202/通信失敗は再読み込み後も同じ ID で再問い合わせ可能な状態に留める。

Express の既定 JSON 上限を変更しない。method違いは既定 404、Content-Type 不正は 400 とする。

## 4. 現況の抽出と通知投影

### 4.1 端末から会場への解決

`packages/shared/src/terminalConfig.ts` を追加する。

```ts
export type TerminalMode = 'H' | 'K';
export interface TerminalDefinition {
  readonly id: string;
  readonly mode: TerminalMode;
  readonly venueId: VenueId;
}
export const TERMINAL_DEFINITIONS: readonly TerminalDefinition[];
export function resolveTerminalDefinition(id: unknown): TerminalDefinition | null;
```

台帳の 4 ID と対応は現行 `apps/web/src/shell/config.ts` をそのまま移す。表示名や view 定義は web に残す。web の `terminals` は共有定義を参照して表示情報を付加し、API は request の `terminalId` だけから `venueId` を解決する。会場対象は `resolveVenueForecastTargets(venueId)` / `resolveWarningCurrentTargetArea(venueId)` から取得し、区域コードを endpoint に直書きしない。

### 4.2 警報・注意報

`apps/api/src/notifications/startupCurrentNotificationProjector.ts` に次を置く。

```ts
export interface StartupProjectionInput {
  readonly venueId: VenueId;
  readonly now: UtcIso8601String;
  readonly includeWarningCategory: boolean;
}

export interface StartupProjectionResult {
  readonly notifications: readonly StartupCurrentNotification[];
}

export function projectStartupCurrentNotifications(
  connection: DatabaseConnection,
  input: StartupProjectionInput,
  outputIdFactory?: () => string,
): StartupProjectionResult;
```

1. readiness は §5 の初期取得・初期評価状態だけで先に判定する。ready 後、会場の municipal code で `normal` と `training` の `warning_current_snapshot` を読む。正常な初期取得・初期評価後に `normal` snapshot が存在しない場合は「確認済み現況なし」として警報側を空にし、速報の抽出は続ける。`training` は行がある場合だけ読む。`test` は読まない。
2. 各 active item の `kindCode` を PR #137 の `classifyWarningNotificationCategory` と `selectIssuedNotificationDefinitionId` に通す。未対応 code は低区分へ落とさず内部エラーにせず skip し、構造化 warning log を 1 件出す（現況表示自体は別 API の責務）。
3. `includeWarningCategory=false` なら category `warning` を除く。`question` / `emergency` は常に残す。
4. projector 用の `WeatherNotification(changeType:'new')` を一時的に組み立て、既存 `resolveNotificationMessage` で表示文言を解決する。ただしその一時 ID は D4 の検知 `notificationId` ではないため、応答では `outputId` と呼び、`notification_output_history` へ書かない。
5. target は市町村 1 件、`occurredAt` は `kindIssuedAt ?? snapshot.telegram.reportDateTime`、ref は `{type:'warning_current',ref:areaCode}`、`sourceVersion` は snapshot metadata、`isTraining` は controlStatus から明示的に伝播する。

解除・取消済みの item を履歴から復活させない。現況 snapshot の active item だけを正とする。

### 4.3 表示期間内の気象防災速報

- `listBosaiBulletins(connection,{controlStatus,includedAreaCodes})` を `normal` / `training` について呼ぶ。`test` は除外する。
- `isCancelled=false`、`reportDateTime <= now`、`now < reportDateTime + 3 hours` をすべて満たす行だけを対象にする。ISO 文字列の辞書比較やローカル時刻計算をせず、妥当性検証済み epoch millisecond で比較する。
- `informationTag` の検証済み 3 値を #103 の明示対応表へ通し、すべて category `question` とする。NULL、未知、短時間大雪は推測で分類せず skip + warning log。取消は先に除外する。
- target は問い合わせ会場の表示名を伴う area target 1 件とする。sourceType は `bosai_bulletin`、sourceVersion は metadata、occurredAt は `reportDateTime`、ref は `{type:'bosai_bulletin',ref:eventId}`、training は controlStatus から伝播する。
- VPBS50 の 3 種はすべて `question` なので `warning` claim の有無に左右されない。

### 4.4 training / test

`training` は本番相当と同じ分類・表示期間で別に抽出し、各 item の `isTraining=true` を保持する。H/K の違いは訓練操作 view の可視性であり、通知パイプライン自体から H を除外する根拠ではないため、両 mode に返す。`normal` と同じ event/sourceVersion でも統合しない。

`test` は PR #137 の確定実装どおり通知対象外で、起動応答にも含めない。`test` を `isTraining=true` に変換しない。

## 5. 初期化状態とサーバー起動世代

### 5.1 初期化レジストリ

`StartupNotificationInitialization` を `startServer` / `main` ごとに 1 インスタンス生成し、全体の C12 phase と会場別 D4 初期評価を持つ。module global singleton にしない。

```ts
export interface StartupNotificationInitializationStatus {
  readonly initialFetchPhase: InitialFetchPhase;
  readonly evaluatedVenueIds: ReadonlySet<VenueId>;
}
```

- API の会場 readiness は **`initialFetchPhase === 'completed'` かつ `evaluatedVenueIds.has(venueId)`** のときだけ true とする。snapshot の存在・active item 件数は条件にしない。
- `not_started`: 当該起動世代で C12 の初期 cycle を開始していない。202。
- `running`: 4 feed の初期 cycle 実行中。202。
- `failed`: 1 feed 以上の失敗または内部例外。202。既存 C13 の recovery で service status が `completed` になるまでは ready にしない。通常 scheduled poll の成功だけで ready にしない。
- `completed`: feed が正常な空一覧でも成立する。この遷移を検知した直後に、PR #137 の `reprocessPendingWarningTelegramReceptions`、`rebuildWarningCurrentFromReceptions`、`emitInitialWarningNotifications` を全会場について実行し、各会場の一連の同期処理が例外なく戻った後だけ `evaluatedVenueIds` へ追加する。PR #137 が server 起動前段で行う同処理は残してよいが、**初期 cycle 完了後のこの評価を省略しない**。tracker により同じ現況の二重初期通知は抑止される。
- 初期 cycle 中に warning reception が 0 件で snapshot が作られなくても、上記評価関数は「対象なし」を正常完了として会場を追加する。ready 後の projector は snapshot 不在を「確認済み現況なし」とし、警報側を空にする。これは「取得未完了」と「正常な発表なし」を区別する基本設計 §6.3 および C12 の契約に従う。
- training snapshot は存在時に同じ評価を行うが、存在しないことは会場評価の完了を妨げない。test は対象外。
- C13 recovery による `failed → completed` は timer 内で起こるため、#29 は phase 変化 callback または cycle 完了 hook を `JmaXmlPollingService` に追加し、同じ全会場評価を 1 回起動する。API request のたびに status を見て初期評価を実行してはならない。
- `DISABLE_POLLING=true` では `JmaXmlPollingService.start()` を呼ばず、C12 の process 単位状態は契約どおり `not_started` のままである。保存済み snapshot は前の起動世代の結果であり、今回世代の初期取得・D4 再評価完了を証明しないため、存在しても endpoint は 202 とする。無効化中だけ過去状態を ready とする特例や、DB 保存状態から `initialFetch.completed` を復元する処理は設けない。テストや手動確認で 200 が必要なら polling を有効にし、注入した成功 feed で初期 cycle を完了させる。
- DB 初期化自体の失敗では HTTP 待受を開始しない既存契約を維持する。

`createApp` は次の依存を受ける。

```ts
export interface AppDependencies {
  readonly startupNotifications?: StartupNotificationService;
}
export function createApp(dependencies?: AppDependencies): Express;
```

依存なしの unit test では health endpoint は従来どおり動き、startup endpoint は 503 相当ではなく route 未登録とする。production の 2 起動経路は必ず service を注入する。

### 5.2 サーバー起動世代

`serverGenerationId` は `startServer()` または `main()` の呼び出しごとに `crypto.randomUUID()` で 1 回生成する小文字 UUID v4 とする。scheduler の開始・停止、強制更新、日次時刻境界、取得の再開では変更しない。同一 Node.js process でも `startServer` を閉じて再度呼べば別世代である。

PoC は単一 API プロセスを前提とする。将来複数 instance を 1 論理取得サービスとして扱う場合の世代共有・leader election は対象外であり、instance ごとに UUID を作る方式をそのまま本番へ移植しない。

## 6. 永続化とトランザクション

### 6.1 migration

#28 と #30 の統合後の次番号として `0020_create_startup_notification_output.sql` を追加する。製造開始時に main の最新番号を確認し、競合時は未適用の次番号へ変更して報告する。適用済み migration は編集しない。

```sql
CREATE TABLE startup_warning_claim (
  server_generation_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (server_generation_id, venue_id)
);

CREATE TABLE startup_notification_inquiry (
  id INTEGER PRIMARY KEY,
  server_generation_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_kind TEXT NOT NULL CHECK (session_kind IN ('startup', 'continuation')),
  inquired_at TEXT NOT NULL,
  warning_claimed INTEGER NOT NULL CHECK (warning_claimed IN (0, 1)),
  response_json TEXT NOT NULL CHECK (response_json <> '')
);

CREATE INDEX idx_startup_notification_inquiry_time
  ON startup_notification_inquiry (inquired_at DESC, id DESC);
```

両表は追記・保持し、自動削除しない。`terminal_session` や端末台帳への FK は張らない。監査スナップショットが台帳変更や手動削除に巻き込まれないためである。`response_json` は 200 応答を stringify した完全なスナップショットとし、session ID 以外の秘密情報は含めない。専用の一覧 endpoint は E10 の責務とする。

### 6.2 repository/service

```ts
export interface StartupNotificationInquiryInput {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly sessionId: TerminalSessionId;
  readonly inquiredAt: UtcIso8601String;
}

export interface StartupNotificationService {
  inquire(input: StartupNotificationInquiryInput):
    | { readonly status: 'initializing'; readonly venueId: VenueId }
    | StartupNotificationReadyResponse;
}
```

`inquire` は同期 DB 処理だけを行う。処理順は次のとおり。

1. route で body と terminal を検証する。service は terminal と venue の組も共有台帳で再検証する。
2. initialization が ready でなければ 202 を返し、transaction を開始しない。
3. `connection.transaction(...).immediate()` の中で `recordTerminalSessionInquiry` を呼ぶ。
4. `kind='startup'` の場合だけ `startup_warning_claim` に `INSERT ... ON CONFLICT(server_generation_id,venue_id) DO NOTHING`。`changes===1` を `warningClaimed` とする。`continuation` は INSERT しない。
5. 同じ transaction 内で、`warningClaimed` を `includeWarningCategory` として現況を再読込・投影し、最終 response object を組み立て、同一 object の JSON を `startup_notification_inquiry` に INSERT する。
6. commit 後に Express が同じ object を送信する。

body 検証、初期化中、未知端末では terminal session 行を作らない。投影・serialization・監査 INSERT のいずれかが失敗すれば外側 transaction 全体を rollback し、session startup 判定と claim を消費しない。commit 後に socket が切れた場合は rollback できず、同じ session ID の再問い合わせは continuation となって `question` / `emergency` だけを返す。これが確定済み at-most-once 契約である。

同時に複数 terminal が初回問い合わせしても PK と immediate transaction により 1 request だけが `warningClaimed=true` になる。`SELECT → INSERT` の事前存在確認を行わない。

## 7. web 接続

`apps/web/src/api/startupNotifications.ts` に request client を追加する。

```ts
export type StartupNotificationClientResult =
  | StartupNotificationReadyResponse
  | { readonly status: 'initializing'; readonly venueId: VenueId }
  | { readonly status: 'unavailable'; readonly reason: 'session' | 'network' | 'server' };

export async function fetchStartupNotifications(
  terminalId: string,
  signal?: AbortSignal,
): Promise<StartupNotificationClientResult>;
```

- `getOrCreateTerminalSession(terminalId)` が `unavailable/random` なら通信せず `reason:'session'`。`ready` なら同じ ID を body に入れる。
- `TerminalApp` の effect から 1 回呼ぶ。React StrictMode の effect setup→cleanup→setup で二重 POST しないよう、`terminalId` ごとの module 内 in-flight/completed cache を client に持たせる。再描画・hash 切替では再送しない。
- terminal URL が変われば terminal ID ごとに別 session/cache を使う。Abort は共有 request を直ちに破棄せず subscriber の購読だけを外し、StrictMode cleanup で POST を中断して再発行する競合を作らない。
- #29 は返却内容を UI へ接続しない。結果を React state や console に仮表示しない。#41 が通常差分 client と共通 store へ接続する。
- 202、network failure、5xx で session ID を更新しない。自動 retry timer は #29 では置かない。同一タブ reload または #41 の合流実装が同じ ID で再問い合わせする。

## 8. 変更対象と製造順序

### 8.1 変更対象

- shared: `terminalConfig.ts`、`startupNotification.ts`、barrel、各 test
- API: migration 1 本、`startupCurrentNotificationProjector.ts`、`startupNotificationService.ts`、repository、route、`app.ts`、`server.ts`、barrel、各 test
- web: `api/startupNotifications.ts`、`App.tsx`（呼び出しのみ）、test
- 既存 `apps/web/src/shell/config.ts`: 共有端末台帳の参照へ最小変更

設計書以外の文書、依存 package、色・UI、既存 migration は変更しない。

### 8.2 製造順序

1. 製造開始時の `main` が #28 の merge commit `96bca5a4...` と #30 の実装を含むことを確認する。その後に入った変更が本設計の調査結果と異なる場合は着手を止めて統括へ報告する。
2. 共有台帳と API DTO/validator をテスト先行で追加する。
3. migration、claim/inquiry repository、現況 projector を追加する。
4. initialization/service/route を配線し、HTTP 結合テストを通す。
5. web client と StrictMode-safe な 1 回呼出しを接続する。UI は変更しない。
6. 対象テスト、red/対照実験、全必須検証を行う。

## 9. 検証計画と受け入れ条件

Node.js 24、既存 Node test runner/tsx を使う。時刻、UUID、初期化状態を注入し、応答 JSON は原則完全一致する。通信競合を単なる `Promise.all` の見た目だけで証明せず、独立 DB 接続または worker と同期開始を使う。

- [ ] **AC1 request/terminal**: 正しい 4 terminal ID と UUID v4 だけが対応 venue へ解決される。未知 ID、空、大文字 UUID、余白、余剰 key、配列/null、壊れた JSON は 400/404 の規定 body と完全一致し、3 表の行数が変わらない。
- [ ] **AC2 初期化**: 新規 service の `not_started`、初期 cycle 中の `running`、1 feed 以上失敗した `failed` はすべて 202 かつ副作用 0。4 feed が空一覧で正常完了した `completed` の後に全会場 D4 初期評価を行うと、snapshot が 0 件でも east/trc とも 200、警報側は空になり速報抽出は実行される。`completed` でも会場評価 callback の途中では未評価会場だけ 202。失敗後は通常 scheduled 成功で ready にならず、C13 recovery が全不足 feed を成功させ `completed` へ遷移し、会場評価が完了した後だけ 200 になる。
- [ ] **AC3 現況分類**: normal snapshot に category 3 種の検証済み code を保存し、最初の east session は 3 件を返す。summary、message definition、area、occurredAt、sourceVersion/ref を固定値で完全一致する。解除済み/取消済みを履歴から追加しない。未対応 code を `warning` に落とさない。
- [ ] **AC4 claim の会場分離**: 同一世代で east session A は `warningClaimed=true`、east session B は false、trc session C は true。A の再問い合わせも false。claim 行は east/trc 各 1 行で session ID と時刻が勝者に一致する。
- [ ] **AC5 category 再提示**: A の初回は warning/question/emergency、同 ID の再問い合わせと B の新規問い合わせは question/emergency だけ。warning active 0 件でも A が claim を消費し、後から warning が現れても B の起動応答には含まれない。
- [ ] **AC6 再起動世代**: 同じ DB と session ID のまま service を別 generation ID で作り直すと session は continuation なので claim せず warning を返さない。新 session ID は新世代の claim を得る。scheduler stop/start や強制更新では generation ID が変わらない。
- [ ] **AC7 at-most-once/rollback**: commit 後に HTTP socket を切断した相当で同じ session を再問い合わせすると warning なし、question/emergency あり。projector または監査 INSERT を意図的に失敗させた場合は session/claim/inquiry の全書込みが rollback され、次回は startup として claim できる。
- [ ] **AC8 競合**: 同一世代・同一会場へ異なる新 session を同期開始し、成功応答の `warningClaimed=true` は 1 件だけ、claim 行も 1 件。busy を成功へ読み替えない。同一 session の競合でも terminal_session は 1 行、startup は 1 件だけ。
- [ ] **AC9 速報期間**: now の 1ms 前、ちょうど now、2:59:59.999 前、ちょうど 3h 前、未来、取消の bulletin を用意し、下限含む・上限除外で対象が完全一致する。訂正の fetchedAt が新しくても reportDateTime が 3h 外なら返さない。会場区域、normal/training が混ざらない。
- [ ] **AC10 training/test**: normal と training の同内容を別 item として返し、後者だけ `isTraining=true`。test は 0 件。training が無くても normal ready を妨げない。H/K とも training を返す。
- [ ] **AC11 監査**: 200 ごとに response JSON と完全一致する inquiry 行が 1 件増える。202/400/404/rollback では増えない。既存 `notification_output_history` は起動再提示回数では増えない。
- [ ] **AC12 web/StrictMode**: fake fetch と storage で同 terminal の effect setup-cleanup-setup、再描画、hash 切替でも POST 1 回・同じ ID。別 terminal は別 ID/body。session random failure は POST 0。202/network/5xx 後も ID を rotate せず、UI/console に仮表示しない。
- [ ] **AC13 HTTP**: 実 server の endpoint で Content-Type、status code、JSON を確認する。health API は従来どおり 200。`DISABLE_POLLING=true` では既存 DB に normal snapshot があっても C12 status が `not_started` のままで endpoint は 202、副作用 0。polling 有効で空の4 feedを成功させると snapshot 不在のまま 200/空警報となる。server close 後は DB を閉じる。
- [ ] **AC14 境界**: 通常差分 endpoint、cursor、通知 UI、受領確認、AuthGate、VPHW50/51、装置異常通知を追加していない。既存 migration と #28/#30 の実装を削除・巻戻ししていない。
- [ ] **AC15 必須検証**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web`、`npm run build` が成功する。

### 9.1 red・対照実験・ミューテーション

新規テスト完成前に、意味を変えないコメントだけの変更で対象テストが成功する対照実験を行う。その後、各変更を 1 つずつ入れて失敗（red）を確認し、都度戻す。

1. claim の unique key から `venue_id` を外す（AC4 が失敗）
2. session continuation でも claim INSERT する（AC5/AC6 が失敗）
3. transaction commit 前でなく commit 後に監査 INSERT する（AC7 が失敗）
4. `reportDateTime + 3h` の比較を `<=` にする（AC9 が失敗）
5. training を normal として返す、または test を含める（AC10 が失敗）
6. StrictMode cleanup で共有 fetch を abort して再発行させる（AC12 が失敗）

実行したテスト名、mutation、期待した失敗、復元後の成功を Walkthrough/最終報告へ残す。一時 DB・worker・fixture・コード変更は片付ける。

## 10. #41 への引き継ぎ

- 起動時は本 endpoint、通常更新は #41 の差分 endpoint とし、通常 poll から `recordTerminalSessionInquiry` や `startup_warning_claim` を呼ばない。
- #41 は起動 200 応答を common notification store に投入後、cursor を確定して差分取得へ移る。起動応答と cursor 取得間の更新欠落を防ぐ境界（snapshot token/sequence）は #41 で設計する。#29 の `serverGenerationId` を差分 cursor の代用にしない。
- #29 の 202/通信失敗再試行を #41 の lifecycle に統合する。同じ session ID を維持し、retry のために terminal session を更新しない。
- 起動応答は現況再提示であり D4 の検知 notification ID を再利用しない。通常差分は D4 が永続化した通知事実を基準にし、`outputId` と `notificationId` を混同しない。
- E10/K4 は `startup_notification_inquiry` を使って起動応答を表示し、`notification_output_history` の `detectionContext` を端末問い合わせ種別だと誤表示しない。

## 11. 残留リスク・未確認事項

- PR #137 の最終 HEAD と merge commit は確認済みである。製造開始までに `main` へ追加変更が入った場合は、本設計の参照契約との差分を再確認する。
- 設計時 worktree に `node_modules` がなく、better-sqlite3 の nested immediate transaction、Express の error mapping、React StrictMode 下の client cache、および C13 recovery 完了 hook は本 Issue の組合せでは実挙動未確認である。製造時に AC2/7/8/12 で確認し、実物と矛盾すれば別方式を勝手に採らず統括へ報告する。
- VPBS50 の取消本文欠落等は Issue #17 のとおり実電文未確認だが、#29 は `isCancelled` を除外するだけで本文構造を推測しない。
- 起動監査の `response_json` は運用期間中増加する。件数・容量を測らず TTL や上限を導入しない。
- 複数 API instance で 1 論理世代を共有する仕組みはない。本番移植時は generation ID の共有主体と claim DB を再設計する。

追加のユーザーヒアリングが必要な事項はない。製造は本設計の承認後に別フェーズとして開始する。
