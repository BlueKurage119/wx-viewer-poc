# Issue #18「C8. 竜巻関連電文（VPHW50/51）の取得・正規化」設計

作成日: 2026-09-11

## 1. 目的

GitHub Issue #18 を実装するため、気象庁公開 XML の `VPHW50`（竜巻注意情報）と `VPHW51`（竜巻注意情報（目撃情報付き））を取得・正規化し、Issue #17 で用いた既存テーブル `bosai_bulletin` / `bosai_bulletin_area` に保存する。

VPHW50/51 は VPBS50 と**電文形式が根本的に異なる**（basic-design.md §5.6【確定】）。実サンプル15件を実読した結果、次の3点が本 Issue の設計の中心となる。

1. **`Head/EventID` が全サンプルで空要素 `<EventID />` である。** Issue #17 の「完全な EventID を保存キーにする」方式がそのまま使えない。合成キーを設計する。
2. **`Head/ValidDateTime` が全サンプルに存在する。** basic-design.md §5.12 のとおり §5.5 の3時間固定ルールを自動適用せず、電文の明示的有効期限を保持する。
3. **Body は警報電文型（`Body/Warning/Item/Kind/Status`）であり、「なし」（＝竜巻注意情報が発表されていない）区域も列挙している。** VPBS50 のように Body から区域を取ると、竜巻注意情報が出ていない会場区域まで一致してしまう。**Body を区域抽出に使ってはならない。**

本 Issue は XML の受理・正規化・保存までを対象とする。パネル表示（Epic G2）、REST API、通知判定は対象外である。

## 2. 参照資料と確定済み前提

### 2.1 参照資料

- GitHub Issue #18 本文、`docs/issues-draft.md` C8
- `docs/basic-design.md`
  - §5.6【確定】: 対象電文に竜巻関連（VPHW50/51）を含める。「気象防災速報（竜巻注意情報・竜巻目撃情報）」として §5.12 の方針で扱う。VPBS50 と異なる電文形式のため別途の取得・正規化処理を要する。標題・対象区域・発表時刻・速報文全文を表示する。Body に自由文がなくても情報欠落と判断しない。並び順は発表時刻の新しい順。
  - §5.12: 竜巻関連は「気象防災速報」として扱い、**既存3種類の3時間固定ルールを自動適用せず、電文に明示された有効期限を扱う**（設計案）。
  - §5.6 のサンプル所見: `19_01_01_091210_VPHW50_kana.txt` に「明示された有効期限がある」。これを根拠に竜巻情報へ §5.5 の3時間ルールを適用しない。
- `docs/data-acquisition-report.md`
  - L130: 「VPHW50／51 竜巻関連。標題が気象防災速報（竜巻注意／竜巻目撃）へ変更されるが別電文形式」
  - L141: 「竜巻系の全仕様対応は追加検証事項」
  - L159: `sokuhou` レイヤーは竜巻 JSON も合成する（本 Issue では公式地図 JSON を使わない）
  - L337「次の実装で必要な作業7」: 竜巻速報の別スキーマ対応範囲を確定する
- `docs/design/issue-17-bosai-bulletin.md`（parser/processor/poller のパターン、NULL 許容方針、disposition 判定方式の規範）
- 既存実装: `apps/api/src/polling/jmaVpbs50Parser.ts` / `jmaVpbs50Processor.ts` / `jmaXmlPoller.ts` / `jmaXmlFeedParser.ts`、`apps/api/src/repositories/bosaiBulletinRepository.ts` / `types.ts`、`apps/api/src/database/migrations.ts`、`apps/api/migrations/0008_create_bosai_bulletin.sql`・`0015_relax_bosai_bulletin_nullable.sql`、`packages/shared/src/venueForecastTargets.ts`
- 気象庁提供サンプル `../../../docs/260907_weather-data/jmaxml_20260723_Samples/` の **`19_*_VPHW50*.xml` / `19_*_VPHW51*.xml` 全15件（kana 版 txt を除く XML の実数は15件。プロンプト記載の16件は kana 版を含む概数）を本設計のために実読した。**

### 2.2 統括担当から渡された確定事項

| # | 確定事項 | 本設計への反映 |
| --- | --- | --- |
| 1 | **両会場対応。** `VENUE_FORECAST_TARGETS.east.bosaiBulletin.includedAreaCodes`（`1310800`,`130012`,`130010`）と `trc.bosaiBulletin.includedAreaCodes`（`1311100`,`130011`,`130010`）と同じ判定方式を使う | §3.5。Issue #17 の `DEFAULT_BOSAI_BULLETIN_TARGET`（両会場の和集合）をそのまま再利用する |
| 2 | **VPHW50・VPHW51 の両方を別電文としてポーリング対象にする。** 目撃有無フラグを正規化データに保持する | §3.2・§3.4・§3.7。「VPHW51 は VPHW50 の上位互換」という当初前提は実サンプルと部分的に食い違うことが判明した（§2.3.2）。この食い違いは確定事項#5 で解決済み |
| 3 | **訂正・取消電文は Issue #17 と同じ NULL 許容方針を踏襲する。** 取消時に必須要素が欠ける可能性を見込み、「未対応構造」にせず NULL として受理する例外を設ける | §3.8 |
| 4 | **保存先は既存 `bosai_bulletin` / `bosai_bulletin_area` を再利用**（新テーブルを作らない）。`source` 列で VPHW50/VPHW51 を区別し、`valid_at` 列に `Head/ValidDateTime` をそのまま格納する。目撃有無フラグの列追加は設計時に検討・判断する | §3.3・§3.7。`source` 列は既存実装で `reception.documentUrl` が入り、URL に `_VPHW50_` / `_VPHW51_` が含まれるため区別は自動的に満たされる。目撃フラグは**列追加が必要**と判断した（§3.4・§3.6） |
| 5 | **VPHW50 の目撃フラグは常に `has_sighting = NULL`（判定不能）に割り切る。** `Headline/Text` の `【目撃情報あり】` 接頭辞による文字列部分一致判定は行わない。`has_sighting` は VPHW51 の `Information type="竜巻注意情報（目撃情報あり）"` の有無のみで判定する | §3.4。VPHW50 のみが配信された目撃事象でパネルの目撃強調が出ないことを許容する（追加ヒアリング済み） |
| 6 | **`valid_to` 列は使わない。** `Head/ValidDateTime` は既存列 `valid_at` にのみ格納する。`valid_to` は本 Issue のスコープでは触らず NULL のままとする（将来必要になった時点で別途判断） | §3.7・§3.8・§6・§8。当初の【設計案】（`valid_at`/`valid_to` 両方に同値を入れる）は**採らない**（追加ヒアリング済み） |
| 7 | **VPHW50 と VPHW51 の二重配信は2行並存を許容する。** `event_id` に電文種別を含める設計（`VPHW50:130010` と `VPHW51:130010` は別行）のまま。パネル表示側での重複排除は本 Issue のスコープ外・将来課題 | §3.3・§7・§8（追加ヒアリング済み） |
| 8 | **同一発表細分区域への同一電文種別の続報（新しい `ReportDateTime`）は既存行を上書きする。** `event_id` の合成キーには発表細分区域コードのみを使い、`ReportDateTime` を含めない。履歴は `telegram_reception` で参照する前提とし、`bosai_bulletin` に続報履歴を残さない | §3.3・§8（追加ヒアリング済み） |
| 9 | **未知の `Information@type` は電文全体を `未対応構造` として棄却する**（設計者判断で確定。根拠は §3.2 の注記） | §3.2 判定#10 |

### 2.3 サンプル実読で確定した事実

#### 2.3.1 電文の外形

| 事項 | 実データで確認した値（全15件） |
| --- | --- |
| ルート namespace | `Report` = `http://xml.kishou.go.jp/jmaxml1/` |
| Head namespace | `http://xml.kishou.go.jp/jmaxml1/informationBasis1/` |
| Body namespace | `http://xml.kishou.go.jp/jmaxml1/body/meteorology1/` |
| `Control/Title` | VPHW50 → `竜巻注意情報`（7件）、VPHW51 → `竜巻注意情報（目撃情報付き）`（8件）。**電文種別と1対1で対応する** |
| `Control/Status` | `通常`（全15件。訓練・試験のサンプルは**存在しない**） |
| `Control/EditorialOffice` / `PublishingOffice` | 県の地方気象台、または `気象庁本庁` / `気象庁予報部`（東京都の3件） |
| `Head/Title` | 発表官署の県名を含み、**2系統ある**。旧形式 `<県名>竜巻注意情報`（11件）、新形式 `<県名>気象防災速報（竜巻注意）`（2件）／`<県名>気象防災速報（竜巻目撃）`（2件） |
| `Head/ReportDateTime` | 全件存在 |
| `Head/TargetDateTime` | 全件存在。全件 `ReportDateTime` と同値 |
| **`Head/ValidDateTime`** | **全15件に存在**。`ReportDateTime` の +62〜80分後（例 `2009-08-10T07:38+09:00` → `08:40+09:00`）。**電文に明示された有効期限**であり、VPBS50 には無い要素 |
| **`Head/EventID`** | **全15件が空要素 `<EventID />`**。値を持つサンプルは1件も無い |
| `Head/InfoType` | `発表`（全15件。訂正・取消のサンプルは**存在しない**） |
| `Head/Serial` | `1`（14件）、`2`（`19_01_01_091210_VPHW50.xml` のみ） |
| **`Head/InfoKind`** | **`竜巻注意情報`（全15件）**。VPBS50 の `気象解説情報` とは**別の値** |
| `Head/InfoKindVersion` | `1.0_0`（VPHW50 の7件すべて）／`1.1_0`（VPHW51 の8件すべて）。**電文種別ごとに異なる** |
| `Headline/Text` | 全件存在・非空。目撃事象は `【目撃情報あり】` で始まる（7件） |
| `Headline/Information@type` | `竜巻注意情報（発表細分）`／`（一次細分区域等）`／`（市町村等をまとめた地域等）`／`（市町村等）` の4種が全件に存在。加えて VPHW51 の5件のみ `竜巻注意情報（目撃情報あり）` を持つ |
| Headline の `Item/Kind/Condition` | **`発表` のみ（全15件・延べ866件）**。「なし」の Item は Headline に現れない |
| `Areas@codeType` | `気象情報／府県予報区・細分区域等`（発表細分・一次細分・まとめた地域・目撃情報あり）、`気象・地震・火山情報／市町村等`（市町村等） |
| `Areas` あたりの `Area` 数 | **全件・全 Information で1件**（最大1） |
| `Information type="竜巻注意情報（発表細分）"` の `Item` 数 | **全件1件**。区域コードは `130010`（東京地方・一次細分）／`260000`（京都府）／`420000`（長崎県）／`110000`（埼玉県）と、**府県予報区コードと一次細分区域コードが混在する** |
| Body | `Body/Warning[@type="竜巻注意情報（...）"]/Item/{Kind/{Name,Code,Status}, Area/{Name,Code}}`。**`Kind/Status` に `発表`（延べ860件）と `なし`（延べ104件）の両方が現れ、非発表区域も列挙される**。`Area` は `Areas` に包まれず `codeType` 属性を持たない |

#### 2.3.2 目撃情報フラグの実態（確定事項#2との食い違い）

確定事項#2 は「VPHW51 は VPHW50 の上位互換で、目撃情報がある場合に Head/Title が『気象防災速報（竜巻目撃）』に変わり `Information type="竜巻注意情報（目撃情報あり）"` が追加される」としているが、実サンプルの対応関係は次のとおりであり、**Head/Title と電文種別からは目撃有無を判定できない**。

| ファイル | 電文種別 | Control/Title | Head/Title | `（目撃情報あり）` Information | Text が `【目撃情報あり】` で始まる |
| --- | --- | --- | --- | --- | --- |
| 19_01_01_091210 | VPHW50 | 竜巻注意情報 | 東京都竜巻注意情報 | なし | いいえ |
| 19_02_01_111226 | VPHW50 | 竜巻注意情報 | 京都府竜巻注意情報 | なし | いいえ |
| 19_03_01_130906 | VPHW50 | 竜巻注意情報 | 長崎県竜巻注意情報 | なし | いいえ |
| 19_04_01_140425 | VPHW51 | 竜巻注意情報（目撃情報付き） | 東京都竜巻注意情報 | **あり** | はい |
| 19_05_01_140425 | VPHW51 | 竜巻注意情報（目撃情報付き） | 東京都竜巻注意情報 | なし | いいえ |
| 19_06_01_140425 | VPHW51 | 竜巻注意情報（目撃情報付き） | 京都府竜巻注意情報 | **あり** | はい |
| 19_07_01_140425 | VPHW51 | 竜巻注意情報（目撃情報付き） | 長崎県竜巻注意情報 | **あり** | はい |
| 19_08_01_150916 | VPHW50 | 竜巻注意情報 | 埼玉県竜巻注意情報 | なし | いいえ |
| 19_08_02_150916 | VPHW51 | 竜巻注意情報（目撃情報付き） | 埼玉県竜巻注意情報 | なし | いいえ |
| 19_08_03_250630 | VPHW50 | 竜巻注意情報 | 埼玉県**気象防災速報（竜巻注意）** | なし | いいえ |
| 19_08_04_250630 | VPHW51 | 竜巻注意情報（目撃情報付き） | 埼玉県**気象防災速報（竜巻注意）** | なし | いいえ |
| 19_10_01_150916 | VPHW50 | 竜巻注意情報 | 埼玉県竜巻注意情報 | なし | **はい** |
| 19_10_02_150916 | VPHW51 | 竜巻注意情報（目撃情報付き） | 埼玉県竜巻注意情報 | **あり** | はい |
| 19_10_03_250630 | VPHW50 | 竜巻注意情報 | 埼玉県**気象防災速報（竜巻目撃）** | なし | **はい** |
| 19_10_04_250630 | VPHW51 | 竜巻注意情報（目撃情報付き） | 埼玉県**気象防災速報（竜巻目撃）** | **あり** | はい |

読み取れること。

- **`Control/Title` は電文フォーマットの識別子であり、目撃有無ではない。** VPHW51 でも目撃情報が無い電文が3件ある（19_05_01・19_08_02・19_08_04）。
- **`Information type="竜巻注意情報（目撃情報あり）"` は VPHW51 にしか現れない。** 同一事象を VPHW50 と VPHW51 の両形式で示した対（19_10_01/19_10_02、19_10_03/19_10_04）では、VPHW51 側にのみフラグがあり、VPHW50 側は本文の `【目撃情報あり】` と（新形式では）Head/Title の「（竜巻目撃）」でしか目撃を表さない。
- **Head/Title も当てにならない。** 19_10_01 は目撃事象（Text が `【目撃情報あり】`）だが Head/Title は旧形式の「埼玉県竜巻注意情報」である。
- したがって**構造的に目撃有無を確定できるのは VPHW51 のみ**である。VPHW50 では構造化されたフラグが存在しない。→ 確定事項#5 により、VPHW50 は常に `has_sighting = NULL` とする（§3.4）。

#### 2.3.3 会場区域の出現（重要）

`19_01_01_091210_VPHW50.xml`（東京都・東京地方に竜巻注意情報発表）の Headline には、**両会場の対象コードが実データとして出現する**。

- `竜巻注意情報（発表細分）`: `130010` 東京地方
- `竜巻注意情報（一次細分区域等）`: `130010` 東京地方
- `竜巻注意情報（市町村等をまとめた地域等）`: `130011` ２３区西部 / **`130012` ２３区東部** / `130013` 多摩北部 / `130014` 多摩西部 / `130015` 多摩南部
- `竜巻注意情報（市町村等）`: 53件。**`1310800` 江東区**（`Condition=発表`）、**`1311100` 大田区**（`Condition=発表`）を含む

`19_04_01_140425_VPHW51.xml`（目撃情報あり）と `19_05_01_140425_VPHW51.xml`（目撃情報なし）も同じ東京都・東京地方の電文で、江東区・大田区を `Condition=発表` で含む。

> **したがって、Issue #17 と違い、本 Issue の会場対象の正例は合成 fixture を作らず気象庁提供サンプルの原文をそのまま使える。** 対象地域外の負例も `19_08_01_150916_VPHW50.xml`（埼玉県。`110000`・`110010`・`110020` 等のみ）を原文のまま使える。合成 fixture は訂正・取消・訓練・試験・構造異常のためだけに用いる。

一方で Body の `Warning` は、19_01_01 の場合 `伊豆諸島北部 130020` や `伊豆諸島南部 130030` を `Kind/Status=なし` として列挙する。**Body から区域を取ると「発表されていない区域」を採用してしまう。** VPBS50 では Body に市町村コードしか現れず Body 走査が必須だったが、VPHW では Headline に市町村コードまで揃っているため Body を使う必要が無い。§3.5 でこれを設計として固定する。

## 3. 設計方針

### 3.1 C1・他 processor との境界

1. C1 がフィード取得・個別 XML の HTTP 取得・URL 重複抑止・`telegram_reception` への保存を担当する。C8 は reception の `rawBody` を入力とし、HTTP GET・受信履歴・フィード選択を再実装しない。
2. 電文種別は `jmaXmlFeedParser.extractTelegramTypeFromUrl`（`/_([A-Z]{4}\d{2})_/`）が URL から決めるため、`VPHW50` と `VPHW51` は reception 段階で確実に区別される。**Control/Title から電文種別を推定しない。**
3. `jmaXmlPoller.ts` の dispatch 連鎖の末尾（`VPBS50` 分岐の後）に `else if (reception.telegramType === VPHW50_TELEGRAM_TYPE || reception.telegramType === VPHW51_TELEGRAM_TYPE)` を1分岐だけ追加する。既存分岐の条件・順序は変更しない。Issue #17 設計書 §3.1-4 が「dispatch 条件は電文種別の完全一致とする」と定めた前提をそのまま満たす。
4. C8 は `warning_current_*` / `warning_timeseries_*` / `early_warning_*` / `area_timeseries_*` / 通知関連テーブルへ読み書きしない。
5. **envelope 検証（`jmaXmlFeedParser.parseTelegramXml`）は EventID を必須にしていない**ことを実コードで確認した（`getDirectChildTextNS` の結果をそのまま `eventId` に入れるだけで、null でも `isValidEnvelope: true` になり得る）。`Area/Code` が1件以上あることは要求するが、VPHW は Headline・Body に多数の `Area` を持つためこれを満たす。**C1 側の変更は不要である。**

### 3.2 受理条件（XML 構造）

parser は `@xmldom/xmldom` を用い、Issue #17 と同様に namespace URI・`localName`・**直接の親子関係**・要素数を検証する。文字列の部分一致、同名要素の子孫探索、最初の一致要素の暗黙採用を行わない。

```text
Report (jmaxml1)
  / Control
    / Title      = "竜巻注意情報"（VPHW50） | "竜巻注意情報（目撃情報付き）"（VPHW51）
    / DateTime   → controlDateTime（更新判別に使う）
    / Status     = 通常 | 訓練 | 試験 → ControlStatus
    / EditorialOffice, PublishingOffice   ※保存しない（§3.7）
  / Head (informationBasis1)
    / Title            → title（例: 埼玉県気象防災速報（竜巻目撃））
    / ReportDateTime   → reportDateTime（発表時刻）
    / TargetDateTime   ※保存しない（全件 ReportDateTime と同値・§3.7）
    / ValidDateTime    → validDateTime（明示された有効期限。§3.7）
    / EventID          ※空要素。保存キーに使わない（§3.3）
    / InfoType         = 発表 | 訂正 | 取消
    / Serial           ※保存しない
    / InfoKind         = "竜巻注意情報"
    / InfoKindVersion  → sourceVersion（1.0_0 / 1.1_0）
    / Headline
      / Text                                     → headlineText（速報文全文）
      / Information[@type="竜巻注意情報（発表細分）"]            必須・1個
        / Item（1個）/ Kind / {Name, Code, Condition="発表"}
                     / Areas[@codeType] / Area / {Name, Code}   → 発表細分区域（保存キーの素）
      / Information[@type="竜巻注意情報（一次細分区域等）"]        必須・1個
      / Information[@type="竜巻注意情報（市町村等をまとめた地域等）"] 必須・1個
      / Information[@type="竜巻注意情報（市町村等）"]              必須・1個
      / Information[@type="竜巻注意情報（目撃情報あり）"]          任意（VPHW51 のみ）→ hasSighting
  / Body (meteorology1)
    / Warning[@type] / Item / {Kind/{Name,Code,Status}, Area/{Name,Code}}
      ※区域抽出に使わない（§3.5）。構造検証もしない（§5.6【確定】"Bodyに自由文がなくても情報欠落と判断しない"）
```

受理判定は次の順に行い、それぞれ `disposition` を返す。

| # | 条件 | disposition |
| --- | --- | --- |
| 1 | reception の電文種別が `VPHW50` / `VPHW51` のいずれでもない | `対象外` |
| 2 | ルート・Control・Head の namespace／必須要素（`Control/Title`・`Control/DateTime`・`Control/Status`・`Head/Title`・`Head/ReportDateTime`・`Head/InfoType`・`Head/InfoKind`・`Head/Headline`）が欠落または2個以上 | `未対応構造` |
| 3 | `Head/InfoKind` が `竜巻注意情報` でない | `対象外` |
| 4 | `Control/Title` が電文種別に対応する値でない（VPHW50↔`竜巻注意情報`、VPHW51↔`竜巻注意情報（目撃情報付き）`） | `未対応構造` |
| 5 | `Control/DateTime`・`Head/ReportDateTime`・`Control/Status` が reception の値と一致しない | `未対応構造` |
| 6 | `Head/ValidDateTime` が欠落・空・日時として解釈不能 | `未対応構造`（**例外**: `InfoType='取消'` は `validDateTime=null` として受理。§3.8） |
| 7 | `Headline/Text` が欠落・空 | `未対応構造`（**例外**: `InfoType='取消'` は `headlineText=null` として受理。§3.8） |
| 8 | `Information type="竜巻注意情報（発表細分）"` が0個または2個以上 | `未対応構造`（**例外**: `InfoType='取消'` で0個は `informationTag=null`・保存キーを代替式へ切り替えて受理。§3.3・§3.8） |
| 9 | 発表細分 Information の `Item` が1個でない、`Item/Kind/Name` が `竜巻注意情報` でない、`Item/Kind/Condition` が `発表` でない、`Areas/Area` が1個でない、`Areas@codeType` が欠落 | `未対応構造` |
| 10 | 必須の4 Information type（発表細分・一次細分区域等・市町村等をまとめた地域等・市町村等）のいずれかが欠落、または既知5種以外の `Information@type` が存在する | `未対応構造` |
| 11 | `Area` に `Name`・`Code` が欠ける、または `Areas@codeType` が無い（発表細分以外の Information も含む） | `未対応構造` |
| 12 | 抽出区域が0件 | `未対応構造` |
| 13 | 抽出区域に両会場の `includedAreaCodes` のいずれも含まれない | `対象地域外` |

- **`InfoKindVersion` は受理条件にしない。** VPHW50 は `1.0_0`、VPHW51 は `1.1_0` と電文種別によって異なり、将来の版更新もあり得る。値は `source_version` に記録するだけとする（Issue #17 §3.2 と同じ判断）。
- **`Head/Title` の県名・括弧内文字列（「（竜巻注意）」「（竜巻目撃）」）で種別・目撃有無を判定しない。** 旧形式・新形式の2系統があり、19_10_01 のように目撃事象でも旧形式タイトルになる実例がある（§2.3.2）。`title` 列には原文を保存するのみとする。
- **`Headline/Text` の `【目撃情報あり】` 接頭辞でも判定しない**（文字列の部分一致による判定を禁じる Issue #17 §3.2 の規律を踏襲）。確定事項#5 のとおり確定である（→ §3.4）。
- **判定#10 で未知の `Information@type` を `未対応構造` にする（設計者判断で確定・確定事項#9）。** 区域体系が追加されたことを黙って取りこぼさないためである。無視して既知分だけで処理を続ける案は採らない。根拠は次の3点であり、統括担当の追加判断を要しないと評価した。
  1. 会場対象判定は「抽出区域が会場コードと交差するか」で行うため、未知区分に会場コードが含まれる形式改訂が起きた場合、無視方式では**発表されている竜巻注意情報を `対象地域外` として静かに落とす**（エラーも警告も出ない）。棄却方式では `未対応構造` として `telegram_reception` に記録され、監視画面（Epic F）から検知できる。CLAUDE.md 8章「エラーも警告も出ずに壊れるものを避ける」の方針に一致する。
  2. 「実データ・公式資料と照合できたものだけを確定事実として扱う」（CLAUDE.md 気象データに関する遵守事項）に従えば、未確認の構造を暗黙に受理する方式は採れない。
  3. Issue #17 §3.2 が既に「既知集合外の値は `未対応構造`」の規律を採っており、本 Issue で方針を反転させると同一テーブルへ書く2経路の受理基準が食い違う。
  - トレードオフ（形式改訂の瞬間に竜巻速報が全件表示されなくなる）は §10 に残留リスクとして記す。PoC の性質上、誤った非表示より検知可能な停止を選ぶ。

### 3.3 保存キー（EventID が空である問題）

`Head/EventID` は全15サンプルで空要素であり、`bosai_bulletin` の `UNIQUE (event_id, control_status)` に空文字列を入れると**全 VPHW 電文が1行に衝突する**。`saveBosaiBulletin` は `validateNonEmptyString(input.eventId, 'eventId')` で空文字列を拒否するため、そもそも保存できない。

**設計: 合成キーを `event_id` 列に入れる。原文 EventID は保存キーに一切使わない。**

```text
event_id = `${telegramType}:${発表細分区域コード}`
  例: "VPHW50:130010" / "VPHW51:130010" / "VPHW50:110000"
```

- **発表細分区域コード**は `Information type="竜巻注意情報（発表細分）"` の唯一の `Item/Areas/Area/Code`（判定#9 で1件であることを保証）とする。これは竜巻注意情報の発表単位であり、府県予報区コード（`110000` 等）と一次細分区域コード（`130010` 等）が混在するが、いずれも6桁の区域コードとしてそのまま使う（意味の解釈・変換をしない）。
- **電文種別を接頭辞に含める（確定事項#7）。** VPHW50 と VPHW51 が同一発表細分区域に対して二重配信された場合（実例: 19_10_01/19_10_02）、**2行の並存を許容する**。これにより VPHW50 と VPHW51 が互いを上書きしない。パネル表示側での重複排除は本 Issue のスコープ外・将来課題である（§7・§8）。
- **`Head/ReportDateTime` は保存キーに含めない（確定事項#8）。** 合成キーの可変部は発表細分区域コードのみである。同一発表細分区域への同一電文種別の続報は既存行を上書きし、続報履歴は `bosai_bulletin` に残さない。履歴は `telegram_reception`（Epic F の監視画面）で参照する。
- **原文 EventID が非空になった場合も合成キーを使う。** 「非空なら原文、空なら合成」という分岐を入れると、同一事象が仕様改訂の前後で別キーになり並存する。キーの決め方は電文種別によって一定であることを優先する。原文 EventID は C1 が `telegram_reception.event_id` に既に保存しているため、情報は失われない。
- **取消電文で発表細分 Information が欠ける場合**（判定#8 の例外）は、`event_id = `${telegramType}:cancel:${controlDateTime}`` とする。取消は既存行の上書きを狙う操作だが、対象区域が読めない取消電文は上書き先を特定できないため、既存行に触れない独立行として記録する。**実挙動未確認**であり §10 に残留リスクとして記す。
- 合成キーであることが後段から明らかになるよう、`event_id` の書式（`<電文種別>:<発表細分区域コード>`）を §8 の引き継ぎ事項に明記する。

**更新判定**は Issue #17 §3.5 と同一とする。同一 `(event_id, control_status)` の既存行があるとき、新電文の `Control/DateTime` が既存行より**新しければ upsert**、**同じか古ければ**保存せず adoption を `重複または旧版` にする。`Head/Serial` は同一 EventID 内の単調増加を実データで確認できていないため更新判定に使わない（19_01_01 が `Serial=2` である一方、同一事象の続報サンプルが無く比較できない）。

この設計の帰結として、**同一発表細分区域に対する連続した発表（Serial 1→2）は1行に上書きされ、過去の発表は `bosai_bulletin` に残らない。これは確定事項#8 として承認済みの挙動である。** Issue #17 の VPBS50 が EventID 単位で上書きするのと同じ扱いであり、履歴は `telegram_reception` と監視画面（Epic F）に集約する設計方針（basic-design.md §5.6「履歴は監視画面に集約する」）に沿う。

### 3.4 目撃情報フラグ

**判定は `Information type="竜巻注意情報（目撃情報あり）"` の有無のみで行う（確定事項#5）。**

| 電文種別 | `（目撃情報あり）` Information | `has_sighting` |
| --- | --- | --- |
| VPHW51 | あり（`Item/Kind/Condition='発表'`） | `1`（true） |
| VPHW51 | なし | `0`（false） |
| VPHW50 | （構造上存在しない） | **`NULL`（判定不能）** |
| VPBS50（既存行） | — | `NULL`（該当なし） |

- **VPHW50 を `0`（目撃なし）にしない。** §2.3.2 のとおり、VPHW50 の実サンプルには目撃事象（19_10_01・19_10_03）が含まれるにもかかわらず構造化フラグが無い。これを `false` として保存すると「目撃情報が無かった」と誤って断定する。`NULL` は「この電文形式では目撃有無を構造的に判定できない」を意味する。
- パネル（G2）は `has_sighting = 1` のときだけ目撃を強調し、`0` と `NULL` はいずれも強調しない。したがって表示上の挙動は `0`/`NULL` で変わらないが、DB 上の意味は区別される。
- `（目撃情報あり）` Information の `Item/Areas/Area` は区域集合に含める（§3.5）。**「目撃された区域」を区域明細で個別に区別する列は持たない**（現行スキーマに列が無く、§5.6 の必須表示項目にも含まれない）。→ §8 引き継ぎ。
- **本文 `【目撃情報あり】` 接頭辞や Head/Title の「（竜巻目撃）」を根拠に `1` としない（確定事項#5）。** 文字列の部分一致で気象上の意味を決めない規律（CLAUDE.md 「気象データに関する遵守事項」、Issue #17 §3.2）を守る。この判断は「VPHW50 のみが配信された目撃事象ではパネルに目撃の強調が出ない」という限界を伴うが、統括担当のヒアリングで**その限界を許容すると確定した**。実装・テストでこの割り切りを覆さないこと（§10）。

### 3.5 区域の抽出と対象判定

**抽出（保存する区域）**

1. `Headline` の子 `Information` を**文書出現順**に走査し、各 `Information` の `Item` を出現順に読む。
2. `Item/Kind/Condition` が `発表` の Item のみを採用する。`発表` 以外の値を持つ Item は区域抽出から除外する（全サンプルで `発表` のみだが、将来「なし」「解除」等が Headline に現れた場合に非発表区域を採用しないための明示的な条件）。
3. `Item/Areas/Area` の `Name`・`Code` を読み、`Areas@codeType` をその行の `codeType` とする。
4. 走査対象の `Information@type` は既知5種すべて（発表細分・一次細分区域等・市町村等をまとめた地域等・市町村等・目撃情報あり）とする。
5. `(areaCode, codeType)` の組で重複を除去する（`UNIQUE (bulletin_id, area_code, code_type)` に合わせる）。`sequence` は重複除去後の 0 起点連番とする。同じ `areaCode` でも `codeType` が異なれば別行として保存する。
6. **`Body/Warning` は走査しない。** §2.3.3 のとおり Body は `Kind/Status='なし'` の非発表区域を列挙するため、区域抽出に使うと竜巻注意情報が発表されていない会場区域を採用してしまう。Body の構造検証も行わない。
7. `Area` に `Name` または `Code` が欠ける、`Areas@codeType` が無い場合は `未対応構造` とする。空文字を補わない。

**対象判定（採用するか）**

- 判定集合は Issue #17 が実装済みの `DEFAULT_BOSAI_BULLETIN_TARGET`（`VENUE_FORECAST_TARGETS.east.bosaiBulletin.includedAreaCodes` と `trc` の同項目の和集合 = `1310800`, `130012`, `130010`, `1311100`, `130011`）を**そのまま再利用する**。竜巻用に別の定義を作らない（確定事項#1）。
- 抽出済み区域の `areaCode` がこの和集合と1件でも交差すれば採用して保存する。交差しなければ `対象地域外` として reception に記録し、`bosai_bulletin` を一切変更しない。
- 直接対象（市町村コード一致）と広域情報（府県予報区・細分区域コード一致）の区別は列として持たない。Issue #17 §3.4 と同じく、保存済み `areas[].areaCode`・`codeType` と会場定義から後段で導出する。
- 会場別の一覧取得は既存 `listBosaiBulletins(connection, { controlStatus, includedAreaCodes })` でそのまま満たせる。リポジトリの絞り込み実装の変更は不要である。

### 3.6 保存先とスキーマ変更

**新規テーブルは作らない**（確定事項#4）。既存 `bosai_bulletin` / `bosai_bulletin_area` と `bosaiBulletinRepository.ts` を再利用する。

**目撃フラグのための列追加を1本だけ行う。** 現行スキーマに目撃有無を表せる列は無く、`information_tag` に押し込むと「速報の種別」と「目撃有無」という別次元の情報が1列に混ざる。確定事項#4 が列追加の検討を委ねているため、**列追加が必要**と判断した。

```sql
-- apps/api/migrations/0016_add_bosai_bulletin_has_sighting.sql
ALTER TABLE bosai_bulletin
  ADD COLUMN has_sighting INTEGER CHECK (has_sighting IN (0, 1));
```

- `0008` / `0015` は**書き換えない**。マイグレーションランナー（`apps/api/src/database/migrations.ts`）は `migrations` ディレクトリを `readdirSync` で走査し、適用済みマイグレーションの **SHA-256 チェックサムを検証する**（L58・L90）ため、既存ファイルの変更は起動時エラーになる。
- **NULL 許容（`NOT NULL DEFAULT 0` にしない）。** §3.4 のとおり `NULL` は「判定不能／該当なし」を意味し、既存の VPBS50 行にも `NULL` が入るのが正しい。
- **テーブル再構築は不要である。** `ALTER TABLE ... ADD COLUMN` で `CHECK` 制約付きの NULL 許容列を追加できることを **better-sqlite3（同梱 SQLite 3.53.4）で実測確認した**: 既存行に `NULL` が入り、`1` の INSERT が成功し、`5` の INSERT が `CHECK constraint failed: has_sighting IN (0,1)` で拒否される。したがって Issue #17 §3.8 のような子テーブルを含む再構築（DROP 順序の罠）は発生しない。検証に使った一時 DB は削除済みである。

**リポジトリ・型の変更**

- `apps/api/src/repositories/types.ts`: `BosaiBulletinInput` と `BosaiBulletin` に `readonly hasSighting: boolean | null;` を追加する。
- `apps/api/src/repositories/bosaiBulletinRepository.ts`:
  - `BosaiBulletinRow` に `readonly has_sighting: number | null;` を追加する。
  - `saveBosaiBulletin` の `INSERT` 列リスト・`VALUES` プレースホルダ・`ON CONFLICT DO UPDATE SET`（`has_sighting = excluded.has_sighting`）・バインド引数に `has_sighting` を追加する。`input.hasSighting === null ? null : input.hasSighting ? 1 : 0` で変換する。
  - 行 → ドメインのマッピングで `hasSighting: row.has_sighting === null ? null : row.has_sighting === 1` とする。
  - `SELECT` が `*` でなく列を列挙している箇所には `has_sighting` を追加する。
- **既存の VPBS50 processor（`jmaVpbs50Processor.ts`）は `hasSighting: null` を明示的に渡すよう1行だけ変更する。** 型が必須プロパティになるため typecheck で漏れが検出される（省略可能にしない）。
- Issue #6 / #17 の既存テストで `BosaiBulletinInput` を組み立てている箇所も `hasSighting: null` の追加が必要になる。

### 3.7 メタ情報（`SnapshotMetadataInput`）

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| `source` | reception の `documentUrl` | 既存実装どおり。URL に `_VPHW50_` / `_VPHW51_` を含むため確定事項#4 の「`source` 列で区別」を満たす |
| `issuedAt` | `Head/ReportDateTime` | 発表時刻 |
| `validAt` | **`Head/ValidDateTime`** | 確定事項#4 |
| `validFrom` | null | |
| `validTo` | **null（固定）** | **確定事項#6。`valid_to` は本 Issue のスコープでは使わない。** `Head/ValidDateTime` は `valid_at` にのみ格納する。当初の【設計案】（`valid_at`/`valid_to` 両方に同値を入れて表示終了判定を `valid_to` で統一する）は採らない。表示層は `valid_at` を見る（§8）。将来 `valid_to` が必要になった時点で別途判断する |
| `fetchedAt` | reception の `receivedAt` | |
| `lastSuccessAt` | processor の処理時刻 | |
| `availability` | `'available'` | |
| `sourceVersion` | `Head/InfoKindVersion`（`1.0_0` / `1.1_0`） | |

- `Head/TargetDateTime` は全15件で `ReportDateTime` と同値であり、保存する意味が無いため保存しない（VPBS50 は `valid_at` に入れているが、竜巻では `valid_at` を `ValidDateTime` に使う）。
- `Control/EditorialOffice`・`PublishingOffice`（発表官署）は Issue #17 と同じく保存しない（列が無い）。
- `Head/Serial`・`Area/Status` に相当する情報も保存しない。
- 取得失敗・対象地域外・構造不正を `stale`／`unavailable` へ変換するのは本 Issue の範囲外。既存行は変更しない。
- **訓練・試験は `control_status` により別行となる。** 訓練電文が `normal` の行を上書きしてはならない。`isTraining` に相当する情報は `control_status='training'` として伝播し、本番相当の速報と同一視しない（CLAUDE.md 気象データ固有の注意）。

### 3.8 InfoType（発表／訂正／取消）の扱い

Issue #17 §3.6 の NULL 許容方針を踏襲する（確定事項#3）。

- `info_type` に原文（`発表`/`訂正`/`取消`）をそのまま保存する。値集合を enum で狭めない（実データで確認できたのは `発表` のみ）。
- `is_cancelled` は `infoType === '取消'` のときだけ `true`。取消電文も**同一 `event_id` の行を上書き**し、行の削除は行わない。
- `information_tag` には Headline 発表細分 Information の `Item/Kind/Name` の原文（全サンプルで `竜巻注意情報`）を保存する。表示名の合成・変換は行わない。VPBS50 の `線状降水帯発生` 等と同じ列に別語彙が入るが、いずれも XML 原文であり、後段は値で種別を判別できる。
- **`InfoType='取消'` の電文に限り**、次を `未対応構造` としない。
  - `Headline/Text` の欠落・空 → `headline_text = NULL`
  - `Head/ValidDateTime` の欠落・空 → `valid_at = NULL`（`valid_to` は発表電文でも取消電文でも常に NULL・確定事項#6）
  - 発表細分 Information の欠落 → `information_tag = NULL`、`event_id` は §3.3 の代替式
- **既存行からの引き継ぎ・`Head/Title` による代用・文言の合成は一切行わない。** 「取消時点の電文に何が書かれていたか」を DB がそのまま表す。
- **情報タグが NULL の取消電文でも、区域による対象判定は従来どおり行う。** 抽出区域が0件の取消電文は判定不能であるため `未対応構造`、対象コードに交差しなければ `対象地域外` とする。
- `InfoType` が `発表` / `訂正` の電文では、上記の欠落はすべて `未対応構造` とする。**NULL 許容は取消の退避経路であって、通常電文の検証を緩めるものではない。**
- 取消・訂正電文の実構造は**実挙動未確認**である（§10）。

## 4. モジュール・型・内部 API

```text
apps/api/src/
├── polling/
│   ├── jmaVphwParser.ts        # 新規: VPHW50/51 の純粋 parser
│   ├── jmaVphwProcessor.ts     # 新規: 保存と adoption 更新
│   ├── jmaXmlPoller.ts         # VPHW dispatch を1分岐追加
│   └── index.ts                # export 追加
├── repositories/
│   ├── types.ts                # VPHW 電文種別・parser 入出力型を追加
│   │                           # BosaiBulletinInput / BosaiBulletin に hasSighting を追加
│   └── bosaiBulletinRepository.ts  # has_sighting の INSERT/UPDATE/SELECT/マッピング
└── (migrations/)
    └── 0016_add_bosai_bulletin_has_sighting.sql  # 新規（§3.6）

apps/api/tests/
├── jmaVphwParser.test.ts       # 新規
├── jmaVphwProcessor.test.ts    # 新規
└── jmaXmlPolling.test.ts       # VPHW dispatch ケースを追加
```

`VPHW50` と `VPHW51` は構造の差が `（目撃情報あり）` Information の有無と `Control/Title` だけであるため、**parser・processor は1組にまとめ、電文種別で分岐する**（ファイルを2組に分けない）。

```ts
// apps/api/src/repositories/types.ts に追加

export const VPHW50_TELEGRAM_TYPE = 'VPHW50' as const;
export const VPHW51_TELEGRAM_TYPE = 'VPHW51' as const;
export type VphwTelegramType = typeof VPHW50_TELEGRAM_TYPE | typeof VPHW51_TELEGRAM_TYPE;

/** Control/Title の期待値。電文種別と1対1（§2.3.1）。 */
export const VPHW_EXPECTED_CONTROL_TITLES: Readonly<Record<VphwTelegramType, string>> = {
  VPHW50: '竜巻注意情報',
  VPHW51: '竜巻注意情報（目撃情報付き）',
};

export const VPHW_EXPECTED_INFO_KIND = '竜巻注意情報' as const;

/** Headline/Information@type の既知集合。未知の type は未対応構造とする（§3.2 判定#10）。 */
export const VPHW_REQUIRED_INFORMATION_TYPES = [
  '竜巻注意情報（発表細分）',
  '竜巻注意情報（一次細分区域等）',
  '竜巻注意情報（市町村等をまとめた地域等）',
  '竜巻注意情報（市町村等）',
] as const;
export const VPHW_SIGHTING_INFORMATION_TYPE = '竜巻注意情報（目撃情報あり）' as const;

export interface ParsedVphw {
  readonly telegramType: VphwTelegramType;
  /** 合成キー `${telegramType}:${発表細分区域コード}`（§3.3）。 */
  readonly eventId: string;
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  /** Head/ValidDateTime。取消で欠ける場合のみ null（§3.8）。 */
  readonly validDateTime: UtcIso8601String | null;
  readonly title: string;
  /** 取消で Headline/Text が無い場合のみ null（§3.8）。 */
  readonly headlineText: string | null;
  /** 発表細分 Item/Kind/Name の原文。取消で発表細分が無い場合のみ null（§3.8）。 */
  readonly informationTag: string | null;
  /** VPHW51 のみ true/false、VPHW50 は常に null（§3.4）。 */
  readonly hasSighting: boolean | null;
  readonly isCancelled: boolean;
  readonly infoKindVersion: string | null;
  readonly areas: readonly BosaiBulletinAreaInput[];
}

export type VphwParseResult =
  | { readonly ok: true; readonly value: ParsedVphw }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };
```

```ts
// apps/api/src/polling/jmaVphwParser.ts

export function isVphwTelegramType(telegramType: string | null): telegramType is VphwTelegramType;

export function parseVphw(
  rawXml: string,
  reception: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  target?: BosaiBulletinTarget,
): VphwParseResult;
```

```ts
// apps/api/src/polling/jmaVphwProcessor.ts

export function processVphwReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target?: BosaiBulletinTarget,
): VphwParseResult;
```

- `parseVphw` は DB に触れない純粋関数とする。DB 上の既存行を参照する更新判定は `processVphwReception` の責務とする。取消電文の欠落要素は NULL で保存するため、**parser も processor も既存行の値を引き継がない**。
- `processVphwReception` は `findBosaiBulletin` による既存行照会・`saveBosaiBulletin`・`updateTelegramReceptionAdoption` を**1トランザクション**で実行する（Issue #17 の `processVpbs50Reception` と同一構造）。
- `target` の既定値は Issue #17 の `DEFAULT_BOSAI_BULLETIN_TARGET` を再利用する（`jmaVpbs50Parser.ts` から import するか、`types.ts` へ移して両者から参照する。**定義の重複コピーは作らない**）。
- adoption の値は成功時 `'気象防災速報として解析済み'`（Issue #17 と同一文言。竜巻も「気象防災速報」として扱う §5.6【確定】に沿う）、旧版スキップ時 `'重複または旧版'`、失敗時は `disposition` をそのまま入れ、`adoptionReason` に判定理由（棄却された区域コード等）を日本語で残す。
- `jmaXmlPoller.ts` に `bosaiBulletinTarget` オプションが既にあるため、VPHW 分岐も同じオプションを使う（新しいオプションを増やさない）。

## 5. 実装手順

0. `apps/api/migrations/0016_add_bosai_bulletin_has_sighting.sql` を追加する（§3.6。`0008`・`0015` は書き換えない）。あわせて `types.ts` の `BosaiBulletinInput` / `BosaiBulletin` に `hasSighting` を追加し、`bosaiBulletinRepository.ts` の行型・INSERT/UPDATE/SELECT・マッピングを更新する。`jmaVpbs50Processor.ts` と既存テストの `BosaiBulletinInput` 組み立て箇所に `hasSighting: null` を追加する。既存の #6 / #17 のテストが引き続き通ることを確認する。
1. `types.ts` に §4 の VPHW 用定数・型を追加する。
2. テスト fixture を用意する（§5.1）。実装前に各失敗テストが red になることを確認する。
3. `jmaVphwParser.ts` を実装する。namespace・直接の親子関係・要素数の検証、`Control/Title` と電文種別の対応検証、Headline のみからの区域抽出と重複除去、目撃フラグ判定、合成キー生成、対象判定を行う。
4. `jmaVphwProcessor.ts` を実装する。`Control/DateTime` 比較による更新判定、取消時の NULL 保存、トランザクション、`control_status` 分離をテストする。
5. `jmaXmlPoller.ts` の dispatch 連鎖の末尾（VPBS50 分岐の後）に VPHW 分岐を追加し、`index.ts` に export を追加する。
6. `jmaXmlPolling.test.ts` に混在フィードのケースを追加し、VPHW50/51 が C8 のみに dispatch されること、VPBS50 processor に流れないこと、他テーブルを変更しないことを検証する。
7. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行する。

### 5.1 テスト fixture の方針

**Issue #17 と異なり、会場対象の正例・負例はいずれも気象庁提供サンプルの原文をそのまま使える**（§2.3.3）。合成は訂正・取消・訓練・試験・構造異常に限る。

| 用途 | fixture | 合成の有無 |
| --- | --- | --- |
| 会場対象の正例（VPHW50） | `19_01_01_091210_VPHW50.xml`（東京都。`130010`・`130012`・`1310800`・`1311100` を含む） | **原文** |
| 目撃情報ありの正例（VPHW51） | `19_04_01_140425_VPHW51.xml`（東京都。`（目撃情報あり）` Information あり） | **原文** |
| 目撃情報なしの VPHW51 | `19_05_01_140425_VPHW51.xml`（東京都。`（目撃情報あり）` なし） | **原文** |
| 対象地域外の負例 | `19_08_01_150916_VPHW50.xml`（埼玉県。会場コードを含まない） | **原文** |
| 新形式 Head/Title の受理 | `19_10_03_250630_VPHW50.xml`（`埼玉県気象防災速報（竜巻目撃）`。目撃事象だが VPHW50 のためフラグ NULL） | **原文** |
| 目撃事象の VPHW50/51 対 | `19_10_01_150916_VPHW50.xml` と `19_10_02_150916_VPHW51.xml` | **原文** |
| 訂正・取消・訓練・試験 | 上記原文の `Head/InfoType` / `Control/Status` を差し替えた合成データ | 合成（fixture・テスト名の双方に「公式サンプル `<名>` を加工した合成データ」と明記する） |
| 構造異常（namespace 不正、`InfoKind` 不一致、`Control/Title` 不一致、発表細分 Item 複数、`Area` 欠落、未知 `Information@type`） | 原文を加工した合成データ | 合成（同上） |

- 原文をリポジトリ内に fixture として取り込む際は、出典（サンプル集の相対パス）を fixture のコメントまたは README に記録する。**加工の有無を必ず区別できるようにし、合成 fixture を実電文として扱わない。**
- Issue #17 のようなネットワーク取得は不要である（原文サンプルで正例・負例の双方が成立するため）。

## 6. 受け入れ条件

検収担当は各項目を1つずつ実行する。

### スキーマ・リポジトリ

- [ ] `apps/api/migrations/0016_add_bosai_bulletin_has_sighting.sql` が追加されており、`git diff main -- apps/api/migrations/0008_create_bosai_bulletin.sql apps/api/migrations/0015_relax_bosai_bulletin_nullable.sql` が**空**であること（既存マイグレーションが1バイトも変わっていないこと）。
- [ ] `0015` 適用済みで親1行・子1行を持つ DB に `0016` を適用すると、行数が保存され（親1・子1）、既存行の `has_sighting` が `NULL` になり、`PRAGMA foreign_key_check` が無出力であること。
- [ ] `has_sighting` に `1` / `0` / `NULL` を保存でき、`findBosaiBulletin` で `hasSighting === true` / `false` / `null` として読み戻せること。`has_sighting = 5` を直接 SQL で INSERT すると `CHECK constraint failed: has_sighting IN (0,1)` で拒否されること。
- [ ] マイグレーション適用後に `npm run test -w apps/api` の既存 #6 / #17 テストが通ること。
- [ ] 既存の VPBS50 経路で保存した行の `has_sighting` が `NULL` であること（`jmaVpbs50Processor` が `hasSighting: null` を渡していること）。

### parser（正例・原文サンプル）

- [ ] `19_01_01_091210_VPHW50.xml` を `parseVphw`（既定 target）に渡すと `ok: true` となり、
      `telegramType='VPHW50'`、`eventId='VPHW50:130010'`、`title='東京都竜巻注意情報'`、
      `informationTag='竜巻注意情報'`、`hasSighting === null`、`isCancelled === false`、
      `infoKindVersion='1.0_0'`、`validDateTime` が `2009-08-10T08:40:00+09:00` を UTC 正規化した値であること。
- [ ] 同 fixture の `areas` に、`130010`/`東京地方`（`codeType='気象情報／府県予報区・細分区域等'`）、`130012`/`２３区東部`、`1310800`/`江東区`（`codeType='気象・地震・火山情報／市町村等'`）、`1311100`/`大田区` がいずれも含まれること。`sequence` が0起点の連番で、`(areaCode, codeType)` の重複が無いこと（`130010` は発表細分と一次細分の両方に現れるが**1件だけ**保存されること）。
- [ ] **同 fixture の `areas` に `130020`（伊豆諸島北部）・`130030`（伊豆諸島南部）が含まれないこと。** これらは `Body/Warning` に `Kind/Status='なし'` として現れる区域であり、Body を走査していないことの証明になる。
- [ ] `19_04_01_140425_VPHW51.xml` が `ok: true`、`telegramType='VPHW51'`、`eventId='VPHW51:130010'`、`hasSighting === true`、`infoKindVersion='1.1_0'` になること。
- [ ] `19_05_01_140425_VPHW51.xml`（VPHW51 だが `（目撃情報あり）` Information が無い）が `ok: true`、`hasSighting === false` になること。
- [ ] `19_10_03_250630_VPHW50.xml`（Head/Title が `埼玉県気象防災速報（竜巻目撃）`、本文が `【目撃情報あり】` で始まる VPHW50）が `ok: true` で受理され、`title` が原文どおりで、**`hasSighting === null`** であること（Head/Title・本文の文字列から `true` を導いていないこと）。
- [ ] `19_08_03_250630_VPHW50.xml`（Head/Title が `埼玉県気象防災速報（竜巻注意）` の新形式）が構造として受理されること（既定 target では `対象地域外` になるため、target を埼玉のコードにして確認する）。

### parser（対象判定・負例）

- [ ] 既定 target（`1310800`,`130012`,`130010`,`1311100`,`130011`）で `19_08_01_150916_VPHW50.xml`（埼玉県）が `ok:false` / `disposition='対象地域外'` を返し、`bosai_bulletin` に行が1件も作られないこと。同 fixture を processor に通したあと `listBosaiBulletins(conn, { controlStatus:'normal', includedAreaCodes: east の3コード })` が空配列を返すこと。
- [ ] `19_01_01_091210_VPHW50.xml` を processor に通したあと、east 絞り込み・trc 絞り込みの両方で1件返ること（東京都の電文は両会場にかかる）。
- [ ] reception の電文種別が `VPBS50` の入力を `parseVphw` に渡すと `disposition='対象外'` になること。

### parser（構造検証）

- [ ] 次の各合成 fixture が `未対応構造` または `対象外` になり、`bosai_bulletin` を変更しないこと。それぞれ期待する disposition を確認する。
      (a) ルート namespace 不正 → `未対応構造`
      (b) `Head/InfoKind` が `気象解説情報` → `対象外`
      (c) VPHW50 の `Control/Title` を `竜巻注意情報（目撃情報付き）` に差し替え → `未対応構造`（電文種別との対応不一致）
      (d) `Head/ValidDateTime` を削除（`InfoType='発表'`）→ `未対応構造`
      (e) `Headline/Text` を空に（`InfoType='発表'`）→ `未対応構造`
      (f) 発表細分 Information を削除（`InfoType='発表'`）→ `未対応構造`
      (g) 発表細分 Information の `Item` を2個に → `未対応構造`
      (h) 発表細分 Information の `Areas/Area` を2個に → `未対応構造`
      (i) いずれかの `Area/Code` を削除 → `未対応構造`
      (j) いずれかの `Areas@codeType` を削除 → `未対応構造`
      (k) `Information@type` を既知5種以外の値（例 `竜巻注意情報（新区分）`）にした Information を追加 → `未対応構造`
      (l) `竜巻注意情報（市町村等）` Information を削除 → `未対応構造`
      (m) reception の `controlDateTime` / `reportDateTime` / `controlStatus` と電文の値が不一致 → `未対応構造`
- [ ] `Head/InfoKindVersion` を `1.9_0` に差し替えた fixture が**受理され**、`source_version='1.9_0'` で保存されること（版を受理条件にしていないこと）。
- [ ] `Head/EventID` に値（例 `JPTE202309081000_1`）を入れた fixture でも、`event_id` が **`VPHW50:130010`**（合成キー）で保存されること（原文 EventID を保存キーにしていないこと）。

### processor（保存・更新）

- [ ] `19_01_01_091210_VPHW50.xml` を processor に通すと `bosai_bulletin` に1行作られ、`valid_at` が `Head/ValidDateTime` の UTC 正規化値、**`valid_to` が NULL**、`valid_from` が NULL、`issued_at` と `report_datetime` が `Head/ReportDateTime`、`fetched_at` が reception の `receivedAt`、`availability='available'`、`source` が reception の `documentUrl`（`_VPHW50_` を含む）であること。
- [ ] 同一発表細分区域・同一電文種別で `Control/DateTime` と `Head/ReportDateTime`・`Head/Serial` を新しくした続報を再投入すると既存行が更新され（`headline_text`・`control_datetime`・`report_datetime`・`valid_at`・`has_sighting`・区域明細が新しい値になる）、**行数が増えない**こと（確定事項#8。`event_id` が `ReportDateTime` を含まないため続報が別行にならないこと）。
- [ ] `Control/DateTime` が既存と同じ、および古い電文を投入した場合、既存行が一切変更されず、reception の `adoption_result` が `重複または旧版` になること。
- [ ] `19_10_01_150916_VPHW50.xml`（VPHW50）と `19_10_02_150916_VPHW51.xml`（VPHW51、同一事象・同一 `Control/DateTime`）を順に投入すると、**`event_id='VPHW50:110000'` と `event_id='VPHW51:110000'` の2行が並存**し、互いを上書きしないこと。前者の `has_sighting` が `NULL`、後者が `1` であること（target を埼玉のコードにして実行する）。
- [ ] **VPHW 経路で保存したすべての行の `valid_to` が NULL であること**（確定事項#6）。`SELECT count(*) FROM bosai_bulletin WHERE valid_to IS NOT NULL` が VPHW 投入後も `0` であること。`jmaVphwProcessor.ts` および `jmaVphwParser.ts` に `validTo` へ `Head/ValidDateTime` を渡すコードが無いこと（`grep -n "validTo" apps/api/src/polling/jmaVphw*.ts` の結果が `validTo: null` 以外を含まないこと）。
- [ ] `InfoType='取消'` の合成 fixture で、同一 `event_id` の行が `is_cancelled=1` に更新され、**行が削除されない**こと。
- [ ] `InfoType='取消'` かつ `Headline/Text` が空・`Head/ValidDateTime` が無い fixture が `ok:true` で受理され、`headline_text` と `valid_at` が **NULL** で保存されること。既存行に値があっても**引き継がれず NULL になる**こと、`Head/Title` が `headline_text` に代入されていないこと。
- [ ] 同じ欠落を持つ fixture でも `InfoType='発表'` / `'訂正'` の場合は `未対応構造` となり、`bosai_bulletin` を変更しないこと（NULL 許容が取消だけの退避経路であること）。
- [ ] `InfoType='取消'` で発表細分 Information が無い fixture が `ok:true` で受理され、`information_tag` が NULL、`event_id` が `VPHW50:cancel:<controlDateTime>` の形式になり、**既存の `VPHW50:130010` 行が変更されない**こと。区域が0件の取消 fixture は `未対応構造`、区域が対象コードに交差しない取消 fixture は `対象地域外` となり保存されないこと。
- [ ] `Control/Status` が `訓練` の fixture を、同一 `event_id` の `通常` 行が存在する状態で投入すると、`control_status='training'` の別行が作られ、`normal` の行の内容（`headline_text`・`has_sighting`・`control_datetime`・区域明細）が一切変わらないこと。`試験` も同様であること。
- [ ] `listBosaiBulletins(conn, { controlStatus:'training', includedAreaCodes: east })` が訓練行のみを返し、`controlStatus:'normal'` の結果に訓練行が混入しないこと。
- [ ] processor 内で `saveBosaiBulletin` を失敗させた場合、reception の adoption も更新されないこと（トランザクションの原子性）。
- [ ] reception の `rawBody` が null の場合、`未対応構造` として adoption だけが記録され、`bosai_bulletin` が変更されないこと。

### 統合（poller）

- [ ] 混在フィード（VPHW50・VPHW51・VPBS50・VPFD51 を含む）の統合テストで、VPHW50/51 が C8 processor にのみ dispatch され、**VPBS50 processor に流れない**こと。`warning_current_*`・`warning_timeseries_*`・`early_warning_*`・`area_timeseries_*`・通知関連テーブルが変更されないこと。
- [ ] 同じ document URL が複数フィードに現れても1回だけ処理されること。

### 品質ゲート

- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` がすべて通ること。
- [ ] 新規テストについて、実装を意図的に壊すと当該テストが落ちること（red を確認済みであること）。特に「Body を走査していないこと」を検証するテストは、parser に Body 走査を足すと落ちることを確認する。

## 7. 対象外（本 Issue で実装しないこと）

- VPBS50 側の処理（C7・Issue #17 で完了済み）。本 Issue で変更するのは `hasSighting: null` の1行追加のみ
- 速報パネルの表示（Epic G2）、有効期限到来による表示終了判定
- 竜巻ナウキャスト（basic-design.md §3.1 で初期版に含めない）
- 公式速報地図 JSON（`tornado.json` / `information.json`）による表示対象・表示期限の補完
- REST API、通知判定、availability の `stale`／`unavailable` 遷移
- 目撃区域と注意情報区域の区別を区域明細に持たせること
- 発表官署・`Head/Serial`・`Body/Warning` の構造化保存
- VPHW50 と VPHW51 が同一事象で二重に届いた場合の表示上の重複排除（確定事項#7 により将来課題・§8）
- `valid_to` 列の利用（確定事項#6 により本 Issue では触らない）
- 同一発表細分区域への続報履歴の保持（確定事項#8 により上書き。履歴は `telegram_reception`）

## 8. 後続 Issue への引き継ぎ

- **`bosai_bulletin.event_id` の書式が電文種別で異なる。** VPBS50 は XML の完全な EventID（`JPTE202309081000_202309081019` 等）、VPHW50/51 は合成キー `<電文種別>:<発表細分区域コード>`（`VPHW50:130010` 等）である。**`event_id` を「気象庁の EventID」として外部に見せてはならない。** API のレスポンスに含める場合は内部キーであることを明示するか、含めない。
- **`has_sighting` の3値の意味**: `1`=目撃情報あり（VPHW51 の構造化フラグ）、`0`=VPHW51 で目撃情報なし、`NULL`=判定不能（VPHW50）または該当なし（VPBS50）。**G2 は `1` のときだけ目撃を強調し、`0` と `NULL` を区別して表示しない。** VPHW50 のみが配信された目撃事象では強調が出ない（確定事項#5 で許容済み）。
- **有効期限は `valid_at` で表す（確定事項#6）。** VPHW 行の `valid_at` は電文由来の明示的有効期限（`Head/ValidDateTime`）である。一方 VPBS50 行の `valid_at` は `Head/TargetDateTime`（＝発表時刻相当）であり、**同一列に意味の異なる値が入る。** G2 が表示終了を判定するときは、`source`（URL に `_VPHW50_`/`_VPHW51_` を含むか）または `information_tag` で電文系統を見分けたうえで、VPHW は `valid_at` を有効期限として、VPBS50 は発表時刻からの3時間ルール（basic-design.md §5.5）として扱う必要がある。**`valid_to` は全行 NULL であり、判定に使えない。** この列を有効期限に使うかどうかは将来の別判断とする。
- **`information_tag` に竜巻の語彙が入る。** `竜巻注意情報`（VPHW）と `線状降水帯発生`/`線状降水帯直前`/`記録雨`（VPBS50）が同一列に混在する。G2 の表示名変換表はこの5値すべてを扱う必要がある。取消電文では NULL になり得る。
- **同一事象が VPHW50 と VPHW51 の2行になり得る（確定事項#7 により本 Issue では並存を許容）。** 実運用で両方が配信されるかは未確認（§10）。両方来る場合、パネルにほぼ同内容の2枚が並ぶ。**表示上の重複排除は G2 の課題として明示的に先送りされている。** 実装するなら `(発表細分区域コード, control_datetime)` が同じ行のうち VPHW51 を優先する等の規則になる（`event_id` を `:` で分割すれば発表細分区域コードが得られる）。
- **目撃区域の粒度**: `（目撃情報あり）` Information の区域も `bosai_bulletin_area` に混ざって保存されるため、「どの区域で目撃されたか」は DB から復元できない。必要になれば区域明細に区分列を追加する。
- **履歴**: 同一発表細分区域への連続発表は1行に上書きされる（確定事項#8）。`bosai_bulletin` は常に「最新の1件」だけを持つ。発表の系列を辿るには `telegram_reception`（`rawBody` を含む受信履歴）を使う（Epic F）。**パネルに直近の複数件を並べる要件が後から出た場合、保存キーの変更（`ReportDateTime` の追加）ではなく `telegram_reception` からの復元で対応する方針である。**
- **availability 担当**: VPHW も複数行が並存するため、行単位で `stale` にする意味づけは別途定義が必要である（Issue #17 §8 と同じ）。

## 9. 追加ヒアリングで確定した論点（記録）

設計中に現れた論点は、統括担当によるユーザーへの追加ヒアリング、または設計者判断（根拠明記）によって**すべて確定した。未決の要ヒアリング事項は無い。**

| # | 論点 | 確定内容 | 確定者 | 反映箇所 |
| --- | --- | --- | --- | --- |
| 1 | VPHW50 の目撃情報をどう扱うか（VPHW50 には構造化フラグが無く、本文の `【目撃情報あり】` 接頭辞しか手がかりが無い） | **常に `has_sighting = NULL`（判定不能）に割り切る。** 文字列部分一致では判定しない。VPHW50 のみが配信された目撃事象で目撃強調が出ないことを許容する | ユーザー（追加ヒアリング） | 確定事項#5、§2.3.2、§3.2、§3.4、§6 |
| 2 | `Head/ValidDateTime` を `valid_to` にも入れるか | **`valid_to` は使わない。`valid_at` にのみ格納し、`valid_to` は NULL のまま**（将来必要になった時点で別途判断） | ユーザー（追加ヒアリング） | 確定事項#6、§3.7、§3.8、§6、§8 |
| 3 | VPHW50 と VPHW51 の二重配信を2行並存させるか | **2行並存を許容する。** `event_id` に電文種別を含める設計のまま。表示上の重複排除は本 Issue のスコープ外・将来課題 | ユーザー（追加ヒアリング） | 確定事項#7、§3.3、§7、§8 |
| 4 | 同一発表細分区域への続報を上書きしてよいか | **上書きする。** `event_id` に `ReportDateTime` を含めない。続報履歴は `bosai_bulletin` に残さず `telegram_reception` で参照する | ユーザー（追加ヒアリング） | 確定事項#8、§3.3、§6、§8 |
| 5 | 未知の `Information@type` を棄却するか無視するか | **電文全体を `未対応構造` として棄却する。** 無視方式では会場コードを含む新区分が追加された際に「発表されているのに `対象地域外` で静かに落ちる」故障が起き、検知できない。棄却なら `telegram_reception` に記録され監視画面から検知できる。加えて Issue #17 §3.2 の既知集合外＝`未対応構造` の規律と、CLAUDE.md「実データ・公式資料と照合できたものだけを確定事実とする」に一致する | **設計者判断**（統括担当の追加確認は不要と評価。根拠は §3.2 判定#10 の注記に明記） | 確定事項#9、§3.2、§10 |

## 10. 残留リスク（製造担当が迷いそうな点）

- **`Body/Warning` を区域抽出に使ってはならない。** これは本設計で最も静かに壊れる箇所である。Body は `Kind/Status='なし'` の非発表区域も列挙するため、Issue #17 の VPBS50 実装をコピーして Body 走査を足すと、**竜巻注意情報が発表されていない会場区域まで一致して誤って採用される**（エラーも警告も出ない）。§6 の「`130020`・`130030` が `areas` に含まれないこと」がこの回帰を検出する唯一のテストである。
- **`Item/Kind/Condition='発表'` の条件を省略しない。** 全サンプルの Headline は `発表` のみだが、将来「解除」等が Headline に現れたときに非発表区域を採用しないための防御である。条件を省いても現在のサンプルではテストが通ってしまう。
- **EventID が空である前提を実装が忘れないこと。** `saveBosaiBulletin` は `eventId` に空文字列を渡すと例外を投げる。合成キーの生成に失敗して空文字列や `undefined` が混じると保存時例外になり、トランザクション全体（adoption 更新も含む）が巻き戻る。
- **訂正・取消・訓練・試験の VPHW 実電文は1件も確認できていない。** これらのテストはすべて公式サンプルを加工した合成 fixture であり、実電文の構造が異なる可能性がある。特に「取消電文で発表細分 Information が欠ける」ケースは推測であり、`event_id = <種別>:cancel:<controlDateTime>` という代替キーは**実挙動未確認**である。テストのコメントに実挙動未確認である旨を残すこと。
- **`Head/EventID` が将来値を持つ改訂があり得る。** 本設計は原文 EventID を保存キーに使わないため、改訂が起きてもキーは安定するが、「気象庁の EventID が DB に無い」状態が続く。原文は `telegram_reception.event_id` にある。
- **`Control/Title` と電文種別の1対1対応は15サンプルでのみ確認した確定事実である。** 標題が変更された新形式（`19_08_03` / `19_10_03` 等）でも `Control/Title` は旧来の `竜巻注意情報` のままであり、変わったのは `Head/Title` だけである。**`Control/Title` に「気象防災速報」が入ることを期待した実装をしないこと。**
- **発表細分 Information の `Areas/Area` が1件であることを受理条件にしている。** 全15サンプルで成立するが、複数区域を同時に発表する形式が存在すれば全件が `未対応構造` になる。安全側に倒した判断であり、`未対応構造` として reception に記録されるため監視画面から検知できる。
- **`valid_to` に `Head/ValidDateTime` を入れたくなる誘惑に乗らないこと（確定事項#6）。** 「電文に明示された有効期限があるのに有効期限列が NULL」という見た目の不整合が残るが、**これは意図された確定仕様である。** `validTo: null` を渡すこと。§6 に `valid_to IS NOT NULL` の件数が0であることを確認する項目がある。
- **VPHW50 の目撃事象でフラグが立たないのは仕様である（確定事項#5）。** `19_10_01` / `19_10_03` は本文が `【目撃情報あり】` で始まるのに `has_sighting = NULL` になる。テストが「直感に反する」ように見えるが、**本文や Head/Title を見て `1` にする「改善」を入れてはならない。** §6 の `19_10_03` の受け入れ条件がこの回帰を検出する。
- **`19_02_01`（京都府 `260000`）・`19_03_01`（長崎県 `420000`）のように、発表細分コードが府県予報区コード（下4桁が `0000`）になる電文と、東京都の `130010`（一次細分区域コード）になる電文が混在する。** 合成キーはこの差を解釈せずそのまま使う。コードの桁パターンから区域の階層を推定する処理を書かないこと。
