# wx-viewer-poc

防災気象情報表示サービスのPoC。npm workspacesによるモノレポで、フロントエンド(`apps/web`)、バックエンド(`apps/api`)、共通コード(`packages/shared`)を管理する。

設計の詳細は [docs/design/issue-1-project-initialization.md](docs/design/issue-1-project-initialization.md) を参照。

## セットアップ

Node.js 24.x LTSを使用する(`.nvmrc`参照)。

```bash
nvm use
npm install
```

## 開発起動

```bash
npm run dev
```

- Web: http://localhost:5174
- API: http://localhost:3001
- Webから`/api`はViteの開発プロキシ経由でAPIへ到達する(例: http://localhost:5174/api/health)。

`Ctrl+C`で終了すると、Web/APIどちらの子プロセスも残らない。

## ポート

| 対象                    | ポート |
| ----------------------- | -----: |
| Vite Web開発サーバー    |   5174 |
| Express API開発サーバー |   3001 |

APIは`PORT`環境変数が指定された場合、その値を優先する。

## テーマ(MD3)

- `apps/web/src/theme`に実装。`@material/material-color-utilities`(`0.3.0`固定)で単一シード色(`DEFAULT_THEME_SEED = '#1A73E8'`)からlight/dark両方のMD3カラートークンを生成し、`--md-sys-color-*`としてCSSへ反映する。
- カラーモードは`system` / `light` / `dark`から選択でき、`system`はOS設定に追従する。手動選択は`localStorage`(`wx-viewer:color-mode`)へ保存し、次回起動時も維持する。
- 警戒レベル色・通知区分色はこのテーマ基盤の対象外。後続Issueで別途セマンティックトークンとして定義する。

## 検証コマンド

```bash
npm run build         # shared → api → web の順にビルド
npm run typecheck     # 全workspaceの型検査
npm run lint          # ESLintによる静的検査
npm run format:check  # Prettierの整形差分チェック(差分があれば npm run format)
```

## 対象外(Issue #1時点)

個別画面、気象データ取得・正規化、業務API、DB、認証、PWA、Dockerfile/Cloud Run/CIは未実装。詳細は設計書§5を参照。
