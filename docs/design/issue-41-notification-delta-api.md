# Issue #41「E9. 通知用API（起動時現況取得・通常ポーリング用差分取得）」設計

対象Issue: [E9 #41](https://github.com/BlueKurage119/wx-viewer-poc/issues/41)
前提Issue: D1 #25 / D4 #28 / D5 #29 / D1-1 #103 / D6 #30 / D10 #145（いずれもCLOSED、実装済み）

---

## 1. 目的と範囲

### 1.1 対象

1. 既存 `POST /api/notifications/startup`（D5 #29）の 200 応答に、サーバー発番の**通知cursor**を追加する。エンドポイントは新設せず、既存応答へ項目を1つ足すだけとする。
2. 通常ポーリング用の**新着通知差分エンドポイント**を新設する。クライアントは起動応答で得たcursorを渡し、「cursor以降」の新着通知を受け取る。
3. 起動応答（現況の再提示）と通常差分（B4の検知事実）を、フロント側の**共通通知store**へ同一の型で合流させるためのデータ契約（`NotificationFeedItem` と変換関数）を `packages/shared` に定義する。
4. `origin` / `detectionContext` の2軸を独立に配信し、H端末側の表示除外が行われてもcursorが停止しないことを保証する（AD-H069）。

**実装範囲はAPI側（`apps/api` + `packages/shared`）に限る。** 差分APIを呼ぶweb側のfetch関数・ポーリングループ・storeはH2 #64 で実装し、E9では作らない（確定事項9、§8・§1.2）。

### 1.2 対象外（この設計では扱わない）

| 項目 | 扱い |
| --- | --- |
| **AD-H006 202/通信再試行** | **E9のAPI設計対象外。** startup APIが202または処理未完了を返す挙動は既存D5仕様を維持するだけとし、クライアント側の自動再試行間隔・打切り・失敗表示はUI側（Epic H、H2 #64）の設計に委ねる。統括担当のヒアリング（本設計の前提3）で確定済み。 |
| **AD-H007 system・竜巻の起動通知と速報通常通知** | **D10 #145 で解消済み、E9のスコープ外。** VPBS50/VPHW の通常通知生成と起動再提示の対象は #145 で確定・実装済みであり、E9は #145 が `notification_output_history` へ書いた行をそのまま配信する。E9で対象種別を追加・除外しない。 |
| **AD-H022 ブラウザ疎通異常** | **E9スコープ外、後続の別Issueで検討。** 「後続へ残す」ことが承認済み（2026-09-13）の未決事項。サーバー側の取得健全性（origin=system の通知）とブラウザ⇔APIサーバー間の疎通断は別概念であり、後者の表現はH2 #64 / G9 #60 / K8 #81 側で定義する。E9のAPIは疎通断を通知として合成しない。 |
| **AD-H068 system操作系メッセージの発生源** | **E9スコープ外、後続の別Issueで検討。** 「後続へ残す」ことが承認済み（2026-09-13）。E11 #43 の取得操作eventと D7 の `fetch_health` 状態遷移の分離は E11 側で判断する。E9は現在B4に存在するsystem通知（`sourceType='fetch_health'`）だけを配信し、操作系メッセージを生成しない。 |
| 通知判定ロジック本体（Epic D） | 変更しない。E9はB4の読み出しと配信のみを行う。 |
| E10 #42（監視画面向けAPI・履歴検索・直近一覧） | 別責務。E9は「cursor以降の新着」だけを返し、履歴一覧・ページング・検索条件は持たない。 |
| 通知UI・鳴動・確認/スヌーズ・受領監視 | H系。E9は `ackRequired` を運ぶだけで確認状態を持たない。 |
| **差分APIのwebクライアント（fetch関数・ポーリングループ・store）** | **E9対象外、H2 #64 で実装する。** E9はAPI（`apps/api`）と共通型（`packages/shared`）のみを実装する。`apps/web` への変更は §8 の型ガード1行に限る。統括担当のヒアリングで確定済み（確定事項9）。 |
| **端末モード（H / K）による配信内容の出し分け** | **E9では行わない。** 配信APIは `terminalMode` を条件に使わず、会場スコープに合致する通知を全件返す。装置異常系・`venueScope==='unresolved'` の表示除外はH側アプリの責務（確定事項8、§4.2・§7）。 |
| 起動時の警報出力権（`startup_warning_claim`） | 既存D5ロジックを一切変更しない。差分エンドポイントは `recordTerminalSessionInquiry` も `claimStartupWarning` も呼ばない。 |

---

## 2. 参照資料と判断根拠

### 2.1 参照資料

- `docs/basic-design.md` §7.3（通知用データの実装済み契約・「保存summaryを機械的に再解析しない」）、§7.7（D5確定仕様・pull方式・warning出力権はサーバー起動世代×会場でat-most-once）、§8.1（履歴は自動削除・自動ローテーションを行わない）
- `docs/issues-draft.md` E9セクション（管理ID: AD-H005, AD-H006, AD-H007, AD-H022, AD-H024, AD-H066, AD-H068, AD-H069）
- `docs/audit-epic-a-d.md` AD-H005 / AD-H006 / AD-H007 / AD-H022 / AD-H024 / AD-H066 / AD-H068 / AD-H069、および AD-D004・AD-D011・AD-D014・AD-D015
- `docs/design/issue-29-startup-notification-api.md` §3・§10（#41への引き継ぎ）
- `docs/design/issue-145-bulletin-notification-coverage.md` §7（E9への引継ぎ契約）
- `docs/design/issue-8-notification-output-history.md`（B4の追記ログ性）、`docs/design/issue-10-retention-policy.md`（自動削除なしの検証済み契約）

### 2.2 統括担当から渡されたヒアリング確定事項

| # | 確定事項 | 本設計での反映箇所 |
| --- | --- | --- |
| 1 | cursor/sequence方式を採用。サーバー発番のsequence番号。会場別/グローバルの別・採番タイミング・永続化は設計裁量。startup応答にも同じsequence値を含める。既存warning出力権ロジックに影響を与えない | §4（グローバル単調増加sequence、B4の `id` を流用）、§5.1（startup応答への `cursor` 追加）、§5.2 |
| 2 | 通常ポーリングAPIはcursor以降の新着通知を**件数上限なく全件**返す。B4準拠の無期限cursor探索のみを担当（I1・E10とは別責務） | §5.2（`limit` パラメータを設けない）、§9 AC6、§11 残留リスク |
| 3 | 202/通信再試行（AD-H006）はE9のAPI設計対象外。既存D5の202挙動を維持するのみ | §1.2、§5.1 |
| 4 | 通常ポーリングAPIのレスポンスにはB4保存済みの確定済み `summary` をそのまま含める。加えて監査・デバッグ用に定義IDと版番号を併記する。保存summaryを機械的に再解析しない・過去履歴を書き換えない | §6.1、§6.2、§9 AC7 |
| 5 | `origin` と `detectionContext` は独立軸。H端末側は `origin` のみで表示除外し、対象外の通知でもcursorは進行させる。生成・保存自体は種別を問わず共通 | §4.3、§6.3、§9 AC5 |
| 6 | AD-H007はD10で解消済み、AD-H022・AD-H068は後続へ残す承認済み。いずれもE9では扱わず記録のみ | §1.2 |
| 7 | **起動通知・通常差分ともに、H側は `summary` 文字列を1本のまま表示する。** `title` / `target` / `content` の3要素へ分解した表示は行わない。B4側（Epic D）の保存構造は変更しない。E9のレスポンス仕様（`summary` を1本の文字列として運ぶ）は現状どおり維持する | §6.2、§6.3、§9 AC7・AC10、§11 |
| 8 | **`venueScope==='unresolved'` の通知は、従来どおり全会場・全端末へ配信し、WARNログを残す。** 配信API（E9）は `terminalMode`（H / K）による絞り込みを**一切行わない**。装置異常系を含む表示除外は、H端末側アプリが `origin` と同様の仕組みで行う | §4.2、§5.2、§7、§9 AC4・AC5、§10 |
| 9 | 差分APIの `apps/web` 側フェッチ関数・ポーリングループ・storeは**E9に含めない**。E9はAPI（`apps/api` + `packages/shared`）のみを実装し、web側はH2 #64 で実装する | §1.1、§1.2、§8、§9 AC12、§10 |

**確定事項8の位置づけ（基本設計 §8.4 との関係）**: 基本設計 §8.4 には「装置異常系の通知はH端末モードで表示除外、K端末モードで表示。フィルタリング実装位置（フロント側／配信APIのクエリ側）は実装時に定める」という未決の論点があった。E9では**「配信APIのクエリ側では絞り込まない」**と決定した。`unresolved` な通知もWARNログを残したうえで全会場・全端末へ配信し、表示除外はH側アプリのフィルタリングロジック（`origin` 等と同様の仕組み）に委ねる。

### 2.3 現行実装調査からの判断根拠

実コードを読んで確認した事実（コミット `1ecacf2` 時点）と、そこから導いた判断を示す。

| 確認した実物 | 事実 | 導いた判断 |
| --- | --- | --- |
| `apps/api/migrations/0011_create_notification_output_history.sql` | `id INTEGER PRIMARY KEY`（rowid別名、AUTOINCREMENTなし）。`notification_id` はUNIQUE。自動削除trigger・TTLなし | 追加のsequence列・migrationを新設せず、`id` をそのままサーバー発番sequenceとして使う（§4.1） |
| `docs/design/issue-10-retention-policy.md` §3・§4、`apps/api/tests/retentionPolicy.test.ts` | B4は追記ログで、リポジトリ層に更新・UPSERT・期間削除がなく、自動削除triggerもないことが検証済み | 無期限cursor探索が成立する。rowid再利用のリスクは「将来、手動削除経路を実装した場合」に限られる（§4.1・§11） |
| `apps/api/src/repositories/notificationOutputHistoryRepository.ts` の `deleteNotificationOutputHistory` | 呼出し元は同リポジトリのテストのみで、製造コードから呼ばれていない | 同上。引き継ぎ事項として §10 に明記する |
| `apps/api/src/notifications/warningNotificationPlanner.ts` L120-133 | D4の通知は `targets=[{kind:'area', codeType:'jma_municipal_warning_area', code:<市町村コード>}]`、`relatedRefs` に会場refを持たない | 会場解決は市町村コードと `VENUE_FORECAST_TARGETS[*].warning.municipalCode` の突合で行う（§4.2） |
| `apps/api/src/notifications/bosaiBulletinNotificationPlanner.ts` L171-182 | D10の速報通知は `targets=[{kind:'area', codeType:'venue', code:<venueId>}]`、`relatedRefs` に `{type:'venue', ref:<venueId>}` を持つ | `codeType==='venue'` を会場解決の最優先ルールにする（§4.2） |
| `apps/api/src/notifications/fetchHealthNotificationPlanner.ts` L204-214 | D7のsystem通知は `targets=[{kind:'equipment', codeType:'wx-viewer-poc/fetch-source', ...}]` で会場情報を持たない | 装置系は会場非依存（global）として全会場へ配信する（§4.2） |
| `packages/shared/src/terminalConfig.ts` L12-17 | 台帳は east/trc それぞれにH端末（`hkeagh01`・`htrcph01`）とK端末（`kkeagh01`・`ktrcph01`）を持ち、`TerminalDefinition.mode` で区別できる | 端末モードでの出し分けを**しない**ことを、既存台帳のH/K対でそのまま検証できる（§9 AC4(e)）。台帳の変更は不要 |
| `packages/shared/src/venueForecastTargets.ts` | east=1310800（江東区）、trc=1311100（大田区）で市町村コードは重複しない | 市町村コード突合で会場が一意に決まる。ただし将来同一コードの会場が増えても壊れないよう、解決結果は会場の配列とする |
| `packages/shared/src/notificationMessageDefinitions.ts` L443-451 | B4の `summary` は `title` / `target` / `content` を `\n` で連結した**1本の文字列**。3要素個別の値はB4に保存されていない。レジストリは現行版のみを保持し、過去版の定義本文を持たない | 通常差分APIは `summary` を1本の文字列として配信する。`\n` で機械的に3分割することは §7.3 の「保存summaryを機械的に再解析しない」に反するため行わない（§6.2）。起動通知は3要素を持つが、**H側は起動・通常ともに `summary` を1本のまま表示する**ことが確定したため（確定事項7）、配信データの粒度差は表示上の不整合にならない |
| `apps/api/src/notifications/startupNotificationService.ts` L106-155 | 起動応答の生成は `connection.transaction(...).immediate()` の内側で、現況投影・claim・監査INSERTを一括して行う。監査表には応答JSON全体が保存される | cursorの採番も同じimmediate transaction内で行えば、現況投影とcursorの整合が保証される（§5.1）。監査表のスキーマ変更は不要 |
| `apps/api/src/app.ts` L163-192 | startupは `req.is('application/json')` → `parseStartupNotificationRequest`（key数厳密一致）→ `resolveTerminalDefinition` → 200/202/400/404/500 の順 | 差分エンドポイントも同じ検証順序・同じエラーbody形（`{status:'error', code}`）に揃える（§5.2） |
| `apps/web/src/api/startupNotifications.ts` L33-40 | 応答の型ガードは `status==='ready'` と `notifications` が配列であることだけを見る緩い判定 | `cursor` 追加で既存webは壊れないが、cursor欠落を検知できないため型ガードに `cursor` の検査を1行追加する（§8） |

**better-sqlite3 は同期API・Node.jsはシングルスレッド**であるため、HTTPハンドラの処理中に他のポーリング処理がB4へINSERTを割り込ませることはない。したがって「cursor採番と現況投影の間の欠落」は現構成では発生しない。ただし将来非同期化した場合に備え、**採番は投影より先に行い、欠落よりも重複を選ぶ**方針を §5.1 に明記する。

---

## 3. 全体像

```text
[端末起動]
  POST /api/notifications/startup   ──> 200 { ..., notifications:[現況再提示], cursor:"1234" }
                                          （202 initializing のときcursorは返らない＝ready到達まで差分に進めない）
        │
        ├─ 起動通知を共通store へ投入（キー: startup:<outputId>）
        └─ cursor="1234" を保持
                │
[通常ポーリング（8.3の周期でH側が駆動）]
  GET /api/notifications/delta?terminalId=hkeagh01&cursor=1234
                                    ──> 200 { notifications:[B4の新着], cursor:"1240", skippedCount:0 }
        │
        ├─ 差分通知を共通store へ投入（キー: delta:<notificationId>）
        └─ cursor="1240" を次回要求へ
```

- 起動応答は**現況の再提示**であり、通知IDは `outputId`（問い合わせごとの出力識別）。
- 通常差分は**B4が永続化した検知事実**であり、通知IDは `notificationId`。
- 両者のIDを混同しない（#29 §10・#145 §7 の引継ぎ契約）。共通storeでは `feedKey = "<source>:<id>"` で名前空間を分ける（§6.4）。

---

## 4. cursor / sequence の設計（AD-H005・AD-H066・AD-H069）

### 4.1 採番方式

**グローバル（会場をまたいで単一）な、サーバー発番の単調増加整数**を採用する。実体は `notification_output_history.id`（SQLiteのrowid別名）をそのまま用いる。

- **採番タイミング**: B4へのINSERT時、すなわちD4/D7/D10が通知事実を永続化した瞬間。E9は採番しない。
- **永続化**: B4の行そのもの。追加テーブル・追加列・追加migrationは不要。
- **会場別にしない理由**: 会場別に採番するには書込み経路（Epic D）へ会場列を足す必要があり、「通知判定ロジック自体は変更しない」というIssueの範囲外条件に反する。グローバル採番＋読み出し時の会場フィルタなら、書込み経路を一切触らずに済む。会場でフィルタして落ちた行があってもcursorは最大値まで進めるため（§4.3）、会場ごとの進行が互いを阻害することはない。
- **単調性の根拠**: B4は追記ログで、製造コードからの削除経路が存在しない（§2.3）。better-sqlite3 は同期で書込みが直列化されるため、HTTPハンドラが「途中まで採番された一括INSERT」を観測することはない。
- **有効範囲**: cursorはDBファイルに紐づく。`serverGenerationId`（プロセス起動世代）とは無関係であり、サーバー再起動をまたいでも有効である。**`serverGenerationId` をcursorの代用にしない**（#29 §10）。

### 4.2 会場スコープの解決（読み出し時）

B4の行には会場列がないため、保存済み `targets` から会場適用範囲を導出する。解決規則は上から順に評価する。

| 順 | 条件 | 結果 |
| --- | --- | --- |
| 1 | `targets` に `codeType === 'venue'` の要素があり、その `code` が有効な `VenueId` である | `{ kind:'venue', venueIds:[該当会場] }`（D10の速報通知） |
| 2 | `targets` に `codeType === 'jma_municipal_warning_area'` の要素があり、その `code` に一致する `VENUE_FORECAST_TARGETS[*].warning.municipalCode` が1つ以上ある | `{ kind:'venue', venueIds:[一致した全会場] }`（D4の警報・注意報通知） |
| 3 | `targets` の全要素が `kind === 'equipment'` である | `{ kind:'global' }`（D7の装置異常系通知。全会場へ配信） |
| 4 | 上記のいずれにも当たらない（未知の `codeType`、`targets` が空/null、JSONとして解釈できたが規約外） | `{ kind:'unresolved' }` |

**`unresolved` の扱い（確定事項8）**: 配信から除外せず**全会場・全端末へ配信**し、応答項目 `venueScope: 'unresolved'` を添えてサーバーログへ WARN を出す。防災用途では「余分に出す」より「黙って落とす」ほうが危険であるため、欠落より過剰を選ぶ。

- **配信API（E9）は `terminalMode`（H / K）による絞り込みを一切行わない。** 要求端末がH端末かK端末かに関わらず、`global` と `unresolved` は同一の内容で返る。
- 表示除外はH側アプリの責務であり、`origin` と同様のフィルタリング仕組みで `venueScope==='unresolved'` を扱う（§7・§10）。E9はH側が判断できるよう `venueScope` を応答に載せるところまでを担う。
- 装置異常系（`global`）についても同じ方針である。基本設計 §8.4 の「H端末モードで表示除外」はフロント側で実現し、配信APIのクエリ条件には入れない（§2.2 の補足）。

**行の変換に失敗した場合**（`target_area_json` / `related_refs_json` がJSONとして壊れている等、DTOを組み立てられない場合）は、その行だけ配信から除外し、`skippedCount` を1増やしてERRORログを出す。**cursorは進める**（1行の破損で端末の通知受信が永久に止まることを防ぐ）。

### 4.3 cursorの進行規則（AD-H069）

応答の `cursor`（次回要求に渡す値）は、**要求cursorより後ろで走査したB4の最大sequence**とする。すなわち応答時点のB4の `MAX(id)` である。

- 会場フィルタで落ちた行、`skippedCount` に計上した行があっても、cursorはそれらを**越えて**進む。
- サーバー側では `origin` / `detectionContext` による除外を**行わない**。H端末側が `origin` のみで表示除外する（AD-H069の確定方針）。サーバーが除外しないので、H側の除外がcursorに影響する余地がそもそも無い。
- `detectionContext`（`normal` / `initial`）は**検知文脈であって端末起動の意味ではない**。`initial` を `system` 扱いして除外してはならない（AD-D015・AD-H069）。この注意書きを応答型のTSDocに書く。
- 新着0件でも `cursor` は返す（現在の `MAX(id)`）。クライアントは常に応答の `cursor` で上書きする。

### 4.4 cursorのHTTP上の表現

- 10進整数の文字列（例 `"0"`、`"1234"`）。JSON数値ではなく文字列にして、将来採番方式を変えても型を変えずに済むようにする。
- 受理パターン: `^(0|[1-9][0-9]{0,15})$`。前ゼロ・符号・空白・16桁超はすべて `invalid_request`。
- B4が空のとき `MAX(id)` は `"0"` とする。
- 要求cursorが現在の `MAX(id)` を超える場合（DBファイル差し替え・別環境のcursor流用）は新着を返さず `cursor_out_of_range` を返す（§5.2）。クライアントは起動APIからやり直す。

---

## 5. API契約

### 5.1 `POST /api/notifications/startup`（既存・cursor追加のみ）

200（ready）応答に `cursor` を1項目追加する。それ以外の挙動・型・監査・claimロジックは**一切変更しない**。

```ts
// packages/shared/src/startupNotification.ts（既存型へ1項目追加）
export interface StartupNotificationReadyResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  readonly session: { readonly kind: TerminalSessionInquiryKind; readonly firstInquiredAt: UtcIso8601String };
  readonly warningClaimed: boolean;
  readonly notifications: readonly StartupCurrentNotification[];
  /** 通常差分の開始位置。この値を GET /api/notifications/delta の cursor に渡す。 */
  readonly cursor: NotificationDeltaCursor; // 追加
}
```

- 採番位置: `createStartupNotificationService` の `connection.transaction(...).immediate()` の**内側**で、`projector(...)` を呼ぶ**直前**に `findMaxNotificationOutputSequence(connection)` を評価する。投影より先に採番することで、将来非同期化しても「欠落」ではなく「重複（起動再提示と差分の両方に同じ事象が出る）」側に倒れる。
- 202（initializing）応答は**変更しない**。cursorも返さない。したがってクライアントはready到達まで差分ポーリングを開始できない。202後の再試行方針はH2 #64（AD-H006、§1.2）。
- 監査表 `startup_notification_inquiry` の `response_json` には応答全体が保存されるため、cursorも自動的に記録される。**スキーマ変更は不要**。
- `warningClaimed` の判定、`claimStartupWarning`、`recordTerminalSessionInquiry` の呼出し条件は変更しない（確定事項1）。

### 5.2 `GET /api/notifications/delta`（新設）

```text
GET /api/notifications/delta?terminalId=<端末ID>&cursor=<10進整数文字列>
Cache-Control: no-store
```

- **GETを選ぶ理由**: 副作用がない読み出しであるため。差分取得は端末セッションを記録せず、警報出力権を消費しない。`POST /api/notifications/startup` と役割が明確に分かれる。
- クエリキーは `terminalId` と `cursor` の2つのみ。未知キー・重複キー（配列化）・欠落は `invalid_request`（`parseStartupNotificationRequest` のkey数厳密一致と同じ厳しさに揃える）。
- `limit` / `since` / `origin` / `category` などの絞り込みパラメータは**設けない**（確定事項2・5）。件数上限なく `cursor` 以降を全件返す。
- 端末モード（`H` / `K`）で拒否しない。**また、端末モードによる通知の絞り込み（装置異常系や `venueScope==='unresolved'` の除外）も行わない**（確定事項8）。同一会場のH端末とK端末が同じcursorで呼べば、応答の `notifications` は完全に一致する。表示除外はH側アプリの責務である（§7）。起動APIがH/Kを区別しないのと揃える。

**200（ready）**

```ts
export interface NotificationDeltaReadyResponse {
  readonly status: 'ready';
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly serverGenerationId: string;
  readonly generatedAt: UtcIso8601String;
  /** 次回要求に渡す値。要求 cursor 以上で、走査した B4 の最大 sequence。 */
  readonly cursor: NotificationDeltaCursor;
  /** sequence 昇順。会場スコープ外の行は含まない。 */
  readonly notifications: readonly NotificationDeltaItem[];
  /** DTO を組み立てられず配信から除外した行数。cursor は進んでいる。 */
  readonly skippedCount: number;
}
```

**エラー**

| HTTP | body | 条件 |
| --- | --- | --- |
| 400 | `{status:'error', code:'invalid_request'}` | クエリキーの過不足・重複、`terminalId` が空、cursorがパターン不一致 |
| 404 | `{status:'error', code:'terminal_not_found'}` | `resolveTerminalDefinition` が null |
| 409 | `{status:'error', code:'cursor_out_of_range', cursor:<現在のMAX(id)>}` | 要求cursor > 現在の `MAX(id)`。クライアントは起動APIからやり直す |
| 500 | `{status:'error', code:'notification_delta_failed'}` | 想定外例外 |

`initializing`（202）に相当する状態は差分側には設けない。差分はB4の読み出しのみで、初期取得の完了可否に依存しないためである。

---

## 6. 型定義とモジュール構成

### 6.1 `packages/shared/src/notificationDeltaCursor.ts`（新規）

`startupNotification.ts` と `notificationDelta.ts` の双方から参照されるため、循環importを避けて最小モジュールに切り出す。

```ts
declare const notificationDeltaCursorBrand: unique symbol;
export type NotificationDeltaCursor = string & {
  readonly [notificationDeltaCursorBrand]: 'NotificationDeltaCursor';
};

export const NOTIFICATION_DELTA_CURSOR_PATTERN: RegExp; // /^(0|[1-9][0-9]{0,15})$/
export function isNotificationDeltaCursor(value: unknown): value is NotificationDeltaCursor;
/** 非負の安全整数以外は例外。無検証キャストの唯一の代替経路。 */
export function toNotificationDeltaCursor(sequence: number): NotificationDeltaCursor;
export function notificationDeltaCursorToSequence(cursor: NotificationDeltaCursor): number;
```

### 6.2 `packages/shared/src/notificationDelta.ts`（新規）

```ts
export type NotificationDeltaVenueScope = 'venue' | 'global' | 'unresolved';

export interface NotificationDeltaItem {
  /** B4 の id。cursor と同じ採番空間。 */
  readonly sequence: number;
  /** B4 の notification_id。起動応答の outputId とは別空間。 */
  readonly notificationId: string;
  readonly category: NotificationCategory;
  /** H 端末はこの値だけで表示除外を判断する（AD-H069）。 */
  readonly origin: NotificationOrigin;
  /** サーバー検知の文脈。端末起動の意味ではない。表示除外の判断に使わない。 */
  readonly detectionContext: NotificationDetectionContext;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly changeType: string;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly venueScope: NotificationDeltaVenueScope;
  readonly output: {
    readonly ackRequired: boolean;
    /** B4 に保存された確定済み文面をそのまま運ぶ。改行で機械的に再分割しない。 */
    readonly summary: string;
    /** 監査・デバッグ用。この id/version で文面を再解決してはならない。 */
    readonly messageDefinition: NotificationMessageDefinitionRef | null;
  };
}

export interface NotificationDeltaRequest {
  readonly terminalId: string;
  readonly cursor: NotificationDeltaCursor;
}

/** HTTP クエリの構造だけを検証する。端末台帳の照合は API 側で行う。 */
export function parseNotificationDeltaQuery(query: unknown): NotificationDeltaRequest | null;

export interface NotificationDeltaReadyResponse { /* §5.2 のとおり */ }
export type NotificationDeltaErrorResponse =
  | { readonly status: 'error'; readonly code: 'invalid_request' | 'terminal_not_found' | 'notification_delta_failed' }
  | { readonly status: 'error'; readonly code: 'cursor_out_of_range'; readonly cursor: NotificationDeltaCursor };
```

**表示3要素の配信方式（AD-H024・確定事項4）**

- B4に保存されているのは1本の `summary`（`title` / `target` / `content` を `\n` で連結したもの）だけで、3要素の個別値は保存されていない（§2.3）。
- したがって通常差分APIは `summary` をそのまま1本の文字列として運ぶ。**`\n` での分割・正規表現抽出・レジストリによる再解決は行わない**（基本設計 §7.3「保存summaryを機械的に再解析しない」）。
- `messageDefinition`（ID・版番号）は**監査・デバッグ目的でのみ**併記する。後日定義を変更しても過去履歴は書き換わらず、`messageDefinition` から文面を再構成する経路も設けない（同 §7.3「後日定義変更しても過去履歴は書き換えない」）。
- `messageDefinition` は B4 のスキーマ上 null 許容であるため、DTOでも `| null` とする。
- `action`（確認ボタン）はB4に保存されていない。H側は `ackRequired === true` のときに固定ラベル「確認」を出す（`NotificationAcknowledgeAction` の定義どおり）。
- **H側の表示粒度（確定事項7）**: 起動通知・通常差分のいずれについても、H側は `summary` 文字列を**1本のまま**表示する。起動応答が持つ3要素（`title` / `target` / `content`）へ分解した表示は行わない。したがってE9のレスポンス仕様は現状どおりでよく、B4側（Epic D）の保存構造を3要素個別列へ変更する必要もない。H側の表示実装はH2 #64 の範囲であるが、この前提はH2へ引き継ぐ（§10）。

### 6.3 共通通知store合流の契約（AD-H005）

起動応答と通常差分をフロントの単一storeへ流し込むための正規化型と純関数を、`packages/shared/src/notificationFeed.ts`（新規）に置く。UI・状態管理・ポーリングループはH2 #64 の範囲であり、ここでは**データ変換の契約だけ**を確定する。

```ts
export type NotificationFeedSource = 'startup' | 'delta';

export interface NotificationFeedItem {
  /** `startup:<outputId>` または `delta:<notificationId>`。ID空間の混同を型で防ぐ。 */
  readonly feedKey: string;
  readonly source: NotificationFeedSource;
  /** delta のみ。startup（現況再提示）は null。 */
  readonly sequence: number | null;
  readonly category: NotificationCategory;
  readonly origin: NotificationOrigin;
  /** startup 応答は detectionContext を持たないので null。捏造しない（#145 §7）。 */
  readonly detectionContext: NotificationDetectionContext | null;
  /** startup 応答は changeType を持たないので null。 */
  readonly changeType: string | null;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  /** startup 応答は detectedAt を持たないので null。 */
  readonly detectedAt: UtcIso8601String | null;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly ackRequired: boolean;
  readonly summary: string;
  /**
   * startup のみ 3 要素を持つ。delta は null（B4 に個別値がない）。
   * 監査・将来利用のために運ぶだけであり、H 側の通知表示には使わない。
   * 表示は startup / delta ともに `summary` を 1 本のまま用いる（確定事項7）。
   */
  readonly display: NotificationDisplayMessage | null;
  readonly messageDefinition: NotificationMessageDefinitionRef | null;
  readonly venueScope: NotificationDeltaVenueScope | null;
}

export function toNotificationFeedItemFromStartup(n: StartupCurrentNotification): NotificationFeedItem;
export function toNotificationFeedItemFromDelta(item: NotificationDeltaItem): NotificationFeedItem;
/** feedKey で重複排除し、occurredAt → sequence（null 最後）→ feedKey の昇順で安定整列する。 */
export function mergeNotificationFeedItems(
  existing: readonly NotificationFeedItem[],
  incoming: readonly NotificationFeedItem[],
): readonly NotificationFeedItem[];
```

- 起動応答の `outputId` を通常差分の `notificationId` へ置き換えない。逆も行わない（#145 §7）。
- `sourceVersion` 単独で通知を統合しない。同じ版でも会場・注意/目撃が異なりうる（#145 §7）。VPHW50/51を同内容でまとめない。
- 通常検知の確認済み状態を理由に起動 `question` を抑止しない（#145 §7）。`mergeNotificationFeedItems` は `feedKey` 一致のみを重複とみなし、内容の類似では統合しない。
- **表示に用いるのは `summary` の1本の文字列だけである**（確定事項7）。`display` が非nullでも、H側の通知表示では参照しない。この前提により、`source` が `startup` か `delta` かでUIの構造分岐を作る必要がない。
- **`venueScope` はH側フィルタリングのための材料であり、サーバー側の絞り込み結果ではない**（確定事項8）。`unresolved` / `global` の項目もstoreへは通常どおり合流させ、表示するかどうかはH側のフィルタ層が `origin` と併せて決める。

### 6.4 API側モジュール

| ファイル | 役割 |
| --- | --- |
| `apps/api/src/notifications/notificationVenueScope.ts`（新規） | `resolveNotificationVenueScope(targets: readonly NotificationTarget[]): NotificationVenueScope` — §4.2 の解決規則。純関数、DB非依存 |
| `apps/api/src/notifications/notificationDeltaService.ts`（新規） | `createNotificationDeltaService(deps): NotificationDeltaService`。`query(input)` が §5.2 の200相当の結果、または `cursor_out_of_range` を返す |
| `apps/api/src/repositories/notificationOutputHistoryRepository.ts`（追記） | `findMaxNotificationOutputSequence(connection): number`（空なら0）、`listNotificationOutputHistoryAfter(connection, afterSequence: number): readonly NotificationOutputHistory[]`（`WHERE id > ? ORDER BY id ASC`、上限なし） |
| `apps/api/src/app.ts`（追記） | `dependencies.notificationDelta` があるときだけ `GET /api/notifications/delta` を登録する（既存の条件付き登録と同じ形） |
| `apps/api/src/server.ts`（追記） | サービス生成と `createApp` への受け渡し（既存 `startupNotifications` と同じ2箇所） |

```ts
export interface NotificationDeltaQueryInput {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly cursor: NotificationDeltaCursor;
  readonly requestedAt: UtcIso8601String;
}
export type NotificationDeltaQueryResult =
  | NotificationDeltaReadyResponse
  | { readonly status: 'cursor_out_of_range'; readonly cursor: NotificationDeltaCursor };

export interface NotificationDeltaService {
  query(input: NotificationDeltaQueryInput): NotificationDeltaQueryResult;
}

export interface CreateNotificationDeltaServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly serverGenerationId: string;
  readonly now?: () => UtcIso8601String;
}
```

処理手順（`query`）:

1. `findMaxNotificationOutputSequence` で現在の最大sequence `max` を得る。
2. 要求cursorの数値 `from` が `max` を超えていれば `{status:'cursor_out_of_range', cursor: toNotificationDeltaCursor(max)}` を返す。
3. `listNotificationOutputHistoryAfter(connection, from)` を昇順で取得する。
4. 各行を `resolveNotificationVenueScope` にかけ、`venue` かつ `venueIds` に要求会場を含まない行を除外する。`global` と `unresolved` は残す（§4.2）。
5. 残った行をDTOへ変換する。`target_area_json` / `related_refs_json` のJSON解析、`targets` 非空検証に失敗した行は除外し `skippedCount` を加算してERRORログ。
6. `cursor: toNotificationDeltaCursor(max)` を付けて返す。**除外した行数に関係なく `max` を返す**（§4.3）。

読み出しはすべて1回のHTTPハンドラ内で同期的に行う。書込みを伴わないため `transaction` は必須ではないが、手順1と手順3の間に整合を取るため **`connection.transaction(...).deferred()`（読み取りトランザクション）でまとめる**。

---

## 7. `origin` / `detectionContext` とH側フィルターの接続（AD-H069）

- サーバーは `origin` / `detectionContext` の値を**そのまま**運び、どちらでも配信を絞らない。
- H端末は `origin === 'weather'` のみを通知UIへ出し、`origin === 'system'` は現時点では表示しない（対象外種別）。この除外は**表示のみ**で、cursorは §4.3 のとおりサーバー側で進むため、systemばかり続いてもweatherの新着が遅延することはない。
- `detectionContext === 'initial'` は「サーバーが初期取得で検知した」ことを表す。**端末起動を意味せず、systemでもない。** これを除外条件に使うと、サーバー再起動直後の現況通知が丸ごと消える（AD-H069の「initialをsystem扱いする誤除外」）。型のTSDocとこの設計書の双方に明記し、受け入れ条件AC5で検証する。
- 通知の生成・B4への保存は種別を問わず共通のまま。E9は生成側に一切触れない。

**`venueScope` もH側フィルターの軸として扱う（確定事項8）**

- `venueScope === 'unresolved'`（会場を解決できなかった通知）および `venueScope === 'global'`（装置異常系）は、**配信API側では除外しない**。`terminalMode`（H / K）を条件に加えることもしない。
- H端末側の表示除外は `origin` と同じフィルタリング層で行う。すなわちH側は「`origin` で除外する」「`venueScope` で除外する」という2つの独立した除外規則を同じ仕組みの上に並べ、どちらも**表示のみ**に作用させる。
- したがって `unresolved` / `global` の項目が何件続いても、サーバー側のcursorは §4.3 のとおり最大sequenceまで進み、その後ろの表示対象通知が遅延することはない。これは `origin` による除外がcursorを止めないのと同じ構造である。
- 具体的な除外条件（`unresolved` をH端末で出すか否か、K端末での扱い）はH2 #64 で決める。E9は判断材料（`origin`・`detectionContext`・`venueScope`）を欠かさず運ぶことまでを責務とする。

---

## 8. web側の変更（最小）

E9で触るweb側は次の1点のみとする（確定事項9）。差分APIのfetch関数・ポーリングループ・store実装・UIは**すべてH2 #64 の範囲**であり、E9では実装しない。

- `apps/web/src/api/startupNotifications.ts` の `isReady` 型ガードに `typeof (value as {cursor?:unknown}).cursor === 'string'` を追加する。cursorを返さないサーバーに対して `ready` と判定してしまう事故（差分APIへ `undefined` を渡す）を防ぐ。

差分APIのfetchクライアント（`apps/web/src/api/notificationDelta.ts` 相当）は**E9では作らない**（確定事項9）。H2 #64 でポーリングループ・storeと一体で実装する。E9が提供するのは `packages/shared` の型・`parseNotificationDeltaQuery`・`toNotificationFeedItemFrom*` / `mergeNotificationFeedItems` までであり、H2はこれらを土台にfetch層を書く。受け入れ条件AC12はこの線引きを検証する。

---

## 9. 受け入れ条件

Node.js 24、既存のNode test runner / tsx を使う。時刻・UUID・端末IDは注入し、応答JSONは原則完全一致で検証する。

- [ ] **AC1 cursorの書式と検証**: `GET /api/notifications/delta` に対し、`cursor` 欠落 / `terminalId` 欠落 / 余剰クエリキー（例 `limit=10`）/ 同名キー重複（`cursor=1&cursor=2`）/ 空文字 / 前ゼロ `"01"` / 負数 `"-1"` / 小数 `"1.5"` / 17桁 / 全角数字 のすべてで、HTTP 400 と body `{"status":"error","code":"invalid_request"}` が完全一致で返る。`"0"` と `"1"` は受理される。未知 `terminalId` は 404 と `{"status":"error","code":"terminal_not_found"}`。
- [ ] **AC2 startup応答へのcursor追加**: B4に既存行を n 件仕込んで `POST /api/notifications/startup` を200で受けると、`cursor` が `"n"`（B4の `MAX(id)` の10進表現）と一致する。B4が空なら `"0"`。202（initializing）応答のJSONには `cursor` キーが存在しない。同じ問い合わせの `startup_notification_inquiry.response_json` をパースすると `cursor` が応答と一致し、監査表のスキーマは変わっていない（`PRAGMA table_info` の列一覧が変更前と同一）。
- [ ] **AC3 起動→差分の欠落と二重表示の防止**: (a) 起動応答で `cursor=C` を得た直後に差分を `cursor=C` で呼ぶと `notifications` が0件で、応答 `cursor` は `C`。(b) 起動応答の後にB4へ1件INSERTしてから差分を呼ぶと、その1件だけが返り、応答cursorが1増える。(c) 起動応答に含まれていた現況（B4上の既存行）が差分にも重複して現れない。(d) 差分を同じcursorで2回呼んでも結果が完全一致する（冪等）。
- [ ] **AC4 会場スコープ**: east端末とtrc端末で差分を呼び分け、(a) `codeType='venue'` の速報通知（D10形式）は該当会場の端末にだけ現れ `venueScope='venue'`、(b) `codeType='jma_municipal_warning_area'` で `code='1310800'` の警報通知はeast端末にだけ、`'1311100'` はtrc端末にだけ現れる、(c) `kind='equipment'` のsystem通知は両端末に現れ `venueScope='global'`、(d) 未知 `codeType` の行は両端末に現れ `venueScope='unresolved'` でWARNログが出る。いずれの場合も両端末の応答 `cursor` は同じ `MAX(id)` である。(e) **端末モードで出し分けないこと（確定事項8）**: 既存台帳の同一会場H/K端末（east: `hkeagh01` / `kkeagh01`、trc: `htrcph01` / `ktrcph01`。`packages/shared/src/terminalConfig.ts`）で同じ `cursor` で差分を呼ぶと、両者の応答JSONが `terminalId` を除いて**完全一致**する。とくに `venueScope='global'`（装置異常系）と `venueScope='unresolved'` の行がH端末の応答からも除外されていない。`terminalMode` を参照するコードが差分サービス・リポジトリ・ルーティングのいずれにも存在しないことをコード上でも確認する。
- [ ] **AC5 origin/detectionContextの2軸独立（AD-H069）**: `origin='system'` の行と `detectionContext='initial'` の行を交互に含む並びを用意し、差分応答に **4通りすべて**（weather×normal、weather×initial、system×normal、system×initial）がフィルタされずに含まれる。`origin='system'` の行を100件挟んでも、その後ろの `origin='weather'` 1件が同じ1回の呼出しで取得でき、応答cursorが最大sequenceまで進む。加えて、この検証をH端末・K端末の双方で実施し、**どちらの端末でも4通りすべてが返る**ことを確認する（配信API側で `terminalMode` による除外を行っていないこと。確定事項8）。
- [ ] **AC6 件数上限なし（確定事項2）**: B4に1000件の行を仕込み `cursor=0` で呼ぶと、会場スコープに合致する行が**全件**返る（切り捨て・`hasMore` 相当の項目が存在しない）。応答に `limit` 系パラメータを受け付けるコードがないことを、クエリキー余剰が400になること（AC1）で確認する。
- [ ] **AC7 表示3要素の配信方式（AD-H024・確定事項4）**: `summary` が `"大雨警報\n江東区\n詳細"` の行に対し、応答の `output.summary` が**改行を含む元の文字列と完全一致**し、`title` / `target` / `content` に相当する個別キーが応答に存在しない。`output.messageDefinition` が保存済みの `{id, version}` と完全一致する。`message_definition_id` が null の行では `output.messageDefinition` が null になる。レジストリの現行版を別版に差し替えたテスト用定義でも `summary` と `messageDefinition.version` が保存値のまま変わらない（過去履歴を書き換えない）。**H側が3要素へ分解しない前提（確定事項7）**の裏返しとして、`packages/shared` にも `summary` を分割・再構成するヘルパーが追加されていないことを確認する。
- [ ] **AC8 cursor_out_of_range と破損行**: (a) 現在の `MAX(id)` より大きいcursorで呼ぶと HTTP 409 と `{"status":"error","code":"cursor_out_of_range","cursor":"<現在のMAX>"}` が返り、`notifications` を返さない。(b) `target_area_json` を壊した行を1件挟むと、その行だけが除外され `skippedCount=1` になり、**その後ろの正常な行は返り**、応答cursorは最大sequenceまで進む（1行の破損で以後の配信が止まらない）。
- [ ] **AC9 副作用がないこと（確定事項1）**: 差分APIを任意回数呼んだ前後で、`terminal_session`、`startup_warning_claim`、`startup_notification_inquiry`、`notification_output_history` の全行数と内容が完全一致で不変である。差分呼出し後に同一sessionで起動APIを呼んでも `warningClaimed` の結果が差分呼出し前と同じである（出力権の消費タイミングが変わっていない）。
- [ ] **AC10 共通store合流の変換契約**: `toNotificationFeedItemFromStartup` と `toNotificationFeedItemFromDelta` の出力が、`feedKey` がそれぞれ `startup:<outputId>` / `delta:<notificationId>` になり、startup側は `sequence`/`detectedAt`/`detectionContext`/`changeType` が null、delta側は `display` が null になる。同じ気象事象に由来する起動項目と差分項目を `mergeNotificationFeedItems` に渡しても**統合されず2件のまま**残る（ID空間が別であるため）。同じ `feedKey` を2回渡すと1件に重複排除され、並び順が `occurredAt` → `sequence` → `feedKey` の昇順で安定する。また、**startup 由来・delta 由来のいずれも `summary` が非空文字列で埋まる**こと（H側が `display` を使わず `summary` だけで表示できること。確定事項7）を確認する。
- [ ] **AC11 HTTP実挙動**: 実サーバーを起動し、`Cache-Control: no-store` と `Content-Type: application/json; charset=utf-8` が付くこと、`GET /api/notifications/delta` が登録され `POST` では 404/405 相当になること、`/api/notifications/startup` と `/api/health` が従来どおり動くことを確認する。`dependencies.notificationDelta` を渡さずに `createApp` したときは差分エンドポイントが登録されない。
- [ ] **AC12 境界（作りすぎていないこと）**: 通知UI・鳴動・確認/スヌーズ・受領監視・再試行ループ・監視画面向けAPI（E10相当の履歴検索/一覧）・`origin` や `category` の絞り込みクエリ・`terminalMode` による絞り込み・新規migration・B4への列追加・Epic Dの通知生成コードの変更、のいずれも行っていない。**差分APIのwebフェッチ関数（`apps/web/src/api/notificationDelta.ts` 相当）・ポーリングループ・通知storeが追加されていない**（確定事項9、H2 #64 の範囲）。`git diff --stat` で変更ファイルが §6.4 と §8 に挙げたものに限られ、`apps/web` 配下の変更が `src/api/startupNotifications.ts`（およびその既存テスト）だけであること。
- [ ] **AC13 必須検証**: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web`、`npm run build` がすべて成功する。

### 9.1 red・対照実験

新規テスト完成前に、意味を変えないコメントだけの変更で対象テストが成功する対照実験を行う。その後、以下の変更を1つずつ入れて失敗（red）を確認し、都度戻す。

1. 応答cursorを「返した通知の最大sequence」に変える → AC4(d) / AC5 / AC8(b) が失敗する（会場外・破損行でcursorが停滞する）
2. サーバー側で `origin==='system'` を除外する → AC5 が失敗する
3. `summary` を `\n` で分割して3要素を組み立てる → AC7 が失敗する
4. 会場解決の規則1（`codeType==='venue'`）を削る → AC4(a) が失敗する
5. サーバー側で要求端末が H モードのとき `venueScope==='unresolved'`（または `'global'`）を除外する → AC4(e) / AC5 が失敗する（配信APIは端末モードで出し分けない。確定事項8）
6. startupのcursor採番を投影の**後**に移す → 現構成では結果が変わらないことを確認し、「同期実行のため差が出ない」ことを記録する（将来の非同期化時の注意として §11 に残す）

---

## 10. 後続Issueへの引き継ぎ

- **H2 #64（通知UI・共通store）**: 起動 → cursor保持 → 差分ポーリングのlifecycleを実装する。202/通信失敗時の再試行間隔・打切り・失敗表示はH2が決める（AD-H006、E9対象外）。`cursor_out_of_range`（409）を受けたら起動APIからやり直す。表示除外は **H側（フロントエンド）の責務**であり、`origin` を軸に行う。`detectionContext` を除外条件に使わない。`venueScope==='unresolved'` および `'global'`（装置異常系）の表示可否も、`origin` と同じフィルタリング層でH2が決める（確定事項8。配信API側は絞り込まない）。
  - **差分APIのfetch関数・ポーリングループ・通知storeはH2で新規に実装する**（確定事項9）。E9が提供するのは `packages/shared` の型・`parseNotificationDeltaQuery`・`toNotificationFeedItemFromStartup` / `toNotificationFeedItemFromDelta` / `mergeNotificationFeedItems` までである。
  - **通知の表示は `summary` を1本の文字列のまま行う**（確定事項7）。`NotificationFeedItem.display`（startup由来のみ非null）を通知表示に使わないこと。起動由来・差分由来でUIの構造分岐を作る必要はない。
- **I1 #67 / I2 #68（通知一覧・履歴画面）**: 「直近N件の一覧」はE9の責務ではない。E9はcursor以降の新着のみを返す。一覧・検索はE10 #42 の履歴APIを使う（AD-H066）。
- **E10 #42（監視画面向けAPI）**: `notification_output_history` の検索・ページング・`startup_notification_inquiry` の表示はE10で設計する。E9が追加する `findMaxNotificationOutputSequence` / `listNotificationOutputHistoryAfter` を流用してよいが、E10の一覧用に上限・オフセットを別途定める。
- **B4へ手動削除経路を実装する場合（将来）**: `notification_output_history.id` はAUTOINCREMENTではないため、**最大idの行を削除すると次のINSERTでidが再利用される**。その時点でE9のcursorは「一度受け取った番号を再び新着に割り当てる」＝新着の取りこぼしを起こす。削除機能を作るときは、(a) `id` をAUTOINCREMENT化する（表の再構築が必要）か、(b) 削除を最大id未満に限定する、のいずれかを必ず併せて設計する。
- **AD-H022（ブラウザ疎通異常）/ AD-H068（system操作系メッセージの発生源）**: 本設計では扱わない。前者はH2 #64 / G9 #60 / K8 #81、後者はE11 #43 で判断する。
- **期限（expiry）の配信**: #145 §7 のとおり、通常差分APIに期限を運ぶ必要が生じた場合は #145 の期限関数と保存済み現況から取得する契約を引き継ぐ。E9では期限フィールドを新設しない（B4に期限が保存されていないため、追加するには保存側＝Epic Dの変更が要る）。

---

## 11. 残留リスク・実挙動未確認事項

- **実挙動未確認**: 設計時点で差分エンドポイントは存在しないため、`connection.transaction(...).deferred()` による読み取りトランザクションの実挙動、Express 5 での同名クエリキー重複時の `req.query` の値（配列化されるか）、1000件規模の応答JSONサイズと所要時間は**実挙動未確認**である。製造時にAC1・AC6・AC11で確認し、設計と矛盾した場合は勝手に方式を変えず統括担当へ報告すること。
- **応答サイズ**: 件数上限を設けない（確定事項2）ため、端末が長時間切断されたあとの初回差分が非常に大きくなりうる。PoCの想定規模（会場2・開催期間限定）では問題にならない見込みだが、実測していない。閾値を超えるようなら上限とページングの追加をH2/E10と合わせて再検討する。
- **rowid再利用**: §10 のとおり、現状は製造コードに削除経路がないため発生しない。検収時に `deleteNotificationOutputHistory` の呼出し元が増えていないことを確認する。
- **DBファイル差し替え**: 別環境のcursorを持ち込んだ場合は 409 `cursor_out_of_range` で検知できるが、**より大きいDBへ差し替えた場合は検知できない**（cursorが範囲内に収まるため、差し替え前後の通知が混ざる）。PoCの運用範囲では許容する。
- **起動通知と通常通知の配信データの粒度差（対応方針は確定済み）**: 起動は3要素（title/target/content）を持ち、通常差分は1本の `summary` のみ。B4に3要素の個別値が保存されていないことに由来する構造的な差であり、E9単独では解消できない。**H側は起動・通常ともに `summary` を1本のまま表示することが確定した**ため（確定事項7）、表示上の不整合は生じない。残るリスクは「H2の実装者が `NotificationFeedItem.display` を見つけて起動通知だけ3要素表示にしてしまう」ことであり、型のTSDoc（§6.3）と引き継ぎ（§10）の双方に明記して防ぐ。
- **H側フィルタリングへの依存（確定事項8）**: 配信APIは `terminalMode` で絞り込まないため、装置異常系や `venueScope==='unresolved'` の通知がH端末に表示されるか否かは、**H2 #64 のフロント実装が正しくフィルタすること**に全面的に依存する。H2でフィルタを実装し忘れると、H端末に装置異常系の通知が出る。E9側でこれを検知する手段はないため、H2の受け入れ条件でフィルタの有無を必ず検証するよう引き継ぐ（§10）。
- 参照した実装はコミット `1ecacf2` 時点のものである。製造開始までに `main` へ追加変更が入った場合は、§2.3 の事実と差分がないか再確認する。

---

## 12. 解決済みヒアリング事項

初版で §12「要ヒアリング事項」として挙げていた3点は、統括担当のヒアリングによりすべて確定した（2026-09-14）。決定内容と反映先を記録する。これらは §2.2 の確定事項7〜9として設計の前提に組み込み済みである。

| # | 論点 | 決定内容 | 反映先 |
| --- | --- | --- | --- |
| 1 | 起動通知と通常通知の表示粒度の差 | **案(a)を採用。** H側は起動・通常ともに `summary` を1本の文字列のまま表示し、3要素（title/target/content）への分解表示は行わない。B4側（Epic D）の保存構造は変更せず、E9のレスポンス仕様も現状どおり維持する | §2.2 確定事項7、§2.3、§6.2、§6.3、§9 AC7・AC10、§10、§11 |
| 2 | `venueScope='unresolved'` の配信方針 | **案(a)を採用。** 従来どおり全会場・全端末へ配信し、WARNログを残す。**配信API（E9）は `terminalMode` による絞り込みを一切行わない。** 表示除外はH端末側アプリが `origin` と同様の仕組みで行う。基本設計 §8.4 の未決論点「フィルタリング実装位置」は、E9では「配信APIのクエリ側では絞り込まない」と決定した | §2.2 確定事項8・補足、§1.2、§4.2、§5.2、§7、§9 AC4(e)・AC5、§9.1 red5、§10、§11 |
| 3 | 差分APIのwebクライアント実装範囲 | **変更なし。** E9はAPI（`apps/api` + `packages/shared`）のみを実装し、`apps/web` 側のfetch関数・ポーリングループ・storeはH2 #64 で実装する。E9のweb変更は §8 の型ガード1行のみ | §2.2 確定事項9、§1.1、§1.2、§8、§9 AC12、§10 |

以上のほか、設計を進めるうえで追加の確認が必要な事項はない。製造は本設計の承認後に別フェーズとして開始する。
