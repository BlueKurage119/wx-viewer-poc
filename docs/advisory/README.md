# 指導文書(Advisory)について

## 位置づけ

```
CLAUDE.md・AGENTS.md（薄い核: 概要・絶対禁止事項・ディレクトリと機密情報）
        │
        ▼
指導文書(docs/advisory/、このディレクトリ) — トピック別の詳細規律
        │
        ▼
各エージェントの機能（.claude/agents/*.md、メモリ）— 個別の役割・セッションでの適用
```

CLAUDE.md/AGENTS.mdは常時読み込まれる。そこに全ての詳細規律を書き込むと、無関係な作業(例: `docs/**`のみの変更)でも毎回全量が読み込まれ、かつ2ファイル間で内容が重複してドリフトする(実例: `docs: AGENTS.mdのチェック省略規定を具体化`と`docs: CLAUDE.mdのチェック省略規定を具体化`が別コミットになった)。

指導文書は、CLAUDE.md/AGENTS.mdからも`.claude/agents/*.md`からも参照される単一の正本とし、該当する作業・フェーズに入ったときだけ読みに行く。

## 一覧

- [dev-workflow.md](dev-workflow.md) — Issue駆動の4フェーズ運用、ヒアリング前提、AGY/Antigravity委託、ブランチ・コミット・PR・署名規約、devサーバー作法(統括・全フェーズ共通)
- [design-phase.md](design-phase.md) — ヒアリング前提の設計、判断に迷ったときの投げ返し方、設計書に必ず含めるもの(設計)
- [build-phase.md](build-phase.md) — 設計書からの逸脱時の対応、スコープ厳守(製造)
- [inspect-phase.md](inspect-phase.md) — 実際に実行して検証する原則、CI担保項目との重複排除、判定後の対応(差し戻し/PR作成)、収束の判断(検収)
- [verification-discipline.md](verification-discipline.md) — red確認・対照実験・完全一致原則・発見のトリアージ・回帰テストの罠・共有可変状態の系統調査・外部レビュー運用(製造・検収)
- [browser-ui-verification.md](browser-ui-verification.md) — ブラウザペインの既知の制約、機械検証できないUI項目の逆発注(検収、ブラウザでのUI確認を行うとき)
- [ui-md3-rules.md](ui-md3-rules.md) — Material Web/MD3の色トークン規約、破ると静かに壊れるフロントエンド制約(`apps/web`を触るとき)
- [wx-data-rules.md](wx-data-rules.md) — 気象庁XML電文の確定/未確定の扱い、`isTraining`、availability 3状態(気象データのパース・表示・通知を触るとき)

`design-phase.md`/`build-phase.md`/`inspect-phase.md`は、各フェーズの担当が「何を判断してよく、何を統括担当に投げ返すべきか」を定める。フェーズの運用手順(いつ誰が起動するか等)は`dev-workflow.md`、テスト技法は`verification-discipline.md`が担当し、住み分ける。

## 出典

`verification-discipline.md`・`browser-ui-verification.md`の一部項目は、このリポジトリでの発生事例だけでなく、技術スタックが近い他プロジェクト(`mj-stats-viewer`ほか)での実際の差し戻し事例から転用している。各項目に出典を明記する。

## frontmatter

各ファイルの先頭にYAML frontmatterを付け、人間が一覧性を得るための索引情報とする(メモリのような自動関連度マッチングは行わないため、`originSessionId`等の運用メタデータは持たない)。

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
- 新しい指導文書を追加したら、この表とfrontmatterの両方を更新する。

## 運用ルール

- 指導文書はコード同様、変更時にレビューを経る。恒久ルールの追加・変更はCLAUDE.md/AGENTS.mdの禁止事項7(【設計案】【未確定】記述の無断確定化)と同じ精神で、根拠なく確度を上げない。
- 個別セッションの学び(このIssueでの判断、この回の逸脱理由等)は指導文書ではなくメモリ(`type: feedback`/`project`)に置く。指導文書は複数Issue・複数セッションを越えて繰り返し当てはまる恒久ルールだけを置く。
