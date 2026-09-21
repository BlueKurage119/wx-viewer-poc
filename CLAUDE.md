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
3. **リモート・ローカル問わず、mainへ直接コミットをしてはならない**
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

- 色は HEX 値をハードコードせず、別に定めたトークンを使用すること
- 見ればわかる説明書き・ラベルは省略すること

#### 気象データに関する遵守事項

- 気象庁XML電文の提供仕様は、実データ・公式資料・[取得方法レポート](docs/data-acquisition-report.md)と照合できたものだけを、設計上の「確定」事実として扱うこと

## 4. 開発の進め方

- 会話・コミットメッセージ・ドキュメント・コード中のコメントはすべて日本語で行うこと。
- Issue ごとに、ヒアリング、設計、製造、検収をこの順番で進める。
- 統括担当はユーザーとの対話、フェーズ間の判断、レビュー、マージ判断を担う。統括担当（メインセッション）は原則として実装を行わず、設計・製造・検収をサブエージェントへ委任すること（軽微な修正を除く）。

### 4.1 フェーズごとの役割定義

<!-- prettier-ignore -->
| 役割 | 担当 | 推奨モデル | 役割と成果物 |
| --- | --- | --- | --- |
| ヒアリング | 統括 | （メインセッション） | **実装方針を左右する未確定事項をユーザーに選択肢とメリット・デメリット等を整理した形で提示する。** 確定した判断を Issue 番号と共に次の担当へ渡す。 |
| 設計 | `wxviewer-designer` | Opus | **対象の `docs/design/issue-N-<slug>.md` 1本だけを新規作成または改訂する。**コード、設定、ブランチ、コミットは変更しない。 |
| 製造 | `wxviewer-builder`・`agy-delegate`スキル | Sonnet・Gemini Flash | **指定済みブランチ上で実装・テスト・コミットまで行う。**push と PR 作成はしない。 |
| 検収 | `wxviewer-inspector` | Opus（2回目はSonnet） | 設計書の受け入れ条件を項目ごとに実行して検証する。コードは修正しない。**全項目が通過した場合のみ PR を作成し、マージはしない。** |

フェーズ運用の必須事項(承認ゲート・devサーバー禁止事項・ブランチ/コミット/PR/署名)は [docs/rules/01-dev-workflow-protocol.md](docs/rules/01-dev-workflow-protocol.md)を参照のこと。

### 4.2 業務標準・指導文書

Issue開発フローの詳細は、必ず守る手順(業務標準)と、それを上手にこなすための知識(指導文書)に分けてまとめている。

- **業務標準**: 各フェーズが必ず通る手順・必須の実施項目・合否条件。必須条件の省略は認めない。[docs/rules/](docs/rules/README.md)(一覧・統治原則もここに記載)
- **指導文書**: 業務標準の手順を上手にこなすための知識(検証コマンド、環境固有の罠、過去の失敗事例等)。業務標準が定める権限・必須工程・合否条件は追加・変更しない。[docs/rules/advisory/](docs/rules/advisory/README.md)

### 4.3 Antigravity固有指示

設計書があり、詳細な指示付きで製造フェーズのみの委託を受けた場合、Implementation Planの承認は省略する。
ただし、統括担当への引き継ぎのため、非対話セッションを除きWalkthroughファイルを作成させること。最終報告に必須の記載事項は [docs/rules/01-dev-workflow-protocol.md](docs/rules/01-dev-workflow-protocol.md) の「AGYの最終報告」を参照。

## 5. 技術スタック・規約

- React 19 + TypeScript + Vite(フロント) / Express 5 + TypeScript(バックエンド) / npm workspacesモノレポ
- ESLint(`eslint.config.js`、`--max-warnings 0`) + Prettier。詳細な規約は各設定ファイルを正とする
- Material Web + `@material/material-color-utilities` によるMD3準拠テーマ。色トークン規約と「破ると静かに壊れる制約」(必須)は [docs/rules/06-ui-md3-protocol.md](docs/rules/06-ui-md3-protocol.md)、UI寸法計測・バンドル見積りのノウハウは [docs/rules/advisory/](docs/rules/advisory/README.md) を参照
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

- ブランチ名は `<プレフィックス>/issue-<番号>-<短い説明>` (例: `feature/issue-2-common-shell`)とする。Issueによらない作業は、その都度統括担当が決める。
- PR 作成時は base が `main` であることを確認する。
- **製造担当(`wxviewer-builder`)の作業はコミットまでとし、push・PRの作成・本文の記述は検収担当(`wxviewer-inspector`)が行う**
- コミット・PR・コメントの署名の必須事項・フォーマット、コミット粒度、PR本文構成は [docs/rules/01-dev-workflow-protocol.md](docs/rules/01-dev-workflow-protocol.md) を参照

## 8. 参照文書

- [docs/basic-design.md](docs/basic-design.md) — 基本設計(協議記録)
- [docs/issues-draft.md](docs/issues-draft.md) — Issue下書き(Epic単位)
- [docs/design/](docs/design/) — 各IssueのIssue単位設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
- [docs/rules/](docs/rules/) — 必ず通る手順と合否条件(業務標準)。一覧は[docs/rules/README.md](docs/rules/README.md)
- [docs/rules/advisory/](docs/rules/advisory/) — 手順を実行するための知識・ノウハウ・過去事例(指導文書)。一覧は[docs/rules/advisory/README.md](docs/rules/advisory/README.md)
