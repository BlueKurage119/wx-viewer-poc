# Issue #296 起動時のシステム通知アラート抑止(鳴動済み記録と解消済み異常の抑止) 設計書

## 1. 背景・目的と範囲

アプリ起動(端末接続)時に、サーバー起動以降のシステム通知が解消済みを含めて大量にアラートになる。オーナーは、問いかけ区分のアラートに毎回応答することを負担に感じている。これを減らすため、次の2点を行う。

- 一度鳴らした system 通知は、同じサーバー世代のあいだは二度と鳴らさない(ブラウザに記録する)。
- cursor なしで取り直した分のうち、同じ取得分の中で解消済みの異常は鳴らさず、履歴にだけ残す。

範囲は次のとおり。

- 対象: `apps/web` の通知受信(`notifications/`)のみ。API・共通型(`packages/shared`)は変更しない。
- 対象外: スリープ復帰時の取得異常→復帰の誤検知、気象通知(weather)の挙動(4.6 に調査結果を記載)。

## 2. 参照資料と設計根拠

| 資料 | 導いた判断 |
| --- | --- |
| Issue #296・統括担当経由のオーナー確定仕様(5.1) | 基準は「鳴らした通知」。保存はブラウザ単位1キー・1,000件・24時間・世代ID付き。世代変更で保存と旧世代 system 通知を破棄。cursor なし取得では、未鳴動を鳴らし、同一取得分で解消済みの異常だけ履歴のみ。後続ポーリングは従来どおり。気象通知は変更しない。履歴は警報等一覧のみ |
| `apps/web/src/notifications/notificationFeedController.ts` `poll` | cursor なし取得は `generation === null`(=`first`)のときに起きる。`restart()` の呼び出し元は `start()`・`server_generation_changed`・応答世代の不一致の3つ。`cursor_out_of_range` は cursor だけ破棄して再取得し、`generation` は保持するので `first` にならない。`restart()` はストアを消さない |
| `apps/web/src/notifications/notificationStore.ts` | 通知エリア表示は `displayedNoticeForRow`(未確認のうち先頭)、ブザーは `receiveNotifications` の戻り値 `chime`(新着から最大レベル1件)と `nextUnconfirmedChime`。確認済み状態 `confirmedFeedKeys` はメモリのみ |
| `apps/web/src/warnings/warningListModel.ts` | 警報等一覧(`warningHistory`、24時間・500件)。新着は全件ここへ入り、K 端末では system 通知も表示される |
| `packages/shared/src/notificationFeed.ts`・`notification.ts` | system 通知の `feedKey` は `delta:<notificationId>`。`NotificationFeedItem` は `sourceType`・`changeType`・`targets`(`kind`・`codeType`・`code`)・`occurredAt`・`sequence` を持つ。解消判定はこれらだけで行える |
| `apps/api/src/notifications/*Planner.ts`・`runtime/startWorkerServer.ts` | 実在する system の `sourceType`・`changeType` を 4.4 の表に列挙した(コード読解) |
| `apps/web/src/notifications/notificationPreferences.ts` | localStorage の既存規約(キー `wx-viewer:<名前>:v1`、`storage` 依存注入、失敗時に例外を出さない)に倣う |
| 実測(統括担当調査) | 初回取得 system 44件(取得異常15・全て約30秒後に復帰済み、復帰17、DB初期化開始/完了6、遅延2、強制取得完了2、Worker応答不明2) |

## 3. 設計概要

1. **鳴動済み記録**: system 通知を「鳴らした」とみなした時点で `feedKey` を記録し、現在のサーバー世代IDと共に localStorage へ保存する。記録済みの通知は、受信経路を問わず通知エリア表示・ブザーの対象にしない(履歴には残る)。
2. **cursor なし取得の振り分け**: ページを開いたとき、または世代変更後の取り直しの system 応答では、新着を次の3つに振り分ける。
   - 記録済み: 履歴のみ
   - 同一取得分の中に解消通知がある異常: 履歴のみ
   - それ以外(未解消の異常・情報系の未鳴動): 鳴らす
3. **後続ポーリング**: 2回目以降と `cursor_out_of_range` 後の再取得は従来どおりアラートにする(記録済みは除く)。重複は既存の `items` 照合で除かれる。
4. **世代変更**: 保存の世代IDが今の世代と違うとき(ページを開いたとき)、または運用中に世代変更を検知したときは、保存した記録を破棄する。運用中の場合は、ストア内の旧世代 system 通知も破棄する。その後の取り直しは 2 のルールで扱う。

「アラート対象外」の判定は次に一本化する。

```ts
/** 通知エリア・未読・件数・ブザーの対象外か(確認済み、履歴のみ、または鳴動済み)。 */
export function isSettled(state: NotificationUiState, feedKey: string): boolean;
```

## 4. 詳細設計

### 4.1 ストア(`notificationStore.ts`)

- `NotificationUiState` に次の2つを追加する。
  - `historyOnlyFeedKeys: ReadonlySet<string>`(保存しない)
  - `alertedFeedKeys: ReadonlySet<string>`(鳴動済み。保存対象)
- `receiveNotifications(state, incoming, mode, receivedAtMs, preferences, options: { readonly initialFetch?: boolean } = {})` を拡張する。
  - 新着のうち `alertedFeedKeys` にあるものは `historyOnlyFeedKeys` に入れ、未読・ブザーの対象外にする。これは全経路共通。
  - `initialFetch === true` のときは、さらに `resolvedAbnormalFeedKeys(newItems)`(4.4)の結果も `historyOnlyFeedKeys` に入れる。
  - 履歴のみの通知は、`unreadFeedKeys`・`warningPresentationByFeedKey`(自動確認)・質問の割り込み・`chime` 候補から除く。`items` と `warningHistory` には従来どおり入れる。
- 鳴動の記録は `markAlerted(state, feedKeys): NotificationUiState` で行う。記録の時点はブザーの対象にした時点(確定 U-1)。`receiveNotifications` で `chime` 候補になった新着の system 通知すべてを記録する(実際に鳴るのは最大レベルの1件でも、候補全件を記録する)。
- `restoreAlertedFeedKeys(state, feedKeys)`: 保存からの復元。
- `discardPreviousGeneration(state, mode)`: 次の破棄を行う。選択中の質問が消えた場合は選択を解除する。
  - `origin === 'system'` の通知を `items`・`warningHistory`・`warningPresentationByFeedKey` から除く。
  - その `feedKey` を `confirmedFeedKeys`・`historyOnlyFeedKeys`・`unreadFeedKeys`・`alertedFeedKeys` から除く。
  - weather 通知は除かない(仕様6)。
- `displayedNoticeForRow`・`nextUnconfirmedChime`・`notificationCounts`・`confirmNotification`・`autoConfirmation.ts` の判定を `isSettled` に置き換える。
- オプション省略時、かつ `alertedFeedKeys` が空のときの挙動は現行と同じであること。

### 4.2 コントローラ(`notificationFeedController.ts`)

依存を次のように拡張する。

```ts
receive: (items: readonly NotificationFeedItem[], options?: { readonly initialFetch?: boolean }) => void;
/** cursor なしの system 応答で世代IDが確定したとき、receive より先に呼ぶ。 */
onGeneration: (serverGenerationId: string, reason: 'page_open' | 'changed') => void;
```

- `restart()` を世代変更の経路(`server_generation_changed`、応答世代の不一致)から呼ぶときは `generationChanged = true` を立てる。`start()` からの呼び出しでは立てない。
- system の ready 応答で `first` のときは、`onGeneration(id, generationChanged ? 'changed' : 'page_open')` を呼んでから `receive(items, { initialFetch: true })` を呼び、フラグを戻す。
- `cursor_out_of_range` 後の再取得は `first` にならないため、`initialFetch` を付けない(既存挙動)。
- weather 側の `receive` は変更しない。

### 4.3 鳴動済み記録の保存(新規 `notifications/alertedFeedKeyStore.ts`)

```ts
export const ALERTED_FEED_KEYS_STORAGE_KEY = 'wx-viewer:notification-alerted:v1';
export const ALERTED_FEED_KEYS_LIMIT = 1000;
export const ALERTED_FEED_KEYS_DURATION_MS = 24 * 60 * 60 * 1000;
export interface StoredAlert { readonly feedKey: string; readonly alertedAtMs: number; }
export interface StoredAlerts { readonly serverGenerationId: string; readonly entries: readonly StoredAlert[]; }
export function createAlertedFeedKeyRepository(
  storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): {
  /** 世代一致なら期限内のキーを返す。不一致なら保存を削除して []。失敗時は []。 */
  load(serverGenerationId: string, nowMs: number): readonly string[];
  /** delta: キーのみ、期限内・新しい順に上限まで保存。失敗は握りつぶす。 */
  save(value: StoredAlerts, nowMs: number): void;
  clear(): void;
};
```

- 保存対象: `origin === 'system'` の `delta:` キーのみ。
- 結線(`useNotificationFeed.ts`)は次のとおり。
  - `onGeneration(id, 'page_open')`: `load` の結果を `restoreAlertedFeedKeys` で取り込む。世代不一致の場合は `load` の中で破棄済み。
  - `onGeneration(id, 'changed')`: `clear()` → `discardPreviousGeneration` の順に行う。
  - `alertedFeedKeys` が増えたら、現在の世代IDで `save` する。
- 既存の確認済み状態(`confirmedFeedKeys`)は保存しない。基準は「鳴らした通知」に変わったため。

### 4.4 解消済み異常の判定

```ts
/** 同一取得分の中に、後続の解消通知がある異常の feedKey を返す。 */
export function resolvedAbnormalFeedKeys(items: readonly NotificationFeedItem[]): ReadonlySet<string>;
```

- 「後続」の判定: 同じ対象キーを持ち、(`occurredAt`, `sequence`) が異常より後であること。
- 対象キー: `sourceType` と、`targets` の `codeType:code` の並び(実際に保持される値は製造時に実データで確認する。実挙動未確認)。

実在する system の `sourceType`・`changeType` と、解消の対応案を次の表に示す。表はコード読解の結果で、推奨案のとおり確定した(U-2)。

| sourceType | changeType(区分) | 種別 | 解消する通知(推奨案) |
| --- | --- | --- | --- |
| `fetch_health` | `fetch_abnormal`(要確認) | 異常 | 同系統の `fetch_recovered` |
| `fetch_health` | `fetch_delayed`(警告) | 異常 | 同系統の `fetch_recovered` |
| `fetch_health` | `fetch_recovered` | 情報 | — |
| `database_recovery` | `database_recovery_started` | 情報(完了があっても一度鳴らす。U-3) | — |
| `database_recovery` | `database_recovery_delayed` | 異常 | `database_recovery_completed` |
| `database_recovery` | `database_recovery_failed`(要確認) | 異常 | 対応先なし(未解消) |
| `database_recovery` | `database_recovery_completed` | 情報 | — |
| `weather_worker` | `report_stale`(警告) | 異常 | 同 role の `restart_completed` |
| `weather_worker` | `initialization_failed`・その他の停止理由コード(要確認) | 異常 | 同 role の `restart_completed` |
| `weather_worker` | `restart_completed` | 情報 | — |
| `fetch_control` | `fetch_operation_unknown` | 異常 | 対応先なし(未解消) |
| `fetch_control` | `force_fetch_failed`・`force_fetch_aborted` | 異常 | 対応先なし(未解消) |
| `fetch_control` | `service_stopped`(要確認) | 異常 | 対応先なし(未解消。表に明記していなかったが U-2 の規則で未解消扱い) |
| `fetch_control` | `fetch_manually_started`・`fetch_manually_stopped`・`force_fetch_completed` | 情報 | — |
| `initial_sync` | `initial_sync_failed`(要確認) | 異常 | 対応先なし(未解消) |

- `weather_worker` は `notificationId` にワーカー世代を含み、停止理由コードは `WEATHER_RUNTIME_REASON_LABELS` のキーで可変になる。
- 表にない `sourceType`・`changeType` は未解消の異常として扱い、鳴らす(確定 U-2)。
- 情報系の通知は、解消済みの異常と同じ取得分に含まれていても、未鳴動なら一度鳴らす(確定 U-4)。

### 4.5 「履歴のみ」の場所

警報等一覧(`warningHistory`)のみ(確定)。

### 4.6 気象通知の調査結果(仕様として残す。オーナー了承済み)

コード読解による結果で、実測はしていない。根拠は `notificationFeedController` の `restart` がストアを消さないこと、`startupCurrentNotificationProjector`・`terminalSessionRepository`・`startupNotificationRepository` の実装。

- サーバー再起動時、起動時投影の `outputId` は毎回新しい UUID になる。このため警報等一覧で重複し、もう一度鳴る。
- 同じタブでは継続セッションになるため、再投影されるのは警報・特別警報・防災速報だけで、注意報は出ない。
- 注意報は、新しい世代で各会場について最初に問い合わせた端末にだけ出る。リロードでも同じ動きになる。

## 5. 確定事項

### 5.1 確定事項(仕様1〜7)

基準は鳴動、保存仕様、世代変更時の破棄、cursor なし取得の振り分け、後続ポーリングは従来どおり、`cursor_out_of_range` は初回扱いにしない、気象通知は不変、履歴は警報等一覧のみ。内容は2章冒頭の行と 4.3・4.5・4.6 に記載した。

### 5.2 追加ヒアリングの確定事項

| ID | 論点 | 確定内容 |
| --- | --- | --- |
| U-1 | 「鳴らした」とみなす時点 | ブザーの対象にした時点。`chime` 候補になった新着すべてを記録する |
| U-2 | 異常と解消通知の対応 | 4.4 の表のとおり。表にない種別は未解消の異常として扱い、鳴らす |
| U-3 | DB初期化開始 | 後に完了があっても、情報系として一度鳴らす |
| U-4 | 解消済み異常と同じ取得分にある情報系の通知(復帰など) | 情報系として一度鳴らす |
| U-5 | 確認済み状態の保存 | 保存しない。確認していない問いかけは、リロード後は通知エリアに出さず鳴らさない。警報等一覧にだけ残る。応答漏れのリスクはオーナーが受け入れた |

## 6. 受け入れ条件

前提:

- `npm run test -w apps/web` が通ること。
- 画面確認はダークテーマ・K 端末で行う。
- API の再起動が必要な項目は、通常の開発用とは別ポート・別データディレクトリで起動した API を使い、web をそのポートに向けて行う。手順は統括担当の指定に従う。

1. **単体: 解消済み異常は鳴らない** — 同じ対象キーで `fetch_abnormal` → `fetch_recovered` の順に並ぶ取得分を `initialFetch: true` で受信させる。異常の `feedKey` が `historyOnlyFeedKeys` に入り、`chime` 候補・`displayedNoticeForRow`・未確認件数に現れず、`warningHistory` には含まれることを確認する。
2. **単体: 未解消の異常は鳴る** — `fetch_abnormal` だけの取得分を同様に受信させ、`chime` が当該通知になり、通知エリアに表示されることを確認する。順序が逆(復帰が先、異常が後)の場合と、別系統の復帰しかない場合も鳴ることを確認する。
3. **単体: 情報系は一度だけ鳴る** — `force_fetch_completed` を受信させると `chime` が返り、ブザーの対象にした時点で `alertedFeedKeys` に入ることを確認する。新着に `chime` 候補が複数ある場合(例: 復帰2件と DB初期化開始1件)は、鳴る1件以外も含めて候補全件が記録されることを確認する。同じ `feedKey` を含む取得分を再度(`initialFetch` の有無の両方で)受信させても、`chime === null` で通知エリアに出ないことを確認する。
4. **単体: 対応表** — 4.4 の表の各行について、次をパラメータ化テストで確認する。
   - 解消の組がある異常は履歴のみになる。
   - 対応先なしの異常(`service_stopped` を含む)と、表にない架空の種別(例: `sourceType: 'unknown_source'`)は鳴る。
   - `database_recovery_started` は、後に `database_recovery_completed` があっても鳴る。
   - `fetch_recovered` は、対になる `fetch_abnormal` が履歴のみになった取得分の中でも鳴る。
5. **単体: 後続ポーリング・cursor_out_of_range** — fake の依存でコントローラを動かし、2回目の system 応答と `cursor_out_of_range` 後の再取得の `receive` に `initialFetch` が付かないこと、`onGeneration` が呼ばれないことを確認する。後者で、既に受信済みの `feedKey` が新着として扱われないことも確認する。
6. **単体: 世代の扱い(コントローラ)** — `start()` 後の最初の応答で `onGeneration(id, 'page_open')` が `receive(..., { initialFetch: true })` より先に呼ばれることを確認する。`server_generation_changed` の後、および応答世代の不一致の後は `onGeneration(newId, 'changed')` と `initialFetch: true` になることを確認する。
7. **単体: 世代変更の破棄(ストア)** — system 通知2件(鳴動済み・確認済み各1)と weather 通知1件を持つ state に `discardPreviousGeneration` を適用する。system 2件が `items`・`warningHistory`・各集合から消え、weather は残ることを確認する。続けて取り直し分(未解消の異常1・解消済み異常の組1)を `initialFetch: true` で受信させ、前者だけが鳴ることを確認する。
8. **単体: 保存** — fake storage で次を確認する。
   - (i) `G1` で保存し `load('G1')` で復元できる。
   - (ii) weather・`startup:` のキーは保存されない。
   - (iii) 1,001件を保存すると最古の1件が落ちる。24時間を超えた項目は `load` で返らない。
   - (iv) `load('G2')` は `[]` を返し、保存キーが削除される。
   - (v) 破損 JSON・型不一致・`getItem`/`setItem`/`removeItem` の例外で `[]` を返し、例外を出さない。
9. **画面: 起動時の振り分け** — 取得異常→復帰が発生済みのサーバーで、localStorage を空にしてページを開く。次を確認する。
   - 解消済みの取得異常が通知エリアに出ず、警報等一覧には並ぶ。
   - 情報系の通知は鳴る。
   - DevTools の Application で `wx-viewer:notification-alerted:v1` に、鳴った通知の `delta:` キーと、`GET /api/notifications/delta` 応答と同じ `serverGenerationId` が保存されている。
10. **画面: リロードで鳴り直さない** — 9 の直後にリロードし、9 で鳴った通知が通知エリアに出ず、ブザーも鳴らないことを確認する。
11. **画面: 後続の新着は鳴る** — 10 の状態のまま強制取得などで新しい system 通知を発生させ、15秒以内に通知エリアに出てブザーが鳴ることを確認する。
12. **画面: 運用中の世代変更** — 別ポート・別データの API で 11 まで行い、ページを開いたまま API を再起動する。次を確認する。
    - 警報等一覧から再起動前の system 通知が消える。
    - 保存が新しい世代IDの内容だけになる(または削除される)。
    - 新しい世代の未解消の異常と情報系の通知が一度鳴る。
13. **画面: ページを開いたときの世代不一致** — 12 の API を停止した状態でページを閉じ、API を起動し直してからページを開く。旧世代の保存が破棄され、取り直し分が 9 と同じ振り分けになることを確認する。
14. **画面: 気象通知は不変** — 発表中の警報等がある状態でページを開き、weather の現況通知が従来どおり通知エリアに出ることを確認する。
15. **画面: 未確認の問いかけはリロード後に出ない** — 9 または 11 で鳴った問いかけ区分の system 通知を確認しないままリロードし、通知エリアに出ず鳴らないこと、警報等一覧には残っていることを確認する。
16. `npm run lint` / `npm run typecheck` / `npm run format:check` がエラーなし。

## 7. 後続への引き継ぎ・残留リスク

- 情報系の通知は鳴るため、起動時の鳴動件数は実測ベースで復帰17件などが残る(確定 U-4)。
- 気象通知はサーバー再起動・リロードで重複・再鳴動する(4.6、仕様として残る)。
- 対象キー(`targets` の中身)の実データでの一意性と、`notificationId` がリロードをまたいで安定であることは、コード読解のみで実挙動未確認。
- 確認済み状態(`confirmedFeedKeys`)は保存しない(確定 U-5)。鳴らした後に確認しないままリロードすると、その問いかけは通知エリアに再表示されず、警報等一覧にだけ残る。応答漏れのリスクはオーナーが受け入れた。
- **申し送り(#296 の範囲外、別 Issue で扱う)**: 問いかけ区分の system 通知を警告区分に格下げするかの検討。
  - オーナーが挙げた候補(原文のまま): 「格下げは（取得異常・DB失敗・強制取得失敗あたりが妥当か？）」
  - 統括担当の見立ては次のとおり。
    - サービス停止(`service_stopped`、履歴で255件): 格下げの有力な候補。
    - 強制取得失敗(`force_fetch_failed`): 格下げの候補。
    - Worker の異常: 自動で復旧するなら候補。
    - 取得異常(`fetch_abnormal`): 基本設計 8.4 で【確定】した問いかけのため、格下げは確定事項の変更になる。
    - DB初期化失敗・初期同期失敗: 人の対応が必要なため、問いかけのままが妥当。
  - 違いの要点: オーナーは DB失敗を候補に挙げているが、統括担当の見立てでは問いかけのままが妥当。また、オーナーの候補にサービス停止は入っていない。
- 非 K 端末は system 通知を表示しないため、画面上の効果は K 端末でのみ観察できる。
