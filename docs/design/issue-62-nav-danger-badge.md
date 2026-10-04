# Issue #62 ナビレールの最高危険度ドット

- 対象: [Issue #62](https://github.com/BlueKurage119/wx-viewer-poc/issues/62)
- 状態: 設計承認済み（2026-10-04）
- 承認記録: ユーザーが本チャットで設計を承認し、サブエージェント式の製造・PR発行・初回レビュー対応まで指示した。
- 設計担当: Codex (GPT 6.1 Sol) `<noreply@openai.com>`
- ヒアリング日: 2026-10-04

## 1. 根拠と確定事項

参照資料は `docs/basic-design.md` §3.1・§5.6・§5.7、`docs/data-acquisition-report.md` §気象防災速報、`docs/design/issue-54-warning-panel.md`、業務標準 01・02・05・06・07、下記の既存実装。Issue 本文は統括担当の取得結果を参照した。

ユーザーの確定判断:

1. 気象情報アイコンに文字なしのドットを表示し、対象情報の最高段階を示す。
2. レベル2以上は指定色、レベル5は縁取りを付ける。解除まで表示し、閲覧や既読操作では消さない。
3. 警報級の可能性は「中」「高」が現在以降の全予報期間（詳細画面の期間を含む）に存在すると白ドット、レベル1相当とする。過去の期間は対象外。
4. 気象防災速報は、線状降水帯半日前予測がレベル1、それ以外がレベル4。パネルの表示対象である間だけ集約する。
5. 半日前予測の取得追加は今回行わず、後続対応に残す。今回取得済みの速報は全てレベル4。

既存の段階別警報表を再利用し、レベル表示のない特別警報・警報・注意報もそれぞれ5・3・2相当の表示段階として集約する。これはナビの表示段階であり、個々の現象に公式警戒レベルを新たに付与するものではない。通知の鳴動、新着の独立印、既読管理は追加しない。

## 2. 既存境界と実挙動未確認

- `shell/AppShell.tsx`: 気象情報ナビボタンの `.nav-icon` にドットを重ねる。現在の選択状態・操作・ラベルを維持する。
- `App.tsx`: 画面切替時に `WeatherMapView` をアンマウントする。地図内部だけで取得・集約すると他画面で更新できないため、対象3情報の取得を画面切替より上に置く。
- `map/panels/warning/warningBadges.ts`: `WARNING_BADGE_TABLE` の special/danger/warning/advisory を使う。未知コードは既存と同じく対象外。APIが提供しない洪水コード04/18を別ソースから補完しない。
- `map/panels/bosai/bosaiBulletinCards.ts`: `isBulletinDisplayed` が取消・期限切れ・終了時刻不明を除外する。VPBS50は発表から3時間、竜巻はvalidAtまで、境界時刻ちょうどで消える。この表示規則を変更しない。
- `map/panels/earlyWarning/earlyWarningModel.ts`: パネルは近距離3コマ、詳細は近距離と遠距離を重複調整して結合する。今回の白ドットは詳細の結合規則と現在以降の期間を使う。
- `map/tiles/useTileCatalogPolling.ts`: 60秒取得、失敗時の保持値・バックオフ・タブ不可視時停止を提供する。これらの機能は維持する。
- `theme/semanticColors.ts`: 2〜5のcontainer/outlineはモード非依存。レベル5の暗い塗りと紫縁を再利用する。
- 半日前予測のDTO種別・取得経路・期限は現行コードに存在しない。タイトルの部分一致等で推定しない。

実挙動未確認: 本設計フェーズではブラウザー描画・実API接続を実行していない。実画面のドット視認性、既存fixtureとの互換性、画面切替後の取得は製造・検収で確認する。気象庁電文の新規提供仕様は本設計で確定しない。

## 3. モジュールと契約

### 3.1 集約モデル

新規 `apps/web/src/weather/weatherDangerModel.ts` に次の純粋関数を設ける。

```ts
type WeatherDangerLevel = 1 | 2 | 3 | 4 | 5;
resolveWarningDangerLevel(response: WarningsResponse): WeatherDangerLevel | null;
resolveEarlyWarningDangerLevel(response: EarlyWarningResponse, nowMs: number): 1 | null;
resolveBulletinDangerLevel(cards: readonly InfoPanelCardInput[]): 4 | null;
resolveHighestDangerLevel(levels: readonly (WeatherDangerLevel | null)[]): WeatherDangerLevel | null;
```

警報は有効な保持データのitemsを既存コード表で分類し、special=5、danger=4、warning=3、advisory=2の最大値。data=nullまたはunavailableなら対象なし。解除済み項目を復活させない。

早期注意は `buildDetailTable(response)` の列とセルを使い、終了時刻が現在より後の有効な列のmedium/highだけを対象とする。終了時刻ちょうど、過去、conditionが値なし、未知値、欠損は対象外。近距離・遠距離のavailabilityとnullは既存モデルに従いそれぞれ判断する。

速報は `buildBosaiBulletinCards` で生成済みの表示対象カードが1件以上なら4。非表示カード、取消、期限判定不能だけなら対象なし。対応済み速報の情報タグを使って勝手にレベル1へ分類しない。

### 3.2 取得共有

新規 `apps/web/src/weather/useWeatherDangerData.ts` は既存の3 APIクライアントと `useTileCatalogPolling` を再利用し、3種のカードと最高段階を同じ応答から生成する。

```ts
interface WeatherDangerPanelData {
  readonly bosaiBulletin: readonly InfoPanelCardInput[];
  readonly warning: readonly InfoPanelCardInput[];
  readonly earlyWarning: InfoPanelCardInput;
}
interface WeatherDangerData {
  readonly panels: WeatherDangerPanelData;
  readonly level: WeatherDangerLevel | null;
}
useWeatherDangerData(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly nowMs: number;
}): WeatherDangerData;
```

既存3 hook の取得・状態からカードを生成する部分は、小さな再利用関数へ抽出してよい。各公開hookの戻り値・単独利用は維持する。新規共有hookと地図内部hookを同時実行しない。

`App` の端末ごとの画面管理コンポーネントで共有hookを常時呼び、既存の1秒時計をnowMsとして渡す。`AppShell` に任意prop `weatherDangerLevel?: WeatherDangerLevel | null`、`WeatherMapView` に任意prop `dangerPanelData?: WeatherDangerPanelData` を渡す。注入時は3種の既存hookを実行しない。単独の地図利用は薄い取得用ラッパーを分けて既存hookを使用する。条件付きhookを作らない。警報等時系列・アメダス・地域予報・地図タイルは移動しない。

時刻再評価はAPI取得と独立する。速報の期限と予報期間終了は既存1秒時計の次の更新で反映する。タイマー更新を取得関数の依存に入れて毎秒fetchしない。解除等のサーバー変更は次の成功したポーリングで反映する。

対象は端末APIが返す会場の情報のみ。resetKeyはterminalId/controlStatusを維持し、別会場や訓練データの保持値を流用しない。現行 `App` が使うnormalを維持し、画面名が訓練通知というだけでtrainingの気象情報を混ぜない。WeatherContext.isTrainingとcontrolStatusを保持し、本番と訓練の通知・履歴を変更しない。

readyではデータのavailabilityを尊重する。staleは保持値から段階を再評価し、取得失敗だけでドットを消さない。loading/failedで保持値がない情報は段階なし。他の取得成功情報は引き続き集約する。availabilityのavailable/stale/unavailableをドットの有無に置き換えず、既存パネルの状態表示は維持する。

### 3.3 描画

`AppShell` の気象情報ボタンだけにドットを置く。nullではドットを描画しない。推奨寸法は直径10px、既存56×32pxのアイコン領域内右上に重ね、レイアウトとクリック対象を変えない。製造で実画面を計測し調整する。

- 2〜5: `--wx-alert-level-N-container`。
- 5: `--wx-alert-level-5-outline` の1px以上の縁。border-boxで外寸を一定にする。
- 1: 新しい `--wx-alert-level-1-container` をsemanticColorsで生成する。既存のカテゴリパレットのtone(100)から白を生成し、RGB/HEXの直書きを追加しない。`AlertLevel` の2〜5は既存消費側を変えず、新トークンだけ型に加える。

視覚的文字・説明は増やさない。ボタンのアクセシブル名には「気象情報、最高危険度レベル4相当」等、1は「気象情報、警報級の可能性あり」を付加する。装飾ドットはaria-hiddenとする。live regionや音は追加しない。

開発専用fixtureの既存動作を維持する。既存 `panelFixture=early-warning` は共有hook移動後も実通信を止める規則を維持する。必要な段階のプレビューfixtureは開発ビルドだけで有効にし、通常API契約へ追加しない。

## 4. 変更範囲

変更対象は上記新規webモジュール、`App.tsx`、`shell/AppShell.tsx`、`index.css`、`theme/semanticColors.ts`、`map/WeatherMapView.tsx`、3情報の既存hookと必要なカード生成関数、および対象テスト・開発専用fixtureに限定する。公開hook契約の保持を優先し、共通ポーリング・テスト設定・依存パッケージ・API・shared DTO・通知・監視機能は変更しない。

## 5. 受け入れ条件

- [ ] 純粋関数へ警報各段階と複数段階を渡し、5/4/3/2相当および最大段階が完全一致する。レベルのない暴風警報・大雪特別警報も3/5相当、未知コードだけならnull。
- [ ] レベル2・早期注意の中・表示対象速報を同時に与えると4。速報が表示期限を過ぎると2、警報解除後は1、可能性もなしになるとnull。
- [ ] near/farの現在以降のmedium/highが1になる。3コマより先・farだけの場合も1。終了時刻の直前は1、ちょうどでnull、過去だけ・値なし・欠損・未知値ではnull。部分unavailableでももう片側の有効データを集約する。
- [ ] VPBS50発表後3時間の直前は4、ちょうどでnull。VPHW50/51のvalidAt境界も同様。取消・期限不明・0件はnull。線状降水帯直前予測も4。
- [ ] 正常応答→取得失敗をモックし、stale保持値のドットとパネルを維持する。保持値なしのfailed/loading/unavailableではその情報を除外し、他情報の段階は残る。nullを発表なしと取り違えて保持値を復活させない。
- [ ] 気象情報から警報一覧・取得監視へ切替し、成功ポーリングで最高段階が更新される。戻ったとき重複fetchが起きない。1秒時計更新ではfetch数が増えない。
- [ ] 端末・controlStatus変更を検証し、前端末/モードの値が新しいドットに残らない。normalデータとisTrainingの区別が既存通りに保たれる。
- [ ] 実画面で1〜5となしを撮影する。気象情報だけにドットがあり、白・黄・赤・紫・黒紫と5の縁を確認。選択中・非選択中でも操作・ラベル・アイコン寸法に崩れがない。白と5の視認性についてAD-H020の確認結果を検収報告に残す。
- [ ] アクセシブル名に現在の段階が反映され、クリック・Enter・Spaceで元の画面切替が動く。閲覧・通知既読・ブザー停止でドットが消えず、鳴動が新たに発生しない。
- [ ] 既存の地図単独描画・パネルfixture・早期注意専用fixtureを実行して従来表示を維持する。本番ビルドには専用fixtureが漏れない。
- [ ] lint/typecheck/format:checkとapps/webの対象テストを実行する。新規テストのred確認・ミューテーション対照実験を業務標準05の順で実施し結果を報告する。

## 6. 判断待ち・後続引き継ぎ

設計承認は2026-10-04に完了し、追加の判断待ちはない。実画面の最終的な視認性判断は検収画像をユーザーへ提示する。

半日前予測はレベル1というユーザー判断を後続へ引き継ぐ。取得対象、DTOの明示的種別、パネルの表示期限が検証・設計された時点でレベル1集約を追加する。今回は推測による分類や取得追加を行わない。

AD-H020: 既存レベル5のセマンティックトークンと縁を採用し、ナビドットの実画面で縁・視認性を検収する。既存監査文書を書き換えず、この設計と検収結果に結論を記録する。採否待ちの保守項目を追加必須作業にしない。
