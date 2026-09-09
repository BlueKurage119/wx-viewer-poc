# Issue #14「C4. VPWP50（警報等時系列）の取得・正規化」設計

作成日: 2026-09-09

## 1. 目的

GitHub Issue #14「C4. VPWP50（警報等時系列）の取得・正規化」を実装するため、気象庁公開 XML の `VPWP50` から江東区（市町村等コード `1310800`）の将来見通しを取得し、時間区間、危険度、量的予想とその区分・単位を失わずに `warning_timeseries_*` へ保存する。

本 Issue の出力は将来の見通しであり、C3 が構成する現在の警報・注意報、通知判定、通知履歴を更新しない。画面・REST API の実装、availability の失敗遷移を起動するスケジューラ、訓練・試験データの画面提示は対象外とする。

## 2. 参照資料と確定済み前提

- [`docs/issues-draft.md`](../issues-draft.md) C4
- [`docs/basic-design.md`](../basic-design.md) §5.8、§6.2、§6.3
- [`docs/data-acquisition-report.md`](../data-acquisition-report.md) §2.1、§3.1、§3.3、§6、§7、§9
- 気象庁提供サンプル `jmaxml_20260723_Samples/*_VPWP50.xml`。`MeteorologicalInfos type="量的予想時系列（市町村等）"`、`TimeSeriesInfo` ごとの `TimeDefines`、危険度の `Significancy` と elementBasis 名前空間の量的値を確認した。
- 現行の `apps/api/migrations/0002_create_warning_timeseries.sql`、`apps/api/src/repositories/types.ts`、`apps/api/src/repositories/warningTimeseriesRepository.ts`、C1 の `jmaXmlPoller.ts` / `jmaXmlFeeds.ts`、C2 の `jmaWarningTelegram*`、C3 の `jmaWarningCurrentReducer.ts`。

統括から渡された確定事項は次のとおりである。

- 対象地域は江東区 `1310800`。フィードにおける VPWP50 の所属を固定せず、定時・随時の和集合から発見する。
- `TimeDefines/TimeDefine@timeId` と各値の `refID` は、**同一の `TimeSeriesInfo` 内だけ**で結合する。別ブロックに同じ ID があっても混在させない。
- 量的予想・危険度・陸上／海上等の区分・単位・期間を保存し、最大値・範囲を現在値または単一数値へ縮退しない。発表時刻により時間区間数が変わり得る。
- VPWP50 は予測であり、現況警報や通知判定には用いない。
- Atom は起動時・復旧時にのみ長期フィードも取得し、通常時は高頻度フィードを取得する。VPWP50 は注警報と更新同期しないため、急変時に VPWP50 側の新規電文がないことは正常として扱い、現況・通知を更新しない。
- #13（C3）の実装を前提に、設計承認後は AGY へ製造を委託する予定である。

`data-acquisition-report.md` は、公開電文一覧での随時分類に反し `regular_l.xml` に東京の VPWP50 が実在したことを確認している。そのため URL や官署コードから電文 URL を組み立てず、各フィードの Atom entry が示す URL の和集合を C1 の重複抑止付き処理へ渡す。

## 3. 設計方針

### 3.1 C1〜C3 との境界

1. C1 はすべてのフィードを取得し、Atom entry の document URL 単位で重複を抑止して原文と共通エンベロープ情報を `telegram_reception` に保存する。C4 はこの保存済み reception を入力とし、HTTP GET・受信履歴の新規作成・URL の重複判定を再実装しない。
2. C2/C3 の対象は `VPWW55`〜`VPWW61` と `VPWS50` の現況警報である。VPWP50 を C2 の `processWarningTelegramReception` に通すと「対象外」として adoption を確定してしまうため、C1 の dispatch は電文種別で分ける。警報種別は既存 C2/C3 経路、`VPWP50` は本 Issue の processor、それ以外は共通エンベロープだけを保存する。C4 と C2 が同じ reception の adoption 結果を書き換えて競合してはならない。
3. C4 processor が成功したときだけ `warning_timeseries_*` の normal/training/test 別スナップショットを置換し、reception の採用結果を `警報等時系列として解析済み` にする。対象地域外・未対応構造はスナップショットを空に更新せず、理由と判定時刻だけを reception に残す。
4. C3 の reducer、`warning_current_*`、通知生成・通知履歴には C4 から import も書込みもしない。VPWP50 の `Kind/Status` と `Kind/DateTime` は、その予報要素の発表／継続・発表時刻として C4 スナップショットにのみ保持する。

### 3.2 フィード選択

通常時（scheduled/manual）は高頻度の定時 `regular` と随時 `extra` をともに取得し、起動時・復旧時（initial/recovery）はこの2つに長期の `regular_l` / `extra_l` を加える。これにより通常時は長期フィードをポーリングせず、VPWP50 を定時・随時のどちらか一方へ固定しない。いずれの場合も C1 の `processedUrlsInCycle` と DB の `hasTelegramReception(documentUrl)` をそのまま使い、同一 URL を二重保存しない。

### 3.3 XML 解釈と正規化

パーサーは C2 と同じ `@xmldom/xmldom` を用い、親子関係・namespace URI・localName を同時に検証する。localName のみの子孫探索、Atom title の部分一致、最初の一致要素の暗黙採用は行わない。共通ヘッダの日時は C2 の厳密 ISO 8601 検証（日時と timezone 必須、UTC に正規化）を共通化して再利用する。

期待する業務構造は次のとおりとする。

```text
Report / Control (jmaxml1)
       / Head    (informationBasis1)
       / Body / MeteorologicalInfos[@type="量的予想時系列（市町村等）"]
              / TimeSeriesInfo [出現順に blockId を付番]
                / TimeDefines / TimeDefine[@timeId]
                / Item [Area/Code = "1310800"]
                  / Kind / Status, DateTime?, Property+
```

- 2026-09-10 に公式 high-frequency 定時フィードから取得した東京 VPWP50（`20260909143532_0_VPWP50_130000.xml`）は、対象 `MeteorologicalInfos` が1件、その中に `TimeSeriesInfo` が3件、各 block に江東区 Item が1件あった。時間定義件数は順に8、2、2であり、すべての `TimeDefine` に Name があった。提供サンプル4件も対象 `MeteorologicalInfos` は1件、TimeSeriesInfo は3件で、時間定義件数は 14/2/3、12/2/3、10/2/3、8/2/2 と変動した。この事実から、固定区間数を置かず全 block を処理する。
- `MeteorologicalInfos` は type 一致をちょうど1件要求する。そこに含まれる各 `TimeSeriesInfo` を XML 出現順に扱い、block 内の江東区 Item はちょうど1件を受理する。全 block に江東区 Item がなければ `対象地域外`、一部 block にだけなければその block は値なしとして残りを採用する。同一 block に対象 Item が複数、または type 一致の `MeteorologicalInfos` が複数なら、意味を推測して統合せず `未対応構造` とする。
- blockId は XML にない内部キーとして `TimeSeriesInfo` ごとに安定して付番する（例: `timeseries-1`）。`timeId` 単独で FK を張らない。各 block の `TimeDefine` を `timeId`、開始日時、Duration と共に保存し、終了日時は開始日時 + ISO 8601 Duration を実装で算出する。画面の期間表示はこの3値を使うため、TimeDefine/Name は保存しない。Duration の解釈不能、重複 timeId、参照先のない refID は `未対応構造` として当該電文を非採用にする。
- Kind は `status` と `DateTime`（なければ null）を保持する。実提供サンプルの VPWP50 Kind は `Name` / `Code` を持たず、Property の `Type` が現象を表す。ゆえに現況警報用の code/name を推測・流用しない。
- `Property/Type` を propertyType として保存し、Property 内の時系列値を XML 出現順に走査する。`Significancy` は `valueCategory: 'risk'`、Name/Code/type をそれぞれ表示値・コード・valueType として保存する。elementBasis の雨量、風向、風速、降雪量、波高等は `valueCategory: 'quantity'` とし、要素 localName と `@type`、テキスト、`@unit`、`@description`、`@condition` を別々に保存する。数値への変換、最大値の選択、範囲の分解は行わない。
- `Local/AreaName` のような区分はその親の値だけに適用し、同じ Property 内の別 Local と混ぜない。区分なしの Base は `areaDivision: null` とする。陸上・海上・地域内細分類の文字列は分類・正規化しない。
- 各値の `refID` は同一 block の `TimeDefine` に完全一致で解決し、保存する value に blockId/refId をセットする。保存層の複合 FK により、異ブロックの同 ID への誤結合を防ぐ。

現行の江東区電文では、各 block の Kind すべてに Status と `type="発表時刻"` の DateTime があり、直接の Name / Code は0件だった。危険度の Significancy は Name / Code を持つ。量的値には `description`（雨量、風、潮位等）を持つもの、`condition="値なし"`（乾燥の湿度・潮位）を持つものがあった。後者は空要素でテキスト値がないため、既存の NOT NULL `value_text` には空文字を保存し、`condition` を null にも数値ゼロにも置換しない。このため、これらを連結文字列や数値へ縮退しない。

### 3.4 スナップショットと更新規則

- スナップショットのキーは既存どおり `(area_code, control_status)`。`areaCode: '1310800'`、Area の原文名を `areaName` に使う。normal/training/test は別行を更新し、訓練・試験を normal 行へ上書きしない。
- `metadata.source` は個別電文 URL、`issuedAt` は `Head/ReportDateTime`、`fetchedAt` は reception の `receivedAt`、`lastSuccessAt` は processor 成功時刻、`sourceVersion` は `Head/InfoKindVersion`（存在しなければ null）とする。`validAt` / `validFrom` / `validTo` は VPWP50 として確認できる共通の単一有効期間がないため null とする。`telegram` は Control/Head の status、InfoType、EventID、ReportDateTime、ControlDateTime を保存する。
- 正常解析は `availability: 'available'` で、その controlStatus の時間定義・値を一括置換する。電文の `InfoType=発表` が修正を含み得るため、Kind/Status が継続でも差分パッチとは見なさず、採用電文の全構造をスナップショットとして置換する。
- `stale` / `unavailable` への更新は C13/C14 など取得状態設計の責務とし、本 Issue は成功・構造不正・対象地域外を availability 状態へ勝手に変換しない。既存 repository の stale 時に明細を保持する挙動を維持する。

## 4. 保存スキーマの補正

現行 `warning_timeseries_*` は blockId を持つ点は C4 に適合するが、実 VPWP50 と次の不整合がある。

- `warning_timeseries_value.kind_code` / `kind_name` は NOT NULL だが、VPWP50 の Kind にはこの2要素がない。
- Kind の DateTime、危険度 Code、量的値の description/condition を保存する列がない。

したがって既存 migration 0002 は変更せず、C4 の新 migration で次を行う。互換性のため repository の公開 input/output 型も同時に改める。

| 対象 | 変更 | 根拠 |
|---|---|---|
| `warning_timeseries_value` | `kind_code` / `kind_name` を nullable に再構築、`kind_datetime TEXT` を追加 | VPWP50 の Kind にない値を作らず、Status・発表時刻を保持する。SQLite は NOT NULL 緩和に table rebuild が必要。 |
| 同 value | `value_code TEXT`、`description TEXT`、`condition TEXT` を追加 | 危険度 Code と量的値の説明・条件を valueText へ連結して失わないようにする。 |

新表へのコピー時は既存行の kind_code/name、既存の time/value 明細を保持し、新列は null とする。現行の `valueType`、`valueText`、`unit`、`areaDivision`、`sequence`、複合 FK は維持する。rebuild 中は foreign key pragma を適切に扱い、migration テストで既存データを含む upgrade を検証する。

## 5. モジュール・型・内部 API

```text
apps/api/
├── migrations/
│   └── 00xx_extend_warning_timeseries_for_vpwp50.sql
├── src/
│   ├── polling/
│   │   ├── jmaVpwp50Parser.ts          # 新規: VPWP50 の純粋パーサー
│   │   ├── jmaVpwp50Processor.ts       # 新規: reception の採用結果と snapshot 保存
│   │   ├── jmaXmlPoller.ts              # dispatch の種別分離
│   │   └── jmaXmlFeeds.ts               # VPWP50 を含む定時・随時の選択
│   └── repositories/
│       ├── types.ts                     # warning_timeseries の列拡張・パーサー入出力
│       └── warningTimeseriesRepository.ts
└── tests/
    ├── jmaVpwp50Parser.test.ts
    ├── jmaVpwp50Processor.test.ts
    ├── jmaXmlPolling.test.ts
    └── repositories.test.ts
```

`jmaWarningTelegramParser.ts` の警報専用解釈を VPWP50 に拡張しない。共通 XML の名前空間・日時ヘルパーが重複する場合のみ、C2/C4 の双方が使う小さな内部モジュールへ抽出する。

```ts
export const VPWP50_TELEGRAM_TYPE = 'VPWP50' as const;

export interface WarningTimeseriesTargetArea {
  readonly municipalCode: string;
  readonly displayName: string;
}

export interface ParsedVpwp50TimeDefine {
  readonly blockId: string;
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface ParsedVpwp50Value {
  readonly blockId: string;
  readonly refId: string;
  readonly kindStatus: string;
  readonly kindDateTime: UtcIso8601String | null;
  readonly kindCode: string | null;
  readonly kindName: string | null;
  readonly valueCategory: 'risk' | 'quantity';
  readonly propertyType: string;
  readonly valueType: string;
  readonly valueCode: string | null;
  readonly valueText: string;
  readonly unit: string | null;
  readonly description: string | null;
  readonly condition: string | null;
  readonly areaDivision: string | null;
  readonly sequence: number;
}

export interface ParsedVpwp50 {
  readonly area: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly ParsedVpwp50TimeDefine[];
  readonly values: readonly ParsedVpwp50Value[];
}

export type Vpwp50ParseResult =
  | { readonly ok: true; readonly value: ParsedVpwp50 }
  | { readonly ok: false; readonly disposition: '対象外' | '対象地域外' | '未対応構造'; readonly reason: string };

export function parseVpwp50(
  rawXml: string,
  expected: Pick<TelegramReception, 'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'>,
  targetArea: WarningTimeseriesTargetArea,
): Vpwp50ParseResult;

export function processVpwp50Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  targetArea: WarningTimeseriesTargetArea,
): Vpwp50ParseResult;
```

`processVpwp50Reception` は単一 transaction 内で snapshot の保存と `updateTelegramReceptionAdoption` を行う。保存失敗時に採用済みだけを記録しない。既に処理済み URL は C1 が渡さないため、同じ URL を再度採用しても明細が増殖しない。

## 6. 実装手順

1. C1/C2/C3 の完成後の API と export を確認し、VPWP50 を C2 の processor に渡さない dispatch 境界を最小変更で設ける。
2. 実提供サンプルと取得方法レポートに基づく fixture を用意し、先に parser の失敗テスト（異 block refID、参照なし refID、異 namespace、対象地域外）を red 確認する。
3. migration と repository 型を拡張し、既存データを保った upgrade、blockId+timeId の複合 FK、nullable Kind、stale の明細維持をテストする。
4. VPWP50 の純粋パーサーを実装し、全値を blockId/refID により同一ブロックの時間定義へ検証する。
5. processor と C1 dispatch を接続し、採用結果と保存が原子的であることをテストする。C3 reducer・`warning_current_*`・通知表が変更されないことを確認する。
6. C1 のフィード選択を、通常時は `regular` / `extra`、起動・復旧時は4フィードに保ち、同一 URL の cycle 内・DB 既受信重複が保存されないテストを追加する。
7. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行する。

## 7. 受け入れ条件

- [ ] 実提供 VPWP50 fixture を `parseVpwp50` に渡すと、`MeteorologicalInfos type="量的予想時系列（市町村等）"` 内の対象地域だけが採用され、Control/Head の日時・status が reception の保存値と完全一致する。
- [ ] 同一 `TimeSeriesInfo` の全 `TimeDefine@timeId` と全値の `refID` が解決され、保存済み value の `(blockId, refId)` が対応する time define を指す。別 block に同じ timeId を意図的に置いた fixture で、別 block へ結合されない。
- [ ] 実サンプルにある危険度、雨量、風向・風速、降雪量、波高について、property type、value type/text/code、unit、description、condition、area division、Kind status/dateTime が完全一致で保存・再取得できる。値を number に変換しない。
- [ ] 定時刻が異なる複数 VPWP50 fixture で TimeDefine 件数が異なっても、固定件数の仮定なく各電文の全期間を保存する。
- [ ] 公式現行東京 VPWP50 と同じ 3 block・江東区 Item 各1件の fixture で、全 block を保存する。対象 Item が一部 block にない fixture では他 block を保存し、同一 block の対象 Item が複数または対象 `MeteorologicalInfos` が複数の fixture では `未対応構造` として既存 snapshot を変更しない。
- [ ] Kind に Name/Code がない実 VPWP50 を、偽の現況警報コード・名称を補わず nullable 値として保存できる。migration 前に保存された warning_timeseries 行は upgrade 後も読め、新列は null である。
- [ ] `condition="値なし"` だけを持つ空要素は、valueText を空文字、condition を `値なし`、unit と valueType を原文どおり保存する。数値ゼロ・null・欠落へ置換しない。
- [ ] `refID` がその block の TimeDefine に存在しない、timeId が block 内で重複する、必須 namespace/type が異なる、不正日時の電文は `未対応構造` となり、既存 snapshot を変更しない。
- [ ] 有効な VPWP50 に江東区 Item がなければ `対象地域外` を記録し、既存 snapshot を変更しない。
- [ ] VPWP50 の正常処理は reception に `警報等時系列として解析済み` を1回記録し、snapshot 保存と採用記録のどちらかだけが残る状態にならない。C2 の warning processor が同じ VPWP50 の adoption を上書きしない。
- [ ] normal/training/test の VPWP50 は別 snapshot に保存され、training/test が normal の明細を更新しない。
- [ ] VPWP50 を処理しても `warning_current_*` と通知関連テーブルの行・内容が変化しない。
- [ ] scheduled/manual では `regular` / `extra` だけ、initial/recovery では4フィードを取得する。各範囲で定時・随時に同じ document URL が出現しても、C1 の cycle と DB の重複抑止により reception と snapshot 更新は1回だけである。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が通る。

## 8. 後続 Issue への引き継ぎ

- UI の警報等時系列パネルは `warning_timeseries_*` を読む。危険度の色・文字・凡例、現在を含む時間帯への初期スクロール、詳細ダイアログは §5.8/§5.13 に従う別 Issue の責務であり、本 Issue は表示順や色を確定しない。
- REST endpoint と共有 DTO は §6.2 の別実装で定める。この時、availability の3状態を boolean に縮退させず、`stale` の保存済み明細と画面非表示方針を混同しない。
- C13/C14 は通信失敗を stale/unavailable に遷移させるとき、正常な対象地域外・解析不正と「正常な発表なし」を混同しない。本 Issue の parser 結果と reception の reason を監視・履歴の根拠にできる。
- 会場設定を導入する後続 Issue は `WarningTimeseriesTargetArea` を解決して注入する。C4 自体は江東区の既定値だけを持ち、他会場のコードを推測しない。

## 9. 要ヒアリング事項

なし。長期フィードの取得契機、VPWP50 が現況・通知と独立であること、未確認の複数対象構造を統合しない扱いは確定済み前提および本設計の受理範囲に反映した。

## 10. 残留リスク

- 2026-09-10 に公式 high-frequency `regular.xml` と東京 VPWP50 の取得は確認したが、通常時の `extra.xml` における東京 VPWP50 の継続的な掲載実績、訂正・訓練・試験の実電文は未確認である。
- `MeteorologicalInfos` が複数、または同一 TimeSeriesInfo に江東区 Item が複数ある VPWP50 の実例は未確認である。受理時に勝手に統合せず未対応構造にする。
- C1〜C3 の export・テストを製造開始時に再読し、実装済みの dispatch 境界と本書の接続点に差異があれば、設計判断を変えずに最小限調整する必要がある。
