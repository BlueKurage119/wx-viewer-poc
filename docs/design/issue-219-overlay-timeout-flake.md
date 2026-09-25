# Issue #219 実時間依存の WeatherTileOverlay タイムアウト通知テストの間欠失敗を解消する

- 予定ブランチ: `fix/issue-219-overlay-timeout-flake`
- 変更対象: `apps/web/tests/playbackAndOverlay.test.ts` のみ(プロダクトコード無変更)

## 1. 参照資料と設計判断の根拠

### 1.1 ヒアリング済みの確定事項(統括担当より)

1. 直し方は案A: 固定100ms待機を「通知が届くまで短い間隔でポーリングし、上限は数秒程度」の待機に置き換える。act()/モックタイマー化(案B)、単なる待機延長(案C)は採らない。
2. 修正対象はタイムアウト通知テスト1件のみ。`apps/web/tests/` の他の固定待機は修正せず、調査記録(本書§5)を残す。
3. プロダクトコードは変更しない。

### 1.2 現状(実物確認)

- 対象テスト: `apps/web/tests/playbackAndOverlay.test.ts` の `WeatherTileOverlay: タイムアウト時に complete: false で swap 完了を通知すること (§9.3, §11.4)`(188行目から)。`swapTimeoutMs: 1` で `createRoot().render()` した後、257行目で `await new Promise((resolve) => setTimeout(resolve, 100));` と固定待機し、`finally` で `root.unmount()` した後に `notifications` が `[{ frameId: 'timeout-frame', complete: false }]` と一致することを検証している。
- 通知経路: `apps/web/src/map/tiles/WeatherTileOverlay.tsx` 331行目 `onSwapSettledRef.current?.({ frameId: targetFrameId, complete })`。settle 以外に通知経路はない(統括担当の調査で欠落・重複経路なしを確認済み)。
- 統括担当の実測: 4コア・ビジーループ12本の負荷下で通知までの時間を20回計測し17〜40msに集中、外れ値60.6ms/70.6ms。100msの余裕はさらに重い負荷で容易に食い潰されうるため、固定待機が間欠失敗の原因と判断する。

### 1.3 設計判断

- 待機は「条件成立で即抜ける」ポーリングにする。成立しない場合は上限到達で抜け、その後の既存 `assert.deepEqual` が失敗して原因(通知0件)を示す。上限で例外を投げる方式にしても良いが、既存アサーションの差分表示を活かすためアサーションに委ねる。
- 重複通知の検出力を落とさないため、1件目到着後に短い追加待機(50ms)を置いてから unmount する。従来の固定100ms待機は「100ms以内の重複」を検出できたので、これと同等以上の窓を確保する意図。追加待機の不足は偽陰性(重複の見逃し)方向にしか働かず、偽陽性の失敗は生まない。
- 上限は 3000ms、間隔は 5ms とする。実測最大70.6msに対し約40倍の余裕。node:test の既定タイムアウト(無制限)とも干渉しない。

## 2. 変更内容(シグネチャ)

`playbackAndOverlay.test.ts` 内(ファイルローカル、export しない)に以下の補助関数を追加する。

```ts
/** predicate が真になるまで intervalMs 間隔で待つ。timeoutMs 到達時は false を返す(例外は投げない)。 */
async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 3000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean>;
```

- 経過時間は `Date.now()` で計る。待機には `setTimeout`(グローバル。`setupEnv.ts` の window.setTimeout 差し替えとは無関係)を使う。
- 257行目の固定待機を次の順に置き換える。
  1. `await waitUntil(() => notifications.length >= 1);`
  2. `await new Promise((resolve) => setTimeout(resolve, 50));`(重複検出窓。数値の意図を日本語コメントで残す)
- 既存の `finally`(unmount と `L.tileLayer` 復元)と最終 `assert.deepEqual` は変更しない。
- 他テスト・他ファイルは変更しない。共通ヘルパー化(tests 配下への新規ファイル追加)もしない。

## 3. 受け入れ条件

検証環境の注意: この環境は `npm ci` が失敗し `--ignore-scripts` 導入のため、`npm run test -w apps/web` 全体では本件と無関係な15件が常に失敗する。以下では対象ファイル単体の実行で合否を判定し、全体実行は「失敗件数・失敗テスト名が main と同一」で判定する。

- [ ] AC1 プロダクトコード無変更: `git diff --name-only origin/main...HEAD` の出力が `apps/web/tests/playbackAndOverlay.test.ts` と `docs/design/issue-219-overlay-timeout-flake.md` のみ(後者は統括がコミットする場合)。`apps/web/src/`・`apps/api/`・`packages/` を含まないこと。
- [ ] AC2 固定待機の除去: `grep -n "setTimeout(resolve, 100)" apps/web/tests/playbackAndOverlay.test.ts` が0件。`grep -n "waitUntil" apps/web/tests/playbackAndOverlay.test.ts` で関数定義と対象テスト内の呼出しが見えること。
- [ ] AC3 単体通過: `cd apps/web && node --import tsx --test tests/playbackAndOverlay.test.ts` が失敗0件。
- [ ] AC4 負荷下の安定性: 4コア環境で `for i in $(seq 12); do (while :; do :; done) & done` によりビジーループ12本を起動した状態で、AC3 のコマンドを50回連続実行し、失敗0回であること。終了後 `kill $(jobs -p)` 等でビジーループを必ず停止し、`pgrep -f "while :"` 等で残存がないことを確認する。
- [ ] AC5 検出力の維持(通知欠落): 作業ツリー上で一時的に `WeatherTileOverlay.tsx` 331行目の `onSwapSettledRef.current?.(...)` 呼出しをコメントアウトし、AC3 を実行して対象テストが `deepEqual` 失敗(actual `[]`)で落ち、所要時間が上限3秒+α程度で打ち切られることを確認する。確認後 `git checkout -- apps/web/src/map/tiles/WeatherTileOverlay.tsx` で復旧し、`git status` に差分がないこと。
- [ ] AC6 検出力の維持(complete 値の破壊): 同様に一時的に331行目の `complete` を `complete: true` に変えて AC3 を実行し、対象テストが失敗することを確認後、復旧する。
- [ ] AC7 検出力の維持(重複通知): 同様に一時的に331行目の呼出しを2回連続にして AC3 を実行し、対象テストが失敗(2件)することを確認後、復旧する。
- [ ] AC8 全体への影響なし: `npm run test -w apps/web` の失敗テスト名一覧が main での同コマンドと一致すること(本件対象テストが失敗一覧に含まれないこと)。
- [ ] AC9 静的検査: `npm run lint` / `npm run typecheck` / `npm run format:check` がエラーなし(依存導入の都合で実行不能な項目があれば、その旨と理由を検収報告に明記)。

## 4. 後続Issueへの引き継ぎ事項

- `waitUntil` はファイルローカルに留めた。他テストで同種の置き換えを行う際は、`apps/web/tests/` 共通ヘルパーへの切り出しを別Issueで検討する。
- §5 の「要注意」項目は、間欠失敗の報告があれば個別Issue化する。

## 5. 調査記録: `apps/web/tests/` の他の固定待機

`grep -rnE "setTimeout\((r|resolve), " apps/web/tests/` で網羅(本書作成時点)。いずれも修正しない。

| 箇所 | 用途 | 見解 |
| --- | --- | --- |
| `nowcastManualPlayback.test.ts` 265, 287, 310, 328, 371, 393, 413, 484(`MANUAL_INTENT_DEBOUNCE_MS + 20〜60`) | デバウンス確定後の状態を正方向に検証 | 同種問題あり(要注意)。余裕20〜60msは本件の実測外れ値(60〜70ms)と同程度で、負荷下で間欠失敗しうる。特に `+20` の413・484行目がもっとも薄い。ポーリング化で解消可能 |
| 同 278, 318, 349, 386(50ms・操作間隔・40ms) | デバウンス期間内の連続操作の模擬、「まだ確定しない」の検証 | 負荷で遅延すると操作間隔がデバウンスを超え、意図と異なる確定が起きうる(偽陽性の失敗)。実時間依存が本質で、ポーリングでは直らない。モックタイマー化が必要な種類 |
| 同 617(1050ms), 658〜682(100/200/300/100/400ms、250ms 閾値の前後を検証) | 時間閾値の前後判定 | 同上。閾値前側(658行目の100ms<250ms)は負荷遅延で閾値を越えうる |
| `terminalSession.test.ts` 130(50ms) | 「時間が経ってもIDに時刻依存がない」ことの演出 | 問題なし。待機時間の長短で結果が変わらない |
| `useMonitoringStatus.test.ts`・`useTileCatalogPolling.test.ts` の `setTimeout(r, 0)` | マイクロタスク/タスクの吐き出し | フェイクタイマーと組み合わせており実時間の余裕に依存しない。問題なし(実挙動未確認: 負荷下での繰り返し実行はしていない) |

上記の失敗可能性はコード読解による推定であり、負荷下での再現は実挙動未確認。
