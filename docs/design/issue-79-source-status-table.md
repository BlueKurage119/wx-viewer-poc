# Issue #79 K6：取得元別稼働状況テーブルの実装

- 状態：設計承認済み・製造開始待ち（要ヒアリング事項なし）
- 対象：K6 #79 のみ。設計担当：Claude（wxviewer-designer）
- 設計日：2026-09-21（同日改訂。§9の全6件がユーザー判断により確定）
- 対象ブランチ：`feature/issue-79-source-status-table`（origin/main 起点）
- 設計時点ではコード・設定・ブランチ・コミットを変更しない。

## 1. 根拠と参照資料

### 1.1 参照した資料と、そこから導いた判断

| 資料 | 確認内容と、そこから導いた設計判断 |
| --- | --- |
| [Issue #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)（`gh issue view 79`で全文確認） | 行・列の構成、状態の6語、アメダス別管理、タイル別欄、追加受け入れ条件（AD-H001/H003/H041/H062の結論記録） |
| [Issue #74 設計書](issue-74-monitoring-dashboard-layout.md) | K1が用意した表骨格の列見出し・行名・「—」規約、監視更新ライフサイクル、状態色トークン、K6への引き継ぎ（§9「取得元表骨格へ実データを接続。カードの健全性を独自に再評価しない」） |
| `packages/shared/src/monitoringStatus.ts` | `MonitoringHealthSource`（6要素固定順）・`MonitoringScheduledSourceStatus`（4グループ）・`MonitoringTilesSection`・`MonitoringHealthSection.evaluatedAt` の現契約。直近処理時間に相当する項目が**無い**ことを確認 |
| `apps/api/src/monitoring/fetchHealthSources.ts` | 6系列と `scheduledSource`（xml/nowcast/kikikuru/amedas）の対応、`appliesElapsedCondition`（`amedas_point`のみ false） |
| `apps/api/src/monitoring/fetchHealthEvaluator.ts` | `status` は `normal/delayed/abnormal/suspended` の4値。**再試行待ちの状態値は存在しない**。`maxConsecutiveFailures` はストリーム横断の最大値 |
| `apps/api/src/monitoring/fetchHealthMonitorService.ts`（69–85行） | 系列ごとに `sourceKinds` 分の `summarizeFetchStreamHealth` を呼び `streams` として評価器へ渡す構造 |
| `apps/api/src/repositories/fetchAttemptRepository.ts`（255–352行） | `summarizeFetchStreamHealth` が直近 `maxScanAttempts` 行を `id, started_at, outcome` だけ選択している。**`duration_ms` は現在 SELECT していない** |
| `apps/api/src/repositories/types.ts`（646–652行） | `FetchStreamHealthSummary` の現契約 |
| `apps/api/src/polling/timeBasedPollingScheduler.ts`（64, 283–350行） | `state` は `waiting/running/scheduled_stopped` の3値。系列単位ではなく `xml/nowcast/kikikuru/amedas` の4グループ単位 |
| `apps/api/src/monitoring/monitoringStatusService.ts`（84–175, 415–455行） | `buildOperationSection` / `buildHealthSection` / `buildTilesSection` の組み立て箇所。健全性未評価時に全項目 null を返す分岐 |
| `apps/web/src/monitoring/MonitoringDashboard.tsx`（10–27, 76–115行） | K1の `SkeletonTable` と `SOURCE_HEADERS` / `SOURCE_ROWS` の実装。全セルが `—` 固定 |
| `apps/web/src/api/monitoringStatus.ts` | DTO検証が `health.sources` を `Array.isArray` までしか見ていない。K6で要素検証を足す必要がある |
| `apps/web/src/monitoring/monitoringPresentation.ts` | 既存の表示変換とトーン（`neutral/normal/active/attention/error`）、`formatJstTime` / `formatJstDateTime` |
| `apps/web/src/monitoring/monitoring.css` | `--wx-system-status-*` トークンの使用実績。HEX直書きなし |
| [docs/audit-epic-a-d.md](../audit-epic-a-d.md) AD-H001/H003/H041/H062 | 各未決事項の原記録と「未決は後続へ残す承認済み（2026-09-13）」。K6は結論の**記録**が求められている |
| [設計業務標準](../rules/02-design-protocol.md)・[UI業務標準](../rules/06-ui-md3-protocol.md)・[気象データ業務標準](../rules/07-wx-data-protocol.md) | 成果物制約、色トークン、3状態・null・確定/未確定の扱い |

パスはリポジトリルートからの相対パス。

### 1.2 統括担当から渡されたヒアリング確定事項（そのまま前提とする）

| # | 確定事項 | 本書での反映箇所 |
| --- | --- | --- |
| 1 | 状態・次回予定は、APIの4グループ（xml/nowcast/kikikuru/amedas）を6行へ展開する。XML定時と随時は同じ値でよい。アメダスの「次回予定」は最新時刻の行だけに出し、地点データの行は「—」 | §4.2、§4.3 |
| 2 | 直近処理時間は列を残し、APIを拡張して表示する（案C）。`fetch_attempt.duration_ms` は既存。集計クエリから直近所要時間を取り、`MonitoringHealthSource` へ項目追加、`monitoringStatusService.ts` で詰める。E10の契約変更として影響範囲・テスト方針を明記 | §3、§5 |
| 3 | タイル（AD-H001）は、雨雲時刻一覧・キキクル時刻一覧の行で索引の**状態と時刻の列のみ**値を出し、他の列は「—」。タイル専用の別欄は設けず、判定基準も新設しない | §4.4 |
| 4 | アメダス地点の検知遅れ（AD-H003）は判定ロジックを変えない。行に「連続失敗 n/5」相当の表示を出す。経過時間は判定に使わない | §4.5 |
| 5 | 評価時刻・scan上限（AD-H041）は、サマリーカード（取得健全性）に評価時刻の**時刻のみ**を出す。脚注なし。flapping抑止は導入しない。評価が一度もない場合は緑でなく「判定待ち」 | §4.6 |
| 6 | 再試行待ちはAPIに項目がないため**今回は表示しない**。「K6でAPIを拡張して出す（C案）」は将来の検討として先送り項目に記録する。「遅延」の表示名は**「遅延」のまま**とする | §4.7、§10 |
| 8 | 取得元表の時刻は日付を含め常に `MM/DD HH:mm:ss`（年は付けない）。同日でも日付を省略しない。この書式は共通フォーマッタとして切り出し、K7の情報表でも同じものを使う | §4.3、§5.1 |
| 9 | 長期フィードは行にしない。基本設計 §8.2 との整合は統括担当が後続で文書修正する | §4.1 |
| 7 | 会場は端末の会場のみを対象とする。他会場は表示しない | §4.8 |

## 2. 対象範囲

### 2.1 K6で実装するもの

- `apps/web/src/monitoring/MonitoringDashboard.tsx` の「取得元別の稼働状況」表を、静的骨格から**実データ接続**へ差し替える（6行×8列）。
- そのための表示変換関数 `buildSourceStatusRows`（新規、`monitoringPresentation.ts` へ追加）。
- 「直近処理時間」を出すためのE10契約拡張（`packages/shared` → `apps/api/src/repositories` → `apps/api/src/monitoring`）。
- Web側DTO検証（`apps/web/src/api/monitoringStatus.ts`）の `health.sources` 要素検証追加。
- AD-H001/H003/H041/H062 の結論記録（§8）。

### 2.2 対象外（やらないこと）

- 「情報別の反映状況」表（K7 #80）。K1の静的骨格のまま残す。
- 健全性の判定ロジック変更（閾値・経過時間条件・flapping抑止・タイル判定基準の新設）。フロントでの再判定も行わない。
- 取得操作（K2 #75）、履歴（K3〜K5）、状態診断ダイアログ（K8 #81）。
- 再試行待ち状態のAPI新設（§10で先送り）。
- 他会場の表示、H端末への展開。
- 上流気象データへの追加取得。画面は保存済み監視情報の読取のみ（AD-H062）。

## 3. E10（稼働状態API）の契約変更【要注意】

確定事項2により、既存の共有DTO `MonitoringHealthSource` に項目を1つ追加する。**これはIssue #42（E10）で確定した契約の変更であり、K6の範囲を超えてサーバー・共有パッケージに触る。**

### 3.1 追加する項目

```ts
// packages/shared/src/monitoringStatus.ts
export interface MonitoringHealthSource {
  // …既存項目は変更しない…
  /**
   * 直近の試行 1 件の所要時間（ミリ秒）。K6 #79 で追加。
   * 直近試行が無い／健全性未評価の場合は null。null を 0 に丸めない。
   * 平均・合計ではなく「最後の 1 回」。複数 sourceKind を持つ系列は
   * lastAttemptAt が最も新しいストリームの値を採る。
   */
  readonly lastDurationMs: number | null;
}
```

### 3.2 値の流れ（上流から順に）

1. **`apps/api/src/repositories/types.ts`** — `FetchStreamHealthSummary` に `lastDurationMs: number | null` を追加。
2. **`apps/api/src/repositories/fetchAttemptRepository.ts`** — `summarizeFetchStreamHealth` の窓SQLの SELECT に `duration_ms` を追加し、`WindowRow` に `duration_ms: number` を足す。JS側 `Date.parse` 降順ソート後の先頭行（`lastAttemptAt` を決めている `firstRow` と同じ行）の `duration_ms` を `lastDurationMs` とする。行が0件のときは `null`。**`lastSuccessAt` の窓外フォールバックには手を加えない**（直近処理時間は最終「成功」ではなく最終「試行」の値）。
3. **`apps/api/src/monitoring/fetchHealthEvaluator.ts`** — `FetchSourceHealthResult` に `lastDurationMs: number | null` を追加。`evaluateFetchSourceHealth` の既存ループ（`latestAttemptAt` を更新している箇所）で、`latestAttemptAt` を更新したストリームの `lastDurationMs` を同時に採る。`suspended` 分岐でも同じ値を返す（停止中でも最後の試行の実測は残る）。**判定ロジック（status・reasons）はこの値を一切参照しない。**
4. **`apps/api/src/monitoring/monitoringStatusService.ts`** — `buildHealthSection` の3箇所（`aggregate === null` の全null分岐、`resultMap` に該当が無い分岐、通常分岐）すべてに `lastDurationMs` を詰める。前2つは `null`。
5. **`apps/web/src/api/monitoringStatus.ts`** — 検証に追加（§5.3）。

### 3.3 影響範囲（変更する既存ファイル）

| ファイル | 変更内容 |
| --- | --- |
| `packages/shared/src/monitoringStatus.ts` | `MonitoringHealthSource` に `lastDurationMs` 追加 |
| `apps/api/src/repositories/types.ts` | `FetchStreamHealthSummary` に `lastDurationMs` 追加 |
| `apps/api/src/repositories/fetchAttemptRepository.ts` | `summarizeFetchStreamHealth` のSELECT・戻り値 |
| `apps/api/src/monitoring/fetchHealthEvaluator.ts` | `FetchSourceHealthResult` と結果組み立て |
| `apps/api/src/monitoring/monitoringStatusService.ts` | `buildHealthSection` の3分岐 |
| `apps/web/src/api/monitoringStatus.ts` | 応答検証 |
| `apps/web/src/monitoring/monitoringTimeFormat.ts` | **新規**。`formatJstMonthDayClock`（§4.3。K7が再利用する） |
| `apps/web/src/monitoring/monitoringPresentation.ts` | 表示変換（§5.1） |
| `apps/web/src/monitoring/MonitoringDashboard.tsx` | 表の実データ化（§5.2） |
| `apps/web/src/monitoring/monitoring.css` | 状態セル・数値列の書式（§5.4） |
| `apps/web/tests/monitoringFixture.ts` | fixtureに `lastDurationMs` 追加 |

既存の**必須項目追加**なので、`FetchStreamHealthSummary` / `FetchSourceHealthResult` / `MonitoringHealthSource` を構築している既存テストはすべて型エラーになる。以下は型エラーが出る可能性が高い既存テストであり、製造担当はここを漏れなく更新する。

- `apps/api/tests/fetchAttemptRepository.test.ts`
- `apps/api/tests/fetchHealthEvaluator.test.ts`
- `apps/api/tests/fetchHealthMonitorService.test.ts`
- `apps/api/tests/fetchHealthNotificationPlanner.test.ts`・`fetchHealthNotificationEmitter.test.ts`（`FetchSourceHealthResult` を組み立てている場合）
- `apps/api/tests/issue42MonitoringApi.test.ts`・`serverMonitoringStatusDisabledPolling.test.ts`・`serverFetchHealthStartup.test.ts`
- `apps/web/tests/monitoringFixture.ts` を使う各テスト

**「型エラーが出たテストを消す・`as any` で通す」ことは禁止**。値を正しく与えて更新する。

### 3.4 テスト方針（E10契約変更分）

| 対象 | 検証すること |
| --- | --- |
| `summarizeFetchStreamHealth` | 直近試行の `duration_ms` が `lastDurationMs` に入る。成功/失敗どちらでも直近の1件を採る。行0件で `null`。`started_at` が同値でid違いのとき、既存の `id` 降順タイブレークと同じ行の値を採る |
| `evaluateFetchSourceHealth` | 複数ストリーム（`radar_times_N1`/`N2`）で `lastAttemptAt` が新しい方の値を採る。`suspended` でも値が残る。`lastDurationMs` を変えても `status`・`reasons` が変わらない（判定に影響しないことの回帰テスト） |
| `monitoringStatusService` | 未評価時は6系列すべて `lastDurationMs: null`。評価後は各系列に値が入る |
| Web DTO検証 | `lastDurationMs` が数値でも `null` でも受理し、負数・文字列は応答不正として弾く |

**`duration_ms` の書き込み状況は実コードで確認済み**：`recordFetchAttempt` は `durationMs` を整数かつ0以上として必須検証している（`validateFetchAttemptInput`）。呼び出し箇所は `jmaXmlPoller.ts`(81行 `Math.max(0, Date.now() - startTimeMs)`)、`nowcastService.ts`(164行)、`kikikuruService.ts`(133行)、`amedasFetchService.ts`（`latestDurationMs` 等）で、いずれも実時間の差分を渡している。**6系列すべてが `duration_ms` を書いている**ため、「書いていない系列は『—』」という退避策は現時点で該当なし。ただし値が常に0にならないことの実行確認は未実施のため、**表示側は `null` を「—」にするだけで、0 を特別扱いしない**（0ms は「0ms」と表示する）。実挙動未確認。

## 4. 表の仕様

### 4.1 列と行

列（K1の `SOURCE_HEADERS` をそのまま使う。**列の追加・削除・並べ替えをしない**）:

`取得元 / 状態 / 適用周期 / 最終試行 / 最終成功 / 次回予定 / 直近処理時間 / 連続失敗回数`

行（K1の `SOURCE_ROWS` と `MONITORED_FETCH_SOURCES` の固定順。**行名の文字列はK1の既存値を変えない**）:

| # | 行名（K1既存） | `sourceId` | `scheduledSource` |
| --- | --- | --- | --- |
| 1 | XML定時フィード | `xml_regular` | `xml` |
| 2 | XML随時フィード | `xml_extra` | `xml` |
| 3 | 雨雲時刻一覧 | `nowcast_target_times` | `nowcast` |
| 4 | キキクル時刻一覧 | `kikikuru_target_times` | `kikikuru` |
| 5 | アメダス最新時刻 | `amedas_latest_time` | `amedas` |
| 6 | アメダス地点データ | `amedas_point` | `amedas` |

行は `health.sources` の配列順ではなく、`sourceId` をキーにして上表の固定順で引く。`health.sources` に該当 `sourceId` が無い場合、その行は全セル「—」とし、行を落とさない。

Issue本文および基本設計 §8.2 にある「初期化・復旧用の長期フィード」は**行にしない**【確定】。理由は次の2点。`xml_feed_regular_long` / `xml_feed_extra_long` は `MONITORED_FETCH_SOURCES` の監視対象外であり（初期化・復旧時のみ取得され周期を持たないため、周期ベースの状態・適用周期・次回予定を持てない）、初期取得の成否は既にK1の「取得運転」カードが `readiness.initialFetchPhase` と `readiness.feeds`（`regular_l` / `extra_l` を含む4フィード）で表示しているため、この表に重複して出す必要がない。基本設計 §8.2 の行リストとの整合は統括担当が後続の文書修正で扱う（本設計書ではこの不採用理由の記録に留める）。

### 4.2 「状態」列

確定事項1に従い、`operation.scheduledSources`（4グループ）を `scheduledSource` の対応で6行へ展開する。XML定時・随時は同じ `xml` の値を見るため同じ表示になる。

表示語の決定順（上から評価し、最初に一致したもの）:

| 順 | 条件 | 表示 | トーン |
| --- | --- | --- | --- |
| 1 | `health.sources[i].status === null`（未評価） | 判定待ち | neutral |
| 2 | `status === 'abnormal'` | 異常 | error |
| 3 | `status === 'delayed'` | 遅延 | attention |
| 4 | `operation.schedulerRunning === false` | 停止 | neutral |
| 5 | `status === 'suspended'` または 対応する `scheduledSources.state === 'scheduled_stopped'` | スケジュール停止 | neutral |
| 6 | `scheduledSources.state === 'running'` | 取得中 | active |
| 7 | 上記以外（`state === 'waiting'` かつ `status === 'normal'`） | 待機 | normal |

- 「停止」と「スケジュール停止」は別の表示語にする（Issue受け入れ条件「停止と失敗が色だけでなく文字でも区別される」は、この表の文字表示で満たす）。
- **「停止」は「スケジュール停止」より先に判定する**（PR #185 レビュー指摘による訂正）。手動停止では、スケジューラが全取得元の `state` を `scheduled_stopped` にし（`timeBasedPollingScheduler.ts` の `!isRunning` 分岐）、健全性評価の `status` も `suspended` になる（`fetchHealthMonitorService.ts` が `state === 'scheduled_stopped'` から導出）。このため順序を逆にすると、実APIでは手動停止が常に「スケジュール停止」と表示され、「停止」に到達しない。時間帯による停止（`schedulerRunning: true` のまま `scheduled_stopped`）だけが「スケジュール停止」になる。
- 異常・遅延を停止で上書きしない（順序2・3を4・5より先に評価する）。K1設計§4.2「取得停止直後の古い異常評価を『正常』で上書きしない」と整合する。
- 「再試行待ち」はAPIに項目がないため**表示しない**（§4.7・§10）。
- 色だけで区別せず、必ず上表の文字を出す。色は `--wx-system-status-*` トークンのみ使用し、HEXを書かない。
- **フロント側で閾値・経過時間から状態を再計算しない。** `status` はサーバーの値をそのまま語に置き換えるだけ。

### 4.3 「適用周期」「次回予定」「最終試行」「最終成功」列

| 列 | 値 | 欠損時 |
| --- | --- | --- |
| 適用周期 | `health.sources[i].intervalSeconds` を秒→表示。60の倍数なら「n分」、それ以外は「n秒」 | `null` → 「—」 |
| 最終試行 | `health.sources[i].lastAttemptAt` を JST `MM/DD HH:mm:ss` | `null` → 「—」 |
| 最終成功 | `health.sources[i].lastSuccessAt` を JST `MM/DD HH:mm:ss` | `null` → 「—」 |
| 次回予定 | 対応する `scheduledSources[].nextRunAt` を JST `MM/DD HH:mm:ss` | `null` → 「—」 |

次回予定の特例（確定事項1）:

- **`amedas_point`（アメダス地点データ）の行は、`scheduledSources` に値があっても常に「—」とする。** 地点取得は最新時刻の結果に従属し、独立した次回予定を持たないため。
- `amedas_latest_time`（アメダス最新時刻）の行にのみ `amedas` グループの `nextRunAt` を出す。
- XML定時・随時は両方に `xml` グループの同じ `nextRunAt` を出す（確定事項1で許容済み）。

#### 時刻書式【確定事項8】

「取得元別の稼働状況」表の時刻は、**日付を含め常に `MM/DD HH:mm:ss`** とする（JST、年は付けない）。`generatedAt` と同じ日付であっても日付を省略しない。

- 日付を常に出すのは、古い時刻を当日の時刻に見せない（何日も前の最終成功が「08:12:30」だけに見える状態を作らない）ためである。省略の有無で意味が変わる書式にしない。
- 秒まで出すのは、取得間隔が最短60秒であり分単位では前回値との差が見えないため。K1のカードが `HH:mm`（分まで）であることとは意図的に粒度が異なる。
- `null` は「—」。日付だけ、時刻だけの部分表示はしない。

この書式は**K7 #80 の情報表（情報時刻・反映時刻）でも同じものを使う**ため、K6で共通フォーマッタとして切り出す。

| 項目 | 内容 |
| --- | --- |
| 置き場所 | `apps/web/src/monitoring/monitoringTimeFormat.ts`（新規） |
| 関数名 | `formatJstMonthDayClock(value: string \| null): string` |
| 返り値 | `MM/DD HH:mm:ss`。`value` が `null`・空文字・`Date.parse` 不能なら `'—'` |
| 実装 | `Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })` の `formatToParts` を使う。既存 `formatJstDateTime` と同じ組み立て方にする |
| K7からの利用 | `import { formatJstMonthDayClock } from '../monitoring/monitoringTimeFormat'`。K7は独自の時刻フォーマッタを新規に作らず、この関数を再利用する |

既存の `formatJstDateTime`（`YYYY/MM/DD HH:mm:ss`、最終表示更新行で使用）と `formatJstTime`（`HH:mm`、カードで使用）は**変更しない**。3つの用途で書式が異なることを、`monitoringTimeFormat.ts` の冒頭コメントに明記する。既存2関数も同ファイルへ移設してよい（その場合は `monitoringPresentation.ts` から re-export し、既存の import を壊さない）。

### 4.4 タイル（AD-H001）の扱い

確定事項3に従う。**雨雲時刻一覧・キキクル時刻一覧の2行だけは、値を出す列を限定する。**

| 列 | 雨雲時刻一覧・キキクル時刻一覧の行 |
| --- | --- |
| 状態 | **値を出す**（§4.2 の通常規則をそのまま適用） |
| 最終試行 | **値を出す**（§4.3 の通常規則） |
| 最終成功 | **値を出す**（§4.3 の通常規則） |
| 次回予定 | **値を出す**（§4.3 の通常規則） |
| 適用周期 | 常に「—」 |
| 直近処理時間 | 常に「—」 |
| 連続失敗回数 | 常に「—」 |

- **健全性判定・状態の導出ロジック自体は他の4行と同じで、変更しない。** サーバー側の評価（`nowcast_target_times` / `kikikuru_target_times` は `MONITORED_FETCH_SOURCES` に含まれる正規の監視対象）はそのまま動き、`status` もそのまま使う。**表示上、一部の列を出さないだけ**である。API側でこの2系列の `intervalSeconds` / `lastDurationMs` / `consecutiveFailures` を `null` に書き換えるような実装をしてはならない。
- 「—」にする3列は、`buildSourceStatusRows` の中で `sourceId` が `nowcast_target_times` / `kikikuru_target_times` のときに空セルへ差し替える。差し替えは表示変換層のみで行う。
- **【注記・既知のトレードオフ】この2行では「連続失敗回数」が「—」になるため、失敗の積み重なり（何回連続で失敗しているか）が行から読み取れない。** 失敗が続いていること自体は**状態列の「遅延」「異常」で判別できる**（`delayedConsecutiveFailures` / `abnormalConsecutiveFailures` による判定はサーバー側で従来どおり働いているため、回数が閾値に達すれば状態列が変わる）。回数そのものを知りたい場合は、K8 #81 の状態診断（`health.sources[*].reasons` に「連続n回失敗」の文言が入っている）で確認する。この割り切りは確定事項3によるものであり、実装で埋め合わせない。
- **タイル画像本体（`radar_tile` / `risk_tile_frame`）に関する専用の欄・行・列を設けない。** 取得中件数・失敗件数・キャッシュ量の表示は作らない。
- **タイル健全性の判定基準を新設しない。** `MonitoringTilesSection.healthMonitored: false` と `healthCriteriaStatus: 'undecided'` は現状のまま維持し、K6でこれらの値を変更しない。
- `tiles.layers[]` の `availableFrameCount` / `upstreamFetchAllowed` / `nextUpstreamAllowedAt` は、K6ではこの表に出さない。

Issue本文の「タイル（オンデマンド取得）は周期取得の行に混ぜず、別の短い欄に表示する」という当初案は、確定事項3により**採用しない**【確定】。

### 4.5 「連続失敗回数」列とアメダス地点の検知遅れ（AD-H003）

確定事項4に従い、**判定ロジックは変更しない**。表示だけを足す。

- 雨雲時刻一覧・キキクル時刻一覧を除く4行（XML定時・XML随時・アメダス最新時刻・アメダス地点データ）の「連続失敗回数」列に `n / N` 形式で表示する。残る2行は §4.4 により常に「—」。`n` は `health.sources[i].consecutiveFailures`、`N` は `health.thresholds.abnormalConsecutiveFailures`（現行設定で5）。**`N` をコードに 5 とハードコードせず、必ず `thresholds` から取る。**
- `consecutiveFailures === null`（未評価）のときは「—」。
- `consecutiveFailures === 0` は「0 / 5」と表示する（「—」にしない。欠測と0件を混同しない）。
- `n >= N` のとき error トーン、`n >= thresholds.delayedConsecutiveFailures` のとき attention トーン。**ここでの着色は表示上の強調であり、状態列の判定を上書きしない**（状態列は §4.2 の通りサーバー値のみで決める）。
- アメダス地点データの行では、`appliesElapsedCondition === false` であることを踏まえ、連続失敗回数のセルに補足を付す。セルの可視テキストは `n / 5` のままとし、`title` 属性と視覚的非表示テキスト（`.visually-hidden` 相当）で「経過時間による判定は行わない（失敗回数のみで判定）」と補う。**「50分」等の具体的な遅れ時間を表示しない**（到達時間は保証されないため、数値を約束に見せない）。
- 経過時間は判定にも表示にも使わない（確定事項4）。

### 4.6 評価時刻・scan上限（AD-H041）

確定事項5に従う。

- サマリーカード「取得健全性」に**評価時刻の時刻のみ**を出す。これは `monitoringPresentation.ts` の既存実装（`評価時刻 ${formatJstTime(...)}`、124–126行）が**すでに満たしており、K6での変更は不要**。実コードで確認済み。
- 脚注（scan上限の注記等）は設けない。`thresholds.maxScanAttempts` は画面に出さない。
- flapping抑止は導入しない。応答ごとの値をそのまま表示する。
- 評価が一度もない場合は緑にせず「判定待ち」。これも既存 `healthPresentation(null)` が満たしている（36–37行）。K6では**表の各行についても**同じ規則を適用する（§4.2 順序1）。
- `consecutiveFailuresCapped`（scan窓で頭打ち）は現在DTOに出ていない。K6で新たに出さない（§10で先送り）。

### 4.7 再試行待ち・「遅延」の表示名（確定事項6）

- **再試行待ち**：`MonitoringScheduledSourceStatus.state` は `waiting | running | scheduled_stopped` の3値、`MonitoringHealthStatus` は `normal | delayed | abnormal | suspended` の4値で、指数バックオフの再試行待ちを表す値はAPIのどこにも無い（実コードで確認）。**K6では表示しない**【確定】。バックオフ中は直前の試行結果に応じて「遅延」「異常」または「待機」と表示される。これを「再試行待ち」と偽らない。Issue本文の状態6語のうち「再試行待ち」だけが本Issueで実装されないことになるが、これは確定事項6によるものであり、推定値で埋めない。APIを拡張して出す案（C案）はユーザーが将来の検討としており、§10に先送り項目として記録する。
- **「遅延」の表示名**：`delayed` の表示語は**「遅延」のまま**とする【確定】。既存カード（`monitoringPresentation.ts` の `healthPresentation`）と同じ語を使い、表とカードで表記を分けない。

### 4.8 会場（確定事項7）

- この表は取得元（上流フィード）単位であり、会場に依存しない。端末の会場に応じて行を増減させない。
- `MonitoringStatusResponse.requestedVenueId` に基づく絞り込みは、この表では行わない（対象データが会場非依存のため）。他会場の情報をこの表に足すこともしない。
- 会場別の要素は「情報別の反映状況」表（K7）の論点であり、K6では扱わない。

### 4.9 未取得・欠測・既知の失敗の扱い（業務標準の維持）

- 「—」は**未接続・未取得・非該当**だけを表す。既知の失敗を「—」で隠さない。
- `null` を `0` や `normal` に丸めない（K1設計§4.1、共有DTOのコメント、[07-wx-data-protocol.md](../rules/07-wx-data-protocol.md)）。
- 未取得だけを理由に赤い異常と判定しない。
- 3状態（`available` / `stale` / `unavailable`）はこの表では扱わない（K7の論点）。boolean へ縮退させる処理をK6で入れない。
- 本番・訓練の区別（`isTraining`）はこの表の対象データに現れない。K6で新たに導入も削除もしない。

## 5. モジュール構成とシグネチャ

### 5.1 `apps/web/src/monitoring/monitoringPresentation.ts`（追記）

```ts
export interface SourceStatusCell {
  /** 可視テキスト。欠測は '—'。 */
  readonly text: string;
  /** 色トークンの選択。省略時は装飾なし。 */
  readonly tone?: MonitoringTone;
  /** title 属性・視覚的非表示テキストで添える補足。 */
  readonly note?: string;
}

export interface SourceStatusRow {
  readonly sourceId: MonitoredFetchSourceId;
  /** 行見出し（K1の SOURCE_ROWS と同じ文字列）。 */
  readonly name: string;
  readonly state: SourceStatusCell;
  readonly interval: SourceStatusCell;
  readonly lastAttempt: SourceStatusCell;
  readonly lastSuccess: SourceStatusCell;
  readonly nextRun: SourceStatusCell;
  readonly duration: SourceStatusCell;
  readonly consecutiveFailures: SourceStatusCell;
}

/**
 * 稼働状態APIから取得元表の6行を作る純粋関数。
 * 閾値・経過時間からの再判定は行わない。data が null のとき全セル '—' の6行を返す。
 * 雨雲時刻一覧・キキクル時刻一覧の行は、§4.4 に従い
 * interval / duration / consecutiveFailures を常に '—' のセルにする。
 */
export function buildSourceStatusRows(
  data: MonitoringStatusResponse | null,
): readonly SourceStatusRow[];

/** 秒を「n分」「n秒」へ。null は '—'。 */
export function formatIntervalSeconds(seconds: number | null): string;

/** ミリ秒を「n ms」または 1000ms 以上なら「n.n 秒」へ。null は '—'、0 は '0 ms'。 */
export function formatDurationMs(durationMs: number | null): string;
```

時刻セルは §4.3 で定めた `monitoringTimeFormat.ts` の `formatJstMonthDayClock` を使う。`buildSourceStatusRows` は `generatedAt` を時刻整形に使わない（同日判定が不要になったため、引数にも取らない）。

`buildSourceStatusRows` は `MONITORED_FETCH_SOURCES` 相当の固定表（`sourceId` → 行名 → `scheduledSource`）をWeb側に持つ。`@wx-viewer-poc/shared` の `MonitoredFetchSourceId` 型を使い、行名はK1の `SOURCE_ROWS` の文字列を再利用する。表定義は `monitoringPresentation.ts` 内の `const SOURCE_ROW_DEFINITIONS` に集約し、`MonitoringDashboard.tsx` の `SOURCE_ROWS` はこれを参照する形へ寄せる（`SOURCE_HEADERS` は現状のまま）。

### 5.2 `apps/web/src/monitoring/MonitoringDashboard.tsx`（改修）

- `SkeletonTable` は「情報別の反映状況」でそのまま使い続ける。
- 取得元表は新コンポーネント `SourceStatusTable`（同ファイル内 `memo`）に差し替える。`props: { rows: readonly SourceStatusRow[] }`。
- 見出しセルは `th scope="col"` / `th scope="row"` を維持する（K1の実装と同じ）。
- 状態セルは `<td class="monitoring-source-state monitoring-tone-{tone}">{text}</td>`。`note` があるセルは `title={note}` と `<span class="monitoring-visually-hidden">{note}</span>` を持つ。
- `state.data === null`（読込中・初回失敗）のときは `buildSourceStatusRows(null)` の全「—」行を出す。K1の「前回値を保持して失敗を明示する」挙動（`MonitoringLoadState.data` が残る場合はその値を表示）はそのまま利用する。

### 5.3 `apps/web/src/api/monitoringStatus.ts`（改修）

`health.sources` を `Array.isArray` だけでなく要素まで検証する。

```ts
function isHealthSource(value: unknown): boolean;
// sourceId が既知6値のいずれか / displayName が string /
// status が null または既知4値 / lastAttemptAt・lastSuccessAt が null 許容ISO /
// consecutiveFailures・intervalSeconds・lastDurationMs が null 許容の非負整数 /
// appliesElapsedCondition が boolean / reasons が配列
```

あわせて `health.thresholds.abnormalConsecutiveFailures` と `delayedConsecutiveFailures` が非負整数であることを検証する（§4.5 で使うため）。`operation.scheduledSources` の要素も `source` が既知4値、`state` が既知3値、`nextRunAt` が null 許容ISO、`intervalSeconds` が null 許容非負整数であることを検証する。不正値は**正常表示へ変換せず**、既存どおり「監視情報の応答形式が不正です」で失敗扱いにする。未知のenum値を `normal` や `waiting` に補完しない。

### 5.4 `apps/web/src/monitoring/monitoring.css`（追記）

- `.monitoring-source-state` … 状態語の表示。トーンクラスは既存 `.monitoring-tone-*` の定義を流用し、**新たなHEXを書かない**。
- 数値列（適用周期・直近処理時間・連続失敗回数）は `text-align: right`、時刻列は `font-variant-numeric: tabular-nums`。
- `.monitoring-visually-hidden` … 既存に同等のクラスがあればそれを使う。無ければこのファイルに定義する。
- K1の寸法予約（取得元枠 240 px = 見出し28 + 列見出し32 + 6行×30）を超えないこと。行の高さを30 pxに収める。

### 5.5 テストファイル

| ファイル | 追加・変更する検証 |
| --- | --- |
| `apps/web/tests/monitoringFixture.ts` | `lastDurationMs` を含む6系列のfixture。未評価fixture、abnormal/delayed/suspended/scheduled_stopped/schedulerRunning=false の各パターン |
| `apps/web/tests/monitoringPresentation.test.ts` | `buildSourceStatusRows` の6行・状態語・「—」・n/N・次回予定の特例・タイル2行の列限定 |
| `apps/web/tests/monitoringTimeFormat.test.ts` | **新規**。`formatJstMonthDayClock` が同日でも `MM/DD HH:mm:ss` を返すこと、年を含まないこと、UTC→JSTの日付繰り上がり（例：`2026-09-21T15:00:00Z` → `09/22 00:00:00`）、`null`・不正文字列が `'—'` になること |
| `apps/web/tests/monitoringDashboard.test.ts` | 表のレンダリング、`th scope`、読込中の全「—」 |
| `apps/web/tests/monitoringStatus.test.ts` | DTO検証の追加分（未知enum・負数・型違いを弾く） |
| `apps/api/tests/fetchAttemptRepository.test.ts` | §3.4 の `lastDurationMs` |
| `apps/api/tests/fetchHealthEvaluator.test.ts` | §3.4 の複数ストリーム・suspended・判定非影響 |
| `apps/api/tests/issue42MonitoringApi.test.ts` | 応答に `lastDurationMs` が含まれる |

## 6. 受け入れ条件（検収担当が1項目ずつ実行する）

### 6.1 表示

- [ ] K端末 `#monitor` を開き、「取得元別の稼働状況」表に §4.1 の6行が上表の順で並び、列が `取得元 / 状態 / 適用周期 / 最終試行 / 最終成功 / 次回予定 / 直近処理時間 / 連続失敗回数` の8列であることを確認する。行数が6、列数が8であること、行名がK1と同じ文字列であることを目視で確認する。
- [ ] 通常運転のfixture（`schedulerRunning: true`、全系列 `normal`、`state: 'waiting'`）で表示し、状態列が全行「待機」であること、XML定時・XML随時・アメダス最新時刻・アメダス地点データの4行で適用周期・最終試行・最終成功・直近処理時間・連続失敗回数に実値が入り「—」でないことを確認する。
- [ ] 同じfixtureで、すべての時刻セルが `MM/DD HH:mm:ss` 形式（例 `09/21 08:12:30`）であり、`generatedAt` と同じ日付の時刻でも日付が省略されていないこと、年が付いていないことを確認する。
- [ ] `readiness`・`venues`・`information`・`tiles` に手を入れていないこと、「情報別の反映状況」表がK1の静的骨格（全セル「—」）のままであることを確認する。

### 6.2 状態列（Issue受け入れ条件「停止と失敗が色だけでなく文字でも区別される」）

- [ ] `health.sources[*].status` を `null / normal / delayed / abnormal / suspended` に変えたfixtureを順に表示し、状態列が「判定待ち／待機／遅延／異常／スケジュール停止」と**文字で**変わることを確認する。CSSを無効化（DevToolsで `color`/`background` を切る、またはグレースケール表示）しても5状態が文字だけで区別できることを確認する。
- [ ] `operation.schedulerRunning: false`・全系列 `state: 'waiting'`・`status: 'normal'` のfixtureで、状態列が全行「停止」になることを確認する。
- [ ] 手動停止の実APIの組み合わせ（`schedulerRunning: false`・全グループ `scheduled_stopped`・全系列 `suspended`）のfixtureで、状態列が全行「停止」になり、「スケジュール停止」に化けないことを確認する（§4.2 順序4が5より先）。
- [ ] 上記と同じfixtureで `schedulerRunning: true` にした（時間帯による停止の）場合に、状態列が全行「スケジュール停止」のままであることを確認する。
- [ ] `schedulerRunning: false` かつ `status: 'abnormal'` のfixtureで、状態列が「異常」であり「停止」に上書きされないことを確認する（§4.2 順序2が4・5より先）。
- [ ] `scheduledSources` の `nowcast` だけ `state: 'scheduled_stopped'` にしたfixtureで、雨雲時刻一覧の行だけが「スケジュール停止」、他の行が変わらないことを確認する。
- [ ] `state: 'running'` のfixtureで該当行が「取得中」になることを確認する。
- [ ] `status: null`（`health.evaluatedAt: null`）のfixtureで、状態列が全行「判定待ち」であり、緑（正常）の配色になっていないことを確認する。
- [ ] 表のどこにも「再試行待ち」の文字が出ないことを確認する（本文検索で0件）。

### 6.3 4グループ→6行の展開（確定事項1）

- [ ] `scheduledSources` の `xml` に `nextRunAt` を設定したfixtureで、XML定時フィードとXML随時フィードの「次回予定」が**同じ値**で表示されることを確認する。
- [ ] `scheduledSources` の `amedas` に `nextRunAt` を設定したfixtureで、「アメダス最新時刻」行の次回予定に値が入り、「アメダス地点データ」行の次回予定が**「—」**であることを確認する。
- [ ] `scheduledSources` の `xml` グループの `intervalSeconds` と `health.sources['xml_regular'].intervalSeconds` が異なる値のfixtureで、XML定時フィード行の適用周期列が `health.sources[i].intervalSeconds` 側の値を表示していることを確認する（§4.3）。
- [ ] `apps/web/src/monitoring/monitoringTimeFormat.ts` に `formatJstMonthDayClock` が存在し、`npm run test -w apps/web` で `monitoringTimeFormat.test.ts` が通ることを確認する。UTC 15:00 台の値がJSTで翌日の日付になることを含む。
- [ ] 取得元表のコードが独自の `Intl.DateTimeFormat` を持たず、`formatJstMonthDayClock` を呼んでいることをコードで確認する（時刻整形が1箇所に集約されていること）。既存 `formatJstDateTime` / `formatJstTime` の書式が変わっていないこと（最終表示更新行は `YYYY/MM/DD HH:mm:ss`、カードは `HH:mm`）を画面で確認する。

### 6.4 直近処理時間（E10契約変更・確定事項2）

- [ ] `packages/shared/src/monitoringStatus.ts` の `MonitoringHealthSource` に `lastDurationMs: number | null` があり、コメントに「直近1回の試行」「null を 0 に丸めない」旨が書かれていることを確認する。
- [ ] `apps/api/src/repositories/fetchAttemptRepository.ts` の `summarizeFetchStreamHealth` のSQLに `duration_ms` が含まれ、`lastAttemptAt` を決めている行と同じ行の値を返していることをコードで確認する。
- [ ] `npm run test -w apps/api` を実行し、`fetchAttemptRepository.test.ts` の `lastDurationMs` テストが通ることを確認する。直近試行が失敗でもその失敗試行の所要時間が返ることを含む。
- [ ] `fetchHealthEvaluator.test.ts` で、`lastDurationMs` の値だけを変えたケース同士で `status` と `reasons` が一致することを確認する（判定に影響しない）。
- [ ] `nowcast_target_times`（`radar_times_N1` と `N2` の2ストリーム）のfixtureで、`lastAttemptAt` が新しい方のストリームの所要時間が採られることを確認する。
- [ ] 実APIを起動し `GET /api/monitoring/status?terminalId=<K端末ID>` の応答JSONに `health.sources[*].lastDurationMs` が6要素すべてに存在することを確認する（未評価直後は全て `null`）。しばらく取得を回した後に再取得し、値が入った系列があることを確認する。値が入らない系列があれば、その系列名を検収報告に記録する（§3.4 の実挙動未確認の解消）。
- [ ] 画面で、XMLまたはアメダスの行について `lastDurationMs: null` が「—」、`0` が「0 ms」、`1500` が「1.5 秒」と表示されることを確認する。`null` が「0 ms」になっていないこと。（雨雲・キキクルの行は §4.4 により常に「—」なのでこの確認に使わない。）
- [ ] §3.3 の表にある既存テストが、`as any` や `@ts-expect-error` やテスト削除で通されていないことを diff で確認する。

### 6.5 連続失敗回数とアメダス地点（AD-H003・確定事項4）

- [ ] `consecutiveFailures: 0` のfixtureで、XML定時フィードの行が「0 / 5」と表示され、「—」になっていないことを確認する。
- [ ] `consecutiveFailures: null` のfixtureで「—」と表示されることを確認する。
- [ ] `health.thresholds.abnormalConsecutiveFailures` を 5 から 7 へ変えたfixtureで、表示の分母が「/ 7」へ追随することを確認する（ハードコードされていない）。
- [ ] 「アメダス地点データ」行の連続失敗回数セルに、`title` 属性または視覚的非表示テキストで「経過時間による判定は行わない」旨の補足があり、「50分」等の具体的な遅れ時間が表示されていないことを確認する。
- [ ] `apps/api/src/monitoring/fetchHealthEvaluator.ts` と `fetchHealthConfig.ts` に判定ロジックの変更が入っていないことを `git diff origin/main` で確認する（`lastDurationMs` の受け渡し以外の差分がないこと）。

### 6.6 タイル（AD-H001・確定事項3）

- [ ] 「雨雲時刻一覧」「キキクル時刻一覧」の2行で、**状態・最終試行・最終成功・次回予定の4列に値が入り**、**適用周期・直近処理時間・連続失敗回数の3列が「—」**であることを確認する。他の4行では同じ3列に値が入っていることを確認する（列限定が2行だけに効いていること）。
- [ ] `health.sources` の `nowcast_target_times` に `intervalSeconds: 60`、`lastDurationMs: 800`、`consecutiveFailures: 3` を設定したfixtureで、それでも当該行の3列が「—」のままであることを確認する（表示変換層で落としている）。
- [ ] 同じfixtureで、APIの応答JSON側では `nowcast_target_times` の `intervalSeconds` / `lastDurationMs` / `consecutiveFailures` が `null` に書き換えられていないことを確認する（サーバーの値を壊していない）。
- [ ] `nowcast_target_times` の `status` を `abnormal` にしたfixtureで、連続失敗回数が「—」でも状態列が「異常」と表示され、失敗が続いていることが判別できることを確認する（§4.4 の注記のとおり）。
- [ ] 画面のどこにも、タイル画像本体の取得中件数・失敗件数・キャッシュ量を示す欄が追加されていないことを確認する。
- [ ] `MonitoringTilesSection` の `healthMonitored: false` と `healthCriteriaStatus: 'undecided'` が変更されていないことを `git diff origin/main -- packages/shared` で確認する。
- [ ] `tiles.layers` の値が取得元表に流し込まれていないことをコードで確認する。

### 6.7 評価時刻・scan上限（AD-H041・確定事項5）

- [ ] 「取得健全性」カードに「評価時刻 HH:mm」が表示され、日付や秒が付いていないことを確認する。
- [ ] `health.evaluatedAt: null` のfixtureで、カードが「判定待ち」と表示され、評価時刻が「—」であり、緑になっていないことを確認する。
- [ ] 画面に `maxScanAttempts` の値や scan 上限に関する脚注が表示されていないことを確認する。
- [ ] 同じfixtureを2回続けて読み込ませたとき、表示がそのまま追随し、前回値を保持する平滑化（flapping抑止）のロジックが入っていないことをコードで確認する。

### 6.8 会場・データ規律（確定事項7・業務標準）

- [ ] 端末を東地区／TRCで切り替えても、取得元表の行数・行名が変わらないことを確認する。他会場を示す行や列が増えないことを確認する。
- [ ] 表示コードに、`null` を `0` や `'normal'` や `'available'` へ補完する処理が無いことをコードで確認する。
- [ ] 取得元表のCSS・コンポーネント・fixtureにHEXの色リテラルが無いことを `grep -rnE '#[0-9a-fA-F]{3,8}' apps/web/src/monitoring apps/web/tests/monitoringFixture.ts` で確認する（0件）。
- [ ] 未知のenum値・負数・不正JSON・400/404/500を与えたとき、表が正常表示へ変換されず、K1の失敗表示になることを確認する。

### 6.9 レイアウト・アクセシビリティ

- [ ] 1920×1080 および 1920×960 CSS px・倍率100% で表示し、監視本体の `scrollHeight` が `clientHeight` 以内、横溢れがないことを実測値付きで記録する。取得元表の高さがK1予約の240 px前後に収まっていることを実測する。
- [ ] 1280×720 と文字拡大200% で、ヘッダー・ツールバー・通知欄が本体と一緒に流れず、状態語が切れないことを確認する。
- [ ] 使用する明暗テーマ両方で、状態語の文字色と実際の背景の組合せが通常文字4.5:1以上であることを計測する。シード値の表示色固定や生成色の直接上書きで対処せず、不足が残る場合は統括へ戻す。
- [ ] 表が `th scope="col"` / `th scope="row"` を持ち、スクリーンリーダーで行見出しと列見出しが対応付くことを確認する。状態がアイコン・色単独で伝えられていないことを確認する。
- [ ] キーボードでナビから表へ移動でき、補足テキストが大量に反復読み上げされないことを確認する。

### 6.10 ビルド・静的検査

- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`、`npm run test -w apps/api`、`npm run build` をすべて実行して通過する。
- [ ] `git diff origin/main --stat` の変更ファイルが §3.3 の表の範囲に収まっていることを確認する。

## 7. AD-H001 / AD-H003 / AD-H041 / AD-H062 の結論記録

Issue #79 の追加受け入れ条件に対応する。棚卸し（[docs/audit-epic-a-d.md](../audit-epic-a-d.md)）の管理項目に対する、K6時点での結論を以下に記録する。**採否待ちの保守事項を修正必須へ昇格させていない。**

| 管理項目 | 棚卸し時の状態 | K6の結論 | 未決として残すもの |
| --- | --- | --- | --- |
| AD-H001 タイルの健全性基準 | 未決仕様／未決。「要求数・失敗率等の採否を先に判断。既存周期基準を流用しない」 | **判定基準を新設しない。** 画像本体の専用欄も設けない。雨雲・キキクルの行は索引（時刻一覧）の**状態・最終試行・最終成功・次回予定の4列のみ**を表示し、適用周期・直近処理時間・連続失敗回数は「—」とする。健全性判定ロジックは他行と同一のまま変更しない。`healthMonitored: false` / `healthCriteriaStatus: 'undecided'` を維持（確定事項3） | 画像本体の健全性基準そのもの。L2 #84 へ残す |
| AD-H003 アメダス地点の検知遅れ | 未決仕様／未決。「許容性・運用表示・別検知の要否を判断」 | **判定ロジックを変更しない。** 運用表示として、連続失敗回数を `n / N` で明示し、地点行には「経過時間による判定は行わない」旨を補足する。到達時間（最悪50分等）は表示しない（確定事項4） | 許容性の最終判断と別検知の要否。L2 #84 へ残す |
| AD-H041 健全性評価の運用初期値・境界 | 残留リスク／確認待ち。「測定結果と評価時刻を表示。flapping抑止の追加は採否待ち」 | **評価時刻をサマリーカードに時刻のみ表示**（既存実装が充足済み。K6で変更なし）。脚注なし。**flapping抑止は導入しない。** 評価が一度もない場合は「判定待ち」で緑にしない（確定事項5） | flapping抑止の採否、`consecutiveFailuresCapped` の露出、scan上限の運用注記。L2 #84 へ残す |
| AD-H062 索引周期と画面再読込頻度 | 未決仕様／未決。「画面は保存catalog読込、表示更新頻度をE/Fで判断」 | **K6は保存済み監視情報の読取のみ**。取得元表の描画・更新で `refreshTimes` 等の上流取得を一切起こさない。更新頻度はK1で承認済みの「完了後5秒・10秒タイムアウト」を継承し、K6で変更しない | 雨雲・キキクル**画面**（F2 #45 / F3 #46）の表示更新頻度。K6の対象外 |

## 8. 後続Issueへの引き継ぎ

- **K7 #80【重要】**：情報表の「情報時刻」「反映時刻」は、本書が新設する `apps/web/src/monitoring/monitoringTimeFormat.ts` の `formatJstMonthDayClock`（`MM/DD HH:mm:ss`、同日でも日付を省略しない）を**そのまま再利用する**。K7で独自の時刻フォーマッタを作らない。`SourceStatusCell` / `formatIntervalSeconds` も再利用してよい。`availability` の3状態、会場別要素、情報時刻の発表／観測／基準時刻の区別はK7で決める。「情報別の反映状況」表は本書で触っていない。
- **K8 #81**：状態診断ダイアログでは、本表に出さなかった `health.sources[*].reasons`（判定理由の文言）、`thresholds`、`consecutiveFailuresCapped` 相当の情報を扱うことを検討する。本表は「状態」1語に集約しているため、理由の提示先がK8になる。**特に、雨雲時刻一覧・キキクル時刻一覧の連続失敗回数は本表で「—」としたため（§4.4）、回数を確認する唯一の画面上の手段がK8になる。**
- **K2 #75**：「再試行待ち」「停止処理中」「強制更新中」を表せるAPI項目の不足は、K1設計§9に続きK6でも解消していない。K2でAPI拡張の要否を判断する（§10）。
- **L2 #84**：AD-H001 の画像本体健全性基準、AD-H003 の許容性判断、AD-H041 の flapping 抑止採否を残す。
- **E10 #42**：`MonitoringHealthSource.lastDurationMs` を本Issueで追加した。E10設計書との整合更新は統括担当が別途扱う。

## 9. ユーザーの判断を要する点

**なし。** 初版で挙げた6件はすべてユーザー判断により確定し、本文へ反映済みである。記録として結論を残す。

| # | 初版の論点 | 確定した結論 | 反映箇所 |
| --- | --- | --- | --- |
| 1 | タイル行の解釈 | **解釈(2)を採用**。雨雲・キキクル時刻一覧の行は、状態・最終試行・最終成功・次回予定の4列のみ値を出し、適用周期・直近処理時間・連続失敗回数は「—」。タイル専用の別欄は作らない。判定・状態の導出ロジックは他行と同じで変えない | §4.4、§4.5、§6.6 |
| 2 | 再試行待ちの扱い | **今回は表示しない。** APIを拡張して出すC案は将来の検討とし、先送り項目へ記録 | §4.7、§10 |
| 3 | 「遅延」の表示名 | **「遅延」のまま** | §4.7 |
| 4 | 長期フィード行の不採用 | **行にしない。** 基本設計 §8.2 との整合は統括担当が後続で文書修正する。本書には不採用理由のみ記載 | §4.1 |
| 5 | 時刻書式 | **常に `MM/DD HH:mm:ss`**（年なし、同日でも日付を省略しない）。共通フォーマッタとして切り出し、K7の情報表でも同じものを使う | §4.3、§5.1、§8 |
| 6 | 連続失敗回数の表記 | **`n / N`**（分母は `thresholds.abnormalConsecutiveFailures` から取る） | §4.5 |

## 10. 判断を先送りにした点

- **再試行待ち状態のAPI拡張（C案）**：ユーザーが**将来の検討**として保留した。`fetch_attempt.attempt_no` からバックオフ中を推定することは可能だが、推定で状態語を作ると「実データと照合できたものだけを確定として扱う」規律に反するため、本Issueでは推定表示もしない。拡張する場合の検討先は**K2 #75**（停止理由・停止処理中・強制更新中のAPI不足と合わせて扱うのが自然）、または再度K6系の追加Issue。Issue本文の状態6語のうち「再試行待ち」だけが未実装になる点を、統括担当はIssueクローズ時に認識しておくこと。
- **`consecutiveFailuresCapped` の露出**：`summarizeFetchStreamHealth` は計算しているが `MonitoringHealthSource` に出ていない。scan窓で失敗回数が頭打ちであることを画面に示す要否はAD-H041の採否待ち。K6では出さない。
- **`health.sources[*].reasons` の画面提示**：判定理由の文言はDTOにあるが、8列の表に収まらない。K8 #81 へ送る。
- **タイル画像本体の健全性基準**：AD-H001 のとおり未決のまま L2 #84 へ。
- **`thresholds` の可視化**：`delayedIntervalMultiplier` / `abnormalElapsedSeconds` / `maxScanAttempts` は画面に出さない。運用時に閾値を確認したい要求が出た場合はK8で扱う。

## 11. 設計時点の検証状況

コード・DTO・既存テスト構成の静的調査を実施した。実コードで確認した事項:

- `MonitoringHealthSource` に直近処理時間に相当する項目が無いこと（確認済み）。
- `summarizeFetchStreamHealth` が `duration_ms` をSELECTしていないこと（確認済み、255–352行）。
- 6系列すべての取得処理が `recordFetchAttempt` に実時間から算出した `durationMs` を渡していること（確認済み。`jmaXmlPoller.ts`81、`nowcastService.ts`164、`kikikuruService.ts`133、`amedasFetchService.ts` の各 `durationMs`）。「`fetch_attempt` へ所要時間を書いていない系列」は**現時点で該当なし**。
- `MonitoringScheduledSourceStatus.state` と `MonitoringHealthStatus` に再試行待ちを表す値が無いこと（確認済み）。
- 「取得健全性」カードの評価時刻・「判定待ち」表示が既存実装で充足済みであること（確認済み、`monitoringPresentation.ts` 36–37, 124–126行）。
- `MonitoringDashboard.tsx` の取得元表が全セル `—` の静的骨格であること（確認済み、76–115, 179行）。

**実挙動未確認**の事項:

- devサーバー・実API・実DBでの `lastDurationMs` の値（0にならないか、系列ごとに値が入るか）。§6.4 の検収項目で確認する。
- ブラウザでの実寸計測、1920×1080／960 での取得元表の高さ、コントラスト比の実測。
- 6行に実データが入った状態でのレイアウト崩れの有無。
- `apps/api/tests` のどのテストが型エラーになるかの実行確認（§3.3 は import 関係からの推定を含む）。製造担当は `npm run typecheck` で網羅的に洗い出すこと。

改訂時点でも上記の実挙動未確認は解消していない。時刻書式（`MM/DD HH:mm:ss`）が6列すべてに入った状態での列幅・横溢れも**実挙動未確認**であり、§6.9 の実測で確認する。日付を常に出すぶん時刻列が長くなるため、K1予約の枠に収まらない場合は列幅配分（取得元列を狭める等）で調整し、書式を短縮して対処しない。

着手時の `git status --porcelain` は差分なし（ブランチ `feature/issue-79-source-status-table`）。本フェーズの成果物は本設計書1本のみ。コード・設定の変更、コミット、PR作成は実施しない。同ディレクトリの `issue-80-information-status-table.md` は別担当（K7 #80）の作業中ファイルであり、本フェーズでは一切触れていない。
