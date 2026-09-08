# Issue #3「A3. 共通メタ情報の型定義」設計

作成日: 2026-09-09

## 1. 目的

情報種別単位の API レスポンスが共通で持つ取得・鮮度・有効期間のメタ情報を、フロントエンドとバックエンドで同一の TypeScript 型として利用できるようにする。

本 Issue は API エンドポイント、DB スキーマ、気象情報の個別ペイロード、通知用データを実装しない。

## 2. 参照資料と確定事項

- [Issue #3](https://github.com/BlueKurage119/wx-viewer-poc/issues/3)
- [基本設計](../basic-design.md) §6.2、§6.3、§6.5
- [Issue 化ドラフト](../issues-draft.md) A3
- [Issue #1 設計](issue-1-project-initialization.md) §3.1

ヒアリングで、次を確定した。

- 型の共有先は既存 workspace の `@wx-viewer-poc/shared` とする。
- 時刻値は UTC の ISO 8601 文字列で表す。
- 情報種別に該当しない有効期間、初期取得前の最終成功時刻、版情報は、キーを省略せず `null` で表す。

基本設計 §6.2 の URL、HTTP メソッド、情報種別ごとの個別ペイロードは、本 Issue では決めない。

## 3. 公開する型

`packages/shared/src/index.ts` から、次の型を公開する。

```ts
export type Availability = 'available' | 'stale' | 'unavailable';

export type UtcIso8601String = string;

export interface CommonMetadata {
  source: string;
  issuedAt: UtcIso8601String;
  validAt: UtcIso8601String | null;
  validFrom: UtcIso8601String | null;
  validTo: UtcIso8601String | null;
  fetchedAt: UtcIso8601String;
  lastSuccessAt: UtcIso8601String | null;
  availability: Availability;
  sourceVersion: string | null;
}
```

`UtcIso8601String` は通信境界で `Date` を渡さないことを示す意味的な別名であり、実行時の形式検証は担わない。外部入力の厳密な検証は、各 API 実装 Issue で扱う。

`source` は提供元を表す非空文字列、`issuedAt` は情報の発表時刻、`fetchedAt` はこのレスポンスの元となる取得試行時刻として、いずれも常に値を持つ。初期取得中・失敗時でもレスポンスを生成する根拠となる取得試行は存在するためである。

有効期間の三つのキーは、単一時点の有効期限には `validAt`、範囲を持つ情報には `validFrom` と `validTo` を使う。利用しないキーは `null` とする。相互排他や時刻順序の実行時検証は、この共通型では行わない。

`availability` の意味は基本設計 §6.3 をそのまま引き継ぐ。`stale` を boolean や `unavailable` に縮退させない。

## 4. モジュール構成と利用方法

既存の `packages/shared` を API 契約の唯一の型定義元とする。個別アプリに型を複製しない。

```text
packages/shared/src/index.ts       # CommonMetadata、Availability、UtcIso8601String を export
apps/api/package.json              # @wx-viewer-poc/shared を workspace 依存として宣言
apps/web/package.json              # @wx-viewer-poc/shared を workspace 依存として宣言
apps/api/src/metadata.ts           # 型の import 到達性を最小限にコンパイル確認
apps/web/src/metadata.ts           # 型の import 到達性を最小限にコンパイル確認
```

アプリ側の確認用コードは API や画面の振る舞いを変えない。各 workspace が `import type { CommonMetadata } from '@wx-viewer-poc/shared'` を解決できることを、型注釈を持つ最小限のローカル定義で確認する。将来の API Issue はこの型と情報種別固有の payload 型を合成してレスポンス型を定義する。

workspace 内の既存パッケージを参照する npm の依存バージョンには、共有パッケージと一致する `0.1.0` を用いる。`packages/shared` のビルド成果物を参照する既存の exports 構成を維持し、パスエイリアスや個別アプリからの相対 import は導入しない。

## 5. テストと受け入れ条件

### 5.1 単体テスト

実行時ロジックを追加しないため、この Issue 単独のランタイム単体テストは追加しない。型の受け入れ確認は TypeScript コンパイルで行う。

### 5.2 受け入れ条件

1. `CommonMetadata` が Issue #3 に列挙された全フィールドを持つ。
2. `availability` は `available`、`stale`、`unavailable` の三状態を表現し、boolean 化されない。
3. 時刻フィールドは `UtcIso8601String` を使い、値がない `validAt`、`validFrom`、`validTo`、`lastSuccessAt` は `null` で表現できる。
4. `sourceVersion` は `string | null` で表現できる。
5. API・Web の両 workspace が `@wx-viewer-poc/shared` から同一型を import して型検査に通る。
6. `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` が成功する。

## 6. 後続 Issue への引き継ぎ

- A4 は `Availability` の三状態を入力・出力として用い、`stale` 時に前回値を保持する §6.3 の状態遷移を実装する。
- Epic E は `CommonMetadata` と情報種別固有 payload を組み合わせ、REST API のレスポンス型・入力検証・シリアライズを定義する。
- Epic B は `lastSuccessAt`、`sourceVersion` 等の永続化方法を DB スキーマで具体化する。
- Epic D の通知データは本型の対象外とし、別の契約として定義する。

## 7. 未確認事項

なし。`source` の具体的な識別子体系、`sourceVersion` の値の由来、情報種別ごとの有効期間の使い分けは、実データと公式資料を照合する各取得・API Issue で確定する。
