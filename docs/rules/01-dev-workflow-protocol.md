---
title: 開発フロー業務標準
description: Issue駆動4フェーズの必須順序、設計→製造の承認ゲート、AGY委託の必須記載事項、ブランチ・コミット・PR・署名フォーマットの必須要件、devサーバーの禁止事項
phases: [ヒアリング, 設計, 製造, 検収]
products: [Claude, Codex, Antigravity]
---

# 開発フロー業務標準

対象: 統括担当、および各フェーズの担当。ノウハウ・背景は[G-01-hearing-first-design.md](advisory/G-01-hearing-first-design.md)・[G-02-dev-server-etiquette.md](advisory/G-02-dev-server-etiquette.md)・[G-03-external-review.md](advisory/G-03-external-review.md)を参照。

## 必須の実施順序

1. Issueごとに、ヒアリング→設計→製造→検収の順で進める。順序を入れ替えない、フェーズを飛ばさない。
2. サブエージェントはユーザーと直接対話できない。**ヒアリングは必ず統括担当が行う。**
3. **設計から製造に移行する場合、必ず一旦ターンを終了し、ユーザーの承認を受ける。** 承認を得ずに製造担当・AGYを起動しない。
4. 統括担当(メインセッション)は原則として実装を行わない(軽微な修正を除く)。設計・製造・検収はサブエージェントへ委任する。
5. 各担当への引き継ぎ情報は、対象Issue・ブランチ名・設計書パス・ヒアリング済みの確定事項に限定する。CLAUDE.md/AGENTS.md/業務標準・指導文書に既に書かれている内容を重ねて渡さない。ただしAntigravity等への製造委託プロンプトは、下記「AGY(Antigravity)への製造委託」の必須記載事項に従う(この制限の対象外とする)。

## 設計書の資産化(必須)

設計承認後、統括担当(設計担当がClaude以外の場合は、設計担当のモデル名・署名用メールアドレスを添えて)が設計書をコミットする。設計書は使い捨てにしない。

## AGY(Antigravity)への製造委託 — 依頼文に必須の記載事項

1. 対象の作業ディレクトリ・ブランチ・設計コミット
2. やること・やらないことの境界
3. 自己検証の手順
4. 最終報告のフォーマット

AGYの最終報告に必須の記載事項:

1. 変更ファイル一覧
2. 検証結果(実行したテストと設計書の受け入れ条件への合否は必ず含める)
3. 設計との差異
4. 迷って止めた点
5. 未解決事項

ユーザーがGUIでAGYを起動した場合は、Walkthroughファイルに最終報告を記載する。

## devサーバーの禁止事項

- 自分が起動していないdev/previewサーバーを含む**一括終了(`pkill -f vite`・`pkill node`等)は禁止**。
- 自分が起動したサーバーのみ、ポート指定で停止する。

## ブランチ・コミット・PRの必須要件

- ブランチ名は `<種別プレフィックス>/issue-<番号>-<短い説明>` とする。Issueによらない作業は、その都度統括担当が決める。
- コミットメッセージは、種別プレフィックス(`feat`/`fix`/`docs`/`chore`等)+ 日本語要約とする。
- コミットの粒度は、設計完了時に1回、製造時に2〜3回を目安とする(変更の規模に応じて増減してよい)。
- **製造担当の作業はコミットまでとし、push・PRの作成・本文の記述は検収担当が行う。**
- PR作成時、baseが`main`であることを確認する。
- 対応するIssue番号がある場合、PR本文に「Closes #<Issue番号>」を含める。
- 既にPRが存在する場合(差し戻し後の再検収等)は、`git push`で更新しPRにコメントで追加分を投稿する。新規PRは作らない。
- マージ後は`git merge-base --is-ancestor <マージコミット> origin/main`が真であることを確かめる。

### 署名(必須)

エージェントが書いた文章(コミットメッセージ・PR本文・コメント等)には、それを生成したアプリケーション・モデル名を必ず本文中に明記する。`gh`コマンドでの投稿は人間のアカウント名義になるため、本文中の明記で代える。

#### コミットメッセージ

以下の例による。

```
Co-Authored-By: Codex (GPT 5.6 Terra) <noreply@openai.com>
```

フォーマット中のモデル表示およびメールアドレスは、以下の表による。コミット署名は、誰がコミットしたかではなく、誰が書いたかで決定すること。

<!-- prettier-ignore -->

| 製品名 | モデル表示例 | メールアドレス |
| --- | --- | --- |
| Claude | `Claude (<model>)` | `<noreply@anthropic.com>` |
| Codex | `Codex (GPT <model>)` | `<noreply@openai.com>` |
| Antigravity | `Antigravity (<model>)` | `<gemini-code-assist@users.noreply.github.com>` |

#### PR・コメントの署名

以下の表の通りとする。PR・コメントの署名は、それを書いて投稿した担当のものを使用すること。

<!-- prettier-ignore -->

| 製品名 | 表示例 |
| --- | --- |
| Claude | `🤖 Generated with [Claude Code](https://claude.com/claude-code)` |
| Codex | `🤖 Generated with Codex` |
| Antigravity | `🤖 Generated with Antigravity` |
