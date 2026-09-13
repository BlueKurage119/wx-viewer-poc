# CLAUDE.md

このファイルはClaude向けのプロジェクト指示である。会話・コミットメッセージ・ドキュメントは日本語で行う。
なお、Codex・Antigravity向けにほぼ同内容の[AGENTS.md](AGENTS.md)を整備している。

## 1. 概要

- 防災気象情報表示サービスのPoC。npm workspacesによるモノレポで、フロントエンド(`apps/web`)、バックエンド(`apps/api`)、共通コード(`packages/shared`)を管理する
- 技術スタック・画面構成・ポート番号は [README.md](README.md) を参照
- 基本設計は [docs/basic-design.md](docs/basic-design.md)(協議記録。【確定】【設計案】【未確定】のタグで確度を区別している)

## 2. ディレクトリと機密情報

- このリポジトリの親フォルダ(`cmk-gsx/`)に、Git管理外の `docs/` がある。これらは、プロジェクト間で共有する・リポジトリを重くしないという理由で外に出しているだけである。主なものは以下の通り。
  - 気象庁XML資料・サンプル電文・コード表(`260907_weather-data/`)
  - 本番PoC要件定義(`260830_poc-v2-requirements/`)

- **このリポジトリ内から、リポジトリ外ファイルを参照・引用するときは、相対パスによること** (`docs/data-acquisition-report.md`が既に行っている)。また、リモート環境などでは閲覧できないため注意すること。**絶対パスでの引用は絶対に禁止する。**

- **例外: `[CONFIDENTIAL]` が付されたフォルダ配下には取り扱いに注意が必要なファイルがある。ファイルの複製・埋め込みはもちろん、ファイル名・内容への言及自体も、このリポジトリ内(コード・ドキュメント・コミットメッセージ・Issue・PR・コメントのいずれも)で一切行ってはならない。**

## 3. 絶対遵守事項

### 3.1 禁止事項

ここに書かれていることは、エージェントとオーナーとの契約である。契約の遵守はエージェントの存在意義であり、違反は絶対に許されないことを強く自覚すること。

1. **`[CONFIDENTIAL]` が付されたフォルダ配下のファイルへの言及・複製・引用をしてはならない**
2. **ホームディレクトリ名を、コードおよびドキュメントに残してはならない**
3. **mainへ直接コミットをしてはならない**
4. **明確な指示を受けずにPRをマージしてはならない**
5. **明確な着手指示の範囲や、指示されたフェーズ・依頼範囲を超えて、勝手に作業してはならない**
6. **明確な指示を受けずに、既存ファイルの削除・大幅な構造変更・マシンに波及する破壊的操作を行ってはならない**
7. **`docs/basic-design.md`の【設計案】・【未確定】の記述を、無断で確定したものとして扱ってはならない**

### 3.2 遵守事項

開発において、特に守ってほしいことを記載した。理由・具体的行動例などは、別に定めた業務標準・指導文書を参照すること。

#### 開発の進め方に関する遵守事項

- 仕様が曖昧・矛盾する場合、勝手に補完せず質問すること
- 依頼範囲を遵守すること（調査・計画の提示や承認は実装開始の許可ではない）
- コードベースに変更を加えるときは、計画または設計の承認を受けてから着手すること
- コミット前に `npm run lint` / `npm run typecheck` / `npm run format:check` および対象workspaceのテストを実行し、エラーがないことを確かめること（ただし、変更が`docs/**`配下の`*.md`のみであり、依存関係により確認ができない場合は省略できる）
- マージ後は、`git merge-base --is-ancestor <マージコミット> origin/main` が真であることを確かめること

#### UIデザインに関する遵守事項

- 色は HEX 値をハードコードせず、Material-color のトークンを使用すること
- 見ればわかる説明書き・ラベルは省略すること

#### 気象データに関する遵守事項

- 気象庁XML電文の提供仕様は、実データ・公式資料・[取得方法レポート](docs/data-acquisition-report.md)と照合できたものだけを、設計上の「確定」事実として扱うこと

## 4. 開発の進め方

- 会話・コミットメッセージ・ドキュメントは日本語で行う
- Issue単位で、サブエージェント3体(ヒアリング→設計→製造→検収)を直列で回す。統括担当(メインセッション)はフェーズ間の判断・レビュー・マージを担い、自分では実装しない(軽微な修正を除く)

  - **ヒアリング**(統括担当・親エージェント): ユーザーとの対話で確定させた判断事項(designer起動時に渡す)
  - **設計**(`wxviewer-designer`・opus): `docs/design/issue-N-<slug>.md`(受け入れ条件を含む)。コードは書かない
  - **製造**(`wxviewer-builder`・sonnet。`agy-delegate`スキルも使用可能): 設計書だけを唯一の仕様として実装。コミット・プッシュまで(PRはしない)
  - **検収**(`wxviewer-inspector`・opus。2回目はsonnet): 受け入れ条件を実行して検証し、通過したらpushしてPRを作成する。マージはしない

  役割ごとの規律は [`.claude/agents/`](.claude/agents/) の定義ファイルに集約してある(統括担当は、対象Issue・ブランチ名・設計書パスなど、その回に固有の情報だけを渡す)。

- フェーズ運用・検証・UI・気象データの**必須事項**は [docs/rules/](docs/rules/README.md) に、**背景・ノウハウ**は [docs/rules/advisory/](docs/rules/advisory/README.md) に分けて置く(統治原則は[docs/rules/README.md](docs/rules/README.md)を参照)。
  - フェーズ運用(承認ゲート・AGY委託の必須記載・ブランチ/コミット/PR/署名・devサーバー禁止事項)は [docs/rules/01-dev-workflow-protocol.md](docs/rules/01-dev-workflow-protocol.md)、背景は [docs/rules/advisory/G-01-dev-workflow.md](docs/rules/advisory/G-01-dev-workflow.md)
  - 設計・製造・検収それぞれの権限境界と合否条件は [docs/rules/02-design-protocol.md](docs/rules/02-design-protocol.md)・[docs/rules/03-build-protocol.md](docs/rules/03-build-protocol.md)・[docs/rules/04-inspect-protocol.md](docs/rules/04-inspect-protocol.md)
  - テスト検証の必須手順(red確認・対照実験・完全一致)は [docs/rules/05-verification-protocol.md](docs/rules/05-verification-protocol.md)、手法の詳細・過去事例は [docs/rules/advisory/G-03-verification-discipline.md](docs/rules/advisory/G-03-verification-discipline.md)
  - ブラウザでのUI検証における制約・逆発注運用は [docs/rules/advisory/C-01-browser-ui-verification.md](docs/rules/advisory/C-01-browser-ui-verification.md)
  - 気象データの必須事項(isTraining・availability 3状態・電文照合)は [docs/rules/07-wx-data-protocol.md](docs/rules/07-wx-data-protocol.md)

## 5. 技術スタック・規約

- React 19 + TypeScript + Vite(フロント) / Express 5 + TypeScript(バックエンド) / npm workspacesモノレポ
- ESLint(`eslint.config.js`、`--max-warnings 0`) + Prettier。詳細な規約は各設定ファイルを正とする
- Material Web + `@material/material-color-utilities` によるMD3準拠テーマ。色トークン規約と「破ると静かに壊れる制約」(必須)は [docs/rules/06-ui-md3-protocol.md](docs/rules/06-ui-md3-protocol.md)、UI寸法計測・バンドル見積りのノウハウは [docs/rules/advisory/G-04-ui-md3-rules.md](docs/rules/advisory/G-04-ui-md3-rules.md) を参照
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

## 7. ブランチ・コミット・PR

- ブランチ名: `feature/issue-<番号>-<短い説明>`(例: `feature/issue-2-common-shell`)
- **製造担当(`wxviewer-builder`)の作業はコミット・プッシュまでとし、PRの作成・本文の記述は検収担当(`wxviewer-inspector`)が行う**
- コミット・PR・コメントの署名の必須事項、コミット粒度、PR本文構成は [docs/rules/01-dev-workflow-protocol.md](docs/rules/01-dev-workflow-protocol.md) を参照。署名フォーマット一覧は [docs/rules/advisory/G-01-dev-workflow.md](docs/rules/advisory/G-01-dev-workflow.md) を参照

## 8. 参照文書

- [docs/basic-design.md](docs/basic-design.md) — 基本設計(協議記録)
- [docs/issues-draft.md](docs/issues-draft.md) — Issue下書き(Epic単位)
- [docs/design/](docs/design/) — 各IssueのIssue単位設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
- [docs/rules/](docs/rules/) — 必ず通る手順と合否条件(業務標準)。一覧は[docs/rules/README.md](docs/rules/README.md)
- [docs/rules/advisory/](docs/rules/advisory/) — 手順を実行するための知識・ノウハウ・過去事例(指導文書)。一覧は[docs/rules/advisory/README.md](docs/rules/advisory/README.md)
