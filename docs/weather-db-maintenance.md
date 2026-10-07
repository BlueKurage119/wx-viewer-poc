# 気象DB保守手順

Issue #247の物理分離後は、気象DBと保持DBを別ファイルで扱う。気象原文・取得履歴・派生値の初期化は明示コマンドだけで実施し、保持DBの操作記録・通知履歴・端末session・起動claim・起動応答監査を保全する。

## 初回導入

1. 正規の停止手順で全API・取得writer・SQLiteツールを停止する。取得の停止ボタンだけでは接続が残るため停止確認にならない。
2. 旧単一DBと付随ファイルの存在・退避状況を確認する。本手順は旧DBをコピー・変換・逆移行しない。既に移動済みという報告だけで残存ファイルを削除しない。
3. 旧 `WX_VIEWER_DB_PATH` を設定から除き、`WX_VIEWER_WEATHER_DB_PATH` と `WX_VIEWER_RETAINED_DB_PATH` を別の通常ファイルへ指定する。相対パスは `apps/api` 基準。既定はそれぞれ `data/weather.sqlite3`、`data/retained.sqlite3`。
4. 正規起動で両baselineを作成し、気象情報を再取得する。旧DB、未知schema・checksum、逆role、不正なパスは起動拒否される。識別エラーを解消するための自動削除は行わない。

初回は既存記録の引継ぎを要求しない。導入後は保持DBの保全が必須である。

## 導入後の気象DB初期化

1. 全writerを正規手順で停止し、保守中に他のSQLiteツールを起動しない。leaseは協調writerの排他であり、非協調writerの新規起動をOSレベルで禁止するものではない。
2. 必要なデータ保全を行う。保全は停止時に主DBと存在する `-wal` / `-shm` / `-journal` を一組として扱い、コピーの検証を行う。検査用の一時コピーは保全・移行・バックアップの代用ではない。保持DBを初期化対象に含めない。
3. 同じ設定を使用して次を実行する。

   ```bash
   npm run db:reset:weather -- --plan --confirm-stopped
   ```

4. 出力された正規保存先、weather role・instance、主ファイル・付随ファイル一覧を確認する。気象原文・取得履歴・派生値が消失すること、保持DB・タイルcacheは対象外であることを確認し、実施承認を得る。
5. 出力されたdigestで実施する。

   ```bash
   npm run db:reset:weather -- --apply --confirm <planDigest> --confirm-stopped
   ```

6. 正規起動する。コマンド内ではschemaを作成しない。次回起動で新しい気象instanceと空schemaを作り、既存の初期取得・会場評価ゲート完了後に通知を取得する。取得失敗を正常空として扱わない。

planは元DBをSQLiteで開かず、一時領域に主・付随ファイルをコピーしてrole・checksum・整合性を検査する。検査前後の元ファイルstat/hashが一致しない場合は拒否する。applyは正規パス・世代・各ファイルのidentity/hashとdigestを照合してから、気象主DBとその3種類の付随ファイルだけを削除する。保持DB、設定、cache、directory全体は削除しない。

停止確認flag不足、digest相違、利用中のDB、停止検査不能、不正なlink、別role、主なし付随ファイルは無変更で拒否する。両DBのwriter lease取得にも成功する必要がある。

## 途中失敗と再実行

削除中の障害は非0終了し、`<weather DB>.reset.json` が残る。アプリはこのjournalが残る間、DBを開く前に起動を拒否する。

```bash
npm run db:reset:weather -- --resume --confirm <元planDigest> --confirm-stopped
```

resumeは元journalの対象・role・instance・digestと残存ファイルidentity/hashを検証する。削除済みの主ファイルを再作成したりSQLiteで開いたりせず、記録済みの付随ファイルだけを続行する。別inode・再生成DB・改変journalは削除しない。journalを手動で消して起動を通さないこと。

完了後のapply再実行は主・付随ファイル・journalが全て不在ならno-opとなる。主なし付随ファイルだけが残り、正当なjournalがない場合は帰属不明で拒否する。

writer-lockが残った場合はstaleと推測して自動削除しない。全writer停止、所有token、対象確認に基づく保守判断を行う。resetにforce/unlockオプションはない。

タイルcache本体は残る。DB索引が消えた状態でcacheだけを根拠にavailableにはせず、再取得後の新索引とファイルが一致するtileだけを配信する。既存の参照外cache清掃方針は変わらない。

## コードrollbackとデータ復元

コードrollbackとDB復元は別の作業である。初回のコピー変換・逆移行は行わない。

1. 分割版を正規停止し、新保持DBとその付随ファイルを保全する。
2. 旧版を起動する必要がある場合は、旧版用の別空DBを旧 `WX_VIEWER_DB_PATH` で指定する。新保持DBや新気象DBを旧版に直接渡さない。
3. 分割版へ戻す際は旧版を正規停止し、元の2設定へ戻して新保持DBを継続使用する。保持5表の値と通知sequence・session・claimが保全されていることを確認する。

旧データを復元する場合は、別途保全した旧DBと付随ファイルの一組を旧版用保存先へ戻す。旧DBの退避がなければ旧データの復元はできない。新保持記録を旧単一DBへ逆移行する経路はない。

気象DB初期化後も過去通知のsummaryとIDは残る。原文は世代が一致し存在する場合だけ参照でき、消失・世代違いは「原文参照不可」となる。整数IDが再利用されても別電文へ接続しない。
