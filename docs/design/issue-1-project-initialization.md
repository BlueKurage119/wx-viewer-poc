# Issue #1「A1. プロジェクト初期化」設計

作成日: 2026-09-08

## 1. 目的

GitHub Issue #1「A1. プロジェクト初期化（React + TypeScript + Vite + Node.js）」を実装するため、フロントエンド、バックエンド、共通コードの開発基盤を構築する。

本Issueでは後続Issueが依存する実行・ビルド・静的検査の土台を整える。個別画面、気象データ取得、業務API、データベース、デプロイは実装しない。

## 2. 参照資料

- GitHub Issue #1「A1. プロジェクト初期化（React + TypeScript + Vite + Node.js）」
- [`../basic-design.md`](../basic-design.md) §2、§6.4、§6.5
- [`../issues-draft.md`](../issues-draft.md) A1
- `../../../cmk-gsx-mockup` の既存Node.js・Express.js構成
- `../../../mj-stats-viewer/mj-stats-viewer` のMaterial Web・React連携実装
- `../../../docs/260830_poc-v2-requirements/260830_00_poc-requirements-v2.md` §7

## 3. 設計方針

### 3.1 リポジトリ・パッケージ構成

npm workspacesを使用したモノレポ構成とし、フロントエンド、バックエンド、共通コードを別パッケージにする。

```text
wx-viewer-poc/
├── apps/
│   ├── web/                  # React + TypeScript + Vite
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── md/       # Material Webの型付きReactラッパー
│   │   │   ├── theme/         # MD3カラートークン生成・テーマ状態
│   │   │   ├── App.tsx
│   │   │   ├── index.css
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── api/                  # Node.js + Express 5 + TypeScript
│       ├── src/
│       │   ├── app.ts        # Expressアプリ生成
│       │   └── server.ts     # HTTPサーバー起動
│       ├── package.json
│       ├── tsconfig.json
│       └── tsconfig.build.json
├── packages/
│   └── shared/               # フロント・バック共通型
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── eslint.config.js
├── package.json              # workspaces・横断コマンド
├── package-lock.json
├── prettier.config.js
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
└── .nvmrc
```

`packages/shared`はIssue #1ではパッケージとしてビルドできる最小限の雛形のみ作成する。共通メタ情報などの実際の型定義はIssue A3で追加する。

### 3.2 採用技術

| 項目 | 採用内容 | 理由 |
|---|---|---|
| Node.js | 24.x LTS | 実装時点のLTSを使用し、後続開発期間中の保守期間を確保する |
| パッケージ管理 | npm workspaces | Node.js同梱のnpmだけで複数パッケージを管理し、追加ツールへの依存を避ける |
| フロントエンド | React + TypeScript + Vite | 基本設計および次期PoC要件に従う |
| バックエンド | Express 5 + TypeScript | 既存モックの知見を再利用でき、今回のREST API中心の用途に十分である |
| モジュール形式 | ES Modules | Viteと現行Node.jsの標準的な構成に合わせる |
| UI | `@material/web` + `@lit/react` | Material Webを`createComponent`で型付きReactコンポーネントへ変換する |
| カラーテーマ | `@material/material-color-utilities` 0.3.0固定 | 検証済みのAPIでシード色からlight/darkのMD3トークンを生成する |
| lint | ESLint flat config | TypeScript、React、Node.jsを単一の設定体系で検査する |
| format | Prettier | lintと整形の責務を分け、開発者・エージェント間の差分を抑える |
| API開発実行 | `tsx watch` | TypeScriptを開発時に直接実行し、変更時にAPIだけを再起動する |
| Web/API同時起動 | `concurrently` | ルートの単一コマンドで両開発サーバーを終了処理込みで管理する |

依存パッケージの具体的なパッチバージョンは実装時の安定版を使用し、生成した`package-lock.json`をコミットして再現性を確保する。メジャーバージョンはNode.js 24、Express 5を固定する。

ルートおよび各workspaceの`package.json`には`"engines": { "node": ">=24 <25" }`を指定する。`.nvmrc`・README記載と合わせ、`npm install`時点でもバージョン不一致を機械的に検知できるようにする。CI未導入のIssue #1では強制力は`npm install`実行時の警告に限られるが、後続のCI導入Issueでそのまま`engines-strict`等の検証に利用できる状態にしておく。

### 3.3 Material Webの利用境界

Material Webはメンテナンスモードであることを前提に採用する。React連携は、別プロジェクト`BlueKurage119/mj-stats-viewer`で動作実績のある`@lit/react`の`createComponent`方式を踏襲する。手書きのJSX IntrinsicElements宣言や独自のプロパティ転送処理は用いない。

- `apps/web/src/components/md`に型付きReactラッパーを置く。
- Issue #1では受け入れ確認用の`FilledButton`ラッパーを1つ作成する。
- ラッパーは`@material/web/button/filled-button.js`から`MdFilledButton`クラスを個別にimportし、`createComponent`へ`tagName`、`elementClass`、React本体を渡して生成する。
- アプリコードは`apps/web/src/components/md/index.ts`のバレルからReact名のコンポーネントをimportする。`<md-*>`生タグは使用しない。
- `@material/web/all.js`は使用しない。必要なコンポーネントの個別エントリーポイントだけをimportする。
- Material Web固有イベントが必要なラッパーでは、`createComponent`の`events`マッピングと`EventName`を用いてReactハンドラへ型を付ける。Issue #1の`FilledButton`は標準`click`だけを使用するため、独自イベント定義は追加しない。
- 色、タイポグラフィ、形状などのテーマ値はCSSカスタムプロパティとして定義し、コンポーネント内へ値を散在させない。
- Material Web 2.5系のtypescaleを使用する場合は、`@material/web/typography/md-typescale-styles.css`をCSSからimportする。廃止済みのJSエクスポートを使用しない。

`apps/web/package.json`には`"sideEffects": ["*.css"]`を指定する。これによりCSSの副作用importを保持しつつ、バレルに追加された未使用ラッパーモジュールを本番バンドルから除去できる構成にする。この指定に伴い、Webの`src`配下ではCSS以外の副作用専用bare importを禁止する。カスタム要素の登録は、実際に使用するラッパーのexportをimportすることで成立させる。

ラッパーはデザインシステムを作り直すものではない。`createComponent`による型付き変換と必要なイベントマッピングに留め、Issue #1で汎用コンポーネント群を先行実装しない。後続Issueで新しいMaterial Webコンポーネントが必要になった時点で、個別ラッパーとバレルexportを追加する。

### 3.4 MD3カラーテーマ基盤

カラーテーマは、別プロジェクト[`BlueKurage119/mj-stats-viewer`のIssue #1](https://github.com/BlueKurage119/mj-stats-viewer/issues/1)および対応実装を基礎にする。固定色を各コンポーネントへ直接指定せず、単一のシード色からMaterial 3のlight/dark両スキームを生成してCSSカスタムプロパティとして配布する。

#### 3.4.1 依存バージョンと生成方式

- `@material/material-color-utilities`は`0.3.0`をキャレットなしで固定する。参照実装で確認されている0.4系のモジュール解決問題を持ち込まない。
- `themeFromSourceColor`、`argbFromHex`、`hexFromArgb`、`TonalPalette`を使用する。
- ライブラリの標準`applyTheme()`は使用しない。0.3.0ではMaterial Web 2.5系が参照する`surface-container-*`等が不足するため、必要なCSS変数を`document.documentElement`へ自前で書き出す。
- 生成したテーマはシード色単位でメモ化し、モード切替のたびにパレット生成を繰り返さない。
- 実装は`apps/web/src/theme`に閉じ込め、DOMへのテーマ書き出しは`applyTheme.ts`だけが担う。

最低限、次のファイルを設ける。

```text
apps/web/src/theme/
├── seeds.ts          # シード色の単一情報源
├── applyTheme.ts     # MD3トークン生成と :root への反映
├── ThemeProvider.tsx # React状態、OS設定購読、永続化
└── index.ts          # 公開API
```

#### 3.4.2 既定シード色

既定シードは、既存モックアップが通常時のプライマリ色として使用しているGoogle Blue系の`#1A73E8`とする。

```ts
export const DEFAULT_THEME_SEED = '#1A73E8';
```

- シード色は`seeds.ts`の1か所だけに定義する。
- `#174EA6`は既存モックの警報時ヘッダー点滅色であり、通常テーマのシードには使用しない。
- シードから`--md-sys-color-primary`、surface、container、outline、error等の標準ロールを生成する。
- コンポーネントや画面CSSへ、通常の背景色・文字色・プライマリ色をHEXで重複定義しない。

#### 3.4.3 生成するトークン

`applyTheme.ts`は次を`:root`へ書き出す。

1. lightまたはdarkスキームの標準`--md-sys-color-*`トークン。
2. neutral paletteから補完する`surface-dim`、`surface-bright`、`surface-container-lowest`、`surface-container-low`、`surface-container`、`surface-container-high`、`surface-container-highest`。
3. primaryと同値の`--md-sys-color-surface-tint`。
4. `--md-sys-color-background`と`--md-sys-color-surface`の現行MD3トーンへの補正。
5. ネイティブUIとスクロールバーを追従させる`document.documentElement.style.colorScheme`。

Material Webコンポーネントとアプリ独自CSSは同じ`--md-sys-color-*`を参照する。

#### 3.4.4 警戒・通知色との分離

気象庁の警戒レベルや通知区分の色は情報の意味を表すため、テーマシードから生成・調和させない。

- 黒、紫、赤、黄の警戒レベル色は、後続の画面実装Issueで`--wx-alert-*`等の固定セマンティックトークンとして定義する。
- 正常・取得中・取得失敗・訓練等の状態色も、用途とコントラストを確認して別途定義する。
- セマンティック色はlight/darkそれぞれで視認性を調整してよいが、テーマ変更によって警戒段階の意味が変わらないようにする。
- 色だけで状態を表さず、文字、アイコン、形状を併用するという基本設計の要件を維持する。

Issue #1では警戒レベル色の具体値やカスタムカラーパレットを先行決定しない。

#### 3.4.5 カラーモード

テーマ設定は次の3値とする。

```ts
export type ColorModeSetting = 'light' | 'dark' | 'system';
```

- 初期値は`system`とする。
- `system`では`prefers-color-scheme: dark`を参照し、OS設定変更を購読して追従する。
- `light`または`dark`の手動設定はOS設定より優先する。
- 設定は`localStorage`の`wx-viewer:color-mode`へ保存する。
- storageの読み書きに失敗した場合は例外で画面を停止せず、`system`へフォールバックする。
- `ThemeProvider`は解決後のモードが変わったときに`useLayoutEffect`でテーマを適用する。

Issue #1の初期画面には、テーマ基盤を検証できる最小限のモード切替操作を設ける。これは本番の設定画面ではなく、後続Issueで共通シェルへ配置し直す前提の確認UIである。

#### 3.4.6 初期描画とタイポグラフィ

- `index.html`でReact起動前に保存済み設定とOS設定を読み、`color-scheme`とlight/darkの初期背景色を設定して白いフラッシュを抑える。
- 先行スクリプトと`ThemeProvider`は同じstorageキー・解決規則を使用する。
- FOUC対策用の固定背景色には、`DEFAULT_THEME_SEED`から生成したneutral toneの実値を使い、シード変更時は同時に更新する旨をコメントする。
- 日本語フォントはNoto Sans JPの400、500、700を読み込み、失敗時は`system-ui, sans-serif`へフォールバックする。
- `--md-ref-typeface-brand`と`--md-ref-typeface-plain`を`index.css`に定義する。
- `@material/web/typography/md-typescale-styles.css`をCSSから直接importする。

### 3.5 TypeScript方針

ルートの`tsconfig.base.json`に共通設定を置き、各workspaceから継承する。

- `strict: true`を有効にする。
- 未使用コードと意図しないfallthroughを検出する。
- WebはViteのビルド方式に合わせ、APIはNode.jsのES Modulesとしてビルドする。
- APIのビルド成果物は`apps/api/dist`へ出力する。
- `packages/shared`はWeb/APIの双方から参照でき、ブラウザ非互換のNode.js依存を持たせない。
- workspace間参照は相対パスの深掘りではなく、workspaceパッケージ名を使用する。

### 3.6 バックエンド構造

Expressアプリの生成とHTTP待受を分離する。

- `app.ts`はExpressアプリを生成・設定して返す。ポートを開かない。
- `server.ts`は環境変数を読み、`app.ts`のアプリを起動する。
- 後続IssueのAPIテストがポート競合なしでアプリを読み込める構造にする。
- JSONボディの受け付けなど、全API共通となる最低限のミドルウェアだけを設定する。
- 業務API、気象API、SQLite接続は追加しない。

雛形の稼働確認用として、次のエンドポイントだけを設ける。

```http
GET /api/health
```

正常時の契約は以下とする。

```json
{
  "status": "ok"
}
```

- HTTP status: `200 OK`
- Content-Type: `application/json; charset=utf-8`
- 認証: なし
- DBや外部サービスの状態確認: なし

このエンドポイントはプロセスの起動確認だけを目的とする。後続のデプロイIssueで必要になった場合は、Cloud Runのヘルスチェックにも利用できる。

### 3.7 開発サーバーとポート

既存モックや一般的なデフォルト設定との衝突を避けるため、提案時の番号からそれぞれ1を加え、次のポートを使用する。

| 対象 | ポート | URL |
|---|---:|---|
| Vite Web開発サーバー | 5174 | `http://localhost:5174` |
| Express API開発サーバー | 3001 | `http://localhost:3001` |

- Viteの`server.port`を`5174`に固定する。
- 意図せず別ポートで起動して見落とすことを防ぐため、Viteの`strictPort`を有効にする。
- APIの開発時既定ポートを`3001`とする。
- APIは`PORT`環境変数が指定された場合、その値を優先する。Cloud Runへの将来対応のためこの契約を維持する。
- Viteは`/api`を`http://localhost:3001`へプロキシする。
- WebからAPIを呼ぶ際は絶対URLを埋め込まず、同一オリジン相対の`/api/...`を使用する。
- 開発時はViteプロキシを使うため、Issue #1ではCORSミドルウェアを導入しない。

### 3.8 開発コマンド

ルート`package.json`から、少なくとも次のコマンドを実行できるようにする。

| コマンド | 動作 |
|---|---|
| `npm run dev` | WebとAPIの開発サーバーを並行起動する |
| `npm run build` | shared、API、Webを依存順にビルドする |
| `npm run typecheck` | 全workspaceのTypeScript型検査を行う |
| `npm run lint` | Web、API、sharedおよび設定ファイルを検査する |
| `npm run format` | 対象ファイルをPrettierで整形する |
| `npm run format:check` | 整形差分がないことを検査する |

`npm run dev`の終了時は、Web/APIの子プロセスが残らないようにする。

### 3.9 フロントエンド初期画面

初期画面は基盤確認専用とし、後続Issueの共通シェルや個別画面を先行実装しない。

表示内容は次に限定する。

- サービス名「防災気象情報表示サービス」
- 雛形が起動していることを示す短い説明
- Material Webのfilled buttonをラッパー経由で1つ表示
- 現在のカラーモード（system/light/dark）を表示
- ボタン操作によりカラーモードが切り替わり、背景、文字、ボタンが追従すること

これにより、React描画、TypeScript、Material Webの登録、カスタム要素のイベント連携、MD3テーマ適用を一度に確認する。

### 3.10 将来の本番配信を妨げない構成

Issue #1ではDockerfile、Cloud Run、CI/CD、Expressからの静的ファイル配信を実装しない。ただし、次期PoCの単一Cloud Run構成へ移行できるよう、以下を前提にする。

- 開発時はViteとExpressを別プロセスで動かし、フロント変更時にAPIを再起動しない。
- 本番ビルドではViteが静的成果物を生成できる。
- 後続のデプロイIssueでExpressからWeb成果物と`/api`を同一オリジン配信できる。
- Web、API、sharedの境界を保ち、本番PoCでFirestoreへ配信方式を変更しても画面コンポーネントや正規化データ型を全面変更しない。

## 4. 変更対象

Issue #1では以下を新規作成または更新する。

- ルートのnpm workspace設定、共通コマンド、Node.jsバージョン指定
- React + TypeScript + ViteのWeb雛形
- Express 5 + TypeScriptのAPI雛形
- shared workspaceの雛形
- Material Web・`@lit/react`依存、確認用の型付きラッパーと初期画面
- MD3テーマ生成、system/light/dark切替、タイポグラフィ、初期描画対策
- ESLint、Prettier、EditorConfig、TypeScript共通設定
- `.gitignore`
- 開発・検証手順を記載したREADME

既存の`docs`配下の設計・調査資料は、参照リンクの修正が必要な場合を除いて変更しない。

## 5. 対象外

- 共通シェル、地図、情報パネル、警報一覧、監視画面、通知UI
- 気象庁データの取得、パース、正規化
- `/api/health`以外のAPI
- SQLite、Firestore、マイグレーション
- AuthGate連携、認証、認可
- PWA、Service Worker、プッシュ通知
- Dockerfile、Cloud Run、GitHub Actions
- 本番向け静的配信、キャッシュ、圧縮、セキュリティヘッダー
- Material Web全コンポーネントのラッパー作成
- 自動テストフレームワークの本格導入

## 6. 実装手順

1. Node.js 24とnpm workspacesを前提としたルート設定を作成する。
2. `apps/web`にReact + TypeScript + Viteの最小構成を作成する。
3. `apps/api`にExpress 5 + TypeScriptの最小構成を作成し、アプリ生成と待受を分離する。
4. `packages/shared`にビルド可能な空の共通パッケージを作成する。
5. Viteのポート、strictPort、`/api`プロキシを設定する。
6. APIの既定ポート、`PORT`上書き、`GET /api/health`を実装する。
7. Material Webと`@lit/react`を導入し、`createComponent`による`FilledButton`ラッパーとバレルを作成する。
8. MD3テーマ生成、`ThemeProvider`、タイポグラフィ、FOUC対策を実装する。
9. テーマ確認操作を含む初期画面を作成する。
10. TypeScript strict設定、ESLint、Prettier、EditorConfigを設定する。
11. ルートの横断コマンドとREADMEを整備する。
12. 受け入れ条件を順に検証する。

## 7. 検証計画

### 7.1 インストール

クリーンな作業ツリーで次を実行し、workspace全体の依存関係をインストールできることを確認する。

```bash
npm install
```

### 7.2 開発起動

```bash
npm run dev
```

次を確認する。

- `http://localhost:5174`が表示される。
- `http://localhost:3001/api/health`が`200`と`{"status":"ok"}`を返す。
- `http://localhost:5174/api/health`もViteプロキシ経由で同じ応答を返す。
- WebまたはAPIのソース変更時、変更した側が更新される。
- 開発コマンド終了後に5174・3001番ポートのプロセスが残らない。

### 7.3 画面確認

ブラウザで次を確認する。

- Reactの初期画面がエラーなく表示される。
- Material Webのfilled buttonがMD3の外観で表示される。
- system/light/darkを切り替えると、背景、文字、filled buttonの配色が追従する。
- 再読み込み後も手動選択したモードが維持される。
- system選択時はOSのカラーモードへ追従する。
- 初期描画からテーマ適用まで、反対モードの白または黒い背景が目立って表示されない。
- ブラウザコンソールにエラーが出ない。

### 7.4 静的検査・ビルド

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
```

すべて終了コード0となることを確認する。警告を黙認して検査を通す設定にはしない。

## 8. 受け入れ条件

Issue #1は次をすべて満たしたとき完了とする。

1. npm workspacesとして`apps/web`、`apps/api`、`packages/shared`が構成されている。
2. Node.js 24.xを使用することが`.nvmrc`、各`package.json`の`engines`フィールド、READMEから分かる。
3. ルートで`npm run dev`を実行するとWebとAPIが同時起動する。
4. Webは`http://localhost:5174`、APIは`http://localhost:3001`で起動する。
5. `GET /api/health`が規定のJSONを`200`で返す。
6. WebからViteの`/api`プロキシを経由してヘルスチェックへ到達できる。
7. Material Webのfilled buttonが`@lit/react`の型付きReactラッパー経由で画面に表示され、操作できる。
8. `DEFAULT_THEME_SEED`の1か所からlight/dark両方のMD3トークンが生成される。
9. system/light/darkの切替、OS設定追従、手動設定の永続化が機能する。
10. Material Webコンポーネントと初期画面が同じ`--md-sys-color-*`トークンへ追従する。
11. `@material/material-color-utilities`が`0.3.0`に固定されている。
12. Noto Sans JPとMaterial Webのtypescale CSSが適用される。
13. TypeScriptの`strict`設定が有効である。
14. `npm run build`が成功する。
15. `npm run typecheck`が成功する。
16. `npm run lint`が警告・エラーなしで成功する。
17. `npm run format:check`が成功する。
18. READMEにセットアップ、開発起動、ポート、テーマ、検証コマンドが記載されている。
19. 個別画面、業務API、DB、デプロイ／CI設定が含まれていない。

## 9. Issue本文へ反映する事項

Issue本文の既存受け入れ条件に、少なくとも次を追記する。

- ルートの`npm run dev`でフロントエンドとバックエンドが同時起動する。
- Webは5174番、APIは3001番ポートを使用する。
- `GET /api/health`が`200`を返す。
- WebからViteプロキシ経由で`/api/health`へ接続できる。
- `npm run typecheck`と`npm run format:check`が成功する。
- `#1A73E8`の単一シードからlight/darkのMD3カラートークンを生成する。
- system/light/dark切替、OS設定追従、手動設定の永続化が機能する。
- `@material/material-color-utilities`を`0.3.0`に固定する。

## 10. 実装上の注意

- 既存モックアップのHTML/CSS/JavaScriptをIssue #1で移植しない。画面移植は対応する後続Issueで必要箇所を参照して行う。
- APIのポート番号をWebコードへ直接埋め込まない。Webは常に`/api`相対パスを使う。
- `packages/shared`へExpress、DOM、Material Webなど片側専用の依存を持ち込まない。
- アプリコードへ`<md-*>`生タグ、`@material/web/all.js`、`@material/web`のコンポーネント直接importを追加しない。
- `apps/web/package.json`の`sideEffects`指定により本番ビルドで除去されるため、CSS以外の副作用専用bare importを書かない。
- 通常のUIカラーは`--md-sys-color-*`を使用し、既定シード色や生成済みロール色をコンポーネントCSSへ重複記述しない。
- 警戒レベル色をMD3シードから生成・harmonizeしない。具体値は対応する後続Issueで決める。
- `index.html`のFOUC対策と`ThemeProvider`でstorageキー・モード解決規則を一致させる。
- lintエラーを一括disableする設定や、TypeScriptの`strict`を局所的に無効化する設定で受け入れ条件を回避しない。
- Material Webの確認用ボタンを、後続画面の仮実装へ拡張しない。
- 既存モックが使用する8080番ポートには変更を加えない。
