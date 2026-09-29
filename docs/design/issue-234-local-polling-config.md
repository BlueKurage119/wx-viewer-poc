# Issue #234 ポーリング設定のローカル専用上書き

## 1. 目的・前提

共有の `config/polling.yaml` を編集せず、手元だけ取得方式・取得周期などを変更できるようにする。

- 対象: [Issue #234](https://github.com/BlueKurage119/wx-viewer-poc/issues/234)
- 状態: 設計承認・製造・再検収を完了し、[PR #240](https://github.com/BlueKurage119/wx-viewer-poc/pull/240) を作成済み。
- 作成: Codex（GPT-6 Sol）

### ヒアリングで確定した事項

1. `config/polling.local.yaml` を固定名で使用し、Git 管理外とする。環境変数によるファイル指定は導入しない。
2. ローカル設定を項目単位で共有設定へ重ねる。入れ子の項目も重ね、`periods` 配列は全体を置換する。
3. 起動ログに読み込み元とローカル上書きの有無を表示する。監視画面は変更しない。
4. `NODE_ENV=production` ではローカル設定を読み込まない。
5. 上書き後に既存の検証を適用する。不正なら起動失敗とし、共有設定へフォールバックしない。
6. 共有設定の既定値変更と、#226 のテスト改善は対象外とする。

### 参照資料と設計判断の根拠

| 参照 | 確認した内容・判断 |
| --- | --- |
| Issue #234 と上記ヒアリング結果 | 固定ファイル、部分上書き、起動ログ、本番無効化、失敗時の扱いを確定 |
| `apps/api/src/config/pollingScheduleLoader.ts` | `import.meta.url` 基準の URL を同期読込し、CORE_SCHEMA・重複キー拒否で解析後に検証している。この方式を維持 |
| `apps/api/src/config/pollingSchedule.ts` | ルート・入れ子の未知キー、欠落、型、値域、時間帯被覆などを検証している。検証器自体は変更せず、合成後の生データを渡す |
| `apps/api/src/server.ts` | `startServer()` と実プロセスの起動経路がある。両経路で DB 初期化・待受より前に設定を読むため、同じ位置で合成・検証を完了させる |
| `apps/api/tests/pollingScheduleLoader.test.ts`・`tests/helpers/pollingSchedule.ts` | 明示 URL による単独読込を利用しているため、この既存契約を保持 |
| `apps/api/tests/helpers/pollingConfigPreload.mjs`・`tests/nowcastApi.test.ts` | 子プロセスの共有設定を fixture に差し替える仕組みがある。今回追加するローカル読込だけを必要に応じて隔離 |
| `config/polling.yaml`・`.gitignore`・`README.md` | 共有値は不変とし、ignore と操作説明を追加 |
| `docs/rules/02-design-protocol.md`・`05-verification-protocol.md` | 受け入れ条件と検証手順を定義 |

## 2. 読み込み・合成仕様

### 適用対象

- 引数省略、または `DEFAULT_CONFIG_URL` と同じ `href` の URL を指定した読込では、非本番時に固定ローカルファイルを適用する。
- 明示的に別 URL を渡す既存用途では、そのファイルだけを読み込む。隣の `polling.local.yaml` やリポジトリのローカルファイルを自動適用しない。
- `startServer({ pollingSchedule })` の設定オブジェクト注入は従来どおり優先する。この場合はファイル読込もローカル上書きも行わない。
- URL は従来同様 `import.meta.url` 基準で解決し、実行時のカレントディレクトリに依存させない。ソース実行・ビルド後実行の双方で同じ `config/` を参照する。
- ファイル変更は API 再起動で反映する。監視・ホットリロード機構は追加しない。

### 読み込み順序

1. 共有（または明示 URL）のファイルを読む。読込失敗・構文不正を従来同様にエラーとする。
2. ローカル適用対象外、または `NODE_ENV === 'production'` の場合はローカルへのファイルアクセスを行わない。
3. 適用対象の場合、固定ローカルファイルを読む。`ENOENT` の場合だけ「上書きなし」とする。他の読込エラーは起動失敗にする。
4. ローカルも `yaml.CORE_SCHEMA`・`json: false` で解析する。重複キー・複数文書・構文不正を拒否する。
5. 両文書のルートがマッピングであることを確認し、ローカルの項目を合成する。ローカルの空文書・`null`・配列・スカラーはマッピングではないため拒否する。空マッピング `{}` は変更なしとして受理する。
6. 合成結果を既存の `validatePollingScheduleConfig()` で検証し、成功した設定と読み込み元情報を返す。

共有ファイル自体は必須とする。共有の YAML 構文不正や読込失敗を、ローカルの値で救済しない。値・スキーマ検証の対象は最終的な合成結果とする。

### 合成規則

- ローカルに存在しないキーは共有値を保持する。
- 両値がマッピングの場合のみ再帰的に重ねる。
- 配列・スカラー・`null` はローカル値で置換する。`false` や `null` を未指定と扱わない。
- `periods` は配列全体の置換であり、要素の位置・時刻によるマージは行わない。指定時には全時間帯・全必須項目を記述する必要がある。
- 未知キーを捨てない。合成結果の既存検証によって拒否する。型が不正な値を共有値に戻さない。
- 入力オブジェクトを変更しない。継承プロパティを取り込まず、`__proto__` 等によるプロトタイプ変更を起こさない方法で自身のキーだけを扱う。
- YAML の自己参照・循環参照で再帰が停止しない状態を作らない。合成中に検出した循環参照は、対象ファイルを示す設定エラーとする。

例として、次のローカル設定は配信方式と XML 鮮度だけを変え、画像索引の鮮度などは共有値を保持する。

```yaml
tileDeliveryProfile: jma-direct
freshness:
  xml:
    staleAfterSeconds: 600
```

## 3. モジュール・型・起動ログ

### ローダー

`apps/api/src/config/pollingScheduleLoader.ts` 内で既存関数の戻り値を維持し、読込元を返す関数を追加する。

```ts
export const DEFAULT_CONFIG_URL: URL;
export const LOCAL_CONFIG_URL: URL;

export type LocalPollingOverrideStatus =
  | 'applied'
  | 'absent'
  | 'disabled-production'
  | 'not-applicable';

export interface LoadedPollingScheduleConfig {
  readonly config: PollingScheduleConfig;
  readonly sources: readonly URL[];
  readonly localOverride: LocalPollingOverrideStatus;
}

export function loadPollingScheduleConfigWithSources(
  configUrl?: URL,
): LoadedPollingScheduleConfig;

export function loadPollingScheduleConfig(configUrl?: URL): PollingScheduleConfig;
```

- `LOCAL_CONFIG_URL` は `DEFAULT_CONFIG_URL` を基準に固定名 `polling.local.yaml` を解決する。
- 既存関数は新関数の `.config` を返す薄いラッパーとする。ローダー単体からログは出さない。
- `sources` は実際に読み込んだ順（共有、適用時だけローカル）。本番時・不在時は共有だけ、別 URL 指定時は指定ファイルだけとする。
- 空マッピングを含め、ローカルファイルを読み込み合成した場合は `applied` とする。
- ファイル読込・YAML 解析エラーは該当 URL と原因を含める。合成・最終検証のエラーは使用したファイル群と原因を含め、上書き後の失敗と分かるようにする。
- 既存の `PollingScheduleConfig`、検証器、公開 API のレスポンス型・エンドポイントは変更しない。外部依存も追加しない。

### 起動経路

`apps/api/src/server.ts` の `startServer()` と実プロセス起動経路で、新関数の結果を受け取り、検証成功後・DB 初期化前に起動ごとに一度 `console.info` で表示する。共通の整形処理により両経路で同じ表現を使う。

標準の表示は次のとおりとする。

```text
ポーリング設定: 読み込み元=config/polling.yaml; ローカル上書き=なし（ファイルなし）
ポーリング設定: 読み込み元=config/polling.yaml, config/polling.local.yaml; ローカル上書き=あり
ポーリング設定: 読み込み元=config/polling.yaml; ローカル上書き=無効（production）
```

別 URL は指定元を表示し、ローカル上書きは「対象外（明示URL）」とする。設定オブジェクト注入時は読み込み元を「設定オブジェクト」、ローカル上書きを「対象外（設定注入）」とする。既定のファイル名表示はリポジトリ相対表記とし、ユーザー固有のディレクトリ名をソースや説明例へ埋め込まない。

不正設定では成功ログを出さず、既存の起動失敗経路へ例外を伝える。DB 初期化・HTTP 待受・上流呼出しより前に失敗する順序を維持する。

## 4. 変更範囲

| ファイル | 変更 |
| --- | --- |
| `apps/api/src/config/pollingScheduleLoader.ts` | 固定ローカル読込・安全な部分合成・読込元情報 |
| `apps/api/src/server.ts` | 2つの起動経路に読込元ログを接続 |
| `.gitignore` | `/config/polling.local.yaml` を追加 |
| `README.md` | 作成場所・部分上書き例・配列全置換・本番無効・再起動反映・失敗時の説明 |
| `apps/api/tests/pollingScheduleLoader.test.ts` | 新規挙動・既存単独読込の回帰検証 |
| `apps/api/tests/serverPollingConfig.test.ts`（新規） | 起動ログ・起動前検証の統合検証 |
| `apps/api/tests/helpers/pollingConfigPreload.mjs` | 必要な場合のみ、既存 fixture 利用時の新設ローカル読込を不在として隔離 |
| 本設計書 | 承認済み設計の保存 |

`config/polling.local.yaml` 自体は配布・コミットせず、README の例を手元で新規作成する。共有 `config/polling.yaml`、既存 fixture の値、共通テスト設定、web・shared・監視 API、取得処理・スケジューラの動作ロジックは変更しない。#226 の全面的なテスト依存解消は行わない。

## 5. 検証方法・受け入れ条件

### 検証方法

ローダーのテストは一時ファイルとファイル読込モックで固定 URL の入力を制御し、既存の利用者のローカルファイルを作成・変更・削除しない。モックと環境変数は各ケース終了時に復元する。共有 fixture を変更せず、明示 URL の読み込みも実ファイルで回帰確認する。

起動経路のテストはファイル読込・外部通信を隔離する。実プロセスの不正設定は子プロセスを使い、終了コードと DB 未生成を確認する。テスト用 DB は一時ディレクトリ内とし、上流呼出しを捕捉してゼロ件を確認する。成功ログは `startServer()` の呼出しと実プロセスの双方を確認し、自分が起動したプロセスだけを終了する。

新規テストは意味を変えない対照改変を先に通し、次に受け入れ条件に対応する実装（例: マージ、production 分岐、配列置換）を意図的に壊して red を確認する。改変を復旧し、手順・結果を報告する。

### チェックリスト

- [ ] AC1: 固定ローカルへの読込を `ENOENT` にして既定ローダーを実行し、共有 fixture の検証結果と戻り値が完全一致することを確認する。読込元が共有のみ、状態が `absent` であること。
- [ ] AC2: ローカルに `tileDeliveryProfile: jma-direct` と `freshness.xml.staleAfterSeconds: 600` を指定して実行する。指定値だけが変わり、`freshness.imageCatalog`・取得周期・他の入れ子の未指定値は共有 fixture と一致すること。読込元2件と `applied` を確認する。
- [ ] AC3: 共有と異なる要素数で24時間を覆う完全な `periods` 配列を指定する。戻り値の配列がローカル配列と完全一致し、共有の要素が残らないこと。周期の `null` と画像取得許可の `false` が保持されること。
- [ ] AC4: ローカルを `{}` にして実行し、共有と同じ設定・状態 `applied` が返ること。空文書、ルートの `null`・スカラー・配列は設定エラーになること。
- [ ] AC5: ローカルに未知ルートキー、未知の入れ子キー、不正な型・値域、必須項目を欠いた `periods`、時間帯の重複・欠落をそれぞれ指定し、既存検証によって失敗すること。エラーに読み込み元と具体的原因があり、共有値を返さないこと。
- [ ] AC6: ローカルの YAML 構文不正・重複キー・複数文書、読込の `EACCES` をそれぞれ与え、該当元と原因を含むエラーになること。共有ファイルの不在・構文不正もローカルの有無にかかわらず失敗すること。
- [ ] AC7: `NODE_ENV=production` で、存在する不正なローカルを読めば例外になるモックを用意して実行する。ローカルにファイルアクセスせず共有だけが返り、状態が `disabled-production` になること。非本番と環境変数未指定ではローカルが適用されること。
- [ ] AC8: 別 URL の fixture を明示し、固定ローカルの内容にかかわらず指定ファイルだけが返ること。状態が `not-applicable` であること。同一 `href` の別 URL インスタンスでは既定読込と同じ適用になること。
- [ ] AC9: 既存の cwd 変更テストと追加する固定ローカル URL の検証を実行し、cwd 変更前後で設定・読込先が一致すること。ビルド後のローダーでも固定 URL がリポジトリの `config/` を指すことを確認する。
- [ ] AC10: 起動ログを捕捉し、不在・適用・production の3状態で第3節のログが各起動につき一度出ることを確認する。`startServer()` と実プロセスで同じ契約を満たし、明示 URL・設定注入時も実際の設定元を示すこと。
- [ ] AC11: 不正なローカルで API 子プロセスを起動し、非ゼロ終了、成功ログなし、DB 未生成、HTTP 待受なし、上流呼出しゼロを確認する。`startServer()` でも初期化前に拒否されること。
- [ ] AC12: `__proto__` などの未知キーと YAML 循環参照を与え、設定エラーになりプロトタイプが変更されず処理が終了することを確認する。合成前の入力オブジェクトに変更がないことも確認する。
- [ ] AC13: `git check-ignore config/polling.local.yaml` が該当パスを返し、`git ls-files -- config/polling.local.yaml` が空であること。共有 YAML・既存 fixture の差分がなく、README の手順と実装が一致すること。
- [ ] AC14: `npm run build`、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行して成功すること。新規テストの対照実験・red 確認・復旧後の成功を報告すること。

## 6. 未確認事項・後続への引き継ぎ

- 検証実績: 設計段階では実挙動未確認だったが、製造後の再検収で AC1〜14 が合格した。API テスト773件、および build・lint・typecheck・format の確認は成功済み（初回レビュー対応前の実績）。
- 初回レビュー対応の製造実績: テスト終了待ちの不具合を修正し、コミット `caaaf9a` に記録した。main 取り込み後の製造検証で API テスト782件、および build・lint・typecheck・format が成功した。この記録は修正後の製造検証結果を示す。
- ユーザーの追加判断を要する事項: なし。設計は承認済みで、製造・PR 作成・初回レビュー対応まで委任されている。
- 後続 Issue: #226 の既存テスト改善は実施しない。今回の新規挙動をテストするための隔離に限定する。
- 先送り事項: 監視画面への設定元表示、任意パスの環境変数指定、設定の動的再読込、共有既定値変更は本設計の対象外。
