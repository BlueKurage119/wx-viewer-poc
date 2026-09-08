# Issue #5「B1. SQLite導入とディスク永続化基盤」設計

作成日: 2026-09-09

## 1. 目的

API サーバーに SQLite のファイルデータベースと forward-only の SQL マイグレーション基盤を導入し、後続 Issue が履歴・前回正常値をプロセス再起動後も保持できる保存先を提供する。HTTP 待受を開始する前にデータベースを開いて未適用マイグレーションを完了させ、初期化に失敗したプロセスを正常稼働として公開しない。

本 Issue は保存基盤だけを扱う。情報種別ごとの業務テーブル、受信履歴・通知出力履歴・操作記録のテーブル、リポジトリ層、業務 API、外部 DB への切り替え抽象化は実装しない。

## 2. 参照資料と確定事項

- [Issue #5](https://github.com/BlueKurage119/wx-viewer-poc/issues/5)
- [基本設計](../basic-design.md) §6.1、§6.4、§8.1、§9.2
- [Issue 化ドラフト](../issues-draft.md) B1〜B6
- [Issue #1 設計](issue-1-project-initialization.md) §3.2、§3.5、§3.6
- [`better-sqlite3` 公式パッケージ情報](https://www.npmjs.com/package/better-sqlite3)
- [`better-sqlite3` 公式 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [`better-sqlite3` 公式ビルド設定](https://github.com/WiseLibs/better-sqlite3/blob/master/.github/workflows/build.yml)
- [`@types/better-sqlite3` 型定義](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/better-sqlite3/index.d.ts)

ヒアリングで、次を確定した。

- SQLite ドライバーには `better-sqlite3` を使用する。
- ORM は導入せず、生 SQL を使用する。
- SQL マイグレーションファイルをリポジトリで管理し、自作ランナーで適用する。

基本設計から、次を確定事項として引き継ぐ。

- ローカル検証の保存先は、外部 DB サービスではなく組み込み DB のディスクファイルとする。
- 履歴・前回正常値をクラッシュ・再起動で失わない。
- 履歴の自動削除・自動ローテーションは行わない。ただし、具体的な履歴テーブルは後続の B2〜B5 で扱う。
- 将来の Firebase 等への置き換えは構想に留まり、本 Issue で互換層や同期機構を設けない。

## 3. 採用技術と判断根拠

### 3.1 依存パッケージ

API workspace に次を追加する。

| 区分 | パッケージ | 設計時点の版 | 用途 |
| --- | --- | --- | --- |
| runtime dependency | `better-sqlite3` | `^13.0.3` | SQLite ファイルの同期的な接続・SQL 実行・トランザクション |
| dev dependency | `@types/better-sqlite3` | `^9.6.0` | TypeScript 型定義 |

`package-lock.json`を更新して実際に解決した版とネイティブバイナリの再現性を確保する。`better-sqlite3` 13.0.3 の `engines` は Node.js 22 以上で、公式ビルド設定は Node.js 24 を対象に含むため、本リポジトリの Node.js `>=24 <25` と整合する。ネイティブアドオンであるため、製造時には Node.js 24 環境でインストール、ロード、テストを実行し、型検査だけで互換性確認を済ませない。

`better-sqlite3` の実装は CommonJS の既定 export、DefinitelyTyped の宣言は `export =` である。現行 API workspace は ES Modules、`moduleResolution: NodeNext`、`esModuleInterop: true` なので、値は既定 import、接続型は名前空間内の型を使う。

```ts
import BetterSqlite3 from 'better-sqlite3';

export type DatabaseConnection = BetterSqlite3.Database;
```

この型は API workspace 内部だけで使用し、`packages/shared` や HTTP 契約へ公開しない。

### 3.2 同期 API の利用境界

マイグレーションと本 PoC の小規模なローカル読み書きは、API プロセス内で同期実行する。起動時初期化の順序が明確になり、SQL トランザクションを直接扱えるためである。後続 Issue でも個別 SQL をルートハンドラーへ散在させず、リポジトリ層を介して接続を使用する。

大量行を走査する処理、長時間トランザクション、CPU 負荷の高いユーザー定義関数は本 Issue の基盤へ追加しない。実測でイベントループへの影響が問題になった場合に worker thread 等を別 Issue で検討する。

## 4. モジュール・ファイル構成

製造では次の構成にする。

```text
apps/api/
├── data/                              # 実行時生成。Git 管理外
│   └── wx-viewer.sqlite3              # 既定の主 DB ファイル
├── migrations/                        # 本番用 SQL。B2 以降が順次追加
│   └── .gitkeep
├── src/
│   ├── database/
│   │   ├── config.ts                  # DB・migration パス解決
│   │   ├── connection.ts              # 接続の生成と接続単位 PRAGMA
│   │   ├── migrations.ts              # 検出・整合性検証・適用
│   │   └── index.ts                   # 初期化 API と内部型の export
│   └── server.ts                      # DB 初期化後に HTTP 待受開始
└── tests/
    ├── database.test.ts               # 接続・永続化・migration 統合テスト
    └── fixtures/migrations/
        ├── 0001_create_probe.sql
        └── 0002_insert_probe.sql
```

加えて次を更新する。

- `apps/api/package.json`: 依存、`test` スクリプトを追加する。
- `package-lock.json`: 依存解決結果を更新する。
- `.gitignore`: `apps/api/data/` を追加し、DB 本体と SQLite の一時・付随ファイルをコミット対象外にする。
- `README.md`: 既定 DB パス、`WX_VIEWER_DB_PATH`、起動時マイグレーションを記載する。

本番用 `migrations/` は B1 の時点では空とする。ランナー自身が管理テーブルを初期化し、実際の SQL 適用能力はテスト fixture で検証する。業務上の意味を持たない確認専用テーブルを本番 DB に残さず、B2 が最初の業務 migration を `0001_*.sql` として追加できるようにする。

## 5. 設定とパス解決

### 5.1 データベースパス

環境変数は次の一つだけを追加する。

| 環境変数 | 未指定時 | 規則 |
| --- | --- | --- |
| `WX_VIEWER_DB_PATH` | `apps/api/data/wx-viewer.sqlite3` | 絶対パスはそのまま、相対パスは API workspace ルート基準で解決 |

API workspace ルートは `config.ts` の `import.meta.url` から求める。`src/database/config.ts` を `tsx` で動かす場合と `dist/database/config.js` を Node.js で動かす場合のどちらも、モジュール位置から二階層上が `apps/api` になる。このため、プロセスのカレントディレクトリによって既定保存先が変わらない。

環境変数が空文字または NUL 文字を含む場合は設定エラーにする。接続前に親ディレクトリを再帰作成する。DB ファイルそのものは `better-sqlite3` の通常接続で未存在時に作成する。

### 5.2 マイグレーションパス

本番用 migration ディレクトリは `apps/api/migrations` に固定し、環境変数では差し替えない。起動環境から任意 SQL の置き場所を注入させず、実行される SQL とリポジトリの版を一致させるためである。

テストでは `runMigrations` の引数として絶対パスの fixture または一時ディレクトリを渡す。本番パスとテストパスの切り替えをグローバル状態で行わない。

## 6. 接続・初期化 API

`apps/api/src/database` 内部では次の契約を使用する。

```ts
export interface DatabaseConfig {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
}

export interface MigrationSummary {
  readonly appliedVersions: readonly number[];
}

export interface DatabaseContext {
  readonly connection: DatabaseConnection;
  readonly migrationSummary: MigrationSummary;
  close(): void;
}

export function resolveDatabaseConfig(
  env?: NodeJS.ProcessEnv,
): DatabaseConfig;

export function openDatabase(databasePath: string): DatabaseConnection;

export function runMigrations(
  connection: DatabaseConnection,
  migrationsDirectory: string,
): MigrationSummary;

export function initializeDatabase(
  config?: DatabaseConfig,
): DatabaseContext;
```

`initializeDatabase` は、設定解決済みパスの親ディレクトリ作成、接続、接続設定、migration 適用を順に行う。migration が失敗した場合は接続を閉じて同じ例外を送出し、半端に開いた接続を返さない。`close()` は複数回呼ばれても安全な冪等操作にする。

接続直後、すべての接続で `PRAGMA foreign_keys = ON` を設定し、値を読み戻して有効化を完全一致で確認する。SQLite の外部キー制約は接続単位の設定であり、後続の各テーブルが同じ前提を共有できるよう基盤で設定する。

ジャーナルモード、同期レベル、キャッシュサイズは B1 では変更せず SQLite／`better-sqlite3` の既定値を使用する。WAL 等は性能・同時実行要件と、主 DB 以外の付随ファイルを含む運用を実測してから別途決める。B1 の受け入れ条件にない性能値を推定で固定しない。

## 7. SQL マイグレーション契約

### 7.1 ファイル規則

本番 migration は UTF-8 の `.sql` ファイルとし、名前を次に限定する。

```text
NNNN_<name>.sql
```

- `NNNN` は `0001` から始まる重複しない4桁の正整数であり、適用順を表す。
- `<name>` は小文字英数字とアンダースコアだけを使用する。
- 例: `0001_create_weather_current.sql`
- 空の SQL はエラーにする。
- migration ファイル内へ `BEGIN`、`COMMIT`、`ROLLBACK` を記述しない。トランザクション境界はランナーだけが管理する。
- 適用済みファイルは編集・改名・削除しない。修正は新しい番号の migration として追加する。
- down migration と自動 rollback は提供しない。履歴を保持する要件に合わせ、ロールバックが必要な変更も新しい forward migration で行う。

ディレクトリ内の `.sql` 以外は無視する。不正な名前の `.sql`、番号重複、適用済み最大番号以下へ後挿しされた未適用 migration は、順序の曖昧さとして起動エラーにする。

### 7.2 管理テーブル

ランナーは業務 migration の前に、内部管理用テーブルを冪等に作成する。

```sql
CREATE TABLE IF NOT EXISTS __schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

各列の意味は次のとおり。

| 列 | 内容 |
| --- | --- |
| `version` | ファイル名先頭の4桁を整数化した値 |
| `name` | 拡張子を除く完全なファイル名 |
| `checksum` | ファイルの生バイト列に対する小文字16進 SHA-256 |
| `applied_at` | 適用完了時点の UTC ISO 8601 文字列 |

管理テーブルはマイグレーション機構そのもののメタデータであり、B2 の業務スキーマには含めない。

### 7.3 検出・適用手順

`runMigrations` は次の順に同期実行する。

1. migration ディレクトリを読み、規則に合う SQL を番号昇順に確定する。
2. `__schema_migrations` を作成し、適用済み行を `version` 昇順で取得する。
3. 適用済み各行について、対応ファイルの存在、名前、SHA-256 が完全一致することを確認する。欠落・改名・編集があれば処理を停止する。
4. 未適用 migration が既存の最大適用番号より大きいことを確認する。
5. 未適用ファイルごとに `IMMEDIATE` トランザクションを開始し、SQL 全文の実行と管理テーブルへの1行追加を同一トランザクションで行う。
6. 全件成功後、その起動で新たに適用した version の昇順配列を返す。未適用がなければ空配列を返す。

一つの migration が失敗した場合、そのファイル内の変更と管理行だけをロールバックし、後続ファイルは実行しない。先に正常完了した別 migration は適用済みのままとする。再起動時は未適用分から再開できる。

値を伴う SQL は後続のリポジトリ実装で prepared statement と bind parameter を使う。migration はリポジトリ内の信頼済み DDL/DML 全文を実行する用途に限定する。

## 8. サーバー起動・終了時のライフサイクル

`server.ts` の起動順序を次に変更する。

```text
環境変数の検証
  → DB 親ディレクトリ作成
  → SQLite 接続
  → 接続設定確認
  → migration 整合性確認・適用
  → Express の HTTP 待受開始
```

- DB 接続または migration に失敗した場合、エラーを標準エラーへ出力して終了コードを非0にし、HTTP ポートを開かない。
- HTTP 待受開始後に `SIGINT` または `SIGTERM` を受けた場合、新規 HTTP 接続の受付を止め、HTTP サーバーの close 完了後に DB 接続を閉じる。
- HTTP サーバーの listen に失敗した場合も、既に開いた DB 接続を閉じる。
- 終了処理は重複シグナルや複数経路から呼ばれても DB を二重 close しない。
- `/api/health` のレスポンス形式は変更しない。DB 初期化完了前は HTTP 待受自体を開始しないため、既存の `{ "status": "ok" }` は永続化基盤の起動が完了したプロセスだけから返る。

起動ログには DB ファイルの解決済みパスと、新規適用した migration 件数を出す。SQL 本文や将来保存する気象データはログへ出さない。

## 9. テスト設計

API workspace に次を追加する。

```json
{
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  }
}
```

各テストは `node:fs/promises` の `mkdtemp` で専用ディレクトリを作り、`after`／`afterEach` で削除する。他テストや開発用 DB を共有しない。アサーションは原則として完全一致を使う。

### 9.1 接続と永続化

1. 存在しない親ディレクトリ配下を指定して初期化すると、親ディレクトリと SQLite ファイルが作成される。
2. `PRAGMA foreign_keys` が数値 `1` である。
3. fixture migration で作成したテーブルへ行を追加して接続を閉じ、同じファイルを再度初期化すると、その行を完全一致で取得できる。
4. 二度目の初期化では適用済み migration を再実行せず、`appliedVersions` が空配列、管理テーブルの行数が不変である。

### 9.2 migration の順序・整合性・原子性

1. fixture の `0001`、`0002` が番号順に適用され、管理テーブルの version、name、checksum、件数が期待値と一致する。
2. 同じ番号のファイル、不正名の SQL、空 SQL をそれぞれ拒否する。
3. 適用後の SQL 本文変更、改名、削除をそれぞれ検知して拒否する。
4. 適用済み最大番号以下に追加された未適用 migration を拒否する。
5. 途中で不正 SQL を実行した migration は、そのファイルで先に行った DDL/DML と管理行を残さず、後続 migration も実行しない。

### 9.3 起動順序と失敗時動作

1. 一時 DB を指定して API サーバーを空きポートで起動し、DB ファイルと管理テーブルが存在した後に `/api/health` が既存レスポンスを返す。
2. 不正 migration を指定したテスト用起動では listen 前に失敗し、ポートを開かず、DB 接続を閉じる。
3. 正常終了処理後に同じ DB ファイルを再度開ける。

起動順序をポート競合や別プロセスへ依存せず検証できるよう、`server.ts` の初期化処理はテストから呼べる関数へ分離する。ただし本番エントリーポイント以外からサーバーを暗黙起動する副作用は持たせない。

### 9.4 テストの有効性確認

新しいテストは次の順で有効性を確認する。

1. 実装前に追加し、対象 API／モジュールが未実装で失敗すること（red）を確認する。
2. 実装後、空白やローカル名だけの意味を変えない変更を加えてテストが成功し続ける対照実験を行う。
3. migration の適用順を逆転する、チェックサム比較を無効化する、接続を閉じる処理を外す等の対象変異を一つずつ加え、対応テストが失敗することを確認する。
4. 変異を元に戻し、対象テストが再度成功することを確認する。

一時変更はコミットせず、検証後に完全に戻す。

## 10. 受け入れ条件

1. Node.js 24 で `better-sqlite3` のネイティブアドオンをインストール・ロードできる。
2. `npm run dev` およびビルド後の `npm run start -w apps/api` のどちらでも、HTTP 待受より前に既定 DB ファイルが `apps/api/data/wx-viewer.sqlite3` へ作成・接続される。
3. `WX_VIEWER_DB_PATH` で保存先を変更でき、相対指定でも実行時のカレントディレクトリに左右されない。
4. 接続ごとに外部キー制約が有効である。
5. 規則に従う未適用 SQL migration が番号順・migration 単位のトランザクションで一度だけ適用される。
6. 適用済み migration の編集・改名・削除、番号重複、過去番号への後挿しを検出すると、HTTP 待受前に異常終了する。
7. DB を閉じて同じファイルで API を再初期化した後も、テストで保存した行と migration 履歴が完全一致で残る。
8. migration 失敗時、その migration の変更と管理行が残らず、後続 migration が実行されない。
9. `apps/api/data/` 配下の DB・付随ファイルが Git の追跡対象にならない。
10. `/api/health` の既存レスポンス契約を維持する。
11. `npm run test -w apps/api`、`npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` が成功する。

## 11. 後続 Issue への引き継ぎ

- B2 は `apps/api/migrations/0001_*.sql` から情報種別ごとの業務スキーマを追加する。テーブル名・列・索引・正規化方式は B2 の設計で確定し、B1 では先取りしない。
- B3〜B5 は同じ migration 番号列に受信履歴、通知出力履歴、操作記録を追加する。適用済みファイルは編集せず、新しい migration を追加する。
- B6 は業務テーブルに自動削除処理がないことを検証する。`__schema_migrations` は業務履歴ではなく、削除 API の対象にしない。
- Epic C は取得成功時の正規化データと前回正常値を、同じ `DatabaseConnection` を受け取るリポジトリ層から保存する。`availability` の `stale` では保存済み正常値を消さない。
- Epic D/E は DB ドライバー型を HTTP／shared 型へ露出させず、リポジトリの入出力型へ変換する。
- 将来、複数 API プロセス、長時間クエリ、高書込並行性が必要になった場合は、journal mode、busy timeout、worker thread、外部 DB 移行を実測に基づく別 Issue として扱う。

## 12. 未確認事項

なし。業務テーブルの具体設計、索引、保持データ量、性能設定、外部 DB への置き換え方式は本 Issue の範囲外であり、後続 Issue で実データと運用要件を確認して決定する。
