# Issue #75: 監視ツールバーの取得操作・履歴入口・階層遷移

## 1. 目的と設計の確度

K1で配置済みの監視ツールバーを活性化し、取得操作の「選択→送信」、E11による結果確認、履歴・診断の開閉境界を接続する。将来の階層ツールバー用に定義と履歴スタックを用意する。

対象ブランチは `feature/issue-75-monitoring-toolbar`。設計フェーズの成果物は本書1本のみ。コード・設定・他文書・ブランチ・コミットは変更しない。

- 【確定】はIssue #75のヒアリングと統括担当の補足による。基本設計の【設計案】【未確定】全体を確定へ変更するものではない。
- 【設計案】は具体的な実装方針を示す。離脱後の照会継続とダイアログ骨組みは追加判断により確定し、§10に承認記録を残す。今回の要ヒアリング事項は解消済み。
- 数値の根拠はコード確認・ヒアリング・暫定設計を区別する。ブラウザ実測は本設計では行っていない。

## 2. 参照資料と既存実装の確認

| 参照 | 確認事項・設計への反映 |
| --- | --- |
| [Issue #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、統括担当による本文・コメント確認結果 | 未送信で実行しない、未選択・送信中の送信無効、離脱時の選択解除、HTTP/XML履歴入口分離 |
| 今回のヒアリングと統括担当の補足 | 本書§3の確定事項。送信中はPOST待機と結果照会を含む。404/通信不能は照会を終了し選択解除。再実行は明示的な新規選択・新UUIDで行う |
| 追加の承認判断（§10） | A1：monitor離脱後も同一IDの照会・共通操作行表示を継続。B1：K2でMD3に沿うモーダル骨組みを実装し、後続へ内容の差し込み境界を渡す |
| 実画面確認に基づく設計変更（§10-C） | Material Labsの切替用プロパティで形状が崩れるとのユーザー指摘を反映。通常ボタンを維持し、MD3の状態クラス・操作行・アクセシブル名で選択状態を示す |
| [基本設計 §8.1〜8.2](../basic-design.md) | 全体一括操作、認証は別作業、停止中の強制更新は自動取得を再開しない |
| [K1設計](issue-74-monitoring-dashboard-layout.md)、[K6設計](issue-79-source-status-table.md) | 既存ツールバーの配置・寸法・折返し、停止理由等のAPI不足の申し送り |
| [E11設計](issue-43-fetch-control-api.md)、`packages/shared/src/fetchControl.ts` | 操作種別、UUID、200/202レスポンスのフィールド。レスポンス検証関数は未実装 |
| `apps/api/src/app.ts`、`services/fetchControlService.ts` | 初回POSTは完了まで待つ。200でも `result: failure` がある。GETは200/202/404。503は受付不可。GETにterminalId等のクエリを付けると400 |
| `apps/web/src/monitoring/MonitoringToolbar.tsx`、`monitoring.css` | 現在は8個の無効な `GbButton`。既存の順番・グループを維持。文字ボタン幅120px、`size="sm"`、`square`、グループ内8px、グループ間24px、toolbarは折返し・高さ自動 |
| `apps/web/src/App.tsx`、`shell/AppShell.tsx` | `TerminalApp`はビュー切替でも存続し、`MonitoringToolbar`/`MonitoringDashboard`はmonitor表示時だけマウント。既存toolbarスロットを利用できる |
| `shell/NotificationArea.tsx`、`notifications/notificationStore.ts`、`shell/notifications.ts` | 操作行は `state.operationMessage`、警報・問いかけ行は `items`等から独立に算出。通知の差分受信でoperationMessageが初期案内へ戻るため、操作状態を通知ストアへ直接上書きすると消える |
| `api/monitoringStatus.ts`、`monitoring/useMonitoringStatus.ts` | 監視情報のDTO検証、5秒間隔の直列ポーリング、非表示時の中断。これは操作結果照会とは別のライフサイクル |
| `components/md/GbButton.tsx`、`components/md/index.ts` | 型付きラッパーはdisabled/aria属性/refを渡せる。Labs登録はラッパー内部の動的import。現状バレルはGbButtonのみ |
| `apps/web/src/index.css`、`theme/applyTheme.ts` | Material typography CSSと日本語typefaceを既に導入。surface-container系・scrim等のスキーム色、shapeのmdトークンをダイアログ骨組みに再利用 |
| [棚卸し](../audit-epic-a-d.md) | AD-H023、AD-H064、AD-H121の結論を§9に記録 |
| [設計標準](../rules/02-design-protocol.md)、[開発フロー](../rules/01-dev-workflow-protocol.md)、[UI標準](../rules/06-ui-md3-protocol.md)、[検証標準](../rules/05-verification-protocol.md) | 成果物境界、承認ゲート、MD3、テストの対照実験・red確認 |
| [G-01](../rules/advisory/G-01-hearing-first-design.md)、[G-10](../rules/advisory/G-10-design-consistency-pitfalls.md)、[G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md)、[G-09](../rules/advisory/G-09-bundle-budget-underestimate.md) | 確定事項と案を分離、共用部品の実装確認、フォント待機後の寸法測定。未実測のバンドル上限は設定しない |

基本設計§8.1の「ツールバー直上の操作結果領域」は今回の確定事項により、K2では既存下部通知の操作行を使う。別領域を追加しない。設計フェーズでは基本設計そのものは編集しない。

## 3. 確定した操作仕様と範囲

### 3.1 取得操作

1. 「取得開始」「取得停止」「強制更新」は単一選択。別ボタンで切替、同じボタン再押下で解除。選択・解除ではAPIを呼ばず、監視データも変更しない。通常のbuttonを維持し、選択状態の表示はMD3の状態クラス・操作行の「選択中」文言・アクセシブル名で行う（§7.3〜7.4）。
2. 送信時だけ `crypto.randomUUID()` によりUUIDを1つ生成し、E11へ `{ requestId }` を送る。UUIDを生成できない場合はPOSTせず、日本語で要求準備失敗を示す。会場・取得元の選択、操作者の捏造、認証実装は行わない。
3. POST待機と結果照会中は取得操作3個・クリア・送信を無効にする。内部でも同期的な実行中ガードを置き、同じ描画フレームの二重押下を防ぐ。
4. HTTP応答待ちのタイムアウトは暫定30秒（ユーザー指定。実測値ではない）。操作全体の失敗期限ではない。POSTを待てなくなったら同じUUIDでGET照会する。POSTを自動再送しない。
5. GETの202は継続照会、200は本文のsuccess/failureに従って完了、404は結果不明、通信不能は結果確認不能。結果不明/確認不能で照会を終了し選択解除する。専用再試行ボタンは追加しない。再操作はユーザーが改めて選択・送信し、新しいUUIDを使う。
6. 完了・結果不明・確認不能後は未選択となる。既存のサーバー側処理、重複防止、強制更新集約、履歴記録、通知生成の責任はE11に維持する。

### 3.2 履歴・診断・離脱

- 受信履歴（HTTP通信ログ）、電文履歴（XMLログ）、出力履歴、状態診断は送信なしで直接開く。K2は開閉状態と後続の内容を接続する境界まで。データ取得・一覧・検索・原文・診断結果はK3/K4/K8へ引き継ぐ。
- 開閉、階層移動、monitorからの離脱では未送信の取得操作選択を解除する。送信済み要求の状態は解除・キャンセルしない。
- 送信中も履歴・診断の入口は有効とする。取得操作の実行中ガードとダイアログ開閉状態を別に持つ。
- 【確定】離脱後も同じ端末のTerminalAppで結果照会・共通操作行への表示を続ける。非表示タブでは次回照会予約を休止し、表示復帰時に同一IDで再照会する（§6.3）。
- 【確定】K2でMD3に沿う共通ダイアログ骨組みを実装する。各入口のタイトル、準備中の最小表示、閉じる、モーダル、フォーカストラップ/復帰、Escapeを提供し、実データ・一覧・検索・原文・診断内容は後続へ残す（§7.2）。

### 3.3 階層と共通操作

```text
[<<][<] メニュー名 [取得開始][取得停止] [強制更新] [受信履歴][電文履歴][出力履歴] [状態診断] [× クリア][→ 送信]
```

- 現行ツールバーをルート `monitor-root` として登録する。実在しない子メニューやURL連動は追加しない。
- `toolbarId`ごとの定義と履歴スタックを用意し、ルートへ戻る/一つ前へ戻る機構を実装する。子階層の挙動はテスト内だけの定義で検証する。
- `<<`/`<`は正方形のアイコン専用ボタンとして常時配置。ルートで無効、子階層で有効。Material Symbolsは `keyboard_double_arrow_left` / `keyboard_arrow_left`。
- メニュー名は固定幅を確保し、ルートでは空欄、子階層では表示。名前の長さで後続ボタンの開始位置を変えない。
- 「クリア」は `close` と文字を併記して常時配置。未送信の操作選択だけを初期化し、解除対象なし/送信中は無効。階層履歴・ダイアログ・送信済み要求・完了結果を消すためには使わない。
- 「送信」は既存ボタンを `arrow_forward` と文字の併記へ改修し、常時配置。未選択/送信中は無効。通知の問いかけ行にある送信とは独立した操作である。

## 4. モジュール構成・型・接続点【設計案】

### 4.1 製造時の変更範囲

| ファイル | 責務・変更 |
| --- | --- |
| `apps/web/src/api/fetchControl.ts`（新規） | E11のPOST/GET、unknownからのレスポンス検証、安全なエラー分類。既存shared型を使用 |
| `apps/web/src/monitoring/monitoringToolbarState.ts`（新規） | 操作選択、階層、開閉の純粋な状態遷移と定義 |
| `apps/web/src/monitoring/monitoringOperationController.ts`（新規） | UUID・送信・タイムアウト・直列照会・実行中ガード・dispose。React非依存で依存注入可能 |
| `apps/web/src/monitoring/useMonitoringToolbar.ts`（新規） | TerminalAppとcontrollerの購読・初期化・破棄、ビュー離脱イベントの接続 |
| `apps/web/src/monitoring/monitoringOperationMessage.ts`（新規） | 操作状態から日本語の操作行メッセージへ変換 |
| `apps/web/src/monitoring/MonitoringToolbar.tsx`（既存） | state/actionsを受け取る表示、選択・直接開く・戻る・クリア・送信 |
| `apps/web/src/monitoring/MonitoringDialogHost.tsx`（新規） | 4種のダイアログ識別・MD3骨組み・モーダル開閉・フォーカストラップ/復帰。内容の差し込み点 |
| `apps/web/src/monitoring/monitoring.css`（既存） | 既存寸法を基にナビゲーション・固定幅名・クリアを追加、選択/フォーカス/折返し。ダイアログのsurface・本文・action配置 |
| `apps/web/src/App.tsx`（既存） | TerminalAppにhookを配置、既存toolbar/notificationスロットへ接続、ダイアログホストを配置 |
| `apps/web/src/shell/notifications.ts`（既存） | 操作メッセージ・監視API異常・通知API異常を同じ行で合成。既存呼出しとテストを更新 |
| `apps/web/tests/fetchControl.test.ts`、`monitoringToolbarState.test.ts`、`monitoringOperationController.test.ts`、`monitoringToolbar.test.ts`（新規） | API境界・状態遷移・競合/タイマー・表示/開閉の検証 |
| 既存 `monitoringDashboard.test.ts`、`shell.test.ts` 等の該当テスト | K1の「8個すべて無効」の旧期待と操作ガイド合成の期待を今回の仕様へ更新 |

`NotificationArea`・notification storeのデータモデル変更、API/shared DTO拡張、監視カードの状態変更は不要。Materialラッパーの追加が必要になった場合はバレル経由で公開し、用途を本Issueに限定する。依存追加・共通テスト設定変更・他画面の改修は予定しない。

### 4.2 内部型と関数シグネチャ

以下は責務と契約を固定する型であり、実装の転記用擬似コードではない。`FetchControlOperationKind`等はsharedからimportする。

```ts
type ToolbarId = string;
type MonitoringDialogId = 'reception' | 'telegram' | 'output' | 'diagnostics';
type ToolbarItem =
  | { readonly kind: 'operation'; readonly operation: FetchControlOperationKind; readonly label: string }
  | { readonly kind: 'dialog'; readonly dialogId: MonitoringDialogId; readonly label: string }
  | { readonly kind: 'navigate'; readonly toolbarId: ToolbarId; readonly label: string };
interface ToolbarDefinition {
  readonly id: ToolbarId;
  readonly title: string;
  readonly groups: readonly (readonly ToolbarItem[])[];
}
interface ToolbarLocalState {
  readonly history: readonly ToolbarId[];
  readonly selectedOperation: FetchControlOperationKind | null;
  readonly openDialog: MonitoringDialogId | null;
}
interface SubmittedOperation {
  readonly requestId: string;
  readonly operationKind: FetchControlOperationKind;
}
type OperationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'sending' | 'checking'; readonly request: SubmittedOperation }
  | { readonly phase: 'completed'; readonly request: SubmittedOperation; readonly response: FetchControlCompletedResponse }
  | { readonly phase: 'unknown' | 'unverifiable'; readonly request: SubmittedOperation; readonly reason: string }
  | { readonly phase: 'rejected'; readonly request: SubmittedOperation | null; readonly reason: string };
type FetchControlReply =
  | { readonly kind: 'completed'; readonly response: FetchControlCompletedResponse }
  | { readonly kind: 'in_progress'; readonly response: FetchControlInProgressResponse }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unverifiable'; readonly reason: 'network' | 'timeout' | 'invalid_response' | 'server_error' };
interface FetchControlClient {
  submit(request: SubmittedOperation, signal: AbortSignal): Promise<FetchControlReply>;
  find(request: SubmittedOperation, signal: AbortSignal): Promise<FetchControlReply>;
}
function createFetchControlClient(deps: { readonly fetch: typeof fetch }): FetchControlClient;
function parseFetchControlReply(
  httpStatus: number,
  body: unknown,
  expected: SubmittedOperation,
  method: 'POST' | 'GET',
): FetchControlReply;
interface MonitoringOperationController {
  getSnapshot(): OperationState;
  subscribe(listener: () => void): () => void;
  submit(kind: FetchControlOperationKind): void;
  dispose(): void;
}
function createMonitoringOperationController(deps: {
  readonly client: FetchControlClient;
  readonly requestIdFactory: () => string;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timerId: number) => void;
}): MonitoringOperationController;
function monitoringOperationMessage(
  local: ToolbarLocalState,
  operation: OperationState,
): string | null;
```

hookの戻り値は `localState`、`operationState`、`currentToolbar`、`busy`、`selectOperation(kind)`、`clearSelection()`、`submit()`、`openDialog(id)`、`closeDialog()`、`navigate(id)`、`back()`、`backToRoot()`。`useMonitoringToolbar({ active: view === 'monitor', definitions, rootId })` をTerminalApp直下で呼ぶ。操作ボタンは選択のみ、送信イベントだけがcontroller.submitを呼ぶ。

履歴スタックは初期値 `[rootId]`。navigateは既知定義への遷移のみを受け付け、現在階層への遷移はno-op、backは末尾1件を除き、backToRootは先頭だけにする。未登録IDは画面を空にせずno-opにする。すべて純粋遷移でテストする。ナビゲーション共通部・メニュー名・クリア/送信は各定義のgroupsに複製しない。

## 5. E11 API接続と検証【設計案】

| 操作 | エンドポイント | 本文/パラメータ |
| --- | --- | --- |
| 取得開始 | `POST /api/control/fetch/start` | JSON `{ requestId }`のみ |
| 取得停止 | `POST /api/control/fetch/stop` | 同上 |
| 強制更新 | `POST /api/control/fetch/force-refresh` | 同上。内部種別は `force_refresh` |
| 結果照会 | `GET /api/control/operations/:requestId` | pathのUUIDのみ。クエリなし、本文なし |

POSTは `Content-Type: application/json`、GETは `cache: 'no-store'`。絶対URLをハードコードせず既存の同一オリジン `/api` を用いる。

### 5.1 正常応答の必須検証

JSONをunknownとして読む。TypeScriptの型アサーションだけで受け入れない。

- HTTP 200は `status === 'completed'`、HTTP 202は `status === 'in_progress'` と一致すること。
- `requestId`がsharedのUUID検証を満たし、照会/送信したIDと一致すること。`operationKind`も要求と完全一致すること。`targetKind === 'all'`。
- `fetchControlState`が `starting | running | stopping | stopped` のいずれかであること。これは応答時点の全体状態であり、過去の要求の結果時点の状態と同一視しない。
- `requestedAt`は実在するUTC ISO日時。200では `completedAt`も必須。形式・日付の往復変換で検証し、日付の繰上がりを許容しない。時計補正による順序の逆転は未規定なので、独自の時刻順制約は追加しない。
- 200では `result`がsuccess/failure、`duplicate`がboolean、`errorCode`/`errorMessage`がstringまたはnull。必須キー欠落をnullに補わない。
- resultとerrorCodeの追加の相関ルールや、未知の追加キーの拒否は導入しない。現在のAPI型が保証しない制約で将来の応答を拒まない。

200のfailureは「操作失敗」、200のsuccessは「操作成功」。`duplicate: true`も確認済みの同じ結果として扱う。成功を「全電文の取得完了」「全取得元正常」と翻訳しない。開始の復旧取得失敗が開始操作のfailureにならない等、E11既存の意味を維持する。

### 5.2 異常応答と不明結果

| 応答・事象 | POSTでの扱い | GETでの扱い |
| --- | --- | --- |
| 200 + 検証済みcompleted | resultに従って完了 | 同左 |
| 202 + 検証済みin_progress | checkingへ移行 | checkingを継続 |
| 404 + `{status:'error', code:'unknown_request'}` | 結果不明で終了 | 結果不明で終了 |
| 400 invalid_request / 409 operation_kind_conflict / 503 fetch_control_unavailable（包絡検証済み） | 要求拒否で終了。操作完了失敗とは区別 | 結果確認不能で終了。元の操作の成否は断定しない |
| 通信例外 / 30秒経過 / 不正JSON・型・ID不一致 / 500・その他のHTTP | 受理後に応答だけ失われた可能性があるため同じIDを1回照会 | 結果確認不能で終了 |

GETの404は上記JSON包絡も確認する。HTMLの404や不正包絡を「記録なし」と断定しない。POSTの500には履歴/通知生成後のエラーもあり得るため、単なる操作失敗へ変換しない。

サーバー由来の任意 `errorMessage`、レスポンス本文、例外全文を操作行へ直出ししない。既知errorCodeを日本語へ対応付け、未知コードは「操作に失敗しました」「結果を確認できません」で受ける。HTMLとして挿入しない。requestIdは状態として保持し、後続K5が結果と照合できるようにする。

## 6. 状態遷移・タイマー・ライフサイクル

### 6.1 操作状態

| 現状態 | イベント | 次状態・処理 |
| --- | --- | --- |
| idle/終了状態、未選択 | 取得操作を押す | 即座に選択。送信を有効化。API呼出し0件 |
| 選択あり | 別の取得操作/同じ取得操作 | 別操作へ切替/未選択へ解除 |
| 選択あり | クリア、階層移動、ダイアログ開閉、monitor離脱 | 未選択。過去結果や送信済み要求は書き換えない |
| 選択あり、非busy | 送信 | 同期ガードを立てUUID生成、sending、POSTを1回。submitted requestと選択状態を分離 |
| sending | 200 completed | completed、選択解除、busy解除 |
| sending | 202、タイムアウト、応答の喪失 | checking。同一IDのGETへ。POST追加なし |
| checking | 202 | checking維持、次のGETを予約 |
| checking | 200 completed | completed、選択解除、busy解除 |
| sending/checking | 規定の404 | unknown、選択解除、busy解除。自動照会終了 |
| checking | 通信不能等 | unverifiable、選択解除、busy解除。自動照会終了 |
| sending | 検証済み受付拒否 | rejected、選択解除、busy解除 |
| busy | 取得操作/クリア/送信の再入力 | UIとcontroller両方でno-op。新しいUUIDも作らない |
| busy | ダイアログ開閉/階層移動/離脱 | 未送信選択の処理のみ。request/operationは維持 |
| 終了状態 | 新たな選択→送信 | 新しいUUIDで新規要求。以前の結果を自動再送しない |

選択の強調は入力直後のReact更新で反映し、通信完了・debounce・タイマーを待たない。未実測のミリ秒上限は置かず、遅延したAPIを使っても次の描画で選択/送信中表示が出ることをブラウザで検収する。

### 6.2 タイマーと競合

- 各HTTP要求は30秒でAbortControllerをabortする。タイムアウトはJSON本文の読取まで含める。abortを無視するテストtransportでもタイムアウトで待機を終えられるよう、タイマー側で状態遷移を確定し、遅延応答は世代番号で捨てる。
- POSTのタイムアウト・通信障害後の初回GETは直ちに行う（document非表示中は§6.3に従い表示復帰まで予約を保留）。202後のGETは前回応答完了から5秒後を暫定値とする。根拠は既存監視status更新の5秒周期への整合であり、E11の実測応答時間から算出した値ではない。定数 `OPERATION_POLL_DELAY_MS` として隔離する。
- `setInterval`を使わず、前の要求完了後の単発setTimeoutで予約する。常に要求1件・照会予約1件以下。202が続く間は操作全体の期限を新設しない。
- 成功・失敗・不明・確認不能・拒否で全タイマーを解放する。AbortErrorだけから「ユーザーが中止した」と判断しない。
- 同じIDのPOST遅延応答/GET完了/タイムアウトが競合しても終了状態を古い応答で戻さない。controllerの要求世代・disposedフラグとbusyガードで排除する。
- React StrictModeのeffect再作成時は旧controllerの購読・タイマーを破棄する。effectでPOSTを開始せず、明示的な送信イベントからだけ始める。

### 6.3 離脱・タブ非表示【確定：A1承認済み】

TerminalAppにcontrollerを保持し、同一端末でmonitor以外へ移っても進行中のPOST/照会を続け、共通通知の操作行へ経過・結果を表示する。戻ったときは未選択で、進行中ならbusyを維持する。ダイアログは離脱時に閉じ、階層履歴は当該TerminalApp内に保持する。

document非表示中は既に始まったHTTPを30秒上限まで待つが、次のGET予約を休止する。表示復帰時は未完了要求を同じIDで直ちに照会する。非表示だけを通信失敗として終わらせない。既に得た404/通信不能等の終了状態からは復帰イベントで自動再開しない。

TerminalApp自体のunmount/端末変更/ページ終了ではcontroller.disposeによりHTTP待機・タイマー・visibility listener・購読を破棄する。サーバーへキャンセル要求は送らず、すでに送った操作はサーバー上で継続する。フルリロードや別端末への遷移を越える永続化・sessionStorage復元はK2に含めない。

## 7. 通知・ダイアログ・アクセシビリティ

### 7.1 通知操作行への接続【設計案】

controller/選択状態から算出した操作メッセージを `TerminalApp` が既存通知stateへ表示用に合成する。`visibleNotificationState`の `items`、未読/確認集合、問いかけ選択、cursor、phaseは変更しない。

`operationGuideMessage`を次の引数へ拡張する。

```ts
function operationGuideMessage(
  notificationMessage: string,
  monitoringFailed: boolean,
  notificationRetrying: boolean,
  operationMessage?: string | null,
): string;
```

優先順は「取得操作の選択/進行/最新結果」「監視情報API取得不可」「通知受信再試行」。意味の異なる状態を `｜` で同じ操作行へ併記し、通知の通常案内だけを省略する。操作メッセージがない場合は従来表示を維持する。警報・問いかけ行を操作結果で上書きしない。操作行の未読・未対応件数も従来どおり。

| 状態 | 操作メッセージ例 |
| --- | --- |
| 選択中 | `全体：取得停止を選択中／送信で実行` |
| POST待機 | `全体：取得停止を送信中` |
| 結果照会 | `全体：取得停止の結果を確認中` |
| success / failure | `全体：取得停止が完了しました` / `全体：取得停止に失敗しました` |
| 404 | `全体：取得停止の結果が不明です（要求の記録を確認できません）` |
| 確認不能 | `全体：取得停止の結果を確認できません（通信・応答異常）` |
| 受付拒否 | `全体：取得停止の要求を受け付けられませんでした` |

対象「全体」を選択時から明示する。新たな選択中は最新結果に代えて選択案内、選択解除時は保持中の最新結果へ戻す。結果自動消去タイマーは追加しない。E11がサーバーで生成する通知は既存feedから別途受け取り、クライアントで通知を複製しない。K2操作自体からブザー・チャイム・既読化を発生させない。

### 7.2 ダイアログ境界【確定：B1承認済み】

K2では同時に1個のダイアログを開き、入口に対応するタイトル・「表示内容は準備中です。」・閉じるボタンだけを表示する。空の一覧や偽データを出して実体完成と誤認させない。開発Issue番号や接続方法などの説明は画面へ表示しない。

#### 内容の差し込み境界

```ts
interface MonitoringDialogContentContext {
  readonly dialogId: MonitoringDialogId;
  readonly close: () => void;
}
interface MonitoringDialogHostProps {
  readonly dialogId: MonitoringDialogId | null;
  readonly onClose: () => void;
  readonly renderContent?: (context: MonitoringDialogContentContext) => ReactNode;
}
```

タイトルは `reception → 受信履歴`、`telegram → 電文履歴`、`output → 出力履歴`、`diagnostics → 状態診断` の固定対応とする。hostがdialog・タイトル・スクロール可能な本文スロット・下部action領域を所有し、後続はrenderContentに本文だけを渡す。K2ではrenderContentを指定せず、既定の準備中表示を使う。後続のrenderContentがnull/undefinedを返した場合も準備中表示を使い、内容未接続を空白にしない。後続が準備中・取得失敗を別表示する場合は、その状態を明示するReactNodeを返す。

開閉・選択解除・フォーカス制御はhostに残し、内容側で別のdialogを生成しない。内容側に閉じる操作が必要ならcontext.closeを使う。ID変更時は本文をdialogIdでkey付けして旧内容のローカル状態を破棄し、異なる履歴へ検索条件等が漏れない境界とする。K2ホスト自身は履歴/診断APIを呼ばない。

#### MD3に沿う骨組み

ネイティブ `<dialog>` を基盤とし、ブラウザ標準の枠・余白・フォントをそのまま表示せず、`monitoring.css`内の専用クラスで次を定義する。値はK2骨組みの設計値であり、ブラウザ実測値ではない。

| 部位 | スタイル・配置 |
| --- | --- |
| surface | 背景 `var(--md-sys-color-surface-container-high)`、文字 `var(--md-sys-color-on-surface)`、borderなし、角丸 `var(--md-sys-shape-corner-md)`。内側余白24px。既存のダークテーマを継承 |
| 幅・高さ | 幅560pxを上限とし、viewport左右各24px以上を空ける。高さもviewport上下各24px以内。閉じたdialogにdisplay:flexを適用せず、`[open]`時のみ縦flex。長い内容は本文だけをスクロールさせ、タイトル/action領域を残す |
| backdrop | `var(--md-sys-color-scrim)` とopacity 0.32。surface自体を半透明にしない。色のHEX/RGB直書きなし |
| タイトル | 既に読み込まれているMaterial typographyの `md-typescale-headline-small` を使用。既存日本語typefaceを継承し、見出しの既定marginを除く |
| 本文 | タイトルから16px離し、`md-typescale-body-medium`、文字 `var(--md-sys-color-on-surface-variant)`。準備中表示は1文のみ |
| action | 本文から24px離し、末尾に右寄せ。既存バレルからimportした `GbButton` の `color="text" size="sm"` で「閉じる」を置く。ツールバー専用の幅120px規則は適用しない |
| フォーカス | 既存のprimaryトークンを使うfocus-visibleの視認性を保持。本文がスクロールしても閉じる操作を見失わない |

`<md-*>`生タグ、JSのbare import、新たな依存ライブラリは追加しない。Material typographyは既存CSS importを再利用し、色は既存MD3トークンのみを使用する。今回の骨組みの幅・本文高さは後続の一覧/原文用レイアウトを決定するものではなく、後続は内容設計時に必要な寸法変更を設計する。

#### モーダル・フォーカス・終了経路

`showModal()`/`close()`を利用し、titleをaria-labelledbyで結ぶ。準備中の既定本文を表示するときだけaria-describedbyでその1文を参照する。後続の長い本文全体を一括読み上げの説明として結び付けない。

ネイティブのモーダルによる背景の非活性化・フォーカストラップを利用する。初期フォーカスは閉じるボタンへ置き、実ブラウザでTab/Shift+Tabが背景へ抜けないことを確認する。EscapeのcancelイベントはpreventDefaultして閉じるボタンと同じonClose経路へ集約する。closeイベントと重複しても状態解除が一度だけ成立する冪等な処理にし、選択解除もこの経路を通す。背景クリックで閉じる追加仕様は設けない。

閉じたら元の入口へフォーカスを返す。monitor離脱で入口が消える場合は新しいビューの本文へ返し、unmount後の要素へfocusしない。後続内容の初期フォーカスが必要となる場合は後続側で設計する。送信済み取得操作のライフサイクルはダイアログの開閉と独立して維持する。

### 7.3 レイアウト・表示【設計案】

- 既存AppShell.toolbarを使用し、本体下/通知上の固定配置を維持する。文字ボタンは既存120px幅・smの40px高・squareを維持する。新設のクリアも同寸法。上下の配置を別領域へ移さない。
- 戻る2個はホストを40×40pxの正方形とする。既存の `.monitoring-toolbar-group md-gb-button { inline-size:120px }` を専用クラスとコンポーネントの公開されたサイズ指定手段で限定的に調整する。Material内部buttonの40×40pxへの厳密な寸法一致は要求しない。通常ボタンの形状を壊す内部DOMの書換え・非公開実装への注入は行わず、通常利用幅と検収幅で見切れ・視覚的重なり・誤操作・横overflowがないことを実ブラウザで確認する。狭幅ではグループ単位で折り返す。
- メニュー名領域は `inline-size:120px; flex:0 0 120px` を案とする（既存文字ボタン幅を基準にした値で、実測で導いた値ではない）。空欄でも領域を確保。長い名前は省略し、title等で全文を提示する。
- 戻る2個とメニュー名を先頭グループ、既存の操作グループを中央、クリア/送信を末尾グループとする。グループ内8px・グループ間24pxを維持し、末尾グループは右寄せする。全11ボタンとなる。
- 上記数値から1行の必要内容幅は1448px（先頭216 + 開始停止248 + 強制120 + 履歴376 + 診断120 + 末尾248 + グループ間120）。これはCSS設計計算であり実測値ではない。K1の1080px閾値を流用しない。
- 狭幅では既存同様グループ単位で折り返し、toolbar自身の高さを広げる。最小グループ幅を下回る極端な幅は今回の新規保証対象としない。検収は既存の760px未満を含め、内容幅600pxまで実施する。文字ボタンの縮小やtoolbar横スクロールで回避しない。
- 配色は既存 `--md-sys-color-*` のみ。通常/選択のトークン対応は暫定とし、製造後のユーザー監修で調整する。HEX/RGBの直書き・新たな警戒色を設けない。
- 取得操作は通常のbuttonのまま維持し、Material Labsの `type="toggle"` / `selected` は使用しない。Materialの形状遷移を選択状態の表現へ流用せず、選択によって寸法・角丸・配置・変形を変更しない。
- 選択中の視覚表現はアプリ側の状態クラスと既存MD3トークンによる枠/背景で行う。通常ボタンの公開されたスタイル指定手段を用い、内部DOMへの書換えで表現しない。操作行の「選択中」文言、disabled、送信/照会中の文字も維持し、色だけで状態を表さない。

### 7.4 キーボードと読み上げ

- 戻るボタンはaria-label/titleをそれぞれ「最初のメニューへ戻る」「一つ前のメニューへ戻る」とする。アイコンspanはaria-hidden。文字付きボタンでもアイコン名を読み上げない。
- 取得操作の選択時は公開されたaria-labelでアクセシブル名を「取得開始、選択中」「取得停止、選択中」「強制更新、選択中」とし、解除時はそれぞれ通常名へ戻す。視覚上のボタンラベルは変えず、選択中の文字は既存の操作行に表示する。`aria-pressed` をMaterial内部へ注入する方式は採用しない。
- GbButtonのホストにaria-labelを付けただけで完了とせず、実ブラウザのアクセシビリティツリーで実際の操作対象の名前が選択/解除に追従することと、内部buttonのdisabled時のキー操作を確認する。ラッパーを介する場合も公開された属性・プロパティを使い、非公開のARIA管理オブジェクトやShadow DOM内部へ書き込まない。
- Tab/Shift+TabとEnter/Spaceで利用できる。矢印キー移動を実装しない状態で `role="toolbar"` を付けず、名前付きgroupでまとめる。フォーカス輪郭はMD3のoutline/primary等を使用する。
- 操作行は既存 `role="status" aria-live="polite"` を利用して選択状態と進行・結果を通知し、同じ202の反復で同一文言を書き直して読み上げを連打しない。ボタンに別のlive領域を追加しない。
- 送信は `aria-label="取得操作を送信"` として、問いかけ行の送信と名前を区別する。問いかけの確認選択と取得操作選択は互いに変更しない。

## 8. 検証計画・受け入れ条件

テストは既存node:test/tsxを使用する。controllerに偽時計・UUID factory・fetch clientを注入し、React内部実装を検査するだけで済ませない。実ブラウザではMaterialのupgrade、`document.fonts.ready`を待って測定する。実サーバーへの開始/停止/強制更新の検収は、通常利用中のサーバーへ副作用を送らず、専用のスタブ取得対象・一時DBを使う。

各条件には§10で承認済みのA1/B1を反映する。離脱後の照会・共通操作行表示と、4入口のモーダル骨組みをK2の検収対象に含める。

- [ ] **AC01 選択だけでは実行しない**：fetchを記録するテストで開始→停止→停止再押下を行う。選択がstart→stop→nullと即座に変わり、POST/GETが0件、監視データも不変である。
- [ ] **AC02 送信の対応**：3操作を各1回、選択→送信する。§5の各URL・本文1キー・別々のUUIDと完全一致する。送信前に操作行へ「全体」と操作名が表示される。
- [ ] **AC03 二重送信防止**：POSTを保留し同じフレームで送信2回、操作選択/クリアを呼ぶ。UUID生成・POSTは各1回、選択変更は拒否。UIでも3操作・クリア・送信がdisabledとなる。
- [ ] **AC04 30秒は操作失敗期限でない**：POSTを保留し29999msではGETなし、30000msで同一UUIDへGETが1回発生する。failureではなく確認中、POSTは合計1件である。JSON本文読取中の停滞も同様に確認する。
- [ ] **AC05 202継続**：POST 202→GET 202→GET 200を返す。応答完了から5秒の直列GET、busy継続、200後に選択解除・全タイマー解放を確認する。202を30秒超継続しても操作全体をfailureにしない。
- [ ] **AC06 200の成功/失敗**：completed success/failureを別々に返す。HTTP 200を共通成功扱いせず、操作行の完了/失敗と選択解除を確認する。duplicate trueでも同じ結果になる。
- [ ] **AC07 結果不明/確認不能**：GETへ検証済み404、通信例外、タイムアウト、503を個別に返す。404は結果不明、他は結果確認不能。選択解除とbusy解除、後続GET/POSTが0件である。次の明示的な選択→送信だけが新UUIDを生成する。
- [ ] **AC08 応答検証**：wrong ID/kind/target、必須フィールド欠落、enum不正、日時不正、duplicateの型不正、HTML/壊れたJSON、HTTPとstatus不一致を1項目ずつ作る。完了成功へ遷移しない。POSTの場合は同じIDでGET、GETの場合は確認不能で終わる。未知の追加キーは受理する。
- [ ] **AC09 受付拒否と500**：POSTの400/409/503を包絡込みで返し、受付拒否・再送なしを確認する。POST 500では同一IDをGETする。任意errorMessageにHTMLや内部URLを入れても、その文字列やHTMLが画面に出ない。
- [ ] **AC10 遅延応答の競合**：POSTタイムアウト後にGETをcompletedへ進めてから旧POSTを解決する。完了結果を古い応答で上書きしない。dispose後のresolve/rejectも新たな更新・照会を起こさない。
- [ ] **AC11 クリア**：未選択で無効、選択後に有効、押下で未選択・POSTなしとなる。送信/照会中は無効。終了後の結果をクリアで消さず、サーバーのキャンセル呼出しも存在しない。
- [ ] **AC12 履歴・診断入口と内容境界**：取得操作を選択後、4入口を順に開く。送信不要で別IDのホストが開き、§7.2の各タイトル・準備中の1文・閉じるを表示し、選択が解除される。閉じるボタン/Escapeでも未選択となる。履歴/診断API・取得制御API呼出しは0件。テストでrenderContentへ識別可能な本文を渡すと準備中表示だけが置き換わり、共通タイトル/action/開閉は維持される。ID変更時は旧本文状態が残らない。
- [ ] **AC13 モーダルとMD3骨組み**：キーボードで各入口を開き、タイトルと既定本文が読み取れ、閉じるへフォーカスし、Tab/Shift+Tabで背景へ抜けず、Escapeで入口へ戻る。背景はクリック操作も受け付けない。送信中に開閉しても同じ要求が続く。幅600px/1280pxのviewportでsurface/typography/右寄せactionが§7.2のトークン・配置を使用し、長いテスト本文でも閉じるが画面内に残ることを確認する。
- [ ] **AC14 階層**：テスト専用のroot→child→grandchild定義でnavigate/back/backToRootを実行し、履歴とタイトルが完全一致する。移動で選択解除、現在ID/未登録IDへの移動はno-op。ルート2ボタンはdisabled、子階層は有効、本番定義には子階層・URL更新がない。
- [ ] **AC15 monitor離脱**：未送信選択後に別ビューへ移動し戻ると未選択。送信/照会中に移動しても同じIDの照会が続き、共通操作行へ結果が出る。戻ってもPOSTし直さず、ダイアログは閉じている。
- [ ] **AC16 非表示と破棄**：202後にdocumentをhiddenにし、新規GET予約が止まることを偽時計で確認。visibleで同一IDのGETを1回再開。TerminalApp破棄で待機要求abort・全タイマー/listener/購読解放。サーバーへの取消要求は0件である。
- [ ] **AC17 通知との共存**：警報・問いかけ・選択中の問いかけ確認を持つ通知stateで取得操作を選択/送信/完了する。これらのID・内容・未読/未対応集合は変わらず操作行だけが変わる。監視API障害・通知受信再試行が同時に発生しても操作結果と両障害案内が併記される。
- [ ] **AC18 ダッシュボードの独立**：監視DTOを固定し選択・送信・成功を行う。取得運転カード/表は楽観更新されず、次の監視DTO受信時だけ更新される。停止中の強制更新成功で「自動取得有効」をクライアントが作らない。
- [ ] **AC19 配置・寸法**：フォントとMaterial登録完了後、ユーザーの通常利用幅と内容幅1448px/1447px/600pxで実ブラウザ確認し、通常利用幅の測定値も記録する。11個のボタン、既存文字ボタン120×40px、戻る2個のホスト40×40px、名前120pxを確認する。Material内部buttonの厳密な寸法一致は合否条件にしない。戻るボタンの見切れ・隣接領域との視覚的重なり・横overflowがなく、各ボタンをポインター/キーボードで個別に操作して意図した戻り動作だけが発火し、誤操作が生じないことを確認する。通常形状を維持した公開手段で実現し、非公開内部DOMの書換えを追加していない。狭幅ではグループ単位折返し、最後のクリア/送信グループ右寄せ、ボタン縮小なし。本文・通知の重なりも確認する。
- [ ] **AC20 名前と状態の安定**：テスト専用子メニューで短い/長いタイトルを切り替える。タイトル領域幅と後続先頭ボタンのx座標が変わらない。ルートでは文字だけ空になる。未選択/選択/送信中/disabledの高さが変わらない。
- [ ] **AC21 アクセシビリティと選択表現**：Tab/Enter/Spaceで3取得操作をそれぞれ選択・解除し、実ブラウザAX上の操作対象の名前が「取得開始」↔「取得開始、選択中」等へ完全一致で切り替わることを確認する。通常buttonのまま、公開aria-labelとMD3の状態クラスを使っており、Materialの切替用プロパティ・内部ARIA注入・形状遷移を選択表現に利用していない。状態クラスと操作行の「選択中」文言が追従し、選択/解除で通常ボタンの形状や配置が崩れない。戻るのaria-label/title、アイコン非読み上げ、内部buttonのdisabled、フォーカス可視、既存role=statusによる状態通知も確認する。問いかけの送信と取得操作の送信を識別できる。
- [ ] **AC22 本番ビルド**：buildした画面でもGbButtonがupgradeされ、文字・4アイコン・disabled/選択が機能する。bare import、生mdタグ、色の直書き、依存バージョン変更が追加されていない。
- [ ] **AC23 品質・範囲**：`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`、`npm run build`を実行し成功する。追加テストは検証標準どおり意味を変えない対照実験後に実装を壊してredを確認し、変更を復旧する。新規結果領域、履歴実体、認証、API/shared変更、他画面の配置変更がないことをdiffで確認する。

## 9. 棚卸し結論と後続Issueへの引き継ぎ

| 管理項目 | K2での結論 | 後続へ残る責務 |
| --- | --- | --- |
| AD-H023 | 取得操作の状態/結果は既存通知の操作行。警報・問いかけ行や通知ID・選択・件数を操作結果で上書きしない。通信障害案内も併記 | サーバー通知同士の優先順位・履歴分類・起動応答監査は既存H2/K4の責務。K2で再定義しない |
| AD-H064 | 全体一括。UUIDは1操作1個、同じUUIDで結果照会。30秒はHTTP待機上限。202継続、200のsuccess/failure、404不明、通信不能の確認不能を区別。新規要求の自動再送なし | manual/recovery/夜間/バックオフと同時実行集約はE11。K5はrequestIdと操作結果を履歴へつなぐ。上流取得の個別成否と操作成否を混同しない |
| AD-H121 | HTTP「受信履歴」とXML「電文履歴」を別入口・別dialogIdに固定し、いずれも直接開く | K3でそれぞれの一覧・原文・左右ペイン・検索を実装。K2ホストの開閉確認をもって履歴実体完成としない |

- **K3 #76**：`reception`/`telegram`の内容を差し込む。APIの違い、件数、raw表示、会場・本番/訓練区別を引き継ぐ。かな形式の採否は本Issueで決めない。
- **K4 #77**：`output`を接続。警報だけでなく問いかけ・非常ブザーも含む。通知検知・出力・実鳴動完了の意味を区別する。
- **K8 #81**：`diagnostics`を接続。K2で診断結果やCPU等の疑似値を生成しない。
- **K5 #78**：要求識別子と結果を照合可能にする。再照会の専用UI、ページ再読込後の復元は別設計。actorId等をK2で補完しない。
- **階層拡張**：後続はtoolbar定義を追加してnavigate項目を接続する。共通の戻る/メニュー名/クリア/送信を複製しない。未送信の選択解除契約を維持する。
- **監視状態APIの不足**：K1/K6から引き継いだ停止理由・停止処理中・強制更新中・再試行待ちの汎用DTO拡張はK2の既存E11接続から分離する。今回の操作行は「当該要求を送信/照会している」事実だけを表示し、サーバー内の停止処理中等を推定しない。全端末の進行状態をダッシュボードへ表示する要件は後続の設計判断として残す。
- **配色監修**：暫定MD3配色を実装後にユーザーが監修する。これを機能実装の阻害要因にしない。

## 10. 承認記録

### A. monitor離脱後の結果確認と表示

【確定】ユーザーの承認判断を統括担当から受領し、A1を採用した。TerminalAppで要求を保持し、monitor以外へ移動後も同一requestIdで結果照会を継続する。共通操作行へ進行・結果を表示し、非表示タブでは次回予約を休止、表示復帰時に再照会する（§6.3、AC15/AC16）。サーバー要求のキャンセルやフルリロードを越える永続化は追加しない。

### B. 履歴・診断内容が未接続の間の見せ方

【確定】ユーザーの承認判断を統括担当から受領し、B1を採用した。K2でMaterial Designの世界観に合うダイアログ骨組みを実装する。4入口に対応するタイトル・準備中の最小表示・閉じる、モーダル、フォーカストラップ/復帰、Escapeを備える。ネイティブdialogに既存MD3のsurface/typography/action配置を適用し、共通ホストへ後続K3/K4/K8の本文を差し込む（§7.2、AC12/AC13）。実データ・一覧・検索・原文・診断内容は後続の責務とする。

以上により、この設計で追加ヒアリングを要した2点は解消した。配色の実装後監修と§11の実挙動確認は継続して残る。

### C. 実画面確認による取得操作ボタンの選択表現の変更

【確定】ユーザーの実画面確認により、Material Labsの `type="toggle"` / `selected` を取得操作へ適用すると既存のトグル形状遷移と競合し、表示が大きく崩れることが判明した。通常buttonを維持し、Materialの形状遷移を選択表現へ流用しない方針へ変更する。

選択中は既存MD3トークンの状態クラスと操作行の「選択中」文言で示す。支援技術には公開aria-labelを通じて「取得開始、選択中」等のアクセシブル名を伝え、解除時に通常名へ戻す。Material内部へ押下状態を注入する方式は採用しない。実ブラウザAXで名前の反映を確認する（§7.3〜7.4、AC21）。

【確定】追加のユーザー判断では、戻るボタンはある程度のブラウザ幅で問題なく表示できているため、Shadow内部buttonまで40×40pxへ矯正する要件を撤回した。ホストの40×40px正方形は維持し、通常利用幅と検収幅で見切れ・視覚的重なり・誤操作・横overflowがなく、狭幅でグループ単位に折り返すことを合格条件とする。Material内部buttonの厳密な寸法一致を要求せず、通常形状を壊さない公開手段と実ブラウザ確認を用いる（AC19）。主修正は取得操作に適用した切替用プロパティの撤回である。

## 11. 実挙動未確認・設計フェーズの確認結果

- 設計ではコード/型/既存テストを静的確認した。ブラウザ・devサーバーの起動、実E11のPOST、外部気象取得は行っていない。
- 初回設計時点ではMaterial Labsの40pxアイコン専用外寸、アイコン/ラベルの収まり、形状遷移、内部buttonへのaria属性伝播、ダイアログのフォーカス制御は**実挙動未確認**だった。後のユーザー実画面確認で判明した形状崩れは§10-Cに記録した。今回変更する通常buttonと状態クラス・アクセシブル名の組合せは設計担当による**実挙動未確認**であり、AC19/AC21により改めて検収する。
- 1448pxの必要幅、名前領域120px、600px幅での折返しは設計計算であり**実挙動未確認**。本文の高さ・通知行の長文表示を含め製造/検収で確認する。
- POSTの30秒タイムアウト後もサーバー処理が継続すること、ネットワーク断/サーバー再起動/遅延応答の組合せ、document非表示後のブラウザタイマー制限は**実挙動未確認**。専用環境で検証する。
- GitHubの直接取得は本環境で通信失敗。Issue本文・コメントの確認結果は統括担当からの共有を使用した。
- 着手時は指定ブランチ、既存差分なし。通常のgit statusでfsmonitor通信エラーが出たため、設定を書き換えず `git -c core.fsmonitor=false status --porcelain` で再確認した。
- 承認反映の改訂着手時は本書だけが未追跡の新規ファイルで、他の差分はなかった。改訂でも本書のみを変更し、A1/B1の確定とMD3ダイアログ骨組み・内容境界・受け入れ条件を整合させた。
- 初回設計終了時の差分は本書の新規追加のみ。`git diff --no-index --check /dev/null docs/design/issue-75-monitoring-toolbar.md` で空白エラーなしを確認した。当時は依存関係（node_modules）が未導入のためPrettierは実行していない。コード変更・コミットを伴わない設計段階のためlint/typecheck/テスト/buildは実行していない。
- §10-Cの改訂着手時には製造・検証中のコード等の既存差分があった。これらを変更せず、本書だけを改訂した。設計書の差分と空白を再確認し、コミットは行わない。

作成: Codex (GPT-6 Astra)。設計承認後のコミット署名は `Co-Authored-By: Codex (GPT-6 Astra) <noreply@openai.com>`。
