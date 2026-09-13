---
title: 開発フローの背景・ノウハウ
description: ヒアリング前提の設計になっている理由、署名フォーマットの参照表、devサーバー作法の背景、外部レビューの起動条件
phases: [ヒアリング, 設計, 製造, 検収]
products: [Claude, Codex, Antigravity]
---

# 開発フローの背景・ノウハウ

対象: 統括担当・各フェーズの担当。必須事項は[01-dev-workflow-protocol.md](../protocol/01-dev-workflow-protocol.md)を参照。ここには背景・理由・具体的なフォーマットだけを置く。

## なぜヒアリング前提なのか

`docs/issues-draft.md`のIssue項目は「実装タスク単位の見出し+参照する基本設計の章番号」程度のあっさりした内容であり、実装方針を左右する論点の多くが未確定のまま残っている。このプロジェクトが他プロジェクトの3体構成と異なり、設計着手前に統括担当によるヒアリングフェーズを挟んでいるのはこのため。`docs/design/issue-1-project-initialization.md`が設計書の書式・粒度の手本。

## 署名フォーマット

- **Claude** — コミット末尾: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` / PR本文・コメント末尾: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- **Codex** — コミット末尾: `Co-Authored-By: Codex (GPT <model> <推奨モデル名>) <noreply@openai.com>` / PR本文・コメント末尾: `🤖 Generated with Codex`
- **Antigravity(委託先として製造した場合)** — コミット末尾: `Co-Authored-By: Antigravity <gemini-code-assist@users.noreply.github.com>` / PR本文・コメント末尾: 委託元(Claude/Codex)の形式に従う

## devサーバー作法の背景

**出典:** `mj-stats-viewer`での差し戻し事例。オーナーが検証用に自分でdevサーバーを立てていた回に、エージェントが無関係なサーバーごと一括終了させた。ポート番号は日によって違うことがあるため固定で覚えず、その都度の状況を確認する(例: 停止は`pkill -f "vite --port <自分のポート>"`のようにポート指定で行う)。wx-viewer-pocは`npm run dev`でweb(5174)+api(3001)を固定ポートで起動する(README参照)。

## 外部レビューへの向き合い方

- 外部ツールによるコードレビューは、統括担当がトリアージ(要対応・先送り・無視)を行ってから、本当に必要なものだけを提示する。年に1回あるかどうかのバグに何時間と何万トークン費やして直しても費用対効果が薄い。
- レビューへの回答・解決済みマークは統括担当が行う。再レビューの要求はユーザーが行う。修正が局所的で、指摘を再現する回帰テストを追加しすべての必須検証が通った場合、再レビュー不要と統括担当が提案してよい。
- **出典: `mj-stats-viewer`での起動条件の実績。** 外部レビュー(Codexの自動PRレビュー等)は、PRを開いたとき・Draftを Readyにしたとき・`@codex review`とコメントしたときに走る。**既存PRへの単なるpushだけでは自動起動しない。** 修正後の再レビューを依頼する場合は、明示的なコメントで起動すること。
