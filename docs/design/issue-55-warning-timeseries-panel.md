# Issue #55 G4. 警報等時系列パネル 設計書

## 1. 目的と範囲

GitHub Issue #55「G4. 警報等時系列パネルの実装」として、E2 #34 の `GET /api/weather/warning-timeseries` を右側情報パネルの「警報等時系列」に結線し、次を実装する。

- パネル本体: 発表時刻の下に、縦軸を現象(危険度の種類)、横軸を時間帯とする危険度の色分け表
- 詳細ダイアログ: 3時間表(危険度全行＋3時間刻みの量的予想)と、日単位・24時間単位の量的予想の別欄を、単位・区分付きで表示
- G10 #61 の「詳細(仮)」入口(警報等時系列分のみ)を撤去し、本物の入口に置き換える

範囲外: 履歴表示(ユーザー決定で実施しない)、付加事項(`additions`)の表示、取得状態表示の新方式(G9 #60)、API・共通型・DB の変更。

## 2. 参照資料と設計判断の根拠

- [基本設計](../basic-design.md) §5.8(本設計で改訂案を示す。§2.2)、§5.13(横スクロール・初期位置の一般方針)
- [issues-draft](../issues-draft.md) G4 項目、[棚卸し](../audit-epic-a-d.md) AD-H048
- [#14 設計書](issue-14-warning-timeseries.md)(正規化)、[#33 設計書](issue-33-warning-rest-apis.md) §3.4(API 契約)
- [#52 設計書](issue-52-info-panel-layout.md)(always パネルの状態規則)、[#54 設計書](issue-54-warning-panel.md)(段階色トークン・API クライアントの作り)、[#61 設計書](issue-61-detail-dialog.md) §5・§6・§10(詳細ダイアログと時系列表部品)
- 型: `packages/shared/src/weatherApi.ts` の `WarningTimeseriesResponse` / `WarningTimeseriesTimeDefine` / `WarningTimeseriesValue`
- 実電文: [気象庁提供サンプル](../../../docs/260907_weather-data/jmaxml_20260723_Samples/) の `*_VPWP50.xml` 4本
- 公式資料: [気象警報・注意報時系列情報(R06)解説資料および別表](<../../../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/>)(別表2 要素、別表4 危険度と対応するコード)

### 2.1 ヒアリング確定事項(統括経由・ユーザー決定)

初回(2026-09-27):

1. 行の順序は**電文の出現順そのまま**とする。§5.7 の固定順との対応付けはしない。基本設計 §5.8 の当該【確定】記述と Issue 受け入れ条件は、これに合わせて改訂する(ユーザー承認済み)。
2. 色は #54 の段階色トークンを流用する(注意報級=黄 `--wx-alert-level-2-*`、警報級=赤 `--wx-alert-level-3-*`、危険警報級=紫 `--wx-alert-level-4-*`、特別警報級=`--wx-alert-level-5-*`)。凡例は詳細ダイアログにだけ置く。未満・値なし・欠測/未取得は区別し、欠測を低危険度として扱わない。コード→段階の対応は、実データ・公式資料で確認できた範囲だけを確定扱いとする。
3. 全コマを保持し、現在を含む時間帯の列へ初期スクロールする。過去の列は左スクロールで閲覧できる。固定コマ数で切り捨てない。行見出しは固定する。
4. 詳細ダイアログは、行見出しに要素・区分・単位を入れる案をベースとする。見た目は後日ユーザー監修予定のため【設計案】とする。
5. 履歴表示はしない。AD-H048 の結論記録を受け入れ条件に含める。null・3状態・時刻の意味・会場(east/trc)・本番/訓練の区別を維持する。

追加(2026-09-27、初版設計への回答):

6. セルの文字は、レベル5(特別警報級を含む)=「切迫」、レベル4=「危険」、レベル3(警報級を含む)=「警戒」とする。レベル2・注意報級には文字を付けない(色のみ)。文字は**色が切り替わるセル**(同じ行で直前の列と段階が変わる最初のセル)にだけ表示する。同じ段階が続くセルは色だけで示す。
7. 日単位の危険度(乾燥・なだれ・低温・霜など)は3時間刻みの表に統合する。日区間が覆う各3時間列に同じ値を複製し、パネル本体の表は1つにする。
8. 日単位・24時間単位 block の量的予想(24時間最大雨量、湿度、降雪量など)は、詳細ダイアログ内の「別欄」の表にする。列見出しは電文の時間定義に基づき「○日○時まで」「○日」の形式にする。
9. パネル(カード)には、注意報級(レベル2)以上の危険度を1セル以上含む行だけを表示する。詳細ダイアログには全行を表示する(ユーザー確認済み)。
10. 欠測を含む行も、注意報級以上のセルが無ければパネルでは隠し、詳細でだけ見せる(ユーザー決定)。欠測を低危険度扱いしない原則(項2)とは、詳細で「?」として区別できることで両立させる。
11. 段階文字は、切替セルに加えて初期スクロール位置の列(現在を含む列)にも補う。そのセルが level3 以上なら、段階が切り替わっていなくても文字を付ける。スクロールには追従しない。
12. 3時間表の基準範囲より先の期間にある日単位の危険度は、パネル・詳細とも表示しない(§5.13「全期間閲覧可能」の例外)。

### 2.2 基本設計 §5.8 の改訂文案(統括担当が反映する。本Issueでは basic-design.md を編集しない)

経緯: §5.8 は「行の順序は§5.7で確定した段階内の固定順(暴風雪→大雨→洪水→暴風→大雪→波浪→高潮→土砂災害)を流用する」を【確定】としていた。しかし、VPWP50 の危険度の種類(`Property/Type`)は「大雨浸水危険度・土砂災害危険度・風危険度・雪危険度・波危険度・高潮危険度・雷危険度・融雪危険度・濃霧危険度・着氷危険度・着雪危険度・乾燥危険度・なだれ危険度・低温危険度・霜危険度」である(サンプル4本・別表2で確認)。これらは §5.7 の警報名と1対1に対応しない(例: 「風」は暴風雪/暴風/風雪/強風を含む)。対応付けは推測になるため、ユーザー判断により電文の出現順を採った。

差し替え前:

> - 対象の現象【確定】: 固定リストを仮定せず、電文（VPWP50）に含まれる現象だけを表示する。行の順序は5.7で確定した段階内の固定順（暴風雪→大雨→洪水→暴風→大雪→波浪→高潮→土砂災害）を流用する。

差し替え後:

> - 対象の現象【確定】: 固定リストを仮定せず、電文（VPWP50）に含まれる危険度の種類だけを対象とする。行の順序は電文の出現順とする（2026-09-27 ユーザー決定）。VPWP50の危険度の種類（大雨浸水・土砂災害・風・雪・波・高潮・雷・濃霧等）は5.7の警報名と1対1に対応しないため、5.7の固定順との対応付けは行わない。
> - 表は3時間刻みの1表とし、日単位の危険度（乾燥・なだれ・低温・霜等）は日区間が覆う各3時間列に同じ値を複製して統合する（2026-09-27 ユーザー決定）。
> - セルは段階色で塗る。文字は段階が切り替わるセルにだけ付け、レベル5（特別警報級を含む）「切迫」、レベル4「危険」、レベル3（警報級を含む）「警戒」とする。レベル2・注意報級は色のみとする（2026-09-27 ユーザー決定）。凡例は詳細ダイアログに置く。欠測・未取得を危険度の低い状態として表示しない。
> - パネルには注意報級（レベル2）以上を含む行だけを表示し、詳細には全行を表示する。欠測だけの行もパネルでは表示せず、詳細で欠測として区別して示す（2026-09-27 ユーザー決定）。
> - 段階の文字は、切り替わるセルに加え、初期表示位置（現在を含む時間帯）のセルにもレベル3以上なら付ける。スクロールには追従しない（2026-09-27 ユーザー決定）。
> - 表示時間範囲は5.13の一般方針に従う（初期位置は現在を含む時間帯、全期間を横スクロールで閲覧可能、固定コマ数で切り捨てない）。ただし例外として、3時間刻みの表の期間より先にある日単位の危険度は、パネル・詳細とも表示しない（2026-09-27 ユーザー決定）。
> - 日単位・24時間単位の量的予想（24時間最大雨量・湿度・降雪量等）は、詳細の別欄に「○日○時まで」「○日」の列見出しで表示する（2026-09-27 ユーザー決定）。

Issue #55 の受け入れ条件に「§5.7 の順で並ぶ」旨の記述がある場合は、「電文の出現順で並ぶ」へ改訂する(統括担当が Issue 本文を更新する)。

### 2.3 実物確認の結果

**危険度コード(公式資料 別表4で確認・確定)**

| コード | 名称(別表4) | サンプル出現 |
|---|---|---|
| 50 | 特別警報級 | なし |
| 30 | 警報級 | なし |
| 20 | 注意報級 | なし(解説資料の記載例にあり) |
| 01 | 注意報級未満 | あり |
| 51 | 警戒レベル５相当 | なし |
| 41 | 警戒レベル４相当 | なし |
| 31 | 警戒レベル３相当 | なし(解説資料の記載例にあり) |
| 22 | 警戒レベル２相当 | なし |
| 21 | 警戒レベル２ | なし |
| 11 | 警戒レベル２未満 | あり |
| 00 | 値なし(予測の確度が十分でない期間又は予測対象外の期間) | あり(霜・高潮) |

- 別表4に「危険警報級」に当たる非レベル系コードは無い。紫(level-4)に到達するのは 41 のみ。
- 21「警戒レベル２」と 22「警戒レベル２相当」の意味の違いは資料から読み取れなかった(§9)。
- 解説資料: 量的値の `condition="値なし"` は、対応する時間帯の危険度コードが 00/01/11 のときに記載されることがある。風向・風速の `condition="風雪"` は雪を伴う場合。

**block 構成(サンプル4本・稚内市等。江東区の実電文はサンプルに無い)**

| block | Duration | コマ数 | 内容 |
|---|---|---|---|
| 1 | PT3H | 8〜14 | 危険度(大雨浸水・土砂災害・風・雪・波・高潮・雷・融雪・濃霧・着氷・着雪)と量的予想(雨・風・雪・波・高潮) |
| 2 | PT24H | 2 | 量的予想のみ(24時間最大雨量・24時間最大降雪量) |
| 3 | PT24H と PT6H/PT12H/PT18H の混在 | 2〜3 | 危険度(乾燥・なだれ・低温・霜)と量的予想(実効湿度・最小湿度) |

- 危険度にも量的予想にも `Local/AreaName`(陸上／海峡名、オホーツク海側／日本海側等)による区分がある。
- API の `values` はパーサーの `globalSequence`(電文内の出現順、全 block 通し)で並ぶ(`warningTimeseriesRepository.ts` の `ORDER BY sequence`)。したがって配列順＝電文の出現順として扱える。`timeDefines.sequence` は block 内の順。
- 江東区の Kind には Name/Code が無い(#14 §4 記録)。行見出しは `propertyType`/`valueType` から作り、`kindName` を使わない。

## 3. 構成

### 3.1 モジュール構成

ファイル名・内部関数分割は製造裁量。§7 の許可一覧の外に出ないこと。

| ファイル | 種別 | 役割 |
|---|---|---|
| `apps/web/src/api/warningTimeseries.ts` | 新規 | `fetchTileCatalog` を `path: '/api/weather/warning-timeseries'` で呼び、`parseWarningTimeseriesResponse` で検証(`api/warnings.ts` と同じ作り) |
| `apps/web/src/map/panels/warningTimeSeries/warningTimeSeriesModel.ts` | 新規 | 純粋関数: コード表、表モデル組み立て、現在列の決定、列ラベル |
| `apps/web/src/map/panels/warningTimeSeries/useWarningTimeSeries.ts` | 新規 | `useTileCatalogPolling` によるポーリング。`InfoPanelCardInput`(1件)を返す |
| `apps/web/src/map/panels/warningTimeSeries/WarningTimeSeriesContent.tsx` | 新規 | パネル本文(危険度表＋「詳細」ボタン＋ダイアログ) |
| `apps/web/src/map/panels/warningTimeSeries/WarningTimeSeriesDetail.tsx` | 新規 | 詳細ダイアログ本文(3時間表・別欄の表＋凡例) |
| `apps/web/src/map/panels/warningTimeSeries/warningTimeSeries.css` | 新規 | スタイル。`apps/web/src/index.css` に `@import` 1行を追加 |
| `apps/web/src/map/WeatherMapView.tsx` | 変更 | `useWarningTimeSeries` を呼び `infoPanelInput.warningTimeSeries` に渡す |
| `apps/web/src/map/panels/panelFixtures.ts` | 変更 | `all-content` の警報等時系列の仮入口を本物の内容へ差し替え、フィクスチャ `warning-timeseries` を追加(§6) |
| `apps/web/src/map/panels/detailDialogFixtures.tsx` | 変更 | `WarningTimeSeriesDetailFixtureEntry` とそのサンプルを削除(#61 §10)。地域時系列予報側は残す |
| `apps/web/tests/warningTimeSeriesPanel.test.ts(x)` | 新規 | 単体テスト |

時系列表は G10 の `DetailTimeSeriesTable` をパネル本体・詳細の両方で使う(行見出し固定・`initialColumnKey` による初期位置合わせが既にある)。`apps/web/src/map/detail/**` は変更しない。パネル本体の列幅は、ラッパー要素のクラス(例 `.wts-panel-table`)配下のセレクタで `detail.css` の `min-inline-size` を上書きする。

### 3.2 型・シグネチャ

```ts
// apps/web/src/api/warningTimeseries.ts
export function parseWarningTimeseriesResponse(
  body: unknown,
  requested: WeatherControlStatus,
): WarningTimeseriesResponse | null;
export function fetchWarningTimeseries(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<WarningTimeseriesResponse>>;
```

`parseWarningTimeseriesResponse` の検証: ルートがオブジェクト、`controlStatus === requested`、`isTraining === (requested === 'training')`、`metadata.availability` が3値のいずれか、`metadata.issuedAt` が文字列か null、`data` が null またはオブジェクトで `timeDefines`・`values` が配列。各 timeDefine の `blockId`・`timeId`・`timeFrom`・`timeTo` が文字列、`sequence` が数値。各 value の `blockId`・`refId`・`propertyType`・`valueType`・`valueText` が文字列、`valueCategory` が `risk|quantity`、`valueCode`・`unit`・`condition`・`areaDivision` が文字列か null。不一致は null(取得失敗扱い)。`additions`・`scope`・`capabilities` は検証・使用しない。

```ts
// warningTimeSeriesModel.ts
export type RiskDisplay = 'level5' | 'level4' | 'level3' | 'level2' | 'below' | 'noValue' | 'missing';
export const RISK_CODE_TABLE: Readonly<Record<string, { readonly name: string; readonly display: RiskDisplay }>>;
export function classifyRiskValue(value: WarningTimeseriesValue | undefined): RiskDisplay;
export interface RiskCell {
  readonly display: RiskDisplay;
  readonly label: '切迫' | '危険' | '警戒' | '—' | '?' | null; // §4.3
  readonly sources: readonly { readonly blockId: string; readonly timeId: string }[]; // 由来の区間(テスト・aria用)
}

export interface WtsColumn { readonly key: string; readonly timeFrom: string; readonly timeTo: string; readonly label: string }
export interface WtsRow<C> { readonly key: string; readonly label: string; readonly cells: readonly C[] }
export interface RiskTable {
  readonly baseBlockId: string;
  readonly columns: readonly WtsColumn[];
  readonly allRows: readonly WtsRow<RiskCell>[];     // 詳細用(非表示行を含む)
  readonly visibleRows: readonly WtsRow<RiskCell>[]; // パネル用(§4.2 行の表示条件)
  readonly currentColumnKey: string | null;
}
/** 危険度が0件なら null */
export function buildRiskTable(data: WarningTimeseriesData, now: number): RiskTable | null;
export function selectBaseBlockId(data: WarningTimeseriesData): string | null;
/** 基準列1つに対する他 block の区間の当てはめ(§4.2 包含判定) */
export function resolveMergedDisplay(column: WtsColumn, intervals: readonly { timeFrom: string; timeTo: string; display: RiskDisplay }[]): RiskDisplay;
export function assignTransitionLabels(displays: readonly RiskDisplay[], initialIndex: number | null): readonly RiskCell['label'][];
/** 詳細: 基準 block の量的予想の行(3時間表に追加) */
export function buildBaseQuantityRows(data: WarningTimeseriesData, baseBlockId: string): readonly WtsRow<DetailCell>[];
/** 詳細「別欄」: 基準以外の block の量的予想を block ごとの表で返す */
export function buildSeparateQuantityTables(data: WarningTimeseriesData, baseBlockId: string | null): readonly {
  readonly blockId: string;
  readonly columns: readonly WtsColumn[]; // label は formatIntervalHeader
  readonly rows: readonly WtsRow<DetailCell>[];
}[];
export function formatIntervalHeader(timeFrom: string, timeTo: string): string; // §4.4
export function resolveCurrentColumnKey(columns: readonly WtsColumn[], now: number): string | null;
export function buildWarningTimeSeriesCard(
  response: WarningTimeseriesResponse,
  availability: 'available' | 'stale',
  now: number,
): InfoPanelCardInput;
```

`DetailCell` は `{ kind: 'quantity'; text: string; condition: string | null } | { kind: 'noValue' } | { kind: 'missing' }` とする(名称は製造裁量)。

## 4. 振る舞い

### 4.1 見出し・取得状態(G1 always 規則)

- 見出し1行目は `panelDefinitions.ts` の title「警報等時系列」とする。2行目の対象名は `panelTargets.ts` の `warningTimeseries.displayName` を使う。時刻は `metadata.issuedAt` を `timeKind: 'issued'` で渡す。`fetchedAt`・`evaluatedAt`・各 `kindDateTime` は見出しに使わない。

| 状態 | カード(常に1件、`key: 'warningTimeSeries'`) |
|---|---|
| ポーリング `loading` | `status: { kind: 'loading' }`(スケルトン) |
| ポーリング `failed`(保持値なし) | `failed`(「取得できませんでした」) |
| 応答 `data === null`(`unavailable`) | `failed`。未取得を「危険度なし」で表さない |
| 応答 `data` あり・`metadata.issuedAt === null` | `failed`(契約外) |
| 応答 `data` あり・危険度の値が0件(`buildRiskTable` が null) | `data` 状態。本文は「危険度の情報がありません」の1行と「詳細」ボタン【設計案】。VPWP50 は常に危険度を含むため、解析欠落の可能性がある状態として正常空と文言を分ける |
| 応答 `data` あり・表示行が0件(全行が §4.2 の条件で非表示) | `data` 状態。本文は「注意報級以上の予想はありません」の1行と「詳細」ボタン【設計案】。これが**正常な空**である |
| 応答 `data` あり・表示行あり | `data` 状態。本文は表と「詳細」ボタン |
| ポーリング `stale`(前回応答あり) | 前回応答から `availability: 'stale'` で組み立てる(G1 現行どおり装飾なし。G9 #60 の決定までの暫定) |

- 正常な空(発表時刻付きの `data` 状態と文言)と取得不能(`failed`「取得できませんでした」)は、文言とカード状態の両方で区別する。
- `now` はデータ更新時(`useMemo` の依存に応答を含める)に `Date.now()` で取る。現在列を追従させるタイマーは置かない。

### 4.2 パネル本体の危険度表(1表)

**基準 block**: `valueCategory === 'risk'` の値を含む block のうち、列の最大長(`timeTo − timeFrom`)が最小のものとする。同じ長さなら `timeDefines` 上の初出順で先のものを選ぶ。サンプルでは 3時間刻みの block1 が選ばれる。列は基準 block の `timeDefines` を `sequence` 昇順で並べ、全コマを出す。

**行**:
- キーは `(propertyType, areaDivision)` とし、全 block を通して `values` 配列で最初に現れた順に並べる(電文の出現順。§2.1-1)。基準 block の行が先、日単位の行(乾燥等)が後になるのは、電文の順がそうなっているからであり、並べ替えではない。
- 行見出しは、`propertyType` の末尾「危険度」を除いた文字列とする(例「大雨浸水」「乾燥」)。`areaDivision` が非 null なら区分名を付ける(例「風(陸上)」)。`kindName` は使わない。

**セルの値**:
- 基準 block の行: `(blockId, refId === timeId)` で結合する。添字位置では結合しない。
- 他 block(日単位等)の行: 行の各値を区間 `[timeFrom, timeTo)` として、基準列 `[f, t)` ごとに `resolveMergedDisplay` で当てはめる(§2.1-7)。
  1. 列と重なる区間(`F < t && f < T`)を集める。
  2. 重なる区間が1つもない場合(日単位データの予報期間外): `noValue`(「—」)とする。別表4の「値なし」の定義(予測対象外の期間)と同じ意味のため、未満にも欠測にもしない。
  3. 1つの区間が列を完全に含む場合(`F <= f && t <= T`): その区間の値を複製する。
  4. 列が区間境界をまたぐ場合(3時間列と日区間の境界がずれている場合): 重なる全区間の値のうち、次の優先順位で最も上のものを採る。`level5 > level4 > level3 > level2 > missing > below > noValue`。危険度の高い側を見落とさないためであり、欠測は「未満」「値なし」より優先して見せる。
- 実電文の日区間(PT24H・PT18H 等)の境界は JST 0時・6時等の3の倍数時刻で、3時間列と揃うと見込まれる。ただし実電文(江東区)では未確認のため、規則4は防御として実装し単体テストで確かめる。
- 基準 block の範囲外にある日区間(翌々日以降など)はパネルに出さない。詳細ダイアログの危険度表でも同じ列範囲に限る(§2.1-12、ユーザー決定。§5.13 の例外)。

**行の表示条件(§2.1-9・10、確定)**:
- パネル本体には、`level2`〜`level5` のセルを1つ以上含む行だけを表示する(`visibleRows`)。
- 全セルが `below`・`noValue`・`missing` だけの行は非表示とする。欠測だけの行も隠す。欠測は詳細で「?」として区別できる(§2.1-10)。
- 詳細ダイアログには全行(`allRows`)を表示する。

**初期位置**: `resolveCurrentColumnKey` の結果を `initialColumnKey` に渡す。
- `timeFrom <= now < timeTo` の列があればその列とする。
- 全列が未来(`now < 先頭 timeFrom`)なら先頭列、全列が過去(`now >= 末尾 timeTo`)なら末尾列とする。列が0件なら null。

**表示**:
- 行見出しは固定する(部品の既存 sticky)。表部分だけ横スクロールし、パネル列には横スクロールを出さない。
- 列ラベルは `DetailTimeSeriesTable` の2段見出しとする。下段は JST 時で `H-H時`(終端0時は24と書く)。
- 寸法【設計案】: 行見出し列 `min-inline-size: 5rem`、データ列 `min-inline-size: 2.5rem`(2字の「切迫」が収まる幅)。実寸は AC-10 で記録する。

### 4.3 セルの段階・文字

| コード | 表示区分 | 色トークン | 文字 | 確度 |
|---|---|---|---|---|
| 50 特別警報級 / 51 警戒レベル５相当 | level5 | `--wx-alert-level-5-*` | 切迫(切替セルのみ) | コード対応は別表4で確定。色・文字はユーザー決定 |
| 41 警戒レベル４相当 | level4 | `--wx-alert-level-4-*` | 危険(切替セルのみ) | 同上 |
| 30 警報級 / 31 警戒レベル３相当 | level3 | `--wx-alert-level-3-*` | 警戒(切替セルのみ) | 同上 |
| 20 注意報級 / 22 警戒レベル２相当 / 21 警戒レベル２ | level2 | `--wx-alert-level-2-*` | なし | 同上。21と22の差は【未確認】 |
| 01 注意報級未満 / 11 警戒レベル２未満 | below | 無着色(`--md-sys-color-surface` 系) | なし | 確定 |
| 00 値なし、および日区間の期間外 | noValue | 無着色 | 「—」(`--md-sys-color-on-surface-variant`)を全セルに付ける | 確定 |
| 値なし(ref 欠落)・`valueCode` null・表外コード | missing | `--md-sys-color-surface-container-highest` 地に破線縁 `--md-sys-color-outline` | 「?」を全セルに付ける | 欠測を低危険度扱いしない(§2.1-2)。表現は【設計案】 |

- **切替セルの規則**(`assignTransitionLabels`): 行の列順に見て、表示区分が `level3`〜`level5` で、かつ直前の列と表示区分が異なるセルにだけ文字を付ける。
  - 区分の比較は表示区分で行う。50と51はどちらも level5 のため、続いていれば切替とみなさない。
  - 間に `missing`・`noValue`・`below` 等を挟んで同じ段階に戻った場合も、直前の列と異なるため再び文字を付ける。
  - **行頭**: 判定はデータの先頭列(列 index 0)から行い、初期スクロール位置とは無関係とする。先頭列が level3 以上なら先頭列に文字を付ける。
  - **初期列の補い**(§2.1-11): `initialColumnKey` の列(現在を含む列)のセルは、level3 以上なら切替でなくても文字を付ける。詳細の3時間表にも同じ規則を適用する。`now` が変わっても再計算はデータ更新時だけで、スクロールには追従しない。関数は `assignTransitionLabels(displays, initialIndex: number | null)` とする。
- 「—」「?」は段階ではないため、全該当セルに付ける(未満・値なし・欠測の区別を維持する。未満は文字なし・無着色、値なしは「—」、欠測は「?」と破線縁)。
- 段階色セルは container 地・on-container 文字・1px outline 縁とする(#54 と同じ構造)。
- 段階は `valueText`(電文の Name)・コードの大小・名称の部分一致では決めない。表のコードだけで決める。
- 各セルに `aria-label`(例「21-24時 警報級」)を付ける。文字が無いセルの段階も支援技術で分かるようにするため。

### 4.4 詳細ダイアログ【設計案・見た目は後日ユーザー監修】

- 入口: パネル本文の下に `GbButton`(text)「詳細」を置く。`DetailDialog` の `meta` は、title「警報等時系列」、target はパネル見出しと同じ対象名、time `{ kind: 'issued', value: metadata.issuedAt }`、`isTraining` は応答の値とする。`scrollContainer` は `useDetailDialogScrollContainer()` を使う。
- **(1) 3時間表**: `DetailTimeSeriesTable` を1つ使う。列と初期列はパネル本体と同じにする。
  - 行は危険度の全行(`allRows`、非表示行を含む)と、基準 block の量的予想行(`buildBaseQuantityRows`)を、`values` の出現順に並べる。
  - 量的予想行のキーは `(propertyType, valueType, areaDivision)` とする。行見出しは `valueType` に、区分名と単位(例「最大風速(陸上) m/s」)を付ける。
  - 危険度セルは §4.3 と同じ表示とし、切替セルの規則も同じにする。
- **(2) 別欄**: 基準 block 以外の block にある量的予想(24時間最大雨量・24時間最大降雪量・実効湿度・最小湿度等)を、block ごとに小さな表で並べる。列数が2〜3と少ないため `DetailTimeSeriesTable` は使わず、`warningTimeSeries/` 内の単純な `<table>`(行見出し `th scope="row"`)とする。
  - 列見出しは `formatIntervalHeader(timeFrom, timeTo)` で生成する。TimeDefine/Name は保存されていない。`timeFrom` は DateTime、`timeTo` は DateTime＋Duration に相当する。
    - JST で `timeFrom` が0時、かつ `timeTo − timeFrom` がちょうど24時間の場合: 「D日」(D は `timeFrom` の JST 日)。
    - それ以外(日界と一致しない区間): 「D日H時まで」(D・H は `timeTo` の JST 日・時)。`timeTo` が JST 0時なら前日の「24時まで」と書く(例 `timeFrom` 22日06時、`timeTo` 23日00時 → 「22日24時まで」)。
    - 区間が複数日にまたがる、または24時間を超える場合も、同じく「D日H時まで」とする。
  - 月は出さない(発表から数日の範囲のため)。
- 量的予想セル: `valueText` をそのまま表示する(数値へ変換しない。最大値・範囲へ縮退しない)。`condition === '値なし'` は「—」とする。その他の `condition`(例「風雪」)は値の後ろに小さく併記する。`description` はセルに表示しない(`aria-label` には使ってよい)。対応する値が無ければ「?」とする。
- **凡例**: 本文の先頭に、見本セルと名称を並べる。
  - レベル5/特別警報級「切迫」、レベル4「危険」、レベル3/警報級「警戒」、レベル2/注意報級(文字なし)
  - 未満(無着色・文字なし)、値なし「—」、欠測・未取得「?」
  - 注記「文字は段階が変わる時間帯にだけ表示」
  - パネル本体には凡例を置かない。
- `additions`(付加事項)は表示しない(§8)。

### 4.5 会場・訓練

- 要求の `terminalId`/`controlStatus` は `WeatherMapView` の既存値をそのまま使う。parse で `controlStatus` 不一致・`isTraining` 矛盾を null にし、訓練データを本番表示に混ぜない。パネル上の訓練表示は、G1〜G3 と同様に付けない。詳細ダイアログは `isTraining` を meta に渡す(表示は既存部品が担う)。

## 5. スタイル

- クラス名は `wts-` 接頭辞。`.info-panel-*`・`.detail-ts-*` を再定義しない(上書きは `.wts-*` 配下の子孫セレクタに限る)。
- HEX・`rgb()` を書かない。`--wx-notice-*` を使わない。
- セル内文字は1〜2字、`font-size` はパネル本文と同等。セルの角丸・余白は製造裁量。

## 6. 開発用フィクスチャ

`WarningTimeseriesResponse` を合成し、本番と同じ `buildWarningTimeSeriesCard` を通す(合成データである旨をコメントに書く)。`all-content` の警報等時系列も、この合成応答から組み立てる(仮入口の撤去)。

新規フィクスチャは次の2つとし、他パネルは `all-content` と同じにする。

- `warning-timeseries`: 通常表示
- `warning-timeseries-quiet`: 全行が未満・値なしで、表示行0件になる正常空

合成応答: `issuedAt` は当日 JST 05:00、列は当日 JST 06:00 起点とする。

| block | 列 | 行(出現順) | 値の例 |
|---|---|---|---|
| 1 (PT3H) | 14 | 大雨浸水、雨(１時間最大雨量 mm)、土砂災害、風危険度(陸上)、風危険度(東京湾)、風(風向・最大風速、陸上/東京湾)、雷、濃霧 | 大雨浸水: 11,21,21,31,31,41,51,50,31,…(切替セルの確認用)。土砂災害: 22,31,…。風(陸上): 01,20,30,30,50,…。雷: 00 と ref 欠落を1つずつ、表外コード `99` を1つ。濃霧: 全て01(非表示行)。風(東京湾): 01 と欠測だけ(欠測のみの非表示行) |
| 2 (PT24H) | 2 | 雨(２４時間最大雨量 mm)、雪(２４時間最大降雪量 cm) | 数値、`condition:'値なし'` を1つ |
| 3 (PT18H→PT24H→PT24H) | 3 | 乾燥危険度、乾燥(実効湿度 %・最小湿度 %)、霜危険度 | 乾燥: 20,01,20。霜: 全て00(非表示行)。先頭区間は当日06時〜24時 |

- 行の出現順は §5.7 の順と異なる並びにし、並べ替えられていないことを目視で分かるようにする。
- 単体テスト用には、日区間の境界が3時間列とずれる入力(例: 区間 当日07時〜翌日07時)を別途用意する(AC-4b)。

## 7. 変更を許可するファイル

- 新規: §3.1 の新規ファイル
- 変更: `apps/web/src/index.css`(`@import` 1行のみ)、`apps/web/src/map/WeatherMapView.tsx`(フック呼び出しと `infoPanelInput` の1項目のみ)、`apps/web/src/map/panels/panelFixtures.ts`(§6 の範囲のみ)、`apps/web/src/map/panels/detailDialogFixtures.tsx`(警報等時系列の仮入口・サンプルの削除のみ)
- 変更禁止: `apps/api/**`、`packages/**`、`apps/web/src/map/detail/**`、`apps/web/src/map/panels/` の他の既存ファイル、`apps/web/src/theme/**`、既存テスト(仮入口削除に伴い警報等時系列サンプル前提のテストが壊れる場合は、統括へ報告してから最小修正)、設定ファイル
- 注意: #61 の AC-7/AC-8 は警報等時系列サンプル(32列・長い本文)を寸法検証に使っていた。削除後、地域時系列予報サンプルだけで既存テストが通るかを製造時に確認し、通らなければ実装を止めて統括へ報告する。

## 8. 管理項目の結論

| ID | 本Issueでの結論 |
|---|---|
| AD-H048 | 時刻定義の参照関係を `(blockId, refId)`↔`(blockId, timeId)` で結合し、添字結合しない(AC-3)。日単位の危険度は区間の包含判定で3時間列へ統合する(AC-4)。固定現象リストを仮定せず、電文に含まれる危険度の種類だけを出現順で表示する(AC-2)。現在区間を初期位置とし全コマ保持(AC-9)。凡例は詳細のみ(AC-10)。基準範囲より先の日単位の危険度は表示しない(ユーザー決定)。詳細で単位・区分(`areaDivision`)・`condition` を保持して表示し、数値化・最大値化しない(AC-10)。パネルは注意報級以上を含む行のみ表示し、欠測は詳細で区別する(ユーザー決定、AC-7)。付加事項(`additions`)の表示は本Issueでは非対応で、G10/後続へ残す。L1 #83 の実データ受入(実寸・色の実測)は未了。保守事項を修正必須へ昇格させない。 |

## 9. 未決事項・実挙動未確認

- 【確定】行の表示条件・欠測行の扱い・初期列の文字補い・基準範囲より先の日単位の危険度の非表示は、ユーザー決定(§2.1-9〜12)。
- 【確認済み・防御】日区間と3時間列の境界がずれる場合の規則(§4.2 規則4)は、実電文(江東区)でずれが生じるかは未確認である。
- 【未確認】コード21「警戒レベル２」と22「警戒レベル２相当」の意味の差。どちらも level2 として同じ表示にする。
- 【未確認】実電文で 20/30/50/21/22/31/41/51 が出現した状態(サンプルは 00/01/11 のみ)。フィクスチャでだけ確認する。
- 【未確認】江東区・大田区の実電文での行構成・block 構成。
- 【設計案】欠測の表現、正常空・危険度0件の文言、パネルの列幅、詳細・別欄の見た目。後日ユーザー監修とする。
- 【未決・G9】stale の見せ方。
- 【未確認】現在列の追従。新しい応答が来るまで、初期位置は再計算しない。

## 10. 受け入れ条件

前提: dev サーバーの扱いは [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。単体テストは `apps/web/tests/warningTimeSeriesPanel.test.ts(x)` に置き、描画確認は `renderToStaticMarkup`(ダイアログは `DetailDialogInner`)で行う。`now` は固定値を注入する。

- [ ] AC-1 品質ゲート: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/web` がすべて成功する。
- [ ] AC-2 行順(単体): 危険度の種類を「雷→大雨浸水→風(陸上)→土砂災害→乾燥(日単位 block)」の順で含み、すべて level2 以上を持つ `values` を渡す。
  - `allRows` と `visibleRows` の行ラベルがこの順になる。
  - 同じ内容を別の出現順で渡すと、その順に従う。§5.7 順・五十音順に並べ替わらない。
  - パネル本体の表は1つで、量的予想行を含まない。
- [ ] AC-3 結合(単体):
  - `timeDefines` を `sequence` 逆順で並べ、`values` の refId をシャッフルした入力でも、基準 block の各セルが同じ timeId の値になる。
  - 別 block の同じ timeId が混ざらない。
  - ref が欠落したセルは `missing` になる。
  - `selectBaseBlockId` が §2.3 の構成で3時間刻みの block を返す。
- [ ] AC-4 日単位の統合(単体):
  - (a) 当日06-24時(PT18H)と翌日0-24時の区間は、それぞれ覆う各3時間列に同じ値が複製される。区間外の列は `noValue` になる。
  - (b) 区間 当日07時〜翌日07時(level3)・翌日07時〜(below)のとき、境界をまたぐ 06-09時列と翌日06-09時列が level3 になる(優先順位規則)。
  - (c) 境界列で missing と below が重なると missing になる。
- [ ] AC-5 コード表(単体):
  - `RISK_CODE_TABLE` が §4.3 の11コードを持ち、名称が別表4と完全一致し、表示区分が §4.3 と一致する。
  - `valueCode` null・`'99'`・undefined は `missing` になる。
  - `valueText` を変えても結果が変わらない。
- [ ] AC-6 切替文字(単体): `assignTransitionLabels` が次を満たす。
  - `initialIndex=null` で [below, level3, level3, level5(50), level5(51), level4, missing, level4, level2, level3] → [null, 警戒, null, 切迫, null, 危険, ?, 危険, null, 警戒]
  - 同じ配列で `initialIndex=2`(level3 の継続セル)のとき、index 2 も「警戒」になる。`initialIndex=8`(level2)のときは変化しない。
  - [level3×5] で `initialIndex=3` のとき [警戒, null, null, 警戒, null] になる。
  - 先頭が level3 の行では、先頭列が「警戒」になる。
  - level2 と below には文字が付かない。
  - noValue のセルは全て「—」になる。
- [ ] AC-7 行の表示条件(単体): §6 の合成応答で、濃霧(全て01)・風(東京湾)(01と欠測のみ)・霜(全て00)が `visibleRows` に無く、`allRows` と詳細の3時間表にはある。
- [ ] AC-8 状態(単体): `buildWarningTimeSeriesCard`/フック相当の組み立てで、次を確認する。
  - (a) `data:null` → `failed`、描画に「取得できませんでした」がある。
  - (b) `issuedAt:null` → `failed`。
  - (c) `warning-timeseries-quiet` 相当 → `data` 状態で発表時刻と「注意報級以上の予想はありません」があり、表と「取得できませんでした」が無い。
  - (d) 危険度0件 → `data` 状態で「危険度の情報がありません」がある。
  - (e) `availability:'stale'` → `status.availability === 'stale'`。
- [ ] AC-9 初期列(単体): 3時間刻み14列で、`now` を次のようにしたときに `resolveCurrentColumnKey` が返す列を確認する。列0件なら null。
  - 先頭より前 → 先頭列
  - 5列目の区間内 → 5列目
  - 5列目の `timeTo` ちょうど → 6列目
  - 末尾より後 → 末尾列
- [ ] AC-10 詳細(単体): §6 の合成応答で `DetailDialogInner` を描画し、次を確認する。
  - (a) 3時間表が1つあり、危険度全行と「１時間最大雨量」「mm」、「最大風速」「陸上」「m/s」の行見出しがある。
  - (b) 別欄に block2・block3 の表がある。「２４時間最大雨量」「実効湿度」「%」の行見出しがある。
  - (c) 別欄の列見出しが `formatIntervalHeader` の規則どおりになる(block3 先頭は「D日24時まで」、日界一致区間は「D日」)。
  - (d) `condition:'値なし'` が「—」で、`0` と表示されない。
  - (e) `valueText` が文字列のまま表示される。
  - (f) 凡例に「切迫」「危険」「警戒」、レベル2(文字なし)、未満・値なし・欠測の7区分がある。パネル本体の描画には凡例が無い。
- [ ] AC-11 見出し表記(単体): `formatIntervalHeader` を次の入力で確認する(JST 表記の ISO で与える)。
  - 22日00時〜23日00時 → 「22日」
  - 22日06時〜23日00時 → 「22日24時まで」
  - 22日00時〜22日12時 → 「22日12時まで」
  - 22日06時〜23日06時 → 「23日6時まで」
- [ ] AC-12 メタ・訓練(単体):
  - `parseWarningTimeseriesResponse` が正しい応答を受理する。`controlStatus` 不一致・`isTraining` 矛盾・`values` 非配列・`valueCategory` 不正の応答は null にする。
  - `issuedAt` を `2026-09-27T20:00:00Z` とし、`fetchedAt`・`evaluatedAt`・`kindDateTime` を別時刻にした応答で、見出しの時刻が issuedAt 由来の表示(`now` を 2026-09-28 JST にして `05:00発表`)だけになる。
  - `venueId='east'`/`'trc'` で、見出し2行目が `panelTargets.ts` の対象名になる。
- [ ] AC-13 画面(フィクスチャ): `npm run dev` 中に east 端末で `?panelFixture=warning-timeseries` を開き、次を確認する。
  - (a) 表が1つで、乾燥が3時間列に複製されている。濃霧・霜・風(東京湾)の行が無い。
  - (b) 表だけが横スクロールし、行見出しが固定されている。パネル列の `scrollWidth <= clientWidth`。
  - (c) 表の `scrollLeft` が、現在列を行見出しの直右に置く値になっている(先頭列・末尾列に該当する時刻帯ならその旨を記録する)。
  - (d) 左スクロールで先頭列まで戻れる。
  - (e) 段階色4種、切替セルと初期列のセルだけに「切迫」「危険」「警戒」、および「—」「?」が見える。
  - `?panelFixture=warning-timeseries-quiet` では「注意報級以上の予想はありません」と発表時刻が出る。
  - 1180×820 と 1280×720 で行見出し列幅・データ列幅・可視列数を実測して記録し、スクリーンショットを PR に添付する。見た目の合否は「ユーザー監修待ち」と記載する。
- [ ] AC-14 画面(詳細・実API):
  - 同フィクスチャで「詳細」を押すとダイアログが開く。3時間表・別欄・凡例・初期列位置を確認する。閉じるとパネル列のスクロール位置が戻る。
  - `?panelFixture` なしで開き、ネットワーク記録で次を記録する。`GET /api/weather/warning-timeseries?terminalId=<端末ID>&controlStatus=normal` が 200 で発行され、ポーリングで再発行されること。カード状態が §4.1 に一致すること。
  - 実データがあれば、行構成・block 構成・日区間境界と3時間列の揃い方を記録する。
- [ ] AC-15 仮入口撤去: `?panelFixture=all-content` の警報等時系列に「詳細（仮）」が無く、`detailDialogFixtures.tsx` に `WarningTimeSeriesDetailFixtureEntry` が無い。地域時系列予報の「詳細（仮）」は残っている。
- [ ] AC-16 静的検査:
  - 新規・変更ファイルを `#[0-9a-fA-F]{3,8}\b`・`rgb\(`・`--wx-notice-` で検索し、0件。
  - `warningTimeSeries/` 配下を `setTimeout|setInterval|localStorage` で検索し、0件。
  - `kindName` を行見出しに使っていない。
- [ ] AC-17 境界:
  - `git diff --stat main...HEAD` が §7 の範囲に限られ、`apps/api/`・`packages/`・`apps/web/src/map/detail/` に差分がない。
  - PR の対応表で、付加事項表示・履歴表示・stale 表示の確定を「非対応/範囲外」と記載する。
- [ ] AC-18 管理項目・基本設計:
  - 本設計書 §8 に AD-H048 の結論があり、PR 本文に転記されている。
  - PR 本文に「基本設計 §5.8 は §2.2 の文案で統括担当が改訂する」旨を記載する。

## 11. 後続Issueへの引き継ぎ

- 統括: 基本設計 §5.8 と Issue #55 本文の改訂(§2.2)。
- G9 #60: stale の表示、取得状態の常時表示。
- G10/後続: `additions`(付加事項)の表示。
- L1 #83: 実データでの実寸・色・初期列の受入、江東区・大田区実電文での行構成確認。
- エポック終了時のユーザー監修: 切替文字の見え方・欠測表現・列幅・詳細の見た目(AC-13 のスクショを材料とする)。
