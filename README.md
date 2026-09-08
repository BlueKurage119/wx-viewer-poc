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
- 共通シェルはダーク固定。保存値やOS設定に追従せず、切替UIは設けない。ThemeProviderの汎用モード基盤は保持し、アプリ起動側から`fixedMode="dark"`を指定する。ヘッダーのみライトのトークンを局所適用する。
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


## 共通シェル（Issue #2）

設計・試作仕様は [共通シェル設計](docs/design/issue-2-common-shell.md) を参照。

- 東地区外務H1: http://localhost:5174/hkeagh01
- 東地区外務K1: http://localhost:5174/kkeagh01
- TRC公共H1: http://localhost:5174/htrcph01
- TRC公共K1: http://localhost:5174/ktrcph01

Hは防災気象情報・警報一覧、Kは加えて気象通報取得監視を表示する。ビューの内容・通知の判定や確認操作は後続実装。

開発時の表示確認は、端末URLへ `?shellPreview=1` を付ける（例: http://localhost:5174/kkeagh01?shellPreview=1）。下部ツールバーでサンプル状態を切り替える。本番ビルドにはこの操作UIを表示しない。

```bash
npm run test -w apps/web  # 端末・遷移・通知表示境界の回帰テスト
npm run preview -w apps/web -- --port 4174 --strictPort  # ビルド後の配信確認
```

開発／ビルドプレビューは未登録端末へのHTMLアクセスに404を返す。本番配信環境でも同等の設定を行う。SPAフォールバックの場合もクライアント側で未登録IDを拒否し、既存端末のシェルを表示しない。
