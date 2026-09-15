---
title: UI・Material Web/MD3業務標準
description: apps/webで必ず守る技術制約(sideEffects・パッケージ固定・生タグ禁止・localStorageキー同期)、色トークン規約
phases: [設計, 製造, 検収]
products: [Claude, Codex, Antigravity]
---

# UI・Material Web/MD3業務標準

対象: `apps/web`を触るすべてのフェーズ。エラーも警告も出ずに壊れるものだけをここに集約している。**`apps/web`に変更を加える前に必ず読むこと。** 計測の罠等のノウハウは[G-08-ui-measurement-pitfalls.md](advisory/G-08-ui-measurement-pitfalls.md)・[G-09-bundle-budget-underestimate.md](advisory/G-09-bundle-budget-underestimate.md)を参照。

## 必須の制約

1. **色はHEX値をハードコードせず、Material-colorのトークンを使用する。**例外は次節に記載する。
2. **見ればわかる説明書き・ラベルは省略する。**
3. **`apps/web`に副作用のためだけのbare importを書かない。** `apps/web/package.json`に`"sideEffects": ["*.css"]`を宣言しているため、CSS以外の`import './foo'`形式(副作用目的のimport)は本番ビルドで黙って除去される。カスタム要素の登録は「ラッパーのexportを使う」ことで成立させる。
4. **`@material/material-color-utilities`は`0.3.0`固定(キャレットなし)。** `npm update`等で勝手に上げない。0.4.x系は既知のパッケージング不具合(拡張子なしimportの解決失敗)があるため避けている。
5. **`<md-*>`の生タグを直書きしない。** Material Webのコンポーネントは必ず`apps/web/src/components/md`のバレル(`index.ts`)からexportされた型付きラッパーをimportする。未ラップのコンポーネントが必要になったら、ラッパーを追加してからバレルに載せる。
6. **配色は`apps/web/src/theme/`が生成する`--md-sys-color-*`のみを使う。** シード色は`apps/web/src/theme/seeds.ts`の`DEFAULT_THEME_SEED`(`#1A73E8`)のみで完結させる。共通シェルはダーク固定(README参照)。警戒レベル色・通知区分色はこのMD3基盤の対象外で、別途セマンティックトークンとして定義する(basic-design.md §5.7参照、未着手)。データ色トークンもまた同じ。
7. **`index.html`と`ThemeProvider.tsx`のlocalStorageキー(`wx-viewer:color-mode`)を一致させる。** FOUC対策で`index.html`側に先読みロジックがあるため、キー名を個別に変更すると同期が壊れる。

## MD3トークン使用義務の例外

キキクルタイルやナウキャストタイルの色は、装飾ではなく、色に意味のあるデータである。したがって、これらの色を無理にMD3トークン化してしまうと、凡例と表示が食い違う事故が発生する。このような場合の例外規定を以下の通り定める。

1. データ色トークンとして、`--wx-data-nowcast-1`の例により定義する。
2. 凡例・タイル補助UIは、var関数で使用する。
3. CSS・TSX・fixtureへのRGB/HEX等による色指定は、これまで通り禁止とする。
4. 色の出典データは、設計担当が調査の上、取得先・取得日時とともに保存をするか、ユーザーより支給を受ける。この色は、別に指示をしない限り、そのままデータ色トークン値とすること。
