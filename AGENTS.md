# AGENTS.md

このファイルはエージェント向けのプロジェクト指示である。会話・コミットメッセージ・ドキュメントは日本語で行う。
なお、[CLAUDE.md](CLAUDE.md)と矛盾する指示が書かれている場合は、CLAUDE.md を優先する。

## 概要

- 防災気象情報表示サービスの PoC。npm workspaces によるモノレポで、フロントエンド(`apps/web`)、バックエンド(`apps/api`)、共通コード(`packages/shared`)を管理する。
- 技術スタック、画面構成、ポート番号は [README.md](README.md) を参照する。
- 基本設計は [docs/basic-design.md](docs/basic-design.md) である。協議記録内の【確定】【設計案】【未確定】は、設計上の確度を表す。

## ディレクトリと機密情報

- リポジトリ親フォルダの Git 管理外 `docs/` には、気象庁 XML 資料・サンプル電文・コード表および本番 PoC 要件定義がある。リポジトリ内の文書から相対パスで参照・引用してよいが、リモート環境では利用できないことがある。**絶対パスでの引用は絶対に禁止する。**
- 親フォルダ内の指定済み機密画像ディレクトリについては、複製する、埋め込む、ファイル名または内容に言及する行為を禁止する。このリポジトリ内のコード、文書、コミットメッセージ、Issue、PR、コメントにも残してはならない。

## 絶対遵守事項

### 禁止事項

ここに書かれていることは、エージェントとオーナーとの契約である。契約の遵守はエージェントの存在意義であり、違反は絶対に許されないことを強く自覚すること。

1. **`cmk-gsx/docs/260908_[CONFIDENTIAL]_wx-poc-image/` 配下の画像への言及・複製・引用をしてはならない**
2. **ホームディレクトリ名を、コードおよびドキュメントに残してはならない**
3. **mainへ直接コミットをしてはならない**
4. **明確な指示を受けずにPRをマージしてはならない**
5. **明確な着手指示の範囲や、指示されたフェーズ・依頼範囲を超えて、勝手に作業してはならない**
6. **明確な指示を受けずに、既存ファイルの削除・大幅な構造変更・マシンに波及する破壊的操作を行ってはならない**
7. **`docs/basic-design.md`の【設計案】・【未確定】の記述を、無断で確定したものとして扱ってはならない**

### 遵守事項

- 仕様が曖昧・矛盾する場合、勝手に補完せず質問すること
- 依頼範囲を遵守すること（調査・計画の提示や承認は実装開始の許可ではない）
- コードベースに変更を加えるときは、計画または設計の承認を受けてから着手すること
- コミット前に `npm run lint` / `npm run typecheck` / `npm run format:check` および対象workspaceのテストを実行し、エラーがないことを確かめること（ただし、変更が`docs/**`配下の`*.md`のみであり、依存関係により確認ができない場合は省略できる）
- マージ後は、`git merge-base --is-ancestor <マージコミット> origin/main` が真であることを確かめること
- 色は HEX 値をハードコードせず、Material-color のトークンを使用すること。見ればわかる説明書き・ラベルは省略すること（詳細・背景は [docs/advisory/ui-md3-rules.md](docs/advisory/ui-md3-rules.md) を参照）
- 気象庁XML電文の提供仕様は、実データ・公式資料・[取得方法レポート](docs/data-acquisition-report.md)と照合できたものだけを、設計上の「確定」事実として扱うこと（詳細・背景は [docs/advisory/wx-data-rules.md](docs/advisory/wx-data-rules.md) を参照）

## Issue 開発フロー

Issue ごとに、統括、設計、製造、検収をこの順番で進める。統括はユーザーとの対話、フェーズ間の判断、レビュー、マージ判断を担う。統括（メインセッション）は原則として実装を行わず、設計・製造・検収をサブエージェントへ委任すること（軽微な修正を除く）。

1. **ヒアリング（統括）**: `docs/issues-draft.md` の対象 Issue と関連する基本設計を読み、実装方針を左右する未確定事項をユーザーに選択肢とメリット・デメリット等を整理した形で提示する。確定した判断を Issue 番号と共に次の担当へ渡す。
2. **設計**(Codex の推奨モデル: Sol以上): `docs/design/issue-N-<slug>.md` を 1 本だけ作成する。コード、設定、ブランチ、コミットは変更しない。判断規律(ヒアリング前提の扱い・要確認事項の返し方・設計書に必ず含めるもの)は [docs/advisory/design-phase.md](docs/advisory/design-phase.md) を参照。**設計から製造に移行する場合は、一旦ターンを終了し、ユーザーの承認を受けること。**
3. **製造**(Codex の推奨モデル: Terra): 設計書を唯一の仕様として、指定済みブランチ上で実装・テスト・コミットまで行う。判断規律(設計書からの逸脱時の対応・スコープ厳守)は [docs/advisory/build-phase.md](docs/advisory/build-phase.md) を参照。push と PR 作成はしない。
4. **検収**(Codex の推奨モデル: Sol、2回目はTerra以下): 設計書の受け入れ条件を項目ごとに実行して検証する。検収担当はコードを修正しない。判断規律(実際に実行して検証する原則・CI担保項目との重複排除・判定後の対応・収束の判断)は [docs/advisory/inspect-phase.md](docs/advisory/inspect-phase.md) を参照。全項目が通過した場合のみ PR を作成し、マージはしない。

- サブエージェントはユーザーと直接対話できないため、ヒアリングは統括の責務である。Codex のサブエージェントを使う場合も、上記の責務と順番を維持し、各担当に対象 Issue、ブランチ名、設計書パス、ヒアリング済みの確定事項だけを渡す。
- フェーズ運用の詳細(承認ゲート・devサーバー作法・ブランチ/コミット/PR/署名・外部レビュー対応)は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) を参照。

### Codex固有指示

製造フェーズにおいては、時間短縮・コスト削減を目的に Antigravity への製造委託を行うことがある。必要により、Antigravity に渡すプロンプトを提供すること。AGY への依頼文の構成は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) の「AGY(Antigravity)への製造委託」を参照(AGENTS.md に記載されている内容を重ねて記載する必要はない)。

### Antigravity固有指示

設計書があり、詳細な指示付きで製造フェーズのみの委託を受けた場合、Implementation Plan の承認は省略する。ただし、統括担当への引き継ぎのため、Walkthrough ファイルを作成すること。最終報告に含める項目は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) の「AGYの最終報告」を参照。

## 設計・実装・検収の規律

検証規律(red確認・対照実験・完全一致・トリアージ・回帰テストの罠・共有可変状態の系統調査)は [docs/advisory/verification-discipline.md](docs/advisory/verification-discipline.md) を参照。ブラウザでのUI検証における制約・逆発注運用は [docs/advisory/browser-ui-verification.md](docs/advisory/browser-ui-verification.md) を参照。

## コードレビューへの向き合い方

- 外部ツールによるコードレビューは、統括担当がトリアージ（要対応・先送り・無視）を行ってから、本当に必要なものだけを提示すること。年に1回あるかどうかのバグに何時間と何万トークン費やして直しても費用対効果が薄い。
- レビューへの回答・解決済みマークは統括担当が行う。
- 再レビューの要求はユーザーが行う。統括担当は必要により再レビューの提案を行うこと。修正が局所的で、指摘を再現する回帰テストを追加しすべての必須検証が通った場合、再レビュー不要と判断できる。起動条件の詳細は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) を参照。

## UI・気象データの規約

UIデザイン(色トークン・破ると静かに壊れる制約)は [docs/advisory/ui-md3-rules.md](docs/advisory/ui-md3-rules.md)、気象データ(isTraining・availability 3状態・電文照合)は [docs/advisory/wx-data-rules.md](docs/advisory/wx-data-rules.md) を参照。

## 技術スタックとコマンド

- React 19 + TypeScript + Vite（フロントエンド）、Express 5 + TypeScript（バックエンド）、npm workspaces モノレポ。
- ESLint（`eslint.config.js`、`--max-warnings 0`）と Prettier。詳細な規約は設定ファイルを正とする。
- Material Web と `@material/material-color-utilities` による MD3 準拠テーマ。UI 文言は日本語。

```bash
npm run dev              # web (5174) + api (3001) を同時起動
npm run build             # shared → api → web の順にビルド
npm run typecheck         # 全 workspace の型検査
npm run lint              # ESLint による静的検査（--max-warnings 0）
npm run format:check      # Prettier 整形差分チェック
npm run test -w apps/web  # test スクリプトがある対象 workspace のテスト
```

## ブランチ・コミット・PR

- ブランチ名は `feature/issue-<番号>-<短い説明>` とする。Codex が新規ブランチを作る場合もこの規約を優先する。
- PR 作成時は base が `main` であることを確認する。
- PR 本文には少なくとも、概要・変更内容・検証を含める。また、`Close` により、元の Issue が自動クローズされるようにする。
- エージェントが作成するコミットメッセージ、PR 本文、コメントには、それを生成したアプリケーションおよびモデル名を本文中に明記する。CLI や API の投稿者名が人間のアカウントになる場合も同様とする。署名フォーマット(Codex/Antigravityの例を含む)、コミット粒度は [docs/advisory/dev-workflow.md](docs/advisory/dev-workflow.md) を参照。

## 参照文書

- [docs/basic-design.md](docs/basic-design.md) — 基本設計（協議記録）
- [docs/issues-draft.md](docs/issues-draft.md) — Issue 下書き
- [docs/design/](docs/design/) — Issue 単位の設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
- [docs/advisory/](docs/advisory/) — トピック別の指導文書（開発フロー・検証規律・UI規約・気象データ規律等）。一覧は[docs/advisory/README.md](docs/advisory/README.md)
