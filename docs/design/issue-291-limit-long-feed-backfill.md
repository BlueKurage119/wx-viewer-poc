# Issue #291 初回同期・復旧時の長期フィード取り込み量の制限（集約電文は直近3件）

作成日: 2026-10-18

## 1. 目的と範囲

初回同期・復旧時に長期フィード（`regular_l`・`extra_l`）の掲載電文（約7日分）をすべて個別取得しているため、時間と容量を使いすぎている。集約型の5種別に限り、種別×発表官署ごとに直近3件だけを取得するよう、取得前の選別を追加する。

範囲内:

- `apps/api/src/polling/` に、取得前選別の純粋関数を追加し、`pollSingleFeed` のエントリ走査に組み込む
- `FeedPollResult` に選別で省いた件数を追加する
- 単体テスト・結合テスト、および変更前後の計測記録

範囲外:

- 平常時（`scheduled`）・`manual` の挙動、高頻度フィード（`regular`・`extra`）の挙動
- 集約型以外の10種別（VPWW55〜61・VPHW50/51・VPBS50）の取得
- 同期中の読み出し停止を `weather_data_read_failed`（赤）と表示する件（別Issue）
- `apps/api/tests/helpers/` のサーバー起動ヘルパー（並行の Issue #290 が触る可能性があるため変更しない）

## 2. 参照資料と設計判断の根拠

### 2.1 参照資料

- Issue #291 本文
- [基本設計](../basic-design.md)（初回・復旧・鮮度の方針。「長期間変化しない警報の発表日時だけで古いと判定しない」）
- [取得方法レポート](../data-acquisition-report.md)（長期フィードは毎時更新・数日分を掲載）
- `apps/api/src/polling/jmaXmlPoller.ts`（`pollSingleFeed`、342行付近のエントリ走査）
- `apps/api/src/polling/jmaXmlFeeds.ts`（`JmaXmlPollTrigger`・`JmaXmlFeedDefinition.role`・`FeedPollResult`）
- `apps/api/src/polling/jmaXmlFeedParser.ts`（`extractTelegramTypeFromUrl`、`AtomFeedEntry` は `updated` を持たない）
- `apps/api/src/polling/jmaXmlPollingService.ts`（1サイクルで複数フィードを順に `pollSingleFeed` する）
- `jmaVenueForecastReprocessor.ts`（VPWP50・VPFD51・VPFD61・VPFW60 の snapshot は地域ごと1行の最新上書き）、`jmaWarningCurrentProcessor.ts`（VPWS50 は最新1本をポインターで参照）

### 2.2 オーナー確定事項（2026-10-18）と反映先

| # | 確定事項 | 反映先 |
| --- | --- | --- |
| 1 | trigger が `initial`・`recovery` で長期フィードを走査するときだけ、集約型を種別×発表官署ごとに直近N件へ絞る。地域による府県の絞り込みはしない。平常時は変えない | §3.2 適用条件 |
| 2 | N = 3（予備を含む） | §3.1 定数 |
| 3 | 集約型 = VPWS50・VPWP50・VPFD51・VPFD61・VPFW60。他の10種別は全件 | §3.1 定数 |
| 4 | 電文履歴で古い集約電文が欠けることは許容 | §6 引き継ぎ |
| 5 | 対象外は取得せず、受信記録も残さない | §3.3 |
| 6 | 赤表示の見直しは範囲外 | §1 |

### 2.3 実測（設計担当、2026-10-18 23時台 JST、本番フィード）

- `regular_l` 9320件・`extra_l` 4006件（統括担当の実測と一致）。
- **並び順**: 両フィードとも `<updated>` が隣接エントリ間で一度も逆転しない（逆転0件）。先頭が最新（`regular_l` 先頭 2026-10-18T14:01:29Z、末尾 2026-10-11T14:06:57Z）。新しい順であることを実データで確認した。
- 集約5種別はすべて `regular_l` にあり、`extra_l` には0件。件数は VPWP50 1676・VPFD51 1247・VPFD61 1228・VPWS50 1008・VPFW60 784。
- 個別電文URLの形式は `.../data/<YYYYMMDDhhmmss>_<数字>_<種別>_<官署コード6桁>.xml`（例 `20261018135702_0_VPWP50_360000.xml`、`..._VPWS50_010000.xml`）。

統括担当の実測（対象15種別で約6,860件・約3.05GB、うち VPWS50・VPWP50 で約98%）を効果見積りの前提とする。

### 2.4 設計判断

1. **順序の扱い**: 並び順は実データで新しい順と確認できたが、フィード仕様として公式資料で保証を確認したわけではない。そこで順序に依存しない方法をとる。URL先頭14桁の時刻（`YYYYMMDDhhmmss`）で降順に順位を付け、同時刻はフィード上の出現順（先のものを新しいとみなす）で決める。パーサーに `updated` を足す改修は不要になる。
2. **官署の識別**: URL末尾の6桁コード（`_<種別>_` の直後、`.xml` の直前）を官署キーとする。コードの意味（府県・地方）は解釈しない（確定事項1）。
3. **N件の数え方**: 選別はエントリ走査の前にフィード全体へ1回だけ行い、各グループの上位3件を「取得候補」とする。既受信の電文と取得に失敗した電文も3件に含める。
   - 根拠（既受信を数える）: 復旧時、DBに最新があれば古いものを追加で取る理由がない。数えない設計では、受信済みの最新を飛ばしてさらに古い電文を取りに行くことになり、snapshot を古い電文で上書きしうる（上書き側の新旧判定に依存する）。
   - 根拠（失敗を数える）: 上限が固定され、取得量が最悪でも1グループ3件に収まる。予備の2件が最新の失敗を補う（確定事項2の「予備」の意図と一致）。成功するまで遡る方式は失敗が続くと取得量が際限なく増える。
4. **適用単位**: フィード1本（`pollSingleFeed` 1回）ごとに選別する。集約5種別は `regular_l` にしかないため、フィードをまたぐ合算は不要。
5. **URL形式に合わない集約型エントリ**（時刻14桁や官署コードが取れないもの）: 選別対象から外し、従来どおり処理する（取りこぼしより取りすぎを選ぶ）。実データでは該当0件。

## 3. 設計

### 3.1 新規モジュール `apps/api/src/polling/longFeedBackfillFilter.ts`

```ts
export const BACKFILL_AGGREGATE_TELEGRAM_TYPES: ReadonlySet<string>; // VPWS50, VPWP50, VPFD51, VPFD61, VPFW60
export const BACKFILL_LATEST_PER_GROUP = 3;

/** initial/recovery かつ long_term フィードのときだけ true */
export function shouldLimitLongFeedBackfill(
  trigger: JmaXmlPollTrigger,
  feedDef: Pick<JmaXmlFeedDefinition, 'role'>,
): boolean;

/**
 * 取得候補から外す（=取得も記録もしない）エントリのURL集合を返す。
 * 集約5種別以外、URL形式に合わないエントリは決して含めない。
 * 入力の順序・内容は変更しない。
 */
export function selectBackfillExcludedUrls(
  entries: readonly AtomFeedEntry[],
): ReadonlySet<string>;
```

- URLの比較は、`pollSingleFeed` と同じく `sanitizeUrl(entry.documentUrl)` 後の値で行う（`sanitizeUrl` を呼ぶか、呼び出し側で sanitize 済みURLを渡す形にしてよい。どちらでも、除外集合と走査側のURLが同じ正規化であること）。
- グループキーは `${種別}|${官署コード}`。並べ替えは §2.4-1 のとおり。
- 同一URLが重複して載っている場合は1件として数える。

### 3.2 `pollSingleFeed` への組み込み

`entries` を得た直後、ループの前に:

```ts
const excludedUrls = shouldLimitLongFeedBackfill(trigger, feedDef)
  ? selectBackfillExcludedUrls(entries)
  : EMPTY_SET;
```

ループ内では、15種別外の判定（`isTargetTelegramType`）の直後、サイクル内重複判定の**前**に:

```ts
if (excludedUrls.has(docUrl)) { skippedBackfillLimitCount++; continue; }
```

- `processedUrlsInCycle` に追加しない（同じサイクルの別フィードで同URLが出れば、そちらの規則で処理される）。
- `hasTelegramReception` も呼ばない。`fetch_attempt`・`telegram_reception` を一切書かない（確定事項5）。
- `discoveredCount` は従来どおり全エントリを数える（意味を変えない）。

### 3.3 `FeedPollResult` の拡張（`jmaXmlFeeds.ts`）

```ts
readonly skippedBackfillLimitCount: number; // 初回・復旧の集約電文絞り込みで取得しなかった件数
```

`pollSingleFeed` のすべての戻り値（フィード取得失敗・中断を含む）で設定する（未走査は0）。既存テストで `FeedPollResult` を `deepEqual` している箇所（`jmaXmlPolling.test.ts` 550行付近など）は、この項目を足して更新する。監視API・画面への露出は本Issueでは行わない。

### 3.4 変更しないもの

- `scheduled`・`manual` の処理、高頻度フィード、集約型以外の10種別、`processedUrlsInCycle`・既受信判定のロジック
- snapshot・警報現況の処理器（入力電文が減るだけで、処理規則は変えない）
- `apps/api/tests/helpers/` 配下

## 4. テスト

### 4.1 単体テスト `apps/api/tests/longFeedBackfillFilter.test.ts`（新規）

`selectBackfillExcludedUrls`・`shouldLimitLongFeedBackfill` について、少なくとも次を検証する。

- 集約5種別それぞれで、同一種別・同一官署に5件あると、URL時刻の新しい3件が残り、古い2件が除外集合に入る
- 同一種別で官署が異なれば別グループとして各3件残る。同一官署で種別が異なっても別グループ
- フィード上の並びを古い順・ランダム順にしても結果が同じ（順序非依存）
- 同時刻のときはフィード上で先に出たものが残る
- VPWW55〜61・VPHW50・VPHW51・VPBS50 が同一官署に10件あっても除外集合に1件も入らない
- URL形式に合わない集約型エントリは除外されない
- `shouldLimitLongFeedBackfill`: `initial`/`recovery` × `long_term` のみ true。`scheduled`/`manual`、および `high_frequency` は false

### 4.2 結合テスト（`pollSingleFeed`、既存の `jmaXmlPolling.test.ts` に追加、または新規ファイル）

既存テストのフィクスチャ方式（`fetchFn` 差し替え）に従う。

- `trigger='initial'`、`long_term` フィードに VPWP50 同一官署5件＋VPWW 系5件を載せると、個別GETは VPWP50 3件＋VPWW 5件だけ。除外2件のURLは `fetch_attempt`・`telegram_reception` に無い。`skippedBackfillLimitCount === 2`
- 同じフィードを `trigger='scheduled'` で処理すると全件GETされ、`skippedBackfillLimitCount === 0`
- `trigger='recovery'` で最新1件が既受信のとき、GETは残り2件だけ（既受信を3件に数える）
- 最新の VPWP50 の取得が失敗しても、2・3番目が取得され、snapshot は2番目の内容になる。4番目以降はGETされない
- 古い3件以外を除外しても、snapshot（VPWP50/VPFD51/VPFD61/VPFW60 のいずれか1種別で可）と警報現況（VPWS50）が、全件取り込んだ場合と同じ行になる

## 5. 受け入れ条件

検収担当は以下を1項目ずつ実行する。計測は `npm run build` を使わず、開発用とは別のポート・別のデータディレクトリで行う。`apps/api/tests/helpers/` は変更しない（差分に含まれていないことも確認する）。

- [ ] **AC-1 静的検査**: `npm run lint`・`npm run typecheck`・`npm run format:check` がエラー0で終わる
- [ ] **AC-2 テスト**: `npm run test -w apps/api` が全件成功する。§4.1・§4.2 の各項目に対応するテストが存在する（テスト名で対応が読める）
- [ ] **AC-3 単体（確定事項の検証）**: AC-2 のうち、集約5種別が種別×官署ごとに3件へ絞られること、それ以外の10種別が全件処理されること、`scheduled` では絞られないことのテストが成功している
- [ ] **AC-4 記録しない**: §4.2 の結合テストで、除外URLが `fetch_attempt`・`telegram_reception` のどちらにも0行であることを確認している
- [ ] **AC-5 変更範囲**: `git diff --stat main...HEAD` の変更が `apps/api/src/polling/`（新規モジュール・`jmaXmlPoller.ts`・`jmaXmlFeeds.ts`）、`apps/api/tests/` の該当テスト、本設計書（実測記録の追記）に限られ、`apps/api/tests/helpers/` を含まない
- [ ] **AC-6 取得件数の記録（合否基準にしない）**: 計測時点の本番 `regular_l`・`extra_l` を取得し、変更前（15種別のうち未受信の全件）と変更後（`selectBackfillExcludedUrls` 適用後）の個別取得予定件数を、種別ごとに数えて §7 に記録する。可能なら変更後コードで別ポート・別データの初回同期を1回実行し、所要時間と `fetch_attempt` の `xml_document` 成功行の `response_bytes` 合計も記録する。変更前の時間・容量は統括担当の実測（約6,860件・約3.05GB）を引用してよい
- [ ] **AC-7 現況・snapshot の一致**（2026-10-18 オーナー判断により、main での全件同期は行わない）: (1) 結合テストで、同じフィード・電文の fixture を絞り込みあり／なしで処理し、警報現況（VPWS50 由来・VPWW 系由来）と、VPWP50・VPFD51・VPFD61・VPFW60 の snapshot テーブルの全行が一致することを確認する。(2) 変更後コードだけで、別ポート・別データを使って本番フィードの初回同期を完了させる（完了はログ・監視APIで確認する）。警報現況と各 snapshot が、各グループ最新の電文に基づいていることを確認する

## 6. 後続Issueへの引き継ぎ

- 電文履歴（受信履歴）には、初回同期・復旧の時点より前の集約電文が各グループ最大3件しか残らない（確定事項4で許容）。集約電文の過去を使う時系列表示を今後作る場合は、この前提を考慮すること。
- 復旧（`recovery`）で、停止期間中に同一グループの集約電文が4件以上出ていた場合、古いものは取得されない。表示は最新由来のため影響しない見込みだが、実挙動未確認。
- 同期中の赤表示（`weather_data_read_failed`）の見直しは別Issue。
- 集約5種別の新旧判定は URL 先頭14桁の時刻に依存する。気象庁がURL形式を変えた場合、選別対象外として全件取得に戻る（安全側）。

## 7. 実測記録（製造・検収で記入）

| 項目 | 変更前 | 変更後 | 計測日時・条件 |
| --- | --- | --- | --- |
| 個別取得予定件数（種別ごと） | | | |
| 初回同期の所要時間 | | | |
| 取得容量（`response_bytes` 合計） | | | |

## 8. 実挙動未確認の事項

- フィードが新しい順であることは実データ1回分（2026-10-18）で確認しただけで、公式資料での保証は未確認。設計は順序に依存しない（§2.4-1）。
- snapshot 処理器が古い電文による上書きを拒むかは本設計では確認していない。本設計は既受信を3件に数えることで古い電文を取りに行かないため、この挙動に依存しない。
- 変更後の初回同期の所要時間・容量は未計測（AC-6 で記録）。
