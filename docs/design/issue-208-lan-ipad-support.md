# Issue #208 LAN・iPad対応

状態: 承認済み（製造まで実施。検収前にユーザーによる実機確認・デザイン監修を行う）

## 1. 前提と根拠

- [Issue #208](https://github.com/BlueKurage119/wx-viewer-poc/issues/208)および統括担当からのヒアリング結果を前提とする。LAN内HTTPでの取得操作、履歴を使わない画面切替、セーフエリア、ツールバー横スクロール、ルートのタイトル予約幅縮小を扱う。
- 【確定】画面切替はURL・ブラウザ履歴を変更しない。`pushState`/`popstate`への置換も行わない。端末IDのURL指定と端末URL間のブラウザ本来の戻る・進むは維持する。再読み込み時は端末の初期画面へ戻り、直前の画面は保存しない。
- ユーザーの発生環境はLAN内IPへのHTTP接続、iPadOS 27。画面切替直後の暗転とローディングバーは通常Safari・ホーム画面起動の両方で報告されている。原因は未確定であり、ハッシュ遷移やViteを原因と断定しない。
- `apps/web/src/monitoring/useMonitoringToolbar.ts`は要求IDを`crypto.randomUUID()`で生成する。`monitoringOperationController.ts`は生成例外を「取得操作の要求を準備できませんでした」に変換する。`packages/shared/src/fetchControl.ts`のUUID検証と、同じ要求IDによる結果照会を維持する。
- `apps/web/src/App.tsx`はハッシュから画面を初期化し、`hashchange`購読と`replaceState`による正規化を行う。`shell/AppShell.tsx`はハッシュリンクで画面を切り替える。`shell/config.ts`の初期画面はH/Kとも`weather`。
- `apps/web/src/index.css`のヘッダー行は通常48px、760px以下では88px。`header-state`は絶対配置の中央寄せ。これらを一体で補正する。
- `monitoring/monitoring.css`は折り返しを許可し、タイトルを120px予約する。ルートのタイトルは空文字であり、無効な戻るボタン2個も表示している。予約幅のみを解消し、戻るボタンは維持する。
- 技術根拠: [Web Cryptography APIのCryptoインターフェース](https://w3c.github.io/webcrypto/#crypto-interface)では`randomUUID`と異なり`getRandomValues`はSecureContext限定ではない。[WebKitのセーフエリア解説](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)に基づき`viewport-fit=cover`と`env(safe-area-inset-*)`を組み合わせる。資料参照日: 2026-09-22。これらは対象iPadでの修正完了の証拠ではない。

## 2. モジュール構成と処理

### 2.1 要求ID

`apps/web/src/monitoring/createRequestId.ts`に`export function createRequestId(): string`を追加し、`useMonitoringToolbar`の`requestIdFactory`へ渡す。

- `crypto.getRandomValues(new Uint8Array(16))`で乱数を取得し、UUID v4のversion/variantビットを設定して小文字の8-4-4-4-12形式にする。HTTP/HTTPSともこの方式に統一し、新規依存を追加しない。
- `Math.random`や時刻で代用しない。暗号乱数が使用できない異常環境では例外を既存の準備失敗処理へ渡す。
- 送信時に1回生成し、再照会は同じIDを使用する既存コントローラーの契約を変えない。
- APIは変更しない。既存の`POST /api/control/fetch/start`、`POST /api/control/fetch/stop`、`POST /api/control/fetch/force-refresh`に`{ requestId: string }`を渡し、`GET /api/control/operations/:requestId`で照会する。

### 2.2 画面切替

- `TerminalApp`の初期状態は`useState<ViewId>('weather')`とする。ハッシュの読取り、`hashchange`購読、履歴の書換えを撤去する。
- `AppShell`のpropsへ`onViewChange: (view: ViewId) => void`を追加する。ナビレールは`type="button"`のボタンとし、選択時にコールバックを呼ぶ。現在画面の表示、キーボード操作、H/Kによる項目の絞り込みを維持する。既存CSSのリンク用セレクターをボタンへ対応させ、標準のボタン枠・背景による見た目の変化を防ぐ。
- 不要となる`resolveView(hash, mode)`とハッシュ画面選択専用のテストを撤去し、新しい契約のテストに置き換える。他の利用箇所は製造時に検索する。
- 旧URLの`#monitor`などは画面指定として解釈しない。起動後もURLを書き換えず、`weather`を表示する。
- 本文スキップリンクは機能を残すが、クリック時にデフォルトのハッシュ移動を抑止し、`main`へのフォーカス移動で実現する。新しい履歴を作らない。
- 画面切替で`TerminalApp`を再マウントせず、通知受信・取得操作コントローラーの寿命を維持する。ツールバー内の階層履歴はブラウザ履歴ではないため維持する。

### 2.3 セーフエリア

- `apps/web/index.html`のviewportに`viewport-fit=cover`を追加する。ホーム画面用manifest、Service Worker、独自のOS判定は追加しない。
- `index.css`に上下左右のセーフエリアを表すCSS変数を定義し、`env(safe-area-inset-*, 0px)`を使用する。
- `.app-shell`は100dvhのborder-box内に左右・下のセーフエリアを確保する。上の余白はヘッダー側で受け持つ。ヘッダー行を「既存の48px（狭幅では88px）+上のセーフエリア」、ヘッダー上paddingを上のセーフエリアとする。背景は上端まで継続し、文字と操作領域を下へ避ける。
- `.header-state`の中央位置も上のセーフエリアを除いた内容領域の中央へ補正する。幅1000px以下のpadding上書きで上余白が消えないよう、既存メディアクエリーも整合させる。
- セーフエリアが0なら従来の寸法を維持する。通知欄やツールバーが100dvhから押し出されないことを確認する。OS固有の固定px余白は導入しない。

### 2.4 ツールバー

- `.view-toolbar`を横スクロールのコンテナーとする。`min-width: 0`、`overflow-x: auto`、折り返し禁止を設定する。狭幅メディアクエリーの折り返し指定も整合させる。
- `.monitoring-toolbar`は`flex-wrap: nowrap`、内容幅を保てる幅指定とし、グループ・操作ボタンが縮んで消えないようにする。横スクロール先に末尾のクリア・送信まで含め、ツールバー以外を横へはみ出させない。タッチイベントによる独自ドラッグは不要。
- ルート階層ではタイトル要素を描画せず、空の120pxと隣接する要素間gapの予約を解消する。戻るボタン2個は従来どおり無効で残す。下位階層では120pxのタイトル、省略表示、戻る操作を維持する。
- 本番定義は現在ルートのみ。下位階層は既存のテスト用定義を使って確認し、試験のためだけに製品メニューを増やさない。
- ボタンの大きさ・文言・選択・送信条件・配色は変更しない。

## 3. 変更範囲

対象は`apps/web/index.html`、`apps/web/src/App.tsx`、`apps/web/src/shell/AppShell.tsx`、`apps/web/src/shell/config.ts`、`apps/web/src/index.css`、`apps/web/src/monitoring/{createRequestId.ts,useMonitoringToolbar.ts,MonitoringToolbar.tsx,monitoring.css}`、対応する`apps/web/tests/`のテスト、および本設計書。

API、sharedの公開契約、依存関係、サーバー公開設定、証明書、取得スケジューラー、通知契約、地図の挙動は変更しない。開始時に存在した`package.json`の他者差分は対象外として保持する。既存の画面直リンクを使うテスト・文書が範囲外で見つかった場合は統括へ報告し、必要な追従範囲を確認する。

## 4. 検証と受け入れ条件

自動テストは新規動作の失敗を検出できるものを追加する。CSS文字列の存在確認だけで画面の合格判定を行わない。新規テストは業務標準に従い、対照実験と意図的な不具合による失敗確認を行う。

- [ ] AC1: 乱数を固定した単体テストでUUIDの全文を独立の期待値と完全一致で比較し、version/variantが正しいこと、共有の`isFetchControlRequestId`を通過することを確認する。`randomUUID`が存在しない環境でも生成できること、乱数生成失敗時に準備失敗を表示し送信しないことを確認する。
- [ ] AC2: LAN内IPのHTTPでK端末を開き、取得開始・取得停止・強制更新をそれぞれ選択して送信する。準備エラーが出ず、各要求がAPIへ届き、結果が確認できること。同じ要求の照会に送信時のUUIDが使われることを通信記録またはクライアント統合テストで確認する。取得開始/停止は試験前の状態を記録し、終了時に復元する。
- [ ] AC3: H/Kの端末を開き、表示可能な全画面を往復する。表示と選択状態が更新され、操作前後のURLと`history.length`が同一であること。画面切替後に再読み込みして`weather`へ戻ること。旧ハッシュ付きURLも初期画面になること。HにK専用項目が出ないこと。
- [ ] AC4: 端末URLを別端末のURLへ移動し、ブラウザの戻る・進むでそれぞれの端末が表示されること。画面切替や本文スキップ操作が途中に履歴を追加しないこと。本文スキップ操作後は`main`にフォーカスが移ること。
- [ ] AC5: iPadOS 27実機で、LAN内HTTPの通常Safariとホーム画面起動のそれぞれについて全画面を往復する。完全暗転・ローディングバーによる再読み込みが発生しないこと。可能ならWebインスペクターでdocument要求とページの再生成も確認する。再現時はコンソール・ネットワーク記録を保存し、Viteのdev配信と自動リロードを含まないビルド配信で比較する。原因が追加変更を要する場合は統括へ戻し、未解決のまま合格にしない。
- [ ] AC6: 同じiPadをホーム画面から起動し縦横へ回転する。ヘッダーのタイトル・時刻・端末名・受信異常表示がOSステータスバーの下に収まり、アラーム停止操作が利用できること。下端の通知操作が隠れないこと。通常Safariでも余白の二重適用がないこと。
- [ ] AC7: iPadの縦横と狭いウィンドウ幅で、ツールバーを指で左右へスクロールし、末尾のクリア・送信を含む各ボタンに到達・操作できること。ボタン押下とスワイプが混同されず、ページ全体の横はみ出しがないこと。キーボードで末尾へフォーカス移動しても操作できること。
- [ ] AC8: ルートの空タイトル予約幅がなくなり、無効な戻るボタン2個は残ること。下位階層を含むテスト用定義で、タイトル表示、一つ前へ戻る、ルートへ戻るを確認し、それぞれ期待した階層になること。
- [ ] AC9: デスクトップの通常幅と760px境界の前後で、ヘッダー・通知欄・地図・取得監視・ツールバーに重なりや切れがないこと。セーフエリア0の通常幅でヘッダー内容領域が48pxを維持すること。スクリーンショットと寸法を記録する。
- [ ] AC10: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`、`npm run build`が成功すること。本番ビルドでもナビレール・Material Webボタン・取得要求生成が動作すること。

## 5. 実挙動未確認・判断事項・引き継ぎ

- **実挙動未確認**: 本設計はコードと資料の調査に基づく。対象iPadでの再読み込みの原因、ホーム起動時のセーフエリア値、縦横回転、タッチ横スクロール、変更後の実機表示は未検証。
- 追加の仕様ヒアリング事項は現時点ではない。ルートの余白削減は空タイトルの予約幅のみとし、戻るボタンの撤去は含めない。
- iPadOS 27の実機受け入れはエミュレーションや別ブラウザの合格で代替しない。検収担当が実機にアクセスできなければ統括からユーザーへ確認手順を渡し、AC5〜7の実機結果を未確認として残す。
- 再読み込みが残った場合の修正方式は原因採取後の判断へ先送りする。Vite設定の変更やSafari向け固定余白を先回りで加えない。
- 後続Issueへの新規機能の引き継ぎはない。HTTPS化、PWA機能、画面状態の永続化は本Issueの対象外であり、自動的に着手しない。

作成: Codex（GPT-6）
