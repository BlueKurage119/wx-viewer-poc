# Issue #10「B6. 履歴の『明示削除まで保持』ポリシーの実装（自動削除なし）」設計

作成日: 2026-09-09

## 1. 目的と範囲

基本設計 §8.1 で【確定】している「受信履歴・通知出力履歴・操作記録を、自動削除・自動ローテーションせず、明示的に削除するまで保持する」を、実行可能な回帰テストで保証する。

対象は B3 の受信履歴（`fetch_attempt`、`telegram_reception` とその対象地域明細）、B4 の通知出力履歴（`notification_output_history`）、B5 の操作記録（`operation_history`）である。各履歴を過去時刻で保存し、将来時刻をシミュレートした API サーバー再起動後にも、全行と保存内容が完全一致で残ることを検証する。あわせて、これらの表に自動削除・自動更新を行う SQLite trigger がないことを横断的に確認する。

本 Issue は**保持ポリシーの検証だけ**を扱い、プロダクトの削除機能は追加しない。ヒアリングで、DB 全体の初期化は API 停止後に SQLite ファイルを削除する運用と確定した。このファイル削除は、稼働中のアプリケーションが時間・周期・容量を契機に履歴を削除する処理ではなく、停止済み環境に対する運用上の明示操作である。本 Issue の自動削除なしの対象外とする。

次は対象外とする。

- 手動の単件・一括・期間削除 API、UI、削除対象の選択、確認ダイアログ
- 削除権限・AuthGate 連携・監査方法
- API 停止後に SQLite ファイル全体を削除して DB を初期化する運用手順・その UI／コマンド化
- 取得ジョブ、取得周期、ローテーション、容量上限、TTL、アーカイブ、圧縮
- B2 の現在値スナップショットおよびタイル本体の削除方針
- 訓練データの抹消要求（基本設計 §3.4 のパイプライン）

したがって migration、リポジトリ公開 API、Express route、`packages/shared`、`apps/web` は変更しない。既存の `deleteFetchAttempt`、`deleteTelegramReception`、`deleteNotificationOutputHistory`、`deleteOperationHistory` は明示的な単件削除の接続点として残るが、本 Issue のテストから呼び出さない。

## 2. 参照資料と前提

### 2.1 参照資料

- [Issue #10](https://github.com/BlueKurage119/wx-viewer-poc/issues/10) — B6 の対象、すなわち受信・通知出力・操作履歴に自動削除・自動ローテーションを実装しないこと、および期間経過のシミュレーション検証
- [基本設計](../basic-design.md) §8.1、§9.4 — 履歴の保持方針と受入条件
- [Issue 化ドラフト](../issues-draft.md) B6 — 定期クリーンアップ処理を設けないことを保証するテスト
- [Issue #7 設計](issue-7-reception-history.md) §6.1-10、§12 — B3 の trigger 不在、単件削除だけを提供すること、B6 への接続点
- [Issue #8 設計](issue-8-notification-output-history.md) §3.1、§6 — B4 の追記ログ性と自動削除・TTL・ローテーションを設けない契約
- [Issue #9 設計](issue-9-operation-history.md) §3.4、§6、§8 — B5 の追記ログ性と B6 の範囲
- 実装済みの `apps/api/migrations/0009`〜`0012`、`apps/api/src/database/`、`apps/api/src/server.ts`、`apps/api/src/repositories/`、`apps/api/tests/*History*.test.ts`

### 2.2 実装から確認した前提

- B3 は `fetch_attempt` と `telegram_reception` の 2 表で受信の事実を保存する。`telegram_reception_area` は後者に従属し、親行を**明示削除した場合だけ**外部キーの `ON DELETE CASCADE` により削除される。この cascade は時間経過による削除ではない。
- B4 は `notification_output_history`、B5 は `operation_history` をそれぞれ追記ログとして持つ。現在のリポジトリ層には更新・UPSERT・一括削除・期間削除がない。
- B3、B4、B5 の各スキーマテストには trigger 不在の個別検証があるが、3 種履歴を同一 DB・同一再起動経路で保存し、期間経過後の残存を確認するテストはない。
- `startServer` は `initializeDatabase` を通じて本番 migration を適用してから Express を起動し、停止時に DB 接続を閉じる。現時点でサーバー起動時の履歴削除処理はない。この起動経路を通すことで、将来起動フックへクリーンアップが追加された場合も検出対象にする。
- API workspace の Node.js は `>=24 <25` であり、`node:test` のテストコンテキストが持つ mock timer による `Date` の固定を利用できる。

## 3. 設計判断

### 3.1 保持対象と判定単位

保持確認の単位は「表が存在する」ことではなく、各履歴種別の実データが保存値のまま残ることである。単一の一時 SQLite DB に次の 4 行を作り、ID を含むリポジトリ返却値を基準値として保持する。

| 履歴種別 | 保存関数 | 残存確認 |
| --- | --- | --- |
| 受信試行履歴 | `recordFetchAttempt` | `findFetchAttemptById` の完全一致 |
| 電文受信履歴 | `recordTelegramReception` | `findTelegramReceptionById` の完全一致（対象地域明細を含む） |
| 通知出力履歴 | `recordNotificationOutputHistory` | `findNotificationOutputHistoryById` の完全一致 |
| 操作記録 | `recordOperationHistory` | `findOperationHistoryById` の完全一致 |

受信履歴が B3 の 2 表からなるため、`fetch_attempt` と `telegram_reception` の双方を必須にする。通知・操作を含めた 4 行の少なくとも 1 行だけが残る、件数だけが一致する、または値を部分一致で比較する検証にはしない。これにより、種別選別、期間フィルター、内容の後追い更新のいずれも検出できる。

### 3.2 期間経過のシミュレーションと再起動境界

保存する時刻はすべて `2000-01-01T00:00:00Z` 近辺の有効な UTC ISO 8601 文字列とする。保存後に最初の `DatabaseContext` を閉じ、テストコンテキストの mock timer で `Date` を `2099-01-01T00:00:00Z` に固定してから、同じ DB パス・migration ディレクトリを `config` として指定して `startServer({ config, port: 0 })` を起動する。

起動に成功したことと `/api/health` が `200` / `{ status: 'ok' }` を返すことを確認してサーバーを停止する。その後、mock timer を復元し、同じ DB を `initializeDatabase` で開いて §3.1 の 4 行を完全一致で取得する。

この境界を採る理由は次のとおり。

- テストの実行日や DB ファイルの更新時刻に依存せず、99 年の経過を決定的に再現できる。
- migration 適用、アプリケーション起動、正常停止を通すため、起動時・定期初期化時に年齢ベースの cleanup を導入した場合に失敗する。
- 期間経過を表すために実時間待機、OS の時刻変更、外部サービスを使わない。テストは短時間かつ並列実行で安全に完結する。

mock timer は、保存と後続の DB 読み出しに影響を残さないよう、将来時刻でのサーバー停止後に必ず復元する。`try` / `finally` でサーバーの `close()`、DB context の `close()`、一時ディレクトリの削除、timer の復元を独立して保証する。

### 3.3 自動削除・自動ローテーションの DB 境界

同じテストで、次の SQL を bind parameter 付きで実行し、空配列を完全一致で確認する。

```sql
SELECT tbl_name, name
FROM sqlite_master
WHERE type = 'trigger'
  AND tbl_name IN (?, ?, ?, ?)
ORDER BY tbl_name, name;
```

引数は `fetch_attempt`、`telegram_reception`、`notification_output_history`、`operation_history` とする。`telegram_reception_area` は親の明示削除に追従する明細表であり、個別の `ON DELETE CASCADE` は SQLite の外部キー機構で実装されている。履歴親表を削除する trigger ではないため、この保持対象一覧へ含めない。

この検証は、B3〜B5 の既存スキーマテストと一部重なるが、Issue #10 が対象とする 3 種の履歴を 1 箇所で明示し、期間経過・再起動検証と同じ保護網にするために維持する。`__schema_migrations` は業務履歴ではないため対象外とする。

### 3.4 明示削除との境界

本ポリシーは「削除不能」ではなく「時間や周期を契機に自動削除しない」である。既存の単件 `delete*` 関数は、呼び出されない限り行を変更しない明示操作であり、Issue #10 の不変条件に反しない。

ヒアリングで確定した DB 全体初期化は、**API を停止して SQLite ファイルを削除する**運用で行う。アプリ内の手動削除機能は作成しない。この停止済み DB ファイルへの明示操作は、稼働中に履歴を時間・周期・容量で削除する自動 cleanup と異なるため、本テストの対象外である。運用手順・削除コマンド・UI は本 Issue で実装しない。

したがって本 Issue では既存の単件 `delete*` 関数を新設・拡張・HTTP 公開しない。将来それらを追加する場合も、年齢・行数・ファイルサイズ・周期だけで削除対象を自動選択する実装へ読み替えてはならない。

## 4. モジュール・型・API

### 4.1 追加・変更対象

```text
apps/api/
└── tests/
    └── retentionPolicy.test.ts  # B3〜B5 横断の期間経過・再起動・trigger 不在テスト
```

テストは既存の `tests/*.test.ts` glob に自動的に含まれる。`package.json` の script 変更は不要である。

### 4.2 利用する既存 API

本 Issue で新しい型・実行時モジュール・リポジトリ API は追加しない。テストは `apps/api/src/database/index.ts`、`apps/api/src/server.ts`、`apps/api/src/repositories/index.ts` から、既存の次を型付きで import する。

```ts
// database/index.ts
initializeDatabase

// server.ts
startServer

// repositories/index.ts
recordFetchAttempt
findFetchAttemptById
recordTelegramReception
findTelegramReceptionById
recordNotificationOutputHistory
findNotificationOutputHistoryById
recordOperationHistory
findOperationHistoryById
```

入力は各リポジトリの `*Input` 型を満たす固定 fixture とする。`fetch_attempt` と `telegram_reception` を関連付ける必要はないため、`fetchAttemptId: null` の電文受信履歴を保存してよい。保持試験の目的は削除契機の不存在であり、取得パイプラインの因果関係を再現することではない。

テスト専用ヘルパーは `retentionPolicy.test.ts` 内に閉じる。

- `createTempDbPath()` — `mkdtempSync` を使う一意な DB パスと `cleanup()`
- `recordHistoricalRows(connection)` — 過去時刻の 4 行を保存し、完全一致の期待値を返す
- `assertNoHistoryTriggers(connection)` — §3.3 の trigger 問合せを実行する

共有型・プロダクト側の retention service・削除 API・migration を作らない。テストがテスト対象を新しい実装へ移してしまうことを避けるためである。

## 5. テスト設計

新規 `apps/api/tests/retentionPolicy.test.ts` に、少なくとも次の 2 テストを置く。各テストは本番 migration ディレクトリを使う一時 DB を生成し、終了時に確実に破棄する。

1. **履歴表に自動削除・自動ローテーション用 trigger がない**
   - `initializeDatabase` 後、§3.3 の `sqlite_master` 問合せが `[]` と完全一致することを確認する。
   - `fetch_attempt`、`telegram_reception`、`notification_output_history`、`operation_history` の 4 表を対象にする。
   - 任意の他表や `__schema_migrations` の trigger 有無を理由に失敗させない。B6 の対象を限定する。

2. **99 年経過と API サーバー再起動の後も B3〜B5 の履歴が完全に残る**
   - 実時計算ではなく、`2000-01-01` 近辺を持つ B3〜B5 の fixture 4 行を保存する。
   - 保存直後に全 4 行を ID で取得して期待値を確定し、DB context を閉じる。
   - mock timer の `Date` を `2099-01-01T00:00:00Z` に固定する。同じ DB を渡して API サーバーを ephemeral port で起動し、health endpoint の正常応答を確認後、停止する。
   - timer を復元してから DB を開き直し、4 個の `find*ById` の返却値が保存直後の期待値とそれぞれ `deepStrictEqual` で一致することを確認する。`count` だけの検証にしない。
   - 途中で例外が起きても server、DB context、timer、一時ディレクトリを順に片付ける。mock timer を他テストへ漏らさない。

### 5.1 red の確認

製造担当は新テストを追加した直後、次の意図的な変更でテストが失敗することを確認してから戻す。

- `retentionPolicy.test.ts` の残存確認直前に、テスト DB へ `DELETE FROM operation_history` を 1 回だけ実行する。
- 対象テストが `findOperationHistoryById(...)` の完全一致失敗として落ちることを確認する。
- このテスト専用の削除文を完全に元へ戻し、テストが通ることを確認する。

意味を変えない対照として、fixture の表示用 `summary` など保持検証に使わない文字列を別の非空文字列へ変えても、残存・trigger 判定が失敗しないことを確認してから、上記の削除による red を確認する。対照確認・意図的破壊は完成コードに残さない。

## 6. 受入条件

1. `apps/api/tests/retentionPolicy.test.ts` が追加され、API workspace の既存 `test` glob で実行される。
2. 新規テストは本番 migration `0001`〜`0012` を一時 DB に適用し、B3 の `fetch_attempt` と `telegram_reception`、B4 の `notification_output_history`、B5 の `operation_history` を対象にする。
3. `sqlite_master` の対象 4 表の trigger 問合せが空配列であることを検証する。自動削除・自動更新 trigger を追加すると失敗する。
4. 4 件の過去時刻履歴を保存した後、`Date=2099-01-01T00:00:00Z` をシミュレートして同一 DB で API サーバーを起動・正常停止しても、ID を含む各返却オブジェクトが保存直後の値と完全一致する。
5. テストは実時間の待機、OS 時刻変更、ネットワーク、既定の開発 DB を使用しない。失敗時にも mock timer、一時 DB、HTTP server の後始末が行われる。
6. migration、DDL、リポジトリ実装・型・export、Express route、`apps/web`、`packages/shared` に差分がない。削除 API、一括・期間削除、TTL、ローテーション、権限は追加されない。
7. 製造時に、新テストを意図的な `operation_history` 削除で一度失敗させ（red）、元へ戻した後に成功させる。対照実験の結果を作業報告へ記録する。
8. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` がすべて成功する。

## 7. 後続 Issue への引き継ぎ

- **Epic C / C13 / C14**: 取得周期・再試行・復旧処理を追加しても、受信履歴を年齢、件数、ファイルサイズ、周期で削除しない。本 Issue の再起動・将来時刻テストを通すこと。取得用の timer は許容されるが、そこから履歴削除を呼ばない。
- **Epic D / E**: 通知生成・監視 API・履歴一覧を実装しても、一覧の表示件数・ページング・表示期間を DB 削除へ結び付けない。画面から古い行を表示しないことと、保存済みの行を削除することは別の責務である。
- **訓練機能（基本設計 §3.4）**: 訓練データの抹消は明示要求を通常パイプラインへ投入する例外である。本 Issue の「通常履歴を時間で消さない」テストを、訓練抹消の直接削除試験に流用しない。
- **将来の手動削除機能**: 対象範囲、期間指定、確認、権限、監査を別 Issue で確定する。その機能は利用者または権限を持つ呼び出し元の明示要求だけで削除し、TTL・cron・起動時 cleanup・容量閾値による自動実行を導入しない。
- **DB 全体初期化の運用**: DB を初期化する必要がある場合は API を停止した後に SQLite ファイルを削除する。本 Issue ではアプリ内の削除 UI・API・コマンドを作らず、稼働中の自動 cleanup として実装しない。将来この運用を自動化する必要が生じても、基本設計 §8.1 の保持方針を変更するため、別途統括判断を要する。
- **容量検討**: B3 設計で引き継いだ大きな原文電文の累積量は、実際の取得頻度を確認する Epic C の統括判断事項である。容量懸念は本保持ポリシーを無断で変更する根拠にしない。保存対象の絞り込み・圧縮・運用上の明示削除を検討する場合は別途合意する。

## 8. 未確認事項

本 Issue の対象である「自動削除なし」と期間経過シミュレーションについて、未確認事項はない。

ただし、アプリ内の手動削除 UI・API・対象選択・期間指定・権限・監査ログは本工程の対象外であり、仕様未定義のままである。DB 全体初期化は「API 停止後の SQLite ファイル削除」という運用だけが確定している。本設計ではいずれも実装しないため、製造・検収の阻害要因ではない。将来変更が必要になった時点で、統括担当が別 Issue として要件を確認すること。
