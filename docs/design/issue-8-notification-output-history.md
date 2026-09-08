# Issue #8「B4. 通知出力履歴テーブルの設計・実装」設計

作成日: 2026-09-09

## 1. 目的と範囲

基本設計 §7.3・§8.1・§8.4 に基づき、バックエンドが「通知として出す」と判定した個別の 1 件を SQLite に永続化する。B1 の forward-only migration に通知出力履歴表を追加し、追記・単件取得・一覧検索・件数取得・単件削除を行う最小のリポジトリ層とテストを実装する。

本履歴が表すのは**通知生成の事実**である。端末への配信成功、実際の鳴動、利用者の確認・回答、ブザー停止完了は表さず、それらの状態列も追加しない。

本 Issue は保存境界だけを扱う。次は対象外とする。

- 通知の正規な共有ドメイン型、および共有型から本履歴への変換処理（Issue #25）
- 気象情報・装置異常から通知を判定するロジック（Epic D2 以降）
- 通知メッセージ定義の選択、テンプレート展開、操作定義（Issue #103）
- 通知履歴 REST API（Epic E）、履歴閲覧 UI（Epic K）
- 確認状態のサーバー側追跡（基本設計 §1・§7.1 で今回対象外）
- 一括・期間削除と削除権限（B6）

## 2. 参照資料と確認結果

### 2.1 参照資料

- [Issue #8](https://github.com/BlueKurage119/wx-viewer-poc/issues/8) — B4 の対象項目と受け入れ条件
- [Issue #25](https://github.com/BlueKurage119/wx-viewer-poc/issues/25) — 通知用共有データ型と B4 変換の責務
- [Issue #103](https://github.com/BlueKurage119/wx-viewer-poc/issues/103) — メッセージ定義、定義識別子・版、生成済み文言の責務
- [基本設計](../basic-design.md) §7.3、§8.1、§8.4（併せて §1、§3.4、§7.6、§7.7）
- [Issue 化ドラフト](../issues-draft.md) B4
- [Issue #5 設計](issue-5-sqlite-persistence.md) — migration 規則、`DatabaseConnection`、`initializeDatabase`
- [Issue #6 設計](issue-6-info-type-schema.md)、[テーブル定義書](issue-6-table-definition.md) — B2 の表・リポジトリ規約
- [Issue #7 設計](issue-7-reception-history.md) — B3 の追記ログ、検索・ページング、後続 migration の規約
- 実装済みの `apps/api/migrations/0001`〜`0010`、`apps/api/src/database/migrations.ts`、`apps/api/src/repositories/`、`apps/api/tests/history*.test.ts`
- 既存画面試作の `apps/web/src/shell/notifications.ts` — 画面内だけで使う暫定通知型

### 2.2 実装から確認した前提

- 最新の適用済み業務 migration は `0010_create_telegram_reception.sql`。B4 は `0011` を使う。
- migration 名は `NNNN_<name>.sql`、小文字英数字とアンダースコアのみ、forward-only である。SQL 内に `BEGIN` / `COMMIT` / `ROLLBACK` を書かず、適用済み `0001`〜`0010` を編集しない。
- DB 接続は `DatabaseConnection` を関数の第 1 引数で受け取る。SQL は prepared statement と bind parameter を使う。
- 時刻はアプリケーションから UTC ISO 8601 文字列として渡す。`CURRENT_TIMESTAMP` の既定値は使わない。
- B3 の一覧は既定 100 件・上限 1000 件、時刻降順＋`id` 降順、同じ条件を一覧と件数取得で共有する。本 Issue もこの契約を踏襲する。
- `issue-6-table-definition.md` は migration 追加時の更新を明記しているため、B4 実装時に `0011` の定義を追記する。

### 2.3 ヒアリングで確定した事項

1. 通知出力履歴は「通知として出すと判定された個別の 1 件」を追跡する。端末での鳴動・確認完了の記録ではない。
2. `origin` は原因の系統を表し、気象内容と装置異常を区別する。
3. 通常取得での検知か、起動時の初期取得・復旧での検知かは `origin` に混ぜず、別の `detectionContext`（`normal` / `initial`）として保存する。
4. 通知文面・操作は履歴とは別の定義として管理する。Issue #103 が型付き静的設定として実装し、SQL のメッセージ定義表は今回作らない。
5. `summary` はテンプレートへの参照ではなく、**通知生成時に完成していた表示文言のスナップショット**を保存する。定義が後日変更されても既存履歴の `summary` は変わらない。

## 3. 責務境界と設計判断

### 3.1 1 行の単位と追記性

`notification_output_history` の 1 行は、通知判定処理が一意な `notificationId` を与えて生成した通知 1 件に対応する。`notification_id` へ UNIQUE 制約を張り、同じ通知を同じ識別子で二重記録しない。

リポジトリの `recordNotificationOutputHistory` は INSERT のみとし、UPSERT をしない。同じ原因・同じ版でも、別の状態変化として別の `notificationId` が付いた通知は別行として保存できる。逆に「同一情報の再取得で通知を生成しない」という判定は Epic D の責務であり、B4 が `source_version` を使って暗黙に抑止しない。

保存後に内容を更新する API は設けない。`summary` を含む行全体を当時のスナップショットとして固定する。単件削除だけは訓練データの抹消および B6 の接続点として提供するが、一括・期間削除は実装しない。自動削除、TTL、ローテーション、削除トリガーも作らない。

### 3.2 `origin` と `detection_context`

永続値を次に固定する。

| 列 | 値 | 意味 |
| --- | --- | --- |
| `origin` | `weather` | 気象内容を原因として生成した通知 |
| `origin` | `system` | 取得失敗・遅延等の装置異常を原因として生成した通知 |
| `detection_context` | `normal` | 通常の取得・更新中に検知した通知 |
| `detection_context` | `initial` | プロセス起動時の初期取得・現況復元で検知した通知 |

基本設計 §7.3 の項目案では `origin` が通常検知／初期取得を表し、§8.4 では同名フィールドが気象内容／装置異常を表していた。ヒアリング結果に従い、原因系統だけを `origin`、検知文脈を `detection_context` として分離する。これにより `weather + initial` や `system + normal` を直交して表現できる。

既存 `apps/web/src/shell/notifications.ts` の `origin: 'weather' | 'equipment'` は共通データ型ではなく画面試作用の暫定型である。B4 ではヒアリングで合意した `system` を正とし、既存画面型は変更しない。Issue #25 および後続の UI 接続時に `system` へ統一する。

### 3.3 Issue #25 との境界

Issue #25 は `notificationId`、`category`、`targetArea`、`relatedRefs` 等を持つ正規の共有 `Notification` 型を定義し、本リポジトリの入力へロスなく変換する mapper を実装する。本 Issue はその共有型を `packages/shared` に作らず、通知判定から DB への mapper も作らない。

B4 のリポジトリ入力は DB 境界の内部表現であり、構造が Issue #25 で確定する `targetArea` と `relatedRefs` は、それぞれ `targetAreaJson` と `relatedRefsJson` の妥当な JSON 文字列として受け取る。B4 は JSON の構文だけを検証し、オブジェクトのプロパティ名、参照種別、通知区分・状態変化の正規な値集合を決めない。これらは Issue #25 の型と mapper が所有する。

この方式を採る理由は次のとおり。

- Issue #8 の項目を 1 表で欠落なく保存でき、未確定の共有型を B4 が先取りしない。
- `targetArea` と `relatedRefs` は §8.1 の一覧検索軸に含まれず、B4 で正規化表を増やす利益がない。
- Issue #25 の mapper で JSON 化・復元を一箇所に閉じられる。B4 は受け取った JSON 文字列を改変・再整形せず保存し、完全一致で返す。

Issue #25 が確定する JSON 形状から区域コード等を SQL で検索する要件が後から生じた場合は、適用済み `0011` を編集せず、新規 migration で検索列または明細表を追加する。

### 3.4 Issue #103 との境界

`message_definition_id` と `message_definition_version` を nullable の接続列として `0011` に用意する。両列は、Issue #103 の導入前に作られる履歴ではともに NULL、Issue #103 が生成する通知ではともに非 NULL とし、片方だけの状態を CHECK 制約で禁止する。

この 2 列には外部キーを張らない。Issue #103 の初期実装は SQL 表ではなく型付き静的設定であり、また将来定義を更新・削除しても既存履歴を失効させてはならないためである。定義の選択、テンプレート、差し込み値、見出し・本文・操作（例: `確認`）の生成は Issue #103 に残す。

`summary` は常に NOT NULL の完成済み表示文言である。たとえば Issue #103 が「気象警報発表」「レベル3大雨警報」を生成した場合、Issue #103／#25 の mapper が画面へ渡す最終表現と同じ規則で組み立てた文字列を `summary` に渡す。B4 は文言を再生成しない。操作ラベルは履歴の項目案にないため B4 に追加せず、確認要否は `ack_required` に保存する。将来、操作内容や差し込み値そのものの監査が必要になれば Issue #103 側の要件として新しい forward migration を追加する。

### 3.5 外部キーを持たない原因参照

`source_type`、`source_version`、`target_area_json`、`related_refs_json` は原因情報の値スナップショットであり、B2 のスナップショット表、B3 の受信履歴、取得元状態表へ外部キーを張らない。

- B2 の現在値は更新・置換されるが、過去の通知理由は残す必要がある。
- `origin='system'` の通知には電文・区域が存在しない場合がある。
- B6 で各履歴を独立して明示削除できる必要がある。
- `relatedRefs` の参照先が消えても、参照文字列と当時の `summary` は履歴に残す。

関連画面への解決方法は Issue #25／Epic E が定める。B4 は参照先の存在検証を行わない。

### 3.6 通知区分・状態変化・確認要否

`category` と `change_type` は非空 TEXT とし、DB の CHECK で値集合を列挙しない。Issue #25 が正規な共有 union 型を定義する責務と重複させず、装置異常系の状態変化など後続 Issue で必要になる値を適用済み migration の編集なしに受け入れるためである。

B4 のテストデータでは既存画面試作に合わせ、通知区分に `warning` / `question` / `emergency` を使う。`ack_required` は入力された真偽値をそのまま保存し、B4 が区分から導出・補正しない。`warning => false`、`question | emergency => true` の正規な関係は Issue #25／#103 が型・生成処理で保証する。

## 4. テーブル定義

### 4.1 migration

追加する migration は `apps/api/migrations/0011_create_notification_output_history.sql` の 1 本とする。`0001`〜`0010` は編集しない。

### 4.2 `notification_output_history`

| 列 | 型 | 制約 | 内容 |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY | DB 内部の連番 |
| `notification_id` | TEXT | NOT NULL、UNIQUE、空文字禁止 | 通知の一意識別子 |
| `category` | TEXT | NOT NULL、空文字禁止 | 通知区分。値集合は Issue #25 が所有 |
| `source_type` | TEXT | NOT NULL、空文字禁止 | 原因となる気象情報種別または装置異常の取得元種別 |
| `source_version` | TEXT | NULL 可、空文字禁止 | 原因情報の版。版を持たない装置異常等は NULL |
| `target_area_json` | TEXT | NULL 可、空文字禁止 | Issue #25 の `targetArea` を mapper が JSON 化した値。対象地域を持たない通知は NULL |
| `occurred_at` | TEXT | NOT NULL | 原因となる状態変化が発生した時刻 |
| `detected_at` | TEXT | NOT NULL | サーバーが検知し、通知として出すと判定した時刻。§8.1 の出力時刻に相当 |
| `change_type` | TEXT | NOT NULL、空文字禁止 | 新規・強化・緩和・解除・訂正・取消・装置状態変化等の生成理由。値集合は Issue #25 が所有 |
| `ack_required` | INTEGER | NOT NULL、0/1 CHECK | 通知時点で確認・回答操作を要するか。完了状態ではない |
| `summary` | TEXT | NOT NULL、空文字禁止 | 生成済み表示文言のスナップショット |
| `related_refs_json` | TEXT | NOT NULL、空文字禁止 | Issue #25 の `relatedRefs` を mapper が JSON 化した値。参照なしは `[]` |
| `origin` | TEXT | NOT NULL、`weather` / `system` CHECK | 原因系統 |
| `detection_context` | TEXT | NOT NULL、`normal` / `initial` CHECK | 通常検知／初期取得・復旧の区別 |
| `is_training` | INTEGER | NOT NULL、0/1 CHECK | 訓練由来か |
| `message_definition_id` | TEXT | NULL 可、空文字禁止 | Issue #103 が選んだメッセージ定義識別子 |
| `message_definition_version` | TEXT | NULL 可、空文字禁止 | Issue #103 が選んだ定義版 |

追加制約:

```sql
CHECK (
  (message_definition_id IS NULL AND message_definition_version IS NULL)
  OR
  (message_definition_id IS NOT NULL AND message_definition_version IS NOT NULL)
)
```

DB の CHECK では JSON の構造を決めない。リポジトリ層で `JSON.parse` が成功することだけを確認してから保存する。返却時は保存済み文字列を再 stringify せず、そのまま返す。

### 4.3 索引

```sql
CREATE INDEX idx_notification_output_history_detected
  ON notification_output_history (detected_at DESC, id DESC);
CREATE INDEX idx_notification_output_history_category
  ON notification_output_history (category, detected_at DESC, id DESC);
CREATE INDEX idx_notification_output_history_source
  ON notification_output_history (source_type, detected_at DESC, id DESC);
CREATE INDEX idx_notification_output_history_origin
  ON notification_output_history (origin, detected_at DESC, id DESC);
CREATE INDEX idx_notification_output_history_context
  ON notification_output_history (detection_context, detected_at DESC, id DESC);
CREATE INDEX idx_notification_output_history_training
  ON notification_output_history (is_training, detected_at DESC, id DESC);
```

`notification_id` の UNIQUE 制約が単件検索用索引を兼ねる。`target_area_json` と `related_refs_json` は B4 の検索対象にしないため索引を作らない。

## 5. モジュール・型・API

### 5.1 追加・変更対象

```text
apps/api/
├── migrations/
│   └── 0011_create_notification_output_history.sql
├── src/repositories/
│   ├── types.ts                              # DB 境界専用の入力・返却・検索型
│   ├── notificationOutputHistoryRepository.ts # INSERT / SELECT / DELETE
│   └── index.ts                              # リポジトリ export
└── tests/
    ├── schema.test.ts                         # migration 総数期待値を 10 → 11
    ├── historySchema.test.ts                  # migration 総数期待値を 10 → 11
    ├── notificationOutputHistorySchema.test.ts
    └── notificationOutputHistoryRepository.test.ts

docs/design/
└── issue-6-table-definition.md               # 0011 の実 DDL を追記
```

`schema.test.ts` と `historySchema.test.ts` は現状 migration ファイル数を 10 と固定しているため、`0011` 追加に合わせて期待値だけを 11 へ更新する。`packages/shared`、`apps/web`、Express の route、既存 migration `0001`〜`0010` は変更しない。

### 5.2 DB 境界専用型

`apps/api/src/repositories/types.ts` に次を追加する。これは API workspace 内部型であり、Issue #25 の共有 `Notification` 型ではない。

```ts
import type { UtcIso8601String } from '@wx-viewer-poc/shared';

export type NotificationOutputOrigin = 'weather' | 'system';
export type NotificationDetectionContext = 'normal' | 'initial';

export interface NotificationOutputHistoryInput {
  readonly notificationId: string;
  readonly category: string;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly targetAreaJson: string | null;
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly changeType: string;
  readonly ackRequired: boolean;
  readonly summary: string;
  readonly relatedRefsJson: string;
  readonly origin: NotificationOutputOrigin;
  readonly detectionContext: NotificationDetectionContext;
  readonly isTraining: boolean;
  readonly messageDefinitionId: string | null;
  readonly messageDefinitionVersion: string | null;
}

export interface NotificationOutputHistory extends NotificationOutputHistoryInput {
  readonly id: number;
}

export interface ListNotificationOutputHistoryOptions {
  readonly category?: string;
  readonly sourceType?: string;
  readonly changeType?: string;
  readonly origin?: NotificationOutputOrigin;
  readonly detectionContext?: NotificationDetectionContext;
  readonly isTraining?: boolean;
  readonly detectedAtFrom?: UtcIso8601String;
  readonly detectedAtTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number; // 既定 0
}
```

### 5.3 リポジトリ API

```ts
export function recordNotificationOutputHistory(
  connection: DatabaseConnection,
  input: NotificationOutputHistoryInput,
): NotificationOutputHistory;

export function findNotificationOutputHistoryById(
  connection: DatabaseConnection,
  id: number,
): NotificationOutputHistory | null;

export function findNotificationOutputHistoryByNotificationId(
  connection: DatabaseConnection,
  notificationId: string,
): NotificationOutputHistory | null;

export function listNotificationOutputHistory(
  connection: DatabaseConnection,
  options?: ListNotificationOutputHistoryOptions,
): readonly NotificationOutputHistory[];

export function countNotificationOutputHistory(
  connection: DatabaseConnection,
  options?: ListNotificationOutputHistoryOptions,
): number;

export function deleteNotificationOutputHistory(
  connection: DatabaseConnection,
  id: number,
): boolean;
```

契約:

- `recordNotificationOutputHistory` は INSERT のみ。重複 `notificationId` は UNIQUE 違反として失敗し、既存行を書き換えない。
- 一覧は `ORDER BY detected_at DESC, id DESC`。既定 100 件、上限 1000 件。`limit <= 0` または `offset < 0` は例外にする。
- 件数取得は一覧と同じ filter builder を使い、`limit` / `offset` を無視する。
- `category` / `sourceType` / `changeType` は完全一致。時刻範囲は境界を含む。`isTraining: false` は SQL で `is_training = 0` とし、未指定と混同しない。
- `ack_required` / `is_training` は DB の 0/1 と TypeScript の boolean を明示変換する。truthy/falsy の暗黙変換を使わない。
- 非空文字列、UTC ISO 8601 時刻、`origin`、`detectionContext`、JSON 構文、メッセージ定義 ID／版の両方 NULL または両方非 NULLを INSERT 前に検証する。
- 読み出した `origin`、`detection_context`、0/1、JSON 文字列も検証し、DB 内に不正値があれば黙って既定値へ丸めず例外にする。
- `summary`、`targetAreaJson`、`relatedRefsJson` は入力内容を加工せず完全一致で返す。
- SQL 値を文字列連結しない。接続をモジュールスコープに保持しない。

## 6. テスト設計

既存 B2／B3 と同様に、各テストは `mkdtemp` で一時 DB を作り、本番 `migrations/` を `initializeDatabase` で適用する。アサーションは原則完全一致とする。

### 6.1 スキーマテスト

`notificationOutputHistorySchema.test.ts` で次を検証する。

1. 本番 migration を適用すると `notification_output_history` が存在し、migration ファイル数と適用件数が 11 で一致する。
2. `PRAGMA table_info(notification_output_history)` の列名・型・NOT NULL 指定が §4.2 の 17 列と完全一致する。
3. `origin` は `weather` / `system` を保存でき、それ以外は CHECK 違反になる。
4. `detection_context` は `normal` / `initial` を保存でき、それ以外は CHECK 違反になる。
5. `ack_required` / `is_training` は 0 / 1 を保存でき、それ以外は CHECK 違反になる。
6. `message_definition_id` / `message_definition_version` は両方 NULL または両方非 NULLを保存でき、片方だけは CHECK 違反になる。
7. 同じ `notification_id` を 2 回 INSERT すると UNIQUE 違反になり、先の 1 行が変化しない。
8. 同じ `source_type` / `source_version` の別 `notification_id` は 2 行保存できる。
9. `sqlite_master` に本表を対象とする trigger がなく、自動削除・自動更新がない。
10. `PRAGMA foreign_key_list(notification_output_history)` が 0 件で、B2／B3／Issue #103 の実装へ依存しない。
11. migration を 2 回実行すると 2 回目の `appliedVersions` が空で、1 回目に保存した行が残る。

### 6.2 リポジトリテスト

`notificationOutputHistoryRepository.test.ts` で次を検証する。

1. 全列を埋めた気象通知（`weather + normal`、定義 ID／版あり）を記録し、数値 `id` と `notificationId` の両方から完全一致で取得できる。
2. 装置異常通知（`system + initial`、`sourceVersion` / `targetAreaJson` / 定義 ID／版が NULL）を保存でき、NULL が空文字へ変換されない。
3. `targetAreaJson` と `relatedRefsJson` が妥当な JSON なら文字列が再整形されず完全一致で往復し、不正 JSON は保存前に例外になる。
4. `ackRequired` / `isTraining` の true / false が 1 / 0 を経由して完全一致で往復する。
5. `summary` に完成済み文言 `気象警報発表　レベル3大雨警報` を保存できる。同じ定義 ID の別通知に異なる `summary` を保存しても、先の履歴が変化しない。
6. `listNotificationOutputHistory` は `detectedAt` の新しい順、同時刻は `id` の大きい順で返す。
7. `category` / `sourceType` / `changeType` / `origin` / `detectionContext` / `isTraining` / `detectedAtFrom` / `detectedAtTo` の各条件と複合条件が完全一致で効く。`countNotificationOutputHistory` が同じ条件のページング前件数を返す。
8. `isTraining: false` が通常通知だけを返し、訓練通知を混入させない。オプション未指定では両方を返す。
9. `limit` / `offset` でページングでき、既定 100、`limit=5000` は 1000、0・負値は例外になる。
10. 重複 `notificationId` の記録が失敗し、UPSERT で既存 `summary` を変更しない。
11. 非 ISO 時刻、空の必須文字列、不正 `origin` / `detectionContext`、定義 ID／版の片方だけを入力すると保存前に例外になる。
12. `deleteNotificationOutputHistory` で対象 1 行だけが消え、存在しない `id` では false、他の履歴は完全一致で残る。

### 6.3 テストの有効性確認

実装担当は AGENTS.md と B1／B2／B3 の規律に従い、次の順で確認する。

1. 実装前にテストを追加し、`0011` またはリポジトリがないため失敗すること（red）を確認する。
2. 空白・ローカル変数名だけの意味を変えない変更でテストが成功し続ける対照実験を先に行う。
3. 次の変異を 1 つずつ加え、対応テストが失敗することを確認する。
   - `notification_id` の UNIQUE 制約を外す。
   - `origin` または `detection_context` の CHECK 制約を外す。
   - `message_definition_id` / `message_definition_version` の組制約を外す。
   - INSERT を `ON CONFLICT ... DO UPDATE` に変える。
   - `ack_required` / `is_training` の読み出しを常に true にする、または書き込みを常に 1 にする。
   - `isTraining: false` の filter 条件を未指定扱いにする。
   - `detectionContext` の filter 条件を外す。
   - `summary` を保存せず、別の列から読み出し時に合成する。
   - JSON 構文検証を外す。
   - `limit` の上限丸めを外す。
4. 変異を元に戻し、対象テストが再度成功することを確認する。一時変更はコミットしない。

## 7. 実行可能な受け入れ条件

検収担当は次を上から順に実行する。

1. `npm run build` が成功する。
2. `npm run typecheck`、`npm run lint`、`npm run format:check` がエラー 0 で終了する。
3. `npm run test -w apps/api` が全件成功する。
4. 既存 `schema.test.ts` / `historySchema.test.ts` の migration 総数期待値が 11 へ更新され、B2／B3 の既存スキーマ検証内容は変更されていない。
5. `apps/api/migrations/0011_create_notification_output_history.sql` が存在し、`git diff --stat main -- apps/api/migrations` に `0001`〜`0010` が現れない。
6. `grep -iE '^\\s*(begin|commit|rollback)' apps/api/migrations/*.sql` が 0 件である。
7. 一時 DB に本番 migration を適用すると `__schema_migrations` が 11 行となり、`notification_output_history` が存在する。2 回目の適用では新規適用が 0 件である。
8. `PRAGMA table_info(notification_output_history);` が §4.2 の 17 列を列名一致で返す。
9. `origin` に `weather` / `system`、`detection_context` に `normal` / `initial` を保存でき、列挙外は CHECK 違反になる。
10. `ack_required` / `is_training` に 0 / 1 を保存でき、2・-1 等は CHECK 違反になる。
11. 定義 ID／版が `(NULL, NULL)` と `(非NULL, 非NULL)` なら保存でき、片方だけなら CHECK 違反になる。
12. Issue #8 の項目案が次の対応で全て保存され、`recordNotificationOutputHistory` → `findNotificationOutputHistoryByNotificationId` で完全一致する。

    | Issue #8 の項目 | 永続表現 |
    | --- | --- |
    | `notificationId` | `notification_id` |
    | `category` | `category` |
    | `sourceType` | `source_type` |
    | `sourceVersion` | `source_version` |
    | `targetArea` | `target_area_json` |
    | `occurredAt` | `occurred_at` |
    | `detectedAt` | `detected_at` |
    | `changeType` | `change_type` |
    | `ackRequired` | `ack_required` |
    | `summary` | `summary` |
    | `relatedRefs` | `related_refs_json` |
    | `origin` | `origin` |
    | `isTraining` | `is_training` |
    | ヒアリング追加 | `detection_context` |

13. 同一 `notification_id` の再 INSERT は失敗して既存行を変更せず、同一 `source_type` / `source_version` でも別 `notification_id` なら追記できる。
14. `summary` の完全一致テストが成功し、同じメッセージ定義を使う後続通知を追加しても既存行の `summary` が変化しない。
15. `listNotificationOutputHistory({ origin: 'weather', detectionContext: 'initial', isTraining: false })` が 3 条件をすべて満たす行だけを返す。
16. `PRAGMA foreign_key_list(notification_output_history);` が 0 件である。B2／B3 の行や将来のメッセージ定義を削除しても、本履歴単体の値を失わない構造である。
17. `sqlite_master` に本表を対象とする trigger がなく、自動削除・自動ローテーションがない。
18. `docs/design/issue-6-table-definition.md` に migration `0011` と本表の全列・制約・索引が実 DDL と一致して追記されている。
19. `git status --porcelain` に、設計書、`0011`、リポジトリの型・実装・export、既存スキーマテストの migration 件数更新、B4 テスト、テーブル定義書以外の変更が含まれない。`packages/shared` と `apps/web` に差分がない。

## 8. 後続 Issue への引き継ぎ

### 8.1 Issue #25（通知用データモデル）

- 正規の共有 `Notification` 型に、Issue #8 の各項目に加えて `detectionContext: 'normal' | 'initial'` を必須で持たせる。
- `origin` は B4 と同じ `weather` / `system` に統一する。既存画面試作の `equipment` は共有型へ持ち込まない。
- 共有型の `targetArea` と `relatedRefs` を JSON 化し、B4 の `targetAreaJson` / `relatedRefsJson` へロスなく変換し、逆変換できる mapper を実装する。JSON の正規形とプロパティ定義は #25 が所有する。
- UTC 時刻、boolean、nullable 値、`origin`、`detectionContext`、全 JSON 項目が往復で完全一致する変換テストを追加する。
- B4 は `category` / `change_type` を自由記述 TEXT として受けるが、共有型では正規な union とし、列挙外の値を生成しない。
- B4 への保存を通知生成と同一トランザクションにするかは通知生成サービスの設計時に決める。B4 リポジトリは外側から渡された接続で実行でき、独自に接続・トランザクションを保持しない。

### 8.2 Issue #103（通知メッセージ定義）

- 定義識別子と版を B4 の `messageDefinitionId` / `messageDefinitionVersion` へ両方渡す。
- 見出し・本文テンプレートに差し込み値を適用した**生成済み表示文言**を B4 の `summary` へ渡す。B4 にテンプレート文字列を渡さない。
- `summary` の連結・改行等の正規な生成規則、操作ラベル、差し込み値の型と検証は #103 が所有する。
- #103 の初期管理方式は型付き静的設定であり、B4 にメッセージ定義 SQL 表や FK を追加しない。
- 操作内容・差し込み値そのものを監査対象にする要件が確定した場合は、適用済み `0011` を編集せず新規 migration とリポジトリ入力の拡張で対応する。

### 8.3 Epic D2 以降

- 通知判定で一意な `notificationId` を発行し、同一情報の再取得で通知自体を重複生成しない。B4 の UNIQUE 制約を通常の重複判定手段にはしない。
- 通知発生時に B4 を 1 回記録する。端末が通知を取得・表示・再提示するたびに履歴を追加しない。
- 初期取得・復旧で見つけた現況は `detectionContext='initial'`、通常更新は `normal` とする。これは `changeType` と独立に設定する。
- 装置異常通知は `origin='system'` とし、原因取得元を `sourceType`、状態遷移を `changeType`、発生・検知時刻をそれぞれ渡す。気象電文がないことを理由に偽の `sourceVersion` / `targetArea` を作らない。

### 8.4 Epic E・Epic K・B6

- Epic E の一覧 API は B4 の一覧・件数関数を使い、ページングを必須にする。通常表示で訓練を除外する場合は `isTraining: false` を明示し、未指定を通常扱いにしない。
- H 端末相当表示で装置異常を除外する場合は `origin='weather'` で絞る。保存時には端末モードで除外せず、全通知を共通に保持する。
- Epic K の出力履歴では `detectedAt` を出力時刻、`detectionContext` を起動時／通常更新の区別として表示する。`ackRequired` を確認済み状態として表示しない。
- B6 は単件削除関数を足場に一括・期間削除を設計するが、自動削除・TTL・ローテーションは追加しない。訓練データの抹消要件では `is_training=1` を明示して対象を限定する。

## 9. 未確認事項

次は後続 Issue の責務として未確定であり、B4 製造を止める要確認事項ではない。

- `category` と `changeType` の正式な共有 union 値、および `targetArea` / `relatedRefs` の JSON 形状は Issue #25 で確定する。B4 は非空文字列・妥当な JSONとして保存できるため、今回の migration 変更を要しない。
- メッセージの見出し・本文を `summary` にどう連結するか、定義選択粒度、操作・差し込み値の型は Issue #103 で確定する。
- 通知履歴と画面の「現行・直近通知」の保持範囲、REST レスポンス形状は Epic E／K で確定する。B4 は明示削除まで全行を保持する。
- 複数プロセス／複数インスタンスでの `notificationId` 発行方式は Epic D の責務であり未確定。B4 は文字列の一意性だけを保証する。

上記以外に、Issue #8 のスキーマ・リポジトリ実装を開始する前にユーザーへ差し戻す要確認事項はない。
