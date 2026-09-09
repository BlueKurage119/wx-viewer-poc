# Issue #11 設計書: XML定時・随時フィードのポーリング基盤（PULL型）

作成日: 2026-09-09

## 1. 目的と範囲

気象庁の PULL 型 XML 提供からフィードを取得し、フィードに掲載された未受信の個別電文を取得して、既存の受信履歴へ追記するバックエンド基盤を実装する。個別電文 URL は Atom エントリのリンクからのみ取得し、日時・官署コード・Atom の題名等から組み立てない。

通常運用の定期取得対象は高頻度フィードの次の 2 本だけとする。固定の初期周期は 60 秒とする。

|識別子|URL|用途|
|---|---|---|
|`regular`|`https://www.data.jma.go.jp/developer/xml/feed/regular.xml`|定時・高頻度。通常ポーリング対象|
|`extra`|`https://www.data.jma.go.jp/developer/xml/feed/extra.xml`|随時・高頻度。通常ポーリング対象|

長期フィードは件数が多いため、通常の定期ポーリングには含めない。初期化・復旧の 1 回の取得でだけ利用可能にする。

|識別子|URL|用途|
|---|---|---|
|`regular_l`|`https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml`|定時・長期。初期化・復旧時のみ|
|`extra_l`|`https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml`|随時・長期。初期化・復旧時のみ|

本 Issue は、フィードと個別電文の HTTP 取得、重複抑止、10 秒タイムアウト、初期値 60 秒・上限 300 秒の指数バックオフ、同時要求の集約、取得履歴への記録を対象とする。

次は対象外とする。

- 電文種別ごとの厳密な判定、業務データへの正規化、現況構成、availability 更新、通知生成（C2 以降）
- 初期化・復旧後に何を現況へ反映し通知を再評価するか（C12）
- 時間帯別周期、夜間運転、取得元別の健全性判定と設定値の外部化（C13、C14）
- 取得開始・停止・強制更新の HTTP API、要求識別子による操作重複防止（E11）
- フロントエンド、共有パッケージ、migration の変更

## 2. 参照資料と確定事項

- Issue #11「C1. XML定時・随時フィードのポーリング基盤（PULL型）」
- `docs/issues-draft.md` の C1
- `docs/data-acquisition-report.md` §2.1、§3.1、§6、§8
- `docs/basic-design.md` §6、§8.1〜§8.3
- `docs/design/issue-7-reception-history.md` §3.4、§8、§12
- 実装済みの `apps/api/src/repositories/fetchAttemptRepository.ts`、`telegramReceptionRepository.ts` と `apps/api/src/server.ts`

ヒアリングで、長期フィードは件数が多いため初期化・復旧時のみ取得すると確定した。したがって Issue 本文の「4フィードを定期的にポーリング」は、高頻度 2 フィードの通常ポーリングと、長期 2 フィードを取得可能な共通基盤を意味するものとして扱う。

取得方法レポートで確認済みの事項は次のとおりである。

- 高頻度フィードは毎分更新、直近少なくとも 10 分を掲載する案内がある。通常時の 60 秒取得はアプリ側の初期案であり、提供の遅延保証ではない。
- 電文種別のフィード所属を固定しない。たとえば `VPWP50` は `regular_l.xml` に実在した。各フィードで発見したリンクの和集合を扱う。
- Atom の title / summary は候補抽出の補助でしかない。本文の名前空間、`Control`、`Head`、地域要素の検証を経て、後続 Issue が情報種別ごとに採用判定する。
- URL／Atom ID と本文ハッシュを用いて重複取得を避ける。一度取得した個別電文を繰り返し全件ダウンロードしない。
- `fetch_attempt` は成功・失敗の両方を追記する。`telegram_reception` は原文、由来フィード、Atom ID、共通ヘッダを保持でき、DB の UNIQUE 制約には依存しない。

## 3. 設計判断

### 3.1 取得サイクル

`pollOnce` は指定されたフィード集合について 1 回だけ取得する。通常サイクルは `regular` と `extra`、初期化・復旧サイクルは 4 フィードすべてを対象とする。長期 2 フィードを通常タイマーから呼ばない。

サービスの通常運転中は 60 秒間隔で通常サイクルを要求する。開始直後は待たずに 1 回実行する。周期はコンストラクタで注入可能にし、C14 が JST の時間帯別周期と夜間方針を与えられるようにする。C1 は時刻帯の判定を持たない。

同一サービス内でサイクルが実行中なら、タイマー、将来の E11 からの強制更新、復旧要求を問わず同じ in-flight Promise を返す。並列の上流リクエストや、重複した個別電文取得を起こさない。これはサービス内部の取得集約であり、E11 の要求識別子・操作履歴による重複防止を代替しない。

### 3.2 重複抑止と履歴

フィードの HTTP GET は毎サイクル実行し、そのたびに `fetch_attempt` を 1 行追加する。Atom エントリごとに `document_url` を取得し、既存の `telegram_reception.document_url` を完全一致で照会する。既受信なら個別 XML の GET と電文履歴の追加を行わない。複数フィードまたは同じフィード内で同じ URL を見つけた場合も、同一サイクルで 1 回だけ処理する。

本文を取得できた未受信 URL は SHA-256 を算出して `content_hash` に保存する。Atom ID とハッシュは受信履歴の追跡・後続の検証材料であり、異なる URL を URL 判定より先に排除するキーにはしない。本文が取得できなかった場合でも、その HTTP 試行は `fetch_attempt` に残す。本文を得られなかった電文について `telegram_reception` の空行は作らない。

取得済み本文は、C1 が安全に抽出できる共通ヘッダと地域要素を `telegram_reception` に記録する。種別固有の採用可否は C2 以降が `updateTelegramReceptionAdoption` で判定するため、C1 が成功取得を「正常な発表なし」や特定の情報種別として扱わない。共通エンベロープを検証できない本文も、原文・ハッシュ・由来と `adoptionResult: '未対応形式'`、理由を残し、黙って破棄しない。

### 3.3 HTTP、タイムアウト、再試行

すべてのフィード・個別電文 GET は `AbortSignal.timeout(10_000)` を使用する。HTTP 非成功、ネットワーク例外、タイムアウト、フィード／Atom の構造不正は失敗として `fetch_attempt` に記録する。タイムアウトとネットワーク例外では `httpStatus` を `null` とする。エラー文には URL の認可情報、ヘッダ、秘密値を残さない。

同じフィードで連続失敗した場合の次回待機は 60、120、240、300、300 秒とする。成功したフィードは連続失敗数を 0 に戻す。フィード単位で独立に管理し、一方が待機中でも他方の取得を妨げない。通常サイクルでは待機中のフィードを開始せず、待機の理由を状態として公開する。

個別電文の失敗は当該電文の `fetch_attempt` に記録し、フィード本文を正常に取得・解析できたことを失敗に読み替えない。フィード試行の `outcome` と、サイクル集計の失敗電文件数を分けて保持する。取得元全体の遅延・異常表示と、設定ファイルによる数値変更は C13 で統合する。

### 3.4 開始・停止

`start()` は通常ポーリングを開始し、即時の通常サイクルを 1 回要求する。二重 `start()` はタイマーを増やさない。`stop()` は次のタイマー投入を止め、実行中サイクルは完了を待つ。停止は永続データ・受信履歴・バックオフ状態を削除しない。サーバー終了時には必ず `stop()` と DB close を順に実行する。

この内部 API は E11 が利用するための接続点であり、C1 では HTTP route を追加しない。停止中の 1 回取得を許すか、停止中でも長期フィードを用いる復旧をいつ呼ぶかは E11/C12 で決める。

## 4. モジュール・型・内部 API

### 4.1 変更対象

```text
apps/api/src/
├── polling/
│   ├── jmaXmlFeeds.ts
│   ├── jmaXmlFeedParser.ts
│   ├── jmaXmlPoller.ts
│   ├── retryBackoff.ts
│   └── jmaXmlPollingService.ts
├── repositories/
│   ├── telegramReceptionRepository.ts
│   ├── types.ts
│   └── index.ts
└── server.ts
apps/api/tests/
└── jmaXmlPolling.test.ts
apps/api/package.json
package-lock.json
```

XML は名前空間を保持して解析できるライブラリを `apps/api` に追加する。正規表現やローカル名だけの文字列走査で XML を解釈しない。ライブラリ選定時は、実装と型定義を `node_modules` で確認し、Atom と電文 XML の名前空間・属性・繰返し要素を区別できることをテストで示す。

### 4.2 型

```ts
export type JmaXmlFeedKind = 'regular' | 'extra' | 'regular_l' | 'extra_l';
export type JmaXmlPollTrigger = 'scheduled' | 'initial' | 'recovery' | 'manual';

export interface JmaXmlFeedDefinition {
  readonly kind: JmaXmlFeedKind;
  readonly url: string;
  readonly sourceKind: string;
  readonly role: 'high_frequency' | 'long_term';
}

export interface AtomFeedEntry {
  readonly id: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly documentUrl: string;
}

export interface FeedPollResult {
  readonly feedKind: JmaXmlFeedKind;
  readonly discoveredCount: number;
  readonly skippedDuplicateCount: number;
  readonly downloadedCount: number;
  readonly failedDocumentCount: number;
}

export interface PollCycleResult {
  readonly trigger: JmaXmlPollTrigger;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly feedResults: readonly FeedPollResult[];
}
```

`JmaXmlPollingService` の内部 API は以下とする。

```ts
pollOnce(trigger: JmaXmlPollTrigger): Promise<PollCycleResult>;
start(): void;
stop(): Promise<void>;
getStatus(): JmaXmlPollingStatus;
```

`pollOnce('scheduled')` は高頻度 2 フィード、`pollOnce('initial')` と `pollOnce('recovery')` は 4 フィードを選ぶ。`manual` の対象選択は E11 の設計で確定するまで高頻度 2 フィードとし、長期フィードを無制限に再取得する抜け道を作らない。

既存の `listTelegramReceptions({ documentUrl, limit: 1 })` を既受信照会に用いる。専用の検索関数を追加する場合も、返却値は「存在するか」だけに限定し、既存の追記ログ性や DB の UNIQUE 制約なしを変更しない。

## 5. 処理フロー

```text
サイクル要求
  └─ in-flight なら同じ Promise を返す
  └─ 対象フィードごとに GET（10 秒 timeout）
       ├─ fetch_attempt を成功・失敗とも記録
       ├─ Atom を名前空間付きで解析
       └─ entry.link.href ごとに処理
            ├─ HTTPS URL として検証
            ├─ document_url が既受信ならスキップ
            └─ 未受信なら個別 XML を GET（10 秒 timeout）
                 ├─ fetch_attempt を記録
                 ├─ SHA-256 を算出
                 ├─ 共通エンベロープを検証・抽出
                 └─ telegram_reception に原文と由来を追記
```

Atom の `link` は電文本文への URL として明示されたものだけを採用する。非 HTTPS、空 URL、相対 URL、許可した公開 XML データ配下でない URL は取得せず、当該フィードの構造不正として失敗記録を残す。リダイレクト先も同じ制約を満たす必要がある。

## 6. テスト計画

`apps/api/tests/jmaXmlPolling.test.ts` を追加する。実ネットワーク、実時間待機、既定の開発 DB を使わず、ローカル HTTP テストサーバー、一時 SQLite DB、注入可能な clock / fetch / timer を使う。

1. 4 フィード定義の URL・`sourceKind`・役割が完全一致し、通常サイクルが高頻度 2 フィードだけ、初期化サイクルが 4 フィードを取得する。
2. Atom エントリの `link.href` でだけ個別電文を取得する。題名・日時・官署コードから URL を組み立てる実装では成功しないフィクスチャを用いる。
3. 同じ `document_url` が複数フィードまたは同一フィードに掲載されても、個別 GET と `telegram_reception` 追記が各 1 回だけである。
4. 前サイクルで受信済みの URL は、次サイクルで個別 GET を行わず、フィード取得試行だけを追記する。
5. 正常な名前空間、`Control`、`Head`、地域要素を持つ本文が、原文、SHA-256、Atom ID、由来フィード、共通ヘッダ、地域明細を含んで完全一致で往復する。
6. title だけが対象らしく見えても、本文の名前空間・共通構造・地域要素が不正なら、空の正常情報へ変換せず、原文と `未対応形式` の理由が残る。
7. フィード・個別電文の HTTP 非成功、ネットワーク例外、10 秒 timeout が `fetch_attempt` に失敗として記録され、timeout の `httpStatus` が `null` である。
8. 同一フィードの連続失敗で待機値が 60、120、240、300、300 秒となり、成功後は 60 秒へ戻る。一方の待機が他方の取得を止めない。
9. 同時の `pollOnce` は同一 Promise を共有し、上流のフィード GET がフィードごとに 1 回だけである。
10. `start()` の複数呼出しがタイマーを増やさず、`stop()` 後は追加サイクルを開始しない。実行中サイクルと DB を安全に終了する。

新テストは、既受信 URL の判定を一時的に外し、重複フィード掲載時の個別 GET 回数および履歴件数の完全一致アサーションが失敗することを red として確認する。その前に、意味を変えないフィクスチャの表示専用文字列を変更してテストが成功し続ける対照実験を行う。いずれの一時変更も完成コードに残さない。

## 7. 受入条件

1. `regular.xml` と `extra.xml` は固定初期周期 60 秒で定期取得され、`regular_l.xml` と `extra_l.xml` は初期化・復旧要求時だけ取得される。
2. すべてのフィード・個別電文の HTTP 試行は、成功・失敗を問わず `fetch_attempt` へ追記される。
3. 個別電文 URL は Atom エントリ内のリンクから取得され、日時・官署コード・title 等から自作されない。
4. 同一サイクル内または既受信済みの同一 URL について、個別 XML の再ダウンロードと電文履歴の重複追記が発生しない。
5. 名前空間、`Control`、`Head`、地域要素を検証できない本文は、正常な発表なしへ縮退せず、取得原文と失敗理由を追跡できる。
6. 個別情報種別の正規化、現況構成、availability、通知判定、HTTP API は追加されない。
7. HTTP タイムアウトは 10 秒で、同一フィードの連続失敗時は 60 秒から上限 300 秒まで指数バックオフする。成功で連続失敗数をリセットする。
8. 同時に発生した取得要求は上流取得 1 回に集約される。
9. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が成功する。
10. migration、既存テーブル定義、`apps/web`、`packages/shared`、REST endpoint に差分がない。

## 8. 後続 Issue への引き継ぎ

- **C2 以降**: C1 が残す原文・共通ヘッダ・Atom ID・ハッシュを入力に、種別固有の厳密な XML 解析、地域判定、正規化、採用結果更新を行う。C1 の共通検証を種別固有の検証で置き換えない。
- **C12**: 初期化・復旧時に長期 2 フィードを `pollOnce('initial' | 'recovery')` で取得し、現況復元、初期取得済み状態、通知再評価を実装する。C1 は長期フィード取得機能だけを提供する。
- **C13**: フィード単位の初期バックオフを、取得元別の状態・監視情報・設定値変更可能な再試行ポリシーへ拡張する。受信履歴を自動削除しない。
- **C14**: C1 の注入可能な通常周期を、JST の時間帯別 60 / 120 / 300 秒と夜間方針へ置き換える。タイマーを重複起動しない。
- **E11**: C1 の `start` / `stop` / `pollOnce` を、要求 ID・操作履歴・全体一括制御に接続する。C1 の in-flight 集約を操作要求の重複防止と混同しない。
- **E10/K6**: `fetch_attempt` を集計して、取得元別の最終試行、最終成功、連続失敗、次回予定を提示する。

## 9. 未確認事項

高頻度フィード本体の実 GET は、取得方法レポート作成時点で未実施である。製造時はテスト用ローカルサーバーで契約を検証した上で、実運用に接続する前に提供元の実レスポンス、Atom link の形、HTTP 応答、掲載件数を限定的に確認する。確認結果を理由に URL 自作、全電文の反復取得、長期フィードの通常ポーリングへ変更してはならない。

本文原文の無制限保存による容量は、Issue #7 が Epic C 着手時に実際の取得頻度を踏まえて統括判断すると引き継いだ事項である。本 Issue では、全件保存・自動削除なしの既存方針を変更しない。

