# Issue #188「取得する電文の選別（取得前の絞り込み）と保存量の削減」設計

作成日: 2026-09-21

## 1. 目的

気象庁 XML フィードの Atom エントリについて、個別電文 XML を取得する前に URL から電文種別を判定し、本システムが解析・表示・通知の対象としない種別を取得・保存・処理しないようにする。

初期取得（長期フィードを含む）と通常の取得の双方で、個別電文の GET 回数および `telegram_reception` に保存する原文量を減らす。まず種別だけを絞り込み、初回同期の所要時間が改善するかを確認する。地域による取得前絞り込みおよび、見送った件数の記録・表示は本 Issue の対象外とする。

## 2. 参照資料と確定事項

- GitHub Issue #188「取得する電文の選別（取得前の絞り込み）と保存量の削減」
- [`../data-acquisition-report.md`](../data-acquisition-report.md) §2.1、§3.1、§9
  - フィード内の `link.href` をたどって個別 XML を取得し、日時・官署コードから URL を組み立てない方針である。
  - 代表データ URL には `_VPWW55_`、`_VPWS50_`、`_VPWP50_`、`_VPBS50_` が含まれ、既存の `extractTelegramTypeFromUrl` はその位置の `VPxxxx` 形式を抽出している。
  - 対象電文の情報種別と、フィード所属を固定せず長短4フィードの和集合として扱う方針が記録されている。
- [`../../apps/api/src/polling/jmaXmlFeedParser.ts`](../../apps/api/src/polling/jmaXmlFeedParser.ts)
  - `extractTelegramTypeFromUrl(url)` は `/_([A-Z]{4}\d{2})_/` で URL 中の種別を抽出し、抽出不能時は `null` を返す。
- [`../../apps/api/src/polling/jmaXmlPoller.ts`](../../apps/api/src/polling/jmaXmlPoller.ts)
  - 現在は Atom 解析後、重複抑止を通過した全エントリを個別 GET し、成功時に原文と受信履歴を保存している。
- [`../../apps/api/src/repositories/types.ts`](../../apps/api/src/repositories/types.ts)
  - `WARNING_TELEGRAM_TYPES` は `VPWW55`〜`VPWW61` と `VPWS50` を定義し、ポーラーはこれに加えて、各既存 processor が受ける電文種別を分岐している。
- 統括担当から渡されたヒアリング済み確定事項:
  1. 取得前フィルタはフィードエントリの URL から判別できる電文種別だけで行い、地域では絞り込まない。
  2. 対象種別は既存の解析・表示・通知対象の15種、`VPWW55`〜`VPWW61`、`VPWS50`、`VPWP50`、`VPFD61`、`VPFW60`、`VPFD51`、`VPBS50`、`VPHW50`、`VPHW51` とする。
  3. 対象外として取得を見送った件数は、取得試行・監視・API・画面のいずれにも記録または表示しない。
  4. 初回同期の軽量化を先に検証し、不十分な場合の追加施策は別途検討する。

### 実挙動未確認

今回の設計フェーズでは、2026-09-21 時点の公開フィードを新たに取得して、全対象15種を含む Atom エントリの URL 形式を実測してはいない。取得方法レポートに記録された代表 URL、既存の URL 抽出実装・テスト、およびヒアリング済み確定事項を根拠とする。公開側の URL 命名が変わり対象種別を抽出できなくなった場合、当該エントリは本設計の fail-closed 方針により取得しないため、運用時の実フィードを使う受け入れ確認で対象種別の URL を確認する。

## 3. 設計方針

### 3.1 選別位置と順序

`pollSingleFeed` の Atom エントリループで、`sanitizeUrl(entry.documentUrl)` の直後、サイクル内重複・DB既受信の判定より前に対象種別判定を置く。

```text
Atom フィード GET・解析
  → entry ごとに documentUrl を sanitize
  → URL から種別を抽出
  → 対象種別か判定
      ├─ 対象外または抽出不能: 何も保存せず次の entry
      └─ 対象: 既存の重複抑止 → 個別 XML GET → 保存 → 既存 processor
```

この位置に置くことで、対象外エントリは `processedUrlsInCycle` に追加せず、個別 XML GET、`fetch_attempt`（`xml_document`）、`telegram_reception`、採用判定、各 processor のいずれも発生しない。同一 URL が複数フィードに掲載されていても、対象 URL に対する既存のサイクル内重複抑止・DB既受信抑止の意味は変えない。

`discoveredCount` は従来どおり Atom 解析済みの全エントリ数を数える。一方、対象外・抽出不能エントリは既存の `skippedDuplicateCount` に混ぜない。これは同カウントが URL 重複によるスキップ数を表す既存契約を保ち、見送り件数を新設・記録しないという確定事項にも従うためである。`downloadedCount`、`failedDocumentCount` は対象種別の個別 GET だけを数える。

### 3.2 対象種別の単一情報源

`apps/api/src/polling/jmaXmlFeeds.ts` に、ポーリングで個別取得を許可する種別を公開定数として追加する。名称は `TARGET_TELEGRAM_TYPES`、型は配列要素から導出する `TargetTelegramType` とする。

```ts
export const TARGET_TELEGRAM_TYPES = [
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
  'VPWS50',
  'VPWP50',
  'VPFD61',
  'VPFW60',
  'VPFD51',
  'VPBS50',
  'VPHW50',
  'VPHW51',
] as const;

export type TargetTelegramType = (typeof TARGET_TELEGRAM_TYPES)[number];

export function isTargetTelegramType(telegramType: string | null): boolean;
```

`isTargetTelegramType` は `null` を `false` とし、上記定数だけを `true` とする。URL種別の抽出は既存の `extractTelegramTypeFromUrl` を使い、同じ URL に対する種別抽出規則を二重定義しない。

`WARNING_TELEGRAM_TYPES` や processor 固有の定数を置き換えない。これらは受信済み本文の解析・採用を担う既存の責務を維持し、`TARGET_TELEGRAM_TYPES` は取得前の許可集合だけを担う。将来対象種別を追加・削除する際は、受信後の processor・通知・表示側とこの許可集合を同じ変更で見直す。

### 3.3 地域・Control/Status・失敗時の扱い

- 地域は URL から判定せず、対象15種のすべての地域版を取得する。取得後の既存 parser / processor が会場・予報対象地域を判定する経路を保持する。
- URLで種別が対象なら、本文の `Control/Status` が通常・訓練・試験のいずれであっても取得前には除外しない。ステータス判定は本文取得後にしかできないため、既存の訓練・試験の受信・採用・通知の挙動を変更しない。
- URLから種別を抽出できないエントリは対象種別であることを証明できないため、対象外と同じく個別取得しない。フィード自体の HTTP / Atom 解析成功は従来どおり成功として扱い、バックオフ・freshness・初期取得完了判定を変更しない。
- フィード HTTP 失敗、Atom解析失敗、対象種別の個別 GET 失敗、中断、重複抑止の既存挙動と結果型は変更しない。

### 3.4 適用範囲と非対象

`pollSingleFeed` は `JmaXmlPollingService` の `scheduled`、`manual`、`initial`、`recovery` の全トリガから共用されるため、本フィルタは高頻度2フィードと長期2フィード、全トリガに一律適用される。フィードの選択集合や実行順序は変更しない。

次は実装しない。

- 地域・会場・タイトル・概要を用いる取得前絞り込み
- 見送ったエントリ件数、URL、種別、理由の DB 保存、ログ、`FeedPollResult`、監視 API、画面への追加
- 既存の `telegram_reception`、`fetch_attempt`、原文の削除・圧縮・保持期間変更
- 起動時の保存済み受信履歴の再処理、初期取得中の健全性判定、取得周期・バックオフ・availability の変更

## 4. 変更対象と実装手順

| ファイル | 変更 |
| --- | --- |
| `apps/api/src/polling/jmaXmlFeeds.ts` | 対象15種の `TARGET_TELEGRAM_TYPES`、`TargetTelegramType`、`isTargetTelegramType` を追加する。`FeedPollResult` の形は変えない。 |
| `apps/api/src/polling/jmaXmlPoller.ts` | Atom entry ごとに URLから種別を抽出し、対象外・抽出不能なら既存の重複・GET・保存処理へ進まないようにする。 |
| `apps/api/tests/jmaXmlPolling.test.ts` | URL種別抽出・許可判定、および対象・対象外・抽出不能が混在するフィードでの取得前選別を検証する。既存の重複、保存、全トリガの契約が壊れないことを確認する。 |

DB migration、repository、shared package、REST API、監視 DTO、Web UI、設定ファイルの変更は不要とする。

実装は次の順で行う。

1. `jmaXmlFeeds.ts` に対象許可集合と判定関数を追加し、15種の完全一致・対象外・`null` を単体テストする。
2. `jmaXmlPoller.ts` で `sanitizeUrl` 後に `extractTelegramTypeFromUrl` と判定関数を呼び、非対象なら `continue` する。
3. ローカル HTTP サーバーを用いる既存方式のテストフィードに、対象 URL、対象外 URL、`VPxxxx` 形式を含まない URL を混在させる。対象 URL のみが個別 GET・`fetch_attempt`・`telegram_reception`・既存 processor へ到達することを検証する。
4. `initial` / `recovery` を含む4フィードの既存テストを実行し、フィルタによってフィード取得成功・初期取得完了・バックオフの判定が変わらないことを確認する。

## 5. 検証計画と受け入れ条件

製造担当は [テスト検証業務標準](../rules/05-verification-protocol.md) に従い、変更に対応するテストを追加してから、対象 workspace のテストおよび横断検査を実行する。

- [ ] `apps/api/tests/jmaXmlPolling.test.ts` に、`TARGET_TELEGRAM_TYPES` が指定の15種を過不足・重複なく含み、各値を `isTargetTelegramType` が `true`、非対象種別と `null` を `false` と判定するテストを追加する。`npm run test -w apps/api -- --test-name-pattern="対象電文|取得前"` を実行して成功すること。
- [ ] 対象種別、対象外種別、種別抽出不能 URL を各1件以上含む Atom fixture をローカル HTTP サーバーで返すテストを追加する。個別 XML への HTTP リクエスト数、`xml_document` の `fetch_attempt` 件数、`telegram_reception` 件数が対象種別分だけであり、対象外・抽出不能 URL への個別 GET が0回であることを完全一致で確認する。
- [ ] 同テストで `FeedPollResult.discoveredCount` が全エントリ数、`skippedDuplicateCount` がURL重複だけ、`downloadedCount` が対象種別の成功 GET 数、`failedDocumentCount` が対象種別の GET 失敗数であることを完全一致で確認する。対象外件数専用のフィールド・履歴・監視出力が追加されないことを、`FeedPollResult` の完全一致と変更ファイル一覧で確認する。
- [ ] 対象種別の URL に対し、フィルタ導入前と同じ `telegram_reception` 保存と既存 processor の採用結果が得られる統合テストを追加または既存テストを拡張して確認する。対象地域外の本文について既存の地域判定に到達することも確認する。
- [ ] `scheduled` / `manual` が高頻度2フィード、`initial` / `recovery` が4フィードを対象とする既存テストを実行し、対象種別は全トリガで取得され、対象外は個別 GET されないことを確認する。初期取得の `feedFetchOutcome` と完了判定が対象外エントリだけでは failure にならないことを確認する。
- [ ] `npm run test -w apps/api`、`npm run lint`、`npm run typecheck`、`npm run format:check` を実行し、すべて成功すること。
- [ ] 運用前の実フィード確認として、4フィードから取得した Atom entry の URL を用い、対象15種を含む URL が既存抽出規則で正しく判定されること、対象外 URL は取得されないことを確認する。外部通信ができない環境では未実施として記録し、推測で合格にしない。

## 6. 後続 Issue への引き継ぎ

- 種別のみのフィルタ導入後も初回同期が許容時間に収まらない場合は、実フィードでの対象・対象外の件数、初期取得所要時間、保存量を観測したうえで、地域による取得前絞り込みや別の軽量化施策を別 Issue として検討する。地域は URL以外の本文検証を要するため、本 Issue の成果だけから地域選別を追加しない。
- 対象外の受信履歴・見送り理由を将来必要とする場合は、保存量削減とのトレードオフ、K3 #76 の受信履歴表示、監視 API / UI、保持方針をまとめて別 Issue で決める。本 Issue では記録しない。
- 気象庁側の URL 命名規則または対象電文を変更する場合は、`TARGET_TELEGRAM_TYPES` と受信後の processor・通知・表示対象を同時に見直し、実データ・公式資料・取得方法レポートとの照合結果を残す。

## 7. 要ヒアリング事項

なし。対象種別、地域を絞り込まないこと、見送り件数を記録しないこと、軽量化の評価後に次施策を判断することはヒアリングで確定済みである。
