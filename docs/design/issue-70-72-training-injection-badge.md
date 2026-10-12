# Issue #70・#72: 訓練電文の注入要求処理と isTraining 伝播・訓練バッジ

## 状態と目的

**設計完了（2026-10-12 追加判断 H1〜H8 反映）。** Issue #70（J2）と #72（J4）を1つのPR（予定ブランチ `feature/issue-70-72-training-injection-badge`）で実装する。

- J2: J1（#69）で生成し、ブラウザに保存した訓練用合成電文を、**実際に受信したものとして**既存の取得・検証・正規化・通知判定パイプラインへ投入する。警報・注意報の訓練状態を成立させるため、投入の送信後にサーバーが訓練用 VPWS50 基準電文を生成し、警報系電文より先に同じパイプラインへ投入する（H1）。
- J4: 実装済みのバックエンド `isTraining` 伝播を実行して確かめたうえで、未接続の UI（下部通知領域・警報一覧・各パネル見出し）に共通部品 `TrainingBadge` を付ける。

未判断事項は残っていない（[判断済み事項](#追加ヒアリングで判断済みの事項2026-10-12)）。

## ヒアリング済み事項（2026-10-12 ユーザー承認済み）

J2:

1. 【確定】注入APIの入力: クライアントが生成済みXML（J1のプレビュー結果＝localStorageのストック）を送る。サーバーは生成検証（`verifyGeneratedTelegram` 相当: parser照合・Status=訓練・合成バナー・対象区域）を再実行し、通ったものだけを投入する。任意のXMLは受けない（検証失敗は拒否）。
2. 【確定】時刻: XMLは書き換えずそのまま投入する。状態判定は既存パイプラインの挙動に任せる。拒否される場合は理由を返す。
3. 【確定】受信の身元: 訓練専用の sourceKind/feedKind と documentUrl（`training://...`）を使い、取得監視の集計（取得元別テーブル等）と実監視storeを汚さない。`pollSingleFeed` 内のHTTP取得と一体になった電文処理を、XML文字列を受ける関数へ切り出す（既存挙動を変えない回帰確認を受け入れ条件に含める）。
4. 【確定】訓練ID: 注入1回につき訓練ID（UUID）を1つ付与し、訓練ID↔受信レコードの対応を記録する最小限の注入記録テーブルを持つ（J3の抹消範囲決定の土台）。複数同時の注入は訓練IDごとに独立。
5. 【確定】権限: K端末のみ（J1と同じ terminalRegistry の mode 検証）。確認ダイアログは追加しない（既存の「アクションボタン→送信ボタン」の2段階で足りる。レベル4以上の追加ダイアログも入れない）。
6. 【確定】通常の取得・検証・正規化・通知判定パイプラインを経由する。直接の通知・データ生成は禁止（[基本設計](../basic-design.md) §3.4）。

J4:

7. 【確定】共通部品 `TrainingBadge`（文言「訓練」）を作り、既存 `detail-dialog-training-label` の見た目・色トークンに揃える（HEX直書き禁止、[06-ui-md3-protocol.md](../rules/06-ui-md3-protocol.md)、検証はダークテーマのみ）。置き場所は下部通知領域の各カード、警報一覧の各行、各パネルの見出し付近（パネルは `isTraining` が真の応答に対してのみ）。
8. 【確定】通知領域・警報一覧は訓練を通常と同じ一覧に混在表示しバッジを付ける。5章の各パネルは `controlStatus:'normal'` 固定のまま、訓練の表示切替は入れない（結果として**UI上のパネルには訓練が出ない**）。パネル側は `isTraining` で出し分ける実装にとどめる。
9. 【確定】訓練通知も通常通知と同様にヘッダーブザーを鳴らす。
10. 【確定】バックエンドの `isTraining` 伝播（planner・出力履歴・通知フィード等）は実装済み。再実装せず、実行して確認したうえで、API/UIの未接続部分だけを範囲とする。未対応を実装済みと扱わない。

範囲外: J3（抹消要求・取消電文）、J5（受入条件検証での訓練除外）、パネルの訓練表示切替。

## 調査根拠と実測結果

### 参照資料

| 参照 | 確認した内容・設計への影響 |
| --- | --- |
| [基本設計](../basic-design.md) §3.4 | 注入は通常パイプライン経由。`isTraining` を6.2・7.3・8.1へ伝播し、通知領域・警報一覧・各パネルにバッジ |
| [J1設計](issue-69-training-telegram-generator.md) | 生成は決定的（同じ引数に同じ出力）。ストックは `wx-viewer:training-stock:v1:{terminalId}`。ツールバーは監視と共通部品。J2で「投入」を選択型項目として足す |
| [棚卸し](../audit-epic-a-d.md) AD-H067 | 訓練UI・注入権限・複数訓練が未決。本書末尾で結論を記録 |
| [取得ポーラー](../../apps/api/src/polling/jmaXmlPoller.ts) `pollSingleFeed` | 個別電文のHTTP取得成功後に、ハッシュ→`parseTelegramXml`→`recordTelegramReception`→種別ごとのprocessorを `runWeatherUpdate` 内で実行。ここを切り出す |
| [電文エンベロープ解析](../../apps/api/src/polling/jmaXmlFeedParser.ts) `extractTelegramTypeFromUrl` | **電文種別は documentUrl から正規表現 `_([A-Z]{4}\d{2})_` で取る。** XML本文からは取らない |
| weather DB スキーマ（[weather/0001_baseline.sql](../../apps/api/migrations/weather/0001_baseline.sql)） | 下記「スキーマ制約」 |
| [取得Worker](../../apps/api/src/runtime/acquisitionWorker.ts)・[取得ランタイム](../../apps/api/src/runtime/createAcquisitionRuntime.ts)・[Workerホスト](../../apps/api/src/runtime/acquisitionWorkerHost.ts) | weather DB の書き手は取得Worker。HTTPメインからは `host.call(method, value, timeout)` で呼ぶ。新しいmethodは payload レーン（上限8MB、256KB単位で分割）に入る |
| [監視集計](../../apps/api/src/repositories/telegramReceptionRepository.ts) `summarizeAdoptionResults`・`listRecentAdoptionFailures` | 会場別採用件数（監視状況）と処理失敗サンプル（処理状況）が**全受信を集計**する。訓練注入の除外が必要 |
| [取得健全性ソース](../../apps/api/src/monitoring/fetchHealthSources.ts) | 取得元別テーブル・取得異常判定は `xml_feed_regular` 等の固定 sourceKind だけを集計。新 sourceKind は影響しない |
| [監視状況サービス](../../apps/api/src/monitoring/monitoringStatusService.ts) | 情報別状況は `controlStatus:'normal'` 固定で読む。訓練は混ざらない |
| [通知領域](../../apps/web/src/shell/NotificationArea.tsx)・[通知store](../../apps/web/src/notifications/notificationStore.ts)・[ブザー](../../apps/web/src/notifications/useHeaderBuzzer.ts) | `NotificationFeedItem.isTraining` は届いているが通知行に表示なし。ブザー選択は訓練を除外していない（H端末も weather 由来通知を表示する） |
| [警報一覧](../../apps/web/src/warnings/WarningListView.tsx) | 既に `warning-list-flags` 内に「訓練」文字（secondary-container配色）を出している。`TrainingBadge` へ置換する |
| [パネル枠](../../apps/web/src/map/panels/InfoPanelFrame.tsx)・[パネル入力型](../../apps/web/src/map/panels/panelDefinitions.ts) | `InfoPanelCardInput` に訓練の項目がない。6パネルの組立てhookは応答の `isTraining` を持つ |
| [詳細ダイアログ](../../apps/web/src/map/detail/detail.css) `.detail-dialog-training-label` | `tertiary-container`／`on-tertiary-container`、角丸999px、12px・600、padding 2px 10px |

### スキーマ制約（weather DB、実物確認）

- `telegram_reception.fetch_attempt_id` は **NULL可・外部キーなし**。`feed_kind`・`feed_entry_id` は NULL可・空文字不可・**値の列挙制約なし**。`document_url` は NOT NULL・空文字不可・**一意制約なし**（索引のみ。重複抑止はアプリの `hasTelegramReception`）。`control_status` は `normal|training|test|NULL`。
- `fetch_attempt.source_kind`・`trigger_kind` は NOT NULL・空文字不可・**列挙制約なし**。`outcome` は `success|failure`、`attempt_no>=1`、`duration_ms>=0`。
- `telegram_reception_area`・`telegram_reception_adoption` は `reception_id` へ `ON DELETE CASCADE`。
- 受信の自動削除処理は存在しない（`deleteTelegramReception` はテストからのみ使用）。weather DB の再作成（DB回復）では全消去される。
- 既存スキーマ変更は不要。訓練の身元は既存列の値で表せる。新規テーブルだけを追加する。

### 実測（2026-10-12、一時スクリプトで既存 `pollSingleFeed` に J1 生成XMLを偽の取得関数経由で流した。一時ファイルは削除済み）

| 試行 | 結果 |
| --- | --- |
| 生成直後、初期判定済み（tracker完了）。レベル３大雨警報・線状降水帯発生・竜巻注意 | 3通とも受信・採用行が作られ `control_status=training`。採用結果は east が全件「…として解析済み」、trc は警報が「対象地域外」、速報2通は「解析済み」。**通知は速報の4件（east/trc×2）だけ、すべて `isTraining=true`。警報の通知は0件** |
| 同上で `warning_current_snapshot` を確認 | **0件**。`applyWarningCurrentReception` が「有効な VPWS50 による初期化が完了していません」（`uninitialized`）で終わる。訓練状態用の VPWS50 が無いため（下記 H1） |
| 疑似の訓練 VPWS50（J1生成XMLを VPWS50 名のURLで流したもの）を先に流す | 警報の現況スナップショットが作られ、「気象警報発表 江東区 レベル３大雨警報」が `isTraining=true` で通知された。**VPWS50 さえあれば警報系も既存経路で通る**ことを確認（疑似VPWS50は形式検証していない。実装方式の根拠ではない） |
| 2日前の時刻で生成したXMLを投入 | 受信・採用は「解析済み」。速報の通知は `[expired] 有効期限が切れています` でスキップ（VPBS50 は発表から約3時間、VPHW50 は ValidDateTime で失効）。スキップ理由はログだけで、採用結果には残らない |
| 初期判定未完了（起動直後の収集中） | 速報も通知0件（既存の初期収集抑止） |
| 取得監視への影響 | `fetch_attempt` は `xml_feed_extra` と `xml_document` の行として記録された（偽フィード経由のため）。**本設計の注入はフィードを経由しないので、`xml_document` 行を作らない** |
| 生成の再現性 | 10通×2時刻（月末・年末を含む）で、電文単体の `itemIds`・`generatedAt`・`generationId` から再生成したXMLが**元の生成XMLとバイト一致**（20/20） |
| 生成検証の強度 | `verifyGeneratedTelegram` は Headline 本文を改ざんしたXMLを**通してしまう**。検証だけでは「任意XMLを受けない」を満たせない |
| XMLサイズ | 単項目の最大 6,695 bytes（高潮特別警報）、VPWW61 に7注意報すべてを含む場合 13,927 bytes。ストック1件分のJSONは最大約15,000 bytes |

会場構成はローカル設定（`config/venues.local.yaml`）に `omiya` が含まれていたため、上記には omiya の採用行（対象地域外）もあった。会場数は環境で変わる。

### 実測（2026-10-12 追加、H1=A案の成立確認。一時スクリプト、削除済み）

本書の基準電文の形（下記「訓練用 VPWS50 基準電文」）を手組みし、既存 `pollSingleFeed` に偽フィードで流した。訓練の初期判定 tracker は実ランタイムと同じ「未完了」のまま開始した。

| 試行 | 結果 |
| --- | --- |
| 基準電文を既存 `parseWarningTelegram`（江東区）に通す | `ok`。Kind は `no_warning`（`dateTime`＝基準の発表時刻）1件 |
| 1) 基準電文（発表 T−1分）→レベル３大雨警報（発表 T） | 訓練の現況スナップショットが1件でき、明細は「レベル３大雨警報」。通知は「気象警報発表 江東区 レベル３大雨警報」1件（`isTraining=true`）。**基準電文自体の通知は0件**（空の差分。tracker はここで完了になり、後続の警報は通常判定で通知される） |
| 2) 2回目の注入（基準電文なし）で雷注意報（発表 T+10分） | 明細は「レベル３大雨警報、雷注意報」。**先の警報は消えない**。通知は雷注意報の1件 |
| 3) 基準より前の古いストック（強風注意報、発表 T−30分） | 現況は変わらず通知0件（既存の版比較で採用されない） |
| 4) 【反例】訓練現況がある状態で、新しい基準電文（発表 T+19分）を再投入 | 明細が空になり、「気象警報等解除」通知が2件出た。**基準電文を毎回投入すると先の訓練状態を消す**。よって「訓練の VPWS50 ストリームが無いときだけ投入」が必要 |

既存リデューサーは、個別電文の発表時刻が VPWS50 の基準時刻より**厳密に新しい**ときだけ個別電文を採用する。同時刻の場合は内容一致を要求し、「なし」と警報では競合（`same_version_conflict`）になる（`jmaWarningCurrentReducer.ts` の `reduceWarningCurrent`）。このため、基準の発表時刻は投入する警報系電文の最も早い発表時刻より前にする。

基準電文の形の出典: 公式サンプル `../../../docs/260907_weather-data/jmaxml_20260723_Samples/15_18_01_250630_VPWS50.xml`。次の点を照合した。

- Control/Title は「気象警報・注意報（Ｒ０６）（集約通報）」、Head/Title は「警戒・注意事項集約定時通報」。
- EventID・Serial は空、InfoKindVersion は 1.5_0、Headline/Text は空。
- 4層の Warning がある。発表のない区域の Item は Kind/Status＝「発表警報・注意報はなし」と Area だけで、ChangeStatus 等は無い。
- Kind/DateTime（type＝発表時刻）は市町村等の層だけにあり、上位3層には無い。

## 追加ヒアリングで判断済みの事項（2026-10-12）

- **H1【確定】A案。** 投入ボタンの送信後、サーバーが訓練用 VPWS50 基準電文（発表中の警報・注意報なし）を生成し、警報系電文より先に通常パイプラインへ投入する。詳細は「[訓練用 VPWS50 基準電文](#訓練用-vpws50-基準電文h1)」。基準電文は J1 の生成項目表に**追加しない**（ユーザーの操作対象外。項目一覧・ストック・プレビューに出さない）。
- **H2【確定】** 受理には、同じ引数から再生成したXMLとのバイト一致を必須とする（生成検証だけでは本文の改ざんを通すため）。将来テンプレートを改訂すると、改訂前のストックは注入できなくなる。
- **H3【確定】** 「訓練IDごとに独立」の範囲は、訓練ID・注入記録・受信の分離まで。警報の現況・速報の状態は「会場×訓練」で共有し、別の訓練の注入どうしで統合・上書きされる（既存パイプラインの仕様のまま）。
- **H4【確定】** 取得Workerが ready なら、取得の開始・停止に関係なく注入を受け付ける。起動直後の初期収集中は、既存の抑止で速報の通知が出ない。
- **H5【確定】** 監視の集計（会場別採用件数・処理失敗サンプル）からは除外し、受信履歴一覧・詳細には残す。
- **H6【確定】** 訓練通知は、同じ会場の H端末にも表示し、ブザーも鳴らす（現行の挙動を変えない）。
- **H7【確定】** 投入成功時は、投入した行のチェックを外す。失敗時は維持する。
- **H8【確定】** 返す理由は会場ごとの採用結果まで。現況の `stale`／`duplicate`、速報の `expired` 等の通知スキップ理由は返さない。

## 全体の流れ

```
[K端末 訓練画面] 一覧でチェック → ツールバー「投入」→「送信」
   │ POST /api/training/inject  { terminalId, telegrams:[{previewId, generatedAt, itemIds, telegramType, xml}] }
   ▼
[HTTPメイン] TrainingInjectionService
   1. 端末検証（K のみ）・入力形式検証
   2. 各電文: 同じ引数で再生成 → バイト一致 → verifyGeneratedTelegram（失敗が1つでもあれば全体を投入せず 422）
   3. 訓練ID（UUID v4）採番、投入順へ並べ替え
   4. TrainingInjectionPort.inject(command)  ── host.call('training.inject', command, 30s)
   ▼
[取得Worker] createAcquisitionRuntime().injectTraining(command)   ※注入どうしは直列化
   training_injection 行（in_progress）
   警報系を含み、かつ江東区の訓練 VPWS50 ストリームが無い → 基準 VPWS50 を生成・検証し sequence 0 で先に投入
   各電文: fetch_attempt(source_kind='training_injection') → ingestTelegramDocument(…feedKind='training')
           └ 既存の parseTelegramXml → recordTelegramReception → 種別processor → 通知判定（runWeatherUpdate内）
           └ 同じ更新単位で training_injection_reception 行
   training_injection 行（completed）→ 採用結果つきの結果を返す
   ▼
[通常の配信経路] 通知 → 保持DB → 通知差分API → 下部通知領域・警報一覧・ブザー（isTraining=true にバッジ）
```

## 型・API契約（`packages/shared/src/trainingTelegram.ts` に追加）

```ts
export const TRAINING_INJECT_MAX_TELEGRAMS = 20; // ストック上限と同じ
export const TRAINING_INJECT_MAX_XML_BYTES = 32 * 1024; // 実測最大 13,927 bytes の2倍超
export const TRAINING_INJECT_MAX_BODY_BYTES = 384 * 1024; // 20通×実測最大約15KB に余裕

export interface TrainingInjectTelegram {
  /** J1 の TrainingTelegramPreview.id（`${generationId}:${index}`、index は 0〜9）。 */
  readonly previewId: string;
  /** J1 の TrainingGenerateResponse.generatedAt（UTC ISO、ミリ秒付き）。 */
  readonly generatedAt: string;
  readonly itemIds: readonly TrainingItemId[];
  readonly telegramType: TrainingTelegramType;
  readonly xml: string;
}
export interface TrainingInjectRequest {
  readonly terminalId: string;
  readonly telegrams: readonly TrainingInjectTelegram[]; // 1〜20、previewId 重複なし
}
export interface TrainingInjectAdoption {
  readonly venueId: string;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
}
export interface TrainingInjectedTelegram {
  readonly previewId: string;
  /** 注入内の投入順（基準電文を投入した場合は基準電文が 0、要求電文は 1 から。投入しない場合は要求電文が 0 から）。 */
  readonly sequence: number;
  readonly telegramType: TrainingTelegramType;
  readonly receptionId: number;
  readonly documentUrl: string;
  readonly adoptions: readonly TrainingInjectAdoption[]; // venueId 昇順
}
export interface TrainingInjectResponse {
  readonly trainingId: string; // UUID v4
  readonly injectedAt: string; // UTC ISO。Worker が受け付けた時刻
  readonly telegrams: readonly TrainingInjectedTelegram[]; // 要求電文のみ、sequence 昇順
  /** サーバーが生成・投入した訓練用 VPWS50 基準電文。投入しなかった場合は null。 */
  readonly baseline: {
    readonly sequence: 0;
    readonly receptionId: number;
    readonly documentUrl: string;
    readonly reportDateTime: string; // UTC ISO
    readonly adoptions: readonly TrainingInjectAdoption[];
  } | null;
}
export type TrainingInjectRejectReason =
  | 'regeneration_mismatch' // 再生成XMLと不一致
  | 'verification_failed'; // 生成検証の不合格
export function parseTrainingInjectRequest(value: unknown): TrainingInjectRequest | null;
export function parseTrainingInjectResponse(value: unknown): TrainingInjectResponse | null; // web 用
```

`parseTrainingInjectRequest` は plain object で `terminalId`・`telegrams` 以外のキーを拒否し、各要素も上記5キー以外を拒否する。`terminalId` は空でない文字列。`previewId` は `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]$`（小文字）。`generatedAt` は `new Date(v).toISOString() === v`。`itemIds` は既存 `parseTrainingItemIds` で検証（既知・重複なし・group内1個）。`telegramType` は既知10種。`xml` は空でない文字列でUTF-8 32KiB以下。

### HTTP: `POST /api/training/inject`

- 既存の `/api/training` 用 no-store ミドルウェアの対象に含める（成否すべて `Cache-Control: no-store`）。
- **ボディ上限:** 全体の `express.json()`（既定100KB）より前に、`app.use('/api/training/inject', express.json({ limit: '512kb' }))` を置く。ルート内で `Buffer.byteLength(JSON.stringify(req.body))` が `TRAINING_INJECT_MAX_BODY_BYTES` を超えたら 413 `request_too_large`。512kb 超でパーサーが拒否した場合も 413（既存エラーハンドラの形）で no-store。既存ルートのボディ上限は変えない。
- query 付きは 400 `invalid_request`。

| 条件 | 応答 |
| --- | --- |
| 形式不正・不明端末 | 400 `{status:'error',code:'invalid_request'}` |
| H端末 | 403 `forbidden_terminal` |
| 再生成不一致・検証不合格（1通でも） | 422 `{status:'error',code:'training_verification_failed',failures:[{previewId,reason}]}`。**1通も投入しない** |
| 注入ポート未構成・取得Worker未準備・busy | 503 `training_injection_unavailable` |
| Worker呼出しの期限切れ・結果不明 | 504 `{status:'error',code:'training_injection_result_unknown',trainingId}` |
| Worker内の途中失敗 | 500 `{status:'error',code:'training_injection_failed',trainingId}`（それまでの電文は投入済みのまま。注入記録は `failed`） |
| 成功 | 200 `TrainingInjectResponse` |

## サーバー設計

### モジュール

| ファイル | 責務 |
| --- | --- |
| `packages/shared/src/trainingTelegram.ts` | 上記の型・定数・検証関数 |
| `apps/api/src/services/trainingInjectionService.ts`（新規） | 端末検証、再生成＋バイト一致＋`verifyGeneratedTelegram`、訓練ID採番、投入順の決定、ポート呼出し、結果の HTTP 用分類 |
| `apps/api/src/training/trainingInjectionContracts.ts`（新規） | `TrainingInjectionCommand`・`TrainingInjectionResult`・`TrainingInjectionPort` の型。`TRAINING_FEED_KIND='training'`・`TRAINING_SOURCE_KIND='training_injection'`・`TRAINING_TRIGGER_KIND='training'`・`trainingDocumentUrl(trainingId, sequence, telegramType)` |
| `apps/api/src/polling/jmaXmlPoller.ts` | `ingestTelegramDocument` を切り出し、`pollSingleFeed` から呼ぶ |
| `apps/api/src/training/trainingInjector.ts`（新規） | Worker側の注入処理 `injectTrainingTelegrams(connection, command, deps)` |
| `apps/api/src/training/trainingWarningBaseline.ts`（新規） | 訓練用 VPWS50 基準電文の生成 `generateTrainingWarningBaseline` と検証 `verifyTrainingWarningBaseline`（純粋処理。DB・ネットワーク不要） |
| `apps/api/src/repositories/trainingInjectionRepository.ts`（新規） | 注入記録の読み書き |
| `apps/api/migrations/weather/0002_create_training_injection.sql`（新規） | 注入記録テーブル |
| `apps/api/src/runtime/createAcquisitionRuntime.ts` | `injectTraining(command)` を公開 |
| `apps/api/src/runtime/acquisitionWorker.ts` | `training.inject` メソッドの受付 |
| `apps/api/src/runtime/startWorkerServer.ts` | ポート実装（`host.call('training.inject', command, 30_000)`）と service の組込み |
| `apps/api/src/app.ts` | ルート追加・ボディ上限 |
| `apps/api/src/repositories/telegramReceptionRepository.ts` | 監視集計2関数から訓練注入を除外 |

`createApplicationRuntime`（インラインの試験用起動）には注入ポートを組み込まない。ポート未構成時は 503 を返す。

### 受理検証（HTTPメイン、DB不要）

各電文について、`generationId = previewId` の `:` より前、`index` は後ろ。

1. `regenerated = generateTrainingTelegrams(itemIds, { now: generatedAt, generationId })`。例外または長さが1以外なら `verification_failed`。
2. `regenerated[0].telegramType !== telegramType` または `regenerated[0].xml !== xml` なら `regeneration_mismatch`。
3. `verifyGeneratedTelegram(regenerated[0], { now: generatedAt, generationId })` が例外なら `verification_failed`。
4. 全電文を検査し終えてから、失敗があれば 422（失敗した全 previewId を列挙）。

鮮度（発表時刻の古さ）は検査しない（確定事項2）。

### 投入順・訓練ID

- 訓練ID は `crypto.randomUUID()`（UUID v4）。service の依存 `idFactory` で差し替え可能にする。
- 要求電文の投入順は `(reportDateTime 昇順, generatedAt 昇順, index 昇順)`。チェックした順や一覧の表示順（新しい順）には従わない。理由: 同じ種別のストリームでは古い発表が後に来ると、既存リデューサーが `stale` で捨てるため、受信順を発表順に揃える。メインはこの順を command の `order`（0始まり）で渡す。`sequence` は Worker が決める（基準電文を投入するときは `order + 1`、しないときは `order`）。

### Worker 契約（`trainingInjectionContracts.ts`）

```ts
export interface TrainingInjectionCommand {
  readonly trainingId: string;
  readonly terminalId: string;
  readonly requestedAt: string; // HTTPメインの受付時刻 UTC ISO
  readonly telegrams: readonly {
    readonly order: number; // 0 始まり。上記の投入順
    readonly previewId: string;
    readonly reportDateTime: string; // 再生成結果の発表時刻 UTC ISO（基準電文の時刻決定に使う）
    readonly telegramType: TrainingTelegramType;
    readonly xml: string;
  }[];
}
export type TrainingInjectionResult = TrainingInjectResponse;
export interface TrainingInjectionPort {
  inject(command: TrainingInjectionCommand): Promise<TrainingInjectionResult>;
}
```

- `acquisitionWorker.ts`: `if (method === 'training.inject') return runtime.injectTraining(value as TrainingInjectionCommand);`（`!runtime || closing || failureCode` のときは既存どおり `not_ready`）。
- ポート実装の例外の分類: `not_ready`・`busy` → 503、`handshake_timeout`・`deadline_exceeded`・`operation_result_unknown`・Worker終了 → 504、`training_injection_failed`（Worker内の処理失敗） → 500。
- **冪等性:** Worker は同じ `trainingId` の注入記録があれば、再処理せず記録から結果を組み立てて返す（`failed` 記録なら `training_injection_failed`）。メインは自動再送しない。

### 電文処理の切り出し（`jmaXmlPoller.ts`）

```ts
export interface TelegramDocumentInput {
  readonly documentUrl: string;
  readonly xml: string;
  readonly feedKind: string;
  readonly feedEntryId: string | null;
  readonly fetchAttemptId: number | null;
  readonly receivedAt: UtcIso8601String; // 受信時刻かつ採用判定時刻
  readonly bodyBytes: number | null;
  readonly contentHash: string; // xml の SHA-256 hex
}
export async function ingestTelegramDocument(
  connection: DatabaseConnection,
  input: TelegramDocumentInput,
  options: PollerContextOptions, // venueRegistry 必須（無ければ既存と同じ例外）
  hooks?: { readonly afterRecord?: (reception: TelegramReception) => void },
): Promise<TelegramReception>;
```

- 中身は現 `pollSingleFeed` の「共通エンベロープの解析」から「`runWeatherUpdate` / `commitReception()`」までを**そのまま**移す（エンベロープ不正時の全会場採用行、`receptionInput` の組立て、種別分岐、`telegramWeatherScopes` と `initialWarningKeys`／`initialBosaiKeys` の決定）。`hooks.afterRecord` は `commitReception` 内で `recordTelegramReception` の直後、processor より前に同期で呼ぶ。`commitReception` は記録した `TelegramReception` を返し、関数はそれを返す。
- `pollSingleFeed` は、個別電文の `fetch_attempt` 成功行を記録した後に `ingestTelegramDocument(connection, { documentUrl: docUrl, xml: docHttpResult.bodyText, feedKind: feedDef.kind, feedEntryId: entry.id, fetchAttemptId: docAttempt.id, receivedAt: docFinishedAt, bodyBytes: docHttpResult.responseBytes, contentHash: docHash }, options)` を await する。それ以外（フィード取得、重複抑止、カウンタ、失敗記録、中断）は変えない。
- 既存の公開関数名・引数・戻り値・DBへ書く値・ログは変えない。

### 注入処理（Worker、`trainingInjector.ts`）

```ts
export async function injectTrainingTelegrams(
  connection: DatabaseConnection,
  command: TrainingInjectionCommand,
  deps: PollerContextOptions & { readonly clock: () => UtcIso8601String },
): Promise<TrainingInjectionResult>;
```

1. 注入記録が既にあれば結果を返す（冪等）。
2. `training_injection` を `status='in_progress'`、`accepted_at=clock()` で挿入。
3. 基準電文の要否を判定し、要るなら生成・検証して `sequence=0` で投入する（[訓練用 VPWS50 基準電文](#訓練用-vpws50-基準電文h1)）。投入手順は次の要求電文と同じ（`fetch_attempt`→`ingestTelegramDocument`→対応行）。ただし `feedEntryId` は `{trainingId}:baseline`、対応行は `role='baseline'`・`preview_id=NULL`。
4. `order` 昇順に各要求電文（`sequence` は上記）:
   - `receivedAt = clock()`、`contentHash = sha256(xml)`、`bodyBytes = Buffer.byteLength(xml)`。
   - `documentUrl = training://{trainingId}/{sequence}_{telegramType}_training.xml`。【確定事項3の例 `training://<注入ID>:<連番>` から形を変えた理由】既存 `parseTelegramXml` が documentUrl の `_VPWW55_` 等から電文種別を決めるため。既存の解析関数は変えない。
   - `recordFetchAttempt`: `sourceKind='training_injection'`、`targetRef=trainingId`、`requestUrl=documentUrl`、`triggerKind='training'`、`attemptNo=1`、`startedAt=finishedAt=receivedAt`、`durationMs=0`、`outcome='success'`、`httpStatus=null`、`responseBytes=bodyBytes`、`itemCount=null`、`failedItemCount=null`、`contentHash`、`errorKind=null`、`errorMessage=null`。
   - `ingestTelegramDocument(connection, { documentUrl, xml, feedKind:'training', feedEntryId: previewId, fetchAttemptId, receivedAt, bodyBytes, contentHash }, deps, { afterRecord: (r) => insertTrainingInjectionReception(...) })`（対応行は `role='requested'`）。
5. 全件後に `status='completed'`、`finished_at`。途中の例外は `status='failed'`・`error_code` を記録して `training_injection_failed` を投げる（投入済み電文は戻さない。パイプライン経由でない削除はしない）。
6. 結果は記録と `telegram_reception_adoption` から組み立てる（`role='baseline'` の行は応答の `baseline`、`requested` の行は `telegrams`）。基準電文の生成・検証・投入が失敗した場合は、要求電文を1通も投入せず `failed` とする。

`createAcquisitionRuntime.injectTraining(command)` は `stopped` なら `not_ready`。`registry`・`runWeatherUpdate`・`warningEmitDeps`・`bosaiEmitDeps`・`clock` を渡す（取得ポーリングの有無・稼働状態には依存しない。H4）。取得ポーリングとの並行は既存の `runWeatherUpdate` の直列化に任せる。

**注入どうしの直列化（必須）:** `injectTraining` はランタイム内の Promise キュー（mutex）で1件ずつ実行する。基準電文の要否判定から最後の電文の投入までを他の注入と重ねない。理由: 同時の2注入がともに「VPWS50 なし」と判定して基準電文を2つ投入すると、後の基準電文が先の注入の警報を消すため（実測の反例4と同じ現象）。

### 訓練用 VPWS50 基準電文（H1）

**位置づけ:** 訓練の警報・注意報の現況を成立させるための、サーバー内部の合成電文。J1 の生成項目表（`TRAINING_ITEMS`）・項目取得API・プレビューAPI・ストックには**追加しない**。ユーザーが選ぶ・見る・送る対象ではない。来歴は `synthetic`（受信上は `feed_kind='training'`、注入記録上は `role='baseline'`）。

**投入する条件（すべて満たすとき）:**

1. 要求電文に警報・注意報（VPWW55〜61）が1通以上ある。速報（VPBS50・VPHW50/51）だけの注入では投入しない（速報は警報の現況を使わないため）。
2. `findWarningCurrentStream(connection, '130000', '1310800', 'training', 'VPWS50')` が null（江東区の訓練 VPWS50 ストリームが未初期化）。既に存在すれば投入しない。気象庁が実配信した訓練 VPWS50 で初期化済みの場合も投入しない。

条件2により、2回目以降の注入では基準電文を投入しない。先に注入した訓練の警報は消えない（実測2）。毎回投入すると先の状態を消す（実測の反例4）。区域は J1 の生成対象と同じ江東区に固定する（会場設定から求めない。J1 の生成区域が固定のため）。

**時刻:**

- 発表時刻 `Tb` = 要求電文のうち警報・注意報の `reportDateTime` の最小値 − 60秒（分単位、秒00）。リデューサーは個別電文の発表時刻が基準より**厳密に新しい**ときだけ採用するので、同じ時刻にしてはいけない。
- Head/ReportDateTime・TargetDateTime、および市町村等の層の Kind/DateTime（type=発表時刻）は `Tb` とする（JST `+09:00`）。
- Control/DateTime は Worker の `clock()`（秒切り捨て、UTC `Z`）。古いストックを注入した場合は、発表時刻と Control 日時が大きく離れる（時刻を書き換えない方針の帰結）。

**内容（公式サンプル 15_18_01 の構造に合わせる）:**

| 要素 | 値 |
| --- | --- |
| Control/Title・Status・EditorialOffice・PublishingOffice | `気象警報・注意報（Ｒ０６）（集約通報）`・`訓練`・`気象庁`・`気象庁` |
| Head/Title | `警戒・注意事項集約定時通報` |
| EventID・Serial | 空タグ |
| InfoType・InfoKind・InfoKindVersion | `発表`・`気象警報・注意報`・`1.5_0` |
| Headline/Text | `＊＊＊これは訓練です＊＊＊`（J1 の警報電文と同じ訓練表示行。Headline/Information は置かない） |
| Body/Warning | 4層（府県予報区等＝東京都130000、一次細分区域等＝東京地方130010、市町村等をまとめた地域等＝２３区東部130012、市町村等＝江東区1310800）に Item を1件ずつ置く。Kind は `<Status>発表警報・注意報はなし</Status>` だけ（市町村等の層のみ `<DateTime type="発表時刻">Tb</DateTime>` を続ける）。Area は Name・Code。ChangeStatus・FullStatus・EditingMark・Property は置かない |

名前空間・XML escaping・要素単位の組立ては J1 と同じ規則（`trainingXmlBuilder.ts` を使う）。サンプル全文の文字列置換はしない。Headline/Information を置かない点と、警報の無い区域だけの部分電文である点は、公式の全国定時通報とは異なる訓練用の形である（J1 の部分電文と同じ扱い）。

**ID:** 電文内の識別子（EventID・Serial）は空。アプリ側の識別は訓練ID と `sequence=0`、documentUrl `training://{trainingId}/0_VPWS50_training.xml`、`feed_entry_id` `{trainingId}:baseline`。

**検証（`verifyTrainingWarningBaseline(xml, { reportDateTime: Tb, controlDateTime })`）:** 投入前に必ず実行し、不合格なら注入全体を `failed` にする。

- 既存 `parseWarningTelegram(xml, { telegramType:'VPWS50', controlStatus:'training', reportDateTime, controlDateTime }, { municipalCode:'1310800', displayName:'江東区' })` が `ok`。
- 結果の `controlStatus='training'`、`telegramType='VPWS50'`、`area.code='1310800'`、`kinds` が `no_warning` 1件で `dateTime=Tb`、`eventId`・`serial` が null。
- 原文DOMで、Control/Status=訓練、InfoKindVersion=1.5_0、Headline/Text の1行目が訓練表示、Body/Warning が上記4層で各1 Item。

**通知:** 基準電文は「なし」から「なし」への状態なので、差分は空で通知を作らない（実測1）。訓練の初期判定 tracker が未完了なら、ここで完了になる。後続の警報電文は通常判定で通知される。

### 注入記録テーブル（`migrations/weather/0002_create_training_injection.sql`）

```sql
CREATE TABLE training_injection (
  training_id TEXT PRIMARY KEY CHECK (length(training_id) = 36),
  terminal_id TEXT NOT NULL CHECK (terminal_id <> ''),
  requested_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  finished_at TEXT,
  telegram_count INTEGER NOT NULL CHECK (telegram_count BETWEEN 1 AND 20), -- 要求電文の数（基準電文を含まない）
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> '')
);
CREATE TABLE training_injection_reception (
  training_id TEXT NOT NULL REFERENCES training_injection(training_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  reception_id INTEGER NOT NULL UNIQUE REFERENCES telegram_reception(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('requested', 'baseline')),
  preview_id TEXT CHECK (preview_id IS NULL OR preview_id <> ''),
  telegram_type TEXT NOT NULL CHECK (telegram_type <> ''),
  PRIMARY KEY (training_id, sequence),
  CHECK ((role = 'baseline') = (preview_id IS NULL)),
  CHECK (role <> 'baseline' OR (sequence = 0 AND telegram_type = 'VPWS50'))
);
```

weather DB に置く理由: 受信と同じ書き手・同じDB世代で整合し、DB回復で受信と一緒に消える。通知（保持DB）からは既存の `relatedRefs` の `telegram_reception` 参照と `weatherDatabaseGenerationId` で辿れる（J3で使う）。

### 取得監視・実監視storeの除外

| 箇所 | 対応 |
| --- | --- |
| `summarizeAdoptionResults`（監視状況の会場別採用件数）・`listRecentAdoptionFailures`（処理状況） | WHERE に `AND (t.feed_kind IS NULL OR t.feed_kind <> 'training')` を加える |
| 取得元別テーブル・取得異常判定（`fetchHealthSources`） | 変更不要（固定 sourceKind のみ集計） |
| 情報別状況（`monitoringStatusService`） | 変更不要（`normal` 固定） |
| 取得の初期取得状況・バックオフ・鮮度（`JmaXmlPollingService`） | 変更不要（注入はフィード取得を経由しない） |
| 受信履歴一覧・詳細 | 変更しない（H5） |

## Web 設計（J2: 投入操作）

- `trainingToolbarState.ts`: `TrainingToolbarSelection` に `'inject'` を追加。ルート定義の groups を `[[{select:'inject',label:'投入'}], [削除, 全削除]]` とする（投入は文字だけ、アイコンなし）。
  - 選べる条件: チェック1件以上かつ投入中でない。送信できる条件: 投入選択中・チェック1件以上・投入中でない。選択中に対象が0件・投入中になった場合は、削除と同じく選択を維持し送信だけ押せない。
  - 送信の `aria-label` は「投入を送信」。選択中の操作行は共通の `「投入を選択中／送信で実行」`。
  - 選択破棄の契機は J1 と同じ（送信・クリア・XMLダイアログを開く・画面離脱・端末切替）。
- 送信: 選択をクリアし、**送信時点でチェックされている行**の `telegram`（`id`→`previewId`、エントリの `generatedAt`、`itemIds`、`telegramType`、`xml`）で `POST /api/training/inject`。
- 投入中は操作行に `{n}通を投入中`。結果（次の選択・送信または画面離脱まで表示）:
  - 200: `{n}通を投入しました`。自端末の会場（端末定義の venueId）の採用結果が「…として解析済み」で終わらない電文が `m` 通あれば `{n}通を投入しました（{m}通は会場で採用されませんでした）`。投入した行のチェックを外す（H7）。基準電文は投入件数 `n`・`m` に数えず、画面にも出さない。
  - 422: `投入できませんでした（電文の検証に失敗しました）`。400: `投入できませんでした（要求が不正です）`。403: `投入できませんでした（この端末では操作できません）`。413: `投入できませんでした（電文が大きすぎます）`。503: `投入できませんでした（取得処理が利用できません）`。504: `投入結果を確認できませんでした`。500・通信失敗: `投入できませんでした`。失敗時はチェックを維持する。
- 投入要求は画面離脱・端末切替で abort しない（サーバー側は処理が進むため）。ただし離脱・切替後に届いた結果は表示しない。投入中の再送はできない。
- ストック（localStorage）の形式・キーは変えない（version 1 のまま）。生成・削除・全削除の挙動も変えない。
- `apps/web/src/api/training.ts` に `requestTrainingInject(terminalId, telegrams, signal?)` と応答検証を追加。
- 確認ダイアログは追加しない（確定事項5）。

## Web 設計（J4: 訓練バッジ）

### 共通部品

- 新規 `apps/web/src/components/TrainingBadge.tsx`・`trainingBadge.css`。`<span className="training-badge">訓練</span>` を返す。props なし（`className` の追加だけ受ける）。
- 見た目（`detail-dialog-training-label` の色・形・字に揃え、行高を固定する）:

```css
.training-badge {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  block-size: 18px;
  padding-inline: 10px;
  border-radius: 999px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
}
```

  高さを 18px に固定する根拠: 警報一覧の行の行高は 13px×1.4＝18.2px、通知行は32px（狭幅60px）、パネル見出しのタイトルは14px。いずれにも収まり、行の高さを変えない値とした（実ブラウザでの計測は未実施。受け入れ条件で実測する）。
- 既存の `detail-dialog-training-label` の span は `TrainingBadge` に置き換え、旧クラスのCSSは削除する（見出し行の高さが変わらないことを受け入れ条件で確認）。

### 置き場所

| 場所 | 変更 |
| --- | --- |
| 下部通知領域（`NotificationArea.tsx` の `NoticeRow`） | `notice?.isTraining === true` のとき、`.notice-text` の**直前**（行の左端、`.notice-row` の flex 子）に `TrainingBadge`。要約はスクロールしてもバッジは残る。空行・操作行には出さない |
| 警報一覧（`WarningListView.tsx`） | `warning-list-flags` 内の `<span>訓練</span>` を `TrainingBadge` に置換。「起動時」は現状のまま |
| 各パネル（`InfoPanelFrame.tsx`） | `InfoPanelCardInput` に `readonly isTraining?: boolean` を追加。`isTraining === true` のとき見出しのタイトル行（`info-panel-card-title`）の右に `TrainingBadge`（タイトルを `display:flex; align-items:center; gap:8px` にする）。6パネルの組立て（`useWarnings`・`bosaiBulletinCards`・`useWarningTimeSeries`・`useEarlyWarning`・`useAmedas`・`useAreaForecast`）で応答の `isTraining` を設定する。読込中・失敗・空のカードには付けない |
| 詳細ダイアログ | 上記の置換のみ |

- パネルは `controlStatus:'normal'` 固定のため、実運用でバッジは出ない（確定事項8）。確認用に開発ビルド限定のパネルフィクスチャ `training-badges`（`all-content` と同じ内容で全カード `isTraining: true`）を `FIXTURE_BUILDERS` に追加する。
- ブザー: 実装変更なし。訓練通知が通常通知と同じ鳴動要求になることを web 単体試験で固定する（確定事項9・10）。

## 変更しないもの

- 既存 parser・processor・現況リデューサー・通知 planner・通知 store・ブザー（H1 は既存処理を変えず、基準電文の投入で解決する）。
- J1 の生成・プレビューAPI・生成テンプレート・ストック形式。
- 監視画面の表示・取得元別テーブル・情報別状況。
- 全体の `express.json()` の上限、既存ルートの応答。
- ブザー・通知行の寸法・色。HEX値は書かない。

## 受け入れ条件

検収は各項目のコマンド・操作を実行する。devサーバー・`npm run build` を使う確認は、統括担当の指示する手順・ポートで行う。

### 回帰・切り出し

- [ ] `npm run test -w apps/api` で既存の取得系テスト（`tests/jmaXmlPolling.test.ts`・`tests/issue178ManualRefreshWhileStopped.test.ts`・`tests/fetchAbort.test.ts`・`tests/issue145BulletinNotifications.test.ts`・`tests/notificationOriginPipeline.acceptance.test.ts` を含む全件）が通る。`git diff main -- apps/api/tests` で既存テストの期待値（assert の値）に変更がない（追加のみ）。
- [ ] 新規試験: 固定XMLの偽フィードを `pollSingleFeed` に流し、`fetch_attempt`（フィード行・`xml_document` 行の各列）、`telegram_reception`（`feed_kind`・`feed_entry_id`・`fetch_attempt_id`・`document_url`・`received_at` 等）、採用行、通知出力が、試験内の独立した期待表と一致する。`ingestTelegramDocument` を直接呼んだ場合も、同じXMLに対して受信・採用・通知の内容が `pollSingleFeed` 経由と一致する（`fetch_attempt_id`・`feed_kind`・`document_url` を除く）。
- [ ] `git diff main -- apps/api/src/polling/jmaXmlPoller.ts` を読み、`pollSingleFeed` のフィード取得・重複抑止・カウンタ・失敗記録・中断の処理に変更がないこと、移動した処理の中身が同一であることを確認する。

### 注入API（J2）

- [ ] K端末で、J1 の `POST /api/training/preview` が返した各電文をそのまま `POST /api/training/inject` に送ると 200。応答の `trainingId` は UUID v4、`telegrams` は送った件数で `sequence` 昇順、`documentUrl` は `training://{trainingId}/{sequence}_{telegramType}_training.xml`。
- [ ] H端末は 403、不明端末・余分なキー・0件・21件・previewId 重複・previewId 形式違い・`generatedAt` 形式違い・未知 itemId・32KiB超のxml・query付きは 400。全応答 `Cache-Control: no-store`。384KiB超のボディは 413（512kb超のパーサー拒否も 413・no-store）。
- [ ] `xml` の Headline 本文を1文字変えたもの、`generatedAt` を1ms変えたもの、`itemIds` を別項目に変えたものは、いずれも 422 `training_verification_failed` で `reason:'regeneration_mismatch'`。その要求の他の正しい電文も含めて、DB に `telegram_reception`・`fetch_attempt`・注入記録が**1行も増えない**。
- [ ] 2日前の `generatedAt` で生成した電文も 422 にならず投入される（時刻を書き換えない）。投入後の `telegram_reception.report_datetime`・`control_datetime` が XML の値と一致する。
- [ ] 注入後、`fetch_attempt` に `source_kind='training_injection'`・`trigger_kind='training'`・`target_ref=trainingId` の行が電文数だけあり、`xml_document`・`xml_feed_*` の行は増えない。`telegram_reception` は `feed_kind='training'`・`feed_entry_id=previewId`・`control_status='training'`・`fetch_attempt_id` が上記の行。
- [ ] `training_injection` に1行（`status='completed'`、`telegram_count`＝電文数、`terminal_id`）、`training_injection_reception` に電文数の行（`reception_id` が上記受信）。2回の注入は別の `trainingId` で、各記録は互いの受信を含まない。
- [ ] 同じ `trainingId` の command を Worker の注入関数へ2回渡すと、2回目は受信・取得記録を増やさず同じ結果を返す（単体試験）。途中の電文で例外を起こすと（試験で差し替え）、記録は `failed`・`error_code` あり、それ以前の電文の受信は残る。
- [ ] 速報系（線状降水帯発生・記録的短時間大雨・竜巻注意・竜巻目撃のいずれか）を生成直後に注入すると、初期判定済みの状態で east 会場に `isTraining=true`・`controlStatus` 由来の訓練通知が出力履歴へ記録され、`GET /api/notifications/delta` で `isTraining:true` として返る（ランタイム関数の単体試験＋実Worker起動の結合試験の両方）。`GET /api/weather/bulletins?controlStatus=training` で訓練の速報が返り、`controlStatus=normal` の応答は注入前後で `generatedAt` 等の時刻を除き同一。
- [ ] 警報系の成立（H1）: 訓練現況が未初期化の状態で、レベル３大雨警報（生成直後）を注入すると、応答の `baseline` が非null（`sequence:0`、documentUrl `training://{trainingId}/0_VPWS50_training.xml`、`reportDateTime` は警報の発表時刻の60秒前）、警報は `sequence:1`。`GET /api/weather/warnings?controlStatus=training`（east の端末）にレベル３大雨警報が出る。出力履歴に「気象警報発表 江東区 レベル３大雨警報」が `isTraining=true` で1件記録され、基準電文由来の通知は0件。`controlStatus=normal` の現況・通知は変化しない（ランタイム関数の単体試験と、実Worker起動の結合試験の両方）。
- [ ] 基準電文を再投入しない: 上記の後、雷注意報（より新しい生成）を注入すると `baseline:null`、雷注意報が `sequence:0`。訓練現況が「レベル３大雨警報、雷注意報」の2件になり（先の警報が消えない）、「気象警報等解除」通知は出ない。
- [ ] 速報だけの注入（例: 竜巻注意のみ）では、訓練現況が未初期化でも `baseline:null` で、VPWS50 の受信が増えない。
- [ ] 気象庁の訓練 VPWS50 に相当する訓練 VPWS50 ストリームが既にある状態（試験で事前に用意）では、警報を注入しても `baseline:null`。
- [ ] 1回の注入に発表時刻の異なる警報を複数含めると、基準の発表時刻は最も早い警報の60秒前で、全警報が現況に反映される（`same_version_conflict` にならない）。
- [ ] 基準電文の生成関数を固定時計（月末・年末・JST日付跨ぎを含む）で呼び、本書の表の要素・値・4層構造・`Tb` の各位置、Headline/Information が無いことを独立した期待値と比較して一致する。`verifyTrainingWarningBaseline` は、Status を通常に変えたもの、Kind に警報を入れたもの、DateTime を `Tb` から変えたものをいずれも不合格にする。
- [ ] 基準電文の生成・検証が失敗する場合（試験で差し替え）、要求電文の受信は1行も増えず、注入記録は `failed`、応答は 500 `training_injection_failed`。
- [ ] 注入記録: 基準電文を投入した注入では `training_injection_reception` に `role='baseline'`・`preview_id NULL`・`sequence=0`・`telegram_type='VPWS50'` の行が1つ、要求電文は `role='requested'` で `sequence` 1 から。`training_injection.telegram_count` は要求電文の数。
- [ ] 直列化: 未初期化の状態から、警報を含む2つの注入を同時に開始（ランタイム関数を `Promise.all`）しても、基準電文の受信は1件だけで、両方の警報が訓練現況に残る。
- [ ] 基準電文は J1 の項目に出ない: `GET /api/training/items` の項目数・group数が J1 と同じ（33項目・16group）で、VPWS50 を含まない。訓練画面の一覧・ストック（localStorage）に基準電文が現れない。
- [ ] 古いストック（試験で2日前の時刻）を注入しても 200 が返り、採用結果が応答に入る。速報の通知が出ないことは既存の失効判定による（応答・UIでエラーにしない）。
- [ ] 監視: 注入の前後で `GET /api/monitoring/status` の会場別採用件数（`recentAdoptions`）と `GET /api/monitoring/processing` の件数・失敗サンプルが変わらない。取得元別テーブル（取得健全性）の各取得元の最終試行・最終成功・連続失敗が注入で変わらない。
- [ ] 取得Workerが未準備（試験で停止）のとき 503 `training_injection_unavailable`、呼出し期限切れ（試験で差し替え）のとき 504 で `trainingId` を含む。インライン起動（`createApplicationRuntime`）では 503。
- [ ] 注入処理は通知・現況・速報を直接書かない: `trainingInjector.ts` と `trainingInjectionService.ts` が `recordNotificationOutputHistory`・現況/速報リポジトリの書込み関数・通知 emitter を import していないことを `grep` で確認する。

### 投入UI（J2）

- [ ] K端末の訓練画面のツールバー中央に「投入」（文字だけ）が「削除」「全削除」と別グループで並ぶ。チェック0件で「投入」は選べない（softDisabled）。1件以上で押すと選択中の配色・「投入、選択中」・操作行「投入を選択中／送信で実行」・送信が点滅。「削除」「全削除」と排他。
- [ ] 送信で確認ダイアログは出ず、送信時点のチェック行だけが投入され（ネットワーク要求の本文で確認）、操作行が「{n}通を投入中」→「{n}通を投入しました」。成功後、投入した行のチェックが外れ、一覧の件数・内容・localStorage は変わらない。
- [ ] 422／503／504／通信失敗をそれぞれ（web単体試験でAPIを差し替え）起こすと、上記の文言が操作行に出てチェックが残る。投入中は「投入」の送信ができない。画面離脱後に届いた結果は表示されない。
- [ ] 1280×800と375×812で、投入選択中・投入中・結果表示中のツールバー外枠高さ・各ボタン幅（120px）が J1 の状態と一致する（[G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md) に従い計測）。

### 訓練バッジ（J4）

- [ ] `TrainingBadge` は「訓練」を表示し、背景 `--md-sys-color-tertiary-container`・文字 `--md-sys-color-on-tertiary-container`。`apps/web/src` の変更差分に HEX・`rgb(` の色指定がない（`git diff main -- apps/web/src | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\('` が該当なし）。
- [ ] 下部通知領域: 訓練通知（実Worker経由の注入、または通知差分APIの応答差し替え）を表示した行の左端にバッジがあり、通常通知の行にはない。通知行の高さ（通常幅32px・狭幅60px）、詳細・確認・送信ボタンの位置と幅が、バッジの有無で変わらない（実測）。
- [ ] 警報一覧: 訓練の行に `TrainingBadge`、通常の行にない。「起動時」表示は従来どおり。訓練行と通常行の行高が一致する（実測、±0.5px）。
- [ ] パネル: web単体試験で `isTraining:true` のカードは見出しにバッジ、`false`・未指定・読込中・失敗・空にはない。開発ビルドの `?panelFixture=training-badges` で全パネルの見出しにバッジが出て、`?panelFixture=all-content` と比べて各カードの見出し高さが変わらない（実測）。通常の画面（フィクスチャなし）ではパネルにバッジが出ない（`controlStatus:'normal'` 固定のため）。
- [ ] 詳細ダイアログ: 訓練の詳細で `TrainingBadge` が出て、見出し行の高さが変更前と一致する（実測）。
- [ ] ブザー: web単体試験で、`isTraining:true` の通知が通常通知と同じ鳴動要求（区分・レベル）になる。訓練通知の確認でブザー停止も通常と同じ。
- [ ] 伝播の確認（実行して確認、確定事項10）: `npm run test -w apps/api` のうち `notificationOutputHistoryMapper`・`notificationDeltaApi`・`startupNotifications`・`issue145BulletinNotifications` の各テストが通り、新規の結合試験で「注入→出力履歴の `is_training=1`→通知差分APIの `isTraining:true`→web の通知store の項目 `isTraining:true`」が一続きで確認できる。
- [ ] 共通メタ情報の維持: 訓練の速報・現況の API 応答で `controlStatus:'training'`・`isTraining:true`、`availability` は3状態のいずれか、`issuedAt` 等の時刻はXMLの発表時刻（受信時刻ではない）、会場は端末の会場。通常の応答は `isTraining:false` のまま。
- [ ] 色・部品の確認はダークテーマのみ。

### 共通

- [ ] `npm run lint`・`npm run typecheck`・`npm run format:check`、`npm run test -w apps/api`・`npm run test -w apps/web`・shared の変更対象テストが通る。新規契約のテストは検証業務標準に従い red 確認・対照実験を記録する。
- [ ] 変更ファイルが本書「モジュール」「Web設計」に挙げた範囲に収まる（`git diff --stat main`）。

## AD-H067 の結論（棚卸しへの記録）

| 論点 | 結論 |
| --- | --- |
| 訓練UI | J1（#69）で生成・ストック、J2（本PR）でストックからの投入を K端末の訓練画面に置く |
| 注入権限 | K端末のみ（terminalRegistry の mode で API でも拒否）。確認ダイアログは追加しない（選択→送信の2段階） |
| 複数訓練 | 注入1回に訓練ID（UUID）。`training_injection`／`training_injection_reception` で訓練ID↔受信（基準電文を含む）を記録。状態（現況・速報）は「会場×訓練」で共有（H3）。注入どうしは直列に処理 |
| 警報系の訓練状態 | 投入の送信後、江東区の訓練 VPWS50 が未初期化のときだけ、サーバーが訓練用 VPWS50 基準電文（発表なし）を警報より前の時刻で生成し、先に同じパイプラインへ投入（H1=A案）。J1 の項目には追加しない |
| 時間変換 | 行わない。XMLの時刻のまま投入し、鮮度・新旧は既存パイプラインが判定 |
| バッジ | `TrainingBadge` を通知領域・警報一覧・パネル見出し（`isTraining` 真のみ）・詳細ダイアログに使う |
| 本番上書き・system汚染 | 訓練は `control_status='training'` で通常状態と分離。監視集計から `feed_kind='training'` を除外。取得健全性は固定 sourceKind のため影響なし |
| 未解決として残すもの | 抹消（J3）、受入除外（J5）、パネルの訓練表示切替（未起票）、注入操作の操作履歴記録（未起票） |

採否待ちの保守事項は自動的に修正必須へ昇格させない。

## 後続への引き継ぎ

- J3（抹消）: 訓練ID→`training_injection_reception.reception_id`→`telegram_reception`（weather DB）、通知は保持DBの `relatedRefs` の `telegram_reception` 参照と `weatherDatabaseGenerationId` で辿る。weather DB を回復で作り直すと注入記録も消え、保持DB側の訓練通知だけが残る点に注意する。基準電文（`role='baseline'`）は訓練現況の土台なので、抹消時に基準電文だけを残す・消す扱い（消すと訓練現況が未初期化に戻り、次の注入で基準電文が再投入される）を J3 で決める。基準電文は取消（InfoType=取消）にすると、既存リデューサーは訓練現況を空にする。取消電文の合成は各 parser の取消対応を確認してから決める。
- J5（受入除外）: 受信は `control_status='training'`、注入由来は加えて `feed_kind='training'`。気象庁が実配信する訓練電文（Status=訓練）は `feed_kind` が通常のフィード種別になる。
- パネルの訓練表示切替を入れるときは、`InfoPanelCardInput.isTraining` を応答から設定済みなので、`controlStatus` を切り替えるだけでバッジが出る。
- 注入の操作履歴（`operation_history`）記録は AD-H068（system操作系メッセージ）と合わせて後続で判断する。

## 検証状況

- 既存パイプラインへの訓練電文の流入、基準電文なしでの警報系の `uninitialized`、速報系の `isTraining` 付き通知、古い時刻での失効スキップ、生成の再現性、検証の改ざん耐性、XMLサイズは、一時スクリプトで実測した（上記表）。
- 本書の基準電文の形（手組み）について、既存 parser の通過、警報の採用と通知、2回目の注入で先の状態が残ること、古いストックが採用されないこと、基準電文の再投入で状態が消えること（反例）も実測した。
- **実挙動未確認:**
  - 実Worker経由の注入（`host.call` の所要時間、30秒の期限の妥当性）。
  - 基準電文の生成関数そのもの（未実装。実測は手組みXML）と、R06 の XSD による検証。
  - `TrainingBadge` の実ブラウザでの寸法（18px固定による各行高への影響）。
  - `?panelFixture=training-badges` の表示。
  - ポーリング稼働中の注入との並行。

  いずれも製造・検収で受け入れ条件として実行する。

作成: Claude（Opus 5.5）
