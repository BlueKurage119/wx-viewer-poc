# Issue #158: 地域時系列予報・アメダス・気象防災速報RESTAPIのテストカバレッジ欠落解消 設計書

作成日: 2026-09-14
作成: Antigravity直轄（Gemini 3.8 Flash）
状態: 【承認済み】2026-09-14 ユーザー承認済み

## 1. 背景と目的

#36〜#38（PR [#157](https://github.com/BlueKurage119/wx-viewer-poc/pull/157)）の検収時に、設計書 `docs/design/issue-36-timeseries-amedas-bosai-rest-apis.md` §7 の受け入れ条件の文言に対応する自動テストが一部不足していることが判明した。検収担当が手動実測して合格を確認したが、回帰検知のためのテストがテストコードとして残っていなかった。

本設計書では、以下の5観点について恒久的な自動テストを追加し、回帰検知手段を確立する。

1. **B2（入力検証）の重複クエリケース**: `terminalId`・`controlStatus`を配列形式（同一キー2回指定等）で渡した場合に、3 GETいずれも400 `invalid_request`になることの検証。
2. **B9（#37 非対応要素）の合成`elems`注入**: 実在の会場コードをハードコードした判定になっていないことを、`resolveVenueForecastTargets`を経由しない合成`elems`（例: `'10110000'`）を注入して`unsupportedElements`の変化を確認する形で検証する。
3. **B13（#38 目撃情報）の`hasSighting: false`ケース**: VPHW51で目撃情報なしの場合に`hasSighting`が`null`ではなく明示的に`false`になることの検証。
4. **B14（#38 鮮度）の否定条件**: 別種別・別区域・別会場・過去時刻の解析失敗では一覧全体の`availability`が変化しないことの検証。
5. **#37（アメダス）の複数観測時点**: `observations`が`observedAt`昇順で返り、`latestObservedAt`が最終要素と一致することを、2件以上の観測時点を持つfixtureで検証する。

## 2. 変更対象

| 対象ファイル | 役割と変更内容 |
| --- | --- |
| `apps/api/src/services/weatherApiService.ts` | `WeatherApiServiceDeps` に `resolveAmedasTarget?: (venueId: VenueId) => AmedasTarget` をオプショナルフィールドとして追加。`getAmedas` 内で依存注入された resolver を優先使用するようにし、合成 `elems` 注入を可能にする。 |
| `apps/api/tests/issue36TimeseriesAmedasBosaiRestApis.test.ts` | 上記5観点に対応するテストコードを追加。 |

## 3. 各観点の詳細設計

### 3.1 B2（入力検証）の重複クエリケース
- 対象エンドポイント:
  - `/api/weather/area-timeseries`
  - `/api/weather/amedas`
  - `/api/weather/bulletins`
- 検証ケース:
  - `terminalId` の同一キー重複指定（例: `?terminalId=hkeagh01&terminalId=htrcph01&controlStatus=normal`）
  - `controlStatus` の同一キー重複指定（例: `?terminalId=hkeagh01&controlStatus=normal&controlStatus=training`）
  - 両方の同一キー重複指定
- 期待値:
  - HTTPステータス 400
  - レスポンスボディ `{ status: 'error', code: 'invalid_request' }`

### 3.2 B9（#37 非対応要素）の合成`elems`注入
- 目的: 実装が地点番号（例: `44166`）や会場コードをハードコードせず、`target.elements` の各桁から正しく非対応要素を導出していることを検証する。
- 注入する合成ターゲット:
  - `elements`: `'10110000'`（桁0: 気温1, 桁1: 降水0, 桁2: 風向1, 桁3: 風速1, 桁4: 日照0, 桁5: 積雪0, 桁6: 湿度0, 桁7: 気圧0）
  - 公開5要素のうち、降水1h（桁1）と湿度（桁6）が `0`（非対応）。
- 期待値:
  - `capabilities.unsupportedElements` が `['humidity', 'precipitation1h']`（`AMEDAS_PUBLIC_ELEMENTS` 走査順）と完全一致すること。
  - レスポンスの `data.observations[0].values` に `precipitation1h` および `humidity` のキーが存在しないこと。

### 3.3 B13（#38 目撃情報）の`hasSighting: false`ケース
- 目的: VPHW51 において目撃情報なし（`hasSighting: false`）が、`false` のまま透過され、`null` に誤って丸められないことを検証する。
- 保存データ:
  - `telegramType`: `VPHW51`
  - `hasSighting`: `false`
- 期待値:
  - レスポンスの該当 bulletin の `hasSighting` が `false`（`=== false` かつ `!== null`）であること。

### 3.4 B14（#38 鮮度）の否定条件
- 目的: 正常な速報が存在して一覧が `available` の状態にあるとき、無関係な解析失敗で誤って `stale` に遷移しないことを検証する。
- 基準データ:
  - 正常な VPBS50 速報（江東区 `1310800`、east、baseline `2026-09-14T06:00:00.000Z`）を保存し、一覧が `available` である状態。
- 否定条件ケース（以下の未対応構造失敗を投入）:
  1. **別種別**: 対象外種別（`VPFD51`）の未対応構造失敗（時刻 `06:10:00.000Z`、江東区、east）
  2. **別区域**: 対象外区域（新潟地方 `150010`）の未対応構造失敗（時刻 `06:10:00.000Z`、VPBS50、east）
  3. **別会場**: 対象外会場（`trc`）の未対応構造失敗（時刻 `06:10:00.000Z`、VPBS50、江東区）
  4. **過去時刻**: baseline（`06:00:00.000Z`）より過去（`05:00:00.000Z`）の未対応構造失敗（VPBS50、江東区、east）
- 期待値:
  - east端末からの GET `/api/weather/bulletins?terminalId=hkeagh01&controlStatus=normal` で、一覧全体の `availability` が `available` のままであること。

### 3.5 #37（アメダス）の複数観測時点
- 目的: 複数観測時点が存在する場合に `observations` が観測時刻の昇順で並び、`latestObservedAt` が最終要素の `observedAt` と一致することを検証する。
- 保存データ:
  - 同一地点（`44136`）に対して、2時点以上の観測データ（例: `2026-09-14T05:00:00.000Z` と `2026-09-14T06:00:00.000Z`）を保存。
- 期待値:
  - `data.observations.length >= 2`
  - `observations` の各要素の `observedAt` が昇順であること。
  - `data.latestObservedAt === observations[observations.length - 1].observedAt` であること。

## 4. 受け入れ条件

- [ ] 上記5項目それぞれに対応する自動テストが追加され、`npm run test -w apps/api` で実行される
- [ ] 各テストは実装を意図的に壊して実際に落ちることを確認してから完成とする（テスト検証業務標準 docs/rules/05-verification-protocol.md のred確認必須）
- [ ] `npm run lint` / `npm run typecheck` / `npm run format:check` が成功する
- [ ] `npm run test -w packages/shared` および `npm run build` が成功する

## 5. 検証手順

テスト検証業務標準に従い、以下の手順を実施する:
1. 対照実験（意味を変えないコメント挿入等で全テストが通ることの確認）
2. 5観点それぞれのミューテーション注入によるRed確認
3. 全体静的検査およびビルド・テスト実行
