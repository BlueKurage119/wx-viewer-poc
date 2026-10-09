# Issue #257 製造検証記録

作成: Codex（GPT-6）。承認済み[設計書](../design/issue-257-weather-acquisition-worker.md)、設計コミット `341f40f`、製造ブランチ `codex/issue-257-weather-acquisition-worker` に対応する。これは製造担当の実行記録であり、検収担当の最終判定とは区別する。

追加UI・通知は暫定。今回の検証通過を表示・文言・通知の最終承認とせず、#259で必ずユーザーの監修を受けて確定する。通知欠落の許容と補完・再送なしは既承認事項である。

## 実装と所有境界

- 本番入口と `startServer` は保持DBとHTTPを先行起動し、取得Workerの準備結果を `weatherPrepared` で別に返す。旧DI単体試験・#253の同期復旧基線計測だけは `startInlineServer` を明示使用する。
- 気象writerとlease、通常取得・XML保存/解析、警報・速報・アメダスの更新、復旧/再処理、画像索引/tile miss保存、気象履歴・清掃は `createAcquisitionRuntime` から取得Worker内で構成する。メインは `openWeatherReader` による独立read-only/query-only接続と、書込み・清掃を無効にした画像readerを使用する。保持通知、session/claim/確認、取得操作、Worker再開履歴はメイン側に残る。
- `WeatherTransport` は世代・protocol version・plain dataを検証し、payloadと制御のframe枠を分ける。気象更新のbegin/candidate/complete ACKと公開pause/releaseで通知判定checkpoint・起動現況の境界を守る。
- 再開は旧Workerのexit、reader drain/close、予定ownerの完全一致を経て起動する。自動再起動はしない。通常取得の停止意図をメインで保持し、受付後の結果不明で巻き戻さない。

## 実行環境と品質確認

全DB・cache・fixtureは専用一時領域、HTTPは動的ポートを使用した。実運用データと既存devサーバーに障害を入れていない。APIはローカル会場上書きの影響を避け `NODE_ENV=production`、Reactのact/StrictModeを使うWebは通常のテスト環境で実行した。

| コマンド | 製造時の結果 |
| --- | --- |
| `NODE_ENV=production npm run test -w apps/api` | 967件通過（AC2/13の追加8件を含む） |
| `npm run test -w apps/web` | 481件通過 |
| `npm run test -w packages/shared` | 63件通過 |
| `npm run lint` | 通過、警告0 |
| `npm run typecheck` | 全workspace通過 |
| `npm run format:check` | 通過 |
| `npm run build` | 通過。Viteの既存500kB超bundle警告あり |
| 本番出力起動 | `apps/api/dist/server.js` の実Worker/HTTPがready。専用一時DBで停止・再開を実ブラウザから操作 |

#261基線のAPI903/Web473/shared61件とは別に、今回の全workspaceを実行した。初回のAPI失敗は、旧注入先/監視キー/HTTP先行待受への試験移行と、起動cleanup・画像準備前503の修正を行い解消した。

## 受入条件への対応

| 条件 | 製造で検証した内容 | 検収時の重点 |
| --- | --- | --- |
| AC1 | TS/本番JSの実Worker、thread/lease所有者、read-onlyでDDL拒否。画像readerの清掃なし。全書込み入口の構成を棚卸し | 全書込み経路の所有対応を独立レビュー |
| AC2 | directory/symlink/schema障害を別々に注入しHTTP・監視・保持system継続、元ファイル不変。共通衝突は既存DB回帰 | 追加8試験でEACCES/native open/migration/復旧throw/reader callback失敗も通過 |
| AC3 | database.ready ACK前の新DB世代unit拒否、旧null世代status拒否、reader独立検証、旧保存済み気象の継続 | reader close失敗からの再試行とmigration停止を独立確認 |
| AC4 | 実Worker terminate/未捕捉例外、異常通知1回、自動spawnなし、保存済み気象200、fresh/staleと終了理由の分離 | 保存済みPNGとmissの異常終了後結合 |
| AC5 | 初回accept期限・後着authorize、同期負荷中、同ID合流/別ID409/異世代拒否、別token/不完全owner保持 | exit確認不能・reader close失敗の全境界 |
| AC6 | 警報/速報初回checkpoint・対象外会場、healthの異常継続/回復→異常、保存失敗後補完0 | 実サーバーsession/確認状態との複合条件 |
| AC7 | 実Workerのbegin前/ACK後commit前/commit後未受領/保存後ACK前/ACK後/complete後の6窓、保存失敗後ACK喪失。checkpoint・保存件数・unknown scope完全一致 | 保持transaction実行中の終了窓を独立確認 |
| AC8 | 実Worker＋HTTPのU1/cursor101、system102、後続weather103、claim1・監査JSON一致。読取/監査失敗・pause期限・HTTP中断で保持副作用0、次の問い合わせ成功 | 複数startupと世代交代の複合競合 |
| AC9 | 実Worker6試験で停止送信直後/受付ACK喪失後exit、同ID照合、旧ACK/revision、未送信busy、受付後照会拒否を確認。再開サービス6試験と既存操作回帰 | 実上流fixtureで停止済み再開時の取得0を独立確認 |
| AC10 | 固定XML解析中の実HTTP各20要求が暫定基準内。下記測定値 | #260で代表負荷・最終構成を測定 |
| AC11 | 実transport 64枠、起動8枠、tile16/4、256KiB/8MiB境界、制御独立枠、閉鎖後拒否、pending0。実SQLite writer/reader BUSY100ms、checkpoint busy中sidecar inode保持 | 更新handshake期限超過中のfresh報告との複合条件 |
| AC12 | 両TileStoreでrename/unlinkとdescriptor読取競合。完全旧PNGまたは有限miss、metadata再取得1回、破損を成功扱いしない。4並列/16論理/合流/FIFO/30秒/close | 実HTTPの異なるtile missと保存済みtile/textの同時要求 |
| AC13 | 二重close、起動失敗後close、実npm dev/dev:host/API/SIGHUP、watch4世代、early-signal等9ケース、owner別close/lease解放 | 追加試験でreader単独reset拒否、停止後apply/resume・保持hash/mtime/行不変も通過 |
| AC14 | 全API967/Web481/shared63の回帰。旧DI試験をinlineへ明示分離し、実HTTP/Workerを追加試験で検証。画像準備前503、原文参照、availability・訓練属性等を維持 | #253/#256の既存条件との対応を最終レビュー |
| AC15 | 下記実ブラウザ記録。状態parser/再照会controller・表示はWeb8追加試験 | 全状態と3幅の組合せ、フォーカス/確認状態の独立確認 |
| AC16 | lint/typecheck/format、全workspace test、build、本番出力起動、対照/redを実施 | 最終差分・署名・範囲の確認 |

表の「検収時の重点」は製造で未実行の複合条件を含む。個々の試験通過だけでAC全項目の最終合格とは報告しない。

## 実Workerの限定負荷測定

Darwin x64、Intel Core i7-9750H 2.60GHz、12論理CPU。固定XMLは31,030 bytes、実Workerで同期DOM解析を5秒間508回実行した。latchで処理継続を確認した区間に各20回の実HTTPを送信した。全API回帰内での直近測定値は次のとおり。

| HTTP | 件数 | 最大 | p95 |
| --- | --- | --- | --- |
| health | 20 | 3.95 ms | 3.82 ms |
| monitoring/status | 20 | 5.42 ms | 3.61 ms |
| system差分 | 20 | 4.22 ms | 4.06 ms |

health最大500ms・監視1秒・system2秒の暫定回帰基準を通過。限定fixtureの観測値であり、実運用性能の保証ではない。

## 対照/redの記録

すべて意味を変えないコメント改変で通過を先に確認し、対象を壊す改変で失敗を確認して復元した。

| 対象 | 破壊改変と観測 |
| --- | --- |
| Web/共有・再開サービス | 状態parser、鮮度境界、再開表示、同ID照合、停止意図、未記録fallbackの各代表改変で対象試験FAIL |
| 通知判定 | 警報/health checkpoint引継ぎ、pause token一致を壊すと対象試験FAIL |
| 開発起動 | Worker writer closeを省くと所有者別close試験FAIL |
| tile/DB | 待機期限を1ms延長、descriptorでなくpath再読取、metadata再読取除去、busy_timeout=0で各対象試験FAIL |
| 取得意図 | 受付後query失敗処理を除去すると意図維持試験FAIL |
| transport・実公開・reader | 対照14/14通過後、8MiBちょうどを拒否、公開cursorをsystem102受領後へ移動、read-only/query-onlyを解除して各対象試験FAIL |

DB試験の一度の併走失敗は、別担当のread-only mutation時間帯と重なったもの。復元後のDB3件および全API回帰は通過した。

## 実ブラウザ

Chromeの検証専用タブ、本番Web出力、動的ポート・一時DBの実APIを使用した。既存の運用タブは変更していない。

- H端末は既存どおり監視ナビなし、K端末で監視と共通通知を表示。
- 360/768/1280pxで取得Worker欄を確認。360pxは縦スクロールで操作欄へ到達でき、状態/理由/専用ボタンが欄内に収まる。既存テーブルの横スクロールは維持。
- 稼働中の専用再開は無効。実Workerをterminateすると「Worker異常」「予期しない終了」と専用操作が有効になる。
- EnterおよびSpaceで2回の専用再開を実行。再開中はボタン無効・progress表示、完了後は稼働中と「取得は停止したままです」を表示し、通常停止意図を維持。
- 履歴をSpaceで展開し2件を確認。Tabで既存取得開始へ移動し、既存操作と共通通知の確認選択を操作できる。
- 追加HTTP fixtureで準備中・stale・応答喪失・unknown・履歴未記録・再開成功後準備失敗を注入して表示を確認した。これは表示・通信制御検証であり、実Worker障害試験とは区別する。


追加境界試験: `weatherWorkerStartupIsolation.test.ts` 5件、`weatherReaderResetSafety.test.ts` 2件、`weatherReaderFailure.test.ts` 1件が通過。fixture設定のみの対照8件PASS→故障/reader保持を無効化して対象7件FAIL→復元8件PASSを確認した。

ブラウザの追加HTTP fixtureでは、準備中の操作不可、staleの再開許可、30秒応答喪失時の新規再開抑止、同一IDのGET再確認、unknown結果、履歴未記録を確認した。再開成功後の気象準備失敗で結果文言が「準備中」になる点を発見し、失敗を明示する表示へ修正。対照8件通過→当該分岐を除去してFAIL→復元を確認した。新規POSTは1回、応答喪失中と再確認はすべて同じ操作IDのGETであることをfixtureの受信記録でも確認した。

全Webの再実行で既存通知試験の30ms待ちが負荷によって完了順序を固定できない事象を一度検出した。製品ではなく試験の順序制御を、指定通知の受信barrierへ変更した。期待順序・アサーションは変更していない。

検証終了時に専用タブを閉じ、viewport指定を解除し、2本の検証HTTPプロセスは自身の終了コマンドで正常終了した。専用DB/cacheも片付けた。

## 初回検収差戻しの修正（AC3 / AC11）

初回検収で再現した次の2件を修正した。以下は製造側の再検証記録であり、検収側の残る複合条件の独立実行を置き換えない。

- AC3: 実Workerが更新開始後にU2を保存し、判定候補・完了を送らず終了した会場で、通常APIがU2をstaleとして返していた。未完了scopeを6気象APIの既存unavailable応答へ接続し、監視は情報種ごとのunavailable・件数null・readErrorsを返す。起動現況も同じscope照合を使う。
- 通常XMLのscopeが地域コードだった点も修正した。通常取得は地域コードを会場×controlStatus×情報種へ変換し、警報再処理はpage内の運用区分、復旧commitはその運用区分の警報、初回判定は実際に判定する警報/解説情報を指定する。会場全体を指定した故障fixtureは全情報種・全運用区分を抑止するが、通常警報の未完了は訓練警報・他情報種・別会場を抑止しない。
- AC11: 起動問い合わせのHTTP中断後に残るpublication.pauseが一般制御8枠を占有すると、停止がbusyになっていた。通信要求は通常64・一般制御8・停止2・終了/異常停止2の独立した有界枠とし、停止実行・停止結果照会・成功/失敗返信・未ACKフレームの送信容量まで同じ専用枠を維持する。

追加回帰は、AC3の地域→scope対応・通常XML実取得経路・scope一致3件と、会場全体/通常警報限定×実行中/異常終了後の実Worker HTTP4件。AC11は通常HTTPの無負荷対照/起動問い合わせ8中断、一般制御・停止・終了枠の上限と独立性、返信の未ACK飽和、受信組立枠飽和を確認した。

AC3はコメントのみ対照7件PASSの後、読取抑止を外して実Worker4件FAIL、scope生成/取得経路の接続を壊して2件FAIL、運用区分の照合を外して1件FAILを確認し復元した。AC11はコメントのみ対照5件PASSの後、停止枠の共用化・返信の再分類・受信組立枠の共用化で各対象試験FAIL、復元後に関連23件PASSを確認した。

追加UI・通知の見た目と文言は引き続き暫定であり、#259でユーザー監修を受けて確定する。

修正後の品質確認: 全API **980件PASS**、`lint` / `typecheck` / `format:check` / `build` はすべてexit code 0。Web・sharedは今回変更がないため再実行していない（直前の初回検収はWeb481件・shared63件PASS）。ビルドには既存の500kB超bundle警告のみが残る。
