# Issue #90 警戒レベル・通知区分のセマンティックカラー

Codex が作成した設計案。ユーザーレビュー待ちであり、配色値・API・検証方法は提案である。レビューを受けるまで製造へ進まない。対象予定ブランチは `feature/issue-90-semantic-colors`。

## 1. 確定した範囲と根拠

ユーザーは今回、Material Design の世界観を極力維持し、気象庁の警戒レベルと通知区分の色のみ実装することを承認した。統括のヒアリング結果に従い、警戒レベル 2〜5 と通知区分「警報・問いかけ・非常ブザー」のトークンを定義し、既存警報行・問いかけ行に適用する。状態色、受信異常バナー、非常ブザーの UI 実装、警戒レベルの新規 UI、通知判定の変更は対象外。

参照資料:

- `docs/issues-draft.md` A5（元の範囲から上記へ限定）
- `docs/basic-design.md` §5.7（黒・紫・赤・黄、レベルを冠さない種別にも同段階色、文字による識別）、§7.2（通知区分と気象警報は別概念）
- `apps/web/src/theme/applyTheme.ts`（テーマ適用経路）、`apps/web/src/index.css`（通知行の暫定色）、`apps/web/src/shell/NotificationArea.tsx`（既存表示）
- インストール済み `@material/material-color-utilities` 0.3.0 の `palettes/tonal_palette.d.ts` / `.js`。`TonalPalette.fromHueAndChroma(hue, chroma)` と `tone(tone)` を実物で確認した。後者は HCT から ARGB を生成しキャッシュする。

電文仕様・通知区分判定は変更せず、基本設計の未確定項目を本設計で確定扱いしない。

## 2. 配色と公開トークン

`apps/web/src/theme/semanticColors.ts` を新設する。HEX の色定数を置かず、固定 HCT の Material tonal palette と tone から生成する。通常テーマのシードは受け取らず、harmonize もしない。これによりシードを変更しても意味色が変わらない。

型と API:

```ts
export type AlertLevel = 2 | 3 | 4 | 5;
export type NoticeColorCategory = 'warning' | 'question' | 'emergency';
export type SemanticColorToken =
  | `--wx-alert-level-${AlertLevel}-${'container' | 'on-container' | 'outline'}`
  | `--wx-notice-${NoticeColorCategory}-${'container' | 'on-container' | 'outline'}`;
export function createSemanticColors(dark: boolean): Record<SemanticColorToken, string>;
```

値は `hexFromArgb` の生成結果。型・関数をテーマの `index.ts` から export する。戻り値は呼び出しごとに独立させ、呼び出し側の変更を他の呼び出しへ伝播させない。palette 自体はモジュール内で再利用してよい。

以下の数値は提供仕様ではなく本 Issue の画面設計値。列の tone は container / on-container / outline の順。

| 対象 | hue / chroma | light tone | dark tone |
| --- | --- | --- | --- |
| level-2 | 100 / 48 | 90 / 10 / 40 | 90 / 10 / 40 |
| level-3 | 25 / 84 | 40 / 100 / 80 | 40 / 100 / 80 |
| level-4 | 305 / 56 | 40 / 100 / 80 | 40 / 100 / 80 |
| level-5 | 0 / 0 | 0 / 100 / 60 | 0 / 100 / 60 |
| notice-warning | 100 / 48 | 90 / 10 / 40 | 30 / 90 / 80 |
| notice-question | 25 / 84 | 90 / 10 / 40 | 30 / 90 / 80 |
| notice-emergency | 25 / 84 | 40 / 100 / 80 | 40 / 100 / 80 |

警戒レベルは両モードで黒・紫・赤・黄を維持する。通知は Material の container / on-container の組み合わせを使い、非常ブザー用には強い赤を確保する。色が同値でも概念を結合せず別トークンとする。

設計時に上記ライブラリを Node で実行し、生成色から計算した文字/背景コントラストは level-2=13.33、level-3=6.46、level-4=6.47、level-5=21.00、warning light/dark=13.33/7.20、question light/dark=13.26/7.24。outline/背景は最小 3.80。emergency は level-3 と同値。これらは丸めた実測値でありテスト期待値を生成式から複製しない。

### レビュー用の生成色一覧

背景 / 文字の順。コントラストは文字と背景の実測比（小数第 2 位まで）。

| 対象 | light 背景 / 文字 | dark 背景 / 文字 | light / dark コントラスト |
| --- | --- | --- | --- |
| レベル 2・黄 | `#fbe365` / `#211b00` | `#fbe365` / `#211b00` | 13.33 / 13.33 |
| レベル 3・赤 | `#ba1a1a` / `#ffffff` | `#ba1a1a` / `#ffffff` | 6.46 / 6.46 |
| レベル 4・紫 | `#7148af` / `#ffffff` | `#7148af` / `#ffffff` | 6.47 / 6.47 |
| レベル 5・黒 | `#000000` / `#ffffff` | `#000000` / `#ffffff` | 21.00 / 21.00 |
| 通知・警報 | `#fbe365` / `#211b00` | `#524700` / `#fbe365` | 13.33 / 7.20 |
| 通知・問いかけ | `#ffdad6` / `#410002` | `#93000a` / `#ffdad6` | 13.26 / 7.24 |
| 通知・非常ブザー | `#ba1a1a` / `#ffffff` | `#ba1a1a` / `#ffffff` | 6.46 / 6.46 |

## 3. 適用

`applyMd3Theme` 内で `createSemanticColors(dark)` の全 21 トークンを、既存の `root` 引数の style へ `setProperty` で書く。既存 MD3 トークンの生成、色モード設定、FOUC 対策は変更しない。副作用 import は追加しない。

`index.css` の `.has-notice.warning-row` と `.has-notice.question-row` の背景と文字をそれぞれ対応する container / on-container へ置換する。対象行の上境界と、その行内の操作ボタンの境界には対応する outline を使う。必要なセレクターを追加して既存共通境界指定に勝たせる。背景が透明なボタン文字は行の文字色継承を維持する。

空行、操作ガイド行、受信異常バナー、ヘッダー、通知件数表示には適用しない。通知行の既存文章・確認/送信ボタンによる識別を維持し、ラベルを増設しない。非常ブザーが現状で問いかけ行に表示される既存挙動は変更しない。

## 4. 検証と受け入れ条件

検証のための大規模な UI 基盤・依存追加は行わない。`apps/web/tests/semanticColors.test.ts` を新設し、既存の Node test 実行経路を使う。

1. light/dark 各 21 キーが過不足なく存在することをキーの完全一致で検証する。各キーの配色は、製造担当がライブラリを一度実行して得た結果を固定した独立の期待値一覧と完全一致で照合する。生成式をテスト側で再実装して期待値を作らない。
2. 全組み合わせで文字/背景 4.5:1 以上、境界/背景 3:1 以上を満たすことを実測する。sRGB 相対輝度による独立計算を用い、`assert.equal(ratio >= limit, true)` 等で判定する。通常文字用の保守的な受入基準であり文字サイズの推定は不要。
3. style の `setProperty` を記録する最小 root stub を使用して `applyMd3Theme` を実行し、全 21 トークンが書かれ、異なる 2 シードで意味色が完全一致すること、light→dark→light で戻ることを確認する。DOM 全体の模倣は不要。
4. 開発画面の既存通知プレビューを light/dark で表示する。警報・問いかけの実際の computed style が該当トークンの解決色と一致し、文字と操作ボタン境界が読み取れることを確認する。空行は通常色のまま、文章と操作で区別でき、配置が崩れないことを画面で確認する。警戒レベルは新規 UI がないため一時的な色見本による目視で黒・紫・赤・黄を確認し、一時ファイルは削除する。既存ブラウザー操作手段があれば利用し、恒久的なプレビュー機能は作らない。
5. 新規テストはまず意味を変えないコメント変更が成功する対照実験を実行する。その後、生成関数の 1 トーン変更、テーマへの書き出し削除、dark 分岐固定をそれぞれ一時的に施し、対応するテストが失敗することを確認して都度復元する。変更内容・失敗したテスト名を製造報告へ残す。
6. コミット前に `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web` を通す。`npm run build` で本番生成経路が成立することも確認する。

検収担当は項目ごとの実行結果を報告し、コードを修正しない。未達を原因と再現手順付きで統括へ返す。全項目通過時のみ指定ブランチを push して `main` を base とする通常 PR を作成し、本文に `Closes #90` と Codex が作成した旨を記載する。マージしない。

## 5. 引き継ぎ・未確認事項

状態色と受信異常バナーは今回見送り。非常ブザー用トークンは将来の UI で使用する。警戒レベルの利用側は、種別名・段階を文字で示し、レベルを冠さない種別に独自レベル表記を追加しない。通知カテゴリ判定と危険度の対応は後続 Issue の責務。

新たな業務上の要確認事項はない。実ブラウザーでの目視と実装後の computed style は製造・検収で未確認項目として実行する。
