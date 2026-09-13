# 指導文書(Advisory)について

## 位置づけ

```
CLAUDE.md・AGENTS.md（権限と責任: 絶対禁止事項、役割と担当の対応表）
        │
        ▼
業務標準(docs/rules/、このディレクトリの1つ上) — 必ず通る手順と合否条件
        │
        ▼
指導文書(docs/rules/advisory/、このディレクトリ) — 手順を実行するための知識・ノウハウ・過去事例
        │
        ▼
各エージェントの機能（.claude/agents/*.md、メモリ）— 個別の役割・セッションでの適用
```

指導文書は業務標準([docs/rules/](../README.md))の下位層であり、**業務標準が定める権限・必須工程・合否条件を追加・変更しない。** ここに書くのは、業務標準の手順を上手にこなすための知識(具体的な検証コマンド、環境固有の罠、過去の失敗事例)だけ。必須事項を書きたくなったら、業務標準の改訂として扱う(詳細は[docs/rules/README.md](../README.md)の統治原則を参照)。

指導文書は、業務標準・CLAUDE.md/AGENTS.md・`.claude/agents/*.md`からも参照される単一の正本とし、該当する作業・フェーズに入ったときだけ読みに行く。

## 一覧

- [A-01-codex-worktree-context.md](A-01-codex-worktree-context.md) — Codexの作業場所・ブランチ・既存差分と実行権限の確認例(全フェーズ)
- [A-02-codex-subagent-shared-work.md](A-02-codex-subagent-shared-work.md) — Codexの委任・共有作業場所・成果受領の確認例(全フェーズ)

- [G-01-hearing-first-design.md](G-01-hearing-first-design.md) — ヒアリング前提の設計になっている理由、設計書の書式の手本(ヒアリング・設計)
- [G-02-dev-server-etiquette.md](G-02-dev-server-etiquette.md) — devサーバー作法の背景(製造・検収)
- [G-03-external-review.md](G-03-external-review.md) — 外部レビューのトリアージ・起動条件・活用実績(検収)
- [G-04-verification-basics.md](G-04-verification-basics.md) — 検証の基本原則(実物確認・実測・反復テストの絞り込み)(設計・製造・検収)
- [G-05-test-effectiveness-verification.md](G-05-test-effectiveness-verification.md) — 対照実験がなぜ必要か、ミューテーションテストの限界(製造・検収)
- [G-06-regression-test-pitfalls.md](G-06-regression-test-pitfalls.md) — 循環アサーション、回帰テストが逆向きに固定してしまう罠(製造・検収)
- [G-07-shared-mutable-state-fixes.md](G-07-shared-mutable-state-fixes.md) — 共有可変状態の修正が半分で終わりやすい理由と対処(製造・検収)
- [G-08-ui-measurement-pitfalls.md](G-08-ui-measurement-pitfalls.md) — UI寸法計測の罠(`apps/web`のカード・ダッシュボード系レイアウトを触るとき)
- [G-09-bundle-budget-underestimate.md](G-09-bundle-budget-underestimate.md) — バンドルサイズの見積り不足と目安(設計)
- [C-01-browser-pane-visibility-limit.md](C-01-browser-pane-visibility-limit.md) — Claude Codeのブラウザペイン固有の制約(検収、ブラウザでのUI確認を行うとき)
- [C-02-ui-verification-backorder.md](C-02-ui-verification-backorder.md) — 機械で検証できないUI項目の逆発注の実務(検収)

製造・検収の権限境界(設計書からの逸脱時の対応・スコープ・受け入れ条件の合否判定)や気象データの必須制約は、現時点では業務標準([docs/rules/](../README.md))だけに書かれており、対応する指導文書はまだ無い(ノウハウが蓄積した時点で追加する)。

## 出典

`G-05〜G-09`・`C-01`・`C-02`の一部項目は、このリポジトリでの発生事例だけでなく、技術スタックが近い他プロジェクト(`mj-stats-viewer`ほか)での実際の差し戻し事例から転用している。各項目に出典を明記する。

## 命名・番号体系

```
[プレフィックス（A|C|G）]-[番号]-[タイトル].md
```

- **プレフィックス**は対象AI製品を表す。
  - `A`: Codex・Antigravity対象(内容がCodex/Antigravity固有のツール・挙動に依存する)
  - `C`: Claude対象(内容がClaude Code固有のツール・挙動に依存する)
  - `G`: 製品非依存の共通知識
  - frontmatterの`products`(「今どの製品がこのフェーズを担当するか」)とは別軸。「内容そのものが特定製品に依存するか」で判定する。例: `G-01-hearing-first-design.md`は`products: [Claude, Codex]`だが、内容自体はどちらのツールにも依存しないため`G`。
- **番号はプレフィックスごとに独立した連番**(A/C/Gそれぞれ1から数える。Gが9件でもCの次の番号はC-01から)。既存番号は不変。途中への追加は枝番、末尾への追加は続番、削除は欠番とする(`docs/design/issue-N-*.md`の運用を踏襲)。
- 業務標準側の対応ファイルとは、可能な限り同じ数字部分を揃える(現状は1対多の関係になっているものが多く厳密には揃っていない。今後1対1で追加する場合は揃える方針とする)。

## frontmatter

各ファイルの先頭にYAML frontmatterを付け、人間が一覧性を得るための索引情報とする(メモリのような自動関連度マッチングは行わないため、`originSessionId`等の運用メタデータは持たない)。業務標準(`docs/rules/`)も`title`/`description`/`phases`/`products`のスキーマを使う。

```yaml
---
title: 短い表題(このディレクトリ内で一意)
description: 何が書かれているかの1〜2文
phases: [対象フェーズ。ヒアリング/設計/製造/検収から該当するもの]
products: [対象AI製品。Claude/Codex/Antigravityから該当するもの]
notes: 補足(任意。製品固有の注記、参考程度に読む対象など)
---
```

- `phases`は「開発フローのどの段階で読むか」、`products`は「どのAI製品(Claude/Codex/Antigravity)が読む想定か」を表す独立した軸。担当サブエージェント名(`wxviewer-designer`等)はClaude側の実装詳細でありCLAUDE.md側の役割表で管理するため、frontmatterには含めない。
- ある製品のツール固有の制約(例: Claude Codeのブラウザペインの挙動)を書いた文書は、`products`を該当製品だけに絞り、他製品での扱いが未確認なら`notes`に明記する。ファイル名のプレフィックス(A/C/G)は、このfrontmatterの内容依存性判定と一致させる。
- 新しい文書を追加したら、この一覧とfrontmatterの両方を更新する。

## 運用ルール

- 指導文書はコード同様、変更時にレビューを経る。恒久ルールの追加・変更はCLAUDE.md/AGENTS.mdの禁止事項7(【設計案】【未確定】記述の無断確定化)と同じ精神で、根拠なく確度を上げない。
- 指導文書に「必ずやるべきこと」を書きたくなったら、それは業務標準の改訂であって指導文書への追記ではない([docs/rules/README.md](../README.md)の統治原則を参照)。
- 個別セッションの学び(このIssueでの判断、この回の逸脱理由等)は指導文書ではなくメモリ(`type: feedback`/`project`)に置く。指導文書は複数Issue・複数セッションを越えて繰り返し当てはまる恒久的な知識だけを置く。
