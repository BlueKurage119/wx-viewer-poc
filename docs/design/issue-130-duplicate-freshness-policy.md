# Issue 130 設計書: jmaXmlPolling.test.ts の freshnessPolicy 重複プロパティ解消

## 概要

`apps/api/tests/jmaXmlPolling.test.ts` 内で、`JmaXmlPollingService` をインスタンス化する際に `freshnessPolicy` プロパティが2回記述されている重複を解消する。

## 背景・目的

Issue #114 の検収中に見つかった軽微な瑕疵。
JS/TS の仕様上は後勝ちで動作に影響しないが、lintの重複キー検出設定によっては警告対象になり得るため整理する。

## 対象ファイル

- `apps/api/tests/jmaXmlPolling.test.ts`

## 具体的な修正内容

`apps/api/tests/jmaXmlPolling.test.ts` の `3122-3123` 行目付近:

```typescript
      const crashingService = new JmaXmlPollingService(freshDb.connection, {
        freshnessPolicy: defaultXmlFreshnessPolicy,
        freshnessPolicy: defaultXmlFreshnessPolicy,
      });
```

上記から重複しているプロパティを1つ削除し、以下のように修正する。

```typescript
      const crashingService = new JmaXmlPollingService(freshDb.connection, {
        freshnessPolicy: defaultXmlFreshnessPolicy,
      });
```

## 受け入れ条件

1. `apps/api/tests/jmaXmlPolling.test.ts` の該当箇所から重複した `freshnessPolicy` プロパティが削除されていること。
2. `npm run lint` が警告・エラーなく通過すること。
3. `npm run typecheck` がエラーなく通過すること。
4. `npm run test -w apps/api` が成功すること。

## 後続 Issue への引き継ぎ・未確認事項

- 特になし
