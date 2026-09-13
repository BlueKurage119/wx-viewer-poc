# Issue #33〜#35 警報関連 REST API 設計

作成日: 2026-09-14  
作成: Codex（GPT-6）  
状態: 【承認済み】2026-09-14 に設計承認。AGY GUI 手動委託による製造と、製造完了後の検収・push・PR 作成まで承認済み。マージは別途承認。

## 1. 対象と承認済み前提

#33（現況警報）、#34（警報等時系列）、#35（警報級の可能性）を、1回の AGY GUI 手動製造委託にまとめる。#36 以降、画面実装、通知生成規則の変更は含まない。

【確定】ユーザーとのヒアリングで次を確認した。

- 端末 ID から既存台帳の会場を解決し、通常表示は `controlStatus=normal` を明示して取得する。
- 未取得 `unavailable`、正常な発表なしの空一覧、保持値付き `stale` を区別し、今回の 3 API で鮮度評価を実装する。
- 量的予想と付加事項は #34 に集約する。`Addition/Note` の抽出・保存・API 提供を追加し、#33 では重複提供しない。
- 現況の洪水コード 04/18 は今回追加採用せず、未対応範囲を契約に明記する。
- 時系列の時間区間・参照関係・単位・区域区分を維持する。早期注意は near/far ごとに状態・発表時刻を持つ。

以下の具体的な DTO、鮮度条件、既存保存値の移行方法を含め、本設計は承認済みである。

## 2. 根拠と既存実装

- [Issue 一覧](../issues-draft.md) Epic E、[基本設計](../basic-design.md) §6.3、[取得方法レポート](../data-acquisition-report.md) §3、§9。
- [#13 現況構成](issue-13-warning-current-state.md)、[#14 時系列](issue-14-warning-timeseries.md)、[#15 早期注意](issue-15-early-warning.md)、[#109 会場別対象](issue-109-venue-forecast-target-definitions.md)、[#130 重複と鮮度](issue-130-duplicate-freshness-policy.md)。各文書の未確定事項を本設計で確定扱いしない。
- [公式 VPWP50 実電文](https://www.data.jma.go.jp/developer/xml/data/20260913214231_0_VPWP50_150000.xml) と [公式 VPWW61 実電文](https://www.data.jma.go.jp/developer/xml/data/20260913135859_0_VPWW61_150000.xml)。新潟市 `1510000` の雷に両方とも「竜巻」「ひょう」の `Addition/Note` がある。VPWP50 は `Property/SignificancyPart/Base/Addition/Note` にあり、当該 Note に `refID` はない。これを特定の時間セルに複製しない。
- [気象庁 XML 技術資料](https://xml.kishou.go.jp/tec_material.html)。現況と時系列が常に同時更新・全文同一であるという保証は置かない。上記実電文は付加事項の集約判断の根拠であり、全現象・全地域で全補足が等価であることの証明ではない。
- `apps/api/src/services/venueWeatherService.ts` は会場別現況・時系列の内部取得を提供し、早期注意は `resolveEarlyWarningTargetArea` と repository を組み合わせれば取得できる。
- `jmaVpwp50Parser.ts` は時間値を抽出するが Note を保存しない。既存の `warning_timeseries_value` には Property の出現位置もない。
- `jmaXmlPollingService.getStatus()` は regular/extra の取得鮮度を現在時刻で評価する。個別 snapshot の `lastSuccessAt` は解析成功時刻であり、定期的なフィード確認成功時刻ではない。
- `app.ts` は health と起動通知のみ公開済み。公開 DTO は DB 行型と分離する。

実 XML とコードの静的照合を行った。新 API、移行、追加パーサーの実挙動は未確認であり、製造・検収で確認する。

## 3. HTTP 契約

### 3.1 エンドポイントと入力

| Issue | GET パス | データ |
| --- | --- | --- |
| #33 | `/api/weather/warnings` | 現況警報・注意報 |
| #34 | `/api/weather/warning-timeseries` | 危険度・量的予想・付加事項 |
| #35 | `/api/weather/early-warning` | near と far の独立した表 |

全 API は `?terminalId=hkeagh01&controlStatus=normal` の形式とする。両パラメーター必須、重複指定・配列・オブジェクト・空文字・未知のキーは 400。`controlStatus` は `normal | training | test` の完全一致のみ受理する。台帳にない文字列の端末 ID は 404、型不正は 400。会場 ID を同時に指定して上書きする経路は設けない。H/K モードはどちらも閲覧可能とし、この端末指定自体を認証とは扱わない。

訓練・試験は明示指定時のみその保存領域を読み、normal へフォールバックしない。レスポンスの `controlStatus` は常に指定値、`isTraining` は `controlStatus === 'training'`。test は `isTraining=false` でも normal ではないため、利用側は `controlStatus` を保持する。

成功・未取得・鮮度低下は HTTP 200。入力不正は `{status:'error',code:'invalid_request'}`、端末不明は `terminal_not_found`、DB 等の内部障害は HTTP 500 / `weather_read_failed`。原文、SQL、例外本文、内部パスをエラーに出さない。GET は上流 HTTP、解析、保存値修復、通知作成、履歴追記を起動しない。`Cache-Control: no-store` を付け、時点ごとの評価を共有キャッシュで隠さない。

### 3.2 共通型

`packages/shared/src/weatherApi.ts` に公開型を新設する。以下の型はバックエンド repository を import せず定義する。

```ts
interface WeatherMetadata {
  source: string | null;
  issuedAt: UtcIso8601String | null;
  validAt: UtcIso8601String | null;
  validFrom: UtcIso8601String | null;
  validTo: UtcIso8601String | null;
  fetchedAt: UtcIso8601String | null;
  lastSuccessAt: UtcIso8601String | null;
  availability: Availability;
  sourceVersion: string | null;
}
interface WeatherContext {
  terminalId: string;
  venueId: VenueId;
  controlStatus: 'normal' | 'training' | 'test';
  isTraining: boolean;
  evaluatedAt: UtcIso8601String;
}
interface WeatherArea {
  code: string;
  name: string;
}
interface WeatherDataset<T> {
  area: WeatherArea;
  metadata: WeatherMetadata;
  data: T | null;
}
```

日時は UTC ISO 8601。`issuedAt` は保存値の発表日時、`fetchedAt` は保存値の電文受信日時、`lastSuccessAt` は保存値の解析成功日時。GET 時刻やフィード成功時刻で書き換えない。`evaluatedAt` のみリクエストの評価時刻である。現況の metadata は構成 snapshot の出所であり全項目の発表日時ではないため、項目固有の時刻・出所も提供する。

未取得は `data:null`、全メタ時刻・source・sourceVersion は null、availability は unavailable。区域は台帳から返す。保持値がある場合は metadata の値を維持し availability のみ評価結果を返す。正常空は `data` が存在する状態で空配列とする。DB の整数 ID、reception ID、content hash、ファイルパス、raw XML は公開しない。

### 3.3 #33 現況

`WarningsResponse = WeatherContext & WeatherDataset<WarningCurrentData> & {capabilities: {unsupportedKindCodes: readonly ['04','18']; supplementSource: 'warning-timeseries'}}`。

`WarningCurrentData` は `items` を持つ。items は明示的な allowlist で次のフィールドのみ写す。

`sequence, kindCode, kindName, kindStatus, lastKindCode, lastKindName, kindIssuedAt, sourceTelegram`。

既存の nullable な時刻・前種別は null のまま返す。`sourceTelegram` は保存された電文種別の文字列である。未抽出の `significancyCode/Name`、`warningLevel`、`attentionText` は提供しない。現況の取得・reducer・通知分類を変更しない。items が空でも「洪水を含む全警報なし」と利用側が解釈できないよう、unsupportedKindCodes は空一覧時も返す。未取得時にも制約を読めるよう、この 2 つの固定情報はレスポンス直下の capabilities にのみ置き、data=null を含む全状態で返す。

### 3.4 #34 時系列

`WarningTimeseriesResponse = WeatherContext & WeatherDataset<WarningTimeseriesData>`。

`WarningTimeseriesData` は `timeDefines`、`values`、`additions` を持つ。`timeDefines` は既存の `blockId,timeId,sequence,timeFrom,timeTo,duration` を公開し、`values` は次を公開する。

`blockId,refId,kindCode,kindName,kindStatus,kindDateTime,valueCategory,propertyType,valueType,valueCode,valueText,unit,description,condition,areaDivision,sequence` および下記の `scope`。

valueCategory は `risk | quantity`。Code/Name がない Kind を現況コードで補完しない。値なしは空文字・condition を保存どおり返し、0 にしない。結合キーは `(blockId,refId)` と `(blockId,timeId)`。UTC 期間・duration を残し、カナ表示文、単一最大値、3時間固定セルへ縮退しない。

```ts
interface TimeseriesScope {
  kindIndex: number;
  propertyIndex: number;
  partName: string;
  partIndex: number;
  baseIndex: number;
  localIndex: number | null;
}
interface TimeseriesAddition {
  blockId: string;
  scope: TimeseriesScope;
  propertyType: string;
  kindStatus: string;
  kindDateTime: UtcIso8601String | null;
  areaDivision: string | null;
  additionIndex: number;
  noteIndex: number;
  text: string;
}
```

各 index は XML の対応する直接の子要素を出現順に 0 始まりで数える。`kindIndex` は対象 Item 内、`propertyIndex` は Kind 内、`partIndex` は Property 内の Type を除いた対象 Part 内の出現順、`baseIndex` は Part 内、`localIndex` は Base 内の Local 出現順である。scope と blockId は snapshot 内の識別子であり更新をまたぐ安定 ID ではない。

`WarningTimeseriesData.additions: readonly TimeseriesAddition[] | null`、`WarningTimeseriesData.values` の各要素の `scope: TimeseriesScope | null` とする。既存 parser と同じく、同一 block に対象 Item は一意であることを検証し、複数なら未対応構造とするため scope に Item の index は持たない。null は旧保存値で未抽出、空配列は新パーサーで検査済みかつ付加事項なし。旧 values の `scope` も null、新規正常採用値は必ず scope を持つ。additions が null でも危険度・量的値を非表示にせず、データ鮮度と補足の取得範囲を分ける。

Base 直下の Note は `localIndex=null, areaDivision=null`、Local 内なら該当 Local の識別子と AreaName のみ付ける。同名 Property・同名 Local を文字列で統合しない。Base の補足を各 Local や時間セルへ複製しない。Note 自体に時間参照を付加しない。`Addition/Note` の直接親子・気象名前空間を検証する。Note の文字列は出現順で保持し、重複も除去しない。未知名前空間の同名要素は採用しない。未確認の時間参照属性や複雑な子要素を持つ Note は黙って情報を捨てず、既存の `未対応構造` 経路にする。

### 3.5 #35 早期注意

`EarlyWarningResponse = WeatherContext & {near: WeatherDataset<EarlyWarningData>; far: WeatherDataset<EarlyWarningData>}`。

`EarlyWarningData` は `segment: 'near'|'far'`、`telegramType`、`timeDefines`、`cells`。timeDefines は `timeId,sequence,timeFrom,timeTo,duration`、cells は `refId,phenomenonCode,phenomenonName,rankValue,condition`。整数 ID を除き、rankValue の null・condition をゼロや「低」に補完しない。timeId は各表の中だけで結合する。

near/far は各発表時刻・保持値・鮮度を独立して返し、片側未取得でも他方を返す。GET 時刻による表の結合や列の削除はしない。既存パーサーが決める明後日の JST 境界・対象期間を維持し、DTO 化で UTC 日付境界に再計算しない。

## 4. 鮮度評価

【承認済み】次の純粋な判定を GET ごとに適用する。1 リクエストで now と polling status を各 1 回取得し、near/far に同じ評価時点を使う。

1. snapshot がなければ `unavailable`。空 items 等でも snapshot があれば保持値あり。
2. 保存 metadata の availability が available でない場合は、保持値を返し `stale`。
3. regular/extra の feedFreshness が両方 available でなければ `stale`。起動直後の feed 未成功、片側失敗、停止後の閾値超過を含む。保存値があるので feed の unavailable をデータの unavailable にコピーしない。
4. #33 はここまで通れば available。現況は解除まで継続するため発表後 300 秒で失効させない。
5. #34/#35 は各 snapshot の timeDefines の最大 timeTo 以下ではなく、`now < max(timeTo)` なら available、`now >= max(timeTo)` なら stale。すべての期間が終了した保持値は削除しない。正常空で時間定義もない場合は期間による失効を判定せず feed と保存状態で評価する。

フィード鮮度は既存設定 `staleAfterSeconds`（現行 XML 300 秒）を使い、API 専用の定数を増やさない。個別 snapshot.lastSuccessAt に同閾値を適用しない。長期フィードは判定に加えない。定時・随時の和集合で発見する既存処理に合わせ、保守的に両方を必要とする。このため無関係なフィード障害で stale になる場合はあるが、新着のない正常周期だけで stale にはならない。

上記に加え、以下の条件をすべて満たす解析失敗履歴があれば、保存値ありの結果を stale にする。

- `telegram_reception` と会場別 adoption を結合し、要求 controlStatus・会場の `未対応構造` に限定する。#34 は VPWP50、#35 は near=VPFD61 / far=VPFW60、#33 は既存現況の採用対象種別に限定する。
- `telegram_reception_area` に台帳の対象区域コードが存在することを必要とする。#33/#34 は市町村等コード、#35 は広域予報区域コード。会場 adoption が存在することだけでは対象県とは断定しない。既存区域一覧はエンベロープの Area 抽出結果であり、現象の対象区域の厳密判定そのものではないという制限を残す。
- reportDateTime と controlDateTime が両方あるもののみ比較し、受信時刻で新旧を決めない。#34/#35 は保持 snapshot.telegram の `(reportDateTime, controlDateTime)` の各要素を数値時刻に変換した時刻対として順に比較し、それより新しい失敗だけを対象とする。UTC 文字列の直接比較は禁止する。同時刻・不明時刻は新しい失敗と断定しない。
- #33 は種別ごとの `warning_current_stream` の同じ時刻対を比較基準とする。未保存ストリームは snapshot.telegram の時刻対を保守的な基準にする。正常採用で同時刻以上の該当ストリームが入れば、その失敗は条件から外れる。他現象の正常採用だけで失敗を隠さない。

専用 read-only repository の `hasNewerWeatherParseFailure(connection, {venueId, controlStatus, telegramType, areaCode, baseline})` で SQL EXISTS を使う。rawBody を取得・再解析しない。UI 一覧用の既定 100 件・上限 1000 件に依存した走査はせず、時刻・区域・会場条件を SQL に指定する。時刻条件は `julianday` 等のミリ秒精度を維持する数値比較とし、変換結果が NULL の行を除外する。reportDateTime が等しい場合だけ controlDateTime を比較し、ミリ秒表記の有無で同一時刻の順序が変わらないようにする。必要な索引は追加 migration に含める。評価と DB 保存値の読取りは同じ同期 read transaction 内で行い、不整合な採用途中を返さない。

この評価は DB の availability を更新せず、通知・監視 API の判定も変更しない。本文 HTTP 取得失敗は `fetch_attempt` に URL 等しかなく種別・会場・controlStatus を確定できないため、情報別失敗に含めない。URL から推測しない。エンベロープ解析失敗で種別・時刻・区域が不明な履歴、同時刻の相違電文、区域情報欠落は未検出になり得る。これらを feed 成功で解析成功と証明したとは扱わず、承認時に検出範囲の制限として提示する。

## 5. 保存変更と移行

既存 migration は編集せず、採番済みの末尾に追加 migration を 1 本作る。

- `warning_timeseries_snapshot` に `additions_parsed INTEGER NOT NULL DEFAULT 0` を追加。
- value に scope の各 nullable 列を追加。旧行は全列 null、新規行は parser が確定した scope を保存。
- `warning_timeseries_addition` を新設。主キー、snapshot_id（snapshot 削除時 CASCADE）、block_id、scope の各列、property_type、kind_status、kind_datetime、area_division、addition_index、note_index、text を持つ。時刻参照を持たないため time_define への疑似 ref FK は張らない。
- parser 結果・保存 input/output に additions と scope を追加。parser 経由の正常採用は additionsParsed=true と値・時間定義・Note を同一 transaction で全置換。従来の直接保存呼出しが additions を省略した場合は未抽出として保存する。
- stale 保存は既存明細だけでなく additionsParsed、Note、scope も保持。未対応構造では既存 snapshot 全体を保持し、正常空の新電文では古い Note を削除する。
- 旧データの再解析は今回実施しない。移行後は additions=null のまま読み、次の新規正常電文採用で配列へ移行する。同一 URL の受信済み抑止を変更しない。GET 内の再解析や DB 更新を実装しない。

旧 DB からのアップグレード、ロールバック時の原子性、foreign_key_check をテストする。運用 DB の手動削除・初期化は行わない。

## 6. モジュールと製造境界

| 対象 | 変更 |
| --- | --- |
| `packages/shared/src/weatherApi.ts`, `index.ts` | 公開 DTO、query の検証関数・export |
| `apps/api/src/services/weatherApiService.ts` | 台帳対象の解決、snapshot→DTO の allowlist 変換 |
| `apps/api/src/repositories/weatherParseFailureRepository.ts` | `hasNewerWeatherParseFailure` による対象限定・数値時刻比較の read-only EXISTS |
| `apps/api/src/services/weatherAvailability.ts` | now、保存状態、feedFreshness、timeDefines からの純粋評価 |
| `apps/api/src/app.ts`, `server.ts` | 3 GET の登録とサービス依存の結線 |
| `apps/api/src/polling/jmaVpwp50Parser.ts`, `jmaVpwp50Processor.ts` | Note、scope の解析と保存引数 |
| `apps/api/src/repositories/types.ts`, `warningTimeseriesRepository.ts` | 保存型・読書き・stale 保持 |
| `apps/api/migrations/` | 追加 migration |
| API と shared の対応テスト | 下記受入条件 |

サービスは `createWeatherApiService({connection, getPollingStatus, now})` とし、`getWarnings(terminal, controlStatus)`, `getWarningTimeseries(terminal, controlStatus)`, `getEarlyWarning(terminal, controlStatus)` を提供する。HTTP 層で `resolveTerminalDefinition` により検証した terminal を渡す。`getPollingStatus` は既存 polling service を参照し、別インスタンスを作らない。起動時に DB 準備後、既存 polling service と同じ connection を結線する。

shared は backend 型を参照しない。既存 `createApp()` の health 単独テストを維持できるよう weather service は依存として注入するが、本番 server では必ず設定する。production の GET が登録されていることまで結線テストで確認する。

## 7. 受け入れ条件

各項目は自動テストで入力と期待値を固定し、検収報告にテスト名・結果を記録する。テスト追加の red 確認・対照実験は [検証業務標準](../rules/05-verification-protocol.md) に従う。

- [ ] A1: 各 GET に既知の east/trc の端末を指定する。別区域の sentinel を保存し、台帳の対象だけが返る。早期注意は共通広域の対象を返す。
- [ ] A2: 各 GET のパラメーター欠落・空・重複・未知キー・不正 controlStatus が 400、未知端末文字列が 404。正常な指定は 200。
- [ ] A3: normal/training/test に異なる値を保存し、指定領域だけ返る。未取得領域に他領域の値を返さず、isTraining/controlStatus が整合する。
- [ ] A4: snapshot なしは data=null・unavailable・日時 null。正常空は data が存在し空一覧。保存値ありの障害時はデータと出所時刻を保持して stale。
- [ ] A5: #33 で未抽出補足・DB ID・raw XML がレスポンスにない。空一覧の契約にも洪水 04/18 未対応が残り、既存警報通知テストが通る。
- [ ] A6: ユーザー指定 VPWP50 を fixture 化し、新潟市を parser の対象引数に指定する。雷の「竜巻」「ひょう」が Base 配下の補足として出現順に保存・返却され、時間 ref が捏造されない。公式電文由来と合成 fixture は区別する。
- [ ] A7: 同一 block 内の同名 Property、複数 Kind/Part/Base/Local、別 block の同一 timeId を合成する。scope により混ざらず、Local の AreaName が隣接要素へ漏れず、重複 Note は保持される。これは境界検証であり公式提供事実の根拠にしない。
- [ ] A8: 異なる名前空間の Addition を混ぜても採用されない。未対応 Note 構造を入力すると電文非採用となり以前の時間値・Note が保持される。
- [ ] A9: 単位、値なし condition、空 valueText、区域区分、危険度コード、duration が保存値と DTO で一致する。value の参照は同一 block の timeDefine のみに解決する。
- [ ] A10: 旧 schema に時系列データを保存して migration を適用する。既存値を失わず additions=null / scope=null。新規正常採用後は additions 配列、新規補足なし電文なら []。foreign_key_check が空。
- [ ] A11: 保存途中の失敗を注入して transaction を rollback する。timeDefines/values/Note/抽出済みフラグが混在せず、stale 保存では全明細を保持する。
- [ ] A12: now を固定し feed 最新失敗・300 秒直前/一致・再起動後未成功を検証する。snapshot ありは stale、なしは unavailable。古い発表でも新着なしで feed 正常の現況は available。
- [ ] A13: #34/#35 の最後の timeTo 直前は available、一致と経過後は stale、保持値は不変。near 期限切れ/far 有効、near 未取得/far 有効を独立に確認する。
- [ ] A14: #35 の既存 JST 明後日境界 fixture を API に通し timeFrom/timeTo と near/far 区分が不変。null rank と condition が維持される。
- [ ] A15: GET 前後で DB・通知件数が変化せず upstream fetch mock が 0 回。内部エラーは安全な 500 となり、server 結線では 3 GET が存在する。
- [ ] A16: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w packages/shared`、`npm run build` が成功する。

- [ ] A17: 会場・区域・controlStatus・種別が一致する新しい未対応構造を投入すると stale。過去電文の後着、別県、別会場、別領域、near に対する far 失敗では状態が変わらない。該当種別の同時刻以上の正常採用で回復し、他種別成功のみでは回復しないことを検証する。同一秒の `.000Z` と `Z` は等値、`.001Z` はその両方より新しい、直前秒の `.999Z` は古いとして判定されることを、reportDateTime と controlDateTime の双方で検証する。

## 8. 管理 ID の棚卸し

| 管理 ID | 今回の結論・参照 |
| --- | --- |
| AD-H004 | 3 状態と保持値を API で分離（§3.2、§4）。stale の画面表現・状態色は G9 へ。 |
| AD-H014 | 端末台帳・controlStatus 明示・公開 DTO の会場別 REST 境界を定義（§3）。 |
| AD-H016 | 既存 2 会場と対象区域の不変条件を維持。会場追加・同一区域の複数会場・広域対象分離は L2 へ。 |
| AD-H017 | 実 XML と合成 fixture を区別（A6/A7）。TRC の全対象実電文・全 cycle の実負荷は未確認のまま L2 へ。 |
| AD-H030 | 既存 value の自然キー UNIQUE は追加しない。全置換の原子性を検証し、将来の二重挿入誤用・制約要否は L2 へ。 |
| AD-H044 | 洪水 04/18 は今回も非採用。全状態の capabilities で明示（§3.3）。 |
| AD-H046 | 付加事項を #34 に集約、旧未抽出と正常空を区別（§3.4、§5）。 |
| AD-H048 | 量的値の condition・description・区域区分を保持（§3.4）。 |
| AD-H049 | near/far の時刻・状態・JST 境界を維持（§3.5）。 |
| AD-H070 | 保存有無・feed 鮮度・期間・識別可能な解析失敗を GET 時に評価（§4）。通知経路への適用は後続。 |

[Epic A〜D 棚卸し](../audit-epic-a-d.md) の各管理 ID と照合した。本表は今回の対応範囲と残件を示し、台帳全体の解消を意味しない。

## 9. 承認対象・後続引き継ぎ

【確定】洪水対応は今回の対象外とする（2026-09-14）。ユーザーが実電文で VPWS50 による代替ができないことを確認し、今回の対応を見送ると判断した。洪水 04/18 は非採用を維持し、指定河川洪水予報・水位周知河川情報の取得・解析も追加しない。API では未対応範囲を明示し、正常な発表なしと混同しない。

承認対象は §3 の DTO と endpoint、§4 の鮮度評価条件と解析失敗の制限、§5 の旧保存値を再解析しない移行方法である。新たな業務判断が必要な場合は製造で補完せず統括へ戻す。

後続画面は、#33 の未対応洪水と #34 の additions=null を「現象なし」「付加事項なし」と表示しない。付加事項の配置は Property/区域単位にし、時間セルへ推測配置しない。現況と予測の発表時刻が異なる場合も片方で上書きしない。現況危険度・未抽出補足の追加採用、旧電文の再解析、上記条件で特定できない個別 XML 取得・解析失敗の鮮度評価、通常通知差分 API、監視 API は今回の対象外として引き継ぐ。

AGY GUI への委託文は設計承認後に統括が作成する。対象ブランチと設計コミットは未発行であり、製造前に確定する。設計担当は本書 1 本だけを変更し、実装・ブランチ作成・コミットを行わない。製造は実装・自己検証・コミットまで、GUI の Walkthrough に変更ファイル・受入合否・設計との差異・停止点・未解決事項を記載する。検収は別担当が全条件を確認してから push/PR を担当する。
