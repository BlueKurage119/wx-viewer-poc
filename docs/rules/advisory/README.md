# 指導文書(Advisory)について

## 位置づけ

```
CLAUDE.md・AGENTS.md（権限と責任: 絶対禁止事項、役割と担当の対応表）
        │
        ▼
業務標準(docs/rules/protocol/) — 必ず通る手順と合否条件
        │
        ▼
指導文書(docs/rules/advisory/、このディレクトリ) — 手順を実行するための知識・ノウハウ・過去事例
        │
        ▼
各エージェントの機能（.claude/agents/*.md、メモリ）— 個別の役割・セッションでの適用
```

指導文書は業務標準([docs/rules/protocol/](../protocol/README.md))の下位層であり、**業務標準が定める権限・必須工程・合否条件を追加・変更しない。** ここに書くのは、業務標準の手順を上手にこなすための知識(具体的な検証コマンド、環境固有の罠、過去の失敗事例)だけ。必須事項を書きたくなったら、業務標準の改訂として扱う(詳細は[docs/rules/protocol/README.md](../protocol/README.md)の統治原則を参照)。

指導文書は、業務標準・CLAUDE.md/AGENTS.md・`.claude/agents/*.md`からも参照される単一の正本とし、該当する作業・フェーズに入ったときだけ読みに行く。

## 一覧

- [01-dev-workflow.md](01-dev-workflow.md) — ヒアリング前提の設計になっている理由、署名フォーマット、devサーバー作法の背景、外部レビューの起動条件(統括・全フェーズ共通)
- [02-design-phase.md](02-design-phase.md) — ヒアリング前提の設計の背景、設計書の書式の手本(設計)
- [05-verification-discipline.md](05-verification-discipline.md) — 対照実験がなぜ必要か・循環アサーションの罠・回帰テストの向き・共有可変状態の系統調査・外部レビューの活用(製造・検収)
- [04-browser-ui-verification.md](04-browser-ui-verification.md) — ブラウザペインの既知の制約、逆発注の実務(検収、ブラウザでのUI確認を行うとき)
- [06-ui-md3-rules.md](06-ui-md3-rules.md) — UI寸法計測の罠、バンドル見積りの目安(`apps/web`のカード・ダッシュボード系レイアウトを触るとき)

製造・検収の権限境界(設計書からの逸脱時の対応・スコープ・受け入れ条件の合否判定)や気象データの必須制約は、現時点では業務標準([docs/rules/protocol/](../protocol/README.md))だけに書かれており、対応する指導文書はまだ無い(ノウハウが蓄積した時点で追加する)。

## 出典

`05-verification-discipline.md`・`04-browser-ui-verification.md`・`06-ui-md3-rules.md`の一部項目は、このリポジトリでの発生事例だけでなく、技術スタックが近い他プロジェクト(`mj-stats-viewer`ほか)での実際の差し戻し事例から転用している。各項目に出典を明記する。

## frontmatter

各ファイルの先頭にYAML frontmatterを付け、人間が一覧性を得るための索引情報とする(メモリのような自動関連度マッチングは行わないため、`originSessionId`等の運用メタデータは持たない)。業務標準(`docs/rules/protocol/`)も同じスキーマを使う。

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
- ある製品のツール固有の制約(例: Claude Codeのブラウザペインの挙動)を書いた文書は、`products`を該当製品だけに絞り、他製品での扱いが未確認なら`notes`に明記する。
- 新しい文書を追加したら、この表とfrontmatterの両方を更新する。

## 運用ルール

- 指導文書はコード同様、変更時にレビューを経る。恒久ルールの追加・変更はCLAUDE.md/AGENTS.mdの禁止事項7(【設計案】【未確定】記述の無断確定化)と同じ精神で、根拠なく確度を上げない。
- 指導文書に「必ずやるべきこと」を書きたくなったら、それは業務標準の改訂であって指導文書への追記ではない([docs/rules/protocol/README.md](../protocol/README.md)の統治原則を参照)。
- 個別セッションの学び(このIssueでの判断、この回の逸脱理由等)は指導文書ではなくメモリ(`type: feedback`/`project`)に置く。指導文書は複数Issue・複数セッションを越えて繰り返し当てはまる恒久的な知識だけを置く。
