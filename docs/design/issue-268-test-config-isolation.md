# Issue #268 テストを実設定ファイル(ローカル設定・会場構成)から独立させる 設計書

## 1. 目的と範囲

`apps/api` のテスト結果が、開発者ごとの `config/*.local.yaml` の有無や、`config/venues.yaml`・`config/terminals.yaml` の運用上の編集(例: TRC会場のコメントアウト)に左右されないようにする。

- 範囲内: `apps/api/tests/` 配下(テスト・ヘルパー・fixture)の変更のみ
- 範囲外: `apps/api/src/` 配下(特に `src/config/` のローダー)の変更、`config/` 配下の変更、#224(workerの `ERR_MODULE_NOT_FOUND`)

## 2. 参照資料と設計判断の根拠

### 2.1 ヒアリング確定事項(統括担当から受領)

1. fixtureは `apps/api/tests/fixtures/config/` 配下に置き、テスト用preload(`apps/api/tests/helpers/venueConfigPreload.ts`)等から、各ローダーの**既存引数**(`baseUrl` / `localUrl` / `environment`、pollingは `configUrl`)で明示的に渡す。本番コードにテスト用分岐・環境変数は追加しない
2. fixtureの会場IDは `east`・`trc` をそのまま持たせる
3. #224は範囲外

### 2.2 実物調査の結果(本設計の前提)

ローダーのlocal適用条件(`src/config/` を読んで確認。変更しない):

| ローダー | 既定パス | local適用条件 |
| --- | --- | --- |
| `loadVenueConfig({ baseUrl?, localUrl?, environment? })` | `config/venues.yaml` / `config/venues.local.yaml` | `baseUrl` 未指定(=既定)か、`baseUrl`・`localUrl` 両方指定のとき。かつ環境が `production` でないとき |
| `loadTerminalConfig({ baseUrl?, localUrl?, environment?, venueRegistry, ... })` | `config/terminals.yaml` / `config/terminals.local.yaml` | 同上 |
| `loadPollingScheduleConfig(WithSources)(configUrl?)` | `config/polling.yaml` / `config/polling.local.yaml` | `configUrl` が既定URLと一致し、かつ `NODE_ENV !== 'production'` のとき(`localUrl` 引数は無い) |

したがって**fixtureの `baseUrl`(pollingは `configUrl`)だけを渡せば、local は `not-applicable` となり読まれない**。これが本設計の中心であり、ローダー変更は不要。

実設定を読んでいる箇所(全数。`grep` で洗い出し済み):

| # | 箇所 | 現状 | 影響 |
| --- | --- | --- | --- |
| A | `tests/helpers/venueConfigPreload.ts` | `loadVenueConfig()`・`loadTerminalConfig({ venueRegistry })` を引数なしで実行 | local適用・実会場構成依存。全テストの `testVenueRegistry` / `eastVenueId` / `trcVenueId` / `testTerminalRegistry` の元 |
| B | `tests/helpers/databasePair.ts` `createTestServerDatabaseOptions` | 会場・端末のURLを含まない | これを使う `startServer` / `startInlineServer` / `startWorkerServer` 呼び出し(38ファイル、全件この関数経由であることを確認済み)で、`src/server.ts` 639行・`src/runtime/startWorkerServer.ts` 59行が既定(=実設定+local)を読む |
| C | `src/server.ts` を直接起動する子プロセス | `independentSystemNotifications.test.ts`(270行付近)・`nowcastApi.test.ts`(1302行付近)・`serverPollingConfig.test.ts`(183行付近) | 本番エントリ(1064行)は引数なしで `startWorkerServer` を呼ぶため、会場・端末は実設定(+非productionならlocal)。pollingは既存 `pollingConfigPreload.mjs` がfs差し替えでfixture化済み |
| D | `databaseRecoveryOrchestration.test.ts` 919行付近 | `--eval` 内で `createTestServerDatabaseOptions(...)` を `JSON.stringify` して埋め込む | B修正後、URLが文字列化されるため再構築が必要(後述 4.4) |
| E | `devLifecycle.test.ts` | リポジトリの `config/` を丸ごと一時ディレクトリへ複製(50行付近)し、`npm run dev` / 実エントリを起動 | `*.local.yaml` も複製される。実会場構成に依存 |
| F | `deliveryRealMissBarrier.test.ts` 675・681行 | 実 `config/venues.yaml`・`terminals.yaml` を読み、`'  - id: trc'` / `'  - id: htrcph01'` で分割して単一会場版を作る | TRCをコメントアウトすると分割文字列が見つからず意図した構成にならない |
| G | `issue236VenueForecastIntegration.test.ts` 49・389行 | `loadVenueConfig({ environment: 'production' })` | localは無効だが実会場構成に依存 |
| H | `venueConfigLoader.test.ts` 37行 | 同上。`['east','trc']` を期待 | 実会場構成に依存 |
| I | `terminalConfigLoader.test.ts` 14・34・157行 | 同上。4端末を期待 | 実構成に依存 |
| J | `pollingScheduleLoader.test.ts` 37・168・494〜640行付近 | 引数なし呼び出し。494行以降は `fs.readFileSync` 差し替えで既定/localを模擬済み。37・168行は実ファイル(+local)を読む | local有無で結果が変わりうる |
| K | `serverPollingConfig.test.ts` 18行 | `originalRead(DEFAULT_CONFIG_URL)` で実 `polling.yaml` を基底文字列として読む | 実設定内容に依存(localは読まない) |

注: 上表の各テストが**現時点で**local有無・TRCコメントアウトにより実際に失敗するかは、テスト全体の実行コストを考慮し本設計では実測していない(**実挙動未確認**)。依存経路はコード読解による。

## 3. fixture

`apps/api/tests/fixtures/config/` を新設する。

| ファイル | 内容 |
| --- | --- |
| `venues.yaml` | 着手時点の `config/venues.yaml` の内容を複製(会場 `east`・`trc`、順序もそのまま) |
| `terminals.yaml` | 着手時点の `config/terminals.yaml` の内容を複製(`hkeagh01`・`kkeagh01`・`htrcph01`・`ktrcph01`) |
| `venues.single.yaml` / `terminals.single.yaml` | `east` のみ / `east` 所属端末のみの単一会場版(F用) |

- pollingは既存 `tests/fixtures/polling/schedule.yaml` を正とする(新規複製しない)。`tests/helpers/pollingSchedule.ts` は既にこれを `configUrl` で渡している
- 複製fixtureの先頭に「テスト用固定値。`config/` の変更に追従させない」旨の日本語コメントを1行入れる
- 気象コード値は既存設定の複製であり、新規の電文構造・コード値は導入しない

## 4. モジュール構成と変更内容

### 4.1 `tests/helpers/venueConfigPreload.ts`(A)

以下をexportする。シグネチャ:

```ts
export const testVenueConfigUrl: URL;      // fixtures/config/venues.yaml
export const testTerminalConfigUrl: URL;   // fixtures/config/terminals.yaml
export const testVenueRegistry: VenueRegistry;   // loadVenueConfig({ baseUrl: testVenueConfigUrl })
export const testVenueGeneration: string;
export const eastVenueId; export const trcVenueId;   // 既存どおり
export const testTerminalRegistry: TerminalRegistry; // loadTerminalConfig({ baseUrl: testTerminalConfigUrl, venueRegistry, venueGeneration })
```

`localUrl` は渡さない(=local `not-applicable`)。`eastVenueId` / `trcVenueId` の `!` 前提は維持する。

### 4.2 `tests/helpers/databasePair.ts`(B)

`createTestServerDatabaseOptions` の戻り値に `venueConfigUrl: testVenueConfigUrl`・`terminalConfigUrl: testTerminalConfigUrl` を追加する。呼び出し側で上書き指定(F等)した場合はスプレッド順で呼び出し側が勝つこと。`pollingSchedule` / `configUrl` は各テストが既に指定しているため触らない。ただし `configUrl`・`pollingSchedule` のどちらも渡さずに起動しているテストがあれば、`configUrl` に `tests/fixtures/polling/schedule.yaml` を渡すよう修正する(製造時に `grep` で確認)。

### 4.3 子プロセス用エントリ(C)

`tests/helpers/fixtureServerMain.ts` を新設する。内容は `src/server.ts` 末尾の本番エントリと同等(`PORT` 環境変数・`shutdownSignalSource: process`・起動ログ・失敗時 `exitCode=1`)に、`venueConfigUrl` / `terminalConfigUrl` を4.1のURLで加えたもの。C の3ファイルは `new URL('../src/server.ts', ...)` を `new URL('./helpers/fixtureServerMain.ts', ...)` に差し替える。既存の `--import` preload(`pollingConfigPreload.mjs` 等)はそのまま残す。

- 起動ログ文言をテストが照合している場合は、照合が通る文言を維持する
- 本番エントリそのもの(1064行のブロック)の起動確認は E(devLifecycle)が担う

### 4.4 `databaseRecoveryOrchestration.test.ts`(D)

`--eval` 内で `venueConfigUrl` / `terminalConfigUrl` を `new URL(<href文字列>)` に戻して渡す。`JSON.stringify` の結果を `startServer` にそのまま渡すと URL が文字列になるため。

### 4.5 `devLifecycle.test.ts`(E)

一時ディレクトリへの `config` 複製時に、`*.local.yaml` を filter で除外し、複製後に `config/venues.yaml`・`config/terminals.yaml` をfixtureで上書きする(一時ディレクトリ内の既定パスにfixtureを置くことで、本番エントリ・本番の既定パス解決をそのまま検証できる)。`config/polling.yaml` も `tests/fixtures/polling/schedule.yaml` で上書きする。319行付近の `config/polling.yaml` への追記処理は上書き後の内容に対して行われるため影響しない(製造時に確認)。

### 4.6 個別テスト(F〜K)

- F: 実設定の文字列分割をやめ、`venues.single.yaml`・`terminals.single.yaml` を `venueConfigUrl` / `terminalConfigUrl` に渡す
- G・H・I: `loadVenueConfig({ baseUrl: testVenueConfigUrl })` 等、fixtureの `baseUrl` を渡す。I の端末テストも `baseUrl: testTerminalConfigUrl` を渡す。「共有YAMLを順序どおり読む」趣旨のテスト名は「fixture YAML」に合わせて改める
- J: 37行は `loadPollingScheduleConfig(fixtureUrl)` に変更。168行(cwd非依存の既定URL解決)は `process.chdir` で一時ディレクトリへ移動した状態のまま、494行以降と同じ `fs.readFileSync` 差し替え方式(既定URLへの読み込みにfixture内容を返し、localは不在)で引数なしの `loadPollingScheduleConfig()` を実行し、読み込みが成功すること・既定URL `DEFAULT_CONFIG_URL` が読まれたことを検証する。cwd 基準の相対パス解決への退行を検知できる検証力を維持し、実ファイル内容は読まない(PR #281 レビュー対応で改訂)。494行以降の差し替え方式は、`shared`(465行)の基底文字列を fixture から読むよう変更する
- K: 18行の基底文字列を fixture から読む

### 4.7 local優先の挙動テスト

local優先の挙動は、本番ローダーのまま以下で明示的に再現されていることを保証する(既存があれば維持、無ければ追加)。

- venue: `venueConfigLoader.test.ts` の一時ディレクトリ方式(`baseUrl`・`localUrl` 両指定、`environment: 'development'` で `applied`、`'production'` で `disabled-production`)
- terminal: `terminalConfigLoader.test.ts` の同方式(50〜75行付近)
- polling: `localUrl` 引数が無いため、`pollingScheduleLoader.test.ts` 494行以降の `fs.readFileSync` 差し替え方式(既定URL・local URLへの読み込みを模擬し、`sources` と `localOverride` を検証)を正とする。実ファイルの `config/polling.local.yaml` には依存しない

## 5. 変更対象ファイル一覧

新規:
- `apps/api/tests/fixtures/config/venues.yaml`
- `apps/api/tests/fixtures/config/terminals.yaml`
- `apps/api/tests/fixtures/config/venues.single.yaml`
- `apps/api/tests/fixtures/config/terminals.single.yaml`
- `apps/api/tests/helpers/fixtureServerMain.ts`

変更:
- `apps/api/tests/helpers/venueConfigPreload.ts`
- `apps/api/tests/helpers/databasePair.ts`
- `apps/api/tests/independentSystemNotifications.test.ts`
- `apps/api/tests/nowcastApi.test.ts`
- `apps/api/tests/serverPollingConfig.test.ts`
- `apps/api/tests/databaseRecoveryOrchestration.test.ts`
- `apps/api/tests/devLifecycle.test.ts`
- `apps/api/tests/deliveryRealMissBarrier.test.ts`
- `apps/api/tests/issue236VenueForecastIntegration.test.ts`
- `apps/api/tests/venueConfigLoader.test.ts`
- `apps/api/tests/terminalConfigLoader.test.ts`
- `apps/api/tests/pollingScheduleLoader.test.ts`

変更禁止: `apps/api/src/**`、`config/**`、`apps/api/package.json`(testスクリプトは現状維持)

受け入れ条件の確認中に上記以外のテストが実設定依存で失敗した場合は、同じ方針(fixture URLの明示注入)で修正してよい。ただし `src/` に手を入れないと解決できない場合は修正せず統括担当へ報告する。

## 6. 受け入れ条件

検証前に、メインフォルダの `config/polling.local.yaml`(現存)を一時ディレクトリへ退避し、検証後に必ず元に戻すこと。`config/venues.yaml` の編集も検証後に `git checkout -- config/venues.yaml` で戻すこと。

- [ ] AC1 `git diff --stat main...HEAD -- apps/api/src config apps/api/package.json` の出力が空(本番ローダー・設定・testスクリプトに差分なし)
- [ ] AC2 `git diff --name-only main...HEAD` が5章の一覧(+5章末尾の許容分)の範囲内に収まる
- [ ] AC3 `npm run lint`・`npm run typecheck`・`npm run format:check` がエラーなく終了する
- [ ] AC4 local なし: `config/*.local.yaml` が1つも無い状態で `npm run test -w apps/api` を実行し全件パス。パス件数(`# pass`)と `# fail 0` を記録する
- [ ] AC5 local あり: 以下3ファイルを作成した状態で `npm run test -w apps/api` を実行し、`# pass` 件数がAC4と一致し `# fail 0`。作成内容(いずれも各ローダーの検証を通る有効な差分)
  - `config/venues.local.yaml`: `east` の `name` を別名に変える差分
  - `config/terminals.local.yaml`: `hkeagh01` の `name` を別名に変え、新規端末1件(`venueId: east`)を追加する差分
  - `config/polling.local.yaml`: 退避した現行ファイル(または周期値を変える差分)
  - 有効な差分であることは、`node --import tsx -e` で引数なしの `loadVenueConfig()`・`loadTerminalConfig(...)`・`loadPollingScheduleConfigWithSources()` を実行し、各 `localOverride` が `'applied'` であることで確認する
- [ ] AC6 TRCコメントアウト: `config/venues.yaml` の `trc` 会場ブロック全行をコメントアウトし、`config/terminals.yaml` の `trc` 所属端末2件もコメントアウト(会場不在の端末で検証が落ちるのを避けるため)した状態で `npm run test -w apps/api` を実行し全件パス。件数がAC4と一致
- [ ] AC7 検証後、`config/` が着手前の状態(`polling.local.yaml` 復元、venues/terminals差分なし、他の `*.local.yaml` 削除)に戻っていることを `git status --porcelain config` と `ls config` で確認
- [ ] AC8 `grep -rnE "config/(venues|terminals|polling)\.yaml" apps/api/tests` の結果が、コメント・既定URLの文字列比較(4.6 J)・devLifecycleの一時ディレクトリ内パスのみであり、リポジトリ実設定ファイルを読む箇所が無い
- [ ] AC9 `grep -rnE "loadVenueConfig\(\{ *environment|loadVenueConfig\(\)|loadTerminalConfig\(\{ *venueRegistry|loadPollingScheduleConfig(WithSources)?\(\)" apps/api/tests` の該当箇所が、4.7のfs差し替え方式のテスト内だけである
- [ ] AC10 local優先の挙動テストが存在しパスする: venue・terminalは一時ディレクトリで `applied` / `disabled-production` を検証するテスト、pollingは fs差し替えで `sources` が `[DEFAULT_CONFIG_URL, LOCAL_CONFIG_URL]` になることを検証するテストを、テスト名とともに列挙する
- [ ] AC11 `apps/api/tests/fixtures/config/venues.yaml` の会場IDが `east`・`trc` の順であることを目視確認

## 7. 後続Issueへの引き継ぎ

- 新規テストで会場・端末レジストリが必要な場合は `venueConfigPreload.ts` のexport、サーバー起動は `createTestServerDatabaseOptions`、子プロセスでのサーバー起動は `fixtureServerMain.ts` を使うこと
- 会場・端末の構成を変えるテストは、fixtureを複製・加工した一時ファイルを `venueConfigUrl` / `terminalConfigUrl` で渡すこと(実設定を加工しない)
- #224(workerの `ERR_MODULE_NOT_FOUND`)は別Issueで対応

## 8. 実挙動未確認の箇所

- 2.2表の各テストが現時点で local有無・TRCコメントアウトにより実際に失敗するか(コード読解のみ)
- `fixtureServerMain.ts` への差し替えで、Cの3ファイルが照合する起動ログ・終了コードがそのまま成立するか
- devLifecycle の `npm run dev` 経路で一時ディレクトリの既定パスが期待どおり解決されるか(既定URLは `import.meta.url` 基準なので成立する見込み)
