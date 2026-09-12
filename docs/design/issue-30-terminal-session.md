# Issue #30「D6. 端末セッション識別子の発行・保持機構」設計

作成日: 2026-09-13  
状態: 2026-09-13 ユーザー承認済み  
設計担当: Codex (GPT-6 Astra)

## 1. 目的と範囲

端末の起動単位を表す独自 ID をブラウザで発行・保持し、同一 ID の初回問い合わせを SQLite に記録する基盤を実装する。再読み込み、一時切断、API サーバー再起動で同じ ID を新規起動と誤認しない。

#29 は本 Issue の後に実施する。#30 はブラウザ側の利用可能なモジュール、サーバー側の判定リポジトリ、永続化テーブル、テストまでを担当する。HTTP エンドポイント、実画面からの問い合わせ、通知生成・再提示・履歴記録は #29 の責務とする。実画面への接続前でも、各モジュールを直接実行するテストで本 Issue を検収できる構成とする。

## 2. 参照資料と判断根拠

- [Issue #30](https://github.com/BlueKurage119/wx-viewer-poc/issues/30)、[Issue 下書き](../issues-draft.md) D6。
- [基本設計](../basic-design.md) §7.7: 独自 ID、同一 ID の初回問い合わせによる起動判定、定期ポーリング・一時再接続の継続扱いは確定。節内の具体化案を追加の確定事項として扱わない。
- ユーザーの今回の承認: 同一タブの再読み込み・一時切断では ID を維持する。タブを閉じて開き直す通常の新規起動では新しい ID とする。サーバー再起動後も初回判定記録を永続化し、同じ ID は継続とする。#29 は後続、製造は AGY へ手動委託予定。
- [SQLite 基盤設計](issue-5-sqlite-persistence.md)、`apps/api/src/database/{connection,migrations}.ts`: 既存 SQLite 接続と追加 SQL migration を利用する。既存 migration は変更しない。
- [通知モデル設計](issue-25-notification-data-model.md): 通知事実と端末の出来事を分ける。本 Issue の記録は `notification_output_history` に入れず、通知型へ端末 ID を追加しない。
- `apps/api/src/repositories/operationHistoryRepository.ts`: 接続を引数で受け取る関数形式に合わせる。
- `apps/api/src/app.ts` は health API のみ。`apps/web/src/main.tsx` は StrictMode の描画、`App.tsx` は画面シェルであり、起動通知の問い合わせは未実装。ここへ仮の登録通信を追加しない。
- [HTML Standard: Web storage](https://html.spec.whatwg.org/multipage/webstorage.html): sessionStorage は同じタブ内の保持に適する。一方、保存禁止・容量制限等で取得や書き込みが失敗し得る。ブラウザの複製・復元は通常の空の新規タブと同一視しない。ユーザーはコピー／復元された ID の継続を許容した。[MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) でも再読み込み・復元時の保持と opener からのコピーを確認した。
- [Web Cryptography API](https://w3c.github.io/webcrypto/): ID 生成には暗号学的乱数を使用する。ネットワーク端末の HTTP 配信も考慮して `crypto.getRandomValues` から UUID v4 を構成する。`randomUUID` の secure context 制限に依存しない。

設計時の worktree に `node_modules` はない。依存の実物・ブラウザでの動作・SQLite の新規 SQL は実挙動未確認であり、製造時に下記の検証を実行する。新規ライブラリは追加しない。

## 3. 識別子とブラウザ側契約

### 3.1 共通型

`packages/shared/src/terminalSession.ts` を追加し、`index.ts` から export する。

```ts
export type TerminalSessionId = string;
export type TerminalSessionInquiryKind = 'startup' | 'continuation';
export function isTerminalSessionId(value: unknown): value is TerminalSessionId;
```

ID は小文字の UUID v4 表記のみを受理する。検証は `typeof value === 'string'` と `value.length === 36` を確認したうえで `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`。末尾改行も拒否する。空白の除去や大文字の正規化で別入力を同一扱いにしない。36 文字は UUID の形式によるもので、推定した運用閾値ではない。

ID は認証情報でも物理端末の恒久 ID でもない。端末 URL の設定 ID とも区別し、認可には使わない。

### 3.2 発行・保持モジュール

`apps/web/src/session/terminalSession.ts` に以下を提供する。

```ts
export type TerminalSessionState =
  | { readonly status: 'ready'; readonly sessionId: TerminalSessionId; readonly persistence: 'session' | 'memory' }
  | { readonly status: 'unavailable'; readonly reason: 'random' };

export interface TerminalSessionDependencies {
  readonly getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  readonly fillRandom: (bytes: Uint8Array) => void;
}

export interface TerminalSessionStore {
  getOrCreate(terminalId: string): TerminalSessionState;
}
export function createTerminalSessionStore(
  dependencies: TerminalSessionDependencies,
): TerminalSessionStore;
export function getOrCreateTerminalSession(terminalId: string): TerminalSessionState;
```

- 保存キーは `wx-viewer:terminal-session:v1:${terminalId}` とする。同じタブ・origin 内でも登録端末ごとに保持する。`terminalId` は既存 `resolveTerminal` が解決した `terminal.id` を #29 から渡す。空文字はプログラミングエラーとして throw する。端末 A → B → A の URL 切替では A の ID に戻り、hash による画面切替も ID に影響しない。既存端末設定の移動は不要。
- factory は端末 ID ごとのメモリ Map を持つ。まずメモリ、次に storage の有効値を使い、新規発行時もメモリへ保持する。通常 export はモジュール内 singleton store へ委譲する。StrictMode の重複呼び出しでも再発行しない。保存成功時はモジュールの再ロードでも storage から回復する。
- キーなし、空、不正形式なら乱数 16 バイトから UUID v4 を生成し、version と variant を設定して小文字の標準形式へ変換する。保存成功なら `persistence: 'session'`、storage の取得・読出し・書込み失敗ならメモリ内で保持して `persistence: 'memory'` として返す。
- 既定依存は呼び出し時に `window.sessionStorage` と `window.crypto.getRandomValues` を取得する。import 時にブラウザ API を触らず、Node テストで依存注入できるようにする。
- storage 失敗時も有効なメモリ ID で継続し、同じ store の同じ端末では再発行しない。保持済み値の後からの変更を追従しない。乱数生成自体が失敗して有効 ID がない場合のみ `unavailable` を返す。`Math.random` へ縮退しない。詳細な例外や ID を画面へ露出しない。
- unload/pagehide 時に削除しない。再読込でも発火し得るためである。タイムアウト・通信エラー・サーバー再起動を理由にローテーションしない。
- storage 不能時のメモリ縮退では再読み込み時に新規 ID になる。これはユーザー承認済みの例外であり、通知問い合わせは停止しない。複製・復元で storage が引き継がれた場合は ID 継続を許容し、タブ間調停は導入しない。

本 Issue で `App.tsx` / `main.tsx` からの呼び出しは追加しない。#29 が実際の端末問い合わせ開始時に呼び、以後の問い合わせへ ID を引き継ぐ。

## 4. 永続化と初回判定

### 4.1 テーブル

`apps/api/migrations/0019_create_terminal_session.sql` を追加する。設計時点の最新は 0018。製造開始時に競合があれば未適用の次番号へ変更し、その変更を報告する。

```sql
CREATE TABLE terminal_session (
  session_id TEXT PRIMARY KEY NOT NULL,
  first_inquired_at TEXT NOT NULL
);
```

1 ID に 1 行だけ保持し、`first_inquired_at` は UTC ISO 8601。二回目以降は更新しない。最終アクセス時刻、期限、サーバー世代、通知本体は保存しない。自動削除・期限切れを導入すると古い ID が再び起動と判定されるため、本 Issue では削除機能を設けない。DB の手動削除・差し替えによる記録喪失までは保証しない。

### 4.2 リポジトリ

`apps/api/src/repositories/terminalSessionRepository.ts` を追加し、既存バレルから export する。

```ts
export interface TerminalSessionInquiryResult {
  readonly sessionId: TerminalSessionId;
  readonly kind: TerminalSessionInquiryKind;
  readonly firstInquiredAt: string;
}

export function recordTerminalSessionInquiry(
  connection: DatabaseConnection,
  sessionId: TerminalSessionId,
  inquiredAt: string,
): TerminalSessionInquiryResult;
```

- ID を共通 validator、時刻を既存 `validateUtcIso8601String` で検証し、不正入力では書き込まず例外を返す。
- `INSERT ... ON CONFLICT(session_id) DO NOTHING` の変更行数で判定する。1 行挿入できた場合だけ `startup`、既存行なら `continuation`。対象を限定しない `INSERT OR IGNORE` で別の制約違反を隠さない。
- 続けて保存行を読み、初回時刻を返す。挿入・読出しは既存 `connection.transaction(...).immediate()` で一単位とする。同時呼び出しの二重 `startup` を `SELECT → INSERT` の存在確認で防ごうとしない。
- I/O エラー等は呼び出し元へ伝播し、起動または継続という成功値へ変換しない。接続を開閉する責務は既存サーバーに残す。
- 外側の同一接続トランザクションから利用できることを実行テストし、外側 rollback で記録も取り消せるようにする。非同期処理を SQLite 同期トランザクション内に持ち込まない。

## 5. #29 との責務分界

#30 は HTTP API を追加しない。#29 の URL、HTTP メソッド、ID の body/header 上の配置、応答スキーマは #29 設計で決める。共通 ID 検証とリポジトリがそのための公開契約となる。

1. ブラウザで ID を生成・取得することは、サーバーの初回問い合わせ記録を消費しない。
2. #29 は起動時問い合わせの妥当性と現況の準備を確認してから `recordTerminalSessionInquiry` を呼ぶ。初期化中・入力エラー・対象端末不明等の応答で呼ばない。
3. #29 が生成失敗時に起動機会を失ってはいけない処理を追加するときは、同じ DB 接続の外側トランザクションで判定記録とその処理をまとめる。#30 は外側 rollback 可能性を検証する。
4. 同じ ID の後続呼び出しは `continuation`。定期ポーリングで新規 ID を作らない。通常データ API のアクセスで本リポジトリを一律実行する middleware は追加しない。
5. `startup` は「このセッション ID が初めて受理された」を表す。サーバー起動後の警報初回出力判定や、通知配信の受領確認とは別概念である。サーバー再起動でも本テーブルを初期化しない。
6. 応答の通信断による受信未確認と、再送時の通知再提示・重複防止方針は #29 の設計対象。#30 の初回判定だけで exactly-once 配信を保証すると解釈しない。
7. 通知の `isTraining`、availability 三状態、通知モデルや履歴は本 Issue で変更しない。AuthGate、SSO、ユーザー識別、端末管理 UI も対象外。

## 6. 変更対象と製造順序

- 共通: `packages/shared/src/terminalSession.ts`、`index.ts`、`tests/terminalSession.test.ts`。
- web: `apps/web/src/session/terminalSession.ts`、`tests/terminalSession.test.ts`。
- API: SQL migration、`src/repositories/terminalSessionRepository.ts`、`src/repositories/index.ts`、`tests/terminalSessionRepository.test.ts`。`schema` / `historySchema` 等の migration 数 18 を固定している既存テストは、追加に対応する最小限の期待値修正。
- 依存追加、設定変更、サーバー起動順序変更、仮 API・仮 UI は不要。

製造は共通型・web モジュール、DB・リポジトリ、検証の順とする。設計承認後、統括が指定するブランチ・設計コミットを基準に着手する。AGY の自己検証結果は Walkthrough に受け入れ条件ごとに記録する。

## 7. 検証計画と受け入れ条件

Node.js 24 環境で `npm ci`、`npm run build -w packages/shared` を実行してから対象テストを開始する。完全一致を原則にする。UUID のランダム性は衝突しないことの大量反復試験で判定せず、固定の乱数注入で形式・bit 設定・生成回数を検証する。各テストは既存の Node test runner と tsx で実行する。

- [ ] AC1 共通 validator: 正しい UUID v4 を true、null・数値・空文字・大文字・余白・末尾改行・v1・不正 variant・前後文字付き文字列を false と完全一致で確認する。
- [ ] AC2 web 新規: 空の fake Storage と 16 バイトすべてゼロの乱数注入で、保存値と返却 ID が `00000000-0000-4000-8000-000000000000` と一致。乱数呼出し 1 回・書込 1 回。別の固定値でも version/variant が正しく設定される。
- [ ] AC3 継続: AC2 と同じ storage を渡す別 store と元の store で複数回呼び、同一 ID・追加乱数 0 回・追加書込 0 回。端末 A → B → A で A は元の ID、B は別 ID。一時切断を表す呼出し間隔を挟んでも ID に時刻依存がない。
- [ ] AC4 新規タブ相当: 独立した空 storage と異なる固定乱数を使って別 ID となる。壊れた保存値は一度だけ置換され、次回は維持される。
- [ ] AC5 障害: storage getter/getItem/setItem がそれぞれ throw するケースは、固定乱数の期待 ID と `status:'ready', persistence:'memory'` に完全一致。同じ store の再呼出しは同一 ID・追加乱数 0 回、別 store に作り直すと新規乱数で別 ID。乱数 throw で利用可能な ID がないケースだけ `{status:'unavailable',reason:'random'}`。
- [ ] AC6 DB: 新規ファイル DB に migration 適用後、ID A の初回は `startup`、別時刻の再問い合わせは `continuation`、初回時刻は保持、行数 1。ID B は `startup`、全行数 2。返却オブジェクトを固定値で完全一致比較する。
- [ ] AC7 再起動: AC6 の DB を close し、同じファイルを initializeDatabase で開き直す。A は `continuation` かつ元の初回時刻。メモリ DB の再作成で代用しない。
- [ ] AC8 競合: 同一ファイルへの独立接続を使い、同一 ID を問い合わせるテストを実行する。成功した結果のうち `startup` は一つ、残りは `continuation`、保存行は一つ。同期ライブラリであるため単なる Promise.all を並列競合の証拠にしない。worker を使う場合は開始を同期し、SQLite busy は成功値に変換せずテスト側で再試行して記録する。
- [ ] AC9 rollback: 外側 transaction 内で新規 ID を記録した後、意図的に throw する。行数 0、次回同 ID は `startup`。不正 ID・不正時刻でも行数は変化しない。
- [ ] AC10 実ブラウザ: 開発サーバーの有効端末 URL 上でモジュールを import し、関数結果を確認する。同一タブ reload 後に同じ ID、空の新規タブに URL を直接入力すると別 ID、通常のタブ終了後に新規タブから開くと別 ID。タブ複製・復元ではコピー／復元された ID の継続を許容する。browser 名・版と結果を報告する。UI への一時コード追加は不要。
- [ ] AC11 境界: 本 Issue の変更で起動問い合わせ HTTP API や通知書込みが追加されていない。web の API 呼出し接続は #29 へ引き継がれている。
- [ ] AC12 必須検証: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/web`、`npm run test -w apps/api`、`npm run build` が成功する。

### red と対照実験

新規テストを完成扱いにする前に、対象実装へ意味を変えないコメント変更を加え、対象テストが成功する対照実験を先に行う。その後、①保存済み ID を無視、②UUID variant 設定を削除、③既存行も startup と返す、④初回時刻を上書き、の変更を一つずつ加えて対応テストが失敗することを確認する。各変更を元に戻して次へ進み、最終状態では全テストを成功させる。失敗テスト名・原因・復元後の結果を報告する。一時 DB・一時コード・生成した試験成果物は片付ける。

## 8. 残留リスク・後続引き継ぎ

- セッション記録は無期限に増える。件数・容量・運用期間の実測なしに TTL を作らない。運用上削除が必要なら、継続判定への影響を含めて別途設計する。
- ID の漏洩・コピー・意図的な再利用を防ぐ認証機能ではない。
- SQLite の transaction ネスト、変更行数、競合時の実挙動は製造時に実物を確認する。既存ライブラリと矛盾する場合は方式を勝手に変更せず統括へ報告する。
- #29 はメモリ縮退でも起動問い合わせを継続する。乱数生成不能の `unavailable` の画面表示、ID の通信配置、通知処理とのトランザクション、初期化中応答、通信断後の再送方針を完成させる。#30 のテストを HTTP 結合検証の代用にはしない。

## 9. 追加ヒアリングの確定結果

ユーザーから以下の回答を受けた。追加の要ヒアリング事項はない。

1. タブ複製・復元でコピー／復元された ID の継続を許容する。複雑なタブ間調停は不要。
2. storage 不能時はメモリ内 ID で継続し、再読み込みでは新規起動になることを許容する。通知停止案は採用しない。

本書の設計承認後、統括が設計をコミットして AGY への製造委託条件を確定する。設計担当はブランチ・コミット・コードを変更しない。
