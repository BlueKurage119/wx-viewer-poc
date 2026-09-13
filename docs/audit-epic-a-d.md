# Epic A〜D 棚卸し（Issue #139）

調査日: 2026-09-13。対象: BlueKurage119/wx-viewer-poc。実装基準: `60aaf5b30b28091e3405797e599cc72c1904b6bd`（Epic D8 完了 main）。設計承認後、未決は後続Issueへ未決のまま残すユーザー判断に従った。

## 1. 調査範囲と読み方

基準の39設計ファイル、全48 PRの本文・会話42件・レビュー54件・inline65件・変更ファイル一覧を読み、後続修正と現コード・テストを照合した。PRレビューの定型案内・空レビュー・再レビュー依頼は製品申し送りの抽出対象外とした。関連Issue会話6件も確認した。取得失敗を0件と扱っていない。

REST全状態一覧143項目はIssue95件とPR48件に分離した。取得済み資料はページネーションの末尾まで取得しており、基準SHAの設計一覧と作業ツリーの差は本棚卸し設計1本だけ。調査後にC17 #144/D10 #145を起票し、タスクは97件になった。設計書の当時の表現は書き換えず、本台帳で現在状態へ結び直す。

状態は未決/未対応/確認待ち/対応中/解消済み/対象外。採否待ちの低頻度保守は未決に含め、修正必須ではない。将来前提の変更と通常運用で到達する障害を影響欄で分ける。PR転載表は未決・未対応・確認待ち・対応中の全IDを収める。

## 2. 母集団台帳

### 2.1 設計ファイル（39件＋調査手順1件）

| 資料ID | ファイル | Issue | 基準blob/設計commit | 判定/取得・確認状態 | 抽出ID |
| --- | --- | --- | --- | --- | --- |
| AD-S001 | [docs/design/issue-1-project-initialization.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-1-project-initialization.md) | 1 | 88a38136bec0075e1a46fc5ac49ed5b94880980e | 対象・全文確認済み | [AD-H026](#ad-h026), [AD-H027](#ad-h027), [AD-H072](#ad-h072), [AD-H073](#ad-h073) |
| AD-S002 | [docs/design/issue-10-retention-policy.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md) | 10 | b47ab0302db8280b87534c15b78fa0a23d4484e7 | 対象・全文確認済み | [AD-H010](#ad-h010), [AD-H011](#ad-h011), [AD-H013](#ad-h013), [AD-H077](#ad-h077) |
| AD-S003 | [docs/design/issue-103-notification-message-definitions.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md) | 103 | e0a45cf4de9b50f3e7ecc95df5e3c74d29c7d5b5 | 対象・全文確認済み | [AD-H007](#ad-h007), [AD-H024](#ad-h024), [AD-H025](#ad-h025), [AD-H051](#ad-h051), [AD-H067](#ad-h067), [AD-H068](#ad-h068), [AD-H110](#ad-h110), [AD-H111](#ad-h111) |
| AD-S004 | [docs/design/issue-109-venue-forecast-target-definitions.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md) | 109 | ce731c085ed58e75aa8eb7a12f5dfb5bcf5b6859 | 対象・全文確認済み | [AD-H008](#ad-h008), [AD-H014](#ad-h014), [AD-H017](#ad-h017), [AD-H018](#ad-h018), [AD-H053](#ad-h053), [AD-H102](#ad-h102) |
| AD-S005 | [docs/design/issue-11-xml-feed-polling.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-11-xml-feed-polling.md) | 11 | a0224b5eaff7614760ec35cb940269310409d769 | 対象・全文確認済み | [AD-H064](#ad-h064), [AD-H077](#ad-h077), [AD-H117](#ad-h117) |
| AD-S006 | [docs/design/issue-114-venue-scoped-adoption-history.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md) | 114 | 0428f911af7c4e44911d515980a4da8333c97409 | 対象・全文確認済み | [AD-H011](#ad-h011), [AD-H014](#ad-h014), [AD-H015](#ad-h015), [AD-H016](#ad-h016), [AD-H017](#ad-h017) |
| AD-S007 | [docs/design/issue-118-self-contained-test-fixtures.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-118-self-contained-test-fixtures.md) | 118 | 8c20febdba75c080369b6d8bbd97a744c3748d66 | 対象・全文確認済み | [AD-H055](#ad-h055), [AD-H081](#ad-h081) |
| AD-S008 | [docs/design/issue-12-warning-xml-parser.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-12-warning-xml-parser.md) | 12 | b8cee783dc5dd3183d41e4c2a347aa866b0f2718 | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H067](#ad-h067), [AD-H102](#ad-h102) |
| AD-S009 | [docs/design/issue-13-warning-current-state.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md) | 13 | 6a639c0811519c64fa1df6238f21dbb4818bf866 | 対象・全文確認済み | [AD-H044](#ad-h044), [AD-H046](#ad-h046), [AD-H070](#ad-h070), [AD-H102](#ad-h102), [AD-H109](#ad-h109), [AD-H112](#ad-h112) |
| AD-S010 | [docs/design/issue-130-duplicate-freshness-policy.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-130-duplicate-freshness-policy.md) | 130 | aef0045e0e31ddc45700a091b42b7238f104eca2 | 対象・全文確認済み | [AD-H105](#ad-h105) |
| AD-S011 | [docs/design/issue-14-warning-timeseries.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-14-warning-timeseries.md) | 14 | c009fe2fce60483fab4fd3f52d86a69427f24baa | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H048](#ad-h048), [AD-H102](#ad-h102) |
| AD-S012 | [docs/design/issue-15-early-warning.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-15-early-warning.md) | 15 | baf021546f58f963eb67ef632075f7b625878957 | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H049](#ad-h049) |
| AD-S013 | [docs/design/issue-16-area-time-series-forecast.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md) | 16 | fd3868179d51961d829d174ba3f084ae57217bf6 | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H046](#ad-h046), [AD-H050](#ad-h050), [AD-H051](#ad-h051) |
| AD-S014 | [docs/design/issue-17-bosai-bulletin.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-17-bosai-bulletin.md) | 17 | be5079406751b80804d4ab35cc2df86f5ade1efe | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H046](#ad-h046), [AD-H047](#ad-h047) |
| AD-S015 | [docs/design/issue-18-tornado-bulletin.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md) | 18 | 0a3502a7e587bda8f19fd833a9d0311d0df5fc01 | 対象・全文確認済み | [AD-H042](#ad-h042), [AD-H043](#ad-h043), [AD-H045](#ad-h045), [AD-H047](#ad-h047) |
| AD-S016 | [docs/design/issue-19-amedas-normalization.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md) | 19 | 3a5302665053881ccd0ca5fad96c8821bba70847 | 対象・全文確認済み | [AD-H008](#ad-h008), [AD-H009](#ad-h009), [AD-H052](#ad-h052), [AD-H053](#ad-h053), [AD-H054](#ad-h054), [AD-H055](#ad-h055) |
| AD-S017 | [docs/design/issue-2-common-shell.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md) | 2 | d85b96838a8978cab914635e4a3d8e346e09a217 | 対象・全文確認済み | [AD-H004](#ad-h004), [AD-H018](#ad-h018), [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H021](#ad-h021), [AD-H022](#ad-h022), [AD-H023](#ad-h023), [AD-H026](#ad-h026), [AD-H027](#ad-h027), [AD-H075](#ad-h075), [AD-H102](#ad-h102) |
| AD-S018 | [docs/design/issue-20-nowcast-tiles.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md) | 20 | 6aba880bc49693e5c033ec6ce4fcf581d3837baa | 対象・全文確認済み | [AD-H056](#ad-h056), [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H059](#ad-h059), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H093](#ad-h093) |
| AD-S019 | [docs/design/issue-21-kikikuru-tiles.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md) | 21 | 14ec0995ec24f69f3308761c481cadeebe0cc854 | 対象・全文確認済み | [AD-H056](#ad-h056), [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H093](#ad-h093) |
| AD-S020 | [docs/design/issue-22-initial-recovery.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-22-initial-recovery.md) | 22 | 308ffa34ddbd26c7c96e2529375a361cc9f679d5 | 対象・全文確認済み | [AD-H063](#ad-h063), [AD-H064](#ad-h064), [AD-H114](#ad-h114), [AD-H117](#ad-h117) |
| AD-S021 | [docs/design/issue-23-exponential-backoff-retry.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-23-exponential-backoff-retry.md) | 23 | fa333a39687034595abaa960f13228814cb4b2b6 | 対象・全文確認済み | [AD-H064](#ad-h064), [AD-H070](#ad-h070), [AD-H117](#ad-h117) |
| AD-S022 | [docs/design/issue-24-time-based-polling-scheduler.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md) | 24 | 10692ec2ca4990b12cbddfa8e2abd23bb79db121 | 対象・全文確認済み | [AD-H008](#ad-h008), [AD-H041](#ad-h041), [AD-H061](#ad-h061), [AD-H062](#ad-h062), [AD-H064](#ad-h064) |
| AD-S023 | [docs/design/issue-25-notification-data-model.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md) | 25 | dd0c4942503b7940f25422ed36d5dcd020e84678 | 対象・全文確認済み | [AD-H005](#ad-h005), [AD-H024](#ad-h024), [AD-H026](#ad-h026), [AD-H066](#ad-h066), [AD-H069](#ad-h069), [AD-H098](#ad-h098), [AD-H111](#ad-h111) |
| AD-S024 | [docs/design/issue-26-notification-category-classifier.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-26-notification-category-classifier.md) | 26 | dcd02d94780440fc52bc9ebc1c27477bd7e59ff7 | 対象・全文確認済み | [AD-H044](#ad-h044), [AD-H109](#ad-h109), [AD-H110](#ad-h110) |
| AD-S025 | [docs/design/issue-27-warning-state-change-notification-decision.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-27-warning-state-change-notification-decision.md) | 27 | a5bd3e09c674a6979c38d03aab7a3269a1fb09c9 | 対象・全文確認済み | [AD-H037](#ad-h037), [AD-H110](#ad-h110) |
| AD-S026 | [docs/design/issue-28-warning-notification-generation-rules.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md) | 28 | bdd116bfa5e18f2368142f5836014fa00fb336ce | 対象・全文確認済み | [AD-H010](#ad-h010), [AD-H037](#ad-h037), [AD-H039](#ad-h039), [AD-H040](#ad-h040), [AD-H043](#ad-h043), [AD-H044](#ad-h044), [AD-H070](#ad-h070) |
| AD-S027 | [docs/design/issue-29-startup-notification-api.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) | 29 | 77bbc0520fa33967d5c7d92d5fa9d319218b1603 | 対象・全文確認済み | [AD-H005](#ad-h005), [AD-H006](#ad-h006), [AD-H007](#ad-h007), [AD-H012](#ad-h012), [AD-H026](#ad-h026), [AD-H063](#ad-h063), [AD-H066](#ad-h066) |
| AD-S028 | [docs/design/issue-3-common-metadata.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-3-common-metadata.md) | 3 | 33b2279e555c0c8f5dac4cfd6ac5aeb7546afdf4 | 対象・全文確認済み | [AD-H014](#ad-h014), [AD-H065](#ad-h065), [AD-H077](#ad-h077) |
| AD-S029 | [docs/design/issue-30-terminal-session.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md) | 30 | 58b346e588534f5eb3a7870b639f0b426f487063 | 対象・全文確認済み | [AD-H010](#ad-h010), [AD-H012](#ad-h012), [AD-H025](#ad-h025), [AD-H114](#ad-h114) |
| AD-S030 | [docs/design/issue-31-equipment-anomaly-notification.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) | 31 | 3e083b1ebf386730d37038ae89209a63fe095989 | 対象・全文確認済み | [AD-H001](#ad-h001), [AD-H003](#ad-h003), [AD-H004](#ad-h004), [AD-H007](#ad-h007), [AD-H023](#ad-h023), [AD-H039](#ad-h039), [AD-H040](#ad-h040), [AD-H041](#ad-h041), [AD-H067](#ad-h067), [AD-H068](#ad-h068), [AD-H069](#ad-h069) |
| AD-S031 | [docs/design/issue-32-notification-origin.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md) | 32 | 87a0d6b539af777884f4e120bd016116fab2683c | 対象・全文確認済み | [AD-H069](#ad-h069), [AD-H111](#ad-h111) |
| AD-S032 | [docs/design/issue-4-availability-state-transition.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-4-availability-state-transition.md) | 4 | 5b474531d4b1253e47d3a30938370599272b707f | 対象・全文確認済み | [AD-H004](#ad-h004), [AD-H070](#ad-h070), [AD-H077](#ad-h077) |
| AD-S033 | [docs/design/issue-5-sqlite-persistence.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-5-sqlite-persistence.md) | 5 | d38d93af563107a5e0b240961515210265b1370a | 対象・全文確認済み | [AD-H011](#ad-h011), [AD-H028](#ad-h028), [AD-H077](#ad-h077) |
| AD-S034 | [docs/design/issue-6-info-type-schema.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md) | 6 | 41b10c3c4b25b787a45b717ab42070c7bbc08e77 | 対象・全文確認済み | [AD-H011](#ad-h011), [AD-H018](#ad-h018), [AD-H047](#ad-h047), [AD-H052](#ad-h052), [AD-H054](#ad-h054), [AD-H058](#ad-h058), [AD-H065](#ad-h065), [AD-H077](#ad-h077), [AD-H118](#ad-h118) |
| AD-S035 | [docs/design/issue-6-table-definition.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-table-definition.md) | 6 | c332ccfc8d156705651014e9ff2b4ee877cb2457 | 対象・全文確認済み | [AD-H032](#ad-h032) |
| AD-S036 | [docs/design/issue-7-reception-history.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md) | 7 | 7f2fd92c49514d241eb4a0ddda7326b8e5825dea | 対象・全文確認済み | [AD-H011](#ad-h011), [AD-H013](#ad-h013), [AD-H042](#ad-h042), [AD-H065](#ad-h065), [AD-H077](#ad-h077), [AD-H085](#ad-h085), [AD-H118](#ad-h118) |
| AD-S037 | [docs/design/issue-8-notification-output-history.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md) | 8 | 5b461a8577b6ccab3a884081fe3a99ac9d2c7bc0 | 対象・全文確認済み | [AD-H024](#ad-h024), [AD-H025](#ad-h025), [AD-H065](#ad-h065), [AD-H066](#ad-h066), [AD-H111](#ad-h111) |
| AD-S038 | [docs/design/issue-9-operation-history.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-9-operation-history.md) | 9 | cf09025693a83dbafc2bd0cd21c69f992ba66c61 | 対象・全文確認済み | [AD-H026](#ad-h026), [AD-H064](#ad-h064), [AD-H065](#ad-h065) |
| AD-S039 | [docs/design/issue-90-semantic-colors.md](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-90-semantic-colors.md) | 90 | e86e893b73e6c04c7bd4dd68d5ee6737fd7c1cf2 | 対象・全文確認済み | [AD-H004](#ad-h004), [AD-H020](#ad-h020) |
| AD-S040 | [docs/design/issue-139-epic-a-d-audit.md](design/issue-139-epic-a-d-audit.md) | #139 | 3c3e3a305a6aada34c62f855f07ea1c227c56f6e | 対象外：調査手順自身、基準後追加 | 該当なし |

### 2.2 PR（全48件）

本文・会話・レビュー・inline・変更ファイルをそれぞれ正常取得。以下の件数は保存した完全レスポンスで数えた。設計修正PRは設計側の管理IDも併記する。更新日時は取得時点のGitHub値であり、マージSHAと基準commitを混同しない。

| 資料ID | PR | 関連Issue | 更新日時UTC | merge SHA | 対象判定 | 本文/会話・review・inline件数 | 抽出ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AD-P001 | [#89 A1. プロジェクト初期化(React+TS+Vite / Express+TS / npm workspaces)](https://github.com/BlueKurage119/wx-viewer-poc/pull/89) | #1 | 2026-09-07T20:10:35Z | ce7a9ac5132f2f265705267073419a27d82f7faf | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/3/4 | [AD-H026](#ad-h026), [AD-H027](#ad-h027), [AD-H072](#ad-h072), [AD-H073](#ad-h073) |
| AD-P002 | [#91 Issue #2: 共通シェルの設計・試作実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/91) | #2 | 2026-09-08T12:34:51Z | 4ccad91baee87af269c06381b9c804b6b17a1664 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/1/1 | [AD-H004](#ad-h004), [AD-H018](#ad-h018), [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H021](#ad-h021), [AD-H022](#ad-h022), [AD-H023](#ad-h023), [AD-H026](#ad-h026), [AD-H027](#ad-h027), [AD-H074](#ad-h074), [AD-H075](#ad-h075), [AD-H102](#ad-h102) |
| AD-P003 | [#92 Investigate Issue 90](https://github.com/BlueKurage119/wx-viewer-poc/pull/92) | #90 | 2026-09-08T11:58:08Z | 未マージ（merged_at=null） | 関連資料：#90予備調査、製品変更なし | 全文確認済み / 1/0/0 | 該当なし |
| AD-P004 | [#93 Fix test scripts & test environments](https://github.com/BlueKurage119/wx-viewer-poc/pull/93) | #2 | 2026-09-08T12:21:08Z | 未マージ（merged_at=null） | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H004](#ad-h004), [AD-H018](#ad-h018), [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H021](#ad-h021), [AD-H022](#ad-h022), [AD-H023](#ad-h023), [AD-H026](#ad-h026), [AD-H027](#ad-h027), [AD-H074](#ad-h074), [AD-H075](#ad-h075), [AD-H102](#ad-h102) |
| AD-P005 | [#94 chore: サブエージェント(designer/builder/inspector)とCLAUDE.mdの整備](https://github.com/BlueKurage119/wx-viewer-poc/pull/94) | 変更ファイルで判定 | 2026-09-08T17:17:40Z | f7c4494fa9362585b1a8d2dacf6c99bbe4d67960 | 対象外：エージェント規約のみ | 全文確認済み / 0/0/0 | 該当なし |
| AD-P006 | [#95 docs: Codex向けプロジェクト指示を追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/95) | 変更ファイルで判定 | 2026-09-08T13:59:57Z | dc64fc605138968402a63dacc9508451a5d3e3f8 | 対象外：AGENTS新設のみ | 全文確認済み / 0/0/0 | 該当なし |
| AD-P007 | [#96 feat: Issue #90 警戒レベル・通知区分のセマンティックカラー](https://github.com/BlueKurage119/wx-viewer-poc/pull/96) | #90 | 2026-09-08T16:40:43Z | 264e9ac2c44637975299e7d26426d7baa63a8ca3 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H004](#ad-h004), [AD-H020](#ad-h020), [AD-H075](#ad-h075) |
| AD-P008 | [#97 feat: 共通メタ情報型を追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/97) | #3 | 2026-09-08T16:51:43Z | 9c4f644fc19e63f817d662e027ea5754e2f746d0 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H014](#ad-h014), [AD-H065](#ad-h065), [AD-H077](#ad-h077) |
| AD-P009 | [#98 feat: availability状態遷移を実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/98) | #4 | 2026-09-08T17:15:23Z | b047c928c32221ab47126e1b883f30807de16f6e | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H004](#ad-h004), [AD-H070](#ad-h070), [AD-H077](#ad-h077) |
| AD-P010 | [#99 fix: Epic Aのコードレビュー実施に伴う修正](https://github.com/BlueKurage119/wx-viewer-poc/pull/99) | 変更ファイルで判定 | 2026-09-08T18:23:08Z | aad6f908b8d890f9cc8c55b95018463fbd6f76f6 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H004](#ad-h004), [AD-H076](#ad-h076) |
| AD-P011 | [#100 feat: SQLite永続化基盤を導入](https://github.com/BlueKurage119/wx-viewer-poc/pull/100) | #5 | 2026-09-09T21:36:53Z | 7c0d473a5190450687d42b29bb3999d44a551cec | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H011](#ad-h011), [AD-H028](#ad-h028), [AD-H029](#ad-h029), [AD-H077](#ad-h077), [AD-H119](#ad-h119) |
| AD-P012 | [#101 B2. 情報種別ごとのテーブル・スキーマ設計](https://github.com/BlueKurage119/wx-viewer-poc/pull/101) | #6 | 2026-09-08T20:37:35Z | 52ac16857e0d74911e18835ff1e05fa22b500e93 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 3/3/4 | [AD-H011](#ad-h011), [AD-H013](#ad-h013), [AD-H018](#ad-h018), [AD-H030](#ad-h030), [AD-H031](#ad-h031), [AD-H032](#ad-h032), [AD-H047](#ad-h047), [AD-H052](#ad-h052), [AD-H054](#ad-h054), [AD-H058](#ad-h058), [AD-H065](#ad-h065), [AD-H077](#ad-h077), [AD-H078](#ad-h078), [AD-H079](#ad-h079), [AD-H118](#ad-h118) |
| AD-P013 | [#102 feat: Issue #7 受信履歴テーブルの設計・実装（通信履歴・電文履歴）](https://github.com/BlueKurage119/wx-viewer-poc/pull/102) | #6, #7 | 2026-09-09T21:36:51Z | ae4618348d08dbd99c9c9f5e64592e48d1eba137 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H011](#ad-h011), [AD-H013](#ad-h013), [AD-H032](#ad-h032), [AD-H042](#ad-h042), [AD-H065](#ad-h065), [AD-H077](#ad-h077), [AD-H080](#ad-h080), [AD-H085](#ad-h085), [AD-H118](#ad-h118) |
| AD-P014 | [#104 feat(api): 通知出力履歴テーブルとリポジトリを追加 (#8)](https://github.com/BlueKurage119/wx-viewer-poc/pull/104) | #6, #8 | 2026-09-08T22:33:33Z | d0a9a42c9a376bef24acd0ac9e9ce8ccd19ce396 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H024](#ad-h024), [AD-H025](#ad-h025), [AD-H032](#ad-h032), [AD-H065](#ad-h065), [AD-H066](#ad-h066), [AD-H111](#ad-h111) |
| AD-P015 | [#105 feat(api): 操作記録テーブルとリポジトリを実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/105) | #6, #9 | 2026-09-09T21:36:54Z | 50c74d574a93e582bfdbe3b7b2840a7f105df6ee | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H026](#ad-h026), [AD-H032](#ad-h032), [AD-H064](#ad-h064), [AD-H065](#ad-h065) |
| AD-P016 | [#106 test: Issue #10 履歴保持ポリシーを検証](https://github.com/BlueKurage119/wx-viewer-poc/pull/106) | #10 | 2026-09-09T02:24:56Z | f3513854c956a83b618d700baae0461f79e6a342 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H010](#ad-h010), [AD-H011](#ad-h011), [AD-H013](#ad-h013), [AD-H077](#ad-h077) |
| AD-P017 | [#107 feat: XML定時・随時フィードのポーリング基盤を実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/107) | #11 | 2026-09-09T09:54:27Z | 55d9be2f964f376e4d46b42810e0f20024294c3d | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H033](#ad-h033), [AD-H034](#ad-h034), [AD-H064](#ad-h064), [AD-H077](#ad-h077), [AD-H117](#ad-h117) |
| AD-P018 | [#108 feat: 警報・注意報XML電文を解析する](https://github.com/BlueKurage119/wx-viewer-poc/pull/108) | #12 | 2026-09-09T21:36:49Z | 93cd7d77bd01e074e7b6856206a6d30f2dd7d075 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H035](#ad-h035), [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H067](#ad-h067), [AD-H102](#ad-h102) |
| AD-P019 | [#110 feat: 警報・注意報の現況構成ロジックを実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/110) | #13 | 2026-09-09T15:18:03Z | 4aeac2f78da727ad787e50276ad0d5f0d82c2b14 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H044](#ad-h044), [AD-H046](#ad-h046), [AD-H070](#ad-h070), [AD-H102](#ad-h102), [AD-H109](#ad-h109), [AD-H112](#ad-h112) |
| AD-P020 | [#111 feat(api): VPWP50警報等時系列を取得・正規化 (Issue #14)](https://github.com/BlueKurage119/wx-viewer-poc/pull/111) | #14 | 2026-09-09T17:24:00Z | 779d7e0c6c88225287886c177ff84ca5651c2cb1 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H048](#ad-h048), [AD-H102](#ad-h102) |
| AD-P021 | [#112 feat: 警報級の可能性（早期注意情報）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/pull/112) | #15 | 2026-09-09T21:36:49Z | 48cad166074da0c11c98e5403ccc547aa710b4eb | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H049](#ad-h049) |
| AD-P022 | [#113 feat: 会場別の予報対象定義を追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/113) | #109 | 2026-09-09T22:49:44Z | fa6b45bea8bc1006152739d89d21fbb772e925f9 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H008](#ad-h008), [AD-H014](#ad-h014), [AD-H017](#ad-h017), [AD-H018](#ad-h018), [AD-H053](#ad-h053), [AD-H102](#ad-h102) |
| AD-P023 | [#115 feat: VPFD51地域時系列予報を取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/pull/115) | #16 | 2026-09-10T12:12:59Z | fcd0c8d9f83272b5a5c219779dd495417d73abde | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H046](#ad-h046), [AD-H050](#ad-h050), [AD-H051](#ad-h051) |
| AD-P024 | [#116 feat: VPBS50（気象防災速報：線状降水帯発生・直前予測・記録的短時間大雨）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/pull/116) | #17 | 2026-09-12T13:52:14Z | 54f93a2a4fb48649f05f8a0bbae66ed224c49e37 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H036](#ad-h036), [AD-H042](#ad-h042), [AD-H045](#ad-h045), [AD-H046](#ad-h046), [AD-H047](#ad-h047), [AD-H081](#ad-h081) |
| AD-P025 | [#117 feat: Issue #18 竜巻関連電文（VPHW50/51）の取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/pull/117) | #18 | 2026-09-10T16:27:22Z | ea7ce75a1cadc7742eff33644680f989a0192962 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H042](#ad-h042), [AD-H043](#ad-h043), [AD-H045](#ad-h045), [AD-H047](#ad-h047) |
| AD-P026 | [#119 test: Issue #118 の外部サンプル依存を解消](https://github.com/BlueKurage119/wx-viewer-poc/pull/119) | #118 | 2026-09-10T21:52:09Z | 0b3cefdb74098bc3935e7c81bca2d66419fe4a38 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 0/0/0 | [AD-H055](#ad-h055), [AD-H081](#ad-h081) |
| AD-P027 | [#120 feat(api): Issue #19 アメダス最新時刻・地点データの取得・正規化](https://github.com/BlueKurage119/wx-viewer-poc/pull/120) | #19 | 2026-09-11T15:26:47Z | 595f0dfe5f8392b70246d476c7eb6271499d0509 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 2/6/8 | [AD-H008](#ad-h008), [AD-H009](#ad-h009), [AD-H052](#ad-h052), [AD-H053](#ad-h053), [AD-H054](#ad-h054), [AD-H055](#ad-h055), [AD-H082](#ad-h082), [AD-H083](#ad-h083) |
| AD-P028 | [#121 feat(api): 雨雲ナウキャストのオンデマンド取得を実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/121) | #20 | 2026-09-11T17:36:52Z | b5c549cff1a0810eb4ec7b6b7bcd2dd380960441 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H056](#ad-h056), [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H059](#ad-h059), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H084](#ad-h084), [AD-H093](#ad-h093) |
| AD-P029 | [#122 feat(api): キキクルのタイル取得を実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/122) | #21 | 2026-09-11T18:51:40Z | 8e4e9cf7baa7c923f0b6650ed61a1cccb302dfb0 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/3/4 | [AD-H056](#ad-h056), [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H085](#ad-h085), [AD-H086](#ad-h086), [AD-H093](#ad-h093) |
| AD-P030 | [#123 feat(api): 長期フィードによる初期取得・復旧処理](https://github.com/BlueKurage119/wx-viewer-poc/pull/123) | #22 | 2026-09-12T13:52:13Z | 960b7dba5ab1a5352172d2b428e89737ffde29ff | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 2/5/6 | [AD-H063](#ad-h063), [AD-H064](#ad-h064), [AD-H087](#ad-h087), [AD-H088](#ad-h088), [AD-H089](#ad-h089), [AD-H114](#ad-h114), [AD-H117](#ad-h117) |
| AD-P031 | [#124 feat: 取得失敗時の指数バックオフと再試行を実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/124) | #23 | 2026-09-11T21:59:53Z | 9d773b1520596c0b70eaef41909b4b336f7c2531 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H064](#ad-h064), [AD-H070](#ad-h070), [AD-H090](#ad-h090), [AD-H117](#ad-h117) |
| AD-P032 | [#125 feat: Issue #24 時間帯別取得周期とオンデマンド取得](https://github.com/BlueKurage119/wx-viewer-poc/pull/125) | #24 | 2026-09-12T13:52:12Z | 3cfb85c690a8f53258c477b35634c45af4ab8e33 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 4/10/14 | [AD-H008](#ad-h008), [AD-H041](#ad-h041), [AD-H061](#ad-h061), [AD-H062](#ad-h062), [AD-H064](#ad-h064), [AD-H091](#ad-h091), [AD-H092](#ad-h092), [AD-H093](#ad-h093), [AD-H094](#ad-h094), [AD-H095](#ad-h095), [AD-H096](#ad-h096), [AD-H097](#ad-h097) |
| AD-P033 | [#126 docs: 外部製造・外部レビューの対応方針を追記](https://github.com/BlueKurage119/wx-viewer-poc/pull/126) | 変更ファイルで判定 | 2026-09-12T08:43:52Z | 87c78dcd1524e354cba136beeeb12ba9cb21d65a | 対象外：外部製造/レビュー規約のみ | 全文確認済み / 1/0/0 | 該当なし |
| AD-P034 | [#127 feat: D1 通知用データモデルを追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/127) | #25 | 2026-09-12T13:52:11Z | 7a868cd4fc0ab88067f2b6cd5a7d74d5e6f58de6 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 2/4/4 | [AD-H005](#ad-h005), [AD-H024](#ad-h024), [AD-H026](#ad-h026), [AD-H066](#ad-h066), [AD-H069](#ad-h069), [AD-H098](#ad-h098), [AD-H099](#ad-h099), [AD-H111](#ad-h111) |
| AD-P035 | [#128 feat: 通知メッセージ定義の管理](https://github.com/BlueKurage119/wx-viewer-poc/pull/128) | #103 | 2026-09-12T13:51:55Z | b8a05eeb8c7e013e1587e103ddec1117e2779963 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 3/1/2 | [AD-H007](#ad-h007), [AD-H024](#ad-h024), [AD-H025](#ad-h025), [AD-H051](#ad-h051), [AD-H067](#ad-h067), [AD-H068](#ad-h068), [AD-H100](#ad-h100), [AD-H101](#ad-h101), [AD-H104](#ad-h104), [AD-H106](#ad-h106), [AD-H110](#ad-h110), [AD-H111](#ad-h111) |
| AD-P036 | [#129 feat: Issue #114 会場別の採用履歴と複数会場同時処理（C16）](https://github.com/BlueKurage119/wx-viewer-poc/pull/129) | #114 | 2026-09-12T14:25:44Z | bf7c8ef48c298d5fd3e30cd4ac0b1cdc6d28fe99 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H011](#ad-h011), [AD-H014](#ad-h014), [AD-H015](#ad-h015), [AD-H016](#ad-h016), [AD-H017](#ad-h017), [AD-H103](#ad-h103), [AD-H104](#ad-h104), [AD-H105](#ad-h105) |
| AD-P037 | [#131 D2: 通知区分判定と現況コード段階表を修正](https://github.com/BlueKurage119/wx-viewer-poc/pull/131) | #13, #26 | 2026-09-12T15:02:25Z | 7b1b7c9feecad5c8eff82cc17ca7cde971822551 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H044](#ad-h044), [AD-H046](#ad-h046), [AD-H070](#ad-h070), [AD-H102](#ad-h102), [AD-H106](#ad-h106), [AD-H109](#ad-h109), [AD-H110](#ad-h110), [AD-H112](#ad-h112) |
| AD-P038 | [#132 fix(api): jmaXmlPolling.test.ts の freshnessPolicy 重複プロパティを解消 (#130)](https://github.com/BlueKurage119/wx-viewer-poc/pull/132) | #130 | 2026-09-12T15:13:12Z | fe2dc78b07c5d262629c889a66134f604b1f95f6 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 2/0/0 | [AD-H105](#ad-h105) |
| AD-P039 | [#133 chore: ESLintがworktree配下を誤って走査しないよう除外する](https://github.com/BlueKurage119/wx-viewer-poc/pull/133) | 変更ファイルで判定 | 2026-09-12T15:36:30Z | 1c5437536e905be9310294d439dbde85b76bb1f9 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H106](#ad-h106), [AD-H107](#ad-h107) |
| AD-P040 | [#134 docs: 外部ドキュメント参照の絶対パスを相対パスへ匿名化する](https://github.com/BlueKurage119/wx-viewer-poc/pull/134) | #109, #118, #12, #13, #18, #26 | 2026-09-12T15:51:45Z | aa1a9ccc3808b858c8ce84a0503fae5a4246ead4 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H008](#ad-h008), [AD-H014](#ad-h014), [AD-H017](#ad-h017), [AD-H018](#ad-h018), [AD-H042](#ad-h042), [AD-H043](#ad-h043), [AD-H044](#ad-h044), [AD-H045](#ad-h045), [AD-H046](#ad-h046), [AD-H047](#ad-h047), [AD-H053](#ad-h053), [AD-H055](#ad-h055), [AD-H067](#ad-h067), [AD-H070](#ad-h070), [AD-H071](#ad-h071), [AD-H081](#ad-h081), [AD-H102](#ad-h102), [AD-H108](#ad-h108), [AD-H109](#ad-h109), [AD-H110](#ad-h110), [AD-H112](#ad-h112) |
| AD-P041 | [#135 feat: 警報・注意報の強化・緩和・解除時の通知生成判定ロジック (#27)](https://github.com/BlueKurage119/wx-viewer-poc/pull/135) | #27 | 2026-09-12T16:43:55Z | fa90f7b4512d06ae98add0d873b2d85f448dd551 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H037](#ad-h037), [AD-H110](#ad-h110), [AD-H120](#ad-h120) |
| AD-P042 | [#136 feat: 端末セッション識別子の発行・保持基盤を追加 (#30)](https://github.com/BlueKurage119/wx-viewer-poc/pull/136) | #30 | 2026-09-12T17:50:46Z | 075d31a0b07f7f20a7d4e121bfbea9c96b16be1a | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/0/0 | [AD-H010](#ad-h010), [AD-H012](#ad-h012), [AD-H025](#ad-h025), [AD-H114](#ad-h114) |
| AD-P043 | [#137 feat: D4 新規/継続/訂正/取消/初期取得の通知生成ルール実装 (#28)](https://github.com/BlueKurage119/wx-viewer-poc/pull/137) | #28 | 2026-09-12T18:05:00Z | 96bca5a47c1159db3cedf628827b302ddad0dec4 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H010](#ad-h010), [AD-H037](#ad-h037), [AD-H038](#ad-h038), [AD-H039](#ad-h039), [AD-H040](#ad-h040), [AD-H043](#ad-h043), [AD-H044](#ad-h044), [AD-H070](#ad-h070), [AD-H112](#ad-h112), [AD-H113](#ad-h113) |
| AD-P044 | [#138 feat: 起動時通知出力APIを実装](https://github.com/BlueKurage119/wx-viewer-poc/pull/138) | #29 | 2026-09-12T20:07:43Z | f7ab333fcea84aa96d6b5d7d5b313f58ba61bcaf | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H005](#ad-h005), [AD-H006](#ad-h006), [AD-H007](#ad-h007), [AD-H012](#ad-h012), [AD-H026](#ad-h026), [AD-H063](#ad-h063), [AD-H066](#ad-h066), [AD-H115](#ad-h115) |
| AD-P045 | [#140 docs: IssueドラフトにD9（棚卸し）タスクを追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/140) | 変更ファイルで判定 | 2026-09-13T03:09:08Z | 9b3d002e67178e078949dfc9546acce5d5e032bc | 対象外：#139自身の起票準備 | 全文確認済み / 1/0/0 | 該当なし |
| AD-P046 | [#141 feat(api): 装置異常系（取得遅延・異常）の通知判定ロジック](https://github.com/BlueKurage119/wx-viewer-poc/pull/141) | #31 | 2026-09-13T04:49:14Z | 96f00324047a0a344c92c4939c4003c271052262 | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H001](#ad-h001), [AD-H002](#ad-h002), [AD-H003](#ad-h003), [AD-H004](#ad-h004), [AD-H007](#ad-h007), [AD-H023](#ad-h023), [AD-H039](#ad-h039), [AD-H040](#ad-h040), [AD-H041](#ad-h041), [AD-H067](#ad-h067), [AD-H068](#ad-h068), [AD-H069](#ad-h069) |
| AD-P047 | [#142 test(api): 通知原因系統と検知文脈の横断確認を追加](https://github.com/BlueKurage119/wx-viewer-poc/pull/142) | #32 | 2026-09-13T05:33:36Z | 60aaf5b30b28091e3405797e599cc72c1904b6bd | 対象：A〜D実装/設計/後続修正 | 全文確認済み / 1/2/2 | [AD-H069](#ad-h069), [AD-H111](#ad-h111), [AD-H116](#ad-h116) |
| AD-P048 | [#143 docs: エージェント規律でコミット時の検査義務を緩和する](https://github.com/BlueKurage119/wx-viewer-poc/pull/143) | 変更ファイルで判定 | 2026-09-13T05:17:55Z | e7aa829bd6a0a1a62b4dc4dd5ad7e01280a269e8 | 対象外：文書検査規約のみ | 全文確認済み / 1/0/0 | 該当なし |

### 2.3 関連Issue会話（全6件）

| 原記録 | 更新日時UTC | 取得/確認 | 抽出ID |
| --- | --- | --- | --- |
| [#2 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/2#issuecomment-5582365059) | 2026-09-08T09:09:22Z | 全文確認済み | [AD-H021](#ad-h021) |
| [#76 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/76#issuecomment-5591759938) | 2026-09-08T20:57:04Z | 全文確認済み | [AD-H122](#ad-h122) |
| [#75 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/75#issuecomment-5591790017) | 2026-09-08T20:59:46Z | 全文確認済み | [AD-H121](#ad-h121) |
| [#103 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/103#issuecomment-5592456815) | 2026-09-08T22:01:35Z | 全文確認済み | [AD-H111](#ad-h111) |
| [#114 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/114#issuecomment-5609920110) | 2026-09-09T23:02:16Z | 全文確認済み | [AD-H102](#ad-h102) |
| [#31 会話](https://github.com/BlueKurage119/wx-viewer-poc/issues/31#issuecomment-5648490319) | 2026-09-12T20:27:34Z | 全文確認済み | [AD-H023](#ad-h023) |

## 3. 基本設計・ドラフトとの差分台帳

| 差分ID | 旧節 | 旧記述 | 現状/判断 | 根拠 | 処置・反映先（既決反映/未決保持） | 関連H |
| --- | --- | --- | --- | --- | --- | --- |
| AD-D001 | §3/§5.1 | 端末mode例・江東区/江戸川臨海固定 | 4端末台帳、2会場・異なる地点、XML採用会場別 | [docs/design/issue-109-venue-forecast-target-definitions.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md)<br>[docs/design/issue-29-startup-notification-api.md§1](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) | 基本設計§3/5.1・全E/G/F | AD-H008,AD-H014,AD-H015,AD-H102 |
| AD-D002 | §4.3/§9.1 | 東京ビッグサイト固定中心 | 会場mapReferenceから画面中心補正、数値zoom未測定 | [docs/design/issue-109-venue-forecast-target-definitions.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md) | F1/F6/L1 | AD-H018 |
| AD-D003 | §6.1/表定義 | SQLite等・後でschema | node:sqlite、migration0001〜0020、履歴/採用/起動監査別 | [docs/design/issue-5-sqlite-persistence.md§11](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-5-sqlite-persistence.md)<br>[docs/design/issue-6-table-definition.md§各表](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-table-definition.md)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md)<br>[docs/design/issue-29-startup-notification-api.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) | 基本設計§6.1 | AD-H032,AD-H077 |
| AD-D004 | §6.2 | 全API今後 | startup POSTのみ公開済み、E1〜E8/E10/E11未公開 | [docs/design/issue-29-startup-notification-api.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-3-common-metadata.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-3-common-metadata.md) | E9重複削除、DTO責務 | AD-H005,AD-H014 |
| AD-D005 | §6.3/§5.12 | availabilityと健全性閾値同一視・失敗全非表示案 | 別軸、stale保持、パネル表示は未決 | [docs/design/issue-4-availability-state-transition.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-4-availability-state-transition.md)<br>[docs/design/issue-24-time-based-polling-scheduler.md§5.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) | G9着手前判断 | AD-H004,AD-H070 |
| AD-D006 | §5.6/§5.12 | 竜巻取得は別途、速報一律3hのドラフト | VPHW収集済み・電文期限、通常通知は未接続 | [docs/design/issue-18-tornado-bulletin.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md)<br>[docs/design/issue-29-startup-notification-api.md§1](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) | G2/E6/D10 | AD-H007,AD-H047 |
| AD-D007 | §5.10/G6 | AQC分岐すべて見送り・湿度必須 | 5/6は欠測例外、羽田の湿度非提供 | [docs/design/issue-19-amedas-normalization.md§8/9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md) | G6/E5 | AD-H052,AD-H053 |
| AD-D008 | §5.11/G8 | 天気コード列が提供される前提 | parserは天気文字、入力と追加保存は要判断 | [docs/design/issue-16-area-time-series-forecast.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md) | E4/G8 | AD-H051 |
| AD-D009 | §7.3 | 単数targetArea・output属性と混在 | 非空targets、通知事実と解決済みoutput、二軸独立 | [docs/design/issue-25-notification-data-model.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md)<br>[docs/design/issue-103-notification-message-definitions.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-32-notification-origin.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md) | 基本設計§7.3 | AD-H024,AD-H025,AD-H111 |
| AD-D010 | §7.6 | 訂正/取消の判定未具体化 | after分類・寄与元一致訂正・取消集約fallback抑止、test非通知 | [docs/design/issue-28-warning-notification-generation-rules.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[PR #137#discussion_r3997085467](https://github.com/BlueKurage119/wx-viewer-poc/pull/137#discussion_r3997085467) | 基本設計§7.6 | AD-H038,AD-H039,AD-H110,AD-H112,AD-H113 |
| AD-D011 | §7.7/D5/L3 | 端末session単位の警報初回と読める | 世代×会場claim、202、at-most-once、専用監査 | [docs/design/issue-29-startup-notification-api.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-30-terminal-session.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md) | 基本設計§7.7/D5/E9/L3 | AD-H005,AD-H006,AD-H012,AD-H114 |
| AD-D012 | §8.1 | 閾値未確定 | 失敗2/5、経過3周期/600秒、地点経過除外 | [docs/design/issue-31-equipment-anomaly-notification.md§8/10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) | 数値を承認運用初期値として反映 | AD-H001,AD-H003,AD-H041 |
| AD-D013 | §8.3 | 夜間XML300秒、索引300/60/300 | XML/索引120/60/120で夜間停止、画像のみ要求時 | [docs/design/issue-24-time-based-polling-scheduler.md§1/5.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md) | 基本設計§8.3/K6 | AD-H061,AD-H062 |
| AD-D014 | §8.4/K9 | origin equipment相当・defaultK | weather/systemと端末台帳、生成共通・表示除外 | [docs/design/issue-32-notification-origin.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md) | K9/H2/E9 | AD-H069 |
| AD-D015 | K4/E10 | 起動時=initialと同義 | 検知initialと端末startupの履歴を分離 | [docs/design/issue-29-startup-notification-api.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-32-notification-origin.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md) | K4/E10 | AD-H025,AD-H066 |
| AD-D016 | C/D一覧・集計 | C14/D9の90件 | 既存追加枝番等5件で95、新規2件で97 | [PR #140/変更](https://github.com/BlueKurage119/wx-viewer-poc/pull/140)<br>[docs/design/issue-130-duplicate-freshness-policy.md§受入](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-130-duplicate-freshness-policy.md)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md) | 全番号保持、C17#144/D10#145末尾追加 | AD-H007,AD-H008 |
| AD-D017 | J3/J5/L4 | 取消投入と物理削除が混在、J5→L循環 | 抹消境界未決、J5をL実行前へ | [docs/design/issue-10-retention-policy.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md)<br>[docs/design/issue-28-warning-notification-generation-rules.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md) | J3/J5/L4/L6 | AD-H010 |
| AD-D018 | K2/K3 | 会話の入口分離・左右ペインが未反映 | HTTP/XML入口分離、左一覧/右本文。カナは採否未決 | [Issue #75#issuecomment-5591790017](https://github.com/BlueKurage119/wx-viewer-poc/issues/75#issuecomment-5591790017)<br>[Issue #76#issuecomment-5591759938](https://github.com/BlueKurage119/wx-viewer-poc/issues/76#issuecomment-5591759938) | K2/K3/E10 | AD-H121,AD-H122 |

## 4. 引き継ぎ台帳（原項目→管理ID）

原記録は「原出典・原項目」欄で節またはコメントへ直接辿れる。複数資料の同じ論点を統合した場合も全出典を列挙した。現在状態の根拠は基準の実装、既存テスト、後続修正commitの照合であり、Issueのcloseだけでは解消としない。

<a id="ad-h001"></a>

### AD-H001 タイルの健全性基準

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-31-equipment-anomaly-notification.md§8 タイル](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[PR #141/申し送りタイル](https://github.com/BlueKurage119/wx-viewer-poc/pull/141) |
| 原記録の要旨 | タイルの健全性基準 |
| 現在状態・解消根拠 | radar_tile/risk_tile_frame は6系列監視から除外 |
| 影響・到達条件 | オンデマンド失敗を周期閾値で測れない |
| 対応案・判断記録 | 要求数・失敗率等の採否を先に判断。既存周期基準を流用しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h002"></a>

### AD-H002 健全性監視の起動順回帰

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #141/申し送り起動順](https://github.com/BlueKurage119/wx-viewer-poc/pull/141)<br>[PR #141#discussion_r3998740636](https://github.com/BlueKurage119/wx-viewer-poc/pull/141#discussion_r3998740636) |
| 原記録の要旨 | 健全性監視の起動順回帰 |
| 現在状態・解消根拠 | f8b5036 と serverFetchHealthStartup.test.ts。scheduler.start呼出→monitor.start→await の順 |
| 影響・到達条件 | 初期取得完了待ち・suspended誤判定を検出 |
| 対応案・判断記録 | 旧本文の未対応を撤回し現テストを維持 |
| 対応先 | [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) |

<a id="ad-h003"></a>

### AD-H003 アメダス地点の検知遅れ

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-31-equipment-anomaly-notification.md§8 amedas_point](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[PR #141/申し送り50分](https://github.com/BlueKurage119/wx-viewer-poc/pull/141) |
| 原記録の要旨 | アメダス地点の検知遅れ |
| 現在状態・解消根拠 | 地点は失敗回数だけで判定。10分間隔で5失敗なら最悪50分 |
| 影響・到達条件 | latest失敗・停止を含む到達時間保証ではない |
| 対応案・判断記録 | 許容性・運用表示・別検知の要否を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h004"></a>

### AD-H004 stale画面表現と状態色

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-4-availability-state-transition.md§6 表示](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-4-availability-state-transition.md)<br>[docs/design/issue-2-common-shell.md§8.3 受信異常](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-90-semantic-colors.md§7 状態色](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-90-semantic-colors.md)<br>[PR #99/A5範囲](https://github.com/BlueKurage119/wx-viewer-poc/pull/99)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 availability](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) |
| 原記録の要旨 | stale画面表現と状態色 |
| 現在状態・解消根拠 | 3状態は共通型。§5.12の非表示案と前回値の見せ方は未決 |
| 影響・到達条件 | 前回値・正常空・未取得を混同し得る |
| 対応案・判断記録 | パネル別表示表を承認後に実装。A5対象外の状態色をここで扱う。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h005"></a>

### AD-H005 起動応答と差分配信の接続

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-29-startup-notification-api.md§10 E9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[PR #138/申し送り](https://github.com/BlueKurage119/wx-viewer-poc/pull/138)<br>[docs/design/issue-25-notification-data-model.md§7 配信](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md) |
| 原記録の要旨 | 起動応答と差分配信の接続 |
| 現在状態・解消根拠 | POST startup 実装済み。通常差分/cursor/store合流なし |
| 影響・到達条件 | 起動snapshotと差分間の欠落・二重表示 |
| 対応案・判断記録 | snapshot/sequence・cursor・共通store・再試行を設計 |
| 対応先 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) |

<a id="ad-h006"></a>

### AD-H006 起動問い合わせの再試行

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-29-startup-notification-api.md§10 202/通信失敗](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[PR #138/申し送り](https://github.com/BlueKurage119/wx-viewer-poc/pull/138) |
| 原記録の要旨 | 起動問い合わせの再試行 |
| 現在状態・解消根拠 | webの初回呼出しは202/通信失敗後に自動再試行しない |
| 影響・到達条件 | 初期取得待ちの画面が応答へ合流しない |
| 対応案・判断記録 | 同一session維持、再試行間隔・打切り・失敗表示を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) |

<a id="ad-h007"></a>

### AD-H007 system・竜巻の起動通知と速報通常通知

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-29-startup-notification-api.md§1 対象外](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 D5](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[docs/design/issue-103-notification-message-definitions.md§8 速報5種](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[PR #141/申し送り最大6](https://github.com/BlueKurage119/wx-viewer-poc/pull/141) |
| 原記録の要旨 | system・竜巻の起動通知と速報通常通知 |
| 現在状態・解消根拠 | startupはweather・warning_current/VPBS50の3tagのみ。VPHW収集は実装済み、速報通常通知生成器なし |
| 影響・到達条件 | D7の最大6system通知は履歴の契約でstartup現仕様でない |
| 対応案・判断記録 | 生成/起動再提示の対象・期限・重複単位を別設計。E9で黙って追加しない |
| 対応先 | [D10 #145](https://github.com/BlueKurage119/wx-viewer-poc/issues/145)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) |

<a id="ad-h008"></a>

### AD-H008 複数会場アメダス収集

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-19-amedas-normalization.md§8 複数会場](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[docs/design/issue-24-time-based-polling-scheduler.md§1 対象外](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md)<br>[docs/design/issue-109-venue-forecast-target-definitions.md§8 同時処理](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md) |
| 原記録の要旨 | 複数会場アメダス収集 |
| 現在状態・解消根拠 | createScheduledAdapters は既定eastの1 state。XMLだけ両会場接続済み |
| 影響・到達条件 | 羽田の定期観測が未取得 |
| 対応案・判断記録 | 最新時刻共有・地点状態分離を設計してC17で接続 |
| 対応先 | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h009"></a>

### AD-H009 起動時アメダスbackfill採否

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-19-amedas-normalization.md§8 保持幅](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[PR #120#discussion_r3990306849](https://github.com/BlueKurage119/wx-viewer-poc/pull/120#discussion_r3990306849) |
| 原記録の要旨 | 起動時アメダスbackfill採否 |
| 現在状態・解消根拠 | backfillBlocks 0〜8の取得は実装済み(r3990409715)。既定schedulerは採用しない |
| 影響・到達条件 | 起動直後24時間グラフが揃う保証なし |
| 対応案・判断記録 | 採用範囲・負荷をC17で判断。表示は取得済み範囲のみ。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h010"></a>

### AD-H010 訓練の取消と物理削除の境界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-10-retention-policy.md§8 訓練](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md)<br>[docs/design/issue-28-warning-notification-generation-rules.md§10 取消](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[docs/design/issue-30-terminal-session.md§8 保持](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md) |
| 原記録の要旨 | 訓練の取消と物理削除の境界 |
| 現在状態・解消根拠 | J3取消投入とJ5/L4物理削除記述は同義でない |
| 影響・到達条件 | 本番・履歴・sessionの消去範囲に影響 |
| 対応案・判断記録 | 管理単位・権限・保持対象をJ3設計前に判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71)、[J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) |

<a id="ad-h011"></a>

### AD-H011 受信原文・履歴の容量

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-5-sqlite-persistence.md§12 保持量](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-5-sqlite-persistence.md)<br>[docs/design/issue-6-info-type-schema.md§9 速報保持](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md)<br>[docs/design/issue-7-reception-history.md§9 原文](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[docs/design/issue-10-retention-policy.md§8 容量](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md)<br>[PR #102/VPWS50 4.36MiB](https://github.com/BlueKurage119/wx-viewer-poc/pull/102)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§9 採用行数](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md) |
| 原記録の要旨 | 受信原文・履歴の容量 |
| 現在状態・解消根拠 | 自動削除なし。受信毎最大会場数の採用行、CASCADEは親削除時のみ |
| 影響・到達条件 | 長期運転でDB増大。4.36MiBは1電文例で全量推定でない |
| 対応案・判断記録 | 実運用量をL2で測り、圧縮/選別/削除は別承認。表示期間で削除しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76) |

<a id="ad-h012"></a>

### AD-H012 session・startup監査の無期限保持

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-29-startup-notification-api.md§11 容量](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-30-terminal-session.md§8 保持](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md) |
| 原記録の要旨 | session・startup監査の無期限保持 |
| 現在状態・解消根拠 | terminal_sessionとstartup応答JSONに自動期限なし |
| 影響・到達条件 | 削除すれば継続判定が変化 |
| 対応案・判断記録 | 容量と運用初期化の採否を確認。自動削除を追加しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) |

<a id="ad-h013"></a>

### AD-H013 手動DB初期化の運用

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-10-retention-policy.md§8 手動削除](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md)<br>[docs/design/issue-7-reception-history.md§12 B6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[PR #101/削除](https://github.com/BlueKurage119/wx-viewer-poc/pull/101)<br>[PR #102/B6](https://github.com/BlueKurage119/wx-viewer-poc/pull/102) |
| 原記録の要旨 | 手動DB初期化の運用 |
| 現在状態・解消根拠 | B6はアプリ内削除機能を追加しない方針に変更済み |
| 影響・到達条件 | 停止/バックアップ/対象選択なしの削除は不可 |
| 対応案・判断記録 | 運用手順の要否・対象・承認を判断。旧削除API申し送りは採用しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43) |

<a id="ad-h014"></a>

### AD-H014 会場別REST境界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-109-venue-forecast-target-definitions.md§7 API](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§9 E/G](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md)<br>[PR #129/API](https://github.com/BlueKurage119/wx-viewer-poc/pull/129)<br>[docs/design/issue-3-common-metadata.md§7 API](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-3-common-metadata.md) |
| 原記録の要旨 | 会場別REST境界 |
| 現在状態・解消根拠 | venueWeatherServiceとstartup端末解決あり。E1〜E8 HTTPなし |
| 影響・到達条件 | 任意会場入力・DB型直接公開を避ける必要 |
| 対応案・判断記録 | 端末台帳での解決、normal明示、DTO/null/時刻検証を先に設計。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) |

<a id="ad-h015"></a>

### AD-H015 C7採用判定の会場精度

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-114-venue-scoped-adoption-history.md§10-1](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md)<br>[PR #129/C7会場別化](https://github.com/BlueKurage119/wx-viewer-poc/pull/129) |
| 原記録の要旨 | C7採用判定の会場精度 |
| 現在状態・解消根拠 | C7和集合判定を全会場採用行へ複製。表示抽出は会場別 |
| 影響・到達条件 | 片会場にだけ該当する電文の採用理由は会場厳密でない |
| 対応案・判断記録 | 採用監査精度をE6/K3で判断、必要ならevent保存1件のまま採用だけ分離。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h016"></a>

### AD-H016 会場追加の不変条件

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-114-venue-scoped-adoption-history.md§9 会場追加](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md)<br>[PR #129/追加4点](https://github.com/BlueKurage119/wx-viewer-poc/pull/129) |
| 原記録の要旨 | 会場追加の不変条件 |
| 現在状態・解消根拠 | municipalCode相異・広域対象一致をtests/resolveSharedで表明 |
| 影響・到達条件 | 同一区域2会場・異なる広域対象追加は現前提外 |
| 対応案・判断記録 | 定義/IDs/CHECK migration/不変条件を同時変更する設計が必要 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33) |

<a id="ad-h017"></a>

### AD-H017 会場の実電文と実負荷

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-109-venue-forecast-target-definitions.md§8 TRC](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md)<br>[docs/design/issue-114-venue-scoped-adoption-history.md§10 実電文/性能](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-114-venue-scoped-adoption-history.md) |
| 原記録の要旨 | 会場の実電文と実負荷 |
| 現在状態・解消根拠 | 区域対応は確認済み、TRCの各対象実電文・全cycle負荷は未確認 |
| 影響・到達条件 | 合成parse 7.4〜9.4msを運用性能保証にできない |
| 対応案・判断記録 | 入手済み実例と合成を区別しL2で確認。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) |

<a id="ad-h018"></a>

### AD-H018 会場中心・画角と背景地図

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§9.5 中心](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-109-venue-forecast-target-definitions.md§7 F1/F6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md)<br>[docs/design/issue-6-info-type-schema.md§8 zoom](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md) |
| 原記録の要旨 | 会場中心・画角と背景地図 |
| 現在状態・解消根拠 | mapReference確定、画面中心補正/ズーム実測なし |
| 影響・到達条件 | 地図寸法・パネル遮蔽で会場位置がずれる |
| 対応案・判断記録 | 会場別中心補正と戻る操作、背景提供元条件/zoomを実画面確認。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [F1 #44](https://github.com/BlueKurage119/wx-viewer-poc/issues/44)、[F6 #49](https://github.com/BlueKurage119/wx-viewer-poc/issues/49)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h019"></a>

### AD-H019 主解像度・小画面と拡大率

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§9.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-2-common-shell.md§11.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md) |
| 原記録の要旨 | 主解像度・小画面と拡大率 |
| 現在状態・解消根拠 | 共通shellは試作、主解像度/拡大率未確定 |
| 影響・到達条件 | 表示切れと通知操作に影響 |
| 対応案・判断記録 | 対象PCの条件を決めて実寸確認。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [G1 #52](https://github.com/BlueKurage119/wx-viewer-poc/issues/52)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) |

<a id="ad-h020"></a>

### AD-H020 レベル5と非常色の実UI視認性

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-90-semantic-colors.md§7 G3/H](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-90-semantic-colors.md)<br>[PR #96/後続色](https://github.com/BlueKurage119/wx-viewer-poc/pull/96)<br>[docs/design/issue-2-common-shell.md§11.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md) |
| 原記録の要旨 | レベル5と非常色の実UI視認性 |
| 現在状態・解消根拠 | semantic token実装・色見本目視済み。レベル5縁必須、非常outlineは面に使わない |
| 影響・到達条件 | 小バッジと同時通知の識別未検証、level4紫との近さ |
| 対応案・判断記録 | 実UIで1px以上の縁/文字/色の組合せを確認。CAM16距離を弁別保証にしない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[G11 #62](https://github.com/BlueKurage119/wx-viewer-poc/issues/62)、[H1 #63](https://github.com/BlueKurage119/wx-viewer-poc/issues/63)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) |

<a id="ad-h021"></a>

### AD-H021 未対応件数・既読・再通知の単位

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§8.3 未対応/既読](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-2-common-shell.md§8.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-2-common-shell.md§9.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-2-common-shell.md§11.1](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[Issue #2#issuecomment-5582365059/通知](https://github.com/BlueKurage119/wx-viewer-poc/issues/2#issuecomment-5582365059) |
| 原記録の要旨 | 未対応件数・既読・再通知の単位 |
| 現在状態・解消根拠 | shellはfixtureと未接続callback。実事象/担当範囲/再通知期限は未決 |
| 影響・到達条件 | 件数合算・確認/対応中・新着の意味が変わる |
| 対応案・判断記録 | 端末内の表示単位・期限・繰返し・スヌーズ競合を決定。複数端末正本は本番別途。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[H3 #65](https://github.com/BlueKurage119/wx-viewer-poc/issues/65)、[H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) |

<a id="ad-h022"></a>

### AD-H022 ブラウザ疎通異常

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§8.3 通信](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-2-common-shell.md§11.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md) |
| 原記録の要旨 | ブラウザ疎通異常 |
| 現在状態・解消根拠 | 受信異常banner試作。成功対象・部分失敗・復帰条件未設計 |
| 影響・到達条件 | サーバ上流健全性とブラウザ接続を混同し得る |
| 対応案・判断記録 | UI更新失敗の契約を別に定め、最終表示時刻を示す。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) |

<a id="ad-h023"></a>

### AD-H023 問いかけ・操作結果の同時表示

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§11.1 遷移](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 件数](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[PR #141/最大6](https://github.com/BlueKurage119/wx-viewer-poc/pull/141)<br>[Issue #31#issuecomment-5648490319](https://github.com/BlueKurage119/wx-viewer-poc/issues/31#issuecomment-5648490319) |
| 原記録の要旨 | 問いかけ・操作結果の同時表示 |
| 現在状態・解消根拠 | 同時systemは最大6件、shell選択と本データ未接続 |
| 影響・到達条件 | 問いかけ中の強制切替/操作結果上書き |
| 対応案・判断記録 | 優先順位と操作導線を決め、IDで保持。データを区分だけで1件化しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) |

<a id="ad-h024"></a>

### AD-H024 通知表示3要素の復元

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-103-notification-message-definitions.md§8 表示](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-8-notification-output-history.md§8 summary](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md)<br>[docs/design/issue-25-notification-data-model.md§7 output](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md) |
| 原記録の要旨 | 通知表示3要素の復元 |
| 現在状態・解消根拠 | resolverはタイトル/対象/詳細とoutput、B4は確定summaryと定義識別を保存 |
| 影響・到達条件 | summary再解析/現レジストリだけ再解決では過去内容が変わる |
| 対応案・判断記録 | E9の配信スナップショット契約を定めてからH接続。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) |

<a id="ad-h025"></a>

### AD-H025 通知確認状態と履歴

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-8-notification-output-history.md§8 ack](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md)<br>[docs/design/issue-103-notification-message-definitions.md§8 action](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-30-terminal-session.md§8 session](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md) |
| 原記録の要旨 | 通知確認状態と履歴 |
| 現在状態・解消根拠 | ackRequiredは確認要否、確認済みではない。D6sessionはreload維持 |
| 影響・到達条件 | B4を端末の確認履歴と見なすと意味が変わる |
| 対応案・判断記録 | 確認は端末内だけ。reload時resetとsession継続を別に検証 |
| 対応先 | [H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) |

<a id="ad-h026"></a>

### AD-H026 本番端末調停・認証・配信移行

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 対象外 |
| 原出典・原項目 | [docs/design/issue-1-project-initialization.md§3.10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-1-project-initialization.md)<br>[docs/design/issue-2-common-shell.md§6.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-25-notification-data-model.md§7 H調停](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md)<br>[docs/design/issue-29-startup-notification-api.md§11 複数instance](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md)<br>[docs/design/issue-9-operation-history.md§8 actor](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-9-operation-history.md) |
| 原記録の要旨 | 本番端末調停・認証・配信移行 |
| 現在状態・解消根拠 | 本PoCは単独REST、session IDは認証でない。AuthGate/共有世代/Firestoreは移植時 |
| 影響・到達条件 | 多instance初回出力・権限・鳴動担当は未定義 |
| 対応案・判断記録 | PoCの表示モードを認可に使わず、本番統合時に再設計 |
| 対応先 | [L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) |

<a id="ad-h027"></a>

### AD-H027 本番配信と404/Node要件

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-1-project-initialization.md§3.2/3.10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-1-project-initialization.md)<br>[docs/design/issue-2-common-shell.md§6.2/11.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md) |
| 原記録の要旨 | 本番配信と404/Node要件 |
| 現在状態・解消根拠 | dev shell/404処理あり、本番配信構成未検証 |
| 影響・到達条件 | deep linkやNode版不一致 |
| 対応案・判断記録 | 採用環境でNode条件・同一origin・登録/未登録pathを確認 |
| 対応先 | [L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h028"></a>

### AD-H028 DB並行性と長時間query

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-5-sqlite-persistence.md§12 将来運用](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-5-sqlite-persistence.md) |
| 原記録の要旨 | DB並行性と長時間query |
| 現在状態・解消根拠 | 同期node:sqlite、WAL/busy設計。複数processは対象外 |
| 影響・到達条件 | 大量queryでevent loop遅延 |
| 対応案・判断記録 | 実負荷測定後worker/外部DB等の採否判断。予防改修を必須にしない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h029"></a>

### AD-H029 migrationコメント誤検出

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #100#issuecomment-5590509293](https://github.com/BlueKurage119/wx-viewer-poc/pull/100#issuecomment-5590509293) |
| 原記録の要旨 | migrationコメント誤検出 |
| 現在状態・解消根拠 | migrations.ts transactionControl正規表現はSQL lexerでない |
| 影響・到達条件 | 将来migrationコメントの形による誤検知、既存正常運転は非該当 |
| 対応案・判断記録 | 採否待ち。再現時に対応要否を判断。現在migrationを書き換えない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h030"></a>

### AD-H030 warning時系列の一意制約

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #101#issuecomment-5591100783/項目1](https://github.com/BlueKurage119/wx-viewer-poc/pull/101#issuecomment-5591100783) |
| 原記録の要旨 | warning時系列の一意制約 |
| 現在状態・解消根拠 | migration0014のvalue表に当該自然キーUNIQUEなし |
| 影響・到達条件 | 将来二重挿入誤用時。現パーサ処理の直ちの欠陥とはしない |
| 対応案・判断記録 | 採否待ち。L2で到達性を確認後に制約要否判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34) |

<a id="ad-h031"></a>

### AD-H031 複合FKの直接回帰

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #101#issuecomment-5591100783/項目3](https://github.com/BlueKurage119/wx-viewer-poc/pull/101#issuecomment-5591100783) |
| 原記録の要旨 | 複合FKの直接回帰 |
| 現在状態・解消根拠 | schema test6は代表FK、複合FKはDDLに存在 |
| 影響・到達条件 | 将来migration退行の検出粒度 |
| 対応案・判断記録 | 採否待ち。検収で複合参照負例の追加要否を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h032"></a>

### AD-H032 DDL参照文書の陳腐化

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-6-table-definition.md§冒頭/各表](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-table-definition.md)<br>[PR #101#issuecomment-5591100783/項目2](https://github.com/BlueKurage119/wx-viewer-poc/pull/101#issuecomment-5591100783) |
| 原記録の要旨 | DDL参照文書の陳腐化 |
| 現在状態・解消根拠 | 当時のDDL一覧とmigration0013〜0020に差。実行DDLを正とする |
| 影響・到達条件 | 古い文書から新DBを生成すると欠落 |
| 対応案・判断記録 | 旧記録を維持し本監査へ差分集約。今後自動生成の採否判断 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h033"></a>

### AD-H033 redirect先のdomain検証

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #107#issuecomment-5599959386/項目1](https://github.com/BlueKurage119/wx-viewer-poc/pull/107#issuecomment-5599959386) |
| 原記録の要旨 | redirect先のdomain検証 |
| 現在状態・解消根拠 | performHttpGetはfetch自動redirectに従い最終URL未検証 |
| 影響・到達条件 | 上流redirect変更時。固定URL通常利用の実害未確認 |
| 対応案・判断記録 | 採否待ち。必要時に最終URL制限採否を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h034"></a>

### AD-H034 二重timeoutの簡素化

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #107#issuecomment-5599959386/項目2](https://github.com/BlueKurage119/wx-viewer-poc/pull/107#issuecomment-5599959386) |
| 原記録の要旨 | 二重timeoutの簡素化 |
| 現在状態・解消根拠 | httpGet.tsはcontrollerタイマーとAbortSignal.timeout併用、finally clear |
| 影響・到達条件 | 動作害のない保守論点 |
| 対応案・判断記録 | 採否待ち。取得挙動変更時のみ整理要否を検討。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h035"></a>

### AD-H035 ParsedIssuedWarningKind冗長宣言

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #108#issuecomment-5599939998/dateTime](https://github.com/BlueKurage119/wx-viewer-poc/pull/108#issuecomment-5599939998) |
| 原記録の要旨 | ParsedIssuedWarningKind冗長宣言 |
| 現在状態・解消根拠 | repositories/types.tsの基底と派生の型宣言を参照 |
| 影響・到達条件 | 型上の冗長で通常挙動への影響なし |
| 対応案・判断記録 | 採否待ち。型改定時に整理要否判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h036"></a>

### AD-H036 区域dedupの変異未検出

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #116/申し送りdedup](https://github.com/BlueKurage119/wx-viewer-poc/pull/116) |
| 原記録の要旨 | 区域dedupの変異未検出 |
| 現在状態・解消根拠 | codeTypeを除く変異がSURVIVED、実装は複合比較 |
| 影響・到達条件 | 現在の異桁コードでは低頻度、体系追加時に影響 |
| 対応案・判断記録 | 採否待ち。コード体系追加時に衝突例のテスト要否判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) |

<a id="ad-h037"></a>

### AD-H037 テストTSの型検査対象

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [docs/design/issue-27-warning-state-change-notification-decision.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-27-warning-state-change-notification-decision.md)<br>[docs/design/issue-28-warning-notification-generation-rules.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md) |
| 原記録の要旨 | テストTSの型検査対象 |
| 現在状態・解消根拠 | apps/api/tsconfig.json includeはsrcのみ、testはtsx実行 |
| 影響・到達条件 | tests内の静的型不備をtypecheckで検知しない |
| 対応案・判断記録 | 採否待ち。将来のテスト保守時に専用設定の採否を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) |

<a id="ad-h038"></a>

### AD-H038 取消とbaselineの等時刻テスト

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [PR #137/申し送り等時刻](https://github.com/BlueKurage119/wx-viewer-poc/pull/137) |
| 原記録の要旨 | 取消とbaselineの等時刻テスト |
| 現在状態・解消根拠 | reducerの>=取消優先は実装済み。前後2例、等値専用例なし |
| 影響・到達条件 | 等時刻境界の将来退行 |
| 対応案・判断記録 | 採否待ち。L3で境界テスト追加の採否を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) |

<a id="ad-h039"></a>

### AD-H039 通知保存失敗時の回復保証

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 未決 |
| 原出典・原項目 | [docs/design/issue-28-warning-notification-generation-rules.md§10 別transaction](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§10 保存失敗](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) |
| 原記録の要旨 | 通知保存失敗時の回復保証 |
| 現在状態・解消根拠 | D4はC3後に別transaction、失敗後tracker完了。D7も保存失敗後statecommit |
| 影響・到達条件 | DB障害/間のcrashで通知喪失、同版再試行保証なし |
| 対応案・判断記録 | 採否待ち。L3で運用影響を判断し、必要時に配信保証の別設計。今回outboxを追加しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) |

<a id="ad-h040"></a>

### AD-H040 通知skip・保存失敗の監視

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-28-warning-notification-generation-rules.md§10 skip](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 エラー](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) |
| 原記録の要旨 | 通知skip・保存失敗の監視 |
| 現在状態・解消根拠 | warn/errorログと戻り値あり、監視APIへの接続なし |
| 影響・到達条件 | 判定不能1件を落として他現象継続するがUIには未反映 |
| 対応案・判断記録 | 処理エラーとして公開する範囲・安全な診断を設計 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80)、[K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81) |

<a id="ad-h041"></a>

### AD-H041 健全性評価の運用初期値・境界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 残留リスク / 確認待ち |
| 原出典・原項目 | [docs/design/issue-31-equipment-anomaly-notification.md§10 周期/時計/scan](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[docs/design/issue-24-time-based-polling-scheduler.md§5.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md) |
| 原記録の要旨 | 健全性評価の運用初期値・境界 |
| 現在状態・解消根拠 | 評価30秒/scan50、時刻開始基準、activeSinceによる経過resetは承認設計 |
| 影響・到達条件 | 未来時刻・最大1評価周期差・scan上限を性能保証にしない |
| 対応案・判断記録 | 測定結果と評価時刻を表示。flapping抑止の追加は採否待ち。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h042"></a>

### AD-H042 実XMLの未観測形

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-12-warning-xml-parser.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-12-warning-xml-parser.md)<br>[docs/design/issue-14-warning-timeseries.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-14-warning-timeseries.md)<br>[docs/design/issue-15-early-warning.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-15-early-warning.md)<br>[docs/design/issue-16-area-time-series-forecast.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md)<br>[docs/design/issue-17-bosai-bulletin.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-17-bosai-bulletin.md)<br>[docs/design/issue-18-tornado-bulletin.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md)<br>[docs/design/issue-7-reception-history.md§12](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md) |
| 原記録の要旨 | 実XMLの未観測形 |
| 現在状態・解消根拠 | 実訂正/取消/訓練/試験や地域固有例は種別ごとに未確認。合成testあり |
| 影響・到達条件 | 合成から提供仕様を確定できない |
| 対応案・判断記録 | L2の種別別実例台帳で確認。入手できないものは未確認を維持。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) |

<a id="ad-h043"></a>

### AD-H043 取消本文/EventID/Serial

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-28-warning-notification-generation-rules.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[PR #137/取消実データ](https://github.com/BlueKurage119/wx-viewer-poc/pull/137)<br>[docs/design/issue-18-tornado-bulletin.md§8 取消区域](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md) |
| 原記録の要旨 | 取消本文/EventID/Serial |
| 現在状態・解消根拠 | 警報取消本文Kindは読まない。VPHW区域無し取消は独立行で既存を消せない |
| 影響・到達条件 | 解除対象の推定や旧現況再有効化は危険 |
| 対応案・判断記録 | 原文入手後に対応する取消範囲を検証、J3合成は実例と区別。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) |

<a id="ad-h044"></a>

### AD-H044 C3洪水04/18非採用

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-26-notification-category-classifier.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-26-notification-category-classifier.md)<br>[docs/design/issue-28-warning-notification-generation-rules.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md)<br>[PR #137/洪水](https://github.com/BlueKurage119/wx-viewer-poc/pull/137)<br>[docs/design/issue-13-warning-current-state.md§10 河川](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md) |
| 原記録の要旨 | C3洪水04/18非採用 |
| 現在状態・解消根拠 | 通知分類36コードに対し現況34。04/18は現況から通知へ到達しない |
| 影響・到達条件 | 公式分類対応と取得対応を混同し得る |
| 対応案・判断記録 | 採用対象/電文と河川情報範囲を確認。コードだけ足さない |
| 対応先 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) |

<a id="ad-h045"></a>

### AD-H045 未知XML構造の継続確認

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-12-warning-xml-parser.md§9 名称不一致](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-12-warning-xml-parser.md)<br>[docs/design/issue-14-warning-timeseries.md§10 複数Infos](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-14-warning-timeseries.md)<br>[docs/design/issue-15-early-warning.md§9 複数TSI](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-15-early-warning.md)<br>[docs/design/issue-16-area-time-series-forecast.md§9 新要素](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md)<br>[docs/design/issue-17-bosai-bulletin.md§10 EventID](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-17-bosai-bulletin.md)<br>[docs/design/issue-18-tornado-bulletin.md§8 Information](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md) |
| 原記録の要旨 | 未知XML構造の継続確認 |
| 現在状態・解消根拠 | 厳密parserは未知形を採用しない。名称不一致・複数block等は未確定 |
| 影響・到達条件 | 新提供形を低い値へfallbackできない |
| 対応案・判断記録 | 原文/理由を監視へ、追加採用前に公式/実例と照合。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h046"></a>

### AD-H046 XML明細の未抽出項目

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-13-warning-current-state.md§10 Property/Addition](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md)<br>[docs/design/issue-16-area-time-series-forecast.md§9 WindSpeedLevel](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md)<br>[docs/design/issue-17-bosai-bulletin.md§10 官署/AreaStatus/Serial](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-17-bosai-bulletin.md) |
| 原記録の要旨 | XML明細の未抽出項目 |
| 現在状態・解消根拠 | 警報補足は断片、attention等はnull。風範囲/速報官署等は専用列なし |
| 影響・到達条件 | G2/G3/G7が元Issueの表示項目をそのまま供給できない |
| 対応案・判断記録 | 各Eで表示必須項目と保存追加の必要性を設計。未取得を補完しない |
| 対応先 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) |

<a id="ad-h047"></a>

### AD-H047 速報の期限・重複・区域表現

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-6-info-type-schema.md§8 期限](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md)<br>[docs/design/issue-17-bosai-bulletin.md§8/10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-17-bosai-bulletin.md)<br>[docs/design/issue-18-tornado-bulletin.md§8 VPHW](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-18-tornado-bulletin.md) |
| 原記録の要旨 | 速報の期限・重複・区域表現 |
| 現在状態・解消根拠 | VPBSは発表3h、VPHWは電文期限。合成event_idはJMA EventIDでない |
| 影響・到達条件 | 一律3h・VPHW50/51重複・目撃区域精度の誤表示 |
| 対応案・判断記録 | 型と期限を区別し、重複表示と取消行・付近の表現を先に判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h048"></a>

### AD-H048 警報等時系列のDTO/量的予想

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-14-warning-timeseries.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-14-warning-timeseries.md)<br>[PR #111/申し送り](https://github.com/BlueKurage119/wx-viewer-poc/pull/111) |
| 原記録の要旨 | 警報等時系列のDTO/量的予想 |
| 現在状態・解消根拠 | warning_timeseries_*にblock/ref/区間/単位/区域区分を保持 |
| 影響・到達条件 | 添字結合や固定現象で誤表示 |
| 対応案・判断記録 | 時刻定義の参照関係をDTOで維持し現在区間・凡例・詳細を実装 |
| 対応先 | [E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[G4 #55](https://github.com/BlueKurage119/wx-viewer-poc/issues/55)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h049"></a>

### AD-H049 早期注意の二表・日界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-15-early-warning.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-15-early-warning.md)<br>[PR #112/範囲](https://github.com/BlueKurage119/wx-viewer-poc/pull/112) |
| 原記録の要旨 | 早期注意の二表・日界 |
| 現在状態・解消根拠 | near/far独立、far明後日以前をJST除外。3状態遷移そのものは未結線 |
| 影響・到達条件 | なし/値なし/未取得・分類の異なる現象を混同 |
| 対応案・判断記録 | 2表と各発表時刻を維持し共通現象だけ詳細結合 |
| 対応先 | [E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[G5 #56](https://github.com/BlueKurage119/wx-viewer-poc/issues/56)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h050"></a>

### AD-H050 地域時系列の区間と時点

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-16-area-time-series-forecast.md§7/9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md)<br>[PR #115/申し送り](https://github.com/BlueKurage119/wx-viewer-poc/pull/115) |
| 原記録の要旨 | 地域時系列の区間と時点 |
| 現在状態・解消根拠 | blockId/refIdと区間・時点を保存 |
| 影響・到達条件 | 配列添字結合や風速実数補間は不可 |
| 対応案・判断記録 | 時間軸参照で結合し階級と範囲を確認 |
| 対応先 | [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) |

<a id="ad-h051"></a>

### AD-H051 天気アイコンの入力境界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-16-area-time-series-forecast.md§9 天気](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-16-area-time-series-forecast.md)<br>[docs/design/issue-103-notification-message-definitions.md§8 表示](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md) |
| 原記録の要旨 | 天気アイコンの入力境界 |
| 現在状態・解消根拠 | VPFD51正規化は天気文字を保持、独立した天気コード列なし |
| 影響・到達条件 | G8旧『天気コード対応』は入力が不足 |
| 対応案・判断記録 | 公式と実電文で対応単位を決め、文字代替を含める。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[G8 #59](https://github.com/BlueKurage119/wx-viewer-poc/issues/59)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) |

<a id="ad-h052"></a>

### AD-H052 アメダスAQC非0・旧推計値

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-19-amedas-normalization.md§9 AQC/旧DB](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[docs/design/issue-6-info-type-schema.md§8 AQC](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md) |
| 原記録の要旨 | アメダスAQC非0・旧推計値 |
| 現在状態・解消根拠 | 5/6はnull、その他区別しない。isEstimated要素別、旧DBdefault0 |
| 影響・到達条件 | 実AQC5/6数値例なし、過去推計値は遡及復元されない |
| 対応案・判断記録 | raw保持要否と実例を確認、仕様推定で補正しない。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h053"></a>

### AD-H053 アメダス要素と地点表変更

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-19-amedas-normalization.md§8/9 elems](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[docs/design/issue-109-venue-forecast-target-definitions.md§7 C9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md) |
| 原記録の要旨 | アメダス要素と地点表変更 |
| 現在状態・解消根拠 | 羽田湿度非提供。elemsと観測項目別に未提供を区別 |
| 影響・到達条件 | 地点表更新の自動追随なし、未知elemsを観測扱いの前提 |
| 対応案・判断記録 | 地点表変更検知・気温風ゼロ地点・極値所属を追加時に確認。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h054"></a>

### AD-H054 アメダス風向/極値日界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-19-amedas-normalization.md§9 風向/極値](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[docs/design/issue-6-info-type-schema.md§8 日界](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md) |
| 原記録の要旨 | アメダス風向/極値日界 |
| 現在状態・解消根拠 | 公式対応と極値の日境界の実検証未完了 |
| 影響・到達条件 | 独自方位変換・日集計で誤り得る |
| 対応案・判断記録 | 採用表示前に公式/実例で確認。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h055"></a>

### AD-H055 アメダス取得資料とfixture来歴

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-118-self-contained-test-fixtures.md§後続](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-118-self-contained-test-fixtures.md)<br>[docs/design/issue-19-amedas-normalization.md§9 実block](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-19-amedas-normalization.md)<br>[PR #120#discussion_r3990306857](https://github.com/BlueKurage119/wx-viewer-poc/pull/120#discussion_r3990306857) |
| 原記録の要旨 | アメダス取得資料とfixture来歴 |
| 現在状態・解消根拠 | r3990410190により44136/44166をderivedに訂正、manifestに加工/SHA記載 |
| 影響・到達条件 | 加工済みを取得原文と主張しない |
| 対応案・判断記録 | 今後もoriginal/derived/syntheticを保持。積雪/気圧は取得レポート旧記述と区別 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[J1 #69](https://github.com/BlueKurage119/wx-viewer-poc/issues/69) |

<a id="ad-h056"></a>

### AD-H056 タイルキャッシュ公開境界

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§9 E7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[docs/design/issue-21-kikikuru-tiles.md§8 E8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[PR #121/引継ぎ](https://github.com/BlueKurage119/wx-viewer-poc/pull/121) |
| 原記録の要旨 | タイルキャッシュ公開境界 |
| 現在状態・解消根拠 | サービスでPNG検証/原子的保存、pathは内部値 |
| 影響・到達条件 | 未検証path公開や任意上流URL受付は契約外 |
| 対応案・判断記録 | 共用サービスから検証済み画像だけ配信。DB ID/pathを公開しない |
| 対応先 | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) |

<a id="ad-h057"></a>

### AD-H057 タイルの選択・部分欠け

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§9 F](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[docs/design/issue-21-kikikuru-tiles.md§8 F](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[PR #121/引継ぎ](https://github.com/BlueKurage119/wx-viewer-poc/pull/121) |
| 原記録の要旨 | タイルの選択・部分欠け |
| 現在状態・解消根拠 | N1/N2/3layer別catalogと座標別結果あり |
| 影響・到達条件 | 同valid候補選択・実在XYZ・窓外保持が未決 |
| 対応案・判断記録 | Fで候補/再生中固定一覧/欠け/前回時刻を決める。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[F4 #47](https://github.com/BlueKurage119/wx-viewer-poc/issues/47)、[F7 #50](https://github.com/BlueKurage119/wx-viewer-poc/issues/50)、[F8 #51](https://github.com/BlueKurage119/wx-viewer-poc/issues/51) |

<a id="ad-h058"></a>

### AD-H058 PNG完全decode・位置/凡例

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未確認・実機待ち / 確認待ち |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[docs/design/issue-21-kikikuru-tiles.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[docs/design/issue-6-info-type-schema.md§8 PNG](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md) |
| 原記録の要旨 | PNG完全decode・位置/凡例 |
| 現在状態・解消根拠 | 署名等の検証はあるが完全decode/CRC保証なし、z10外未実測 |
| 影響・到達条件 | 完全画像健全性と地理的重ね合わせ未検証 |
| 対応案・判断記録 | Fで配色/位置/zoom/凡例を実画面確認。追加検証は採否判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[F5 #48](https://github.com/BlueKurage119/wx-viewer-poc/issues/48)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h059"></a>

### AD-H059 キャッシュ容量・LRU・性能

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[PR #121/引継ぎ](https://github.com/BlueKurage119/wx-viewer-poc/pull/121) |
| 原記録の要旨 | キャッシュ容量・LRU・性能 |
| 現在状態・解消根拠 | 孤児清掃あり、容量上限/LRU/複数process共有なし |
| 影響・到達条件 | 長期stale参照や低速HTTPで容量/待ち時間増大 |
| 対応案・判断記録 | L2で実測し要否判断、複数processは本番別途。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) |

<a id="ad-h060"></a>

### AD-H060 タイルファイルとDBの整合説明

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-21-kikikuru-tiles.md§5 保存](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[docs/design/issue-20-nowcast-tiles.md§9 保存障害](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md) |
| 原記録の要旨 | タイルファイルとDBの整合説明 |
| 現在状態・解消根拠 | filesystemとSQLiteは単一transactionでない。原子的renameと清掃/再取得で補う |
| 影響・到達条件 | 旧説明を分散transaction保証と読めない |
| 対応案・判断記録 | 差分台帳へ記載、保存障害時の部分成功をAPIへ返す |
| 対応先 | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) |

<a id="ad-h061"></a>

### AD-H061 タイルstale時GET抑止の撤回

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§10 stale](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[docs/design/issue-21-kikikuru-tiles.md§5 stale](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[docs/design/issue-24-time-based-polling-scheduler.md§5.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md) |
| 原記録の要旨 | タイルstale時GET抑止の撤回 |
| 現在状態・解消根拠 | #24により保存索引staleでも有効frameの画像GET可、夜間は別許可 |
| 影響・到達条件 | 古いC10/C11設計から抑止を再導入しない |
| 対応案・判断記録 | readCatalogはHTTPなし、画像許可/索引availabilityを別に伝える |
| 対応先 | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)、[F8 #51](https://github.com/BlueKurage119/wx-viewer-poc/issues/51) |

<a id="ad-h062"></a>

### AD-H062 索引周期と画面再読込頻度

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-24-time-based-polling-scheduler.md§8/9 E/F](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md)<br>[PR #125#issuecomment-5642219287](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#issuecomment-5642219287) |
| 原記録の要旨 | 索引周期と画面再読込頻度 |
| 現在状態・解消根拠 | 途中の索引定期廃止案は最終§1で撤回。120/60/120秒で定期取得 |
| 影響・到達条件 | 画面がrefreshTimesを毎回呼ぶと契約違反 |
| 対応案・判断記録 | 画面は保存catalog読込、表示更新頻度をE/Fで判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)、[F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79) |

<a id="ad-h063"></a>

### AD-H063 全体初期化と個別復元

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-22-initial-recovery.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-22-initial-recovery.md)<br>[docs/design/issue-29-startup-notification-api.md§10 readiness](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) |
| 原記録の要旨 | 全体初期化と個別復元 |
| 現在状態・解消根拠 | startup readinessは4feed成功+会場評価。個別電文成功や全nonXML完了とは別 |
| 影響・到達条件 | 200空を全情報正常の保証と誤認し得る |
| 対応案・判断記録 | 監視DTOで初期取得/採用/画像/地点状態を分離。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K1 #74](https://github.com/BlueKurage119/wx-viewer-poc/issues/74)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) |

<a id="ad-h064"></a>

### AD-H064 全体取得制御と要求識別子

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-9-operation-history.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-9-operation-history.md)<br>[docs/design/issue-11-xml-feed-polling.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-11-xml-feed-polling.md)<br>[docs/design/issue-22-initial-recovery.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-22-initial-recovery.md)<br>[docs/design/issue-23-exponential-backoff-retry.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-23-exponential-backoff-retry.md)<br>[docs/design/issue-24-time-based-polling-scheduler.md§8 E11](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-24-time-based-polling-scheduler.md) |
| 原記録の要旨 | 全体取得制御と要求識別子 |
| 現在状態・解消根拠 | 開始/停止内部機能と操作履歴repoあり、HTTP操作未接続 |
| 影響・到達条件 | manual/force/recovery/夜間/バックオフ無視の意味未決 |
| 対応案・判断記録 | 全体一括・requestId結果照会・連打集約・完了時記録を設計。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43)、[K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) |

<a id="ad-h065"></a>

### AD-H065 履歴検索と通常/訓練分離

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-3-common-metadata.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-3-common-metadata.md)<br>[docs/design/issue-6-info-type-schema.md§9 E](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md)<br>[docs/design/issue-7-reception-history.md§12](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[docs/design/issue-8-notification-output-history.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md)<br>[docs/design/issue-9-operation-history.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-9-operation-history.md) |
| 原記録の要旨 | 履歴検索と通常/訓練分離 |
| 現在状態・解消根拠 | repoはページング/一覧原文除外あり。normalフィルタは明示が必要 |
| 影響・到達条件 | null/訓練や巨大rawの不用意な公開 |
| 対応案・判断記録 | DTO/検索条件/上限・安全診断・権限を設計 |
| 対応先 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77)、[K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) |

<a id="ad-h066"></a>

### AD-H066 通知一覧の保持範囲

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-8-notification-output-history.md§8 直近](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md)<br>[docs/design/issue-25-notification-data-model.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md)<br>[docs/design/issue-29-startup-notification-api.md§10 store](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-29-startup-notification-api.md) |
| 原記録の要旨 | 通知一覧の保持範囲 |
| 現在状態・解消根拠 | B4無期限履歴とI1直近一覧は別責務 |
| 影響・到達条件 | 保持件数・期限・過去通知再鳴動が未定義 |
| 対応案・判断記録 | 表示件数と期間、cursor保持/破棄を定める。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[I2 #68](https://github.com/BlueKurage119/wx-viewer-poc/issues/68)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) |

<a id="ad-h067"></a>

### AD-H067 訓練UI・注入権限・複数訓練

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-12-warning-xml-parser.md§8 訓練](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-12-warning-xml-parser.md)<br>[docs/design/issue-103-notification-message-definitions.md§8 training](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 J](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) |
| 原記録の要旨 | 訓練UI・注入権限・複数訓練 |
| 現在状態・解消根拠 | normal/training/test分離とD4training伝播済み、UI/注入未接続 |
| 影響・到達条件 | 本番上書き・system状態汚染を避ける必要 |
| 対応案・判断記録 | カタログ来歴/訓練ID/権限/時間変換・バッジを判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [J1 #69](https://github.com/BlueKurage119/wx-viewer-poc/issues/69)、[J2 #70](https://github.com/BlueKurage119/wx-viewer-poc/issues/70)、[J4 #72](https://github.com/BlueKurage119/wx-viewer-poc/issues/72)、[J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) |

<a id="ad-h068"></a>

### AD-H068 system操作系メッセージの発生源

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [docs/design/issue-103-notification-message-definitions.md§8 操作/停止](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 操作event](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md) |
| 原記録の要旨 | system操作系メッセージの発生源 |
| 現在状態・解消根拠 | 定義registryはあるが操作等event生成は未接続 |
| 影響・到達条件 | サービス停止と通信断を同一視できない |
| 対応案・判断記録 | E11操作eventとfetch_health遷移を分離。停止検知主体を判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) |

<a id="ad-h069"></a>

### AD-H069 H端末フィルターと二軸

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-32-notification-origin.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md)<br>[docs/design/issue-31-equipment-anomaly-notification.md§8 K9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-31-equipment-anomaly-notification.md)<br>[docs/design/issue-25-notification-data-model.md§7 配信](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md) |
| 原記録の要旨 | H端末フィルターと二軸 |
| 現在状態・解消根拠 | origin weather/systemとdetectionContext normal/initial独立、shell equipment未接続 |
| 影響・到達条件 | initialをsystem扱いする誤除外・cursor停止 |
| 対応案・判断記録 | originだけで表示除外、対象外でもcursor進行、生成保存は共通 |
| 対応先 | [K9 #82](https://github.com/BlueKurage119/wx-viewer-poc/issues/82)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) |

<a id="ad-h070"></a>

### AD-H070 気象snapshotの鮮度評価

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [docs/design/issue-4-availability-state-transition.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-4-availability-state-transition.md)<br>[docs/design/issue-13-warning-current-state.md§10](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md)<br>[docs/design/issue-23-exponential-backoff-retry.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-23-exponential-backoff-retry.md)<br>[docs/design/issue-28-warning-notification-generation-rules.md§10 stale](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-28-warning-notification-generation-rules.md) |
| 原記録の要旨 | 気象snapshotの鮮度評価 |
| 現在状態・解消根拠 | 値保持とD7取得元監視は別。XML通常feed鮮度は300秒 |
| 影響・到達条件 | D7だけでは各現況staleを通知/表示に自動適用しない |
| 対応案・判断記録 | 情報別の参照元・評価時刻・normal空をDTOで設計 |
| 対応先 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) |

<a id="ad-h071"></a>

### AD-H071 過去のGit履歴の匿名化

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 対象外 |
| 原出典・原項目 | [PR #134/注意](https://github.com/BlueKurage119/wx-viewer-poc/pull/134) |
| 原記録の要旨 | 過去のGit履歴の匿名化 |
| 現在状態・解消根拠 | 現行参照は相対化済み。過去commit履歴rewriteは別判断 |
| 影響・到達条件 | 本棚卸しで履歴を書換える権限はない |
| 対応案・判断記録 | 個人情報文字列を再転載せず運用判断として保持 |
| 対応先 | [L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) |

<a id="ad-h072"></a>

### AD-H072 初期FOUCのstorage例外

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-1-project-initialization.md§3.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-1-project-initialization.md)<br>[PR #89#discussion_r3952367010](https://github.com/BlueKurage119/wx-viewer-poc/pull/89#discussion_r3952367010) |
| 原記録の要旨 | 初期FOUCのstorage例外 |
| 現在状態・解消根拠 | apps/web/index.html と #2 staticダークテーマ、PR89 r3952385051 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h073"></a>

### AD-H073 lint警告を成功とする設定

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-1-project-initialization.md§3.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-1-project-initialization.md)<br>[PR #89#discussion_r3952367013](https://github.com/BlueKurage119/wx-viewer-poc/pull/89#discussion_r3952367013) |
| 原記録の要旨 | lint警告を成功とする設定 |
| 現在状態・解消根拠 | package.json --max-warnings 0、PR89 r3952385639 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h074"></a>

### AD-H074 tsxの依存不足

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #91#discussion_r3957845190](https://github.com/BlueKurage119/wx-viewer-poc/pull/91#discussion_r3957845190)<br>[PR #93/変更](https://github.com/BlueKurage119/wx-viewer-poc/pull/93) |
| 原記録の要旨 | tsxの依存不足 |
| 現在状態・解消根拠 | 基準mainに含まれる d324e19 と apps/web/package.json のtsx devDependency。PR93は未マージなので採用根拠にしない。 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h075"></a>

### AD-H075 受信異常bannerのHEX直書き

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§11.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[PR #96#issuecomment-5588562804](https://github.com/BlueKurage119/wx-viewer-poc/pull/96#issuecomment-5588562804) |
| 原記録の要旨 | 受信異常bannerのHEX直書き |
| 現在状態・解消根拠 | AppShell/index.css がMD3 error/on-error参照 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h076"></a>

### AD-H076 未登録404の固定HEX

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #99/レビュー](https://github.com/BlueKurage119/wx-viewer-poc/pull/99) |
| 原記録の要旨 | 未登録404の固定HEX |
| 現在状態・解消根拠 | apps/web/vite.config.ts はcolor-scheme dark |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h077"></a>

### AD-H077 B2/C取得/保持基盤の接続

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-3-common-metadata.md§6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-3-common-metadata.md)<br>[docs/design/issue-4-availability-state-transition.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-4-availability-state-transition.md)<br>[docs/design/issue-5-sqlite-persistence.md§11](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-5-sqlite-persistence.md)<br>[docs/design/issue-6-info-type-schema.md§9 C](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md)<br>[docs/design/issue-7-reception-history.md§12](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[docs/design/issue-10-retention-policy.md§7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-10-retention-policy.md)<br>[docs/design/issue-11-xml-feed-polling.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-11-xml-feed-polling.md) |
| 原記録の要旨 | B2/C取得/保持基盤の接続 |
| 現在状態・解消根拠 | migrations0001〜0020、polling各processor、retentionPolicy.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h078"></a>

### AD-H078 stale明細の削除

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #101#discussion_r3961726748](https://github.com/BlueKurage119/wx-viewer-poc/pull/101#discussion_r3961726748) |
| 原記録の要旨 | stale明細の削除 |
| 現在状態・解消根拠 | 70f06f7、repositories各snapshot更新の成功時だけ明細置換、repositories.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h079"></a>

### AD-H079 共通UTC日時入力の検証

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #101#discussion_r3961726752](https://github.com/BlueKurage119/wx-viewer-poc/pull/101#discussion_r3961726752) |
| 原記録の要旨 | 共通UTC日時入力の検証 |
| 現在状態・解消根拠 | 70f06f7、repositories/snapshot.ts 日時検証とrepositories.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h080"></a>

### AD-H080 fetchAttempt戻値ID上書き

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #102/軽微事項](https://github.com/BlueKurage119/wx-viewer-poc/pull/102) |
| 原記録の要旨 | fetchAttempt戻値ID上書き |
| 現在状態・解消根拠 | 基準mainに含まれる 1dbafcf。fetchAttemptRepository.ts:186はinput展開後RETURNING idを代入。 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h081"></a>

### AD-H081 C7外部fixture依存の無言skip

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #116/申し送りexistsSync](https://github.com/BlueKurage119/wx-viewer-poc/pull/116)<br>[docs/design/issue-118-self-contained-test-fixtures.md§受入](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-118-self-contained-test-fixtures.md)<br>[PR #119/変更](https://github.com/BlueKurage119/wx-viewer-poc/pull/119) |
| 原記録の要旨 | C7外部fixture依存の無言skip |
| 現在状態・解消根拠 | tests/fixtures/jma/manifest.json とリポジトリ内固定fixture。jmaVpbs50Processor.test.ts等はexistsSyncをassertし、欠落を成功としてskipしない。 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h082"></a>

### AD-H082 アメダスAQC非数値混入

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #120#discussion_r3990306854](https://github.com/BlueKurage119/wx-viewer-poc/pull/120#discussion_r3990306854) |
| 原記録の要旨 | アメダスAQC非数値混入 |
| 現在状態・解消根拠 | r3990409984、amedasParser.ts unknownShapeCount除外とamedasParser.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h083"></a>

### AD-H083 アメダス空結果の履歴件数

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #120#discussion_r3990561525](https://github.com/BlueKurage119/wx-viewer-poc/pull/120#discussion_r3990561525) |
| 原記録の要旨 | アメダス空結果の履歴件数 |
| 現在状態・解消根拠 | r3990680016、amedasFetchService.ts 空時nullとamedasFetchService.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h084"></a>

### AD-H084 PNG本文受信のduration

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #121#discussion_r3991497291](https://github.com/BlueKurage119/wx-viewer-poc/pull/121#discussion_r3991497291) |
| 原記録の要旨 | PNG本文受信のduration |
| 現在状態・解消根拠 | 93bbc79、nowcastTileStore.ts 本文完了後計時とnowcastTileStore.test.ts 750ms回帰 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h085"></a>

### AD-H085 キキクル履歴sourceKind

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-7-reception-history.md§12 部分tile](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[PR #122#discussion_r3992100369](https://github.com/BlueKurage119/wx-viewer-poc/pull/122#discussion_r3992100369) |
| 原記録の要旨 | キキクル履歴sourceKind |
| 現在状態・解消根拠 | kikikuruService.ts risk_tile_frame、kikikuruService.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h086"></a>

### AD-H086 キキクル一覧/タイル競合

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #122#discussion_r3992100375](https://github.com/BlueKurage119/wx-viewer-poc/pull/122#discussion_r3992100375) |
| 原記録の要旨 | キキクル一覧/タイル競合 |
| 現在状態・解消根拠 | kikikuruService.ts レイヤーqueueでrefresh/clean直列化、kikikuruService.test.ts 並行例 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h087"></a>

### AD-H087 server待受失敗の未処理reject

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #123#discussion_r3992681111](https://github.com/BlueKurage119/wx-viewer-poc/pull/123#discussion_r3992681111) |
| 原記録の要旨 | server待受失敗の未処理reject |
| 現在状態・解消根拠 | bfa8c5b、server.ts 待受awaitと起動cleanup、jmaXmlPolling.test.ts ポート競合 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h088"></a>

### AD-H088 CLI初期取得失敗のcleanup

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #123#discussion_r3992681116](https://github.com/BlueKurage119/wx-viewer-poc/pull/123#discussion_r3992681116) |
| 原記録の要旨 | CLI初期取得失敗のcleanup |
| 現在状態・解消根拠 | bfa8c5b、server.ts main try/catchでclose |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h089"></a>

### AD-H089 初期取得中error監視の空白

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #123#discussion_r3992790668](https://github.com/BlueKurage119/wx-viewer-poc/pull/123#discussion_r3992790668) |
| 原記録の要旨 | 初期取得中error監視の空白 |
| 現在状態・解消根拠 | f663ae1、server.ts error monitor/Promise.raceと起動テスト |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h090"></a>

### AD-H090 XML内部例外のゼロ遅延retry

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #124#discussion_r3993563008](https://github.com/BlueKurage119/wx-viewer-poc/pull/124#discussion_r3993563008) |
| 原記録の要旨 | XML内部例外のゼロ遅延retry |
| 現在状態・解消根拠 | jmaXmlPollingService.ts 通常周期抑制、jmaXmlPolling.test.ts 内部例外回帰 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h091"></a>

### AD-H091 境界越え実行の次回予約

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3994104686](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3994104686) |
| 原記録の要旨 | 境界越え実行の次回予約 |
| 現在状態・解消根拠 | cfc1105、timeBasedPollingScheduler.ts 新世代完了再予約、同Acceptance.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h092"></a>

### AD-H092 地点未試行時の再確認時刻

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3994104688](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3994104688) |
| 原記録の要旨 | 地点未試行時の再確認時刻 |
| 現在状態・解消根拠 | 38dee5d、AmedasScheduledAdapter はpointData.attempted時のみ更新 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h093"></a>

### AD-H093 未承認の鮮度5分固定

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-20-nowcast-tiles.md§9 C14](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-20-nowcast-tiles.md)<br>[docs/design/issue-21-kikikuru-tiles.md§9 閾値](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-21-kikikuru-tiles.md)<br>[PR #125#discussion_r3994104692](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3994104692) |
| 原記録の要旨 | 未承認の鮮度5分固定 |
| 現在状態・解消根拠 | #24最終§1で300秒承認、config/polling.yaml 独立設定・検証 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h094"></a>

### AD-H094 注入設定のDB前検証

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3995563875](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3995563875) |
| 原記録の要旨 | 注入設定のDB前検証 |
| 現在状態・解消根拠 | 5548d28、server.ts validatePollingScheduleConfig、scheduleLoader tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h095"></a>

### AD-H095 XML明示再開の即時取得

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3995563880](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3995563880) |
| 原記録の要旨 | XML明示再開の即時取得 |
| 現在状態・解消根拠 | 5548d28、scheduler再開 immediateScheduled true、scheduler tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h096"></a>

### AD-H096 未知freshnessキー受理

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3995563885](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3995563885) |
| 原記録の要旨 | 未知freshnessキー受理 |
| 現在状態・解消根拠 | 5548d28、pollingSchedule.ts キー完全一致、pollingScheduleLoader.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h097"></a>

### AD-H097 停止境界後のXML開始失敗

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #125#discussion_r3995594107](https://github.com/BlueKurage119/wx-viewer-poc/pull/125#discussion_r3995594107) |
| 原記録の要旨 | 停止境界後のXML開始失敗 |
| 現在状態・解消根拠 | 0227287、scheduler start catch→failedからrecovery、scheduler tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h098"></a>

### AD-H098 通知targetの単数化

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-25-notification-data-model.md§8 複数対象](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md)<br>[PR #127#discussion_r3995733564](https://github.com/BlueKurage119/wx-viewer-poc/pull/127#discussion_r3995733564) |
| 原記録の要旨 | 通知targetの単数化 |
| 現在状態・解消根拠 | a129b4f、shared/notification.ts 非空targets配列とmapper JSON |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h099"></a>

### AD-H099 JMA市町村コードの誤桁

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #127#discussion_r3995928067](https://github.com/BlueKurage119/wx-viewer-poc/pull/127#discussion_r3995928067) |
| 原記録の要旨 | JMA市町村コードの誤桁 |
| 現在状態・解消根拠 | dad849c、notificationOutputHistoryMapper.test.ts 1311100/1310800 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h100"></a>

### AD-H100 レベル2注意報の区分制限

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #128#discussion_r3996157685](https://github.com/BlueKurage119/wx-viewer-poc/pull/128#discussion_r3996157685) |
| 原記録の要旨 | レベル2注意報の区分制限 |
| 現在状態・解消根拠 | 5b9af99、notificationMessageDefinitions.ts warning/question+byCategory、shared tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h101"></a>

### AD-H101 レベル4危険警報の区分制限

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #128#discussion_r3996157688](https://github.com/BlueKurage119/wx-viewer-poc/pull/128#discussion_r3996157688) |
| 原記録の要旨 | レベル4危険警報の区分制限 |
| 現在状態・解消根拠 | 5b9af99、同registry question/emergency+byCategory、shared tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h102"></a>

### AD-H102 会場定義とXML同時採用

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-2-common-shell.md§9.5/9.6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-2-common-shell.md)<br>[docs/design/issue-12-warning-xml-parser.md§8 C15](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-12-warning-xml-parser.md)<br>[docs/design/issue-13-warning-current-state.md§9 会場](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md)<br>[docs/design/issue-14-warning-timeseries.md§8 会場](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-14-warning-timeseries.md)<br>[docs/design/issue-109-venue-forecast-target-definitions.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-109-venue-forecast-target-definitions.md)<br>[PR #113/申し送り](https://github.com/BlueKurage119/wx-viewer-poc/pull/113)<br>[Issue #114#issuecomment-5609920110](https://github.com/BlueKurage119/wx-viewer-poc/issues/114#issuecomment-5609920110) |
| 原記録の要旨 | 会場定義とXML同時採用 |
| 現在状態・解消根拠 | #109/#114、venueForecastTargets.ts、migration0018、venueScopedAdoption.test.ts。アメダスはH008へ別途 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h103"></a>

### AD-H103 共有区域assertの未接続

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #129#discussion_r3996419975](https://github.com/BlueKurage119/wx-viewer-poc/pull/129#discussion_r3996419975) |
| 原記録の要旨 | 共有区域assertの未接続 |
| 現在状態・解消根拠 | 063184b、jmaXmlPoller.ts resolveShared*使用、venueScopedAdoption tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h104"></a>

### AD-H104 時刻依存の起動失敗test

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #129/既知flake](https://github.com/BlueKurage119/wx-viewer-poc/pull/129)<br>[PR #128/検証修正](https://github.com/BlueKurage119/wx-viewer-poc/pull/128) |
| 原記録の要旨 | 時刻依存の起動失敗test |
| 現在状態・解消根拠 | b19364a、jmaXmlPolling.test.ts now固定 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h105"></a>

### AD-H105 重複freshnessプロパティ2箇所

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #129/軽微事項](https://github.com/BlueKurage119/wx-viewer-poc/pull/129)<br>[docs/design/issue-130-duplicate-freshness-policy.md§受入](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-130-duplicate-freshness-policy.md)<br>[PR #132#issuecomment-5646738740](https://github.com/BlueKurage119/wx-viewer-poc/pull/132#issuecomment-5646738740) |
| 原記録の要旨 | 重複freshnessプロパティ2箇所 |
| 現在状態・解消根拠 | 57bee3a、jmaXmlPolling.test.ts 両重複削除 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h106"></a>

### AD-H106 worktreeまでlint走査

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #128/検証制限](https://github.com/BlueKurage119/wx-viewer-poc/pull/128)<br>[PR #131/検証](https://github.com/BlueKurage119/wx-viewer-poc/pull/131)<br>[PR #133/背景](https://github.com/BlueKurage119/wx-viewer-poc/pull/133) |
| 原記録の要旨 | worktreeまでlint走査 |
| 現在状態・解消根拠 | eslint.config.js ignores。ルートlint最終検証対象 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h107"></a>

### AD-H107 共有設定の環境固有path

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #133#discussion_r3996648200](https://github.com/BlueKurage119/wx-viewer-poc/pull/133#discussion_r3996648200) |
| 原記録の要旨 | 共有設定の環境固有path |
| 現在状態・解消根拠 | 303bf8b、共有設定から除去。原文字列は再転載しない |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h108"></a>

### AD-H108 外部資料リンクの深さ

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #134#discussion_r3996678406](https://github.com/BlueKurage119/wx-viewer-poc/pull/134#discussion_r3996678406) |
| 原記録の要旨 | 外部資料リンクの深さ |
| 現在状態・解消根拠 | e565b11、docsは../../docs、designは../../../docs |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h109"></a>

### AD-H109 C3段階表の逆転

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-13-warning-current-state.md§3.6 訂正](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md)<br>[docs/design/issue-26-notification-category-classifier.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-26-notification-category-classifier.md)<br>[PR #131/変更](https://github.com/BlueKurage119/wx-viewer-poc/pull/131) |
| 原記録の要旨 | C3段階表の逆転 |
| 現在状態・解消根拠 | jmaWarningCurrentReducer.ts 7現象14code訂正、classifier/reducer/processor tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h110"></a>

### AD-H110 D3後続例外/重複/訓練

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-26-notification-category-classifier.md§8](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-26-notification-category-classifier.md)<br>[docs/design/issue-27-warning-state-change-notification-decision.md§6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-27-warning-state-change-notification-decision.md)<br>[PR #135/申し送りD4](https://github.com/BlueKurage119/wx-viewer-poc/pull/135)<br>[docs/design/issue-103-notification-message-definitions.md§8 D4](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md) |
| 原記録の要旨 | D3後続例外/重複/訓練 |
| 現在状態・解消根拠 | #28 plannerが当該1件skippedで継続、訓練のみisTraining、同版/continued抑止 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h111"></a>

### AD-H111 D1文言定義・B4mapper・二軸

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-8-notification-output-history.md§8 D1](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-8-notification-output-history.md)<br>[docs/design/issue-25-notification-data-model.md§8 文言](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-25-notification-data-model.md)<br>[docs/design/issue-103-notification-message-definitions.md§8 D4/D7](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-103-notification-message-definitions.md)<br>[docs/design/issue-32-notification-origin.md§9](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-32-notification-origin.md)<br>[Issue #103#issuecomment-5592456815/当初案（後続で区分訂正）](https://github.com/BlueKurage119/wx-viewer-poc/issues/103#issuecomment-5592456815) |
| 原記録の要旨 | D1文言定義・B4mapper・二軸 |
| 現在状態・解消根拠 | shared registry/notification.ts、notificationOutputHistoryMapper.ts、D8三組合せテスト |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h112"></a>

### AD-H112 D4取消時の集約fallback

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-13-warning-current-state.md§10 取消](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-13-warning-current-state.md)<br>[PR #137/設計訂正](https://github.com/BlueKurage119/wx-viewer-poc/pull/137) |
| 原記録の要旨 | D4取消時の集約fallback |
| 現在状態・解消根拠 | 759efec、reducer cancelledStreamsでbaseline比較、warningNotificationRules AC6-2 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h113"></a>

### AD-H113 VPWS50訂正の過剰対象

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #137/申し送り訂正](https://github.com/BlueKurage119/wx-viewer-poc/pull/137)<br>[PR #137#discussion_r3997075266](https://github.com/BlueKurage119/wx-viewer-poc/pull/137#discussion_r3997075266) |
| 原記録の要旨 | VPWS50訂正の過剰対象 |
| 現在状態・解消根拠 | 25aae0e、planner sourceTelegram完全一致、planner回帰test |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h114"></a>

### AD-H114 端末sessionから起動API接続

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-30-terminal-session.md§8 後続](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-30-terminal-session.md)<br>[PR #136/引継ぎ](https://github.com/BlueKurage119/wx-viewer-poc/pull/136)<br>[docs/design/issue-22-initial-recovery.md§8 D5/D6](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-22-initial-recovery.md) |
| 原記録の要旨 | 端末sessionから起動API接続 |
| 現在状態・解消根拠 | #29、app POST route/shared terminal台帳/web startup client、startupNotifications tests |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h115"></a>

### AD-H115 初期評価失敗の永久202

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #138#discussion_r3997224305](https://github.com/BlueKurage119/wx-viewer-poc/pull/138#discussion_r3997224305) |
| 原記録の要旨 | 初期評価失敗の永久202 |
| 現在状態・解消根拠 | 838de5f、jmaXmlPollingService listener失敗を次周期再試行、jmaXmlPolling.test.ts |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h116"></a>

### AD-H116 二軸の相関した受入test

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #142#discussion_r3998803888](https://github.com/BlueKurage119/wx-viewer-poc/pull/142#discussion_r3998803888) |
| 原記録の要旨 | 二軸の相関した受入test |
| 現在状態・解消根拠 | 2dc9d41、notificationOriginPipeline.acceptance.test.ts system+initial第三行 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h117"></a>

### AD-H117 XML初期復旧/backoffの後続

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-11-xml-feed-polling.md§8 C12/C13](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-11-xml-feed-polling.md)<br>[docs/design/issue-22-initial-recovery.md§8 C13](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-22-initial-recovery.md)<br>[docs/design/issue-23-exponential-backoff-retry.md§7 C14](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-23-exponential-backoff-retry.md) |
| 原記録の要旨 | XML初期復旧/backoffの後続 |
| 現在状態・解消根拠 | jmaXmlPollingService.ts 4feed成功集合/60,120,240,300秒、停止再開/バックオフ回帰 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h118"></a>

### AD-H118 タイル孤児清掃・部分失敗

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [docs/design/issue-6-info-type-schema.md§9 tile](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-6-info-type-schema.md)<br>[docs/design/issue-7-reception-history.md§12 tile](https://github.com/BlueKurage119/wx-viewer-poc/blob/60aaf5b30b28091e3405797e599cc72c1904b6bd/docs/design/issue-7-reception-history.md)<br>[PR #101/タイル](https://github.com/BlueKurage119/wx-viewer-poc/pull/101)<br>[PR #102/部分失敗](https://github.com/BlueKurage119/wx-viewer-poc/pull/102) |
| 原記録の要旨 | タイル孤児清掃・部分失敗 |
| 現在状態・解消根拠 | #20/#21サービスとtileStore、failure/itemCount/failedItemCount、参照外清掃・破損再取得テスト |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h119"></a>

### AD-H119 動的migration fixtureの構成差

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #100#issuecomment-5590509293/構成図](https://github.com/BlueKurage119/wx-viewer-poc/pull/100#issuecomment-5590509293) |
| 原記録の要旨 | 動的migration fixtureの構成差 |
| 現在状態・解消根拠 | database.test.ts writeMigrationで一時生成。当時設計図と配置差は受容、機能差なし |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h120"></a>

### AD-H120 D3switch案とif-chainの差

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 実装差分 / 解消済み |
| 原出典・原項目 | [PR #135/実装メモ](https://github.com/BlueKurage119/wx-viewer-poc/pull/135) |
| 原記録の要旨 | D3switch案とif-chainの差 |
| 現在状態・解消根拠 | warningStateChangeNotificationDecider.ts 末尾throw、受入/mutationで同契約。旧設計記録は維持 |
| 影響・到達条件 | 後続で解消済み、未解消の作業として再起票しない |
| 対応案・判断記録 | 現契約と回帰を維持 |
| 対応先 | — |

<a id="ad-h121"></a>

### AD-H121 HTTP受信履歴とXML電文履歴の分離

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未対応申し送り / 未対応 |
| 原出典・原項目 | [Issue #75#issuecomment-5591790017](https://github.com/BlueKurage119/wx-viewer-poc/issues/75#issuecomment-5591790017) |
| 原記録の要旨 | HTTP受信履歴とXML電文履歴の分離 |
| 現在状態・解消根拠 | ユーザーが履歴の入口をHTTP通信ログとXMLログの2つに分けると指定 |
| 影響・到達条件 | K2旧本文は単一の受信履歴入口 |
| 対応案・判断記録 | 入口を分け、既存B3の2種の記録を別に閲覧 |
| 対応先 | [K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) |

<a id="ad-h122"></a>

### AD-H122 電文履歴の左右ペインとカナ表示候補

| 項目 | 内容 |
| --- | --- |
| 種別・状態 | 未決仕様 / 未決 |
| 原出典・原項目 | [Issue #76#issuecomment-5591759938](https://github.com/BlueKurage119/wx-viewer-poc/issues/76#issuecomment-5591759938) |
| 原記録の要旨 | 電文履歴の左右ペインとカナ表示候補 |
| 現在状態・解消根拠 | 左一覧・右電文の構成を指定、カナ形式は可能ならという候補 |
| 影響・到達条件 | カナ変換は現行parserの供給契約にない |
| 対応案・判断記録 | 左右ペインを反映し、カナ表示の採否・変換根拠は着手前判断。未決は後続へ残す承認済み（2026-09-13）。 |
| 対応先 | [K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) |

## 5. PR転載用：未解消事項の全件

台帳全122件中、以下68件を転載する。解消済み52件・対象外2件は [§4](#4-引き継ぎ台帳原項目管理id) の各IDに根拠を残し、本表に混ぜない。採否待ちは予防修正を必須とする判断ではない。

| 管理ID | 種別・状態 | 論点と影響 | 今回の扱い・次の対応 | 引き継ぎ先 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| [AD-H001](#ad-h001) | 未決 | タイルの健全性基準。オンデマンド失敗を周期閾値で測れない | 要求数・失敗率等の採否を先に判断。既存周期基準を流用しない | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h001) |
| [AD-H003](#ad-h003) | 未決 | アメダス地点の検知遅れ。latest失敗・停止を含む到達時間保証ではない | 許容性・運用表示・別検知の要否を判断 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h003) |
| [AD-H004](#ad-h004) | 未決 | stale画面表現と状態色。前回値・正常空・未取得を混同し得る | パネル別表示表を承認後に実装。A5対象外の状態色をここで扱う | [G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h004) |
| [AD-H005](#ad-h005) | 未対応 | 起動応答と差分配信の接続。起動snapshotと差分間の欠落・二重表示 | snapshot/sequence・cursor・共通store・再試行を設計 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) | [台帳](#ad-h005) |
| [AD-H006](#ad-h006) | 未決 | 起動問い合わせの再試行。初期取得待ちの画面が応答へ合流しない | 同一session維持、再試行間隔・打切り・失敗表示を判断 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | [台帳](#ad-h006) |
| [AD-H007](#ad-h007) | 未対応 | system・竜巻の起動通知と速報通常通知。D7の最大6system通知は履歴の契約でstartup現仕様でない | 生成/起動再提示の対象・期限・重複単位を別設計。E9で黙って追加しない | [D10 #145](https://github.com/BlueKurage119/wx-viewer-poc/issues/145)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) | [台帳](#ad-h007) |
| [AD-H008](#ad-h008) | 未対応 | 複数会場アメダス収集。羽田の定期観測が未取得 | 最新時刻共有・地点状態分離を設計してC17で接続 | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h008) |
| [AD-H009](#ad-h009) | 未決 | 起動時アメダスbackfill採否。起動直後24時間グラフが揃う保証なし | 採用範囲・負荷をC17で判断。表示は取得済み範囲のみ | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h009) |
| [AD-H010](#ad-h010) | 未決 | 訓練の取消と物理削除の境界。本番・履歴・sessionの消去範囲に影響 | 管理単位・権限・保持対象をJ3設計前に判断 | [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71)、[J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) | [台帳](#ad-h010) |
| [AD-H011](#ad-h011) | 未決 | 受信原文・履歴の容量。長期運転でDB増大。4.36MiBは1電文例で全量推定でない | 実運用量をL2で測り、圧縮/選別/削除は別承認。表示期間で削除しない | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76) | [台帳](#ad-h011) |
| [AD-H012](#ad-h012) | 未決 | session・startup監査の無期限保持。削除すれば継続判定が変化 | 容量と運用初期化の採否を確認。自動削除を追加しない | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) | [台帳](#ad-h012) |
| [AD-H013](#ad-h013) | 未決 | 手動DB初期化の運用。停止/バックアップ/対象選択なしの削除は不可 | 運用手順の要否・対象・承認を判断。旧削除API申し送りは採用しない | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43) | [台帳](#ad-h013) |
| [AD-H014](#ad-h014) | 未決 | 会場別REST境界。任意会場入力・DB型直接公開を避ける必要 | 端末台帳での解決、normal明示、DTO/null/時刻検証を先に設計 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | [台帳](#ad-h014) |
| [AD-H015](#ad-h015) | 未決 | C7採用判定の会場精度。片会場にだけ該当する電文の採用理由は会場厳密でない | 採用監査精度をE6/K3で判断、必要ならevent保存1件のまま採用だけ分離 | [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h015) |
| [AD-H016](#ad-h016) | 未対応 | 会場追加の不変条件。同一区域2会場・異なる広域対象追加は現前提外 | 定義/IDs/CHECK migration/不変条件を同時変更する設計が必要 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33) | [台帳](#ad-h016) |
| [AD-H017](#ad-h017) | 確認待ち | 会場の実電文と実負荷。合成parse 7.4〜9.4msを運用性能保証にできない | 入手済み実例と合成を区別しL2で確認 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) | [台帳](#ad-h017) |
| [AD-H018](#ad-h018) | 未決 | 会場中心・画角と背景地図。地図寸法・パネル遮蔽で会場位置がずれる | 会場別中心補正と戻る操作、背景提供元条件/zoomを実画面確認 | [F1 #44](https://github.com/BlueKurage119/wx-viewer-poc/issues/44)、[F6 #49](https://github.com/BlueKurage119/wx-viewer-poc/issues/49)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h018) |
| [AD-H019](#ad-h019) | 未決 | 主解像度・小画面と拡大率。表示切れと通知操作に影響 | 対象PCの条件を決めて実寸確認 | [G1 #52](https://github.com/BlueKurage119/wx-viewer-poc/issues/52)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) | [台帳](#ad-h019) |
| [AD-H020](#ad-h020) | 確認待ち | レベル5と非常色の実UI視認性。小バッジと同時通知の識別未検証、level4紫との近さ | 実UIで1px以上の縁/文字/色の組合せを確認。CAM16距離を弁別保証にしない | [G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[G11 #62](https://github.com/BlueKurage119/wx-viewer-poc/issues/62)、[H1 #63](https://github.com/BlueKurage119/wx-viewer-poc/issues/63)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) | [台帳](#ad-h020) |
| [AD-H021](#ad-h021) | 未決 | 未対応件数・既読・再通知の単位。件数合算・確認/対応中・新着の意味が変わる | 端末内の表示単位・期限・繰返し・スヌーズ競合を決定。複数端末正本は本番別途 | [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[H3 #65](https://github.com/BlueKurage119/wx-viewer-poc/issues/65)、[H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) | [台帳](#ad-h021) |
| [AD-H022](#ad-h022) | 未決 | ブラウザ疎通異常。サーバ上流健全性とブラウザ接続を混同し得る | UI更新失敗の契約を別に定め、最終表示時刻を示す | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | [台帳](#ad-h022) |
| [AD-H023](#ad-h023) | 未決 | 問いかけ・操作結果の同時表示。問いかけ中の強制切替/操作結果上書き | 優先順位と操作導線を決め、IDで保持。データを区分だけで1件化しない | [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) | [台帳](#ad-h023) |
| [AD-H024](#ad-h024) | 未決 | 通知表示3要素の復元。summary再解析/現レジストリだけ再解決では過去内容が変わる | E9の配信スナップショット契約を定めてからH接続 | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) | [台帳](#ad-h024) |
| [AD-H025](#ad-h025) | 未対応 | 通知確認状態と履歴。B4を端末の確認履歴と見なすと意味が変わる | 確認は端末内だけ。reload時resetとsession継続を別に検証 | [H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77)、[L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) | [台帳](#ad-h025) |
| [AD-H027](#ad-h027) | 未対応 | 本番配信と404/Node要件。deep linkやNode版不一致 | 採用環境でNode条件・同一origin・登録/未登録pathを確認 | [L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h027) |
| [AD-H028](#ad-h028) | 未決 | DB並行性と長時間query。大量queryでevent loop遅延 | 実負荷測定後worker/外部DB等の採否判断。予防改修を必須にしない | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h028) |
| [AD-H029](#ad-h029) | 残留リスク/未決 | migrationコメント誤検出。将来migrationコメントの形による誤検知、既存正常運転は非該当 | 採否待ち。再現時に対応要否を判断。現在migrationを書き換えない | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h029) |
| [AD-H030](#ad-h030) | 残留リスク/未決 | warning時系列の一意制約。将来二重挿入誤用時。現パーサ処理の直ちの欠陥とはしない | 採否待ち。L2で到達性を確認後に制約要否判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34) | [台帳](#ad-h030) |
| [AD-H031](#ad-h031) | 残留リスク/未決 | 複合FKの直接回帰。将来migration退行の検出粒度 | 採否待ち。検収で複合参照負例の追加要否を判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h031) |
| [AD-H032](#ad-h032) | 未対応 | DDL参照文書の陳腐化。古い文書から新DBを生成すると欠落 | 旧記録を維持し本監査へ差分集約。今後自動生成の採否判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h032) |
| [AD-H033](#ad-h033) | 残留リスク/未決 | redirect先のdomain検証。上流redirect変更時。固定URL通常利用の実害未確認 | 採否待ち。必要時に最終URL制限採否を判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h033) |
| [AD-H034](#ad-h034) | 残留リスク/未決 | 二重timeoutの簡素化。動作害のない保守論点 | 採否待ち。取得挙動変更時のみ整理要否を検討 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h034) |
| [AD-H035](#ad-h035) | 残留リスク/未決 | ParsedIssuedWarningKind冗長宣言。型上の冗長で通常挙動への影響なし | 採否待ち。型改定時に整理要否判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h035) |
| [AD-H036](#ad-h036) | 残留リスク/未決 | 区域dedupの変異未検出。現在の異桁コードでは低頻度、体系追加時に影響 | 採否待ち。コード体系追加時に衝突例のテスト要否判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) | [台帳](#ad-h036) |
| [AD-H037](#ad-h037) | 残留リスク/未決 | テストTSの型検査対象。tests内の静的型不備をtypecheckで検知しない | 採否待ち。将来のテスト保守時に専用設定の採否を判断 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) | [台帳](#ad-h037) |
| [AD-H038](#ad-h038) | 残留リスク/未決 | 取消とbaselineの等時刻テスト。等時刻境界の将来退行 | 採否待ち。L3で境界テスト追加の採否を判断 | [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) | [台帳](#ad-h038) |
| [AD-H039](#ad-h039) | 残留リスク/未決 | 通知保存失敗時の回復保証。DB障害/間のcrashで通知喪失、同版再試行保証なし | 採否待ち。L3で運用影響を判断し、必要時に配信保証の別設計。今回outboxを追加しない | [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) | [台帳](#ad-h039) |
| [AD-H040](#ad-h040) | 未対応 | 通知skip・保存失敗の監視。判定不能1件を落として他現象継続するがUIには未反映 | 処理エラーとして公開する範囲・安全な診断を設計 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80)、[K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81) | [台帳](#ad-h040) |
| [AD-H041](#ad-h041) | 残留リスク/確認待ち | 健全性評価の運用初期値・境界。未来時刻・最大1評価周期差・scan上限を性能保証にしない | 測定結果と評価時刻を表示。flapping抑止の追加は採否待ち | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h041) |
| [AD-H042](#ad-h042) | 確認待ち | 実XMLの未観測形。合成から提供仕様を確定できない | L2の種別別実例台帳で確認。入手できないものは未確認を維持 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) | [台帳](#ad-h042) |
| [AD-H043](#ad-h043) | 確認待ち | 取消本文/EventID/Serial。解除対象の推定や旧現況再有効化は危険 | 原文入手後に対応する取消範囲を検証、J3合成は実例と区別 | [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) | [台帳](#ad-h043) |
| [AD-H044](#ad-h044) | 未対応 | C3洪水04/18非採用。公式分類対応と取得対応を混同し得る | 採用対象/電文と河川情報範囲を確認。コードだけ足さない | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85)、[L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) | [台帳](#ad-h044) |
| [AD-H045](#ad-h045) | 確認待ち | 未知XML構造の継続確認。新提供形を低い値へfallbackできない | 原文/理由を監視へ、追加採用前に公式/実例と照合 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h045) |
| [AD-H046](#ad-h046) | 未対応 | XML明細の未抽出項目。G2/G3/G7が元Issueの表示項目をそのまま供給できない | 各Eで表示必須項目と保存追加の必要性を設計。未取得を補完しない | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) | [台帳](#ad-h046) |
| [AD-H047](#ad-h047) | 未決 | 速報の期限・重複・区域表現。一律3h・VPHW50/51重複・目撃区域精度の誤表示 | 型と期限を区別し、重複表示と取消行・付近の表現を先に判断 | [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h047) |
| [AD-H048](#ad-h048) | 未対応 | 警報等時系列のDTO/量的予想。添字結合や固定現象で誤表示 | 時刻定義の参照関係をDTOで維持し現在区間・凡例・詳細を実装 | [E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[G4 #55](https://github.com/BlueKurage119/wx-viewer-poc/issues/55)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h048) |
| [AD-H049](#ad-h049) | 未対応 | 早期注意の二表・日界。なし/値なし/未取得・分類の異なる現象を混同 | 2表と各発表時刻を維持し共通現象だけ詳細結合 | [E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[G5 #56](https://github.com/BlueKurage119/wx-viewer-poc/issues/56)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h049) |
| [AD-H050](#ad-h050) | 未対応 | 地域時系列の区間と時点。配列添字結合や風速実数補間は不可 | 時間軸参照で結合し階級と範囲を確認 | [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | [台帳](#ad-h050) |
| [AD-H051](#ad-h051) | 未決 | 天気アイコンの入力境界。G8旧『天気コード対応』は入力が不足 | 公式と実電文で対応単位を決め、文字代替を含める | [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[G8 #59](https://github.com/BlueKurage119/wx-viewer-poc/issues/59)、[G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) | [台帳](#ad-h051) |
| [AD-H052](#ad-h052) | 確認待ち | アメダスAQC非0・旧推計値。実AQC5/6数値例なし、過去推計値は遡及復元されない | raw保持要否と実例を確認、仕様推定で補正しない | [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h052) |
| [AD-H053](#ad-h053) | 未決 | アメダス要素と地点表変更。地点表更新の自動追随なし、未知elemsを観測扱いの前提 | 地点表変更検知・気温風ゼロ地点・極値所属を追加時に確認 | [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144)、[E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h053) |
| [AD-H054](#ad-h054) | 確認待ち | アメダス風向/極値日界。独自方位変換・日集計で誤り得る | 採用表示前に公式/実例で確認 | [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37)、[G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h054) |
| [AD-H056](#ad-h056) | 未対応 | タイルキャッシュ公開境界。未検証path公開や任意上流URL受付は契約外 | 共用サービスから検証済み画像だけ配信。DB ID/pathを公開しない | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | [台帳](#ad-h056) |
| [AD-H057](#ad-h057) | 未決 | タイルの選択・部分欠け。同valid候補選択・実在XYZ・窓外保持が未決 | Fで候補/再生中固定一覧/欠け/前回時刻を決める | [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[F4 #47](https://github.com/BlueKurage119/wx-viewer-poc/issues/47)、[F7 #50](https://github.com/BlueKurage119/wx-viewer-poc/issues/50)、[F8 #51](https://github.com/BlueKurage119/wx-viewer-poc/issues/51) | [台帳](#ad-h057) |
| [AD-H058](#ad-h058) | 確認待ち | PNG完全decode・位置/凡例。完全画像健全性と地理的重ね合わせ未検証 | Fで配色/位置/zoom/凡例を実画面確認。追加検証は採否判断 | [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[F5 #48](https://github.com/BlueKurage119/wx-viewer-poc/issues/48)、[L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h058) |
| [AD-H059](#ad-h059) | 未決 | キャッシュ容量・LRU・性能。長期stale参照や低速HTTPで容量/待ち時間増大 | L2で実測し要否判断、複数processは本番別途 | [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84)、[E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | [台帳](#ad-h059) |
| [AD-H060](#ad-h060) | 未対応 | タイルファイルとDBの整合説明。旧説明を分散transaction保証と読めない | 差分台帳へ記載、保存障害時の部分成功をAPIへ返す | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)、[L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | [台帳](#ad-h060) |
| [AD-H062](#ad-h062) | 未決 | 索引周期と画面再読込頻度。画面がrefreshTimesを毎回呼ぶと契約違反 | 画面は保存catalog読込、表示更新頻度をE/Fで判断 | [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39)、[E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40)、[F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45)、[F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46)、[K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79) | [台帳](#ad-h062) |
| [AD-H063](#ad-h063) | 未決 | 全体初期化と個別復元。200空を全情報正常の保証と誤認し得る | 監視DTOで初期取得/採用/画像/地点状態を分離 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K1 #74](https://github.com/BlueKurage119/wx-viewer-poc/issues/74)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) | [台帳](#ad-h063) |
| [AD-H064](#ad-h064) | 未決 | 全体取得制御と要求識別子。manual/force/recovery/夜間/バックオフ無視の意味未決 | 全体一括・requestId結果照会・連打集約・完了時記録を設計 | [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43)、[K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) | [台帳](#ad-h064) |
| [AD-H065](#ad-h065) | 未対応 | 履歴検索と通常/訓練分離。null/訓練や巨大rawの不用意な公開 | DTO/検索条件/上限・安全診断・権限を設計 | [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77)、[K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) | [台帳](#ad-h065) |
| [AD-H066](#ad-h066) | 未決 | 通知一覧の保持範囲。保持件数・期限・過去通知再鳴動が未定義 | 表示件数と期間、cursor保持/破棄を定める | [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67)、[I2 #68](https://github.com/BlueKurage119/wx-viewer-poc/issues/68)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | [台帳](#ad-h066) |
| [AD-H067](#ad-h067) | 未決 | 訓練UI・注入権限・複数訓練。本番上書き・system状態汚染を避ける必要 | カタログ来歴/訓練ID/権限/時間変換・バッジを判断 | [J1 #69](https://github.com/BlueKurage119/wx-viewer-poc/issues/69)、[J2 #70](https://github.com/BlueKurage119/wx-viewer-poc/issues/70)、[J4 #72](https://github.com/BlueKurage119/wx-viewer-poc/issues/72)、[J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) | [台帳](#ad-h067) |
| [AD-H068](#ad-h068) | 未決 | system操作系メッセージの発生源。サービス停止と通信断を同一視できない | E11操作eventとfetch_health遷移を分離。停止検知主体を判断 | [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | [台帳](#ad-h068) |
| [AD-H069](#ad-h069) | 未対応 | H端末フィルターと二軸。initialをsystem扱いする誤除外・cursor停止 | originだけで表示除外、対象外でもcursor進行、生成保存は共通 | [K9 #82](https://github.com/BlueKurage119/wx-viewer-poc/issues/82)、[E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)、[H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64)、[L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) | [台帳](#ad-h069) |
| [AD-H070](#ad-h070) | 未対応 | 気象snapshotの鮮度評価。D7だけでは各現況staleを通知/表示に自動適用しない | 情報別の参照元・評価時刻・normal空をDTOで設計 | [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33)、[E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34)、[E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35)、[E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36)、[E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38)、[G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60)、[K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) | [台帳](#ad-h070) |
| [AD-H121](#ad-h121) | 未対応 | HTTP受信履歴とXML電文履歴の分離。K2旧本文は単一の受信履歴入口 | 入口を分け、既存B3の2種の記録を別に閲覧 | [K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75)、[K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) | [台帳](#ad-h121) |
| [AD-H122](#ad-h122) | 未決 | 電文履歴の左右ペインとカナ表示候補。カナ変換は現行parserの供給契約にない | 左右ペインを反映し、カナ表示の採否・変換根拠は着手前判断 | [K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76)、[E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) | [台帳](#ad-h122) |

## 6. E〜L 再編・文書反映計画（既存56件）

既存番号・タイトル・確定済み範囲を維持し、次表の差分を基本設計/ドラフト/投稿本文へ反映する。各行は現在未実装のUI/APIまたは将来の受入タスクであり、A〜Dの部品の存在を完成扱いしない。設計案の細部は着手前判断のまま残す。

| 識別/Issue（本文改定・番号維持） | 現在との差分・変更理由 | 新担当範囲 | 依存 | 着手前の判断/阻害範囲 | 対応H |
| --- | --- | --- | --- | --- | --- |
| [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33) | 江東区固定を会場台帳へ一般化。C3は34コードで洪水04/18未採用 | 会場別現況・正常空・補足項目のDTO | A3, A4, B2, C2, C3、C15 #109、C16 #114 | 会場受け渡し/情報別stale/未抽出補足の採用範囲（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H014](#ad-h014), [AD-H016](#ad-h016), [AD-H017](#ad-h017), [AD-H044](#ad-h044), [AD-H046](#ad-h046), [AD-H070](#ad-h070) |
| [E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34) | block/ref/区間/単位を保ちDB内部型を公開しない | 会場別警報等時系列・量的予想のDTO | A3, A4, B2, C4、C15 #109、C16 #114 | 時刻定義の公開形式・補足値・欠測とstale（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H014](#ad-h014), [AD-H017](#ad-h017), [AD-H030](#ad-h030), [AD-H048](#ad-h048), [AD-H070](#ad-h070) |
| [E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35) | 東京地方の2表と各発表時刻、明後日JST境界を維持 | near/far独立の早期注意DTO | A3, A4, B2, C5、C15 #109、C16 #114 | 各表availabilityと正常空の表現（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H014](#ad-h014), [AD-H049](#ad-h049), [AD-H070](#ad-h070) |
| [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36) | 風速階級/時間参照を保持。天気コード列と風速範囲列は未保存 | 地域時系列の区間・時点と表示入力 | A3, A4, B2, C6、C15 #109、C16 #114 | G7/G8の必須入力・追加保存要否・文字代替（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H014](#ad-h014), [AD-H046](#ad-h046), [AD-H050](#ad-h050), [AD-H051](#ad-h051), [AD-H070](#ad-h070) |
| [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37) | 江戸川臨海/羽田、取得地点の成功と最新時刻確認を分離 | 会場別アメダス観測DTO | A3, A4, B2, C9、C17 #144（両地点の定期取得）、C15 #109、C16 #114 | C17との状態境界・AQC5/6欠測・要素非提供の表現（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H008](#ad-h008), [AD-H014](#ad-h014), [AD-H052](#ad-h052), [AD-H053](#ad-h053), [AD-H054](#ad-h054) |
| [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) | VPBS3種とVPHW、direct/wide・取消null・合成IDを区別 | 会場別速報DTOと期限 | A3, A4, B2, C7, C8、C15 #109、C16 #114 | VPHW重複/目撃区域・官署等未保存項目・C7採用精度（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H014](#ad-h014), [AD-H015](#ad-h015), [AD-H017](#ad-h017), [AD-H036](#ad-h036), [AD-H043](#ad-h043), [AD-H046](#ad-h046), [AD-H047](#ad-h047), [AD-H070](#ad-h070) |
| [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39) | readCatalogは追加HTTPなし、共用NowcastServiceで画像要求 | 保存索引と画像のREST配信 | C10、C14 #24（共用サービス・周期/許可） | URL/DTO/PNG配信・N1/N2同時刻候補・更新頻度（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H014](#ad-h014), [AD-H056](#ad-h056), [AD-H059](#ad-h059), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H062](#ad-h062) |
| [E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | 共用KikikuruService、大雨/浸水/土砂を分離 | キキクル保存索引と画像のREST配信 | C11、C14 #24（共用サービス・周期/許可） | URL/DTO/画像結果・索引availability・停止許可の公開（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H014](#ad-h014), [AD-H056](#ad-h056), [AD-H059](#ad-h059), [AD-H060](#ad-h060), [AD-H061](#ad-h061), [AD-H062](#ad-h062) |
| [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41) | D5 POSTは既存。cursor/欠落防止/再試行/対象外でも進行を追加 | 通常差分と起動応答の共通store合流 | D1, D4, D5、D1-1 #103、D6 #30。D10 #145 は追加対象種別だけ依存し、現行種別の配信は先行可能 | snapshot-sequence・保持期間・202/通信再試行・表示3要素復元（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H005](#ad-h005), [AD-H006](#ad-h006), [AD-H007](#ad-h007), [AD-H022](#ad-h022), [AD-H024](#ad-h024), [AD-H066](#ad-h066), [AD-H068](#ad-h068), [AD-H069](#ad-h069) |
| [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) | 6系列健全性/情報availability/4feed readiness/採用を分離 | 保存済み監視状態と履歴のREST配信 | B3, B4, B5、C14 #24（実スケジュール）、C16 #114（会場別採用）、D5 #29（起動監査）、D7 #31（6系列健全性） | 監視DTO・安全な診断・検索上限・タイル基準・地点遅延の扱い（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H001](#ad-h001), [AD-H003](#ad-h003), [AD-H011](#ad-h011), [AD-H012](#ad-h012), [AD-H039](#ad-h039), [AD-H040](#ad-h040), [AD-H041](#ad-h041), [AD-H045](#ad-h045), [AD-H063](#ad-h063), [AD-H065](#ad-h065) |
| [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43) | 内部start/stopとB5 repoをAPIへ接続、完了時記録と結果再照会 | 全体取得制御・要求IDと操作履歴 | B5, C14 | manual/force/recovery・夜間・バックオフ・全体操作対象・認証境界（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H013](#ad-h013), [AD-H064](#ad-h064), [AD-H068](#ad-h068) |
| [F1 #44](https://github.com/BlueKurage119/wx-viewer-poc/issues/44) | east/trcのmapReferenceと台帳から対象を決める | 会場別地図の中心補正 | A1, A2 | 背景地図提供元/条件・実寸zoom・パネル遮蔽補正（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H018](#ad-h018) |
| [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45) | N1/N2を時刻だけで無条件結合せず欠けを維持 | 雨雲タイル・利用可能コマ・再生 | F1, E7 | 必要XYZ/同valid候補・保存索引再読込頻度・zoom実測（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H062](#ad-h062) |
| [F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46) | 別catalog、初回大雨、期限を実況と誤表示しない | キキクル3種表示 | F1, E8 | zoom/位置/凡例の実確認・保存索引更新頻度（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H057](#ad-h057), [AD-H058](#ad-h058), [AD-H062](#ad-h062) |
| [F4 #47](https://github.com/BlueKurage119/wx-viewer-poc/issues/47) | 再生中一覧固定・表示時刻/予測・追従状態を明示 | 時間カードと実在コマ操作 | F1 | カード実寸・操作状態・窓外コマの表現（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H057](#ad-h057) |
| [F5 #48](https://github.com/BlueKurage119/wx-viewer-poc/issues/48) | 画像の色/位置を実検証し出典を隠さない | レイヤー・凡例と出典 | F1 | 凡例対応・透過度・実データでの視認性（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H058](#ad-h058) |
| [F6 #49](https://github.com/BlueKurage119/wx-viewer-poc/issues/49) | 台帳の会場へ戻し時刻/レイヤーは変更しない | 会場へ戻るとzoom | F1 | 画面寸法変更時の中心再計算（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H018](#ad-h018) |
| [F7 #50](https://github.com/BlueKurage119/wx-viewer-poc/issues/50) | 窓外コマを別時刻に黙って置換しない | 最新追従と手動保持 | F2, F3, F4 | 保持frameが消えた時の案内・再生停止後更新（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H057](#ad-h057) |
| [F8 #51](https://github.com/BlueKurage119/wx-viewer-poc/issues/51) | 画像結果と索引staleは別、staleだけでGETを禁じない | 画像欠け・前回値・停止表示 | F2, F3 | 未取得/失敗/停止/前回画像の時刻表示（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H057](#ad-h057), [AD-H061](#ad-h061) |
| [G1 #52](https://github.com/BlueKurage119/wx-viewer-poc/issues/52) | 会場の固定対象を表示し地図移動では変えない | 会場別パネルレイアウト | A2 | 主解像度・拡大率・短い要約固定表示の採否（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H019](#ad-h019) |
| [G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53) | VPBS3hとVPHW電文期限を分離。取消nullと官署未保存に対応 | 速報全文・区域・種別別期限 | G1, E6 | 竜巻重複/付近の精度・官署表示の入力・詳細ボタン（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H007](#ad-h007), [AD-H046](#ad-h046), [AD-H047](#ad-h047) |
| [G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54) | C3段階/警戒レベル/通知区分を混同せずsemantic token使用 | 会場別警報バッジと補足 | G1, E1 | 強調時間・補足DTO・レベル5縁の実視認性・洪水未採用表示（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H020](#ad-h020), [AD-H044](#ad-h044), [AD-H046](#ad-h046) |
| [G4 #55](https://github.com/BlueKurage119/wx-viewer-poc/issues/55) | block/ref/時間定義を使い固定コマ数を仮定しない | 警報等時系列と量的予想 | G1, G10, E2 | 色/凡例・現在区間の初期位置・詳細対象区分（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H048](#ad-h048) |
| [G5 #56](https://github.com/BlueKurage119/wx-viewer-poc/issues/56) | なし/値なし/未取得を区別、両表の発表時刻を明示 | 早期注意2表と詳細結合 | G1, G10, E3 | 高/中の凡例・stale表示・共通現象だけの結合（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H049](#ad-h049) |
| [G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57) | 羽田の湿度非提供、5/6欠測、要素別isEstimated、24h未取得は明示 | 会場別アメダスと推移 | G1, G10, E5 | 風向公式対応・品質表示・未提供/欠測/通信異常の表示（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H008](#ad-h008), [AD-H009](#ad-h009), [AD-H052](#ad-h052), [AD-H053](#ad-h053), [AD-H054](#ad-h054) |
| [G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) | 風速階級の実数補間なし、E4入力から範囲表示 | 地域予報の区間/時点表 | G1, G8, E4 | 風速範囲の根拠・矢羽根/色・天気文字代替（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H046](#ad-h046), [AD-H050](#ad-h050), [AD-H051](#ad-h051) |
| [G8 #59](https://github.com/BlueKurage119/wx-viewer-poc/issues/59) | 現parserは天気文字でコード列なし。入力契約を先に決める | 天気アイコン入力と対応表の検証 | A1（Material Web導入） | 対応単位・根拠・網羅性・未対応時の文字代替（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H051](#ad-h051) |
| [G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60) | staleの前回値をDB削除や単純NGに縮退しない | 3状態と部分欠測の表示契約 | G1〜G7, A4 | 各情報の非表示/前回値/時刻・状態色の最終UI（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H022](#ad-h022), [AD-H049](#ad-h049), [AD-H070](#ad-h070) |
| [G10 #61](https://github.com/BlueKurage119/wx-viewer-poc/issues/61) | 背景操作停止・復帰・行見出し固定を共通化 | 詳細ダイアログと時間軸 | A2 | 実寸レイアウト・横スクロール・取得済み範囲表示（当該部分の設計/実装を阻害。確定部分は先行可能） | 該当なし |
| [G11 #62](https://github.com/BlueKurage119/wx-viewer-poc/issues/62) | レベル5縁を維持し通知区分の鳴動から分離 | ナビの最高危険度と速報新着 | A2, G3 | 小バッジ視認性・速報新着の表示単位（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H020](#ad-h020) |
| [H1 #63](https://github.com/BlueKurage119/wx-viewer-poc/issues/63) | semantic tokenを使い非常outlineを面に使わない | 通知区分別ヘッダー表現 | A2, D1 | 実UIの赤ヘッダーと通知同時表示の視認性（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H020](#ad-h020) |
| [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | weather/systemと最大6件を保持、resolver3要素を使用 | 通知共通storeと表示・確認 | A2, D1, D8 | 表示優先順・問いかけ中切替・件数/既読単位・操作結果との競合（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H005](#ad-h005), [AD-H006](#ad-h006), [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H021](#ad-h021), [AD-H022](#ad-h022), [AD-H023](#ad-h023), [AD-H024](#ad-h024), [AD-H066](#ad-h066), [AD-H068](#ad-h068), [AD-H069](#ad-h069) |
| [H3 #65](https://github.com/BlueKurage119/wx-viewer-poc/issues/65) | 端末内操作、受領監視は追加しない | 非常ブザーのスヌーズ | H2 | 再通知開始/期限/反復・新着/確認/スヌーズ競合（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H021](#ad-h021) |
| [H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66) | ackRequiredと確認済みを分離。D6 session維持とは別 | 端末内確認状態 | H2, H3 | reload時の表示/確認reset・保存範囲。サーバ永続化はしない（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H021](#ad-h021), [AD-H025](#ad-h025) |
| [I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) | 監視履歴とは別。個別承認/差戻/確認ボタンは設けない | 現行/直近通知の一覧 | A2, D1, E9 | 保持件数/期間・起動outputと検知notificationの対応（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H005](#ad-h005), [AD-H021](#ad-h021), [AD-H023](#ad-h023), [AD-H025](#ad-h025), [AD-H066](#ad-h066) |
| [I2 #68](https://github.com/BlueKurage119/wx-viewer-poc/issues/68) | origin/detectionContext/isTrainingを混同しない | 通知一覧フィルター | I1 | 列と条件・対象種別・期間の初期値（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H066](#ad-h066) |
| [J1 #69](https://github.com/BlueKurage119/wx-viewer-poc/issues/69) | self-contained fixtureのoriginal/derived/syntheticを区別 | 来歴付きサンプルカタログ | A2 | 採用sample/権限/一覧UI。加工を実電文と扱わない（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H055](#ad-h055), [AD-H067](#ad-h067) |
| [J2 #70](https://github.com/BlueKurage119/wx-viewer-poc/issues/70) | trainingをnormal/testと区別し、system実監視storeを汚さない | 訓練電文の通常経路注入 | J1, C2〜C8, D2〜D4 | 訓練ID・複数同時・時刻変換と権限（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H067](#ad-h067) |
| [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71) | 各parserの取消対応を確認し本番データを直接削除しない | 訓練取消投入と抹消範囲 | J2 | 論理取消/物理削除の対象・権限・履歴保持・未対応電文（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H010](#ad-h010), [AD-H043](#ad-h043) |
| [J4 #72](https://github.com/BlueKurage119/wx-viewer-poc/issues/72) | バックエンドtraining伝播済み部分を再実装せずAPI/UIへ延長 | 訓練フラグとバッジ | J2, A3, D1, B2〜B5 | バッジ具体表現・通常表示との分離（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H067](#ad-h067) |
| [J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73) | Lの実行前に除外条件を供給する。Lへの循環依存を外す | 受入から訓練を除外 | J3 #71、J4 #72（Lの実行前に完了） | J3で決めた抹消範囲と本番データ不変の検証（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H010](#ad-h010), [AD-H067](#ad-h067) |
| [K1 #74](https://github.com/BlueKurage119/wx-viewer-poc/issues/74) | 運転/健全性/情報状態/処理を別々に表示 | 監視4段レイアウト | A2, E10 | カード実寸・未評価null・状態の文字表現（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H063](#ad-h063) |
| [K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75) | 未送信で実状態を変えず要求IDで結果を再照会 | 操作選択→送信と結果。ユーザー指定（Issue #75 comment-5591790017）に従い、受信履歴（HTTP通信ログ）と電文履歴（XMLログ）の入口を分ける。取得操作は引き続き選択→送信、履歴閲覧は送信不要とする。 | K1, E11 | 操作結果と通知の優先順・timeout表示（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H023](#ad-h023), [AD-H064](#ad-h064), [AD-H121](#ad-h121) |
| [K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76) | 一覧raw除外、詳細だけ原文、会場別adoptionsを表示 | 原文と会場別採用の検索。ユーザー指定（Issue #76 comment-5591759938）に従い、左ペインに一覧、右ペインに電文を表示する。気象庁カナ形式のパース表示は「可能なら」の候補として、変換根拠・実現性・採否を着手前に判断し、未実装を供給済みと扱わない。 | K1, E10, B3 | ページング/normal既定・原文安全表示・採用精度（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H011](#ad-h011), [AD-H015](#ad-h015), [AD-H045](#ad-h045), [AD-H065](#ad-h065), [AD-H122](#ad-h122) |
| [K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) | B4 detectionContextとD5問い合わせ種別は別。実鳴動完了とはしない | 検知履歴と起動応答監査 | K1, E10, B4 | 履歴の分類・outputId/notificationId・同時複数件（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H012](#ad-h012), [AD-H023](#ad-h023), [AD-H024](#ad-h024), [AD-H025](#ad-h025), [AD-H065](#ad-h065) |
| [K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) | 操作結果と上流fetch結果を混同せずactor nullを保持 | 操作履歴表示 | K1, E10, B5 | 安全なエラー表現・不明結果の再照会（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H064](#ad-h064), [AD-H065](#ad-h065) |
| [K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79) | 索引も定期取得、画像本体に周期なし。amedas時刻/地点別 | 6系列取得状態と次回予定 | K1, E10 | tile健全性/地点検知遅れの運用表示・評価時刻/scan上限（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H001](#ad-h001), [AD-H003](#ad-h003), [AD-H041](#ad-h041), [AD-H062](#ad-h062) |
| [K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) | 片方の失敗を隠さずnear/far・各layerを展開 | 情報別反映状態 | K1, E10 | 初期化/解析失敗/stale/停止中保存値の区別（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H040](#ad-h040), [AD-H045](#ad-h045), [AD-H063](#ad-h063), [AD-H070](#ad-h070) |
| [K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81) | 問題の集約は通知生成単位とは別。最後の表示更新時刻を表示 | 現在の問題とUI更新停止 | K1, E10 | ブラウザ疎通と上流異常の区別・処理skipの採用（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H022](#ad-h022), [AD-H040](#ad-h040) |
| [K9 #82](https://github.com/BlueKurage119/wx-viewer-poc/issues/82) | 台帳のterminalModeとoriginだけで判定しcursorは進める | H端末のsystem表示除外 | A2, D8, H2 | フィルター配置。生成/保存は端末によらず共通（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H069](#ad-h069) |
| [L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | 既存shell smokeを実データUIの受入へ拡充 | 両会場の地図・パネル受入 | Epic F, Epic G | G9表示承認・実寸/色/zoom/凡例の実測条件（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H004](#ad-h004), [AD-H018](#ad-h018), [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H027](#ad-h027), [AD-H047](#ad-h047), [AD-H048](#ad-h048), [AD-H049](#ad-h049), [AD-H050](#ad-h050), [AD-H058](#ad-h058) |
| [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | 実電文と合成を区別し夜間/復旧/会場/キャッシュ/容量を確認 | 取得・保存・運用限界の受入 | Epic B, Epic C | タイル基準/地点50分・低頻度保守項目は到達性と採否を判断（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H001](#ad-h001), [AD-H003](#ad-h003), [AD-H008](#ad-h008), [AD-H009](#ad-h009), [AD-H011](#ad-h011), [AD-H012](#ad-h012), [AD-H013](#ad-h013), [AD-H015](#ad-h015), [AD-H016](#ad-h016), [AD-H017](#ad-h017), [AD-H027](#ad-h027), [AD-H028](#ad-h028), [AD-H029](#ad-h029), [AD-H030](#ad-h030), [AD-H031](#ad-h031), [AD-H032](#ad-h032), [AD-H033](#ad-h033), [AD-H034](#ad-h034), [AD-H035](#ad-h035), [AD-H036](#ad-h036), [AD-H037](#ad-h037), [AD-H041](#ad-h041), [AD-H042](#ad-h042), [AD-H043](#ad-h043), [AD-H044](#ad-h044), [AD-H045](#ad-h045), [AD-H052](#ad-h052), [AD-H053](#ad-h053), [AD-H054](#ad-h054), [AD-H055](#ad-h055), [AD-H058](#ad-h058), [AD-H059](#ad-h059), [AD-H060](#ad-h060) |
| [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) | D4/D5/D7の単位・二軸・同時件数・at-most-onceを実行確認 | 通知判定・起動出力の受入 | Epic D | 取消実例/等時刻境界・保存失敗保証・D10採用分の追加条件（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H002](#ad-h002), [AD-H007](#ad-h007), [AD-H037](#ad-h037), [AD-H038](#ad-h038), [AD-H039](#ad-h039), [AD-H042](#ad-h042), [AD-H043](#ad-h043), [AD-H044](#ad-h044) |
| [L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) | 健全性とavailability、会場別採用、3種履歴を分離 | 監視・訓練・表示除外受入 | Epic K, Epic J | E11操作契約・J3抹消範囲・ブラウザ更新停止（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H010](#ad-h010), [AD-H067](#ad-h067), [AD-H069](#ad-h069) |
| [L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) | 実際の音/確認/スヌーズ、同時通知と両モードを検証 | 通知UIの受入 | Epic H, Epic I | Hの表示単位・優先順位・期限の承認済み値（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H019](#ad-h019), [AD-H020](#ad-h020), [AD-H025](#ad-h025) |
| [L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) | 洪水キキクルと洪水警報、試験報と訓練を別に確認 | 対象外の横断確認 | L1〜L5 | 本番移行事項・未取得実例を未確認のまま記録（当該部分の設計/実装を阻害。確定部分は先行可能） | [AD-H026](#ad-h026), [AD-H042](#ad-h042), [AD-H044](#ad-h044), [AD-H071](#ad-h071) |

### 6.1 新規起票と件数

C17 #144 と D10 #145 は調査基準後の起票実績。C17は収集配線の不足をE5へ混ぜず、D10は通知生成の判断をE9配信へ混ぜないために分離した。新規設計では未決の採否を先に承認する。

| 識別 | Issue | 範囲 | 確認 |
| --- | --- | --- | --- |
| C17 | [#144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144) | 複数会場アメダス収集、共有/過去取得は設計前判断 | 起票・タイトル/本文完全一致読み戻し済み |
| D10 | [#145](https://github.com/BlueKurage119/wx-viewer-poc/issues/145) | 速報通常通知・system/竜巻起動採用の補完 | 起票・タイトル/本文完全一致読み戻し済み |

集計: A5 / B6 / C19 / D11 / E11 / F8 / G11 / H4 / I2 / J5 / K9 / L6 = **97件**。基準時はC18/D10の95件。C8-1 #118、C14-1 #130、C15 #109、C16 #114、D1-1 #103を省略しない。

## 7. 投稿本文（既存56件・新規2件）

以下を投稿用本文の正本とする。URL・既存番号を保持し、未決は着手前判断として明記する。

### E1 #33 — E1. 情報種別単位のRESTエンドポイント実装（気象警報・注意報）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2 で確定した情報種別単位のREST APIのうち、気象警報・注意報（対象会場の市町村（east: 江東区、trc: 大田区）の現況）のエンドポイントを実装する。

## 2. やること

- 対象会場の市町村（east: 江東区、trc: 大田区）の現況警報・注意報を返すエンドポイントの実装
- 共通メタ情報（source, issuedAt, validAt/From/To, fetchedAt, lastSuccessAt, availability, sourceVersion）を含めたレスポンス実装

## 3. やらないこと

- 通知用API（E9）、監視画面向けAPI（E10）

## 4. 受け入れ条件

- 対象会場の市町村（east: 江東区、trc: 大田区）の現況警報・注意報が共通メタ情報付きで取得できる
- availabilityが§6.3の定義どおりに反映される（正常な発表なしと取得不能が区別される）

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C2, C3、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 江東区固定を会場台帳へ一般化。C3は34コードで洪水04/18未採用。

**今回の担当範囲**: 会場別現況・正常空・補足項目のDTO。

**着手前に決める事項**: 会場受け渡し/情報別stale/未抽出補足の採用範囲。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H014, AD-H016, AD-H017, AD-H044, AD-H046, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C2, C3、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E2 #34 — E2. 情報種別単位のRESTエンドポイント実装（警報等時系列）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §5.8 に基づき、警報等時系列（VPWP50由来）のエンドポイントを実装する。

## 2. やること

- 対象会場の市町村（east: 江東区、trc: 大田区）の警報等時系列データを返すエンドポイントの実装
- 共通メタ情報を含めたレスポンス実装

## 3. やらないこと

- パネル表示（Epic G4）

## 4. 受け入れ条件

- 対象会場の市町村（east: 江東区、trc: 大田区）の警報等時系列データが共通メタ情報付きで取得できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §5.8](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C4、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: block/ref/区間/単位を保ちDB内部型を公開しない。

**今回の担当範囲**: 会場別警報等時系列・量的予想のDTO。

**着手前に決める事項**: 時刻定義の公開形式・補足値・欠測とstale。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H014, AD-H017, AD-H030, AD-H048, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C4、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E3 #35 — E3. 情報種別単位のRESTエンドポイント実装（警報級の可能性）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §5.9 に基づき、警報級の可能性（早期注意情報、VPFD61/VPFW60由来）のエンドポイントを実装する。

## 2. やること

- 東京地方の警報級の可能性データを返すエンドポイントの実装
- 「なし」「値なし」「未取得」の区別を保ったレスポンス実装

## 3. やらないこと

- パネル表示（Epic G5）

## 4. 受け入れ条件

- 東京地方の警報級の可能性データが共通メタ情報付きで取得できる
- 「なし」と「値なし」がAPIレスポンス上でも区別されている

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §5.9](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C5、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 東京地方の2表と各発表時刻、明後日JST境界を維持。

**今回の担当範囲**: near/far独立の早期注意DTO。

**着手前に決める事項**: 各表availabilityと正常空の表現。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H014, AD-H049, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C5、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E4 #36 — E4. 情報種別単位のRESTエンドポイント実装（地域時系列予報）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §5.11 に基づき、地域時系列予報（VPFD51由来）のエンドポイントを実装する。

## 2. やること

- 東京地方の天気・風、東京地点の気温を返すエンドポイントの実装
- 共通メタ情報を含めたレスポンス実装

## 3. やらないこと

- パネル表示（Epic G7）

## 4. 受け入れ条件

- 天気・風（東京地方）、気温（東京地点）が共通メタ情報付きで取得できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §5.11](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C6、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 風速階級/時間参照を保持。天気コード列と風速範囲列は未保存。

**今回の担当範囲**: 地域時系列の区間・時点と表示入力。

**着手前に決める事項**: G7/G8の必須入力・追加保存要否・文字代替。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H014, AD-H046, AD-H050, AD-H051, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C6、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E5 #37 — E5. 情報種別単位のRESTエンドポイント実装（アメダス）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §5.10 に基づき、アメダス（対象会場の観測所（east: 江戸川臨海、trc: 羽田））のエンドポイントを実装する。

## 2. やること

- 対象会場の観測所（east: 江戸川臨海、trc: 羽田）の観測データ（気温・湿度・風向・風速・直近1時間降水量等）を返すエンドポイントの実装
- 欠測・観測非対応・通信異常の3区分を保ったレスポンス実装

## 3. やらないこと

- パネル表示・詳細ダイアログ（Epic G6）

## 4. 受け入れ条件

- 対象会場の観測所（east: 江戸川臨海、trc: 羽田）の観測データが共通メタ情報付きで取得できる
- 欠測・観測非対応・通信異常がAPIレスポンス上で区別されている

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §5.10](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C9、C17 #144（両地点の定期取得）、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 江戸川臨海/羽田、取得地点の成功と最新時刻確認を分離。

**今回の担当範囲**: 会場別アメダス観測DTO。

**着手前に決める事項**: C17との状態境界・AQC5/6欠測・要素非提供の表現。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H008, AD-H014, AD-H052, AD-H053, AD-H054 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C9、C17 #144（両地点の定期取得）、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E6 #38 — E6. 情報種別単位のRESTエンドポイント実装（気象防災速報）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §5.6 に基づき、気象防災速報（VPBS50・竜巻関連VPHW50/51由来）のエンドポイントを実装する。

## 2. やること

- 対象会場の市町村（east: 江東区、trc: 大田区）を対象とする情報、および対象会場の市町村（east: 江東区、trc: 大田区）を含む広域情報を返すエンドポイントの実装
- VPBS50由来の速報と竜巻関連速報を統合したレスポンス実装（広域速報は元の対象区域名を表示）

## 3. やらないこと

- パネル表示（Epic G2）

## 4. 受け入れ条件

- 対象会場の市町村（east: 江東区、trc: 大田区）対象・広域対象の速報が区域名付きで取得できる
- 竜巻関連の速報も同じエンドポイントで取得できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §5.6](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E6）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A3, A4, B2, C7, C8、C15 #109、C16 #114。

## Issue #139 の棚卸し反映

**現在の実装との差分**: VPBS3種とVPHW、direct/wide・取消null・合成IDを区別。

**今回の担当範囲**: 会場別速報DTOと期限。

**着手前に決める事項**: VPHW重複/目撃区域・官署等未保存項目・C7採用精度。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H014, AD-H015, AD-H017, AD-H036, AD-H043, AD-H046, AD-H047, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A3, A4, B2, C7, C8、C15 #109、C16 #114。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E7 #39 — E7. レーダー（ナウキャスト）タイル配信エンドポイント

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §4章 に基づき、雨雲ナウキャストの時刻一覧・タイル画像を配信するエンドポイントを実装する。

## 2. やること

- 時刻一覧（実在フレームのみ）を返すエンドポイントの実装
- タイル画像の配信エンドポイントの実装（C10で取得したタイルをキャッシュ経由で配信）

## 3. やらないこと

- フロント側の地図UI実装（Epic F2, F4）

## 4. 受け入れ条件

- 実在する時刻一覧のみが返される
- タイル画像が取得・配信できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §4章](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E7）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: C10、C14 #24（共用サービス・周期/許可）。

## Issue #139 の棚卸し反映

**現在の実装との差分**: readCatalogは追加HTTPなし、共用NowcastServiceで画像要求。

**今回の担当範囲**: 保存索引と画像のREST配信。

**着手前に決める事項**: URL/DTO/PNG配信・N1/N2同時刻候補・更新頻度。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H014, AD-H056, AD-H059, AD-H060, AD-H061, AD-H062 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: C10、C14 #24（共用サービス・周期/許可）。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E8 #40 — E8. キキクルタイル配信エンドポイント

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §6.2, §4章 に基づき、キキクル（大雨・浸水・土砂）の時刻一覧・タイル画像を配信するエンドポイントを実装する。

## 2. やること

- キキクル種別ごとの時刻一覧を返すエンドポイントの実装
- タイル画像の配信エンドポイントの実装（C11で取得したタイルをキャッシュ経由で配信）

## 3. やらないこと

- 洪水キキクルの配信（§4.2で対象外と確定済み）
- フロント側の地図UI実装（Epic F3）

## 4. 受け入れ条件

- 大雨・浸水・土砂の時刻一覧・タイル画像が取得・配信できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2）

## 6. 備考

参照: [docs/basic-design.md §6.2, §4章](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E8）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: C11、C14 #24（共用サービス・周期/許可）。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 共用KikikuruService、大雨/浸水/土砂を分離。

**今回の担当範囲**: キキクル保存索引と画像のREST配信。

**着手前に決める事項**: URL/DTO/画像結果・索引availability・停止許可の公開。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H014, AD-H056, AD-H059, AD-H060, AD-H061, AD-H062 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: C11、C14 #24（共用サービス・周期/許可）。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E9 #41 — E9. 通知用API（起動時現況取得・通常ポーリング用差分取得）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §7.3, §7.7 に基づき、通知用データを配信するAPI（起動時現況取得・通常ポーリング用差分取得）を実装する。

## 2. やること

- 既存 POST /api/notifications/startup の応答を共通通知 store へ合流する。エンドポイントを重複作成しない
- 通常ポーリング用の新着通知取得エンドポイントの実装

## 3. やらないこと

- 監視画面向けAPI（E10）
- 通知判定ロジック自体（Epic D）

## 4. 受け入れ条件

- 起動時現況取得エンドポイントがD5の仕様どおりに応答する
- 通常ポーリングで新着通知のみを取得できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う（§6.2, §7.3）

## 6. 備考

参照: [docs/basic-design.md §7.3, §7.7](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E9）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: D1, D4, D5、D1-1 #103、D6 #30。D10 #145 は追加対象種別だけ依存し、現行種別の配信は先行可能。

## Issue #139 の棚卸し反映

**現在の実装との差分**: D5 POSTは既存。cursor/欠落防止/再試行/対象外でも進行を追加。

**今回の担当範囲**: 通常差分と起動応答の共通store合流。

**着手前に決める事項**: snapshot-sequence・保持期間・202/通信再試行・表示3要素復元。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H005, AD-H006, AD-H007, AD-H022, AD-H024, AD-H066, AD-H068, AD-H069 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: D1, D4, D5、D1-1 #103、D6 #30。D10 #145 は追加対象種別だけ依存し、現行種別の配信は先行可能。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E10 #42 — E10. 監視画面向けAPI（稼働状態・履歴取得）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8章 に基づき、監視画面（3.3）向けの稼働状態・履歴取得APIを実装する。

## 2. やること

- 全体状態・取得元別稼働状況・情報別反映状況・現在の異常を返すエンドポイントの実装
- 受信履歴・通知出力履歴・操作記録の一覧・検索エンドポイントの実装
- 情報を取得するためにこの画面から外部へ追加ポーリングせず、サーバーが保持する監視情報を返す実装（§8.2）

## 3. やらないこと

- 取得制御API（開始・停止・強制更新、E11で別途扱う）
- 監視画面UI自体（Epic K）

## 4. 受け入れ条件

- 全体状態・取得元別稼働状況・情報別反映状況・現在の異常が取得できる
- 受信履歴・通知出力履歴・操作記録が検索条件付きで取得できる

## 5. 未決事項

- URLパス・HTTPメソッド・型定義の確定は設計段階で承認後に行う

## 6. 備考

参照: [docs/basic-design.md §8章](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E10）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: B3, B4, B5、C14 #24（実スケジュール）、C16 #114（会場別採用）、D5 #29（起動監査）、D7 #31（6系列健全性）。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 6系列健全性/情報availability/4feed readiness/採用を分離。

**今回の担当範囲**: 保存済み監視状態と履歴のREST配信。

**着手前に決める事項**: 監視DTO・安全な診断・検索上限・タイル基準・地点遅延の扱い。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H001, AD-H003, AD-H011, AD-H012, AD-H039, AD-H040, AD-H041, AD-H045, AD-H063, AD-H065 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: B3, B4, B5、C14 #24（実スケジュール）、C16 #114（会場別採用）、D5 #29（起動監査）、D7 #31（6系列健全性）。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### E11 #43 — E11. 取得制御API（開始・停止・強制更新、要求識別子による重複防止）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.1, §8.2 に基づき、監視画面から送信する取得開始・取得停止・強制更新の操作を受け付けるAPIを実装する。

## 2. やること

- 取得開始・取得停止・強制更新の各操作を受け付けるエンドポイントの実装
- 要求識別子による重複防止の実装（開始要求の重複で取得ジョブを増やさない）
- 強制更新の同時実行集約の実装
- 操作結果をB5（操作記録テーブル）へ記録する処理
- タイムアウト等で結果不明の場合、同じ要求識別子で結果を照会できるエンドポイントの実装

## 3. やらないこと

- 監視画面のツールバーUI（Epic K2）
- 取得元単位の個別操作（§8.2で今回は全体一括操作のみと確定済み）

## 4. 受け入れ条件

- 開始・停止・強制更新の各操作が要求識別子付きで受け付けられる
- 同じ要求識別子での重複実行がジョブを増やさないことがテストで確認できる
- 操作結果がB5の操作記録テーブルに記録される

## 5. 未決事項

- 操作者認証はAuthGate連携に委ね、本タスクでは規定しない（§8.2）

## 6. 備考

参照: [docs/basic-design.md §8.1, §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（E11）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: B5, C14。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 内部start/stopとB5 repoをAPIへ接続、完了時記録と結果再照会。

**今回の担当範囲**: 全体取得制御・要求IDと操作履歴。

**着手前に決める事項**: manual/force/recovery・夜間・バックオフ・全体操作対象・認証境界。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H013, AD-H064, AD-H068 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: B5, C14。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F1 #44 — F1. 地図コンポーネント基盤（背景地図・東京ビッグサイト中心点算出）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、対象端末の会場を中心とした地図の初期表示・中心点算出方法を実装する。

**着手順の参考:** 基本設計 §1 で、C109（12月・冬季開催）向けには本Epic（夏季降雨系のナウキャスト・キキクル表示の土台となる地図機能）の優先度を下げる方針が示されている。

## 2. やること

- 背景地図コンポーネントの実装（地名と行政界が読める淡色地図を第一案とする）
- 中心点算出ロジックの実装: 地図領域のうち右側情報パネル幅と下部の時間操作カード高さを差し引いた矩形を求め、その矩形の中心に対象会場の mapReference が来るよう地図中心をずらす
- 対象会場の常設マーカー、対応する市町村境界の細線表示
- PCでのドラッグ移動・ホイール／＋－ボタンでの拡大縮小の実装

## 3. やらないこと

- ナウキャスト・キキクルレイヤーの表示（F2, F3）
- 時間操作カード自体のUI（F4）

## 4. 受け入れ条件

- 初期表示で対象会場の mapReference が、右パネル幅・下部カード高さを除いた表示領域の中心に来る
- ドラッグ・ホイール・＋－ボタンで地図を操作できる
- 対象会場のマーカーと対応する市町村境界が表示される

## 5. 未決事項

- 背景地図の配信元・利用条件は採用時に確認する（§4.3）
- 数値のズームの具体的な調整（実装時に調整、§4.3）

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A1, A2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: east/trcのmapReferenceと台帳から対象を決める。

**今回の担当範囲**: 会場別地図の中心補正。

**着手前に決める事項**: 背景地図提供元/条件・実寸zoom・パネル遮蔽補正。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H018 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A1, A2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F2 #45 — F2. ナウキャスト（雨雲）レイヤーの表示・時間操作

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.1〜§4.3 で確定した、雨雲ナウキャストの表示を実装する。初期表示レイヤーとする。

## 2. やること

- 雨雲ナウキャストタイルの表示（E7のAPIから取得）
- 過去60分〜未来60分の表示窓、実際に取得できるコマのみの使用
- 再生（利用可能コマを古い順に約1秒間隔で繰り返す）の実装
- 最新追従モードでの表示時刻自動更新（F7と連携）

## 3. やらないこと

- キキクルレイヤー（F3）
- 時間操作カードUI自体（F4）

## 4. 受け入れ条件

- 初期表示が雨雲ナウキャストになる
- 表示窓が過去60分〜未来60分に収まり、欠けたコマが補間されずに表示される
- 再生操作でコマが古い順に約1秒間隔で切り替わる

## 5. 未決事項

- 雷・竜巻ナウキャスト等の追加レイヤーは今回対象外（未確定、§4.2）

## 6. 備考

参照: [docs/basic-design.md §4.1〜§4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F1, E7。

## Issue #139 の棚卸し反映

**現在の実装との差分**: N1/N2を時刻だけで無条件結合せず欠けを維持。

**今回の担当範囲**: 雨雲タイル・利用可能コマ・再生。

**着手前に決める事項**: 必要XYZ/同valid候補・保存索引再読込頻度・zoom実測。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H057, AD-H058, AD-H062 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F1, E7。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F3 #46 — F3. キキクル（大雨・浸水・土砂）レイヤーの表示・種別切替

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.2, §4.3 で確定した、キキクル（大雨・浸水・土砂）の表示・種別切替を実装する。

**着手順の参考:** 基本設計 §1 で、C109（冬季開催）向けには夏季降雨系機能（本タスクを含む）の優先度を下げる方針が示されている。

## 2. やること

- キキクル種別選択UI（大雨・浸水・土砂の3種）の実装
- 初回切り替え時に大雨（統合表示）を初期選択とし、以降は選択した種別を画面内で保持する実装
- レイヤー切り替え時に中心・ズームを保持し、再生を停止して最新時刻を表示する実装

## 3. やらないこと

- 洪水キキクルの表示（§4.2で対象外と確定済み）
- ナウキャストレイヤー（F2）

## 4. 受け入れ条件

- キキクルへの初回切り替え時に大雨（統合表示）が選択される
- 種別を切り替えても地図中心・ズームが保持される
- 切り替え直後は再生停止・最新時刻表示になる

## 5. 未決事項

下記「着手前に決める事項」を参照。洪水キキクルは対象外として確定済み

## 6. 備考

参照: [docs/basic-design.md §4.2, §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F1, E8。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 別catalog、初回大雨、期限を実況と誤表示しない。

**今回の担当範囲**: キキクル3種表示。

**着手前に決める事項**: zoom/位置/凡例の実確認・保存索引更新頻度。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H057, AD-H058, AD-H062 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F1, E8。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F4 #47 — F4. 時間操作カード（プレーヤー型UI）の実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、動画プレーヤーのようなコンパクトなカード形式の時間操作UIを実装する。

## 2. やること

- 右側情報パネルを除いた地図領域の下部中央に常設する時間操作カードの実装
- 上段: 選択レイヤー名と表示日時・状態
- 中段: 時刻スライダー
- 下段: 前コマ／再生・停止／次コマと「最新へ」ボタン
- 実況／予測の区別、最新追従中か過去等を選択中かの常時表示

## 3. やらないこと

- レイヤー選択ボタン・凡例開閉UI（F5）
- ズーム・「会場へ戻る」ボタン（F6）

## 4. 受け入れ条件

- 時間操作カードが地図領域下部中央に常設表示される
- スライダー操作でコマを選択でき、前コマ／再生停止／次コマ／最新への各操作ができる
- 選択レイヤー名・表示日時・実況/予測の区別・追従状態が常時表示される

## 5. 未決事項

- 具体的な幅・レイアウトの微調整は画面設計段階で承認後に行う（§4.3）

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 再生中一覧固定・表示時刻/予測・追従状態を明示。

**今回の担当範囲**: 時間カードと実在コマ操作。

**着手前に決める事項**: カード実寸・操作状態・窓外コマの表現。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H057 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F5 #48 — F5. レイヤー選択ボタン・凡例開閉UIの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、地図領域左上のレイヤー選択ボタンと凡例開閉UIを実装する。

## 2. やること

- 地図領域左上のレイヤー選択ボタンの実装（選択メニューを開く）
- レイヤーの濃さ・凡例の開閉を同じメニューにまとめる実装
- 凡例の初期表示、閉じた場合の再表示ボタンの実装
- 出典の常時表示

## 3. やらないこと

- 時間操作カード自体（F4には入れない、§4.3で確定）

## 4. 受け入れ条件

- レイヤー選択ボタンから、レイヤーの濃さと凡例開閉を操作できる
- 凡例を閉じても再表示ボタンが残る
- 出典が常時表示される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 画像の色/位置を実検証し出典を隠さない。

**今回の担当範囲**: レイヤー・凡例と出典。

**着手前に決める事項**: 凡例対応・透過度・実データでの視認性。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H058 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F6 #49 — F6. ズーム・「会場へ戻る」ボタンの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、地図領域左下のズーム・「会場へ戻る」ボタンを実装する。

## 2. やること

- 地図領域左下に＋／－ボタンを縦配置する実装
- 「会場へ戻る」ボタンの実装（F1で確定した初期中心・画角に戻す。時刻とレイヤーは変更しない）
- ナビレールとは別の操作群として余白を設ける

## 3. やらないこと

- 時間操作カード（F4）、レイヤー選択（F5）

## 4. 受け入れ条件

- ＋／－ボタンで地図を拡大縮小できる
- 「会場へ戻る」を押すと初期中心・画角に戻り、時刻・レイヤー選択は変更されない

## 5. 未決事項

- 画面幅・右パネル幅・下部カード高さが変化しうる場合の中心点再計算方法（画面実装時に定める、§4.3）

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F6）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 台帳の会場へ戻し時刻/レイヤーは変更しない。

**今回の担当範囲**: 会場へ戻るとzoom。

**着手前に決める事項**: 画面寸法変更時の中心再計算。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H018 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F7 #50 — F7. 最新追従モードと手動時刻選択の切替ロジック

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、最新追従中の自動時刻更新と、手動時刻選択時の追従停止ロジックを実装する。

## 2. やること

- 最新追従中のみ、新しいデータの取得に合わせて表示時刻を進める実装
- 手動で時刻を選択したら追従を止め、「最新へ」を押すまで選択時刻を保持する実装
- 最新追従中でも地図中心・ズームは変更しない実装（「最新へ」は時刻のみ、「会場へ戻る」は画角のみを変更する）
- 選択中の時刻が提供範囲外になった場合、状態を明示して「最新へ」を案内する実装（別時刻へ無表示で置き換えない）

## 3. やらないこと

- タイル取得失敗時の表示（F8）

## 4. 受け入れ条件

- 最新追従中に新しいコマが取得されると表示時刻が自動的に進む
- 手動で時刻を選択すると追従が止まり、「最新へ」を押すまで選択時刻が保持される
- 「最新へ」で時刻のみ、「会場へ戻る」で画角のみが変更されることがテストで確認できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F7）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F2, F3, F4。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 窓外コマを別時刻に黙って置換しない。

**今回の担当範囲**: 最新追従と手動保持。

**着手前に決める事項**: 保持frameが消えた時の案内・再生停止後更新。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H057 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F2, F3, F4。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### F8 #51 — F8. タイル取得失敗時の状態表示（欠けコマ・前回値表示）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §4.3 で確定した、タイル未取得部分の状態明示を実装する。

## 2. やること

- タイル未取得部分の状態を明示する実装（降水・危険度なしと誤認させない）
- 取得失敗で以前の画像を残す場合、その画像の時刻と前回値表示であることを明示する実装

## 3. やらないこと

- タイル取得処理自体（バックエンド側、C10, C11で実装済み）

## 4. 受け入れ条件

- タイル未取得の状態が、降水・危険度なしと区別できる形で表示される
- 前回値を表示している場合、その時刻と前回値である旨が明示される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §4.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（F8）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: F2, F3。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 画像結果と索引staleは別、staleだけでGETを禁じない。

**今回の担当範囲**: 画像欠け・前回値・停止表示。

**着手前に決める事項**: 未取得/失敗/停止/前回画像の時刻表示。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H057, AD-H061 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: F2, F3。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G1 #52 — G1. 右側情報パネルの共通レイアウト・スクロール制御

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.2, §5.3 で確定した、右側情報パネルの配置順と共通レイアウトを実装する。以降の各パネル実装（G2〜G7）の土台となる。

## 2. やること

- 配置順（気象防災速報→警報・注意報→警報等時系列→警報級の可能性→アメダス→地域時系列予報）に沿ったレイアウト実装
- 右側パネル列全体の縦スクロール制御（地図・操作メニューは継続して操作できる構成）
- 情報種別の配置順を原則固定する実装（新着・変更箇所の位置変更を避ける）

## 3. やらないこと

- 各パネルの中身の実装（G2〜G7）
- 詳細ダイアログ共通コンポーネント（G10）

## 4. 受け入れ条件

- 右側パネルが§5.2の順序で表示される
- パネル列を縦スクロールしても地図・操作メニューが操作できる
- 5.1で確定した対象（対象会場の市町村（east: 江東区、trc: 大田区）／東京地方／東京（北の丸公園）／対象会場の観測所（east: 江戸川臨海、trc: 羽田）等）が地図の移動・レイヤー切り替えで変化しない

## 5. 未決事項

- 右側上部に警報・新着の短い要約を固定表示する案（§5.3で検討中）

## 6. 備考

参照: [docs/basic-design.md §5.1, §5.2, §5.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 会場の固定対象を表示し地図移動では変えない。

**今回の担当範囲**: 会場別パネルレイアウト。

**着手前に決める事項**: 主解像度・拡大率・短い要約固定表示の採否。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H019 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G2 #53 — G2. 気象防災速報パネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.5, §5.6 で確定した、気象防災速報パネル（線状降水帯発生・直前予測、記録的短時間大雨、竜巻関連）を実装する。

## 2. やること

- 標題、対象区域、発表時刻・経過時間、速報文全文の表示（要約と本文への機械的分割はしない）
- VPBS50 の3種は発表後3時間、VPHW50/51 は電文明示期限まで表示（表示期間を利用者が変更する設定は設けない）
- 複数件同時発表時は発表時刻の新しい順に並べる実装
- パネル自体の新着強調は行わない（ナビレールのバッジで気付ける設計、G11と連携）

## 3. やらないこと

- 短時間大雪の速報表示（§5.12で対象外と確定済み）
- VPBS51（潮位速報）の表示（対象外と確定済み）
- 詳細ダイアログ内での履歴表示（履歴は監視画面に集約、§5.6）

## 4. 受け入れ条件

- VPBS50 の3種と VPHW50/51 それぞれの期限で表示される
- 複数件が発表時刻の新しい順に並ぶ
- 発表官署が補助表示として区別される

## 5. 未決事項

- 詳細ボタンは追加で見せる情報がある場合に限り設ける（§5.6）

## 6. 備考

参照: [docs/basic-design.md §5.5, §5.6](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, E6。

## Issue #139 の棚卸し反映

**現在の実装との差分**: VPBS3hとVPHW電文期限を分離。取消nullと官署未保存に対応。

**今回の担当範囲**: 速報全文・区域・種別別期限。

**着手前に決める事項**: 竜巻重複/付近の精度・官署表示の入力・詳細ボタン。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H007, AD-H046, AD-H047 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, E6。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G3 #54 — G3. 警報・注意報パネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.7 で確定した、対象会場の市町村（east: 江東区、trc: 大田区）の警報・注意報現況パネルを実装する。

## 2. やること

- 見出し「気象警報・注意報」、対象会場の市町村名（江東区または大田区）の補助ラベル表示
- 見出し直下に、対象地域の現況に反映した発表時刻を表示
- バッジ群の実装: 危険度カラー（黒/紫/赤/黄）と文字でレベル・現象を表示
- バッジ短縮表記の実装（「レベル3大雨警報」等、警戒レベルを持つ種別は「レベルN＋正式名称」、レベルを冠さない種別は正式名称のみ）
- 特別警報→危険警報→警報→注意報の順、同段階内は§7.4コード表の固定順で並べる実装
- 新規・強化・緩和があった行の補助表示

## 3. やらないこと

- 承認／差戻ボタン・行ごとの確認操作（§3.2で別ビューとして分離、本パネルには設けない）
- 詳細ダイアログの実装（G10で共通コンポーネントとして扱う）

## 4. 受け入れ条件

- バッジが§5.7の配色・段階順・短縮表記のルールどおりに表示される
- 解除された行が現況から外れ、残る発表中情報は表示され続ける
- 全件が正常に発表なしと確認できた場合、パネル自体が省略される（取得状態は別途確認できる場所に残る）

## 5. 未決事項

- 更新の補助表示（新規・強化・緩和）の強調保持時間（§5.7で未確定）

## 6. 備考

参照: [docs/basic-design.md §5.7](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, E1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: C3段階/警戒レベル/通知区分を混同せずsemantic token使用。

**今回の担当範囲**: 会場別警報バッジと補足。

**着手前に決める事項**: 強調時間・補足DTO・レベル5縁の実視認性・洪水未採用表示。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H020, AD-H044, AD-H046 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, E1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G4 #55 — G4. 警報等時系列パネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.8, §5.13 で確定した、対象会場の市町村（east: 江東区、trc: 大田区）の警報等時系列パネルを実装する。

## 2. やること

- 発表時刻の下に、縦軸を現象、横軸を時間帯とする危険度の色分け表の実装
- 対象現象は電文（VPWP50）に含まれる現象のみを表示する実装（固定リストを仮定しない）
- 行の順序を§5.7で確定した段階内固定順（暴風雪→大雨→洪水→暴風→大雪→波浪→高潮→土砂災害）に揃える実装
- 詳細ダイアログ（雨量・風等の量的予想、単位・対象区分の明記）の実装

## 3. やらないこと

- 履歴表示（履歴は監視画面に集約）

## 4. 受け入れ条件

- 電文に含まれる現象のみが行として表示される（固定リストではない）
- 行の順序が§5.7の段階内固定順に従う
- 詳細ダイアログで雨量・風等の量的予想が単位・対象区分付きで確認できる

## 5. 未決事項

- 表示時間範囲・横幅超過時の扱いは§5.13の一般方針に従う

## 6. 備考

参照: [docs/basic-design.md §5.8, §5.13](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, G10, E2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: block/ref/時間定義を使い固定コマ数を仮定しない。

**今回の担当範囲**: 警報等時系列と量的予想。

**着手前に決める事項**: 色/凡例・現在区間の初期位置・詳細対象区分。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H048 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, G10, E2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G5 #56 — G5. 警報級の可能性パネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.9, §5.13 で確定した、東京地方の警報級の可能性パネルを実装する。

## 2. やること

- 発表時刻の下に、縦軸を現象、横軸を時間帯・日付とする表の実装
- 「なし」（セルに「－」）、「値なし」（セルは空白）、未取得・取得不能（表自体を非表示）の3区分の実装
- 明後日まで／明々後日以降を別表のまま表示する実装（§5.9で確定）
- 詳細ダイアログでは共通する現象を1つの表に結合して時間軸を通しで表示する実装

## 3. やらないこと

- 独自の「低確率」や数値確率への置き換え（§5.9で明確に禁止されている）

## 4. 受け入れ条件

- 「なし」「値なし」「未取得」がそれぞれ§5.9の表示ルールどおりに区別される
- 明後日まで／明々後日以降が別表として表示される
- 詳細ダイアログで共通現象が1つの表に結合され、通しの時間軸で表示される

## 5. 未決事項

- 凡例の具体的表現（「高」「中」「－」の色・文言）は実装時に定める（§5.9）

## 6. 備考

参照: [docs/basic-design.md §5.9, §5.13](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, G10, E3。

## Issue #139 の棚卸し反映

**現在の実装との差分**: なし/値なし/未取得を区別、両表の発表時刻を明示。

**今回の担当範囲**: 早期注意2表と詳細結合。

**着手前に決める事項**: 高/中の凡例・stale表示・共通現象だけの結合。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H049 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, G10, E3。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G6 #57 — G6. アメダスパネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.10, §5.13 で確定した、対象会場の観測所（east: 江戸川臨海、trc: 羽田）のアメダスパネルを実装する。

## 2. やること

- 選択会場の観測所名と観測時刻の明示（江戸川臨海または羽田）
- 気温（℃）、湿度（%）、風向（方位名）、風速（m/s）、直近1時間の降水量（mm、集計期間の明記）の表示
- 欠測・観測非対応・通信異常の3区分の表示（0として表示しない）
- 詳細ダイアログ（直近24時間の気温・湿度・風速の折れ線、1時間降水量の棒グラフ、風向は対応時刻の値を参照可能にする）の実装

## 3. やらないこと

- AQC 1/4等の品質注記の表示分岐（AQC 5/6を欠測相当とする既決例外は維持する）

## 4. 受け入れ条件

- 対象会場の観測所（east: 江戸川臨海、trc: 羽田）の観測時刻とともに提供される気温・湿度・風向・風速・直近1時間降水量が表示され、羽田の湿度などの非提供要素は値を要求せず「非提供」と明示される
- 欠測・観測非対応・通信異常が区別して表示される
- 詳細ダイアログで24時間推移が確認できる（欠測区間は補間しない）

## 5. 未決事項

- 詳細ダイアログの期間選択は初期版では設けない（§5.13）

## 6. 備考

参照: [docs/basic-design.md §5.10, §5.13](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G6）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, G10, E5。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 羽田の湿度非提供、5/6欠測、要素別isEstimated、24h未取得は明示。

**今回の担当範囲**: 会場別アメダスと推移。

**着手前に決める事項**: 風向公式対応・品質表示・未提供/欠測/通信異常の表示。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H008, AD-H009, AD-H052, AD-H053, AD-H054 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, G10, E5。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G7 #58 — G7. 地域時系列予報パネルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.11, §5.13 で確定した、地域時系列予報パネル（天気・風：東京地方、気温：東京（北の丸公園））を実装する。

## 2. やること

- 天気・風（3時間区間）と気温（3時間ごと時点値）で列（時刻軸）を共有する表の実装
- 天気・風は区間幅に応じてセルを結合、気温は各列に時点値をそのまま配置する実装
- 区間値と時点値の違いを列見出しの時刻表記（「9-12時」「9時」等）で区別する実装
- 風速の矢羽根（風向アイコン）＋階級に応じた色分け＋m/s範囲の併記の実装

## 3. やらないこと

- 天気アイコンのMaterial Symbols対応表の作成・検証（G8で別途扱う）

## 4. 受け入れ条件

- 天気・風・気温が列を共有した表で表示され、区間値と時点値が列見出しで区別できる
- 風速が電文の階級（1〜6）をそのまま使い、矢羽根＋色分け＋範囲表記で表示される（m/sの実数変換・補間はしない）

## 5. 未決事項

- 天気アイコンの具体的な対応（G8の検証結果に依存）

## 6. 備考

参照: [docs/basic-design.md §5.11, §5.13](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G7）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1, G8, E4。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 風速階級の実数補間なし、E4入力から範囲表示。

**今回の担当範囲**: 地域予報の区間/時点表。

**着手前に決める事項**: 風速範囲の根拠・矢羽根/色・天気文字代替。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H046, AD-H050, AD-H051 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1, G8, E4。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G8 #59 — G8. 天気アイコン対応表の検証・実装（Material Symbols）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.11 で検討中とされている、現行parserが保持する天気文字と、採用時に根拠確認する天気コードとMaterial Symbols（Material Web採用に伴う標準アイコンセット）の対応を検証・実装する。

## 2. やること

- 現行parserが保持する天気文字と、採用時に根拠確認する天気コードとMaterial Symbolsの対応表の作成
- 対応表の網羅性・粒度の検証
- 対応が難しい天気コードがある場合の代替表現（近似アイコン、文字表示への切り替え等）の実装

## 3. やらないこと

- 地域時系列予報パネル自体のレイアウト実装（G7で扱う）

## 4. 受け入れ条件

- E4で合意した天気の入力に対して、Material Symbolsのアイコンまたは代替表現が表示される
- 対応できないコードについて、明示的な代替表現（近似アイコンまたは文字表示）が用意されている

## 5. 未決事項

- 対応表の網羅性・粒度は実装時の検証事項（§5.11）

## 6. 備考

参照: [docs/basic-design.md §5.11](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G8）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A1（Material Web導入）。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 現parserは天気文字でコード列なし。入力契約を先に決める。

**今回の担当範囲**: 天気アイコン入力と対応表の検証。

**着手前に決める事項**: 対応単位・根拠・網羅性・未対応時の文字代替。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H051 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A1（Material Web導入）。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G9 #60 — G9. 各パネル共通：取得状態表示（取得中/取得できません/一部未確認）の実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.12 の設計案に基づき、各情報パネル共通の取得状態表示を実装する。

## 2. やること

- available / stale / unavailable・正常空・部分欠測の表示表を情報種別ごとに整理する。
- §5.12 の非表示案と前回値保持の扱いは未決のまま設計時に判断し、承認後に UI を実装する。
- 前回正常値を削除せず、値・鮮度・通信状態を別々に扱う。

## 3. やらないこと

- バックエンド側のavailability判定ロジック自体（A4で実装済みの状態を利用する）

## 4. 受け入れ条件

- 取得中・取得失敗・一部未確認の状態がパネルごとに設計承認された状態別表示表どおりに表示される
- 一部セルのみ欠測の場合、そのセルだけ「—」表示になり他の情報は表示され続ける

## 5. 未決事項

- 具体的なUI表現（アイコン・色等）は実装時に定める

## 6. 備考

参照: [docs/basic-design.md §5.12](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G9）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: G1〜G7, A4。

## Issue #139 の棚卸し反映

**現在の実装との差分**: staleの前回値をDB削除や単純NGに縮退しない。

**今回の担当範囲**: 3状態と部分欠測の表示契約。

**着手前に決める事項**: 各情報の非表示/前回値/時刻・状態色の最終UI。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H022, AD-H049, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: G1〜G7, A4。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G10 #61 — G10. 詳細ダイアログ共通コンポーネントの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §5.13 で確定した、各パネル共通の詳細ダイアログの土台コンポーネントを実装する。

## 2. やること

- PC画面の大部分を使うダイアログレイアウトの実装
- 見出し・対象地域／地点・発表または観測時刻・閉じるボタンの実装
- 背景の地図操作を停止し、閉じると元のパネル位置へ戻す実装
- 時系列表を横スクロール表示できる仕組み（行見出し固定、日付を含む列見出し）の実装

## 3. やらないこと

- 各パネル固有の詳細ダイアログの中身（G4〜G6で個別に実装）

## 4. 受け入れ条件

- ダイアログを開くと背景の地図操作が止まる
- ダイアログを閉じると元のパネル位置へ戻る
- 横幅を超えた表が表部分だけ横スクロールし、行見出しが固定される

## 5. 未決事項

- 具体的な余白・サイズ等の細部レイアウトは画面実装時に定める

## 6. 備考

参照: [docs/basic-design.md §5.13](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G10）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 背景操作停止・復帰・行見出し固定を共通化。

**今回の担当範囲**: 詳細ダイアログと時間軸。

**着手前に決める事項**: 実寸レイアウト・横スクロール・取得済み範囲表示。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 該当なし（既存タスク固有の設計事項のみ） の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### G11 #62 — G11. 左ナビレールの危険度バッジ実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.1 で確定した、左ナビレールの防災気象情報アイコンに表示する危険度バッジを実装する。

## 2. やること

- 発表中の最高危険度レベルを常時表示するバッジの実装
- バッジの色・段階を§5.7で確定した警戒レベル配色（黒/紫/赤/黄）に準拠させる実装
- 気象防災速報（G2）の新着に気付けるよう、バッジで状態を示す仕組みの実装

## 3. やらないこと

- 通知区分（警報／問いかけ／非常ブザー）の鳴動表現（Epic H。バッジは常時表示の状態表示であり、通知の鳴動とは別のものとする、§3.1）

## 4. 受け入れ条件

- 発表中の最高危険度レベルがバッジとして常時表示される
- バッジの色・段階が§5.7の配色ルールに準拠する

## 5. 未決事項

- アイコン・バッジの具体的な見た目は画面実装時に定める（§3.1）

## 6. 備考

参照: [docs/basic-design.md §3.1, §5.7](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（G11）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, G3。

## Issue #139 の棚卸し反映

**現在の実装との差分**: レベル5縁を維持し通知区分の鳴動から分離。

**今回の担当範囲**: ナビの最高危険度と速報新着。

**着手前に決める事項**: 小バッジ視認性・速報新着の表示単位。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H020 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, G3。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### H1 #63 — H1. ヘッダー点滅ブザーの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §1, §7.1, §7.2 で確定した、wx-viewer-poc画面専用の練習実装として、既存モックアップ相当のヘッダー点滅ブザーを実装する。

## 2. やること

- 通知区分（警報／問いかけ／非常ブザー）に応じたヘッダーの点滅・表現の実装
- 非常ブザー時にヘッダーを赤表示にする実装
- 既存モックアップ（`cmk-gsx-mockup`）と同等の挙動をこの画面専用に実装する

## 3. やらないこと

- 確認状態のサーバー側追跡（受領監視、§1で今回対象外と確定済み）
- 基本画面（中央アプリ）への統合（今回の対象外）

## 4. 受け入れ条件

- 警報／問いかけ／非常ブザーの各区分でヘッダーの表現が既存モックアップ相当に切り替わる
- 非常ブザー時にヘッダーが赤表示になる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §1, §7.1, §7.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（H1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, D1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: semantic tokenを使い非常outlineを面に使わない。

**今回の担当範囲**: 通知区分別ヘッダー表現。

**着手前に決める事項**: 実UIの赤ヘッダーと通知同時表示の視認性。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H020 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, D1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### H2 #64 — H2. 下部通知領域の表示・確認操作の実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.1, §7.2 で確定した、全ビュー共有の下部通知領域の表示・確認操作を実装する。

## 2. やること

- 通知区分ごとの表現差分（警報: ピンポーン／ピロン・ピロン、問いかけ: ピーピーピー、非常ブザー: ヘッダー赤表示＋ピポピポピポピポ）の実装
- 確認操作（ブザー停止）の実装
- §7章の気象内容通知と§8.4の装置異常系通知を同じ表示先・同じ表現の仕組みに流し込む実装（データ上は区別、表示先は分けない）

## 3. やらないこと

- 確認状態のサーバー側永続化（§1で対象外と確定済み）

## 4. 受け入れ条件

- 通知区分ごとに異なる表現（音・表示）が下部通知領域に表示される
- 確認操作でブザーが停止する
- 気象内容の通知と装置異常系の通知が同じ通知領域に表示される

## 5. 未決事項

- 具体的な表示項目・レイアウトは実装時に定める（§3.1）

## 6. 備考

参照: [docs/basic-design.md §3.1, §7.2, §8.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（H2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, D1, D8。

## Issue #139 の棚卸し反映

**現在の実装との差分**: weather/systemと最大6件を保持、resolver3要素を使用。

**今回の担当範囲**: 通知共通storeと表示・確認。

**着手前に決める事項**: 表示優先順・問いかけ中切替・件数/既読単位・操作結果との競合。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H005, AD-H006, AD-H019, AD-H020, AD-H021, AD-H022, AD-H023, AD-H024, AD-H066, AD-H068, AD-H069 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, D1, D8。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### H3 #65 — H3. 非常ブザーのスヌーズ機能の実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §1, §7.2 で確定した、既存モックアップ相当の非常ブザーのスヌーズ機能を実装する。

## 2. やること

- 非常ブザー（問いかけの特殊モード）のスヌーズ操作の実装
- 既存モックアップと同等の挙動の実装

## 3. やらないこと

- 確認状態のサーバー側追跡（§1で対象外と確定済み）

## 4. 受け入れ条件

- 非常ブザー中にスヌーズ操作ができ、既存モックアップ相当の挙動になる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §1, §7.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（H3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: H2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 端末内操作、受領監視は追加しない。

**今回の担当範囲**: 非常ブザーのスヌーズ。

**着手前に決める事項**: 再通知開始/期限/反復・新着/確認/スヌーズ競合。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H021 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: H2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### H4 #66 — H4. フロント側確認状態の一時管理（サーバー永続化なし）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §1, §9.5 で確定したとおり、確認／回答操作はフロント側の挙動（ブザー停止等）のみとし、「誰が・いつ確認したか」をサーバー側で追跡・保持する仕組み（受領監視）は今回実装しない方針を実装として担保する。

## 2. やること

- フロント側の一時的な状態管理として確認状態を保持する実装（画面リロードで状態がリセットされる想定）
- 確認状態をサーバーへ送信・永続化する経路が存在しないことを保証する実装

## 3. やらないこと

- サーバー側での確認状態の追跡・保持（受領監視）の実装

## 4. 受け入れ条件

- 確認操作の結果がサーバー側に送信・永続化されないことがテストで確認できる
- 確認状態がフロントの一時的な状態にとどまることが確認できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §1, §9.5](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（H4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: H2, H3。

## Issue #139 の棚卸し反映

**現在の実装との差分**: ackRequiredと確認済みを分離。D6 session維持とは別。

**今回の担当範囲**: 端末内確認状態。

**着手前に決める事項**: reload時の表示/確認reset・保存範囲。サーバ永続化はしない。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H021, AD-H025 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: H2, H3。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### I1 #67 — I1. 警報一覧ビューの実装（一覧表示・フィルターのみ）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.2 で確定した、既存モックアップの警報一覧ビュー（`view-alert`相当）を簡略化した警報一覧を実装する。

## 2. やること

- 左ナビレールから3.1・3.3と並ぶビューとして「警報一覧」を追加する実装
- 一覧の行を、§7.3で設計した通知用データ（notificationId、category、sourceType、occurredAt、summary等）を基に表示する実装
- ブザーの停止（確認）はヘッダークリック／F8キー等の全体操作で行い、一覧内には個別の確認ボタンを置かない実装

## 3. やらないこと

- 承認／差戻ボタン・行ごとの確認操作（気象警報・注意報は地区本部の承認を要する情報ではないため設けない、§3.2で確定済み）

## 4. 受け入れ条件

- 警報一覧ビューがナビレールから開ける
- 一覧の行が通知用データを基に表示される
- 承認／差戻ボタン・行ごとの確認操作が存在しないことがテストで確認できる

## 5. 未決事項

- 履歴の集約先（監視画面）との役割分担（保持期間・件数上限等）は設計段階で具体化して承認を受ける（§3.2）

## 6. 備考

参照: [docs/basic-design.md §3.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（I1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, D1, E9。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 監視履歴とは別。個別承認/差戻/確認ボタンは設けない。

**今回の担当範囲**: 現行/直近通知の一覧。

**着手前に決める事項**: 保持件数/期間・起動outputと検知notificationの対応。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H005, AD-H021, AD-H023, AD-H025, AD-H066 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, D1, E9。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### I2 #68 — I2. 警報一覧のフィルター機能（通知区分・情報種別・期間）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.2 に基づき、警報一覧の列構成・フィルター項目を実装する。

## 2. やること

- 通知区分、対象情報種別、期間等のフィルター機能の実装
- 列構成の実装（列構成の詳細は実装時に定める）

## 3. やらないこと

- 一覧表示の基本部分（I1で実装済みの部分を利用する）

## 4. 受け入れ条件

- 通知区分・対象情報種別・期間でフィルターできる

## 5. 未決事項

- 列構成・フィルター項目の詳細は実装時に定める（§3.2）

## 6. 備考

参照: [docs/basic-design.md §3.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（I2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: I1。

## Issue #139 の棚卸し反映

**現在の実装との差分**: origin/detectionContext/isTrainingを混同しない。

**今回の担当範囲**: 通知一覧フィルター。

**着手前に決める事項**: 列と条件・対象種別・期間の初期値。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H066 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: I1。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### J1 #69 — J1. サンプル電文カタログUI（一覧・選択）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.4 で確定した訓練通知機能のうち、あらかじめ用意したサンプル電文（`jmaxml_20260723_Samples`等）を選択するカタログUIを実装する。

## 2. やること

- サンプル電文の一覧表示UIの実装
- サンプル電文を選択するUIの実装

## 3. やらないこと

- 注入要求の実処理（J2）
- 抹消要求の実処理（J3）

## 4. 受け入れ条件

- 提供済みサンプル電文がカタログとして一覧表示される
- サンプル電文を選択できる

## 5. 未決事項

- サンプル電文のカタログ化（一覧・選択UI）の具体案、注入操作の権限は設計段階で具体化して承認を受ける（§3.4）

## 6. 備考

参照: [docs/basic-design.md §3.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（J1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: self-contained fixtureのoriginal/derived/syntheticを区別。

**今回の担当範囲**: 来歴付きサンプルカタログ。

**着手前に決める事項**: 採用sample/権限/一覧UI。加工を実電文と扱わない。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H055, AD-H067 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### J2 #70 — J2. 訓練電文の注入要求処理（通常パイプライン経由）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.4 で確定した、訓練通知パイプラインの検証機能のうち、サンプル電文を実際に受信したものとして通常の取得・検証・正規化・通知判定パイプラインへ投入する「注入要求」を実装する。

## 2. やること

- J1で選択したサンプル電文を、実際に受信した電文として通常パイプライン（Epic C, D）へ投入する処理の実装
- パイプラインを経由させることで、§7章の状態変化判定（新規・強化・緩和・解除等）や通知区分の判定を実データと同じ経路で検証できるようにする実装

## 3. やらないこと

- パイプラインを経由しない直接的な通知・データ生成（状態不整合の原因になるため用いない、§3.4で確定済み）

## 4. 受け入れ条件

- 選択したサンプル電文が通常の取得・検証・正規化・通知判定パイプラインを経由して処理される
- パイプライン経由での状態変化判定・通知区分判定が実データと同じ経路で動作することがテストで確認できる

## 5. 未決事項

- 同時に複数の訓練データを扱う場合の管理方法は設計段階で具体化して承認を受ける（§3.4）

## 6. 備考

参照: [docs/basic-design.md §3.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（J2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: J1, C2〜C8, D2〜D4。

## Issue #139 の棚卸し反映

**現在の実装との差分**: trainingをnormal/testと区別し、system実監視storeを汚さない。

**今回の担当範囲**: 訓練電文の通常経路注入。

**着手前に決める事項**: 訓練ID・複数同時・時刻変換と権限。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H067 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: J1, C2〜C8, D2〜D4。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### J3 #71 — J3. 訓練データの抹消要求処理（取消電文の合成投入）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.4 で確定した、注入した訓練データを取り消す「抹消要求」を実装する。

## 2. やること

- 電文の取消（InfoType=取消）を模した合成電文を同じパイプラインへ投入する処理の実装

## 3. やらないこと

- パイプラインを経由しない直接削除（状態不整合の原因になるため用いない、§3.4で確定済み）

## 4. 受け入れ条件

- 抹消要求が、取消を模した合成電文として通常パイプラインへ投入される
- 直接削除の経路が存在しないことがテストで確認できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §3.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（J3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: J2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 各parserの取消対応を確認し本番データを直接削除しない。

**今回の担当範囲**: 訓練取消投入と抹消範囲。

**着手前に決める事項**: 論理取消/物理削除の対象・権限・履歴保持・未対応電文。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H010, AD-H043 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: J2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### J4 #72 — J4. 訓練データの isTraining フラグ伝播（電文→通知→履歴→UI表示）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.4 で確定した、訓練由来のデータであることを示す`isTraining`フラグの伝播を実装する。本番データとの分離を担保する重要な確定事項である。

## 2. やること

- `isTraining`フラグを、共通メタ情報（§6.2）・通知用データ（§7.3）・履歴（§8.1）に一貫して伝播させる実装
- 3.1の下部通知領域・3.2の警報一覧・5章の各パネルに「訓練」バッジを表示する実装（実発表と誤認させない）

## 3. やらないこと

- 受入条件検証での訓練データ除外ロジック自体（J5で別途扱う）

## 4. 受け入れ条件

- 訓練電文由来のデータに`isTraining`フラグが設定され、通知・履歴・各パネルまで一貫して伝播することがテストで確認できる
- 下部通知領域・警報一覧・各パネルに「訓練」バッジが表示される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §3.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（J4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: J2, A3, D1, B2〜B5。

## Issue #139 の棚卸し反映

**現在の実装との差分**: バックエンドtraining伝播済み部分を再実装せずAPI/UIへ延長。

**今回の担当範囲**: 訓練フラグとバッジ。

**着手前に決める事項**: バッジ具体表現・通常表示との分離。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H067 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: J2, A3, D1, B2〜B5。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### J5 #73 — J5. 受入条件検証での訓練データ除外ロジック

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §3.4, §9.6 で確定した、受入条件検証において`isTraining`が付与された訓練データを除外するロジックを実装する。

## 2. やること

- 9章の受入条件検証（Epic L）が訓練データを対象に含めないようにする実装（`isTraining`で除外して判定する）
- 8.1で確定した「履歴は明示削除まで保持」の例外として、J3 の設計で定めた取消・抹消範囲を検証する。物理削除を未決のまま実装しない

## 3. やらないこと

- 抹消要求の実処理自体（J3で実装済みの処理を利用する）

## 4. 受け入れ条件

- 受入条件検証（Epic L）が、`isTraining`付きデータを判定対象から除外することがテストで確認できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §3.4, §9.6](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（J5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: J3 #71、J4 #72（Lの実行前に完了）。

## Issue #139 の棚卸し反映

**現在の実装との差分**: Lの実行前に除外条件を供給する。Lへの循環依存を外す。

**今回の担当範囲**: 受入から訓練を除外。

**着手前に決める事項**: J3で決めた抹消範囲と本番データ不変の検証。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H010, AD-H067 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: J3 #71、J4 #72（Lの実行前に完了）。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K1 #74 — K1. 監視画面レイアウト実装（全体状態4カード・取得元別テーブル・情報別テーブル・現在の異常）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.2, §8.5 で確定した、気象通報取得監視画面（3.3）のレイアウトを実装する。想定利用者はデバッグ用途・開発サイドの監視・トラブルシューティング用とする。

## 2. やること

- 全体状態（4カード: 取得運転／取得健全性／スケジュール／処理待ち）の表示実装
- 取得元別の稼働状況（主テーブル）の表示実装
- 情報別の反映状況（処理結果テーブル）の表示実装
- 現在の異常（解消していない問題だけ）の表示実装
- 本体を4段構成で縦スクロール表示する実装

## 3. やらないこと

- ツールバー自体の実装（K2）
- 各ダイアログ（受信履歴・出力履歴、K3・K4）

## 4. 受け入れ条件

- 全体状態・取得元別稼働状況・情報別反映状況・現在の異常が§8.5のレイアウトどおりに表示される
- 本体が縦スクロールで閲覧できる

## 5. 未決事項

- 具体的な余白・カードの縦横比・レスポンシブ対応は画面実装時に定める（§8.5）

## 6. 備考

参照: [docs/basic-design.md §8.2, §8.5](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, E10。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 運転/健全性/情報状態/処理を別々に表示。

**今回の担当範囲**: 監視4段レイアウト。

**着手前に決める事項**: カード実寸・未評価null・状態の文字表現。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H063 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, E10。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K2 #75 — K2. ツールバー（取得開始/停止/強制更新/受信履歴/出力履歴/送信）の実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.1 で確定した、監視画面のツールバーと操作手順を実装する。

## 2. やること

- `[取得開始][取得停止]　[強制更新]　[受信履歴][出力履歴]　[送信]`のツールバーレイアウトの実装
- 取得開始・取得停止・強制更新は「送信」を押して初めて実行要求を送る2段階操作の実装
- 「受信履歴」「出力履歴」は各ダイアログを直接開く実装（送信不要）
- 操作選択は単一とし、別の操作を選ぶと切り替える実装（選択中ボタンの強調、説明表示）
- 未選択時・送信中は「送信」を無効化する実装
- 監視画面から離れる、または履歴ダイアログの開閉時に未送信の選択を解除する実装

## 3. やらないこと

- 取得元単位の個別操作（§8.2で今回は全体一括操作のみと確定済み）
- 操作者の認証（AuthGate連携に委ね、本タスクでは規定しない）

## 4. 受け入れ条件

- 「送信」を押すまで開始・停止・強制更新が実行されないことがテストで確認できる
- 未選択時・送信中は「送信」ボタンが無効化される
- 監視画面から離れると未送信の選択が解除される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.1](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E11。

## Issue 会話の追加要件

ユーザー指定（Issue #75 comment-5591790017）に従い、受信履歴（HTTP通信ログ）と電文履歴（XMLログ）の入口を分ける。取得操作は引き続き選択→送信、履歴閲覧は送信不要とする。

管理項目: AD-H121。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 未送信で実状態を変えず要求IDで結果を再照会。

**今回の担当範囲**: 操作選択→送信と結果。

**着手前に決める事項**: 操作結果と通知の優先順・timeout表示。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H023, AD-H064 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E11。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K3 #76 — K3. 受信履歴ダイアログの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.1, §8.2 で確定した、受信履歴ダイアログを実装する。

## 2. やること

- 発表時刻・受信時刻・種別・対象地域・発表／訂正／取消・採用結果での検索機能の実装
- 詳細で原文（電文本文）を閲覧できる実装

## 3. やらないこと

- 通知出力履歴ダイアログ（K4で別途扱う）

## 4. 受け入れ条件

- 受信履歴が指定した検索条件で絞り込める
- 詳細から原文を閲覧できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.1, §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10, B3。

## Issue 会話の追加要件

ユーザー指定（Issue #76 comment-5591759938）に従い、左ペインに一覧、右ペインに電文を表示する。気象庁カナ形式のパース表示は「可能なら」の候補として、変換根拠・実現性・採否を着手前に判断し、未実装を供給済みと扱わない。

管理項目: AD-H122。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 一覧raw除外、詳細だけ原文、会場別adoptionsを表示。

**今回の担当範囲**: 原文と会場別採用の検索。

**着手前に決める事項**: ページング/normal既定・原文安全表示・採用精度。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H011, AD-H015, AD-H045, AD-H065 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10, B3。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K4 #77 — K4. 通知出力履歴ダイアログの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.1 で確定した、通知出力履歴ダイアログを実装する。警報出力履歴は通知区分「警報」だけに限定せず、問いかけ・非常ブザーを含む通知出力を扱う。

## 2. やること

- 原因情報、通知区分、生成理由、出力時刻、検知文脈 initial／normal の区別と、別表の起動応答監査を表示する実装
- 警報／問いかけ／非常ブザーすべての通知出力を扱う実装（実際の鳴動完了とは扱わない旨を明示）

## 3. やらないこと

- 受信履歴ダイアログ（K3で別途扱う）

## 4. 受け入れ条件

- 通知区分（警報／問いかけ／非常ブザー）を問わず通知出力履歴が表示される
- 検知通知の initial／normal と起動応答監査が区別して表示される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.1](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10, B4。

## Issue #139 の棚卸し反映

**現在の実装との差分**: B4 detectionContextとD5問い合わせ種別は別。実鳴動完了とはしない。

**今回の担当範囲**: 検知履歴と起動応答監査。

**着手前に決める事項**: 履歴の分類・outputId/notificationId・同時複数件。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H012, AD-H023, AD-H024, AD-H025, AD-H065 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10, B4。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K5 #78 — K5. 操作記録の表示実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.1, §8.2 で確定した、取得開始・停止・強制取得の操作記録の表示を実装する。

## 2. やること

- 開始・停止・強制取得の実行時刻、対象、結果、操作主体を表示する実装

## 3. やらないこと

- 操作記録の保存処理自体（B5で実装済み）

## 4. 受け入れ条件

- 操作記録が実行時刻・対象・結果・操作主体とともに表示される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.1, §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10, B5。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 操作結果と上流fetch結果を混同せずactor nullを保持。

**今回の担当範囲**: 操作履歴表示。

**着手前に決める事項**: 安全なエラー表現・不明結果の再照会。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H064, AD-H065 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10, B5。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K6 #79 — K6. 取得元別稼働状況テーブルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.2 で確定した、取得元別の稼働状況を表示する主テーブルを実装する。

## 2. やること

- 行（XML定時フィード、XML随時フィード、雨雲時刻一覧、キキクル時刻一覧、アメダス最新時刻・地点データ、初期化・復旧用の長期フィード）の表示実装
- 列（取得元、状態、適用周期、最終試行、最終成功、次回予定、直近処理時間、連続失敗回数）の表示実装
- 状態（待機／取得中／停止／スケジュール停止／再試行待ち／異常）を色と文字で示す実装
- アメダスの時刻確認と地点データ取得の成功を別管理で表示する実装
- タイル（オンデマンド取得）は周期取得の行に混ぜず、別の短い欄に表示する実装

## 3. やらないこと

- 情報別の反映状況テーブル（K7で別途扱う）

## 4. 受け入れ条件

- 各取得元の状態・最終試行・最終成功・連続失敗回数等が表示される
- アメダスの時刻確認成功と地点データ更新成功が別に表示される
- 停止と失敗が色だけでなく文字でも区別される

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K6）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 索引も定期取得、画像本体に周期なし。amedas時刻/地点別。

**今回の担当範囲**: 6系列取得状態と次回予定。

**着手前に決める事項**: tile健全性/地点検知遅れの運用表示・評価時刻/scan上限。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H001, AD-H003, AD-H041, AD-H062 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K7 #80 — K7. 情報別反映状況テーブルの実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.2 で確定した、情報別の反映状況を表示する処理結果テーブルを実装する。

## 2. やること

- 行（気象防災速報、気象警報・注意報、警報等時系列、警報級の可能性、アメダス、地域時系列予報、雨雲、キキクル）の表示実装
- 列（情報名、対象地域／地点、反映状態、情報の発表／観測／基準時刻、サーバー反映時刻、内容の要約）の表示実装
- 反映状態（利用可能／正常・対象情報なし／未初期化／取得異常／解析異常／未対応形式／停止中の保存値）の表示実装
- 警報級の可能性の2つの情報やキキクルの各種別を必要に応じて内訳展開できる実装（片方の失敗を全体成功に隠さない）

## 3. やらないこと

- 取得元別稼働状況テーブル（K6で別途扱う）

## 4. 受け入れ条件

- 情報別の反映状態・時刻・要約が表示される
- 新着がないことを障害と扱わず、発表時刻が古いだけで異常表示にならないことがテストで確認できる

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K7）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 片方の失敗を隠さずnear/far・各layerを展開。

**今回の担当範囲**: 情報別反映状態。

**着手前に決める事項**: 初期化/解析失敗/stale/停止中保存値の区別。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H040, AD-H045, AD-H063, AD-H070 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K8 #81 — K8. 「現在の異常」パネルの実装（同一問題の集約表示）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.2 で確定した、解消していない問題だけを表示する「現在の異常」パネルを実装する。

## 2. やること

- 対象、初回発生時刻、直近発生時刻、短い原因、影響、再試行予定の表示実装
- 同じ問題の繰り返しを1件にまとめ、継続時間と回数を更新する実装
- 解消したら本体から外し、記録は履歴側（K3・K4）に残す実装
- 画面の更新が止まった場合に「監視情報を更新できません」と最終表示更新時刻を示す実装（緑の正常表示だけを残さない）

## 3. やらないこと

- 履歴側への記録処理自体（B3・B4で実装済み）

## 4. 受け入れ条件

- 同じ問題が1件にまとめられ、継続時間・回数が更新される
- 問題が解消すると本体から外れる
- 画面の更新が止まった場合に警告表示が出る

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §8.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K8）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: K1, E10。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 問題の集約は通知生成単位とは別。最後の表示更新時刻を表示。

**今回の担当範囲**: 現在の問題とUI更新停止。

**着手前に決める事項**: ブラウザ疎通と上流異常の区別・処理skipの採用。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H022, AD-H040 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: K1, E10。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### K9 #82 — K9. H端末相当モードでの装置異常系通知の表示フィルタリング実装

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §8.4 で確定した、端末種別パラメーターがH端末相当モードのとき、装置異常系の通知を下部通知領域・ナビレールバッジ等の表示から除外するフィルタリングを実装する。生成・保持は端末種別によらず共通で行う。

## 2. やること

- `terminalMode`がH端末相当のとき、`origin`が装置異常系と区別される通知を下部通知領域・ナビレールバッジ等の表示から除外する実装
- 端末台帳でK端末相当モードと定義された端末ではすべての通知区分を表示する実装

## 3. やらないこと

- 通知の生成・保持ロジック自体（D7, D8で実装済み。本タスクは表示フィルタリングに限定）

## 4. 受け入れ条件

- H端末相当モードで、装置異常系の通知が下部通知領域・ナビレールバッジから表示されないことがテストで確認できる
- 装置異常系の通知の生成・保持自体は、モードによらず継続していることがテストで確認できる
- K端末相当モードではすべての通知区分が表示される

## 5. 未決事項

- フィルタリングの実装位置（フロント側／配信APIのクエリ側）は実装時に定める（§8.4）

## 6. 備考

参照: [docs/basic-design.md §8.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（K9）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: A2, D8, H2。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 台帳のterminalModeとoriginだけで判定しcursorは進める。

**今回の担当範囲**: H端末のsystem表示除外。

**着手前に決める事項**: フィルター配置。生成/保存は端末によらず共通。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H069 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: A2, D8, H2。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L1 #83 — L1. 表示（地図・パネル）の受入条件検証

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.1 に基づき、地図・情報パネルの表示に関する受入条件を検証する。

## 2. やること

- 初期表示が雨雲ナウキャストであり、東京ビッグサイトが§4.3の中心点算出方法に一致することの検証
- キキクル（大雨・浸水・土砂）とナウキャストの切り替えで地図中心・ズームが保持され、切り替え直後に再生停止・最新時刻表示になることの検証
- 右側情報パネルが§5.2の順序で表示されることの検証
- §5.1で確定した対象が固定され、地図の移動・レイヤー切り替えで変化しないことの検証
- 取得不能・初期取得中・正常な発表なしが§5.12のルールどおりに区別表示されることの検証
- 警報・注意報バッジが§5.7の配色・段階順・短縮表記ルールに従うことの検証

## 3. やらないこと

- 取得・保存の検証（L2）、通知判定の検証（L3）

## 4. 受け入れ条件

- §9.1に列挙された全項目が検証済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.1](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L1）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: Epic F, Epic G。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 既存shell smokeを実データUIの受入へ拡充。

**今回の担当範囲**: 両会場の地図・パネル受入。

**着手前に決める事項**: G9表示承認・実寸/色/zoom/凡例の実測条件。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H004, AD-H018, AD-H019, AD-H020, AD-H027, AD-H047, AD-H048, AD-H049, AD-H050, AD-H058 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: Epic F, Epic G。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L2 #84 — L2. 取得・保存の受入条件検証

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.2 に基づき、取得・保存に関する受入条件を検証する。

## 2. やること

- Node.js側の取得処理が監視画面の開閉で増減しないことの検証（§3.3, §8.1）
- 各情報種別のavailabilityが§6.3の定義どおりに遷移し、正常な発表なし（空一覧）とunavailableが区別されることの検証
- サーバー再起動後もディスク永続化により履歴・前回正常値が失われないことの検証
- 取得失敗時に指数バックオフで再試行し、§8.1の遅延・異常判定の閾値（設定ファイルで変更可能）が機能することの検証

## 3. やらないこと

- 通知判定の検証（L3）

## 4. 受け入れ条件

- §9.2に列挙された全項目が検証済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.2](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L2）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: Epic B, Epic C。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 実電文と合成を区別し夜間/復旧/会場/キャッシュ/容量を確認。

**今回の担当範囲**: 取得・保存・運用限界の受入。

**着手前に決める事項**: タイル基準/地点50分・低頻度保守項目は到達性と採否を判断。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H001, AD-H003, AD-H008, AD-H009, AD-H011, AD-H012, AD-H013, AD-H015, AD-H016, AD-H017, AD-H027, AD-H028, AD-H029, AD-H030, AD-H031, AD-H032, AD-H033, AD-H034, AD-H035, AD-H036, AD-H037, AD-H041, AD-H042, AD-H043, AD-H044, AD-H045, AD-H052, AD-H053, AD-H054, AD-H055, AD-H058, AD-H059, AD-H060 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: Epic B, Epic C。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L3 #85 — L3. 通知判定（バックエンド）の受入条件検証

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.3 に基づき、通知判定（バックエンド）に関する受入条件を検証する。

## 2. やること

- §7.4のコード対応表どおりに通知区分が判定されることの検証
- 強化・緩和・解除（§7.5）、新規・継続・訂正・取消・初期取得（§7.6）で確定した通知生成ルールどおりに通知が生成される／されないことの検証
- 初期取得・復旧時も通常の状態変化と同様に通知が生成され、プロセス再起動のたびに現況が再評価されることの検証
- 起動時出力APIがpull方式で提供され、サーバー起動世代・会場単位の警報出力権と端末問い合わせ種別を分離し§7.7のルールどおりに応答することの検証

## 3. やらないこと

- 監視画面の検証（L4）

## 4. 受け入れ条件

- §9.3に列挙された全項目が検証済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.3](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L3）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: Epic D。

## Issue #139 の棚卸し反映

**現在の実装との差分**: D4/D5/D7の単位・二軸・同時件数・at-most-onceを実行確認。

**今回の担当範囲**: 通知判定・起動出力の受入。

**着手前に決める事項**: 取消実例/等時刻境界・保存失敗保証・D10採用分の追加条件。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H002, AD-H007, AD-H037, AD-H038, AD-H039, AD-H042, AD-H043, AD-H044 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: Epic D。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L4 #86 — L4. 監視画面の受入条件検証

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.4 に基づき、監視画面に関する受入条件を検証する。

## 2. やること

- ツールバーの開始・停止・強制更新が「送信」操作なしには実行されないことの検証
- 取得操作が全体一括のみで、取得元単位の個別操作を持たないことの検証
- 履歴（受信履歴・通知出力履歴・操作記録）が自動削除されず、明示削除まで保持されることの検証
- §8.1の遅延・異常判定が装置異常系の警報・問いかけとして、3.1と共通の下部通知領域に表示されることの検証
- 端末種別パラメーターがH端末相当モードのとき、装置異常系の通知が下部通知領域・ナビレールバッジ等の表示から除外されることの検証（生成・保持は継続すること）
- 訓練通知（3.4）の注入・抹消要求が通常パイプラインを経由して処理され、`isTraining`等の訓練フラグが伝播し画面上で訓練データと分かる表示になることの検証
- 訓練データが§8.1の「明示削除まで保持」の例外として、J3で承認された取消・抹消範囲だけが反映されることの検証

## 3. やらないこと

- 通知UI（フロント側）自体の検証（L5）

## 4. 受け入れ条件

- §9.4に列挙された全項目が検証済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.4](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L4）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: Epic K, Epic J。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 健全性とavailability、会場別採用、3種履歴を分離。

**今回の担当範囲**: 監視・訓練・表示除外受入。

**着手前に決める事項**: E11操作契約・J3抹消範囲・ブラウザ更新停止。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H010, AD-H067, AD-H069 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: Epic K, Epic J。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L5 #87 — L5. 通知UI（フロント側）の受入条件検証

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.5 に基づき、通知UI（フロント側）に関する受入条件を検証する。

## 2. やること

- ヘッダー点滅ブザー・下部通知領域・確認操作・非常ブザーのスヌーズが、既存モックアップ相当の挙動でwx-viewer-poc画面専用に動作することの検証
- 確認操作の結果がサーバー側に永続化されず、フロントの一時的な状態にとどまることの検証（受領監視を実装しないことの確認）
- 警報一覧ビュー（3.2）に承認／差戻ボタン・行ごとの確認操作が存在しないことの検証

## 3. やらないこと

- 対象外・除外項目の確認（L6）

## 4. 受け入れ条件

- §9.5に列挙された全項目が検証済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.5](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L5）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: Epic H, Epic I。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 実際の音/確認/スヌーズ、同時通知と両モードを検証。

**今回の担当範囲**: 通知UIの受入。

**着手前に決める事項**: Hの表示単位・優先順位・期限の承認済み値。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H019, AD-H020, AD-H025 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: Epic H, Epic I。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### L6 #88 — L6. 対象外・除外の確認（洪水キキクル・潮位速報・短時間大雪等）

<details>
<summary>投稿本文</summary>

## 1. 背景・目的

基本設計書 §9.6 に基づき、今回の実装範囲から明確に除外された項目が誤って含まれていないことを確認する。

## 2. やること

- 洪水キキクル、潮位速報（VPBS51）、短時間大雪の速報が実装対象に含まれていないことの確認
- 通知の確認状態のサーバー側追跡（受領監視）、基本画面（中央アプリ）への統合が実装対象に含まれていないことの確認
- L1〜L4の検証において、`isTraining`が付与された訓練データが判定対象から除外されていることの確認

## 3. やらないこと

- L1〜L5で実施した個別の受入条件検証そのもの（本タスクは除外項目の横断確認に限定する）

## 4. 受け入れ条件

- §9.6に列挙された全項目が確認済みであること

## 5. 未決事項

下記「着手前に決める事項」を参照

## 6. 備考

参照: [docs/basic-design.md §9.6](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)、[docs/issues-draft.md（L6）](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/issues-draft.md)。依存: L1〜L5。

## Issue #139 の棚卸し反映

**現在の実装との差分**: 洪水キキクルと洪水警報、試験報と訓練を別に確認。

**今回の担当範囲**: 対象外の横断確認。

**着手前に決める事項**: 本番移行事項・未取得実例を未確認のまま記録。未決事項は既定値で補わず、当該部分の設計承認まで実装を保留する。他の確定済み部分の調査・設計は進めてよい。

**追加の受け入れ条件**:

- 上記担当範囲と既存実装の境界を実行して確認し、未対応を実装済みと扱わない。
- 共通メタ情報の null、3状態、時刻の意味、会場、本番・訓練の区別を該当する範囲で維持する。
- 棚卸しの管理項目 AD-H026, AD-H042, AD-H044, AD-H071 の結論を記録する。採否待ちの保守事項は自動的に修正必須へ昇格させない。

依存関係（棚卸し後）: L1〜L5。

根拠: [Epic A〜D 棚卸し](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/audit-epic-a-d.md)、[基本設計](https://github.com/BlueKurage119/wx-viewer-poc/blob/feature/issue-139-epic-a-d-audit/docs/basic-design.md)。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### C17 #144 — C17. 複数会場アメダス定期取得の接続

<details>
<summary>起票済み本文</summary>

## 背景・目的

Issue #139 の棚卸しで、C16 の複数会場同時処理は XML に接続済みだが、アメダスの定期取得は `createScheduledAdapters()` が既定の east 用 `AmedasFetchState` を1個生成する構成に留まることを確認した。E5 の表示 API から個別に収集を起動せず、収集層で会場別取得を接続する。

## やること

- `VENUE_IDS` / `VENUE_FORECAST_TARGETS` から会場の観測地点を解決し、江戸川臨海と羽田の定期取得を既存の取得スケジューラへ接続する。
- 地点別の取得状態・再確認時刻・保存結果を分離し、一方の失敗が他方の正常値を上書きしないようにする。
- C14 の時間帯・夜間停止・実行中処理の完了・最新時刻と地点取得の成否分離を維持する。
- E5/G6 へ会場別の正常値・未提供要素・欠測・取得失敗を引き継ぐ。

## 着手前に決める事項

- `latest_time.txt` の1周期内の取得を両地点で共有するか。共有する場合の失敗履歴と地点別再試行の単位。
- 同一観測地点を参照する会場を将来追加する場合の取得共有と状態キー。
- 起動時の過去ブロック取得（既存 `backfillBlocks`）を採用するか。採用する場合の範囲・取得負荷・失敗時の扱い。

これらは本 Issue の設計前に判断する。棚卸しでは方式・値を確定しない。

## 対象外

表示 API/UI、観測品質フラグの新たな意味付け、健全性閾値の変更。

## 受け入れ条件

- 両会場の地点が同一スケジューラで取得され、取得回数・状態・保存結果を地点別に検証できる。
- 羽田だけの失敗と回復、最新時刻取得失敗、夜間境界、再起動を実行して検証する。
- 画面や端末の数で上流の取得ジョブが増えない。
- E5/G6 が未取得の羽田を正常な観測値や江戸川臨海の値として扱わない。

依存: C9 #19、C14 #24、C15 #109、C16 #114。E5 #37 の両会場取得完了の前提となる。根拠: #19 設計 §8、#24 設計 §1・§6、`apps/api/src/polling/timeBasedPollingScheduler.ts`。

🤖 Generated with Codex (GPT-6 Astra)

</details>

### D10 #145 — D10. 速報の通常通知と起動時通知の対象範囲の補完

<details>
<summary>起票済み本文</summary>

## 背景・目的

Issue #139 の棚卸しで、通知レジストリには速報5種とシステム通知の定義がある一方、D4 は警報・注意報の通常通知生成、D5 は警報・注意報と VPBS50 の3種の起動時再提示に限定されていることを確認した。VPHW50/51 の収集・正規化は C8 で実装済みだが、通常通知の生成と起動時出力への採用は別の境界である。D7 が記録する system 通知を D5 が既に返すと誤認せず、残る通知範囲を設計する。

## やること

- 速報5種（VPBS50 の線状降水帯発生・直前予測・記録的短時間大雨、VPHW50/51 の竜巻関連）の通常受信通知について、既存レジストリからの定義選択と状態変化の生成条件を設計する。
- system 通知および竜巻関連情報を起動時出力へ統合するか、対象とする場合の条件を明示的に判断する。
- 採用する範囲を、既存 D1・メッセージ定義・B4 検知履歴または D5 起動応答監査の適切な境界へ接続する。
- E9 に、対象・通知識別・版・期限・再提示条件の確定した契約を渡す。

## 着手前に決める事項

- 速報の新規・訂正・取消・初期取得時の通知単位、会場別対象と重複抑止、VPHW50/51 同時発表の扱い。
- 起動時再提示に含める system の「現在状態」をどこから読むか、warning の消費単位、復帰通知・過去履歴の扱い。D5 の現行 at-most-once 契約を変更するか。
- VPHW の期限、目撃情報の対象区域、取消時の対象同定に必要な実電文根拠。未確認の構造は推測で補わない。

棚卸しでは上記を確定しない。採用しない範囲も理由と後続判断先を残す。

## 対象外

E9 の cursor/差分配信 API、通知UI、受領監視、指令伝達、DB障害時の通知再送保証の変更。

## 受け入れ条件

- 対象・対象外と根拠が通知種別ごとの表に揃い、既存実装済み範囲との重複がない。
- 採用範囲について新規・同版再取得・訂正・取消・期限・会場・訓練/本番を検証する。合成資料を実電文の検証結果と扱わない。
- 検知通知の `notificationId` / `detectionContext` と起動出力の `outputId` / 問い合わせ監査を混同しない。
- system の取得元別通知（最大6件）を、同一時刻・同じ区分という理由で1件へ落とさない。
- 未決事項は設計承認前に判断し、未採用分は未対応のまま追跡する。

依存: C7 #17、C8 #18、D1 #25、D1-1 #103、D4 #28、D5 #29、D7 #31。E9 #41 は現行対応分の配信設計を先行でき、追加種別の配信契約だけ本 Issue の判断に依存する。

🤖 Generated with Codex (GPT-6 Astra)

</details>

## 8. 検証・外部更新の結果

### 8.1 製造時の受け入れ条件確認

検証日は2026-09-13。これは製造担当の自己確認であり、独立した検収は後続担当が行う。

| 条件 | 結果 | 確認内容 |
| --- | --- | --- |
| AC1 母集団 | 合格 | 設計39件・PR48件の個別一覧を基準コミットと照合。手順文書1件を区別 |
| AC2 原資料取得 | 合格 | PR本文48件、会話42件、review54件、inline65件を取得・読了。関連Issue会話6件も追補 |
| AC3 原項目追跡 | 合格 | 原出典・現状・影響・判断・後続を122管理IDへ記録 |
| AC4 解消判定 | 合格 | 解消済み52件の根拠を記録。未マージPR92/93をマージ根拠に採用しない |
| AC5 差分 | 合格 | §3の差分台帳と基本設計・Issue下書きを対応付け |
| AC6 設計上の確度 | 合格 | 既決だけ反映し、未決・確認待ち・対象外を明示 |
| AC7 全後続Issue | 合格 | E〜Lの56件すべてに再編判断と投稿本文を用意。C17/D10を追加 |
| AC8 PR転載表 | 合格 | 未解消68IDと§5のID集合が完全一致し、欠落・余剰なし |
| AC9 ユーザー判断 | 合格 | 未決事項を未決のまま後続へ残す承認を反映。値や方式を独自確定していない |
| AC10 起票・更新 | 合格 | 統括が既存56件を更新、新規2件を起票。タイトル・本文の完全一致を読み戻し確認 |
| AC11 変更範囲・体裁 | 合格 | 変更は指定3文書のみ。リンク実在・表列数・管理ID・タスク97件の一意性を検証 |
| AC12 必須検証 | 合格 | 下表のコマンドと文書検証を実行 |
| AC13 PR | 検収待ち | 製造担当はpush・PRを行わない。検収通過後に通常PRを作成し、本文の表・Closes・baseを検証する |

### 8.2 コマンド検証

| コマンド | 結果 |
| --- | --- |
| `npm run build` | 終了コード0 |
| `npm run lint` | 終了コード0 |
| `npm run typecheck` | 終了コード0 |
| `npm run format:check` | 終了コード0 |
| `npm run test -w apps/api` | 509件成功、失敗0 |
| `npm run test -w apps/web` | 16件成功、失敗0 |
| `npm run test -w packages/shared` | 32件成功、失敗0 |
| 文書専用検証 | 母集団集合・原資料件数・状態enum・管理ID・アンカー・ローカルリンク・表列数・タスク番号・公開本文の一致を確認 |

APIテストはsandbox内ではローカル待受けがEPERMとなったため、同じコマンドを待受け可能な承認済み環境で再実行した。`.prettierignore` の `docs/**` 除外により、formatコマンドだけでは本変更のMarkdownを検証しないため、文書専用検証で補完した。新規テスト・実装コードの変更はない。

### 8.3 GitHub更新の読み戻し

既存Issue番号・タイトルを維持して56件の本文を更新した。以下は統括の更新実績であり、§7の投稿本文とGitHubの本文・タイトルが全件完全一致している。時刻はUTC。新規2件も起票後に完全一致を確認した。

| 対象 | 操作 | 読み戻し確認 |
| --- | --- | --- |
| [E1 #33](https://github.com/BlueKurage119/wx-viewer-poc/issues/33) | 本文更新 | 2026-09-13T06:43:53Z・完全一致 |
| [E2 #34](https://github.com/BlueKurage119/wx-viewer-poc/issues/34) | 本文更新 | 2026-09-13T06:43:55Z・完全一致 |
| [E3 #35](https://github.com/BlueKurage119/wx-viewer-poc/issues/35) | 本文更新 | 2026-09-13T06:43:58Z・完全一致 |
| [E4 #36](https://github.com/BlueKurage119/wx-viewer-poc/issues/36) | 本文更新 | 2026-09-13T06:44:00Z・完全一致 |
| [E5 #37](https://github.com/BlueKurage119/wx-viewer-poc/issues/37) | 本文更新 | 2026-09-13T06:44:03Z・完全一致 |
| [E6 #38](https://github.com/BlueKurage119/wx-viewer-poc/issues/38) | 本文更新 | 2026-09-13T06:44:06Z・完全一致 |
| [E7 #39](https://github.com/BlueKurage119/wx-viewer-poc/issues/39) | 本文更新 | 2026-09-13T06:44:08Z・完全一致 |
| [E8 #40](https://github.com/BlueKurage119/wx-viewer-poc/issues/40) | 本文更新 | 2026-09-13T06:44:10Z・完全一致 |
| [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41) | 本文更新 | 2026-09-13T06:44:11Z・完全一致 |
| [E10 #42](https://github.com/BlueKurage119/wx-viewer-poc/issues/42) | 本文更新 | 2026-09-13T06:44:13Z・完全一致 |
| [E11 #43](https://github.com/BlueKurage119/wx-viewer-poc/issues/43) | 本文更新 | 2026-09-13T06:44:15Z・完全一致 |
| [F1 #44](https://github.com/BlueKurage119/wx-viewer-poc/issues/44) | 本文更新 | 2026-09-13T06:44:17Z・完全一致 |
| [F2 #45](https://github.com/BlueKurage119/wx-viewer-poc/issues/45) | 本文更新 | 2026-09-13T06:44:19Z・完全一致 |
| [F3 #46](https://github.com/BlueKurage119/wx-viewer-poc/issues/46) | 本文更新 | 2026-09-13T06:44:21Z・完全一致 |
| [F4 #47](https://github.com/BlueKurage119/wx-viewer-poc/issues/47) | 本文更新 | 2026-09-13T06:44:23Z・完全一致 |
| [F5 #48](https://github.com/BlueKurage119/wx-viewer-poc/issues/48) | 本文更新 | 2026-09-13T06:44:25Z・完全一致 |
| [F6 #49](https://github.com/BlueKurage119/wx-viewer-poc/issues/49) | 本文更新 | 2026-09-13T06:44:27Z・完全一致 |
| [F7 #50](https://github.com/BlueKurage119/wx-viewer-poc/issues/50) | 本文更新 | 2026-09-13T06:44:29Z・完全一致 |
| [F8 #51](https://github.com/BlueKurage119/wx-viewer-poc/issues/51) | 本文更新 | 2026-09-13T06:44:31Z・完全一致 |
| [G1 #52](https://github.com/BlueKurage119/wx-viewer-poc/issues/52) | 本文更新 | 2026-09-13T06:44:34Z・完全一致 |
| [G2 #53](https://github.com/BlueKurage119/wx-viewer-poc/issues/53) | 本文更新 | 2026-09-13T06:44:36Z・完全一致 |
| [G3 #54](https://github.com/BlueKurage119/wx-viewer-poc/issues/54) | 本文更新 | 2026-09-13T06:44:38Z・完全一致 |
| [G4 #55](https://github.com/BlueKurage119/wx-viewer-poc/issues/55) | 本文更新 | 2026-09-13T06:48:32Z・完全一致 |
| [G5 #56](https://github.com/BlueKurage119/wx-viewer-poc/issues/56) | 本文更新 | 2026-09-13T06:48:35Z・完全一致 |
| [G6 #57](https://github.com/BlueKurage119/wx-viewer-poc/issues/57) | 本文更新 | 2026-09-13T06:48:37Z・完全一致 |
| [G7 #58](https://github.com/BlueKurage119/wx-viewer-poc/issues/58) | 本文更新 | 2026-09-13T06:48:39Z・完全一致 |
| [G8 #59](https://github.com/BlueKurage119/wx-viewer-poc/issues/59) | 本文更新 | 2026-09-13T06:48:41Z・完全一致 |
| [G9 #60](https://github.com/BlueKurage119/wx-viewer-poc/issues/60) | 本文更新 | 2026-09-13T06:48:43Z・完全一致 |
| [G10 #61](https://github.com/BlueKurage119/wx-viewer-poc/issues/61) | 本文更新 | 2026-09-13T06:48:44Z・完全一致 |
| [G11 #62](https://github.com/BlueKurage119/wx-viewer-poc/issues/62) | 本文更新 | 2026-09-13T06:48:46Z・完全一致 |
| [H1 #63](https://github.com/BlueKurage119/wx-viewer-poc/issues/63) | 本文更新 | 2026-09-13T06:48:48Z・完全一致 |
| [H2 #64](https://github.com/BlueKurage119/wx-viewer-poc/issues/64) | 本文更新 | 2026-09-13T06:48:51Z・完全一致 |
| [H3 #65](https://github.com/BlueKurage119/wx-viewer-poc/issues/65) | 本文更新 | 2026-09-13T06:48:53Z・完全一致 |
| [H4 #66](https://github.com/BlueKurage119/wx-viewer-poc/issues/66) | 本文更新 | 2026-09-13T06:48:55Z・完全一致 |
| [I1 #67](https://github.com/BlueKurage119/wx-viewer-poc/issues/67) | 本文更新 | 2026-09-13T06:48:57Z・完全一致 |
| [I2 #68](https://github.com/BlueKurage119/wx-viewer-poc/issues/68) | 本文更新 | 2026-09-13T06:48:59Z・完全一致 |
| [J1 #69](https://github.com/BlueKurage119/wx-viewer-poc/issues/69) | 本文更新 | 2026-09-13T06:49:01Z・完全一致 |
| [J2 #70](https://github.com/BlueKurage119/wx-viewer-poc/issues/70) | 本文更新 | 2026-09-13T06:49:03Z・完全一致 |
| [J3 #71](https://github.com/BlueKurage119/wx-viewer-poc/issues/71) | 本文更新 | 2026-09-13T06:49:05Z・完全一致 |
| [J4 #72](https://github.com/BlueKurage119/wx-viewer-poc/issues/72) | 本文更新 | 2026-09-13T06:49:07Z・完全一致 |
| [J5 #73](https://github.com/BlueKurage119/wx-viewer-poc/issues/73) | 本文更新 | 2026-09-13T06:49:09Z・完全一致 |
| [K1 #74](https://github.com/BlueKurage119/wx-viewer-poc/issues/74) | 本文更新 | 2026-09-13T06:49:11Z・完全一致 |
| [K2 #75](https://github.com/BlueKurage119/wx-viewer-poc/issues/75) | 本文更新 | 2026-09-13T06:49:13Z・完全一致 |
| [K3 #76](https://github.com/BlueKurage119/wx-viewer-poc/issues/76) | 本文更新 | 2026-09-13T06:49:15Z・完全一致 |
| [K4 #77](https://github.com/BlueKurage119/wx-viewer-poc/issues/77) | 本文更新 | 2026-09-13T06:49:17Z・完全一致 |
| [K5 #78](https://github.com/BlueKurage119/wx-viewer-poc/issues/78) | 本文更新 | 2026-09-13T06:49:19Z・完全一致 |
| [K6 #79](https://github.com/BlueKurage119/wx-viewer-poc/issues/79) | 本文更新 | 2026-09-13T06:49:21Z・完全一致 |
| [K7 #80](https://github.com/BlueKurage119/wx-viewer-poc/issues/80) | 本文更新 | 2026-09-13T06:49:23Z・完全一致 |
| [K8 #81](https://github.com/BlueKurage119/wx-viewer-poc/issues/81) | 本文更新 | 2026-09-13T06:49:26Z・完全一致 |
| [K9 #82](https://github.com/BlueKurage119/wx-viewer-poc/issues/82) | 本文更新 | 2026-09-13T06:49:28Z・完全一致 |
| [L1 #83](https://github.com/BlueKurage119/wx-viewer-poc/issues/83) | 本文更新 | 2026-09-13T06:49:30Z・完全一致 |
| [L2 #84](https://github.com/BlueKurage119/wx-viewer-poc/issues/84) | 本文更新 | 2026-09-13T06:49:31Z・完全一致 |
| [L3 #85](https://github.com/BlueKurage119/wx-viewer-poc/issues/85) | 本文更新 | 2026-09-13T06:49:34Z・完全一致 |
| [L4 #86](https://github.com/BlueKurage119/wx-viewer-poc/issues/86) | 本文更新 | 2026-09-13T06:49:36Z・完全一致 |
| [L5 #87](https://github.com/BlueKurage119/wx-viewer-poc/issues/87) | 本文更新 | 2026-09-13T06:49:38Z・完全一致 |
| [L6 #88](https://github.com/BlueKurage119/wx-viewer-poc/issues/88) | 本文更新 | 2026-09-13T06:49:40Z・完全一致 |
| [C17 #144](https://github.com/BlueKurage119/wx-viewer-poc/issues/144) | 新規起票 | 2026-09-13・完全一致 |
| [D10 #145](https://github.com/BlueKurage119/wx-viewer-poc/issues/145) | 新規起票 | 2026-09-13・完全一致 |

取得した一次資料、検証スクリプト、実行ログ、更新前後のハッシュと読み戻しJSONは検収担当へ引き継ぐ。一時資料はリポジトリへ追加せず、検収終了まで保持して統括が後始末する。
