# Issue #109 設計: 会場・予報点定義（地域・観測・地図の対象を分離）

## 1. 目的と決定事項

Issue #109（C15）は、会場ごとに固定する気象情報の対象を一か所で定義し、コードの文字列値だけが偶然同じであることを理由に別用途へ渡せないようにする。対象は地図移動・レイヤー切替では変化しない。端末の H/K は画面モードであって、会場の気象対象・警報状態・通知・保存キーには含めない。

ユーザー確定事項により、TRC（東京流通センター）の対象も今回定義する。TRC は本リポジトリ内の実験用端末という Issue #2 の位置付けを維持する。本Issueは取得、正規化、画面、DBスキーマ変更そのものを実装しない。

### 1.1 確定する会場別定義

| 用途 | 東地区（東京ビッグサイト） | TRC（東京流通センター） |
|---|---|---|
| 会場 ID / 表示名 | `east` / 東京ビッグサイト | `trc` / 東京流通センター |
| 地図基準位置（WGS84 度） | `35.63159368010876`, `139.79281040119963` | `35.58138`, `139.748119` |
| 警報・注意報、警報等時系列の市町村等 | 江東区 / `1310800` | 大田区 / `1311100` |
| 警報現況の府県予報区 | 東京都 / `130000` | 東京都 / `130000` |
| 警報級の可能性、地域時系列の天気・風 | 東京地方 / `130010` | 東京地方 / `130010` |
| 地域時系列の気温地点 | 東京（北の丸公園） / `44132` | 東京（北の丸公園） / `44132` |
| アメダス | 江戸川臨海 / `44136` | 羽田 / `44166` |
| 速報の対象判定（直接 → 細分 → 広域） | 江東区 `1310800` → 23区東部 `130012` → 東京地方 `130010` | 大田区 `1311100` → 23区西部 `130011` → 東京地方 `130010` |

`44132` は地域時系列予報 XML の気温用 Station、`44136` / `44166` はアメダス地点であり、いずれも会場地点の観測・予報を意味しない。TRC の羽田は現行地点表で `elems="11110000"`（気温・降水・風向・風速）であり、江戸川臨海の `11112010` と異なり湿度・日照を提供しない。C9/G6 は、羽田で得られない値を別地点で補完せず、未提供として扱う。

速報の3コード集合は、電文に保存された区域コードを読出し時に照合するための集合である。大田区対象の VPBS50 実電文はまだ採取していないため、これは公式地域コード表による区域包含の定義であり、TRCへ速報が実際に発表されたことを示すものではない。

## 2. 根拠と確認記録

確認日はいずれも 2026-09-10（JST）。コードはすべて文字列で保持する。先頭ゼロを持ち得る他地域のコードにも同じ型を適用するため、数値に変換しない。

| 対象 | 根拠 | 確認内容 |
|---|---|---|
| 江東区、23区東部、東京地方、東京都 | `docs/data-acquisition-report.md` §2、[20251225_AreaInformationCity-AreaForecastLocalM.xlsx](</Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260826_Code/20251225_AreaInformationCity-AreaForecastLocalM.xlsx>) | `1310800 → 130012 → 130010 → 130000`。既存レポートの実 XML 検証（VPWW55/VPWS50/VPWP50）も江東区コードを確認済み。 |
| 大田区、23区西部、東京地方、東京都 | 同コード表（AreaInformationCity および地域関係表） | 大田区 `1311100`、その市町村等をまとめた地域 `130011`（23区西部）、上位 `130010`（東京地方）、府県予報区 `130000`（東京都）。気象庁の[警報・注意報（東京地方）](https://www.data.jma.go.jp/multi/warn/warn_detail.html?code=130010&lang=jp)でも大田区が東京地方の対象として列挙される。 |
| 東京地方の広域予報・東京地点 | `docs/data-acquisition-report.md` §2・§9、実 VPFD51 | 東京地方 `130010` の天気・風と、Station 東京 `44132` の気温を区別する既存確認。実 VPFD51 で本土向けの温度 Station は東京 `44132`（ほかは大島・八丈島・父島）であり、羽田 Station は存在しない。よってTRCもこの広域予報点を使用する。 |
| 江戸川臨海 | [気象庁現行アメダス地点表 JSON](https://www.jma.go.jp/bosai/amedas/const/amedastable.json)、`20260326_PointAmedas.xlsx` | `44136`、緯度35°38.3′、経度139°51.8′、`elems="11112010"`。 |
| 羽田 | [気象庁現行アメダス地点表 JSON](https://www.jma.go.jp/bosai/amedas/const/amedastable.json)、[地域気象観測所一覧](https://www.jma.go.jp/jma/kishou/know/amedas/ame_master_20241218.pdf) | `44166`、名称「羽田」、緯度35°33.2′、経度139°46.8′、`elems="11110000"`。公式一覧の所在地は大田区羽田・東京航空地方気象台。従来の仮説 `44100` は採用しない。 |
| 東京ビッグサイト地図位置 | [東京ビッグサイト公式アクセスページ](https://www.bigsight.jp/visitor/access/) の埋込地図（確認日同日） | 埋込地図の中心 `35.63159368010876,139.79281040119963` を会場基準位置に採用する。地図実装時の右パネル等を避ける中心補正は、この基準位置から計算する。 |
| TRC 地図位置 | [TRC公式アクセスページ](https://www.trc-inc.co.jp/access/) の Google Maps 埋込（確認日同日） | 公式ページの地図 URL `ll=35.58138,139.748119` を会場基準位置に採用する。所在地は東京都大田区平和島6-1-1。既存の丸めた `35.58,139.75` を置換する。 |

## 3. モジュール構成

### 3.1 共有定義

新設する `packages/shared/src/venueForecastTargets.ts` を唯一の定義元とし、`packages/shared/src/index.ts` から再 export する。API と Web は同じ値を import し、地域名、コード、座標をそれぞれ再記述しない。

```text
packages/shared/src/venueForecastTargets.ts
  ├─ コード体系ごとのブランド型・会場 ID
  ├─ VenueForecastTargets / 各用途の target 型
  ├─ VENUE_FORECAST_TARGETS（east / trc、readonly）
  └─ resolveVenueForecastTargets(venueId)
          ├─ apps/api/src/venueForecastTargets.ts（C2/C3 用 adapter）
          └─ apps/web/src/shell/config.ts（端末表示用の会場参照）
```

型は文字列のブランドで区別する。例えば `MunicipalWarningAreaCode`、`PrefectureForecastAreaCode`、`RegionalForecastAreaCode`、`ForecastTemperatureStationCode`、`AmedasStationCode`、`BosaiBulletinAreaCode` を別型にする。`130010` のように文字列が同じでも、広域予報用と速報照合用は別の明示変換を経なければ代入できない。生成関数は共有モジュール内だけに置き、定義表のリテラルを型付けする。外部入力（XML/JSON）をこのブランド型へキャストしない。

```ts
export interface WarningCurrentTarget {
  readonly municipalCode: MunicipalWarningAreaCode;
  readonly displayName: string;
  readonly prefectureCode: PrefectureForecastAreaCode;
}

export interface BroadForecastTarget {
  readonly areaCode: RegionalForecastAreaCode;
  readonly displayName: string;
}

export interface TemperatureForecastTarget {
  readonly stationCode: ForecastTemperatureStationCode;
  readonly displayName: string;
}

export interface AmedasTarget {
  readonly stationCode: AmedasStationCode;
  readonly displayName: string;
  /** 地点表 elems。表示可能要素を決める根拠であり、ビット演算しない。 */
  readonly elements: string;
}

export interface BosaiBulletinTarget {
  readonly includedAreaCodes: readonly BosaiBulletinAreaCode[];
}

export interface VenueForecastTargets {
  readonly venueId: VenueId;
  readonly venueName: string;
  readonly mapReference: Readonly<{ latitude: number; longitude: number }>;
  readonly warning: WarningCurrentTarget;
  readonly warningTimeseries: WarningTimeseriesTarget;
  readonly broadForecast: BroadForecastTarget;
  readonly temperatureForecast: TemperatureForecastTarget;
  readonly amedas: AmedasTarget;
  readonly bosaiBulletin: BosaiBulletinTarget;
}
```

`warningTimeseries` は警報と同じ市町村等コード・表示名を持つが、C4 の受け取り型に合わせて別プロパティとする。`warning` をそのまま C4 に渡すことで、将来 C4 が府県予報区を業務判定へ誤用する余地を作らない。`broadForecast` は C5 の `EarlyWarningTargetArea` と C6 の天気・風に渡し、温度の Station は `temperatureForecast` だけから渡す。

地図座標は WGS84 の度の有限数値として検証する。ズーム値・可視矩形からの補正量・境界ポリゴンはこの設定に含めず、F1 の責務とする。

### 3.2 API の接続点と既存ハードコードの移行

新設 `apps/api/src/venueForecastTargets.ts` に、共有定義から既存の C2/C3 受取型へ変換する小さな adapter を置く。

```ts
resolveWarningTargetArea(venueId: VenueId): WarningTargetArea
resolveWarningCurrentTargetArea(venueId: VenueId): WarningCurrentTargetArea
resolveWarningTimeseriesTargetArea(venueId: VenueId): WarningTimeseriesTargetArea
resolveEarlyWarningTargetArea(venueId: VenueId): EarlyWarningTargetArea
```

各戻り値はコード体系を対応する既存型のフィールドへだけ写す。`resolveWarningCurrentTargetArea` は C2/C3 に `{ municipalCode, displayName, prefectureCode }` を解決済みで渡す接続点である。`DEFAULT_WARNING_TARGET_AREA` と `DEFAULT_WARNING_CURRENT_TARGET_AREA` は、`resolve...( 'east' )` の値を参照する後方互換 alias に置き換え、江東区の既定挙動を保つ。C2/C3 の XML 構造解釈や C3 の状態遷移は変更しない。

同様に、C4/C5 はそれぞれ `resolveWarningTimeseriesTargetArea('east')`、`resolveEarlyWarningTargetArea('east')` を既定に使えるようにして、`jmaVpwp50Parser.ts`、`jmaEarlyWarningParser.ts` に散在する `1310800` / `130010` / 名称リテラルを除去する。C6/C9/C7/F1/G系はこのIssueで取得・UIを実装しないが、後続が同じ resolver を利用する。

`jmaXmlPoller.ts` と `JmaXmlPollingServiceOptions` の既存の個別 target 注入 API は壊さない。本Issueで現在の単一 target のポーリングを、両会場の全対象へ暗黙に多重処理する変更は行わない。理由は、受信履歴の `adoption_result` が現在は電文1件につき1つであり、複数会場の採用結果を同じ列に保存できないためである。TRC の定義と C2/C3 への明示注入は可能になるが、同一サーバーで東地区・TRCを同時に常時正規化するには、後続で会場別の採用履歴（または採用結果を対象非依存に分離）を設計する必要がある。

これはTRCコードの未確認ではなく、複数会場を同時処理する永続化境界の未決定である。製造は east 既定と明示注入接続を受入範囲とし、TRC を選択する起動・API契約は統括確認後の後続 Issue とする。

速報については `KOTO_INCLUDED_AREA_CODES` を廃止し、リポジトリへ会場対象を隠さない。`listBosaiBulletins` の真偽値 `includesKoto` は `includedAreaCodes?: readonly BosaiBulletinAreaCode[]` に置換する（空配列は呼出しエラー）。SQL の `IN` プレースホルダは渡された集合から生成する。現在の江東区利用者は `resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes` を渡すため結果を変えない。C7/E6/G2 は会場 ID をどの API 境界で解決するかを後続で決め、保存済み電文の区域コード・区域名は従来どおり電文原文のまま保持する。

### 3.3 Web の移行

`apps/web/src/shell/config.ts` の `Venue` は気象対象の重複フィールド `municipality` / `amedas` と、暫定 `mapReference` を保持しない。端末設定は会場 ID を保持し、共有 resolver の戻り値を `venue` として参照する。端末名、H/K、TRCの実験用フラグは Web 固有のままにする。

これにより同会場のH/Kは同一の readonly 会場定義を共有し、東地区とTRCは異なる定義を参照する。地図・各情報パネルが後続で参照するのは解決済みの `terminal.venue.weatherTargets` であり、端末モードや地図操作から対象を再選択しない。

## 4. データの流れ

```text
URLの端末ID
  → Web端末設定（H/K と venueId）
  → resolveVenueForecastTargets(venueId)
  ├─ 警報: municipal + prefecture → C2 / C3
  ├─ 警報等時系列: municipal → C4
  ├─ 早期注意・天気風: regional → C5 / C6
  ├─ 気温: forecast station → C6
  ├─ アメダス: amedas station → C9
  ├─ 速報: included-area set → C7 / E6 / G2
  └─ 地図: mapReference → F1
```

この図の各分岐は型が異なる。たとえばアメダス `44166` を地域時系列の気温 Station に、`130000` を C2 の市町村等コードに、H/K を警報のDBキーに渡す実装は型検査で拒否する。

## 5. テスト計画

テストは先に実装を意図的に壊して red を確認する。各変更の前に、意味を変えないコメント等の対照変更で対象テストが通ることも確認し、テスト基盤の常時失敗を除外する。

1. `packages/shared/tests/venueForecastTargets.test.ts` で、east / trc を完全一致で検証する。各会場の全用途のコード、名称、座標、TRC羽田の `elements`、速報コード列の順序まで比較する。未知 `VenueId` は resolver が返さない（外部文字列を無検証で `VenueId` にしない）ことを検証する。
2. shared のコンパイル専用テスト（または `@ts-expect-error` を置く型検証ファイル）で、`AmedasStationCode` を `WarningTargetArea.municipalCode` へ、`ForecastTemperatureStationCode` を広域予報コードへ、`TerminalMode` を `VenueId` へ代入できないことを検証する。ブランドをただの `string` に戻す変異で typecheck が失敗する red を確認する。
3. `apps/api/tests/venueForecastTargets.test.ts` で adapter を完全一致検証する。east は既存 C2/C3 の江東区・東京都値、trc は大田区・東京都値となること、C4 は大田区のみ、C5 は両会場とも東京地方のみを受け取ることを確認する。municipal/prefecture を入れ替える変異で失敗することを確認する。
4. 既存の `jmaWarningTelegramParser.test.ts` と `jmaWarningCurrentProcessor.test.ts` に、TRC adapter で注入した `1311100` を含む fixture を追加する。大田区 Item は採用され、江東区 Item だけの fixture は `対象地域外` となること、C3 の stream/snapshot キーの `prefectureCode='130000'` と `areaCode='1311100'` が完全一致することを確認する。`1311100` を `1310800` に変異してこの対照が落ちることを確認する。
5. `apps/api/tests/repositories.test.ts` の速報絞り込みを、新しい集合引数で east と trc に分けて確認する。`130010` は双方に含まれ、`130012` はeastだけ、`130011`と`1311100`はtrcだけ、伊豆諸島だけの速報は双方に含まれない。集合を旧江東区定数に固定する変異でTRC検証が落ちることを確認する。
6. `apps/web/tests/shell.test.ts` を更新し、同会場H/Kが同一の共有会場定義を参照し、両会場の地図基準・警報名・アメダス名が表のとおりであることを完全一致で確認する。Web側に旧丸め座標や重複した名称リテラルを残す変異を検出する。
7. 節目で `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web` を実行する。

## 6. 実行可能な受入条件

- [ ] `packages/shared` に会場別の唯一の定義元があり、east と trc の地図・警報・広域予報・気温予報地点・アメダス・速報対象を完全一致で解決できる。
- [ ] 市町村等、府県予報区、広域予報区域、予報気温地点、アメダス地点、速報照合区域を別のブランド型で表し、誤用途への代入は `typecheck` で失敗する。
- [ ] east の C2/C3 既定値は、従来どおり江東区 `1310800` / 東京都 `130000` である。
- [ ] TRC を明示選択した C2/C3 adapter は、大田区 `1311100` / 東京都 `130000` を返し、江東区だけの XML Item を大田区として採用しない。
- [ ] C4/C5 が使用する resolver はそれぞれ大田区（TRC）と東京地方 `130010` を返し、アメダス `44166` や温度地点 `44132` を代用しない。
- [ ] 速報の読出し絞り込みは会場から解決した区域集合を受け、east と trc の直接・細分・広域の正負例を区別する。判定結果をDBへ保存しない。
- [ ] Web端末設定は同会場のH/Kで同じ会場定義を共有し、H/Kを気象コード・状態キーへ渡さない。
- [ ] TRC の羽田 `44166` と地図座標 `35.58138,139.748119`、東京ビッグサイトの地図座標 `35.63159368010876,139.79281040119963` が定義表とテストに反映され、旧TRC丸め座標と `44100` は残らない。
- [ ] 上記テストと lint/typecheck/format check がすべて成功する。

## 7. 後続 Issue への引き継ぎ

- **C4**: `warningTimeseries` を注入し、TRCでは大田区 Item を抽出する。現行の既定はeastのまま維持する。
- **C5/C6**: C5およびC6天気・風は `broadForecast`、C6気温は `temperatureForecast` を別々に受け取る。`44132` を会場やアメダスと表示しない。
- **C7/E6/G2**: `bosaiBulletin.includedAreaCodes` を会場単位で解決する API 契約を決める。電文の区域名・コード種別は保存した原文を表示し、広域を会場単独情報に改名しない。
- **C9/G6**: `amedas.elements` を確認して羽田にない湿度・日照を unavailable/未提供として表現する。別地点へのフォールバックは禁止する。
- **F1/F6**: `mapReference` を入力に、可視矩形を使う中心補正と「会場へ戻る」を実装する。ズーム値と会場マーカー詳細はこのIssueで決めない。
- **複数会場の常時処理**: 同一 API プロセスがeast/TRCを同時にポーリングする必要が生じたら、`telegram_reception` の単一 adoption 結果を会場別に保持する方式を先に設計する。現在の列を最後に処理した会場の値で上書きしてはならない。

## 8. 未確認事項・残留リスク

1. 大田区を対象とする VPBS50 の実電文、TRC用の VPWP50 / VPWW 系の実電文は未採取である。コード表に基づく対象コード定義と、既存パーサーの別市町村 fixture による検証までは本Issueの範囲とし、実電文の構造を推測しない。
2. 東京ビッグサイト公式埋込地図の値は地図の基準位置であり、個別入口・各展示ホールを指定する座標ではない。TRCも公式アクセスページの地図中心である。会場内の表示点を変更する要求があれば、ユーザーが位置を指定してから更新する。
3. TRCと東地区を同時にサーバー側で収集・正規化する開始方法、会場IDをAPIへ渡す認可されない端末URLとの対応、会場別APIレスポンスの形は未決定である。本Issueは安全な定義・注入境界までとし、単一の受信採用履歴を多会場対応と誤認しない。
