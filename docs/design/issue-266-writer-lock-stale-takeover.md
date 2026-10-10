# Issue #266 設計書: DB書き込みロックの残留検出・引き継ぎと解放失敗ログ

## 1. 目的と範囲

`<DB>.writer-lock`(ディレクトリ+`owner.json`)が持ち主プロセスの終了後に残り、次のAPI起動が`EEXIST`で失敗する事象を解消する。起動時に既存ロックの持ち主の生存を判定し、**確実に死んでいる場合だけ**記録を残して原子的に引き継ぐ。あわせて、ロック解放失敗・API終了処理の開始/完了/失敗をログに出す。

非対象(Issueどおり): OSファイルロックへの置き換え、writer lease契約(#257/#258)の変更、devスクリプトへの強制終了導入、取得Worker準備処理の非同期化。

## 2. 参照資料と設計判断の根拠

| 参照 | 内容・導いた判断 |
| --- | --- |
| Issue #266 本文 | やること1〜4、動作・失敗契約、受け入れ条件L1〜L8 |
| ヒアリング確定事項(統括担当) | (1)取得時に自プロセスの起動時刻を`owner.json`へ追記し、残留判定では現在の当該pidの起動時刻と±2秒で照合。起動時刻の記録がない旧形式は判定不能として奪わない。(2)残留ロックを一意名へ`rename`で退避し、成功した1プロセスだけが`mkdir`で取得。負けた側は従来の`EEXIST`扱いで失敗。(3)ログは`console.warn/error`に`[writer-lock] 事象 key=value`形式の1行、ホームディレクトリの絶対パスを含めない。(4)一時サーバーのデータフォルダ分離運用はG-02に追記(必須化しない) |
| `apps/api/src/database/roleDatabase.ts` | `initializeRoleDatabase`が`mkdirSync(lock)`→`owner.json`を`wx`で書く。`releaseOwnedRoleLease`は**渡されたownerのキーだけ**を`owner.json`と比較し、不一致・読取不能で`lease_owner_unverified`を投げる。→ `owner.json`に追加フィールドを書いても解放判定は変わらない(契約を変えずに拡張できる) |
| `apps/api/src/runtime/startWorkerServer.ts` L73 | retainedロックはAPI本体プロセスが`pid=process.pid`、`startedAt=serverStartedAt`(サーバー開始時のISO時刻。プロセス起動時刻ではない)で取得 |
| `apps/api/src/runtime/acquisitionWorker.ts` L195 / `acquisitionWorkerHost.ts` L375 | weatherロックは取得Worker(worker_threads)内で`initializeRoleDatabase`を呼んで取得。pidは本体と同じ、`threadId`で区別。Worker停止後に本体が`releaseOwnedRoleLease`で解放する |
| `apps/api/src/database/pairSafety.ts` `acquireWriterLeases` | `initializeDatabases`(pair.ts)と`resetWeatherDatabase.ts`が使う別経路のロック取得。本Issueの引き継ぎ対象外(§3.6) |
| `apps/api/src/serverClose.ts` / `server.ts` L978付近 | `createRetryableDatabaseClose(stop, closeDatabase)`がAPIの終了処理本体。ここに終了ログを集約できる |
| `scripts/dev.mjs` | 停止はSIGTERMのみ、30秒超で警告、停止失敗時は再起動しない |
| 実測(macOS, 本設計時) | `TZ=UTC LC_ALL=C ps -o lstart= -p <pid>`の出力は`Fri Oct  9 19:03:08 2026    `形式(**日が1桁のとき空白2つ、末尾に空白**、秒精度)。存在しないpidでは出力空・終了コード1。`process.kill(1, 0)`は`EPERM`(他ユーザーの生存プロセス)。`renameSync(dir, 既存の空でないdir)`は`ENOTEMPTY`、空ディレクトリが宛先なら成功 |

Linuxでの`ps -o lstart`(procps)の出力形式は**実挙動未確認**(同じ形式と想定。§7参照)。

## 3. 設計

### 3.1 モジュール構成

新規ファイル `apps/api/src/database/writerLock.ts` にロックの取得・残留判定・引き継ぎ・ログを集約する。`roleDatabase.ts`の`mkdirSync(lock)`+`owner.json`書き込みをこのモジュールの呼び出しに置き換える。

```ts
/** owner.json に追記する拡張フィールド(WriterLeaseOwner 型自体は変えない) */
export interface WriterLockProcessIdentity {
  readonly processStartedAt: string | null; // 自プロセスの起動時刻(ISO 8601, UTC, 秒精度)。取得失敗時 null
  readonly hostname: string;                 // os.hostname()
}

export type ProcessProbe =
  | { readonly state: 'absent' }                                // pid が存在しない
  | { readonly state: 'present'; readonly startedAtMs: number } // 存在し起動時刻を取得できた
  | { readonly state: 'unknown'; readonly detail: string };     // 判定不能

export interface WriterLockDeps {             // テストで差し替える
  probeProcess(pid: number): ProcessProbe;
  currentIdentity(): WriterLockProcessIdentity;
  log: Pick<Console, 'warn' | 'error'>;
}

/** lock を取得し owner.json を書く。失敗時は従来どおり例外(EEXIST 系)を投げる */
export function acquireWriterLock(lockPath: string, owner: WriterLeaseOwner, deps?: WriterLockDeps): void;
```

`initializeRoleDatabase`は`mkdirSync(dirname(lock), {recursive:true})`の後、`mkdirSync(lock)`と`owner.json`書き込みの代わりに`acquireWriterLock(lock, owner)`を呼ぶ。以降の処理(validate、`close()`、catch節での解放)は変えない。

### 3.2 起動時刻の取得

- `probeProcess(pid)`:
  1. `process.kill(pid, 0)`: 例外なし、または`EPERM` → 存在。`ESRCH` → `{state:'absent'}`。それ以外の例外 → `unknown`。
  2. 存在する場合、`execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 2000 })`。出力をtrimし、正規表現 `^\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$` で解析してUTCのepoch msにする(`Date.parse`の非標準形式に頼らない)。
  3. `ps`が非0終了・出力空(1と2の間に終了した場合を含む)・解析失敗 → `unknown`。
- `currentIdentity()`: 自プロセスに対して同じ`ps`を実行し、ISO文字列で`processStartedAt`を得る。**モジュール内でキャッシュ**する(worker_threadsでは別インスタンスになり再実行されるが、同期で数十ms程度の想定。**実挙動未確認**)。取得失敗時は`processStartedAt: null`とし、`[writer-lock] start_time_unavailable`をwarnで出す(そのロックは後で残留判定できず奪われない側に倒れる)。
- 照合許容差: `|記録値 − 現在値| <= 2000ms` で「同一プロセス(生存)」。

### 3.3 取得・残留判定・引き継ぎの手順

```
1. mkdirSync(lock) 成功 → owner.json を {...owner, processStartedAt, hostname} で wx 書き込み → 完了
2. EEXIST → 既存の owner.json を読む(以下、判定結果 → 処理)
   a. 読めない/JSON不正/必須フィールド(pid:number, token:string)欠落 → reason=owner_unreadable
   b. processStartedAt が無い・null(旧形式・取得失敗) → reason=legacy_owner
   c. hostname が自ホストと異なる → reason=other_host
   d. pid === process.pid → reason=same_process(自プロセス内の別スレッドの可能性。奪わない)
   e. probe=unknown → reason=probe_failed
   f. probe=present かつ差 <= 2000ms → reason=owner_alive
   → a〜f は [writer-lock] takeover_refused を error で出し、元の EEXIST 例外を再送出(従来どおり起動失敗)
   g. probe=absent → stale(reason=pid_not_found)
   h. probe=present かつ差 > 2000ms → stale(reason=pid_reused)
3. stale のとき:
   3-1. stalePath = `${lock}.stale-${旧owner.token}` へ renameSync(lock, stalePath)
        失敗(ENOENT/ENOTEMPTY/EEXIST 等) → takeover_lost を warn、EEXIST 相当の例外で失敗
   3-2. stalePath/owner.json を読み直し、token が判定時の旧tokenと一致することを確認
        不一致 → takeover_aborted を error、stalePath を lock へ rename して戻す試行(失敗も error に記録)、例外で失敗
   3-3. mkdirSync(lock)(EEXIST → takeover_lost を warn、例外で失敗)→ owner.json を wx 書き込み
   3-4. stalePath/taken-over.json に {"takenOverAt": ISO時刻} を書く(失敗は warn のみで継続)
   3-5. [writer-lock] takeover を warn で出す(旧owner全項目と退避先名)
4. 取得に成功した後(1・3のどちらでも)、古い退避先の掃除(§3.3.1)を行う
```

**退避先は直後には削除せず、一定時間経過後に自動削除する(オーナー回答)。** 退避名を「旧ownerのtoken」から一意に決め、退避先を残すことで、2プロセスが同じ残留ロックを同時に引き継ごうとした場合に次の性質が成り立つ。

- 両者が同じ旧token `T0` を判定した後、先に`rename`したAが`lock.stale-T0`を作り、新しい`lock`(token `T1`)を`mkdir`しても、後続Bの`rename(lock, lock.stale-T0)`は宛先が空でないため`ENOTEMPTY`で失敗する(実測済み)。BがAの生きたロックを退避してしまうABA問題を、追加のミューテックスなしで防げる。
- 退避先を削除すると、この防御が消え、Bが`T1`のロックを`stale-T0`名で奪える。この競合窓は「Bが旧ownerを読んでからrenameするまで」(ミリ秒〜秒)なので、退避から十分に時間が経った退避先だけを削除すれば防御は壊れない。
- 3-2の読み直しは、退避先が外部要因で消された場合などの防御。

#### 3.3.1 古い退避先の自動削除

- 実行タイミング: `acquireWriterLock`がロック取得に成功した直後(取得失敗時は行わない)。対象は同じディレクトリ内で名前が`<lockのbasename>.stale-`で始まるディレクトリだけ。
- 閾値: 退避から**1時間超**(定数 `STALE_RETENTION_MS = 60 * 60 * 1000`)。
- 退避時刻: 退避先の`taken-over.json`の`takenOverAt`。読めない場合は退避先ディレクトリの`mtimeMs`と`ctimeMs`の**大きい方**(新しい方。削除しない側に倒す)。
- 削除: `rmSync(path, { recursive: true })`。成功時 `[writer-lock] stale_removed lock= stale= ageMs=` を warn、失敗時 `[writer-lock] stale_remove_failed lock= stale= code=` を warn で出し、**起動は継続する**(例外を投げない)。一覧取得(`readdirSync`)の失敗も同様にログのみ。

`acquireWriterLeases`(pairSafety.ts)にも`owner.json`の拡張フィールドは追記しない(§3.6)。

### 3.4 ログ書式

すべて1行、`[writer-lock] <事象> key=value ...`。値に空白を含む場合は`JSON.stringify`した文字列を値にする。パスは**ロックディレクトリのbasename**(例 `lock=retained.sqlite3.writer-lock`)だけを出し、絶対パス・ホームディレクトリを含めない。tokenは先頭8文字だけ出す(`token=1a2b3c4d`)。

| 事象 | レベル | 主なキー |
| --- | --- | --- |
| `takeover` | warn | `lock` `role` `reason`(pid_not_found/pid_reused) `stale`(退避先basename) `oldPid` `oldRole` `oldToken` `oldStartedAt` `oldProcessStartedAt` `oldServerGenerationId` `oldWorkerGeneration` `oldThreadId` `currentProcessStartedAt`(pid_reusedのみ) |
| `takeover_refused` | error | `lock` `role` `reason`(§3.3 a〜f) `oldPid` `detail`(任意) |
| `takeover_lost` | warn | `lock` `role` `step`(rename/mkdir) `code` |
| `takeover_aborted` | error | `lock` `role` `expectedToken` `actualToken` `restored`(true/false) |
| `start_time_unavailable` | warn | `pid` `detail` |
| `stale_removed` | warn | `lock` `stale` `ageMs` |
| `stale_remove_failed` | warn | `lock` `stale` `code` |
| `release_failed` | error | `lock` `role` `reason`(lease_owner_unverified/例外のcode) `pid` `threadId` |

`release_failed`は`releaseOwnedRoleLease`内で例外を投げる直前(読取不能・owner不一致)、および`rmSync`失敗時に出し、その後**従来どおり例外を投げる**(戻り値・例外の契約は変えない)。これで`close()`経路、catch節、`acquisitionWorkerHost`の解放のいずれでも出る。

### 3.5 API終了処理のログ

`apps/api/src/serverClose.ts`の`createRetryableDatabaseClose`に最小限のログを入れる(書式は`[api-shutdown] 事象 key=value`)。

| 事象 | レベル | タイミング |
| --- | --- | --- |
| `start` | warn | `stop`呼び出し開始時(`reason`=signal/programmatic/なし) |
| `stage_failed` | error | `stop`が拒否されたとき `stage=stop`、`closeDatabase`が投げたとき `stage=close_database`。`error`=メッセージ(絶対パスを含みうるため、メッセージ中の`process.cwd()`とホームディレクトリをそれぞれ`.`・`~`に置換して出す) |
| `complete` | warn | 完了時 `elapsedMs` |

リトライ契約(`pending`/`complete`の扱い)は変えない。`stop`内の各サービス停止の個別ログは追加しない(既存の`console.error('graceful shutdown の記録に失敗しました'...)`はそのまま)。

### 3.6 対象外とした経路

`acquireWriterLeases`(`initializeDatabases`・reset用の手動経路)は残留引き継ぎを行わない。両経路が同じロックディレクトリを使うため、こちらが作ったロック(拡張フィールドなし)は`legacy_owner`として奪われない(安全側)。

### 3.7 運用文書(L7)

`docs/rules/advisory/G-02-dev-server-etiquette.md`に節「一時サーバーのデータフォルダ分離」を追記する(推奨であり必須化しない)。内容:

- 製造・検収で一時的にAPIを起動するときは、`WX_VIEWER_WEATHER_DB_PATH`・`WX_VIEWER_RETAINED_DB_PATH`を、オーナーの`apps/api/data/`とは別の一時フォルダ(スクラッチパッド等)に向ける。理由: 同じDBのwriterロックを争い、オーナーのサーバーの起動失敗や、本Issueの引き継ぎ判定の混乱を招くため。
- 退避先`*.writer-lock.stale-*`は、退避から1時間を超えたものが次のロック取得時に自動削除される。

## 4. テスト(製造担当が追加)

`apps/api/tests/writerLock.test.ts`を新規作成。一時ディレクトリ(`mkdtempSync(os.tmpdir())`)上で、`deps`を差し替えて判定を決定的に検証する。

| ケース | 準備 | 期待 |
| --- | --- | --- |
| 新規取得 | lockなし | lock作成、owner.jsonに`processStartedAt`(ISO)と`hostname`がある |
| pid不在 | 旧owner.json(拡張フィールドあり)、probe=absent | 取得成功、`lock.stale-<旧token>`に旧owner.jsonが残る、`takeover reason=pid_not_found`のwarn 1行 |
| pid再利用 | probe=present、差3000ms | 取得成功、`reason=pid_reused` |
| 生存 | probe=present、差1000ms | `EEXIST`例外、lock・owner.jsonは不変、`takeover_refused reason=owner_alive` |
| 旧形式 | `processStartedAt`なし | 例外、`reason=legacy_owner` |
| 破損・欠落 | owner.jsonが`{`/owner.jsonなし | 例外、`reason=owner_unreadable` |
| 判定不能 | probe=unknown | 例外、`reason=probe_failed` |
| 同一pid | `pid=process.pid` | 例外、`reason=same_process` |
| ABA防御 | 旧token T0で判定済みの状態を再現: `lock.stale-T0`(owner.json入り)と新lock(T1)を置き、T0を判定した後の引き継ぎ処理(内部関数を export するか、probeの呼び出し時に別プロセス相当の操作を差し込む)を実行 | `takeover_lost step=rename code=ENOTEMPTY`、T1のlockは不変 |
| 同時引き継ぎ(実プロセス) | 残留lock(pidは終了済みの子プロセスのpid)を用意し、`acquireWriterLock`を呼ぶ子プロセスを4つ同時起動。20回繰り返す | 各回とも成功は**ちょうど1**、lockのowner.jsonのpidが成功した子のpid |
| 古い退避先の削除 | `lock.stale-A`(taken-over.jsonの`takenOverAt`=2時間前)、`lock.stale-B`(同=10分前)、`lock.stale-C`(taken-over.jsonなし、`utimesSync`でmtime=2時間前)、無関係な`other.stale-X`(2時間前)を置いて取得 | AとCが削除、BとXは残る、`stale_removed`が2行 |
| 削除失敗でも継続 | 削除処理(`rmSync`相当)を失敗させる差し込み、または退避先の親を書込不可にする | 取得は成功、`stale_remove_failed`のwarn 1行 |
| 実probe | `probeProcess(process.pid)` | `present`、起動時刻が`Date.now() - process.uptime()*1000`と±2秒以内 |
| 実probe(不在) | 終了済み子プロセスのpid | `absent` |
| 解放失敗ログ | owner.jsonのtokenを書き換えて`releaseOwnedRoleLease` | `lease_owner_unverified`例外(従来どおり)+`release_failed`のerror 1行 |
| 終了ログ | `createRetryableDatabaseClose`で`stop`成功/失敗、`closeDatabase`失敗 | `start`/`complete`、`stage_failed stage=stop`、`stage_failed stage=close_database` |

ログ検証は`deps.log`(またはconsoleのモック)で行い、出力に`process.cwd()`・`os.homedir()`の文字列が含まれないことを全ケース共通で検証する。既存テスト(`databasePair*.test.ts`、`weatherAcquisitionWorker.test.ts`、`devLifecycle.test.ts`等)は無変更で通ること。

## 5. 受け入れ条件(検収手順)

共通準備: 検収担当はオーナーのデータを使わない。スクラッチパッドに`$D`を作り、`WX_VIEWER_WEATHER_DB_PATH=$D/weather.sqlite3 WX_VIEWER_RETAINED_DB_PATH=$D/retained.sqlite3 PORT=<空きポート> DISABLE_POLLING=true`で`npx tsx apps/api/src/server.ts`(本番起動と同じエントリ。製造担当が実際のエントリポイントを最終報告に明記する)を起動する。`npm run build`・`npm run dev`は使わない(L6を除く)。起動成功の判定は`[api] listening`の出力とHTTP 200(`/api/health`等、既存のヘルスエンドポイント)。

- [ ] **L1**: 一度起動して成功させ、`kill -9 <pid>`で終了させる。`$D/retained.sqlite3.writer-lock`と`$D/weather.sqlite3.writer-lock`が残っていることを`ls`で確認(weatherはWorker起動完了後に kill すること)。再起動する。合格: 起動成功し、stderrに`[writer-lock] takeover`が**retained・weatherそれぞれ1行**(`reason=pid_not_found`、`oldPid=`が kill したpid)、`$D`に`*.writer-lock.stale-*`が2つでき、中の`owner.json`が旧ownerのもの。自動テスト「pid不在」も合格。
- [ ] **L2**: (生存)サーバーを起動したまま、同じ`$D`・別ポートで2つ目を起動する。合格: 2つ目は起動失敗し、`takeover_refused reason=owner_alive`が出て、1つ目のlock・owner.jsonは不変(`cat`で前後比較)で1つ目は応答し続ける。(pid再利用)2つ目を止めた状態で1つ目を`kill -9`し、残った`retained`の`owner.json`の`pid`を**生存中の別プロセス**(例 `sleep 600 &`のpid)に書き換え、`processStartedAt`は元のまま(sleepの起動時刻と2秒超ずれる)にして起動する。合格: 起動成功、`takeover reason=pid_reused`。自動テスト「生存」「pid再利用」も合格。
- [ ] **L3**: L1と同様に残留を作り、`retained`の`owner.json`を(a)`{`に書き換え、(b)削除、(c)`processStartedAt`キーを削除、の各状態で起動する。合格: 各回とも起動失敗、`takeover_refused`の`reason`が(a)(b)`owner_unreadable`、(c)`legacy_owner`、lockディレクトリは残ったまま退避されていない。
- [ ] **L4**: 自動テスト「同時引き継ぎ(実プロセス)」「ABA防御」が合格すること。テストコードを読み、子プロセスが実ファイルシステム上で同時に`acquireWriterLock`を呼んでいること、成功数をちょうど1で検証していることを確認する。
- [ ] **L5**: 自動テスト「解放失敗ログ」が合格。加えて実機: サーバー起動中に`retained`の`owner.json`の`token`を書き換え、SIGTERMで停止する。合格: stderrに`[writer-lock] release_failed role=retained reason=lease_owner_unverified`と`[api-shutdown] stage_failed`が出る。正常停止(書き換えなし)では`[api-shutdown] start`と`complete elapsedMs=`が出て`release_failed`は出ない。
- [ ] **L6**: (オーナー観測パターンの再現)検収担当が`npm run dev`を起動して再現する(オーナーのdevは停止済み。起動前に`lsof -i :5174 -i :3001`で使用中でないことを確認する)。**必ず**`WX_VIEWER_WEATHER_DB_PATH=$D/weather.sqlite3 WX_VIEWER_RETAINED_DB_PATH=$D/retained.sqlite3`を付けて起動し、オーナーの`apps/api/data/`を使わない。L6の間は`npm run build`を実行しない(`packages/shared/dist`が更新されAPIが再起動し、共有distを壊すおそれがある)。手順: `apps/api/src`配下のファイルに無害な変更(コメント追加)を保存して再起動させる操作を、Worker準備中(起動直後数秒以内)のタイミングを含め5回以上繰り返す。うち1回以上は、再起動待ちの旧APIプロセスを`kill -9`する。合格: いずれの回も手作業でのロック削除なしに新APIが`[api] listening`に到達する。旧プロセスが異常終了した回では`takeover`ログが出る。変更は検収後に元へ戻す。**終了後は必ず自分が起動したdevを停止**し(devプロセスへSIGTERM)、5174・3001が解放されたことを`lsof`で確認する。
- [ ] **L9**: 自動テスト「古い退避先の削除」「削除失敗でも継続」が合格。加えて実機: L1の後に残った`$D/*.writer-lock.stale-*`の1つについて`taken-over.json`の`takenOverAt`を2時間前に書き換え、もう1つはそのままにして、サーバーを停止→再起動する。合格: 書き換えた方だけが削除され`stale_removed`が出る、もう一方は残る、起動成功。
- [ ] **L7**: `docs/rules/advisory/G-02-dev-server-etiquette.md`に§3.7の内容(環境変数名2つ、理由、stale削除の注意)が追記されていること。必須表現(「必ず」「禁止」等)で書かれていないこと。
- [ ] **L8**: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/api`・`npm run build`がすべて成功。`npm run build`はオーナーのdevが動いていないことを確認したうえで実行する。

全項目共通: 出力されたログ行にホームディレクトリ名・絶対パスが含まれないことを`grep`で確認する。

## 6. 後続Issueへの引き継ぎ

- `acquireWriterLeases`経路(reset等)は引き継ぎ非対応のまま。
- 起動準備の同期停止(#259後続)が解消されれば残留の発生自体が減る。

## 7. 残留リスク・実挙動未確認

- Linux(procps)での`ps -o lstart=`の出力形式は**実挙動未確認**。macOSでのみ実測。形式が違えば`probe_failed`となり奪わない側に倒れる(安全だが引き継ぎ不能)。
- worker_threads内での`execFileSync('ps')`の所要時間は**実挙動未確認**。
- `ps -o lstart`は秒精度で、記録側も同じ`ps`で取るため照合は同精度。システム時刻の大きな変更(NTP補正等で2秒超)があると、生存プロセスを`pid_reused`と誤判定しうる。開発機のPoC用途として許容する前提。
- 退避先の削除は1時間の閾値に依存する。旧ownerを読んでからrenameするまでに1時間以上止まったプロセスがあると二重取得防止が効かないが、現実的には起こらない前提。
- 旧形式のowner.json(本Issue導入前のロック)が残っている場合は引き継がれない。導入直後の1回は手作業削除が必要になりうる。
