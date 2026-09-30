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

## APIのSQLite永続化

APIはHTTP待受の前にSQLiteを初期化し、`apps/api/migrations/`の未適用SQL migrationを番号順に適用する。既定のDBファイルは`apps/api/data/wx-viewer.sqlite3`で、Git管理対象外である。

`WX_VIEWER_DB_PATH`で保存先を指定できる。絶対パスはそのまま、相対パスはAPI workspace（`apps/api`）から解決する。

```bash
WX_VIEWER_DB_PATH=./local.sqlite3 npm run dev -w apps/api
```

## テーマ(MD3)

- `apps/web/src/theme`に実装。`@material/material-color-utilities`(`0.3.0`固定)で単一シード色(`DEFAULT_THEME_SEED = '#1A73E8'`)からlight/dark両方のMD3カラートークンを生成し、`--md-sys-color-*`としてCSSへ反映する。
- 共通シェルはダーク固定。保存値やOS設定に追従せず、切替UIは設けない。ThemeProviderの汎用モード基盤は保持し、アプリ起動側から`fixedMode="dark"`を指定する。ヘッダーのみライトのトークンを局所適用する。
- 警戒レベル色・通知区分色はこのテーマ基盤の対象外。後続Issueで別途セマンティックトークンとして定義する。

## 取得周期・鮮度設定（config/polling.yaml）

APIの気象データ定期取得およびオンデマンド画像取得の制御は、リポジトリルートの `config/polling.yaml` で行います。

- **時間帯別周期**: JSTベースの時間帯ごとに、XML通常・画像索引（雨雲／キキクル）・アメダスの取得周期（秒）と、画像本体のオンデマンド取得許可（`nowcastEnabled` / `kikikuruEnabled`）を設定します。`null` を指定した対象はその時間帯に定期取得を停止します。
- **鮮度判定（stale）閾値**: XML（`freshness.xml`）と画像索引（`freshness.imageCatalog`）のstale判定秒数を独立して設定します（初期値各300秒）。
- **設定変更・反映**: 設定ファイルを編集後、APIプロセスを再起動することで反映されます（再ビルド不要）。
- **厳密検証**: 起動時に24時間被覆、未知・欠落キー、型の厳密チェックを行います。設定が不正な場合は、DB初期化・待受・上流呼出しを行わずに起動失敗します。

手元だけ設定を変える場合は `config/polling.local.yaml` を作成します。このファイルは Git 管理外です。項目ごとに共有設定へ重ねられ、入れ子の未指定項目は共有値を保持します。例:

```yaml
tileDeliveryProfile: jma-direct
freshness:
  xml:
    staleAfterSeconds: 600
```

`periods` を指定すると配列全体が置き換わるため、24時間を覆う全区間と各区間の必須項目を記述してください。`NODE_ENV=production` ではローカル設定を読み込みません。変更は API の再起動で反映されます。不正なローカル設定がある場合は共有設定へ戻さず起動に失敗します。起動ログには実際の読み込み元と上書き状態を表示します。

## 会場設定（config/venues.yaml）

会場の名称、地図基準位置、警報・予報・アメダス・気象防災速報の対象は、リポジトリルートの `config/venues.yaml` で管理します。ルートは `venues` だけで、各会場には `id`、`name`、`experimental`、`mapReference`、`warning`、`warningTimeseries`、`broadForecast`、`temperatureForecast`、`amedas`、`bosaiBulletin` を指定します。ID は英小文字で始まる 32 文字以内の英小文字・数字・ハイフンです。

各コードは文字列で指定します。市町村コードは7桁、府県・広域予報区域は6桁、気温・アメダス地点は5桁、アメダス要素は8桁、速報区域は6または7桁です。速報区域リストには市町村警報区域と広域予報区域を含め、重複させません。

設定を変更した場合は API を再起動してください。起動中の設定は変わりません。開発時だけ `config/venues.local.yaml` を置くと、同じ ID の項目を差分上書きし、新しい ID の会場を追加できます。ローカル差分に削除指定はありません。`NODE_ENV=production` ではローカル差分を読み込みません。

YAML の読込、構文、未知キー、必須項目、型、コード形式、会場内の整合性を起動前に検証します。不正な設定や端末台帳にある会場の欠落は、DB 初期化・HTTP待受・上流取得より前に起動を失敗させます。Web は `/api/config/venues` を初回描画前に取得します。

## 検証コマンド

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm run format:check
npm run test --workspaces --if-present
```

CIと同じ順序でローカル検証を再現できます。clean checkout環境では先行して `npm run build` を実行することで、依存workspaceの型定義およびビルド成果物が準備されます。

## CI（GitHub Actions）

`main` ブランチ向けPull Requestの作成・更新時に自動実行されます。

- **確認方法**: PRのChecksタブから `CI` ワークフローの `検証` ジョブを開き、失敗ステップとnpmログを確認します。
- **必須チェック設定手順（初回CI成功後・ユーザー作業）**:
  リポジトリの **Settings** → **Branches**（または **Rules** / Rulesets）で既存の `main` 保護ルールを確認し、「Require status checks to pass before merging」で `検証` を選択して追加します（既存ルールを重複作成しないようにしてください）。なお、必須チェックの設定変更は本Issueの自動操作には含まれません。

## 対象外(Issue #1時点)

個別画面、気象データ取得・正規化、業務API、DB、認証、PWA、Dockerfile/Cloud Runは未実装（CIはIssue #147で実装済み）。詳細は設計書§5を参照。

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

## 端末設定（config/terminals.yaml）

端末 ID、表示名、H/K モード、所属会場は `config/terminals.yaml` で管理します。ルートは `terminals` のみで、1 件以上の端末を指定します。各端末には `id`、`name`、`mode`、`venueId` が必要です。`id` は英小文字で始まる 32 文字以内の英小文字・数字・ハイフンです。`name` は前後空白なしの 1〜80 文字で、全端末で一意にします。同じ会場・モードの端末は複数登録できます。

```yaml
terminals:
  - id: hkeagh01
    name: 東地区外務H1
    mode: H
    venueId: east
```

変更後は API を再起動してください。再ビルドは不要です。開発時だけ Git 管理外の `config/terminals.local.yaml` を置くと、同じ ID の項目を差分上書きし、新しい ID の端末を追加できます。新しい ID には全項目が必要です。削除指定はありません。`NODE_ENV=production` ではローカル差分を読み込みません。

```yaml
terminals:
  - id: hkeagh01
    name: 東地区外務H2
  - id: hkeagh02
    name: 東地区外務H3
    mode: H
    venueId: east
```

共有設定とローカル差分は API 起動時に検証します。不正な設定があれば、DB 初期化や HTTP 待受の前に起動が失敗します。Web はページ更新時に会場・端末設定を取得し直します。
