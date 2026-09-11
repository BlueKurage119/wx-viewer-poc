# Issue #24 設計書: C14. 時間帯別取得周期スケジューラ

作成日: 2026-09-12  
対象 Issue: #24「C14. 時間帯別取得周期スケジューラ」

## 1. 目的と範囲

JST の時間帯に応じて、XML 高頻度フィード、雨雲ナウキャスト時刻一覧、キキクル時刻一覧、アメダス最新時刻の取得投入周期を切り替えるサーバー内スケジューラを実装する。周期と時間帯は、画面・REST API ではなく API workspace 内の設定ファイルで変更できるようにする。

統括ヒアリングで、20:00〜翌4:00（JST）は **XML を含む全ての上流取得を停止する** ことが確定した。従って基本設計 §8.3 表の「XML は300秒で継続」という未確定案は採らない。4:00 に運用へ入ると、待機中の対象を直ちに一度投入し、その後に時間帯別周期へ従う。

本 Issue が扱うのは、定期的な「取得を投入するか、いつ次に投入するか」と、同じ取得ジョブの重複投入を防ぐことだけである。各取得の HTTP、パース、前回値保持、availability、通信履歴、個別タイル取得、指数バックオフの具体的な規則は既存 Issue / #23 の責務として保持する。

対象外:

- 開始・停止・強制更新の HTTP API、画面操作、操作履歴（E11/K2）
- タイル PNG の定期先読み・全画角取得。定期対象は時刻一覧だけであり、タイルは C10/C11 のオンデマンド契約を維持する
- 取得元別の遅延・異常の閾値判定と指数バックオフの実装（#23/C13）
- 設定ファイルのホットリロード。設定変更はプロセス再起動後に反映する。再起動不要の設定変更 UI/API は本 Issue の対象外である
- XML 初期取得の4フィード完全性判定、復旧の再実行条件（#22/C12）

## 2. 参照資料と判断根拠

|参照|本設計への反映|
|---|---|
|Issue #24 本文|4時間帯、既定周期、設定ファイル、周期境界での重複防止、4:00 と手動再開の即時取得を要件とする。手動再開の API 自体は E11 のため実装しない。|
|`docs/issues-draft.md` C14|時間帯別周期の責務であることを確認した。|
|`docs/basic-design.md` §8.3|JST 境界、既定の 120/60/120 秒および 300/60/300 秒、4:00 の即時取得、タイルを全再取得しない原則を採用する。|
|`docs/basic-design.md` §8.1, §8.2|意図的なスケジュール停止は障害と混同せず、取得元別状態・次回予定を後続の監視へ渡す。|
|`docs/design/issue-11-xml-feed-polling.md`|通常 XML は `scheduled` で高頻度2フィード、`initial` / `recovery` は4フィード。サービス内の in-flight 集約を操作要求の重複防止と混同しない。|
|`docs/design/issue-19-amedas-normalization.md`|`runAmedasFetchCycle` はタイマーを持たない単発入口で、`AmedasFetchState` は会場ごとに保持する。最新時刻と地点データを別成功として保持する。|
|`docs/design/issue-20-nowcast-tiles.md`|定期対象は N1/N2 の `refreshTimes()` のみ。画像は on-demand のままとし、C14 が `staleAfterMs` と周期を構成する。|
|`docs/design/issue-21-kikikuru-tiles.md`|定期対象は `refreshTimes()` のみ。3レイヤーを含む一覧1回の取得であり、PNG の先読みをしない。|
|`docs/design/issue-22-initial-recovery.md`|XML 起動時は `start()` により4フィード初期取得を行い、その後に通常周期へ移る。夜間に外部取得をしてはならないため、C14 は XML の開始／停止時刻を制御する。|
|`docs/design/issue-23-exponential-backoff-retry.md`|XML フィード別 `FeedBackoffStatus`、`nextAllowedFetchAt`、初期取得失敗フィードだけの recovery、通常周期と再試行を XML サービス内の単一タイマーで調停する確定契約を利用する。|

気象庁の提供周期・掲載保証を本スケジューラは新たに仮定しない。60 秒等はあくまでアプリケーションの既定取得確認周期であり、発表から表示までの遅延保証ではない。

## 3. 運転規則

### 3.1 時間帯と既定値

時刻は `Asia/Tokyo` で解釈し、各区間は開始を含み終了を含まない半開区間とする。サーバーの OS タイムゾーンや UTC 日付の変わり目に依存しない。

|モード|JST 時間帯|XML 高頻度2フィード|雨雲 N1/N2 時刻一覧|キキクル時刻一覧|アメダス最新時刻|
|---|---|---:|---:|---:|---:|
|`early`|04:00:00 以上 05:00:00 未満|120秒|300秒|300秒|300秒|
|`busy`|05:00:00 以上 18:00:00 未満|60秒|60秒|60秒|60秒|
|`late`|18:00:00 以上 20:00:00 未満|120秒|300秒|300秒|300秒|
|`off_hours`|20:00:00 以上、または 00:00:00 以上 04:00:00 未満|停止|停止|停止|停止|

XML の「高頻度2フィード」は既存の `pollOnce('scheduled')` を指す。長期2フィードを周期対象へ混ぜない。初期・復旧で4フィードを取得する既存 C1/C12 の契約は変えない。

20:00 の境界では、新規ジョブを投入せず、すでに開始済みのジョブは中断せず完了を待つ。各ジョブの結果は既存契約どおり保存する。夜間は次の境界（翌04:00）だけを待機し、ポーリング用の短いタイマーを残さない。04:00 の境界では、XML は初期取得または通常取得のいずれか一方を1回、雨雲・キキクル・アメダスは各1回だけ即時投入する。以後、完了時刻から該当モードの周期を数える。

### 3.2 起動と XML 初期取得

サーバー起動が `early` / `busy` / `late` の場合、従来どおり C12 の XML 初期取得（4フィード）を先に一度実行する。初期取得の完了・失敗後、XML は C14 の周期投入へ参加する。他の3取得元は初回を待たずに各1回投入する。

サーバー起動が `off_hours` の場合、**XML 初期取得を含め、上流 HTTP 取得を一切実行しない**。DB migration、保存済み XML の再処理、保存済み現況の再構成は外部取得ではないため、#22 の既存順序で実行してよい。C14 は04:00まで待機し、04:00 に XML の初期取得（4フィード）を1回行い、他の3取得元も各1回投入する。このため「XMLを含む全取得停止」と C12 の現況復元を両立できる。

この待機中に E11 が将来手動再開を要求する場合も、20:00〜04:00には外部取得を開始しない。E11 は C14 が公開する再開入口を呼ぶが、夜間は `off_hours` を返すだけとする。日中の再開時の XML `recovery` を行うかは、C12/C13/E11 が決める復旧条件であり C14 は決めない。

### 3.3 重複防止と次回時刻

スケジューラは `setInterval` を使わず、各対象につき「完了後に1本だけ次回 `setTimeout` を登録する」方式にする。実行時間が周期を超えても同一対象の並列実行が発生しない。タイマー発火、04:00の即時投入、将来の再開要求が重なっても、対象ごとの in-flight Promise を共有して同じ adapter を1回だけ呼ぶ。

モード境界、開始、停止で、古いタイマーを `clearTimeout` してから新しい予定を1本だけ登録する。コールバックには世代番号を閉じ込め、古いコールバックがキューに残っていても現在世代でなければ何も投入しない。これにより20:00直前に設定されたタイマーが20:00後に取得を始めたり、04:00の即時投入と旧タイマーが二重に走ったりしない。

雨雲・キキクル・アメダスの `nextRunAt` は、通常は当該実行の完了時刻 + 適用周期、`off_hours` では次の04:00（JST）とする。XML は #23 の確定責務どおり、通常周期予定とフィード別 `nextAllowedFetchAt` を **XML サービス内の単一タイマーで早い方に調停する**。`FeedBackoffStatus.nextAllowedFetchAt` は「この時刻より前に当該フィードを開始してはならない」という制約であり、C14 が `max` を取って再試行を遅らせたり、独自の再試行 timer を作ったりしない。

20:00〜04:00 は、この XML タイマーも通常・recovery の新規投入を行わない。停止時には #23 の `stop()` が次回通常・再試行投入を取り消し、C14 は翌04:00まで待つ。#23 の `getStatus().feedStatuses` が返す `FeedBackoffStatus`（`consecutiveFailures`、`isWaiting`、`waitingReason`、`nextAllowedFetchAt`、各最終時刻）は、C14 が監視用状態へ投影する際にそのまま参照し、失敗種別・待機秒数を再計算しない。

## 4. 設定ファイル

### 4.1 配置と反映単位

設定ファイルは `apps/api/src/config/pollingSchedule.ts` とする。JSON を実行時に読込む方式にはせず、型検査される TypeScript 定数と検証関数にする。数値・時間帯の編集箇所を1ファイルに集約し、変更後は API プロセスを再起動して反映する。コンパイル成果物だけで動く `npm run start` でも同じ設定が含まれるため、未コピーの JSON を原因とする起動差異を作らない。

画面・REST API・環境変数では変更できない。`DEFAULT_POLLING_SCHEDULE` の値を変える運用は、設定変更をレビュー可能にし、起動時検証に失敗した場合は周期不明のまま取得を始めず API 起動を失敗させる。

```ts
// apps/api/src/config/pollingSchedule.ts
export type PollingMode = 'early' | 'busy' | 'late' | 'off_hours';
export type ScheduledSource = 'xml' | 'nowcast' | 'kikikuru' | 'amedas';

export interface TimeRangeConfig {
  readonly mode: PollingMode;
  readonly start: `${number}:${number}`; // HH:mm、JST
  readonly end: `${number}:${number}`;
}

export interface PollingScheduleConfig {
  readonly timeZone: 'Asia/Tokyo';
  readonly ranges: readonly TimeRangeConfig[];
  readonly intervalsSeconds: Readonly<
    Record<PollingMode, Readonly<Record<ScheduledSource, number | null>>>
  >;
}

export const DEFAULT_POLLING_SCHEDULE: PollingScheduleConfig = {
  timeZone: 'Asia/Tokyo',
  ranges: [
    { mode: 'early', start: '04:00', end: '05:00' },
    { mode: 'busy', start: '05:00', end: '18:00' },
    { mode: 'late', start: '18:00', end: '20:00' },
    { mode: 'off_hours', start: '20:00', end: '04:00' },
  ],
  intervalsSeconds: {
    early: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    busy: { xml: 60, nowcast: 60, kikikuru: 60, amedas: 60 },
    late: { xml: 120, nowcast: 300, kikikuru: 300, amedas: 300 },
    off_hours: { xml: null, nowcast: null, kikikuru: null, amedas: null },
  },
};
```

`validatePollingScheduleConfig()` は次を起動前に完全一致で検査する。

1. `timeZone === 'Asia/Tokyo'`、モード集合と対象集合が過不足なく存在すること。
2. `HH:mm` が実在する時刻で、範囲が24時間を重複・欠落なく一巡被覆すること。上記4境界を別の日付や OS の timezone へ丸めないこと。
3. 運転中3モードの周期が1以上86,400以下の有限整数秒、`off_hours` の全値が `null` であること。
4. `off_hours` 以外で `null`、または `off_hours` で数値を指定した設定を拒否すること。今回の夜間全停止を設定ミスで覆せないようにする。

`staleAfterMs`、キャッシュ絶対パス、許可ズームは C10/C11 が必須注入としている別の運用設定であり、この周期表へ隠蔽しない。C14 の製造時に、C10/C11 を生成する composition root に既存の明示値（検証時のズーム `[10]` を含む）を置く。実運用パス・鮮度閾値の値は現行ソースに未確定のため、本設計で推測して定数化しない。

## 5. モジュール、型、内部 API

### 5.1 変更対象

```text
apps/api/src/
├── config/
│   └── pollingSchedule.ts             # 周期表、JST 範囲・値の検証
├── polling/
│   ├── timeBasedPollingScheduler.ts   # C14 のnon-XML単一タイマー・世代・状態
│   ├── jmaXmlPollingService.ts        # #23 の単一timerへC14のJST通常周期を供給する最小拡張
│   └── index.ts                       # 公開 export
└── server.ts                          # #22 の復元後に scheduler を composition する
apps/api/tests/
└── timeBasedPollingScheduler.test.ts
```

`amedasFetchService.ts`、`nowcastService.ts`、`kikikuruService.ts` は単発入口を維持し、自身へ timer を追加しない。migration、repository schema、`packages/shared`、REST endpoint、`apps/web` は変更しない。

### 5.2 C14 が所有する抽象

```ts
export interface ScheduledPollAdapter {
  readonly source: ScheduledSource;
  runScheduled(): Promise<void>;
}

export interface TimeBasedPollingSchedulerOptions {
  readonly schedule: PollingScheduleConfig;
  readonly adapters: readonly ScheduledPollAdapter[];
  readonly xmlPollingService: JmaXmlPollingService;
  readonly now?: () => Date;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

export interface ScheduledPollStatus {
  readonly source: ScheduledSource;
  readonly mode: PollingMode;
  readonly state: 'waiting' | 'running' | 'scheduled_stopped';
  readonly intervalSeconds: number | null;
  readonly nextRunAt: UtcIso8601String | null;
}

export interface TimeBasedPollingStatus {
  readonly mode: PollingMode;
  readonly nextModeChangeAt: UtcIso8601String;
  readonly sources: Readonly<Record<ScheduledSource, ScheduledPollStatus>>;
}

class TimeBasedPollingScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): TimeBasedPollingStatus;
}
```

`adapters` は `nowcast`、`kikikuru`、`amedas` の3種を過不足なく1つずつ受ける。重複または欠落は起動時に例外とする。XML は #23 の状態・timerを持つ `xmlPollingService` として別に受ける。各 non-XML adapter は C14 の呼出しごとに、取得試行の `triggerKind='scheduled'` を既存サービスへ渡す。

|source|adapter が呼ぶ既存単発入口|補足|
|---|---|---|
|`xml`|`JmaXmlPollingService` の #23 確定済み通常／recovery 調停|高頻度2フィードの通常取得、失敗フィードだけの recovery、backoff は XML サービスが単一 timer で扱う。C12 の初期4フィードは server composition で別途開始する。C14 は周期方針と夜間停止だけを渡す。|
|`nowcast`|`NowcastService.refreshTimes({ triggerKind: 'scheduled', … })`|N1/N2 時刻一覧を1サイクルで更新。PNG は取得しない。|
|`kikikuru`|`KikikuruService.refreshTimes({ triggerKind: 'scheduled', … })`|3レイヤーの時刻一覧を1サイクルで更新。PNG は取得しない。|
|`amedas`|`runAmedasFetchCycle(connection, amedasState, { triggerKind: 'scheduled', … })`|`AmedasFetchState` はスケジューラの寿命中に保持する。`pointFetchPolicy` の10分再確認は §5.4 の扱いに従う。|

### 5.3 #22 / #23 の XML タイマーとの接続

#23 は通常周期とバックオフ再試行を `JmaXmlPollingService` 内の**単一の次回タイマー**で調停し、初期取得が failed の間は失敗フィードだけを recovery する。この契約を外部の C14 timer で置換すると、失敗済みフィード以外を再取得しない recovery、初期4フィードの累積成功判定、停止時の timer 取消しを二重実装することになるため、#24 は行わない。

#24 の XML 接続は次の境界に限定する。

1. C14 の JST モード判定が XML サービスへ通常周期を供給する。運用時間中は該当モードの120/60/120秒、`off_hours` は通常投入不可を表す。
2. XML サービスは #23 の既存責務として、供給された通常周期予定とフィード別 `nextAllowedFetchAt` の早い方を単一 timer へ設定し、実行時に待機中フィードを開始しない。
3. 20:00 で server composition が XML サービスを `stop()` し、04:00 で再開する。夜間起動時は `start()` 自体を04:00まで呼ばない。これにより初期取得・recovery を含む上流 XML GET が夜間に発生しない。

この「JST の通常周期を供給する小さな設定入口」は #24 が #23 マージ後に `JmaXmlPollingService` の **#24 側の拡張**として追加する。#23 の公開済み `start()` / `stop()` / `pollOnce()` / `getStatus()`、`InitialFetchResult`、`FeedBackoffStatus`、失敗フィード限定 recovery の意味は変更しない。#24 は private timer、失敗集合、attemptNo を直接操作しない。#23 の最終実装・テストを正として、その公開状態と lifecycle の外から要件を追加しない。

### 5.4 アメダス地点データの再確認

本 Issue の表は「アメダス最新時刻」の周期である。各 `amedas` adapter は毎回 `latest_time.txt` を確認し、通常は `pointFetchPolicy: 'onLatestTimeChange'` を渡す。地点ブロックの最後の実行開始から10分以上経過した回だけ `pointFetchPolicy: 'always'` を渡す。これにより最新時刻確認を busy で60秒に保ちつつ、時刻が不変でも現行ブロックを最大10分ごとに再確認するという Issue #19 の引継ぎを満たす。

「10分」は Issue #19 で既定値として外部化可能とされた値であるため、`amedasPointRecheckSeconds` は `pollingSchedule.ts` のアメダス付帯設定として正の整数で検証し、既定600秒とする。これは取得周期とは別値であり、時刻一覧の設定値を変更しても地点再確認の意図を暗黙に変えない。夜間は当然この再確認も実行しない。

複数会場の常時収集と `latest_time.txt` の会場間共有方式は Issue #19 が未設計として残した事項である。#24 では既定の1会場（`east`）のみで adapter を構成し、会場を増やすために同一 `latest_time.txt` を重複取得する実装を入れない。

## 6. 処理フロー

```text
server 起動
  ├─ DB 初期化・保存済み XML の再処理・現況再構成（#22）
  ├─ JST が off_hours か
  │    ├─ はい: XML start / 初期取得を呼ばず、C14 が翌04:00を待機
  │    └─ いいえ: XML を start（初期4フィード。#23 の単一timerへC14の通常周期を供給）
  └─ C14.start()
       ├─ off_hours: 全 source を scheduled_stopped、翌04:00だけ予約
       └─ 運用時間: non-XML の未実行 source を即時投入（XML は初期取得済み後に#23のtimerで対象化）
            └─ 各完了後: 現在JSTのモードを再判定
                 ├─ off_hours: 翌04:00を予約
                 └─ 運用時間: 完了時刻 + 適用周期を予約

20:00 到達
  └─ 予約を無効化し、実行済みを待つ。新規上流取得は投入しない

04:00 到達
  ├─ 夜間起動なら XML 初期4フィードを一度実行
  ├─ XML 初期取得を XML の即時1回として扱う（重ねて scheduled を投入しない）
  ├─ nowcast / kikikuru / amedas を各1回だけ即時投入
  └─ early 周期で次回を予約
```

04:00 時点で XML 初期取得がまだ実行中なら、その Promise を共有し、別の `scheduled` XML を並列投入しない。初期取得終了後に初めて XML の次回周期を予約する。non-XML の即時投入は XML 初期取得の終了を待たないが、各 source 内では排他する。

## 7. テスト計画と実行可能な受け入れ条件

実ネットワーク、実時間待機、実運用 DB を使わない。注入 clock と fake timer、各 non-XML source の呼出し回数を記録する fake adapter で `timeBasedPollingScheduler.test.ts` を作る。XML 統合箇所は既存のローカル HTTP fixture と #23 の `JmaXmlPollingService.getStatus()` を使い、C10/C11/C9 の各 service はそれぞれの既存 fake fetch 契約を使う。

1. `04:00:00`、`05:00:00`、`18:00:00`、`20:00:00`、`00:00:00`、`03:59:59.999` の JST 時刻についてモードと4対象の周期値が上表と完全一致する。UTC日付をまたぐ夜間も `off_hours` となる。
2. 既定設定の運用時間中に各 non-XML adapter を起動直後1回呼び、early / busy / late でそれぞれ300、60、300秒後に次回が1本だけ登録される。XML サービスには early / busy / late の120/60/120秒が供給され、通常 `scheduled` は高頻度2フィードだけで長期フィードを増やさない。
3. 20:00直前に遅い adapter を実行中にし、20:00後は新規呼出しが0回である一方、開始済み Promise は完了できる。状態は `scheduled_stopped`、`nextRunAt` は翌04:00となる。
4. 夜間に起動すると04:00までnon-XML の3 adapter と XML 初期取得の HTTP 呼出しが0回である。04:00に XML 初期4フィードが各1回、non-XML の3 adapter が各1回だけ起動し、XML の通常 `scheduled` が初期取得と並列に起動しない。
5. 04:00、20:00、timer callback、`start()` / `stop()` の競合を fake timer で同一tickに発生させても、各 source の実行回数は1回だけである。世代の古い callback は実行回数を増やさない。
6. 実行時間が周期を超える adapter を使っても、完了前に同一 source を再投入しない。完了後にだけ1本の次回 timer が存在する。
7. `DEFAULT_POLLING_SCHEDULE` の busy XML を61秒、late アメダスを301秒へ変更したテスト設定を注入すると、その値だけが次回予定に反映される。範囲欠落・重複、0秒、off_hours の数値、運用時間の `null` は起動前に拒否する。
8. #23 の XML 単一timer結線で、C14 が周期を供給しても、通常周期・recovery・初期取得の timer が多重化せず、1周期あたり `pollOnce('scheduled')` が1回だけである。`nextAllowedFetchAt` 到達時は失敗フィードだけが recovery される。C12 の初期4フィード判定、保存済み現況の再構成、正常/訓練/試験の分離は回帰する。
9. アメダスは busy 中毎分 `latest_time.txt` を確認し、時刻不変でも地点データを10分に1回 `always` 再確認する。時刻更新時は次の周期で地点データを取得する。夜間は両方0回である。
10. `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run test -w apps/api` が成功する。

新規テストは、まず fake adapter の表示用ラベルだけを変更して成功を維持する対照実験を行う。次に (a) 20:00 の停止判定を一時的に外す、(b) non-XML timer 世代照合を一時的に外す、(c) XML へ供給する busy 周期を60秒以外へ一時的に変える、の各ミューテーションで該当完全一致アサーションが red になることを確認する。一時変更は完成コードに残さない。

## 8. 後続 Issue への引き継ぎ

- **#23/C13**: XML のバックオフ・失敗フィード限定 recovery は #23 の `JmaXmlPollingService` が継続して所有する。C14 はJST通常周期の供給、夜間 `stop()`、04:00の `start()`、および `getStatus().feedStatuses` の投影だけを担う。#23 の失敗分類、`nextAllowedFetchAt`、内部timerを再実装しない。
- **#22/C12**: 初期4フィードの完全性・初期状態は維持する。夜間にサーバーが起動した場合、C14 が04:00まで `start()` を遅延させる integration test を追加する。
- **E11/K2**: 全体開始・停止・強制更新 API は C14 の `start()` / `stop()` と状態を使用する。停止中・夜間中に強制更新が可能か、日中再開時に `recovery` を使うかはこの Issue では確定しない。
- **K6/E10**: `TimeBasedPollingStatus` の `mode`、source 状態、適用周期、次回予定を監視表示へ変換する。`scheduled_stopped` は失敗・`unavailable`・手動停止と混同しない。
- **複数会場**: アメダス複数地点と `latest_time.txt` の共有取得方式は別設計が必要である。C14 の単一会場前提を、会場ごとの HTTP 重複で安易に拡張しない。

## 9. 未確認事項

1. C10/C11 の production 用キャッシュ絶対パスと `staleAfterMs` の実測値は現行設計・実装に未確定である。#24 はこれらを周期表の数値から推定しない。composition root へ明示注入する前に運用値を確認する必要がある。
2. 日中の E11 手動再開で XML の `recovery`（長期フィードを含む）を実行するか、通常高頻度取得だけにするかは E11/C12/C13 の判断待ちである。夜間はどちらも実行しない点だけ確定している。
3. `off_hours` 中の設定変更を再起動なしで反映する要求はない。本設計はプロセス再起動反映とする。ホットリロードが必要になった場合は、原子的な設定読込失敗時の継続値、監査、世代切替を別 Issue で設計する。
