# Issue #16「C6. VPFD51（地域時系列予報）の取得・正規化」設計

作成日: 2026-09-10

## 1. 目的

GitHub Issue #16「C6. VPFD51（地域時系列予報）の取得・正規化」を実装するため、気象庁公開 XML の `VPFD51` から、東京地方（Area `130010`）の `３時間内卓越天気`・`３時間内代表風` と、東京地点（Station `44132`）の `３時間毎気温` を取得して正規化し、`area_timeseries_*` に保存する。

天気・風は3時間**区間**、気温は3時間ごとの**時点**であり、各々が異なる `TimeDefines` を持つ。このため配列の添字で横並びにした単一時系列へ変換せず、値が参照する `TimeDefine` をブロック単位で保持する。風速階級 `1`〜`6` は階級値のままとし、m/s への換算、代表値の選択、補間を行わない。

本 Issue は XML の取得・正規化・保存までを対象とする。REST API（E4）、地域時系列予報パネル（G7）、天気アイコン対応（G8）、取得失敗時の availability 遷移、通知判定は対象外である。

## 2. 参照資料と確定済み前提

- `docs/issues-draft.md` C6
- `docs/basic-design.md` §5.11、§6.1、§6.2、§6.3、§9
- `docs/data-acquisition-report.md` §2、§3.5、§6、§9。実 VPFD51 で東京地方 `130010` の天気・風、東京 `44132` の気温・単位・`refID` を確認済みである。
- 気象庁提供サンプル `jmaxml_20260723_Samples/*_VPFD51.xml` と「府県天気予報，地域時系列予報（Ｒ１）解説資料」（取得方法レポート [L9]）。サンプル `24_11_03_190925_VPFD51.xml` で、`MeteorologicalInfos type="区域予報"` の `３時間内卓越天気`・`３時間内代表風`、`MeteorologicalInfos type="地点予報"` の `３時間毎気温`、各 `TimeSeriesInfo` の独立した `TimeDefines` を確認した。
- 既存の `apps/api/migrations/0004_create_area_timeseries.sql`、`apps/api/src/repositories/areaTimeseriesRepository.ts`、`apps/api/src/repositories/types.ts`、C1 の XML ポーリング基盤、#14/#15 の電文種別 dispatch。
- `docs/design/issue-109-venue-forecast-target-definitions.md`。会場別の対象定義でも広域予報区域は東京地方 `130010`、気温予報地点は東京 `44132` である。

統括から渡された確定事項は次のとおりである。

- 天気・風の対象は Area `130010`（東京地方）、気温の対象は Station `44132`（東京）である。
- 天気・風の3時間区間と、気温の3時間ごとの時点値は `TimeDefines` が異なるため、配列番号による横並びを行わず区別して保持する。
- 風速階級 `1`〜`6` はそのまま保持し、m/s への変換・補間を行わない。
- G7 の表示実装は範囲外である。

`VPFD51` は「府県天気予報」を含む複合電文であり、区域予報、地点予報、地域時系列予報以外の情報も同居する。今回受理するのは、上記3要素だけである。URL や官署コードから個別電文 URL を組み立てず、C1 が Atom フィードから発見して `telegram_reception` に保存した reception を入力にする。

## 3. 設計方針

### 3.1 C1・既存情報種別との境界

1. C1 はフィード取得、個別 XML の HTTP 取得、URL 重複抑止、共通エンベロープ解析、`telegram_reception` への保存を担当する。C6 は reception の `rawBody` を入力にして解析するため、HTTP GET、受信履歴、フィード選択を再実装しない。
2. `jmaXmlPoller.ts` は既存の現況警報、`VPWP50`、`VPFD61`／`VPFW60` の分岐に続き、`VPFD51` だけを C6 processor に dispatch する。別 processor が VPFD51 の adoption を対象外として確定・上書きしてはならない。
3. parser が成功した場合だけ、対象 control status の `area_timeseries_snapshot` と子明細を transaction 内で完全置換し、同じ transaction で reception の adoption を `地域時系列予報として解析済み` にする。対象地域・地点がない、または未対応構造のときは既存 snapshot を変更せず、理由だけを reception に記録する。
4. C6 は現況警報、警報等時系列、早期注意、通知関連テーブルへ読み書きしない。VPFD51 の `InfoType` は差分パッチの意味に推測せず、有効な1電文から得た対象明細全体をスナップショットとして置換する。
5. 通常時／初期・復旧時のフィード選択、サイクル内および DB 既受信 URL の重複抑止は C1 と #14/#15 の既存処理を用いる。VPFD51 が定時・随時のどちらへ載るかは固定しない。

### 3.2 XML の受理条件とブロック分離

parser は `@xmldom/xmldom` を用い、namespace URI、`localName`、直接の親子関係、必須要素数を検証する。文字列の部分一致、同名要素の子孫探索、最初の一致要素の暗黙採用は行わない。`telegram_reception` の電文種別、Control/Head の日時、Control/Status と XML 本文の値が一致することも確認する。

受理する構造は次の3ブロックである。`timeId` はブロックごとに独立した名前空間であるため、単独では結合キーにしない。

```text
Report / Control (jmaxml1)
       / Head    (informationBasis1)
       / Body    (meteorology1)
         / MeteorologicalInfos[type="区域予報"]
           / TimeSeriesInfo / TimeDefines / TimeDefine[@timeId]     # region-3hour
             / Item [Area/Code = "130010"]
               / Kind / Property[Type="３時間内卓越天気"]
                 / WeatherPart / jmx_eb:Weather[@refID]
               / Kind / Property[Type="３時間内代表風"]
                 / WindDirectionPart / jmx_eb:WindDirection[@refID]
                 / WindSpeedPart / WindSpeedLevel[@refID]
         / MeteorologicalInfos[type="地点予報"]
           / TimeSeriesInfo / TimeDefines / TimeDefine[@timeId]     # temperature-3hour
             / Item [Station/Code = "44132"]
               / Kind / Property[Type="３時間毎気温"]
                 / TemperaturePart / jmx_eb:Temperature[@refID]
```

- `Head/InfoKind` は実サンプル・公式資料で確認した `府県天気予報`、電文種別は `VPFD51` を要求する。Control/Title や Head/Title の表示名は受理条件に使わない。
- `MeteorologicalInfos` は `type="区域予報"` と `type="地点予報"` を各1件要求する。どちらかがない、同 type が複数、対象の `TimeSeriesInfo` が複数で意味を特定できない場合は `未対応構造` とする。今回選ばない日単位の区域予報・地点予報は、対象 `Property/Type` を持たないので無視する。
- 区域ブロックは、対象 Area `130010` を持ち、`３時間内卓越天気` と `３時間内代表風` をともに持つ `TimeSeriesInfo` をちょうど1件受理する。地点ブロックは、対象 Station `44132` と `３時間毎気温` を持つ `TimeSeriesInfo` をちょうど1件受理する。対象 Area/Station が存在しない場合は `対象地域外`、候補が複数または同じ対象 Item が複数の場合は `未対応構造` とする。
- 保存する内部 `blockId` は固定文字列 `region-3hour` と `temperature-3hour` とする。天気・風は同一の区域ブロックを共有するが、気温の `timeId` と区域の `timeId` はたとえ同じ文字列でも結合しない。
- 各 `TimeDefine` は XML 出現順に `sequence` を振り、`timeId` と開始日時を保存する。区域側は `Duration` を必須とし、開始日時に加算した終了日時とともに保存する。地点側の3時間毎気温は時点値であり、実サンプルの `TimeDefine` に `Duration` はないため、`duration: null`、`timeTo: timeFrom` として保存する。開始日時・`timeId` の欠落またはブロック内重複、区域側の Duration 欠落・解釈不能は `未対応構造` とする。
- 各値の `refID` は、**同じ blockId** の `TimeDefine@timeId` に完全一致で解決する。参照先なし、`refID` 欠落、同一 `(blockId, refID, element)` の重複は `未対応構造` とし、近い時刻への補間や別ブロックへの結合はしない。

### 3.3 値の正規化

`area_timeseries_value.element` は次の限定値を保存する。名前や数値を追加で推定しない。

| XML 要素 | `element` | 保存方法 |
| --- | --- | --- |
| `jmx_eb:Weather`（`３時間内卓越天気`） | `weather` | テキストを `valueText`、`WeatherCode` は今回の対象要素外のため保存しない。 |
| `jmx_eb:WindDirection` | `wind_direction` | テキストを `valueText`、`unit` を原文どおり保存する。方向を方位角へ変換しない。 |
| `WindSpeedLevel` | `wind_speed_rank` | テキスト階級を `valueCode` に保存する。`range` や `description` から m/s の数値を作らず、`valueNumber` は null とする。 |
| `jmx_eb:Temperature` | `temperature` | テキストと `unit` を保存し、有限数値として厳密に解釈できる場合だけ同じ値を `valueNumber` に保存する。 |

- 天気の表示文言、風向、気温の文字列・単位は XML 原文を失わず保存する。空要素または必須テキストの欠落は数値ゼロ・空文字へ置換せず `未対応構造` とする。
- 風速階級は XML の `WindSpeedLevel` が elementBasis namespace ではない実サンプル構造を受理する。値 `1`〜`6` 以外を階級として再分類せず原文を保持する。`range` と `description` は表示/API 要件として未確定で、今回の既存スキーマには保存しない。
- 気温は観測値ではなく予報値である。`valueNumber` の保存は後続 API/UI における数値表示・並び替えのための重複表現であり、単位変換・丸め・補間ではない。不正数値は `未対応構造` とする。
- 区域側と地点側の TimeDefine 件数・開始時刻が異なっても、各ブロック内の全値を保存する。共通時刻があるかどうか、また表示列へどう投影するかは G7 の責務である。

### 3.4 スナップショットとメタ情報

既存スキーマの一意キー `(area_code, station_code, control_status)` を維持する。保存キーは `areaCode: '130010'`、`stationCode: '44132'` とし、各 XML の Area/Station Name をそれぞれ保存する。normal/training/test は別行であり、訓練・試験が normal の明細を上書きしてはならない。

- `metadata.source` は reception の `documentUrl`、`issuedAt` は `Head/ReportDateTime`、`fetchedAt` は reception の `receivedAt`、`lastSuccessAt` は processor 成功時刻、`sourceVersion` は `Head/InfoKindVersion` とする。
- VPFD51 全体に、今回の3要素へ共通する単一有効期間は確認できないため、`validAt`、`validFrom`、`validTo` は null とする。値の時点・区間は各 `area_timeseries_time_define` が表す。
- 正常解析では `availability: 'available'` として対象 control status の全明細を置換する。取得失敗、対象地域外、構造不正を `stale`／`unavailable` へ変換するのは本 Issue の範囲外であり、既存の前回 snapshot を維持する。
- repository の stale 保存時に明細を維持する既存挙動を変更しない。既存 migration `0004_create_area_timeseries.sql` は、blockId、複合 FK、`value_code`／`value_text`／`value_number`／`unit` をすべて持つため、スキーマ変更は不要とする。

## 4. モジュール・型・内部 API

```text
apps/api/src/
├── polling/
│   ├── jmaVpfd51Parser.ts             # 新規: VPFD51 の純粋 parser
│   ├── jmaVpfd51Processor.ts          # 新規: snapshot 保存と adoption 更新
│   ├── jmaXmlPoller.ts                # VPFD51 dispatch 追加
│   └── index.ts                       # export 追加
├── repositories/
│   └── types.ts                       # 電文種別、対象、parser 入出力型を追加
└── venueForecastTargets.ts             # 広域予報区域・気温予報地点を1組の対象として解決する helper を追加

apps/api/tests/
├── jmaVpfd51Parser.test.ts
├── jmaVpfd51Processor.test.ts
└── jmaXmlPolling.test.ts
```

既存の `areaTimeseriesRepository.ts` と migration `0004_create_area_timeseries.sql` は変更しない。`venueForecastTargets.ts` の helper は `resolveVenueForecastTargets(venueId)` が持つ `broadForecast` と `temperatureForecast` を返し、会場による別の警報対象を地域時系列対象へ誤用しないために用いる。

```ts
export const VPFD51_TELEGRAM_TYPE = 'VPFD51' as const;

export interface AreaTimeseriesForecastTarget {
  readonly forecastAreaCode: string;
  readonly forecastAreaName: string;
  readonly temperatureStationCode: string;
  readonly temperatureStationName: string;
}

export interface ParsedVpfd51 {
  readonly area: { readonly code: string; readonly name: string };
  readonly station: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly AreaTimeseriesTimeDefineInput[];
  readonly values: readonly AreaTimeseriesValueInput[];
}

export type Vpfd51ParseResult =
  | { readonly ok: true; readonly value: ParsedVpfd51 }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

export function parseVpfd51(
  rawXml: string,
  reception: Pick<TelegramReception, 'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'>,
  target?: AreaTimeseriesForecastTarget,
): Vpfd51ParseResult;

export function processVpfd51Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target?: AreaTimeseriesForecastTarget,
): Vpfd51ParseResult;
```

`parseVpfd51` は DB に触れない純粋関数とする。`processVpfd51Reception` は parser 成功時に `saveAreaTimeseriesSnapshot` と `updateTelegramReceptionAdoption` を1 transaction で実行する。保存失敗時に adoption だけが残ってはならない。

## 5. 実装手順

1. #15 完了後の `jmaXmlPoller.ts`、export、テストの競合を確認し、VPFD51 の dispatch を既存の種別分岐へ最小変更で追加する。
2. 公式提供サンプルを基に成功 fixture を作り、区域と地点の `TimeDefines` が同じ `timeId` を用いても別 block として保存されるケースを含める。対象地域外、対象地点外、ブロック内 `timeId` 重複、他 block のみの `refID`、不正 namespace、日時不一致、対象 Item 重複の失敗 fixture を用意する。実装前に各失敗テストが red になることを確認する。
3. 純粋 parser を実装し、3要素だけを抽出する。区域の区間値と地点の時点値を blockId/refID で検証し、固定件数や添字対応を置かない。
4. processor を実装し、snapshot 保存と adoption 更新の原子性、normal/training/test の分離、失敗時の既存 snapshot 維持をテストする。
5. C1 の混在フィード統合テストに VPFD51 を追加し、種別 dispatch、URL 重複抑止、現況警報・VPWP50・早期注意・通知表への非干渉を検証する。
6. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行する。

## 6. 受け入れ条件

- [ ] 公式 VPFD51 fixture を `parseVpfd51` に渡すと、東京地方 `130010` の `３時間内卓越天気`・`３時間内代表風` と、東京 `44132` の `３時間毎気温` だけが採用され、Control/Head の日時・status は reception と完全一致する。
- [ ] 区域の `region-3hour` は3時間 Duration を持つ区間として、地点の `temperature-3hour` は `duration=null`・`timeFrom===timeTo` の時点として保存・再取得される。両者が同じ `timeId` や同じ開始時刻を持つ fixture でも、別 block の時刻定義へ結合されない。
- [ ] 対象要素の全 `refID` が同一 block の `TimeDefine` に解決される。別 block にしか存在しない refID、参照先なし、block 内重複 timeId、重複 `(blockId, refId, element)` は `未対応構造` となり、既存 snapshot を変更しない。
- [ ] 天気は `weather`、風向は `wind_direction`、風速階級は `wind_speed_rank`、気温は `temperature` として保存・再取得され、原文のテキスト・単位・気温数値が完全一致する。
- [ ] 風速階級 `1`〜`6` は `valueCode` に原文の階級として保存され、`valueNumber` は null である。range/description から m/s 値を作らず、気温と同じ時間軸へ補間しない。
- [ ] 天気・風と気温の TimeDefine 件数または時刻が異なる複数 fixture でも、固定件数・配列添字による対応付けなしに各ブロックの全値を保存する。
- [ ] 必須 namespace、電文種別、Control/Head の日時・status、`InfoKind` が reception または受理条件と一致しない電文は `対象外` または `未対応構造` となり、既存 snapshot を変更しない。
- [ ] 有効な VPFD51 に対象 Area または対象 Station がなければ `対象地域外` を reception に記録し、既存 snapshot を変更しない。対象 Area/Station・対象 TimeSeriesInfo が複数で曖昧な場合は推測して併合せず `未対応構造` とする。
- [ ] 成功時には snapshot 保存と `地域時系列予報として解析済み` の adoption 更新が同一 transaction で実行され、どちらか一方だけが残らない。
- [ ] normal/training/test は別 snapshot として保存され、training/test の VPFD51 が normal の明細を更新しない。VPFD51 処理は `warning_current_*`、`warning_timeseries_*`、`early_warning_*`、通知関連テーブルを変更しない。
- [ ] 混在フィードで VPFD51 は C6 processor にだけ dispatch され、同じ document URL が複数フィードに現れても1回だけ処理される。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が通る。

## 7. 後続 Issue への引き継ぎ

- E4 は `area_timeseries_snapshot`、`timeDefines`、`values` を blockId を保ったまま返す。区域の区間と地点の時点値を API 側で配列添字結合しない。
- G7 は `region-3hour` の `timeFrom`〜`timeTo` と、`temperature-3hour` の `timeFrom`（=`timeTo`）を意味の異なる列情報として扱う。画面上で列を共有する場合も、時点温度を区間温度に見せる補間や、存在しない時刻の値の生成をしない。
- G7 は `wind_speed_rank` を階級表示として用い、m/s 数値表示には変換しない。階級から矢羽根を選ぶ規則、天気コード／Material Symbols の対応は G7/G8 で、公式対応表を確認後に別途実装する。
- availability 担当は、フィード取得不能、対象地域外、解析不正を別に扱う。失敗時は normal/training/test それぞれの前回明細を削除せず、既存 repository の stale 明細保持を維持する。

## 8. 要ヒアリング事項

なし。対象 Area/Station、時点・区間の保持方法、風速階級の非変換、表示範囲外はいずれも統括ヒアリングで確定済みである。

## 9. 残留リスク

- 訂正・取消・訓練・試験の VPFD51 実電文は未確認である。Control/Head の値を reception と照合し、control status ごとの独立 snapshot に保存することで、通常データへの混入を防ぐ。
- 将来の XML で同一対象の複数 TimeSeriesInfo や、新たな地域時系列要素が現れた場合、本 Issue は意味を推測して併合しない。実データ・公式資料を照合して別 Issue で対応する。
- `WindSpeedLevel` の `range`／`description` を将来 API・表示で必要とする場合、現行スキーマに列がない。今回の「階級のみ保持」確定事項には含まれないため、保存列追加は別途設計する。
