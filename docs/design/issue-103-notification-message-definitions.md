# Issue #103「D1-1. 通知メッセージ定義の管理」設計

作成日: 2026-09-12

## 1. 目的と範囲

Issue #25 で実装済みの `Notification` を入力に、通知として表示する「通知定義の種別」「対象」「補足・内容」、操作、確認要否を型付き静的定義から生成する。生成結果は `NotificationOutputSnapshot` として既存の B4 mapper に渡し、選択した定義 ID／版と完成済み表示文言を通知出力履歴へ保存できるようにする。

本 Issue の実装対象は次である。

- 共有パッケージにおけるメッセージ定義、表示内容、操作、生成要求、生成エラーの型
- リポジトリ内の TypeScript 静的定義レジストリ
- 明示された定義 ID と `Notification` の整合を検証し、表示内容と `NotificationOutputSnapshot` を生成する処理
- 初期メッセージ定義と単体テスト

次は対象外とする。

- 気象電文・装置状態から `Notification` を生成する判定（D2〜D4、D7）
- `sourceType`、装置系 `changeType`、DB 名・区分名・運転モード名の正規値の決定
- 通知の配信 API、端末上の表示、鳴動、確認・回答処理、受領監視
- メッセージ定義の SQL 保存、外部ファイル化、多言語化、運用画面からの編集
- サービス停止の検知主体・出力経路。端末側の疎通異常は、後続設計で取得異常等として扱いうる
- ユーザーが確定していない「データ取得復旧」「データ処理異常」の初期定義

## 2. 参照資料と確認結果

### 2.1 参照資料

- [Issue #103](https://github.com/BlueKurage119/wx-viewer-poc/issues/103) 本文。指定された旧コメントは仕様根拠に使用しない
- [Issue #25 設計](issue-25-notification-data-model.md) と実装済み `packages/shared/src/notification.ts`、`apps/api/src/notifications/notificationOutputHistoryMapper.ts`
- [Issue #8 設計](issue-8-notification-output-history.md) と実装済み `notification_output_history`、B4 リポジトリ
- [基本設計](../basic-design.md) §3.4、§7.1〜§7.7、§8.4
- [Issue 化ドラフト](../issues-draft.md) D1〜D8
- 統括担当による Issue #103 のヒアリング結果
- 画面試作 `apps/web/src/shell/notifications.ts`、`NotificationArea.tsx`（接続先ではなく、後続 UI の参考）

### 2.2 実装から確認した前提

- `Notification` は `category`、`sourceType`、`changeType`、`origin`、`isTraining`、空でない `targets` 等を持つ。完成文言と確認要否は持たない。
- `NotificationOutputSnapshot` は `ackRequired`、`summary`、定義 ID／版を持ち、B4 mapper はこれらを改変せず履歴入力へ写す。
- 気象系 `changeType` は `new` / `continued` / `strengthened` / `weakened` / `released` / `corrected` / `cancelled` が実装済みである。装置系 `changeType` と全 `sourceType` は現時点で非空 `string` であり、正規値は後続 Issue の責務である。
- B4 の `summary` は非空の完成済み表示文言であり、過去行を定義変更に追従させない。定義 ID と版は両方非 null または両方 null である。
- 現在の `NotificationOutputSnapshot` には表示3要素と操作がない。既存契約と fixture を壊さない派生型を本 Issue で追加し、既存 mapper は基底型としてそのまま受け取る。
- 画面試作の `ShellNotice` と操作ボタンは暫定実装であり、本 Issue の共有型へ置換しない。

### 2.3 ヒアリングで確定した事項

- 出力文言は原則として体言止めとする。
- 表示は ①通知定義の種別、②対象、③補足・内容の3要素とする。①は定義、②は `Notification.targets`、③の任意詳細は通知生成側が供給する。
- 同じ情報の複数地域は一通知の `targets` にまとめて併記し、異なる気象情報は別通知とする。
- 操作は表示3要素と分離して定義する。
- 「気象防災速報発表」に竜巻を含め、固定の内容タイトル候補を「線状降水帯発生」「線状降水帯直前予測」「記録的短時間大雨」「竜巻注意」「竜巻目撃」とする。
- `weather-advisory-issued` は通常注意報を `warning`、レベル2注意報を `question` として受け付ける。同じ表示名「気象注意報発表」を使い、操作と確認要否は区分に従う。
- `weather-warning-issued` はレベル3警報等を `question`、レベル4危険警報を `emergency` として受け付ける。同じ表示名「気象警報発表」を使い、操作と確認要否は区分に従う。
- `weather-special-warning-issued` は `emergency` 固定で「気象特別警報発表」とする。
- システム通知10種の名称、通知区分、対象表示方針は §5.2 の表とする。詳細は原則任意で、通知生成側が必要な場合だけ供給する。
- 「運転モード切替」の対象は「防災気象情報」固定とする。モード名を含む詳細の組立・出力・妥当性はモード切替実装側の責任とし、本 Issue では一般の任意詳細として扱う。
- 「サービス停止」はサーバー異常等を想定し、対象を「防災気象情報」固定とする。

## 3. 責務境界と設計判断

### 3.1 定義 ID を明示し、通知事実との整合を検証する

通知生成側は `definitionId` を明示して生成関数を呼ぶ。生成関数は定義の `origin`、`category`、気象系では必要に応じて `changeType` と `Notification` を照合し、一致した場合だけ出力を作る。

現時点の `sourceType` と装置系 `changeType` は正規値が未確定であるため、それらの文字列を #103 が仮決めして自動選択キーにしない。D2〜D4、D7 は正式な原因判定と同時に、対応する定義 ID を選ぶ。正式値が確定した後、定義の matcher に `sourceType` / `changeType` 条件を追加して自動選択関数を設けてもよいが、本 Issue の公開契約を壊さない別変更として行う。

この境界でも D1 データを無視しない。定義 ID だけで生成せず、少なくとも `origin` と `category`、値が確定済みの気象系状態変化を必ず検証する。存在しない ID と不整合な組合せはいずれも構造化エラーにし、低い通知区分、類似定義、汎用文言へ暗黙にフォールバックしない。

### 3.2 表示3要素と `summary`

表示結果を次の3要素で保持する。

1. `title`: 通知定義の種別。静的定義が所有する。
2. `target`: 対象。通常は `Notification.targets[].name` を入力順に `、` で連結する。固定対象の定義は定義内の文字列を使う。表示省略が指定された場合は `null` とする。
3. `content`: 補足・内容。定義固有の固定タイトルと、呼び出し元が渡す任意詳細から作る。

`summary` は表示要素のスナップショットであり、`title`、非 null の `target`、非 null の `content` をこの順に LF（`\n`）1文字で連結する。末尾改行は付けない。各要素に改行を許さず、入力された任意詳細は前後空白を除いた結果が空ならエラーにする。固定タイトルと任意詳細の両方がある場合、`content` は `固定タイトル：任意詳細` とする。固定タイトルだけ、任意詳細だけの場合はその値を使い、どちらもなければ `content` は `null` とする。

複数対象は並べ替え・重複排除せず、`Notification.targets` の順序を保存する。対象名の正規化と重複防止は通知生成側の責任である。

### 3.3 対象表示の扱い

定義は対象表示を次のいずれかで持つ。

- `notificationTargets`: `targets[].name` を併記する。
- `fixed`: 定義に保存した固定文字列を表示する。
- `notificationTargetsOmittable`: 通常は `targets[].name` を表示するが、呼び出し元が `omitTarget: true` を明示した場合だけ省略する。

「全部」を表す `codeType` / `code` は未確定のため、文字列 `全部` や特定コードを #103 が推測して判定しない。DB 初期化完了、取得手動停止、取得手動開始、強制取得完了だけが `omitTarget` を受け付ける。他の定義への `omitTarget: true` はエラーにする。省略しても `Notification.targets` 自体は空にせず、履歴の対象 JSON を保持する。

### 3.4 操作と確認要否

初期定義の操作は、操作不要または選択肢のない確認だけとする。

- `warning`: `action: null`、`ackRequired: false`
- `question` / `emergency`: `action: { kind: 'acknowledge', label: '確認' }`、`ackRequired: true`

定義内で許容する `category` と、それに対応する操作規則を固定し、呼び出し元から操作や確認要否を上書きさせない。回答選択肢、送信 payload、二段階 UI、確認済み状態は後続 Issue の責務である。

### 3.5 定義版と不変スナップショット

初期定義はすべて `version: '1'` とする。表示文言、対象方式、固定内容、操作、matcher の意味を変える場合は版を上げる。誤字修正も既存履歴の再現性に影響するため版更新とする。定義を更新しても B4 の既存 `summary`、`message_definition_id`、`message_definition_version` を更新しない。

定義 ID は意味を表す安定した kebab-case 文字列とし、表示文言の変更で ID を変えない。別の業務事象を追加する場合は新しい ID を追加する。

### 3.6 訓練通知

`isTraining` は `Notification` から B4 mapper まで既存どおり伝播する。本 Issue は定義を訓練用に複製せず、`summary` に訓練接頭辞を自動追加しない。訓練表示は `isTraining` を使う後続 UI の責務とし、気象事実と訓練由来を同一視しない。

## 4. モジュール構成と型

### 4.1 変更対象

```text
packages/shared/
├── src/
│   ├── notification.ts                    # 出力表示・操作型を追加
│   ├── notificationMessageDefinitions.ts  # 定義、レジストリ、生成処理
│   └── index.ts                           # 公開 export
└── tests/
    └── notificationMessageDefinitions.test.ts
```

`apps/api/src/notifications/notificationOutputHistoryMapper.ts`、B4 migration／リポジトリ、`apps/web` は変更しない。派生型だけが持つ表示・操作属性は、基底型を受ける既存 mapper から無視される。

### 4.2 公開型

`packages/shared/src/notification.ts` の既存 `NotificationOutputSnapshot` は変更せず、次の派生型を追加する。

```ts
export interface NotificationDisplayMessage {
  readonly title: string;
  readonly target: string | null;
  readonly content: string | null;
}

export interface NotificationAcknowledgeAction {
  readonly kind: 'acknowledge';
  readonly label: '確認';
}

export type NotificationAction = NotificationAcknowledgeAction | null;

export interface ResolvedNotificationOutputSnapshot extends NotificationOutputSnapshot {
  readonly messageDefinition: NotificationMessageDefinitionRef;
  readonly display: NotificationDisplayMessage;
  readonly action: NotificationAction;
}
```

`ResolvedNotificationOutputSnapshot` は `messageDefinition` を非 null に狭める。#25 の基底型にある `null` は、#103 導入前の履歴変換と既存テスト入力のためそのまま残す。派生型は基底型を受ける既存 B4 mapper へ渡せる。

`packages/shared/src/notificationMessageDefinitions.ts` には次を定義する。定義本体の型はレジストリ内部で使用し、呼び出し元が定義を変更できる API は提供しない。

```ts
export type NotificationMessageDefinitionId =
  | 'weather-advisory-issued'
  | 'weather-warning-issued'
  | 'weather-special-warning-issued'
  | 'weather-warning-strengthened'
  | 'weather-warning-weakened'
  | 'weather-warning-released'
  | 'weather-bosai-bulletin-linear-rainband-observed'
  | 'weather-bosai-bulletin-linear-rainband-forecast'
  | 'weather-bosai-bulletin-record-short-rain'
  | 'weather-bosai-bulletin-tornado-warning'
  | 'weather-bosai-bulletin-tornado-sighting'
  | 'system-data-fetch-delayed'
  | 'system-data-fetch-failed'
  | 'system-database-initialized'
  | 'system-database-initialization-failed'
  | 'system-service-stopped'
  | 'system-operation-mode-changed'
  | 'system-fetch-manually-stopped'
  | 'system-fetch-manually-started'
  | 'system-force-fetch-completed'
  | 'system-force-fetch-failed';

export interface ResolveNotificationMessageInput {
  readonly definitionId: NotificationMessageDefinitionId;
  readonly detail?: string;
  readonly omitTarget?: boolean;
}

export type NotificationMessageResolutionErrorCode =
  | 'definition_not_found'
  | 'notification_mismatch'
  | 'invalid_detail'
  | 'target_omission_not_allowed'
  | 'invalid_target_name';

export class NotificationMessageResolutionError extends Error {
  readonly code: NotificationMessageResolutionErrorCode;
  readonly definitionId: string;
}

export function resolveNotificationMessage(
  notification: Notification,
  input: ResolveNotificationMessageInput,
): ResolvedNotificationOutputSnapshot;
```

TypeScript の union はコンパイル時の入力を制限するが、JavaScript・JSON 境界の不正値もありうるため、実装はレジストリに存在しない文字列を `definition_not_found` として検出する。例外メッセージに任意詳細や対象名を含めず、通知内容をログへ重複露出させない。

## 5. 初期メッセージ定義

### 5.1 気象通知

初期実装では、Issue 本文の受け入れ例、基本設計の確定済み状態変化、ヒアリングで確定した速報タイトルを表現できる定義を用意する。正式な JMA 種別／コードから各 ID を選ぶ対応は D2〜D4 の責務である。

| 定義 ID | category | changeType | ① title | ②対象 | ③固定内容 | 操作 |
|---|---|---|---|---|---|---|
| `weather-advisory-issued` | warning / question | new | 気象注意報発表 | 通知対象 | なし | category に従う |
| `weather-warning-issued` | question / emergency | new | 気象警報発表 | 通知対象 | なし | category に従う |
| `weather-special-warning-issued` | emergency | new | 気象特別警報発表 | 通知対象 | なし | 確認 |
| `weather-warning-strengthened` | 定義選択時の通知区分 | strengthened | 気象警報等強化 | 通知対象 | なし | category に従う |
| `weather-warning-weakened` | 定義選択時の通知区分 | weakened | 気象警報等緩和 | 通知対象 | なし | category に従う |
| `weather-warning-released` | warning | released | 気象警報等解除 | 通知対象 | なし | なし |
| `weather-bosai-bulletin-linear-rainband-observed` | question | new | 気象防災速報発表 | 通知対象 | 線状降水帯発生 | 確認 |
| `weather-bosai-bulletin-linear-rainband-forecast` | question | new | 気象防災速報発表 | 通知対象 | 線状降水帯直前予測 | 確認 |
| `weather-bosai-bulletin-record-short-rain` | question | new | 気象防災速報発表 | 通知対象 | 記録的短時間大雨 | 確認 |
| `weather-bosai-bulletin-tornado-warning` | question | new | 気象防災速報発表 | 通知対象 | 竜巻注意 | 確認 |
| `weather-bosai-bulletin-tornado-sighting` | question | new | 気象防災速報発表 | 通知対象 | 竜巻目撃 | 確認 |

`weather-advisory-issued` は通常注意報 (`warning`) とレベル2注意報 (`question`) を、`weather-warning-issued` はレベル3警報等 (`question`) とレベル4危険警報 (`emergency`) を、それぞれ同じ定義 ID で扱う。`strengthened` / `weakened` も変更後情報の区分に従うという基本設計 §7.5 のため、単一の固定 category を持てない。レジストリ内部では category ごとに定義を複製せず、許容 category と、それに対応する操作規則を持つ。解決時の `notification.category` が `warning` なら操作なし、`question` / `emergency` なら確認とする。定義 ID／版は category によらず同じである。

例として、レベル3大雨警報の新規発表を `weather-warning-issued`、対象 `江東区`、detail `レベル3大雨警報` で解決した結果は次になる。

```ts
{
  display: {
    title: '気象警報発表',
    target: '江東区',
    content: 'レベル3大雨警報',
  },
  action: { kind: 'acknowledge', label: '確認' },
  ackRequired: true,
  summary: '気象警報発表\n江東区\nレベル3大雨警報',
  messageDefinition: { id: 'weather-warning-issued', version: '1' },
}
```

訂正・取消は通常経路で扱うことだけが確定しており、表示文言と通知区分の参照先は基本設計 §7.6 でも未確定であるため、初期定義へ含めない。`continued` は通知を通常生成しないため定義を設けない。対応する ID がない呼び出しはエラーになる。

### 5.2 システム通知

| 定義 ID | category | ① title | ②対象 | ③固定内容 | 操作 |
|---|---|---|---|---|---|
| `system-data-fetch-delayed` | warning | データ取得遅延 | 通知対象（区分名） | なし | なし |
| `system-data-fetch-failed` | question | データ取得異常 | 通知対象（区分名） | なし | 確認 |
| `system-database-initialized` | warning | DB初期化完了 | 通知対象（DB名、全部の場合は省略可） | なし | なし |
| `system-database-initialization-failed` | question | DB初期化異常終了 | 通知対象（DB名） | なし | 確認 |
| `system-service-stopped` | question | サービス停止 | 固定「防災気象情報」 | なし | 確認 |
| `system-operation-mode-changed` | warning | 運転モード切替 | 固定「防災気象情報」 | なし | なし |
| `system-fetch-manually-stopped` | warning | 取得手動停止 | 通知対象（区分名、全部の場合は省略可） | なし | なし |
| `system-fetch-manually-started` | warning | 取得手動開始 | 通知対象（区分名、全部の場合は省略可） | なし | なし |
| `system-force-fetch-completed` | warning | 強制取得完了 | 通知対象（区分名、全部の場合は省略可） | なし | なし |
| `system-force-fetch-failed` | question | 強制取得失敗 | 通知対象（区分名） | なし | 確認 |

システム通知はいずれも `origin: 'system'` を必須とする。装置系 `changeType` の正式値が確定していないため、初期 matcher は `changeType` を固定しない。各通知を発生させる後続実装は、独自の詳細文を必須とせず、必要な場合だけ `detail` を渡す。

## 6. 実装手順

1. `notification.ts` に表示3要素、確認操作、既存スナップショットを継承する解決済み出力型を追加する。既存 `NotificationOutputSnapshot` は変更しない。
2. `notificationMessageDefinitions.ts` に非公開の readonly レジストリ、公開 ID union、生成入力、構造化エラー、生成関数を実装し、`index.ts` から公開する。
3. §5 の初期定義を `as const satisfies` で宣言し、ID 重複と定義の `category`／操作／確認要否の不整合がない構造にする。
4. 生成処理で ID、通知との整合、対象名、任意詳細、対象省略権限を検証し、表示3要素、操作、`summary`、定義参照を一度に生成する。
5. 型テストとランタイム単体テストを追加し、§7 の受け入れ条件を確認する。

## 7. テスト計画と受け入れ条件

- [ ] `weather-warning-issued` に `origin: 'weather'`、`category: 'question'`、`changeType: 'new'`、江東区 target、detail `レベル3大雨警報` を渡すと、§5.1 の例と表示3要素・操作・`ackRequired`・`summary`・定義 ID／版が完全一致する。
- [ ] 同定義に江東区・大田区の順で targets を渡すと、`target === '江東区、大田区'`、`summary === '気象警報発表\n江東区、大田区\nレベル3大雨警報'` となる。順序変更・重複排除がないことも完全一致で確認する。
- [ ] 5つの気象防災速報定義がすべて title `気象防災速報発表` を生成し、content がそれぞれ §5.1 の固定タイトルに完全一致する。任意詳細 `東京都東部` を追加した1ケースでは `固定タイトル：東京都東部` になる。
- [ ] `weather-advisory-issued` は `warning` の通常注意報で操作なし / `ackRequired === false`、`question` のレベル2注意報で確認操作 / `ackRequired === true` を返す。`weather-warning-issued` は `question` のレベル3警報等と `emergency` のレベル4危険警報のどちらでも確認操作 / `ackRequired === true` を返す。`weather-special-warning-issued` は `emergency` 固定で確認操作 / `ackRequired === true` を返す。各ケースの title は順に「気象注意報発表」「気象警報発表」「気象特別警報発表」で完全一致する。`weather-warning-released` は操作なし / `ackRequired === false` を返す。
- [ ] `weather-warning-strengthened` / `weather-warning-weakened` は入力 category が `warning` の場合は操作なし、`question` / `emergency` の場合は確認を生成し、changeType が異なる入力を拒否する。
- [ ] §5.2 のシステム通知10種について、title、許容 category、操作、確認要否、対象方式、定義 ID／版を表駆動テストで完全一致確認する。
- [ ] サービス停止と運転モード切替は `Notification.targets` の名称にかかわらず target `防災気象情報` を生成する。運転モード切替の detail を省略でき、呼び出し元が `モード：手動` を渡した場合はその文字列を改変しない。
- [ ] DB初期化完了、取得手動停止、取得手動開始、強制取得完了は `omitTarget: true` で target を `null` にする。他の定義で同指定を行うと `target_omission_not_allowed` になる。
- [ ] detail の省略は許容する。空文字、空白だけ、CR/LF を含む detail は `invalid_detail`、空白だけまたは CR/LF を含む対象名は `invalid_target_name` になる。
- [ ] 存在しない定義 ID は `definition_not_found`、origin／category／確定済み気象 changeType が定義と異なる場合は `notification_mismatch` になり、別定義・既定文言を返さない。
- [ ] `isTraining: true` と同じ通知の `false` は同じ定義・表示文言を生成し、入力の `isTraining` 自体は変更しない。既存 B4 mapper テストで訓練フラグがそのまま履歴入力へ渡ることも確認する。
- [ ] 生成結果を `toNotificationOutputHistoryInput` へ渡す統合テストで、`summary`、`ackRequired`、定義 ID `weather-warning-issued`、版 `1` が完全一致で B4 入力へ渡る。
- [ ] 定義レジストリが TypeScript 内の静的設定であり、SQL migration、DB リポジトリ、外部 JSON／YAML を追加・変更していない。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api` が通る。

新規テストは、実装前に未実装で失敗する red を確認する。意味を変えない対照実験としてテスト説明文または検証対象外 fixture の文字列を変更してもテストが通ることを確認した後、少なくとも次の変異を1つずつ加え、対応テストが失敗することを確認する。

- 複数対象の区切りを `、` から別文字へ変更する。
- `warning` 定義の `ackRequired` を `true` にする。
- 不明 ID を最初の定義へフォールバックさせる。
- `summary` から content を除く。

対照変更・変異は元に戻し、完成コードへ残さない。製造報告に red、対照実験、各変異の KILLED を記録する。

## 8. 後続 Issue への引き継ぎ

### D2〜D4（気象通知判定）

- JMA の正式な情報種別・コード、状態変化、通知区分を確定し、対応する `Notification` と定義 ID を同時に選ぶ。
- 大雨警報、土砂災害警報、雷注意報等の異なる情報は別通知にし、同じ情報・状態変化・区分・操作条件の複数地域だけを targets にまとめる。
- `weather-*-issued` の detail に、検証済みコードから生成した「レベル3大雨警報」等を渡す。名称の部分一致やコード番号の大小で分類しない。
- 訂正・取消の通知区分と表示文言をヒアリング後に新しい定義として追加する。継続には定義を選ばず通知自体を生成しない。
- 気象防災速報5種と実電文・解析結果の対応が確認できたものだけを各 ID に割り当てる。未確認の速報を類似 ID に割り当てない。

### D7・取得／操作／初期化の各実装（システム通知）

- 装置系 `changeType` と `sourceType` の正式値を所有し、事象に対応する定義 ID を選ぶ。#103 の定義 ID を装置状態値の代用にしない。
- 区分名・DB名を `Notification.targets[].name` に設定する。「全部」の判定は各機能が所有し、対象省略可能な4定義だけで `omitTarget: true` を渡す。
- 運転モード切替処理は、定義済みモードから必要な詳細を組み立てる。#103 はモード値を列挙・検証・補完しない。
- サービス停止はサーバー異常等の検知・通知出力経路を別途設計する。端末側の疎通異常を同じ事象と仮定しない。
- 「データ取得復旧」「データ処理異常」が必要になった場合は、ユーザー確認後に新規 ID と版1の定義を追加する。

### フロント通知表示

- `display.title` / `target` / `content` を3要素として表示し、`action` に基づいて確認 UI を構成する。`summary` の改行を再解析して構造を復元しない。
- `isTraining` を別の視覚・文言で明示する。訓練表示の具体形は UI Issue で決める。
- 操作済み状態は端末内に保持し、B4 の `ackRequired` を確認完了状態として更新しない。

## 9. 未確認事項と実装上の注意

- 訂正・取消の文言と通知区分は未確定であり、本 Issue の初期定義には含めない。
- 5つの気象防災速報タイトルと、気象庁 XML／既存 parser の具体的な判定値との全対応は実挙動未確認である。本 Issue は表示定義だけを用意し、D2 以降で確認できたものから接続する。
- システム通知を発生させる各機能と、正式な装置系 `sourceType` / `changeType` は未実装または未確定である。初期定義は表示生成を検証できるが、実発生経路は本 Issue の完了条件にしない。
- 解決済み出力は既存 `NotificationOutputSnapshot` の派生型とし、既存 shared／API fixture や mapper の変更を不要にする。製造時に基底型へ必須フィールドを直接追加しない。
- 定義文言に体言止めを用いる。通知生成側が渡す任意詳細の文体は各生成側の責任であり、#103 は自然言語の文体判定を行わない。

本 Issue の製造を止める追加ヒアリング事項はない。未確定の原因値・訂正取消・検知経路は、暗黙補完せず対象外または後続引き継ぎとして隔離している。
