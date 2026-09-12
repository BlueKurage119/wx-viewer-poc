# Issue #28 D4. 新規/継続/訂正/取消/初期取得の通知生成ルール 設計

対象 Issue: [#28](https://github.com/BlueKurage119/wx-viewer-poc/issues/28)
対象ブランチ: `feature/issue-28-warning-notification-rules`（`main` から作成）

## 1. 目的とスコープ

基本設計 §7.6 で確定した状態変化ルール（新規発表・継続・訂正・取消・初期取得／復旧）を実装し、**D2（区分判定）・D3（強化／緩和／解除判定）・#103（メッセージ定義）・B4（通知出力履歴）を初めて 1 本のポーリングパイプラインへ配線する**。本 Issue の完了時点で、警報・注意報電文の受信および起動時復旧から `notification_output_history` への通知レコード生成までが動作する。

### 1.1 やること

- `new`（新規発表）の通知生成ルール（§7.4 の対応表 = D2 分類器に従う）
- `continued`（同一内容の継続）で通知を生成しないルール
- 同一版の再取得で通知が重複生成されないルール
- `corrected`（InfoType=訂正）の通知生成ルール
- `cancelled`（InfoType=取消）の通知生成ルールと、取消電文を通常経路に乗せるための C3 現況側の変更
- 初期取得・復旧時に、現況を新規発見として通常ルールで通知するルール（プロセス起動単位でリセット）
- `corrected` / `cancelled` 用の通知メッセージ定義 2 種の追加（#103 の引き継ぎ事項）
- D3 判定・D2 分類の失敗時に、当該現象の通知だけを落として現況処理を止めない例外処理

### 1.2 やらないこと

- D5（起動時通知出力 API）、D6（端末セッション）、D7/D8（装置異常系通知）
- 通知の配信・鳴動・確認／回答処理・受領監視。フロント表示一切
- `packages/shared/src/notification.ts` の既存 `changeType` 列挙・型の破壊的変更（#25 で確定済み。**追加のみ**）
- 気象防災速報・竜巻注意情報等、警報・注意報コード表（§7.4 コード対応【確定】）の対象外の情報種別
- 訓練通知の注入／抹消 UI・API（§3.4）。本 Issue は `isTraining` の伝播のみを担う
- 通知の retention／削除ポリシー（#10 で既定済み）

## 2. 参照資料と、そこから導いた判断

### 2.1 参照資料

| 資料 | 参照した内容 |
|---|---|
| `docs/basic-design.md` §7.2〜§7.7 | 通知区分、§7.4 コード対応【確定】、§7.5 解除ルール【確定】、§7.6 その他の状態変化、§7.7 起動時出力 |
| `docs/basic-design.md` §3.4 | 訓練通知と `isTraining` の伝播範囲【確定】 |
| `docs/data-acquisition-report.md` L71 / L324 | InfoType は個別仕様に従う。警報・時系列は発表／訂正。取消の実電文・全シナリオ動作は**未検証** |
| `docs/design/issue-27-...md` §6・§8 | D3 が D4 へ引き継いだ事項（重複抑止・例外捕捉・集約粒度・`isTraining` 伝播） |
| `docs/design/issue-103-...md` §8 | 「訂正・取消の通知区分と表示文言をヒアリング後に新しい定義として追加する。継続には定義を選ばず通知自体を生成しない」 |
| `apps/api/src/polling/jmaWarningCurrentProcessor.ts` | `applyWarningCurrentReception` / `rebuildWarningCurrentFromReceptions` の現行挙動 |
| `apps/api/src/polling/jmaWarningCurrentReducer.ts` | `WARNING_CODE_TABLE`（code→phenomenonKey/telegramType/level）、`diffWarningCurrent` |
| `apps/api/src/notifications/warningNotificationCategoryClassifier.ts` | `classifyWarningNotificationCategory(code)` |
| `apps/api/src/notifications/warningStateChangeNotificationDecider.ts` | `decideWarningStateChangeNotification` / `isWarningStateChangeDecisionInput` |
| `packages/shared/src/notificationMessageDefinitions.ts` | 既存 21 定義と `resolveNotificationMessage` の検証規則 |
| `apps/api/src/repositories/notificationOutputHistoryRepository.ts` | `recordNotificationOutputHistory(connection, input)` |
| `apps/api/src/notifications/notificationOutputHistoryMapper.ts` | `toNotificationOutputHistoryInput(notification, output)` |
| `docs/260907_weather-data/jmaxml_20260723_Samples/` 実サンプル | `Kind/Name` の実値。例: `レベル２大雨注意報` / `レベル３大雨警報` / `レベル４大雨危険警報` |

### 2.2 実物調査で確かめた事実（設計の根拠）

1. **`Kind/Name` はレベルを含む完成した名称である。** VPWW55 サンプルの実値が `レベル３大雨警報` 等であることを確認した。したがって #103 §8 が要求する「検証済みコードから生成した『レベル3大雨警報』等を detail に渡す」は、**`WarningCurrentItemInput.kindName` をそのまま渡すことで満たせる**。文字列を組み立て直したり名称から分類したりしない。
2. **`WarningCurrentItemInput.warningLevel` は常に `null`。** `jmaWarningCurrentReducer.ts` が固定で `null` を設定している。レベル情報の取得元として使えない（→ 1 の `kindName` を使う根拠）。
3. **`WARNING_CODE_TABLE` の `level` は 1=注意報 / 2=警報 / 3=危険警報 / 4=特別警報 に完全一致する。** ただし本設計では `level` の意味に依存せず、コード→定義 ID の明示表を持ち、D2 の区分表との整合を受け入れ条件で固定する（§4.4）。
4. **現行の取消処理は現況にも受信履歴ポインターにも一切触れない。** `applyWarningCurrentReception` は `parsed.infoType === '取消'` を最初に見て `{applied:false, reason:'cancelled'}` を返し、`rebuildWarningCurrentFromReceptions` も同 InfoType を `continue` でスキップする。
5. **取消電文の実サンプルは 1 件も存在しない。** `VPWW55`〜`VPWW61`・`VPWS50` の提供サンプルは全件 `<InfoType>発表</InfoType>` である。**取消電文の本文構造（Kind 要素の有無・内容）は実挙動未確認。**
6. **`diffWarningCurrent` は現象キーごとに最大 1 件を返す。** 訂正・取消という概念を持たない（InfoType は現象差分とは独立の軸）。
7. **会場は 2 つで、`municipalCode` は `1310800`（江東区）/ `1311100`（大田区）と重複しない。** 現況スナップショットは `areaCode`+`controlStatus` で一意であり、会場ループによる同一地域の二重通知は発生しない。
8. **`notification_output_history` への書き込みは `recordNotificationOutputHistory` 1 本のみ。** 一意制約は `id` のみで、`notificationId` の重複を DB が弾かない（重複抑止はアプリ側の責務）。

### 2.3 統括担当から渡されたヒアリング確定事項の反映

| 確定事項 | 本設計での反映箇所 |
|---|---|
| Q1: InfoType=取消 を「該当現象の解除相当」として通常経路（現況更新＋通知）に乗せる。通知区分は §7.5 の解除ルール（固定 `warning`）を援用。対象は取消直前の `before` から決める | §4.6、§5.2 |
| Q2: 版が進んだ訂正電文は現象内容の増減に関わらず常に `corrected` 通知を生成する。区分は訂正後の現況コードを D2 に通して決める。同一版の再取得は既存 C3 版比較で弾かれ通知も出ない | §4.5 |

## 3. 全体構成

```
[ポーリング／起動時復旧]
  jmaWarningTelegramProcessor.processWarningTelegramReception
    └ applyWarningCurrentReception (C3)  ──→ WarningCurrentApplyResult
         applied:false → 通知を一切生成しない（重複抑止の一次防壁）
         applied:true  ↓
    └ emitWarningNotificationsForReception (D4・新規)
         ├ planWarningNotifications (D4 純粋関数・新規)
         │    ├ continued            → skip
         │    ├ new                  → D2 classify → 定義 ID 選択
         │    ├ strengthened/weakened/released → D3 decide → 定義 ID 選択
         │    ├ corrected            → D2 classify → corrected 定義
         │    └ cancelled            → 解除ルール(warning) → cancelled 定義
         │    └ resolveNotificationMessage (#103)
         └ recordNotificationOutputHistory (B4)

  server 起動 → rebuildWarningCurrentFromReceptions (C12)
    └ emitInitialWarningNotifications (D4・新規)
         └ InitialWarningNotificationTracker（プロセス内メモリ・非永続）
              未処理キーなら diffWarningCurrent([], snapshot.items) を
              detectionContext='initial' で通知
```

### 3.1 新規・変更ファイル

| ファイル | 区分 | 内容 |
|---|---|---|
| `packages/shared/src/notificationMessageDefinitions.ts` | 変更 | `weather-warning-corrected` / `weather-warning-cancelled` の 2 定義と ID 列挙を追加 |
| `apps/api/src/notifications/warningNotificationDefinitionSelector.ts` | 新規 | 警報等コード → `NotificationMessageDefinitionId` の明示表と選択関数 |
| `apps/api/src/notifications/warningNotificationPlanner.ts` | 新規 | D4 の中核。差分＋InfoType から通知計画を組む純粋関数 |
| `apps/api/src/notifications/initialWarningNotificationTracker.ts` | 新規 | プロセス起動単位の初期取得済み判定（非永続） |
| `apps/api/src/notifications/warningNotificationEmitter.ts` | 新規 | 計画を `notification_output_history` へ永続化する副作用層 |
| `apps/api/src/notifications/index.ts` | 変更（無ければ新規） | 上記のバレル export |
| `apps/api/src/polling/jmaWarningCurrentProcessor.ts` | 変更 | 取消電文を通常経路へ乗せる（§4.6） |
| `apps/api/src/polling/jmaWarningTelegramProcessor.ts` | 変更 | 採用成功時に D4 を呼ぶ配線 |
| `apps/api/src/server.ts` | 変更 | 復旧後に `emitInitialWarningNotifications` を呼ぶ配線と tracker の生成 |
| `apps/api/src/repositories/types.ts` | 変更 | `WarningCurrentApplyResult` に取消情報を追加（§4.6） |
| `apps/api/tests/**` | 新規 | §7 の受け入れ条件テスト |

## 4. 通知生成ルール

### 4.0 前提: 通知の粒度

**1 現象キー（`WarningPhenomenonKey`）につき 1 通知**とする。D3 §8 が D4 へ預けた「複数現象をまとめるか個別に出すか」の判断は、**個別**で確定する。根拠は #103 §8 の「大雨警報、土砂災害警報、雷注意報等の異なる情報は別通知にし、同じ情報・状態変化・区分・操作条件の複数地域だけを `targets` にまとめる」。本 PoC の対象地域は会場ごとに 1 市区町村であるため、`targets` は常に 1 要素になる。

### 4.1 共通フィールドの決め方

| フィールド | 値 |
|---|---|
| `notificationId` | 注入された `notificationIdFactory()`（既定 `crypto.randomUUID()`） |
| `origin` | `'weather'` 固定 |
| `category` | §4.3〜§4.6 の各ルール |
| `sourceType` | `'warning_current'` 固定（`packages/shared/src/notification.typecheck.ts` の既存例と一致させる） |
| `sourceVersion` | 適用後スナップショットの `metadata.sourceVersion` |
| `targets` | `[{ kind:'area', codeType:'jma_municipal_warning_area', code: snapshot.areaCode, name: snapshot.areaName }]` |
| `occurredAt` | 対象アイテムの `kindIssuedAt`。`null` のときスナップショットの `telegram.reportDateTime`。`released`/`cancelled` は `before` 側のアイテムではなく `telegram.reportDateTime`（解除を告げた電文の発表時刻） |
| `detectedAt` | 受信経路は `reception.receivedAt`。初期取得経路は注入 clock の現在時刻 |
| `relatedRefs` | `[{type:'warning_current', ref: snapshot.areaCode}]`。受信経路ではこれに `{type:'telegram_reception', ref: String(reception.id)}` を加える |
| `detectionContext` | tracker が当該キーを未処理と判定した評価では `'initial'`、以後は `'normal'`（§4.7） |
| `isTraining` | `controlStatus === 'training'` のとき `true`、それ以外 `false`（§4.8） |
| `ackRequired` / `summary` / `messageDefinition` | `resolveNotificationMessage` の戻り値をそのまま使う。D4 が上書きしない |

`resolveNotificationMessage` へ渡す `detail` は、対象アイテムの `kindName`（例 `レベル３大雨警報`）。`released` / `cancelled` は `before` 側の `kindName` を渡す（何が解除／取消されたかを示すため）。

### 4.2 `continued`（同一内容の継続）

**通知を生成しない。** #103 §8 の「継続には定義を選ばず通知自体を生成しない」に従い、メッセージ定義も持たない。ただし計画の `skipped` に `{ phenomenonKey, reason: 'continued' }` を残し、監視で「無視された」ことを追える形にする。

### 4.3 `new`（新規発表）

1. `classifyWarningNotificationCategory(after.kindCode)` を呼ぶ。
2. `kind === 'classified'` 以外（`release` / `unsupported`）は通知を生成せず `skipped` に `reason: 'unclassifiable_kind_code'` で記録する。**低い区分へフォールバックしない。**
3. `selectIssuedDefinitionId(after.kindCode)`（§4.4）で定義 ID を決める。
4. `changeType: 'new'`、`category` は 1 の結果。

### 4.4 コード → 発表時メッセージ定義 ID の対応表

`warningNotificationDefinitionSelector.ts` に**明示表**として持つ（`level` の大小や名称の部分一致で決めない）。

| 定義 ID | 対象コード |
|---|---|
| `weather-special-warning-issued` | `32` `33` `35` `36` `37` `38` `39`（特別警報） |
| `weather-warning-issued` | `43` `48` `49`（レベル4危険警報）、`02` `03` `04` `05` `06` `07` `08` `09`（警報） |
| `weather-advisory-issued` | `10` `12` `13` `14` `15` `16` `17` `18` `19` `20` `21` `22` `23` `24` `25` `26` `27` `29`（注意報） |

表に無いコードは `null` を返し、呼び出し側は通知を生成せず `skipped` に落とす。

この表と D2 の区分表は、`resolveNotificationMessage` の `allowedCategories` 検証を通る組合せでなければならない。整合は受け入れ条件 AC7 で全コード総当たりに固定する。

- `weather-special-warning-issued` は `emergency` のみ許可 → 対象 7 コードはすべて D2 で `emergency`。
- `weather-warning-issued` は `question`/`emergency` を許可 → `43/48/49` は `emergency`、`02`〜`09` は `question`。
- `weather-advisory-issued` は `warning`/`question` を許可 → `10/19/29` は `question`、残りは `warning`。

> 注: `04`（洪水警報）と `18`（洪水注意報）は `WARNING_CODE_TABLE` に存在しない（C3 が採用していない）ため、実際には差分として現れない。表には D2 と整合する形で載せるが、到達不能である旨をコメントに残す。**この不一致を理由に `WARNING_CODE_TABLE` を書き換えない**（C3 の責務であり本 Issue の範囲外）。

### 4.5 `corrected`（InfoType=訂正）

**【確定・Q2】** 版が進んだ訂正電文（C3 の版比較を通過し `applied:true` になったもの）は、現象内容の増減に関わらず必ず 1 件以上の通知を生成する。

ルール:

1. 当該受信の差分のうち `new` / `strengthened` / `weakened` / `released` に該当する現象は、**通常ルール（§4.3・D3）で通知する**。訂正電文で初めて現れた警報や強化された警報を「訂正」に埋没させない（安全側）。
2. 差分が `continued` の現象のうち、**訂正後スナップショットで `sourceTelegram` が当該電文種別と一致するアイテム**について、`changeType: 'corrected'` の通知を生成する。`category` は当該アイテムの `kindCode` を D2 に通した結果（Q2 の「訂正後の現況コードを D2 分類器に通して決める」）。
3. 1・2 のいずれでも 1 件も生成されなかった場合（例: 訂正後の現況が「発表警報・注意報はなし」）、対象地域のみを `targets` とする `corrected` 通知を 1 件、`category: 'warning'`（§7.5 解除ルールの援用）、`detail` なしで生成する。

定義 ID は `weather-warning-corrected`（§4.9）。

### 4.6 `cancelled`（InfoType=取消）

**【確定・Q1】** 取消電文を「該当現象の解除相当」として通常経路に乗せる。

#### 4.6.1 C3 側の変更（`jmaWarningCurrentProcessor.ts` / `jmaWarningCurrentReducer.ts`）

> **【訂正 2026-09-13】** 本節の初版は「個別電文の取消は `individualMap` から当該種別を除けば寄与が空になる」と書いていたが、これは**実装不可能な誤りだった**。実物調査の結果（下記「誤りの内容」）に基づき、メカニズムを書き直す。§4.6 の業務判断（取消＝該当現象の解除相当。H1/Q1）は変更しない。

**誤りの内容（実物確認済み）**

`jmaWarningCurrentReducer.ts` の `reduceWarningCurrent` は、`INDIVIDUAL_WARNING_TELEGRAM_TYPES` を 1 ストリームずつ走査し、`individuals` に当該種別が**無い**場合は `else` 分岐（「集約側の状態を採用」、現行 L300 付近）へ落ちて、**VPWS50 が保持している当該ストリーム所属の現象を無条件に `finalActiveMap` へ入れる**。したがって `individualMap` から外すことは「寄与が空」ではなく「集約側の値へフォールバックする」を意味する。VPWS50 が当該現象を発表中として保持しているのは府県警報等状況の定常状態であり、例外ではない。検収での実測: VPWS50 が `03`（大雨警報）＋`14`（雷注意報）を保持した状態で VPWW55 の取消を投入すると、取消後の現況に `03` が残存し `cancelled` 通知は 0 件（無音の no-op）になった。

**訂正後のメカニズム（案 A: 合成そのものに「取消ストリーム」の概念を持ち込む）**

「当該ストリームの寄与を除く」ではなく、**「当該ストリームに属する現象キーを、集約側の採用経路も含めて最終マップから成立させない」**という操作として設計し直す。後処理での差し引き（案 B）ではなく合成器側に入れる理由は、同じ規則が `applyWarningCurrentReception` と `rebuildWarningCurrentFromReceptions` の 2 経路で必要であり、後処理では両方に同じ減算ロジックを複製することになるため。

1. **`reduceWarningCurrent` に第 3 引数（任意）を追加する。**

   ```ts
   export function reduceWarningCurrent(
     aggregate: ParsedWarningTelegram,
     individuals: ReadonlyMap<IndividualWarningTelegramType, ParsedWarningTelegram>,
     /** InfoType=取消 のポインターを持つ個別ストリーム。既定は空。`individuals` とは排他。 */
     cancelledStreams?: ReadonlyMap<IndividualWarningTelegramType, ParsedWarningTelegram>,
   ): WarningCurrentReductionResult;
   ```

   - **任意引数**にするのは、既存の 2 引数呼び出し（`apps/api/tests/jmaWarningCurrentReducer.test.ts`、`jmaWarningCurrentProcessor.ts` の通常経路）を無改修で通すため。既存テストへの破壊的影響はない。
   - 呼び出し元は `jmaWarningCurrentProcessor.ts` の 2 箇所のみ（`applyWarningCurrentReception` / `rebuildWarningCurrentFromReceptions`）。
   - `WARNING_CODE_TABLE` は**変更しない**。

2. **ストリーム走査ループの先頭に取消判定を置く**（`individuals` / `individual && reportDateTime > baseline` などの既存分岐より**前**）。

   ```
   const cancel = cancelledStreams?.get(streamType);
   if (cancel && cancel.reportDateTime >= aggregateBaselines.get(streamType)!) {
     contributingTypes.add(streamType);   // 取消電文は現況の根拠として記録する
     continue;                            // 集約側フォールバックへ落とさない = 当該ストリームの現象キーは一切採用しない
   }
   ```

   - `continue` により、当該ストリームに属する現象キーは `finalActiveMap` に入らない。集約側が保持していても復活しない。これが今回の修正の本体である。
   - **baseline 比較を残す理由**: 取消より後に発表された新しい VPWS50 が当該現象を再び発表している場合（取消 → 府県一括で再発表）、取消で永久に潰してはならない。`cancel.reportDateTime < baseline`（＝集約のほうが新しい）のときは取消判定を行わず、既存の集約採用経路に進む。
   - **等時刻（`>=`）で取消を優先する理由**: 取消電文は本文 Kind を解釈しないため、既存の同時刻整合チェック（`WarningCurrentConflictError`）に載せられない。同時刻で集約側が当該現象を保持していた場合に「取消が無かったことになる」のを避け、安全側（現象を消す側）に倒す。
   - `individuals` と `cancelledStreams` は呼び出し元で排他に構築するため、同一種別が両方に入ることはない（不変条件としてコメントに明記する）。

3. **`contributingTelegramTypes` に取消ストリームを含める。** 取消電文は現況の導出根拠であり、その `contentHash` が `computeSourceVersion` に入ることで、取消の前後でスナップショットの `sourceVersion` が必ず変化する。既存の「`contributingTypes.size === 0` なら集約を入れる」フォールバックはそのまま残す。

4. **処理側（`jmaWarningCurrentProcessor.ts`）は `individualMap` と対になる `cancelledMap` を構築する。** 現行は取消ストリームを単に `individualMap` へ入れないだけなので、これを「除外しつつ `cancelledMap` に入れる」へ変える。対象は 2 経路とも同じ:
   - 今回の受信自身が個別電文の取消なら、`cancelledMap.set(parsed.telegramType, parsed)`。
   - 他ストリームのポインター受信を再パースした結果が `infoType === '取消'` なら、同じく `cancelledMap` へ入れる（取消ポインターを残したまま次の受信で内容が復活しないようにする。`rebuildWarningCurrentFromReceptions` でも同一の扱いにする）。
   - メタ情報構成ループ（`reduction.contributingTelegramTypes` を回して `contributingStreams` を組む箇所）で、電文本体の参照先に `cancelledMap` をフォールバックとして加える。これにより取消ストリームの `infoType` が `'取消'` として記録され、`primaryMeta` 経由でスナップショットの `telegram.infoType` にも反映される（現行のままだと `undefined` → `null` → `'発表'` に化ける）。

5. **取消電文の本文 Kind は依然として一切解釈しない。** 取消電文の本文構造は実挙動未確認（§2.2-5）であり、`extractActiveKindsByPhenomenon` を呼ばない。`cancelledStreams` の値から参照してよいのは `reportDateTime` / `contentHash` / `infoType` / `eventId` などのヘッダ情報のみ。

6. 版比較（`stale` / `duplicate` / `same_version_conflict`）は**通常どおり行う**。同じ版の取消電文の再取得は `duplicate` で弾かれる（Issue 本文「同じ版の再取得は重複処理しない」）。

7. `VPWS50`（府県警報等状況）の取消: 現況全体の基盤が失われる。**当該 `controlStatus` の現況を `items: []` のスナップショットへ更新し、全現象を取消対象とする**（H1 で確定済み）。この経路は `reduceWarningCurrent` を呼ばないため今回の修正の対象外であり、現行実装のままでよい。

8. 戻り値は `{ applied: true, origin, snapshot, changes, infoType: '取消' }` とする。D4 が InfoType を知る必要があるため、`WarningCurrentApplyResult` の `applied:true` 分岐に `readonly infoType: '発表' | '訂正' | '取消'` を追加する（`null` の InfoType は `'発表'` に正規化）。

> `reason: 'cancelled'` は「未知の InfoType」の場合にのみ残る。既存の `reason` 列挙値は削除しない（B 系の履歴・テストが参照するため）。

**実挙動未確認**: 「取消の後に、同じ現象を含む新しい VPWS50 が届く」実データは確認できていない。2 の baseline 比較はこの順序でも現況が正しく再構成されるようにするための設計上の保険であり、実電文での確認はしていない。

#### 4.6.2 D4 側のルール

- 取消電文由来の差分で `changeType === 'released'` のものを、`changeType: 'cancelled'` として通知する。
- `category` は **§7.5 の解除ルールを援用して固定 `'warning'`**（Q1）。`before.kindCode` も `after` も参照しない（D3 の `release_rule` と同じ考え方）。
- `ackRequired` は `resolveNotificationMessage` が `actionResolution: 'none'` から `false` を返す。
- `detail` は `before.kindName`（取消される直前のアイテム。Q1 の「対象は取消される直前の `before` から決める」）。
- 定義 ID は `weather-warning-cancelled`（§4.9）。
- 取消電文由来の差分に `new` / `strengthened` / `weakened` が現れることは、本文を解釈しない以上ありえない。万一現れた場合は生成せず `skipped` に `reason: 'unexpected_change_on_cancel'` で記録する（暗黙に通知へ変換しない）。
- **取消が現況を変化させなかった場合（no-op）の扱い**: §4.6.1 の修正により「集約側に残っていたため消えなかった」は発生しなくなるが、次の 2 経路では取消が `applied:true` のまま 0 件通知になりうる。
  1. 取消されたストリームがそもそも発表中の現象を 1 件も持っていなかった（現況に当該ストリーム所属の現象キーが無かった）。
  2. 取消電文より新しい VPWS50 が当該現象を発表中として保持しており、§4.6.1-2 の baseline 比較で取消判定が適用されなかった。

  この場合、`trigger.kind === 'reception' && trigger.infoType === '取消'` かつ生成通知が 0 件なら、`skipped` に 1 件
  `{ phenomenonKey: null, changeType: 'cancelled', reason: 'cancel_without_effect', detail: <電文種別と受信 ID> }`
  を記録する（`WarningNotificationSkipReason` に `'cancel_without_effect'` を追加。§5.1）。**通知は生成しない**（§4.5-3 の訂正のような「必ず 1 件」の救済は取消には適用しない。取消で何も消えていない以上、利用者へ知らせるべき状態変化が存在しないため）。`skipped` は §4.11 のとおり戻り値に含め `console.warn` で 1 行出す。取消が無音で消える現行の挙動（記録すら残らない）は、これで解消する。

> **§7.6 の「通常経路で処理することは取消済み内容を現行の警報として有効化する意味ではない」を守るため、取消電文の本文 Kind を現況へ取り込む実装は禁止する。**

### 4.7 初期取得・復旧

**【確定・§7.6】** 初期取得・復旧時に検知した「すでに発表中」の情報も、新規発見として通常の状態変化ルールどおりに通知する。履歴の一括通知防止の特別な抑制は設けない。「初期取得済み」の判定はプロセス起動単位でリセットし、永続化しない。

現行の問題: `rebuildWarningCurrentFromReceptions` は DB に残る既存スナップショットを `before` として差分を取るため、再起動時の差分は全件 `continued` になり、要件を満たさない。

設計:

```ts
// apps/api/src/notifications/initialWarningNotificationTracker.ts
export class InitialWarningNotificationTracker {
  /** キー = `${areaCode}|${controlStatus}`。プロセス内メモリのみ。永続化しない。 */
  isPending(areaCode: string, controlStatus: ControlStatus): boolean;
  markDone(areaCode: string, controlStatus: ControlStatus): void;
  /** テスト用。プロセス再起動の等価物。 */
  reset(): void;
}
```

- サーバ起動時、`rebuildWarningCurrentFromReceptions` の後に会場ごとに `emitInitialWarningNotifications(connection, targetArea, tracker, deps)` を呼ぶ。
- 同関数は `ControlStatus` の `'normal'` / `'training'` それぞれについて（§4.8 により `'test'` は対象外）:
  1. `tracker.isPending(areaCode, status)` が `false` なら何もしない。
  2. `findWarningCurrentSnapshot(connection, areaCode, status)` が `null` なら**何もしない（`markDone` もしない）**。§7.7 の「初期取得失敗をもって初回処理済みにしない」に従い、後から最初の電文が届いたときに初期取得として扱えるようにする。
  3. スナップショットがあれば `diffWarningCurrent([], snapshot.items)` を取る。全件 `new` になる。
  4. `detectionContext: 'initial'` で §4.3 のルールにより通知を生成・永続化する。
  5. `tracker.markDone(areaCode, status)`。
- 受信経路（`emitWarningNotificationsForReception`）でも、`tracker.isPending(...)` が `true` の間は `detectionContext: 'initial'` を使い、生成後に `markDone` する。これにより「復旧前に最初の電文が届いた」場合も初期取得として扱われ、二重に初期通知が出ない。
- tracker はサーバブートストラップで 1 インスタンス生成し、`processWarningTelegramReception` 系へ引数で渡す。**モジュールレベルの暗黙シングルトンにしない**（テストが並行実行でも独立するように）。

### 4.8 `isTraining` と `controlStatus`

| `controlStatus` | 扱い |
|---|---|
| `'normal'` | `isTraining: false` で通知を生成する |
| `'training'` | `isTraining: true` で通知を生成する（§3.4: 通知・履歴へ一貫して伝播） |
| `'test'` | **通知を生成しない（設計案）**。試験報は §3.4 の訓練通知とは別概念であり、`isTraining` に押し込めると本番／訓練の区別が壊れる。C3 の現況としては従来どおり保持する（→ §9 要ヒアリング事項 H2） |

`isTraining` は D3 を経由しない（D3 設計書 §6）。C3 スナップショットの `telegram.controlStatus` から D4 で導出する。**`isTraining` の値を通知区分・定義 ID の選択に混ぜない**（訓練データを本番相当と同一視しないが、区分の判定規則自体は同じであるため）。

### 4.9 追加するメッセージ定義（#103 の引き継ぎ）

`packages/shared/src/notificationMessageDefinitions.ts` に 2 件追加する。既存定義は変更しない。

| 定義 ID | origin | allowedCategories | requiredWeatherChangeType | title | targetMode | actionResolution |
|---|---|---|---|---|---|---|
| `weather-warning-corrected` | `weather` | `['warning','question','emergency']` | `'corrected'` | `気象警報等訂正` | `notificationTargets` | `byCategory` |
| `weather-warning-cancelled` | `weather` | `['warning']` | `'cancelled'` | `気象警報等取消` | `notificationTargets` | `none` |

- 体言止め（#103 §9）に揃えた。`weather-warning-released`（`気象警報等解除`）と並ぶ命名。
- `cancelled` を `released` で代用せず独立させた理由は §7.6 の「訂正・取消の原文の区分は保持する」。原文の InfoType を `changeType` に写し、表示上も「解除」と「取消」を混同させない。
- `NotificationMessageDefinitionId` の union にも追加する。`MESSAGE_DEFINITIONS` は `satisfies Record<NotificationMessageDefinitionId, ...>` なので、union だけ増やすと型エラーになる（追加漏れが型で検知される）。

### 4.10 重複抑止（Issue の受け入れ条件 1）

二段構えにする。

1. **一次防壁（C3）**: `applyWarningCurrentReception` が `applied:false`（`duplicate` / `stale` / `same_version_conflict` / `uninitialized` / `unsupported_*`）を返したら、D4 は**一切通知を生成しない**。同一版の再取得は `reason:'duplicate'` で弾かれる。取消電文も §4.6.1 により同じ版比較を通る。
2. **二次防壁（D4）**: `applied:true` でも `changes` が全件 `continued` で、かつ InfoType が `訂正` でなければ、生成される通知は 0 件になる（§4.2）。

アプリ側で `notification_output_history` を検索して重複判定する仕組みは設けない。理由: 初期取得ルール（§4.7）が「再起動のたびに再通知されうることを許容する」を確定しており、履歴ベースの重複排除はその確定事項と矛盾するため。

### 4.11 例外処理（D3 設計書 §6 の引き継ぎ）

`WarningStateChangeDecisionError` および D2 の `unsupported` は、**当該現象 1 件の通知だけを落とし、他の現象の通知と C3 の現況処理を止めない**。

- `planWarningNotifications` は純粋関数として例外を投げず、`skipped: readonly { phenomenonKey, changeType, reason }[]` に落とす。
- `resolveNotificationMessage` が `NotificationMessageResolutionError` を投げた場合も同様に当該 1 件を `skipped` に落とす（`reason: 'message_resolution_failed'`、`code` を含める）。**低い区分・類似定義・汎用文言へフォールバックしない**（#103 §3.1）。
- `emitWarningNotificationsForReception` は永続化時の例外を捕捉して `console.error` し、C2 の採用判定を取り消さない（既存の `jmaWarningTelegramProcessor` の方針と揃える）。
- `skipped` は戻り値として返し、`console.warn` で 1 行ずつ出す。監視 UI への配線は本 Issue の範囲外。

## 5. 型定義・シグネチャ

### 5.1 `warningNotificationPlanner.ts`

```ts
import type {
  NotificationCategory, ResolvedNotificationOutputSnapshot,
  UtcIso8601String, WeatherNotification, WeatherNotificationChangeType,
} from '@wx-viewer-poc/shared';
import type {
  ControlStatus, WarningCurrentChange, WarningCurrentItemInput,
  WarningPhenomenonKey, WarningTelegramType,
} from '../repositories/types.js';

/** 通知生成のきっかけ。InfoType（電文の軸）と初期取得（プロセスの軸）を 1 つに束ねる。 */
export type WarningNotificationTrigger =
  | { readonly kind: 'reception'; readonly infoType: '発表' | '訂正' | '取消';
      readonly telegramType: WarningTelegramType; readonly receptionId: number }
  | { readonly kind: 'initial' };

export interface WarningNotificationContext {
  readonly areaCode: string;
  readonly areaName: string;
  readonly controlStatus: ControlStatus;
  readonly sourceVersion: string | null;
  /** 適用後スナップショットの telegram.reportDateTime。 */
  readonly reportDateTime: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  /** 訂正・初期取得で現況アイテムを参照するため、適用後スナップショットの items を渡す。 */
  readonly currentItems: readonly WarningCurrentItemInput[];
}

export interface PlannedWarningNotification {
  readonly notification: WeatherNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export type WarningNotificationSkipReason =
  | 'continued'
  | 'unclassifiable_kind_code'
  | 'unmapped_definition'
  | 'state_change_decision_failed'
  | 'message_resolution_failed'
  | 'unexpected_change_on_cancel'
  | 'cancel_without_effect'
  | 'control_status_not_notifiable';

export interface WarningNotificationSkip {
  readonly phenomenonKey: WarningPhenomenonKey | null;
  readonly changeType: WeatherNotificationChangeType | null;
  readonly reason: WarningNotificationSkipReason;
  readonly detail: string;
}

export interface WarningNotificationPlan {
  readonly notifications: readonly PlannedWarningNotification[];
  readonly skipped: readonly WarningNotificationSkip[];
}

export interface PlanWarningNotificationsInput {
  readonly trigger: WarningNotificationTrigger;
  readonly changes: readonly WarningCurrentChange[];
  readonly context: WarningNotificationContext;
  readonly detectionContext: 'normal' | 'initial';
  readonly notificationIdFactory: () => string;
}

/** 副作用も例外も持たない。判定不能はすべて skipped へ落とす。 */
export function planWarningNotifications(
  input: PlanWarningNotificationsInput,
): WarningNotificationPlan;
```

### 5.2 `warningNotificationDefinitionSelector.ts`

```ts
import type { NotificationMessageDefinitionId } from '@wx-viewer-poc/shared';

/** §4.4 の明示表。表に無いコードは null。 */
export function selectIssuedNotificationDefinitionId(
  kindCode: string,
): NotificationMessageDefinitionId | null;

/** 状態変化 → 定義 ID。new は selectIssuedNotificationDefinitionId に委譲する。 */
export function selectWarningNotificationDefinitionId(
  changeType: 'new' | 'strengthened' | 'weakened' | 'released' | 'corrected' | 'cancelled',
  kindCode: string | null,
): NotificationMessageDefinitionId | null;
```

対応: `strengthened`→`weather-warning-strengthened`、`weakened`→`weather-warning-weakened`、`released`→`weather-warning-released`、`corrected`→`weather-warning-corrected`、`cancelled`→`weather-warning-cancelled`。

### 5.3 `initialWarningNotificationTracker.ts`

§4.7 のとおり。`ControlStatus` は `import type` で取り込む。

### 5.4 `warningNotificationEmitter.ts`

```ts
export interface WarningNotificationEmitDeps {
  readonly tracker: InitialWarningNotificationTracker;
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string; // 既定 crypto.randomUUID
}

export interface WarningNotificationEmitResult {
  readonly recordedCount: number;
  readonly skipped: readonly WarningNotificationSkip[];
}

/** 受信経路。applied:true の適用結果からのみ呼ぶ。 */
export function emitWarningNotificationsForReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  applyResult: Extract<WarningCurrentApplyResult, { applied: true }>,
  parsed: ParsedWarningTelegram,
  deps: WarningNotificationEmitDeps,
): WarningNotificationEmitResult;

/** 起動時復旧経路。会場ごとに 1 回呼ぶ。 */
export function emitInitialWarningNotifications(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea,
  deps: WarningNotificationEmitDeps,
): WarningNotificationEmitResult;
```

永続化は `toNotificationOutputHistoryInput(notification, output)` → `recordNotificationOutputHistory(connection, input)`。複数件は 1 トランザクションでまとめる（`connection.transaction`）。**C3 の適用トランザクションとは分ける**（C3 の適用を通知の失敗で巻き戻さない。失敗しても §4.7 により再起動時に初期取得として再評価される）。

## 6. 実装手順

1. `packages/shared` に `weather-warning-corrected` / `weather-warning-cancelled` を追加し、`npm run typecheck` を通す。
2. `warningNotificationDefinitionSelector.ts` を追加。D2 との整合テスト（AC7）を先に書き、red を確認する。
3. `initialWarningNotificationTracker.ts` を追加。
4. `warningNotificationPlanner.ts` を追加（純粋関数）。`new` / `continued` / `strengthened` / `weakened` / `released` から着手し、`corrected` / `cancelled` を続ける。
5. `WarningCurrentApplyResult` に `infoType` を追加し、`applyWarningCurrentReception` の取消処理を §4.6.1 に置き換える。`rebuildWarningCurrentFromReceptions` の取消スキップも同時に直す。既存の C3 テストが落ちないこと（落ちる場合は取消関連のみであることを確認する）。
6. `warningNotificationEmitter.ts` を追加し、`jmaWarningTelegramProcessor` / `server.ts` へ配線する。
7. 受け入れ条件テストを追加し、red → green → ミューテーションの順で検証する。

コミットは 2〜3 回（例: ①shared 定義追加＋セレクタ、②プランナ＋トラッカ＋C3 取消対応、③配線＋テスト）。

## 7. 受け入れ条件（検収担当が 1 項目ずつ実行する）

前提コマンドはリポジトリルートで実行する。

### AC0 共通検証

```bash
npm run lint && npm run typecheck && npm run format:check && npm run test -w apps/api && npm run test -w packages/shared
```

すべて終了コード 0。`--max-warnings 0` のため警告も 0 件であること。

### AC1 同一版の再取得で通知が重複生成されない

テスト名（例）: `同一 contentHash の電文を 2 回処理しても通知は 1 回だけ生成される`

手順: インメモリ DB に VPWS50（警報 1 件以上を含む）を投入し `processWarningTelegramReception` を 1 回実行 → `listNotificationOutputHistory` の件数を `N` として記録。**同一の受信内容（同一 `reportDateTime` / `controlDateTime` / `contentHash`）**をもう一度処理する。

合格条件:
- 2 回目の `applyWarningCurrentReception` 相当の結果が `applied:false, reason:'duplicate'`。
- 通知件数が `N` のまま増えない。
- `N >= 1`（1 回目は実際に通知が出ている＝抑止と無通知の区別がつく）。

### AC2 初期取得・復旧で現況が通常ルールどおり通知される

テスト名（例）: `プロセス再起動を模して tracker を作り直すと、既存現況が new として再通知される`

手順: 電文を処理して現況スナップショットを作る（通知 `N1` 件）。**同じ DB 接続のまま新しい `InitialWarningNotificationTracker` を生成**（＝プロセス再起動の等価物）し、`rebuildWarningCurrentFromReceptions` → `emitInitialWarningNotifications` を実行する。

合格条件:
- 追加された通知が、現況アイテム件数と同じだけ生成されている。
- 追加分の `change_type` がすべて `new`。
- 追加分の `detection_context` がすべて `initial`。
- 追加分の `category` が、各アイテムの `kindCode` に対する `classifyWarningNotificationCategory` の結果と一致する（区分が `warning` に丸められていない）。
- さらにもう一度 `emitInitialWarningNotifications` を同じ tracker で呼んでも件数が増えない（プロセス内では 1 回だけ）。

### AC3 継続では通知が生成されない

同一現象・同一 `kindCode` で `reportDateTime` だけが新しい電文を続けて処理する。

合格条件: 2 通目の適用は `applied:true` かつ差分が `continued` のみで、通知が 1 件も追加されない。

### AC4 新規発表の区分と定義 ID

`03`（レベル３大雨警報）を含む電文を新規適用する。

合格条件:
- 通知 1 件、`change_type='new'`、`category='question'`、`ack_required=1`。
- `message_definition_id='weather-warning-issued'`、`message_definition_version='1'`。
- `summary` が `気象警報発表` で始まり、対象地域名と `レベル３大雨警報` を LF 区切りで含む。

同様に `33`（大雨特別警報）で `category='emergency'` / `weather-special-warning-issued`、`10`（レベル２大雨注意報）で `category='question'` / `weather-advisory-issued`、`14`（雷注意報）で `category='warning'` / `ack_required=0` / `weather-advisory-issued` を確認する。

### AC5 訂正は常に通知される

`InfoType=訂正` で、**現況の警報コードがまったく変わらない**（全現象 `continued`）電文を、`reportDateTime` を進めて投入する。

合格条件:
- 適用結果が `applied:true`。
- `change_type='corrected'` の通知が 1 件以上生成される。
- その `category` が、訂正後の現況アイテムの `kindCode` を D2 に通した結果と一致する。
- `message_definition_id='weather-warning-corrected'`。
- 同じ版（同一 `contentHash`）の訂正電文を再投入すると通知が増えない。

### AC6 取消は解除相当として通知される

**AC6-1（基本ケース）**: VPWW55 で `03` を発表済みの状態から、同 VPWW55 の `InfoType=取消` 電文（`reportDateTime` は前進）を投入する。

合格条件:
- 適用結果が `applied:true`（`reason:'cancelled'` で弾かれない）。
- 現況スナップショットから当該現象（`heavy_rain`）のアイテムが消えている。
- `change_type='cancelled'` の通知が 1 件生成され、`category='warning'`、`ack_required=0`、`message_definition_id='weather-warning-cancelled'`。
- `summary` に取消前の `kindName`（`レベル３大雨警報`）が含まれる。
- **取消電文の本文に含まれる Kind が現況へ取り込まれていない**（取消電文にダミーの Kind を入れたフィクスチャで、現況アイテムがそれを含まないことを確認する）。
- 同一版の取消電文を再投入すると `duplicate` となり通知が増えない。
- 取消後にプロセス再起動相当（新 tracker + `rebuildWarningCurrentFromReceptions`）を行っても、取消前の内容が現況に復活しない。

**AC6-2（集約側フォールバック経路 — 今回の欠陥の回帰テスト。必須）**: §4.6.1 の「誤りの内容」で実測された経路を、そのままテストケースにする。

手順:
1. VPWS50 で `03`（大雨警報, VPWW55 所属）と `14`（雷注意報, VPWW61 所属）を発表する。
2. 個別 VPWW55 で同じ `03` を継続発表する（`reportDateTime` は VPWS50 より前進）。
3. 同 VPWW55 の `InfoType=取消` 電文（`reportDateTime` はさらに前進）を投入する。

合格条件:
- 適用結果が `applied:true`。
- **取消後の現況スナップショットに `heavy_rain`（`kindCode='03'`）が含まれない**。VPWS50 が `03` を保持したままでも復活しないこと。これが不合格なら §4.6.1 の修正が効いていない。
- 取消後の現況に `14`（`thunder`）は**残っている**（取消は VPWW55 所属の現象キーのみを落とし、他ストリームの現象を巻き込まない）。
- `change_type='cancelled'` の通知が 1 件生成され、`category='warning'`、`ack_required=0`、`message_definition_id='weather-warning-cancelled'`、`summary` に `03` の `kindName` が含まれる。
- スナップショットの `metadata.sourceVersion` が取消前後で変化している（§4.6.1-3）。
- 続けて `rebuildWarningCurrentFromReceptions` を実行しても `heavy_rain` が復活せず、`thunder` は残る。

**AC6-3（no-op の記録）**: VPWS50 が `14` のみを発表中で、VPWW55 の現象が現況に 1 件も無い状態から、VPWW55 の `InfoType=取消` を投入する。

合格条件:
- `applied:true` かつ生成通知 0 件。
- 返却される `skipped` に `reason: 'cancel_without_effect'`、`phenomenonKey: null` の記録が 1 件含まれる（§4.6.2）。
- `notification_output_history` に当該受信由来のレコードが増えていない。

### AC7 D2 区分表と定義 ID 表の整合（総当たり）

`classifyWarningNotificationCategory` が `classified` を返す全 36 コードについて、`selectIssuedNotificationDefinitionId` が `null` を返さず、得られた定義 ID の `allowedCategories` に D2 の区分が含まれることをテストで総当たり確認する。

合格条件: 全コードで成立し、かつ `resolveNotificationMessage` が `notification_mismatch` を投げない。

### AC8 訓練データが本番と混同されない

`controlStatus='training'` の電文を処理する。

合格条件:
- 生成された通知の `is_training=1`。
- 同じ内容の `controlStatus='normal'` 電文で生成された通知の `is_training=0`。
- `listNotificationOutputHistory(connection, { isTraining: false })` に訓練由来の通知が含まれない。
- 訓練由来通知の `category` が、本番相当と同じ規則で決まっている（訓練だからといって区分が下がっていない）。

### AC9 判定不能コードでフォールバックしない

D2 で `unsupported` になるコードを含む差分を `planWarningNotifications` に直接与える（純粋関数テスト）。

合格条件: 例外を投げず、当該現象の通知が生成されず、`skipped` に `reason:'unclassifiable_kind_code'` が入る。他の現象の通知は生成される。

### AC10 red / 対照実験 / ミューテーション

- 新規テストは、実装を壊した状態で実際に落ちること（red）を先に確認して報告する。
- ミューテーション判定の前に、意味を変えないダミー改変が SURVIVED になることを確認する（対照実験）。
- 次の 3 変異が KILLED になること: ①`continued` を skip せず通知する、②`detectionContext` を常に `'normal'` にする、③`cancelled` の `category` を `before.kindCode` から決める。
- 対照変更・変異は元に戻し、完成コードへ残さない。

### AC11 手動確認

```bash
npm run dev
```

API を起動し、既存の受信履歴がある状態で `GET /api/notifications/output-history`（存在しない場合は DB を直接 `sqlite3` で確認）に、起動時に `detection_context='initial'` の行が追加されていることを確認する。起動を 2 回行うと、その都度 `initial` の行が増える（§7.6 の「再起動のたびに再通知されうることを許容する」）。

## 8. 後続 Issue への引き継ぎ

- **D5（起動時通知出力 API）**: 本 Issue は `notification_output_history` への記録までを担う。端末起動時の出力対象選択（§7.7: 問いかけ・非常ブザーは毎回、`warning` はサーバ起動後初回のみ）は D5 が所有する。`InitialWarningNotificationTracker` は「サーバ起動後初回」の判定に再利用できるが、**D5 の端末セッション単位の判定（D6）とは別軸**である。混同しないこと。
- **D5/D6**: `detectionContext='initial'` は「サーバが初期取得として検知した」という意味であり、「端末起動時に出力すべき」という意味ではない。
- **D7/D8（装置異常系）**: `warningNotificationEmitter` の永続化パターン（`toNotificationOutputHistoryInput` → `recordNotificationOutputHistory` を 1 トランザクション）をそのまま踏襲できる。
- **#103**: 訂正・取消の定義が追加されたことで、気象系の定義は 13 種になる。今後 `sourceType` / `changeType` による自動選択関数を設ける場合、本 Issue の `warningNotificationDefinitionSelector` が唯一の対応表である。
- **フロント（§7.2 の表現）**: 通知区分色は #90（セマンティックカラー）の対象。本 Issue は色・音・文言表現を持たない。
- **C3**: 取消電文の本文 Kind を解釈しない方針は、実電文が入手でき次第見直す前提の暫定である（§10）。

## 9. ヒアリング事項（統括担当が確認済み）

本設計時点で設計担当が決めずに残した論点は、統括担当が追加ヒアリングを行い、以下のとおりすべて設計案どおり確定した。

- **H1（確定）**: `VPWS50`（府県警報等状況）の `InfoType=取消` を受信した場合、当該地域・当該 `controlStatus` の現況を**空にし、発表中だった全現象を `cancelled` として通知する**（§4.6.1 の設計案どおり）。
- **H2（確定）**: `controlStatus='test'`（試験報）の電文からは**通知を生成しない**（現況としては保持する。§4.8 の設計案どおり）。
- **H3（確定）**: 訂正電文で現象内容に増減があった場合、**増減があった現象は通常ルール（`new`/`strengthened`/`weakened`/`released`）、変化のなかった現象は `corrected`** とする（§4.5 の設計案どおり）。
- **H4（確定）**: `corrected` / `cancelled` の表示文言は `気象警報等訂正` / `気象警報等取消` のままとする（§4.9 の設計案どおり）。

## 10. 実装上の注意・残留リスク

- **取消電文の本文構造は実挙動未確認である。** 提供サンプル（`jmaxml_20260723_Samples/`、`260812_高潮サンプル電文/`）に `VPWW55`〜`VPWW61`・`VPWS50` の `InfoType=取消` は 1 件も存在しない。本設計は「取消電文の本文 Kind を一切解釈しない」ことでこのリスクを封じている。実電文が入手できたら、Kind の有無・`EventID` の一致条件・`Serial` の扱いを再検証すること。**名称やコード番号から取消対象を推定する実装を足さない。**
- **`availability` を単純化しない。** 本 Issue は `available` 状態の現況からのみ通知を生成する。`stale` / `unavailable` に対応する通知は D7/D8（装置異常系）の責務であり、ここで OK/NG の 2 値に潰さないこと。
- **`WARNING_CODE_TABLE` を本 Issue で書き換えない。** `04`（洪水警報）/`18`（洪水注意報）が C3 の表に無いことは既知の差であり、D4 の都合で C3 を変更しない。
- **通知の永続化は C3 の適用トランザクションの外で行う。** 通知記録の失敗で現況適用を巻き戻さない。両者の間でプロセスが落ちた場合、その通知は失われるが、§4.7 の初期取得ルールにより再起動時に現況が再通知される。
- **`apps/api/tests` は `npm run typecheck` の対象外**（D3 設計書 §7）。型で排除したつもりの入力も実行時ガードとテストで担保する。
- **`process` レベルのシングルトンを使わない。** tracker はブートストラップで生成して引数で渡す。テストが並行実行されても独立する。
- **色・音・文言表現を D4 に持ち込まない。** §7.2 の表現案は実装対象外。
- `console.error` / `console.warn` は既存の `jmaWarningTelegramProcessor` と同じ粒度に留める。監視 UI への配線は本 Issue の範囲外。
