# Issue #36〜#38 地域時系列予報・アメダス・気象防災速報 REST API 設計

作成日: 2026-09-14
作成: 設計担当（Claude Opus 5）
状態: 【承認済み】2026-09-14 のヒアリングで全項目が確定し、同日ユーザーが本設計を承認した。AGY（Antigravity）による製造を経て検収・PR作成まで完了している。

## 1. 対象と前提

#36（E4 地域時系列予報）、#37（E5 アメダス）、#38（E6 気象防災速報）の3つの REST エンドポイントを1回の製造委託にまとめる。取得・解析・保存層（C6/C9/C17/C7/C8）は実装済みであり、本設計は**保存済みの値を会場別 DTO として公開する読み取り専用層だけ**を対象とする。画面（G6/G7/G8/G2）、天気アイコン対応、通知規則、スキーマ変更は含まない。

### 1.1 統括担当のヒアリングで確定した事項

【確定】2026-09-14 のヒアリングで次を確認した。本設計はこれを覆さない。

**#36**

- 天気コード・風速の range / description は追加保存も提供もしない。既存保存済みの値（天気テキスト・風向テキスト・風速階級・気温テキスト／数値）だけを DTO で返す。天気アイコン対応（G8）・表示列（G7）は今回のスコープ外として引き継ぐ。

**#37**

- 公開する観測要素は表示確定の5項目（気温・湿度・風向・風速・直近1時間降水量）のみ。C9 が保存する他の要素（推計フラグを含む）は今回の API では提供しない。
- C9/C17 の2系統 availability（最新時刻系統／地点系統）のうち、**地点系統（`amedas_snapshot.availability`）のみ**を API の availability として公開する。時刻系統の状態は監視画面（Epic G）専用とし API では公開しない。
- 非対応要素（会場の `elems` で 0 の系列）は DTO のキー自体を省略する。欠測（AQC 由来を含む）は `value = null` をそのまま透過する。`quality_flag` は API では非公開とする。

**#38**

- VPBS（3種）と VPHW（50/51）は `bosai_bulletin` テーブルの全行を**単一の配列**として返す（`telegramType` / `source` で区別可能にする）。
- direct/wide 区分は DB に列がないため、E6 のサービス層で会場定義と `area_code` を比較して都度計算し、DTO にフラグとして付与する。**migration は行わない。**
- 発表官署（EditorialOffice / PublishingOffice）は今回も追加保存しない。C7/C8 の既存確定事項を維持する。
- VPHW50 と VPHW51 が同一区域に対して2行並存する場合も、保存されている行をそのまま返す（重複排除・統合はしない。将来のパネル側課題として引き継ぐ）。

**製造着手の順序（#33〜#35 の未マージ）**

- **#33 の PR がマージされてから #36〜#38 の製造を開始する。** #33 のブランチを本ブランチへ先に取り込む案は採らない。詳細は §1.2。

**#37 の `controlStatus`**

- `controlStatus=training` / `test` を指定した場合、**実観測値を返さず常に `data: null` ／ `availability: 'unavailable'` を返す**（案B）。訓練・試験の表示に実データを混在させないことを優先する。normal 指定時のみ保存値を返す。詳細は §3.5。

**#38 の一覧規模**

- 件数・期間の上限は**設けず、`listBosaiBulletins` が返す全行をそのまま返す**。将来上限が必要になった場合は別 Issue で対応する（§10）。

### 1.2 製造着手前提（#33 のマージ完了）

【確定】本設計は #33〜#35 の成果物（`packages/shared/src/weatherApi.ts`、`apps/api/src/services/weatherApiService.ts`、`weatherAvailability.ts`、`repositories/weatherParseFailureRepository.ts`、`app.ts` の3 GET 登録）を**再利用する前提**で書いている。これらは 2026-09-14 時点で `codex/issue-33-warning-rest-apis` ブランチにのみ存在し、`origin/main` には入っていない。本 Issue の作業ブランチ `codex/issue-36-timeseries-amedas-bosai-rest-apis` は `origin/main` から作成されているため、**このままでは参照先の型・関数が存在せずビルドできない**。

製造担当への引き継ぎ事項。

- **#33 の PR がマージされるまで製造に着手しない。** マージ前に着手すると `npm run typecheck` / `npm run build` が参照解決不能で失敗し、§7 B16 を満たせない。
- **#33 マージ後、本ブランチを `origin/main` 上で rebase するか、最新の `origin/main` から作り直す**（ブランチ名は `codex/issue-36-timeseries-amedas-bosai-rest-apis` を維持する）。どちらにするかは統括担当が着手指示時に指定する。
- 再作成・rebase 後、`packages/shared/src/weatherApi.ts` と `apps/api/src/services/weatherApiService.ts` が存在し、`app.ts` に #33 の3 GET が登録済みであることを確認してから実装に入る（確認できない場合は統括担当へ戻す）。

## 2. 参照資料と現物確認

- [Issue 一覧](../issues-draft.md) Epic E の E4/E5/E6 行（依存 Issue と管理 ID）、[基本設計](../basic-design.md) §5.5・§5.6・§5.10・§5.12・§6.3。
- [#33〜#35 警報関連 REST API 設計](issue-33-warning-rest-apis.md)。HTTP 契約・共通型・鮮度評価・受け入れ条件の粒度は本書でも踏襲する。
- [#16 C6 地域時系列予報](issue-16-area-time-series-forecast.md)、[#19 C9 アメダス正規化](issue-19-amedas-normalization.md)、[#144 C17 複数会場アメダス](issue-144-multi-venue-amedas.md)、[#17 C7 気象防災速報](issue-17-bosai-bulletin.md)、[#18 C8 竜巻関連電文](issue-18-tornado-bulletin.md)。各文書の【未確定】【設計案】を本設計で確定扱いしない。
- 既存コードを実読して確認した事実（静的確認。新 API の実挙動は未確認であり製造・検収で確認する）。

| 確認対象 | 確認した事実 |
| --- | --- |
| `packages/shared/src/weatherApi.ts`（#33 ブランチ） | `WeatherMetadata` / `WeatherContext` / `WeatherArea` / `WeatherDataset<T>` / `WeatherControlStatus` / `parseWeatherApiQuery` が公開済み。backend 型を import していない。 |
| `apps/api/src/app.ts`（#33 ブランチ） | 3 GET が `dependencies.weatherApi` の有無で条件登録され、`parseWeatherApiQuery` → `resolveTerminalDefinition` → try/catch → `Cache-Control: no-store` の同一形。 |
| `apps/api/src/repositories/areaTimeseriesRepository.ts` | `findAreaTimeseriesSnapshot(connection, areaCode, stationCode, controlStatus)`。`timeDefines` は `sequence ASC, id ASC`。 |
| `apps/api/src/repositories/types.ts` | `AreaTimeseriesValue` は `blockId, refId, element, valueCode, valueText, valueNumber, unit, sequence`（＋内部 `id`）。`AreaTimeseriesSnapshot` は `telegram` を持つ。 |
| `apps/api/src/repositories/amedasRepository.ts` | `findAmedasSnapshot(connection, stationCode)`。**controlStatus を引数に取らない。** `observations` は `observed_at ASC, element ASC, id ASC`。 |
| `apps/api/migrations/0007_create_amedas.sql` | `amedas_snapshot` に **`control_status` 列がない**（`UNIQUE (station_code)`）。`amedas_observation` に `unit` 列がない。`0017` で `is_estimated` を追加。 |
| `apps/api/src/polling/amedasSource.ts` | `AMEDAS_ELEMENT_SERIES` の桁順は 気温/降水/風向/風速/日照/積雪/湿度/気圧。公開5要素のキーは `temp`(桁0)、`precipitation1h`(桁1)、`windDirection`(桁2)、`wind`(桁3)、`humidity`(桁6)。 |
| `apps/api/src/polling/amedasParser.ts` | 非対応要素・`aqc === null` は**行を保存しない**。AQC 5/6 と `val === null` の欠測は `valueNumber: null` の行を保存する。`valueText` が入るのは形状2（極値発生時刻。`maxTempTime` 等）だけで、公開5要素には現れない。 |
| `packages/shared/src/venueForecastTargets.ts` | east: `warning.municipalCode='1310800'`／amedas `44136` `elems='11112010'`／`bosaiBulletin.includedAreaCodes=['1310800','130012','130010']`。trc: `'1311100'`／`44166` `elems='11110000'`／`['1311100','130011','130010']`。**trc の桁6（湿度）が `0` で非対応**。 |
| `apps/api/src/repositories/bosaiBulletinRepository.ts` | `listBosaiBulletins(connection, {controlStatus, includedAreaCodes?})` が `EXISTS` で区域絞り込み済み。並びは `report_datetime DESC, id DESC`。`areas` は `sequence ASC, id ASC`。 |
| `apps/api/src/polling/jmaXmlFeedParser.ts` | `extractTelegramTypeFromUrl(url): string | null` が `/_([A-Z]{4}\d{2})_/` で種別を返す。 |
| `weatherParseFailureRepository.ts`（#33 ブランチ） | `hasNewerWeatherParseFailure(connection, {venueId, controlStatus, telegramType: string, areaCode, baseline})`。`telegramType` は任意文字列なので VPFD51/VPBS50/VPHW50/VPHW51 に再利用できる。 |

`bosai_bulletin` に保持期間の削除処理は存在しない（[#10 保持ポリシー](issue-10-retention-policy.md) の対象外）。この帰結は §10 に残留リスクとして記す。

## 3. HTTP 契約

### 3.1 エンドポイント

| Issue | GET パス | データ |
| --- | --- | --- |
| #36 | `/api/weather/area-timeseries` | 地域時系列予報（VPFD51） |
| #37 | `/api/weather/amedas` | アメダス観測（公開5要素） |
| #38 | `/api/weather/bulletins` | 気象防災速報（VPBS50・VPHW50・VPHW51 の統合一覧） |

### 3.2 入力・エラー・副作用（#33 と同一）

`?terminalId=<端末ID>&controlStatus=<normal|training|test>` の形式とする。検証は既存の `parseWeatherApiQuery` を**そのまま再利用**し、新しい検証関数を作らない。両パラメーター必須、重複指定・配列・オブジェクト・空文字・未知のキーは 400 `invalid_request`。端末 ID は `resolveTerminalDefinition` で解決し、台帳にない文字列は 404 `terminal_not_found`。会場 ID による上書き経路は設けない。

成功・未取得・鮮度低下はすべて HTTP 200。DB 等の内部障害は HTTP 500 `weather_read_failed` とし、SQL・例外本文・内部パス・原文 XML をエラーに出さない。GET は上流 HTTP 取得、解析、保存値修復、通知作成、履歴追記を一切起動しない。`Cache-Control: no-store` を付ける。DB の整数 ID、reception ID、content hash、ファイルパス、raw XML は公開しない。

レスポンスの `controlStatus` は常に指定値、`isTraining` は `controlStatus === 'training'`。`test` は `isTraining=false` でも normal ではないため、利用側は `controlStatus` を保持する。#36・#38 は訓練・試験の保存領域を明示指定時のみ読み、normal へフォールバックしない。**#37 は保存層が controlStatus で分割されていない**ため §3.5 の特例を置く（`normal` 以外を指定した場合は DB を読まず、常に `data: null` ／ `availability: 'unavailable'` を返す。normal の実観測値へフォールバックしない）。

### 3.3 共通型の再利用

`packages/shared/src/weatherApi.ts` に追記する。#33 で新設済みの `WeatherContext` / `WeatherMetadata` / `WeatherArea` / `WeatherDataset<T>` / `WeatherControlStatus` / `parseWeatherApiQuery` は**そのまま再利用**し、同義の型を新設しない。shared は backend 型を import しない。

再利用可否は情報種別ごとに異なる。

| Issue | `WeatherContext` | `WeatherMetadata` | `WeatherDataset<T>` | 理由 |
| --- | --- | --- | --- | --- |
| #36 | 再利用 | 再利用 | **再利用** | 単一 snapshot・単一区域で #34 と同形。 |
| #37 | 再利用 | 再利用 | **使わない** | 対象が「区域」ではなく「観測地点」であり、`WeatherDataset.area` に地点を入れると区域と地点の区別が静かに壊れる。`station: WeatherStation` を持つ専用のレスポンス型にする。 |
| #38 | 再利用 | 各速報の行ごとに再利用 | **使わない** | 対象が単一 snapshot ではなく可変長の行集合であり、かつ「0件＝発表なし」が正常状態であるため `data: null` と空配列の区別が成り立たない。 |

追加する共通型は次の1つだけとする。

```ts
export interface WeatherStation {
  readonly code: string;
  readonly name: string;
}
```

### 3.4 #36 地域時系列予報 DTO

```ts
export interface AreaTimeseriesTimeDefineDto {
  readonly blockId: string;        // 'region-3hour' | 'temperature-3hour'
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;  // 時点値ブロックでは timeFrom と同値
  readonly duration: string | null;   // 時点値ブロックでは null
}

export interface AreaTimeseriesValueDto {
  readonly blockId: string;
  readonly refId: string;
  readonly element: 'weather' | 'wind_direction' | 'wind_speed_rank' | 'temperature';
  readonly valueCode: string | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly sequence: number;
}

export interface AreaTimeseriesData {
  readonly station: WeatherStation;          // 気温予報地点（44132 東京）
  readonly timeDefines: readonly AreaTimeseriesTimeDefineDto[];
  readonly values: readonly AreaTimeseriesValueDto[];
}

export interface AreaTimeseriesCapabilities {
  readonly blockIds: readonly ['region-3hour', 'temperature-3hour'];
  readonly elements: readonly ['weather', 'wind_direction', 'wind_speed_rank', 'temperature'];
  readonly unsupportedFields: readonly ['weatherCode', 'windSpeedRange', 'windSpeedDescription'];
}

export type AreaTimeseriesResponse = WeatherContext &
  WeatherDataset<AreaTimeseriesData> & {
    readonly capabilities: AreaTimeseriesCapabilities;
  };
```

設計上の制約。

- `area` は広域予報区域（`resolveAreaTimeseriesForecastTarget(venueId).forecastAreaCode` / `forecastAreaName`、snapshot があれば保存値を優先し空文字なら台帳名で補う）。気温予報地点は `data.station` に分けて置き、区域と地点を同じフィールドに混ぜない。
- **`blockId` を保持したまま返す。** `region-3hour`（3時間区間。天気・風向・風速階級）と `temperature-3hour`（3時間毎の時点値。気温）を API 側で統合しない。配列添字による横並び、時点値から区間値への補間、区間の再分割をしない。
- `refId` の結合は**同一 `blockId` 内の `timeId` に限る**。別ブロックの `timeId` と一致しても結合しない。
- 値の欠落は保存どおり `null` を返し、`0` や空文字へ置換しない。`wind_speed_rank` は `valueCode` に階級文字列のまま入り `valueNumber` は null である。これを m/s へ換算しない。
- `capabilities` は `data: null`（未取得）を含む**全状態で返す**。未保存の天気コード・風速 range/description を利用側が「該当なし」と解釈しないようにするためであり、#33 の `unsupportedKindCodes` と同じ役割である。
- 内部 `id`、`telegram` の生値は公開しない。

### 3.5 #37 アメダス DTO

```ts
export type AmedasPublicElement =
  | 'temp' | 'humidity' | 'windDirection' | 'wind' | 'precipitation1h';

/** 公開5要素のみ。地点が提供しない要素はキー自体を持たない（欠測は null）。 */
export interface AmedasElementValues {
  readonly temp?: number | null;
  readonly humidity?: number | null;
  readonly windDirection?: number | null;
  readonly wind?: number | null;
  readonly precipitation1h?: number | null;
}

export interface AmedasObservationDto {
  readonly observedAt: UtcIso8601String;
  readonly values: AmedasElementValues;
}

export interface AmedasData {
  readonly latestObservedAt: UtcIso8601String | null;
  readonly observations: readonly AmedasObservationDto[];  // observedAt 昇順
}

export interface AmedasCapabilities {
  /** 公開契約上の要素順。表示順の指示ではない。 */
  readonly publicElements: readonly AmedasPublicElement[];
  /** 会場の elems から導いた、この地点が提供しない公開要素。 */
  readonly unsupportedElements: readonly AmedasPublicElement[];
}

export type AmedasResponse = WeatherContext & {
  readonly station: WeatherStation;
  readonly metadata: WeatherMetadata;
  readonly data: AmedasData | null;
  readonly capabilities: AmedasCapabilities;
};
```

設計上の制約。

- **`controlStatus` が `normal` のときだけ保存値を返す。** `training` / `test` を指定した場合は `findAmedasSnapshot` を呼ばず（DB を読まず）、常に `data: null`・`availability: 'unavailable'`・metadata の全時刻/`source`/`sourceVersion` を null として返す（【確定】2026-09-14 ヒアリング。案B）。`amedas_snapshot` に `control_status` 列がなく訓練・試験用の観測データが上流にも存在しないため、normal の実観測値を訓練・試験の応答へ流用しない。`context.controlStatus` は指定値、`isTraining` は `controlStatus === 'training'` という §3.2 の規約は維持し、`station` と `capabilities` は台帳（会場定義）から常に返す。この状態は「訓練・試験ではアメダスを提供しない」という業務上の仕様であり、取得障害ではない。
- 対象地点は `resolveAmedasTarget(venueId)` で解決し、`normal` では `findAmedasSnapshot(connection, target.stationCode)` を使う。他地点へフォールバックしない。`station.name` は snapshot の `station_name`、空文字なら台帳の `displayName` で補う（snapshot を読まない `training` / `test` では台帳の `displayName` を使う）。
- **公開するのは5要素だけ**である。`maxTemp` / `minTemp` / `sun1h` / `snow` / `pressure` 等、C9 が保存する他の要素は DTO に写さない（allowlist 変換。allowlist 外のキーを転送しない）。
- **`quality_flag` と `is_estimated` は公開しない。** AQC 5/6 由来の欠測は C9 が `valueNumber: null` で保存済みであり、DTO はその `null` をそのまま透過する。API 側で品質フラグから値を作らない／消さない。
- **非対応要素はキーを省略する。** 省略は「保存行が存在しない」ことの結果であり、C9 では (a) 会場 `elems` の桁が `0`、(b) 上流 JSON の `aqc === null` の2つで行が保存されない。DTO 単体ではこの2つを区別できないため、`capabilities.unsupportedElements` に **(a) だけ**を `resolveUnsupportedElements(target.elements)` から導いて返す。trc（羽田、`elems='11110000'`）では `['humidity']`、east（江戸川臨海、`elems='11112010'`）では `[]` になる。会場コードや地点番号を API 側でハードコードしない。
- **単位は DTO に持たない。** `amedas_observation` に `unit` 列がなく、保存されていない単位を API が宣言すると「実データと照合できたものだけを確定とする」規律に反する。表示単位の確定は G6 へ引き継ぐ（§10）。
- 値は `valueNumber` をそのまま返す。`valueText` は公開しない（公開5要素は形状1のみで `valueText` が入らないことを `amedasParser.ts` で確認済み。万一 `valueNumber` が null で `valueText` が非 null の行が現れた場合は `null` として扱い、値を捏造しない）。
- 観測時点は snapshot に保存されている**全時点**を昇順で返す。件数を API 側で切り詰めない（保存済みの範囲が上流ブロックの単位であり、切り詰めると G6 の遡り表示が再取得を要求してしまう）。`latestObservedAt` は `observations` の最終要素の `observedAt`（0件なら null）。
- `capabilities` は `data: null`（未取得・訓練・試験）を含む**全状態で返す**。`unsupportedElements` は会場定義の `elems` から導くため保存状態に依存しない。

### 3.6 #38 気象防災速報 DTO

```ts
export type BulletinTelegramType = 'VPBS50' | 'VPHW50' | 'VPHW51';

export interface BulletinAreaDto {
  readonly areaCode: string;
  readonly areaName: string;
  readonly codeType: string;
  readonly sequence: number;
  readonly informationType: string | null;
}

export interface BulletinDto {
  /** C7 は原文 EventID、C8 は合成キー `${telegramType}:${発表細分区域コード}`。 */
  readonly eventId: string;
  /** source URL から解決した電文種別。解決できない場合は null。 */
  readonly telegramType: BulletinTelegramType | null;
  readonly infoType: string;            // 発表 / 訂正 / 取消
  readonly isCancelled: boolean;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly title: string;
  readonly headlineText: string | null;
  readonly informationTag: string | null;  // 線状降水帯発生 / 線状降水帯直前 / 記録雨 / null
  /** VPHW51 のみ true/false。VPHW50 と VPBS50 は常に null（判定不能／該当なし）。 */
  readonly hasSighting: boolean | null;
  readonly areas: readonly BulletinAreaDto[];
  /** 会場の市区町村等コードが areas に現れるか（サービス層で都度計算）。 */
  readonly isDirect: boolean;
  /** 会場の includedAreaCodes と交差した区域コード（areas の sequence 順、重複なし）。 */
  readonly matchedAreaCodes: readonly string[];
  readonly metadata: WeatherMetadata;
}

export interface BulletinsCapabilities {
  readonly telegramTypes: readonly ['VPBS50', 'VPHW50', 'VPHW51'];
  /** この種別では目撃有無を構造的に判定できない（hasSighting=null の意味）。 */
  readonly sightingUndeterminableTypes: readonly ['VPHW50', 'VPBS50'];
  /** 保存していないため提供しない項目。 */
  readonly unsupportedFields: readonly ['editorialOffice', 'publishingOffice'];
  /** VPHW50/VPHW51 の同一区域2行並存を統合していない。 */
  readonly deduplicated: false;
}

export type BulletinsResponse = WeatherContext & {
  readonly area: WeatherArea;                 // 会場の市区町村等（判定の基準）
  readonly availability: Availability;        // 一覧全体の鮮度（§4.3）
  readonly bulletins: readonly BulletinDto[]; // 0件は「発表なし」であり異常ではない
  readonly capabilities: BulletinsCapabilities;
};
```

設計上の制約。

- 取得は `listBosaiBulletins(connection, { controlStatus, includedAreaCodes: 会場の includedAreaCodes })` の1回だけとする。**両会場の和集合（`DEFAULT_BOSAI_BULLETIN_TARGET`）を会場別一覧として返さない**（#17 §8 の引き継ぎ事項）。並び順は repository の既定（`report_datetime DESC, id DESC`）をそのまま維持し、API 側で並べ替えない。
- VPBS 3種と VPHW 50/51 を**単一配列**で返す。種別ごとに配列を分けない。区別は `telegramType` と `metadata.source` で行う。
- `telegramType` は `extractTelegramTypeFromUrl(metadata.source)` で解決し、結果が `VPBS50` / `VPHW50` / `VPHW51` のいずれでもなければ `null` にする。`source` が null または解決不能な場合の**フォールバック**として、`eventId` が `VPHW50:` / `VPHW51:` で始まるときだけその種別とみなす（C8 の合成キー書式が設計で固定されているため）。それ以外は `null` とし、**タイトル・本文の文字列から種別を推測しない**。
- **`isDirect` はサービス層で都度計算する。** 定義: `areas` のいずれかの `areaCode` が `resolveWarningCurrentTargetArea(venueId).municipalCode`（east=`1310800` / trc=`1311100`）と一致すれば `true`。位置依存（`includedAreaCodes[0]`）や桁数依存の判定をしない。`false` は「会場を含む広域情報として区域名が出ているだけ」を意味する（#17 §8・#18 §3.5 の分類と一致する）。migration は行わず、DB に列を追加しない。
- `matchedAreaCodes` は `includedAreaCodes` と交差した区域コードを `areas` の `sequence` 昇順で重複を除いて並べたものとする。`isDirect` が false のとき、どの広域区域で一致したのかを画面が表示できるようにするためである。
- `hasSighting` は保存値をそのまま返す。**VPHW50 の `null` を `false` に丸めない**（#18 確定事項#5）。`capabilities.sightingUndeterminableTypes` で `null` の意味を明示する。
- **VPHW50 と VPHW51 の2行並存を統合しない**（#18 確定事項#7）。`capabilities.deduplicated: false` で明示する。
- `metadata.validAt` は VPHW の `Head/ValidDateTime`、VPBS50 では null である（#17 §「validTo」）。**API 側で `reportDateTime + 3時間` を有効期限として書き込まない。** 表示上の3時間整理は G2 が `reportDateTime` から計算する。
- 発表官署は保存されていないため提供しない。`capabilities.unsupportedFields` で明示する。
- 内部 `id`（`bosai_bulletin.id` / `bosai_bulletin_area.id`）は公開しない。

## 4. 鮮度評価

#33〜#35 と同じ「純粋関数で GET ごとに評価し、DB の availability を更新しない／通知・監視の判定を変更しない」という方針を維持する。1 リクエストにつき `now` と polling status を各1回だけ取得する。ただし**上流の取得経路が情報種別ごとに違う**ため、適用する条件は次のとおり異なる。相違点には理由を付す。

| 条件 | #36 | #37 | #38 |
| --- | --- | --- | --- |
| snapshot なし → `unavailable` | 適用 | 適用 | **非適用**（§4.3） |
| 保存 availability が available でない → `stale` | 適用 | **これだけを使う** | 各行に適用（§4.3） |
| XML フィード（regular/extra）両方 available でなければ `stale` | 適用 | **非適用** | 適用 |
| `now >= max(timeTo)` → `stale` | 適用 | 非適用（時間定義なし） | 非適用（§4.2） |
| 新しい `未対応構造` 解析失敗 → `stale` | 適用 | **非適用** | 適用 |

### 4.1 #36

既存の `evaluateWeatherAvailability` を**そのまま**使う（#34 と同型）。VPFD51 は C1 が Atom フィードから発見する XML 電文であり、フィード鮮度・電文単位の解析失敗という #33 の前提がそのまま成立する。

- `maxTimeTo` は `region-3hour` と `temperature-3hour` の**全 timeDefines の timeTo の最大値**とする（`temperature-3hour` は時点値で `timeTo === timeFrom`）。ブロックごとに別々の失効判定をしない。時間定義が空なら `null` を渡し、期間による失効を判定しない。
- 解析失敗判定は `hasNewerWeatherParseFailure(connection, { venueId, controlStatus, telegramType: 'VPFD51', areaCode: target.forecastAreaCode, baseline: snapshot.telegram の (reportDateTime, controlDateTime) })` とする。`areaCode` は広域予報区域コード（`130010`）であり、気温予報地点コード（`44132`）は区域ではないため使わない。
- フィード鮮度の閾値は既存設定 `staleAfterSeconds` を使い、API 専用の定数を増やさない。

### 4.2 #37

**`amedas_snapshot.availability` をそのまま返し、GET 時の追加失効判定を一切行わない。** `evaluateWeatherAvailability` は呼ばない（`feedFreshness: null` を渡すと無条件に `stale` になるため、誤用すると静かに壊れる）。専用の分岐を `weatherApiService` 内に置く。

```
controlStatus !== 'normal' → 'unavailable'（DB を読まない。data: null、metadata 全時刻 null。§3.5）
snapshot が無い            → 'unavailable'（data: null、metadata 全時刻 null）
snapshot がある            → snapshot.metadata.availability をそのまま返す
```

この相違の理由。

1. **XML フィード鮮度は無関係。** アメダスは Atom フィード経由ではなく `timeBasedPollingScheduler` の HTTP 取得（`latest_time.txt` ＋ 地点 JSON）で更新される。XML フィードの停止をアメダスの stale にコピーすると、無関係な障害でアメダスが常時 stale になる。
2. **解析失敗履歴は照合できない。** `hasNewerWeatherParseFailure` は `telegram_reception` / `telegram_reception_adoption` / `telegram_reception_area` を結合する。アメダスの取得・失敗はこれらのテーブルに載らず、`telegramType` も `areaCode` も確定できない。URL から推測しない。
3. **観測時刻の経過による失効を入れない。** C14/C17 の時間帯別スケジューラは 20:00〜04:00 JST に取得を停止する。観測時刻の古さを stale の条件にすると、夜間は正常運用でも全端末が常時 stale になる。取得失敗による古さは C9/C17 が既に `amedas_snapshot.availability` に `stale` として書き込んでいるため、二重判定は不要である。
4. **地点系統のみを公開する**（確定事項）。`latest_time.txt` 取得失敗（時刻系統）は地点の保持値を無効にしないため、API の availability には反映しない。この状態は Epic G の監視画面が別途扱う。

### 4.3 #38

一覧全体の `availability` は次で評価する。#33 の条件1（snapshot なし → unavailable）は**適用しない**。

- 理由: 気象防災速報は「発表がないのが常態」であり、行が0件であることは未取得の証拠ではない。0件を `unavailable` にすると、平常時が恒久的に「取得できていない」と表示される。したがって `unavailable` は返さず、`available` か `stale` のどちらかになる。

評価手順（`evaluateWeatherAvailability` を `hasSnapshot: true`、`savedAvailability: 'available'`、`maxTimeTo: undefined` で呼び、残りを実値で渡す）。

1. XML フィード（regular/extra）の両方が available でなければ `stale`。
2. 返す行のうち `metadata.availability` が `available` でないものが1件でもあれば `stale`（保持値付きの行が混ざっている状態）。
3. 対象種別の新しい `未対応構造` 解析失敗があれば `stale`。判定対象は `VPBS50` / `VPHW50` / `VPHW51` の3種別 × 会場の `includedAreaCodes` の各コード（east/trc とも3件）＝最大9回の `EXISTS`。各種別の baseline は、返却対象行のうち**同一 `telegramType` を持つ行の最大 `(reportDateTime, controlDateTime)`** とする。該当種別の行が1件もない場合、その種別の判定は**行わない**（baseline を決められず、古い失敗まで拾って恒久的に stale になるため）。この保守的な扱いは検出漏れを生む。§10 に制限として残す。
4. 上のいずれにも当たらなければ `available`。

行ごとの `metadata.availability` は保存値をそのまま返す（GET 時に書き換えない）。評価と DB 読み取りは #33 と同じく**同一の同期 read transaction 内**で行い、採用途中の不整合な状態を返さない。

### 4.4 未取得・正常空の表現（共通）

- #36 / #37 の未取得は `data: null`、metadata の全時刻・`source`・`sourceVersion` は null、`availability` は `unavailable`。区域・地点は台帳から返す。#37 の `training` / `test` 指定時もこれと同一の形で返す（§3.5）。
- 保持値がある場合は metadata の値（`issuedAt` / `fetchedAt` / `lastSuccessAt` / `source`）を保存どおり維持し、`availability` だけを評価結果に差し替える。GET 時刻やフィード成功時刻で上書きしない。
- 正常空は `data` が存在した上での空配列（#36 の `values: []`、#37 の `observations: []`、#38 の `bulletins: []`）とする。

## 5. 保存変更

**なし。** migration、既存テーブルの列追加、parser の抽出項目追加、保存型の変更は行わない（確定事項）。本 Issue は読み取り専用である。

## 6. モジュールと製造境界

| 対象 | 変更 |
| --- | --- |
| `packages/shared/src/weatherApi.ts`, `index.ts` | `WeatherStation` と #36/#37/#38 の公開 DTO 型を追記・export。`parseWeatherApiQuery` は変更しない。 |
| `apps/api/src/services/weatherApiService.ts` | `getAreaTimeseries` / `getAmedas` / `getBulletins` を既存 `WeatherApiService` に追加。allowlist 変換、`isDirect` / `matchedAreaCodes` / `telegramType` の計算。 |
| `apps/api/src/services/weatherAvailability.ts` | **変更しない。** #36 は既存関数をそのまま使い、#37 は呼ばない、#38 は既存シグネチャの範囲で呼ぶ。 |
| `apps/api/src/app.ts` | 3 GET の追加登録（既存3 GET と同一の形）。 |
| `apps/api/src/server.ts` | 変更しない（`weatherApi` は結線済み）。 |
| repository / parser / polling / migrations | **変更しない。** |
| `apps/api/tests/issue36TimeseriesAmedasBosaiRestApis.test.ts`（新規）, `packages/shared/tests/weatherApi.test.ts` | §7 の受け入れ条件 |

`WeatherApiService` インターフェースにメソッドを追加するだけとし、別サービスや別 factory を作らない。`createWeatherApiService({connection, getPollingStatus, now})` の依存はそのまま使う。`getPollingStatus` は既存 polling service を参照し別インスタンスを作らない。`createApp()` の health 単独テストを維持できるよう `weatherApi` は引き続き任意依存とし、本番 `server.ts` では必ず設定される（結線テストで確認する）。

## 7. 受け入れ条件

各項目は自動テストで入力と期待値を固定し、検収報告にテスト名・結果を記録する。テスト追加の red 確認・対照実験は [検証業務標準](../rules/05-verification-protocol.md) に従う。時刻は注入した `now` で固定し、外部通信しない fixture と一時 DB を使う。**#37 の項目は B2 / B3b を除きすべて `controlStatus=normal` で検証する**（`training` / `test` は §3.5 により常に `unavailable` となるため、値の検証に使えない）。

- [ ] **B1 端末と対象解決**: 3 GET に east / trc の端末を指定する。#36 は広域予報区域 `130010` と気温地点 `44132`、#37 は east=`44136` / trc=`44166`、#38 は会場ごとの `includedAreaCodes` が使われる。別区域・別地点の sentinel を保存しても混入しない。#37 で片方の地点だけ保存した状態でも他地点の値を流用しない。
- [ ] **B2 入力検証**: 3 GET それぞれで、パラメーター欠落・空文字・重複指定・未知キー・不正 `controlStatus` が 400 `invalid_request`、未知端末文字列が 404 `terminal_not_found`、正常指定が 200 になる。検証は既存 `parseWeatherApiQuery` 経由であることを確認する。
- [ ] **B3 controlStatus 分離（#36/#38）**: normal / training / test に異なる値を保存し、指定した領域だけが返る。未取得領域に他領域の値を返さない。`controlStatus` と `isTraining` が整合する。
- [ ] **B3b #37 controlStatus 非対応（訓練・試験）**: normal で観測値を保存した状態で `controlStatus=training` および `test` を指定すると、**常に `data: null`・`availability: 'unavailable'`・metadata の全時刻/`source`/`sourceVersion` が null** になり、normal の実観測値が一切現れない。同一リクエストで `context.controlStatus` は指定値、`isTraining` は training のときだけ true、`station` と `capabilities` は台帳どおり返る。`normal` を指定した同条件では観測値が返ることを対照として確認する。実装が `training` / `test` で `findAmedasSnapshot` を呼ばないこと（repository の mock 呼び出し 0 回）を確認する。
- [ ] **B4 未取得・正常空・保持値（#36/#37）**: snapshot なしは `data: null`・`availability: 'unavailable'`・metadata の全時刻 null。明細0件の snapshot は `data` が存在して空配列。保存 availability が `stale` の snapshot は保持値と出所時刻をそのまま返し `stale` になる。#37 の判定はすべて `controlStatus=normal` で行う。
- [ ] **B5 #36 ブロック分離**: `region-3hour` と `temperature-3hour` が同じ `timeId` 文字列・同じ開始時刻を持つ fixture でも、`timeDefines` / `values` が `blockId` ごとに分離され、`refId` が他ブロックの `timeDefine` に解決されない。`temperature-3hour` は `duration: null` かつ `timeFrom === timeTo` のまま返る。
- [ ] **B6 #36 値の完全一致**: `weather` のテキスト、`wind_direction` のテキストと `unit`、`wind_speed_rank` の `valueCode`（`valueNumber` は null）、`temperature` のテキスト・`unit`・`valueNumber` が保存値と DTO で完全一致する。値なしが `0` や空文字に置換されない。
- [ ] **B7 #36 capabilities**: `data: null` の未取得状態でも `capabilities.blockIds` / `elements` / `unsupportedFields` が返る。`unsupportedFields` に `weatherCode` / `windSpeedRange` / `windSpeedDescription` が含まれ、DTO のどこにもこれらのキーが存在しない。
- [ ] **B8 #37 公開要素の限定**: 公開5要素以外（`maxTemp` / `minTemp` / `maxTempTime` / `sun1h` / `snow` / `pressure` 等）を保存した snapshot を入力しても、DTO には現れない。`quality_flag` と `is_estimated` に相当するキーがレスポンス全体に存在しない。
- [ ] **B9 #37 非対応要素と欠測の区別**: trc（`elems='11110000'`）では `values` に `humidity` キーが存在せず、`capabilities.unsupportedElements` が `['humidity']` になる。east（`elems='11112010'`）では `unsupportedElements` が `[]`。AQC 5/6 由来の欠測行と通常欠測行はいずれも `value: null` のキーとして現れ、キー省略と区別できる。判定に地点番号をハードコードしていないことを、合成 `elems` を注入したケースで確認する。
- [ ] **B10 #37 鮮度**: `controlStatus=normal` で、snapshot なし → `unavailable`、保存 `available` → `available`、保存 `stale` → `stale` を保持値付きで返す。**XML フィードの regular / extra を両方 unavailable にしても #37 の結果は変わらない。** 観測時刻を `now` から大きく過去にしても（夜間停止相当）`available` のまま変わらない。同一ケースで #36 は `stale` になることを対照として確認する。
- [ ] **B11 #38 統合配列と区別**: VPBS50・VPHW50・VPHW51 の行を混在させ、単一の `bulletins` 配列で返る。各行の `telegramType` が `source` URL から正しく解決される。`source` が解決不能で `eventId` が `VPHW51:` で始まる行はフォールバックで `VPHW51` になり、どちらでも解決できない行は `null` になる（タイトル・本文から推測されない）。並び順が `report_datetime` 降順のままである。
- [ ] **B12 #38 isDirect / matchedAreaCodes**: east の端末で、江東区 `1310800` を含む行は `isDirect: true`、東京地方 `130010` だけを含む行は `isDirect: false` かつ `matchedAreaCodes: ['130010']` になる。同じ DB に対し trc の端末では大田区 `1311100` を含む行が `isDirect: true` になり、east/trc で結果が独立して変わる。`includedAreaCodes` と交差しない行は返らない（`listBosaiBulletins` の絞り込み）。DB に direct/wide の列が追加されていないこと（`PRAGMA table_info` で確認）。
- [ ] **B13 #38 目撃・並存・期限**: VPHW51 の目撃ありは `hasSighting: true`、目撃なしは `false`、VPHW50 と VPBS50 は `null` のまま返る（`false` に丸められない）。同一発表細分区域の `VPHW50:130010` と `VPHW51:130010` の2行が**どちらも**返る。VPHW 行の `metadata.validAt` が `Head/ValidDateTime` 由来の値、VPBS50 行の `validAt` / `validTo` が null であり、`reportDateTime + 3時間` が書き込まれていない。
- [ ] **B14 #38 鮮度と正常空**: 行0件は `bulletins: []` かつ `availability` が `unavailable` **ではない**こと。XML フィード片側 unavailable で `stale`。保存 availability が `stale` の行を1件混ぜると一覧全体も `stale`。会場・区域・controlStatus・種別が一致する新しい `未対応構造` を投入すると `stale` になり、別種別・別区域・別会場・過去時刻の失敗では変わらない。該当種別の行が0件のときはその種別の失敗判定が行われない（古い失敗で stale にならない）ことを確認する。
- [ ] **B15 副作用なしと結線**: 3 GET の前後で DB の全テーブル行数と通知件数が変化せず、upstream fetch の mock 呼び出しが 0 回。`Cache-Control: no-store` が付く。内部例外を注入すると 500 `weather_read_failed` になり本文・SQL・パスが漏れない。`server.ts` 経由の起動で #33 の3 GET と本 Issue の3 GET の計6本が登録されている。
- [ ] **B16 回帰**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w packages/shared`、`npm run build` が成功する。`weatherAvailability.ts`・repository・parser・migrations に差分がない（`git diff --stat` で確認）。

## 8. 管理 ID の棚卸し

| 管理 ID | 今回の結論・参照 |
| --- | --- |
| AD-H004 | 3状態と保持値を API で分離（§4）。#38 は `unavailable` を返さない理由を明記。画面表現は G2/G6/G7 へ。 |
| AD-H008 | アメダスの取得状態を地点系統だけで公開（§4.2）。時刻系統・監視集約は Epic G へ。 |
| AD-H014 | 端末台帳・`controlStatus` 明示・公開 DTO の会場別 REST 境界を #36〜#38 にも適用（§3）。#37 は `normal` 以外を常に `unavailable` とする特例を置く（§3.5。2026-09-14 確定）。 |
| AD-H015 | VPHW50/51 の2行並存を統合せず `capabilities.deduplicated: false` で明示（§3.6）。 |
| AD-H017 | 会場2件・対象区域の不変条件を維持。実電文と合成 fixture の区別は B11〜B13 で要求。 |
| AD-H036 | 発表官署は今回も非提供。`unsupportedFields` で明示（§3.6）。 |
| AD-H043 | direct/wide をサービス層で都度計算し DB に列を持たない（§3.6）。 |
| AD-H046 | 未保存項目（天気コード・風速 range/description）を `capabilities.unsupportedFields` で「該当なし」と区別（§3.4）。 |
| AD-H047 | 取消は `isCancelled` と `infoType` を保存どおり返し、行を隠さない（§3.6）。 |
| AD-H050 / AD-H051 | 風速階級・天気テキストを非変換で公開。アイコン・範囲表示は G7/G8 へ（§3.4、§10）。 |
| AD-H052 / AD-H053 / AD-H054 | 公開5要素の限定、非対応要素のキー省略、欠測 null 透過、品質フラグ非公開（§3.5）。 |
| AD-H070 | 保存有無・フィード鮮度・期間・識別可能な解析失敗を GET 時に評価。#37 では非適用とし理由を明記（§4）。 |

[Epic A〜D 棚卸し](../audit-epic-a-d.md) の各管理 ID と照合した。本表は今回の対応範囲と残件を示し、台帳全体の解消を意味しない。

## 9. ヒアリング完了状況

**要ヒアリング事項は残っていない。** 本設計の未確定論点（#33〜#35 の未マージの解消方法、#37 の `controlStatus=training`/`test` の振る舞い、#38 一覧の件数・期間上限）は、2026-09-14 の統括担当によるヒアリングで**全項目が確定**した。確定内容は §1.1・§1.2・§3.5・§10 に反映済みである。

製造担当は、本設計に書かれていない業務判断が必要になった場合、自分で決めずに統括担当へ戻すこと。

## 10. 残留リスクと後続への引き継ぎ

- **#36**: `hasNewerWeatherParseFailure` の `areaCode` に広域予報区域コード（`130010`）を使うが、`telegram_reception_area` の区域一覧はエンベロープの Area 抽出結果であり、VPFD51 で必ず `130010` が記録される保証は静的確認の範囲にとどまる。記録されない場合、VPFD51 の解析失敗は鮮度評価で検出されない（過検出ではなく検出漏れ側に倒れる）。検収時に fixture で実挙動を確認すること。
- **#36**: `max(timeTo)` を両ブロックの最大値で取るため、`temperature-3hour` だけが先に終了しても `region-3hour` が有効なら `available` のままになる。ブロック別の失効表示が必要なら G7 で `timeDefines` から判断する。
- **#37**: `capabilities.unsupportedElements` は会場定義の `elems` からのみ導く。上流 JSON が `aqc === null` を返して行が保存されなかった要素は、キー省略という同じ見え方になるが `unsupportedElements` には現れない。画面は「キーがない＝値が0」と解釈してはならない。
- **#37**: 単位を DTO に持たない。G6 は表示単位を自前で決める必要がある。単位を API 契約にする場合は、公式資料と照合してから別 Issue で追加すること（推測で単位を宣言しない）。
- **#37**: 将来 `elems` の桁が `2`（推計）に変わった公開要素は、推計フラグが非公開のため観測値と区別できないまま表示される。推計の扱いが必要になったら本設計を改訂すること。
- **#38**: 件数・期間の上限を設けないため（確定事項）、`bosai_bulletin` に保持期間の削除処理がないこと（[#10](issue-10-retention-policy.md) の対象外）と相まって、運用が長期化すると1レスポンスが際限なく肥大化しうる。PoC の運用期間では問題にならない見込みだが、将来的に上限（`reportDateTime` の直近 N 時間、または最大 N 件）が必要になれば別 Issue で対応すること。その際は絞り込み条件を `capabilities` に明示し、画面が「上限で切られた一覧」と「全件」を区別できるようにすること。
- **#37**: `training` / `test` ではアメダスを提供しない（常に `unavailable`）。訓練モードの画面ではアメダス欄が恒常的に未取得表示になるため、G6 は「訓練中は対象外」と「取得失敗」を区別できる表現が必要になる。区別のための追加フィールドは今回置いていないので、必要になった時点で別 Issue とすること。
- **#38**: 該当種別の行が0件のときはその種別の解析失敗判定を行わないため、「一度も保存できていない種別が壊れ続けている」状態は `available` のまま見える。フィード鮮度と監視画面（Epic F/G）で補う。
- **#38**: `telegramType` を `source` URL から解決するため、`source` の書式が変わると `null` に落ちる（誤った種別にはならない）。種別を確実に持たせるには列追加が必要で、今回は確定事項により行わない。
- **#38**: VPHW50/51 の2行並存は API では統合しない。G2 のパネルで同一区域の重複表示をどう扱うかは将来課題として引き継ぐ（#18 §8）。
- **G7/G8**: 天気コード・風速の range / description は保存も提供もされない。アイコン選択・風速範囲表示が必要になった時点で、C6 の parser 拡張と migration を含む別 Issue とすること。API の `values` から推測して補完しない。
- **G2/G6/G7 共通**: `availability: 'stale'` は「保持値あり・鮮度低下」であり「データなし」ではない。`unavailable` と同じ表示にしないこと。#38 の0件は「発表なし」であり、取得失敗と混同しないこと。
- 本設計は既存コードと設計書の**静的照合**に基づく。新 API の実挙動、DTO と保存値の一致、鮮度評価の境界は製造・検収で確認する。新たな業務判断が必要になった場合は製造で補完せず統括へ戻すこと。
