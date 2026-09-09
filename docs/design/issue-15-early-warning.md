# Issue #15「C5. 警報級の可能性（早期注意情報）の取得・正規化」設計

作成日: 2026-09-10

## 1. 目的

GitHub Issue #15「C5. 警報級の可能性（早期注意情報）の取得・正規化」を実装するため、気象庁公開 XML の `VPFD61` と `VPFW60` から東京地方（区域コード `130010`）の警報級の可能性を取得し、時間区間、現象、提供値を失わずに `early_warning_*` へ保存する。

`VPFD61` は明後日までの前半（`near`）、`VPFW60` は明々後日以降の後半（`far`）として別スナップショットに保存する。これは両情報の発表時刻と取得成否が独立し得るためである。本 Issue は画面・REST API、後半電文に残る明後日部分の画面上の除外、availability の失敗遷移、通知判定を実装しない。

## 2. 参照資料と確定済み前提

- `docs/issues-draft.md` C5
- `docs/basic-design.md` §5.9、§5.12、§6.2、§6.3
- `docs/data-acquisition-report.md` §2、§3.4、§6、§9
- 気象庁提供サンプル `jmaxml_20260723_Samples/90_01_01_241031_VPFD61.xml` と `69_01_01_241031_VPFW60.xml`。`TimeDefines`、東京地方と同じ府県予報区域の `Area/Code`、elementBasis 名前空間の `PossibilityRankOfWarning`、空要素の `condition="値なし"` を確認済み。
- 既存の `apps/api/migrations/0003_create_early_warning.sql`、`apps/api/src/repositories/earlyWarningRepository.ts`、`apps/api/src/repositories/types.ts`、C1 の XML ポーリング基盤、#14 の `jmaXmlPoller.ts` にある電文種別 dispatch。

確定事項:

- 対象は東京地方 `130010`。URL を組み立てず、C1 が定時・随時フィードから発見して保存した reception を入力にする。
- `VPFD61` は `near`、`VPFW60` は `far` として別に保存し、片方の失敗・対象地域外・未対応構造で他方の保存済み値を変更しない。
- `PossibilityRankOfWarning` の実値（例: `高`、`中`、`なし`）は原文のまま保存する。`なし` は値であり、空要素の `condition="値なし"`、自システムの未取得・取得不能と混同しない。
- 後半の「雨」は大雨と土砂災害を併せた表現である。前半のどちらかへのコピー、独自の危険度・数値確率への変換はしない。
- 訓練・試験は normal と別キーで保存する。早期注意情報は現況警報、警報等時系列、通知関連の状態を更新しない。

## 3. 設計方針

### 3.1 C1・#14 との境界

1. C1 はフィード取得、個別 XML の HTTP 取得、URL 重複抑止、共通エンベロープの解析、`telegram_reception` への保存を担当する。C5 は reception の `rawBody` を入力にし、これらを再実装しない。
2. C1 の dispatch は、既存の警報種別、`VPWP50` に続き、`VPFD61` と `VPFW60` を C5 processor にだけ渡す。対象外電文の adoption を他 processor が確定・上書きしてはならない。
3. parser 成功時だけ、対応 segment の `early_warning_snapshot` と明細を transaction 内で完全置換し、同じ transaction で reception の adoption を `早期注意情報として解析済み` に更新する。対象地域外・未対応構造では既存 snapshot を変更せず、判定理由だけを reception に記録する。
4. #14 と同じ通常時／初期・復旧時のフィード選択、cycle 内および DB の document URL 重複抑止をそのまま利用する。電文の掲載フィードを一方に固定しない。

### 3.2 XML の受理条件と正規化

parser は `@xmldom/xmldom` を用い、namespace URI、localName、直接の親子関係、必須要素数を検証する。Atom title、Control/Title、InfoKind の表示名だけから電文種別を判断しない。`telegram_reception` の電文種別・Control/Head の日時・Control/Status と、XML 内容が一致することを確認する。

共通のルート構造は次のとおりとする。

```text
Report / Control (jmaxml1)
       / Head    (informationBasis1)
       / Body / MeteorologicalInfos
              / TimeSeriesInfo
                / TimeDefines / TimeDefine[@timeId]
                / Item [Area/Code = "130010"]
                  / Kind / Property
                    / Type
                    / PossibilityRankOfWarningPart
                      / jmx_eb:PossibilityRankOfWarning[@refID]
```

- `VPFD61` と `VPFW60` のそれぞれについて、期待する `MeteorologicalInfos` の種別・`InfoKind` は実データと公式資料で確認した値だけをコード上の受理条件にする。名称の旧称が残る可能性があるため、Control/Title の文字列を受理条件に加えない。
- `TimeSeriesInfo` は当該電文の対象 `MeteorologicalInfos` 内で 1 件を受理する。複数ある、または必須の `TimeDefines`・`Item`・対象 Area が曖昧な場合は、意味を推測して結合せず `未対応構造` とする。
- `TimeDefine` は XML 出現順で `sequence` を振り、`timeId`、開始日時、`Duration`、開始日時に Duration を加算した終了日時を保存する。開始日時、Duration、timeId の欠落・重複、Duration の解釈不能は `未対応構造` とする。
- 対象 Area は `Area/Code === '130010'` の 1 件だけを受理し、その `Area/Name` を保存する。対象 Area がなければ `対象地域外`、同一 block に複数あれば `未対応構造` とする。
- 各 `Kind/Property` の `Type` を現象名として保存する。安定した公式コードが XML に存在する場合だけ `phenomenonCode` に保存し、存在しなければ Type 文字列そのものを識別子に用いる。種別名から独自コードを推測しない。
- `jmx_eb:PossibilityRankOfWarning` ごとに `refID` を同一 `TimeDefines` の `timeId` と完全一致で解決する。参照先なし、重複する `(refID, phenomenonCode)`、必須の Type・refID の欠落は `未対応構造` とする。
- 非空要素のテキストは `rankValue` に原文のまま保存し、`condition` は属性値を保存する。`なし` は `rankValue: 'なし', condition: null`、`condition="値なし"` の空要素は `rankValue: null, condition: '値なし'` とする。空要素を `なし`・`0`・空文字へ変換しない。

### 3.3 スナップショット・メタ情報

既存スキーマの一意キー `(area_code, segment, control_status)` を維持する。対象と対応は以下のとおり。

| 電文 | segment | telegramType | 対象 |
| --- | --- | --- | --- |
| `VPFD61` | `near` | `VPFD61` | 東京地方 `130010` |
| `VPFW60` | `far` | `VPFW60` | 東京地方 `130010` |

- `metadata.source` は reception の `documentUrl`、`issuedAt` は `Head/ReportDateTime`、`fetchedAt` は reception の `receivedAt`、`lastSuccessAt` は processor 成功時刻、`sourceVersion` は `Head/InfoKindVersion` とする。
- 電文全体に単一の有効期限は確認できないため `validAt` / `validFrom` / `validTo` は null とする。時間区間は明細の `timeDefines` が表す。
- 成功時は `availability: 'available'` で当該 segment・controlStatus の全明細を置換する。`stale` / `unavailable` への遷移は C13/C14 等の後続担当であり、本 Issue では取得失敗・対象地域外・解析不正を availability の値に変換しない。
- 既存 repository の stale 時に明細を保持する性質を変更しない。normal/training/test は独立に読み書きし、訓練・試験を normal に上書きしない。

## 4. モジュール・型・内部 API

```text
apps/api/src/
├── polling/
│   ├── jmaEarlyWarningParser.ts       # 新規: VPFD61 / VPFW60 の純粋 parser
│   ├── jmaEarlyWarningProcessor.ts    # 新規: snapshot 保存と adoption 更新
│   ├── jmaXmlPoller.ts                # 2 電文の dispatch 追加
│   └── index.ts                       # export 追加
├── repositories/
│   └── types.ts                       # 電文種別、対象、parser 入出力型
└── tests/
    ├── jmaEarlyWarningParser.test.ts
    ├── jmaEarlyWarningProcessor.test.ts
    └── jmaXmlPolling.test.ts
```

既存の `earlyWarningRepository.ts` と migration `0003_create_early_warning.sql` は、C5 に必要な segment、時刻定義、現象、rankValue、condition、controlStatus、共通メタ情報をすでに表現できる。そのためスキーマ変更は不要とする。

追加する型の概形は次のとおり。

```ts
export const VPFD61_TELEGRAM_TYPE = 'VPFD61' as const;
export const VPFW60_TELEGRAM_TYPE = 'VPFW60' as const;

export interface EarlyWarningTargetArea {
  readonly forecastAreaCode: string;
  readonly displayName: string;
}

export interface ParsedEarlyWarning {
  readonly segment: 'near' | 'far';
  readonly telegramType: 'VPFD61' | 'VPFW60';
  readonly area: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly EarlyWarningTimeDefineInput[];
  readonly cells: readonly EarlyWarningCellInput[];
}
```

`parseEarlyWarning(rawXml, reception, targetArea)` は DB に触れない純粋関数とする。結果は成功値または `対象外`、`対象地域外`、`未対応構造` と理由を返す。`processEarlyWarningReception(connection, reception, processedAt, targetArea)` は parser 成功時に repository 保存と adoption 更新を同一 transaction で行う。

## 5. 実装手順

1. #14 完了後の `jmaXmlPoller.ts`、export、テストの競合を確認し、C5 の dispatch を既存の VPWP50 分岐の隣に最小変更で追加する。
2. 公式サンプルを基に、VPFD61／VPFW60 の成功 fixture と、`なし`、`値なし`、対象地域外、参照先なし、不正 namespace、日時不一致、対象 Area 重複の失敗 fixture を用意する。実装前に parser の各失敗テストが red になることを確認する。
3. 純粋 parser を実装し、時刻定義と cell の参照整合性、値と condition の区別を完全一致で検証する。
4. processor を実装し、保存と adoption の原子性、near/far と normal/training/test の分離、失敗時の既存値維持をテストする。
5. C1 の混在フィード統合テストへ 2 電文を追加し、種別ごとの dispatch、URL 重複抑止、他情報種別への非干渉を検証する。
6. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行する。

## 6. 受け入れ条件

- [ ] VPFD61 の実提供 fixture を解析すると、東京地方だけが near として採用され、Control/Head の日時・status、全 TimeDefine、各 rank cell が入力 XML と完全一致する。
- [ ] VPFW60 の実提供 fixture を解析すると、東京地方だけが far として採用され、後半の「雨」を大雨・土砂災害のいずれにも複製しない。
- [ ] `なし` は `rankValue='なし'`・`condition=null`、`condition='値なし'` の空要素は `rankValue=null`・`condition='値なし'` として保存・再取得される。両者を数値、低確率、同一値に変換しない。
- [ ] `near` と `far` は発表時刻・明細・availability が独立し、far の保存または失敗で near の明細が変化しない（逆も同様）。
- [ ] normal/training/test は別 snapshot として保存され、training/test が normal を上書きしない。
- [ ] 必須 namespace・電文種別・日時が reception と一致しない、TimeDefine の重複・不正 Duration、refID の参照先なし、対象 Area の複数は `未対応構造` となり、既存 snapshot を変更しない。
- [ ] 有効な電文に東京地方がなければ `対象地域外` を reception に記録し、既存 snapshot を変更しない。
- [ ] 成功時は snapshot 保存と `早期注意情報として解析済み` の adoption 更新が同一 transaction で行われ、どちらか一方だけが残らない。
- [ ] 混在フィードで VPFD61／VPFW60 は早期注意 processor にだけ dispatch され、現況警報、VPWP50、通知関連の表・採用結果を変更しない。同一 URL が複数フィードに現れても 1 回だけ処理される。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が通る。

## 7. 後続 Issue への引き継ぎ

- 画面/API担当は near と far の発表時刻を別々に表示し、パネルでは 2 表を結合しない。後半電文の明後日部分を表示対象から外す日付境界は、発表日の JST と時間定義に基づいて処理する。
- 詳細ダイアログ担当は、共通する現象を通しの時間軸に結合してよいが、前半の大雨・土砂災害と後半の雨を同一データへ変換しない。
- availability 担当は、対象地域外・解析不正・フィード取得不能を区別し、片 segment の通信失敗で他 segment の前回正常値を削除しない。

## 8. 要ヒアリング事項

なし。対象地域、2 電文の保存単位、`なし`／`値なし`／未取得の区別は既存の確定事項に従う。

## 9. 残留リスク

- VPFD61／VPFW60 の訂正・訓練・試験の実電文は未確認である。Control/Head の値を保存・照合し、通常データへ上書きしない設計で吸収する。
- 将来の XML バージョンで対象 `MeteorologicalInfos` の複数構造が出現した場合、本 Issue は統合せず `未対応構造` として受信履歴へ残す。対応は実データと公式資料の照合後に別 Issue とする。

