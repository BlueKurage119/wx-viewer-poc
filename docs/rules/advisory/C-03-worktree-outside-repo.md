---
title: worktreeはリポジトリ外に作る
description: リポジトリ内にworktreeを作るとlint/testが他worktreeを誤走査する。settings.jsonのworktree.locationはCLI/Agentツールに未対応
phases: [ヒアリング, 設計, 製造, 検収]
products: [Claude]
notes: Claude Code固有の設定(.claude/settings.json、EnterWorktree、Agentツールのisolation:"worktree")を前提とする。Codex/Antigravityでの同等機能は未確認
---

# worktreeはリポジトリ外に作る

対象: 統括担当。Issueの並行作業や、指導文書の再編のような大きな変更を隔離したワークツリーで進める場合に読む。

git worktreeをリポジトリ内(例: `<repo>/.claude/worktrees/`配下)に作ると、複数worktree(複数セッション)が並行稼働している状況で問題が起きる。あるセッションのlint/testが、他セッションのworktree内の(まだ完成していない・意図的に壊れている)コードまで検査対象に含めてしまい、本来無関係のはずの受け入れ条件が満たせなくなる。

## `.claude/settings.json`の`worktree.location`だけに頼らない

この設定は公式には「デスクトップアプリがSSHセッション用worktreeを作る場所」を指す機能であり、CLI経由(`--worktree`、`EnterWorktree`、Agentツールの`isolation: "worktree"`)には現時点で反映されないとドキュメントに明記されている。設定していても効いているとは限らない。

## 対処

新しくworktreeが必要な場面(`Agent`ツールで`isolation: "worktree"`を使う、`EnterWorktree`を呼ぶ、大きな変更を隔離したい等)では、可能な範囲でリポジトリの親ディレクトリの外側にあたるパスを明示的に指定する。例: リポジトリの親ディレクトリ直下に`.worktrees/<リポジトリ名>-<用途>`のような専用ディレクトリを作り、そこにworktreeを追加する。

設定や指定が実際に効いているか(次にworktreeが作られる際、意図した場所に作られるか)を確認し、効いていなければ別の回避策を探る。

**出典:** 本プロジェクトでの実運用時の差し戻し事例。`docs/rules`の再編(本ファイルを含む一連の変更)も、リポジトリ外のworktreeで作業してこの問題を回避した。
