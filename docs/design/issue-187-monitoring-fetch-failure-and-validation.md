# 監視画面の取得失敗（K端末→サーバー）の表示と応答検証

## 1. 参照した資料と設計判断の根拠
- Issue #187「監視画面の取得失敗（K端末→サーバー）の表示と応答検証」
- docs/rules/02-design-protocol.md

**【ヒアリング確定事項と設計判断】**
1. 端末側検出エラーの通知連携:
   - 監視画面が表示中（`view === 'monitor'`）かつ監視API取得失敗時（`phase: 'failed'`）に、共通シェルヘッダーの connection prop に `{ failed: true, lastSuccessAt }` を反映し「受信異常」バッジを表示。復旧時は解除する。
   - 同時に、下部操作ガイド欄（`NotificationArea` の operation）に「取得監視: 監視情報API取得不可」と表示する。復旧時は通常の操作案内に戻す。
   - **設計判断**: 現在 `useMonitoringStatus` フックは `MonitoringDashboard` 内部に閉じている。親コンポーネント（`App.tsx`）からヘッダーと通知へ伝播させるため、`MonitoringDashboard` にコールバック `onLoadStateChange` を追加し、`App.tsx` 側でステータスを保持・中継する構成とする。
2. 監視画面内の表示（更新行）:
   - 更新行（`.monitoring-update-row`）の表示は変更せず、既存の表示（「最終表示更新 ...」または「—」）を維持する【ユーザー確定方針】。通信失敗の通知は共通シェルヘッダーの「受信異常」バッジおよび下部操作ガイド欄に集約する。
3. 前回値保持時の正常色強調の抑制:
   - 対象範囲: 全体状態カード、取得元別の稼働状況表、情報別の反映状況表の全域。
   - 抑制方針: 通信失敗時（`phase: 'failed'` かつ前回値あり）は、「正常（緑色）」のみを無彩色（neutral）に抑制し、サーバー側の「遅延」や「異常」のトーンは維持する。
   - **設計判断**: `monitoringPresentation.ts` や `monitoringInformationRows.ts` のUI構成関数群に省略可能な `isFailed?: boolean` 引数を追加し、内部で結果オブジェクトの `tone` / `stateTone` が `'normal'` かつ `isFailed` が真の場合に `'neutral'` へ置換する責務を持たせる。
4. 通信クライアント（isMonitoringResponse）の境界バリデーション:
   - `information` および `tiles` （`layers` 含む）の全フィールドを含め、境界で厳格に検証する。
   - 構造不正がある場合は例外をスローし、安全に `phase: 'failed'` として扱う。
   - **設計判断**: `apps/web/src/api/monitoringStatus.ts` に各セクション専用のバリデーション内部関数を追加し、`isMonitoringResponse` の中から呼び出す。
5. 通信失敗状態の維持（再試行中も継続）【ユーザー確定方針】:
   - 監視APIリクエストが失敗した場合、リクエストが正常に完了するまで（再試行中・取得しようとしているときも含む）、受信異常バッジ・操作ガイド・無彩色抑制を維持する。
   - **設計判断**: `useMonitoringStatus` フックにおいて、直前の試行が失敗状態（`hasFailed === true`）である間は、次回の `load()` 実行開始時に `refreshing` や `loading` へフェーズを戻さず `phase: 'failed'` を維持したままリクエストを送信する。正常完了（成功レスポンス受信）時に初めて `phase: 'ready'` へ遷移し受信異常を解除する。

## 2. モジュール構成・型定義・具体的なシグネチャ

### 2.1 境界バリデーションの強化
**対象ファイル:** `apps/web/src/api/monitoringStatus.ts`
- `isIsoDate` において、`Date.parse` だけでなく、正規表現 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/` による Z 終端の UTC ISO 8601 形式および実在日時の厳密な検証を行う。
- 以下の検証用内部関数を追加し、未検証要素をすべて型通りにチェックする。
  ```typescript
  function isInformationSection(value: unknown): boolean
  function isTilesLayer(value: unknown): boolean
  function isTilesSection(value: unknown): boolean
  ```
- 既存の `isMonitoringResponse` の条件を強化し、以下を満たさない場合は `false` を返す。
  - `value.information.every(isInformationSection)`
  - `isTilesSection(value.tiles)`
- 構造不正時はこれまで通り `false` となり、既存の実装により「監視情報の応答形式が不正です」の例外がスローされ `phase: 'failed'` となる。

### 2.2 正常色強調の抑制対応
**対象ファイル:** `apps/web/src/monitoring/monitoringPresentation.ts` / `monitoringInformationRows.ts`
- 以下の生成関数に省略可能な引数 `isFailed?: boolean` を追加する（デフォルト値 `false`）。
  ```typescript
  // monitoringPresentation.ts
  export function buildMonitoringCards(data: MonitoringStatusResponse, isFailed?: boolean): readonly MonitoringCard[]
  export function buildSourceStatusRows(data: MonitoringStatusResponse | null, isFailed?: boolean): readonly SourceStatusRow[]

  // monitoringInformationRows.ts
  export function buildInformationRows(data: MonitoringStatusResponse | null, resolveTargets?: VenueForecastTargetsResolver, isFailed?: boolean): readonly InformationRow[]
  ```
- 各関数の内部ループまたはマップ処理において、生成されたアイテムの `tone` または `stateTone` が `'normal'` の場合、`isFailed === true` であれば `'neutral'` に変更して返す。また、カードの補足色 `detailTone` が `'normal'` の場合も `'neutral'` に抑制する。

### 2.3 監視画面内の表示（更新行）と状態のコールバック
**対象ファイル:** `apps/web/src/monitoring/MonitoringDashboard.tsx`
- コンポーネントのプロパティにコールバックを追加:
  ```typescript
  export interface MonitoringDashboardProps {
    terminalId: string;
    onLoadStateChange?: (state: MonitoringLoadState) => void;
  }
  ```
- `useEffect` を用い、`state` が変化するたびに `onLoadStateChange?.(state)` を実行して親に伝える。
- 画面構成用関数への引数として、`const isFailed = state.phase === 'failed';` を算出し `build...` 関数に渡す。
- `.monitoring-update-row` のレンダリングは変更せず、既存の「最終表示更新」をそのまま維持する。

### 2.4 親シェルとの連携
**対象ファイル:** `apps/web/src/App.tsx`
- `TerminalApp` コンポーネント内に監視画面の状態を保持する State を追加:
  ```typescript
  const [monitoringState, setMonitoringState] = useState<MonitoringLoadState | null>(null);
  ```
- `AppShell` に渡す `connection` prop の算出ロジックを修正:
  - 監視画面（`view === 'monitor'`）かつ `monitoringState?.phase === 'failed'` のとき、`failed: true` とする。
  - その際の `lastSuccessAt` は、`monitoringState.data?.generatedAt` をパースした `Date` オブジェクト（`data` がなければ `null`）。
- `AppShell` の `NotificationArea` に渡す `operation` 文字列の算出を修正:
  - 上記エラー条件に合致する場合は「取得監視: 監視情報API取得不可」とする。
  - それ以外は既存の案内文字列を使用。
- `MonitoringDashboard` コンポーネント呼び出し時に `onLoadStateChange={setMonitoringState}` を渡す。
- `view` が `'monitor'` 以外に切り替わった場合、`connection` prop と `operation` は通常状態（`preview` 用のモック等）に戻るよう評価する。

### 2.5 状態取得フックにおける失敗状態の維持
**対象ファイル:** `apps/web/src/monitoring/useMonitoringStatus.ts`
- フック内に失敗継続フラグ（`hasFailed`）を保持。
- 初回通信失敗時、または更新失敗時（`catch` ブロック）に `hasFailed = true` とする。
- `load()` 実行開始時および `visibilitychange` による復帰時:
  - `hasFailed` が `true` の場合は、`setState` で `refreshing` や `loading` に遷移させず、現在の `phase: 'failed'` を維持したままリクエストを送信する。
  - `hasFailed` が `false` の場合は、従来どおり `latestData ? { phase: 'refreshing', data: latestData } : { phase: 'loading', data: null }` へ遷移する。
- リクエスト成功時（`then` ブロック）:
  - `hasFailed = false` にリセットし、`setState({ phase: 'ready', data })` を実行して通常状態へ復帰する。

## 3. 受け入れ条件のチェックリスト

- [ ] `apps/web/src/api/monitoringStatus.ts` の `isMonitoringResponse` にて、`information` および `tiles` の全フィールドが厳格にバリデーションされており、UTC ISO 8601（Z終端）以外の形式や不正な実在日時は拒否されること。
- [ ] 監視画面の更新行（`.monitoring-update-row`）は既存の表示形式（最終表示更新時刻または「—」）が維持されていること。
- [ ] 2回目以降の通信失敗時、前回値の中で「正常（緑色）」だった項目が無彩色（neutral）として表示され（カード補足の `detailTone` を含む）、遅延（黄色）や異常（赤色）の警告はそのまま維持されること。
- [ ] 監視APIエラー時、共通シェルヘッダーに「受信異常」バッジが表示され、バッジ内に最終更新時刻（成功なしの場合は「通信成功なし」）が表示されること。
- [ ] 監視APIエラー時、下部の操作ガイドに「取得監視: 監視情報API取得不可」と表示されること。
- [ ] 監視APIエラー後、次のリクエストを試行している間（再試行中・取得中）も、リクエストが正常に完了するまで受信異常バッジ・操作ガイド・無彩色抑制が維持されること。
- [ ] 監視APIエラーから復旧（通信成功）したとき、バッジ・操作ガイドのすべてが通常状態に戻ること。
- [ ] 監視APIエラーが発生していても、別の画面に切り替えるとヘッダーの「受信異常」バッジや操作ガイドの表示がクリアされること。

## 4. 後続Issueへの引き継ぎ事項
特になし。

## 5. 実挙動を確認できなかった箇所の明記
実挙動未確認（本Issueは設計のみ実施）
