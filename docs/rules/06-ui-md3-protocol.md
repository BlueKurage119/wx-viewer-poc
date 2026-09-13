---
title: UI・Material Web/MD3業務標準
description: apps/webで必ず守る技術制約(sideEffects・パッケージ固定・生タグ禁止・localStorageキー同期)、色トークン規約
phases: [設計, 製造, 検収]
products: [Claude, Codex, Antigravity]
---

# UI・Material Web/MD3業務標準

対象: `apps/web`を触るすべてのフェーズ。エラーも警告も出ずに壊れるものだけをここに集約している。**`apps/web`に変更を加える前に必ず読むこと。** 計測の罠等のノウハウは[G-08-ui-measurement-pitfalls.md](advisory/G-08-ui-measurement-pitfalls.md)・[G-09-bundle-budget-underestimate.md](advisory/G-09-bundle-budget-underestimate.md)を参照。

## 必須の制約

1. **色はHEX値をハードコードせず、Material-colorのトークンを使用する。** 見ればわかる説明書き・ラベルは省略する。
2. **`apps/web`に副作用のためだけのbare importを書かない。** `apps/web/package.json`に`"sideEffects": ["*.css"]`を宣言しているため、CSS以外の`import './foo'`形式(副作用目的のimport)は本番ビルドで黙って除去される。カスタム要素の登録は「ラッパーのexportを使う」ことで成立させる。
3. **`@material/material-color-utilities`は`0.3.0`固定(キャレットなし)。** `npm update`等で勝手に上げない。0.4.x系は既知のパッケージング不具合(拡張子なしimportの解決失敗)があるため避けている。
4. **`<md-*>`の生タグを直書きしない。** Material Webのコンポーネントは必ず`apps/web/src/components/md`のバレル(`index.ts`)からexportされた型付きラッパーをimportする。未ラップのコンポーネントが必要になったら、ラッパーを追加してからバレルに載せる。
5. **配色は`apps/web/src/theme/`が生成する`--md-sys-color-*`のみを使う。** シード色は`apps/web/src/theme/seeds.ts`の`DEFAULT_THEME_SEED`(`#1A73E8`)のみで完結させる。共通シェルはダーク固定(README参照)。警戒レベル色・通知区分色はこのMD3基盤の対象外で、別途セマンティックトークンとして定義する(basic-design.md §5.7参照、未着手)。
6. **`index.html`と`ThemeProvider.tsx`のlocalStorageキー(`wx-viewer:color-mode`)を一致させる。** FOUC対策で`index.html`側に先読みロジックがあるため、キー名を個別に変更すると同期が壊れる。
