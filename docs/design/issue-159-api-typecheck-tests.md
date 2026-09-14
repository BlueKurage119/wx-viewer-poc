# Issue #159: apps/api の typecheck 対象に tests/ を含める

## 背景

`apps/api/tsconfig.json` の `include` が `["src"]` のみで、`tests/` ディレクトリのテストコードが `npm run typecheck` の対象外になっている。PR #157 の製造時にも `startServer` の `await` 漏れや存在しないプロパティ指定が tsc で検出されず、実行時まで発覚しなかった。

## 現状のtsconfig構成

| ファイル | 用途 | include | rootDir | outDir |
|---|---|---|---|---|
| `tsconfig.json` | typecheck (`tsc --noEmit`) | `["src"]` | `"src"` | `"dist"` |
| `tsconfig.build.json` | build (`tsc -p`) | extends tsconfig.json | (継承: `"src"`) | (継承: `"dist"`) |

## 事前調査結果: 型エラーの規模

tests/ を include に含めた一時的な設定で検査したところ、**542件の型エラー**が検出された。

### エラー種別の内訳

| 種別 | 件数 | 内容 | 修正パターン |
|---|---|---|---|
| TS2532 / TS18048 | 404件 | `Object is possibly 'undefined'` | `noUncheckedIndexedAccess` による配列アクセス。`!` 非nullアサーションで対処 |
| TS2345 / TS2322 | 54件 | 型の不一致 | テストデータの型修正 |
| TS2739 / TS2741 | 33件 | プロパティ不足 | テストデータへの必須プロパティ追加 |
| TS2353 | 14件 | 存在しないプロパティ指定 | テストデータの修正 |
| TS2339 | 10件 | 型に存在しないプロパティアクセス | 型キャスト or テストコード修正 |
| TS2305 / TS2304 / TS2724 | 10件 | import/名前解決エラー | 正しい型名への修正 |
| TS6133 | 4件 | 未使用変数 | 変数削除 or `_` プレフィックス |
| その他 | 13件 | TS2349, TS2698, TS2571 等 | 個別対応 |

### 影響ファイル(上位10件)

| ファイル | エラー数 |
|---|---|
| `jmaVpwp50Parser.test.ts` | 61 |
| `repositories.test.ts` | 58 |
| `issue33WarningRestApis.test.ts` | 44 |
| `nowcastService.test.ts` | 43 |
| `kikikuruApi.test.ts` | 37 |
| `jmaXmlPolling.test.ts` | 37 |
| `fetchHealthNotificationPlanner.test.ts` | 32 |
| `fetchHealthMonitorService.test.ts` | 32 |
| `nowcastApi.test.ts` | 21 |
| `historyRepositories.test.ts` | 21 |

## 変更方針

### tsconfig構成: tsconfig.json を型検査専用、tsconfig.build.json をビルド専用に分離

```
tsconfig.json (型検査用: noEmit)
  ├── include: ["src", "tests"]
  ├── rootDir: "."        ← "src" → "." に変更
  └── outDir: 削除        ← noEmit専用なので不要

tsconfig.build.json (ビルド用: emit)
  ├── extends: tsconfig.json → tsconfig.base.json に変更(独立化)
  ├── include: ["src"]
  ├── exclude: ["src/**/*.test.ts"]
  ├── rootDir: "src"
  └── outDir: "dist"
```

`tsconfig.build.json` を `tsconfig.json` の extends から切り離す理由: `rootDir` を `"."` に変更すると、build時の dist/ 以下に `tests/` ディレクトリが生成されてしまう。build用の設定は独立させて `rootDir: "src"` を維持する必要がある。

### テストコードの型エラー修正方針

- **TS2532/TS18048 (404件)**: テストコードでの配列インデックスアクセスに `!` 非nullアサーションを使用。テストでは配列の中身がセットアップで確定しているため、実行時の安全性に影響はない
- **TS2739/TS2741/TS2353**: テストデータの型不整合修正(不足プロパティの追加、不正プロパティの削除)
- **TS2305/TS2304/TS2724**: 正しいexport名への修正(例: `AreaTimeseriesTimeDefine` → `AreaTimeseriesTimeDefineDto`)
- **TS6133**: 未使用変数の削除 or `_` プレフィックス
- **TS2339**: 型に存在しないプロパティアクセスの修正

## 変更対象ファイル

### tsconfig関連

- `apps/api/tsconfig.json` — include に tests 追加、rootDir を "." に変更、outDir 削除
- `apps/api/tsconfig.build.json` — extends を tsconfig.base.json に変更し自己完結化

### テストファイル (約30ファイル)

542件の型エラーを修正。

## 受け入れ条件

- `npm run typecheck -w apps/api` が `apps/api/tests/**/*.test.ts` を検査対象に含む
- 意図的に型不整合（存在しないプロパティ指定等）をテストコードに注入すると `npm run typecheck` が失敗することを確認する
- 既存の `npm run test -w apps/api` ・ `npm run build` が引き続き成功する

## 検証手順

```bash
npm run typecheck -w apps/api
npm run test -w apps/api
npm run build
npm run lint
npm run format:check
```
