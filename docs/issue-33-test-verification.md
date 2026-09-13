# Issue #33〜#35 テスト有効性検証記録

実施日: 2026-09-14  
担当: Antigravity（Gemini 3.8 Flash）  
対象ブランチ: `codex/issue-33-warning-rest-apis`  
仕様: [承認済み設計](design/issue-33-warning-rest-apis.md)  
製造コミット: `267ce669f12a9b835cab2c7781220f54a4d03f7f`  
標準規約: [docs/rules/05-verification-protocol.md](rules/05-verification-protocol.md)  

## 対象テスト

1. `packages/shared/tests/weatherApi.test.ts`
2. `apps/api/tests/issue33WarningRestApis.test.ts`

---

## 1. 対照実験（Control Experiment）

意味を変えないダミー改変（コメント挿入）を各実装ファイルに加え、テストが成功（SURVIVED, exit 0）することを確認した。

| 対象ファイル | ダミー改変内容 | 実行コマンド | 結果 |
| --- | --- | --- | --- |
| `packages/shared/src/weatherApi.ts` | ファイル先頭付近に `// control experiment dummy comment` を追加 | `npm test -w packages/shared` | **SURVIVED** (exit 0, 36 passed) |
| `apps/api/src/services/weatherApiService.ts` | `createWeatherApiService` 前に `// control experiment dummy comment for verification protocol` を追加 | `npx tsx --test tests/issue33WarningRestApis.test.ts` | **SURVIVED** (exit 0, 16 passed) |

---

## 2. red確認（Mutation Testing / 意図的な実装破壊）

各受け入れ条件・仕様に対応する実装コードを意図的に壊し、テストが期待通り失敗（KILLED, exit 1）することを確認した。

| 観点 / 受け入れ条件 | 意図的な実装破壊内容 | 破壊対象ファイル・箇所 | 検出したテスト（失敗箇所） | 判定結果 |
| --- | --- | --- | --- | --- |
| **共通クエリ検証** (余剰キー拒否) | `keys.length !== 2` の検証チェックをコメントアウト（余剰キーを許容） | `packages/shared/src/weatherApi.ts`<br>`parseWeatherApiQuery` | `parseWeatherApiQuery: 異常系 - パラメーター欠落・余剰キー・型不正・不正値は invalid_request になる`<br>(deepStrictEqual エラー: expected invalid_request, actual ok: true) | **KILLED** (exit 1) |
| **A1** (会場別解決) | snapshot 取得時の対象区域コードを不正値 `'9999999'` に変更 | `apps/api/src/services/weatherApiService.ts`<br>`getWarnings` | `A1: 会場別解決 - east (江東区), trc (大田区) のみ返り、他区域 sentinel は混ざらない。早期注意は共通広域`<br>(strictEqual エラー: expected '1310800', actual '9999999') | **KILLED** (exit 1) |
| **A2** (入力バリデーション) | クエリ検証失敗時に 400 ではなく 200 を返却するように改変 | `apps/api/src/app.ts`<br>`/api/weather/warnings` ハンドラー | `A2: 入力バリデーション - 3 API 共通の厳格な検証 (400, 404, 200)`<br>(strictEqual エラー: 200 !== 400) | **KILLED** (exit 1) |
| **A5** (#33 allowlist/capabilities) | `unsupportedKindCodes` を `[]`（空配列）に改変 | `apps/api/src/services/weatherApiService.ts`<br>`capabilities` 定義 | `A5: #33 の allowlist と capabilities（04, 18 未対応明示、内部IDや未抽出項目の排除）`<br>(deepStrictEqual エラー: actual `[]`, expected `['04', '18']`) | **KILLED** (exit 1) |
| **A6 / A7** (VPWP50 Addition/Note 抽出) | `extractAdditionElement` 内の `additions.push(...)` をコメントアウト（Note が抽出されない） | `apps/api/src/polling/jmaVpwp50Parser.ts`<br>`extractAdditionElement` | `A6: 公式 VPWP50 実電文 fixture で新潟市（1510000）の雷危険度付加事項（竜巻、ひょう）の出現順パースと API 提供`<br>(strictEqual エラー: 0 !== 2) | **KILLED** (exit 1) |
| **A10** (旧スキーマ互換) | `additions_parsed === 0`（旧データ）時の additions 初期値を `null` ではなく `[]` に改変 | `apps/api/src/repositories/warningTimeseriesRepository.ts`<br>`findWarningTimeseriesSnapshot` | `A10: 旧 schema からのマイグレーションで既存値維持 (additions=null, scope=null)、新規正常採用で配列へ移行、foreign_key_check 空`<br>(strictEqual エラー: `[]` !== `null`) | **KILLED** (exit 1) |
| **A13** (時系列 timeTo 境界判定) | `nowMs >= maxToMs` を `nowMs > maxToMs`（同時刻で stale にならない）に改変 | `apps/api/src/services/weatherAvailability.ts`<br>`evaluateWeatherAvailability` | `A13: #34/#35 timeTo 判定（直前 available、一致・経過後は stale）。near 期限切れ/far 有効、near 未取得/far 有効の独立性`<br>(strictEqual エラー: expected 'stale', actual 'available') | **KILLED** (exit 1) |
| **A14** (#35 早期注意 null rank 維持) | `cells.map` 内で `rankValue: c.rankValue ?? '無'` と null を文字列で補完するように改変 | `apps/api/src/services/weatherApiService.ts`<br>`getEarlyWarning` | `A14: #35 早期注意 - timeFrom/timeTo と near/far 区分が不変。null rank と condition が維持される`<br>(strictEqual エラー: '無' !== null) | **KILLED** (exit 1) |
| **A17** (新着解析失敗の時刻比較) | `r.report_datetime > :baselineReport` を `>=`（同時刻でも失敗とみなす）に改変 | `apps/api/src/repositories/weatherParseFailureRepository.ts`<br>`hasNewerWeatherParseFailure` | `A17: hasNewerWeatherParseFailure - 時刻比較（.000Z vs Z 等値、.001Z 新規、.999Z 過去）、種別・会場・区域条件独立性と回復`<br>(strictEqual エラー: true !== false) | **KILLED** (exit 1) |

---

## 3. 復旧確認（Reversion & Restoration）

すべての意図的改変・ダミーコメントを原状復帰（`git checkout`）し、作業ツリーが clean であること、および対象テストがすべて成功（exit 0）することを確認した。

- 作業ツリー状態: `git status` → `nothing to commit, working tree clean`
- `npx tsx --test packages/shared/tests/weatherApi.test.ts`: **PASS** (exit 0, 2/2 passed)
- `npx tsx --test apps/api/tests/issue33WarningRestApis.test.ts`: **PASS** (exit 0, 16/16 passed)

---

## 4. 全検証コマンドの実行結果

業務標準で定められた全検証コマンドを順次実行し、すべて合格した。

1. `npm run lint`: **合格** (0 errors, 0 warnings, `--max-warnings 0`)
2. `npm run typecheck`: **合格** (全 workspaces 合格)
3. `npm run format:check`: **合格** (All matched files use Prettier code style!)
4. `npm run test -w apps/api`: **合格** (全 555 テスト通過、0 失敗)
5. `npm run test -w packages/shared`: **合格** (全 36 テスト通過、0 失敗)
6. `npm run build`: **合格** (shared → api → web 正常ビルド完了)

---

## 6. PR #155 レビュー指摘対応（A6・A7・A11 補強）のテスト有効性検証記録

実施日: 2026-09-14  
担当: Antigravity（Gemini 3.8 Flash）  
対象: 受入条件 A6, A7, A11 のテスト補強（プロダクションコード変更なし）

### 6.1 対照実験（Control Experiment）

各テストケースに意味を変えないダミー改変（コメント挿入）を加え、テストが成功（SURVIVED, exit 0）することを確認した。

| 対象テスト | ダミー改変内容 | 実行コマンド | 結果 |
| --- | --- | --- | --- |
| **A6** | `// control experiment dummy comment for A6` を追加 | `npx tsx --test --test-name-pattern="A6:" apps/api/tests/issue33WarningRestApis.test.ts` | **SURVIVED** (exit 0, 1 passed) |
| **A7** | `// control experiment dummy comment for A7` を追加 | `npx tsx --test --test-name-pattern="A7:" apps/api/tests/issue33WarningRestApis.test.ts` | **SURVIVED** (exit 0, 1 passed) |
| **A11** | `// control experiment dummy comment for A11` を追加 | `npx tsx --test --test-name-pattern="A11:" apps/api/tests/issue33WarningRestApis.test.ts` | **SURVIVED** (exit 0, 1 passed) |

### 6.2 red確認（Mutation Testing / 意図的な実装破壊）

各補強観点に対応する実装コードを意図的に壊し、テストが期待通り失敗（KILLED, exit 1）することを確認した。

| 観点 / 受け入れ条件 | 意図的な実装破壊内容 | 破壊対象ファイル・箇所 | 検出したテスト（失敗箇所） | 判定結果 |
| --- | --- | --- | --- | --- |
| **A6** (通常処理経由のAPI応答とadditions伝播) | `additions` を `null` に改変して API 応答データに付加事項が伝播しないようにした | `apps/api/src/services/weatherApiService.ts`<br>`getWarningTimeseries` 内の `data` 生成箇所 | `A6: 公式 VPWP50 実電文 fixture で新潟市（1510000）の雷危険度付加事項（竜巻、ひょう）の出現順パースと通常処理・API提供の検証`<br>(TypeError: Cannot read properties of null (reading 'filter')) | **KILLED** (exit 1) |
| **A7** (複数 Local/Base/Part/Property/Kind の scope 独立性) | `localIndex` の値を `999` に固定し、scope 添字計算を破壊した | `apps/api/src/polling/jmaVpwp50Parser.ts`<br>`localScope` 生成箇所 | `A7: 境界検証 - 複数 Kind/Property/Part/Base/Local の階層構造における scope 添字独立性と重複 Note 保持`<br>(AssertionError: actual localIndex 999 !== expected 0) | **KILLED** (exit 1) |
| **A11** (トランザクションロールバック原子性と全項目保持) | トランザクション保護を解除（直接実行）し、途中失敗時にロールバックされないようにした | `apps/api/src/repositories/warningTimeseriesRepository.ts`<br>`saveWarningTimeseriesSnapshot` | `A11: 保存トランザクション途中の例外で rollback され既存 snapshot（timeDefines/values/additions/scope）が完全に維持される。stale 保存では明細・Note・scope 全体を保持`<br>(AssertionError: actual 'src_attempted_update' !== expected 'src_initial') | **KILLED** (exit 1) |

### 6.3 復旧確認（Reversion & Restoration）

すべての意図的改変を原状復帰し、プロダクションコードに変更がないこと（テストおよび記録ドキュメントのみの変更であること）を確認した。

- `git diff --stat` による変更ファイル: `apps/api/tests/issue33WarningRestApis.test.ts` のみ
- `npx tsx --test apps/api/tests/issue33WarningRestApis.test.ts`: **PASS** (exit 0, 16/16 passed)

### 6.4 全検証コマンドの再実行結果

1. `npm run lint`: **合格** (0 errors, 0 warnings, `--max-warnings 0`)
2. `npm run typecheck`: **合格** (全 workspaces 合格)
3. `npm run format:check`: **合格** (All matched files use Prettier code style!)
4. `npm run test -w apps/api`: **合格** (全 555 テスト通過、0 失敗)
5. `npm run test -w packages/shared`: **合格** (全 36 テスト通過、0 失敗)
6. `npm run build`: **合格** (shared → api → web 正常ビルド完了)

---

## 7. 未解決事項

- なし。PR #155 のレビュー指摘3件（受入条件 A6・A7・A11）に対するテスト補強、対照実験、red確認、復旧確認、全検証コマンドがすべて完了した。

