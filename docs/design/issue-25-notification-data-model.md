# Issue #25「D1. 通知用データモデル」設計（改訂案）

作成日: 2026-09-12

## 1. 目的と範囲

本 Issue では、サーバーが検知した通知事実を端末宛てに固定しない共有データ型として定義し、既存の B4 `notification_output_history` へ保存する変換境界を実装する。

通知は当面 REST の pull ポーリングで全端末が共通に取得する。通知は発生した区域・地点・設備等を複数の対象として持ち、端末側は所属する会場定義（将来の端末グループ）の監視対象と照合して表示・鳴動の要否を決める。通知に端末 ID、端末グループ ID、担当 H 端末 ID、既読状態、配信済み状態を持たせない。

本 Issue の実装対象は次だけである。

- `packages/shared` の通知事実型と公開 export
- `apps/api` の通知事実から B4 リポジトリ入力への mapper
- 上記の単体テスト

次は対象外とする。

- 通知区分・状態変化を気象電文や装置状態から判定する処理（D2 以降）
- ポーリング API、取得カーソル、端末・セッション、配信・再配信
- 会場定義と通知対象の照合、端末グループ、H 端末優先順位・障害時の鳴動担当調停
- 端末内の既読・確認状態、端末通知履歴とその画面
- 選択肢のある問いかけへのサーバー操作要求、将来の受領メッセージ
- 通知メッセージの定義選択、テンプレート展開、操作定義、完成文言の生成（#103）
- 通知出力履歴 API／画面（Epic E、K4）

## 2. 参照資料と前提

- [Issue 化ドラフト](../issues-draft.md) D1
- [基本設計](../basic-design.md) §3.1、§3.3、§3.4、§6.2、§7.1〜§7.7、§8.1、§8.3、§8.4
- [B4 設計](issue-8-notification-output-history.md) §3.3〜§3.6、§5
- `apps/api/migrations/0011_create_notification_output_history.sql`
- `apps/api/src/repositories/notificationOutputHistoryRepository.ts` と `types.ts`
- `packages/shared/src/index.ts`、`venueForecastTargets.ts`
- `apps/web/src/shell/notifications.ts`（画面試作専用の暫定型）
- 統括担当が実施した Issue #25 のヒアリング結果

現行 B4 は `notification_id` の UNIQUE、`target_area_json` と `related_refs_json` の JSON 文字列、`origin`（`weather` / `system`）、`detection_context`（`normal` / `initial`）、訓練フラグ、メッセージ定義 ID／版の対を保存する。B4 はサーバーの通知出力履歴であり、端末への到達・表示・鳴動・既読・確認・回答を保存しない。`target_area_json` は既存列名のまま、改訂後は対象配列を保存する。

現行の会場定義は `east` と `trc` ごとに、市町村等警報、広域予報、アメダス、気象防災速報の対象コードを用途別に持つ。端末の表示モードとは独立した定義であり、将来は本番 PoC の単一会場における端末グループへ発展的に置き換える。D1 はこの現行構造を変更しない。

## 3. 確定した設計判断

### 3.1 通知事実と端末上の出来事を分離する

`Notification` は「サーバーが何を通知として生成したか」を表す不変の事実である。全端末が同じ `notificationId` の通知を取得しても、監視対象外の端末は取得カーソルだけを進め、表示・鳴動・既読・確認の端末履歴を作らない。対象端末だけが端末内でこれらを管理する。

サーバー通知出力履歴と端末通知履歴は別の履歴であり、将来 `notificationId` を対応キーにする。D1 は前者だけを B4 に保存する。

### 3.2 発生対象は複数であり、受信者ではない

`targets` は通知が表す発生対象の空でない配列である。区域、観測地点、設備を同じ形で示すが、端末や端末グループの宛先を表さない。端末側は自身のグループが監視する対象と、各要素の `(kind, codeType, code)` を照合する。比較処理と広域・細分区域の包含関係は本 Issue で実装しない。

気象通知は、**情報種別・状態変化・通知区分・操作条件が同一の対象群**を一件にまとめる。たとえば大田区と江東区で同じ大雨警報が発表された場合は、一件の通知に二つの area target を入れる。大雨警報、土砂災害警報、雷注意報は情報種別が異なるため、それぞれ別通知とする。発表と解除など状態変化が異なる対象も別通知とする。

通知区分、操作、受領監視の要否が異なる宛先を一件にまとめない。将来の指令伝達では、指令という発生事実と、宛先ごとの通知出力を別モデルにする。例えば東1ホールへの受領監視付き問いかけと東外務への受領監視なし警報は同じ指令に関連しても別通知となる。本 Issue の気象通知の `targets` に端末宛先を入れない。

通知本体へ担当端末を保存しない。H 端末の優先順位、接続／障害状態による担当切替は、将来サーバーがポーリング応答で調停する。通知そのものを変更せずに担当だけを切り替えられるようにするためである。

### 3.3 確認・回答のモデル化境界

`ackRequired` は「その通知に確認または回答の操作が必要か」の出力属性として B4 に保存する。ただし、D1 は操作内容を定義しない。選択肢のない確認・既読は端末内だけで完結し、選択肢付き問いかけはサーバー操作要求を発生させ、将来の受領監視付き確認は受領メッセージを発生させる。この三者の UI、操作 payload、権限、重複回答の調停は後続 Issue で定義する。

### 3.4 #103 と文言生成の責務を分ける

#103 は D1 の通知事実を入力に、静的メッセージ定義から見出し・本文テンプレート・操作・`ackRequired`・完成済み `summary` を選ぶ正規所有者である。D1 はテンプレート、差し込み値、操作、定義選択を持たない。

そのため共有 `Notification` に `summary` と `ackRequired` は含めない。基本設計 §7.3 の項目案にある両項目は、通知事実を #103 が出力用スナップショットへ解決した後の属性として扱う。B4 mapper は `Notification` と、完成済み `summary`・`ackRequired`・メッセージ定義 ID／版の組を別入力として受け取る。#25 単体では、ID／版を必ず両方 `null` にして mapper を検証する。実運用の通知判定が B4 へ記録を始めるのは、#103 がこの出力スナップショットを供給できるようになった後とする。文言を D1 や mapper が仮生成してはならない。

## 4. 型とモジュール構成

### 4.1 共有型

`packages/shared/src/notification.ts` を追加し、`packages/shared/src/index.ts` から export する。`notificationId` は通知生成時にサーバーが割り当てる、形式に意味を持たない一意な不透明文字列とする。D1 の mapper は ID を生成しない。

```ts
import type { UtcIso8601String } from './index.js';

export type NotificationCategory = 'warning' | 'question' | 'emergency';
export type NotificationOrigin = 'weather' | 'system';
export type NotificationDetectionContext = 'normal' | 'initial';

export type WeatherNotificationChangeType =
  | 'new'
  | 'continued'
  | 'strengthened'
  | 'weakened'
  | 'released'
  | 'corrected'
  | 'cancelled';

/** 装置異常の状態値は D2 以降で確定するため、D1 では非空文字列として扱う。 */
export type SystemNotificationChangeType = string;

export interface NotificationTarget {
  readonly kind: 'area' | 'point' | 'equipment';
  /** 同じ code でも意味が混ざらないよう、コード体系を表す。 */
  readonly codeType: string;
  readonly code: string;
  readonly name: string;
}

export interface NotificationRelatedRef {
  readonly type: string;
  readonly ref: string;
}

export interface NotificationMessageDefinitionRef {
  readonly id: string;
  readonly version: string;
}

interface NotificationBase {
  readonly notificationId: string;
  readonly category: NotificationCategory;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  /** 発生対象。空配列は許可しない。 */
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly detectionContext: NotificationDetectionContext;
  readonly isTraining: boolean;
}

export interface WeatherNotification extends NotificationBase {
  readonly origin: 'weather';
  readonly changeType: WeatherNotificationChangeType;
}

export interface SystemNotification extends NotificationBase {
  readonly origin: 'system';
  readonly changeType: SystemNotificationChangeType;
}

export type Notification = WeatherNotification | SystemNotification;

/** #103 が通知事実から選ぶ出力スナップショット。D1 は選択規則を所有しない。 */
export interface NotificationOutputSnapshot {
  readonly ackRequired: boolean;
  readonly summary: string;
  readonly messageDefinition: NotificationMessageDefinitionRef | null;
}
```

`targets` を非空タプルにして、発生対象を持たない通知を型上作れないようにする。対象を特定できない装置異常は、対象設備、監視地点、またはシステム自身を `NotificationTarget` として表す。対象が定義できない事象を将来扱う場合は、空配列へ緩和せず、`kind` と識別体系を後続設計で追加する。

共有パッケージ内では `notification.ts` が `index.ts` を import しない。循環を避け、`UtcIso8601String` は `types.ts` から export する。既存 export 名と値は変えない。

`continued` は基本設計 §7.3 の状態語を失わないため型に含めるが、§7.6 の「単なる継続は新規通知を生成しない」により D2 以降の生成器は通常これを出力しない。`initial` は状態変化ではなく初期取得・復旧という検知文脈であるため `detectionContext` にだけ保存する。

### 4.2 B4 mapper

`apps/api/src/notifications/notificationOutputHistoryMapper.ts` を追加する。共有型から API 専用のリポジトリ型へ依存するのは API 層だけとし、`packages/shared` は `apps/api` を import しない。

```ts
import type { Notification, NotificationOutputSnapshot } from '@wx-viewer-poc/shared';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';

export function toNotificationOutputHistoryInput(
  notification: Notification,
  output: NotificationOutputSnapshot,
): NotificationOutputHistoryInput;
```

変換は次の対応を固定する。

| `Notification` / `NotificationOutputSnapshot` | B4 入力 |
| --- | --- |
| `notificationId` | `notificationId` |
| `category` | `category` |
| `sourceType` / `sourceVersion` | `sourceType` / `sourceVersion` |
| `targets` | `targetAreaJson = JSON.stringify(targets)` |
| `occurredAt` / `detectedAt` | 同名列 |
| `changeType` | `changeType` |
| `output.ackRequired` / `output.summary` | `ackRequired` / `summary` |
| `relatedRefs` | `relatedRefsJson = JSON.stringify(relatedRefs)` |
| `origin` / `detectionContext` / `isTraining` | 同名列 |
| `output.messageDefinition` | `null` なら ID／版とも `null`、非 null なら `id`／`version` |

mapper は値の意味を補正しない。`category` から `ackRequired` を導出せず、JSON の key 順や表示文言を作り替えない。B4 リポジトリの非空文字列、日時、JSON、ID／版の対の検証を重複しない。`target_area_json` の列名・migration・リポジトリ型は変更しない。

`apps/web/src/shell/notifications.ts` の `ShellNotice` は試作 UI 専用で、`origin: 'equipment'`、端末内の `unread`／`pending` を持つ。今回の共有型に置換せず、#103 と配信・端末履歴の設計が揃った後に接続する。

## 5. 実装手順

1. `UtcIso8601String` を循環のない共有モジュールへ切り出し、既存 export 互換を保つ。
2. `notification.ts` に §4.1 の型を追加し、`packages/shared/src/index.ts` から export する。
3. 共有 workspace の型検査用ファイルまたは既存テストに、端末 ID・既読・確認状態を持たないこと、`targets` が空にできないこと、weather と system の `changeType` が区別されることを追加する。
4. API に mapper を追加し、`targets` 全体を JSON 配列として B4 入力へ写す。B4 migration、リポジトリ、DB 専用型は変更しない。
5. mapper テストで、複数区域の気象通知、単一設備対象の装置通知、訓練通知、メッセージ定義あり／なしを完全一致で確認する。
6. 型検査、lint、format check、shared と api の対象テストを実行する。

## 6. テスト計画と受け入れ条件

- [ ] `Notification` に端末 ID、端末グループ ID、既読・確認・配信状態、固定の鳴動担当がなく、`targets` が空配列を許さないことを型テストで確認する。
- [ ] 大田区・江東区を含む同一気象通知を mapper に渡すと、`targetAreaJson` が二要素の JSON 配列、`relatedRefsJson` が入力配列の JSON となり、その他の B4 入力値も完全一致することを確認する。
- [ ] 単一の設備 target を持つ装置通知で、`targetAreaJson` が一要素の JSON 配列、`origin === 'system'`、`sourceVersion === null` を保持することを確認する。
- [ ] `detectionContext: 'initial'` の気象通知で、`changeType` を変更せずに B4 入力へ渡ることを確認する。初期取得を状態変化値へ混在させない。
- [ ] `isTraining: true` が mapper を通過して B4 入力まで `true` のまま保存されることを確認する。本番相当の通知へ変換しない。
- [ ] `messageDefinition: null` の出力スナップショットが B4 の ID／版をともに `null` にすることを確認する。片方だけが非 null になる入力は mapper では生成しない。
- [ ] `messageDefinition` がある出力スナップショットでは、ID と版がそれぞれ B4 入力へ完全一致で渡ることを確認する。文言テンプレートや操作の選択規則はこのテストに含めない。
- [ ] `summary` と `ackRequired` が `NotificationOutputSnapshot` の入力値どおりであり、`category` による書換えや D1 独自の文言生成がないことを確認する。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api` が通ることを確認する。

新規テストは、mapper の `target` JSON 化、訓練フラグ、ID／版の null 対を意図的に壊して失敗すること（red）を確認してから完成させる。対象外の D2 判定規則、#103 のテンプレート規則をテストの期待値へ複製しない。

## 7. 後続 Issue への引き継ぎ

### #103（D1-1）

- `Notification` の `category`、`sourceType`、`changeType`、`origin`、`isTraining`、`targets`、`relatedRefs` を入力に静的メッセージ定義を選ぶ。
- 見出し・本文テンプレート・選択肢・操作内容・`ackRequired`・完成済み `summary` を決定し、`NotificationOutputSnapshot` を生成する。
- 生成時に選んだ定義 ID／版と完成文言を B4 mapper へ渡す。定義変更後も過去の出力履歴は書き換えない。

### D2 以降

- `sourceType` の正規値、気象情報からの `WeatherNotificationChangeType`、`notificationId` の割当を定める。
- 同一の情報種別・状態変化・通知区分・操作条件の対象群を一通知へまとめ、これらのいずれかが違う場合は別通知を生成する。大雨警報、土砂災害警報、雷注意報は別通知とする。
- 同一内容の再取得・単なる継続では新しい `notificationId` を作らない。初期取得・復旧では `detectionContext: 'initial'` を使う。
- 訓練電文由来では `isTraining: true` を生成から出力履歴まで維持する。

### 配信・端末グループ・端末履歴

- ポーリング API は全端末へ共通の通知列を返し、端末は対象外でも取得カーソルを進める。
- 会場定義を端末グループへ発展させ、監視区域・地点、H 端末順位、現地端末・設備をそこに包含する。通知の `targets` のいずれかと監視対象を照合する。
- H 端末の鳴動は、サーバーが接続・障害状態と順位を基に調停する。通知本体を特定端末宛てに変更しない。
- 端末通知履歴は表示・鳴動・既読・端末内確認・回答／受領送信の経過を `notificationId` で記録し、サーバー出力履歴とは別画面にする。

## 8. 要ヒアリング事項

1. 端末グループの監視対象と通知の `targets` が異なる粒度の場合、完全一致以外の区域包含・対応表をどの後続 Issue で定義するか。
3. #103 導入前に D2 の通知生成を動かす必要がある場合、B4 に保存する完成済み `summary` と `ackRequired` を誰が供給するかを決めてください。本設計は D1 が仮文言を生成しないため、#103 完了前の実運用記録は開始しない前提です。

## 9. 実装上の注意と統合注意

- B4 の `target_area_json` は既存 migration の列名のままとし、`JSON.stringify(notification.targets)` による JSON 配列を保存する。列名から対象を区域だけに縮退させない。
- B4 の `category`／`change_type` は TEXT であり、DB CHECK の値集合を追加しない。D1 の共有型と D2 以降の生成器が正規値を管理する。
- `origin` の共有値は B4 と同じ `system` を使う。画面試作の `equipment` を共有型へ持ち込まない。
- #23・#24 は実装進行中である。製造開始時にはこの設計時点のリポジトリだけを前提にせず、B4 の migration・リポジトリ・型・テストに競合や追加済み変更がないか確認してから mapper の import パスと対象テストを統合する。
- #25 は D1 の範囲に限り、既存 B4 のスキーマを変更しない。
