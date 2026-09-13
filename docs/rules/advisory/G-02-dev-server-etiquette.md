---
title: devサーバー作法の背景
description: オーナーが自分でdevサーバーを立てていることがあるため、一括終了を避ける理由
phases: [製造, 検収]
products: [Claude, Codex, Antigravity]
---

# devサーバー作法の背景

対象: 製造担当・検収担当。禁止事項の本体は[01-dev-workflow-protocol.md](../01-dev-workflow-protocol.md)の「devサーバーの禁止事項」を参照。

**出典:** `mj-stats-viewer`での差し戻し事例。オーナーが検証用に自分でdevサーバーを立てていた回に、エージェントが無関係なサーバーごと一括終了させた。ポート番号は日によって違うことがあるため固定で覚えず、その都度の状況を確認する(例: 停止は`pkill -f "vite --port <自分のポート>"`のようにポート指定で行う)。wx-viewer-pocは`npm run dev`でweb(5174)+api(3001)を固定ポートで起動する(README参照)。
