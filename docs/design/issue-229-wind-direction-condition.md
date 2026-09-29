# Issue #229: 方向なしの風向と condition の保存・提供

## 1. 状態・目的・承認範囲

- 対象: [Issue #229](https://github.com/BlueKurage119/wx-viewer-poc/issues/229)
- 状態: 設計承認済み（2026-09-29）。ユーザーの製造着手指示により製造まで承認済み。
- 作成: Codex (GPT 6 Sol)。コミット署名用メール: `noreply@openai.com`。
- ヒアリング済み【確定】: 方向なしは `valueText: ""` とし、風向の `condition` を別項目で保存・API提供する。非空風向の「やや強く」「強く」等も保持する。
- 目的: 3時間区間の空テキスト・非空 condition の風向によって、地域時系列予報全体が保存されなくなることを防ぐ。
- 対象外: 地域時系列予報パネルの表示変更、日別予報の新規抽出、他電文の変更、既存データの再解析・バックフィル。

## 2. 根拠と調査結果

### 2.1 参照資料

- [取得方法レポート §3.5](../data-acquisition-report.md): 対象は東京地方 `130010` の3時間内卓越天気・代表風、東京 `44132` の3時間毎気温。日別予報と区別する。
- [#16 設計](issue-16-area-time-series-forecast.md)、[#36 設計](issue-36-timeseries-amedas-bosai-rest-apis.md)、[#58・#59 設計 §2.3・§11](issue-58-59-area-forecast-panel.md)。
- [公式Ｒ１解説資料の格納先](<../../../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/>): 「府県天気予報，地域時系列予報（Ｒ１）_解説資料.pdf」の日別風予報の例、※４－１－１(1)〜(3)、※５－１－１を直接確認。
- [公式スキーマ](<../../../docs/260907_weather-data/jmaxml_20241031_Schema(xsd)/>): `jmx_eb.xsd` の `type.WindDirection`・`type.Weather`・`type.Temperature`、`jmx_mete.xsd` の `type.WindSpeedLevel`。
- [提供サンプル](../../../docs/260907_weather-data/jmaxml_20260723_Samples/): `24_11_01`〜`24_11_03`、`24_12_01`〜`24_12_03` の `190925_VPFD51.xml` 計6本。
- 現コード: `jmaVpfd51Parser.ts`、`areaTimeseriesRepository.ts`、`weatherApiService.ts`、共有 DTO、`areaForecastModel.ts`。

リポジトリ外資料はローカル資料であり、リモート環境では参照できない場合がある。

### 2.2 公式仕様とアプリの判断の区別

公式Ｒ１の日別風予報には、要素テキストなし・`condition="風弱く"` の `WindDirection` があり、風向を特定しないと説明される。非空風向の condition は風の強さの階級として記述される。3時間内代表風の説明は8方位で、方向なしの例はない。スキーマの風向は `xs:string` で condition も任意文字列である。

6本の全地域・全地点を、Property/Type が対象の3種類に一致する範囲で集計した結果:

| 要素 | 件数 | 空テキスト | 備考 |
| --- | ---: | ---: | --- |
| Weather | 288 | 0 | 天気文字あり |
| WindDirection | 288 | 0 | condition 属性も全件なし |
| WindSpeedLevel | 288 | 0 | 風速階級あり |
| Temperature | 312 | 0 | 気温値あり |

**3時間区間での方向なし・condition 付き風向の実出現は実挙動未確認。** 本対応は、確認済みの日別表現と汎用スキーマを根拠に同構造を受容するアプリ側の設計であり、3時間区間で実際に提供されることを確定事実とは扱わない。回帰・再現テストの condition 付き3時間データは合成データと明記する。

### 2.3 他要素の空値拒否の調査

| 要素 | 現行の拒否条件 | 公式資料・スキーマとの照合 | 今回の扱い |
| --- | --- | --- | --- |
| 天気 | trim 後が空 | Ｒ１は天気5種類を説明。汎用 Weather は文字列・condition 属性を許容するが、対象3時間予報の空値の意味は確認できない | 現行維持 |
| 風速階級 | 空、または `1`〜`6` 以外 | Ｒ１は1〜6を説明。汎用 WindSpeedLevel は nullablefloat だが、対象予報での空値の意味は確認できない | 現行維持 |
| 気温 | 空、数値形式違反、非有限値 | 汎用 Temperature は nullablefloat・condition 属性あり。ただし対象3時間毎気温の空値の運用は確認できない | 現行維持 |

いずれも電文全体を未対応構造にする経路が存在する。サンプルには空値がなく、スキーマで許容されることだけでは有効な予報値・欠測・値なしの区別を確定できない。他要素の受容条件は今回緩和せず、実データまたは提供仕様の追加根拠を得た段階で判断する。これは「空値は提供されない」という断定ではない。

## 3. 値の契約

【設計案】共通の `condition: string | null` を地域時系列の値に追加する。風向以外は今回 `null` 固定。condition の未知語も列挙制限せず保持し、意味の推測・翻訳・valueText への代入はしない。

| 風向の trim 後テキスト | trim 後 condition | 結果 |
| --- | --- | --- |
| `北` 等の非空 | なし・空白のみ | 従来の値＋`condition: null` |
| `北` 等の非空 | `やや強く`、`強く`、その他の非空文字列 | 従来の値＋condition |
| 空（自己終了タグ・空白のみを含む） | `風弱く`、その他の非空文字列 | 行を保存。`valueText: ""`、condition を保持 |
| 空 | なし・空白のみ | 従来どおり電文全体を未対応構造とする |

空文字の受容条件は Issue 本文の「テキスト空・condition あり」に合わせる。API 利用者は値行の存在、`valueText === ""`、condition を併せて参照できる。`null` や行の欠落へ変換しない。未知 condition の意味まで「風弱く」と同一と断定しない。

要素そのものの欠落、refID 不正、重複、対象地域・地点の不一致など、空テキスト以外の構造検証は変更しない。8方位・16方位その他の非空文字列に新たな語彙制限は加えない。

## 4. 変更構成・シグネチャ

### 4.1 parser・型

- `apps/api/src/repositories/types.ts`: `AreaTimeseriesValueInput` に `readonly condition: string | null` を追加。継承する `AreaTimeseriesValue` と `ParsedVpfd51.values` に伝播する。
- `apps/api/src/polling/jmaVpfd51Parser.ts`: `parseVpfd51` の公開シグネチャは維持。風向で `textContent?.trim() ?? ''` と `getAttribute('condition')?.trim() || null` を抽出し、両者が空の場合だけ従来の空風向エラーにする。天気・風速階級・気温の生成値には `condition: null` を設定する。
- `apps/api/src/polling/jmaVpfd51Processor.ts`: 公開シグネチャ `processVpfd51Reception(connection, reception, processedAt, target?)` と値配列を保存する既存経路を維持する。ロジック変更は不要の見込み。

### 4.2 DB・repository

新規 `apps/api/migrations/0025_add_area_timeseries_condition.sql`（着手時に番号衝突があれば未使用の次番号）:

```sql
ALTER TABLE area_timeseries_value ADD COLUMN condition TEXT;
```

既存 migration は変更しない。既存行の condition は SQL NULL となり、既存値・キー・順序は保持する。過去の原文からの補完は行わず、以後の正常更新で condition を保存する。

`apps/api/src/repositories/areaTimeseriesRepository.ts` では row 型、INSERT 列・バインド、通常保存結果、find の行変換、stale 保存時の既存行再取得すべてに condition を通す。`saveAreaTimeseriesSnapshot(connection, input): AreaTimeseriesSnapshot` と `findAreaTimeseriesSnapshot(connection, areaCode, stationCode, controlStatus): AreaTimeseriesSnapshot | null` の引数は維持する。

### 4.3 API

- `packages/shared/src/weatherApi.ts`: `AreaTimeseriesValueDto` に必須の `readonly condition: string | null` を追加する。
- `apps/api/src/services/weatherApiService.ts`: `getAreaTimeseries` の values マッピングに `condition: v.condition` を追加する。
- `GET /api/weather/area-timeseries`、既存の `terminalId`・`controlStatus` クエリー契約、レスポンス外枠は維持する。

方向なしの行の例:

```json
{
  "blockId": "region-3hour",
  "refId": "1",
  "element": "wind_direction",
  "valueCode": null,
  "valueText": "",
  "valueNumber": null,
  "unit": "８方位漢字",
  "condition": "風弱く",
  "sequence": 7
}
```

sequence は説明用。実際は既存の並び順を保持する。新規プロパティ追加以外の旧レスポンス値は変えない。capabilities の `unsupportedFields` は現行が `weatherCode`・`windSpeedRange`・`windSpeedDescription` であり、condition は含まれていないため変更しない。

### 4.4 表示・状態・変更範囲

`areaForecastModel.ts` の既存処理は空文字を方向なしとして扱うため表示ロジックは変更不要。共有型に合わせて `apps/web/src/map/panels/areaForecast/areaForecastFixture.ts` と関連テストの地域時系列値リテラルに `condition: null` を補うことは許容する。型合わせに伴う fixture 更新は表示仕様変更に含めない。

通常・訓練の controlStatus による保存・API分離と既存 isTraining はそのまま維持する。availability の available / stale / unavailable は維持し、stale 時は空文字と condition を含む前回値を保持する。

主なテスト変更対象: `apps/api/tests/jmaVpfd51Parser.test.ts`、`jmaVpfd51Processor.test.ts`、`repositories.test.ts`、`database.test.ts`、`issue36TimeseriesAmedasBosaiRestApis.test.ts`、`apps/web/tests/areaForecastModel.test.ts`。ほかの地域時系列テストで必須型追加により必要になる値リテラル修正に限り許容する。共通テスト基盤・設定の変更は不要。

## 5. 検証方法・受け入れ条件

追加する不具合再現テストは実装修正前に失敗を確認する。検証用DBは一時DBを用い、運用DB・稼働中サーバーは変更しない。

- [ ] AC-1: parser テストで有効な合成3時間電文の風向1件を自己終了タグ・`condition="風弱く"` とする。`ok: true`、当該値の `valueText === ''`、condition と unit の保持、天気・風速階級・気温・時間定義の件数維持を検証する。空白のみのテキストでも同結果。
- [ ] AC-2: 非空風向＋`やや強く`・`強く`・任意の未知語、および空風向＋任意の非空 condition を parser テストに与える。condition が trim 後の原文で保持され、valueText に代入されない。属性なし・空白属性は null。他要素は null。
- [ ] AC-3: 空風向＋condition なし／空白だけ、不正 refID、重複をそれぞれ与え、引き続き未対応構造となる。空天気・空風速階級・空気温も拒否される対照ケースを確認する。
- [ ] AC-4: 既存のリポジトリ内公式 fixture と既存 parser テストを実行し、追加 condition を除く解析結果が変わらず、condition は null となる。非空の16方位や未知文字列も従来どおり通る。
- [ ] AC-5: 既存 migration まで適用した一時DBに旧形式行を保存し、新 migration を適用する。旧列の値・行数が変わらず condition が null。migration 再実行で重複適用がなく、新規DBでも全 migration が通る。
- [ ] AC-6: repository テストで方向なし、非空風向＋condition、condition null を保存する。保存戻り値・find・DB再オープン後の find で同一値。stale 保存では入力で旧値を上書きせず、空文字・condition を含む前回値が保持される。次の正常保存で condition を null に更新したとき旧 condition が残らない。
- [ ] AC-7: processor テストで AC-1 の原文を reception として処理し、採用結果が「地域時系列予報として解析済み」、地域時系列全体がDBに保存される。通常・訓練を分離して condition が保存され、他方を上書きしない。
- [ ] AC-8: REST テストの既存リクエスト手順を用い、AC-7 相当の保存結果を GET する。HTTP 200、方向なし行の空文字と condition、他値の維持を検証する。通常・訓練の選択、stale の前回値保持、未保存時の unavailable が既存契約どおりである。
- [ ] AC-9: 既存画面モデルのテストで空文字・非空 condition の風向行が方向なし、行なし／null は欠測となることを検証し、表示コード差分がないことを確認する。
- [ ] AC-10: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w apps/web` が成功する。共有workspaceに test 定義がある場合はそのテストも実行する。既存テストの期待値変更は condition 追加に限り、既存データの意味の変更がないことを差分レビューする。

## 6. 判断事項・後続への引き継ぎ

- 製造移行前に本設計全体の承認が必要。ヒアリング済みの方針に追加する必須の仕様質問は現時点でない。
- 先送り: 天気・風速階級・気温の空値受容。現行の全体拒否を維持し、妥当な空値が確認された場合に値の意味と API 表現を別途ヒアリングする。
- 先送り: 過去行の condition バックフィル、condition の画面表示、日別 WindForecastPart の抽出。AD-H046 の未抽出項目全体は解消しない。
- 実挙動未確認: 3時間区間での condition 付き実電文、本設計適用後の parser→DB→API の動作と migration（製造・検収で確認する）。
- 設計フェーズは資料・コードの読み取りと本書作成のみ。ブランチ・コミット・コード・設定を変更しない。
