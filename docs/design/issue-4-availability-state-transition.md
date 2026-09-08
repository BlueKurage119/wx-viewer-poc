# Issue #4「A4. availability 状態遷移の実装」設計

作成日: 2026-09-09

## 1. 目的

各情報種別 API の `availability` を、取得処理や遅延・異常の具体的な閾値から分離した共通の純粋関数で判定する。`available`、`stale`、`unavailable` の三状態を縮退させず、後続の取得・保存・API 実装が同じ判定を利用できるようにする。

本 Issue は、取得の成功・失敗の検出、鮮度を判定する時刻閾値、前回正常値の保存、REST API、UI 表示を実装しない。

## 2. 参照資料と確定事項

- [Issue #4](https://github.com/BlueKurage119/wx-viewer-poc/issues/4)
- [基本設計](../basic-design.md) §6.2、§6.3、§9.2
- [Issue 化ドラフト](../issues-draft.md) A4
- [Issue #3 設計](issue-3-common-metadata.md) §3、§6

ヒアリングで、次を確定した。

- 判定関数は `hasLastNormalValue` と、呼び出し元が判定済みの鮮度状態（`normal` / `delayed` / `abnormal`）を受け取る純粋関数とする。
- 遅延・異常を決める具体的な条件・閾値は本 Issue の対象外とする。
- 実装はこの設計書のレビュー承認後に Agy へ委託する。

`hasLastNormalValue` は、現在の取得成功値を保存した直後も含め、「表示可能な前回正常値が存在する」ことを表す。空の正常な発表結果も有効な値として保存済みなら `true` であり、正常な発表なしと `unavailable` を混同しない。

## 3. 判定契約

### 3.1 公開する型と関数

`packages/shared/src/availability.ts` に次を定義し、`packages/shared/src/index.ts` から再 export する。

```ts
export type Availability = 'available' | 'stale' | 'unavailable';

export type FreshnessStatus = 'normal' | 'delayed' | 'abnormal';

export interface AvailabilityInput {
  hasLastNormalValue: boolean;
  freshness: FreshnessStatus;
}

export function resolveAvailability(input: AvailabilityInput): Availability;
```

既存の `Availability` は `availability.ts` へ移し、`index.ts` は `Availability` を含む全公開型・関数を再 export する。パッケージ利用者の import 先は `@wx-viewer-poc/shared` のまま維持する。

### 3.2 判定表

| `hasLastNormalValue` | `freshness` | 結果 |
| --- | --- | --- |
| `false` | `normal` | `unavailable` |
| `false` | `delayed` | `unavailable` |
| `false` | `abnormal` | `unavailable` |
| `true` | `normal` | `available` |
| `true` | `delayed` | `stale` |
| `true` | `abnormal` | `stale` |

保持値がなければ、鮮度状態が何であっても `unavailable` とする。保持値がある場合にだけ、鮮度が `normal` なら `available`、`delayed` または `abnormal` なら `stale` とする。

この関数は現在の `availability` を入力に取らない。状態遷移は取得・保存層が入力を更新して再判定することで表す。これにより、`unavailable → available`（初回正常値の保存）、`available → stale`（鮮度低下）、`stale → available`（次回正常取得）、`stale → unavailable`（保持値喪失）を同一規則で扱える。

## 4. モジュール構成

```text
packages/shared/src/availability.ts        # 入力型、鮮度状態、判定関数、Availability
packages/shared/src/index.ts               # shared パッケージ公開 API の再 export
packages/shared/tests/availability.test.ts # 判定表に対応する単体テスト
packages/shared/package.json               # test スクリプトと test 用依存
```

共有ロジックは API・Web のいずれにも置かない。後続 workspace は `@wx-viewer-poc/shared` から `resolveAvailability` と関連型を import する。

既存の Web テストと同じ Node.js 組み込みテストランナーを使用する。shared workspace に `test` スクリプトとして `node --import tsx --test tests/*.test.ts` を定義し、`tsx` を shared の開発依存に明記する。ルートにたまたま hoist されている依存には依存しない。

## 5. テストと受け入れ条件

### 5.1 単体テスト

`packages/shared/tests/availability.test.ts` で、§3.2 の六組すべてをテーブル駆動で検証する。各ケースは `resolveAvailability` の戻り値を完全一致で確認する。

次の性質も個別に確認する。

- `hasLastNormalValue: false` の三ケースはすべて `unavailable` になる。
- `hasLastNormalValue: true` の `delayed` と `abnormal` は、いずれも `stale` になる。
- `normal` かつ保持値ありだけが `available` になる。

テストは実装前に追加して `npm run test -w packages/shared` が失敗すること（red）を確認する。実装後は、判定表のいずれか一行を意図的に変更してテストが失敗することを確認してから元に戻し、テストが判定を検出できることを確かめる。

### 5.2 受け入れ条件

1. `Availability` は `available`、`stale`、`unavailable` の三状態を表現し、boolean や二状態に縮退しない。
2. 保持する正常値がない場合は、鮮度状態にかかわらず `unavailable` となる。
3. 保持する正常値があり、鮮度が `normal` の場合は `available` となる。
4. 保持する正常値があり、鮮度が `delayed` または `abnormal` の場合は `stale` となり、保持値の内容を破棄しない。
5. §3.2 の六組を完全一致で検証する単体テストが成功する。
6. `npm run test -w packages/shared`、`npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` が成功する。

## 6. 後続 Issue への引き継ぎ

- Epic B/C/D は、取得成功時に正常値を保存したかを `hasLastNormalValue` として渡し、時刻・再試行・遅延異常基準から導いた `FreshnessStatus` を渡す。閾値そのものはこの関数へ持ち込まない。
- Epic E は `resolveAvailability` の結果を Issue #3 の `CommonMetadata.availability` に設定する。
- Epic G9 は `available`、`stale`、`unavailable` を三状態のまま表示に反映し、`stale` では前回正常値を表示し続ける。
- 保存層が保持値を明示削除する場合は `hasLastNormalValue: false` を渡す。今回の履歴保持ポリシーにより通常の自動削除は行わない。

## 7. 未確認事項

なし。`FreshnessStatus` を導く遅延・異常の具体的な時刻閾値、取得失敗・再試行との接続、および保持値の永続化は後続 Issue で実データと運用要件に基づいて決定する。
