# Issue #198 設計書: タイル配信プロファイルによるプロキシ／直接取得切替

対象Issue: #198（関連: #39 / #40 / #45 / #46）

## 1. 目的と範囲

### 1.1 やること

- 雨雲ナウキャストとキキクルについて、既存のAPI経由で画像を取得する `proxy` と、端末が気象庁 `jmatile` から画像を取得する `jma-direct` を、サーバーが配信するプロファイル識別子で切り替え可能にする。
- `config/polling.yaml` に全端末共通の `tileDeliveryProfile` を追加し、サーバー起動時に既存設定と一体で厳密検証する。既定値は現行挙動を維持する `proxy` とする。
- サーバーは任意URLではなく `proxy | jma-direct` の識別子だけを、ナウキャスト／キキクルの時刻一覧APIに含めて端末へ返す。
- 端末は時刻一覧APIから受け取ったプロファイルとコマ情報から、プロキシURLまたは既知の気象庁URLを内部生成する。
- `training` / `test` では、プロファイルにかかわらずタイルレイヤーを生成しない。`jma-direct` ではさらに画像取得不可・時間窓外（`imageAccess.allowed !== true`）でレイヤーを生成しない。`proxy` は夜間停止中も検証済みキャッシュを読める既存契約を維持する。
- 気象庁を配信元として利用していることを、両プロファイルで地図上に表示する。
- 将来、監視端末からサーバー上のプロファイルを変更できるように、設定値の参照を専用サービス境界へ集約する。

### 1.2 やらないこと

- 動的変更API、監視画面の設定UI、WebSocket等によるプッシュ配信、`polling.yaml` のホットリロード。
- 端末別・会場別・レイヤー別のプロファイル設定。本Issueでは全端末・ナウキャスト・全キキクル種別へ同じ値を適用する。
- 任意の配信元URLやURLテンプレートをサーバーから配信すること。
- 直接取得失敗時に `proxy` へ自動フォールバックすること。
- 気象庁の索引JSONを端末から直接取得すること。索引・取得可否・コマ一覧は引き続きサーバーの時刻一覧APIを唯一の入力とする。
- プロキシ用タイルAPI、サーバー側の保存・検証処理、事前取得方式の変更・削除。
- Issue #45 / #46 が定めた操作、再生、先読み、差替え、表示仕様の変更。
- DBスキーマ、操作履歴、監視APIの変更。

## 2. 確定事項

1. 設定は `config/polling.yaml` から起動時に読み込み、現時点では全端末共通とする。既定値は `proxy` とする。
2. サーバーは任意URLではなく配信プロファイル識別子 `proxy | jma-direct` を配信し、端末がURL生成方式を切り替える。
3. 将来の監視端末はサーバー上のプロファイルを変更する操作主体とする。本Issueでは変更API、設定UI、ホットリロードを実装しない。
4. `jma-direct` の取得失敗時に `proxy` へ自動フォールバックしない。
5. `jma-direct` の配信元は現行の気象庁 `https://www.jma.go.jp/bosai/jmatile/` とする。
6. `training` / `test` ではタイルレイヤーを生成しない。取得可否・時間窓は `jma-direct` で端末側ゲートに使う。`proxy` はタイルAPIへ要求し、夜間停止中も検証済みキャッシュは配信、キャッシュミスは停止応答とする。
7. 新プロファイルは次回の時刻一覧取得後に作るレイヤーから反映し、取得中タイルを中断しない。

## 3. 現状と成立条件

### 3.1 現行経路

```text
端末
  ├─ GET /api/weather/{nowcast|kikikuru}/times
  └─ GET /api/weather/.../tiles/{z}/{x}/{y}.png
       └─ APIサーバー ──取得／保存／PNG検証──> 気象庁 jmatile
```

- 時刻一覧APIは `controlStatus !== normal` で `unsupported_control_status`、空の `allowedZooms`、空データを返す。
- サーバーは `imageAccess` に時間帯設定と取得機能停止状態を投影する。
- 現行フロントは `controlStatus` と `allowedZooms` はレイヤー生成条件に使う一方、`imageAccess.allowed` をレイヤー生成条件に使っていない。これは `proxy` では意図された挙動であり、夜間停止中でもタイルAPIが検証済みキャッシュを返せる。画像要求時にサーバーが拒否できない `jma-direct` に限り、本Issueで `imageAccess.allowed` を明示的な条件へ加える。
- 時刻一覧は表示中レイヤーごとに60秒間隔で取得する。取得失敗時は最後の成功値を `stale` として保持する。
- `WeatherTileOverlay` の差替えキーは `id + urlTemplate` であり、プロファイル変更でURLが変われば別レイヤーとして扱われる。差替え処理は新レイヤーの読込完了またはタイムアウトまで旧レイヤーを維持する。

### 3.2 直接取得の成立条件と制約

| 観点 | 設計上の扱い |
| --- | --- |
| CORS | PNGを `<img>` / Leaflet `TileLayer` として表示するだけで、Canvasへ画素を読み出さない。現行の `crossOrigin: false` を維持する。製造・検収時には実ブラウザーで取得できることと、気象庁応答を再確認する |
| URL契約 | 既存サーバー取得実装と同じ `jmatile` パスをフロントの純関数で生成する。サーバー応答から任意URLを受け取らない |
| 上流負荷 | 端末ごとに同じ画像を取得し得る。プロキシの共有キャッシュ効果は失われる。本Issueではオーナー判断により許容するが、既定値は `proxy` のままとする |
| 取得制御 | 索引・コマ・`imageAccess` はサーバーから取得する。`jma-direct` は許可されたカタログからだけレイヤーを生成する。`proxy` は従来どおりタイルAPIへ要求し、サーバーがキャッシュ命中なら停止中も配信、ミスなら `acquisition_stopped` を返す。直接画像要求自体をサーバーで強制停止はできない |
| 反映遅延 | 設定変更機構を将来追加した場合も、端末への反映は次回の時刻一覧取得成功時（通常最大約60秒）となる。取得失敗中は最後に成功したカタログを保持する |
| 取得中断 | プロファイル更新を受けても既存レイヤーの画像要求を明示的にabortしない。新URLのレイヤー生成と既存の差替え規則に任せる |
| 障害時 | `tileerror` を既存表示へ反映するだけで、自動フォールバックしない。運用者が設定を `proxy` に戻し、サーバーを再起動するまでプロファイルは変わらない |
| 出典 | 地理院タイルに加え「気象庁」を常時表示する。プロキシでも画像の出典は同じなので表示条件を分けない |

`jma-direct` は性能改善と引き換えに、サーバーによる画像要求単位の認可・停止強制・保存済みPNG検証・共有キャッシュを通らない。これをプロファイルの意味として明示する。制御状態と出典は両プロファイルで同じ契約を守る一方、時間窓停止時は、`jma-direct` がレイヤーを生成しないのに対し、`proxy` は検証済みキャッシュを表示できるという経路固有の差がある。

## 4. 公開契約

### 4.1 共有型

`packages/shared/src/tileApi.ts` に次を追加する。

```ts
export type TileDeliveryProfile = 'proxy' | 'jma-direct';
```

`NowcastTimesResponse` と `KikikuruTimesResponse` の双方へ、必須フィールドを追加する。

```ts
readonly tileDeliveryProfile: TileDeliveryProfile;
```

- フィールドはトップレベルに置く。両APIで同じ意味・名前とし、ナウキャストの商品別、キキクル種別別には持たせない。
- `status: 'unsupported_control_status'` の応答にも現在のプロファイルを含める。ただし `allowedZooms: []` と空データのためレイヤーは生成しない。
- URL、ホスト名、認証情報、フォールバック先、端末別上書きは応答に含めない。
- 既存のレスポンスフィールド、タイルAPIの要求・応答、HTTPステータスは変更しない。

### 4.2 設定契約

`config/polling.yaml` のルートへ必須キーを追加する。

```yaml
tileDeliveryProfile: proxy
```

`PollingScheduleConfig` に `readonly tileDeliveryProfile: TileDeliveryProfile` を追加し、`validatePollingScheduleConfig()` は次を満たす。

- `proxy` と `jma-direct` だけを受理する。
- 欠落、型違い、空文字、大小文字違い、未知値を起動エラーにする。
- 既存どおり未知のルートキーを拒否する。
- 暗黙のフォールバックは行わない。「既定値」はリポジトリに同梱する `config/polling.yaml` の値が `proxy` であることを指す。
- DB初期化・HTTP待受より前に設定全体を検証する既存順序を維持する。

### 4.3 サーバー内のサービス境界

`apps/api/src/services/tileDeliveryProfileService.ts` を新設する。

```ts
export interface TileDeliveryProfileService {
  getProfile(terminal: TerminalDefinition): TileDeliveryProfile;
}

export function createStaticTileDeliveryProfileService(
  profile: TileDeliveryProfile,
): TileDeliveryProfileService;
```

- `server.ts` は起動時設定からサービスを1個生成し、ナウキャスト／キキクルAPIサービスへ注入する。
- 現実装は引数の `terminal` によらず共通値を返す。ただし呼出し境界には端末定義を渡し、将来の端末別解決をAPI応答生成箇所へ拡散させない。
- `NowcastApiService.getTimes()` と `KikikuruApiService.getTimes()` は注入されたサービスから要求端末のプロファイルを取得し、4.1の必須フィールドへ投影する。
- テスト用の `StartServerOptions.pollingSchedule` 経路にも同じ設定値とサービスを使い、本番用 `main()` と `startServer()` の2生成経路を一致させる。
- 本Issueでは setter、永続化、変更イベント、変更APIを作らない。将来はこのサービスの実装を可変ストアへ置換し、監視端末用APIだけが更新する。時刻一覧APIは同じ参照境界を使い続ける。

## 5. 端末側のURL生成と適用

### 5.1 時刻形式

APIの `baseTime` / `validTime` は厳密なISO 8601 UTC文字列である。`jmatile` のパスでは区切りなし14桁UTCへ変換する。

```text
2026-09-15T03:00:00.000Z -> 20260915030000
```

変換は文字列の記号除去ではなく、妥当な日時として検証してUTC各要素をゼロ埋めする純関数にする。不正値ではURLを生成せず、呼出し側がレイヤーを作らない契約とする。

### 5.2 ナウキャスト

`buildNowcastTileUrlTemplate()` に `tileDeliveryProfile` を必須入力として追加する。

| profile | 生成結果 |
| --- | --- |
| `proxy` | 現行どおり `/api/weather/nowcast/{product}/tiles/{z}/{x}/{y}.png?...` |
| `jma-direct` | `https://www.jma.go.jp/bosai/jmatile/data/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png` |

- `jma-direct` では `product` はURLへ含めない。N1/N2はカタログの系列区分であり、気象庁の画像パスは同一形式である。
- `terminalId`、`controlStatus` は直接URLへ含めない。
- 表示対象と先読み対象の双方が、適用中カタログの同じプロファイルを渡す。

### 5.3 キキクル

`buildKikikuruTileUrlTemplate()` に `tileDeliveryProfile` を必須入力として追加する。互換用の省略可能オーバーロードや `controlStatus = normal` の暗黙既定は残さず、全呼出しを明示オブジェクト形式へ統一する。

| profile | 生成結果 |
| --- | --- |
| `proxy` | 現行どおり `/api/weather/kikikuru/{layer}/tiles/{z}/{x}/{y}.png?...` |
| `jma-direct` | `https://www.jma.go.jp/bosai/jmatile/data/risk/{basetime}/{member}/{validtime}/surf/{imageId}/{z}/{x}/{y}.png` |

- `member` と `imageId` はサーバーが検証して返したコマ情報だけを用いる。URLパス要素として安全な既存カタログ契約を維持する。
- `terminalId`、`controlStatus`、アプリ内の `layer` は直接URLへ含めない。

### 5.4 レイヤー生成条件

ナウキャストの `usePlayback()` とキキクルの `useKikikuruLayerState()` は、次をすべて満たす場合だけ表示・先読み用の `WeatherTileOverlayFrame` を生成する。

1. 対象レイヤーが有効である。
2. `controlStatus === 'normal'` である（`training` / `test` は不可）。
3. カタログが `status: 'ok'` から構築され、`allowedZooms` が空でない。
4. `jma-direct` の場合だけ `imageAccess?.allowed === true` である。`proxy` ではこの条件を評価しない。
5. 対象コマが現在のカタログに存在する。
6. URLの時刻・パス要素を正常に生成できる。

条件を外れた場合は表示・先読みレイヤーを `null` / 空にし、既存のレイヤー破棄経路を使う。ただし `proxy` は `imageAccess` を端末側ゲートにせず、夜間停止中も従来どおりタイルAPIへ要求する。タイルAPIは検証済みキャッシュ命中なら200で画像を配信し、キャッシュミスなら503 `acquisition_stopped` を返す。この判定を端末が先回りしてはならない。

### 5.5 プロファイル切替時の状態遷移

```text
時刻一覧の取得成功
  └─ 応答を新カタログへ変換（profileを含む）
      ├─ 再生停止中: 次に生成する表示／先読みURLへ即時反映
      └─ 再生中: Issue #45のactiveCatalog固定を維持し、再生停止時に最新カタログを反映
            └─ URL変更によりswapKey変更
                └─ 既存差替え処理で新レイヤーを生成（既存要求を明示中断しない）
```

- 「次のレイヤー生成から反映」は既存の差替え一貫性を壊さないことを意味する。プロファイル受信と同時に表示中画像を消去しない。
- カタログ取得失敗時は既存どおり最後の成功カタログを保持するため、プロファイルも最後の成功値を維持する。失敗を `proxy` への切替契機にしない。
- ナウキャスト再生中のカタログ固定は既存仕様を優先する。最大60秒という通常反映時間は再生停止中の目安であり、再生が継続する間は反映を保留する。

## 6. 出典表示

`MapAttribution.tsx` に気象庁への外部リンクを追加し、地理院タイルのリンクと並べて常時表示する。

- 表示文言は簡潔に `気象庁` とする。
- リンク先は気象庁ホームページとし、既存リンク同様 `target="_blank"` / `rel="noreferrer"` / `attribution-link` を使う。
- プロファイルや現在のレイヤーで表示を切り替えない。プロキシ配信時もデータの出典は気象庁である。
- 既存のMD3トークン、フォーカス表示、地理院リンクを維持し、HEX値を追加しない。

## 7. 変更対象

| ファイル | 変更内容 |
| --- | --- |
| `config/polling.yaml` | `tileDeliveryProfile: proxy` を追加 |
| `packages/shared/src/tileApi.ts` | プロファイル型と両時刻一覧レスポンスの必須フィールドを追加 |
| `apps/api/src/config/pollingSchedule.ts` | 設定型・ルートキー・値の厳密検証を追加 |
| `apps/api/src/services/tileDeliveryProfileService.ts` | 静的プロファイル参照のサービス境界を追加 |
| `apps/api/src/services/nowcastApiService.ts` | 端末に対応するプロファイルを全時刻一覧応答へ追加 |
| `apps/api/src/services/kikikuruApiService.ts` | 同上 |
| `apps/api/src/server.ts` | 本番／テスト両経路でサービスを生成・注入 |
| `apps/web/src/api/nowcastTimes.ts` | 必須プロファイルを厳密に検証 |
| `apps/web/src/api/kikikuruTimes.ts` | 同上 |
| `apps/web/src/map/nowcast/nowcastCatalog.ts` | プロファイルをカタログへ保持 |
| `apps/web/src/map/kikikuru/kikikuruCatalog.ts` | 同上 |
| `apps/web/src/map/nowcast/nowcastTileUrl.ts` | プロファイル別URL生成、ISO→14桁UTC変換 |
| `apps/web/src/map/kikikuru/kikikuruTileUrl.ts` | 同上、旧オーバーロード廃止 |
| `apps/web/src/map/nowcast/usePlayback.ts` | プロファイル伝播、`jma-direct` のみに適用する `imageAccess` 表示・先読みゲート |
| `apps/web/src/map/kikikuru/useKikikuruLayerState.ts` | プロファイル伝播、`jma-direct` のみに適用する `imageAccess` 表示ゲート |
| `apps/web/src/map/MapAttribution.tsx` | 気象庁の出典リンク追加 |
| 関連する `packages/shared/tests`、`apps/api/tests`、`apps/web/tests` | 8章の契約・回帰テストを追加／更新 |

以下は変更しない。

- プロキシ用のExpressタイルルートと要求パーサー
- `nowcastService` / `kikikuruService` / タイルストア／PNG検証
- `WeatherTileOverlay` の差替え・先読み保持・エラー通知の仕組み
- DB、migration、監視・取得制御API
- `docs/basic-design.md` および他Issueの設計書

## 8. テスト設計

### 8.1 共有契約・設定

- 型テスト／レスポンスfixtureで両時刻一覧応答にプロファイルが必須であることを確認する。
- `pollingScheduleLoader.test.ts` で同梱設定が `proxy` として読めること、`jma-direct` を受理すること、欠落・未知値・型違い・大小文字違いを拒否することを完全一致で確認する。
- 起動失敗テストで不正プロファイル時にDB初期化・待受へ進まない既存契約を維持する。

### 8.2 API

- ナウキャスト／キキクルAPIテストを `proxy` と `jma-direct` の双方で行い、`normal` と `unsupported_control_status` の全成功応答に注入値がそのまま含まれることを確認する。
- 異なる端末IDでも現時点では同じ値になることを確認する。
- プロキシ用タイルルートの既存テストは変更後も全件通し、URL・クエリ・ステータス・画像配信契約が変わらないことを確認する。

### 8.3 URL生成

- ナウキャスト／キキクルについて、同じ固定コマから `proxy` と `jma-direct` のURLテンプレートを完全一致で検証する。
- 日付境界、うるう日、1桁月日時分秒のゼロ埋めを検証する。
- 不正ISO日時、未知プロファイルをURLとして扱わないことを検証する。
- `jma-direct` URLに `terminalId` / `controlStatus` が含まれず、プロキシURLの既存クエリキーが欠落しないことを確認する。

### 8.4 レイヤー生成・切替

- 両機能の `jma-direct` で、`normal + allowedZoomsあり + imageAccess.allowed=true` のときだけURLが生成されることを確認する。
- `jma-direct` は `training`、`test`、`imageAccess.allowed=false`、`imageAccess=null`、`allowedZooms=[]`、コマなしの各ケースで表示・先読みレイヤーが生成されないことを確認する。
- `proxy` は `training`、`test`、`allowedZooms=[]`、コマなしではレイヤーを生成しない一方、`imageAccess.allowed=false` または `imageAccess=null` だけを理由に抑止しないことを確認する。
- 夜間停止中の `proxy` で、検証済みキャッシュ命中は既存タイルAPIから200、キャッシュミスは503 `acquisition_stopped` となる #39 の契約を回帰テストする。`imageAccess.allowed=false` の時刻一覧を受けた端末から実際にタイル要求が発生することも確認する。
- 次の成功カタログで `proxy -> jma-direct` と `jma-direct -> proxy` を切り替えたとき、フレームIDが同じでもURL変更により新レイヤーになることを確認する。
- 取得失敗でカタログが `stale` になった場合は最後の成功プロファイルを維持し、自動フォールバックしないことを確認する。
- ナウキャスト再生中は適用中カタログのプロファイルを表示・先読みに使い、停止後に最新カタログのプロファイルへ移ることを確認する。
- プロファイル変更時に既存レイヤーを読込途中で明示中断せず、既存の差替え完了／タイムアウト規則が働くことを確認する。

### 8.5 出典・実ブラウザー

- 地図に `地理院タイル` と `気象庁` のリンクが常時存在し、リンク属性と既存のアクセシビリティ表示を確認する。
- 実ブラウザーで `jma-direct` を使用し、ナウキャストとキキクルのPNGが表示でき、コンソールにCORS／mixed-contentエラーが出ないことを確認する。
- DevToolsのNetworkで画像要求先が `www.jma.go.jp/bosai/jmatile/` であり、アプリのタイルAPIを経由していないことを確認する。
- 同じコマ・表示範囲で、初見タイルの所要時間を `proxy` の未キャッシュ時と `jma-direct` でそれぞれ3回以上測定する。タイルごとの応答時間と、レイヤーの差替え完了までの時間を記録し、直接モードがIssue記載の比較基準（プロキシ未キャッシュ0.46〜5.5秒／枚）より短縮されることを確認する。上流状況に左右されるため、同時刻・同範囲・ブラウザーキャッシュ無効の条件を揃える。

テスト追加時は `docs/rules/05-verification-protocol.md` に従い、実装前のred確認を行う。受け入れ条件に直接対応する新規テストは、意味を変えない対照改変がSURVIVEDすることを確認した後、プロファイル分岐・ゲート・必須フィールドを意図的に壊して失敗することを確認し、結果を製造報告へ記録する。

## 9. 受け入れ条件

- [ ] `config/polling.yaml` の `tileDeliveryProfile: proxy` で従来と同じプロキシURLを生成し、既存のナウキャスト／キキクルのAPI配信契約・表示・テストが回帰しない。
- [ ] 設定値 `proxy | jma-direct` 以外（欠落、型違い、未知値、大小文字違い）では、DB初期化・HTTP待受より前に理由を含む起動エラーとなり、暗黙に `proxy` へ戻らない。
- [ ] ナウキャスト／キキクルの全時刻一覧成功応答が、任意URLではなく必須の `tileDeliveryProfile` を返す。`unsupported_control_status` 応答にも識別子はあるが、レイヤーは生成されない。
- [ ] 全端末・全対象レイヤーへ起動時の同一プロファイルが適用され、APIサービスは設定を直接参照せず `TileDeliveryProfileService` 経由で解決する。
- [ ] `jma-direct` では、ナウキャストとキキクルのタイル要求が現行の気象庁 `jmatile` URLへ直接送られ、アプリのタイルAPIを経由しない。索引は引き続きアプリの時刻一覧APIから取得する。
- [ ] `jma-direct` のURLが、ナウキャストでは `basetime/none/validtime/surf/hrpns`、キキクルでは `basetime/member/validtime/surf/imageId` を用いて正しく生成される。
- [ ] 両プロファイルで `training` / `test`、`allowedZooms=[]`、コマなしのいずれかなら、表示用・先読み用タイルレイヤーを生成しない。
- [ ] `jma-direct` は `imageAccess.allowed !== true` または時間窓外なら表示用・先読み用タイルレイヤーを生成しない。
- [ ] `proxy` は `imageAccess.allowed=false` または `null` だけを理由に端末側でレイヤーを抑止しない。夜間停止中もタイルAPIへ要求し、検証済みキャッシュ命中は200で表示、キャッシュミスは503 `acquisition_stopped` となる既存契約を維持する。
- [ ] 時刻一覧の次回取得成功後、次に生成するレイヤーから新しいプロファイルが使われる。表示中・取得中のタイルを明示中断せず、既存の差替え規則を維持する。ナウキャスト再生中は再生停止まで既存のactiveCatalogを維持する。
- [ ] 時刻一覧取得失敗または直接タイル取得失敗を契機に、自動的に `proxy` へ切り替わらない。直接タイル失敗は既存のタイルエラー表示へ反映される。
- [ ] `proxy -> jma-direct -> proxy` の往復で、同じコマでもURLの変更が差替え判定に反映される。
- [ ] 地図上に「地理院タイル」と「気象庁」の出典リンクが両プロファイルで常時表示される。
- [ ] 実ブラウザーでナウキャスト／キキクルの直接取得が成立し、CORS・mixed-contentエラーがない。
- [ ] 同条件・各3回以上の実測で、`jma-direct` の初見タイル取得時間がIssue記載のプロキシ未キャッシュ基準より短縮され、測定条件と結果が検収報告に残る。
- [ ] 動的変更API、設定UI、ホットリロード、端末別設定、任意URL配信、DB変更を実装していない。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web` がすべて成功する。

## 10. ユーザー判断を要する点・先送り事項

### 10.1 本設計で判断済み

- 配信先はサーバーがURLを指示するのではなく、プロファイル識別子を指示し、端末が内部切替する。
- 設定単位は全端末共通、対象はナウキャストとキキクルの双方、既定値は `proxy`。
- 直接取得先は気象庁 `jmatile`、失敗時の自動フォールバックは行わない。
- 切替は時刻一覧の取得と既存レイヤー差替え境界で行い、取得中画像を中断しない。

### 10.2 先送り事項

- 監視端末からの変更APIの認可、監査記録、競合制御、永続化先、再起動後の復元規則。
- 動的変更時の即時通知方式（60秒ポーリングの継続、短周期化、SSE/WebSocket等）。
- 端末別・会場別・レイヤー別の上書きと優先順位。
- 気象庁側の仕様・利用条件・可用性が変わった場合の別配信基盤。
- 直接取得による端末数分の重複アクセスが運用上許容できる端末台数の上限。PoCの実運用計測後に判断する。

上記先送り事項は、本Issueの静的な全端末共通プロファイルとサービス境界の実装を妨げない。
