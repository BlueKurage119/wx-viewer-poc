# wx-viewer-poc

防災気象情報表示サービスのPoC。npm workspacesによるモノレポで、フロントエンド(`apps/web`)、バックエンド(`apps/api`)、共通コード(`packages/shared`)を管理する。技術スタック・画面構成・ポート番号は [README.md](README.md) を参照。設計の全体像は [docs/basic-design.md](docs/basic-design.md)(協議記録。【確定】【設計案】【未確定】のタグで確度を区別している)。

```bash
npm run dev            # web(5174) + api(3001) を同時起動
npm run build           # shared → api → web の順にビルド
npm run typecheck       # 全workspaceの型検査
npm run lint             # ESLintによる静的検査(--max-warnings 0)
npm run format:check    # Prettier整形差分チェック
npm run test -w apps/web  # 対象workspaceのテスト(package.jsonのtestスクリプトが定義されているworkspaceのみ)
```

---

## 破ると静かに壊れる制約

**エラーも警告も出ずに壊れる**ものだけをここに集約している。変更する前に必ず読むこと。

### 1. `apps/web` に副作用のためだけの bare import を書かない

`apps/web/package.json` に `"sideEffects": ["*.css"]` を宣言している。CSS以外の `import './foo'` 形式(副作用目的のimport)は**本番ビルドで黙って除去される**。devサーバーでは動くため気づけない。カスタム要素の登録は「ラッパーのexportを使う」ことで成立させる。

### 2. `@material/material-color-utilities` は `0.3.0` 固定(キャレットなし)

`apps/web/package.json` で明示的に固定している。`npm update`等で勝手に上げない。0.4.x系は既知のパッケージング不具合(拡張子なしimportの解決失敗)があるため避けている(mj-stats-viewerでの検証を踏襲)。

### 3. `<md-*>` の生タグを直書きしない

Material Webのコンポーネントは必ず `apps/web/src/components/md` のバレル(`index.ts`)からexportされた型付きラッパーをimportする。未ラップのコンポーネントが必要になったら、ラッパーを追加してからバレルに載せる。

### 4. 色をハードコードしない

配色は `apps/web/src/theme/` がランタイムに生成し、`--md-sys-color-*` としてCSS変数で供給する。シード色は `apps/web/src/theme/seeds.ts` の `DEFAULT_THEME_SEED`(`#1A73E8`)のみで完結させる。共通シェルはダーク固定(README参照)。警戒レベル色・通知区分色はこのMD3基盤の対象外で、別途セマンティックトークンとして定義する(basic-design.md §5.7参照、未着手)。

### 5. `index.html` と `ThemeProvider.tsx` のlocalStorageキーは一致させる

いずれも `wx-viewer:color-mode`。FOUC対策で `index.html` 側に先読みロジックがあるため、キー名を個別に変更すると同期が壊れる。

### 6. basic-design.mdの確度タグを尊重する

【確定】はユーザーとの対話で確認済みの事項、【設計案】【未確定】は未決事項。設計書・実装のいずれでも、【設計案】を無断で【確定】扱いにしない。

---

## 開発フロー

Issue単位で、サブエージェント3体を直列で回す。役割ごとの規律は [`.claude/agents/`](.claude/agents/) の定義ファイルに集約してある(統括担当は、対象Issue・ブランチ名・設計書パスなど、その回に固有の情報だけを渡す)。

| 役割 | 担当 | model | 成果物 |
|---|---|---|---|
| ヒアリング | 統括担当(親エージェント) | — | ユーザーとの対話で確定させた判断事項(designer起動時に渡す) |
| 設計 | `wxviewer-designer` | opus | `docs/design/issue-N-<slug>.md`(受け入れ条件を含む)。コードは書かない |
| 製造 | `wxviewer-builder` | sonnet | 設計書だけを唯一の仕様として実装。コミットまで(push・PRはしない) |
| 検収 | `wxviewer-inspector` | opus | 受け入れ条件を実行して検証し、通過したらpushしてPRを作成する。マージはしない |

統括担当(ユーザーと直接対話するメインセッション)はフェーズ間の判断・レビュー・マージを担い、自分では実装しない。サブエージェントはバックグラウンドで動作しユーザーと直接対話できないため、**ヒアリングは統括担当の責務とする。**

**このプロジェクトは他プロジェクトの3体構成と異なり、designer着手前に統括担当によるヒアリングフェーズを挟む。** `docs/issues-draft.md` のIssue項目はあっさりとした内容(実装タスク単位の見出しと参照章番号のみ)であるため、統括担当が`AskUserQuestion`等でユーザーに本質的な論点を確認し、確定した判断をIssue番号とあわせてdesignerへ渡す。designer自身は設計中に新たな要ヒアリング事項を見つけても自分で決めず、最終返答で統括担当に投げ返す(→統括担当が追加ヒアリングするか判断)。詳細は [`.claude/agents/wxviewer-designer.md`](.claude/agents/wxviewer-designer.md)。

設計書は使い捨てではなく、後続Issueの参照資産としてコミットする(`docs/design/issue-1-project-initialization.md`が書式・粒度の手本)。

### 検証の規律(詳細は各エージェント定義を参照)

- **redを先に確認する** — 新しいテストは、実装を壊して実際に落ちることを確認してから完成とする
- **ミューテーション判定の前に対照実験を行う** — 意味を変えないダミー改変がSURVIVEDになることを先に確かめる。「常にKILLEDに見える」故障モードが実在する
- **発見はトリアージする** — 到達経路の無い欠陥を修正ラウンドに変換しない

### 気象データ固有の注意

- **訓練データと本番相当データを混同しない。** 訓練通知機能(basic-design.md §3.4)の`isTraining`フラグが伝播すべき箇所(通知・履歴・表示)を、実装・検証のいずれでも本番データと同一視しない。
- **availability(`available`/`stale`/`unavailable`、basic-design.md §6.3)の3状態を、単純なOK/NGに簡略化しない。** stale時は前回値を保持しつつ鮮度低下を表現する。
- 気象庁XML電文のサンプル・提供仕様は、実データ・公式資料(取得方法レポート `docs/data-acquisition-report.md`)と照合できたものだけを設計上の「確定」事実として扱う。憶測で電文仕様を補わない。

---

## 参照ドキュメント

- [docs/basic-design.md](docs/basic-design.md) — 基本設計(協議記録)
- [docs/issues-draft.md](docs/issues-draft.md) — Issue下書き(Epic単位)
- [docs/design/](docs/design/) — 各IssueのIssue単位設計書
- [docs/data-acquisition-report.md](docs/data-acquisition-report.md) — 気象データ取得方法の検証記録
