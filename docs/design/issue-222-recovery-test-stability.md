# Issue #222 設計書: 復旧オーケストレーションテスト AC17/18 の時刻依存除去と失敗時終了保証

## 1. 背景と原因(記録)

- 失敗箇所: `apps/api/tests/databaseRecoveryOrchestration.test.ts` の AC17/18 テスト内 `assert.ok(fetchCount > 0)`(調査時点662行)。直前の `assert.equal(fetchCount, 0)`(659行)は通過している。
- 原因: 同テストは `startServer` に `pollingSchedule` を渡さないため `config/polling.yaml` が使われる。同ファイルの `20:00`〜`04:00`(JST、UTC 11:00〜19:00)帯は `xmlSeconds: null` であり、この時間帯は上流取得が開始されない。調査時の実行時刻 UTC 14:17 で毎回再現した。**実装はスケジュール通りに動いており不具合ではない**(テストの時刻依存)。
- 停止の原因: assert失敗で `server.close()` に到達せず、HTTPサーバー・ポーリングタイマーが残留してテストプロセスが終了しない。
- 未実施事項: PR#221 のCI run時刻と夜間帯の照合は未実施。検収で記録する(AC-1)。
- 環境固有事項(参考): 調査環境ではローカル依存導入に `npm_config_nodedir=/opt/node22 npm ci` と `npm run build -w packages/shared` が必要だった。

## 2. 参照資料と確定事項

- 統括担当から渡されたユーザー承認済み方針(そのまま前提とする)
  1. テストに終日 `xmlSeconds` が有効な `pollingSchedule` を注入し時刻依存を除去する。実装(`apps/api/src/**`)は変更しない。
  2. 固定50ms待ちは「全会場の `recover` がゲートで待機している」ことを待つ形にする。`fetchCount > 0` の同期確認は、上流取得が呼ばれるまで上限付きで待つ形にする。「全会場復旧完了まで上流取得しない」検証力を落とさない。
  3. 後始末は `t.after` でサーバーclose・一時ディレクトリ削除。ポートは `port: 0`。
  4. 受け入れ条件は §5。
  - 禁止: 他の復旧テストの全面的な作り直し、テストのスキップ。
- 既存コード: 同ファイル AC13 テストが `loadPollingScheduleConfig()` を読み込み一部を上書きして `pollingSchedule` に渡す前例がある。`startServer` は `port: 0` で起動でき、戻り値の `server.port` で実ポートを得られる(同テスト内の子プロセス `--eval` で使用済み)。

## 3. 変更対象

`apps/api/tests/databaseRecoveryOrchestration.test.ts` の AC17/18 テスト1件のみ。実装・設定ファイル・他テストは変更しない。

## 4. 変更内容

### 4.1 テスト関数の形

`test('AC17/18: ...', async (t) => { ... })` とし、`node:test` の `TestContext` を受け取る。

### 4.2 終日有効スケジュールの注入

```ts
const schedule = loadPollingScheduleConfig();
const alwaysOnSchedule = {
  ...schedule,
  periods: schedule.periods.map((period) => ({ ...period, xmlSeconds: period.xmlSeconds ?? 60 })),
};
```

- 既存の時間帯境界をそのまま使い、`xmlSeconds` が `null` の帯だけ 60 秒に置換する(境界の連続性など読み込み時検証の前提を崩さないため。新規に `00:00-24:00` 単一帯を作る案は、境界表記の検証仕様を確認していないため採らない)。他の項目(`imageCatalogSeconds` 等)は触らない。`fetchFn` は全URLに空Atomを返すので、他種別の取得が起きても害はない。
- `startServer` に `pollingSchedule: alwaysOnSchedule` を渡す。
- 型がreadonly等で合わない場合の型付けは製造担当の裁量(実装コードは変更しない)。

### 4.3 待機の置換

- `recover` 内で待機開始時に `waitingVenues.add(venue.venueId)` してから `await gate` する。
- 固定50ms待ちを、`waitingVenues.size === VENUE_IDS.length`(現状 east・trc の2会場。`@wx-viewer-poc/shared` の `VENUE_IDS` を使う)になるまで10ms間隔・上限5秒でポーリングする待機に置換し、上限到達時は assert 失敗させる。
- 全会場待機を確認した直後に `assert.equal(fetchCount, 0)`。さらに検証力維持のため、その後に固定の短い猶予(例: 100ms)を置いてから再度 `assert.equal(fetchCount, 0)` を確認する(待機確認直後だけだと取得開始の遅延と区別できないため)。
- `release()` → `const server = await starting` の後、`fetchCount > 0` を10ms間隔・上限5秒で待ち、上限到達時は assert 失敗させる。
- ポーリング待機ヘルパーはファイル内ローカル関数として定義してよい(例: `waitUntil(predicate, timeoutMs, label)`)。名称は製造担当の裁量。

### 4.4 後始末とポート

- `port: 0` にする(乱数ポート廃止)。本テストはHTTPアクセスしないため実ポートは不要。
- `setup()` 直後に `t.after` で一時ディレクトリ削除を登録する。
- `startServer` 呼び出し直後に `t.after(async () => { release(); await starting.then((s) => s.close()).catch(() => undefined); })` を登録する。assert失敗時もゲート解放→起動完了→close が走り、プロセスが残らない。
- 正常経路の明示的 `await server.close()` は残してよい。二重closeで例外になる場合は `t.after` 側の `.catch` で吸収される。二重close時の実挙動は未確認のため、例外が表に出る場合は正常経路の close を削除し `t.after` に一本化する。
- 後半(DISABLE_POLLING子プロセス部)の `finally` 内 `rmSync` は `t.after` と重複するので、`rmSync` は `t.after` に一本化してよい(`reopened.close()` は残す)。後半のロジックは変更しない。

## 5. 受け入れ条件

- [ ] AC-1 原因の記録: 本設計書§1が原因・再現時刻・実装が不具合でないことを記載していること。加えて検収時に PR#221 の失敗CI runの実行時刻(UTC)を確認し、UTC 11:00〜19:00 に入るか否かをPR本文に記録すること。
- [ ] AC-2 失敗でも停止しない: 一時的に AC17/18 テストの `fetchCount > 0` 待機の条件を満たし得ないもの(例: `fetchCount > 1000000`)に改変し、`npm run test -w apps/api` を実行。当該テストが失敗として報告され、上限(5秒程度)経過後にプロセスが非0で終了すること(`timeout 300` で包み、124でないこと)。確認後に改変を戻し `git diff` で差分が無いことを確認する。
- [ ] AC-3 50回連続合格: 当該ファイルのみを50回ループ実行し全回合格(1回でも失敗・停止すれば不合格)。例: `for i in $(seq 50); do (cd apps/api && timeout 120 node --import tsx --test tests/databaseRecoveryOrchestration.test.ts) || exit 1; done`(実行方法は apps/api の test スクリプトに合わせて調整可)。
- [ ] AC-4 夜間相当: `date -u` が UTC 11:00〜19:00 の状態で当該テストファイルを実行し合格すること。該当時刻外なら `faketime` 等で夜間時刻にして実行する(時刻操作は実挙動未確認。手段が無い場合は夜間帯に実行した `date -u` 出力と結果を記録する)。
- [ ] AC-5 CI: PRのCIで apps/api テストが合格すること。
- [ ] AC-6 `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/api` 全体が合格。
- [ ] AC-7 範囲: `git diff main --stat` で変更が当該テストファイル(と本設計書)のみであること。`test.skip`/`{ skip }`/`todo` の追加が無いこと(`git diff main | grep -nE "skip|todo"` で該当なし)。

## 6. 後続への引き継ぎ

- 同ファイル AC13 等にも乱数ポート・`try/finally` 依存の後始末が残る。今回は範囲外(全面作り直し禁止)。同種の停止が起きた場合は同じ `t.after` 方式で個別に対処する。
- `config/polling.yaml` の夜間帯を前提にするテストが他にあれば同じ時刻依存を持つ。本Issueでは調査していない。
