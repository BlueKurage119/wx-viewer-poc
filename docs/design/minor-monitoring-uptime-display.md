# 取得監視画面への運転時間表示の追加 設計書

## 1. 参照した資料と設計判断の根拠

### 参照資料
- ユーザーヒアリング確定事項（2026-09-21）
- `apps/web/src/monitoring/MonitoringDashboard.tsx`
- `apps/web/src/monitoring/monitoringTimeFormat.ts`
- `apps/web/src/monitoring/monitoring.css`
- `docs/rules/02-design-protocol.md`
- `docs/rules/06-ui-md3-protocol.md`

### ヒアリング確定事項と設計判断
1. **起動の基準点（確定事項）**:
   - **案A（Web画面起動時からの経過時間）** を採用する。
   - バックエンドAPIスキーマ（`shared` / `api`）への変更は行わず、フロントエンド（`apps/web`）単独で実装を完結させる。
   - 基準時刻は、Webアプリケーションの初期ロード時（モジュール読み込み時、またはセッション開始時）に記録されたタイムスタンプ（ミリ秒）とする。これにより、監視画面から他画面へ切り替えて戻った場合でも運転時間がリセットされず、継続して累積表示される。

2. **表示内容と配置（確定事項）**:
   - 表示文言: `運転時間: hh:mm:ss`
   - 配置場所: 監視画面の更新行（`.monitoring-update-row`）における「最終表示更新」の左側。
   - スタイル: 既存の `.monitoring-update-row` のスタイル（`font-size: 13px; font-variant-numeric: tabular-nums; gap: 16px; justify-content: end;`）を継承し、数字の桁変動によるガタつきを防ぐとともに、折り返しを防止（`white-space: nowrap;`）する。

3. **カウントアップの更新周期**:
   - 1000ms（1秒）ごとのインターバル更新とする。
   - 画面がバックグラウンドになった場合や復帰時も、基準時刻と現在時刻の差分から計算することで正確な経過時間を維持する。

4. **書式仕様（`hh:mm:ss`）**:
   - 時間（hh）、分（mm）、秒（ss）それぞれを2桁ゼロ埋めで表示する。
   - 経過時間が24時間を超えた場合、日数の分離は行わず時間部を累積する（例: 25時間 → `25:00:00`、100時間 → `100:00:00`）。

---

## 2. モジュール構成・型定義・具体的なシグネチャ

### 2.1 時刻・経過時間整形関数の追加
**対象ファイル:** `apps/web/src/monitoring/monitoringTimeFormat.ts`

```typescript
/**
 * 経過秒数を "hh:mm:ss" 形式の文字列へ整形する。
 * - 24時間を超えた場合も日数は分けず、時間部を2桁以上で累積する（例: 25:00:00）。
 * - 負数または NaN の場合は "00:00:00" を返す。
 *
 * @param elapsedSeconds 経過秒数（整数または実数、内部で Math.floor される）
 * @returns "hh:mm:ss" 形式の文字列
 */
export function formatElapsedTime(elapsedSeconds: number): string;
```

**実装ロジック概要:**
- `if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return '00:00:00';`
- `const totalSec = Math.floor(elapsedSeconds);`
- `const hours = Math.floor(totalSec / 3600);`
- `const minutes = Math.floor((totalSec % 3600) / 60);`
- `const seconds = totalSec % 60;`
- `const hh = String(hours).padStart(2, '0');`
- `const mm = String(minutes).padStart(2, '0');`
- `const ss = String(seconds).padStart(2, '0');`
- `return `${hh}:${mm}:${ss}`;`

### 2.2 運転時間計測フックの追加
**対象ファイル:** `apps/web/src/monitoring/useMonitoringUptime.ts`（新規作成）

```typescript
/**
 * アプリ起動（モジュール初期化）時を起点とした経過秒数を1秒周期で更新して返すフック。
 *
 * @returns 起動からの経過秒数
 */
export function useMonitoringUptime(): number;
```

**実装ロジック概要:**
- モジュールスコープに初期化時刻を記録: `const APP_START_TIME_MS = Date.now();`
- フック内ステート: `const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.floor((Date.now() - APP_START_TIME_MS) / 1000));`
- `useEffect` 内で 1秒ごとの `setInterval` を設定し、アンマウント時にクリア。
- 更新関数内で `Math.floor((Date.now() - APP_START_TIME_MS) / 1000)` を設定。

### 2.3 監視ダッシュボードへの表示組み込み
**対象ファイル:** `apps/web/src/monitoring/MonitoringDashboard.tsx`

`MonitoringDashboardView` 内で `useMonitoringUptime` を呼び出し（または `MonitoringDashboard` で取得して View に渡すか、View 内で直接利用）、`.monitoring-update-row` に運転時間要素を挿入する。

```tsx
export function MonitoringDashboardView({
  state,
  uptimeSeconds,
}: {
  state: MonitoringLoadState;
  uptimeSeconds?: number;
}) {
  // uptimeSeconds が渡されない場合は内部でフックを使用するか、
  // テストの容易性のためオプショナル prop として受け取り可能にする。
  const currentUptime = useMonitoringUptime();
  const displayUptime = uptimeSeconds ?? currentUptime;
  const uptimeText = formatElapsedTime(displayUptime);

  ...
  return (
    <div className="monitoring-dashboard" aria-label="取得監視">
      <div className="monitoring-update-row">
        <span className="monitoring-uptime">運転時間: {uptimeText}</span>
        <span>
          最終表示更新{' '}
          {state.data ? (
            <time dateTime={state.data.generatedAt}>
              {formatJstDateTime(state.data.generatedAt)}
            </time>
          ) : (
            '—'
          )}
        </span>
      </div>
      ...
    </div>
  );
}
```

### 2.4 スタイルの調整
**対象ファイル:** `apps/web/src/monitoring/monitoring.css`

`.monitoring-update-row` 配下の各 span の改行防止および配置整合。

```css
.monitoring-update-row {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 16px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.monitoring-update-row span {
  white-space: nowrap;
}
```

### 2.5 テストの更新・追加
1. **`apps/web/tests/monitoringTimeFormat.test.ts`**:
   - `formatElapsedTime` の単体テスト（0秒、1秒、59秒、60秒、3599秒、3600秒、24時間超 `86400秒 -> 24:00:00`、100時間超、負数・不正値のハンドリング）を追加。
2. **`apps/web/tests/monitoringDashboard.test.ts`**:
   - 既存テスト `test('K1: 通信失敗でも監視情報行に失敗メッセージを表示しない')` において、`updateRow` 内の `span` 要素数が運転時間追加により 2 つになるため、アサーションを `assert.equal((updateRow.match(/<span/g) ?? []).length, 2);` に更新する。また、「運転時間:」が表示されていることを確認。
   - 新規テスト: 監視画面の更新行に「運転時間: hh:mm:ss」が「最終表示更新」の左側に表示されることの検証。

---

## 3. 受け入れ条件のチェックリスト

- [ ] `formatElapsedTime` が秒数を正しく `hh:mm:ss` 形式に整形し、24時間以上（例: 90000秒 → `25:00:00`）でも日数を分けず時間部を累積すること。
- [ ] 取得監視画面を表示した際、最終表示更新の左側に `運転時間: hh:mm:ss` が表示されていること。
- [ ] 監視画面を開いている間、運転時間の秒数が1秒ごとにカウントアップすること。
- [ ] 画面の表示更新中（`refreshing`）や通信失敗時（`failed`）でも運転時間の表示が維持され、カウントが継続すること。
- [ ] ブラウザの別タブへ移動後、再度タブに戻った際にも経過時間が正しい値に維持・更新されていること。
- [ ] `npm test -w apps/web` で全テスト（既存テストの整合性維持を含む）が通過すること。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check` にすべて合格すること。

---

## 4. 後続Issueへの引き継ぎ事項

- 本修正はクライアント側計測による微修正（案A）として実施するため、将来的にサーバープロセスやデータ取得スケジューラの稼働時間（Uptime）を監視対象とする機能拡張（案B相当）が求められた場合は、監視API（`MonitoringStatusResponse`）へのフィールド追加として別途Epic/Issueで検討・設計すること。

---

## 5. 実挙動未確認事項

- なし（既存のコンポーネント構造、CSSレイアウト、およびタイマー処理の動作を確認済み）。
