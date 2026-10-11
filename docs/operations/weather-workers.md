# 気象 Worker の運用手順

Issue #260 の 2 Worker 構成を対象とする。操作前に対象環境の設定とバックアップを確認する。気象 DB の reset の詳細は [気象 DB 保守手順](../weather-db-maintenance.md) に従う。

## 状態の確認

1. `/api/health` でメイン HTTP の応答を確認する。`ok` は気象 Worker の正常を意味しない。
2. `/api/monitoring/status?terminalId=<端末ID>` と監視画面で、取得・提供を個別に確認する。処理状態、最後の報告時刻、元データの更新時刻、停止理由を混同しない。
3. `stale` は報告期限切れであり、終了確認ではない。`failed` は処理失敗を示す。取得の通常停止は Worker の停止と異なる。提供の停止中は保存済み閲覧も利用不能となる。
4. 通知・操作履歴と `/api/monitoring/weather-worker-operations` を照合する。結果不明の操作を画面表示だけで成功と判断しない。

## role 別の再開

1. 停止理由と旧 Worker の exit を確認する。exit が未確認なら代替 Worker を起動せず、状態の再読込と終了確認を続ける。応答が遅いだけの Worker を重ねて起動しない。
2. 取得 (`acquisition`) または提供 (`delivery`) の対象 role と、監視応答の `workerGeneration` を確認する。通常取得の開始・停止・強制更新は別の操作である。
3. 監視画面の専用再開操作を使う。API で行う場合は `POST /api/control/weather-workers/<role>/restart` に、一意の `requestId` と `expectedWorkerGeneration` を JSON で送る。同じ操作の再送には同じ `requestId` を使い、別の ID で二重実行しない。
4. 応答喪失・結果不明なら `GET /api/control/weather-workers/operations/<requestId>` で照会し、操作履歴と監視を再読込する。受付成功と Worker ready は別に確認する。提供は reader 接続が完了してから保存済み API を確認する。
5. 失敗した場合はエラーコード、旧世代、対象 role、時刻、DB 接続状態を記録する。原因を除去してから新しい `requestId` と最新世代で再試行する。取得失敗時も保持履歴とメイン HTTP を確認する。

## 全体停止と reset

1. 正規の停止経路でメインと取得・提供 Worker を終了する。取得停止操作だけでは全接続を閉じない。read-only 接続、タイマー、lease、SQLite ツールも終了を確認する。
2. 気象 DB・保持 DB と各付随ファイル (`-wal`、`-shm`、`-journal`) を停止時の一組として保全し、コピーを検査する。付随ファイルだけを手動削除しない。
3. `npm run db:reset:weather -- --plan --confirm-stopped` を実行し、対象パス、role、instance、削除対象、digest を確認する。
4. 承認された対象に限り `npm run db:reset:weather -- --apply --confirm <planDigest> --confirm-stopped` を実行する。途中失敗では journal を保持し、保守手順の `--resume` を用いる。保持 DB とタイル cache は reset 対象外である。
5. 正規起動後、新しい気象 DB 世代、取得・提供の ready、保持履歴の件数と sequence、保存済み情報の再取得状態を確認する。空の気象 DB を正常な最新データと表示しない。

## rollback

対象コードは `2619133`。停止とバックアップを先に済ませ、対象版の schema 検証と代表データ読取を**隔離コピー**で行う。`8ad36a6` 系で更新した DB を対象版が読めることが確認できた場合だけ、直接読取を選ぶ。互換性を確認できない場合は、対象版で保全した DB と付随ファイル一式を復元する。気象 DB・保持 DB・タイル cache・操作履歴・通知履歴の保全と、復帰後の件数・世代・閲覧結果を照合する。保全コピーがない場合は復元可能と判断しない。

## 検証状態

この文書は実装契約に基づく手順である。各分岐の実行状況と未検証事項は [Issue #260 検証結果](../design/issue-260-verification-results.md) に記録する。
