# Issue #26「D2. コード対応表に基づく通知区分判定」設計案

作成日: 2026-09-12
設計担当: Codex（GPT-6 Astra）

## 1. 目的・承認範囲

警報等情報要素の `Kind/Code` から、基本設計 §7.4 の確定した通知区分を返す純粋関数を追加する。同時に、既存の現況構成で注意報と特別警報のコード対応が逆転している不具合を修正する。

ユーザーとの協議で、D2 と既存コード表の修正、誤対応を前提にしたテスト・設計記述の修正、公式コードによる強化・緩和の回帰検証、保存済み現況への影響調査を同じ設計に含めることになった。**製造は #114 完了後、かつ本設計への承認後に開始する。現在は設計のみである。**

#114 は PR #129 でマージ済み。初版の基準 HEAD は `b8a05eeb8c7e013e1587e103ddec1117e2779963`、統合確認の基準 HEAD は `bf7c8ef`。#114 の実装作業用 worktree は変更・操作しない。製造ブランチは統括担当が設計承認後に指定する。設計担当はブランチ・コミットを作成しない。

### 対象外

- D3 の強化・緩和・解除時の通知生成と D4 の継続・訂正・取消・重複・初期取得ルール
- `Notification` の生成、ID 採番、対象区域の集約、文言生成、確認要否、B4 への通知履歴保存
- 気象防災速報・竜巻等の別コード体系、装置異常の区分判定
- API エンドポイント、UI、共有通知型の変更
- C3 の対応電文・現象の拡張、警戒レベルや画面順序の変更
- 稼働中 DB の書換え、過去履歴の訂正、DB や履歴の削除
- #130 の `jmaXmlPolling.test.ts` にある `freshnessPolicy` 重複キーの修正（別 Issue の既存不具合）

## 2. 参照資料と調査結果

| 資料・実装 | 根拠・確認内容 |
| --- | --- |
| [Issue 化ドラフト](../issues-draft.md) D2、Issue #26 | Kind/Code による通知区分判定。未定義コードを低区分へ自動割当しない |
| [基本設計](../basic-design.md) §7.4、§7.5、§7.6、§9.3 | §7.4 の確定コード表が D2 の唯一の業務上の区分対応。状態変化による通知要否は別責務 |
| [取得方法レポート](../data-acquisition-report.md) §警報・注意報、L3・提供サンプル | Kind/Code と Significancy/Code は別辞書。個別 VPWW55〜61 と集約 VPWS50 の現況処理 |
| [公式コード表](</Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260826_code.xlsx>)「警報等情報要素コード管理表」E24:F64 | 統括の照合結果を引継ぎ。§7.4 の 36 コードと一致。10 は大雨注意報、33 は大雨特別警報等 |
| 同レポート参照の提供 XML | 統括の実 XML 照合結果を引継ぎ。10＝大雨注意報、29＝土砂災害注意報、15＝強風注意報を確認済み |
| [C3 設計](issue-13-warning-current-state.md) §3.3・§3.6・復旧処理 | 現象別所属と段階比較の責務。通知は生成しない |
| [#114 設計](issue-114-venue-scoped-adoption-history.md)、PR #129 のマージ差分 | 会場別採用履歴、必須 targetArea 引数、全会場の起動時再処理・再構築。実装を §5 と照合済み |
| [D1 設計](issue-25-notification-data-model.md)、`packages/shared/src/notification.ts` | `NotificationCategory = 'warning' \| 'question' \| 'emergency'` を再利用 |
| `apps/api/src/polling/jmaWarningCurrentReducer.ts` | 7 組の注意報・特別警報の段階が逆転。土砂災害のコメントも洪水等と誤記。現象キーと所属ストリームは維持できる |
| `apps/api/src/polling/jmaWarningTelegramParser.ts` | Code は文字列として保持。数値化・ゼロ埋めはしない |
| `apps/api/src/polling/jmaWarningCurrentProcessor.ts`、現況リポジトリ、`server.ts` | 保存済み現況と受信原文の復旧境界は §5 に記載 |

コード表の全コードについて実電文での発表例を確認したという意味ではない。36 コードの通知対応は公式コード表と基本設計の確定表に基づく。対応電文をこの設計で追加推定しない。§5.7 の表示に関する【設計案】は確定扱いしない。

## 3. D2 のモジュール・API

### 3.1 配置と公開境界

新規 `apps/api/src/notifications/warningNotificationCategoryClassifier.ts` に判定関数と戻り値型を置き、既存 `apps/api/src/notifications/index.ts` から export する。`NotificationCategory` は `@wx-viewer-poc/shared` から type import する。

```ts
export type WarningNotificationCategoryResult =
  | { readonly kind: 'classified'; readonly category: NotificationCategory }
  | { readonly kind: 'release' }
  | { readonly kind: 'unsupported' };

export function classifyWarningNotificationCategory(
  code: string,
): WarningNotificationCategoryResult;
```

入力は **警報等情報要素の Kind/Code の文字列のみ**。Status、Name、LastKind、Significancy、地域、通知生成文脈、訓練フラグを入力に混在させない。HTTP API は追加しない。

戻り値の `release` はコード `00` が通常の発表中種別表の対象外であることを表し、解除通知を生成する指示ではない。解除対象コードを保持した `Status=解除` や電文取消の解釈は呼出側の D3/D4 が所有する。`classified` でも通知すべきとは限らない。

### 3.2 入力表現と対応表

実装のキーは既存パーサー・現況処理と同じ **2 桁の ASCII 数字文字列**とする。資料の `2` はコード `02` として記載する。呼出時の数値化、trim、ゼロ埋め、部分一致を行わない。`'2'`、`' 02 '`、`'002'` 等は未対応である。これは内部 API の入力契約であり、気象庁がそれらの入力を提供すると主張するものではない。

| 結果 | コード（完全一致） |
| --- | --- |
| `classified / emergency` | `32`, `33`, `35`, `36`, `37`, `38`, `39`, `43`, `48`, `49` |
| `classified / question` | `02`, `03`, `04`, `05`, `06`, `07`, `08`, `09`, `10`, `19`, `29` |
| `classified / warning` | `12`, `13`, `14`, `15`, `16`, `17`, `18`, `20`, `21`, `22`, `23`, `24`, `25`, `26`, `27` |
| `release`（category なし） | `00` |
| `unsupported`（category なし） | 上記以外すべて。予約・未知・空文字・形式外を含む |

`warning` は通知区分の「警報」であり、気象警報の段階ではない。対応表はモジュール内部の明示的な定数とし、値の大小・名称・C3 の level から推論しない。通常オブジェクトを使う場合は own property のみを照合するか、`Map` 等でキーを厳密に照合する。`toString` 等を対応コードと誤認しない。

例外・ログ・I/O・DB 書込みは行わず、同じ文字列に同じ結果を返す。型上 `string` 以外は受け付けない。外部入力のスキーマ検証を新設する範囲ではない。

### 3.3 現況表との責務分離

C3 の表は現象キー・担当電文・比較段階を管理し、D2 の表は通知区分だけを管理する。D2 を reducer 内に置いたり、C3 に通知属性を追加したりしない。既存 C3 が対応していない `04`（洪水警報）、`18`（洪水注意報）も D2 では確定表どおり分類するが、C3 の受信対応を追加する意味ではない。

両表の相違は、独立した公式対応を期待値にしたテストで防止する。実装の C3 表から D2 テストの期待値を生成しない。

## 4. 現況判定コード表の修正

`PhenomenonDefinition.level` の `注意報=1 / 警報=2 / 危険警報=3 / 特別警報=4` は内部比較尺度であり、気象庁の警戒レベル番号ではない。この尺度・型・現象キー・担当電文は変更しない。

| 現象キー / 電文 | level 1 | level 2 | level 3 | level 4 |
| --- | --- | --- | --- | --- |
| `heavy_rain` / VPWW55 | `10` 大雨注意報 | `03` 大雨警報 | `43` 大雨危険警報 | `33` 大雨特別警報 |
| `landslide` / VPWW56 | `29` 土砂災害注意報 | `09` 土砂災害警報 | `49` 土砂災害危険警報 | `39` 土砂災害特別警報 |
| `storm_surge` / VPWW57 | `19` 高潮注意報 | `08` 高潮警報 | `48` 高潮危険警報 | `38` 高潮特別警報 |
| `snowstorm` / VPWW58 | `13` 風雪注意報 | `02` 暴風雪警報 | — | `32` 暴風雪特別警報 |
| `storm` / VPWW58 | `15` 強風注意報 | `05` 暴風警報 | — | `35` 暴風特別警報 |
| `waves` / VPWW59 | `16` 波浪注意報 | `07` 波浪警報 | — | `37` 波浪特別警報 |
| `heavy_snow` / VPWW60 | `12` 大雪注意報 | `06` 大雪警報 | — | `36` 大雪特別警報 |

上表の名称は現象説明用の略記であり、XML の Name をこの文字列で上書きしない。`WARNING_CODE_TABLE` の 14 エントリーの level を修正し、コメントの誤記も是正する。VPWW61 の独立注意報とその他の現況構成アルゴリズムは維持する。

`jmaWarningCurrentReducer.test.ts` と `jmaWarningCurrentProcessor.test.ts` は、たとえば「大雨注意報なのに Code=33」「高潮注意報なのに Code=38」の fixture・期待値・コメントを公式対応へ直す。一括の数字置換は行わず、元のシナリオが意図した注意報・警報・特別警報の段階を保つ。LastKind のコード・名称も整合させる。パーサー単体で名称不一致を保持する試験があれば、境界の試験としての意図を確認して維持する。

[C3 設計](issue-13-warning-current-state.md) §3.3 の列挙順は段階の明示表ではないため、製造時に §3.6 へ上表に相当する正しい段階対応と #26 による訂正注記を追記する。既存設計を全面改稿しない。基本設計 §7.4 は既に正しく、修正不要。

## 5. 保存済み現況・復旧への影響

設計時点の調査では、現況明細は `kindCode`、`kindName`、`lastKindCode` 等の原文由来の値を保存し、今回誤っていた内部 `level` は保存しない。比較時に before/after の両コードを現在の `WARNING_CODE_TABLE` で解釈する。そのため **コード表の修正だけを理由とする DB migration・コード値の置換・強制再保存は不要**である。実データの `10` を `33` に書き換えることは誤りである。

既存の通常起動は受信の再処理後に `rebuildWarningCurrentFromReceptions` を実行する。`enablePolling=false` の経路は同じ復旧を実行しない。復旧候補は原文等がある対象電文を採用結果で絞らず読み直し、新しい表で原文をパース・合成する。復旧は通知出力履歴を追記しない。

`sourceVersion` は寄与ストリーム由来であり、内部 level を含まない。復旧後も sourceVersion が同じなら現況保存は既存スナップショットを返す。今回の修正は保存対象値を変えないため、この短絡を解除する必要はない。修正後の次回差分は保存済みコードを新しい表で比較できる。

過去に誤判定した受信履歴・外部に返した差分を遡及して書き換えない。誤ったコード・名称を含む開発 fixture を原文として投入済みの場合、それは実電文と異なる入力であり、一律変換の対象にしない。今回、稼働 DB の内容は未確認であり、その削除や補正は承認範囲に含めない。

### #114 マージ後の統合境界

`bf7c8ef` の実装を照合し、level の永続化や sourceVersion の算出変更がないことを確認した。#114 の migration `0018` は会場別採用履歴を導入するものであり、D2 に追加 migration は要らない。製造・検収では最新 migration 適用済みの一時 DB を使う。

既存 API は次のとおりであり、D2 でシグネチャを変更しない。

```ts
resolveVenueWarningContext(venueId: VenueId): VenueWarningContext;
// VenueWarningContext = { readonly venueId: VenueId; readonly targetArea: WarningCurrentTargetArea }
processWarningTelegramReception(connection: DatabaseConnection, reception: TelegramReception,
  decidedAt: UtcIso8601String, venue: VenueWarningContext): WarningTelegramParseResult;
processWarningTelegramReceptionForAllVenues(connection: DatabaseConnection,
  reception: TelegramReception, decidedAt: UtcIso8601String): ReadonlyMap<VenueId, WarningTelegramParseResult>;
applyWarningCurrentReception(connection: DatabaseConnection, reception: TelegramReception,
  parsed: ParsedWarningTelegram, targetArea: WarningCurrentTargetArea): WarningCurrentApplyResult;
reprocessPendingWarningTelegramReceptions(connection: DatabaseConnection,
  venue: VenueWarningContext, clock: () => UtcIso8601String): Promise<{ readonly processedCount: number }>;
rebuildWarningCurrentFromReceptions(connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea): WarningCurrentApplyResult;
getVenueWarningCurrent(connection: DatabaseConnection, venueId: VenueId,
  controlStatus: ControlStatus): WarningCurrentSnapshot | null;
```

`VENUE_IDS` は `east` / `trc`。resolver の対象は east が市町村等コード `1310800`（江東区）、trc が `1311100`（大田区）、府県予報区コードは双方 `130000`。現況は `(area_code, control_status)`、ストリームは `(prefecture_code, area_code, control_status, telegram_type)`、採用履歴は `(reception_id, venue_id)` で分離する。会場に応じてパースし直し、他会場のパース結果を流用しない。

通常起動の両経路は `VENUE_IDS` をループし、各 resolver 結果で `reprocessPendingWarningTelegramReceptions(connection, venue, clock)`、`rebuildWarningCurrentFromReceptions(connection, venue.targetArea)` の順に実行する。復旧関数は全 controlStatus を内部で再構築するが、戻り値は normal の結果だけである。training/test の検証は戻り値で代用せず、`getVenueWarningCurrent` で明示的に読む。再処理は未判定の会場別採用行を補うため、起動手順全体の初回には採用行が増え得る。原文・通知履歴の不変と、採用行の初回補完後の冪等性を分けて検証する。

AC9 では `jmaWarningCurrentProcessor.test.ts` に、両市町村を含む合成 VPWS50 で 2 会場 × 3 controlStatus を初期化する回帰を追加する。各組を対象にした公式 Code `10→03` の新しい VPWW55 を適用し、対象の差分が `strengthened` となり、残り 5 組のスナップショット全体が事前値と完全一致することを確認する。逆方向 `33→03` の `weakened` は AC7 で検証する。全会場処理の採用結果は会場別に確認し、その後起動と同じ再処理・再構築を 2 回実行して 6 組の最終現況・sourceVersion、原文・通知履歴、および初回補完後の採用行が完全一致することを確認する。ネットワークを起動せず、既存テストの一時 DB と合成 fixture を拡張する。

## 6. 変更対象と製造手順

| ファイル | 変更 |
| --- | --- |
| `apps/api/src/notifications/warningNotificationCategoryClassifier.ts` | 新規の型、分類関数、内部対応表 |
| `apps/api/src/notifications/index.ts` | 公開 export |
| `apps/api/tests/warningNotificationCategoryClassifier.test.ts` | 新規の全コード・例外入力・C3 との意味整合テスト |
| `apps/api/src/polling/jmaWarningCurrentReducer.ts` | 段階表とコメント修正 |
| `apps/api/tests/jmaWarningCurrentReducer.test.ts` | 既存 fixture 整合と全 7 現象の差分回帰 |
| `apps/api/tests/jmaWarningCurrentProcessor.test.ts` | 既存 fixture 整合、保存済み現況・復旧回帰 |
| `docs/design/issue-13-warning-current-state.md` | §3.6 に段階対応と訂正根拠を追記 |

1. 統括が #114 完了と設計承認を確認し、製造ブランチを指定する。
2. `npm run build -w packages/shared` で参照する shared の生成物を最新化し、#114 統合後の上記ファイル、関連型、復旧呼出しとテスト配置を再確認する。変更が本設計の契約と矛盾する場合は停止して統括へ返す。
3. 公式対応の独立した期待値を使うテストを準備し、既存 C3 の段階逆転を再現する red を記録する。この段階では未実装の D2 に SURVIVED を要求しない。
4. D2 純粋関数を追加し、既存の段階表・fixture・設計記述を修正する。実装・対象テストが成功した後に、AC10 の意味不変対照、意味変異の順で検証する。
5. 対象テストを通した後、節目の全 API テストと必須静的検査を実行する。検収は §7 の項目ごとに実行する。

#114 が同等ファイルを移動した場合は移動先へ対応付けて報告する。新しい業務仕様や永続データの変換が必要なら、局所修正として無断で追加しない。

## 7. 受け入れ条件と実行方法

API の test script は `node --import tsx --test tests/*.test.ts`。個別実行はリポジトリルートから `node --import tsx --test apps/api/tests/<ファイル名>.test.ts` とする。テストでは `node:assert/strict` の完全一致を基本とし、戻り値配列・オブジェクトは `deepEqual` で確認する。

- [ ] **AC1: 全 36 コード** — classifier テストを実行し、§3.2 の明示的な期待値全件に対し `{ kind: 'classified', category: ... }` が完全一致する。期待値は実装表を import・反転・走査して作らず、10 / 11 / 15 件の固定集合を独立に記述する。
- [ ] **AC2: 解除・未対応** — `00` は `{ kind: 'release' }`、`42`, `45`, `46`, `47`, `99`, `01`, `11`, `28`, `30`, `31`, `34`, `40`, `41`, `44`、空文字、`2`, `0`, `002`, ` 02 `, `０２`, `2e0`, `toString`, `__proto__` は `{ kind: 'unsupported' }` と完全一致する。category が紛れ込まない。既知コードを複数回呼んでも結果が一致する。
- [ ] **AC3: C3 の正しい段階表** — reducer テストで §4 の全 24 エントリーの phenomenonKey / telegramType / level を独立した期待値と完全一致で比較し、VPWW61 の既存 10 エントリーも変わっていないことを確認する。
- [ ] **AC4: 7 現象の強化・緩和** — §4 の各行について存在する隣接段階の全遷移を正方向で `strengthened`、逆方向で `weakened` として実行する。計 17 組の往復について、phenomenonKey / before / after を含む配列が完全一致する。最上段から最下段と逆方向の直接遷移も 7 現象で確認する。LastKind を使うケースは実際の直前コード・名称を入れる。
- [ ] **AC5: D2 と C3 の意味整合** — C3 の全 34 対応コードを分類関数に渡し、それぞれが独立した期待 category と完全一致することを確認する。AC1 の固定期待表と C3 の対応キー集合を照合してよいが、期待 category を C3 の level や D2 の実装表から生成しない。大雨 `10→03→43→33` は `question→question→emergency→emergency`、強風 `15→05→35` は `warning→question→emergency` となり、同じ区分内でも AC4 の強化・緩和が消えない。D3 の通知生成は実装しない。
- [ ] **AC6: 現況構成の既存契約** — reducer / processor テストを実行し、新規・継続・解除、同時刻競合、LastKind 矛盾、未知コード・未知状態での現況保持、集約と個別の合成が通る。fixture の名称・コードの訂正で元の検証目的を失っていない。
- [ ] **AC7: 保存済み現況からの更新** — 一時 DB に公式 Code=10 の大雨注意報を保存して接続を閉じ、再接続後 Code=03 の新しい電文を処理する。`strengthened` と原文コード・名称を含む現況が完全一致する。Code=33 から 03 の保存済み状態では `weakened`。新規 DB の通常更新だけで代用しない。
- [ ] **AC8: 復旧と同一版** — 一時 DB の原文から現況を復旧し、2 回目の復旧も最終現況・sourceVersion・既存履歴件数が同一となる。受信履歴と通知出力履歴を増加・書換えしない。同一版の既存保存済みスナップショットを持つ場合も検証する。ネットワーク取得は起こさない。
- [ ] **AC9: #114 統合境界** — `node --import tsx --test apps/api/tests/jmaWarningCurrentProcessor.test.ts` を実行し、§5 の 2 会場 × 3 controlStatus の更新・保持・再構築回帰が成功する。会場・状態を明示して読み出した 6 組を完全一致で確認し、normal の復旧戻り値だけで済ませない。D2 自体は訓練属性を受け取らず通知も作らないため、`isTraining` を新設・変換しない。availability の 3 状態の既存契約を変更しない。
- [ ] **AC10: red と対照実験** — 実装・対象テストが成功した状態を確認してから、テストごとの対象実装を意味を変えないコメント追加等で変更し、同じ対象コマンドが成功（SURVIVED）することを確認する。その変更を戻した後、D2 の `10` を `emergency` に変更、未知コードを `warning` に変更、`00` を分類対象に変更、C3 の `10/33` の level を旧値に戻す変異をそれぞれ加え、関連 AC が失敗（KILLED）することを確認する。保存/復旧の新規回帰には level 逆転や対象更新の抑止等、そのアサーションが検出すべき変異を当てる。コンパイル失敗だけを red と数えない。各変異を元へ戻して成功させ、変更点・コマンド・結果を報告する。未実装時の失敗をこの対照実験・ミューテーション判定に流用しない。
- [ ] **AC11: 節目検証** — `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が成功する。今回 shared/web は変更しないため、それらの workspace テストを追加実行する必要はない。
- [ ] **AC12: 変更境界** — `git diff --stat` と `git status --porcelain` で変更が §6 と承認済みの設計書に収まり、#114 作業場所・既存 migration・稼働 DB への変更がない。一時ファイルと一時 DB を片付ける。

実際のコードはまだ修正しておらず、本設計に対する新規テスト・ミューテーション・復旧動作は **実挙動未確認**。AC9 の呼出しシグネチャと保存・復旧境界は #114 マージ後の実装と照合済み。実行による検証は製造・検収で行う。

## 8. 後続 Issue への引継ぎ

- **D3**: 変更後のコードを分類する。緩和を一律 warning にせず、解除通知は §7.5 のルールで別途 warning とする。同一区分でも強化・緩和を通知対象とする。分類関数の `release` をすべての解除の検出器として使わない。
- **D4**: 新規・継続・訂正・取消・初期取得の通知要否と重複防止、原文 Status の解釈、訓練フラグ伝播を所有する。未知コードを default の低区分へ流さない。未対応の記録・監視方法は D2 にログ副作用を足す形ではなく呼出側で設計する。
- **D1 / #103**: 分類結果の category を後続の通知生成で共有型へ渡す。D2 は sourceType、notificationId、summary、ackRequired 等を補完しない。
- **C3**: 内部比較 level は気象庁警戒レベル・通知区分と別概念。今後のコード追加は公式資料と対象電文の照合を行い、C3 と D2 の対応範囲を区別する。

## 9. 要確認事項・残留リスク

追加の業務判断を要する事項は現時点でない。#114 のマージ後差分は確認済みで、製造前には本設計の承認が必要。

- #130 は `apps/api/tests/jmaXmlPolling.test.ts` の `freshnessPolicy` 重複キーとして報告された既存不具合で、D2 の修正範囲外。統括の限定確認では shared のビルド後に `npm run typecheck -w apps/api` と対象ファイルの ESLint が成功しており、現行 lint/typecheck の阻害とは扱わない（API の型検査は tests を対象に含めない）。この確認では全 API テストは未実施。必須検証に失敗した場合、既存原因として切り分けても AC11 を合格扱いにせず、統括へ結果と阻害範囲を報告する。
- 公式資料と提供サンプルは Git 管理外で、リモート製造環境では閲覧できない可能性がある。本文の固定表と出典を使用し、資料を確認できたと偽らない。
- 稼働済み DB に誤った手製 fixture が投入されているかは未確認。コードの機械置換・履歴の上書きは行わず、必要なら別途対象を特定して統括へ報告する。
