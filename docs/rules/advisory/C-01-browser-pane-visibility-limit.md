---
title: ブラウザペインのvisibilityState制約
description: Claude Codeのブラウザペインがhiddenのまま動作するため起きる誤診断
phases: [検収]
products: [Claude]
notes: Claude Codeのブラウザペイン(mcp__Claude_Browser__*)固有の制約。Codex/Antigravityの同等ツールで同じ制約が起きるかは未確認
---

# ブラウザペインのvisibilityState制約

対象: 主に`wxviewer-inspector`(検収)。ブラウザペイン(`mcp__Claude_Browser__*`)でUIを確認する場面全般。

**出典: `mj-stats-viewer`での差し戻し事例。**

Claude Codeのブラウザペインは`document.visibilityState === "hidden"`のまま動作する。そのため次の事象が起きる。

- **Web Animations APIが進行せず、アニメーション完了イベント(`animation.finished`等)が永久に解決しない。** `document.getAnimations()`も空配列を返す。`tabs_select`で前面化してもペイン自体が非表示なので解消しない。
  - 実例: `md-menu`の`opening`は発火するが`opened`が長時間待っても発火しない。`closing`は発火し`open`もfalseになるが`closed`が発火しない。結果、`closed`に依存したReact stateが更新されず「次のクリックが1回空振りする」偽の不具合として観測された(実ブラウザでは正常動作を確認済み)。
- **`prefers-color-scheme`のエミュレーションは`matchMedia`の`change`イベントを発火しない。** OS設定の即時追従(リロードなしの動的切替)は、ブラウザペインでは検証できない。リロード後の初期解決なら検証可能。

これを知らずにブラウザペインでの検証結果だけで判断すると、環境固有の症状をコードの欠陥と誤診して不要な修正を入れる(逆に「実ブラウザでは動くはず」と楽観して未検証のまま通すのも危険)。

**対処:**

1. アニメーション完了イベントやOS設定連動に依存する挙動で異常が出たら、まず`document.visibilityState`を確認し、環境要因か実装要因かを切り分ける。
2. 実装自体を、完了イベントに依存しない形(`closing`等の即時発火するイベント)に倒せないか検討する。
3. ブラウザペインで原理的に確認できない項目は、[C-02-ui-verification-backorder.md](C-02-ui-verification-backorder.md)の逆発注でユーザーへ回す。
