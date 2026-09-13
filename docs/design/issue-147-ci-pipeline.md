# Issue #147「D11. CIパイプラインの実装」設計

作成日: 2026-09-13

状態: 2026-09-13 ユーザー承認済み。§7の二段階検収を含め、AGYによる製造からPR発行・CI確認まで着手承認を得た。

## 1. 目的と確定事項

[Issue #147](https://github.com/BlueKurage119/wx-viewer-poc/issues/147) の検証コマンドをGitHub Actionsで自動実行し、PRのChecksに成否を表示する。

ヒアリングで次を確定した。

- `main` 向けPRの作成・更新を対象とし、全ブランチへのpushトリガーは設けない。
- Node.jsは既存の `.nvmrc` に合わせた24.xとする。
- npmのダウンロードキャッシュを使用し、毎回 `npm ci` でインストールする。
- testスクリプトのある全workspaceを検証する。現在はAPI・Web・sharedの3つ。
- 必須チェック化はCI動作確認後にユーザーが設定する。本Issueでは設定手順を用意する。
- 別ワークツリーで改訂中のエージェント規律ファイルは変更しない。製造は承認後にAGYへ委託する。

製造ブランチは `feature/issue-147-ci-pipeline`。

## 2. 参照資料と調査結果

- [Issue一覧 D11](../issues-draft.md)、[基本設計 §2・§6.4・§6.5](../basic-design.md): 開発基盤の自動検証だけを扱い、サーバー・配信方式は変更しない。
- [Issue #1設計 §3.8](issue-1-project-initialization.md): ローカルの既存npmコマンドを正とする。
- [Issue #118設計](issue-118-self-contained-test-fixtures.md)、`apps/api/tests/fixtures/jma/`: 外部サンプルの自己完結化が既に実装されている。
- ルートおよび各workspaceの `package.json`: root buildはshared→api→web。sharedのexports・typesは `dist` を参照するため、clean checkoutではtypecheck・testより先にビルドが必要。
- `.nvmrc` は `24`、各enginesは `>=24 <25`。統括確認のローカル環境はNode.js v24.20.0 / npm 11.19.0。パッチバージョン一致は必須とせず、比較時に実際のバージョンを記録する。
- 3 workspaceともtestは `node --import tsx --test tests/*.test.ts`。`test.skip`・`it.skip`・`t.skip`・`skip:` の検索では該当なし。実行時skip数は検収で確認する。
- `jmaXmlPolling.test.ts` は `127.0.0.1` の動的ポートでHTTPサーバーを起動し、feed取得先を差し替える。`amedasFetchService.test.ts` はfixtureと `fetchFn` の注入を使用する。URL文字列の存在だけでは外部通信とは判定しない。
- `.prettierignore` は `docs/`・`dist/`・`node_modules/`・lockfileを除外する。このIssueでは検査範囲を変更しない。

GitHubの仕様は2026-09-13に次の公式資料で確認した。

- [checkout](https://github.com/actions/checkout): 現行例は `actions/checkout@v7`。PRの既定checkoutはマージ結果を検証する。
- [setup-node](https://github.com/actions/setup-node): 現行例は `actions/setup-node@v7`。`node-version-file` とnpmキャッシュを使用でき、キャッシュ対象に `node_modules` は含まれない。
- [PRイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request): `branches` はbaseブランチを判定する。既定の活動種別はopened・synchronize・reopened。
- [ブランチ保護設定](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule): 実行済みチェックを必須チェックとして設定する手順の根拠。

GitHub上の実行、Linux上のnative依存インストール、外部通信遮断下のテストは実挙動未確認。

## 3. 変更対象と対象外

| ファイル | 変更 |
| --- | --- |
| `.github/workflows/ci.yml` | 新規。単一の検証ワークフロー |
| `README.md` | CIの対象・実行コマンド・ログ確認・必須チェック設定手順。既存のCI未実装記述に実装済みの注記 |
| 本設計書 | 承認後に設計成果物として保存 |

アプリコード、package.json、lockfile、fixture、検証設定、規律ファイルは変更対象に含めない。既存検証に不具合が見つかった場合は、skip追加や閾値緩和で回避せず統括へ返す。Dockerfile、CD、Cloud Run、権限設定の実変更、新規テスト基盤・恒常的なネットワーク遮断機構は対象外。型・APIエンドポイントの追加変更はない。

## 4. ワークフローの契約

### 4.1 起動と実行環境

- workflow名: `CI`、job ID: `verify`、job名: `検証`。
- イベント: `pull_request`、baseは `main`、typesは `opened`・`synchronize`・`reopened` を明記。PR本文編集だけでは再実行しない。
- pathsフィルターは設けず、ドキュメントだけのPRも対象にする。
- runnerはGitHub-hosted `ubuntu-latest`。追加のOS・Node.js matrixは設けない。
- workflow権限は `contents: read`。checkoutは `persist-credentials: false`、refの上書きはしない。
- `actions/checkout@v7` の後に `actions/setup-node@v7`。setup-nodeの入力は `node-version-file: .nvmrc`、`cache: npm`、`cache-dependency-path: package-lock.json`。
- Secrets、外部資料、永続DB、別リポジトリを要求しない。依存インストールおよびActionsの準備にはネットワークが必要。

### 4.2 ステップと失敗判定

全コマンドの作業ディレクトリはリポジトリルート。各行を独立したstepとし、step名にコマンドを含める。

| 順序 | step名 / コマンド | 条件 |
| --- | --- | --- |
| 1 | `実行環境` / `node --version` と `npm --version` | setup成功後 |
| 2 | `npm ci` | 通常の成功条件。step IDは `install` |
| 3 | `npm run build` | install成功後 |
| 4 | `npm run lint` | install成功後 |
| 5 | `npm run typecheck` | install成功後 |
| 6 | `npm run format:check` | install成功後 |
| 7 | `npm run test --workspaces --if-present` | install成功後 |

3〜7の条件はそれぞれ `!cancelled() && steps.install.outcome == 'success'` とする。先行検証が失敗しても他の検証を試し、インストール失敗・取消時は後続を実行しない。build失敗時にはtypecheck・testもdist不足で失敗し得るため、原因調査は最初の失敗から行う。

`continue-on-error`、`|| true`、終了コードを隠すパイプは使わない。いずれかのstep失敗でjobを失敗にする。npmが出力するworkspace名・スクリプト・テスト名を省略せず保持する。root lint/formatにはworkspaceという実行単位がないため、コマンドと対象ファイルパスで識別する。

testは既存のnpm workspace探索を使い、testスクリプトがないworkspaceだけを `--if-present` で除外する。固定の3件リストや新しいroot scriptは追加しない。検収では現在の3 workspaceが実行されていることを個別に確認する。

単一jobにすることでインストール・sharedビルドを共有する。チェック名は必須チェック設定後も不用意に変更しない。GitHub UI上の正式な表示名は初回実行で確認し、手順にはjob名 `検証` を指定する。

## 5. ローカル再現手順とREADME

READMEの検証コマンドに、次の順序と全workspaceテストを記載する。

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm run format:check
npm run test --workspaces --if-present
```

clean checkoutを前提にbuildを先行させる。CIはPRのマージ結果を検証するため、head単独での成功と比較する際はbaseとの差分も確認する。成否の食い違いがあれば同じマージ結果・Node/npmバージョンで再現する。

READMEに次も記載する。

- PRのChecksから `CI` の `検証` を開き、失敗stepとnpmログを確認する。
- CI実装済みであることを追記する。Issue #1時点という過去記述を、他機能の現状整理まで広げない。
- 初回成功後、ユーザーがSettings → Branchesの既存main保護ルールを確認し、Require status checks to pass before mergingで `検証` を選ぶ。既存Rulesetで管理している場合はそのmain向けルールへ同じチェックを追加する。既存ルールを重複作成しない。
- 必須チェックの設定変更は本Issueの自動操作に含めない。

## 6. PR作成前の受け入れ条件

- [ ] **L1 構成**: YAMLをパーサーで読み、§4のイベント・入力・権限・コマンド順・条件を照合する。新規依存は追加しない。利用可能ならactionlintも実行する。対象外のファイル変更がないことを `git diff --name-only` で確認する。
- [ ] **L2 clean再現**: 他作業と共有しない一時作業ディレクトリへ対象リビジョンの追跡ファイルだけを配置する。dist・node_modules・親資料がない状態から§5の全コマンドを実行し、すべて終了コード0。3 workspaceのtestの実行・成功・skip数とNode/npmバージョンを記録する。作業後は自身が作成した一時ディレクトリを削除する。
- [ ] **L3 外部通信なし**: L2の依存準備後、子プロセスにも適用されるOSのネットワーク制限下で全workspaceテストを実行する。loopbackは許可し、それ以外の送信を拒否する。macOSでは下記の一時的なプロセス制限を使用できる。ファイアウォール等のマシン設定を変更しない。

```bash
sandbox-exec -p '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip "localhost:*"))' npm run test --workspaces --if-present
```

  同じ制限下でNode.jsから非loopback宛てのTCP接続が拒否される対照確認を先に行う。制限なしで到達可能な宛先を用い、制限時の拒否理由を記録する。既存HTTPテスト成功をloopback許可の確認に使う。全test成功かつskipが増えないことを合格条件とする。これは外部サービスからの応答に依存しないことの確認であり、通信試行が一切ないという保証ではない。

  設計担当のsandbox内では `sandbox-exec ... /usr/bin/true` が `sandbox_apply: Operation not permitted` で失敗した。統括が承認レビューを通したsandbox外の実行で同じプロファイルを確認し、終了コード0を得た。プロセス制限の起動は可能だが、通信拒否の対照確認と全テスト実行は製造・検収時に行う。実行制限が解消できない場合はこの項目を「未確認」として統括へ返す。プロキシ環境変数だけで遮断確認済みと扱わず、新しい仕組みや環境設定を勝手に追加しない。

- [ ] **L4 失敗検出**: L2用の一時コピーで、既存APIテストの期待値を一つ意図的に不一致にし `npm run test --workspaces --if-present` を実行する。非0終了とAPIのworkspace名・失敗テスト名がログに現れることを確認し復元する。同様にREADMEの整形だけを一時的に崩し `npm run format:check` が非0となりREADMEを示すことを確認して復元する。既存テストは追加変更しないため、新規テストのred確認ではなく既存コマンドの失敗伝播の確認である。
- [ ] **L5 手順**: READMEのコマンドがworkflowと一致し、Checks確認とユーザーによる必須チェック設定の手順がある。全必須検証の成功を確認して製造成果をコミットする。

## 7. PR後の検証と工程の例外案

**【承認済み・Issue #147限定】** 現行規律の「全項目通過後にPR作成」と、PR起動するCI自体の実行検証には依存の循環がある。本IssueではL1〜L5通過をPR作成の前提とし、検収担当が通常PRを作成した後にG1〜G3を確認する二段階検収を行う。規律ファイルは改訂しない。2026-09-13にユーザーから本手順およびPR発行までの承認を得た。失敗ケースを含むPRが必要な場合も、ユーザーへ一言知らせて進めることが承認されている。

- [ ] **G1 作成イベント**: `main` baseの通常PR作成後、openedイベントの実行が生成され、Checksに `CI` の `検証` が表示される。ログで5種すべての検証と3 workspaceのtest実行を確認し、全成功。インストールでbetter-sqlite3を含むnative依存が成功したことも確認する。
- [ ] **G2 更新イベント**: 当該PRへの次の実変更コミットでsynchronize実行を確認する。追加変更が不要なら、統括の承認を得た検証用の空コミットを1回だけ使う。最新コミットへの実行が全成功することを確認する。rerunだけではsynchronize検証の代替にしない。
- [ ] **G3 一致**: G1/G2の実行URL・対象SHA・Node/npm・各コマンド成否とtest結果をローカルの結果と比較して検収報告に残す。差異を調査せず成功扱いにしない。実測所要時間は記録してよいが、予測値による独自timeoutは追加しない。

G1〜G3未確認の段階では「ローカル検収通過・GitHub検証待ち」と報告し、Issue全体を完了としない。PR本文は概要・変更内容・検証・`Closes #147`・生成アプリとモデル名を含める。マージしない。

## 8. 引き継ぎ・未確認事項

- 要ヒアリング事項: なし。§7の二段階検収は承認済み。
- L3のプロセス制限は統括のsandbox外実行で起動確認済み。通信遮断の対照確認とテスト本体は未実施であり、製造・検収時に実行する。できない場合は受け入れ条件を黙って緩和しない。
- GitHub Actionsのリポジトリ設定による許可・待機、Linux上の既存テストの再現性は実挙動未確認。環境起因の失敗とコードの失敗を分けて報告する。
- 後続でworkspaceを増やす場合、testスクリプトを定義すれば全workspace実行の対象になる。追加されたworkspaceのビルド順はroot buildで管理する。
- 必須チェックの設定作業はユーザーへ引き継ぐ。チェック名の変更、merge queue対応、push検証、CDは必要になったIssueで扱う。
- AGYへの製造委託は統括が承認済み設計コミットを指定して行う。AGYは設計との差異・受け入れ条件ごとの結果・停止点を報告し、GitHub実行前の条件を完了と誤記しない。
