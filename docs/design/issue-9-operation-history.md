# Issue #9 操作記録テーブルの設計・実装

作成日: 2026-09-09

## 1. 目的と範囲

基本設計 §8.1・§8.2 が求める、取得サービスに対する全体一括の「取得開始」「取得停止」「強制更新」の**実行記録**を SQLite に永続化する。記録は、要求受理時刻、結果確定時刻、対象、結果、操作主体を後から監視画面で調査できるようにするための監査ログである。

本 Issue は、forward-only migration、追記・単件取得・一覧検索・件数取得・単件削除のリポジトリ層、およびそれらのテストを対象とする。実際に取得ジョブを開始・停止・集約する制御機構（Epic E11）、監視画面・REST API（Epic E10/E11）、認証・AuthGate 連携、履歴の一括／期間削除と権限（B6）は実装しない。

操作記録は通信履歴（B3 の `fetch_attempt`）とは別物である。例えば強制更新が 1 回実行されると、B5 は利用者の制御要求を 1 行記録し、その結果生じる複数の上流アクセスは Epic C が B3 に複数行記録する。互いを代替せず、外部キーも張らない。

## 2. 参照資料と前提

### 2.1 参照資料

- [Issue 化ドラフト](../issues-draft.md) — B5
- [基本設計](../basic-design.md) §8.1・§8.2（全体一括操作、履歴保持、操作主体）
- [Issue #5 設計](issue-5-sqlite-persistence.md) §7 — migration の命名・適用・forward-only 契約
- [Issue #6 設計](issue-6-info-type-schema.md) および [テーブル定義書](issue-6-table-definition.md) — リポジトリ／DDL の規約
- [Issue #7 設計](issue-7-reception-history.md) — 追記履歴・検索・ページングと B5 との役割分担
- [Issue #8 設計](issue-8-notification-output-history.md) — B4 が予約する migration `0011`

### 2.2 実装と並行作業から確認した事項

- 現在 main に存在する業務 migration は `0001`〜`0010` である。
- 並行中の Issue #8 の設計は `0011_create_notification_output_history.sql` を予約している。#8 が未マージでも、#9 は `0011` を使わない。
- よって #9 の製造は **#8 のクローズ・マージ後**に開始し、`apps/api/migrations/0012_create_operation_history.sql` を追加する。製造開始時に `origin/main` と対象ブランチで `0011_create_notification_output_history.sql` の存在・内容を確認する。#8 が別番号で確定した場合は、#9 の番号を「確定済み最大番号 + 1」に読み替え、既存・並行作業の migration を改変しない。
- migration は `NNNN_<name>.sql`、UTF-8、番号昇順、forward-only である。SQL に `BEGIN` / `COMMIT` / `ROLLBACK` を書かず、適用済み migration を編集しない。
- DB 接続は `DatabaseConnection` を各リポジトリ関数の第 1 引数として受け、値は prepared statement と bind parameter で渡す。時刻はアプリケーション側から UTC ISO 8601 文字列として渡す。
- B3／B4 は、履歴を自動削除せず、追記と単件削除だけを提供する。B5 も同じ保持方針に従う。

## 3. 設計判断

### 3.1 記録単位

1 行は、サーバーが受理し、その結果が確定した全体一括の制御要求 1 件を表す。画面上で操作を選択しただけ、送信前に選択を解除しただけ、履歴ダイアログを開いただけでは記録しない。これは基本設計 §8.1 の「送信を押して初めて実行要求を送る」という境界に合わせるためである。

`request_id` はクライアントまたは制御 API が与える要求識別子を保存する。B5 は同じ `request_id` を UNIQUE にし、タイムアウト後の同一要求識別子による照会・再送で監査行が二重に増えないようにする。ただし重複要求の実行集約そのものは Epic E11 の責務であり、B5 がジョブを制御しない。

制御 API は受理時の `requestedAt` と要求識別子を保持し、結果を確定した時点で `requestedAt` と `completedAt` を含む 1 行を `recordOperationHistory` で INSERT する。受理時に未完了行を INSERT して完了時に UPDATE する方式は採らない。結果未確定の中間状態を履歴に残さず、既存 B3／B4 と同じ追記ログ原則を守れるためである。プロセス停止等で結果を確定できなかった要求は B5 に行を残さず、Epic E11 の要求状態・再実行制御の責務として扱う。

### 3.2 操作・対象・結果

`operation_kind` は基本設計で確定している 3 操作に限定する。

| 永続値 | 表示上の操作 |
| --- | --- |
| `start` | 取得開始 |
| `stop` | 取得停止 |
| `force_refresh` | 強制更新 |

対象は今回「全体一括」と確定しているため、`target_kind` を `all` 固定の非 NULL 列として保存する。対象を省略すると、将来の取得元別操作が導入された際に「当時の全体操作」と区別できないためである。取得元別操作は今回の対象外であり、将来必要になった場合は既存 `0012` の CHECK を編集せず、新しい migration と型拡張で追加する。

結果は実行を依頼した HTTP 応答ではなく、制御機構が当該要求について確定させた結果を保存する。`result` は `success` / `failure` とし、処理が完了していない途中状態は B5 に記録しない。強制更新によって起動された個々の取得の成否は B3 が持つため、強制更新行の `success` は「要求どおりの更新処理を完了できた」ことを意味し、取得元すべての成功を暗黙に保証しない。

診断情報は `error_code`（機械処理用の非空文字列、NULL 可）と `error_message`（表示・調査用、NULL 可）に保存する。**確定事項として、`result='failure'` のときも両方 NULL を許容する。** 成功・失敗のどちらでも診断を得られない場合があるためである。B5 は診断の有無から結果を補正しない。

### 3.3 操作主体と認証境界

基本設計は操作主体を履歴項目として要求する一方、認証方式は AuthGate 連携作業側で定めるとしている。このため将来連携用に主体を `actor_id` と `actor_display_name` の nullable スナップショットとして保持し、外部の利用者表へ外部キーを張らない。

**確定事項:** B5 の時点では AuthGate 連携、主体識別子の発行、これら 2 列への値設定を実装しない。`recordOperationHistory` の入力では `actorId` / `actorDisplayName` をともに `null` として記録する。将来の AuthGate 連携側が主体の正規識別子・表示名を確定し、以後の操作記録に値を渡す。既存の NULL 行を更新しない。

### 3.4 独立性と保持

- `fetch_attempt`、`telegram_reception`、`notification_output_history`、将来の利用者表に外部キーを張らない。履歴は参照先の削除・変更後も当時の事実を残し、B6 が履歴種別ごとに明示削除できるようにする。
- 更新 API、UPSERT、自動削除、TTL、ローテーション、削除トリガーを設けない。単件削除は B6 の接続点としてだけ提供する。
- `error_message` は自由文であり、秘密情報や認証トークン、HTTP の認可ヘッダー等を保存してはならない。Epic E11 は利用者へ返してよい短い診断だけを渡す。

## 4. テーブル定義

### 4.1 migration

追加する migration は、#8 が `0011` を適用済みにした後の `apps/api/migrations/0012_create_operation_history.sql` 1 本とする。`0001`〜`0011` は編集しない。#8 の最終採番が変わる場合は §2.2 の規則で番号だけを更新し、番号の重複を解消してから製造する。

### 4.2 `operation_history`

```sql
CREATE TABLE operation_history (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE CHECK (request_id <> ''),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('start', 'stop', 'force_refresh')),
  target_kind TEXT NOT NULL CHECK (target_kind = 'all'),
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  requested_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  actor_id TEXT CHECK (actor_id IS NULL OR actor_id <> ''),
  actor_display_name TEXT CHECK (actor_display_name IS NULL OR actor_display_name <> ''),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> ''),
  error_message TEXT
);

CREATE INDEX idx_operation_history_completed
  ON operation_history (completed_at DESC, id DESC);
CREATE INDEX idx_operation_history_kind
  ON operation_history (operation_kind, completed_at DESC, id DESC);
CREATE INDEX idx_operation_history_result
  ON operation_history (result, completed_at DESC, id DESC);
```

`request_id` の UNIQUE は同一要求の二重記録防止だけに使う。異なる `request_id` の同種操作は、同時刻でも別行として保存できる。`target_kind` は将来拡張の余地を意図して表に残すが、B5 時点では `all` 以外を受け入れない。

`requested_at` は制御 API が要求を受理した UTC 時刻、`completed_at` は結果を確定した UTC 時刻である。いずれも SQLite の `CURRENT_TIMESTAMP` を既定値にせず、アプリケーション側から渡す。B5 は完了行だけを INSERT するため、両時刻は常に非 NULL である。

## 5. モジュール・型・API

### 5.1 追加・変更対象

```text
apps/api/
├── migrations/
│   └── 0012_create_operation_history.sql
├── src/repositories/
│   ├── types.ts                       # B5 の入力・返却・検索型
│   ├── operationHistoryRepository.ts  # INSERT / SELECT / DELETE
│   └── index.ts                       # リポジトリ export
└── tests/
    ├── schema.test.ts                  # migration 総数 11 → 12
    ├── historySchema.test.ts           # migration 総数 11 → 12
    ├── operationHistorySchema.test.ts
    └── operationHistoryRepository.test.ts

docs/design/
└── issue-6-table-definition.md         # 0012 の実 DDL を追記
```

製造は #8 の変更を取り込んだブランチで行うため、既存テストの期待値は `10 → 12` と一度に変えず、#8 完了後の `11 → 12` だけを変更する。`packages/shared`、`apps/web`、Express の route、既存 migration は変更しない。

### 5.2 DB 境界専用型

`apps/api/src/repositories/types.ts` に次を追加する。共有 API 型や AuthGate 型ではなく、SQLite 境界専用の型である。

```ts
import type { UtcIso8601String } from '@wx-viewer-poc/shared';

export type OperationKind = 'start' | 'stop' | 'force_refresh';
export type OperationTargetKind = 'all';
export type OperationResult = 'success' | 'failure';

export interface OperationHistoryInput {
  readonly requestId: string;
  readonly operationKind: OperationKind;
  readonly targetKind: OperationTargetKind;
  readonly result: OperationResult;
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String;
  // AuthGate 連携前は入力を NULL 固定とする。
  readonly actorId: null;
  readonly actorDisplayName: null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface OperationHistory extends Omit<OperationHistoryInput, 'actorId' | 'actorDisplayName'> {
  readonly id: number;
  // 将来の AuthGate 連携後に記録された履歴は非 NULL で返し得る。
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
}

export interface ListOperationHistoryOptions {
  readonly operationKind?: OperationKind;
  readonly result?: OperationResult;
  readonly actorId?: string;
  readonly requestedAtFrom?: UtcIso8601String;
  readonly requestedAtTo?: UtcIso8601String;
  readonly completedAtFrom?: UtcIso8601String;
  readonly completedAtTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number; // 既定 0
}
```

### 5.3 リポジトリ API

```ts
export function recordOperationHistory(
  connection: DatabaseConnection,
  input: OperationHistoryInput,
): OperationHistory;

export function findOperationHistoryById(
  connection: DatabaseConnection,
  id: number,
): OperationHistory | null;

export function findOperationHistoryByRequestId(
  connection: DatabaseConnection,
  requestId: string,
): OperationHistory | null;

export function listOperationHistory(
  connection: DatabaseConnection,
  options?: ListOperationHistoryOptions,
): readonly OperationHistory[];

export function countOperationHistory(
  connection: DatabaseConnection,
  options?: ListOperationHistoryOptions,
): number;

export function deleteOperationHistory(
  connection: DatabaseConnection,
  id: number,
): boolean;
```

契約は次のとおりとする。

- `recordOperationHistory` は INSERT のみ。同じ `requestId` は UNIQUE 違反とし、既存行を更新・上書きしない。
- 一覧は `ORDER BY completed_at DESC, id DESC`。`limit` 未指定は 100、1000 超は 1000 に丸める。`limit <= 0` または `offset < 0` は例外とする。
- 件数取得は一覧と同じ filter builder を使い、`limit` と `offset` は無視する。フィルターは完全一致、時刻範囲は境界を含む。
- INSERT 前に非空文字列、要求受理・結果確定の UTC ISO 8601 時刻、`requestedAt <= completedAt`、union 値、nullable 文字列の空文字禁止を検証する。時刻の前後関係は文字列比較ではなく、形式検証後の時刻値で比較する。`result` と診断列の有無を相互に補正・制約しない。DB から読み出した列挙値・時刻も検証し、不正な保存値を既定値へ丸めない。
- boolean／truthy-falsy の暗黙変換、SQL 値の文字列連結、モジュールスコープの接続保持をしない。

## 6. テスト設計

各テストは `mkdtemp` で作成した一時 DB に本番 migration を `initializeDatabase` で適用する。アサーションは原則完全一致とする。

### 6.1 スキーマテスト

`operationHistorySchema.test.ts` で次を検証する。

1. #8 完了後の本番 migration を適用すると、ファイル数・適用件数が 12 で一致し、`operation_history` が存在する。
2. `PRAGMA table_info(operation_history)` が §4.2 の 11 列を列名・型・NOT NULL 指定まで完全一致で返す。
3. `operation_kind` に `start` / `stop` / `force_refresh` を、`result` に `success` / `failure` を保存でき、列挙外は CHECK 違反になる。
4. `target_kind='all'` は保存でき、他値は CHECK 違反になる。
5. `request_id` の重複は UNIQUE 違反になり、異なる `request_id` の同種操作は 2 行保存できる。
6. `success` / `failure` のいずれも、`error_code` / `error_message` がともに NULL の行を保存できる。診断を保存する失敗行も保存でき、`error_code` の空文字だけは CHECK 違反になる。
7. 外部キーが 0 件であり、表を対象とする trigger がない。
8. migration を 2 回実行すると 2 回目の `appliedVersions` が空で、1 回目の行が完全一致で残る。

### 6.2 リポジトリテスト

`operationHistoryRepository.test.ts` で次を検証する。

1. `start` 成功、診断なしの `stop` 失敗、診断付きの `force_refresh` 失敗の 3 行を記録し、要求受理・結果確定時刻と ID を含めて完全一致で往復する。NULL の主体・診断列は空文字へ変換されない。
2. `findOperationHistoryById` と `findOperationHistoryByRequestId` が対象を返し、存在しない値は `null` を返す。
3. `operationKind` / `result` / `actorId` / 要求受理・結果確定の各時刻境界の単独・複合フィルターが正しく効き、`countOperationHistory` が limit 適用前の同条件件数を返す。
4. 同一 `completedAt` の 2 行が `id` 降順で返る。ページング、既定 100、上限 1000、`limit=0`・負値・負の offset の例外を検証する。
5. 空の `requestId`、不正な操作・結果・対象、非 ISO 8601 の要求受理・結果確定時刻、結果確定時刻より後の要求受理時刻、空文字の nullable 主体・エラーコードを渡すと、SQL 実行前に例外になる。`success` / `failure` の双方で診断列が NULL の入力は例外にならない。
6. 同じ `requestId` の再記録が失敗し、先行行が完全一致で残る。異なる `requestId` の同一操作は両方残る。
7. `deleteOperationHistory` が対象 1 行だけを削除し、存在しない ID は `false`、他の行は完全一致で残る。

### 6.3 テストの有効性確認

製造では AGENTS.md の規律に従い、実装前にテストを追加して red を確認する。意味を変えない対照変更でテストが通ることを確認した後、少なくとも次の変異で対応テストが失敗することを確認する。

- `operation_kind` または `target_kind` の CHECK を外す。
- `request_id` の UNIQUE を外す。
- `requested_at` または `completed_at` を INSERT／返却から外す。
- 一覧の `ORDER BY` から `id DESC` を外す。
- `result` または `actor_id` の filter 条件を外す。
- `recordOperationHistory` を UPSERT に変える。
- `limit` 上限丸めを外す。

変異は必ず元に戻し、一時 DB は作り直す。migration を差し替える変異では適用済みチェックサム不一致を避けるため、既存 DB を再利用しない。

## 7. 受け入れ条件

検収担当は #8 が main に反映済みであることを確認してから、次を実行する。

1. `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` がエラー 0 で終了する。
2. `npm run test -w apps/api` が全件成功する。
3. `apps/api/migrations/0012_create_operation_history.sql` が存在し、`0001`〜`0011` に差分がない。#8 の最終番号が異なる場合は、重複のない次番号の migration が 1 本だけ存在することを確認する。
4. `grep -iE '^\\s*(begin|commit|rollback)' apps/api/migrations/*.sql` が 0 件である。
5. 一時 DB に本番 migration を適用すると `__schema_migrations` が 12 行で、`operation_history` が存在する。2 回目の適用は新規 0 件である。
6. `PRAGMA table_info(operation_history);` が §4.2 の 11 列を列名一致で返す。
7. 操作種別 3 値、結果 2 値、対象 `all` のみを保存でき、各列挙外の値は CHECK 違反になる。
8. 同じ `request_id` は 2 行保存できず、異なる `request_id` は同一操作でも別行として残る。
9. `success` / `failure` のいずれでも診断列がともに NULL の行を保存できる。診断付きの失敗行も保存でき、`error_code=''` は CHECK 違反になる。
10. `PRAGMA foreign_key_list(operation_history);` が 0 件で、`sqlite_master` に本表の trigger がない。
11. 一覧が `completed_at DESC, id DESC`、既定 100、上限 1000、完全一致フィルター、要求受理・結果確定の各境界を含む時刻フィルターで動作し、件数取得が同一条件の全件数を返す。
12. 単件削除以外の削除 API・自動削除・TTL・ローテーションが追加されていない。
13. `docs/design/issue-6-table-definition.md` の `0012` と表・全列・制約・索引が実 DDL と完全一致する。
14. `git status --porcelain` に、設計書、migration、リポジトリ型・実装・export、既存テストの migration 件数更新、B5 テスト、テーブル定義書以外の変更がない。`apps/web` と `packages/shared` に差分がない。

## 8. 後続 Issue への引き継ぎ

- **Epic E11** は、要求識別子の発行・重複防止・同時実行集約・開始／停止／強制更新のライフサイクルを担当する。受理時刻を要求とともに保持し、結果確定時に `requestedAt` と `completedAt` を揃えて `recordOperationHistory` に 1 回渡す。B5 の未完了行を UPDATE する方式は使わない。タイムアウト時には同じ `requestId` を照会し、新規行を無条件に追加しない。
- **Epic E10** は、一覧・詳細 API で本リポジトリのページングを必須にし、無制限取得を作らない。認可を必要とする操作・履歴閲覧の境界は AuthGate の方針に従う。
- **AuthGate 連携**は、主体の正規識別子・表示名の扱いを確定し、その時点以後の `actorId` / `actorDisplayName` に値を渡す。B5 時点の NULL 行を後追い更新しない。秘密情報を `actorDisplayName`／`errorMessage` に流さない。
- **B6** は `operation_history` を明示削除対象に含める。一括・期間削除・削除権限を追加する場合も、自動削除や TTL に読み替えず、適用済み `0012` を編集しない。
- **Epic C／B3** は、強制更新で発生した各取得試行を `fetch_attempt` に記録する。B5 の成功／失敗だけから取得元別の詳細成否を導出しない。

## 9. 未確認事項

現時点で B5 の製造を止める未確認事項はない。失敗時の診断列はいずれも NULL 可とし、要求受理時刻と結果確定時刻をともに保存することは確定済みである。
