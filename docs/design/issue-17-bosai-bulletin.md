# Issue #17「C7. VPBS50（気象防災速報）の取得・正規化」設計

作成日: 2026-09-10 / 改訂: 2026-09-10（追加ヒアリング結果を反映。§2.2.1 参照）

## 1. 目的

GitHub Issue #17 を実装するため、気象庁公開 XML の `VPBS50`（府県気象防災速報）から、**線状降水帯発生・線状降水帯直前予測・記録的短時間大雨**の速報を取得・正規化し、既存テーブル `bosai_bulletin` / `bosai_bulletin_area` に保存する。

C6（#16）と異なり、VPBS50 は「対象1組の最新スナップショット」ではなく、**EventID 単位で並存する複数件の速報**である。したがって単一行の置換ではなく、完全な EventID をキーとした個別行の upsert とし、他の速報を消さないことを設計の中心に置く。

本 Issue は XML の受理・正規化・保存までを対象とする。パネル表示（Epic G2）、REST API、通知判定、3時間固定表示の経過判定は対象外である。

## 2. 参照資料と確定済み前提

### 2.1 参照資料

- `docs/issues-draft.md` C7、GitHub Issue #17 本文
- `docs/basic-design.md` §5.5（有効期限が明確でない速報／3時間固定表示【確定】）、§5.6（速報パネルの内容【確定】。標題・対象区域・発表時刻・速報文全文を表示する）、§5.12（短時間大雪は対象外）、§6.1–§6.3
- `docs/data-acquisition-report.md` §3.6。InfoKind=`気象解説情報`、Version=`1.5_0`、InfoType=発表／訂正／取消、EventID 親番＋枝番、`Control/DateTime` による更新判別、実データ `20260905220832_0_VPBS50_130000.xml` が **伊豆諸島南部 `130030`** 対象の負例であること、区域は `Headline/Information[@type="情報タグ"]/Item/Areas` と Body の `Area` を codeType 付きで読むこと、地域不明はタイトルの「東京都」だけで採用しないこと
- 気象庁提供サンプル（`jmaxml_20260723_Samples`、取得方法レポート [L10] の速報サンプル群）。本設計のために次の10件すべてを実読した。
  - `82_01_01_260324_VPBS50.xml`（線状降水帯発生、Condition=`線状降水帯発生`、Areas 3件）
  - `82_03_01/02/03_260324_VPBS50.xml`（線状降水帯直前予測、Condition=`線状降水帯直前`、同一親番 `JPFK202307100159` に枝番 `202307100159`／`202307100209`／`202307100329` の3件）
  - `82_01_02_250630_VPBS50.xml`（記録的短時間大雨、Condition=`記録雨`、Body に `Area codeType="気象・地震・火山情報／市町村等"` の美幌町 `0154300` と `Station`）
  - `82_01_03_241031_VPBS50.xml`、`85(82)_02_02/03/05/06_250630_VPBS50.xml`（短時間大雪、Condition=`短時間大雪`。**本 Issue の対象外**）
- 既存資産: `apps/api/migrations/0008_create_bosai_bulletin.sql`、`apps/api/src/repositories/bosaiBulletinRepository.ts`、`apps/api/src/repositories/types.ts`（`BosaiBulletinInput` 他）、`packages/shared/src/venueForecastTargets.ts`、C1 のポーリング基盤 `apps/api/src/polling/jmaXmlPoller.ts`、#16 の `jmaVpfd51Parser.ts` / `jmaVpfd51Processor.ts`

### 2.2 統括から渡された確定事項

- **両会場対応**とする。`VENUE_FORECAST_TARGETS.east.bosaiBulletin.includedAreaCodes` = `['1310800', '130012', '130010']`（江東区・23区東部・東京地方）、`trc` = `['1311100', '130011', '130010']`（大田区・23区南部・東京地方）を判定に用いる。Issue 本文の「江東区」は east の例示であり、実装スコープを east に限定しない。
- 表示期間（発表後3時間固定）は表示層の話であり本 Issue の直接スコープ外。正規化データには発表時刻・経過時間判定に必要な情報を保持する。
- 将来パネルが必要とする項目（標題・対象区域・発表時刻・速報文全文・EventID・更新状態）を正規化時に保持する。

### 2.2.1 追加ヒアリング（2026-09-10）で確定した事項

初版の §9 に挙げた4点について統括担当がユーザーへ確認した結果は次の通り。本改訂はこれを前提とする。

| 論点 | 確定した判断 | 反映先 |
| --- | --- | --- |
| 取消電文で `Headline/Text`・情報タグが欠ける場合 | **スキーマを NULL 許容にする。** 欠けている要素は補完も引き継ぎもせず、そのまま NULL で保存する。「既存行から引き継ぐ」案は**不採用** | §3.6・§3.8・§4・§5・§6 |
| 対象外区域の速報 | **保存しない**（PoC 範囲。初版方針のまま変更なし） | §3.4（変更なし） |
| 負例 fixture `20260905220832_0_VPBS50_130000.xml` | **製造時にネットワーク取得を試みる。** 取得できなければ合成 fixture へフォールバックし、合成である旨をコード・テストに明記する | §5.1・§6・§8 |
| 発表官署（`EditorialOffice`／`PublishingOffice`） | **今回は保存しない**（初版方針のまま変更なし） | §3.7・§7（変更なし） |

### 2.3 サンプル実読で確定した事実

| 事項 | 実データで確認した値 |
| --- | --- |
| ルート namespace | `Report` = `http://xml.kishou.go.jp/jmaxml1/` |
| Head namespace | `http://xml.kishou.go.jp/jmaxml1/informationBasis1/` |
| Body namespace | `http://xml.kishou.go.jp/jmaxml1/body/meteorology1/` |
| `Control/Title` | `府県気象防災速報`（全10件で同一） |
| `Head/InfoKind` | `気象解説情報`（全10件） |
| `Head/InfoKindVersion` | `1.5_0`（全10件） |
| `Head/InfoType` | `発表`（全10件。訂正・取消のサンプルは**存在しない**） |
| `Control/Status` | `通常`（全10件。訓練・試験のサンプルは**存在しない**） |
| 情報タグ Condition | `線状降水帯発生` / `線状降水帯直前` / `記録雨` / `短時間大雪` の4値のみ |
| 区域 codeType | `気象情報／府県予報区・細分区域等`（Headline Areas と Body Area）、`気象・地震・火山情報／市町村等`（Body Area、記録的短時間大雨のみ） |
| EventID 形式 | `<親番>_<枝番>`。親番は `JPTE202309081000` / `JPFK202307100159` / `JPOD240001` / `JPNC240004` と**桁数・形式が一定でない**。枝番も12桁と14桁が混在する |

> **重要:** 会場の市町村コード（江東区 `1310800`・大田区 `1311100`）は、サンプル上 Headline の情報タグ `Areas` には現れず、記録的短時間大雨の **Body の `Area codeType="気象・地震・火山情報／市町村等"`** にのみ現れる形である。したがって区域抽出は Headline と Body の両方から行わなければ、直接対象の判定が成立しない。

## 3. 設計方針

### 3.1 C1・他 processor との境界

1. C1 がフィード取得・個別 XML の HTTP 取得・URL 重複抑止・`telegram_reception` への保存を担当する。C7 は reception の `rawBody` を入力とし、HTTP GET・受信履歴・フィード選択を再実装しない。
2. `jmaXmlPoller.ts` の既存 dispatch 連鎖（現況警報 → `VPWP50` → `VPFD61`/`VPFW60` → `VPFD51`）の末尾に `else if (reception.telegramType === VPBS50_TELEGRAM_TYPE)` を1分岐だけ追加する。既存分岐の条件・順序は変更しない。
3. C7 は `warning_current_*` / `warning_timeseries_*` / `early_warning_*` / `area_timeseries_*` / 通知関連テーブルへ読み書きしない。
4. `VPHW50`／`VPHW51`（竜巻）は `VPBS50_TELEGRAM_TYPE` に含めない。将来 C8 が別 processor を追加できるよう、dispatch 条件は電文種別の完全一致とする。

### 3.2 受理条件（XML 構造）

parser は `@xmldom/xmldom` を用い、#16 と同様に namespace URI・`localName`・**直接の親子関係**・必須要素数を検証する。文字列の部分一致、同名要素の子孫探索、最初の一致要素の暗黙採用を行わない。

```text
Report (jmaxml1)
  / Control
    / Title            = "府県気象防災速報"
    / DateTime         → controlDateTime（更新判別に使う）
    / Status           = 通常 | 訓練 | 試験 → ControlStatus
    / EditorialOffice, PublishingOffice   ※発表官署（後述）
  / Head (informationBasis1)
    / Title            → title（例: 千葉県気象防災速報（線状降水帯発生））
    / ReportDateTime   → reportDateTime（発表時刻。3時間経過判定の基準）
    / TargetDateTime
    / EventID          → eventId（完全形。保存キー）
    / InfoType         = 発表 | 訂正 | 取消
    / InfoKind         = "気象解説情報"
    / InfoKindVersion  → sourceVersion
    / Headline
      / Text                                   → headlineText（速報文全文）
      / Information[@type="情報タグ"]
        / Item / Kind / Name      = "情報タグ"
               / Kind / Condition            → informationTag
               / Areas[@codeType] / Area / (Name, Code)   → 区域（1）
  / Body (meteorology1)
    / MeteorologicalInfos[@type="観測実況"]
      / MeteorologicalInfo / Item / Area[@codeType] / (Name, Code)  → 区域（2）
```

受理判定は次の順で行い、それぞれ `disposition` を返す。

| 条件 | disposition |
| --- | --- |
| reception の電文種別が `VPBS50` でない | `対象外` |
| namespace／必須要素（`Control/Title`・`Control/DateTime`・`Control/Status`・`Head/Title`・`Head/ReportDateTime`・`Head/EventID`・`Head/InfoType`・`Head/InfoKind`・`Headline/Text`）の欠落・重複 | `未対応構造`（**例外**: `InfoType='取消'` の `Headline/Text` 欠落・空は `headlineText=null` として受理。§3.6） |
| `Head/InfoKind` が `気象解説情報` でない | `対象外` |
| `Control/Title` が `府県気象防災速報` でない | `対象外` |
| `Control/DateTime`・`Head/ReportDateTime`・`Control/Status` が reception の値と一致しない | `未対応構造` |
| 情報タグ `Item` が0件または2件以上／`Kind/Name` が `情報タグ` でない | `未対応構造`（**例外**: `InfoType='取消'` かつ `Item` 0件は `informationTag=null` として受理。§3.6） |
| `Condition` が `短時間大雪` | `対象外`（§5.12 で対象外確定） |
| `Condition` が対象3値のいずれでもない（未知タグ） | `対象外` |
| 抽出区域に両会場の `includedAreaCodes` のいずれも含まれない | `対象地域外` |

- `InfoKindVersion` は受理条件に**しない**。`1.5_0` を要求すると将来の版更新で全件が落ちるため、値は `sourceVersion` として記録するだけにする。バージョン確認は「記録して照合可能にする」ことで満たす。
- `Head/Title` の県名や「（線状降水帯発生）」の括弧内文字列で種別を判定しない。種別判定は情報タグ `Condition` の完全一致のみで行う（取得方法レポート §3.6「タイトルの『東京都』だけで採用しない」に従う）。
- Body の `MeteorologicalInfos` の構造・`Property/Type`（`気象現象の実況` / `雨の実況` / `雪の実況`）は受理条件にせず、**区域抽出のためだけ**に走査する。Body に自由文がなくても情報欠落と判断しない（§5.6【確定】）。

### 3.3 対象種別の判別

情報タグ `Condition` の完全一致で判別する。保存する `informationTag` は XML 原文をそのまま入れる。

| Condition（原文） | 意味 | 本 Issue |
| --- | --- | --- |
| `線状降水帯発生` | 線状降水帯発生 | 対象 |
| `線状降水帯直前` | 線状降水帯直前予測 | 対象 |
| `記録雨` | 記録的短時間大雨 | 対象 |
| `短時間大雪` | 短時間大雪 | **対象外**（`対象外` として reception に記録） |

`線状降水帯直前` という原文タグから「直前予測」という表示名を導く変換表は本 Issue では持たない。表示名は G2 の責務とし、DB には原文タグだけを保存する。

### 3.4 区域の抽出と対象判定

**抽出（保存する区域）**

1. Headline の情報タグ `Areas/Area` を出現順に読む。`Areas@codeType` を各行の `codeType` とする。
2. Body の `MeteorologicalInfos/MeteorologicalInfo/Item/Area` を出現順に読む。`Area@codeType` を `codeType` とする。
3. 1→2 の順に連結し、`(areaCode, codeType)` の組で重複を除去する（テーブルの `UNIQUE (bulletin_id, area_code, code_type)` に合わせる）。`sequence` は重複除去後の 0 起点連番とする。同じ `areaCode` でも `codeType` が異なれば別行として保存する（区域体系が違うため統合しない）。
4. Body の `Station`（アメダス地点番号・他機関観測地点番号）は区域ではないため保存しない。地点名は速報文（`Headline/Text`）に含まれる。
5. `Area` に `Name` または `Code` が欠ける、`codeType` 属性が無い場合は `未対応構造` とする。空文字を補わない。
6. `Area/Status`（例: 美幌町の `付近`）は現行スキーマに列がなく、§5.6 の必須表示項目にも含まれないため保存しない（→ §8 引き継ぎ）。

**対象判定（採用するか）**

- 判定集合は `VENUE_FORECAST_TARGETS.east.bosaiBulletin.includedAreaCodes` と `trc` の同項目の**和集合**（`1310800`, `130012`, `130011`, `130010`, `1311100`）とする。ハードコードせず `packages/shared` の定義から導出する。
- 抽出済み区域の `areaCode` がこの和集合と1件でも交差すれば採用し、保存する。交差しなければ `対象地域外` として reception に記録し、`bosai_bulletin` を一切変更しない。実データ `20260905220832_0_VPBS50_130000.xml`（伊豆諸島南部 `130030`）はこの経路で棄却される。
- **直接対象と広域情報の区別は保存時に列として持たない。** 市町村コード（`1310800`/`1311100`）に一致したものが直接対象、府県予報区・細分区域コード（`130010`/`130011`/`130012`）に一致したものが「会場を含む広域情報」であるという分類は、保存済みの `areas[].areaCode` と `codeType`、および会場定義から後段（API/G2）で一意に導出できる。会場ごとに答えが変わる分類を電文側の行に焼き付けない。
- `listBosaiBulletins(connection, { controlStatus, includedAreaCodes })` は既存実装で `bosai_bulletin_area.area_code IN (...)` の EXISTS 判定を行うため、会場別の一覧取得はこの既存 API でそのまま満たせる。リポジトリの変更は不要である。

### 3.5 EventID と更新判定

- **保存キーは完全な EventID（親番＋枝番、XML 原文の文字列そのもの）**とし、既存の `UNIQUE (event_id, control_status)` をそのまま用いる。
- **親番の切り出しは行わない。** サンプルの親番は `JPTE202309081000`・`JPOD240001` と桁数も構成も異なり、区切り文字 `_` が枝番との唯一の区切りであるという保証を実データで確認できていない。親番による関連付けは §5.6 の表示要件に含まれないため本 Issue では実装せず、`event_id` に完全形を入れることで「親番のみでの上書き」が構造的に起こり得ない状態にする。同一親番の3件（`JPFK202307100159_202307100159`／`_202307100209`／`_202307100329`）は独立3行として保存される。
- **更新判定は `Control/DateTime` で行う。** 同一 `(eventId, controlStatus)` の行が既に存在する場合、
  - 新電文の `Control/DateTime` が既存行の `control_datetime` より**新しい**とき: upsert する。
  - **同じか古い**とき: 保存せず、reception の adoption を `重複または旧版` として記録し、既存行を変更しない。
  これにより「訂正で `ReportDateTime` が変わらない」場合でも更新でき、フィードの再配信・遅延到着による巻き戻しを防ぐ。`ReportDateTime` や `Serial` は更新判定に使わない（`Serial` は電文内の通番であり、同一 EventID 内の単調増加を実データで確認できていない）。
- `Head/Serial` は現行スキーマに列がなく、§5.6 の表示要件にも含まれないため保存しない。

### 3.6 InfoType（発表／訂正／取消）の扱い

- `info_type` に原文（`発表`/`訂正`/`取消`）をそのまま保存する。値集合を enum で狭めない（実データで確認できたのは `発表` のみのため）。
- `is_cancelled` は `infoType === '取消'` のときだけ `true` とする。取消電文も**同一 EventID の行を上書き**し、行の削除は行わない（履歴として残す。§8.1 の保持方針）。
- `訂正` は独立した新規速報ではなく同一 EventID の更新である。受信時刻だけで表示期間を延長しない（§5.5）ため、`report_datetime` は電文の `Head/ReportDateTime` をそのまま保存し、`fetched_at` と混同しない。
- **取消電文の本文・情報タグ（ヒアリングで確定: スキーマを NULL 許容にする）**: 取消の実電文サンプルが存在せず、`Headline/Text` と情報タグ `Item` が存在するかを確認できていない。現行スキーマは `headline_text` / `information_tag` を NOT NULL かつ非空で検証するため、これを NULL 許容へ緩める（§3.8 の新規マイグレーション）。規則は次の通り。
  - **`InfoType='取消'` の電文に限り**、`Headline/Text` の欠落・空、情報タグ `Item` の0件を `未対応構造` としない。欠けている要素は `headline_text` / `information_tag` を **NULL のまま保存**する。
  - **既存行からの引き継ぎ・`Head/Title` による代用・文言の合成は一切行わない。** 「取消時点の電文に何が書かれていたか」を DB がそのまま表すことを優先し、パネル側が NULL を「取消のため本文なし」として扱えるようにする。
  - 取消電文に情報タグがある場合は通常どおり `Condition` を保存する。値が対象3値以外（未知タグ・`短時間大雪`）であれば従来どおり `対象外` として棄却する。
  - **情報タグが NULL の取消電文でも、区域による対象判定は従来どおり行う。** 区域が両会場の和集合に交差しなければ `対象地域外` として保存しない。区域まで欠ける取消電文は判定不能であるため `未対応構造` とする（区域は保存キーではなく採否の根拠であり、無条件に採用してはならない）。
  - `InfoType` が `発表` / `訂正` の電文では、従来どおり `Headline/Text` の欠落・空と情報タグ0件を `未対応構造` とする。NULL 許容は取消の退避経路であって、通常電文の検証を緩めるものではない。
  - 取消電文の実構造は**実挙動未確認**である（§10 残留リスク）。

### 3.7 メタ情報（`SnapshotMetadataInput`）

| 項目 | 値 |
| --- | --- |
| `source` | reception の `documentUrl` |
| `issuedAt` | `Head/ReportDateTime` |
| `validAt` | `Head/TargetDateTime`（速報の対象時刻。無ければ null） |
| `validFrom` | null |
| `validTo` | **null**（VPBS50 に専用の有効期限は確認できていない。§5.5 の3時間は表示上の整理期間であり、`valid_to` に3時間後を書き込むと「気象上の有効期限」と誤読される。3時間判定は `report_datetime` から表示層が計算する） |
| `fetchedAt` | reception の `receivedAt` |
| `lastSuccessAt` | processor の処理時刻 |
| `availability` | `'available'` |
| `sourceVersion` | `Head/InfoKindVersion` |

- 取得失敗・対象地域外・構造不正を `stale`／`unavailable` へ変換するのは本 Issue の範囲外である。既存行は変更しない。
- `Control/EditorialOffice`・`PublishingOffice`（§5.6 の「発表官署は補助表示」）は現行スキーマに列が無い。本 Issue ではスキーマを変更せず保存しない。→ §9 要ヒアリング事項。
- 訓練・試験は `control_status` により別行となる。訓練電文が `normal` の行を上書きしてはならない。`isTraining` に相当する情報は `control_status='training'` として伝播し、本番相当の速報と同一視しない。

### 3.8 保存先の判断

**新規テーブルは作らない。** Issue #6 で作成済みの `0008_create_bosai_bulletin.sql` と `bosaiBulletinRepository.ts` が、本 Issue の必要項目（`event_id`・`control_status`・`info_type`・`report_datetime`・`control_datetime`・`title`・`headline_text`・`information_tag`・`is_cancelled`・メタ情報・区域明細の `area_code`/`area_name`/`code_type`/`sequence`）をすべて備えており、`saveBosaiBulletin` は `(event_id, control_status)` の upsert ＋ 区域明細の全置換をトランザクション内で行う。`listBosaiBulletins` の `includedAreaCodes` 絞り込みも実装済みである。

**ただし §3.6 の確定事項（取消電文の NULL 許容）のため、列制約を緩める新規マイグレーション1本だけを追加する。** `0008_create_bosai_bulletin.sql` は既にコミット済みであり、マイグレーションランナー（`apps/api/src/database/migrations.ts`）は適用済みマイグレーションの**チェックサムを検証する**ため、`0008` を書き換えてはならない。新規に `0015_relax_bosai_bulletin_nullable.sql` を追加する。

**マイグレーションの中身（SQLite のテーブル再構築）**

`headline_text` / `information_tag` の NOT NULL を外すには `ALTER TABLE ... ALTER COLUMN` が使えないため、`0014_extend_warning_timeseries_for_vpwp50.sql` と同じ再構築パターンを採る。加えて、`bosai_bulletin` には子テーブル `bosai_bulletin_area`（`ON DELETE CASCADE`）があり、接続は `PRAGMA foreign_keys = ON`（`apps/api/src/database/connection.ts`）で、マイグレーションは**トランザクション内で実行される**（トランザクション内では `PRAGMA foreign_keys` の切り替えが無効）。したがって親テーブルを先に DROP すると子行が CASCADE で消える。**子テーブルも同時に再構築し、DROP は子 → 親の順**とする。

```sql
-- 0015_relax_bosai_bulletin_nullable.sql
-- 1) headline_text / information_tag を NULL 許容にした新テーブル（他列は 0008 と同一）
CREATE TABLE bosai_bulletin_new ( ... headline_text TEXT, information_tag TEXT, ... );
INSERT INTO bosai_bulletin_new SELECT <0008 の全列を同順> FROM bosai_bulletin;
-- 2) 子テーブルも作り直し（参照先は一時名 bosai_bulletin_new）
CREATE TABLE bosai_bulletin_area_new ( ... bulletin_id ... REFERENCES bosai_bulletin_new(id) ON DELETE CASCADE, ... );
INSERT INTO bosai_bulletin_area_new SELECT <0008 の全列を同順> FROM bosai_bulletin_area;
-- 3) 子 → 親の順に DROP（逆順にすると CASCADE で子行が消える）
DROP TABLE bosai_bulletin_area;
DROP TABLE bosai_bulletin;
-- 4) RENAME。親の RENAME により子の FK 参照名も自動で bosai_bulletin に書き換わる
ALTER TABLE bosai_bulletin_new RENAME TO bosai_bulletin;
ALTER TABLE bosai_bulletin_area_new RENAME TO bosai_bulletin_area;
```

この手順は本設計の作成時に SQLite で**実測検証済み**である。親1行・子1行を投入した `0008` 相当の DB に対して上記を適用した結果、行数が保存され（親1・子1）、`PRAGMA foreign_key_check` が無出力、`sqlite_master` 上の子テーブル定義の FK 参照が `REFERENCES "bosai_bulletin"(id)` に書き換わり、`headline_text`/`information_tag` を NULL とする INSERT が成功することを確認した。検証に使った一時 DB・SQL は削除済みである。

**リポジトリ・型の変更**

- `apps/api/src/repositories/types.ts`: `BosaiBulletinInput.headlineText` / `.informationTag`、および `BosaiBulletin` の同項目を `string | null` にする。
- `apps/api/src/repositories/bosaiBulletinRepository.ts`: 行型 `BosaiBulletinRow` の当該2列を `string | null` にし、`saveBosaiBulletin` の `validateNonEmptyString(input.headlineText, ...)` / `validateNonEmptyString(input.informationTag, ...)` を「**null でなければ非空文字列を要求する**」検証へ差し替える（`null` は許容、空文字列は従来どおり拒否）。`INSERT`／`ON CONFLICT DO UPDATE`／`SELECT` のマッピングは列名の変更が無いためそのままでよい。
- `listBosaiBulletins` の絞り込み条件は `bosai_bulletin_area` を見るため影響を受けない。
- 他 Issue（#6 の既存テスト）が `headlineText` に非 null を渡している箇所は型が広がるだけなので変更不要である。

## 4. モジュール・型・内部 API

```text
apps/api/src/
├── polling/
│   ├── jmaVpbs50Parser.ts      # 新規: VPBS50 の純粋 parser
│   ├── jmaVpbs50Processor.ts   # 新規: 保存と adoption 更新
│   ├── jmaXmlPoller.ts         # VPBS50 dispatch を1分岐追加
│   └── index.ts                # export 追加
├── repositories/
│   ├── types.ts                # 電文種別・対象・parser 入出力型を追加
│   │                           # BosaiBulletinInput/BosaiBulletin の
│   │                           # headlineText・informationTag を string | null へ
│   └── bosaiBulletinRepository.ts  # 上記2項目の null 許容化（検証と行型）
└── (migrations/)
    └── 0015_relax_bosai_bulletin_nullable.sql  # 新規: NOT NULL 緩和（§3.8）

apps/api/tests/
├── jmaVpbs50Parser.test.ts     # 新規
├── jmaVpbs50Processor.test.ts  # 新規
└── jmaXmlPolling.test.ts       # VPBS50 dispatch ケースを追加
```

```ts
export const VPBS50_TELEGRAM_TYPE = 'VPBS50' as const;

/** 情報タグ Condition の原文。表示名への変換は行わない。 */
export const BOSAI_BULLETIN_TARGET_TAGS = ['線状降水帯発生', '線状降水帯直前', '記録雨'] as const;
export type BosaiBulletinTargetTag = (typeof BOSAI_BULLETIN_TARGET_TAGS)[number];

/** 会場定義から導出した判定用の区域コード集合。 */
export interface BosaiBulletinTarget {
  readonly includedAreaCodes: readonly string[];
}

export interface ParsedVpbs50 {
  readonly eventId: string;
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly reportDateTime: UtcIso8601String;
  readonly targetDateTime: UtcIso8601String | null;
  readonly controlDateTime: UtcIso8601String;
  readonly title: string;
  /** 取消電文で Headline/Text が無い場合のみ null（§3.6）。発表・訂正では必ず非空。 */
  readonly headlineText: string | null;
  /** 取消電文で情報タグ Item が無い場合のみ null（§3.6）。発表・訂正では必ず対象3値のいずれか。 */
  readonly informationTag: BosaiBulletinTargetTag | null;
  readonly isCancelled: boolean;
  readonly infoKindVersion: string | null;
  readonly areas: readonly BosaiBulletinAreaInput[];
}

export type Vpbs50ParseResult =
  | { readonly ok: true; readonly value: ParsedVpbs50 }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

export function parseVpbs50(
  rawXml: string,
  reception: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  target?: BosaiBulletinTarget,
): Vpbs50ParseResult;

/** 両会場の includedAreaCodes の和集合を返す。順序は east → trc の出現順、重複除去済み。 */
export function resolveBosaiBulletinTarget(): BosaiBulletinTarget;
export const DEFAULT_BOSAI_BULLETIN_TARGET: BosaiBulletinTarget;

export function processVpbs50Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target?: BosaiBulletinTarget,
): Vpbs50ParseResult;
```

- `parseVpbs50` は DB に触れない純粋関数とする。DB 上の既存行を参照する §3.5 の更新判定は `processVpbs50Reception` 側の責務とする。取消電文の欠落要素は NULL で保存する確定方針のため、**parser も processor も既存行の値を引き継がない**（DB 参照は更新判定のためだけに行う）。
- `processVpbs50Reception` は、`findBosaiBulletin` による既存行照会・`saveBosaiBulletin`・`updateTelegramReceptionAdoption` を**1トランザクション**で実行する。保存に失敗して adoption だけが残ってはならない。
- adoption の値は既存 processor に合わせる。成功時 `adoptionResult: '気象防災速報として解析済み'`、失敗時は `disposition` をそのまま、旧版スキップ時は `'重複または旧版'` とし、`adoptionReason` に判定理由（棄却された区域コード等）を日本語で残す。

## 5. 実装手順

0. `apps/api/migrations/0015_relax_bosai_bulletin_nullable.sql` を追加する（§3.8。`0008` は書き換えない）。あわせて `types.ts` の `BosaiBulletinInput` / `BosaiBulletin` と `bosaiBulletinRepository.ts` の行型・検証を null 許容化する。既存の #6 のテストが引き続き通ること、および NULL を渡した保存・読み出しが往復することを確認する。
1. `types.ts` に `VPBS50_TELEGRAM_TYPE`・`BosaiBulletinTarget`・`ParsedVpbs50`・`Vpbs50ParseResult` を追加する。既存の `BosaiBulletinInput` 系の型は変更しない。
2. テスト fixture を用意する（§6 の前提）。実装前に各失敗テストが red になることを確認する。
3. `jmaVpbs50Parser.ts` を実装する。namespace・直接の親子関係・要素数の検証、情報タグによる種別判定、Headline＋Body からの区域抽出と重複除去、対象判定を行う。
4. `jmaVpbs50Processor.ts` を実装する。`Control/DateTime` 比較による更新判定、取消時の NULL 保存、トランザクション、`control_status` 分離をテストする。
5. `jmaXmlPoller.ts` の dispatch 連鎖の末尾に VPBS50 分岐を追加し、`index.ts` に export を追加する。
6. `jmaXmlPolling.test.ts` に混在フィードのケースを追加し、VPBS50 が C7 のみに dispatch されること、同一 document URL が1回だけ処理されること、他テーブルを変更しないことを検証する。
7. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を実行する。

### 5.1 テスト fixture の方針

- 正例・種別判定・短時間大雪の除外には、**気象庁提供サンプルの原文**（`82_01_01_260324_VPBS50.xml`＝線状降水帯発生、`82_03_01/02/03_260324_VPBS50.xml`＝直前予測の同一親番3件、`82_01_02_250630_VPBS50.xml`＝記録的短時間大雨、`82_01_03_241031_VPBS50.xml`＝短時間大雪）を用いる。これらは千葉県・福岡県・網走等が対象であるため、**会場対象判定の正例にはならない**。会場対象の正例は、これらサンプルの構造を保ったまま区域コードのみを東京の対象コードへ差し替えた派生 fixture とし、fixture 内コメントに「公式サンプル `<ファイル名>` の区域を差し替えた合成データ」と明記する。合成であることを隠して実電文として扱わない。
- 負例の実データ `20260905220832_0_VPBS50_130000.xml`（伊豆諸島南部 `130030`）はリポジトリ内に存在しない。**ヒアリングで「製造時にネットワーク取得を試みる」ことが確定した。** 製造担当は次の順で運用する。
  1. `https://www.data.jma.go.jp/developer/xml/data/20260905220832_0_VPBS50_130000.xml` の取得を試みる。
  2. 取得できた場合は原文をそのまま fixture として保存し、実データである旨（取得日時・取得元 URL）を fixture 先頭コメントまたは README に記録する。
  3. 取得できない場合（公開期間切れ・404・ネットワーク不可）は、公式サンプル `82_03_01_260324_VPBS50.xml` の区域コード・区域名を `130030`／`伊豆諸島南部` に差し替えた合成 fixture へフォールバックする。**合成である旨（元サンプル名・差し替えた箇所）を fixture のコメントと、それを使うテストのコメント・テスト名の双方に明記する。**
  4. どちらの経路でも、検証内容（「非対象区域の速報が採用されず、会場向け一覧に混入しない」）と受け入れ条件の判定基準は同一とする。取得可否によって受け入れ条件の合否が変わってはならない。
- 訂正・取消・訓練・試験の fixture は実電文が存在しないため、公式サンプルの `InfoType`／`Control/Status` を差し替えた合成データとする。合成であることを fixture と設計書の双方に明記する（§10 残留リスク）。

## 6. 受け入れ条件

検収担当は各項目を1つずつ実行する。

- [ ] `82_01_01_260324_VPBS50.xml`（線状降水帯発生）を `parseVpbs50` に渡すと `ok: true` となり、`eventId='JPTE202309081000_202309081019'`、`informationTag='線状降水帯発生'`、`title='千葉県気象防災速報（線状降水帯発生）'`、`headlineText` が `Headline/Text` の全文と完全一致し、`areas` が `120010/北西部`・`120020/北東部`・`120030/南部` の3件（`codeType='気象情報／府県予報区・細分区域等'`、`sequence` は 0,1,2）であること。ただし判定用 target を千葉のコードにした場合に限る（既定 target では `対象地域外` になること）。
- [ ] `82_01_02_250630_VPBS50.xml`（記録的短時間大雨）で、Headline の `013010/網走地方` と **Body の `0154300/美幌町`（`codeType='気象・地震・火山情報／市町村等'`）の両方**が `areas` に含まれること。Body の `Station`（アメダス地点番号 `17631`）は `areas` に含まれないこと。
- [ ] 既定 target（両会場の和集合 `1310800`,`130012`,`130010`,`1311100`,`130011`）で、伊豆諸島南部 `130030` を対象とする負例 fixture（§5.1 の実データ取得が成功した場合はその原文、失敗した場合は合成 fixture。**どちらを使ったかが fixture とテストのコメントから読み取れること**）が `ok:false` / `disposition='対象地域外'` を返し、`bosai_bulletin` に行が1件も作られないこと。同 fixture を processor に通したあと `listBosaiBulletins(conn, { controlStatus:'normal', includedAreaCodes: east の3コード })` が空配列を返すこと。
- [ ] 江東区 `1310800` を Body 区域に持つ fixture、大田区 `1311100` を持つ fixture、東京地方 `130010` のみを持つ fixture の3件がいずれも採用され、`listBosaiBulletins` の east 絞り込みでは前2件のうち江東区のものと東京地方のものが返り、大田区のみのものは返らないこと（trc 絞り込みではその逆）。
- [ ] `82_01_03_241031_VPBS50.xml`（短時間大雪、Condition=`短時間大雪`）が `disposition='対象外'` となり、区域が対象コードに一致する形へ差し替えた場合でも保存されないこと。
- [ ] `82_03_01/02/03_260324_VPBS50.xml`（親番 `JPFK202307100159` が同一、枝番が異なる3件）を順に processor へ通すと、`bosai_bulletin` に**3行**が並存し、どれも他を上書きしないこと（`event_id` が完全な EventID で3種類あること）。
- [ ] 同一 EventID・同一 `control_status` の電文を、`Control/DateTime` を新しくして再投入すると既存行が更新され（`headline_text`・`info_type`・`control_datetime` が新しい値になり、区域明細が全置換される）、行数が増えないこと。
- [ ] 同一 EventID で `Control/DateTime` が既存と**同じ**、および**古い**電文を投入した場合、既存行が一切変更されず、reception の `adoption_result` が `重複または旧版` になること。`ReportDateTime` が変わらない訂正 fixture（`Control/DateTime` のみ新しい）は正しく更新されること。
- [ ] `apps/api/migrations/0015_relax_bosai_bulletin_nullable.sql` が追加されており、`0008_create_bosai_bulletin.sql` が**1バイトも変更されていない**こと（`git diff main -- apps/api/migrations/0008_create_bosai_bulletin.sql` が空）。
- [ ] `0008` 適用済みで親1行・子1行を持つ DB に対して `0015` を適用すると、行数が保存され（親1・子1）、`PRAGMA foreign_key_check` が無出力で、`SELECT sql FROM sqlite_master WHERE name='bosai_bulletin_area'` の FK 参照先が `bosai_bulletin` になっていること。マイグレーション適用後に `npm run test -w apps/api` の既存 #6 テストが通ること。
- [ ] `headline_text` / `information_tag` に `NULL` を入れた行が保存でき、`findBosaiBulletin` で `headlineText === null` / `informationTag === null` として読み戻せること。一方、**空文字列**を渡した場合は従来どおり `saveBosaiBulletin` が例外を投げること。
- [ ] `InfoType='取消'` の fixture で、同一 EventID の行が `is_cancelled=1` に更新され、**行が削除されない**こと。
- [ ] `InfoType='取消'` かつ `Headline/Text` が無い（または空）／情報タグ `Item` が0件の fixture が `ok:true` で受理され、`headline_text` / `information_tag` が **NULL** で保存されること。既存行に値があっても**引き継がれず NULL になる**こと、`Head/Title` が `headline_text` に代入されていないこと。
- [ ] 同じ欠落を持つ fixture でも `InfoType='発表'` / `'訂正'` の場合は `未対応構造` となり、`bosai_bulletin` を変更しないこと（NULL 許容は取消だけの退避経路であること）。
- [ ] `InfoType='取消'` で情報タグが無く、かつ抽出区域が0件の fixture が `未対応構造` となり保存されないこと。区域が対象コードに交差しない取消電文は `対象地域外` となり保存されないこと。
- [ ] `Control/Status` が `訓練` の fixture を、同一 EventID の `通常` 行が存在する状態で投入すると、`control_status='training'` の別行が作られ、`normal` の行の内容が一切変わらないこと。`試験` も同様であること。
- [ ] namespace 不正、`InfoKind` が `気象解説情報` でない、`Control/Title` が `府県気象防災速報` でない、情報タグ `Item` が0件／2件以上、`Area` の `Name`／`Code`／`codeType` 欠落、reception と `Control/DateTime`・`ReportDateTime`・`Control/Status` が不一致——の各 fixture が `対象外` または `未対応構造` となり、`bosai_bulletin` を変更しないこと。
- [ ] `InfoKindVersion` が `1.5_0` 以外の値（例 `1.6_0`）でも受理され、`source_version` にその値が保存されること。
- [ ] 保存された行の `valid_to` が `null` であること（発表後3時間を `valid_to` に書き込まないこと）。`report_datetime` が `Head/ReportDateTime`、`fetched_at` が reception の `receivedAt` と一致すること。
- [ ] processor 内で `saveBosaiBulletin` を失敗させた場合、reception の adoption も更新されないこと（トランザクションの原子性）。
- [ ] 混在フィードの統合テストで、VPBS50 が C7 processor にのみ dispatch され、`warning_current_*`・`warning_timeseries_*`・`early_warning_*`・`area_timeseries_*`・通知関連テーブルが変更されないこと。同じ document URL が複数フィードに現れても1回だけ処理されること。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` がすべて通ること。

## 7. 対象外（本 Issue で実装しないこと）

- 竜巻関連電文 `VPHW50`／`VPHW51`（C8 で別電文形式として扱う）
- 速報パネルの表示（Epic G2）、発表後3時間の経過判定・表示終了判定
- 短時間大雪の速報処理（§5.12 で対象外確定）
- `VPBS51`（潮位速報。当面提供見送りのため対象外確定）
- 公式速報地図 JSON（`information.json` / `tornado.json`）による表示対象・表示期限の補完
- REST API、通知判定、availability の `stale`／`unavailable` 遷移
- EventID 親番による速報の関連付け・グルーピング
- 列の**追加**を伴うスキーマ変更（発表官署列・`Area/Status` 列・`Serial` 列）。本 Issue で行うスキーマ変更は §3.8 の NOT NULL 緩和1本のみである

## 8. 後続 Issue への引き継ぎ

- **G2（速報パネル）は `headline_text` / `information_tag` が NULL になり得ることを前提に実装すること。** NULL になるのは `info_type='取消'` の行に限られる（§3.6）。「本文なし」を空文字列として描画するか取消であることを明示するかは G2 の設計判断とする。
- **G2（速報パネル）**: 表示に必要な項目は `title`・`areas`（`areaCode`/`areaName`/`codeType`）・`report_datetime`・`headline_text`・`event_id`・`info_type`・`is_cancelled` から取得できる。発表後3時間の判定は `report_datetime` を基準に表示層で行い、`valid_to` を有効期限として読まない。並び順は `report_datetime` の新しい順（§5.6【確定】）。
- **直接対象／広域情報の区別**は DB に列を持たない。会場の `includedAreaCodes` と保存済み `areas[].codeType` から後段で導出する。市町村コード一致＝直接対象、府県予報区・細分区域コード一致＝「会場を含む広域情報」として区域名を明示する（取得方法レポート §3.6）。
- **API 層**は `listBosaiBulletins` の `includedAreaCodes` に会場の定義をそのまま渡す。会場ごとに別クエリとし、両会場の和集合で取得した結果を会場別一覧としてそのまま出さない。
- **発表官署**（`EditorialOffice`／`PublishingOffice`）を補助表示する場合は列追加のマイグレーションが必要である。
- **C8（竜巻 VPHW50/51）** は本設計の `bosai_bulletin` を流用できるか未検証である。電文形式が異なるため、テーブル共有の可否は C8 の設計で判断する。§5.6 は竜巻に §5.5 の3時間ルールを適用しないと明記しているため、`valid_to` の扱いは別途設計する。
- **availability 担当**は、取得失敗・対象地域外・構造不正を区別する。VPBS50 は複数行が並存するため、availability を行単位で `stale` にする意味づけは別途定義が必要である。

## 9. ヒアリング結果（解決済み）

初版の要ヒアリング事項4点は、2026-09-10 の追加ヒアリングですべて解決した（§2.2.1 参照）。

1. **取消電文で `Headline/Text`・情報タグが欠ける場合の扱い** → **スキーマを NULL 許容にする**。`0015_relax_bosai_bulletin_nullable.sql` で `headline_text`・`information_tag` の NOT NULL を外し、取消電文で要素が無い場合はそのまま NULL で保存する。既存行からの引き継ぎ・`Head/Title` による代用は行わない（§3.6・§3.8）。
2. **対象外区域の速報を保存するか** → **保存しない**（PoC 範囲）。初版方針のまま（§3.4）。将来、東京都内の全速報を広域一覧として見せる要件が出た場合は、採否判定の位置づけを見直す必要がある（§8 引き継ぎ）。
3. **負例 fixture の入手** → **製造時にネットワーク取得を試みる**。失敗時は合成 fixture にフォールバックし、合成である旨をコード・テストに明記する（§5.1・§6）。
4. **発表官署の保存** → **今回は保存しない**。初版方針のまま（§3.7・§7）。G2 で必要になった時点で列追加のマイグレーションを行う。

**本改訂の時点で、新たな要ヒアリング事項は無い。**

## 10. 残留リスク（製造担当が迷いそうな点）

- **NULL 許容化は「取消電文で本文・情報タグが欠ける」という未確認の可能性に備えた措置である。** 実際の取消電文がこれらを常に含むなら NULL の行は生まれない。列を緩めたこと自体は無害だが、**発表・訂正の電文で欠落を見逃さない**よう、§3.6 の「NULL 許容は `InfoType='取消'` に限る」条件を実装で必ず分岐させること。全 InfoType で欠落を許すと、構造変化を検知できないまま空の行が積み上がる。
- **SQLite のテーブル再構築は DROP の順序を誤ると子行が消える。** `PRAGMA foreign_keys = ON` かつマイグレーションはトランザクション内で走る（トランザクション内では当該 PRAGMA を切り替えられない）ため、§3.8 の「子 → 親の順に DROP」を必ず守ること。親を先に DROP すると `bosai_bulletin_area` の行が CASCADE で静かに消える（エラーにならない）。
- **訂正・取消・訓練・試験の VPBS50 実電文は1件も確認できていない。** これらのテストはすべて公式サンプルを加工した合成 fixture であり、実電文の構造が異なる可能性がある。実挙動未確認である旨をテストのコメントに残すこと。
- **EventID の親番／枝番の区切り規則は実データで確定できていない。** 親番の桁数・形式がサンプル間で一定でないため、本設計は分割を一切行わない。将来、親番による関連付けが必要になったら公式資料 [L10] を再確認してから実装する。
- **会場の市町村コードが Headline の情報タグに現れるかは未確認である。** サンプルでは記録的短時間大雨の Body にのみ市町村コードが現れた。線状降水帯の速報で市町村コードが現れる形は確認できていない。Headline と Body の両方を走査する本設計はこの不確実性を吸収するが、「江東区が直接対象になる実速報」は未確認である（取得方法レポート §3.6 も追加検証事項としている）。
- **`InfoKindVersion` を受理条件にしない判断**は、将来の版更新で仕様が変わっても電文を受理し続けることを意味する。構造検証（namespace・要素の直接の親子関係・要素数）が実質的な防御線であり、構造が変われば `未対応構造` として棄却される。
- **`Area/Status`（`付近` 等）を保存しない**ため、記録的短時間大雨の「美幌町付近」という精度情報は `headline_text` の全文からのみ読める。パネルは速報文全文を表示する設計（§5.6）のため情報は失われないが、構造化された区域だけを使う画面を作ると精度が過大に見える可能性がある。
