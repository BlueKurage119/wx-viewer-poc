# Issue #71・#73: 訓練データの抹消要求処理と受入条件検証での訓練データ除外

## 状態と目的

- J3（#71）: J2 で注入した訓練データを、取消電文（InfoType=取消）を模した合成電文を通常パイプラインへ投入して論理的に取り消す。
- J5（#73）: 受入条件検証（Epic L）が受信・通知・出力履歴を検証対象として取り出すとき、訓練データを除外する api 側の共通関数を用意する。
- 前提: [J2/J4 設計書](issue-70-72-training-injection-badge.md)（実装・マージ済み、`b40b6f4`）。特に「後続への引き継ぎ」、注入記録テーブル、投入済み一覧（追加変更(2) A）。

## ヒアリング済み事項（2026-10-13 ユーザー承認）

1. 【確定】抹消は**論理取消のみ**。取消電文を合成して通常パイプラインへ投入する。受信レコード・訓練通知・出力履歴の物理削除はしない。直接削除の経路が無いことをテストで確認する。
2. 【確定】抹消単位は**訓練ID単位**（投入済み一覧の1行）。加えて「全抹消」を設け、全抹消のときだけ基準電文（`role='baseline'` の訓練用 VPWS50）も取消して訓練現況を空に戻す。行ごとの抹消では基準電文を残す。
3. 【確定】取消電文の合成方式は設計者に一任。条件は「訓練で表示された警報・注意報等が消えること」。各 parser の取消対応を実測で確認し、方式と根拠を記録する。
4. 【確定】J5 は api 側に共通除外関数を置き、「訓練データの除外」と「抹消後も本番データが不変」をテストで確認する。L はこれを使う。
5. 権限は J2 と同じ K端末のみ（`terminalRegistry` の mode 検証）。確認は既存の選択→送信の2段階操作のみ（確認ダイアログなし）。UI は投入済み一覧に沿わせる。色はトークンのみ、ダークテーマのみ検証。

## 追加ヒアリングで確定した事項（2026-10-13 ユーザー回答）

- Q1【確定】抹消の取消電文では**通知を出さない**（通知も鳴動もなし）。受信・検証・正規化・状態更新は通常パイプラインを通し、通知判定段だけ抹消由来を通知生成しない。
- Q2【確定】全抹消は会場を問わず全訓練を対象とする。
- Q3【確定】抹消済みの訓練は投入済み一覧に「抹消済み」と表示して残す。
- Q4・Q5【確定】ツールバー5ボタン案、投入済みの行にチェック欄を追加、確認は既存の2段階のみ（確認ダイアログなし）。
- Q6【確定】基本設計の文言は今回改訂しない。食い違いと解釈を本書に記録するにとどめる（[基本設計との食い違い](#基本設計との食い違いq6)）。

## 調査根拠と実測結果

### 参照資料

- [基本設計 §3.4](../basic-design.md)（抹消要求は取消電文を同じパイプラインへ投入、直接削除は用いない。受入検証は `isTraining` で除外）
- [J2/J4 設計書](issue-70-72-training-injection-badge.md)
- [棚卸し台帳](../audit-epic-a-d.md) AD-H010（取消と物理削除の境界）・AD-H043（取消本文/EventID/Serial）・AD-H067（訓練全般）
- [Issue下書き](../issues-draft.md) J3・J5・L4
- 既存コード: `jmaWarningCurrentProcessor.ts`（取消の扱い）、`jmaWarningCurrentReducer.ts`（`cancelledStreams`）、`jmaVpbs50Processor.ts`（EventID 単位の取消）、`jmaVphwParser.ts`（EventID は `{種別}:{発表細分コード}`）、`trainingInjector.ts`・`trainingWarningBaseline.ts`

### 既存 parser・processor の取消対応（コード確認）

| 種別 | 取消の扱い（既存実装） | 合成取消が効く条件 |
| --- | --- | --- |
| VPWW55〜61（個別） | Kind は解釈しない。ストリーム単位で `cancelledStreams` に入り、そのストリームの現象を集約側にもフォールバックさせず全て外す | 取消の ReportDateTime がストリームの既存以上（同時刻なら Control/DateTime が新しい）、かつ VPWS50 基準以上 |
| VPWS50（集約） | 取消のとき現況を空にする（`items: []`） | 同上 |
| VPBS50 | `event_id`＋`control_status` の行を `is_cancelled=1` に更新。Control/DateTime が既存より新しいことが必要。区域0件の取消は previous と照合 | 元の EventID のまま、Control/DateTime を新しくする |
| VPHW50/51 | EventID は `{種別}:{発表細分コード}`。発表細分の無い取消は代替キーの独立行になり既存を消せない（AD-H043） | 元の Body（発表細分）を保つ |

### 実測（2026-10-13、一時スクリプト。scratchpad で実行し削除済み）

インメモリDB＋`testVenueRegistry` で、J1 生成の `warning-03`（VPWW55）・`bulletin-linear-occurrence`（VPBS50）・`bulletin-tornado`（VPHW50）・`bulletin-tornado-observed`（VPHW51）を `injectTrainingTelegrams` で1訓練として注入し、受信原文（`telegram_reception.raw_body`）から InfoType を `取消`、Control/DateTime を注入後の時計（秒、UTC `Z`）に書き換えた電文を `ingestTelegramDocument(feedKind='training')` で投入した。

| # | 条件 | 結果 |
| --- | --- | --- |
| 1 | 個別4種を取消（ReportDateTime は元のまま） | 4通とも east で「…として解析済み」。訓練の警報現況 `03` → `[]`。`bosai_bulletin` の訓練3行が `info_type='取消'`・`is_cancelled=1` |
| 2 | 1 と同じで ReportDateTime を新しくした場合 | 結果は1と同じ |
| 3 | 1 に加えて基準電文（VPWS50）も取消 | 採用され、現況 `[]` |
| 4 | 1 の後に新しい警報を注入 | 基準電文は再投入されず（ストリームあり）、現況 `03`（行抹消後の再注入は成立） |
| 5 | **3 の後に新しい警報を注入（J2 の現行実装）** | **基準電文は再投入されず（VPWS50 ストリームが取消電文を指したまま存在）、現況 `[]` のまま。全抹消後は訓練の警報が二度と表示されない** |
| 6 | 3 の後、新しい基準電文（Tb＝警報の発表時刻−60秒）を投入してから警報を注入 | 基準電文が採用され、現況 `03` |

実測5により、全抹消を成立させるには J2 の基準電文の投入条件を変える必要がある（[J2 基準電文の投入条件の変更](#j2-基準電文の投入条件の変更)）。

## 設計判断

### 取消電文の合成方式（確定事項3）

**方式: 取消対象の受信原文を DOM で読み、次の2要素だけを書き換えて投入する。**

| 要素 | 値 |
| --- | --- |
| Head/InfoType | `取消` |
| Control/DateTime | Worker の `clock()`（秒切り捨て、UTC `Z`。J2 の基準電文と同じ規則） |

それ以外（Control/Status=訓練、Head/Title、ReportDateTime、EventID、Serial、Headline、Body）は**変えない**。根拠:

- 警報: Kind を解釈しないため本文は何でもよいが、ReportDateTime を元のままにすると、後の訓練で同じストリームが上書きされていた場合に取消が古くなって効かない（下の「上書き済みの判定」で事前に除くので投入もしない）。実測1・2 で同じ結果。
- VPBS50: 元の EventID と新しい Control/DateTime が必要（コード確認・実測1）。
- VPHW50/51: 発表細分を含む Body を保たないと既存行を消せない（AD-H043、実測1）。
- Head/Title に「（取消）」を付けるかは公式実例との照合ができていない（AD-H043 は確認待ち）。付けない形で実測は通ったので、付けない。**合成取消は気象庁の実取消電文の形の再現ではない**（AD-H043 の「J3合成は実例と区別」に従う）。

文字列の正規表現置換はしない。既存の XML 読取（parser と同じ DOM ライブラリ）で該当要素のテキストだけを置き換え、直列化する。直列化後に**投入前検証**として既存の `parseTelegramXml`（documentUrl で種別を決める既存関数）と種別 parser を通し、`infoType='取消'`・`controlStatus='training'`・種別一致・（速報のみ）EventID が元と一致することを確かめる。不合格なら抹消全体を `failed` にし、1通も投入しない。

### 取消対象の決定（上書き済みの判定）

訓練の現況は「会場×訓練」で共有している（J2 H3）。後の訓練が同じストリーム／同じ EventID を上書きしている場合、元の訓練の取消を投入すると**後の訓練の表示を消してしまう**。そこで、取消は「現在その状態を作っている受信が対象訓練のものであるとき」だけ投入する。

| 種別 | 対象とする条件 | 外す理由（記録値） |
| --- | --- | --- |
| VPWW55〜61 | `findWarningCurrentStream(conn,'130000','1310800','training',種別)` の `receptionId` が対象訓練の `role='requested'` の受信 | `superseded`（後の訓練が上書き済み）・`already_cancelled`（ストリームの指す電文が取消） |
| VPBS50・VPHW50/51 | 受信原文から求めた EventID の `bosai_bulletin`（`control_status='training'`）が `is_cancelled=0` かつ `source` が対象受信の `document_url` | 同上 |

1訓練に同じ種別が複数ある場合も、条件を満たすのは高々1通（ストリームの指す受信）である。外れた電文は投入しないが、抹消記録には理由付きで残す。外れた電文の効果は、上書きした後の訓練の電文が完全状態で置き換えているため、既に画面に残っていない（個別電文はストリームの完全状態）。

### 全抹消（確定事項2）

1. 対象訓練は、抹消時点の `training_injection` の**全行**（`completed` に加え、一覧に出ない `failed` も含む。J2 の「途中失敗で受信が一部残った注入は J3 の抹消対象」に対応）。
2. 上表と同じ判定で、訓練由来（注入の受信）が指している個別ストリーム・速報行を全て取消する。
3. 最後に、VPWS50 ストリームが `role='baseline'` の受信を指していれば基準電文を取消す。指していない（気象庁が実配信した訓練 VPWS50 等）場合は取消さず、`baseline_not_owned` として記録する。
4. 気象庁が実配信した訓練電文（`feed_kind` が通常のフィード種別）が作った状態は、行抹消・全抹消のどちらでも取消さない（注入したものだけを取消す）。

### J2 基準電文の投入条件の変更

実測5の対処として、`trainingInjector.ts` の基準電文の投入条件2を次に改める（J3 の範囲で J2 のコードを変更する）。

- 変更前: 江東区の訓練 VPWS50 ストリームが null。
- 変更後: null、**または**ストリームが指す受信の InfoType が `取消`。
- 時刻 `Tb` = max（従来の Tb、取消済みストリームの ReportDateTime）。後者が大きい場合は ReportDateTime を同じにし、Control/DateTime（`clock()`）が新しいことで採用させる（既存 processor は同時刻なら Control/DateTime の新しい方を採る）。その場合、Tb 以前の発表時刻の警報は採用されない（J2 の「古いストックは採用されない」と同じ扱い。注入は失敗にしない）。
- 実測6で成立を確認した。同時刻＋新しい Control の分岐は**実挙動未確認**（受け入れ条件で確認）。

### 通知・ブザー

**【確定（Q1）】抹消由来の取消電文からは通知を作らない。**

基本設計 §3.4「同じパイプラインを経由」との関係: 受信記録（`recordTelegramReception`）・parser による検証・正規化・現況／速報の状態更新（各 processor、`runWeatherUpdate` による直列化と配信スコープの更新）は通常経路をそのまま通す。抑止するのは**通知判定（planner→通知 store→出力履歴→ブザー）だけ**である。状態は通常経路で更新されるため、画面（警報一覧・パネル）からは通常の配信で訓練表示が消える。

**分岐の位置（最小）:** `ingestTelegramDocument` の第3引数 `PollerContextOptions` の `warningNotificationEmitDeps`・`bosaiNotificationEmitDeps` は既存で省略可能であり、省略時は各 processor が状態更新だけを行い通知を作らない（実測でも省略して状態更新だけが行われた）。抹消処理（`trainingRetractor.ts`）は ingest を呼ぶとき、Worker から受けた deps から**この2つを外したオプション**を渡す:

```ts
const { warningNotificationEmitDeps: _w, bosaiNotificationEmitDeps: _b, ...stateOnly } = deps;
await ingestTelegramDocument(connection, input, stateOnly, hooks);
```

- `jmaXmlPoller.ts`・各 processor・planner・emitter には**変更を加えない**。分岐は抹消処理の呼出し側だけにあるので、通常取得（`pollSingleFeed`）と訓練注入（`trainingInjector.ts`）の通知には影響しない。
- 判定の根拠は呼出し経路（抹消処理）であり、`source_kind='training_retraction'` は記録上の識別に使う（通知判定には使わない。通知判定に sourceKind 判定を足すと共通コードに分岐が入るため）。
- 初期判定 tracker（`initialWarningKeys`／`initialBosaiKeys`）は `runWeatherUpdate` に渡す既存の値のままとする。抹消で tracker が完了扱いになっても、次の注入は抹消後の状態（空）との差分で通常どおり通知される。この点は**実挙動未確認**（受け入れ条件で確認）。
- 帰結: 抹消後、通知領域に既に出ている訓練通知は残る（通知・出力履歴は物理削除しない、確定事項1）。後の注入で同じ警報を再び出すと、状態が空からの差分なので新規として通知される。

### AD-H010・AD-H043・AD-H067 の結論（棚卸しへの記録）

| 管理ID | 結論 |
| --- | --- |
| AD-H010 | 抹消は論理取消のみ。受信・訓練通知・出力履歴・注入記録・端末セッションの物理削除は**今回実装しない**。基本設計 §3.4・§9 の「訓練データは抹消要求で削除できる」は、本PoCでは「取消電文により画面・現況から消える」の意味で満たし、履歴の物理消去は別Issue候補として残す。受入検証からの除外は J5 の共通関数で行う（物理削除に依存しない） |
| AD-H043 | J3 の合成取消は実取消の再現ではなく、既存 processor が取消として扱える最小変更（InfoType・Control/DateTime のみ）。警報の取消本文 Kind は読まない既存方針、VPHW は発表細分を保つ形で既存行を消せることを実測で確認。実配信の取消本文・EventID・Serial の確認は L2/L3 に残す |
| AD-H067 | 抹消 UI は K端末の訓練画面の投入済み一覧に置く。訓練ID単位＋全抹消。注入と抹消は同じ直列化キューで処理。J5 の除外条件を L へ供給 |

### 基本設計との食い違い（Q6）

基本設計 §3.4 は「訓練データは通常操作（抹消要求）で削除できる」（§8.1 の保持方針の例外）、§9 の受入条件は「抹消要求により削除できること」と書く。本書は確定事項1により物理削除をしない。**本PoCでは、取消電文により訓練データを現況・画面から取り除くこと（論理取消）をもって「抹消（削除）」とみなす。** 基本設計の文言は今回改訂しない（Q6）。受入検証から訓練データを外す目的は J5 の除外関数で満たす。

## 全体の流れ

```
[K端末 訓練画面] 投入済みの行をチェック →「電文抹消」→ 送信   ／  「電文全抹消」→ 送信
   │ POST /api/training/retract { terminalId, scope:'training', trainingIds:[…] } | { terminalId, scope:'all' }
   ▼
[HTTPメイン] TrainingRetractionService: 端末検証（K のみ）・形式検証・抹消ID採番
   │ host.call('training.retract', command, 30s)
   ▼
[取得Worker] runtime.retractTraining(command)   ※ injectTraining と同じ直列化キュー
   training_retraction（in_progress）、対象訓練を記録
   対象受信ごとに: 上書き済み判定 → 取消電文を合成・検証 → fetch_attempt(source_kind='training_retraction')
                   → ingestTelegramDocument(feedKind='training') → training_retraction_item
   全抹消のみ: 最後に基準電文の取消
   training_retraction（completed）→ 結果
   ※ ingest には通知 emit deps を外したオプションを渡す（状態更新のみ、通知なし）
   ▼
[通常の配信経路] 状態の配信で警報一覧・パネルから訓練表示が消える（通知・ブザーは出ない）
```

## 型・API契約（`packages/shared/src/trainingTelegram.ts` に追加）

```ts
export const TRAINING_RETRACT_MAX_TRAINING_IDS = 50; // 投入済み一覧の最大件数と同じ

export type TrainingRetractRequest =
  | { readonly terminalId: string; readonly scope: 'training'; readonly trainingIds: readonly string[] } // 1〜50、重複なし、UUID v4 小文字
  | { readonly terminalId: string; readonly scope: 'all' };

export type TrainingRetractSkipReason = 'superseded' | 'already_cancelled' | 'baseline_not_owned';

export interface TrainingRetractedTelegram {
  readonly trainingId: string;          // 取消対象の訓練ID
  readonly targetSequence: number;      // 注入内の sequence（基準電文は 0）
  readonly telegramType: string;
  readonly role: 'requested' | 'baseline';
  readonly outcome: 'cancelled' | TrainingRetractSkipReason;
  readonly receptionId: number | null;  // 取消電文の受信ID（outcome='cancelled' のみ）
  readonly adoptions: readonly TrainingInjectAdoption[]; // 取消電文の採用結果（venueId 昇順、外した電文は空）
}
export interface TrainingRetractResponse {
  readonly retractionId: string;        // UUID v4
  readonly scope: 'training' | 'all';
  readonly acceptedAt: string;          // UTC ISO
  readonly trainingIds: readonly string[]; // 対象とした訓練ID（昇順）
  readonly telegrams: readonly TrainingRetractedTelegram[]; // 投入順
}
export function parseTrainingRetractRequest(value: unknown): TrainingRetractRequest | null;
export function parseTrainingRetractResponse(value: unknown): TrainingRetractResponse | null; // web 用
```

`parseTrainingRetractRequest` は余分なキーを拒否する（`scope:'all'` に `trainingIds` があれば不正）。

### HTTP: `POST /api/training/retract`

- `/api/training` の no-store ミドルウェアの対象。ボディは既定の `express.json()`（上限は変えない）。query 付きは 400。

| 条件 | 応答 |
| --- | --- |
| 形式不正・不明端末 | 400 `invalid_request` |
| H端末 | 403 `forbidden_terminal` |
| `scope:'training'` で、存在しない訓練ID、または要求端末と別会場の K端末が投入した訓練ID を含む | 404 `{status:'error',code:'training_not_found',trainingIds:[…]}`（1件も処理しない） |
| 既に抹消済み（`completed` の抹消が対象にした訓練ID）を含む | 409 `{status:'error',code:'training_already_retracted',trainingIds:[…]}`（1件も処理しない） |
| ポート未構成・Worker未準備・busy | 503 `training_retraction_unavailable` |
| 期限切れ・結果不明 | 504 `{status:'error',code:'training_retraction_result_unknown',retractionId}` |
| Worker内の途中失敗・取消電文の検証不合格 | 500 `{status:'error',code:'training_retraction_failed',retractionId}`（検証不合格は1通も投入しない。投入途中の失敗はそれまでの取消を戻さない） |
| 成功 | 200 `TrainingRetractResponse` |

404・409 の判定は Worker 側で行い（weather DB の書き手）、Worker は `training_retraction_rejected` 例外に理由と訓練ID を載せて返す。メインはそれを 404/409 に分類する。会場の判定は J2 の一覧と同じく、メインが `terminalRegistry` から同じ会場の K端末 ID 集合を求めて command に入れる。

**全抹消の範囲:** 訓練の現況は会場をまたいで共有（江東区の訓練ストリーム）なので、全抹消は**会場を問わず全ての注入記録**を対象とする（Q2 確定）。

## サーバー設計

### モジュール

| ファイル | 責務 |
| --- | --- |
| `packages/shared/src/trainingTelegram.ts` | 上記の型・定数・検証関数 |
| `apps/api/src/services/trainingRetractionService.ts`（新規） | 端末検証、会場の K端末集合、抹消ID採番（`idFactory`）、ポート呼出し、HTTP 分類 |
| `apps/api/src/training/trainingInjectionContracts.ts` | `TrainingRetractionCommand`・`TrainingRetractionResult`・`TrainingRetractionPort`、`TRAINING_RETRACTION_SOURCE_KIND='training_retraction'`、`trainingRetractionDocumentUrl(retractionId, itemNo, telegramType)` = `training://{retractionId}/r{itemNo}_{telegramType}_training.xml`（既存 `parseTelegramXml` が `_VPWW55_` 等で種別を決めるため J2 と同じ形） |
| `apps/api/src/training/trainingCancelTelegram.ts`（新規） | `buildTrainingCancelTelegram(rawXml, { controlDateTime })`（DOM で2要素を書換え）と `verifyTrainingCancelTelegram(xml, { documentUrl, telegramType, expectedEventId })`。純粋処理 |
| `apps/api/src/training/trainingRetractor.ts`（新規） | Worker 側 `retractTrainingTelegrams(connection, command, deps)` |
| `apps/api/src/training/trainingInjector.ts` | 基準電文の投入条件・Tb の変更（上記） |
| `apps/api/src/repositories/trainingRetractionRepository.ts`（新規） | 抹消記録の挿入・更新・読取り。**DELETE 文を持たない** |
| `apps/api/src/repositories/trainingInjectionRepository.ts` | 一覧取得で抹消済みの訓練を除く |
| `apps/api/migrations/weather/0003_create_training_retraction.sql`（新規） | 抹消記録テーブル |
| `apps/api/src/runtime/createAcquisitionRuntime.ts` | `retractTraining(command)` を公開。`injectTraining` と**同じ** Promise キューで直列化 |
| `apps/api/src/runtime/acquisitionWorker.ts` | `training.retract` の受付 |
| `apps/api/src/runtime/startWorkerServer.ts` | ポート実装 `host.call('training.retract', command, 30_000)` と service の組込み |
| `apps/api/src/app.ts` | ルート追加 |
| `apps/api/src/acceptance/trainingExclusion.ts`（新規、J5） | 共通除外関数 |

### Worker 契約

```ts
export interface TrainingRetractionCommand {
  readonly retractionId: string;
  readonly terminalId: string;
  readonly requestedAt: string;
  readonly scope: 'training' | 'all';
  readonly trainingIds: readonly string[];       // scope='all' では空
  readonly allowedTerminalIds: readonly string[]; // 要求端末と同じ会場の K端末（scope='training' の所有判定）
}
export type TrainingRetractionResult = TrainingRetractResponse;
export interface TrainingRetractionPort { retract(command: TrainingRetractionCommand): Promise<TrainingRetractionResult>; }
```

冪等性は J2 と同じ（同じ `retractionId` の記録があれば再処理せず記録から結果を返す。メインは自動再送しない）。

### 抹消処理（`retractTrainingTelegrams`）

1. 記録があれば結果を返す（冪等）。
2. 対象訓練の決定と拒否判定（404・409）。`scope='all'` は `training_injection` 全行から、既に `completed` の抹消の対象になった訓練を除いたもの（0件でも基準電文の判定は行う）。
3. `training_retraction`（`in_progress`）と `training_retraction_target` を挿入。
4. 候補の列挙: 対象訓練の `role='requested'` の受信を `(accepted_at, training_id, sequence)` 順に並べ、上書き済みの判定で `cancelled` 予定か理由を決める。全抹消では最後に基準電文（判定は上記）。
5. `cancelled` 予定の全電文について取消電文を合成・検証する（**投入前に全件**。1通でも不合格なら何も投入せず `failed`、`error_code='cancel_verification_failed'`）。
6. 順に投入: `recordFetchAttempt`（`sourceKind='training_retraction'`、`targetRef=retractionId`、`triggerKind='training'`、他は J2 と同じ値）→ `ingestTelegramDocument(…, { feedKind:'training', feedEntryId:`${retractionId}:${itemNo}`, … }, deps, { afterRecord: (r) => insertTrainingRetractionItem(...) })`。外した電文の item 行は投入せずに挿入する。
7. `completed`・`finished_at`。途中の例外は `failed` で `training_retraction_failed` を投げる。投入済みの取消は戻さない。

### 抹消記録テーブル（`migrations/weather/0003_create_training_retraction.sql`）

```sql
CREATE TABLE training_retraction (
  retraction_id TEXT PRIMARY KEY CHECK (length(retraction_id) = 36),
  scope TEXT NOT NULL CHECK (scope IN ('training', 'all')),
  terminal_id TEXT NOT NULL CHECK (terminal_id <> ''),
  requested_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> '')
);
CREATE TABLE training_retraction_target (
  retraction_id TEXT NOT NULL REFERENCES training_retraction(retraction_id) ON DELETE CASCADE,
  training_id TEXT NOT NULL REFERENCES training_injection(training_id) ON DELETE CASCADE,
  PRIMARY KEY (retraction_id, training_id)
);
CREATE TABLE training_retraction_item (
  retraction_id TEXT NOT NULL REFERENCES training_retraction(retraction_id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL CHECK (item_no >= 0),
  target_reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  telegram_type TEXT NOT NULL CHECK (telegram_type <> ''),
  outcome TEXT NOT NULL CHECK (outcome IN ('cancelled', 'superseded', 'already_cancelled', 'baseline_not_owned')),
  cancel_reception_id INTEGER UNIQUE REFERENCES telegram_reception(id) ON DELETE CASCADE,
  PRIMARY KEY (retraction_id, item_no),
  CHECK ((outcome = 'cancelled') = (cancel_reception_id IS NOT NULL))
);
```

`databasePair.test.ts` の旧DDL照合からこの3表を除外する（J2 の a9a0982 と同じ扱い）。

### 投入済み一覧（J2 追加変更(2) A）への影響

- **（Q3 確定）抹消済みの訓練も一覧に残し、「抹消済み」と表示する。** `GET /api/training/injections` の各要素に `retractedAt: string | null`（その訓練を対象にした `completed` の抹消の `accepted_at` の最も早いもの。未抹消は null）を追加する。`parseTrainingInjectionsResponse`（web 用）も対応する。並び・最大50件・対象（同じ会場の K端末の `completed` 注入）は変えない。
- 50件の上限は抹消済みを含めて数える（古いものから一覧外へ出る。DB の記録は残る）。

### 取得監視への影響

- `summarizeAdoptionResults`・`listRecentAdoptionFailures` は J2 で `feed_kind='training'` を除外済み。取消電文も `feed_kind='training'` なので追加変更なし。
- `fetchHealthSources` は固定 sourceKind のみ集計のため `training_retraction` の影響なし（変更不要。受け入れ条件で確認）。

## J5: 受入条件検証の除外関数（`apps/api/src/acceptance/trainingExclusion.ts`）

```ts
export const TRAINING_SOURCE_KINDS = ['training_injection', 'training_retraction'] as const;
export const TRAINING_FEED_KIND = 'training';

/** 受信: control_status='training'（気象庁の実配信訓練を含む）または feed_kind='training'（注入・取消）。 */
export function isTrainingReception(r: { readonly controlStatus: string | null; readonly feedKind: string | null }): boolean;
/** 取得試行: sourceKind が TRAINING_SOURCE_KINDS。 */
export function isTrainingFetchAttempt(a: { readonly sourceKind: string }): boolean;
/** 通知・出力履歴: isTraining=true。 */
export function isTrainingNotification(n: { readonly isTraining: boolean }): boolean;

/** 検証対象として取り出す（訓練を除外済み）。範囲は既存リポジトリの一覧関数の引数に合わせる。 */
export function listAcceptanceReceptions(weather: DatabaseConnection, range: { from: string; to: string }): TelegramReception[];
export function listAcceptanceFetchAttempts(weather: DatabaseConnection, range: { from: string; to: string }): FetchAttempt[];
export function listAcceptanceOutputHistory(retained: DatabaseConnection, range: { from: string; to: string }): NotificationOutputHistoryRecord[];
```

- 除外は SQL の WHERE で行い（`(control_status IS NULL OR control_status <> 'training') AND (feed_kind IS NULL OR feed_kind <> 'training')`、`source_kind NOT IN (...)`、`is_training = 0`）、述語関数は同じ条件を TypeScript で表す（両者が一致することを試験で固定）。
- `control_status='test'`（試験）は除外しない（J5 の対象外。基本設計 §3.4 は訓練のみ）。
- アプリの実行時（API・画面）からは呼ばない。L の受入検証テストとスクリプト専用。既存の一覧関数・API の応答は変えない。
- 範囲引数の型や戻り値の型名は既存リポジトリの型に合わせてよい（製造判断）。

## Web 設計（J3: 抹消操作）

- `TrainingToolbarSelection` に `'retract' | 'retractAll'` を追加。groups を `[[リスト消去, リスト全消], [電文投入], [電文抹消, 電文全抹消]]` とする（文字だけ、アイコンなし）。（Q4 確定。ボタン名は 2026-10-13 ユーザー指定）
- 投入済みの行に**チェック欄を置く**（J2 追加変更(2) の「投入済みの行にはチェック欄を置かない」を本書で置き換える）。ローカル行と投入済みの行のチェックは同じ一覧で付けられるが、操作ごとに数える対象を分ける:
  - リスト消去・電文投入: ローカル行のチェック数（従来どおり）。
  - 抹消: 投入済みの行のチェック数が1以上で選べる。送信時点でチェックされている投入済みの行の訓練ID を送る（`scope:'training'`）。
  - 全抹消: 投入中・抹消中でなければ常に選べる（一覧が空でも基準電文の取消のため）。送信で `scope:'all'`。
  - 選択・送信可否・排他・選択破棄の契機は既存の規則に揃える。投入中は抹消も選べず、抹消中は投入も選べない。
- 送信の `aria-label`: 「抹消を送信」「全抹消を送信」。操作行: 「抹消を選択中／送信で実行」「全抹消を選択中／送信で実行」、実行中 `{n}件の訓練を抹消中`・`訓練データを全抹消中`。
- 結果: 200 で `{n}件の訓練を抹消しました`／`訓練データを全抹消しました`。直後に投入済み一覧を再読込する（該当行が「抹消済み」になる）。失敗は `抹消できませんでした（…）`（400 要求が不正です／403 この端末では操作できません／404 対象の訓練が見つかりません／409 既に抹消済みです／503 取得処理が利用できません／500・通信失敗は括弧なし）、504 は `抹消の結果を確認できませんでした`。失敗時もチェックを維持し、一覧を再読込する。
- 画面離脱・端末切替で abort しない（J2 と同じ）。離脱後の結果は表示しない。
- 確認ダイアログは追加しない（選択→送信の2段階。Q5 確定）。
- **抹消済みの行（Q3）:** ステータス欄は「抹消済み」（色は `on-surface-variant`、トークンのみ）。並びは投入済みのまとまりの中で他の投入済み行と同じ新しい順（`acceptedAt` 降順）に混ぜる。チェック欄は**置かない**（列幅は空けて揃える。再抹消は 409 のため対象外）。抹消済みの行は全抹消の対象数にも数えない。
- `apps/web/src/api/training.ts` に `requestTrainingRetract(request, signal?)`。
- 色はトークンのみ。行高48px・ツールバー外枠高・ボタン幅は変えない。

## 変更しないもの

- 既存 parser・processor・現況リデューサー・通知 planner・通知 store・ブザー。
- 受信履歴一覧・詳細、出力履歴、操作記録（`operation_history`）。抹消操作の操作記録は J2 と同じく後続（AD-H068）。
- J1 の生成・ストック形式（version 3）。
- 既存の DELETE 系 API・ルートを追加しない。

## 受け入れ条件

検収は各項目のコマンド・操作を実行する。devサーバー・`npm run build` を使う確認は統括担当の指示する手順・ポートで行う。

### 取消の効果（api 試験、インメモリDB）

- [ ] `warning-03`・`bulletin-linear-occurrence`・`bulletin-tornado`・`bulletin-tornado-observed` を1訓練で注入後、その訓練ID の行抹消で、訓練の警報現況（`findWarningCurrentSnapshot(conn,'1310800','training').items`）が空になり、`bosai_bulletin` の訓練3行が `is_cancelled=1`。4通の取消電文の east の採用結果が「…として解析済み」。基準電文は取消されず、VPWS50 ストリームが基準電文の受信を指したまま。
- [ ] 行抹消後に新しい警報を注入すると、基準電文は再投入されずに警報が現況に出る。
- [ ] 訓練A（VPWW55）→訓練B（VPWW55・同じ竜巻 VPHW50）の順に注入し、A を抹消すると、A の該当電文は `superseded` で取消電文が投入されず、B の警報・竜巻は現況に残る。
- [ ] 全抹消で、全訓練の個別ストリーム・速報行が取消され、最後に基準電文が取消されて現況が空。抹消後に新しい警報を注入すると基準電文が再投入され（`baseline` 非null）、警報が現況に出る（実測5の回帰）。
- [ ] 全抹消前の VPWS50 ストリームの ReportDateTime 以前の発表時刻の警報を注入した場合、注入は 200（`completed`）で、基準電文は ReportDateTime 同一・Control/DateTime が新しい形で採用され、警報は採用されない。
- [ ] `failed` の注入記録の受信が作った状態も全抹消で取消される。気象庁の実配信を模した訓練電文（`feed_kind` が通常値、Status=訓練）で作った状態は全抹消で取消されず、VPWS50 が実配信を指す場合は `baseline_not_owned` が記録される。
- [ ] 取消電文の原文は元の電文と InfoType・Control/DateTime 以外が一致する（DOM で要素ごとに比較）。検証不合格を起こす入力（試験で原文を壊す）では1通も投入されず、抹消記録が `failed`。
- [ ] 取消電文の受信・取得試行が `feed_kind='training'`・`source_kind='training_retraction'`・`trigger_kind='training'`・documentUrl `training://{retractionId}/r{n}_{種別}_training.xml`。
- [ ] 同じ `retractionId` で2回呼んでも受信行が増えず、同じ結果が返る。注入と抹消を同時に呼んでも直列に処理される（2つ目は1つ目の完了後に始まる）。

### 物理削除が無いこと（確定事項1）

- [ ] 行抹消・全抹消の前後で、`telegram_reception`・`telegram_reception_adoption`・`fetch_attempt`・`training_injection`・`training_injection_reception`・`bosai_bulletin`（行数）・保持DBの `notification_output_history` の行数が減らない（増加のみ）。抹消前に存在した各行の内容が不変（`bosai_bulletin`・現況系は除く）。
- [ ] `grep -rnE "DELETE|\.delete\(" apps/api/src/training apps/api/src/services/trainingRetractionService.ts apps/api/src/repositories/trainingRetractionRepository.ts` が0件。`/api/training` 配下に GET・POST 以外のルートが無い（`app.ts` の確認と、`DELETE /api/training/injections/x` が 404 になる試験）。

### 本番データ不変（確定事項4）

- [ ] 通常（`control_status='normal'`）の警報・速報の受信と通知出力履歴（`is_training=0`）を用意した状態で、注入→行抹消→全抹消を行う。`control_status='normal'` の現況スナップショット・ストリーム・`bosai_bulletin`、`is_training=0` の出力履歴、通常フィード由来の受信・取得試行のダンプが前後で一致する。

### HTTP API

- [ ] `POST /api/training/retract`: K端末 200、H端末 403、不明端末・形式不正・query 付き・`scope:'all'` に `trainingIds` 付き・51件・重複は 400、no-store。別会場の K端末の訓練ID・存在しない ID は 404 で何も処理されない。抹消済みの訓練ID は 409。ポート未構成（インライン起動）・Worker未準備は 503、期限切れは 504、Worker内失敗は 500。
- [ ] `GET /api/training/injections` で、抹消済みの訓練は `retractedAt` が抹消の受付時刻、未抹消・`failed` の抹消の対象は `null`。抹消済みも一覧に残る。

### 通知の抑止（Q1）

- [ ] 実Worker 経由（`trainingInjectionRealWorker.test.ts` と同じ形）で警報・VPBS50・VPHW50 を注入→行抹消→全抹消すると、抹消の前後で保持DBの `notification_output_history` の行数が変わらず、通知差分API にも新しい通知が出ない。一方、注入時の訓練通知は従来どおり記録されている。
- [ ] 抹消後に同じ内容の警報を再注入すると、`is_training=1` の新規の通知が記録される（tracker・差分が通常どおり動く）。
- [ ] 分岐が他へ影響しないこと: `git diff main -- apps/api/src/polling apps/api/src/notifications` が空。既存の通知系試験（`warningNotificationPlanner`・`issue145BulletinNotifications`・`trainingInjection*` 等）が期待値を変えずに通る。通常（normal）の警報取消電文を `pollSingleFeed` 経由で流す試験で、従来どおり取消通知が出る。
- [ ] web 単体試験: 抹消の 200 応答でブザーの鳴動要求が発生しない。

### J5 除外関数

- [ ] 通常・気象庁実配信の訓練（`control_status='training'`、通常 feed_kind）・注入・取消を混在させたDBで、`listAcceptanceReceptions` が通常のみ、`listAcceptanceFetchAttempts` が `training_injection`・`training_retraction` 以外、`listAcceptanceOutputHistory` が `is_training=0` のみを返す。各述語関数の判定が SQL の結果と一致する。
- [ ] 抹消前後で `listAcceptance*` の結果が一致する（抹消が受入対象に影響しない）。
- [ ] `grep -rn "acceptance/trainingExclusion" apps/api/src` が `trainingExclusion.ts` 自身以外を返さない（実行時コードから呼ばない）。

### 訓練画面（web 単体試験＋実ブラウザ、ダークテーマのみ）

- [ ] ツールバーが左から「リスト消去」「リスト全消」｜「電文投入」｜「電文抹消」「電文全抹消」。1280×720（HD幅、最小想定。モバイルは対象外：2026-10-13 ユーザー指定）でツールバーがはみ出さず、ボタン幅120px・外枠高が既存と同じ（実測）。はみ出す場合は製造を止めて統括担当へ報告する。
- [ ] 投入済みの行にチェック欄が出る。投入済みの行だけチェックしたとき「電文投入」「リスト消去」は選べず「電文抹消」は選べる。ローカル行だけのときはその逆。電文全抹消は一覧が空でも選べる。
- [ ] 抹消を送信すると `scope:'training'`・チェックした訓練ID で要求され、200 後に `{n}件の訓練を抹消しました` が出て、該当行のステータスが「抹消済み」になりチェック欄が無くなる。電文全抹消は `訓練データを全抹消しました` で投入済みの行が全て「抹消済み」になり、ローカル行は変わらない。抹消済みの行は「電文抹消」の対象として選べない。
- [ ] 404・409・503・504・通信失敗（差し替え）で本書の文言が出て、チェックが維持される。投入中は抹消・全抹消を選べず、抹消中は電文投入を選べない。
- [ ] 実画面: 警報・速報を注入し、下部通知領域・警報一覧・警報パネルの訓練カード・速報パネルに訓練表示が出た後、行抹消で警報一覧と警報パネルの訓練カード・速報パネルの訓練カードが消える。このとき下部通知領域に新しい通知は出ず、ブザーも鳴らない（既に出ていた訓練通知は残る）。
- [ ] 色はトークンのみ（HEX・rgb 無し）。行高48px がチェック欄の追加で変わらない。

### 共通

- [ ] `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/api`・`npm run test -w apps/web` が通る。既存の J2 試験は「投入済み行にチェック欄が無い」に関する期待値の置換以外を変えずに通る。

## 後続への引き継ぎ

- **L（受入検証）**: 受信・取得試行・出力履歴は `apps/api/src/acceptance/trainingExclusion.ts` の `listAcceptance*` で取り出す。新しい訓練由来の sourceKind を足すときは `TRAINING_SOURCE_KINDS` に追加する。
- **物理削除（別Issue候補）**: 訓練の受信・通知・出力履歴・注入／抹消記録を消す要求は今回実装しない。行う場合は保持DB（出力履歴）と weather DB をまたぐため、`relatedRefs` と `weatherDatabaseGenerationId` での照合、DB回復後に保持DBだけ残る訓練通知の扱いを含めて別途設計する。
- **AD-H043**: 実配信の取消電文（警報・VPBS50・VPHW）の Head/Title・Body・EventID・Serial を入手したら、合成取消との差を記録する（合成取消を実例として扱わない）。
- 抹消操作の操作記録（`operation_history`）は AD-H068 と合わせて後続で判断する。
- 基本設計 §3.4・§9 の「削除できる」の文言は改訂しない（Q6）。本書の解釈（論理取消をもって抹消）を L4 の受入でも前提とする。

## 検証状況

- 取消電文の方式（InfoType・Control/DateTime のみ書換え）で、VPWW55・VPBS50・VPHW50・VPHW51・VPWS50 の取消が既存パイプラインで採用され、現況・速報が消えることを実測した。全抹消後に基準電文が再投入されない問題（実測5）と、新しい基準電文で回復すること（実測6）も実測した。
- **実挙動未確認:**
  - VPWW56〜61 の取消（VPWW55 と同じ processor 経路だがサンプル未投入）。
  - 通知 emit deps を外したときに `runWeatherUpdate` の初期判定 tracker を含めて通知が一切出ないこと（実測は weather DB の状態更新のみ。保持DBは未確認）。
  - Tb が取消済みストリームと同時刻になる分岐。
  - 上書き済み判定（`superseded`）の実挙動。
  - ツールバー5ボタンの 1280px 幅（HD）での収まり。
  - 実Worker 経由の抹消の所要時間（30秒期限の妥当性）。

  いずれも製造・検収で受け入れ条件として実行する。

作成: Claude（Opus 5.5）

## 2026-10-13 UI監修で変更

本節は前節までより優先する。基準は実装済みのブランチ `feature/issue-71-73-training-retraction`（c6f84b4・9a19a52）。ツールバーの名称は実装どおり「電文抹消」「電文全抹消」とし、前節の「抹消」「全抹消」はこの名称で読み替える。

### 決定（ユーザー確定）

- 抹消済みの行にもチェック欄を出し、既存の「リスト消去」「リスト全消」で一覧から外せるようにする。
- DB の行は削除しない。「一覧から外した」印を付けるだけとし、別の K端末からも再読込後も外れたままにする。
- 未抹消の投入済みの行は、従来どおり一覧から消去できない（先に電文抹消する）。
- 「リスト全消」の対象は、ローカル行と抹消済みの行。

### 記録（`migrations/weather/0004_create_training_injection_list_hidden.sql`、新規）

```sql
CREATE TABLE training_injection_list_hidden (
  training_id TEXT PRIMARY KEY REFERENCES training_injection(training_id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL,
  terminal_id TEXT NOT NULL CHECK (terminal_id <> '')
);
```

- 既存の `training_injection` は変えない（0002 の DDL を変えないため、列追加ではなく別表とした）。`databasePair.test.ts` の旧DDL照合から除外する（0003 と同じ扱い）。
- 書込みは `INSERT ... ON CONFLICT(training_id) DO NOTHING` だけにする（最初に外した時刻と端末を保つ）。**この表に対する DELETE・UPDATE 文は持たない**。外した行を一覧に戻す操作は設けない。
- リポジトリは `trainingInjectionRepository.ts` に `hideTrainingInjectionsFromList(connection, { trainingIds, terminalId, hiddenAt })` を追加する。

### API: `POST /api/training/injections/hide`（新規）

- 要求: `{ terminalId: string, trainingIds: string[] }`（1〜50件、重複なし、UUID v4 小文字、余分なキーは拒否）。query 付きは 400。no-store。既定の `express.json()` を使う。
- 経路: 取得Worker へ `host.call('training.injections.hide', command, 5_000)`。注入・抹消と**同じ直列化キュー**で処理する（抹消の完了前に外す判定が走らないようにする）。
- 判定は Worker で行い、1件でも不可なら1件も記録しない。

| 条件 | 応答 |
| --- | --- |
| 形式不正・不明端末 | 400 `invalid_request` |
| H端末 | 403 `forbidden_terminal` |
| 存在しない、または別会場の K端末が投入した訓練ID | 404 `training_not_found`（`trainingIds` 付き） |
| 未抹消（`completed` の抹消の対象になっていない）の訓練ID | 409 `{status:'error',code:'training_not_retracted',trainingIds:[…]}` |
| 既に外した訓練ID | 成功として扱う（冪等。記録は変えない） |
| ポート未構成・Worker未準備・期限切れ | 503 `training_injection_unavailable` |
| 成功 | 200 `{ hiddenTrainingIds: string[] }`（要求の全件、昇順） |

- 型・検証関数は `packages/shared/src/trainingTelegram.ts` に `TrainingInjectionsHideRequest`・`parseTrainingInjectionsHideRequest`・`parseTrainingInjectionsHideResponse` を追加する。web は `apps/web/src/api/training.ts` に `requestTrainingInjectionsHide(terminalId, trainingIds, signal?)` を追加する。

### 一覧 `GET /api/training/injections` の変更

- 外した訓練を除く。**50件の上限は外していない行で数える**（外した行が上限の枠を使わない）。並び・対象・`retractedAt` は前節どおり。

### Web（訓練画面）

- 抹消済みの行にチェック欄を置く（前節の「抹消済みの行にはチェック欄を置かない」を廃止）。未抹消の投入済みの行のチェック欄は前節どおり（電文抹消用）。
- 操作ごとに数える対象:

| 操作 | 選べる条件 | 送信で対象にする行 |
| --- | --- | --- |
| リスト消去 | チェックされたローカル行または抹消済みの行が1以上 | チェックされたローカル行（ストックから消す）と抹消済みの行（hide API） |
| リスト全消 | ローカル行または抹消済みの行が1以上 | 全ローカル行と全抹消済みの行。未抹消の投入済みの行は残す |
| 電文投入 | チェックされたローカル行が1以上 | 前節どおり |
| 電文抹消 | チェックされた未抹消の投入済み行が1以上 | 前節どおり（抹消済みの行は含めない） |
| 電文全抹消 | 前節どおり | 前節どおり |

  - チェックされているのが未抹消の投入済み行だけのとき、リスト消去は選べない。
  - 選択の排他・選択破棄の契機は既存の規則のまま。投入中・抹消中・一覧から外す処理中は、他の操作を選べない（外す処理中も「処理中」に含める）。
- 送信の処理順: 抹消済みの行がある場合、先に hide API を呼ぶ。200 のときだけローカル行をストックから消し、一覧を再読込する。hide API が失敗したときは、ローカル行も消さずにチェックを維持する（部分的に消えた状態を作らない）。抹消済みの行が無いときは、従来どおりローカル行だけを消す（API を呼ばない）。
- 文言:
  - 成功: `{n}件をリストから消去しました`（n はローカル行と抹消済みの行の合計。既存の文言をそのまま使う）。
  - 処理中: `{n}件をリストから消去中`。
  - 失敗: `リストから消去できませんでした（…）`。括弧内は 404「対象の訓練が見つかりません」、409「電文抹消が済んでいない訓練があります」、503「取得処理が利用できません」。400・通信失敗は括弧なし。
- 件数「n／20件」はローカル行だけで数える（前節どおり）。
- 色はトークンのみ。行高48px は変えない。

### 前節の条件との整合

- **「物理削除が無いこと」:** hide は INSERT だけで、既存のどの行も削除・変更しない。前節の grep（`apps/api/src/training`・`trainingRetractionService.ts`・`trainingRetractionRepository.ts`）に加えて、`trainingInjectionRepository.ts` と新設の hide 処理ファイル（例: `apps/api/src/services/trainingInjectionHideService.ts`）も対象に含め、`DELETE|\.delete\(` が0件（UPDATE は J2 の status 更新以外が無いこと）であることを確認する。`DELETE /api/training/...` のルートは作らない（POST を使う）。
- **J5 除外・本番不変:** hide は一覧の表示だけに効く。受信・取得試行・出力履歴・現況・速報には触れないため、`listAcceptance*` の結果と normal 系のダンプは hide の前後で一致する（受け入れ条件で確認）。
- 前節の受け入れ条件「抹消済みの行は『抹消』の対象として選べない」は維持する。「チェック欄が無くなる」は「チェック欄は残り、電文抹消の対象にはならない」に読み替える。

### 受け入れ条件（追加・修正）

- [ ] `POST /api/training/injections/hide`: 抹消済みの訓練は 200 で、以後 `GET /api/training/injections` に出ない。同じ会場の別の K端末の一覧からも消える。再度の hide は 200 で、`hidden_at` は変わらない。未抹消の訓練を含む要求は 409、存在しない・別会場の訓練は 404。どちらの場合も1件も記録されない。H端末 403。形式不正・51件・重複・query 付きは 400。no-store。Worker未準備は 503。
- [ ] hide の前後で、`training_injection`・`training_injection_reception`・`training_retraction*`・`telegram_reception`・`fetch_attempt`・`bosai_bulletin`・`notification_output_history` の行数と内容が一致する。`listAcceptance*` の結果も一致する。
- [ ] 一覧の50件の上限は外していない行で数える（試験: 外した行を含めて51件以上ある状態で、外していない最新50件が返る）。
- [ ] 訓練画面: 抹消済みの行にチェック欄がある。抹消済みの行をチェックしてリスト消去すると、hide が呼ばれ `{n}件をリストから消去しました` が出て、その行が一覧から消える。再読込後も消えたまま。
- [ ] 未抹消の投入済み行だけをチェックしたとき、リスト消去は選べない。未抹消の投入済み行とローカル行を混ぜてチェックしたときは、リスト消去でローカル行だけが消え、未抹消の行は残る。
- [ ] リスト全消で、全ローカル行と全抹消済みの行が消え、未抹消の投入済み行は残る。対象がローカル行だけのときは hide API を呼ばない。
- [ ] hide が 409・503・通信失敗（差し替え）のとき、本節の文言が出て、ローカル行もストックに残り、チェックが維持される。
- [ ] 外す処理中は、電文投入・電文抹消・電文全抹消を選べない。
- [ ] 色はトークンのみ。チェック欄の追加で行高48px が変わらない（1280×800・375×812 で実測、ダークテーマのみ）。
- [ ] `grep -rnE "DELETE|\.delete\(" apps/api/src/training apps/api/src/repositories/trainingInjectionRepository.ts apps/api/src/repositories/trainingRetractionRepository.ts apps/api/src/services/trainingRetractionService.ts` に hide 処理のファイルを加えて実行し、0件であること。加えて `grep -n "UPDATE" apps/api/src/repositories/trainingInjectionRepository.ts` の結果が、J2 の `training_injection` の status 更新（実装済み、1か所）だけであり、`training_injection_list_hidden` を対象にする UPDATE が無いこと。

### 実挙動未確認

- 抹消の完了直後に hide を送った場合の、同じキュー上での処理順は試験で確かめていない。製造・検収で確認する。

## 2026-10-13 初回レビュー対応で変更

この節は前の節より優先する。

### 抹消後の再投入（ユーザー判断 2026-10-13）

- 懸念: 抹消前に生成したローカル行を抹消後に再投入すると、取消電文（Control/DateTime を対象+1秒以上にしたもの）より Control/DateTime が古く、「重複または旧版」として採用されず、投入は成功扱いなのに訓練の警報・速報が表示されない可能性がある。
- 製造担当がまず実測する（警報 VPWW 系と速報 VPBS50・VPHW の両方）。再現しなければ実装は変えず、再現しないことを試験として固定する。
- 再現した場合の対処（確定）: 注入時に、その電文が更新する訓練の状態（警報ストリーム、速報の EventID 行）が取消電文を指しており、取消電文の Control/DateTime 以上でない電文に限り、Control/DateTime だけを「取消電文の Control/DateTime + 1秒」以上へ書き換えて投入する。書き換えは取消電文の合成と同じ DOM 方式で行い、それ以外の要素は変えない。J2 の「XML は書き換えない」の例外として記録する。生成検証（`verifyGeneratedTelegram` 相当）は書き換え前の XML に対して行う。
- 受け入れ条件: 抹消前に生成した電文を抹消後に再投入すると、訓練の警報・速報が再び表示される（試験）。取消されていない状態への投入では XML が書き換わらない（試験）。

### レビュー指摘の修正（不具合系）

- `trainingController.clearList` は `this` に依存しない（クロージャ内の関数を直接呼ぶ）。
- リスト消去の成功文言の件数は、実際に消したローカル行の件数＋一覧から外した件数とする。
- 通常（normal）の取消電文が `pollSingleFeed` 経由で従来どおり取消通知を出すことを恒久の試験として追加する。

区域コード・取消文字列の共通化、`trainingId` 空文字の null 化、抹消済み判定の全件読込は別 Issue とする。
