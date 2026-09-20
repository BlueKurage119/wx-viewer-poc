# Issue #74 K1：取得監視ダッシュボードの基本レイアウト

- 状態：設計承認済み・製造開始待ち
- 対象：K1 #74のみ。設計担当：Codex
- 設計日：2026-09-21
- 設計時点ではコード・設定・ブランチ・コミットを変更しない。

## 1. 根拠と合意事項

### 1.1 参照資料

| 資料 | 設計判断の根拠 |
| --- | --- |
| [基本設計 §8.1〜8.5](../basic-design.md) | 取得運転と健全性の分離、固定ツールバー、履歴の入口、停止と異常の区別、画面更新停止の明示 |
| [Issue #74](https://github.com/BlueKurage119/wx-viewer-poc/issues/74) | 元のK1範囲。旧4段配置を含むため、以下の会話合意との差分あり |
| [設計業務標準](../rules/02-design-protocol.md)、[UI業務標準](../rules/06-ui-md3-protocol.md) | 設計成果物・受入条件・MD3制約 |
| `packages/shared/src/monitoringStatus.ts` | 既存DTOの独立したoperation / health / readiness / venues、および値の意味 |
| `apps/api/src/monitoring/monitoringStatusService.ts`、`apps/api/src/app.ts` | 稼働状態APIの読取契約、HTTP応答、既存集約値 |
| `apps/web/src/App.tsx`、`shell/AppShell.tsx`、`index.css` | K端末限定ナビ、既存toolbarスロット、固定シェルの実寸 |
| `apps/web/src/theme/semanticColors.ts`、`shell/config.ts` | 既存色トークン、端末・会場の名前解決 |

上記パスはリポジトリルートからの相対パス。生成画像は会話で支給された表示構成を参考とし、画像内の地域・時刻・周期・状態を仕様や実データとして採用しない。

### 1.2 ヒアリング確定事項

- 本体は上から4カード（取得運転・取得健全性・スケジュール・処理待ち）、取得元別の稼働状況、情報別の反映状況。
- 表示構成は会話の1枚目、カードのアイコンは3枚目を基本とする。3枚目の歯車・チェック・時計・文書の図形を装飾SVGとして実装する。
- 「現在の異常」の常設パネルは設けない。異常はダッシュボードの赤表示と状態文字、K8「状態診断」ダイアログ、出力履歴で扱う。通知されない現在の問題は状態診断で補う。
- 停止・未評価を異常や正常と混同しない。
- フルHDで全体を収める密度を目指す。本体のみ縦スクロールし、共通ヘッダー・左ナビ・下部通知欄を維持する。
- 固定ツールバーは本体下・通知領域上、高さ48 px程度。順序は以下のとおり。空白はグループ間の余白。

```text
[取得開始][取得停止]  [強制更新]  [受信履歴][電文履歴][出力履歴]  [状態診断]       [送信]
```

- 開始・停止・強制更新は選択後に送信。履歴・状態診断は直接開き、送信不要。送信は右端、未選択時は無効。
- K1は4カードと全体配置、下段表の静的な列見出し・行名・未接続値「ー」、ツールバー占有領域まで。表の詳細判定・実データ接続はK6/K7、取得操作はK2、診断内容はK8。
- 【確定・レイアウト調整】取得健全性の状態アイコンは Material Symbols の `check`・`check_alert`・`close` の3段階とする。表は列比率を保って利用可能な横幅を使い、内容文字数で列幅を変動させない。黄・赤状態の表行は行全体を強調する。ツールバーボタンは全角5文字を収める固定幅、M3 Expressiveのスクエア型とする。

### 1.3 既存資料との差分

基本設計§8.2/8.5とIssue #74に残る「現在の異常」常設パネル・4段配置は本会話で変更された。基本設計の古いツールバー図に電文履歴・状態診断を追加する必要がある。K8の「パネル」表現もダイアログへ変更する必要がある。

設計担当は本書以外を変更しない。統括担当が基本設計・Issue本文の整合更新を後続作業として扱う。K1完了をK6/K7/K8の完了とみなさない。

## 2. 対象範囲

### K1で実装するもの【承認済み設計】

- K端末の `#monitor` のプレースホルダーを監視画面へ差し替える。
- 稼働状態APIを読み、4カード、最終表示更新時刻、読込中・通信失敗を表示する。
- 下段2領域に将来の列見出し・行名が分かる静的な表骨格を実装し、未接続の値・状態セルを「ー」とする。
- 既存 `AppShell.toolbar` に監視用ツールバーの配置見本を渡す（K1時点の見せ方は§7 A）。
- 表示変換と監視取得ライフサイクルのテスト、実寸確認。

### 対象外

- サーバー・共有DTOの拡張、開始/停止/強制更新の送信、履歴・診断ダイアログの内容。
- K6/K7の表の列・内訳・状態判定・実データ行の実装。
- 通知配信接続、H端末フィルター、警報履歴の新規実装、ホストCPU等の監視。
- 上流気象データへの追加取得。APIへの画面更新は保存済み監視情報の読取のみ。

## 3. レイアウト【承認済み設計】

### 3.1 フルHDの寸法目標

基準はブラウザの**コンテンツ領域1920×1080 CSS px、倍率100%**。物理モニターがフルHDでもブラウザ枠・OS倍率によって内寸が小さくなるため、1920×960でも追加確認する。

| 領域 | 高さ・幅の目安 |
| --- | --- |
| ヘッダー | 現行48 pxを維持 |
| ナビレール | 現行72 pxを維持 |
| 通知領域 | 現行96 px（32 px×3行）を維持 |
| ツールバー | 1行時48 px程度、ボタン40 px、上下4 px・左右16 px。120 px固定幅の全ボタンが1行に収まらないときは必要な行数へ拡張 |
| 監視本体 | 1080時888 px、960時768 px。上下16 px・左右24 px |
| 最終表示更新行 | 24 px。失敗メッセージを左、時刻を右 |
| カード | 112 px以上、4等分・間隔16 px。アイコン48 px、本文14〜16 px、主要値24 px |
| 取得元枠 | 見出し28 px＋将来の列見出し32 px＋6行×30 px＝240 px |
| 情報枠 | 見出し28 px＋将来の列見出し32 px＋8行×30 px＝300 px |
| 領域間 | 12 px×3 |

想定本体高さは `32 + 24 + 112 + 240 + 300 + 36 = 744 px`。1920×1080内寸では144 px、1920×960内寸でも24 pxの余裕があり、基本6行・8行では本体スクロールなしを目指す。追加行・エラー長文・文字拡大時も本体をスクロールさせる。

これはK6/K7が基本6行・8行を採用した場合の配置予約であり、全会場の情報を8行へ強制集約する仕様ではない。情報APIは会場別要素を含む。会場選択・内訳展開・追加行はK7で決め、必要なら本体スクロールを使う。

### 3.2 シェルへの組込み

`AppShell.tsx` のmainに `view-content-monitor` を追加し、監視用CSSで余白だけを上書きする。既存gridの `minmax(0, 1fr)` とmainの `overflow: auto` を使い、独立した二重縦スクロールを追加しない。ツールバーは既存grid第3行、通知欄は第4行のままとする。

ツールバーはグループ内8 px・グループ間24 px。送信の直前に `margin-inline-start: auto`。狭幅では既存シェルに合わせて折り返し、送信を最後のグループに保つ。カードはビューポート幅1280 px以上で4列、760〜1279 pxで2列、759 px以下で1列。横スクロールを本体全体へ強制しない。

下段は静的な表骨格として表示する。列見出しと行名で完成後の表示内容を示し、未接続の値・状態セルはすべて「ー」。ゼロ件・正常・異常なし・架空地域・架空時刻を置かない。表骨格の行は実データ行として扱わず、K6/K7で値を接続する。「ー」は未接続・未取得の欠測値を表す。接続後の既知の失敗を「ー」で隠さず、未取得だけを理由に赤い異常と判定しない。

| 表 | 列見出し（K1の骨格） | 固定の行名 |
| --- | --- | --- |
| 取得元別の稼働状況 | 取得元／状態／適用周期／最終試行／最終成功／次回予定／直近処理時間／連続失敗回数 | XML定時フィード、XML随時フィード、雨雲時刻一覧、キキクル時刻一覧、アメダス最新時刻、アメダス地点データ |
| 情報別の反映状況 | 情報名／対象地域・地点／反映状態／情報時刻／反映時刻／要約 | 気象防災速報、気象警報・注意報、警報等時系列、警報級の可能性、アメダス、地域時系列予報、雨雲、キキクル |

取得元6系列・情報8種は既存DTOと基本設計の契約に対応する。列見出しは基本設計§8.2をもとにした配置用であり、APIに全列の値が存在することを意味しない。会場・種別の内訳、実際の値の対応と不足APIはK6/K7で設計する。情報時刻の発表／観測／基準時刻の区別もK7へ引き継ぐ。見出しセルは `th` と `scope` で対応付ける。

表は `table-layout: fixed` とし、各 `table` の先頭に `colgroup` を置いて、次の列比率をCSS `%` で指定する。`width: 100%` により横スクロールコンテナの利用可能な横幅をすべて使い、現行の表示比率を保ったまま拡縮する。狭幅時は既存の `min-width: 920px` と横スクロールを維持する。セル内容は列幅を広げず、時刻・数値を含むセルは `white-space: nowrap` を維持する。幅不足時に情報を改変・省略しない。

| 表 | 列比率（左から順） |
| --- | --- |
| 取得元別の稼働状況 | 11.63 / 8.46 / 10.15 / 14.80 / 14.80 / 14.80 / 12.68 / 12.68 % |
| 情報別の反映状況 | 17.78 / 24.44 / 12.22 / 15.56 / 15.56 / 14.44 % |

取得元・情報のいずれも状態が `attention` または `error` の行へ、それぞれ `monitoring-row-attention` / `monitoring-row-error` を付与する。行内の全セルを対応する `*-container` 背景と `*-on-container` 前景で描画し、状態列だけを着色する現行の見せ方を置き換える。通常・動作中・停止・判定待ちの行背景は既存surfaceのままとする。コンテナ色と対応するon-containerの組合せ以外の混色・HEX直書きは行わない。

監視ツールバーに限定したCSSで既存のmin-height 60 px・上下padding 8 pxを48 px・4 pxへ上書きする。他画面のツールバー寸法は維持する。

各 `md-gb-button` は `inline-size: 120px`（全角5文字を収める固定幅）とする。Material Web 2.5.0のM3 Expressive Labsボタンを型付き`GbButton`ラッパーおよび`components/md`バレル経由で使用し、`color="filled"`、`size="sm"`、`square` を指定する。`square` は角丸を0 pxへ上書きするものではなく、同コンポーネントが定義するExpressiveのsquare shapeと状態遷移を使用する。幅はラベル文字数で変化させない。

8ボタンの合計960 px、グループ内間隔24 px、5グループ間の間隔96 pxにより、ツールバー内容の1行必要幅は1080 pxである。`.monitoring-toolbar` は常に `flex-wrap: wrap` を指定し、利用可能な内容幅が1080 px未満になった時点からグループ単位で折り返す。`.view-toolbar-monitor` は固定`height`を使わず `min-height: 48px; height: auto` とし、折返した行を内包する。各グループは分割せず、`monitoring-toolbar-submit` は折返し後も最後の行の右端に配置する。シェル外への横溢れ・ボタンの縮小・スクロールによる回避は行わない。他画面のツールバー寸法・折返し規則は維持する。

## 4. データ契約とカード表示【承認済み設計】

### 4.1 API

```ts
fetchMonitoringStatus(
  terminalId: string,
  signal?: AbortSignal,
): Promise<MonitoringStatusResponse>
```

- `GET /api/monitoring/status?terminalId=<encodeURIComponentした端末ID>`。
- 200：`MonitoringStatusResponse`。400：`invalid_request`、404：`terminal_not_found`、500：`monitoring_status_failed`。非2xx・不正JSON・必要フィールド不正は取得失敗として扱う。
- 既存APIは初期化中もready形式でreadinessを返す。202応答を仮定しない。
- `terminalId` の一致を確認し、使用する値・配列・enum・非負件数・日時を検証する。不明値をnormalへ補完しない。
- `generatedAt` を最終表示更新時刻に使用。日時はJST、時刻は秒まで。前日以前は日付を省略しない。ヘッダーの現在時刻と区別する。
- `serverGenerationId` が変わったら応答全体を置換し、再処理カウンター等を前世代から加算しない。

### 4.2 カード対応

| カード | 使用値 | 表示規則 |
| --- | --- | --- |
| 取得運転 | `operation.schedulerRunning` | true「自動取得有効」、false「自動取得停止」。全取得が現に実行中、手動停止、停止処理完了などは断定しない |
| 同補足 | `readiness.initialFetchPhase` | not_started「初回同期 未開始」、running「初回同期中」、completed「初回同期完了」、failed「初回同期失敗」。運転指示とは別行。failedは赤表示 |
| 取得健全性 | `health.evaluatedAt` / `worstStatus` | 評価時刻nullまたはstatus nullは「判定待ち」。normal「正常」、delayed「遅延」、abnormal「異常」、suspended「停止中（評価対象外）」 |
| スケジュール | `operation.period.start/end` / `nextPeriodChangeAt` | 「HH:mm – HH:mm」「次の切替 HH:mm」。設定時間をそのまま表示し、画像の09:00等を固定しない。全定期周期nullなら「定期取得の設定なし」を補足 |
| 処理待ち | `venues[].reprocessing` | 常に「起動時再処理」と明示。会場別に未開始／再処理中 processedCount / total／再処理完了を表示。完了0件は「再処理完了 0件」と区別 |

- 健全性はサーバーの最悪値を表示し、フロントで経過時間・閾値から再判定しない。異常＝全取得失敗とは限らないため「全取得失敗」へ言い換えない。
- 取得停止と健全性の評価タイミングは独立。取得停止直後の古い異常評価を「正常」で上書きしない。
- スケジュールの「通常／低頻度」はDTOに名称がないため固定時刻や周期値から推測しない。
- 処理待ちはライブのキュー長・同時処理数ではない。会場ごとの進捗を表示し、片方の完了で全体完了にしない。会場名は既存定義で解決する。
- DTOにない `fetchControlState`・停止理由・停止処理中・手動強制更新の実行状態は描かない。K2でAPI拡張を含め検討する（§7 B）。

### 4.3 配色・アイコン

【確定・追加ヒアリング】システム状態色は緑・黄・赤と無彩色に限定する。緑 `#34be4d`、黄 `#ffce22`、赤 `#ff6240` はユーザー指定の**シード色**であり、表示色そのものへ固定しない。Material Color Utilitiesの明暗スキームから表示色を生成する。青案は撤回する。正常と動作中は同じ緑の濃淡で区別する。気象警戒レベル色・通知区分色とは別の意味色として扱う。出典は「MD3ガイドラインのDO / DON’Tのコンテナ色」とのユーザー申告であり、正確なURLは未提供、公式値としての独立確認は未実施。

| 状態 | 意味色 | 表示上の注意 |
| --- | --- | --- |
| 正常 | 緑 | 「正常」等の状態名を併記 |
| 動作・処理中 | 緑の濃淡 | 正常と色相を変えず、「初回同期中」「再処理中」等を併記 |
| 遅延・注意 | 黄 | 正常へ丸めず「遅延」等を表示 |
| 異常・既知の失敗 | 赤 | 「異常」「初回同期失敗」等を表示 |
| 意図的停止 | 無彩色 | 「自動取得停止」「停止中」等を表示 |
| 未評価・未取得 | 無彩色 | 「判定待ち」「未開始」等を維持。欠測値・未接続セルは「ー」 |

未取得だけを理由に異常とせず、既知の失敗を「ー」で隠さない。取得運転・取得健全性・再処理は独立して着色し、運転有効を健全性正常の代用にしない。

【承認済み】正常は緑スキームのprimaryによる文字・アイコン、動作中は同じ緑スキームのprimaryContainer背景＋onPrimaryContainer文字で区別する。どちらも状態名を併記する。

#### 状態トークンの配置・生成【承認済み設計】

`apps/web/src/theme/systemStatusColors.ts` に3つのシード定数と生成関数を集中し、`applyTheme.ts` から対象テーマの要素へ適用する。既存 `semanticColors.ts` の `argbFromHex` / `themeFromSourceColor` / `hexFromArgb` の使用方式を参照し、既存固定バージョン `@material/material-color-utilities` 0.3.0を使う。全体テーマシード、既存の警戒レベル色・通知色、その生成方式は変更しない。HEXリテラルは専用シード定義元にのみ記載し、コンポーネント・CSS・fixtureはトークン参照だけとする。

```ts
type SystemStatusColor = 'green' | 'yellow' | 'red';
type SystemStatusColorRole = 'foreground' | 'on-foreground' | 'container' | 'on-container';
type SystemStatusColorToken =
  | `--wx-system-status-${SystemStatusColor}-${SystemStatusColorRole}`;

function createSystemStatusColors(dark: boolean): Record<SystemStatusColorToken, string>;
```

各シードに対して `themeFromSourceColor(argbFromHex(seed))` を1回生成し、`dark ? theme.schemes.dark : theme.schemes.light` を選択する。対応するARGBを `hexFromArgb` でトークン値へ変換する。

| 専用トークンの役割 | 選択したスキームの値 | 用途 |
| --- | --- | --- |
| `foreground` | `primary` | 通常surface上の状態文字・アイコン、または強調面 |
| `on-foreground` | `onPrimary` | primaryを強調面として使用した場合の文字 |
| `container` | `primaryContainer` | 淡い状態コンテナ背景 |
| `on-container` | `onPrimaryContainer` | コンテナ上の文字・アイコン |

- 赤も専用の赤シードから作るprimary系を使い、`scheme.error` へ置き換えない。
- シードRGBを表示色として固定せず、手動混色や混合率指定も行わない。スキーム生成結果を役割どおりに組み合わせる。
- 停止・未評価・未取得には既存MD3の `on-surface-variant` / `surface` 系を使用し、新たな有彩色を増やさない。
- 指定シードと白黒純色のコントラスト比を実装判断には使わず、生成後のトークンと実際の背景の組合せを検証する。コンテナには対応するon-container、強調面にはon-foregroundを使う。

本追加はユーザーが指定した意味色の定義であり、MD3基盤の装飾色を任意のHEXへ置換する変更ではない。[UI業務標準](../rules/06-ui-md3-protocol.md)のテーマ集中管理とコンポーネント直書き禁止を維持する。既存規約が列挙する警戒レベル・通知色に加える専用意味色として本設計承認で位置づけ、統括による規約への整合反映は別途扱う。

歯車・時計・文書のアイコンは48 pxの円形領域に24 pxの Material Symbols を配置し、aria-hiddenとする。取得健全性だけは `worstStatus` により以下の3段階を選ぶ。全状態を色・図形だけで伝えず、状態文字を併記する。

| `worstStatus` | 表示名 | Material Symbols名 |
| --- | --- | --- |
| `normal` | 正常 | `check` |
| `delayed` | 遅延 | `check_alert` |
| `abnormal` | 異常 | `close` |
| `null` | 判定待ち | `remove` |
| `suspended` | 停止中（評価対象外） | `remove` |

`null`（判定待ち）と `suspended`（停止中・評価対象外）は、正常・注意・異常の3段階のいずれにも属さないため、Material Symbols の `remove`（バー）と無彩色で示す。`check` を流用して正常と誤認させない。状態文字を併記する。

## 5. 更新・失敗表示【承認済み】

- 監視画面mount時に即時GETし、完了後5秒で次のGET。多重実行しない。5秒は基本設計の初期案を本設計で採用する承認済み周期であり、表示遅延の保証ではない。
- 1要求のタイムアウトは10秒。画面離脱・端末変更でAbortControllerとタイマーを破棄し、古い要求の完了を無視する。StrictModeの再mountでも未解除のタイマーを残さない。
- 初回は「監視情報を取得中」、値は「—」。初回失敗は「監視情報を更新できません」「通信成功なし」であり、健全性異常とは別の表示。
- 2回目以降の失敗では前回値を保持し、更新行に `role="status"` で「監視情報を更新できません（前回値を表示）」と最終更新時刻を表示。カードの通常色強調を抑え、前回の正常だけが現在値に見える状態を避ける。
- 復旧応答で表示と時刻を一括更新し、失敗表示を解除する。エラー中も同じ周期で再取得する。
- バックグラウンドでは新規取得を休止し、非表示中の実行要求は中断。復帰時は前回値と「監視情報を確認中」を表示して即時取得し、成功するまで現在の正常として強調しない。
- K1の通信状態は監視本体で示す。共通ヘッダーのconnectionや通知配信接続へ勝手に全画面の異常を波及させない。

## 6. モジュール構成

| ファイル | 責務 |
| --- | --- |
| `apps/web/src/api/monitoringStatus.ts` | API読取、必要値の検証、AbortSignal対応 |
| `apps/web/src/monitoring/useMonitoringStatus.ts` | 購読・直列取得・タイムアウト・離脱・可視性変更 |
| `apps/web/src/monitoring/monitoringPresentation.ts` | DTOからカードへの純粋な表示変換、JST書式 |
| `apps/web/src/monitoring/MonitoringDashboard.tsx` | 更新行、4カード、下段2表の静的骨格 |
| `apps/web/src/monitoring/MonitoringToolbar.tsx` | 固定ツールバーの配置見本。M3 Expressiveの`GbButton`を使用し、後続から機能を接続できる境界 |
| `apps/web/src/components/md/GbButton.tsx`、`components/md/index.ts` | `GbButton.tsx` が`@material/web/labs/gb/components/button/md-gb-button.js`を登録し、`color`・`size`・`square`を型付きReact propsとして公開する。利用側は必ず`components/md`バレルからimportする |
| `apps/web/src/monitoring/monitoring.css` | 監視専用の寸法・状態トークン参照・レスポンシブ |
| `apps/web/src/theme/systemStatusColors.ts`、`theme/applyTheme.ts` | シードの集中定義・MCU明暗スキームから状態色を生成・テーマ適用 |
| `apps/web/src/App.tsx`、`shell/AppShell.tsx` | monitor分岐・toolbar接続・mainの監視用クラス |
| `apps/web/tests/monitoring*.test.ts` | 表示変換、取得失敗・復旧・タイマーの検証 |

```ts
type MonitoringLoadState =
  | { phase: 'loading'; data: null }
  | { phase: 'ready'; data: MonitoringStatusResponse }
  | { phase: 'refreshing'; data: MonitoringStatusResponse | null }
  | { phase: 'failed'; data: MonitoringStatusResponse | null };

type MonitoringCard = {
  id: 'operation' | 'health' | 'schedule' | 'processing';
  title: string;
  value: string;
  details: readonly string[];
  tone: 'neutral' | 'normal' | 'active' | 'attention' | 'error';
};

function useMonitoringStatus(terminalId: string): MonitoringLoadState;
function buildMonitoringCards(data: MonitoringStatusResponse): readonly MonitoringCard[];
function MonitoringDashboard(props: { terminalId: string }): React.JSX.Element;
function MonitoringToolbar(): React.JSX.Element;
```

`MonitoringDashboard.tsx` は、健全性カードのアイコン名を `card.id` 固定ではなく、`card.id === 'health'` のとき `worstStatus` から選ぶ関数へ分離する。各値は上表の文字列を返し、`null` / `suspended` は `remove` を返す。両表には上記列比率順の `colgroup` を追加し、各実データ行の状態toneから行の強調クラスを決定する。`MonitoringToolbar.tsx` は既存のグループ構造・無効状態を維持して、`../components/md`のバレルから`GbButton`をimportする。専用CSSで固定幅とグループ単位の自然な折返しを適用する。

`md-gb-button` は既存バレルに未登録であるため、`GbButton.tsx` 内の`createComponent`でカスタム要素を登録し、`components/md/index.ts`から公開してから利用する。登録用のbare importを`main.tsx`などのアプリ起動側へ置かない。生mdタグ・CSS以外のbare import・依存追加は不要。既存shellPreviewは監視ツールバーと衝突させず、通知確認機能が失われないよう検証する。

## 7. 設計承認の記録

ユーザーはA〜Cおよび正常・動作中の濃淡の推奨案を承認した。

| 項目 | 承認内容 |
| --- | --- |
| A：K1時点の表示 | 下段は静的な列見出し・行名・未接続セル「ー」。ツールバーは合意した順序のボタンをすべて無効で表示し、操作可能に偽装しない |
| B：取得運転 | 現行DTOのまま「自動取得有効／自動取得停止」＋初回同期状態。停止理由・停止処理中のAPI拡張はK2へ引き継ぐ |
| C：監視更新 | 完了後5秒、10秒タイムアウト、失敗時は前回値と失敗の明示、非表示中休止・復帰即時取得 |
| 正常・動作中の濃淡 | 正常は緑スキームのprimary文字・アイコン、動作中はprimaryContainer背景＋onPrimaryContainer文字 |

状態色の3シードとMCU明暗スキームの利用、ツールバー48 px程度も承認済み。本書の設計判断について追加ヒアリング待ちはない。後続Issueへ明示的に引き継いだ機能と実挙動検証はK1設計の判断保留ではなく、それぞれの工程で扱う。

## 8. 受け入れ条件

§7の承認内容を前提として、検収担当が以下を項目ごとに実施する。

- [ ] K端末 `#monitor` を開き、4カード→取得元表骨格→情報表骨格の順、固定ツールバー、既存通知3行を確認する。「現在の異常」常設パネルがない。
- [ ] 1920×1080および1920×960 CSS px・100%で通常画面の6行/8行の静的表骨格を表示し、本体のscrollHeightがclientHeight以内、横溢れなし、全ボタンと通知欄が見える。ツールバーが1行時48 px程度であることを含め実測値を記録する。
- [ ] 基本行数を超える追加行、1280×720、文字拡大200%で本体をスクロールし、ヘッダー・ツールバー・通知欄が本体と一緒に流れず、主要値や送信が切れない。
- [ ] 通常画面の下段には§3.2の列見出し・6系列/8種の行名があり、それ以外の未接続セルはすべて「ー」。正常・ゼロ件・架空地域・時刻を表示しない。ツールバーの順序と余白を確認し、全ボタン無効、クリックで制御POSTやダイアログが発生しない。
- [ ] healthのnormal/delayed/abnormal/suspended/null fixtureを順に表示し、承認済み状態色と文字の対応、nullが正常に化けないことを確認する。
- [ ] healthのnormal/delayed/abnormal fixtureを順にサーバー描画し、取得健全性カードのMaterial Symbols名が順に `check` / `check_alert` / `close` となること、SVGを描画しないことを確認する。suspended/null fixtureでは `remove` が描画され、状態文字と無彩色で停止中／判定待ちを判別できることを確認する。
- [ ] 取得元表と情報表の `colgroup` を検査し、指定した列順・%比率、`table-layout: fixed`、`width: 100%`、既存の最小幅920 pxが適用されていることを確認する。各列へ最長の既知表示値を入れても同一列の比率が変化せず、横幅920 px超では表が利用可能な横幅をすべて使うことを、フォント読込完了後に確認する。狭い本体幅では表コンテナだけが横スクロールしてヘッダー・カード・ツールバーが横溢れしないことを確認する。
- [ ] delayed / abnormal の取得元行とattention / errorの情報行をfixtureで表示し、該当行の全セルがそれぞれ黄／赤の `container` 背景と対応する `on-container` 前景になること、通常・停止・判定待ち行の背景が変化しないことを確認する。通常文字と背景のコントラストを4.5:1以上で計測する。
- [ ] `GbButton.tsx` の型付きラッパーが`@material/web/labs/gb/components/button/md-gb-button.js`を登録し、`components/md/index.ts`から`GbButton`を公開することを確認する。`MonitoringToolbar.tsx`がこのバレルからのみimportし、`main.tsx`などに登録用bare import、生`md-gb-button`タグ、個別ラッパーへの直接importがないことを型検査と本番ビルドで確認する。`color="filled"`、`size="sm"`、`square`、`disabled`をReact propsとして渡せることを確認する。
- [ ] 内容幅1080 px以上、1079 px、760 px未満でツールバーを表示する。1080 px以上では各ボタンが120 px幅・`size="sm"`の40 px高・`square`プロパティによるM3 Expressive square shapeの1行であり、ラベル文字数にかかわらず同じ幅であることを確認する。1079 px以下ではグループを分割せず折り返し、toolbar自身が必要な高さへ拡張し、シェル外への横溢れ・横スクロール・ボタン縮小がないことを確認する。送信は折返し後も最後の行の右端にあり、未選択・選択・押下でLabsコンポーネント本来の形状遷移を妨げないことを確認する。
- [ ] schedulerRunning=falseと初回同期の4状態を組み合わせ、「手動停止」「停止処理完了」と断定せず、初回同期失敗が見えることを確認する。
- [ ] 会場Aが再処理完了・会場Bが再処理中、全会場idle、完了0件を表示し、会場別の状態と「起動時再処理」が確認できる。総数からライブキュー数を捏造しない。
- [ ] 時間帯設定を変更したfixtureで時間帯と次の切替がそのまま変わり、固定時刻・通常/低頻度の推測表示がない。
- [ ] 初回遅延→タイムアウト、成功→失敗→復旧をmock fetchと制御時計で再現し、読込中・通信成功なし・前回値・最終更新・復旧が区別できる。
- [ ] APIを10秒未満遅延させ、未完了の間に並行GETが増えない。完了後5秒で次が来ることを確認する。離脱・非表示で要求とタイマーが解除され、復帰で即時読取する。
- [ ] serverGenerationIdが異なる応答へ切り替え、古い進捗が加算・混在しない。端末不一致・未知enum・不正JSON・400/404/500を正常表示へ変換しない。
- [ ] H端末では監視ナビを出さず、既存気象画面・shellPreview・共通通知表示を確認する。監視画面の開閉で上流取得の開始/停止要求が出ない。
- [ ] 指定3色がシードとして1箇所に定義され、MCU 0.3.0の明暗スキームのprimary系から対応トークンが生成されること、赤だけerror系へ差し替えられていないこと、コンポーネント・CSS・fixtureにHEX直書きがなく、警戒レベル色・通知色を変更していないことを確認する。正常/動作中/遅延/異常/停止/未評価fixtureで色と文言の対応を確認する。
- [ ] 使用する明暗テーマと各状態について、実際の前景・背景の組合せで通常文字4.5:1以上、大きな文字3:1以上、意味を持つ図形と背景3:1以上を計測する。生成色の直接上書きやシード値の表示色固定で対処せず、対応するスキームの前景・背景ペアと実際のテーマ適用範囲を確認し、不足が残る場合は統括へ戻す。正常と動作中は色覚に依存せず状態文字で区別できる。
- [ ] キーボードでナビから本文へ移動でき、失敗状態は文字で判別できる。アイコン単独の意味伝達や大量の反復読み上げがない。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`、`npm run build`を実行して通過する。本番ビルドでも`md-gb-button`が描画され、開発時だけに登録が依存しないことを確認する。

## 9. 後続Issueへの引き継ぎ

- K群共通：システム状態の緑/黄/赤は本書の専用トークンを再利用する。気象警戒レベル・通知色へ転用しない。未取得と既知の失敗、停止と正常を混同せず、各後続画面でも文字と色を併用する。

- K2 #75：本書のボタン順と選択→送信/直接開くの区別を引き継ぐ。停止理由・停止処理中・強制更新中を表すAPI不足、停止中の強制更新で自動取得表示を解除しない点、操作中の再選択/結果不明の扱いを設計する。
- K3/K4/K5：受信履歴・電文履歴・出力履歴・操作記録の入口と実体の担当を整理する。出力履歴だけでは通知されない現在の問題を網羅できない。
- K6 #79：取得元表骨格へ実データを接続。6系列・停止・評価待ち・再試行・タイル別判定を扱う。カードの健全性を独自に再評価しない。
- K7 #80：情報表骨格へ実データを接続。会場別要素、availabilityの3状態、保存値、一部未確認の扱いを決める。8行予約を理由に情報を欠落させない。
- K6 #79/K7 #80：本書で定めた `colgroup` の列比率と、attention/errorの行全体を状態コンテナで強調する規則を維持する。新規列の追加・既存列の比率変更は利用可能幅に対する表示への影響を明記して別途設計する。
- K8 #81：常設パネルではなくツールバー「状態診断」から開く。現時点の未解消問題とブラウザ疎通・上流異常を区別し、原因・影響・再試行予定のAPI充足性を点検する。
- K9：H端末の装置異常系通知の表示除外は本書の対象外。

## 10. 設計時点の検証状況

コード・DTO・既存CSSの静的調査を実施。統括担当によりMCU 0.3.0で指定3シードからdarkのprimary / primaryContainer / onPrimaryContainerを生成できることは実行確認済み。UIの実背景に対する可読性の確認とは区別する。Material Web 2.5.0の`@material/web/labs/gb/components/button`に`md-gb-button`、`color`・`size`・`square` props、およびExpressive square shapeが存在することを静的確認した。レビュー時点の実装には`GbButton`バレルを介さない直接import、`main.tsx`での登録用bare import、760 px未満に限った折返しがあり、本設計と差異がある。devサーバー起動、実API接続、ブラウザでの実寸計測、Labsボタンの状態遷移、タイマー・可視性切替は**実挙動未確認**。列比率・ボタン幅は既存CSSと表示構成からの設計値であり、フルHDへ収まることは製造・検収で確認する。

着手時の `git -c core.fsmonitor=false status --porcelain` は差分なし。本フェーズの成果物は本設計書1本のみ。製造・コミット・PR作成は実施しない。
