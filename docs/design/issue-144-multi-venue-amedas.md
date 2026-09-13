# Issue #144 設計書: C17. 複数会場アメダス定期取得の接続

作成日: 2026-09-14

対象: [Issue #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)  
状態: 設計承認待ち。製造予定ブランチは `codex/issue-144-multi-venue-amedas`。製造は承認後に AGY へ委託する。

## 1. 目的・ヒアリング結果

既存の時間帯別スケジューラから、東京ビッグサイトの江戸川臨海と東京流通センターの羽田を定期取得する。画面・端末から収集を起動せず、地点ごとの保存値と取得状態を独立させる。

2026-09-14 のヒアリングで、次を【確定】した。

1. `latest_time.txt` は地点ごとに取得する。異なる地点間で取得・成功失敗履歴を共通化しない。
2. 同一地点を参照する複数会場は、地点コードをキーに取得・状態・保存を共有する。
3. 地点取得失敗時は、その地点だけ次の既存定期周期で再試行する。正常地点は最新時刻更新時または600秒の再確認を維持する。独立タイマーは作らず夜間停止に従う。
4. 起動時の過去取得は行わない。定期収集は `backfillBlocks: 0` とする。

表示 API/UI、品質フラグの解釈追加、健全性閾値変更、過去区間の補完は対象外。

## 2. 参照資料・現物確認

- Issue 本文（統括担当が取得した内容を共有）：同一スケジューラによる両地点取得、片地点失敗・回復、最新時刻失敗、夜間境界、再起動の検証を要求。
- [基本設計](../basic-design.md) §5.10・取得スケジュール、[Issue 一覧](../issues-draft.md) C17/E5/G6：既存の取得仕様と後続の表示責務を確認。設計案・未確定の表示仕様は確定扱いしない。
- [C9 設計](issue-19-amedas-normalization.md)、[C14 設計](issue-24-time-based-polling-scheduler.md)：正規化・保存・時間帯制御を維持する。
- `packages/shared/src/venueForecastTargets.ts`：`VENUE_IDS = ['east', 'trc']`、`east → 44136 / 江戸川臨海 / 11112010`、`trc → 44166 / 羽田 / 11110000`。
- `apps/api/src/polling/timeBasedPollingScheduler.ts`：現行 factory は east 既定の状態1個。スケジューラは source ごとにタイマーと実行中 Promise を保持し、単一 `amedas` source を前提とする。
- `apps/api/src/polling/amedasFetchService.ts`：状態は会場から対象を解決。最新時刻・地点の成功失敗を別管理し、地点未試行では地点失敗数を更新しない。最新時刻履歴の `targetRef` は現行 `null`。
- `apps/api/src/repositories/amedasRepository.ts`：保存キーは `station_code`、stale 書き込みでは既存観測行を保持。
- `apps/api/src/monitoring/fetchHealthMonitorService.ts`：健全性は `sourceKind` 単位の集約であり、地点別状態そのものではない。
- `apps/api/tests/timeBasedPollingScheduler.test.ts` の既存600秒試験は地点応答に空 JSON を使用している。これは構造異常となるため、今回の失敗再試行仕様では正常系 fixture に置き換える必要がある。

上記は静的確認。変更後の実行、上流への実通信、夜間境界・再起動の実挙動は設計時点で**実挙動未確認**。新しい気象庁提供仕様の確定は行わない。

## 3. モジュール構成・内部インターフェース

### 3.1 地点単位の編成

`apps/api/src/polling/timeBasedPollingScheduler.ts` 内に、単一 source を返す集合 adapter を追加する。既存の単地点 `AmedasScheduledAdapter` と単発 `runAmedasFetchCycle` は維持する。

```ts
export class MultiVenueAmedasScheduledAdapter implements ScheduledPollAdapter {
  readonly source: ScheduledSource = 'amedas';
  constructor(adapters: readonly AmedasScheduledAdapter[]);
  runScheduled(): Promise<void>;
}
```

factory の既定経路で `VENUE_IDS` を列挙し、`resolveAmedasTarget(venueId)` が返す地点コードで重複排除する。各地点につき代表会場の `AmedasFetchState` と単地点 adapter を1個だけ生成し、同一プロセスの全周期で使い続ける。同一地点の会場定義は `displayName`・`elements` も一致することを検査し、不一致は構成エラーとして生成時に例外にする。これは重複排除により定義誤りが隠れるのを防ぐ内部検証である。

重複排除を直接テストできる内部ヘルパーを設ける。

```ts
export function resolveUniqueAmedasVenues(
  venueIds: readonly VenueId[],
  resolveTarget?: (venueId: VenueId) => AmedasTarget,
): readonly VenueId[];
```

既定 resolver は `resolveAmedasTarget`。地点コードの初出順で代表会場を返す。テストのみ合成 resolver で両会場が同一地点となる条件を注入する。コードに地点番号を追加ハードコードしない。

`createScheduledAdapters(options: CreateScheduledAdaptersOptions): readonly ScheduledPollAdapter[]` の戻り値は引き続き nowcast、kikikuru、amedas の3個。単一 source に地点 adapter を複数登録しない。既存の明示注入 `amedasState` / `amedasVenueId` は単地点用途として維持し、両方あるときは現行どおり state を優先する。無指定の本番経路を全会場対応にする。新しい実行時設定は追加しない。

集合 adapter は各地点を同じ呼び出し内で開始し、`Promise.allSettled` で全地点の終了を待つ。通常の HTTP・パース失敗は既存の結果として処理される。予期しない例外も他地点の完了を妨げず、全地点終了後に集約して例外を通知する。スケジューラの実行中判定が全地点の終了まで維持されるため、遅い地点を残して次周期が重ならない。

### 3.2 地点別の再試行

単地点 adapter の policy を以下に変更する。600秒は既存 `amedasPointRecheckSeconds` に従う。

| 条件 | 地点取得 policy |
| --- | --- |
| 初回、地点の連続失敗数が1以上、または最後の地点試行から再確認時間以上 | `always` |
| 上記以外 | `onLatestTimeChange` |

既存の `state.getStreamStatus('pointData').consecutiveFailures` を利用し、成功時のリセットを既存 service に任せる。HTTP 失敗・タイムアウト・構造異常が再試行対象。取得成功で値が遅延して stale の場合は取得失敗とは扱わず、現行の更新/600秒判定を使う。

再確認時刻はその地点で `pointData.attempted` が true の場合だけ更新する。最新時刻失敗時は地点を試行せず、再確認時刻・地点失敗数・再試行待ち状態を維持する。最新時刻の取得は毎周期・地点ごとに行うので、最新時刻だけ失敗した地点も次周期で最新時刻を再取得する。

定期 adapter から渡す `triggerKind: 'scheduled'` と `backfillBlocks: 0` は fetchOptions より後に設定し、定期経路で過去取得が混入しないようにする。単発 service の既存 backfill 機能は変更しない。

### 3.3 履歴・保存・公開面

`amedasFetchService.ts` の最新時刻履歴の成功・失敗両方で `targetRef: target.stationCode` とする。URL は共通でも、今回は各地点のサイクルで別に取得するため帰属地点を記録する。既存の sourceKind は変更せず、過去の `targetRef: null` 行は書き換えない。地点 JSON 履歴は既存どおり地点コードを保持する。

`runAmedasFetchCycle(connection, state, options?): Promise<AmedasFetchCycleResult>`、snapshot の型、DB スキーマ、repository のシグネチャは変更不要。保持値・availability の3状態、AQC、非対応要素、推計フラグは既存の正規化をそのまま使う。他地点へのフォールバックを追加しない。訓練通知経路も変更しない。

REST エンドポイントは追加しない。`server.ts` の通常起動とスケジューラ再生成の両経路は factory 既定を使うことを確認する。factory を閲覧処理から呼ばない。

## 4. 変更対象と実装順

1. `apps/api/src/polling/timeBasedPollingScheduler.ts`：地点編成、集合 adapter、失敗再試行、定期 backfill 固定。
2. `apps/api/src/polling/amedasFetchService.ts`：最新時刻取得履歴の地点帰属。
3. `apps/api/tests/timeBasedPollingScheduler.test.ts`：既存正常系 fixture 修正と単地点再試行検証。
4. `apps/api/tests/multiVenueAmedasScheduler.test.ts`（新規）：factory から実 service・一時 DB・fake timer を接続した両地点検証。
5. `apps/api/tests/amedasFetchService.test.ts`：最新時刻履歴の成功/失敗と地点帰属、既存期待値の更新。

必要な import/export とテスト用ヘルパーは上記に含む。表示層・監視ロジック・共有会場定義・マイグレーションへの変更は予定しない。

## 5. 検証と受け入れ条件

全て外部通信しない fixture/fake fetch と一時 DB を使用する。時刻は adapter の now と service の clock を同期する。HTTP 先は URL 別に識別し、最新時刻の共通 URL については同時取得の呼び出し順を固定できる mock を使い、失敗させた地点は結果の `targetRef` でも確認する。期待値は固定値・完全一致を基本とする。

- [ ] **AC1 両地点と履歴**：factory 無指定のアメダス adapter を1周期実行する。最新時刻2回、地点 JSON は44136/44166各1回、過去ブロック0回。DB に各地点の異なる fixture の観測値が保存され、最新時刻・地点履歴の計4行がそれぞれ正しい地点コードと `scheduled` を持つ。
- [ ] **AC2 正常時の省略と境界**：同じ最新時刻で初回成功後599秒では両地点 JSON を取得せず、600秒では各1回取得する。600秒未満でも最新時刻更新時は各地点を取得する。最新時刻は全ての周期で地点ごとに1回取得する。
- [ ] **AC3 片地点の失敗・回復**：両地点正常保存後、時刻更新周期で羽田のみ HTTP 503 にする。羽田は stale で直前値保持、江戸川臨海は更新成功。次の既存周期で時刻不変のまま羽田だけ再取得して回復し、失敗数0・available・新しい羽田値になる。正常地点の地点 JSON 回数と再確認時刻は余分に増えない。羽田初回失敗も別ケースで実行し、unavailable・観測行なし・江戸川臨海値の流用なしを確認する。
- [ ] **AC4 構造異常と継続失敗**：羽田だけ不正な地点 JSON を返し、連続する2周期で羽田の取得回数と失敗数が各1増えることを確認する。正常地点は省略される。復旧後の次周期では羽田も通常の省略に戻る。
- [ ] **AC5 最新時刻失敗**：片地点だけ最新時刻取得に失敗させ、もう一方の取得・保存が完了することを確認する。失敗地点は地点未試行、地点失敗数と再確認時刻が変わらない。初回失敗と、地点失敗後の再試行待ちに最新時刻失敗を挟む場合を実行し、回復周期で地点を取得する。両地点の最新時刻失敗も実行し、履歴2行・地点取得0回を確認する。
- [ ] **AC6 同一地点共有**：重複排除 helper に合成 resolver を注入し、同一地点の2会場から代表会場1個だけが返ることを完全一致で確認する。その代表を用いた編成で状態/adapterが1個、最新時刻と地点 JSON が各1回となることを確認する。同じ地点コードで elements または表示名が異なる場合は生成前に例外となる。
- [ ] **AC7 夜間・実行中完了**：実 factory の集合 adapter を fake timer の `TimeBasedPollingScheduler` に接続する。20:00 JST 前に両地点の応答を保留して開始し、20:00を越えて応答を解放すると両地点が保存される。夜間中は再試行を含め追加通信0回。翌04:00に両地点取得が再開する。夜間に新規起動した場合も04:00まで通信0回。既定の日中300/60/300秒は既存試験で確認する。
- [ ] **AC8 再起動と保持**：一時ファイル DB に両地点を正常保存して接続を閉じ、再接続して新しい factory/状態を作る。日中初周期は同じ最新時刻でも両地点を取得し、過去ブロック取得0回。同条件で羽田失敗の場合は再起動前の羽田値を stale で保持し、江戸川臨海値と混同しない。
- [ ] **AC9 非提供・欠測の維持**：両地点の実 service 取得経路に品質付き fixture を渡す。羽田の湿度等の非提供要素が正常な数値や他地点の値にならず、対応要素の AQC 5/6 の null と qualityFlag、江戸川臨海の日照推計フラグが既存契約どおり保存されることを確認する。
- [ ] **AC10 多重実行・例外分離**：片地点の Promise を保留し、全体の完了が先行しないことと次周期が重ならないことを確認する。片地点の予期しない例外を注入しても他地点は完了し、集合 adapter は全地点終了後に例外を返す。スケジューラ登録は amedas 1個である。`server.ts` の起動/再生成経路と閲覧側の呼び出し関係を静的確認し、端末数・画面数に応じた収集起動がないことを記録する。
- [ ] **AC11 回帰・検証規律**：`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が全て成功する。追加テストは業務標準05に従い、意味を変えない改変の対照実験後、対象の配線/再試行/地点分離を意図的に壊して落ちることを確認し、復旧後の結果とともに報告する。

## 6. 後続 Issue への引き継ぎ・残留リスク

- E5 #37/G6 #57 は会場定義から地点を解決し、対応する snapshot の値と availability を読む。未取得は正常値と見なさず、未提供要素・欠測・取得失敗を区別する。DTO/UI の具体的表現は今回確定しない。
- 定期 backfill は0のため、再起動中や停止期間の過去ブロックは埋まらない。プロセス内の失敗数・再確認時刻は再起動で初期化され、DB の保持値は残る。
- 現行の健全性監視は `source_kind` ごとに複数地点の履歴を集約する。他地点の成功によって集約上の連続失敗が途切れるため、地点単独の異常を代表しない場合がある。今回の地点状態・snapshot と監視集約は別契約であり、地点別監視や検知遅れの扱いは後続の監視設計へ引き継ぐ。閾値・集約処理は変更しない。
- 最新時刻を2地点で別取得するため、更新境界で返る時刻が地点間で異なる可能性がある。各地点が取得した時刻だけで自分のブロックと状態を判断する。履歴件数も従来より増える。
- 上流や DB 自体が共通障害となる場合まで独立稼働を保証するものではない。通常の片地点 HTTP/パース失敗は他地点の正常値を上書きしない。

要ヒアリング事項: なし。本文の実装設計は承認対象であり、製造開始は統括担当による設計提示とユーザー承認後とする。
