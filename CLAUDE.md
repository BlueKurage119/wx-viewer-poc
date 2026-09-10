# CLAUDE.md

## 1. 概要

- 防災気象情報表示サービスのPoC。npm workspacesによるモノレポで、フロントエンド(`apps/web`)、バックエンド(`apps/api`)、共通コード(`packages/shared`)を管理する
- 技術スタック・画面構成・ポート番号は [README.md](README.md) を参照
- 基本設計は [docs/basic-design.md](docs/basic-design.md)(協議記録。【確定】【設計案】【未確定】のタグで確度を区別している)

## 2. ディレクトリ管理

- このリポジトリの親フォルダ(`cmk-gsx/`)に、Git管理外の `docs/` がある。主なものは以下の通り。
  - 気象庁XML資料・サンプル電文・コード表(`260907_weather-data/`)
  - 本番PoC要件定義(`260830_poc-v2-requirements/`)

  これらはいずれも、プロジェクト間で共有する・リポジトリを重くしないという理由で外に出しているだけである。
  **このリポジトリ内から絶対パス等で参照・引用してよい**(`docs/data-acquisition-report.md`が既に行っている)が、リモート環境などでは閲覧できないため注意すること。

- **例外: `cmk-gsx/docs/260908_[CONFIDENTIAL]_wx-poc-image/` 配下は取り扱いに注意が必要な画像である。ファイルの複製・埋め込みはもちろん、ファイル名・内容への言及自体も、このリポジトリ内(コード・ドキュメント・コミットメッセージ・Issue・PR・コメントのいずれも)で一切行ってはならない。**

## 3. 絶対遵守事項

### 3.1 禁止事項

ここに書かれていることは、エージェントとオーナーとの契約である。契約の遵守はエージェントの存在意義であり、違反は絶対に許されないことを強く自覚すること。

1. **`cmk-gsx/docs/260908_[CONFIDENTIAL]_wx-poc-image/` 配下の画像への言及・複製・引用をしてはならない**
2. **mainへ直接コミットをしてはならない**
3. **明確な指示を受けずにPRをマージしてはならない**
4. **明確な指示を受けずに、既存ファイルの削除・大幅な構造変更・マシンに波及する破壊的操作を行ってはならない**
5. **`docs/basic-design.md`の【設計案】・【未確定】の記述を、無断で確定したものとして扱ってはならない**

### 3.2 遵守事項

#### 開発の進め方に関する遵守事項

- 仕様が曖昧・矛盾する場合、勝手に補完せず質問すること
- 依頼範囲を遵守すること（調査・計画の提示や承認は実装開始の許可ではない）
- コードベースに変更を加えるときは、計画または設計の承認を受けてから着手すること
- コミット前に `npm run lint` / `npm run typecheck` / `npm run format:check` および対象workspaceのテストを実行し、エラーがないことを確かめること
- マージ後は、`git merge-base --is-ancestor <マージコミット> origin/main` が真であることを確かめること

#### UIデザインに関する遵守事項

- 色はHEX値をハードコードせず、Material-colorのトークンを使用すること
- 見ればわかる説明書き・ラベルは省略すること

#### 気象データに関する遵守事項

- 気象庁XML電文の提供仕様は、実データ・公式資料・[取得方法レポート](docs/data-acquisition-report.md)と照合できたものだけを、設計上の「確定」事実として扱うこと

## 4. 開発の進め方

- 会話・コミットメッセージ・ドキュメントは日本語で行う
- Issue単位で、サブエージェント3体を直列で回す。役割ごとの規律は [`.claude/agents/`](.claude/agents/) の定義ファイルに集約してある(統括担当は、対象Issue・ブランチ名・設計書パスなど、その回に固有の情報だけを渡す)

  | 役割       | 担当                     | model                                    | 成果物                                                                       |
  | ---------- | ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
  | ヒアリング | 統括担当(親エージェント) | —                                        | ユーザーとの対話で確定させた判断事項(designer起動時に渡す)                   |
  | 設計       | `wxviewer-designer`      | opus                                     | `docs/design/issue-N-<slug>.md`(受け入れ条件を含む)。コードは書かない        |
  | 製造       | `wxviewer-builder`       | sonnet（`agy-delegate`スキルも使用可能） | 設計書だけを唯一の仕様として実装。コミット・プッシュまで(PRはしない)         |
  | 検収       | `wxviewer-inspector`     | opus（2回目はsonnet）                    | 受け入れ条件を実行して検証し、通過したらpushしてPRを作成する。マージはしない |

- 統括担当(ユーザーと直接対話するメインセッション)はフェーズ間の判断・レビュー・マージを担い、自分では実装しない。
  **サブエージェントはバックグラウンドで動作しユーザーと直接対話できないため、ヒアリングは統括担当の責務とする。**
  **設計から製造に移行する場合は、一旦ターンを終了し、ユーザーの承認を受けること。**
  AGY等の外部エージェントの起動はユーザーまたは統括担当とし、製造担当が起動可能な場面は、並列しての製造を行う必要がある場合に限る。
- **このプロジェクトは他プロジェクトの3体構成と異なり、designer着手前に統括担当によるヒアリングフェーズを挟む。**
  `docs/issues-draft.md` のIssue項目はあっさりとした内容(実装タスク単位の見出しと参照章番号のみ)であるため、統括担当が`AskUserQuestion`等でユーザーに本質的な論点を確認し、確定した判断をIssue番号とあわせてdesignerへ渡す。
  designer自身は設計中に新たな要ヒアリング事項を見つけても自分で決めず、最終返答で統括担当に投げ返す(→統括担当が追加ヒアリングするか判断)。詳細は [`.claude/agents/wxviewer-designer.md`](.claude/agents/wxviewer-designer.md)
- 設計書は使い捨てではなく、後続Issueの参照資産として、設計承認後に統括担当（設計担当がClaude以外の場合は、設計担当のモデル名・AGENTS.mdに指定のメールアドレスを署名につけて）がコミットする(`docs/design/issue-1-project-initialization.md`が書式・粒度の手本)

### 検証の規律(詳細は各エージェント定義を参照)

- **redを先に確認する** — 新しいテストは、実装を壊して実際に落ちることを確認してから完成とする
- **ミューテーション判定の前に対照実験を行う** — 意味を変えないダミー改変がSURVIVEDになることを先に確かめる。「常にKILLEDに見える」故障モードが実在する
- **発見はトリアージする** — 到達経路の無い欠陥を修正ラウンドに変換しない

### 気象データ固有の注意

- **訓練データと本番相当データを混同しない。** 訓練通知機能(basic-design.md §3.4)の`isTraining`フラグが伝播すべき箇所(通知・履歴・表示)を、実装・検証のいずれでも本番データと同一視しない。
- **availability(`available`/`stale`/`unavailable`、basic-design.md §6.3)の3状態を、単純なOK/NGに簡略化しない。** stale時は前回値を保持しつつ鮮度低下を表現する。
- 気象庁XML電文のサンプル・提供仕様は、実データ・公式資料(取得方法レポート `docs/data-acquisition-report.md`)と照合できたものだけを設計上の「確定」事実として扱うこと（再掲）。憶測で電文仕様を補ってはならない。

### コードレビューへの向き合い方

- 外部ツールによるコードレビューは、統括担当がトリアージ（要対応・先送り・無視）を行ってから、本当に必要なものだけを提示すること。年に1回あるかどうかのバグに何時間と何万トークン費やして直しても費用対効果が薄い。
- 再レビューの要否は、統括担当が判断する。また、レビューへの回答・解決済みマークは統括担当が行う。

## 5. 技術スタック・規約

- React 19 + TypeScript + Vite(フロント) / Express 5 + TypeScript(バックエンド) / npm workspacesモノレポ
- ESLint(`eslint.config.js`、`--max-warnings 0`) + Prettier。詳細な規約は各設定ファイルを正とする
- Material Web + `@material/material-color-utilities` によるMD3準拠テーマ(8章参照)
- UI文言は日本語

## 6. 主要コマンド

```bash
npm run dev              # web(5174) + api(3001) を同時起動
npm run build             # shared → api → web の順にビルド
npm run typecheck         # 全workspaceの型検査
npm run lint               # ESLintによる静的検査(--max-warnings 0)
npm run format:check      # Prettier整形差分チェック
npm run test -w apps/web    # 対象workspaceのテスト(package.jsonのtestスクリプトが定義されているworkspaceのみ)
```

## 7. ブランチ・コミット規約

- ブランチ名: `feature/issue-<番号>-<短い説明>`(例: `feature/issue-2-common-shell`)
- コミットメッセージ: 種別プレフィックス(`feat`/`fix`/`docs`/`chore`等)+ 日本語要約
- コミットの粒度は、設計完了時に1回、製造時に2〜3回を目安とする
- PR本文に「Closes #<Issue番号>」を含める
- PR作成時、baseが `main` であることを確認する
- **製造担当(`wxviewer-builder`)の作業はコミット・プッシュまでとし、PRの作成・本文の記述は検収担当(`wxviewer-inspector`)が行う**
- Claudeが書いた文章(コミットメッセージ・PR本文・コメント等)には、Claudeが書いた旨の名義を本文中に明記する(コミットは末尾に `Co-Authored-By: Claude <model> <noreply@anthropic.com>`、PR本文は末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`)。`gh`コマンドでの投稿は人間のアカウント名義になるため、本文中の明記で代える

## 8. 破ると静かに壊れる制約

**エラーも警告も出ずに壊れる**ものだけをここに集約している。変更する前に必ず読むこと。

### 8.1 `apps/web` に副作用のためだけの bare import を書かない

`apps/web/package.json` に `"sideEffects": ["*.css"]` を宣言している。CSS以外の `import './foo'` 形式(副作用目的のimport)は**本番ビルドで黙って除去される**。devサーバーでは動くため気づけない。カスタム要素の登録は「ラッパーのexportを使う」ことで成立させる。

### 8.2 `@material/material-color-utilities` は `0.3.0` 固定(キャレットなし)

`apps/web/package.json` で明示的に固定している。`npm update`等で勝手に上げない。0.4.x系は既知のパッケージング不具合(拡張子なしimportの解決失敗)があるため避けている(mj-stats-viewerでの検証を踏襲)。

### 8.3 `<md-*>` の生タグを直書きしない

Material Webのコンポーネントは必ず `apps/web/src/components/md` のバレル(`index.ts`)からexportされた型付きラッパーをimportする。未ラップのコンポーネントが必要になったら、ラッパーを追加してからバレルに載せる。

### 8.4 色をハードコードしない

配色は `apps/web/src/theme/` がランタイムに生成し、`--md-sys-color-*` としてCSS変数で供給する。シード色は `apps/web/src/theme/seeds.ts` の `DEFAULT_THEME_SEED`(`#1A73E8`)のみで完結させる。共通シェルはダーク固定(README参照)。警戒レベル色・通知区分色はこのMD3基盤の対象外で、別途セマンティックトークンとして定義する(basic-design.md §5.7参照、未着手)。

### 8.5 `index.html` と `ThemeProvider.tsx` のlocalStorageキーは一致させる

いずれも `wx-viewer:color-mode`。FOUC対策で `index.html` 側に先読みロジックがあるため、キー名を個別に変更すると同期が壊れる。

## 9. 参照ドキュメント

- [docs/basic-design.md](docs/basic-design.md) — 基本設計(協議記録)
- [docs/issues-draft.md](docs/issues-draft.md) — Issue下書き(Epic単位)
- [docs/design/](docs/design/) — 各IssueのIssue単位設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
