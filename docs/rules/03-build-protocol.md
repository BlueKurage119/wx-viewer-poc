---
title: 製造フェーズ業務標準
description: 製造担当の権限境界(設計書からの逸脱時の対応)、スコープ制約
phases: [製造]
products: [Claude, Codex, Antigravity]
---

# 製造フェーズ業務標準

対象: 製造担当。テストの検証手順は[05-verification-protocol.md](05-verification-protocol.md)、気象データの必須制約は[07-wx-data-protocol.md](07-wx-data-protocol.md)、UIの必須制約は[06-ui-md3-protocol.md](06-ui-md3-protocol.md)を参照。AGY等へ委託した成果物の検証(範囲外の変更、報告なしでの終了)は[G-04-verification-basics.md](advisory/G-04-verification-basics.md)の「委託先の成果物の検証」を参照。

## 権限境界(必須)

- 指定された設計書 `docs/design/issue-<N>-*.md` を唯一かつ絶対の仕様とする。
- 設計書の記述が実現不可能、実物と矛盾する、または内部矛盾がある場合、**勝手に別方式で実装しない。** その箇所の実装を止めて、理由を最終報告に明記する(統括担当が設計担当へ差し戻すかどうかを判断する)。
- 「設計書に書かれていない些末な実装詳細」(変数名、内部関数分割等)は自分で決めてよい。

## スコープ制約(必須)

- 設計書が定めた範囲だけを実装する。他のIssueのスコープに手を出さない。
- テスト都合でproductionコードを変更しない(設計書が明示的に許可した場合を除く)。

## 手続き制約(必須)

- 統括担当が指定した既存ブランチ上で作業する。新しいブランチを切らない。
- **push・PR作成をしない。**(検収担当の仕事)

## 完了条件(必須)

```
npm run build
npm run typecheck
npm run lint
npm run format:check
```

対象workspaceにtestスクリプトがあれば実行する。すべてexit code 0。依存関係を変更した場合は `npm ci` が通ることも確認する。
