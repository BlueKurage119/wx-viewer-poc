# Issue #68 警報履歴一覧のフィルター設計

## 1. 前提と根拠

- 対象: [Issue #68](https://github.com/BlueKurage119/wx-viewer-poc/issues/68)。#67の一覧を使用し、表示用の検索条件を追加する。
- 2026-10-04のヒアリング【確定】: 上部に検索条件、下部に高密度の表を置く。日時範囲・通知区分・情報種別を指定して「検索」で反映し、「条件クリア」を設ける。初期条件はすべて。既存MD3を使う。
- 列【確定】: 発生日時・通知区分・対象サービス・情報種別・内容。2026-10-04の追加指示により対象サービスは全行「防災気象情報」、内容の改行は全角スペースへ置換し、折り返さず1行表示する。新しい順、固定見出し、スクロール。訓練・起動時を明示する。確認時刻・端末名称・自端末／全端末・個別確認操作は追加しない。
- 保持範囲【確定】: #67の一覧専用保持を使う。起動現況と起動後受信を別行で扱い、受信時刻基準の直近24時間、起動現況は期間対象外、合計最大500件、再読み込みでリセット。H端末は装置系を除外する。
- [#67設計](issue-67-warning-list.md)を先行実装とする。公開型・一覧部品の配置を同設計と照合した。
- コード根拠: `packages/shared/src/notificationFeed.ts`の`NotificationFeedItem`は`category`・`sourceType`・`occurredAt`・`source`・`origin`・`detectionContext`・`isTraining`を別々に持つ。`apps/web/src/notifications/notificationStore.ts`の`isVisibleForTerminal`はHで`origin === 'system'`を非表示とする。検索のためにこれらを再分類しない。
- [#41設計 §10の後続引継ぎ](issue-41-notification-delta-api.md)では一覧・検索にE10履歴APIを利用する想定がある。今回はヒアリングで合意した端末内の直近一覧を対象とするため、履歴APIで過去を補充しない。この差異を今回の範囲判断として記録する。
- [棚卸しAD-H066](../audit-epic-a-d.md#ad-h066)は永続出力履歴と直近一覧の責務を分ける。保持の実装は#67、保持範囲内の検索は#68で担う。
- 必須制約は[設計業務標準](../rules/02-design-protocol.md)、[UI業務標準](../rules/06-ui-md3-protocol.md)、[気象データ業務標準](../rules/07-wx-data-protocol.md)による。画像の色値や装置名は実装へ転記しない。

## 2. 承認済みの設計詳細

以下の操作詳細は2026-10-04にユーザー承認済み。【確定】として製造する。ブザー停止は確認とみなさず、F8およびヘッダーのブザー停止で確認状態を変更しない。

| 論点 | 承認済み仕様 | 対案・違い |
| --- | --- | --- |
| 検索日時 | 発生日時`occurredAt`を日本標準時（JST）で入力し、開始・終了の両端を含む。秒まで指定可能。空欄の側は無制限 | 受信日時: 受信順を探せるが表示列の日時と条件が一致しない |
| 条件クリア | 入力・適用済み条件・エラーを初期値へ戻し、即時に全件表示 | 検索まで未適用: 操作数が増える |
| 画面間の保持 | 同じ端末で別画面へ移動して戻っても入力・適用条件を保持。端末切替・再読み込みで初期化 | 毎回初期化: 再検索が必要になる |
| 情報種別選択肢 | H/K可視条件適用後の保持行の`sourceType`から生成。選択済み値は行の消失後も選択肢に保持 | 固定カタログ: 空の種別も選べるが将来種別の追加管理が必要 |
| 不正期間 | 開始が終了より後、または解釈不能ならエラーを表示し、前回の適用条件・一覧を保つ | 自動補正: 入力意図を推測する必要がある |

既知の情報種別表示名は#67の表示用関数を共有する。未知の`sourceType`は元の識別子を表示し、隠さず検索可能とする。通知区分は「すべて・警報・問いかけ・非常」の単一選択。各条件はANDで結合する。起動現況も検索日時の条件を適用する（保持期限の例外とは別）。検索中も新着・期限失効を現在の適用条件で再評価する。

## 3. モジュールと契約

変更予定は`apps/web/src/warnings/`の一覧部品・検索部品・純関数とテスト、`App.tsx`の条件保持接続に限定する。#67が別のディレクトリ名を採る場合は同じ一覧機能配下へ揃える。API・DB・共通通知型・通知受信フック・ヘッダー鳴動／ブザー停止ロジックは#67でユーザー訂正を反映し、#68では変更しない。

```typescript
interface WarningListFilterDraft {
  readonly category: NotificationCategory | 'all';
  readonly sourceType: string | 'all';
  readonly fromLocal: string;
  readonly toLocal: string;
}
interface WarningListFilter {
  readonly category: NotificationCategory | 'all';
  readonly sourceType: string | 'all';
  readonly fromEpochMs: number | null;
  readonly toEpochMs: number | null;
}
type WarningListFilterParseResult =
  | { readonly ok: true; readonly filter: WarningListFilter }
  | { readonly ok: false; readonly message: string };
function parseWarningListFilter(draft: WarningListFilterDraft): WarningListFilterParseResult;
function matchesWarningListFilter(item: NotificationFeedItem, filter: WarningListFilter): boolean;
function filterWarningListItems(
  items: readonly NotificationFeedItem[],
  filter: WarningListFilter,
): readonly NotificationFeedItem[];
```

- ファイル案: `warningListFilters.ts`（型・純関数）、`WarningListFilters.tsx`（入力）、それぞれのテスト。初期状態は`all`・`all`・空欄・空欄。
- #67の`WarningHistoryEntry`は`item`と`firstReceivedAtMs`を持ち、`NotificationUiState.warningHistory`に保持される。`selectWarningHistory(entries, mode, nowMs)`が返す`readonly NotificationFeedItem[]`を検索へ渡す。検索後の並びは#67の整列順を維持し、入力配列や保持履歴を変更しない。
- 入力状態と適用済み条件を分け、入力中は表示を変えない。「検索」またはフォーム送信で検証後に適用する。ブラウザーのローカルタイムゾーンに依存せずJSTとして変換する。
- 検索はメモリー内の選択処理のみ。APIエンドポイントの追加・呼び出しはない。空結果は「条件に一致する通知はありません」と表示する。保持行自体が空の場合は#67の空表示を使う。
- `source`は起動／差分、`origin`は気象／装置、`detectionContext`は検知文脈、`isTraining`は訓練であり、`category`条件の代わりに使用しない。訓練も初期表示に含み、フィルター後もバッジを保持する。nullを偽の値に置き換えない。
- 検索範囲外の通知も共通storeで受信・鳴動を継続する。ブザー停止を確認状態の変更として扱わない。絞り込み、条件クリア、画面移動でcursor・未読・確認状態を書き換えず、過去通知を再投入しない。

## 4. UI

上部フォームは開始日時・終了日時・通知区分・情報種別・検索・条件クリア。狭い幅では条件部を折り返し、表のスクロール領域を圧迫しすぎない。入力には日本語の関連付け済みラベル、エラーには読み上げ可能な通知を設ける。

ボタンは`components/md`の`GbButton`を使う。日時入力と選択は既存のネイティブ`input`・`select`利用に揃え、配色は`--md-sys-color-*`を使う。生の`md-*`タグや登録だけのbare importは追加しない。固定見出し・表列・行の密度は#67の責務で、#68は余分な説明行や列を足さない。

## 5. 受け入れ条件

- [ ] AC1: #67一覧に複数区分・複数種別・複数日時・起動／差分・本番／訓練のfixtureを用意して開く。初期条件ですべての端末可視行が#67と同じ順・同じ列で表示される。列順は「発生日時・通知区分・対象サービス・情報種別・内容」、対象サービスは全行「防災気象情報」、内容は改行を全角スペースへ置換した1行表示である。
- [ ] AC2: 各通知区分を選択して検索する。対応する`category`だけ残る。`source`・`origin`・`detectionContext`・`isTraining`が違っても同一区分なら残る。
- [ ] AC3: 情報種別を選択して検索する。`sourceType`が一致する行だけ残る。未知の種別を含むfixtureも選択・検索できる。Hで装置系選択肢・行が現れず、Kでは現れる。
- [ ] AC4: JSTの開始・終了と等しい時刻、およびその前後1秒の行を用意し検索する。等しい両端だけ含まれ、前後は除外される。片側空欄・両側空欄も検証する。テストのタイムゾーンを変えても一致する行は同じ。
- [ ] AC5: 区分・種別・日時を組み合わせると全条件を満たす行だけ残る。起動時でも発生日時が条件外なら検索結果に含まれない。訓練・起動時表示は検索後も残る。
- [ ] AC6: 条件入力だけでは一覧が変わらず、検索で反映される。逆転期間を送信すると日本語エラーが表示され、直前の結果を維持する。条件クリアで入力とエラーが消え、検索を再操作せず全件へ戻る。
- [ ] AC7: 絞り込み中に一致する新着、不一致の新着、#67期限切れを順に発生させる。一致する新着だけが現れ、期限切れは消える。選択中の種別の最後の行が消えても入力を勝手に変えない。条件一致なしでは空結果文言が出る。
- [ ] AC8: 検索・クリア前後のcursor・未読集合・確認集合を比較して検索操作による変化がないことを確認。不一致の新着でもヘッダー通知・鳴動・F8によるブザー停止が動作し、停止前後で確認集合が変更されない。検索・クリアで過去通知の再鳴動や追加API要求が起きない。
- [ ] AC9: 条件入力後に他画面へ移動して戻ると入力・適用条件が残る。端末切替・再読み込みで初期化される。キーボードで全入力と検索・クリアを操作できる。
- [ ] AC10: 実画面で条件部・固定見出し・縦横スクロールを確認する。色ハードコード・個別確認操作・確認時刻／端末名称／自端末全端末切替が追加されていない。
- [ ] AC11: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`を実行し合格する。追加テストは[検証業務標準](../rules/05-verification-protocol.md)のred確認・対照実験を記録する。

## 6. 実挙動未確認・引継ぎ

本設計ではコードと既存設計書を確認した。devサーバー、ブラウザー、実通知での動作は未確認。#67の設計書と公開型・部品パスを照合した。GitHubの最新本文はこの担当のCLIから通信できず、リポジトリ内の棚卸しに保存された#68本文を参照した。

AD-H066: 今回は端末内の保持上限と検索範囲を定める。検索は保持期限・cursorへ影響しない。永続履歴検索・端末間履歴・再読み込み後の履歴取得を実装済みとは扱わない。

サーバーには通知出力履歴と`GET /api/monitoring/notification-outputs`が存在する（[#42設計](issue-42-monitoring-rest-apis.md)）。これは端末ごとの受信・確認履歴と同義ではない。本番PoCの全端末表示では、検知通知と起動出力の対応、端末ごとの出力／受信／確認の意味、権限、保持・ページングを別途決める。今回の条件型・純関数は表示責務として分離しておき、将来サーバー検索を採用する際に取得層を差し替えられる構成にする。ただし履歴API接続やDB変更は今回行わない。

作成: Codex (GPT-6.1 Sol) <noreply@openai.com>

製造・検収の承認範囲: #67・#68を`codex/issue-67-68-warning-list`で実装し、合同検収後に1本のPRへまとめる。設計コミットは統括担当が行う。
