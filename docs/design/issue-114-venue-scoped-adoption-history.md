# Issue #114 設計: 会場別の採用履歴と複数会場同時処理（C16）

## 1. 目的と確定事項

Issue #109 は会場別の気象対象（`VenueId = 'east' | 'trc'`）を型安全に定義し、C2/C3 への明示注入点を作ったが、同一 API プロセスで両会場を常時処理することは明示的に見送った。理由は `telegram_reception.adoption_result` が受信電文 1 件につき 1 つしか採用結果を持てず、後に処理した会場が前の会場の結果を上書きするためである（#109 §3.2・§7）。

本 Issue はこの永続化境界を解消し、東地区と TRC の同時処理を実運用として有効化する。

### 1.1 統括担当のヒアリングで確定した判断

| # | 論点 | 確定事項 |
|---|---|---|
| 1 | 永続化モデルの形状 | 別テーブル `telegram_reception_adoption` に正規化する。`(reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at)` を持ち `UNIQUE (reception_id, venue_id)`。既存の `telegram_reception.adoption_result` 列は移行後に廃止する。 |
| 2 | 既存データの移行 | 既存 3 列の値は `venue_id = 'east'` の行として引き継ぐ。TRC 分は移行対象データが存在しないため作成しない（未判定のまま）。 |
| 3 | 同時処理の適用範囲 | ポーリング・起動時再処理・C3 現況再構築は `VenueId` 全件を毎回ループする。会場を絞る設定フラグは設けない。 |
| 4 | 将来 API のための境界 | 内部の repository / service の関数シグネチャに `venueId` を持たせ、会場別データを返せるところまで。公開 HTTP エンドポイント・クエリパラメータ・UI の会場選択は作らない。 |

## 2. 参照資料と実物調査

| 参照 | 確認した内容 |
|---|---|
| `docs/issues-draft.md` / Issue #114 本文 | やること・やらないこと・受け入れ条件。 |
| `docs/design/issue-109-venue-forecast-target-definitions.md` | 会場定義・adapter の既存契約、複数会場同時処理を後続へ送った理由。 |
| `docs/design/issue-25-notification-data-model.md` §「targets」 | 通知の `targets` は「発生対象」であり端末・会場の宛先ではない。会場照合は端末側の責務で、本 Issue のサーバー側モデルに会場列を足す必要はない。 |
| `packages/shared/src/venueForecastTargets.ts` | `VenueId`、`VENUE_FORECAST_TARGETS`、`resolveVenueForecastTargets`。`VenueId` の一覧配列と型ガードは未提供。 |
| `apps/api/src/venueForecastTargets.ts` | C2〜C7/C9 の adapter。`resolveBosaiBulletinTarget()` だけが両会場の **和集合** を返す（会場別ではない）。 |
| `apps/api/migrations/0010_create_telegram_reception.sql` | `adoption_result` / `adoption_reason` / `adoption_decided_at` は `telegram_reception` の列。既存インデックスはこの 3 列を参照していない。 |
| `apps/api/migrations/0001_create_warning_current.sql` | `warning_current_snapshot` は `UNIQUE (area_code, control_status)`。 |
| `apps/api/migrations/0013_create_warning_current_stream.sql` | `warning_current_stream` は `UNIQUE (prefecture_code, area_code, control_status, telegram_type)`。 |
| `apps/api/src/database/connection.ts` | `PRAGMA foreign_keys = ON` を起動時に強制している（ON でなければ例外）。 |
| `apps/api/src/database/migrations.ts` | migration は `0000_` 形式の連番、各ファイルを 1 トランザクションで適用、ファイル内での `BEGIN/COMMIT` は禁止、適用済みは checksum 照合。 |
| `apps/api/src/polling/jmaXmlPoller.ts` | 共通エンベロープ不正時に `recordTelegramReception` で `'未対応形式'`（`adoptionDecidedAt = null`）を書く。電文種別で各 processor へ分岐する。 |
| `apps/api/src/polling/jmaWarningTelegramProcessor.ts` / `jmaWarningCurrentProcessor.ts` | C2 の parse は `targetArea.municipalCode` で Item を絞るため、会場ごとに結果が異なる。C3 は `targetArea` を stream/snapshot のキーに使う。 |
| `apps/api/src/polling/jmaVpwp50Processor.ts` ほか各 processor | `updateTelegramReceptionAdoption` を呼ぶのは C2/C4/C5/C6/C7(VPBS50・VPHW) の 6 processor と poller の計 7 箇所。戻り値はいずれも利用していない。 |
| `apps/web/src/shell/config.ts` | `Terminal` が `mode: 'H' | 'K'` と `venue` を別々に持ち、同一会場の H/K は同一の `Venue` オブジェクト（`venues.east` / `venues.trc`）を共有する。 |

### 2.1 実測記録（2026-09-12、Node 24.20.0、当該 worktree）

- **SQLite の移行操作**: `better-sqlite3` のバンドル版は SQLite **3.53.4**。`0010` を適用した DB に対し「新テーブル作成 → `INSERT ... SELECT` で east 行を移送 → `ALTER TABLE telegram_reception DROP COLUMN` ×3」を 1 トランザクション（`immediate`）で実行し、成功を確認した。`PRAGMA foreign_keys = ON` の状態で親行を削除すると子行が CASCADE 削除されること、`venue_id` の CHECK が `'osaka'` を拒否することも確認した（検証スクリプトは削除済み）。
- **会場ごとの再 parse コスト**: 64 Item・17,325 バイトの合成 VPWS50 に対する `parseWarningTelegram` 1 回あたり **7.4〜9.4 ms**（ウォームアップ 20 回後に 100 回平均、east/trc 各 1 セット）。会場を 1 つ増やすと C2 の CPU コストはこの分だけ増える。ポーリング間隔（分単位）と HTTP 取得時間に対して無視できるため、**会場ごとに parse をやり直す**方式を採る（§3.3）。なお計測に使った合成電文は C1 保存値との照合で `未対応構造` に終わっており、DOM 解析と Item 走査までのコストの計測値である。採用判定まで到達する実電文ではこれ以上になる。**実挙動未確認**: 実 VPWS50（東京都全域・実サイズ）での計測は行っていない。

## 3. 設計

### 3.1 永続化モデル

新規 migration `apps/api/migrations/0018_create_telegram_reception_adoption.sql`。

```sql
CREATE TABLE telegram_reception_adoption (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL CHECK (venue_id IN ('east', 'trc')),
  adoption_result TEXT CHECK (adoption_result IS NULL OR adoption_result <> ''),
  adoption_reason TEXT,
  adoption_decided_at TEXT,
  UNIQUE (reception_id, venue_id)
);

CREATE INDEX idx_telegram_reception_adoption_pending
  ON telegram_reception_adoption (venue_id, adoption_decided_at, reception_id);
CREATE INDEX idx_telegram_reception_adoption_result
  ON telegram_reception_adoption (venue_id, adoption_result);

INSERT INTO telegram_reception_adoption (
  reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
)
SELECT id, 'east', adoption_result, adoption_reason, adoption_decided_at
FROM telegram_reception
WHERE adoption_result IS NOT NULL
   OR adoption_reason IS NOT NULL
   OR adoption_decided_at IS NOT NULL;

ALTER TABLE telegram_reception DROP COLUMN adoption_result;
ALTER TABLE telegram_reception DROP COLUMN adoption_reason;
ALTER TABLE telegram_reception DROP COLUMN adoption_decided_at;
```

設計上の要点。

- `venue_id` の CHECK は `VenueId` のリテラルを書き下す。DB は TypeScript の型を知らないため、会場追加時は migration を追加する（既存 migration の編集は checksum 照合で禁止されている）。
- 3 列すべてが NULL の受信（＝まだ誰も判定していない）は行を作らない。「行が無い」＝「その会場では未判定」である。
- 逆に `adoption_result` が入っていて `adoption_decided_at` が NULL の行は現行の `'未対応形式'` と同じ意味（エンベロープ時点の暫定記録で、判定は未確定）であり、再処理対象に残る（§3.6）。
- TRC 行は移行時に作らない。移行直後は TRC がすべて未判定となり、起動時再処理が TRC 分だけを埋める。これは確定事項 2 のとおりであり、既存の east 結果を書き換えない。

### 3.2 型と repository API

#### 3.2.1 `packages/shared`

`venueForecastTargets.ts` に以下を追加する（既存の定義は変更しない）。

```ts
export const VENUE_IDS: readonly VenueId[] = Object.freeze(['east', 'trc']);
export function isVenueId(value: unknown): value is VenueId;
```

`VENUE_IDS` は `Object.keys(VENUE_FORECAST_TARGETS)` からではなくリテラルで定義し、`VENUE_FORECAST_TARGETS` の全キーと一致することをテストで固定する（キー順序に依存する処理を作らないため）。`isVenueId` は DB から読み出した `venue_id` 文字列を `VenueId` へ戻す唯一の経路とする。外部入力を無検証でキャストしない（#109 §5.1 の方針を踏襲）。

#### 3.2.2 `apps/api/src/repositories/types.ts`

```ts
export interface TelegramReceptionAdoption {
  readonly receptionId: number;
  readonly venueId: VenueId;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
}

/** 1 会場分の採用判定。既存の同名型を venueId 付きへ置き換える。 */
export interface TelegramReceptionAdoptionInput {
  readonly venueId: VenueId;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
}
```

`TelegramReception` / `TelegramReceptionSummary` から `adoptionResult` / `adoptionReason` / `adoptionDecidedAt` を削除し、`readonly adoptions: readonly TelegramReceptionAdoption[]`（`venueId` 昇順）を追加する。列を消すだけでなく型からも消すことで、旧フィールドを参照する実装は typecheck で落ちる。

`TelegramReceptionInput` の 3 フィールドは `readonly adoptions: readonly TelegramReceptionAdoptionInput[]` に置き換える（通常は空配列）。

`ListTelegramReceptionsOptions` は `adoptionResult?: string` に加えて `adoptionVenueId?: VenueId` を持ち、`EXISTS (SELECT 1 FROM telegram_reception_adoption a WHERE a.reception_id = t.id AND …)` で絞る。`adoptionVenueId` のみの指定は「その会場の判定行が存在する受信」を意味する。

#### 3.2.3 `apps/api/src/repositories/telegramReceptionRepository.ts`

```ts
export function upsertTelegramReceptionAdoption(
  connection: DatabaseConnection,
  receptionId: number,
  input: TelegramReceptionAdoptionInput,
): TelegramReceptionAdoption;

export function findTelegramReceptionAdoption(
  connection: DatabaseConnection,
  receptionId: number,
  venueId: VenueId,
): TelegramReceptionAdoption | null;

export function listTelegramReceptionAdoptions(
  connection: DatabaseConnection,
  receptionId: number,
): readonly TelegramReceptionAdoption[];

export function listPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venueId: VenueId,                       // 追加（第 2 引数）
  options?: { readonly after?: …; readonly limit?: number },
): PendingWarningTelegramPage;
```

- `updateTelegramReceptionAdoption` は廃止し、`INSERT … ON CONFLICT (reception_id, venue_id) DO UPDATE SET …` の upsert に置き換える。既存呼出し 6 箇所はいずれも戻り値を使っていないため、戻り値型の変更（`TelegramReception | null` → `TelegramReceptionAdoption`）の影響は無い。
- `listPendingWarningTelegramReceptions` の未判定条件は現行の意味を保つ。

  ```sql
  AND NOT EXISTS (
    SELECT 1 FROM telegram_reception_adoption a
    WHERE a.reception_id = t.id AND a.venue_id = ? AND a.adoption_decided_at IS NOT NULL
  )
  ```

  現行は `adoption_decided_at IS NULL` を未判定としており、エンベロープ不正の `'未対応形式'`（decided_at は NULL）も再処理対象に入っていた。上式はその挙動を会場別に保存する。
- `listWarningTelegramReceptionsForRebuild` は採用結果を条件にしていないため、引数・SQL とも変更しない（再構築は保存済み原文から会場ごとに再計算する）。
- `findTelegramReceptionById` / `listTelegramReceptions` は `telegram_reception_area` と同じ要領で採用行を join せず個別に読み、`adoptions` に詰める。
- `deleteTelegramReception` は `PRAGMA foreign_keys = ON`（実測確認済み）による CASCADE に委ねる。追加の明示 DELETE は書かない。

### 3.3 C2/C3 を会場ごとに独立実行する仕組み

`parseWarningTelegram` は `targetArea.municipalCode` で `Item` を選び、見つからなければ `対象地域外` を返す。つまり **parse 結果自体が会場に依存する**ため、パース結果を共有して採用判定だけを会場別にすることはできない。§2.1 の実測（1 回 7.4〜9.4 ms）から、会場ごとに parse をやり直す方式のコストは許容できる。

会場 ID と解決済み対象を必ず対で運ぶため、両者を 1 つの引数にまとめる。

```ts
// apps/api/src/venueForecastTargets.ts
export interface VenueWarningContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningCurrentTargetArea;
}
export function resolveVenueWarningContext(venueId: VenueId): VenueWarningContext;

export interface VenueWarningTimeseriesContext {
  readonly venueId: VenueId;
  readonly targetArea: WarningTimeseriesTargetArea;
}
export function resolveVenueWarningTimeseriesContext(venueId: VenueId): VenueWarningTimeseriesContext;
```

processor の新シグネチャ。

```ts
// jmaWarningTelegramProcessor.ts
export function processWarningTelegramReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  venue: VenueWarningContext,
): WarningTelegramParseResult;

/** VENUE_IDS を毎回ループする。ポーリング本線はこちらを呼ぶ。 */
export function processWarningTelegramReceptionForAllVenues(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
): ReadonlyMap<VenueId, WarningTelegramParseResult>;

export async function reprocessPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  venue: VenueWarningContext,
  clock: () => UtcIso8601String,
): Promise<{ readonly processedCount: number }>;
```

- `processWarningTelegramReception` は `venue.targetArea` で parse → C3 適用 → `upsertTelegramReceptionAdoption(connection, reception.id, { venueId: venue.venueId, … })` の順で動く。現行の「C3 が例外を投げても C2 の解析成功を取り消さない」挙動、`unsupported_code` のときに `'未対応コード'` へ差し替える挙動は変更しない。
- 会場ループは 1 会場ずつ独立したトランザクションで完了させる（現行どおり `applyWarningCurrentReception` と採用行 upsert がそれぞれ自分のトランザクションを張る）。一方の会場の失敗が他方の採用行を巻き戻さない。
- `WarningTargetArea | WarningCurrentTargetArea` の実行時分岐（`'prefectureCode' in targetArea`）は削除する。`VenueWarningContext.targetArea` が常に `WarningCurrentTargetArea` であるため不要になり、`DEFAULT_WARNING_TARGET_AREA` / `DEFAULT_WARNING_CURRENT_TARGET_AREA` も廃止する（`resolveVenueWarningContext('east')` に置換）。
- C4（VPWP50）も市町村等コードが会場で異なるため同じ形にする：`processVpwp50Reception(connection, reception, processedAt, venue: VenueWarningTimeseriesContext)` と `…ForAllVenues`。`warning_timeseries_snapshot` は `area_code` が主キー要素なので会場ごとに別行になり、二重保存にならない。

#### 3.3.1 会場によって対象が変わらない電文種別

C5（VPFD61/VPFW60）と C6（VPFD51）は、両会場とも `130010` / `44132` に解決される（#109 §1.1）。これらを会場ごとにループすると、同一のスナップショットを 2 回保存することになるため、**判定は 1 回だけ行い、その結果を全 `VenueId` の行として記録する**。

```ts
// telegramReceptionRepository.ts
export function upsertTelegramReceptionAdoptionForAllVenues(
  connection: DatabaseConnection,
  receptionId: number,
  input: Omit<TelegramReceptionAdoptionInput, 'venueId'>,
): readonly TelegramReceptionAdoption[];
```

「対象が同一だから共有してよい」という前提が将来崩れたら静かに壊れるため、`apps/api/src/venueForecastTargets.ts` に等価性の表明を置く。

```ts
/** 全会場で同一に解決されることを保証して 1 つの対象を返す。異なれば例外。 */
export function resolveSharedEarlyWarningTargetArea(): EarlyWarningTargetArea;
export function resolveSharedAreaTimeseriesForecastTarget(): AreaTimeseriesForecastTarget;
```

エンベロープ不正（`jmaXmlPoller` の `'未対応形式'`）も会場に依存しないため、`recordTelegramReception` へ渡す `adoptions` を `VENUE_IDS.map(venueId => ({ venueId, adoptionResult: '未対応形式', … }))` とする。

C7（VPBS50・VPHW）は現状 `resolveBosaiBulletinTarget()` が両会場の **和集合** で判定しており、会場別ではない。本 Issue ではこの判定ロジックを変更せず、和集合の判定結果を全会場行として記録する（§8-1 の要ヒアリング事項）。

### 3.4 C3 側テーブルに会場列を追加しない理由

`warning_current_snapshot` は `UNIQUE (area_code, control_status)`、`warning_current_stream` は `UNIQUE (prefecture_code, area_code, control_status, telegram_type)`、`warning_timeseries_snapshot` は `area_code` を含むキーである。east は `1310800`、trc は `1311100` で、**会場が異なれば市町村等コードも異なる**ため、会場列を足さなくても行は分離される。会場列を追加すると同じ区域の現況が会場の数だけ重複し、どちらが正かを決める規則が新たに必要になるため追加しない。

この分離は「2 会場の市町村等コードが相異なる」ことに依存している。将来同じ市町村内に 2 会場を定義すると **エラーも警告も出ずに** 現況が相互上書きされるため、共有 workspace に不変条件テストを置く。

- `VENUE_IDS` の全会場について `warning.municipalCode` が相異なること。
- `warning.municipalCode` と `warningTimeseries.municipalCode` が会場内で一致すること（C3 と C4 のキーの整合）。

同じ理由で、会場列が要らないことを設計文書とテストの両方に残す（後続が「会場列が無いのは実装漏れ」と誤解しないため）。`bosai_bulletin` は `eventId` + `controlStatus` キーで会場非依存に保存し、読み出し時に `includedAreaCodes` で絞る現行方式を維持する。

### 3.5 会場別データを返す内部境界（公開 API は作らない）

`apps/api/src/services/venueWeatherService.ts` を新設する。HTTP ルータからは呼ばれない（この Issue ではエンドポイントを作らない）。

```ts
export function getVenueWarningCurrent(
  connection: DatabaseConnection,
  venueId: VenueId,
  controlStatus: ControlStatus,
): WarningCurrentSnapshot | null;              // findWarningCurrentSnapshot(warning.municipalCode, status)

export function getVenueWarningTimeseries(
  connection: DatabaseConnection,
  venueId: VenueId,
  controlStatus: ControlStatus,
): WarningTimeseriesSnapshot | null;           // findWarningTimeseriesSnapshot(warningTimeseries.municipalCode, status)

export function listVenueBosaiBulletins(
  connection: DatabaseConnection,
  venueId: VenueId,
  options: Omit<ListBosaiBulletinsOptions, 'includedAreaCodes'>,
): readonly BosaiBulletin[];                   // 会場の includedAreaCodes で絞る

export function listVenueTelegramReceptions(
  connection: DatabaseConnection,
  venueId: VenueId,
  options?: Omit<ListTelegramReceptionsOptions, 'adoptionVenueId'>,
): readonly TelegramReceptionSummary[];        // adoptionVenueId = venueId を強制
```

`controlStatus` を引数に残すことで、訓練（`training`）と本番（`normal`）の現況を同一視しない。既定値を `'normal'` に固定せず、呼出し側に明示させる。

### 3.6 ポーリング・起動時再処理・再構築

- `PollerContextOptions` から `warningTargetArea` と `warningTimeseriesTargetArea` を削除する。C2/C4 は常に `VENUE_IDS` 全件を処理する（確定事項 3。会場を絞る注入点を残すと、片方の会場だけ判定済みという中途半端な DB 状態を作れてしまう）。C5/C6/C7 の target 注入オプションは現行のまま残す。
- `apps/api/src/server.ts` の 2 箇所（`startServer` と既定起動経路）は次のループに置き換える。

  ```ts
  for (const venueId of VENUE_IDS) {
    const venue = resolveVenueWarningContext(venueId);
    await reprocessPendingWarningTelegramReceptions(database.connection, venue, clock);
    rebuildWarningCurrentFromReceptions(database.connection, venue.targetArea);
  }
  ```

  `rebuildWarningCurrentFromReceptions` のシグネチャは `targetArea` のままでよい（採用履歴を書かないため `venueId` を必要としない）。ただし既定引数 `DEFAULT_WARNING_CURRENT_TARGET_AREA` は廃止し、必須引数にして呼び忘れを typecheck で検出する。
- 冪等性: 再処理は会場ごとに `adoption_decided_at IS NOT NULL` の行を作るため、2 回目以降は対象 0 件になる。再構築は会場ごとに `delete → upsert` を行う既存の実装をそのまま使い、受信履歴・通知履歴を増やさない（現行の 22-10 テストの主張を会場別に拡張する）。

### 3.7 H/K 端末との整合

`apps/web/src/shell/config.ts` は変更しない。`terminals` は `hkeagh01`/`kkeagh01` が `venues.east`、`htrcph01`/`ktrcph01` が `venues.trc` を **同一オブジェクト参照で**共有しており、`mode` は `Terminal` にのみ存在して `Venue` にも `VenueForecastTargets` にも現れない。本 Issue で新設する DB キー（`telegram_reception_adoption.venue_id`）、C3 のキー（`area_code`）、§3.5 のサービス引数のいずれにも `TerminalMode` を入れない。

回帰を検出するため、共有 workspace の型テストに「`TerminalMode` を `VenueId` へ代入できない」（#109 で導入済み）に加え、`apps/web` のテストで「同一会場の H/K 端末が同一の `weatherTargets` を返す」ことを検証する。

### 3.8 Issue #25（通知データモデル）との整合

D1 の `Notification` は端末・会場の宛先を持たず、`targets` は「発生した区域・地点・設備」を表す。会場との照合は端末側が行う設計であり（#25 §「targets」）、本 Issue で `notification_output_history` に会場列を追加する必要はない。通知の発火側（D2 以降）は未実装のため、会場別採用履歴が通知の重複判定に影響する経路は現時点で存在しない。

ただし後続で通知を発火させるとき、**同じ気象事象が 2 会場分で 2 件の通知になるのか 1 件なのか**は未決定であり、本 Issue では決めない（§8-3）。本 Issue の実装では `venue_id` を通知キー・通知 ID の生成に一切使わない。`isTraining`（`control_status = 'training'`）の扱いも変更しない。会場別採用履歴も `control_status` 別の C3 現況も、訓練と本番を同じ行に混ぜない現行構造のままである。

## 4. 変更対象

| 種別 | パス | 内容 |
|---|---|---|
| 追加 | `apps/api/migrations/0018_create_telegram_reception_adoption.sql` | §3.1 |
| 変更 | `packages/shared/src/venueForecastTargets.ts` | `VENUE_IDS`、`isVenueId` |
| 変更 | `apps/api/src/venueForecastTargets.ts` | `VenueWarningContext` ほか resolver、`resolveShared*` |
| 変更 | `apps/api/src/repositories/types.ts` | 採用型の分離、`TelegramReception*` から 3 フィールド削除 |
| 変更 | `apps/api/src/repositories/telegramReceptionRepository.ts` | upsert・pending の会場化、`adoptions` の読出し |
| 変更 | `apps/api/src/repositories/index.ts` | 追加 export |
| 追加 | `apps/api/src/services/venueWeatherService.ts` | §3.5 |
| 変更 | `apps/api/src/polling/jmaWarningTelegramProcessor.ts` | §3.3 |
| 変更 | `apps/api/src/polling/jmaWarningCurrentProcessor.ts` | 既定引数の廃止 |
| 変更 | `apps/api/src/polling/jmaVpwp50Processor.ts` | §3.3 |
| 変更 | `apps/api/src/polling/jmaEarlyWarningProcessor.ts` / `jmaVpfd51Processor.ts` / `jmaVpbs50Processor.ts` / `jmaVphwProcessor.ts` | 全会場行への記録に置換 |
| 変更 | `apps/api/src/polling/jmaXmlPoller.ts` | 会場ループ、`'未対応形式'` の全会場記録、target オプション削除 |
| 変更 | `apps/api/src/server.ts` | §3.6 |
| 変更 | 既存テスト（`apps/api/tests/jmaWarningTelegramParser.test.ts`、`jmaWarningCurrentProcessor.test.ts`、`jmaXmlPolling.test.ts`、`repositories.test.ts`、`venueForecastTargets.test.ts`、`packages/shared/tests/venueForecastTargets.test.ts`、`apps/web/tests/shell.test.ts`） | 新シグネチャへの追従と §5 の新規検証 |

## 5. 対象外

- 会場をまたいだ気象情報の統合表示、会場選択 UI、会場別 HTTP エンドポイント・クエリパラメータ。
- 認証・認可、端末 URL と会場の対応付けの変更。
- 未確認の会場・地域コードの追加。TRC 対象の実 VPWW/VPWS/VPBS50 電文は未採取のままであり（#109 §8-1）、合成 fixture による検証にとどめる。
- C2/C3 の XML 解釈・状態遷移の業務規則（版比較、`InfoType`、`reduceWarningCurrent`、差分計算）の変更。
- C7 の会場別判定の厳密化（§8-1）。
- 通知の発火・重複排除（§8-3）。

## 6. 実装手順

1. `packages/shared` に `VENUE_IDS` / `isVenueId` と不変条件テスト（§3.4）を追加する。
2. migration `0018` を追加し、`repositories.test.ts` に移行テスト（§7-1）を追加する。
3. `types.ts` と `telegramReceptionRepository.ts` を会場別モデルへ置き換える。ここで typecheck が広範に落ちる状態になるのが正常である。
4. `apps/api/src/venueForecastTargets.ts` に context resolver と `resolveShared*` を追加する。
5. C2/C4 processor を `VenueWarningContext` 版へ、C5/C6/C7 processor と poller を全会場記録へ置き換える。
6. `jmaXmlPoller` と `server.ts` を会場ループへ置き換え、target 注入オプションを外す。
7. `venueWeatherService.ts` を追加する。
8. 既存テストを新シグネチャへ追従させ、§7 の新規テストを追加する。
9. `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w packages/shared` / `-w apps/api` / `-w apps/web` を通す。

## 7. 検証計画

新しいテストは **先に red を確認する**（実装を意図的に壊して落ちること）。ミューテーション判定の前に、意味を変えないダミー改変（コメント追加など）でそのテストが通ることを確かめ、「常に落ちる／常に通る」故障モードを除外する。

1. **移行テスト**: `0017` までを適用した DB に旧形式の `telegram_reception` 行（採用済み 1 件・未判定 1 件）を直接 INSERT し、`0018` 適用後に (a) 採用済み 1 件が `venue_id='east'` の行として値ごと一致すること、(b) 未判定行の採用行が 0 件であること、(c) `trc` 行が 0 件であること、(d) `PRAGMA table_info(telegram_reception)` に 3 列が無いこと、を検証する。`INSERT … SELECT` の `WHERE` を落とす変異で (b) が落ちることを確認する。
2. **同一電文の会場独立**: 江東区 Item と大田区 Item を両方含む VPWS50 を 1 件保存し、east → trc の順、および trc → east の順で `processWarningTelegramReception` を呼ぶ。どちらの順でも 2 行の採用行が残り、内容が順序に依存しないことを完全一致で検証する。`UNIQUE (reception_id, venue_id)` を `UNIQUE (reception_id)` にする変異で落ちることを確認する。
3. **対象地域外の独立**: 江東区 Item のみの電文で、east は `'警報・注意報として解析済み'`、trc は `'対象地域外'` になること。大田区 Item のみの電文で逆になること。`venue_id` を固定値 `'east'` に変異させると落ちることを確認する。
4. **C3 のキー分離**: 上記 2 の電文適用後、`warning_current_snapshot` が `area_code = '1310800'` と `'1311100'` の 2 行に分かれ、`warning_current_stream` が `(130000, 1310800, …)` と `(130000, 1311100, …)` に分かれること。両会場の項目が混ざらないこと。
5. **未判定検出の会場別**: east だけ判定済みの受信について、`listPendingWarningTelegramReceptions(conn, 'east')` が 0 件、`(conn, 'trc')` が 1 件を返すこと。`'未対応形式'`（`adoption_decided_at = null`）の行がある受信は、その会場でも依然 pending であること（現行挙動の保存）。
6. **起動時の冪等性**: 受信履歴を投入した DB に対し、`VENUE_IDS` ループの再処理＋再構築を 2 回実行し、`telegram_reception`・`telegram_reception_area`・`notification_output_history` の件数が 1 回目と 2 回目で不変、`telegram_reception_adoption` は (受信件数 × 判定した会場数) から増えないこと、`warning_current_snapshot` の内容が 2 回目で変化しないことを検証する。
7. **移行後の東地区一致**: 東地区単独運用の手順（east のみ処理）で得た `warning_current_snapshot` / `warning_current_stream` / east の採用行と、両会場処理後の east 側の同一データが完全一致することを検証する。
8. **会場不変条件**: `VENUE_IDS` の各会場の `warning.municipalCode` が相異なること、`VENUE_IDS` が `VENUE_FORECAST_TARGETS` の全キーと集合として一致すること。`trc` の市町村等コードを `1310800` に変異させると落ちることを確認する。
9. **H/K 分離**: 同一会場の H/K 端末が同一の `weatherTargets` を返すこと。`telegram_reception_adoption` の列名・`WarningCurrentSnapshot` のキー・`venueWeatherService` の引数に `'H'`/`'K'` が現れないこと（型テスト＋文字列検査）。
10. **共有判定の表明**: `resolveSharedEarlyWarningTargetArea()` / `resolveSharedAreaTimeseriesForecastTarget()` が east/trc で同一値のとき値を返し、会場定義を変異させて不一致にすると例外になること。

## 8. 受け入れ条件

検収担当は上から順に実行する。コマンドはリポジトリルートで実行する。

- [ ] `npm run test -w apps/api` の移行テスト（§7-1）が通る。`0017` までの DB に旧形式データを入れて `0018` を適用すると、採用済み行が `venue_id='east'` として値ごと保存され、`trc` 行は作られず、`telegram_reception` から `adoption_result` / `adoption_reason` / `adoption_decided_at` の 3 列が消えている。
- [ ] 江東区 Item と大田区 Item を含む同一 `telegram_reception` を east・trc の両順序で処理しても、`telegram_reception_adoption` に 2 行が独立して残り、内容が処理順に依存しない（§7-2）。
- [ ] 江東区のみの電文は east で採用・trc で `'対象地域外'`、大田区のみの電文はその逆になる（§7-3）。east は `1310800`/`130000`、trc は `1311100`/`130000` を使う。
- [ ] 両会場処理後、`warning_current_snapshot` と `warning_current_stream` が `area_code` `1310800` と `1311100` の行に分かれ、互いの項目を上書きしない（§7-4）。C3 側テーブルに会場列は追加されていない。
- [ ] `listPendingWarningTelegramReceptions` は会場ごとに未判定を返し、片方の会場の判定完了が他方の再処理対象を消さない（§7-5）。
- [ ] 起動時再処理＋現況再構築を 2 回続けて実行しても、受信履歴・受信区域・通知出力履歴の件数が増えず、`warning_current_snapshot` の内容が変化しない（§7-6）。
- [ ] east 単独処理の結果と、両会場処理後の east 側データが完全一致する（§7-7）。
- [ ] 会場不変条件テスト（§7-8）と共有判定の表明テスト（§7-10）が通る。
- [ ] 同一会場の H/K 端末が同一の会場定義を参照し、`venue_id`・C3 のキー・`venueWeatherService` の引数のいずれにも端末モードが含まれない（§7-9）。
- [ ] `apps/api/src/services/venueWeatherService.ts` の各関数が `venueId` を引数に取り、会場別のデータを返す。新しい HTTP エンドポイント・クエリパラメータ・UI の会場選択は追加されていない（`git diff` で `app.ts` にルート追加が無いこと、`apps/web/src` に会場選択 UI が無いことを確認する）。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w packages/shared`、`npm run test -w apps/api`、`npm run test -w apps/web` がすべて成功する。

## 9. 後続 Issue への引き継ぎ

- **会場別 API（E/G 系）**: `venueWeatherService` を HTTP へ露出する際、会場 ID をパス・クエリ・端末 URL のどれで受けるかを決める。端末 URL から会場を導出する場合、`resolveTerminal` の結果をサーバー側で再検証する経路が必要になる。
- **C7 の会場別化**: 現在の和集合判定を会場別へ厳密化する場合、速報本体は `eventId` キーで 1 件保存のまま、採用判定だけを会場別にする必要がある（§8-1）。
- **通知（D 系）**: 会場ごとに独立した現況変化から通知を作るとき、1 事象 2 会場を 1 通知にまとめるか会場ごとに出すかを決める。`telegram_reception_adoption.venue_id` を通知 ID や重複判定キーへ流用しない。
- **保持期間（C10）**: 受信履歴の削除は CASCADE で採用行も消える。保持期間の対象件数を数えるとき、採用行は受信 1 件につき最大 会場数 行になることを前提にする。
- **会場追加**: 会場を増やすときは (a) `VenueId` と `VENUE_FORECAST_TARGETS`、(b) `VENUE_IDS`、(c) `telegram_reception_adoption.venue_id` の CHECK を足す migration、(d) §3.4 の不変条件テストの 4 点を同時に更新する。

## 10. 未確認事項・要ヒアリング

1. **C7（VPBS50・VPHW）の採用判定を会場別に厳密化するか**。現状 `resolveBosaiBulletinTarget()` は east と trc の `includedAreaCodes` の **和集合**で判定するため、江東区だけを対象とする速報でも TRC 行に `'気象防災速報として解析済み'` が記録される。本設計は #109 が C7 の会場解決を後続へ送った経緯を尊重し、和集合判定のまま全会場行へ同じ値を記録する案とした。厳密化する場合は「速報本体は 1 件保存のまま、採用判定のみ会場別」という追加設計が要る。
2. **`telegram_reception_adoption` に「会場非依存の判定」を表す表現を設けるか**。本設計は表現を設けず、会場非依存の判定（エンベロープ不正・C5・C6・現状の C7）も全会場ぶんの行として複製する。行数は受信 1 件あたり会場数に比例するが、「この会場にとってこの電文はどう扱われたか」を常に 1 クエリで答えられる利点を採った。
3. **1 つの気象事象が 2 会場で発生したときの通知の粒度**（1 通知か会場ごとか）。本 Issue では通知を発火させないため決めていない。
4. **TRC 対象の実電文は未採取**（#109 §8-1 から変わらず）。本 Issue の検証はすべて合成 fixture による。大田区を含む実 VPWS50/VPWW55 の構造は推測しない。
5. **実挙動未確認**: §2.1 の parse コストは合成電文での計測であり、東京都全域の実 VPWS50 での実測ではない。また、両会場同時処理時のポーリング 1 サイクル全体の所要時間は計測していない。
