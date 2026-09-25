# Issue #53 G2. 気象防災速報パネル

作成日: 2026-09-25
作成: 設計担当（Claude Opus 5.5）
状態: 【設計案】ユーザー承認待ち。2026-09-25 の追加回答（§2.1 Q6〜Q8）を反映済みで、統括への未決の確認事項は無い（§10）。

## 1. 目的と範囲

G1（#52）の共通枠に、気象防災速報（VPBS50 の3種＝線状降水帯発生・線状降水帯直前予測・記録的短時間大雨、VPHW50/51＝竜巻注意情報・竜巻目撃情報）の中身と実データ結線を実装する。データは E6（#38）の `GET /api/weather/bulletins` を使う。

範囲内:

- `GET /api/weather/bulletins` の定期取得と、応答から速報カード入力（`InfoPanelCardInput[]`）への変換
- 種別別の表示期限（VPBS50 は発表後3時間、VPHW50/51 は電文の `ValidDateTime`）と、時間経過による自動の非表示
- 取消電文の対象カードを黙って非表示にする
- カードの中身: 対象区域、経過時間、「目撃情報あり」（`hasSighting === true` のときだけ）、速報文全文
- 開発用フィクスチャ `?panelFixture=bosai-bulletins`

範囲外（やらないこと）:

- 短時間大雪・VPBS51（Issue本文のとおり対象外）
- 詳細ボタン・詳細ダイアログ（確定事項4）
- 発表官署の表示・保存・API追加（確定事項3）
- VPHW50/51 の統合・重複排除（確定事項1）
- 目撃区域の特定（確定事項2）
- 速報の通常通知生成器（AD-H007、§8）
- API・DB・parser・`packages/shared` の変更（読み取りのみ）
- パネル自体の新着強調（Issue本文。ナビレールのバッジ G11 が担う）
- 訓練・試験の画面上の区別表示（G1 と同じく本Issueでは付けない。§4.6）

## 2. 参照資料と設計判断の根拠

- Issue #53 本文と「Issue #139 の棚卸し反映」
- [基本設計](../basic-design.md) §5.1【確定】、§5.2【確定】、§5.5（表示期間3時間のみ【確定】。「最近の速報」扱い等の後半は【設計案】のため確定扱いしない）、§5.6【確定】、§5.12
- [E6 設計書](issue-36-timeseries-amedas-bosai-rest-apis.md) §3.6（`BulletinDto`・`capabilities`）、§4.3（一覧の availability は `available`/`stale` のみ）
- [C7 設計書](issue-17-bosai-bulletin.md) §3.5〜§3.7・§8（取消は同一 EventID の行を上書き、`headline_text` は取消で NULL になり得る、`valid_to` は使わない）
- [C8 設計書](issue-18-tornado-bulletin.md) §3.3・§3.4・§3.8・§8（合成キー `VPHW5x:<発表細分区域コード>`、`hasSighting` の3値、VPHW の期限は `valid_at`、取消で発表細分が欠けると別行 `VPHW5x:cancel:<controlDateTime>`）
- [G1 設計書](issue-52-info-panel-layout.md)（1件＝1カード、見出しは `Report/Head/Title`＋発表時刻、固定対象名なし、occasional の状態表、stale は装飾なしで前回値）
- [G10 設計書](issue-61-detail-dialog.md)（詳細ダイアログ。本Issueでは使わない）
- [監査記録](../audit-epic-a-d.md) AD-H007・AD-H046・AD-H047
- [06-ui-md3-protocol.md](../rules/06-ui-md3-protocol.md)、[07-wx-data-protocol.md](../rules/07-wx-data-protocol.md)
- 既存コード: `apps/web/src/map/panels/*`、`apps/web/src/map/WeatherMapView.tsx`（`InfoPanelColumn` に `input` を渡していない。`controlStatus` の既定は `'normal'`）、`apps/web/src/map/tiles/useTileCatalogPolling.ts`（60秒間隔・不可視時停止・バックオフ・`loading/ready/stale/failed` の4状態）、`apps/web/src/api/tileCatalogClient.ts`（`fetchTileCatalog`: `path`・`parse` を受ける汎用 GET）、`packages/shared/src/weatherApi.ts`（`BulletinsResponse`・`BulletinDto`）、`apps/api/src/repositories/bosaiBulletinRepository.ts`（`ON CONFLICT (event_id, control_status) DO UPDATE`。取消は元の行を `is_cancelled=1` で上書き）

### 2.1 ヒアリング確定事項（2026-09-25）

| # | 確定事項 | 反映 |
|---|---|---|
| Q1 | VPHW50 と VPHW51 が同じ区域・同じ時刻で重複しても統合せず、両方をカードとして表示する | §4.1。重複排除処理を書かない。AC-3 |
| Q2 | `hasSighting === true` のときだけ「目撃情報あり」を補助表示する。区域は電文の対象区域をそのまま表示し、目撃区域は特定しない（本文に書かれているため）。DB は変更しない | §4.3・§4.4。AC-5 |
| Q3 | 発表官署は今回表示しない。保存・API 追加もしない。受け入れ条件「発表官署が補助表示として区別される」は非対応として明記し後続へ申し送る（AD-H046 の結論） | §8・§9。AC-11 |
| Q4 | 詳細ボタンは設けない | §4.4。AC-5 |
| Q5 | 取消電文は取消対象のカードを何も告知せずに消す。取消を示す表示・取消カードは出さない | §4.2。AC-2 |
| Q6 | （追加回答）竜巻カードの対象区域は発表単位の区域（`竜巻注意情報（発表細分）`、例「東京地方」）のみを表示する | §4.3。AC-6・AC-9 |
| Q7 | （追加回答）期限の判定は電文種別（API の `telegramType`: VPBS50 / VPHW50 / VPHW51）で行う。竜巻は竜巻注意情報という別の電文種別で配信されるため「種別を判別できない」前提は置かない。`source` URL・`information_tag`・`eventId` 等から画面側で種別を推定しない | §4.2・§3.2・§2.2。AC-2・AC-8 |
| Q8 | （追加回答）訂正は内容だけ差し替え、「訂正」の表示は付けない | §4.2。AC-2 |

### 2.2 実物確認の結果

- VPBS50 サンプル（リポジトリ外の気象庁サンプル集 `82_01_01`・`82_03_01` 等）: `Head/Title` は「千葉県気象防災速報（線状降水帯発生）」「福岡県気象防災速報（線状降水帯直前予測）」の形。`Headline/Text` に速報文が1段落で収まる。区域は Headline の情報タグ区域（「北西部」等）と Body 区域が同名で重複して現れる。VPBS50 の区域は parser が `informationType: null` で保存する（`jmaVpbs50Parser.ts`）。
- VPHW サンプル（`19_01_01` 等）: 区域は `Information@type` ごとに保存され（`jmaVphwParser.ts` が `informationType` に原文を入れる）、東京都の電文では発表細分 `東京地方` の1件に対し、市町村等が53件、まとめた地域が5件ある。全件を並べると1カードの区域行が60件近くになる（§4.3、§10 Q-A）。
- `telegramType` が3値以外（`null`）になり得るかのコード確認（Q7）: 取得側 `jmaXmlPoller.ts` は受信 URL から `extractTelegramTypeFromUrl` で電文種別を取り、`VPBS50` なら `processVpbs50Reception`、`VPHW50`/`VPHW51` なら `processVphwReception` へ振り分ける。両 processor は `metadata.source` に同じ `reception.documentUrl` を保存する（`jmaVpbs50Processor.ts`・`jmaVphwProcessor.ts`）。API（`weatherApiService.ts` の bulletins 変換）はこの `source` から同じ関数で種別を取り、解決できなければ `eventId` の `VPHW50:`/`VPHW51:` 接頭辞で補う。したがって**現行の保存経路で作られた行では `telegramType` は必ず3値のいずれかになり、`null` は返らない**（静的確認。DTO の型としては `null` が残っている）。このため Q7 の扱いについて統括への確認事項は残さない。型上の `null` 等、3値以外の行が来た場合は**その行だけを除外し、同じ応答の他の行は表示する。画面に異常表示は出さない**（2026-09-25 ユーザー判断。§3.2・§4.2）。
- 速報文全文は `BulletinDto.headlineText`（`Head/Headline/Text`）である。本文の別欄は API に存在しない。§5.6「Body に自由文がなくても情報欠落と判断しない」に従い、`headlineText` を全文として扱う。

## 3. 構成

### 3.1 モジュール構成

ファイル名・内部の関数分割は製造裁量で変更してよい。ただし §7 の変更許可一覧の外に出ないこと。

| ファイル | 種別 | 役割 |
|---|---|---|
| `apps/web/src/api/bosaiBulletins.ts` | 新規 | `fetchTileCatalog` を `path: '/api/weather/bulletins'` で呼び、応答を `parseBulletinsResponse` で検証する |
| `apps/web/src/map/panels/bosai/bosaiBulletinCards.ts` | 新規 | 純粋関数群（表示期限・表示可否・区域名・経過時間・カード入力の組み立て）。React に依存しない |
| `apps/web/src/map/panels/bosai/useBosaiBulletins.ts` | 新規 | `useTileCatalogPolling` によるポーリングと、1分ごとの現在時刻更新。`InfoPanelCardInput[]` を返す |
| `apps/web/src/map/panels/bosai/BosaiBulletinContent.tsx` | 新規 | カードの中身（区域・経過時間・目撃情報あり・全文） |
| `apps/web/src/map/panels/bosai/bosaiBulletin.css` | 新規 | 中身のスタイル。`BosaiBulletinContent.tsx` から `import './bosaiBulletin.css'` は `apps/web/src/index.css` の `@import './map/panels/bosai/bosaiBulletin.css';` で読み込む（2026-09-25 ユーザー承認による改訂: Node 実行のテストが `.css` の import を解決できないため、既存の流儀に揃えて `index.css` に `@import` を1行追加する方式へ変更した） |
| `apps/web/src/map/WeatherMapView.tsx` | 変更 | `useBosaiBulletins` を呼び、`InfoPanelColumn` へ `input={{ ...DEFAULT_INFO_PANEL_INPUT, bosaiBulletin: cards }}` を渡す（1箇所） |
| `apps/web/src/map/panels/panelFixtures.ts` | 変更 | フィクスチャ `bosai-bulletins` を追加（§6）。既存フィクスチャは変更しない |
| `apps/web/tests/bosaiBulletinPanel.test.ts` | 新規 | 単体テスト |

`InfoPanelColumn.tsx`・`InfoPanelFrame.tsx`・`panelDefinitions.ts`・`panelDisplayState.ts`・`panelSort.ts`・`panelTime.ts`・`panels.css` は**変更しない**。`index.css` は上記 `@import` 1行の追加のみ許可する（#54 警報パネルと並行設計のため共有ファイルへの変更を最小にする）。

### 3.2 型・シグネチャ

```ts
// apps/web/src/api/bosaiBulletins.ts
import type { BulletinsResponse, WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { TileCatalogResult } from './tileCatalogClient';

/** 応答の最低限の実行時検証。不正なら null。controlStatus が要求値と違う場合も null。 */
export function parseBulletinsResponse(
  body: unknown,
  requested: WeatherControlStatus,
): BulletinsResponse | null;

export function fetchBosaiBulletins(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<BulletinsResponse>>;
```

`parseBulletinsResponse` が検証する項目: ルートがオブジェクト、`controlStatus === requested`、`isTraining === (requested === 'training')`、`availability` が `'available' | 'stale' | 'unavailable'` のいずれか、`bulletins` が配列、各要素の `eventId`・`title`・`reportDateTime` が非空文字列、`isCancelled` が boolean、`telegramType` が文字列または null（値の範囲は検証しない。3値以外の行は応答を拒否せず、§4.2 で**その行だけ**表示対象から除く。画面側で種別を推定・補完しない）、`hasSighting` が boolean または null、`headlineText` が文字列または null、`areas` が配列（各要素の `areaName` が文字列、`informationType` が文字列または null、`sequence` が数値）、`metadata` がオブジェクトで `validAt` が文字列または null。これ以外の項目は検証しない（使わないため）。

```ts
// apps/web/src/map/panels/bosai/bosaiBulletinCards.ts
import type { Availability, BulletinDto } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';

export const VPBS50_DISPLAY_DURATION_MS = 3 * 60 * 60 * 1000;

/** 表示終了時刻（epoch ms、この時刻ちょうどで非表示）。判定できない場合 null。 */
export function resolveBulletinDisplayEnd(bulletin: BulletinDto): number | null;

/** 表示対象か。取消・期限切れ・期限判定不能は false。 */
export function isBulletinDisplayed(bulletin: BulletinDto, nowMs: number): boolean;

/** カードに出す区域名（表示順、重複なし）。§4.3 */
export function resolveBulletinAreaNames(bulletin: BulletinDto): readonly string[];

/** 経過時間の文言。§4.4 */
export function formatBulletinElapsed(reportDateTime: string, nowMs: number): string;

/** 応答1件からカード入力列を作る。表示対象外を除き、並びは応答順を保つ（並べ替えは InfoPanelColumn が行う）。 */
export function buildBosaiBulletinCards(params: {
  readonly bulletins: readonly BulletinDto[];
  readonly availability: Extract<Availability, 'available' | 'stale'>;
  readonly nowMs: number;
}): readonly InfoPanelCardInput[];
```

```ts
// apps/web/src/map/panels/bosai/useBosaiBulletins.ts
export function useBosaiBulletins(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
}): readonly InfoPanelCardInput[];
```

カード入力の組み立て規則（`buildBosaiBulletinCards`）:

- `key`: `bulletin.eventId`（同一 `controlStatus` 内で一意。VPHW50/51 は接頭辞で区別される）
- `heading`: `bulletin.title`（`Report/Head/Title` をそのまま。加工しない）
- `status`: `{ kind: 'data', availability, time: bulletin.reportDateTime, timeKind: 'issued' }`
- `content`: `<BosaiBulletinContent bulletin={bulletin} nowMs={nowMs} />`
- `eventId` を画面に表示しない（C8 §8: 合成キーを気象庁 EventID として見せない）

## 4. 振る舞い

### 4.1 並び順と重複

- カードの並びは G1 の `InfoPanelColumn`（`sortCardsByTimeDescending`）に任せ、`reportDateTime` の新しい順とする。同時刻は安定ソートにより入力順＝ API 順（`report_datetime DESC, id DESC`）が保たれる。本Issueで並べ替えを追加しない。
- VPHW50 と VPHW51 が同じ区域・同じ時刻で並存しても、両方をカードにする（Q1）。統合・重複排除・どちらかの優先を実装しない。

### 4.2 表示期限・取消

`resolveBulletinDisplayEnd`（判定は `telegramType` のみで分岐する。Q7）:

| `telegramType` | 表示終了時刻 | 根拠 |
|---|---|---|
| `VPBS50` | `Date.parse(reportDateTime) + 3時間` | §5.5【確定】。`metadata.validAt`（VPBS50 では `TargetDateTime`）・`validTo`・`fetchedAt` は使わない |
| `VPHW50` / `VPHW51` | `Date.parse(metadata.validAt)`。`validAt` が null または解析不能なら `null` | C8 §8（VPHW の有効期限は `valid_at`）。3時間ルールを適用しない（§5.12） |
| 上記3値以外（`null`・`VPBS51` 等） | `null`（その行だけ非表示。同じ応答の他の行は通常どおり表示し、異常表示・ログ表示・通知を出さない） | 2026-09-25 ユーザー判断。§2.2 のとおり現行コードでは起こらない |

`isBulletinDisplayed(b, now)` は次のすべてを満たすとき true。

1. `b.isCancelled === false`
2. `resolveBulletinDisplayEnd(b)` が null でない
3. `now < 表示終了時刻`（終了時刻ちょうどで非表示）

取消（Q5）:

- 取消電文は同じ `eventId` の元の行を上書きする（C7 §3.6、C8 §3.8）。したがって `isCancelled === true` の行を除外するだけで取消対象のカードが消える。取消カード・取消の文言・通知は出さない。
- `infoType` が `訂正` の行は通常どおり表示する。訂正を示す表示は付けない（Q8。§5.5「再取得・訂正の受信時刻だけで表示期間を延長しない」は `reportDateTime` 基準の判定で満たされる）。
- 期限経過・取消による非表示で通知・解除通知を生成しない（§5.5）。

時間経過による再評価:

- `useBosaiBulletins` は `nowMs` を state に持ち、60秒ごとに更新する（経過時間の分単位表示と表示期限の反映のため）。ポーリング間隔も既存の `TILE_CATALOG_POLL_INTERVAL_MS`（60秒）を使う。したがって期限到達から非表示までの遅れは最大60秒である【設計案・製造裁量で短縮可。延長不可】。
- ポーリングは `useTileCatalogPolling` をそのまま使う（不可視タブで停止・バックオフ・中断を継承）。`resetKey` は `${terminalId}:${controlStatus}`。

### 4.3 対象区域の表示

`resolveBulletinAreaNames`（Q6 で確定）:

- VPBS50（`informationType` が全件 null）: `areas` を `sequence` 昇順に並べ、`areaName` の重複を除いた全件。
- VPHW50/51: `informationType === '竜巻注意情報（発表細分）'` の区域だけを `sequence` 昇順・`areaName` 重複除去で出す（東京都の電文では「東京地方」）。まとめた地域・市町村等・目撃情報ありの区域は出さない。発表細分が0件の場合は空配列を返し、区域行を描画しない（C8 は発表・訂正電文で発表細分がちょうど1件であることを受理条件にしており、0件は表示されない取消行でのみ起こる。他の区域で補わない）。
- 区域名は電文の `areaName` をそのまま表示し、会場の市区町村名へ書き換えない（§5.1【確定】）。`isDirect`・`matchedAreaCodes` は表示に使わない。
- 目撃区域の特定をしない（Q2）。「付近」等の精度は `Area/Status` が保存されていないため区域行では表さず、全文（`headlineText`）に書かれた記述で読む。
- 区切りは読点「、」。長い場合は折り返す（省略・「ほか◯件」への短縮をしない）。

### 4.4 カードの中身

上から次の順に並べる。ラベル（「対象区域:」「本文:」等）は付けない（06 必須制約2）。

1. 対象区域（§4.3）
2. 経過時間＋（`hasSighting === true` のときだけ）「目撃情報あり」
3. 速報文全文（`headlineText`。改行・全角空白を保持するため `white-space: pre-wrap`。要約・分割・省略・行数制限をしない）

見出し1行目は `title`、2行目は G1 の共通枠が出す発表時刻（`14:05発表`／前日以前は `9/23 14:05発表`）。固定対象名は出さない（G1）。

経過時間 `formatBulletinElapsed` 【設計案】:

| 経過（`now - reportDateTime`、分は切り捨て） | 表示 |
|---|---|
| 0分未満（時計ずれ） | `0分経過` |
| 60分未満 | `N分経過`（例 `35分経過`） |
| 60分以上・端数あり | `H時間M分経過`（例 `1時間5分経過`） |
| 60分以上・端数なし | `H時間経過` |

「目撃情報あり」:

- `hasSighting === true` のときだけ表示。`false` と `null` はどちらも何も出さず、両者を画面で区別しない（C8 §8）。本文・見出しの文字列から目撃を推測しない。
- 見た目は小さなラベル（`font-size: 12px`、`border: 1px solid var(--md-sys-color-outline)`、`color: var(--md-sys-color-on-surface)`、角丸）。エラー色・警戒レベル色は使わない（補助表示のため）。

`headlineText === null`（取消以外では C7/C8 の検証上起こらない）の場合は全文の要素を描画しない。空文字列の代用文言を出さない。

詳細ボタンは置かない（Q4）。

### 4.5 取得状態（G1 の occasional 規則に従う）

`useBosaiBulletins` の返り値:

| ポーリング状態 | 返すカード |
|---|---|
| `loading` | `[]`（非表示） |
| `failed`（保持値なし） | `[]`（非表示。取得異常の告知は通知領域の責務、G1 §5） |
| `ready` | `buildBosaiBulletinCards({ bulletins, availability: toCardAvailability(response.availability), nowMs })` |
| `stale`（取得失敗・保持値あり） | 保持している前回応答から `availability: 'stale'` で組み立てる。期限・取消の判定は前回応答に対して `nowMs` で行い続ける |

`toCardAvailability`: 応答の `'available'` → `'available'`、`'stale'` → `'stale'`、`'unavailable'`（E6 §4.3 により返らない想定）→ `'stale'`。3状態を boolean に縮退させず、カード入力の型（`available | stale`）に写すだけとする。G1 の方針により stale の装飾は付けない。

表示対象が0件（発表なし・全件期限切れ・全件取消）は `[]` を返し、「発表なし」等の表示を置かない（G1 H6）。

### 4.6 訓練・試験（isTraining）

- 要求の `controlStatus` は `WeatherMapView` の既存 prop（既定 `'normal'`）をそのまま使う。
- `parseBulletinsResponse` は応答の `controlStatus` が要求値と異なる、または `isTraining !== (controlStatus === 'training')` の場合に null（取得失敗扱い）とし、訓練データを本番の表示に混在させない。
- 画面上の訓練表示はG1同様に本Issueでは付けない。`controlStatus` を切り替える画面経路は現状存在しない（`App.tsx` は `controlStatus` を渡していない）。

## 5. スタイル

- 色は `--md-sys-color-*` のみ。HEX・RGB を書かない。
- 区域: `font-size: 13px; color: var(--md-sys-color-on-surface)`。経過時間: `font-size: 12px; color: var(--md-sys-color-on-surface-variant)`。全文: `font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere`。
- 要素間は `gap: 6px` 程度（製造裁量）。カード自体の枠・余白は G1 の `.info-panel-card` に任せ、上書きしない。
- クラス名は `bosai-bulletin-` 接頭辞とし、G1 のクラスを再定義しない。

## 6. 開発用フィクスチャ

`panelFixtures.ts` に `bosai-bulletins` を追加する。`BulletinDto` の配列（下表、時刻は `todayAt` 系で当日の JST を生成、`nowMs` はフィクスチャ生成時点）を `buildBosaiBulletinCards` に通してカードを作る（本番と同じ経路で中身を描く）。他の5パネルは `all-content` と同じダミーとする。

| # | telegramType | title | 設定 | 期待 |
|---|---|---|---|---|
| F1 | VPBS50 | 東京都気象防災速報（記録的短時間大雨） | 発表=現在−40分、区域 `東京地方`/`２３区東部`/`江東区`（重複1件含む）、全文2文 | 表示。`40分経過` |
| F2 | VPHW51 | 東京都気象防災速報（竜巻目撃） | 発表=現在−10分、validAt=現在+50分、hasSighting=true、発表細分 `東京地方`＋市町村等3件 | 表示。区域は `東京地方` のみ。「目撃情報あり」あり |
| F3 | VPHW50 | 東京都気象防災速報（竜巻注意） | F2 と同じ発表時刻・区域・validAt、hasSighting=null | 表示（F2 と統合しない）。「目撃情報あり」なし |
| F4 | VPBS50 | 東京都気象防災速報（線状降水帯発生） | 発表=現在−3時間1分 | 非表示（期限切れ） |
| F5 | VPHW50 | 東京都気象防災速報（竜巻注意） | 発表=現在−20分、validAt=現在−1分 | 非表示（電文期限切れ） |
| F6 | VPBS50 | 東京都気象防災速報（線状降水帯直前予測） | 発表=現在−5分、isCancelled=true、infoType=取消、headlineText=null | 非表示（取消。告知なし） |

フィクスチャのタイトル・全文は合成であり、実電文ではない旨をコメントに書く。F1〜F3 は同一日の時刻で作るため、日付をまたぐ直前（00:00〜00:50 JST）に開くと並びや日付表記が変わり得る点もコメントに残す。

## 7. 変更を許可するファイル

製造（agy-delegate）はこの一覧の外を変更しない。検収は `git diff --stat main...HEAD` で確認する。

- 新規: `apps/web/src/api/bosaiBulletins.ts`、`apps/web/src/map/panels/bosai/bosaiBulletinCards.ts`、`apps/web/src/map/panels/bosai/useBosaiBulletins.ts`、`apps/web/src/map/panels/bosai/BosaiBulletinContent.tsx`、`apps/web/src/map/panels/bosai/bosaiBulletin.css`、`apps/web/tests/bosaiBulletinPanel.test.ts`
- 変更: `apps/web/src/index.css`（`bosaiBulletin.css` の `@import` 1行追加のみ）、`apps/web/src/map/WeatherMapView.tsx`（`useBosaiBulletins` の呼び出しと `InfoPanelColumn` への `input` の受け渡しのみ）、`apps/web/src/map/panels/panelFixtures.ts`（`bosai-bulletins` の追加のみ）

変更禁止（例示）: `apps/api/**`、`packages/**`、`apps/web/src/map/panels/` の上記以外、`apps/web/src/index.css` の上記1行以外、`apps/web/src/map/map.css`、`apps/web/package.json`、ルートの設定ファイル、`polling.yaml` 等の設定、既存テスト。テストのために本番コード・共通設定を書き換えることも禁止する。

## 8. 管理項目の結論

| ID | 本Issueでの結論 |
|---|---|
| AD-H007（速報の通常通知生成器） | **本Issueの範囲外。** G2 はパネル表示のみを扱い、速報の通常通知生成・起動時再提示を実装しない。対応先は D10 #145・E9 #41・L3 #85 のまま。採否待ちの保守事項であり、本Issueで修正必須へ昇格させない。 |
| AD-H046（XML 明細の未抽出項目） | 速報について: **発表官署（`EditorialOffice`/`PublishingOffice`）は表示しない。保存・API 追加もしない**（Q3、2026-09-25）。Issue の受け入れ条件「発表官署が補助表示として区別される」は**非対応**とし、実装済みとして扱わない（§9）。`Area/Status`・`Serial` も未抽出のまま。表示が必要になった場合は C7/C8 の列追加 migration と E6 の DTO 拡張を含む別Issueとする。 |
| AD-H047（速報の期限・重複・区域表現） | 期限: VPBS50 は `reportDateTime`＋3時間、VPHW50/51 は `metadata.validAt` で区別（§4.2）。重複: VPHW50/51 は統合せず両方表示（Q1）。取消: 対象カードを告知なしで消す（Q5）。区域・目撃: 電文の区域名をそのまま表示し、`hasSighting === true` のときだけ「目撃情報あり」を出す。目撃区域は特定しない（Q2）。「付近」は全文でのみ表される。竜巻の区域は発表単位のみ（Q6）。期限の判定は `telegramType` で行う（Q7）。訂正は表示を付けない（Q8）。後続へ残るもの: 発表細分を欠く VPHW 取消電文の扱い（§11）。 |

## 9. 受け入れ条件

前提: dev サーバーの起動・停止は [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。単体テストは `apps/web/tests/bosaiBulletinPanel.test.ts` に置き、`now` は固定値を注入する（実時刻に依存させない）。

- [ ] AC-1 品質ゲート: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/web` がすべて成功する。
- [ ] AC-2 期限・取消（単体）: `isBulletinDisplayed` について次の全ケースをテストする。`now` を `2026-09-25T05:00:00Z` に固定する。
  - VPBS50、発表 `02:00:00Z`＋1ms → true、発表ちょうど `02:00:00Z`（now＝終了時刻）→ false、発表 `02:30Z` で `metadata.validAt` に過去時刻を入れても true（validAt を見ないこと）
  - VPHW50、`validAt=05:00:01Z` → true、`validAt=05:00:00Z` → false、発表が4時間前でも `validAt` が未来なら true（3時間ルールを当てないこと）
  - VPHW51、`validAt=null` → false
  - `isCancelled=true`（期限内の VPBS50・VPHW51 それぞれ）→ false
  - `infoType='訂正'`・期限内 → true
  - 変異確認: `now < 終了` を `now <= 終了` に変えると失敗するテストがあることを一時的に書き換えて確認し、元に戻す。
- [ ] AC-3 重複非統合（単体）: 同一 `reportDateTime`・同一区域の VPHW50（`eventId='VPHW50:130010'`）と VPHW51（`'VPHW51:130010'`）を `buildBosaiBulletinCards` に渡すと2件のカードが返り、`key` がそれぞれの `eventId` である。
- [ ] AC-4 並び順（単体）: 発表時刻が異なる3件（VPBS50 13:40、VPHW51 14:05、VPBS50 14:30 JST）を古い順・新しい順・混在順の3通りの入力で `InfoPanelColumn`（`input.bosaiBulletin` に `buildBosaiBulletinCards` の結果）へ渡し、`renderToStaticMarkup` の出力で見出しの出現順が常に 14:30→14:05→13:40 になる。
- [ ] AC-5 中身（単体・`renderToStaticMarkup`）:
  - `hasSighting=true` で「目撃情報あり」が1回出る。`false` と `null` で出ない。
  - `headlineText` に2行（`\n` 区切り）の文字列を入れると、その全文が省略なくマークアップに含まれる。
  - 詳細ボタン（`button` 要素・「詳細」の文字列）が中身に存在しない。
  - `eventId` の文字列がマークアップに含まれない。
  - 「発表官署」「気象庁」等の官署表示がない（`title` 以外に官署名を出さない）。
  - 「取消」の文字列がどのカードにも出ない（取消行はカード自体が作られない）。
- [ ] AC-6 区域（単体）: VPBS50 で `areas` に同名重複（`北西部` ×2）があると1回だけ、`sequence` 順で返る。VPHW で発表細分 `東京地方` と市町村等 `江東区`・`大田区` がある場合、`['東京地方']` だけを返す。VPHW で発表細分が0件なら空配列を返し、中身に区域行が描画されない（`renderToStaticMarkup` で確認）。
- [ ] AC-7 経過時間（単体）: `formatBulletinElapsed` が 0分→`0分経過`、35分59秒→`35分経過`、60分→`1時間経過`、65分→`1時間5分経過`、発表が now より1分未来→`0分経過` を返す。
- [ ] AC-8 取得状態（単体）: `parseBulletinsResponse` が、正しい応答を受理し、`controlStatus` が要求値と異なる応答・`isTraining` が矛盾する応答・`bulletins` が配列でない応答・`hasSighting` が文字列の要素を含む応答・を null にする。`telegramType` が `null` の行と `'VPBS51'` の行を、期限内の正常な VPBS50・VPHW51 の行と混ぜた応答は `parseBulletinsResponse` が受理し（null にならない）、`buildBosaiBulletinCards` の結果は正常な2行のカードだけ（`key` が正常行の `eventId`）になり、`renderToStaticMarkup` した `InfoPanelColumn` の出力に除外行のタイトルが含まれず、正常行のタイトルが含まれ、「取得できませんでした」等の異常文言が含まれない。`toCardAvailability` が `available→available`、`stale→stale`、`unavailable→stale` を返す（3状態を別々のケースでテストする）。
- [ ] AC-9 画面（フィクスチャ）: `npm run dev` の起動中に east 端末の気象画面を `?panelFixture=bosai-bulletins` で開く。右側列の最上部に速報カードが F2/F3（同時刻、順序は問わない）→F1 の順に3枚だけあり、F4・F5・F6 のタイトルは DOM に存在しない。F2 にだけ「目撃情報あり」がある。F2・F3 の区域行は「東京地方」だけ、F1 は「東京地方、２３区東部、江東区」。F1 の経過時間が `40分経過`（開いた時点から1分以内）。各カードに詳細ボタンがない。カードの見出し2行目は `HH:mm発表` で、固定対象名が出ない。その下に警報・注意報以降のパネルが §5.2 順で続く。
- [ ] AC-10 画面（実 API 結線）: `?panelFixture` なしで気象画面を開き、ブラウザのネットワーク記録で `GET /api/weather/bulletins?terminalId=<端末ID>&controlStatus=normal` が発行され 200 が返ること、約60秒後に再発行されることを確認する。応答の `bulletins` に表示対象が無い場合は速報カードが0枚で、「発表なし」等の文言がなく、最上部が警報・注意報以降のパネルになる（DB に実速報がある場合はその件数・タイトルと表示の一致を記録する）。
- [ ] AC-11 非対応の明記: 本設計書 §8 の AD-H046 に「発表官署の補助表示は非対応」が記録されており、PR 本文の受け入れ条件対応表で Issue の「発表官署が補助表示として区別される」を**非対応（後続へ申し送り）**と記載する（未対応を実装済みと扱わない）。
- [ ] AC-12 色: 新規の `.tsx`・`.css`・`.ts` を `#[0-9a-fA-F]{3,8}\b` と `rgb\(` で検索し0件。
- [ ] AC-13 変更範囲: `git diff --stat main...HEAD` の変更が §7 の許可一覧に限られる。`InfoPanelColumn.tsx`・`panels.css`・`apps/api/`・`packages/` に差分がない。`index.css` の差分は `bosaiBulletin.css` の `@import` 1行の追加だけである。

## 10. 統括への確認事項

**なし。** 初版の確認事項は 2026-09-25 のユーザー回答ですべて解消した。

| 初版の論点 | 回答 | 反映 |
|---|---|---|
| Q-A 竜巻カードの区域の出し方 | 発表単位の区域のみ（案1） | §2.1 Q6、§4.3、AC-6 |
| Q-B 種別を判定できない行 | 判定は電文種別 `telegramType` で行う。判別不能の前提は置かない。コード確認の結果、現行経路では3値以外は返らない（§2.2） | §2.1 Q7、§3.2、§4.2、AC-2・AC-8 |
| Q-C 訂正の表示 | 付けない（提案どおり） | §2.1 Q8、§4.2 |

製造担当は、本設計に書かれていない業務判断が必要になった場合、自分で決めずに統括担当へ戻すこと。

## 11. 後続Issueへの引き継ぎ・残留リスク

- **発表官署**（AD-H046、Q3）: 非対応。表示するには C7/C8 の列追加 migration、E6 の DTO 追加（`capabilities.unsupportedFields` からの除去）、G2 の補助表示の3点が必要。
- **速報の通常通知**（AD-H007）: #145・#41・#85 で扱う。G2 の表示期限（3時間・電文期限）を通知の期限に流用する場合は、その Issue で改めて判断する。
- **発表細分を欠く VPHW 取消電文**（C8 §3.3）: 取消が `VPHW5x:cancel:<controlDateTime>` の別行として保存されると、元の行は `isCancelled=false` のまま残り、電文期限まで表示され続ける。取消行自体は `isCancelled=true` のため表示されない。対象を特定できない取消から元の行を推測して消すことはしない（C8 の方針）。実電文での発生有無は**実挙動未確認**。
- **訂正・取消・訓練・試験の実電文**は C7/C8 とも1件も確認できていない。本Issueの取消・訂正の振る舞いは合成データでのみ検証する（**実挙動未確認**）。
- **VPHW50 のみ配信の目撃事象**では「目撃情報あり」が出ない（C8 確定事項#5で許容済み）。本文の `【目撃情報あり】` から推測する改善を入れないこと。
- **期限の反映遅れ**: 1分ごとの再評価のため、期限到達から非表示まで最大約60秒遅れる。不可視タブではポーリングが止まるが、`nowMs` の更新と期限判定はタブ復帰後の最初の更新で反映される（ブラウザのタイマー間引きで遅れる可能性は**実挙動未確認**）。
- **列の押し下げ**: 速報が多数・全文が長い場合に下のパネルが押し下がる（G1 H7 で許容済み）。竜巻は発表単位の区域のみ（Q6）のため区域行は短い。
- **`telegramType` の型上の `null`**: 現行の保存経路では返らない（§2.2、静的確認のみ・**実挙動未確認**）。将来、取得側の URL 書式変更や別経路の保存で `null` 等が返ると、その行だけが黙って表示されない（他の行は表示され、画面に異常表示は出ない。2026-09-25 ユーザー判断で許容。監視画面の受信履歴では見える）。その場合は API 側で種別を確実に持たせる別Issueとし、画面で推定しない。
- **`fetchTileCatalog` の流用**: 失敗の `code` 型が `TileApiError['code']` だが、気象 API のエラーコード（`invalid_request` 等）が入り得る。本Issueでは `code` を画面判断に使わないため実害はない。気象 API 共通のクライアントが必要になったら G3 以降でまとめて整理する。
- **#54（警報パネル）との競合**: `WeatherMapView.tsx` の `InfoPanelColumn` への `input` 受け渡し行を両Issueが変更する。後からマージする側が `{ ...DEFAULT_INFO_PANEL_INPUT, bosaiBulletin, warning }` の形に統合すること。
- 実挙動未確認: 実速報（DB に実データがある状態）での表示、iPad 実機での長い全文の折り返し。
