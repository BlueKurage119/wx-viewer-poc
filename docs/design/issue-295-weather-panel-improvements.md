# Issue #295 防災気象情報画面の改善 設計書

## 1. 目的と範囲

右側情報パネルの縦の高さを節約し、地図の視認性を上げる。対象は次の3点だけとする。

1. 「警報等時系列」「警報級の可能性」「アメダス」の3カードで、本文最下部の「詳細」ボタンをカード見出し行の右端へ移す
2. アメダスのカード本文から湿度をなくし、2列×2行で表示する
3. 降水ナウキャストタイルの不透明度を 1 → 0.75 にする

範囲外(変更しない): 府県天気予報(`areaForecast`)カード、詳細ダイアログの中身(アメダスの湿度グラフ・表を含む)、キキクルの不透明度、`InfoPanelFrame` を使う他のカード。

## 2. 参照資料と設計判断の根拠

### 2.1 オーナー確定事項(統括担当から受領。再検討しない)

| No | 確定事項 |
| --- | --- |
| K1 | 3カード(警報等時系列・警報級の可能性・アメダス)の `GbButton`「詳細」を見出し行(`info-panel-card-heading`)の右端へ移す。府県天気予報は変更しない |
| K2 | 状態ごとの寸法揺れ(スケルトン・取得失敗・前回値・訓練バッジ・長い対象名)を列挙して扱いを決める。詳細ダイアログの開閉・フォーカス復帰は維持 |
| K3 | アメダスのカードは湿度をやめ、2列×2行。1行目「気温・時雨量」、2行目「風向・風速」。`.amedas-values > div:last-child` の全幅指定も扱う。詳細ダイアログ内の湿度は変更しない |
| K4 | `NOWCAST_LAYER_OPACITY` を 0.75 にする。キキクルは変更しない |
| K5 | テーマはダーク固定。色はトークンのみ |
| K6 | 見出しの右余白により対象名・時刻の行が折り返して1行増えることは許容する(追加ヒアリングで確定) |
| K7 | ボタンの縦位置は、見出し2行(タイトル・メタ)と同じ行に上寄せで置く。見出しブロックの上端に揃えて右端に配置する(追加ヒアリングで確定) |

### 2.2 実物調査の結果(コード読解。`main` の `066d1de` 時点)

- `InfoPanelFrame.tsx`: 見出しは `<header class="info-panel-card-heading">` の中に、タイトル(`.info-panel-card-title`。訓練バッジを含む)とメタ(`.info-panel-card-meta`。「対象名 · 時刻」)を縦に並べる(`flex-direction: column; gap: 2px`)。本文はカードごとの `children` を `.info-panel-card-body` に描画する。
  - `skeleton` のときは `children` を描画しない
  - `failed` のときは `amedas` だけ `children` を描画し(前回値表示)、他は「取得できませんでした」の文言だけ
- 「詳細」ボタンとダイアログの開閉状態(`useState`)は、各 `*Content` コンポーネントの内部にある。`InfoPanelColumn.tsx` は `card.content` をそのまま `children` として渡すだけである。
- `.info-panel-card` は `display:flex; flex-direction:column; gap:8px; padding:12px 16px; min-height:96px`。`position` 指定はない。
- アメダス: カード本文は `AMEDAS_FIELDS`(気温・湿度・風向・風速・時雨量の5項目)を2列グリッドで並べ、最後の項目(時雨量)を `.amedas-values > div:last-child { grid-column: 1 / -1 }` で全幅にしている。
  - **`AMEDAS_TABLE_FIELDS` は `AMEDAS_FIELDS.slice(0, 4)` から作られている**。`amedasValueToChartPoint` 系(`AMEDAS_FIELDS.find`)も詳細のグラフで使っている。したがって `AMEDAS_FIELDS` 自体を変えると詳細ダイアログの湿度が消え、K3に反する。
- `WeatherMapView.tsx` 48行目に `NOWCAST_LAYER_OPACITY = 1`、49行目に `KIKIKURU_LAYER_OPACITY = 0.75`。`tests/kikikuruMapIntegration.test.ts` 171行目が `nowcastLayerOpacity === 1` を検査している。
- webのテストは `renderToStaticMarkup`(SSR)で描画を検査している(`tests/earlyWarningPanel.test.ts` 等)。

### 2.3 設計判断

| No | 判断 | 根拠 |
| --- | --- | --- |
| D1 | ボタンの DOM 上の位置は今と同じ(各 `*Content` の中)のまま、**CSS の絶対配置**で見出し行の右端に重ねる | ボタンと `open` 状態を同じコンポーネントに置いたままにでき、開閉・フォーカス復帰の実装に手を入れずに済む(K2)。Portal で見出しへ差し込む方式は SSR(`renderToStaticMarkup`)ではボタンが出力されず、既存のテスト方式で検査できなくなるため採らない。状態を `InfoPanelColumn` 側へ持ち上げる方式は3パネルのデータ組み立て経路すべてに波及するため採らない |
| D2 | 見出しの右側に、ボタンの幅だけ余白を取る(3パネルだけ) | 長い対象名・訓練バッジがボタンの下に潜り込まないようにする(K2) |
| D3 | 余白を取る判定は `data-panel-id` ではなく、本文にボタンがあるかどうか(`:has()`)で行う | スケルトン・取得失敗(アメダス以外)はボタンが描画されないので、そのときは余白も取らず従来どおりの見出しになる。状態ごとに分岐を書かずに済む |
| D4 | アメダスのカード用に、表示項目の並びを別定数 `AMEDAS_CARD_FIELDS` で持つ。`AMEDAS_FIELDS` は変えない | 2.2 のとおり `AMEDAS_FIELDS` は詳細ダイアログの表・グラフと共用で、湿度を残す必要がある(K3) |
| D5 | `.amedas-values > div:last-child` の全幅指定は削除する | 4項目の2×2になり、最後の項目(風速)を全幅にする理由がなくなる。残すと風速が3行目に落ちて2×2にならない |

## 3. 変更内容

### 3.1 詳細ボタンの見出し右端への移動(K1・K2)

#### 3.1.1 変更ファイル

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/map/panels/panels.css` | 下記のクラスを追加 |
| `apps/web/src/map/panels/warningTimeSeries/WarningTimeSeriesContent.tsx` | 「詳細」ボタンに `className="info-panel-card-detail-button"` を付ける。DOM 上の位置・`onClick`(`setNarrowed(false); setOpen(true)`)は変えない |
| `apps/web/src/map/panels/earlyWarning/EarlyWarningContent.tsx` | 同上 |
| `apps/web/src/map/panels/amedas/AmedasContent.tsx` | 同上(カード本文の「詳細」だけ。詳細ダイアログ内の「続きを見る」には付けない) |

`InfoPanelFrame.tsx`・`InfoPanelColumn.tsx`・府県天気予報のファイルは変更しない。`GbButton` が `className` を素通しすること(`...props` の展開)は製造時に確認し、素通ししない場合は `<span className="info-panel-card-detail-button">` で包む。

#### 3.1.2 CSS(シグネチャ。値は 3.1.3 に従う)

```css
.info-panel-card { position: relative; }

/* 本文中の「詳細」をカード見出し行の右端に重ねる */
.info-panel-card-detail-button {
  position: absolute;
  inset-block-start: <カード上端からの距離>;
  inset-inline-end: <カード右端からの距離>;
}

/* ボタンがあるカードだけ、見出しの右側にボタン幅ぶんの余白を取る */
.info-panel-card:has(.info-panel-card-detail-button) .info-panel-card-heading {
  padding-inline-end: <ボタン幅 + 8px>;
}
```

- 訓練オーバーレイ(`data-training-overlay='true'`)のカードは枠線が 2px で `padding` が 1px ずつ小さい。`inset` はカードの外枠基準(`position: absolute` の包含ブロックは padding box)なので、枠線の差 1px ぶん位置がずれる。ずれを許すか、`[data-training-overlay='true']` で 1px 補正するかは 3.1.3 の実測で決め、補正する場合は同じセレクタで書く。
- 色の指定は追加しない(ボタンの色は既存の `color="text"` のまま)。

#### 3.1.3 位置と余白の決め方

`inset-inline-end` と余白の値は、実画面で `getBoundingClientRect()` を測って決める(計測時の注意は [G-08](../rules/advisory/G-08-ui-measurement-pitfalls.md))。配置は次のとおり【確定】(K7)。

- ボタンの右端を、カード本文の右端(カード右 padding の内側の線)に揃える
- ボタンの上端を、見出しブロック(`.info-panel-card-heading`)の上端に揃える(上寄せ)。つまり `inset-block-start` はカードの上 padding と同じ値(通常 12px、訓練オーバーレイは枠線を含めて同じ位置になるよう 3.1.2 で判断)。タイトル行の中心には揃えない
- ボタンが見出しブロック(タイトル+メタの2行)より背が高い場合でも上寄せを保ち、はみ出し分は本文側へ重ならないことを AC-5 で確認する。重なる場合は統括担当へ報告する
- 見出しの右余白は、ボタンの実測幅 + 8px

`GbButton size="sm"` の実寸(高さ・幅)は**実挙動未確認**。製造担当は測った値を、設計書の本節末尾に「実測値」として追記してからコミットする(設計書の追記は製造担当に許可する唯一の設計書変更とする)。

#### 3.1.4 状態ごとの寸法揺れと扱い

| 状態 | ボタン | 見出し | 扱い |
| --- | --- | --- | --- |
| 通常(content) | あり | タイトル+メタの2行 | 余白あり。カード高さは「ボタン行の高さ + gap 8px」ぶん減る |
| スケルトン | なし(`children` 非描画) | タイトルのみ | 余白なし(D3)。変化なし |
| 取得失敗(警報等時系列・警報級の可能性) | なし(文言だけ) | タイトルのみ | 余白なし。変化なし |
| 取得失敗・前回値あり(アメダス) | あり(`children` を描画するため) | タイトル(+メタは出ない場合あり) | 余白あり。ボタンはタイトル行に重なる。詳細を開けることは従来どおり |
| 前回値の警告文(アメダス `staleMessage`) | あり | 変化なし | 警告文は本文先頭のまま。ボタンは見出し側にあるので警告文と重ならない |
| 訓練バッジ(content かつ `isTraining`) | あり | タイトル行にバッジが加わる | 余白の内側でタイトルとバッジを並べる。入りきらない場合はタイトル行内で折り返す(既存の `display:flex` に `flex-wrap: wrap` を追加してよい) |
| 訓練オーバーレイ | あり | 枠線 2px | 3.1.2 のとおり 1px 差を実測で判断 |
| 長い対象名・時刻の併記(警報級の可能性の二時刻、警報等時系列の対象地域名など) | あり | メタが複数行に折り返す | 余白により折り返し位置が左へ寄る。1行増えることは許容する【確定】(K6) |
| 本文が短い場合(アメダス「取得できません」等) | あり | — | `min-height: 96px` は変えない |

注: 見出しが2行以上になるカードでは、ボタンを右上に置いても見出し自体の高さは変わらないため、カード高さの削減量はボタン行の高さ + 8px になる(見出しの右余白によりメタが1行増える場合はその分相殺される。この相殺は許容する【確定】(K6))。相殺が起きるカードがあるかは**実挙動未確認**で、検収で記録する(AC-4)。

#### 3.1.5 維持する挙動

- ボタンの `onClick`・`DetailDialog` の `open`/`onClose` は変更しない。フォーカス復帰は既存の `DetailDialog` の実装(閉じたら開いた要素へ戻す)に依存しており、ボタン要素自体は変わらないので維持される。
- キーボードのフォーカス順: ボタンの DOM 位置は本文末尾のままなので、Tab 順は「本文内の操作要素 → 詳細」のまま変わらない。3カードの本文には現状フォーカスできる要素がない(警報等時系列のスイッチは詳細ダイアログ内)ため、見た目の順(見出し → 本文)と食い違うことはない。
- カード上のホイール伝播停止(`onWheel`)は変更しない。

### 3.2 アメダスのカード表示(K3)

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/map/panels/amedas/amedasModel.ts` | `AMEDAS_CARD_FIELDS` を追加。`AMEDAS_FIELDS`・`AMEDAS_TABLE_FIELDS` は変えない |
| `apps/web/src/map/panels/amedas/AmedasContent.tsx` | カード本文の `.amedas-values` の描画を `AMEDAS_FIELDS` から `AMEDAS_CARD_FIELDS` に替える。`Detail`(詳細ダイアログ)は変えない |
| `apps/web/src/map/panels/amedas/amedas.css` | `.amedas-values > div:last-child { grid-column: 1 / -1; }` を削除 |

```ts
/** カード本文の表示項目。2列グリッドに行優先で並べ、1行目「気温・時雨量」、2行目「風向・風速」になる。 */
export const AMEDAS_CARD_FIELDS: readonly AmedasPublicElement[] = [
  'temp',
  'precipitation1h',
  'windDirection',
  'wind',
];
```

- ラベル(`dt`)は従来どおり `AMEDAS_FIELDS` から引く(項目定義を二重に持たない)。型・名前の細部は製造担当が決めてよい。
- 非提供要素(`capabilities.unsupportedElements`)の表示(「非提供」等)は `amedasDisplayValue` の既存挙動のまま。
- 取得失敗・前回値ありの場合も同じ4項目を表示する(同じ描画経路のため)。

### 3.3 ナウキャストタイルの不透明度(K4)

| ファイル | 変更 |
| --- | --- |
| `apps/web/src/map/WeatherMapView.tsx` | `const NOWCAST_LAYER_OPACITY = 0.75;` |
| `apps/web/tests/kikikuruMapIntegration.test.ts` | 171行目の期待値を `0.75` に更新 |

`KIKIKURU_LAYER_OPACITY` は変更しない。

### 3.4 テスト(追加・更新)

| ファイル | 内容 |
| --- | --- |
| `apps/web/tests/amedasPanel.test.ts` | `AmedasContent` を SSR し、`.amedas-values` の `dt` が順に「気温・時雨量・風向・風速」で、「湿度」を含まないこと。詳細の `AMEDAS_TABLE_FIELDS` のラベルに「湿度」が残ること |
| `apps/web/tests/amedasPanel.test.ts`・`earlyWarningPanel.test.ts`・`warningTimeSeriesPanel.test.ts` | 各 `*Content` の SSR 出力に `info-panel-card-detail-button` クラスを持つ「詳細」ボタンが1つあること |
| `apps/web/tests/areaForecastPanel.test.ts` | 府県天気予報の SSR 出力に `info-panel-card-detail-button` が含まれないこと |
| `apps/web/tests/kikikuruMapIntegration.test.ts` | 3.3 のとおり |

既存テストで「詳細」ボタンの位置や湿度のカード表示を前提にしたものがあれば、本設計に合わせて更新する(期待値の変更理由をテスト名かコメントで分かるようにする)。

## 4. 受け入れ条件

検収時は devサーバーの起動・データ・ポートの扱いを [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。UI の確認はダークテーマで行う。

| No | 確認方法 | 合格条件 |
| --- | --- | --- |
| AC-1 | `npm run lint` | エラー・警告 0 |
| AC-2 | `npm run typecheck` | エラー 0 |
| AC-3 | `npm run format:check` / `npm run test -w apps/web` | 差分なし / 全テスト成功(3.4 の追加テストを含む) |
| AC-4 | 実画面で3カード(通常状態)の `.info-panel-card` の高さを `getBoundingClientRect().height` で測り、`main` と比較する | メタが折り返さないカードは `main` より低い。メタが1行増えたカードは高さが `main` 以下であることを確認し、増えた行数とあわせて記録する(K6により1行増えは許容) |
| AC-5 | 実画面で3カードの「詳細」ボタンと見出しの矩形を測る | ボタンの上端と見出しブロックの上端の差が 1px 以内、ボタンの右端とカード本文の右端の差が 1px 以内。タイトル・訓練バッジ・メタ・本文の各矩形とボタンの矩形が重ならない |
| AC-6 | 府県天気予報カードを `main` と比較 | ボタンの位置・カードの高さが `main` と同じ |
| AC-7 | `?panelFixture=` 等で、スケルトン・取得失敗・アメダスの前回値表示・訓練バッジ・訓練オーバーレイの各状態を表示する(用意できない状態は「確認不能」と記録) | スケルトン・取得失敗(アメダス以外)はボタンが出ず、見出しに右余白がない。アメダスの前回値表示ではボタンが見出し右端にあり、警告文と重ならない。訓練オーバーレイでボタン位置のずれが 1px 以内 |
| AC-8 | 長い対象名のカード(警報級の可能性の二時刻併記、または対象名を長くしたフィクスチャ)を表示 | メタが余白の内側で折り返し(1行増えは許容)、ボタンと重ならない。ボタンは上寄せのまま。横スクロールが出ない |
| AC-9 | 3カードそれぞれで「詳細」をクリック → Esc で閉じる。続けてキーボード(Tab で「詳細」にフォーカス → Enter → Esc) | ダイアログが開閉し、閉じた後のフォーカスが「詳細」ボタンに戻る。警報等時系列では開いた時に絞り込みスイッチがオフになっている(従来どおり) |
| AC-10 | アメダスのカードを表示 | 2列×2行で、1行目が「気温・時雨量」、2行目が「風向・風速」。「湿度」が表示されない。非提供地点(羽田等)でも4項目の配置が崩れない |
| AC-11 | アメダスの詳細ダイアログを開く | 湿度のグラフ・表の列が `main` と同じく表示される |
| AC-12 | 降水ナウキャストを表示し、レイヤの不透明度を確認(DevTools でタイル要素の `opacity`、または `weatherMapViewConfiguration.nowcastLayerOpacity`) | 0.75。キキクルは 0.75 のまま |
| AC-13 | `git diff --stat main` | 変更ファイルが 3.1〜3.4 の表に挙げたもの(と設計書の実測値追記)だけ |
| AC-14 | オーナー目視確認(UI。検収担当は観点を渡すだけで合否を判定しない) | 観点: (1) 見出し右端に上寄せした「詳細」が押す場所として自然に見えるか (2) 見出しの折り返しや訓練バッジとの並びに違和感がないか (3) アメダスの2×2の並び・値の読みやすさ (4) ナウキャストの透過で地図(道路・地名)が読めるようになったか、雨の強弱の色が読み取れるか |

## 5. 後続Issueへの引き継ぎ

- 「詳細」ボタンの見出し配置クラス `info-panel-card-detail-button` は、他のカード(府県天気予報など)へ広げる場合にも使える。府県天気予報はボタン形状・地点名のスペースの都合で今回対象外とした(K1)。
- `AMEDAS_CARD_FIELDS` を追加したことで、カードと詳細の表示項目は独立して変えられる。
- ナウキャストとキキクルは同じ不透明度 0.75 になった。両方を重ねた場合の見え方は今回確認範囲外。

## 6. 実挙動未確認の箇所

- `GbButton size="sm"` の実寸と、それに基づくボタン位置・見出し余白の値(3.1.3。製造時に実測して追記)
- 見出しの右余白によってメタの行数が増えるカードがあるか(許容済み。AC-4 で記録)
- `GbButton` が `className` を内部の要素へ素通しするか(3.1.1)
