---
title: 気象データ業務標準
description: 気象庁XML電文の確定/未確定の扱い、isTrainingの伝播範囲、availability 3状態の縮退禁止
phases: [設計, 製造, 検収]
products: [Claude, Codex, Antigravity]
---

# 気象データ業務標準

対象: 気象庁XML電文のパース・正規化・表示・通知に関わる設計・製造・検収。

## 確定事実の扱い(必須)

気象庁XML電文の提供仕様は、実データ・公式資料・[取得方法レポート](../../data-acquisition-report.md)と照合できたものだけを、設計上の「確定」事実として扱うこと。電文構造やコード値を憶測で補わない。実挙動を確認できなかった箇所は「実挙動未確認」と明記する。`docs/basic-design.md`の【設計案】・【未確定】の記述を、無断で確定したものとして扱ってはならない。

## 訓練データと本番相当データの混同禁止(必須)

訓練通知機能(basic-design.md §3.4)の`isTraining`フラグが伝播すべき箇所(通知・履歴・表示)を、実装・検証のいずれでも本番データと同一視しない。設計では`isTraining`フラグが伝播すべき範囲を明記し、本番相当の通知・履歴と同一視する設計にしない。

## availabilityの3状態を縮退させない(必須)

availability(`available`/`stale`/`unavailable`、basic-design.md §6.3)の3状態を、単純なOK/NGやbooleanに簡略化しない。`stale`時は前回値を保持しつつ鮮度低下を表現する。設計・実装・検収のいずれの段階でも、この3状態が意図通りに区別されているかを確認する。2状態に縮退した実装を見逃さない。

`packages/shared/src/availability.ts`の`Availability`型・`resolveAvailability`が実装の正本。取得健全性(available/stale/unavailable)と保持値の有無は別軸であることに注意する。

## 修正時の確認範囲(必須)

気象データのキャッシュ・availability状態はモジュールレベルの共有可変状態になりやすい。[05-verification-protocol.md](05-verification-protocol.md)・[05-verification-discipline.md](../advisory/05-verification-discipline.md)の「共有可変状態の修正は系統的に洗い出す」に従い、一部の経路だけ`isTraining`やavailabilityの縮退を直しても、他の経路(通知・履歴・表示のいずれか)に同じ欠陥が残っていないかを、修正のたびに全経路で確認すること。
