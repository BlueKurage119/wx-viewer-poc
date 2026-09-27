# Issue #55 G4. 警報等時系列パネル 設計書

## 1. 目的と範囲

GitHub Issue #55「G4. 警報等時系列パネルの実装」として、E2 #34 の `GET /api/weather/warning-timeseries` を右側情報パネルの「警報等時系列」に結線し、次を実装する。

- パネル本体: 発表時刻の下に、縦軸を現象(危険度の種類)、横軸を時間帯とする危険度の色分け表
- 詳細ダイアログ: 3時間表(危険度全行＋3時間刻みの量的予想)と、日単位・24時間単位の量的予想の別欄を、単位・区分付きで表示
- G10 #61 の「詳細(仮)」入口(警報等時系列分のみ)を撤去し、本物の入口に置き換える

範囲外: 履歴表示(ユーザー決定で実施しない)、パネル本体での付加事項(備考)の表示、取得状態表示の新方式(G9 #60)、API・共通型・DB の変更。

## 2. 参照資料と設計判断の根拠

- [基本設計](../basic-design.md) §5.8(本設計で改訂案を示す。§2.2)、§5.13(横スクロール・初期位置の一般方針)
- [issues-draft](../issues-draft.md) G4 項目、[棚卸し](../audit-epic-a-d.md) AD-H048
- [#14 設計書](issue-14-warning-timeseries.md)(正規化)、[#33 設計書](issue-33-warning-rest-apis.md) §3.4(API 契約)
- [#52 設計書](issue-52-info-panel-layout.md)(always パネルの状態規則)、[#54 設計書](issue-54-warning-panel.md)(段階色トークン・API クライアントの作り)、[#61 設計書](issue-61-detail-dialog.md) §5・§6・§10(詳細ダイアログと時系列表部品)
- 型: `packages/shared/src/weatherApi.ts` の `WarningTimeseriesResponse` / `WarningTimeseriesTimeDefine` / `WarningTimeseriesValue`
- 実電文: [気象庁提供サンプル](../../../docs/260907_weather-data/jmaxml_20260723_Samples/) の `*_VPWP50.xml` 4本
- 公式資料: [気象警報・注意報時系列情報(R06)解説資料および別表](<../../../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/>)(別表2 要素、別表4 危険度と対応するコード)

### 2.1 ヒアリング確定事項(統括経由・ユーザー決定)

初回(2026-09-27):

1. 行の順序は**電文の出現順そのまま**とする。§5.7 の固定順との対応付けはしない。基本設計 §5.8 の当該【確定】記述と Issue 受け入れ条件は、これに合わせて改訂する(ユーザー承認済み)。
2. 色は #54 の段階色トークンを流用する(注意報級=黄 `--wx-alert-level-2-*`、警報級=赤 `--wx-alert-level-3-*`、危険警報級=紫 `--wx-alert-level-4-*`、特別警報級=`--wx-alert-level-5-*`)。凡例は詳細ダイアログにだけ置く。未満・値なし・欠測/未取得は区別し、欠測を低危険度として扱わない。コード→段階の対応は、実データ・公式資料で確認できた範囲だけを確定扱いとする。
3. 全コマを保持し、現在を含む時間帯の列へ初期スクロールする。過去の列は左スクロールで閲覧できる。固定コマ数で切り捨てない。行見出しは固定する。
4. 詳細ダイアログは、行見出しに要素・区分・単位を入れる案をベースとする。見た目は後日ユーザー監修予定のため【設計案】とする。
5. 履歴表示はしない。AD-H048 の結論記録を受け入れ条件に含める。null・3状態・時刻の意味・会場(east/trc)・本番/訓練の区別を維持する。

追加(2026-09-27、初版設計への回答):

6. セルの文字は、レベル5(特別警報級を含む)=「切迫」、レベル4=「危険」、レベル3(警報級を含む)=「警戒」とする。レベル2・注意報級には文字を付けない(色のみ)。文字は**色が切り替わるセル**(同じ行で直前の列と段階が変わる最初のセル)にだけ表示する。同じ段階が続くセルは色だけで示す。
7. 日単位の危険度(乾燥・なだれ・低温・霜など)は3時間刻みの表に統合する。日区間が覆う各3時間列に同じ値を複製し、パネル本体の表は1つにする。
8. 日単位・24時間単位 block の量的予想(24時間最大雨量、湿度、降雪量など)は、詳細ダイアログ内の「別欄」の表にする。列見出しは電文の時間定義に基づき「○日○時まで」「○日」の形式にする。
9. パネル(カード)には、注意報級(レベル2)以上の危険度を1セル以上含む行だけを表示する。詳細ダイアログには全行を表示する(ユーザー確認済み)。
10. 欠測を含む行も、注意報級以上のセルが無ければパネルでは隠し、詳細でだけ見せる(ユーザー決定)。欠測を低危険度扱いしない原則(項2)とは、詳細で「?」として区別できることで両立させる。
11. 段階文字は、切替セルに加えて初期スクロール位置の列(現在を含む列)にも補う。そのセルが level3 以上なら、段階が切り替わっていなくても文字を付ける。スクロールには追従しない。
12. ~~3時間表の基準範囲より先の期間にある日単位の危険度は、パネル・詳細とも表示しない~~ → 項33で撤回。パネルには出さず、詳細の3時間表では右側に日単位の列を延長して表示する。

UI監修(製造コミット fd2cafd の画面に対するユーザー判断):

13. パネルは「現在を含む時間帯＋その先2コマ」の3列だけを表示し、横スクロールしない。日付行は出さず、時刻見出しだけを残す。過去の列と4コマ目以降は、詳細ダイアログでだけ閲覧できる。パネルでの初期スクロールは不要(詳細は従来どおり)。
14. 文字の無いセルも、文字のあるセルと同じ大きさで表示する。
15. 凡例から注記「文字は段階が変わる時間帯にだけ表示」を削除する。凡例のレベル4の表記は「危険警報級」とする(セルの文字「危険」は変えない)。
16. 区分付きの行(例: 風(陸上)・風(海上)・風(東京湾))は、同じ種類どうしを連続して並べる。見出し行は作らない。
17. 危険度の値なし(00)と量的予想の値なし(`condition='値なし'`)は、「—」をやめて空白にする。欠測「?」との区別は維持する。
18. 正常な空の文言を「注意が必要な時間帯はありません」とする。
19. 行の表示条件(項9)の判定範囲は、パネルに表示中の3列の中とする(ユーザー確定)。
20. 値なしを空白にすることで「未満」と見た目の区別がなくなることは了承済み。区別は `aria-label` で保つ(ユーザー確定)。
21. 付加事項(`additions`)を「備考」として、詳細ダイアログの3時間表にだけ表示する(ユーザー決定)。表の最終列を「備考」列として右端に固定し、パネルには表示しない。ユーザーのいう「関連する現象」は、付加事項に書かれる現象(例: 雷の「竜巻」「ひょう」)を指す。
   - 実データの根拠は、公式 VPWP50 実電文(新潟市。#33 設計書 §2 参照)で、雷の `SignificancyPart/Base/Addition/Note` に「竜巻」「ひょう」があること(refID なし)。
   - 手元のサンプル4本と、2026-09-27 時点の公式フィード現行 VPWP50 40件には、Note が0件だった(統括調査)。このため画面ではフィクスチャで確認する。

UI監修(追加。実装 HEAD d14d042 時点):

22. 値なし(および未満)のセルは背景色を付けない(透明)。「無着色」の実装を `--md-sys-color-surface` 系の塗りから背景なしへ改めた(d14d042 で実装済み)。
23. 詳細ダイアログの3時間表では、表が見えている間、日付行と時刻行の見出しをダイアログ本文のスクロール領域の上端に吸着させ、常に表示する(ユーザー決定)。表の中に高さの上限を設けて二重スクロールにする案は採らない。
24. 3時間区間の時刻見出しから「時」を除き、「21-24」の形にする(「時」だけが2行目に折り返すため)。パネルと詳細の3時間表の両方に適用する。別欄の「D日H時まで」「D日」は区間表記ではないため対象外とし、変更しない(ユーザー決定 2026-09-27)。
25. 詳細の3時間表では、同じ区分の風向の行と最大風速の行を1行にまとめ、セルに「矢印＋方位名＋風速」(例「↘ 北西 15」)を表示する。矢印は気象庁ホームページと同じく、風が吹いていく向き(風下)を指す(ユーザー決定)。
26. 矢印には Material Symbols の `navigation` アイコンを使い、風下の向きに合わせて回転させる(ユーザー決定)。
27. まとめた行は、同じ区分の風の危険度行の直下に置く(ユーザー決定。電文出現順の例外)。行見出しは「風向・風速(陸上) m/s」の形とする。
28. `condition="風雪"` は表示しない(値への併記をやめる。ユーザー決定)。
29. パネル本体と別欄は変更しない。

UI監修(追加。実装 HEAD c113b48 時点):

30. 詳細の3時間表で、統合行の行見出しから区分名を除き「風向・風速 m/s」とする(直上の危険度行に区分があるため)。読み上げには区分を残す(ユーザー決定)。
31. 統合行のセルは方位の漢字を出さず、上段に矢羽、下段に風速の2段で表示する。8方位以外(静穏など)の風向は「－」とし、原文は読み上げに残す(ユーザー決定)。
32. 3時間表の雨の量的予想の行(１時間最大雨量等)は、雨に関わる危険度のまとまりの直後に置く(ユーザー決定。電文出現順の例外)。
33. 3時間表の期間より先の日単位の危険度(明後日の乾燥・低温・霜など)は、3時間表の右に日単位の列(見出し「○日」)を延長して表示する(ユーザー決定。項12を撤回)。
25. 方式(a)を採用し、§7 に記載した `map/detail/**` の3ファイルの変更をユーザーが許可した(2026-09-27)。読み上げは各セルの時間帯入り `aria-label` で補う前提も統括判断で採用する。

### 2.2 基本設計 §5.8 の改訂文案(統括担当が反映する。本Issueでは basic-design.md を編集しない)

経緯: §5.8 は「行の順序は§5.7で確定した段階内の固定順(暴風雪→大雨→洪水→暴風→大雪→波浪→高潮→土砂災害)を流用する」を【確定】としていた。しかし、VPWP50 の危険度の種類(`Property/Type`)は「大雨浸水危険度・土砂災害危険度・風危険度・雪危険度・波危険度・高潮危険度・雷危険度・融雪危険度・濃霧危険度・着氷危険度・着雪危険度・乾燥危険度・なだれ危険度・低温危険度・霜危険度」である(サンプル4本・別表2で確認)。これらは §5.7 の警報名と1対1に対応しない(例: 「風」は暴風雪/暴風/風雪/強風を含む)。対応付けは推測になるため、ユーザー判断により電文の出現順を採った。

差し替え前:

> - 対象の現象【確定】: 固定リストを仮定せず、電文（VPWP50）に含まれる現象だけを表示する。行の順序は5.7で確定した段階内の固定順（暴風雪→大雨→洪水→暴風→大雪→波浪→高潮→土砂災害）を流用する。

差し替え後:

> - 対象の現象【確定】: 固定リストを仮定せず、電文（VPWP50）に含まれる危険度の種類だけを対象とする。行の順序は電文の出現順とする（2026-09-27 ユーザー決定）。VPWP50の危険度の種類（大雨浸水・土砂災害・風・雪・波・高潮・雷・濃霧等）は5.7の警報名と1対1に対応しないため、5.7の固定順との対応付けは行わない。
> - 表は3時間刻みの1表とし、日単位の危険度（乾燥・なだれ・低温・霜等）は日区間が覆う各3時間列に同じ値を複製して統合する（2026-09-27 ユーザー決定）。
> - セルは段階色で塗る。文字は段階が切り替わるセルにだけ付け、レベル5（特別警報級を含む）「切迫」、レベル4「危険」、レベル3（警報級を含む）「警戒」とする。レベル2・注意報級は色のみとする（2026-09-27 ユーザー決定）。凡例は詳細ダイアログに置く。欠測・未取得を危険度の低い状態として表示しない。
> - パネルには注意報級（レベル2）以上を含む行だけを表示し、詳細には全行を表示する。欠測だけの行もパネルでは表示せず、詳細で欠測として区別して示す（2026-09-27 ユーザー決定）。
> - 段階の文字は、切り替わるセルに加え、初期表示位置（現在を含む時間帯）のセルにもレベル3以上なら付ける。スクロールには追従しない（2026-09-27 ユーザー決定）。
> - 表示時間範囲は5.13の一般方針に従う（初期位置は現在を含む時間帯、全期間を横スクロールで閲覧可能、固定コマ数で切り捨てない）。ただし例外として、パネルは3列窓とし、全期間の閲覧は詳細ダイアログで満たす。詳細の3時間表では、3時間刻みの期間より先の日単位の危険度を、表の右に日単位の列（見出し「○日」）を延長して表示する（2026-09-27 ユーザー決定）。
> - 日単位・24時間単位の量的予想（24時間最大雨量・湿度・降雪量等）は、詳細の別欄に「○日○時まで」「○日」の列見出しで表示する（2026-09-27 ユーザー決定）。

追補文案(UI監修 2026-09-27 反映。上の差し替え後の文に続けて追記する):

> - パネルは現在を含む時間帯とその先2コマの3列だけを表示し、横スクロールしない。過去の時間帯と4コマ目以降は詳細ダイアログでだけ閲覧できる。これは5.13「全期間を横スクロールで閲覧可能」のパネルにおける例外であり、全期間の閲覧は詳細ダイアログで満たす（2026-09-27 ユーザー決定）。
> - 風・高潮等の区分付きの行は、同じ種類の行を連続して並べる。並び順は電文の出現順を原則とし、その例外として、同じ種類の2つ目以降の区分行を同じ種類の最初の出現位置にまとめる（2026-09-27 ユーザー決定）。
> - 値なし（危険度の値なし、量的予想の値なし）は空白で表示する。欠測・未取得は空白と区別して示す（2026-09-27 ユーザー決定）。
> - 注意報級以上の時間帯が無いときは、発表時刻とともに「注意が必要な時間帯はありません」と表示する。取得できないときの表示とは区別する（2026-09-27 ユーザー決定）。
> - 詳細の3時間表の日付・時刻の見出しは、表が見えている間はダイアログ上端に固定して表示する。3時間区間の時刻見出しは「21-24」のように「時」を付けない。別欄の「○日○時まで」の「時」は残す（2026-09-27 ユーザー決定）。
> - 詳細の3時間表では、風向と風速を区分ごとに1行にまとめ、風下を指す矢印・方位名・風速を表示する。まとめた行は同じ区分の風の危険度の行の直下に置く。「風雪」の条件は表示しない（2026-09-27 ユーザー決定）。
> - 詳細の3時間表で、風向・風速の行は行見出しを「風向・風速」と単位だけとし（区分は直上の風の危険度の行で示す）、セルは上段に矢羽、下段に風速の2段で表示する。8方位以外の風向は「－」とする。雨量の予想（１時間最大雨量等）の行は、雨に関わる危険度（大雨浸水・土砂災害）の行のまとまりの直後に置く（2026-09-27 ユーザー決定）。
> - パネルに表示する行の判定（注意報級以上を含む）は、パネルに表示する3列の範囲で行う（2026-09-27 ユーザー決定）。
> - 値なしは未満と同じく空白で表示し、見た目では区別しない（読み上げでは区別する。2026-09-27 ユーザー了承）。
> - 付加事項（例: 雷の「竜巻」「ひょう」）は、詳細ダイアログの3時間表の右端に固定した「備考」列に、現象・区分の行単位で表示する。時間帯のセルには割り当てない。パネルには表示しない。区域全体の付加事項は、同じ現象の各区分の行に複製して表示する。3時間表に対応する行が無い付加事項は表示しない。備考列は常時表示し、表示する付加事項が無い行・表では空白とする。付加事項が未取得の場合は、その旨を示し「付加事項なし」とは表示しない（2026-09-27 ユーザー決定）。

なお、上の差し替え後の文のうち「文字は段階が切り替わるセルにだけ付け」「初期表示位置」は、パネルでは「表示する3列の先頭列」と読み替える(§4.3)。

Issue #55 の受け入れ条件に「§5.7 の順で並ぶ」旨の記述がある場合は、「電文の出現順で並ぶ」へ改訂する(統括担当が Issue 本文を更新する)。

### 2.3 実物確認の結果

**危険度コード(公式資料 別表4で確認・確定)**

| コード | 名称(別表4) | サンプル出現 |
|---|---|---|
| 50 | 特別警報級 | なし |
| 30 | 警報級 | なし |
| 20 | 注意報級 | なし(解説資料の記載例にあり) |
| 01 | 注意報級未満 | あり |
| 51 | 警戒レベル５相当 | なし |
| 41 | 警戒レベル４相当 | なし |
| 31 | 警戒レベル３相当 | なし(解説資料の記載例にあり) |
| 22 | 警戒レベル２相当 | なし |
| 21 | 警戒レベル２ | なし |
| 11 | 警戒レベル２未満 | あり |
| 00 | 値なし(予測の確度が十分でない期間又は予測対象外の期間) | あり(霜・高潮) |

- 別表4に「危険警報級」に当たる非レベル系コードは無い。紫(level-4)に到達するのは 41 のみ。
- 21「警戒レベル２」と 22「警戒レベル２相当」の意味の違いは資料から読み取れなかった(§9)。
- 解説資料: 量的値の `condition="値なし"` は、対応する時間帯の危険度コードが 00/01/11 のときに記載されることがある。風向・風速の `condition="風雪"` は雪を伴う場合。

**block 構成(サンプル4本・稚内市等。江東区の実電文はサンプルに無い)**

| block | Duration | コマ数 | 内容 |
|---|---|---|---|
| 1 | PT3H | 8〜14 | 危険度(大雨浸水・土砂災害・風・雪・波・高潮・雷・融雪・濃霧・着氷・着雪)と量的予想(雨・風・雪・波・高潮) |
| 2 | PT24H | 2 | 量的予想のみ(24時間最大雨量・24時間最大降雪量) |
| 3 | PT24H と PT6H/PT12H/PT18H の混在 | 2〜3 | 危険度(乾燥・なだれ・低温・霜)と量的予想(実効湿度・最小湿度) |

- 危険度にも量的予想にも `Local/AreaName`(陸上／海峡名、オホーツク海側／日本海側等)による区分がある。
- API の `values` はパーサーの `globalSequence`(電文内の出現順、全 block 通し)で並ぶ(`warningTimeseriesRepository.ts` の `ORDER BY sequence`)。したがって配列順＝電文の出現順として扱える。`timeDefines.sequence` は block 内の順。
- 江東区の Kind には Name/Code が無い(#14 §4 記録)。行見出しは `propertyType`/`valueType` から作り、`kindName` を使わない。

## 3. 構成

### 3.1 モジュール構成

ファイル名・内部関数分割は製造裁量。§7 の許可一覧の外に出ないこと。

| ファイル | 種別 | 役割 |
|---|---|---|
| `apps/web/src/api/warningTimeseries.ts` | 新規 | `fetchTileCatalog` を `path: '/api/weather/warning-timeseries'` で呼び、`parseWarningTimeseriesResponse` で検証(`api/warnings.ts` と同じ作り) |
| `apps/web/src/map/panels/warningTimeSeries/warningTimeSeriesModel.ts` | 新規 | 純粋関数: コード表、表モデル組み立て、現在列の決定、列ラベル |
| `apps/web/src/map/panels/warningTimeSeries/useWarningTimeSeries.ts` | 新規 | `useTileCatalogPolling` によるポーリング。`InfoPanelCardInput`(1件)を返す |
| `apps/web/src/map/panels/warningTimeSeries/WarningTimeSeriesContent.tsx` | 新規 | パネル本文(危険度表＋「詳細」ボタン＋ダイアログ) |
| `apps/web/src/map/panels/warningTimeSeries/WarningTimeSeriesDetail.tsx` | 新規 | 詳細ダイアログ本文(3時間表・別欄の表＋凡例) |
| `apps/web/src/map/panels/warningTimeSeries/warningTimeSeries.css` | 新規 | スタイル。`apps/web/src/index.css` に `@import` 1行を追加 |
| `apps/web/src/map/WeatherMapView.tsx` | 変更 | `useWarningTimeSeries` を呼び `infoPanelInput.warningTimeSeries` に渡す |
| `apps/web/src/map/panels/panelFixtures.ts` | 変更 | `all-content` の警報等時系列の仮入口を本物の内容へ差し替え、フィクスチャ `warning-timeseries` を追加(§6) |
| `apps/web/src/map/panels/detailDialogFixtures.tsx` | 変更 | `WarningTimeSeriesDetailFixtureEntry` とそのサンプルを削除(#61 §10)。地域時系列予報側は残す |
| `apps/web/tests/warningTimeSeriesPanel.test.ts(x)` | 新規 | 単体テスト |

時系列表は、詳細の3時間表にだけ G10 の `DetailTimeSeriesTable` を使う(行見出し固定・`initialColumnKey` による初期位置合わせが既にあるため)。パネル本体は3列窓で日付行を出さないため、`warningTimeSeries/` 内の単純な `<table>` とする(§4.2、UI監修 §2.1-13)。`apps/web/src/map/detail/**` は §4.6 の吸着見出し(オプトイン)以外では変更しない。

### 3.2 型・シグネチャ

```ts
// apps/web/src/api/warningTimeseries.ts
export function parseWarningTimeseriesResponse(
  body: unknown,
  requested: WeatherControlStatus,
): WarningTimeseriesResponse | null;
export function fetchWarningTimeseries(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}): Promise<TileCatalogResult<WarningTimeseriesResponse>>;
```

`parseWarningTimeseriesResponse` の検証: ルートがオブジェクト、`controlStatus === requested`、`isTraining === (requested === 'training')`、`metadata.availability` が3値のいずれか、`metadata.issuedAt` が文字列か null、`data` が null またはオブジェクトで `timeDefines`・`values` が配列。各 timeDefine の `blockId`・`timeId`・`timeFrom`・`timeTo` が文字列、`sequence` が数値。各 value の `blockId`・`refId`・`propertyType`・`valueType`・`valueText` が文字列、`valueCategory` が `risk|quantity`、`valueCode`・`unit`・`condition`・`areaDivision` が文字列か null。不一致は null(取得失敗扱い)。`additions` は null または配列で、配列の各要素の `blockId`・`propertyType`・`text` が文字列、`areaDivision` が文字列か null、`scope` がオブジェクトで `localIndex` が数値か null、`additionIndex`・`noteIndex` が数値であることを検証する(`additions` の欠落・不正は null と区別し、応答全体を取得失敗とする)。`values[].scope`・`capabilities` は検証・使用しない。

```ts
// warningTimeSeriesModel.ts
export type RiskDisplay = 'level5' | 'level4' | 'level3' | 'level2' | 'below' | 'noValue' | 'missing';
export const RISK_CODE_TABLE: Readonly<Record<string, { readonly name: string; readonly display: RiskDisplay }>>;
export function classifyRiskValue(value: WarningTimeseriesValue | undefined): RiskDisplay;
export interface RiskCell {
  readonly display: RiskDisplay;
  readonly label: '切迫' | '危険' | '警戒' | '?' | null; // §4.3
  readonly sources: readonly { readonly blockId: string; readonly timeId: string }[]; // 由来の区間(テスト・aria用)
}

export interface WtsColumn { readonly key: string; readonly timeFrom: string; readonly timeTo: string; readonly label: string }
export interface WtsRow<C> { readonly key: string; readonly label: string; readonly cells: readonly C[] }
export interface RiskTable {
  readonly baseBlockId: string;
  readonly columns: readonly WtsColumn[];
  readonly allRows: readonly WtsRow<RiskCell>[];     // 詳細用(非表示行を含む)
  readonly visibleRows: readonly WtsRow<RiskCell>[]; // パネル用(§4.2 行の表示条件)
  readonly currentColumnKey: string | null;
}
/** 危険度が0件なら null */
export function buildRiskTable(data: WarningTimeseriesData, now: number): RiskTable | null;
export function selectBaseBlockId(data: WarningTimeseriesData): string | null;
/** 基準列1つに対する他 block の区間の当てはめ(§4.2 包含判定) */
export function resolveMergedDisplay(column: WtsColumn, intervals: readonly { timeFrom: string; timeTo: string; display: RiskDisplay }[]): RiskDisplay;
export function assignTransitionLabels(displays: readonly RiskDisplay[], initialIndex: number | null): readonly RiskCell['label'][];
/** 詳細: 基準 block の量的予想の行(3時間表に追加) */
export function buildBaseQuantityRows(data: WarningTimeseriesData, baseBlockId: string): readonly WtsRow<DetailCell>[];
/** 詳細「別欄」: 基準以外の block の量的予想を block ごとの表で返す */
export function buildSeparateQuantityTables(data: WarningTimeseriesData, baseBlockId: string | null): readonly {
  readonly blockId: string;
  readonly columns: readonly WtsColumn[]; // label は formatIntervalHeader
  readonly rows: readonly WtsRow<DetailCell>[];
}[];
/** 備考(§4.4)。rowKey は3時間表の行キー。対応行の無い Note は捨てる。additions===null なら null。備考列は常時表示(byRow が空でも列は出す) */
export function buildRemarks(
  additions: readonly TimeseriesAddition[] | null,
  rows: readonly { readonly key: string; readonly propertyType: string; readonly areaDivision: string | null }[],
): { readonly byRow: ReadonlyMap<string, string> } | null;
export function formatIntervalHeader(timeFrom: string, timeTo: string): string; // §4.4
export function selectPanelColumns(columns: readonly WtsColumn[], now: number): readonly WtsColumn[]; // §4.2 3列窓
export function resolveCurrentColumnKey(columns: readonly WtsColumn[], now: number): string | null;
export function buildWarningTimeSeriesCard(
  response: WarningTimeseriesResponse,
  availability: 'available' | 'stale',
  now: number,
): InfoPanelCardInput;
```

`DetailCell` は `{ kind: 'quantity'; text: string; condition: string | null } | { kind: 'noValue' } | { kind: 'missing' }` とする(名称は製造裁量)。

## 4. 振る舞い

### 4.1 見出し・取得状態(G1 always 規則)

- 見出し1行目は `panelDefinitions.ts` の title「警報等時系列」とする。2行目の対象名は `panelTargets.ts` の `warningTimeseries.displayName` を使う。時刻は `metadata.issuedAt` を `timeKind: 'issued'` で渡す。`fetchedAt`・`evaluatedAt`・各 `kindDateTime` は見出しに使わない。

| 状態 | カード(常に1件、`key: 'warningTimeSeries'`) |
|---|---|
| ポーリング `loading` | `status: { kind: 'loading' }`(スケルトン) |
| ポーリング `failed`(保持値なし) | `failed`(「取得できませんでした」) |
| 応答 `data === null`(`unavailable`) | `failed`。未取得を「危険度なし」で表さない |
| 応答 `data` あり・`metadata.issuedAt === null` | `failed`(契約外) |
| 応答 `data` あり・危険度の値が0件(`buildRiskTable` が null) | `data` 状態。本文は「危険度の情報がありません」の1行と「詳細」ボタン【設計案】。VPWP50 は常に危険度を含むため、解析欠落の可能性がある状態として正常空と文言を分ける |
| 応答 `data` あり・表示行が0件(3列窓の中で全行が §4.2 の条件で非表示) | `data` 状態。本文は「注意が必要な時間帯はありません」の1行と「詳細」ボタン【設計案】。これが**正常な空**である |
| 応答 `data` あり・表示行あり | `data` 状態。本文は表と「詳細」ボタン |
| ポーリング `stale`(前回応答あり) | 前回応答から `availability: 'stale'` で組み立てる(G1 現行どおり装飾なし。G9 #60 の決定までの暫定) |

- 正常な空(発表時刻付きの `data` 状態と文言)と取得不能(`failed`「取得できませんでした」)は、文言とカード状態の両方で区別する。
- `now` はデータ更新時(`useMemo` の依存に応答を含める)に `Date.now()` で取る。現在列を追従させるタイマーは置かない。

### 4.2 パネル本体の危険度表(1表)

**基準 block**: `valueCategory === 'risk'` の値を含む block のうち、列の最大長(`timeTo − timeFrom`)が最小のものとする。同じ長さなら `timeDefines` 上の初出順で先のものを選ぶ。サンプルでは 3時間刻みの block1 が選ばれる。列は基準 block の `timeDefines` を `sequence` 昇順で並べ、全コマを出す。

**行**:
- キーは `(propertyType, areaDivision)` とし、全 block を通して `values` 配列で最初に現れた順に並べる(電文の出現順。§2.1-1)。
- **同じ種類の連続配置**(§2.1-16。出現順の唯一の例外): `propertyType` が同じで `areaDivision` が異なる行は、その `propertyType` の最初の出現位置にまとめて連続して並べる。まとまりの中の順は、各区分の最初の出現順とする。見出し行は作らない。例: 出現順が 風(陸上)→雷→風(東京湾) なら、表示は 風(陸上)→風(東京湾)→雷。詳細の3時間表(危険度行・量的予想行とも)にも同じ規則を適用する。量的予想は `(propertyType, valueType)` を種類とみなす。基準 block の行が先、日単位の行(乾燥等)が後になるのは、電文の順がそうなっているからであり、並べ替えではない。
- 行見出しは、`propertyType` の末尾「危険度」を除いた文字列とする(例「大雨浸水」「乾燥」)。`areaDivision` が非 null なら区分名を付ける(例「風(陸上)」)。`kindName` は使わない。

**セルの値**:
- 基準 block の行: `(blockId, refId === timeId)` で結合する。添字位置では結合しない。
- 他 block(日単位等)の行: 行の各値を区間 `[timeFrom, timeTo)` として、基準列 `[f, t)` ごとに `resolveMergedDisplay` で当てはめる(§2.1-7)。
  1. 列と重なる区間(`F < t && f < T`)を集める。
  2. 重なる区間が1つもない場合(日単位データの予報期間外): `noValue`(空白)とする。別表4の「値なし」の定義(予測対象外の期間)と同じ意味のため、未満にも欠測にもしない。
  3. 1つの区間が列を完全に含む場合(`F <= f && t <= T`): その区間の値を複製する。
  4. 列が区間境界をまたぐ場合(3時間列と日区間の境界がずれている場合): 重なる全区間の値のうち、次の優先順位で最も上のものを採る。`level5 > level4 > level3 > level2 > missing > below > noValue`。危険度の高い側を見落とさないためであり、欠測は「未満」「値なし」より優先して見せる。
- 実電文の日区間(PT24H・PT18H 等)の境界は JST 0時・6時等の3の倍数時刻で、3時間列と揃うと見込まれる。ただし実電文(江東区)では未確認のため、規則4は防御として実装し単体テストで確かめる。
- 基準 block の範囲外にある日区間(翌々日以降など)は、パネルには出さない(3列窓は基準列だけから選ぶ)。
- **詳細3時間表の延長列**(§2.1-33): 詳細の3時間表だけで、基準列の右に日単位の列を足す。
  - 対象: 基準 block 以外の block にある危険度の区間のうち、`timeFrom >= 基準の最終列の timeTo`(基準期間の終端以降に始まる区間)のもの。
  - 同じ `(timeFrom, timeTo)` の区間は1列にまとめ、`timeFrom` 昇順に並べる。
  - 基準期間と重なる区間は、従来どおり3時間列へ複製する(§4.2 の規則1〜4)。延長列には出さない。
  - 基準期間の終端をまたぐ区間(`timeFrom < 終端 < timeTo`)は、重なる部分だけを複製し、はみ出した部分は延長列にしない。実電文では日区間の境界が JST 0時で、基準期間の終端(サンプルでは0時)と揃うため、この場合は起きない見込みである(未確認)。
  - 列の見出し: `at = timeFrom`。日付行は共通部品の既定どおり(例「9/29(火)」)とし、時刻行は空欄(`timeLabel: ''`)とする(ユーザー決定)。読み上げ用に、延長列の各セルの `aria-label` の時間帯部分には `formatIntervalHeader` の結果(「29日」、日界と一致しなければ「29日12時まで」)を使う。
  - 延長列のセル:
    - その区間の値を持つ日単位の危険度の行は、`(blockId, refId === timeId)` で結合する。
    - それ以外の行(3時間刻みの危険度、量的予想、風向・風速)は空白とする。この空白は `outOfRange` 区分で、見た目は値なしと同じ、読み上げは「対象期間外」である。欠測「?」にはしない。
  - 列幅は3時間列と同じにする。
  - 初期スクロール(`initialColumnKey`)は基準列だけから決める。全列が過去のときも、延長列ではなく基準の末尾列とする。
  - 吸着見出しは延長列も含めて同期する(列として追加するだけ)。
  - 備考列は延長列のさらに右で、右端に固定する。
  - 切替文字(§4.3)は、延長列も同じ行の続きとして判定する。
  - 別欄の表は変えない。

**行の表示条件(§2.1-9・10、確定)**:
- パネル本体には、**パネルに表示する3列の中に** `level2`〜`level5` のセルを1つ以上含む行だけを表示する(`visibleRows`)。判定範囲は3列の中とする(§2.1-19、ユーザー確定)。
- 全セルが `below`・`noValue`・`missing` だけの行は非表示とする。欠測だけの行も隠す。欠測は詳細で「?」として区別できる(§2.1-10)。
- 詳細ダイアログには全行(`allRows`)を表示する。

**パネルの表示列(3列窓、§2.1-13)**: `selectPanelColumns(columns, now)` で決める。
- `timeFrom <= now < timeTo` の列(現在列)があれば、現在列とその後の2列を表示する。後ろに2列が無ければ、ある分だけ(1〜2列)を表示する。過去の列で埋め合わせない。
- 全列が未来(`now < 先頭 timeFrom`)なら、先頭から3列を表示する。
- 全列が過去(`now >= 末尾 timeTo`)なら、表示列は0件とする。本文は「最新の予想時間帯がありません」の1行と「詳細」ボタン【設計案】とする。発表時刻は見出しに出るため、古い予想であることは分かる。
- 列が0件なら表を出さない(危険度0件と同じ扱い)。

**詳細の初期位置**: 詳細の3時間表だけ、`resolveCurrentColumnKey` の結果を `initialColumnKey` に渡す(従来どおり)。
- 現在列があればその列、全列が未来なら先頭列、全列が過去なら末尾列、列0件なら null。

**表示(パネル)**:
- パネルは `DetailTimeSeriesTable` を使わず、`warningTimeSeries/` 内の単純な `<table>` とする(部品には日付行があり、`map/detail/**` は変更禁止のため)。列見出しは時刻の1段だけ(JST `H-H`、例「21-24」。終端0時は24と書く。§2.1-24)で、日付行は出さない。
- 横スクロールを出さない(表・パネル列とも `scrollWidth <= clientWidth`)。初期スクロール処理は持たない。
- セル寸法(§2.1-14): 全データセルを固定の同じ大きさにする(例: `inline-size: 3rem; block-size: 1.75rem`。数値は製造裁量)。文字の有無でセルの幅・高さが変わらないこと。行見出し列は残りの幅を使い、折り返し可。最小のパネル列幅(18rem)でも3列が収まること。
- 詳細の3時間表でも、データセルは文字の有無で大きさが変わらないようにする(`DetailTimeSeriesTable` の列幅はそのままで、セル内の色塗り要素を同じ大きさにする)。

### 4.3 セルの段階・文字

| コード | 表示区分 | 色トークン | 文字 | 確度 |
|---|---|---|---|---|
| 50 特別警報級 / 51 警戒レベル５相当 | level5 | `--wx-alert-level-5-*` | 切迫(切替セルのみ) | コード対応は別表4で確定。色・文字はユーザー決定 |
| 41 警戒レベル４相当 | level4 | `--wx-alert-level-4-*` | 危険(切替セルのみ) | 同上 |
| 30 警報級 / 31 警戒レベル３相当 | level3 | `--wx-alert-level-3-*` | 警戒(切替セルのみ) | 同上 |
| 20 注意報級 / 22 警戒レベル２相当 / 21 警戒レベル２ | level2 | `--wx-alert-level-2-*` | なし | 同上。21と22の差は【未確認】 |
| 01 注意報級未満 / 11 警戒レベル２未満 | below | 無着色(`--md-sys-color-surface` 系) | なし | 確定 |
| 00 値なし、および日区間の期間外 | noValue | 無着色 | なし(空白。§2.1-17) | 確定 |
| 値なし(ref 欠落)・`valueCode` null・表外コード | missing | `--md-sys-color-surface-container-highest` 地に破線縁 `--md-sys-color-outline` | 「?」を全セルに付ける | 欠測を低危険度扱いしない(§2.1-2)。表現は【設計案】 |

- **切替セルの規則**(`assignTransitionLabels`): 行の列順に見て、表示区分が `level3`〜`level5` で、かつ直前の列と表示区分が異なるセルにだけ文字を付ける。
  - 区分の比較は表示区分で行う。50と51はどちらも level5 のため、続いていれば切替とみなさない。
  - 間に `missing`・`noValue`・`below` 等を挟んで同じ段階に戻った場合も、直前の列と異なるため再び文字を付ける。
  - **行頭**: 判定はデータの先頭列(列 index 0)から行う。先頭列が level3 以上なら先頭列に文字を付ける。
  - **初期列の補い**(§2.1-11): 詳細の3時間表では、`initialColumnKey` の列のセルが level3 以上なら、切替でなくても文字を付ける。関数は `assignTransitionLabels(displays, initialIndex: number | null)` とする。
  - **パネル**: パネルでは、表示する3列の先頭列を `initialIndex` として渡す。先頭列が level3 以上なら文字が付き、2・3列目は全期間の直前列との比較で切替を判定する。
  - 再計算はデータ更新時だけとし、スクロールには追従しない。
- 「?」は段階ではないため、全ての欠測セルに付ける。未満・値なしはどちらも無着色の空白とし(§2.1-17)、欠測は「?」と破線縁で区別する。未満と値なしは見た目では区別されず、`aria-label`(「注意報級未満」「値なし」)でだけ区別される(§9)。
- 段階色セルは container 地・on-container 文字・1px outline 縁とする(#54 と同じ構造)。
- 段階は `valueText`(電文の Name)・コードの大小・名称の部分一致では決めない。表のコードだけで決める。
- 各セルに `aria-label`(例「21-24時 警報級」。読み上げ用なので「時」を付けたままにする)を付ける。文字が無いセルの段階も支援技術で分かるようにするため。

### 4.4 詳細ダイアログ【設計案・見た目は後日ユーザー監修】

- 入口: パネル本文の下に `GbButton`(text)「詳細」を置く。`DetailDialog` の `meta` は、title「警報等時系列」、target はパネル見出しと同じ対象名、time `{ kind: 'issued', value: metadata.issuedAt }`、`isTraining` は応答の値とする。`scrollContainer` は `useDetailDialogScrollContainer()` を使う。
- **(1) 3時間表**: `DetailTimeSeriesTable` を1つ使う。列と初期列はパネル本体と同じにする。
  - 行は危険度の全行(`allRows`、非表示行を含む)と、基準 block の量的予想行(`buildBaseQuantityRows`)を、`values` の出現順に並べる。
  - 量的予想行のキーは `(propertyType, valueType, areaDivision)` とする。行見出しは `valueType` に、区分名と単位(例「最大風速(陸上) m/s」)を付ける。
  - 危険度セルは §4.3 と同じ表示とし、切替セルの規則も同じにする。
- **(2) 別欄**: 基準 block 以外の block にある量的予想(24時間最大雨量・24時間最大降雪量・実効湿度・最小湿度等)を、block ごとに小さな表で並べる。列数が2〜3と少ないため `DetailTimeSeriesTable` は使わず、`warningTimeSeries/` 内の単純な `<table>`(行見出し `th scope="row"`)とする。
  - 列見出しは `formatIntervalHeader(timeFrom, timeTo)` で生成する。TimeDefine/Name は保存されていない。`timeFrom` は DateTime、`timeTo` は DateTime＋Duration に相当する。
    - JST で `timeFrom` が0時、かつ `timeTo − timeFrom` がちょうど24時間の場合: 「D日」(D は `timeFrom` の JST 日)。
    - それ以外(日界と一致しない区間): 「D日H時まで」(D・H は `timeTo` の JST 日・時)。`timeTo` が JST 0時なら前日の「24時まで」と書く(例 `timeFrom` 22日06時、`timeTo` 23日00時 → 「22日24時まで」)。
    - 区間が複数日にまたがる、または24時間を超える場合も、同じく「D日H時まで」とする。
  - 月は出さない(発表から数日の範囲のため)。
- 量的予想セル: `valueText` をそのまま表示する(数値へ変換しない。最大値・範囲へ縮退しない)。`condition === '値なし'` は空白とする(§2.1-17)。その他の `condition`(例「風雪」)は表示しない(§2.1-28)。`description` はセルに表示しない(`aria-label` には使ってよい)。対応する値が無ければ「?」とする。
- **凡例**: 本文の先頭に、見本セルと名称を並べる。
  - レベル5/特別警報級「切迫」、危険警報級「危険」(§2.1-15)、レベル3/警報級「警戒」、レベル2/注意報級(文字なし)
  - 未満・値なし(空白)、欠測・未取得「?」
  - 注記は置かない(§2.1-15)。
  - パネル本体には凡例を置かない。
- **備考列(付加事項。§2.1-21)**: 3時間表にだけ置く。別欄・パネルには置かない。
  - **列**: 3時間表の最終列を「備考」とする。`DetailTimeSeriesTable` の `columns` の末尾に `{ key: 'remarks', at: <最終時間列の at>, timeLabel: '備考' }` を足し、各行の `cells` の末尾に備考セルを1つ足す。`at` を最終時間列と同じにするのは、日付行に新しいラベルや境界線を出さないためである。
  - **右端固定**: `warningTimeSeries.css` で、ラッパー(例 `.wts-detail-3h`)配下の `.detail-ts-table tr > :last-child` に `position: sticky; inset-inline-end: 0; z-index: 1;`、背景 `--md-sys-color-surface-container-high`、左境界線 `--md-sys-color-outline-variant` を指定する。幅は `min-inline-size: 6rem; max-inline-size: 10rem; white-space: normal`【設計案】。
    - 既存実装の確認結果: `.detail-ts-scroll` が `overflow-x: auto` の横スクロール容器で、行見出しは同じ sticky 方式(`inset-inline-start: 0`)で固定されている。子孫セレクタで右端にも同じ方式を当てれば固定できるため、`apps/web/src/map/detail/**` の変更は不要(変更禁止を維持)。
    - 初期スクロールは `target.offsetLeft - corner.offsetWidth` で左側だけを基準にするため、右端の固定列の影響を受けない。
    - 日付行の最終セルも `:last-child` で固定される。空欄なので害はない。
  - **結合**: 備考の対象は行単位とする(`buildRemarks`)。`(blockId, refId)` の時間セルへは複製しない。
    - `scope.localIndex !== null`(Local 内の Note)は、`propertyType` と `areaDivision` が一致する全ての行(量的予想なら各 `valueType` の行)の備考とする。
    - `scope.localIndex === null`(Base 直下の Note、`areaDivision === null`)は、その `propertyType` の全ての行の備考とする。区分なしの行があればその行に、区分行しか無ければ各区分行に同じ本文を複製する(ユーザー決定 2026-09-27)。
      - #33 §3.4 の「Base の補足を各 Local へ複製しない」は、保存・API 層の方針である。API は引き続き Base の Note として返す。画面表示での複製は、ユーザー決定による例外として記録する。
    - 時間セルへは複製しない。
    - 危険度の Note は `blockId` を照合に使わない。日単位 block の危険度も3時間表の行へ統合済みのため(§4.2)。同じ `(propertyType, areaDivision)` の Note が複数 block にある場合も、下の連結規則で1つにまとめる。
    - 量的予想の Note は、同じ `blockId`(時間区切り)の行にだけ載せる。3時間表以外の block(24時間最大雨量など、別欄の量的予想)の Note は3時間表の行に載せず、表示しない(検収で判明した規則と AC-19/21 の矛盾をユーザー決定で解消 2026-09-27)。
  - **表示形式**: 同じ行に載る Note は `(blockId の timeDefines 初出順, scope.kindIndex, propertyIndex, partIndex, baseIndex, localIndex, additionIndex, noteIndex)` の順、つまり電文の出現順とし、「、」で連結する。重複も除去しない(#33 §3.4 の保持方針に合わせる)。
  - **対応行が無い Note**: 3時間表に対応する行が無い Note(例: 別欄だけにある量的予想の Property、Local の区分名が一致しない Note)は表示しない。件数も画面に出さない(ユーザー決定 2026-09-27)。
    - パネルで非表示になった行は、詳細の3時間表には全行あるため、このケースに当たらない。
  - **null と空配列の区別**:
    - 備考列は常時表示する(ユーザー決定 2026-09-27、列を隠す案は撤回)。`additions === []`、または備考に載る Note が1つも無い場合も列を出し、全セルを空白とする。該当が無い行は空白とする。
    - `additions === null`(旧保存値で未抽出): 備考列を出す。全セルを空白とし、列見出しを「備考(未取得)」とする。表の直下に「付加事項は取得できていません」の1行を出す(ユーザー決定)。「なし」とは表示しない。
  - パネル本体には備考を表示しない。

### 4.5 会場・訓練

- 要求の `terminalId`/`controlStatus` は `WeatherMapView` の既存値をそのまま使う。parse で `controlStatus` 不一致・`isTraining` 矛盾を null にし、訓練データを本番表示に混ぜない。パネル上の訓練表示は、G1〜G3 と同様に付けない。詳細ダイアログは `isTraining` を meta に渡す(表示は既存部品が担う)。

### 4.6 詳細3時間表の吸着見出し(§2.1-23)【推奨案: 共通部品へのオプトイン追加】

**既存構造の確認(実装を読んだ結果)**
- `DetailDialogInner` は、見出し `header.detail-dialog-heading`(タイトル・閉じるボタン・メタ)と、本文 `div.detail-dialog-body`(`overflow: auto`、縦スクロール領域)を兄弟として並べる。閉じるボタンなどの見出しは本文のスクロール領域の外にあるため、本文上端に吸着する要素と重ならない。
- `DetailTimeSeriesTable` は `div.detail-ts-scroll`(`overflow-x: auto`)の中に1つの `<table>` を置き、`thead` に日付行と時刻行を持つ。行見出しは `position: sticky; inset-inline-start: 0` で固定している。
- `overflow-x: auto` の要素は縦方向にもスクロール容器になる。このため `thead` に `position: sticky; top: 0` を当てても、基準が `.detail-ts-scroll`(縦にスクロールしない)になり、`.detail-dialog-body` の縦スクロールには吸着しない。CSS だけでは実現できない。
- `DetailDialogScrollContainerContext` はダイアログを閉じた後に右側列の位置を戻すためのもので、本件には使わない。

**比較**

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| (a) 共通部品にオプトイン機能を追加【推奨】 | `DetailTimeSeriesTable` に `stickyHeader?: boolean` を追加する。true のときだけ、見出しを別の横スクロール領域に分け、本文と横スクロールを同期する | 日付ラベル・初期スクロール・行見出しの固定を1か所で保てる。G5/G6 の時系列表も同じ機能を使える | `map/detail/**` の変更許可が必要。既定値の false で既存の出力が変わらないことを回帰 AC で守る |
| (b) 警報等時系列側で独自に作る | 見出しの複製とスクロール同期を `warningTimeSeries/` 内で作る | 共通部品に触れない | 日付ラベル・初期スクロール・固定列の処理が二重になる。後続パネルでも同じものを作り直すことになる |

**(a) の仕様**
- 追加する props は `stickyHeader?: boolean`(既定 false)と、`TimeSeriesColumn.width?: string`(任意。列幅の指定)の2つ。false のときの DOM・クラス・挙動は現行と完全に同じにする。
- true のときの構造:
  - 外側 `div.detail-ts-sticky`: overflow を持たない。吸着の範囲をこの表に限る。
  - 見出し `div.detail-ts-head`: `position: sticky; inset-block-start: calc(-1 * var(--detail-dialog-body-padding-top, 0px)); z-index: 2; overflow-x: hidden;` 背景 `--md-sys-color-surface-container-high`。中に `thead` だけの `<table>` を置き、日付行と時刻行を持つ。
  - 本文 `div.detail-ts-scroll`: `tbody` だけの `<table>` を置く。横スクロールと、`region`・`tabIndex=0`・`aria-label` はこちらが担う。
  - 2つの表は `table-layout: fixed` とし、同じ `<colgroup>` を持つ。行見出し列は `var(--detail-ts-row-header-width, 7rem)`、データ列は `column.width ?? var(--detail-ts-column-width, 4rem)` とする。これで列幅が一致する。
- **統括担当による実装修正の記録**:
  - 48f5e2a(列幅ずれの解消): `table-layout: fixed` と `colgroup` だけでは、見出しと本文の表で列幅がずれた。原因は、既存のセル規則(`td` の `min-inline-size` 等)が固定レイアウトの列幅に干渉したことである。このため、次の2点を行った。
    - 2つの表の両方に、列幅の合計(行見出し列の幅＋各列の幅)を `inline-size` として明示する。
    - オプトイン時のセルでは、`min-inline-size`/`max-inline-size` を打ち消す。
  - 5fc1593(隙間の解消): `.detail-dialog-body` の上余白(16px)の内側に吸着するため、見出しとダイアログの見出しの間に隙間ができた。このため、次の2点を行った。
    - `.detail-dialog-body` の上余白を CSS 変数 `--detail-dialog-body-padding-top`(16px)にした。
    - `.detail-ts-head` の `inset-block-start` を `calc(-1 * var(--detail-dialog-body-padding-top, 0px))` にし、余白の分だけ上へずらした。
    - これは `detail.css` の既存ルール(`.detail-dialog-body` の padding)の書き換えである。変数化であり、計算上の値は同じ(16px)。§7 の「既存ルールは変えない」の例外として記録する。
- 横スクロールの同期: 本文の `scroll` イベントで `head.scrollLeft = body.scrollLeft` とする。見出し側は `overflow-x: hidden` なので利用者は直接スクロールしない。初期スクロール(`initialColumnKey`)は本文に設定したあとで同期する。計算式(`target.offsetLeft − 行見出し幅`)は変えない。
- 固定列: 行見出し列(左端 sticky)は2つの表の両方に当てる。見出し側も `overflow-x: hidden` のスクロール容器なので、sticky は有効である。警報等時系列の備考列(右端 sticky、`.wts-detail-3h` 配下の `tr > :last-child`)も、2つの表の両方に当たるようにセレクタを書く。
- 吸着の基準は、最も近いスクロール容器である `.detail-dialog-body` の上端とする。見出しはダイアログのヘッダー(閉じるボタン等)の下にあり、重ならない。`detail-ts-sticky` の外に出ると吸着が外れる。このため、別欄の表が見えている位置では3時間表の見出しは出ない。
- アクセシビリティ: 見出しと本文が別々の表になるため、列見出しとセルの表上の関連付けは失われる。警報等時系列のセルは `aria-label` に時間帯を含むため、読み上げは保たれる。共通部品のコメントに、オプトイン時はセル側に時間帯のラベルを持たせる前提であることを書く。
- 警報等時系列では `stickyHeader` を詳細の3時間表にだけ指定する。別欄の単純な表とパネルには使わない。
- (a) の変更は、本 Issue のブランチで製造担当が行う。共通部品の変更であることをコミットと PR 本文で明示する。

### 4.6.1 詳細3時間表での量的予想の行の配置(§2.1-32)

電文出現順の例外として、3時間表の量的予想の行を、次の対応表に従って危険度の行のまとまりに紐付ける。

| 量的予想(基準 block の `propertyType`) | 紐付ける危険度の行(`propertyType`) | 配置 |
|---|---|---|
| 雨(１時間最大雨量等、`雨` の全 `valueType`) | 大雨浸水危険度・土砂災害危険度(洪水危険度が電文にあれば含める。ユーザー決定。別表2・サンプルには出現を確認できていない) | 最終的な行順で、これらの危険度の行のうち最後のものの直後に、`雨` の行を出現順でまとめて置く |
| 風(風向・最大風速) | 同じ区分の風危険度 | §4.7(各区分の危険度の行の直下) |
| 上記以外(雪・波・高潮・乾燥の湿度など) | なし | 出現順のまま(§4.2 の規則) |

- 紐付け先の危険度の行が1つも無い場合は、出現順のまま置く。
- 大雨浸水・土砂災害の行が離れて並ぶ場合(間に別の行がある)も、2つの行は動かさない。雨の行を、そのうち後ろの行の直後に置く(ユーザー決定)。

### 4.7 風向・風速の統合行(詳細の3時間表のみ。§2.1-25〜28)

**統合の対象**
- 基準 block の量的予想で `propertyType === '風'` の値のうち、同じ `areaDivision` で `valueType === '風向'` と `valueType === '最大風速'` の両方の行があるもの。
- 片方しか無い区分は統合せず、従来どおり単独の行とする。風向だけの行でも、セルは下の表示規則で矢印付きにする。
- `風` の Property に他の `valueType` があれば、単独の行として残す。

**行の配置**(電文出現順の例外)
- 統合行は、同じ `areaDivision` の危険度行(`propertyType === '風危険度'`)の直下に置く。
- 危険度行の区分が複数あるときは、「風危険度(陸上)→風向・風速(陸上)→風危険度(東京湾)→風向・風速(東京湾)」と交互に並ぶ。§2.1-16 の同じ種類を連続して並べる規則より、この規則を優先する(ユーザー決定 2026-09-27)。
- 対応する危険度行が無い統合行(区分が一致しない、または危険度に区分が無い)は、`風` の値が最初に現れた位置に置く。統合行どうしが複数あれば、§2.1-16 の規則で連続させる。
- 行見出し(§2.1-30):
  - 同じ区分の風危険度行の直下に置かれた統合行: 「風向・風速」＋空白＋最大風速の `unit`(例「風向・風速 m/s」)。区分名は付けない。
  - 直下に置けなかった統合行(対応する危険度行が無く、`風` の最初の出現位置に置かれたもの)で、かつ `areaDivision` が非 null の場合: 区分が読み取れなくなるため「風向・風速(陸上) m/s」と区分名を付ける。
  - `unit` が null なら単位を付けない。
  - 読み上げ(セルの `aria-label`・行見出しの `aria-label`)には、表示に関係なく区分名を含める(例「21-24時 陸上 北西の風 15メートル毎秒」)。
- 備考: `風` の Property の Note は統合行に載せる(§4.4 の規則で、区分が一致するもの)。

**セルの結合**: 各時間列で、同じ `(blockId, timeId)` の風向の値 d と最大風速の値 s を取る(§2.1-31)。
- d の状態:
  - `8方位` = §4.7 の8語のいずれか
  - `方位外` = 値があるが8語以外(静穏等)
  - `値なし` = `condition === '値なし'`
  - `欠測` = 値の要素が無い
- s の状態: `値` / `値なし` / `欠測`

セルは2段とする。上段は d、下段は s を表す。

| 状態 | 上段(d) | 下段(s) |
|---|---|---|
| 8方位 / 値 | 矢羽(回転) | 風速の `valueText`(例「15」) |
| 方位外 | 「－」 | — |
| 値なし | 空白 | 空白 |
| 欠測 | 「?」 | 「?」 |

- 上段と下段は独立に決める(例: d=値なし・s=値 → 上段は空白、下段は「15」)。
- d・s とも値なしのときは、上下とも空白になる。
- 読み上げ(`aria-label`)は、時間帯＋区分名＋風向部分＋風速部分とする。
  - 風向部分は「北西の風」(方位外は「静穏の風」のように原文＋「の風」)、値なしは省く、欠測は「風向欠測」。
  - 風速部分は「15メートル毎秒」、値なしは省く、欠測は「風速欠測」。
  - 両方が値なしなら「値なし」とする。
- 高さ(§2.1-14 の同寸規則との関係):
  - 統合行のデータセルは全て同じ2段の高さとし、文字の有無で変えない。
  - 統合行は他の行より高くなる(1行の高さの約2倍)。行見出しのセルも同じ行の高さに伸びる。
  - 他の行の高さは変えない。
  - 上段の矢羽は 24px(332af31 でユーザーが変更)、下段は本文と同じ文字サイズとし、行間は詰める。数値は製造裁量。
- 読み上げの単位は、`unit === 'm/s'` なら「メートル毎秒」、それ以外は `unit` の原文とする。
- `condition === '風雪'` は表示にも読み上げにも使わない(§2.1-28)。`description` も使わない。

**方位→矢印**
- 方位は `valueText`(`unit === '８方位漢字'`)を、次の8語との完全一致で変換する。回転角は `navigation` を**風下**へ向ける角度(北=0°、時計回り)で、風が吹いてくる方位＋180° である。

| valueText | 北 | 北東 | 東 | 南東 | 南 | 南西 | 西 | 北西 |
|---|---|---|---|---|---|---|---|---|
| 回転角 | 180 | 225 | 270 | 315 | 0 | 45 | 90 | 135 |

- 8語以外(`unit` が違う場合、未知の文字列、将来の16方位・「静穏」等)は、矢羽を付けず上段を「－」とする。推測で近い方位に丸めない。原文は読み上げにだけ残す(「(原文)の風」)。

**矢印の描き方**(既存資産に合わせる)
- Material Symbols Outlined は `apps/web/index.html` で Google Fonts から読み込み済みである。既存の利用例は `map/detail/DetailDialogIcon.tsx` と `.detail-dialog-close-icon`(`font-family: 'Material Symbols Outlined'` の `span` に、アイコン名の文字列をリガチャとして入れ、`aria-hidden="true"` を付ける方式)。これと同じ方式で `warningTimeSeries/` 内に小さな部品を作る(`map/detail/**` は変更しない。`DetailDialogIcon` は閉じるボタン用のクラスを持つため流用しない)。
- `<span class="wts-wind-arrow" aria-hidden="true" style="--wts-wind-rotate: 135deg">navigation</span>` の形とする。CSS は次のとおり。
  - `font-family: 'Material Symbols Outlined'` とし、`font-variation-settings` は 'FILL' 1(塗りつぶし)とする(ユーザー決定 2026-09-27)。
  - `font-size: 24px`、`display: inline-block`、`transform: rotate(var(--wts-wind-rotate))`。
  - `color: currentColor`(セル文字色 `--md-sys-color-on-surface` を継承)。HEX は使わない。
- **既定の向きの実物確認**: Google Fonts 配信の `materialsymbolsoutlined/navigation/default/24px.svg` を取得して確認した。path の先端が `(480, -880)`(viewBox `0 -960 960 960` の上端中央)にあり、底辺が下にあるため、**回転0°で上(北)を指す**。上の回転角表はこれを基準とする。
- 回転は `style` 属性に角度だけを渡し、色や寸法を `style` に書かない。
- フォントが読み込めない環境(オフライン等)では、リガチャが「navigation」の文字列として表示される。既存の閉じるボタンと同じ前提であり、本 Issue では対策しない(§9)。

## 5. スタイル

- クラス名は `wts-` 接頭辞。`.info-panel-*`・`.detail-ts-*` を再定義しない(上書きは `.wts-*` 配下の子孫セレクタに限る)。
- HEX・`rgb()` を書かない。`--wx-notice-*` を使わない。
- セル内文字は1〜2字、`font-size` はパネル本文と同等。セルの角丸・余白は製造裁量。

## 6. 開発用フィクスチャ

`WarningTimeseriesResponse` を合成し、本番と同じ `buildWarningTimeSeriesCard` を通す(合成データである旨をコメントに書く)。`all-content` の警報等時系列も、この合成応答から組み立てる(仮入口の撤去)。

新規フィクスチャは次の2つとし、他パネルは `all-content` と同じにする。

- `warning-timeseries`: 通常表示
- `warning-timeseries-quiet`: 全行が未満・値なしで、表示行0件になる正常空

合成応答: `issuedAt` は当日 JST 05:00、列は当日 JST 06:00 起点とする。

| block | 列 | 行(出現順) | 値の例 |
|---|---|---|---|
| 1 (PT3H) | 14 | 大雨浸水、雨(１時間最大雨量 mm)、土砂災害、風危険度(陸上)、風危険度(東京湾)、風(風向・最大風速、陸上/東京湾。北西の風に `condition:'風雪'` を含め、8方位以外の風向「静穏」を1つ入れる)、雷、濃霧 | 大雨浸水: 11,21,21,31,31,41,51,50,31,…(切替セルの確認用)。土砂災害: 22,31,…。風(陸上): 01,20,30,30,50,…。雷: 00 と ref 欠落を1つずつ、表外コード `99` を1つ。濃霧: 全て01(非表示行)。風(東京湾): 01 と欠測だけ(欠測のみの非表示行) |
| 2 (PT24H) | 2 | 雨(２４時間最大雨量 mm)、雪(２４時間最大降雪量 cm) | 数値、`condition:'値なし'` を1つ |
| 3 (PT18H→PT24H→PT24H) | 3 | 乾燥危険度、乾燥(実効湿度 %・最小湿度 %)、霜危険度 | 乾燥: 20,01,20。霜: 全て00(非表示行)。先頭区間は当日06時〜24時 |

`additions`(合成。公式の新潟市の実電文の構造に倣う):
- 雷 Base 直下の「竜巻」「ひょう」(同じ行・出現順)
- 風危険度の Local(陸上)の Note を1つ
- 風危険度の Base 直下の Note を1つ(区分行だけの種類。複製の確認用)
- block2 の雨(24時間最大雨量)の Note を1つ(対応行が無く、表示されないことの確認用)

`warning-timeseries-quiet` は `additions: null` とし、未取得の表示を確認する。

- 行の出現順は §5.7 の順と異なる並びにし、並べ替えられていないことを目視で分かるようにする。
- 単体テスト用には、日区間の境界が3時間列とずれる入力(例: 区間 当日07時〜翌日07時)を別途用意する(AC-4b)。

## 7. 変更を許可するファイル

- 新規: §3.1 の新規ファイル
- 変更: `apps/web/src/index.css`(`@import` 1行のみ)、`apps/web/src/map/WeatherMapView.tsx`(フック呼び出しと `infoPanelInput` の1項目のみ)、`apps/web/src/map/panels/panelFixtures.ts`(§6 の範囲のみ)、`apps/web/src/map/panels/detailDialogFixtures.tsx`(警報等時系列の仮入口・サンプルの削除のみ)
- 変更許可(§4.6 の吸着見出しに限る): `apps/web/src/map/detail/DetailTimeSeriesTable.tsx`(オプトインの prop と分岐の追加)、`apps/web/src/map/detail/detail.css`(新しいクラスの追加と、`.detail-dialog-body` の上余白の変数化(値は16pxのまま。5fc1593)だけ)、`apps/web/tests/detailTimeSeriesTable.test.ts`(ケースの追加だけ。既存ケースは変えない)。
- 変更禁止: `apps/api/**`、`packages/**`、`apps/web/src/map/detail/` の上記以外(`DetailDialog.tsx`・`timeSeriesHeader.ts`・`DetailDialogScrollContainerContext.tsx` 等)、`apps/web/src/map/panels/` の他の既存ファイル、`apps/web/src/theme/**`、既存テスト(仮入口削除に伴い警報等時系列サンプル前提のテストが壊れる場合は、統括へ報告してから最小修正)、設定ファイル
- 注意: #61 の AC-7/AC-8 は警報等時系列サンプル(32列・長い本文)を寸法検証に使っていた。削除後、地域時系列予報サンプルだけで既存テストが通るかを製造時に確認し、通らなければ実装を止めて統括へ報告する。

## 8. 管理項目の結論

| ID | 本Issueでの結論 |
|---|---|
| AD-H048 | 時刻定義の参照関係を `(blockId, refId)`↔`(blockId, timeId)` で結合し、添字結合しない(AC-3)。日単位の危険度は区間の包含判定で3時間列へ統合する(AC-4)。固定現象リストを仮定せず、電文に含まれる危険度の種類だけを出現順で表示する(AC-2)。現在区間を初期位置とし全コマ保持(AC-9)。凡例は詳細のみ(AC-10)。基準範囲より先の日単位の危険度は表示しない(ユーザー決定)。詳細で単位・区分(`areaDivision`)・`condition` を保持して表示し、数値化・最大値化しない(AC-10)。パネルは注意報級以上を含む行のみ表示し、欠測は詳細で区別する(ユーザー決定、AC-7)。付加事項は詳細の3時間表の固定「備考」列に行単位で表示し、時間セルへ複製せず、null(未抽出)と空を区別する(AC-19〜21)。L1 #83 の実データ受入(実寸・色の実測)は未了。保守事項を修正必須へ昇格させない。 |

## 9. 未決事項・実挙動未確認

- 【確定】行の表示条件・欠測行の扱い・初期列の文字補いは、ユーザー決定(§2.1-9〜11)。基準範囲より先の日単位の危険度は、詳細の延長列で表示する(§2.1-33。項12は撤回)。UI監修の項13〜18(3列窓・同寸セル・凡例・区分の連続配置・値なしの空白・正常空の文言)もユーザー決定。
- 【確定】判定範囲は3列の中(§2.1-19)。未満と値なしの見た目が同じになることは了承済み(§2.1-20)。
- 【確定】Base 直下の Note は区分行へ複製して表示し、対応行の無い Note は表示しない。備考列は常時表示し(載るものが無ければ空白)、未抽出のときは「備考(未取得)」とする(ユーザー決定 2026-09-27)。
- 【未確認】実フィードの Note 出現。Note 付きの江東区・大田区の電文は未確認で、フィクスチャで確認する。Local 内の Note はサンプル・実電文ともに未確認で、#33 の合成テストだけが根拠である。
- 【確定】風の危険度行が複数区分あるとき、危険度行と統合行が交互に並ぶ(§4.7)。§2.1-16 より統合行の直下配置を優先する(ユーザー決定 2026-09-27)。矢羽は塗りつぶしとする(ユーザー決定 2026-09-27)。
- 【未確認】実電文の風向が8方位以外の値(静穏等)をとるか。本設計は8語以外を原文表示とする。
- 【前提】Material Symbols は Google Fonts から読み込んでいる(既存と同じ)。オフライン時はアイコン名が文字で出る。
- 【設計案】全列が過去の場合の文言「最新の予想時間帯がありません」。現在列の後ろが2列未満の場合は、ある分だけ(1〜2列)を表示する。
- 【確認済み・防御】日区間と3時間列の境界がずれる場合の規則(§4.2 規則4)は、実電文(江東区)でずれが生じるかは未確認である。
- 【未確認】コード21「警戒レベル２」と22「警戒レベル２相当」の意味の差。どちらも level2 として同じ表示にする。
- 【未確認】実電文で 20/30/50/21/22/31/41/51 が出現した状態(サンプルは 00/01/11 のみ)。フィクスチャでだけ確認する。
- 【未確認】江東区・大田区の実電文での行構成・block 構成。
- 【設計案】欠測の表現、正常空・危険度0件の文言、パネルの列幅、詳細・別欄の見た目。後日ユーザー監修とする。
- 【未決・G9】stale の見せ方。
- 【未確認】現在列の追従。新しい応答が来るまで、初期位置は再計算しない。

## 10. 受け入れ条件

前提: dev サーバーの扱いは [01-dev-workflow-protocol.md](../rules/01-dev-workflow-protocol.md) に従う。単体テストは `apps/web/tests/warningTimeSeriesPanel.test.ts(x)` に置き、描画確認は `renderToStaticMarkup`(ダイアログは `DetailDialogInner`)で行う。`now` は固定値を注入する。

- [ ] AC-1 品質ゲート: `npm run lint`・`npm run typecheck`・`npm run format:check`・`npm run test -w apps/web` がすべて成功する。
- [ ] AC-2 行順(単体): 危険度の種類を「雷→大雨浸水→風(陸上)→土砂災害→乾燥(日単位 block)」の順で含み、すべて level2 以上を持つ `values` を渡す。
  - `allRows` と `visibleRows` の行ラベルがこの順になる。
  - 同じ内容を別の出現順で渡すと、その順に従う。§5.7 順・五十音順に並べ替わらない。
  - パネル本体の表は1つで、量的予想行を含まない。
  - (区分の連続配置、§2.1-16) 出現順が「風(陸上)→雷→風(東京湾)→大雨浸水→風(海上)」の入力で、行順が「風(陸上)→風(東京湾)→風(海上)→雷→大雨浸水」になる。見出し行(「風」単独の行)は無い。量的予想の区分行(詳細の3時間表)も同じ規則でまとまる。
- [ ] AC-3 結合(単体):
  - `timeDefines` を `sequence` 逆順で並べ、`values` の refId をシャッフルした入力でも、基準 block の各セルが同じ timeId の値になる。
  - 別 block の同じ timeId が混ざらない。
  - ref が欠落したセルは `missing` になる。
  - `selectBaseBlockId` が §2.3 の構成で3時間刻みの block を返す。
- [ ] AC-4 日単位の統合(単体):
  - (a) 当日06-24時(PT18H)と翌日0-24時の区間は、それぞれ覆う各3時間列に同じ値が複製される。区間外の列は `noValue` になる。
  - (b) 区間 当日07時〜翌日07時(level3)・翌日07時〜(below)のとき、境界をまたぐ 06-09時列と翌日06-09時列が level3 になる(優先順位規則)。
  - (c) 境界列で missing と below が重なると missing になる。
- [ ] AC-5 コード表(単体):
  - `RISK_CODE_TABLE` が §4.3 の11コードを持ち、名称が別表4と完全一致し、表示区分が §4.3 と一致する。
  - `valueCode` null・`'99'`・undefined は `missing` になる。
  - `valueText` を変えても結果が変わらない。
- [ ] AC-6 切替文字(単体): `assignTransitionLabels` が次を満たす。
  - `initialIndex=null` で [below, level3, level3, level5(50), level5(51), level4, missing, level4, level2, level3] → [null, 警戒, null, 切迫, null, 危険, ?, 危険, null, 警戒]
  - 同じ配列で `initialIndex=2`(level3 の継続セル)のとき、index 2 も「警戒」になる。`initialIndex=8`(level2)のときは変化しない。
  - [level3×5] で `initialIndex=3` のとき [警戒, null, null, 警戒, null] になる。
  - 先頭が level3 の行では、先頭列が「警戒」になる。
  - level2 と below には文字が付かない。
  - noValue のセルは全て文字なし(null)になり、missing は全て「?」になる。
  - (パネル) 3列窓の先頭列に当たる index を `initialIndex` として渡したとき、その列が level3 以上なら文字が付く。
- [ ] AC-7 行の表示条件(単体):
  - §6 の合成応答で、濃霧(全て01)・風(東京湾)(01と欠測のみ)・霜(全て00)が `visibleRows` に無く、`allRows` と詳細の3時間表にはある。
  - 3列窓の外(過去列、または4コマ目以降)にだけ level2 以上がある行は `visibleRows` に無い(§2.1-19。判定範囲が全期間に変わった場合はこの項目を改める)。
- [ ] AC-8 状態(単体): `buildWarningTimeSeriesCard`/フック相当の組み立てで、次を確認する。
  - (a) `data:null` → `failed`、描画に「取得できませんでした」がある。
  - (b) `issuedAt:null` → `failed`。
  - (c) `warning-timeseries-quiet` 相当 → `data` 状態で発表時刻と「注意が必要な時間帯はありません」があり、表と「取得できませんでした」が無い。
  - (d) 危険度0件 → `data` 状態で「危険度の情報がありません」がある。
  - (e) `availability:'stale'` → `status.availability === 'stale'`。
- [ ] AC-9 表示列・初期列(単体): 3時間刻み14列で、`now` を変えて確認する。
  - `selectPanelColumns` の結果(列番号は1始まり)
    - 先頭より前 → 1〜3列目
    - 5列目の区間内 → 5〜7列目
    - 5列目の `timeTo` ちょうど → 6〜8列目
    - 13列目の区間内 → 13〜14列目(2列)
    - 14列目の区間内 → 14列目(1列)
    - 末尾より後 → 0列。カードの本文は「最新の予想時間帯がありません」になる
  - `resolveCurrentColumnKey`(詳細用)の結果
    - 先頭より前 → 1列目
    - 5列目の区間内 → 5列目
    - 5列目の `timeTo` ちょうど → 6列目
    - 末尾より後 → 14列目
    - 列が0件 → null
- [ ] AC-10 詳細(単体): §6 の合成応答で `DetailDialogInner` を描画し、次を確認する。
  - (a) 3時間表が1つあり、危険度全行と「１時間最大雨量」「mm」、「風向・風速 m/s」の行見出し(風危険度(陸上)の直下)がある。「最大風速」単独の行と「風向」単独の行は無い。
  - (b) 別欄に block2・block3 の表がある。「２４時間最大雨量」「実効湿度」「%」の行見出しがある。
  - (c) 別欄の列見出しが `formatIntervalHeader` の規則どおりになる(block3 先頭は「D日24時まで」、日界一致区間は「D日」)。
  - (d) `condition:'値なし'` のセルと危険度 00 のセルが空白(文字なし)になり、「—」も `0` も表示されない。ref が欠落したセルは「?」になる。
  - (e) `valueText` が文字列のまま表示される。
  - (f) 凡例に「切迫」、「危険警報級」の表記と見本の「危険」、「警戒」、レベル2(文字なし)、未満・値なし(空白)、欠測「?」がある。凡例に「レベル4」の表記と「文字は段階が変わる」の注記が無い。パネル本体の描画には凡例が無い。
- [ ] AC-11 見出し表記(単体): `formatIntervalHeader` を次の入力で確認する(JST 表記の ISO で与える)。
  - 22日00時〜23日00時 → 「22日」
  - 22日06時〜23日00時 → 「22日24時まで」
  - 22日00時〜22日12時 → 「22日12時まで」
  - 22日06時〜23日06時 → 「23日6時まで」
- [ ] AC-12 メタ・訓練(単体):
  - `parseWarningTimeseriesResponse` が正しい応答を受理する。`controlStatus` 不一致・`isTraining` 矛盾・`values` 非配列・`valueCategory` 不正の応答は null にする。
  - `issuedAt` を `2026-09-27T20:00:00Z` とし、`fetchedAt`・`evaluatedAt`・`kindDateTime` を別時刻にした応答で、見出しの時刻が issuedAt 由来の表示(`now` を 2026-09-28 JST にして `05:00発表`)だけになる。
  - `venueId='east'`/`'trc'` で、見出し2行目が `panelTargets.ts` の対象名になる。
- [ ] AC-13 画面(フィクスチャ): `npm run dev` 中に east 端末で `?panelFixture=warning-timeseries` を開き、次を確認する。
  - (a) 表が1つで、データ列が3列以下である。先頭列が現在を含む時間帯である(開いた時刻の JST と列見出しを照合する)。列見出しは時刻の1段だけで、日付の行が無い。
  - (b) 表とパネル列のどちらにも横スクロールが無い(`scrollWidth <= clientWidth`)。1180×820・1280×720 に加え、パネル列が最小幅(18rem)になる viewport でも同じである。
  - (c) 全データセルの `getBoundingClientRect()` の幅・高さが、文字の有無によらず ±0.5px で一致する(§2.1-14)。
  - (d) 3列窓の中に level2 以上がある行だけが表示されている。区分付きの行が連続して並ぶ。
  - (e) 表示された列に、該当する段階色・文字(「切迫」「危険」「警戒」)・「?」が見える。「—」はどこにも無い。
  - 合成応答は実時刻を起点にするため、表示される段階の組み合わせは開いた時刻で変わる。確認した時刻と見えた内容を記録する。
  - `?panelFixture=warning-timeseries-quiet` では「注意が必要な時間帯はありません」と発表時刻が出る。
  - 1180×820 と 1280×720 で行見出し列幅・データセル寸法を実測して記録し、スクリーンショットを PR に添付する。見た目の合否は「ユーザー監修待ち」と記載する。
- [ ] AC-14 画面(詳細・実API):
  - 同フィクスチャで「詳細」を押すとダイアログが開く。3時間表・別欄・凡例・初期列位置を確認する。閉じるとパネル列のスクロール位置が戻る。
  - `?panelFixture` なしで開き、ネットワーク記録で次を記録する。`GET /api/weather/warning-timeseries?terminalId=<端末ID>&controlStatus=normal` が 200 で発行され、ポーリングで再発行されること。カード状態が §4.1 に一致すること。
  - 実データがあれば、行構成・block 構成・日区間境界と3時間列の揃い方を記録する。
- [ ] AC-15 仮入口撤去: `?panelFixture=all-content` の警報等時系列に「詳細（仮）」が無く、`detailDialogFixtures.tsx` に `WarningTimeSeriesDetailFixtureEntry` が無い。地域時系列予報の「詳細（仮）」は残っている。
- [ ] AC-16 静的検査:
  - 新規・変更ファイルを `#[0-9a-fA-F]{3,8}\b`・`rgb\(`・`--wx-notice-` で検索し、0件。
  - `warningTimeSeries/` 配下を `setTimeout|setInterval|localStorage` で検索し、0件。
  - `kindName` を行見出しに使っていない。
- [ ] AC-17 境界:
  - `git diff --stat main...HEAD` が §7 の範囲に限られ、`apps/api/`・`packages/` に差分がなく、`apps/web/src/map/detail/` の差分は §7 の許可(§4.6)の範囲に限られる。
  - PR の対応表で、履歴表示・パネルでの備考表示・stale 表示の確定を「非対応/範囲外」と記載する。
  - 行の表示条件の判定範囲(3列の中)をユーザー決定として PR 本文に記載する。
- [ ] AC-18 管理項目・基本設計:
  - 本設計書 §8 に AD-H048 の結論があり、PR 本文に転記されている。
  - PR 本文に「基本設計 §5.8 は §2.2 の文案で統括担当が改訂する」旨を記載する。
- [ ] AC-19 備考の結合(単体): §6 の合成応答で `buildRemarks`/詳細の描画を確認する。
  - 雷の行の備考が「竜巻、ひょう」(出現順・「、」連結)になる。
  - 風(陸上)の行に Local の Note がある。風(東京湾)の行には Local の Note が無い。
  - 風危険度の Base Note が、風(陸上)・風(東京湾)の両方の行の備考にある。「全域」の文字は無い。
  - 雨(24時間最大雨量)の Note の本文が、詳細のどこにも現れない。
  - 同じ Note を2件入れると2回表示される(重複を除去しない)。
- [ ] AC-20 時間セル非複製・パネル非表示(単体):
  - Note の本文(「竜巻」等)が、3時間表の時間セル・別欄・パネル本体の描画のいずれにも現れない。
  - 3時間表の各行のセル数は常に時間列数＋1(備考)である。
- [ ] AC-21 null と空の区別(単体):
  - `additions: []` でも備考列(見出し「備考」)があり、全セルが空白である。
  - 雨(24時間最大雨量)の Note だけを持つ `additions` でも備考列はあり、全セルが空白で、雨の Note 本文はどこにも現れない。
  - `additions: null` では、見出しが「備考(未取得)」になり、「付加事項は取得できていません」がある。「なし」の文字は無い。どちらの場合も危険度・量的予想の表示は変わらない。
  - parse: `additions` が文字列など不正な型の応答は null(取得失敗)になり、`additions: null` の応答は受理される。
- [ ] AC-22 備考列の右端固定(画面): `?panelFixture=warning-timeseries` の詳細を 1180×820 と 1280×720 で開く。
  - §6 の合成応答で、3時間表を左端から右端まで横スクロールする間、備考列のセルの `getBoundingClientRect().right` が表スクロール領域の `right` と ±1px で一致し続ける。行見出し列の `left` も固定のままである。
  - 初期スクロール位置で、現在列が行見出しの直右にあり、備考列に隠れていない。
  - スクリーンショットを PR に添付する(Note は実フィードに0件のためフィクスチャで確認した旨を記載する)。
- [ ] AC-23 吸着見出し(画面): `?panelFixture=warning-timeseries` の詳細を 1180×820 と 1280×720 で開き、次を確認する。
  - (a) 本文を縦にスクロールして3時間表の見出しの元の位置が上に隠れても、日付行と時刻行が表示され続け、見出しの上端がダイアログ見出し(`header.detail-dialog-heading`)の下端と ±1px で接する(隙間が無い。5fc1593)。ダイアログのヘッダーと閉じるボタンに重ならず、閉じるボタンを押せる。
  - (b) 3時間表の最終行が本文上端を越えると、見出しの吸着が外れる(別欄の表の上に3時間表の見出しが残らない)。
  - (c) 表を横スクロールしたとき、見出しのセルと本文のセルの左端が各列で ±1px 以内でそろう。これを初期位置・左端・右端の3点で確認する。行見出し列と備考列は、見出し側・本文側とも固定のままである。
  - (d) 開いた直後の初期位置で、見出しと本文の現在列がそろっている。
  - (e) 表の内側に縦スクロールが無い(`.detail-ts-scroll` の `scrollHeight === clientHeight`)。
  - (f) 見出しの表と本文の表の `getBoundingClientRect().width` が ±1px で一致する(48f5e2a)。
- [ ] AC-24 共通部品の回帰防止(単体): `stickyHeader` を指定しない `DetailTimeSeriesTable` の `renderToStaticMarkup` 出力が、変更前と同じである(既存の `detailTimeSeriesTable.test.ts` が無修正で通る。加えて、変更前の出力を固定した比較ケースを追加する)。`stickyHeader` 指定時は、見出しの表と本文の表の `colgroup` が同じ列数・同じ幅指定になるケースを追加する。`git diff main...HEAD -- apps/web/src/map/detail/` の差分が `DetailTimeSeriesTable.tsx` と `detail.css`(追加と、`.detail-dialog-body` の上余白の変数化だけ)に限られる。`.detail-dialog-body` の computed `padding-top` が 16px のままである(地域時系列予報サンプルの詳細で確認)。
- [ ] AC-25 時刻見出し(単体・画面): パネルと詳細3時間表の時刻見出しが「21-24」「0-3」の形で、「時」を含まない。別欄の見出しは「D日H時まで」「D日」のまま変わらない。画面で、時刻見出しが1行に収まる(見出しセルの高さが1行分である)。
- [ ] AC-26 風向・風速の統合(単体):
  - 陸上区分の `風` の値(風向 北西・最大風速 15、unit `m/s`)のセルに、上段 `navigation` のアイコン要素(回転 135deg)、下段「15」がある。セル内に「北西」の文字が無く、`aria-label` が「21-24時 陸上 北西の風 15メートル毎秒」になる。
  - 8方位すべてについて、回転角が §4.7 の表どおりになる。
  - `valueText` が「北北西」「静穏」の場合は、アイコン要素が無く、上段が「－」になる。`aria-label` に原文(「静穏の風」)がある。
  - d(8方位/方位外/値なし/欠測)× s(値/値なし/欠測)の12通りで、上段・下段・読み上げが §4.7 の規則どおりになる。
  - 風危険度の行の直下にある統合行の見出しは「風向・風速 m/s」(区分名なし)である。対応する危険度の行が無い位置の統合行は「風向・風速(陸上) m/s」である。
  - `condition:'風雪'` の値で「風雪」の文字がどこにも出ない。
  - 風向だけの区分は統合されず単独の行で、矢印が付く。
- [ ] AC-27 統合行の配置(単体):
  - 出現順「風危険度(陸上)→風危険度(東京湾)→雷→風(陸上の風向・最大風速)→風(東京湾の風向・最大風速)」の入力で、詳細3時間表の行順が「風危険度(陸上)→風向・風速(陸上)→風危険度(東京湾)→風向・風速(東京湾)→雷」になる。
  - 危険度行と区分が一致しない統合行は、`風` の最初の出現位置に置かれる。
  - パネル本体の行と、別欄の表は変わらない(統合行・矢印が出ない)。
- [ ] AC-28 矢印の見た目(画面): 詳細で、矢印が風下を指す(北西の風なら右下)。色がセル文字と同じである。HEX・`rgb(` を使っていない。スクリーンショットを PR に添付する(見た目の合否はユーザー監修待ち)。 統合行のデータセルの高さが全て同じ(±0.5px)で、統合行以外の行の高さが統合前(c113b48)と変わらない。
- [ ] AC-29 雨の行の配置(単体):
  - 出現順「大雨浸水→雷→土砂災害→雨(１時間最大雨量)→風危険度…」の入力で、詳細3時間表の行順が「大雨浸水→雷→土砂災害→１時間最大雨量→…」になる(雨の行が土砂災害の直後)。
  - 出現順「雨→大雨浸水→土砂災害」でも、雨の行が土砂災害の直後に移る。
  - 大雨浸水・土砂災害の行が無い入力では、雨の行は出現順のままである。
  - 雪・波の量的予想の行は出現順から動かない。
  - パネル本体と別欄は変わらない。
- [ ] AC-30 延長列(単体・画面):
  - 基準 block が当日06時〜翌日24時の14列、日単位 block が当日(06-24)・翌日・翌々日の3区間(乾燥・霜)の入力で、次を確認する。
    - 詳細3時間表の列が14＋1列(翌々日)になり、延長列の日付行が共通部品の既定の日付表示(例「9/29(火)」)で、時刻行が空欄である。延長列のセルの `aria-label` が「29日 」で始まる(日付は入力に合わせる)。
    - 乾燥・霜の行の延長列には翌々日の値がある。
    - 3時間刻みの危険度・量的予想・統合行の延長列は空白で、「?」ではない。`aria-label` は「対象期間外」である。
    - 当日・翌日の区間は、従来どおり3時間列に複製されている。
  - パネルの3列窓は延長列を含まない(全列が過去でも延長列を表示しない)。
  - `initialColumnKey` は基準列のいずれかである。
  - 画面で、延長列の右に備考列が右端固定で表示される。吸着見出しに延長列の見出しがあり、本文と ±1px でそろう。

## 11. 後続Issueへの引き継ぎ

- 統括: 基本設計 §5.8 と Issue #55 本文の改訂(§2.2)。
- G9 #60: stale の表示、取得状態の常時表示。
- L1 #83: 実データでの実寸・色・初期列の受入、江東区・大田区実電文での行構成確認。
- エポック終了時のユーザー監修: 切替文字の見え方・欠測表現・列幅・詳細の見た目(AC-13 のスクショを材料とする)。
