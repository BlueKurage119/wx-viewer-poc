# Issue #27「D3. 強化・緩和・解除時の通知生成ロジック」設計案

作成日: 2026-09-13
設計担当: Claude Opus 5 (1M context)

## 1. 目的・承認範囲

基本設計 §7.5【確定】の「強化・緩和・解除時の通知」ルールを、C3 の状態変化（`WarningCurrentChange`）を入力とし、**通知対象か・通知区分は何か・確認要否は何か**だけを返す純粋関数として実装する。

統括担当のヒアリングで確定した範囲は次のとおり。

- 入力は C3 が返す `WarningCurrentChange` のうち `strengthened` / `weakened` / `released` の 3 種。
- 出力は「通知対象かどうか」「通知区分（`warning` / `question` / `emergency`）」「`ackRequired`（§7.2: 警報=false、問いかけ・非常ブザー=true）」。
- 強化・緩和は **変更後（after）の Kind/Code** を D2 `classifyWarningNotificationCategory` に通して区分を決める。緩和を一律「警報」にしない。
- 解除は **changeType が `released` であること自体**で通知区分「警報」に固定する。after は null であり、after のコードから判定できる設計にしない。
- 通知区分が before / after で同じでも、`strengthened` / `weakened` であれば通知対象とする（category 比較でスキップしない）。

### 対象外（今回やらないこと）

- `Notification`（D1 型）本体の組み立て、`notificationId` 採番、`targets` の決定、`sourceType` / `sourceVersion` / `occurredAt` / `detectedAt` / `relatedRefs` / `detectionContext` / `isTraining` の充足
- 通知履歴（B4 / #8）への保存、通知出力スナップショット（`NotificationOutputSnapshot`）・要約文（#103）の生成
- ポーリングパイプライン（`jmaWarningCurrentProcessor` 等）への配線・呼び出し・ログ出力
- `new` / `continued` / 訂正 / 取消 / 初期取得の通知要否と重複防止（すべて D4 の責務）
- 重複通知の抑止、通知の再配信、起動時出力（D5）、端末セッション（D6）
- `packages/shared/src/notification.ts`（D1 型定義）の変更、D2 の対応表・シグネチャの変更、C3 の `WARNING_CODE_TABLE` / `WarningCurrentChange` の変更
- 装置異常（`SystemNotification`）、気象防災速報・竜巻注意情報等の別コード体系
- HTTP API・UI・DB migration の追加

## 2. 参照資料と、そこから導いた設計判断

| 資料・実装 | 確認内容と設計への反映 |
| --- | --- |
| [基本設計](../basic-design.md) §7.5【確定】 | 強化・緩和は after の区分、解除は「警報」固定、区分同一でも通知対象。§3 の判定規則はこの 3 行に 1 対 1 で対応させる |
| 同 §7.2 | 通知区分は 警報 / 問いかけ / 非常ブザーの 3 値。「警報」は利用者に操作を求めない＝`ackRequired=false`。問いかけと、その特殊モードである非常ブザーは確認・回答を要する＝`true` |
| 同 §7.3 通知用データ項目案 | `ackRequired` の定義「警報は false、問いかけ・非常ブザーは true」。§4.2 の対応表はここから導いた |
| 同 §7.4【確定】コード対応 | 区分の対応表は D2 が所有する。D3 は表を持たず、D2 を呼ぶだけとする |
| 同 §7.6【設計案・未確定】 | `new` / `continued` / 訂正 / 取消 / 初期取得は未確定を含むため D3 では扱わない（対象外に明記） |
| [D2 設計](issue-26-notification-category-classifier.md) §3.1・§8「後続 Issue への引継ぎ」 | 「D3 は変更後のコードを分類する。緩和を一律 warning にしない。解除通知は §7.5 のルールで別途 warning とする。**分類関数の `release` をすべての解除の検出器として使わない**」。§3.5 の解除判定は `changeType === 'released'` のみを根拠とする設計にした |
| `apps/api/src/notifications/warningNotificationCategoryClassifier.ts`（実装確認済み） | `classifyWarningNotificationCategory(code: string): { kind:'classified'; category } \| { kind:'release' } \| { kind:'unsupported' }`。コード `00` のみ `release`。副作用・例外なし |
| `apps/api/src/repositories/types.ts` L854-881（実装確認済み） | `WarningPhenomenonKey`、`WarningCurrentChangeType = 'new'\|'continued'\|'strengthened'\|'weakened'\|'released'`、`WarningCurrentChange { phenomenonKey, changeType, before, after }`。`before` / `after` はいずれも `WarningCurrentItemInput \| null` と緩く宣言されている。§3.2 で D3 側の入力型を絞り込む理由がこれ |
| `apps/api/src/polling/jmaWarningCurrentReducer.ts` `diffWarningCurrent`（実装確認済み） | `released` は `before` あり・`after` null のときのみ生成される。`strengthened` / `weakened` は before・after 双方が存在し、`WARNING_CODE_TABLE` の `level` の大小で決まる。同一 level で異コードは `WarningCurrentConflictError` を投げる |
| 同 `WARNING_CODE_TABLE`（#26 修正後、実装確認済み） | 収録コードは 34 件（`10 03 43 33 / 29 09 49 39 / 19 08 48 38 / 13 02 32 / 15 05 35 / 16 07 37 / 12 06 36 / 14 17 20 21 22 23 24 25 26 27`）。**この 34 件はすべて D2 の `classified` 集合（36 件）の部分集合であり、`00` を含まない**。よって C3 由来の after.kindCode に対して D2 が `release` / `unsupported` を返すことは、設計時点の両表が一致している限り起こらない。この不変を §5 の AC で回帰検証する |
| 同 `reduceWarningCurrent` / `WarningCurrentUnsupportedError` | 未対応コード・未対応 Status は例外を投げて現況に反映しない。D3 で未対応 after を検知した場合も **黙って低い区分へ落とさず例外にする**（§3.6）という判断の根拠 |
| [C3 設計](issue-13-warning-current-state.md) | 状態変化の検出責務は C3。D3 は検出をやり直さない（before/after の level 再比較をしない） |
| [D1 型](../../packages/shared/src/notification.ts) | `NotificationCategory = 'warning' \| 'question' \| 'emergency'` をそのまま再利用。`ackRequired` は `NotificationOutputSnapshot` 側の項目であり、D3 は型定義を変更せず戻り値で値だけを提供する |
| `apps/api/tsconfig.json` | `include: ["src"]`。**`apps/api/tests` は `npm run typecheck` の対象外**。型レベルの制約だけに頼らず、実行時ガードとテストで担保する必要がある（§3.4） |

## 3. モジュール設計

### 3.1 配置と公開境界

| ファイル | 内容 |
| --- | --- |
| `apps/api/src/notifications/warningStateChangeNotificationDecider.ts`（新規） | 入力型・戻り値型・エラー型・判定関数 |
| `apps/api/src/notifications/index.ts`（変更） | 上記の `export *` を 1 行追加 |
| `apps/api/tests/warningStateChangeNotificationDecider.test.ts`（新規） | §5 の受け入れ条件に対応するテスト |

D2 と同じ `notifications` 層に置く。C3 の型（`WarningCurrentChange` 等）は `apps/api/src/repositories/types.ts` から **type-only import** する。実装の依存は D2 の分類関数のみで、reducer・リポジトリ・DB・時刻・ログには一切依存しない。HTTP API は追加しない。

### 3.2 入力型

`WarningCurrentChange` は `before` / `after` がともに nullable なため、そのまま受けると「`strengthened` なのに after が null」を型で排除できない。D3 側で判別可能ユニオンとして絞り込む。

```ts
import type {
  WarningCurrentChange,
  WarningCurrentItemInput,
  WarningPhenomenonKey,
} from '../repositories/types.js';

/** D3 が担当する状態変化。new / continued は D4 の責務であり含めない。 */
export type WarningStateChangeKind = 'strengthened' | 'weakened' | 'released';

export type WarningStateChangeDecisionInput =
  | {
      readonly phenomenonKey: WarningPhenomenonKey;
      readonly changeType: 'strengthened' | 'weakened';
      readonly before: WarningCurrentItemInput;
      readonly after: WarningCurrentItemInput;
    }
  | {
      readonly phenomenonKey: WarningPhenomenonKey;
      readonly changeType: 'released';
      readonly before: WarningCurrentItemInput;
      readonly after: null;
    };
```

C3 の値をこの型へ渡すための絞り込みも同じモジュールで提供する。呼出側（D4）が `as` キャストで無理やり通すことを避けるための入口である。

```ts
/** C3 の差分が D3 の担当範囲かを判定する型ガード。new / continued は false。 */
export function isWarningStateChangeDecisionInput(
  change: WarningCurrentChange,
): change is WarningCurrentChange & WarningStateChangeDecisionInput;
```

型ガードは `changeType` の 3 値判定に加え、`strengthened` / `weakened` では `before !== null && after !== null`、`released` では `before !== null && after === null` を実際に検査する（型の主張だけで済ませない）。

### 3.3 戻り値型

```ts
import type { NotificationCategory } from '@wx-viewer-poc/shared';

export interface WarningStateChangeNotificationDecision {
  /** §7.5 により、担当する 3 種の状態変化はすべて通知対象。区分同一でも false にしない。 */
  readonly notify: true;
  readonly changeType: WarningStateChangeKind;
  readonly phenomenonKey: WarningPhenomenonKey;
  readonly category: NotificationCategory;
  /** §7.2・§7.3: warning=false、question/emergency=true。 */
  readonly ackRequired: boolean;
  /** 区分をどの規則で決めたか。'release_rule' のとき basisKindCode は null。 */
  readonly categoryBasis: 'after_kind_code' | 'release_rule';
  readonly basisKindCode: string | null;
}

export function decideWarningStateChangeNotification(
  input: WarningStateChangeDecisionInput,
): WarningStateChangeNotificationDecision;
```

`notify` を `true` リテラル固定にしたのは、§7.5 の「区分が同じでも通知対象」を型で表明し、将来 D4 が「同一区分だから抑止」という分岐を D3 の戻り値に読み込めないようにするため。**重複抑止・同一版の再取得抑止は D4 の責務**であり、D3 の `notify` は「§7.5 上の通知対象であること」だけを意味する。

`categoryBasis` / `basisKindCode` は、緩和を一律 warning にしていないこと・解除が after 由来でないことをテストと後続 Issue の要約生成から検証できるようにするための説明項目である。通知区分そのものには影響しない。

### 3.4 判定規則（§7.5 との対応）

| §7.5 の確定文 | 実装規則 |
| --- | --- |
| 強化・緩和: 変更後の気象情報に対応する通知区分で通知する | `changeType` が `strengthened` / `weakened` のとき `classifyWarningNotificationCategory(input.after.kindCode)` の結果を使う。`before` は読まない。`changeType` が強化か緩和かで区分を分けない |
| 緩和を一律に通知区分「警報」とはしない | 上記のとおり緩和も after のコードで分類する。`weakened` に対する定数の区分を実装に置かない |
| 解除: 通知区分「警報」で知らせる | `changeType === 'released'` の分岐で `category = 'warning'` を返す。この分岐では **D2 を呼ばず、`after` も `before.kindCode` も参照しない**。D2 の `{ kind:'release' }`（コード `00`）を解除の検出器に使わない |
| 通知区分が変更前後で同じでも、強化・緩和の状態変化があれば通知対象 | before の分類を行わず、category 比較の分岐自体を実装に持たない（比較して同値なら抑止、という分岐を書かない） |

`ackRequired` は `category` から次の明示的な対応で導く。`category !== 'warning'` のような否定条件ではなく、3 値すべてを列挙した定数表とし、値の追加時にコンパイルエラーになる形（`Record<NotificationCategory, boolean>`）にする。

| category | 意味（§7.2） | ackRequired |
| --- | --- | --- |
| `warning` | 警報（操作を求めない） | `false` |
| `question` | 問いかけ | `true` |
| `emergency` | 非常ブザー（問いかけの特殊モード） | `true` |

### 3.5 `new` / `continued` を渡された場合

型では `WarningStateChangeDecisionInput` に含めないことで排除する。ただし `apps/api/tests` が `typecheck` の対象外であること、および将来 DB 由来の値が `as` で渡される可能性があるため、**実行時にも防ぐ**。

`decideWarningStateChangeNotification` は先頭で `changeType` を検査し、`new` / `continued` / 未知の値であれば `WarningStateChangeDecisionError`（`reason: 'unsupported_change_type'`）を投げる。既定値として何らかの区分を返さない。`strengthened` / `weakened` で `after` が null、`released` で `after` が非 null の場合も同じエラー型（`reason: 'malformed_change'`）とする。

D4 は `isWarningStateChangeDecisionInput` で振り分けてから呼ぶため、正常系でこの例外に到達しない。

### 3.6 D2 が `unsupported` / `release` を返した場合

§2 のとおり、C3 の `WARNING_CODE_TABLE` の 34 コードはすべて D2 の `classified` 集合に含まれ、`00` を含まない。C3 は未対応コードを `WarningCurrentUnsupportedError` で弾いて現況に反映しないため、`after.kindCode` がここに来ることは **両表が一致している限り起こらない**。

したがってこの経路は「データ条件」ではなく「C3 と D2 の対応表が乖離したというバグ」を意味する。§7.4 の「未対応の種別を低い区分へ自動的に割り当てない」に従い、`warning` へフォールバックせず、C3 の fail-loud 方針（`WarningCurrentUnsupportedError`）に合わせて `WarningStateChangeDecisionError`（`reason: 'unclassifiable_kind_code'`）を投げる。D2 が `release`（コード `00`）を返した場合も、解除は `changeType` で表現される設計であるため同じく矛盾として扱い、同 reason で投げる。

```ts
export type WarningStateChangeDecisionErrorReason =
  | 'unsupported_change_type'
  | 'malformed_change'
  | 'unclassifiable_kind_code';

export class WarningStateChangeDecisionError extends Error {
  constructor(
    public readonly reason: WarningStateChangeDecisionErrorReason,
    message: string,
  );
}
```

到達不能であることは §5 の AC4（両表の整合回帰）で担保し、例外自体の挙動は合成入力で検証する。**この例外をポーリングループでどう捕捉・記録するかは D4 の責務**であり、D3 はログ・I/O を持たない（§6 に引継ぎとして明記）。

### 3.7 訓練データの扱い

D3 は `isTraining` を入力にも出力にも持たない。判定は訓練・本番で同一であり、**訓練フラグは D4 が構築する `Notification` 側に伝播させる**。D3 の戻り値に訓練由来かどうかを示す項目を追加しない（追加すると本番相当の通知と同一視される経路が生まれるため）。C3 の `controlStatus`（normal / training / test）も D3 の入力に含めない。

## 4. 判定の具体例（§7.5 の例に対応）

| 状態変化 | before → after | D2 の分類 | D3 の結果 |
| --- | --- | --- | --- |
| レベル4危険警報 → レベル3警報（緩和） | `43` → `03` | after=`03` → question | `question` / `ackRequired=true` / basis=`after_kind_code` |
| レベル3警報 → レベル2注意報（緩和） | `03` → `10` | after=`10` → question | `question` / `ackRequired=true` |
| 解除 | `03` → なし | 呼ばない | `warning` / `ackRequired=false` / basis=`release_rule` / `basisKindCode=null` |
| レベル2注意報 → レベル3警報（強化） | `10` → `03` | after=`03` → question | `question`（区分同一でも `notify: true`） |
| 大雨警報 → 大雨特別警報（強化） | `03` → `33` | after=`33` → emergency | `emergency` / `ackRequired=true` |
| 大雨特別警報 → 大雨注意報（緩和） | `33` → `10` | after=`10` → question | `question`（一律 warning にしない） |
| 強風注意報 → 暴風警報（強化） | `15` → `05` | after=`05` → question | `question`（before は warning。before を見ていたら誤る） |
| 暴風警報 → 強風注意報（緩和） | `05` → `15` | after=`15` → warning | `warning` / `ackRequired=false` |
| 大雪注意報 → 大雪警報（強化） | `12` → `06` | after=`06` → question | `question`（before=warning からの上げ） |
| 波浪特別警報 → 波浪注意報（緩和） | `37` → `16` | after=`16` → warning | `warning` / `ackRequired=false`（緩和でも警報になる正当なケース） |

## 5. 受け入れ条件

API のテストは `node --import tsx --test tests/*.test.ts`。個別実行はリポジトリルートから `node --import tsx --test apps/api/tests/warningStateChangeNotificationDecider.test.ts`。判定は `node:assert/strict` の `deepEqual` による完全一致を基本とする。fixture の `WarningCurrentItemInput` は必須項目（`sequence` / `kindCode` / `kindName` / `kindStatus` / `lastKindCode` / `lastKindName` / `significancyCode` / `significancyName` / `warningLevel` / `attentionText` / `kindIssuedAt` / `sourceTelegram`）を埋めたヘルパで生成し、`kindName` は実コードに対応する正しい名称にする。

- [ ] **AC1: §7.5 の例（緩和・解除）** — `43→03`、`03→10` の `weakened` がいずれも `{ notify: true, category: 'question', ackRequired: true, categoryBasis: 'after_kind_code', basisKindCode: '03' / '10' }`（`changeType` / `phenomenonKey` を含む全項目）で完全一致すること。同じ `heavy_rain` の `released`（before=`03`、after=null）が `{ notify: true, changeType: 'released', category: 'warning', ackRequired: false, categoryBasis: 'release_rule', basisKindCode: null }` と完全一致すること。
- [ ] **AC2: 強化・緩和は after で決まる** — §4 の表の 9 行（released を除く）すべてについて `category` / `ackRequired` / `categoryBasis` / `basisKindCode` が期待値と完全一致すること。期待 category は実装や D2 の内部集合から生成せず、テスト内に独立した固定値として記述する。特に `05→15`（緩和で `warning`）と `15→05`（強化で `question`）の双方を含め、before の区分を使っていたら不一致になることを確認する。
- [ ] **AC3: 区分が同じでも通知対象** — 前後とも同一区分になる遷移（question 同士の `10→03` / `03→10` / `29→09` / `09→29`、emergency 同士の `43→33` / `33→43`）で `notify` が `true` であり、`notify: false` を返す経路が存在しないこと。実装に before の分類呼び出しが無いことをコードレビューでも確認する。
- [ ] **AC4: 解除は changeType のみで判定** — C3 の `WARNING_CODE_TABLE` に含まれる 34 コードすべてを `before.kindCode` に置いた `released` 入力を作り、いずれも `category: 'warning'` / `ackRequired: false` / `basisKindCode: null` になること。加えて C3 の 34 コードを `classifyWarningNotificationCategory` に通し、全件が `{ kind: 'classified' }` を返す（`release` / `unsupported` が 1 件も無い）ことを確認し、§3.6 の到達不能性を回帰として固定する。コード集合は `WARNING_CODE_TABLE` から取得してよいが、期待 category を C3 の `level` から生成しない。
- [ ] **AC5: ackRequired の対応** — `warning` になる遷移（例 `05→15`、`37→16`）で `ackRequired: false`、`question`（例 `43→03`）と `emergency`（例 `03→33`）で `true` になること。3 区分すべてを最低 1 件ずつ通ること。
- [ ] **AC6: 対象外 changeType** — `new` / `continued` を（テストは typecheck 対象外なので `as` で）渡すと `WarningStateChangeDecisionError` が投げられ、`reason === 'unsupported_change_type'` であること。区分を返さないこと（`assert.throws` で型と reason を検査する）。`'foo'` のような未知値でも同じ。
- [ ] **AC7: 型ガード** — `isWarningStateChangeDecisionInput` が、`strengthened` / `weakened`（before・after あり）・`released`（before あり・after null）で `true`、`new` / `continued` で `false`、`strengthened` で after が null・`released` で after が非 null の不正形で `false` を返すこと。C3 の `diffWarningCurrent` が返す配列（新規・継続・強化・緩和・解除を含む合成入力）をこのガードで絞り込み、残った要素だけを判定関数に渡して例外が発生しないことを確認する。
- [ ] **AC8: 不整合入力の例外** — `strengthened` で `after: null`、`released` で `after` 非 null を（`as` で）渡すと `reason === 'malformed_change'` の例外になること。C3 の表に無いコード（例 `99`）や `00` を `after.kindCode` に置いた `strengthened` を渡すと `reason === 'unclassifiable_kind_code'` の例外になり、`warning` 等へフォールバックしないこと。
- [ ] **AC9: 純粋性** — 同じ入力で 2 回呼んで結果が `deepEqual` で一致すること。入力オブジェクトが変更されていないこと（呼び出し前後のディープコピーと完全一致）。DB・ファイル・ネットワーク・時刻に依存しないこと（実装に `Date` / `Math.random` / I/O が無いことをレビューで確認）。
- [ ] **AC10: red と対照実験** — 実装とテストが成功する状態を確認してから、(a) 対象実装に意味を変えないコメント追加のみを行い同じテストコマンドが成功（SURVIVED）することを先に確かめる。その後 (b) `released` を `warning` 固定から `after`／`before` のコード由来に変更、(c) `weakened` の category を `'warning'` 固定に変更、(d) `after` の代わりに `before.kindCode` を分類、(e) `ackRequired` を `question` で `false` に反転、(f) 区分が同一のとき `notify: false` を返す分岐を追加、(g) 未対応コードで例外の代わりに `warning` を返す、の各変異でそれぞれ関連 AC が失敗（KILLED）することを確認する。各変異を戻して成功することも確認し、変異内容・コマンド・結果を報告する。コンパイル失敗だけを red と数えない。
- [ ] **AC11: 節目検証** — `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` がいずれも成功すること。今回 `packages/shared` と `apps/web` は変更しないため、それらの workspace テストの追加実行は不要。
- [ ] **AC12: 変更境界** — `git diff --stat` / `git status --porcelain` の変更が §3.1 の 3 ファイル（新規 2・変更 1）と本設計書に収まっていること。`packages/shared`、`jmaWarningCurrentReducer.ts`、`warningNotificationCategoryClassifier.ts`、migration、稼働 DB に変更が無いこと。一時ファイルを残さないこと。

本設計時点でコードは 1 行も書いていないため、上記テスト・変異の結果は **実挙動未確認**。§2 に記した既存実装のシグネチャ・コード表の内容・`apps/api/tsconfig.json` の `include` は実ファイルを読んで確認済み。

## 6. 後続 Issue への引継ぎ

- **D4（#28 相当）**: `new` / `continued` / 訂正 / 取消 / 初期取得のルールを所有する。C3 の差分配列は `isWarningStateChangeDecisionInput` で D3 担当分を振り分け、残りを D4 のルールで処理する。D3 の `notify: true` は §7.5 上の通知対象という意味であり、**同一版の再取得・重複通知の抑止は D4 が別途行う**。`WarningStateChangeDecisionError` をポーリングループでどう捕捉・記録・監視するか（現況処理を止めるのか、当該現象だけ落とすのか）も D4 で決める。
- **D4 / #103**: `Notification` の組み立て時に、D3 の `category` をそのまま `category` へ、`ackRequired` を `NotificationOutputSnapshot.ackRequired` へ渡す。`notificationId` / `targets` / `sourceType` / `sourceVersion` / `occurredAt` / `detectedAt` / `relatedRefs` / `detectionContext` / `isTraining` / `summary` は D3 が補完しない。`isTraining` は D3 を経由しないため、C3 の `controlStatus` から D4 で伝播させる。
- **要約文（#103）**: `categoryBasis` / `basisKindCode` / `phenomenonKey` / `before` / `after` を使えば「レベル4危険警報からレベル3警報へ」のような文面を作れる。D3 は文言を生成しない。
- **D2 / C3**: `WARNING_CODE_TABLE` に新しいコードを追加する場合、D2 の対応表にも同時に追加しないと AC4 が落ちる。この落ち方は意図した検知であり、D3 側にフォールバックを足して回避しない。

## 7. 実装上の注意

- `apps/api/tests` は `npm run typecheck` の対象外である。型で排除したつもりの入力も実行時ガードとテストで担保する。
- C3 の型は `apps/api/src/repositories/types.ts` から **type-only import**（`import type`）とし、リポジトリ実装・DB へのランタイム依存を作らない。
- `switch (input.changeType)` の `default` 節で暗黙に区分を返さない。`never` チェックで網羅性を保証し、想定外は例外にする。
- 通知区分の対応表を D3 内に複製しない（D2 の単一の所有物とする）。
- 色・文言・音は D3 の範囲外。§7.2 の表現案を実装に持ち込まない。

## 8. 要確認事項・残留リスク

- §7.5 は【確定】であり、本設計で新たに業務判断を必要とした論点は無い。§7.6 の未確定部分には踏み込んでいない。
- `WarningStateChangeDecisionError` をポーリングループが捕捉しない場合、現況処理全体を止める可能性がある。到達不能性は AC4 で固定するが、捕捉方針の決定は D4 に持ち越す（§6）。
- C3 の `diffWarningCurrent` は 1 現象キーにつき最大 1 件の差分を返す。1 電文で複数現象が同時に変化した場合、D3 は現象ごとに独立した判定を返す。**複数現象の通知をまとめるか個別に出すかは D4 の集約責務**であり、D3 では決めていない。
