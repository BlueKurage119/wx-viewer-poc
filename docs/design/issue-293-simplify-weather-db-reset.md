# Issue #293 設計書: 気象DBリセット手順の簡素化

## 1. 目的と範囲

`npm run db:reset:weather` を、開発中に頻繁に使える **1コマンド+対話確認** にする。現行の「plan→digestをコピー→apply」「途中失敗時は `--resume --confirm <元digest>`」「`--confirm-stopped` flag」「残留writer-lockは手作業で判断」を、次の流れに置き換える。

1. `npm run db:reset:weather` を実行する
2. 稼働中を自動検出したら拒否する。持ち主が存在しない残留writer-lockがあれば、内容を示して解除してよいか確認する
3. 停止の自己申告を求める
4. plan結果を表示し、y/Nで確認したらそのままapplyする
5. 途中失敗後は同じコマンドを再実行すれば、journalを検証して再開する

**保持DB・タイルcacheの保全と、利用中DBへの操作拒否は、#248(Issue #247)の水準から後退させない。** 削除処理の中核(`resetWeatherDatabase()` のjournal・identity・digest照合)は変更せず、対話層と残留lock処理を追加する。

非対象: 自動バックアップ(ヒアリング確定4で行わない)、OSレベルの排他ロックへの置き換え、アプリ起動時のlock引き継ぎ(#266)の判定条件変更、schema再作成をコマンド内で行うこと。

## 2. 参照資料と設計判断の根拠

| 参照 | 内容・導いた判断 |
| --- | --- |
| Issue #293 本文・ヒアリング結果コメント | 確定1〜6と追加回答Q1〜Q4(下表) |
| `apps/api/src/database/resetWeatherDatabase.ts` | `resetWeatherDatabase(config, {mode, confirmStopped, confirm}, hooks)` は呼出しごとに両DBのwriter leaseを取得→`assertStopped`(lsof)→plan作成/journal検証→削除→保持DB不変を確認→lease解放。applyは**呼出し時点で再計算したplanのdigestと`confirm`が一致する場合だけ**削除する。→ 対話層は「planで得たdigestをそのままapplyに渡す」だけでよく、plan表示から確認までの間に対象が変われば既存の照合で拒否される(TOCTOU防御が残る) |
| 同 `validateJournal` | resumeでは `confirm` とjournal内の `planDigest` の一致に加え、digestの自己整合・role/family/instance・残存ファイルのidentityを検証する。→ 自動再開では journal 自身の `planDigest` を `confirm` に渡しても、改変journal・別inode・再生成DBの拒否は残る(digest照合が担っていたのは「人がどのplanを承認したか」の確認であり、対話の確認で代替する) |
| `apps/api/src/database/pairSafety.ts` `acquireWriterLeases` | `<DB>.writer-lock` を `mkdirSync` し `owner.json` に `{pid, startedAt, token, role}` を書く。**`processStartedAt`・`hostname` を記録しない**。`pair.ts` の `initializeDatabases` も同じ関数を使う |
| 同 `assertStopped` | 両DBの主・付随ファイルに対し `lsof -F p` を実行し、開いているプロセスがあれば拒否。lsofが無い・異常終了・stderr出力でも拒否 |
| `apps/api/src/database/writerLock.ts`(#266) | アプリ経路(`initializeRoleDatabase`)の `owner.json` には `pid`・`token`・`processStartedAt`・`hostname` が記録される。`probeProcess(pid)` は `kill(pid,0)` で `absent`/`present(起動時刻)`/`unknown` を返す。残留lockは `<lock>.stale-<token>` へrenameし、token再照合後に取得する。退避先は1時間後にアプリ起動時に清掃される |
| `apps/api/src/database/roleDatabase.ts` L60・`pair.ts` L65 | `.reset.json` が残る間はアプリ起動を拒否する(変更しない) |
| `docs/weather-db-maintenance.md`・README L47・`docs/operations/weather-workers.md` L24-25 | 現行手順の記載箇所。いずれも更新が必要 |
| `docs/design/issue-247-split-weather-retained-db.md` §9 AC3・AC10 | 後退させない安全性の受け入れ条件 |
| `apps/api/tests/resetWeatherDatabase.test.ts` 等5ファイル | `resetWeatherDatabase()` をflag相当の options で直接呼ぶ。`npmReset()` は実npm scriptへ `--plan`/`--apply` 等を渡す |

### 2.1 ヒアリング確定事項の反映

| # | 確定事項 | 反映先 |
| --- | --- | --- |
| 1 | 開発中に頻繁に使う。手軽さ優先、保全・誤操作拒否は後退させない | §1、§3全体、AC-S |
| 2 | 1コマンド+対話確認。plan表示→y/N→apply。digestコピー不要 | §3.2 |
| 3 | writer lease等で稼働中を自動検出して拒否+対話で停止を自己申告。`--confirm-stopped` の代替 | §3.2 手順4、§3.4 |
| 4 | 自動退避は行わない | §1 非対象、§3.2 表示文言 |
| 5 | 同じコマンドの再実行でjournalを検証して自動再開。`--resume`・元digest不要 | §3.2 手順3 |
| 6 | 残留writer-lockは記録PIDが存在しなければstale判定→対話確認で解除。PIDが生きていれば拒否(追加回答Q3により「同じプロセスが生きていれば拒否」と読み替え) | §3.3 |
| Q1 | 【確定】非対話環境向けに既存flag方式を残す(案A) | §3.5、AC-N |
| Q2 | 【確定】hostnameのない旧形式lockは同一ホストとみなし、PIDだけでstale判定する(対話確認は残す) | §3.3 |
| Q3 | 【確定】PIDは生きているが起動時刻が違う(PID再利用)場合はstaleとし、対話確認のうえ解除する(#266と同じ扱い) | §3.3、AC-7・AC-8 |
| Q4 | 【確定】`docs/operations/weather-workers.md` も更新範囲に含める | §3.6、AC-D |

## 3. 設計

### 3.1 モジュール構成

| ファイル | 変更 |
| --- | --- |
| `apps/api/src/database/resetWeatherDatabase.ts` | **中核関数 `resetWeatherDatabase()` のシグネチャ・挙動は変更しない**(既存テストの呼出しを維持)。CLIエントリ部分を、引数の有無で対話経路/flag経路に振り分ける形に変える。`ResetPlan` から表示用の要約を作る `describeResetPlan()`、journalから再開対象を読む `readResetJournalStatus()` を追加(後者は既存の失敗時表示処理を関数化したもの) |
| `apps/api/src/database/resetInteractive.ts`(新規) | 対話経路本体 `runInteractiveReset(config, io, deps)` |
| `apps/api/src/database/writerLockInspection.ts`(新規) | 残留lockの判定 `inspectWriterLock()` と退避 `quarantineStaleWriterLock()` |
| `apps/api/src/database/pairSafety.ts` | `acquireWriterLeases` の `owner.json` に `processStartedAt`・`hostname`(`writerLock.ts` の `currentIdentity()`)を追記する。既存キーは変えない |
| README・`docs/weather-db-maintenance.md`・`docs/operations/weather-workers.md` | §3.6 |
| `apps/api/tests/resetInteractive.test.ts`・`writerLockInspection.test.ts`(新規) | §4 |

`writerLock.ts` の `takeOverStale` 等、アプリ起動時の引き継ぎ判定は変更しない。

### 3.2 対話経路の流れ

起動条件: 引数なしで実行され、かつ `process.stdin.isTTY && process.stdout.isTTY` が真。引数なしでTTYでない場合は、何も変更せずに終了コード1で拒否し、§3.5 の非対話手段を案内する。

```ts
export interface ResetIo {
  print(text: string): void;            // stdout
  ask(question: string): Promise<string>; // readline/promises。EOF・Ctrl+C は '' を返す
}
export interface InteractiveResetDeps {
  inspectLock(lockPath: string): WriterLockInspection; // 既定は inspectWriterLock
  quarantine(lockPath: string, expectedToken: string): void;
  reset: typeof resetWeatherDatabase;
}
export async function runInteractiveReset(
  config: DatabasePairConfig, io: ResetIo, deps?: Partial<InteractiveResetDeps>,
): Promise<'completed' | 'resumed' | 'nothing_to_do' | 'cancelled'>;
```

y/N の判定: 入力を trim して `y` または `yes`(大小無視)だけを承諾とする。空入力・その他・EOF・Ctrl+C は中止。中止時は「中止しました。変更はありません。」を表示し終了コード1。

1. **設定検証**: `resolveDatabasePairConfig()`→`validateDatabasePairConfig()`(既存)。失敗は無変更で拒否。
2. **残留lockの確認**(§3.3): 気象・保持の両 `<DB>.writer-lock` を `inspectLock` で判定する。
   - `absent` のみ → 次へ
   - いずれかが `alive`/`undeterminable` → 理由を表示して拒否(終了コード1、無変更)
   - `stale` があれば、lock名(basename)・role・pid・記録された起動時刻・判定理由を表示し「この残留ロックを解除しますか? [y/N]」。承諾時だけ `quarantine` を実行。拒否時は中止。
3. **journalの確認**: `<weather DB>.reset.json` が存在すれば**再開モード**。`readResetJournalStatus()` で完了済み/残りパスを表示する。journalの読取・検証(`validateJournal(..., value.plan.planDigest, false)` 相当)に失敗した場合は、自動再開せず「journalを保持したまま保守確認してください」と表示して拒否する(現行と同じ)。
4. **停止の自己申告**: 「API・取得Worker・SQLiteツールを全て正規手順で停止しましたか? [y/N]」。承諾は `confirmStopped: true` として以降の呼出しに渡す。
5. **plan**(新規時): `reset(config, { mode: 'plan', confirmStopped: true })`。lease取得失敗・lsof検出・識別失敗はここで拒否される。`files` が全て `null`(気象DBが存在しない)なら「初期化対象がありません」と表示し `nothing_to_do`(終了コード0)。`identity` が `null` で付随ファイルだけ残る等は、既存のapply拒否条件をここで先に表示して拒否する。
6. **確認表示**: `describeResetPlan(plan)` で、気象DBの正規パス(リポジトリ相対ではなくユーザーが指定した設定値のまま)、role・instance_id、削除する主・付随ファイル一覧、「気象原文・取得履歴・派生値を削除します。バックアップは作成しません。保持DB(操作記録・通知履歴・session・起動claim・応答監査)とタイルcacheは対象外です。」を表示し、「削除を実行しますか? [y/N]」。再開モードでは残りパスを示し「再開しますか? [y/N]」。
7. **実行**: 新規は `reset(config, { mode: 'apply', confirmStopped: true, confirm: plan.planDigest })`。再開は `reset(config, { mode: 'resume', confirmStopped: true, confirm: journal.plan.planDigest })`。各呼出しで lease・lsof・保持DB不変確認が再実行される。plan表示後に対象が変わった場合は既存の digest 不一致で拒否され、「対象が変わりました。もう一度実行してください。」を表示する。
8. **完了表示**: 「完了しました。次回の正規起動で気象schemaを再作成し、再取得します。」。失敗時は既存CLIと同じくエラーと journal 状態を表示し、案内文を「同じコマンド `npm run db:reset:weather` を再実行すると再開します」に変える。

stdout/stderr にホームディレクトリ名が出るのは利用者の端末内表示であり許容する(設計書・テスト期待値に絶対パスを書かない)。

### 3.3 残留writer-lockの判定と解除

```ts
export type WriterLockInspection =
  | { state: 'absent' }
  | { state: 'alive'; pid: number; role?: string; reason: 'owner_alive' | 'pid_present_unverifiable' }
  | { state: 'stale'; pid: number; token: string; role?: string; startedAt?: string;
      processStartedAt?: string; currentProcessStartedAt?: string; reason: 'pid_not_found' | 'pid_reused' }
  | { state: 'undeterminable'; reason: 'owner_unreadable' | 'other_host' | 'probe_failed' | 'not_directory' };
export function inspectWriterLock(lockPath: string, deps?: { probeProcess; currentIdentity }): WriterLockInspection;
export function quarantineStaleWriterLock(lockPath: string, expectedToken: string): void;
```

判定(上から順に適用):

| 条件 | 結果 |
| --- | --- |
| lockパスが存在しない | `absent` |
| ディレクトリでない・symlink | `undeterminable(not_directory)` |
| `owner.json` が読めない/`pid`(数値)・`token`(文字列)が無い | `undeterminable(owner_unreadable)` |
| `hostname` が記録され、現在のhostnameと異なる | `undeterminable(other_host)` |
| `probeProcess(pid)` が `unknown` | `undeterminable(probe_failed)` |
| `probeProcess(pid)` が `present` で、記録 `processStartedAt` との差が `START_TIME_TOLERANCE_MS`(2秒)以内 | `alive(owner_alive)` |
| `probeProcess(pid)` が `present` で、`processStartedAt` が記録されていない(旧形式) | `alive(pid_present_unverifiable)` |
| `probeProcess(pid)` が `present` で、起動時刻が2秒を超えて異なる | `stale(pid_reused)` |
| `probeProcess(pid)` が `absent` | `stale(pid_not_found)` |

- 【確定】(Q3)確定6の「PIDが生きていれば拒否」は「同じプロセスが生きていれば拒否」と読む。PID再利用(起動時刻が異なる)は #266 と同じく stale とし、解除の確認表示に記録時刻と現在の起動時刻を併記する。
- 【確定】(Q2)`hostname` が無い旧形式(#248以降の `acquireWriterLeases` 由来)は同一ホストとみなし、PIDだけで判定する。PIDが存在しなければ stale(対話確認あり)。旧形式は起動時刻を持たないため、PIDが存在する場合は再利用か同一プロセスかを区別できず、`alive(pid_present_unverifiable)` として拒否する。
- `quarantineStaleWriterLock` は #266 と同じ手順: `<lock>.stale-<token>` へ `renameSync`→退避先 `owner.json` の token が `expectedToken` と一致するか再照合→不一致なら元へ戻して拒否。退避先には `taken-over.json`(`takenOverAt`)を書き、既存のアプリ起動時清掃(1時間経過後)に任せる。**削除はしない。** `[writer-lock] reset_quarantine lock=... role=... oldPid=... oldToken=<先頭8文字>` を `console.warn` に出す。
- 判定から解除までの間に別プロセスがlockを取り直した場合は、token再照合で拒否される。解除後の lease 取得は既存の `mkdirSync`(排他)で行うため、同時に起動した別writerとは片方だけが成功する。

`acquireWriterLeases` が `processStartedAt`・`hostname` を書くようにすることで、reset自身が強制終了して残したlockも、次回のreset対話・アプリ起動時引き継ぎ(#266の `legacy_owner` 拒否に当たらない)の両方で判定できるようになる。

### 3.4 自動検出で検出できる範囲(既存コードからの確認結果)

| 状況 | 検出 | 手段 |
| --- | --- | --- |
| API/取得Workerが起動中(lease保持) | できる | lease の `mkdir` 失敗(EEXIST)。手順2で `alive` として先に表示 |
| lease を持たないがDB/付随ファイルを開いているプロセス(sqlite3 CLI等) | できる(同一ユーザーのプロセス) | `assertStopped` の lsof |
| 持ち主が終了した残留lock | stale として解除確認 | §3.3 |
| 他ユーザーのプロセスがDBを開いている | **実挙動未確認**(非rootのlsofで見えない可能性) | lsof |
| 確認後に新しく起動される非協調writer | できない | OSロックではない(#247と同じ制約) |
| 別ホストからネットワーク共有越しに開いている | できない | - |

自己申告(手順4)は上記の検出できない範囲を利用者の確認で補う位置付けであり、自動検出を省略する理由にはしない。

### 3.5 非対話環境の扱い【確定: 案A】

| 案 | 内容 | メリット | デメリット |
| --- | --- | --- | --- |
| A(【確定】採用) | 既存flag(`--plan`/`--apply --confirm <digest>`/`--resume --confirm <digest>`、各 `--confirm-stopped`)を現行のまま残す。残留lock解除は対話経路のみ | 既存テスト(`npmReset`)・#247 AC3/AC10 をそのまま維持できる。自動化でもplan承認の証跡(digest)が残る | 手順が2系統になり、手順書に両方を書く必要がある |
| B | flagを廃止し、TTYでなければ拒否 | 入口が1つで単純 | CIや非TTYのエージェント実行から使えない。既存の実npm subprocessテストを対話用(疑似TTY)に作り直す必要 |
| C | flagを `--yes --confirm-stopped` の1組(digest不要、plan→applyを内部で連続実行、journalがあれば自動再開)に置き換える | 非対話でも1コマンド | plan結果を誰も見ずに削除できる。誤った設定値での誤削除リスクが対話経路より高い |

オーナー回答Q1により案Aを採用する。flag経路の挙動(残留lockの解除を行わないことを含む)は現行から変えない。手順書には対話手順を主とし、非対話・自動化向けに既存flag手順を別節で残す。

### 3.6 文書更新

- README L47: 「停止中に `npm run db:reset:weather` を実行し、表示内容を確認して y で実行する。途中で失敗したら同じコマンドを再実行する」の要旨へ置換。保持対象の列挙と保守手順へのリンクは残す。
- `docs/weather-db-maintenance.md`「導入後の気象DB初期化」「途中失敗と再実行」: 対話手順(§3.2 の1〜8)、自動検出の範囲と限界(§3.4)、残留lockの解除条件(§3.3)、自動バックアップを行わないこと、必要なら事前に停止状態で主DBと付随ファイル一組を保全すること、journalを手で消さないことを記載。「writer-lockをstaleと推測して自動削除しない/force・unlockオプションはない」の記述は「持ち主PIDが存在しない場合だけ対話確認で退避する」に改める。非対話手段は §3.5 の決定に従う。
- `docs/operations/weather-workers.md` L24-25【確定(Q4)】: 同様に対話手順へ置換し、詳細は保守手順へリンクする。

## 4. 受け入れ条件

共通: `mkdtemp` 配下の異なる2 SQLite ファイルと合成fixtureを使う。実DB・実cache・ゴミ箱を使わない。対話は `ResetIo` のフェイク(回答列を与え、表示を記録)で検証し、TTY判定は実subprocessで検証する。各テストは自分が作った一時ディレクトリだけを後始末する。

### 4.1 対話経路

- [x] **AC-1(1コマンド完了)**: 停止済み一時DBに対し `runInteractiveReset` を回答 `y`(停止申告)→`y`(実行)で実行する。気象主DBと存在した付随ファイルだけが消え、`.reset.json` が残らない。保持DB主・付随ファイルの dev/ino/size/mtime/hash と保持5表全行が実行前と完全一致し、タイルcache・無関係ファイルが不変。表示に削除対象一覧・weather instance_id・「バックアップは作成しません」・保持DBとタイルcacheが対象外である旨が含まれ、digestの入力を求める問いが無い。【実測: `tests/resetInteractive.test.ts`「AC-1: 1コマンド完了」通過 (pass)】
- [x] **AC-2(中止)**: 停止申告・実行確認それぞれで `n`、空入力、`''`(EOF相当)を与える計6通りで、戻り値 `cancelled`、全対象ファイルの identity/hash 不変、journal・lock が残らない。【実測: `tests/resetInteractive.test.ts`「AC-2: 中止」計6通り通過 (pass)】
- [x] **AC-3(確認後の対象変化)**: plan表示後・実行確認の回答前に、フェイク `ask` の中で気象DBへ1行書き込む(または付随ファイルを作る)。apply が digest 不一致で拒否され、全ファイル不変、表示に再実行の案内が出る。【実測: `tests/resetInteractive.test.ts`「AC-3: 確認後の対象変化」通過 (pass)】
- [x] **AC-4(稼働中の自動拒否)**: (a) 生存中の子プロセスが #266 形式の `owner.json` で気象lockを保持、(b) 同じく保持lock、(c) lease を持たず気象DBを開いたままの子プロセス、の各状態で実行する。いずれも停止申告で `y` と答えても削除されず全ファイル不変。(a)(b) は停止申告の問いより前に拒否される。【実測: `tests/resetInteractive.test.ts`「AC-4: 稼働中の自動拒否」通過 (pass)】
- [x] **AC-5(停止検査不能)**: PATH から lsof を除いた環境で `y`/`y` を与えても拒否され全ファイル不変(#247 AC10 の停止検査不能拒否の維持)。【実測: `tests/resetInteractive.test.ts`「AC-5: 停止検査不能」通過 (pass)】
- [x] **AC-6(対象なし)**: 気象主・付随ファイル・journalが全て無い状態で実行すると `nothing_to_do`、終了コード0、保持側不変。主なし付随ファイルだけが残り journal が無い場合は無変更で拒否される。【実測: `tests/resetInteractive.test.ts`「AC-6: 対象なし」通過 (pass)】

### 4.2 残留lock

- [x] **AC-7(stale解除)**: (a) 終了済み子プロセスのPIDを記録した #266形式lock、(b) 同じく `hostname`・`processStartedAt` の無い旧形式lock、(c) 生存中の子プロセスのPIDに、実際と2秒を超えて異なる `processStartedAt` と現在のhostnameを記録した #266形式lock(PID再利用相当)、の3種を気象lockとして置く。いずれも解除の問いが出て、(c) では記録時刻と現在の起動時刻が表示される。解除確認で `y` → 以降 `y`/`y` で完了し、lockは `<lock>.stale-<token>` に退避され(削除されない)`taken-over.json` がある。解除確認で `n` なら lock・DBとも不変。【実測: `tests/writerLockInspection.test.ts`「AC-7: stale解除」4ケース通過 (pass)】
- [x] **AC-8(生存PIDは拒否)**: (a) 生存中の子プロセスのPID・正しい起動時刻、(b) 生存中の子プロセスのPIDを記録した旧形式(起動時刻なし)、(c) `hostname` が異なる、(d) `owner.json` 破損、(e) `probeProcess` が `unknown`(依存注入) の各lockで、解除の問いを出さずに拒否し、lockとDBが不変。【実測: `tests/writerLockInspection.test.ts`「AC-8: 生存PIDおよび判定不能lockは拒否」5ケース通過 (pass)】
- [x] **AC-9(解除の競合)**: `inspectLock` と `quarantine` の間に lock を別tokenの新しいlockへ差し替える(依存注入)。退避が token 不一致で拒否され、新しいlockが元の位置に残る。【実測: `tests/writerLockInspection.test.ts`「AC-9: 解除の競合」通過 (pass)】
- [x] **AC-10(reset由来lockの判定)**: `acquireWriterLeases` が書く `owner.json` に `pid`・`startedAt`・`token`・`role` に加え `processStartedAt`・`hostname` が含まれる。そのlockを残したまま持ち主を終了させると、`initializeRoleDatabase`(#266経路)が `legacy_owner` で拒否せず引き継ぎ、reset対話でも stale と判定される。【実測: `tests/writerLockInspection.test.ts`「AC-10: reset由来lockの判定」通過 (pass)】

### 4.3 途中失敗と自動再開

- [x] **AC-11**: 既存の障害注入(`afterUnlink`・`beforeProgressWrite`)で apply を途中失敗させる。表示に再実行の案内があり `--resume` の記載が無い。journal が残り、アプリ起動は拒否される。続けて同じ `runInteractiveReset` を `y`/`y` で実行すると再開し、残りの付随ファイルだけを削除して journal が消える。主ファイル削除直後の中断でも、欠落主ファイルを SQLite で開かずに再開できる。【実測: `tests/resetInteractive.test.ts`「AC-11: 途中失敗と自動再開」通過 (pass)】
- [x] **AC-12**: journal を改変(対象パス・digest・instance を変更)した場合、または削除予定パスに別inodeのファイルを置いた場合、再開は拒否され全ファイル・journal 不変。【実測: `tests/resetInteractive.test.ts`「AC-12: journal改変・別inodeの拒否」通過 (pass)】

### 4.4 非対話経路(案A【確定】)

- [x] **AC-N1**: 実 `npm run db:reset:weather` を stdin をパイプにした subprocess で引数なし実行すると、終了コード1・無変更で、非対話手段の案内を出す。【実測: `tests/resetInteractive.test.ts`「AC-N1: 非対話環境の拒否」通過 (pass)】
- [x] **AC-N2**: 既存の `apps/api/tests/resetWeatherDatabase.test.ts` の実npm `--plan`/`--apply`/`--resume` テストが変更なしで通過する。【実測: 既存テストファイル全件無変更で通過 (pass)】

### 4.5 安全性の非後退と共通

- [x] **AC-S1**: #247 設計書 §9 の AC3・AC10 に対応する既存テスト(`resetWeatherDatabase.test.ts`・`splitDatabaseLifecycle.test.ts`・`weatherReaderResetSafety.test.ts`・`deliveryWorkerHost.test.ts`)を**期待値を変えずに**全件通過させる。`git diff` で `resetWeatherDatabase()` 本体(関数宣言から `executeDelete` 末尾まで)と `validateJournal`・`executeDelete` の保持側保護に変更が無いことを確認する。【実測: 既存4テストファイル全件通過、git diff で中核関数・保持側保護の完全不変を確認】
- [x] **AC-S2**: 対話経路でも、同一パス/symlink/hardlink/case差/role違いの設定で実行すると、問いを出す前または実行前に拒否され全対象不変(AC10 の代表ケースを対話経路から3種以上実施)。【実測: `tests/resetInteractive.test.ts`「AC-S2: 安全性の非後退」4種通過 (pass)】
- [x] **AC-S3**: 業務標準05に従い、意味を変えない対照改変の後、「対話経路でapplyに渡すdigestを固定文字列にする」「stale判定で起動時刻が一致するpresentをstale扱いにする」「quarantineのtoken再照合を除く」「停止申告の否定を無視する」の各改変で該当テストが red になることを確認し、改変を戻す。【実測: 対照実験 SURVIVED (pass)、4ミューテーション全件 KILLED (RED確認後、git diffで完全復元確認)】
- [x] **AC-D**: README・`docs/weather-db-maintenance.md`・`docs/operations/weather-workers.md` に `--confirm <planDigest>` を手入力させる手順・`--resume --confirm <元planDigest>` の手順が(案Aで残す非対話節を除き)残っていない。対話手順、自動検出の限界、残留lock解除の条件、自動バックアップなし、journalを手で消さない旨が記載されている。ホームディレクトリ名・絶対パスが無い。【実測: 対象3ファイル更新完了、git diff/grep で絶対パス・ホームディレクトリ名なしを確認】
- [x] **AC-Q**: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/api` が終了コード0。【実測: 全コマンド exit code 0、APIテスト 1258 件全件通過】

## 5. 実挙動未確認の箇所

- 非rootの lsof が他ユーザーのプロセスによるDBオープンを検出できるか(§3.4)。
- `readline/promises` で Ctrl+C を受けた際に `''` を返して後始末できるか(製造時に `SIGINT` を `ask` 内で扱う)。【製造時確認: `process.once('SIGINT', onSigint)` を `createDefaultResetIo` の `ask` 内に組み込み、空文字を返して中断処理へ遷移するよう実装】
- Linux での `ps -o lstart` 形式(#266から継続)。

## 6. 判断・残留リスク・後続への引継ぎ

- 未確定事項: なし(Q1〜Q4はオーナー回答で確定し、本文へ反映済み)。
- 残留リスク: plan表示から確認までの間は lease を解放している。その間の変化は digest 照合で拒否するが、確認待ちの間に別writerが起動してapply時点で停止していれば検出されない(現行のplan/apply 2コマンド方式と同等)。自己申告は利用者の確認であり保証ではない。
- 後続: なし(PID再利用の扱いは #266 と揃えた)。
