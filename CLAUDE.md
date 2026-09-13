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
  **このリポジトリ内から参照・引用するときは、相対パスによること。**(`docs/data-acquisition-report.md`が既に行っている)が、リモート環境などでは閲覧できないため注意すること。**絶対パスで参照してはならない。**

- **例外: `cmk-gsx/docs/260908_[CONFIDENTIAL]_wx-poc-image/` 配下は取り扱いに注意が必要な画像である。ファイルの複製・埋め込みはもちろん、ファイル名・内容への言及自体も、このリポジトリ内(コード・ドキュメント・コミットメッセージ・Issue・PR・コメントのいずれも)で一切行ってはならない。**

## 3. 絶対遵守事項

### 3.1 禁止事項

ここに書かれていることは、エージェントとオーナーとの契約である。契約の遵守はエージェントの存在意義であり、違反は絶対に許されないことを強く自覚すること。

1. **`cmk-gsx/docs/260908_[CONFIDENTIAL]_wx-poc-image/` 配下の画像への言及・複製・引用をしてはならない**
2. **ホームディレクトリ名を、コードおよびドキュメントに残してはならない**
3. **mainへ直接コミットをしてはならない**
4. **明確な指示を受けずにPRをマージしてはならない**
5. **明確な着手指示の範囲や、指示されたフェーズ・依頼範囲を超えて、勝手に作業してはならない**
6. **明確な指示を受けずに、既存ファイルの削除・大幅な構造変更・マシンに波及する破壊的操作を行ってはならない**
7. **`docs/basic-design.md`の【設計案】・【未確定】の記述を、無断で確定したものとして扱ってはならない**

### 3.2 遵守事項

- 仕様が曖昧・矛盾する場合、勝手に補完せず質問すること
- 依頼範囲を遵守すること(調査・計画の提示や承認は実装開始の許可ではない)
- コードベースに変更を加えるときは、計画または設計の承認を受けてから着手すること
- コミット前に `npm run lint` / `npm run typecheck` / `npm run format:check` および対象workspaceのテストを実行し、エラーがないことを確かめること(ただし、変更が`docs/**`配下の`*.md`のみであり、依存関係により確認ができない場合は省略できる)
- マージ後は、`git merge-base --is-ancestor <マージコミット> origin/main` が真であることを確かめること
- UIデザイン・気象データそれぞれの詳細規律は [docs/advisory/ui-md3-rules.md](docs/advisory/ui-md3-rules.md)・[docs/advisory/wx-data-rules.md](docs/advisory/wx-data-rules.md) を参照

## 4. 開発の進め方

- 会話・コミットメッセージ・ドキュメントは日本語で行う
- Issue単位で、サブエージェント3体(ヒアリング→設計→製造→検収)を直列で回す。統括担当(メインセッション)はフェーズ間の判断・レビュー・マージを担い、自分では実装しない(軽微な修正を除く)

  - **ヒアリング**(統括担当・親エージェント): ユーザーとの対話で確定させた判断事項(designer起動時に渡す)
  - **設計**(`wxviewer-designer`・opus): `docs/design/issue-N-<slug>.md`(受け入れ条件を含む)。コードは書かない
  - **製造**(`wxviewer-builder`・sonnet。`agy-delegate`スキルも使用可能): 設計書だけを唯一の仕様として実装。コミット・プッシュまで(PRはしない)
  - **検収**(`wxviewer-inspector`・opus。2回目はsonnet): 受け入れ条件を実行して検証し、通過したらpushしてPRを作成する。マージはしない

  役割ごとの規律は [`.claude/agents/`](.claude/agents/) の定義ファイルに集約してある(統括担当は、対象Issue・ブランチ名・設計書パスなど、その回に固有の情報だけを渡す)。

- フェーズ運用の詳細(ヒアリング前提・設計から製造への承認ゲート・AGY委託・devサーバー作法・ブランチ/コミット/PR/署名・外部レビュー対応)は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) を参照。
- 検証規律(red確認・対照実験・完全一致・トリアージ・回帰テストの罠・共有可変状態の系統調査)は [docs/advisory/verification-discipline.md](docs/advisory/verification-discipline.md) を参照。
- ブラウザでのUI検証における制約・逆発注運用は [docs/advisory/browser-ui-verification.md](docs/advisory/browser-ui-verification.md) を参照。
- 気象データ固有の注意(isTraining・availability 3状態・電文照合)は [docs/advisory/wx-data-rules.md](docs/advisory/wx-data-rules.md) を参照。

## 5. 技術スタック・規約

- React 19 + TypeScript + Vite(フロント) / Express 5 + TypeScript(バックエンド) / npm workspacesモノレポ
- ESLint(`eslint.config.js`、`--max-warnings 0`) + Prettier。詳細な規約は各設定ファイルを正とする
- Material Web + `@material/material-color-utilities` によるMD3準拠テーマ。色トークン規約と「破ると静かに壊れる制約」は [docs/advisory/ui-md3-rules.md](docs/advisory/ui-md3-rules.md) を参照
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
- コミット・PR・コメントの署名フォーマット、コミット粒度、PR本文構成の詳細は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) を参照

## 8. 参照文書

- [docs/basic-design.md](docs/basic-design.md) — 基本設計(協議記録)
- [docs/issues-draft.md](docs/issues-draft.md) — Issue下書き(Epic単位)
- [docs/design/](docs/design/) — 各IssueのIssue単位設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
- [docs/advisory/](docs/advisory/) — トピック別の指導文書(開発フロー・検証規律・UI規約・気象データ規律等)。一覧は[docs/advisory/README.md](docs/advisory/README.md)
