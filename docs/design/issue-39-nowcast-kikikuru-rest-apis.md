# Issue #39・#40 ナウキャスト・キキクルの索引・PNG 配信 API 統合設計

## 1. 状態・前提

設計担当・#40 調査協力: Codex (GPT-6 Astra) / 2026-09-14。設計承認待ち。製造は #39・#40 をまとめてユーザーによる AGY 手動委託予定であり、本書の作成は製造開始を意味しない。

【ユーザー確定】ヒアリング事項:

- 保存索引を JSON、画像を単体 GET の PNG として公開する。
- N1/N2 の同じ validTime の候補を区別して両方返す。API が代表候補を選ばない。
- 一覧要求では保存索引のみ読み、鮮度の 3 状態と索引・画像それぞれの取得許可・停止理由を返す。
- training/test では非提供とし、normal の実データを流用しない。

【設計承認対象】URL、DTO、HTTP ステータスとヘッダー、初期化中の応答等の以下の具体案は本書の設計承認対象である。採用案は各項目につき本書の 1 案に固定し、製造担当が選び直すことはしない。端末指定は既存 REST と合わせ、保存例外は 500 として既存サービスの部分成功保証を増やさない。画面の再読込頻度は後続へ残す。

## 2. 参照資料と現状

| 資料・実装                                                                                                                                   | 設計判断の根拠                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Issue #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)・[Issue #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | 実在時刻一覧とキャッシュ経由の画像配信。地図 UI は対象外。                                                                      |
| [基本設計](../basic-design.md) §4・§6.2、[棚卸し](../audit-epic-a-d.md)                                                                      | API 契約は今回の設計対象。基本設計の未確定事項を確定扱いしない。                                                                |
| [#20 設計](issue-20-nowcast-tiles.md)、[#24 設計](issue-24-time-based-polling-scheduler.md)                                                  | 保存索引参照、now ±60 分窓、共用サービス、画像取得許可と索引鮮度の分離。#20 の古い stale GET 抑止は #24 で撤回済み。            |
| `apps/api/src/polling/nowcastService.ts`、`nowcastTypes.ts`                                                                                  | readCatalog は同期かつ HTTP なし。fetchFrameTiles は完全一致フレーム検証・キャッシュ検証・座標別取得を実装済み。REST は未実装。 |
| `apps/api/src/polling/nowcastTileStore.ts`                                                                                                   | verifyTile はサイズ・SHA-256・既存 PNG 構造検証を済ませた Buffer を返す。                                                       |
| `apps/api/src/server.ts`、`imageServices.ts`                                                                                                 | scheduler と閲覧で同じインスタンスを使う。HTTP 待受の後に画像サービスを初期化する。許可 zoom は現状 `[10]`。                    |
| `packages/shared/src/weatherApi.ts`、[#33 設計](issue-33-warning-rest-apis.md)                                                               | terminalId/controlStatus の厳格検証、端末台帳解決、WeatherContext・WeatherMetadata を再利用する。                               |

#36〜#38 は別 worktree で製造中であり、本書作成時点で統合済みとは扱わない。製造開始前に #38 までのマージを確認したうえで最新 main の `app.ts`・`server.ts`・shared exports と照合して追加箇所を合わせる。既存エンドポイントの書換え・作業中 worktree の変更は行わない。

本フェーズではコード読取のみを実施した。新規 REST、実上流画像、ブラウザー表示は**実挙動未確認**。PNG の完全 decode・CRC 保証、地理的重ね合わせ、z10 以外の実用性も本書で確認済みにしない。

## 3. 公開 API

### 3.1 ナウキャスト一覧（#39）

`GET /api/weather/nowcast/times?terminalId=<台帳ID>&controlStatus=normal`

クエリはこの 2 キーだけを許可し、既存 `parseWeatherApiQuery` を用いる。欠落・未知キー・配列・オブジェクト・重複は 400。未知端末は 404。任意会場 ID・URL・ファイルパスを受け付けない。不正 percent encoding の URIError はこの API 範囲のエラーハンドラーで 400 invalid_request に正規化する。

200 応答は次の型とする。`Availability`、`UtcIso8601String`、`WeatherContext`、`WeatherMetadata` は既存 shared 型を参照する。

```ts
export interface TileUpstreamAccess {
  readonly allowed: boolean;
  readonly reason: 'disabled' | 'scheduled_stopped' | null;
  readonly nextAllowedAt: UtcIso8601String | null;
}
export interface NowcastApiFrame {
  readonly product: 'N1' | 'N2';
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly element: 'hrpns';
  readonly member: 'none';
}
export interface NowcastApiProduct {
  readonly metadata: WeatherMetadata;
  readonly data: { readonly frames: readonly NowcastApiFrame[] } | null;
}
export type NowcastTimesResponse = WeatherContext & {
  readonly status: 'ok' | 'unsupported_control_status';
  readonly window: {
    readonly from: UtcIso8601String;
    readonly to: UtcIso8601String;
  } | null;
  readonly catalogAccess: TileUpstreamAccess | null;
  readonly imageAccess: TileUpstreamAccess | null;
  readonly allowedZooms: readonly number[];
  readonly products: Readonly<Record<'N1' | 'N2', NowcastApiProduct>>;
};
```

- normal では `status=ok`、`evaluatedAt=catalog.now`、window はサービス値。会場は台帳から解決するが、全国の同じ索引を会場別に生成し直さない。
- `metadata` は snapshot.metadata を明示的に射影し、availability だけ readCatalog の現在評価を使う。DB ID、保存 path、タイル一覧、内部 period 設定を公開しない。snapshot が null なら availability=unavailable、他の metadata フィールドは全て null、data=null。初回失敗の snapshot が存在する場合は保存された試行時刻等を保持するが lastSuccessAt=null のため data=null。正常取得済みの空索引は data={frames:[]} として未取得と区別する。
- data.frames は `catalog.products[product].frames` の順と全キーを維持する。時刻補間・穴埋め・validTime による重複削除を行わない。保存索引の存在は画像取得成功の保証ではない。
- 全体 availability を加えず、N1/N2 の available/stale/unavailable を独立して維持する。`baseTime` はフレームの基準時刻、`validTime` は対象時刻。metadata の発表・取得・最終成功時刻やレスポンス評価時刻で代用しない。issuedAt は保存サービスの内部規約（最大 baseTime、正常空・初回失敗は代用取得時刻）を維持し、気象庁が発表した時刻と断言しない。fetchedAt は索引試行、lastSuccessAt は索引成功、PNG storedAt は画像保存の時刻である。
- access は `enablePolling=false` なら reason=disabled、そうでなく allowed=false なら scheduled_stopped、allowed=true なら null。allowed と nextAllowedAt はサービス値を保持する。enablePolling は server の既存設定を渡し、nextAllowedAt=null だけから理由を推測しない。
- allowedZooms はサービス生成と同じ設定値 `[10]` を使用する。新規 zoom を追加しない。
- training/test は既存 WeatherContext の規則（isTraining は training のみ true）を維持し、status=unsupported_control_status、window/access=null、allowedZooms=[]、両 product は metadata.availability=unavailable、metadata の他全項目=null、data=null。画像サービス・DB・上流へアクセスしない。正常な非提供応答として 200。

### 3.2 単体 PNG

`GET /api/weather/nowcast/:product/tiles/:z/:x/:y.png?terminalId=<台帳ID>&controlStatus=normal&baseTime=<UTC>&validTime=<UTC>`

product は N1/N2。z/x/y は正規の非負整数の 10 進表記（`0` または先頭ゼロなし）。安全な整数、許可 zoom、`0 <= x,y < 2**z` を検証する。時刻は URL エンコードした `YYYY-MM-DDTHH:mm:ss.sssZ` の正規 UTC 表記とし、Date 変換後の toISOString との完全一致で実在日時も検証する。フレームは element=hrpns/member=none をサーバーが固定する。

許可クエリは terminalId/controlStatus/baseTime/validTime の 4 個のみ。全体キーを検証した後、端末の 2 キーだけを既存 parser に渡す。上流 URL、path、element/member の差替えを受け付けない。形式検証→端末解決→controlStatus 非提供判定→サービス準備確認→画像要求の順。

成功は 200 `Content-Type: image/png`。本文は再検証に使った同一 Buffer。`X-Content-Type-Options: nosniff` と以下を返す。

| ヘッダー                    | 意味                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `X-Wx-Catalog-Availability` | fetchFrameTiles の結果 availability。索引鮮度であり画像成功状態とは別。 |
| `X-Wx-Tile-Result`          | cached または downloaded。                                              |
| `X-Wx-Tile-Stored-At`       | 結果 tile.storedAt。配信時刻で上書きしない。                            |

全応答（エラーを含む）は `Cache-Control: no-store`。ブラウザーキャッシュで時間窓・取得許可の再評価を迂回しない。ETag/Last-Modified を出さず、自動 304 を抑止する。画像ルートには GET 登録より前に明示 HEAD を登録し、405 `method_not_allowed` と `Allow: GET` を返す。HEAD から画像取得・DB 読取を呼ばない。既存 API の ETag 設定は変更せず、この 4 ルートの送出を `res.end` 等で制御する。サーバー側の既存キャッシュは引き続き利用する。

```ts
export interface TileApiError {
  readonly status: 'error';
  readonly code:
    | 'invalid_request'
    | 'method_not_allowed'
    | 'terminal_not_found'
    | 'frame_not_available'
    | 'unsupported_control_status'
    | 'image_services_initializing'
    | 'acquisition_stopped'
    | 'tile_fetch_failed'
    | 'tile_read_failed'
    | 'weather_read_failed';
  readonly catalogAvailability?: Availability;
  readonly imageAccess?: TileUpstreamAccess;
}
```

| HTTP | code                        | 条件                                                                                           |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| 405  | method_not_allowed          | 画像 HEAD。Allow: GET を返す。                                                                 |
| 400  | invalid_request             | 上述の形式・座標不正。サービス呼出しなし。                                                     |
| 404  | terminal_not_found          | 台帳にない端末。                                                                               |
| 404  | frame_not_available         | サービスが保存索引不在・窓外・更新競合によるフレーム消滅を返した。                             |
| 422  | unsupported_control_status  | training/test の PNG 要求。正常画像の流用なし。                                                |
| 503  | image_services_initializing | 初期化 getter が未準備。空索引の unavailable とは区別する。一覧にも適用。                      |
| 503  | acquisition_stopped         | キャッシュミスでサービス結果が scheduled_stopped。imageAccess に現在の許可・理由を付ける。     |
| 502  | tile_fetch_failed           | 通信失敗、上流 HTTP エラー、不正 PNG など取得結果の失敗。内部 errorKind/URL/本文は露出しない。 |
| 500  | tile_read_failed            | 保存・DB・履歴例外、配信直前の再検証失敗、その他内部例外。                                     |
| 500  | weather_read_failed         | 一覧の内部例外。                                                                               |

取得サービスの errorKind は、`frame_not_available` を 404、`scheduled_stopped` を 503、`http_status` / `timeout` / `network` / `invalid_png` / `fetch_failed` を 502 に写す。`invalid_coordinate` はルート検証を通過した後には到達しない想定だが、返された場合は 400 invalid_request（付加項目なし）に写す。未知の errorKind は 500 tile_read_failed とし、結果にある catalogAvailability を付ける。結果配列が空または複数件なら内部契約違反として 500 tile_read_failed（付加項目なし）とする。

エラー付加項目は次で固定する。404 frame_not_available、502 tile_fetch_failed、503 acquisition_stopped は取得結果の catalogAvailability を必須とする。500 のうち成功結果を得た後の readVerifiedTile が null/例外の場合はその結果の catalogAvailability を必須とし、fetchFrameTiles 自体の例外は省略する。400/405/404 terminal_not_found/422/503 image_services_initializing/500 weather_read_failed は省略する。例外に対して追加 readCatalog で鮮度を補わない。

imageAccess は acquisition_stopped だけに付ける。停止結果を得た後 readCatalog を 1 回呼び、その時点の imageAccess を射影する。503 は今回の画像を取得できなかった結果、imageAccess はその後の評価であり、時間帯境界をまたぐと allowed=true/reason=null と 503 が両立する。この再評価が例外なら 500 tile_read_failed（取得結果の catalogAvailability は維持、imageAccess は省略）にする。内部例外から鮮度を推測しない。空 PNG、透明 PNG、204、前回の別フレームで失敗を隠さない。同時刻の別 product に自動フォールバックしない。

### 3.3 キキクル一覧・PNG（#40）

`GET /api/weather/kikikuru/times?terminalId=<台帳ID>&controlStatus=normal`

`GET /api/weather/kikikuru/:layer/tiles/:z/:x/:y.png?terminalId=<台帳ID>&controlStatus=normal&baseTime=<UTC>&validTime=<UTC>&imageId=<id>&member=<member>`

共通の query/端末/controlStatus/XYZ/UTC/HEAD/エラー/ヘッダー契約は §3.1・§3.2 と同じ。PNG query は正確に 6 キー。layer は heavyrain（大雨）/inund（浸水）/land（土砂）だけとし、flood は非対応。imageId は layer ごとに rain_mesh/inund/land の対応を検証する。member は非空の単一文字列で、パス区切り・制御文字・`..` を禁止し、固定値に置換しない。これらの形式違反は 400、形式適合でも保存自然キーに一致しなければ 404。

```ts
export type KikikuruApiLayer = 'heavyrain' | 'inund' | 'land';
export interface KikikuruApiFrame {
  readonly layer: KikikuruApiLayer;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: 'rain_mesh' | 'inund' | 'land';
  readonly member: string;
}
export interface KikikuruApiDataset {
  readonly metadata: WeatherMetadata;
  readonly data: { readonly frames: readonly KikikuruApiFrame[] } | null;
}
export type KikikuruTimesResponse = WeatherContext & {
  readonly status: 'ok' | 'unsupported_control_status';
  readonly catalogAccess: TileUpstreamAccess | null;
  readonly imageAccess: TileUpstreamAccess | null;
  readonly allowedZooms: readonly number[];
  readonly layers: Readonly<Record<KikikuruApiLayer, KikikuruApiDataset>>;
};
```

3 層を必ず別の Record キーで返す。snapshot 不在、初回失敗、正常空、成功後 stale の metadata/data 判定は #39 と同じ。normal の allowedZooms=[10]、training/test は []、status=unsupported_control_status、access=null、3 層とも metadata unavailable/他全項目 null/data=null とし、clock だけを使う。許可値の null は非提供による非評価を意味する。

正常データは `KikikuruService.readCatalog()` の全フレームを順序どおり返す。雨雲の ±60 分窓や基本設計の未確定 3 時間窓を適用しない。自然キー `(layer, baseTime, validTime, imageId, member)` を全て保持し、同 validTime の異なる候補を削らない。validTime は危険度の対象時刻であり、未来の実況と呼ばない。初期選択・候補選択はフロントの後続 Issue に残す。

[#21 設計](issue-21-kikikuru-tiles.md)、[取得方法レポート](../data-acquisition-report.md)、`kikikuruService.ts`・`kikikuruTypes.ts`・`kikikuruTileStore.ts` がこの境界の根拠。サービスは既存 3 層別 catalog・キュー・キャッシュを使い、上流の新仕様を推定しない。

## 4. モジュールと実装境界

| ファイル                                                                          | 変更内容                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/tileApi.ts`（新規）                                          | 両 Issue の公開 DTO、エラー code union、厳格な一覧/PNG query・params parser。共通 access/error は両 Issue が共有。                                                                                                             |
| `packages/shared/src/index.ts`                                                    | 新規型・parser の export を追加。                                                                                                                                                                                              |
| `apps/api/src/services/nowcastApiService.ts`（新規）                              | 明示 DTO 射影と単体 PNG 取得。                                                                                                                                                                                                 |
| `apps/api/src/polling/nowcastService.ts`                                          | 既存 readonly 公開プロパティ tileStore を使い `readVerifiedTile(tile: RadarTile): Promise<Buffer \| null>` を追加。verifyTile の buffer を返し、path を HTTP 層に渡さない。既存 fetchFrameTiles の結果・例外契約は変更しない。 |
| `apps/api/src/polling/kikikuruService.ts`                                         | `readVerifiedTile(tile: RiskTile): Promise<Buffer \| null>` を追加。#39 と同じ再検証境界。                                                                                                                                     |
| `apps/api/src/services/kikikuruApiService.ts`（新規）                             | #40 の DTO 射影と単体 PNG 取得。                                                                                                                                                                                               |
| `apps/api/src/app.ts`                                                             | 4 GET と画像 2 HEAD とヘッダー・エラー応答を追加。既存 REST の登録や挙動を保持。                                                                                                                                               |
| `apps/api/src/services/tileApiSupport.ts`（新規）                                 | 内部配信結果・共通射影補助。                                                                                                                                                                                                   |
| `apps/api/src/polling/imageServices.ts`                                           | 現行 `[10]` を同値の共通定数参照へ変更する。                                                                                                                                                                                   |
| `apps/api/src/server.ts`                                                          | 初期化後の既存 imageServices を返す getter、既存 enablePolling と許可 zoom を adapter に注入。                                                                                                                                 |
| `apps/api/tests/nowcastApi.test.ts`・`kikikuruApi.test.ts`（新規）、shared テスト | 下記受け入れ検証。                                                                                                                                                                                                             |

adapter は `NowcastApiService` と `KikikuruApiService` を新設する。共通の内部型・射影補助は `apps/api/src/services/tileApiSupport.ts` に置き、公開 shared 型に Buffer を含めない。

```ts
type TileDeliveryResult =
  | {
      readonly kind: 'success';
      readonly buffer: Buffer;
      readonly catalogAvailability: Availability;
      readonly tileResult: 'cached' | 'downloaded';
      readonly storedAt: UtcIso8601String;
    }
  | { readonly kind: 'error'; readonly httpStatus: number; readonly error: TileApiError };
interface NowcastApiService {
  getTimes(terminal: TerminalDefinition, controlStatus: WeatherControlStatus): NowcastTimesResponse;
  getTile(frame: NowcastApiFrame, coordinate: TileCoordinate): Promise<TileDeliveryResult>;
}
interface KikikuruApiService {
  getTimes(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): KikikuruTimesResponse;
  getTile(frame: KikikuruApiFrame, coordinate: TileCoordinate): Promise<TileDeliveryResult>;
}
```

`TerminalDefinition` は既存 shared export。画像の端末解決/controlStatus 確認はルートで済ませ、adapter へ検証済み frame/coordinate だけを渡す。各依存は `getService(): NowcastService | null` または `KikikuruService | null`、`enablePolling:boolean`、`allowedZooms:readonly number[]`、`clock():UtcIso8601String`。normal で getter=null の場合は typed 初期化エラーを返し、ルートが 503 に写す。getTimes は readCatalog を 1 回のみ呼ぶ。PNG は `fetchFrameTiles(frame, [coordinate])` の結果 1 件を使用し、成功時だけ `readVerifiedTile(result.tile)` を呼ぶ。閉鎖済み proxy のガードを通し、キャッシュ root の別設定・サービスの別インスタンス・直接 DB クエリを作らない。

shared parser は `parseTileTimesQuery(query:unknown)`（既存 parser の再利用）、`parseNowcastTileRequest(params:unknown,query:unknown)`、`parseKikikuruTileRequest(params:unknown,query:unknown)` とする。戻り値は `{ok:true,value:T} | {ok:false,error:'invalid_request'}`、T は端末共通 query と検証済み frame/coordinate を持つ。#33〜#38 の parser 契約を緩めない。allowedZooms の正本を `tileApi.ts` の `TILE_API_ALLOWED_ZOOMS=[10] as const` に集約し、imageServices のサービス生成と各 adapter の応答・検証が同じ値を参照する（値の拡張はしない）。

配信時に検証済み Buffer を返すので検証後の sendFile による再読込はしない。結果取得後に索引更新・清掃が走りファイルが消えた場合は再検証失敗の 500。無制限リトライはしない。filesystem と SQLite の単一 transaction 保証はなく、既存 rename・清掃・再取得で補う。1 要求 1 座標なので別要求の成功を取り消さないが、保存例外後にその要求だけを成功と見なさない。

`startServer` と `main` の両 composition を変更対象とする。各 createApp の前に getter が閉じ込める参照を宣言し、main の enablePolling は既存条件式の評価を composition 開始側に移して注入可能にする。サーバー起動順を変更せず、getter は scheduler が使う同じ imageServices.nowcast / imageServices.kikikuru をそれぞれ参照する。既存 close の順序と待機を維持する。ルートは準備前から登録し 503 を返せるようにする。終了済み proxy の throw は 500 で扱い、disabled に書換えない。

## 5. 受け入れ条件（両 Issue を一括検収）

共通項目はナウキャストとキキクルの両方で実施する。N1/N2・窓は #39 固有、3 層・member/imageId は #40 固有。

fixture 上流 fetch・一時 DB・一時 cache・注入 clock・ローカル HTTP ポートで検証し、実上流やユーザーの dev サーバーを使わない。新規テストは検証業務標準に従い red 確認と対照実験を記録する。

- [ ] **B01** キキクル 3 層に異なる自然キーと同 validTime の別 member/baseTime を保存し、全件を層別に返し、時間窓で削除せず、frame.validTime と metadata 各時刻が保存値と一致することを確認する。
- [ ] **B02** 両サービスで snapshot なし・初回失敗・正常空を作り、data=null と data={frames:[]}、試行時刻の保持、lastSuccessAt=null の区別を完全一致で検証する。
- [ ] **B03** キキクルの layer/imageId 不一致、危険な member、flood を送って 400、保存していない正常形式の member は 404、上流追加なしを確認する。
- [ ] **B04** 一覧 GET を繰り返し、fixture fetch の索引・画像呼出しが 0 回増加、DB の fetchedAt/lastSuccessAt が不変であることを確認する。scheduler と同じサービスへ refreshTimes 後、次の GET に結果が反映される。
- [ ] **B05** 同 validTime の N1/N2、同 product の別 baseTime、欠けたコマを fixture に入れ、返却フレームが窓内の実在キーと完全一致し補間・統合されないことを比較する。
- [ ] **B06** N1 成功/N2 初回失敗、成功後失敗、閾値直前/ちょうどを実サービスで作り、各 product の 3 状態・metadata の欠損項目 null・保持フレームが正しいことを確認する。
- [ ] **B07** 台帳の別会場端末 2 件を GET し context の会場だけが台帳どおりで索引は共通であることを確認する。training/test は各 product/layer が unavailable・data=null、access/window=null、画像は 422、サービス呼出しがないことを spy で確認する。
- [ ] **B08** query 欠落・未知キー・重複・配列、未知端末、product 不正、非正規/不可能日時、負値・小数・先頭ゼロ・範囲外 XYZ・z10 外を送信し、規定の 400/404 と上流呼出しなしを確認する。
- [ ] **B09** 実在フレームの単体 GET で PNG バイト列が fixture と完全一致、初回 downloaded、2 回目 cached、2 回目上流追加なし、storedAt が不変であることを確認する。キキクルは 3 層それぞれで実行する。
- [ ] **B10** キキクルの各層で独立に成功・初回失敗・成功後失敗・鮮度閾値直前/ちょうどを作り、3状態と保持時刻・フレームが他層へ波及しないことを確認する。索引許可=false/画像許可=true と逆の状態も注入し両 access が独立であることを確認する。
- [ ] **B11** stale かつ画像許可でキャッシュミスを要求して 200、停止時の正常キャッシュで 200、停止時ミスで 503、false enablePolling で reason=disabled、時間帯停止で scheduled_stopped を確認する。索引 availability を停止理由で書換えていないことを確認する。
- [ ] **B12** 窓外・不在フレームは 404、上流 404/500・timeout・通信失敗・不正 PNG は 502、保存例外は 500 を返す。失敗応答に PNG、DB ID/path、上流 URL/本文、例外 message が含まれないことを確認する。
- [ ] **B13** saveTile 失敗、DB 保存失敗、画像/DB 保存後の履歴保存失敗を注入し当該要求は 500、他の成功済み要求は維持されることを確認する。履歴障害解除後は保存済み同座標を cached で取得できることを確認する。
- [ ] **B14** 既存キャッシュを破損させ、画像許可時は再取得して 200、停止中は上流呼出しなしで 503 になることを確認する。停止結果の直後に時計を許可時間へ進め、503 と imageAccess.allowed=true が契約どおり共存することを確認する。
- [ ] **B15** 成功結果後のファイル消失/改変を注入し配信直前検証が 500 になること、正常時は検証した Buffer と配信 Buffer が同じ内容であることを確認する。別座標の成功済み要求は維持される。
- [ ] **B16** すべての応答の no-store、PNG の nosniff と 3 ヘッダー、条件付き GET でも 304 で迂回しないことを HTTP で検証する。
- [ ] **B17** 両画像ルートへ HEAD を送り 405/Allow: GET、サービス・DB・上流呼出し 0 回を確認する。不正 percent encoding は 400 JSON になることも検証する。
- [ ] **B18** getter 未準備の normal 一覧/画像は 503、準備後は同じルートで取得可能であり、新しいサービスを生成せず scheduler と instance が一致することを検証する。startServer は起動統合テスト、main は環境変数と隔離 DB/cache を指定した子プロセスの HTTP テストで結線を確認し、起動した子プロセスだけを終了する。
- [ ] **B19** `npm run build`、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、shared に test がある場合そのテストを実行し全通過を記録する。既存 #33〜#38 の API 回帰検証を保持する。

## 6. 棚卸し結論・後続引き継ぎ

| 管理項目 | 本 Issue の結論                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AD-H014  | 台帳から会場解決、normal のみ実データ、公開 DTO 射影、null と時刻意味を維持。全国タイルを会場別データと偽らない。                  |
| AD-H056  | 自由 URL/path を受付せず、共用サービス＋配信 Buffer の再検証を通す。                                                               |
| AD-H059  | 容量上限・LRU・性能・複数 process 対応は追加しない。承認済みの後送りを維持し L2 #84 へ。                                           |
| AD-H060  | filesystem/DB の分散 transaction 保証はない。単体画像要求ごとに成功/失敗、保存例外は 500。複数座標バッチ部分成功の新契約は対象外。 |
| AD-H061  | 索引 stale と画像許可を別々に公開し、stale だけで GET を止めない。                                                                 |
| AD-H062  | REST 読取で refreshTimes しない。画面の再読込周期は F2 #45 等の承認対象として残す。                                                |

#39・#40 は本書 1 本を正本として一括製造する。まず共通 `tileApi.ts` と配信境界、続いて両サービスの adapter・ルートを接続する。個別設計書を別途承認・選択しない。指定ブランチ・作業ディレクトリ・設計コミットは承認後に統括が確定するため、本書に架空値を置かない。AGY の範囲は両 Issue の実装・テスト・コミットまで。push・PR 作成は検収担当。最終報告は変更ファイル、全受け入れ条件の合否と検証結果、設計との差異、迷って止めた点、未解決事項を Walkthrough に記載する。

F2 #45/F4 #47/F8 #51 へ、N1/N2 候補選択、再生中の一覧更新、要求 XYZ、部分欠け、前回画像の保持時刻表示を引き継ぐ。API はこれらを選択しない。F2/L2 へ実 PNG decode・位置・凡例・zoom の実測を残す。今回追加の要ヒアリング事項はなく、具体 HTTP/DTO 契約の承認待ち。

F3 #46・F8 #51 へキキクルの 3 層別時刻・鮮度・画像結果・停止理由、初期選択、表示窓、凡例・位置・前回画像表示を引き継ぐ。
