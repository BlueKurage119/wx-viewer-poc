# Issue #45 (F2) ナウキャスト（雨雲）レイヤーの表示・時間操作 設計

作成日: 2026-09-15
対象 Issue: #45 (F2)
依存: #44 (F1 地図基盤・実装済み)、#39 (E7 ナウキャスト索引・PNG 配信 API・実装済み)

## 1. 設計承認の対象と権限区分

本書は F2 の実装範囲を定める。以下のタグは `docs/basic-design.md` の慣習に従う。

- 【確定】= ユーザーヒアリングで確定済み、または本設計で実データ・実物により実測した事実。
- 【設計案】= 本設計が提案する案。統括担当経由のユーザー承認を得てから製造へ進む。
- 【未確定】= 本設計では決めない。後続 Issue またはユーザー判断に残す。

統括担当から渡された確定事項は次の通りである。第 1 次ヒアリング（#1〜#4）に加え、本設計の技術検証結果を受けた第 2 次ヒアリング（#5〜#8）で残りの論点が確定した。

| # | 確定事項 | 本書での扱い |
| --- | --- | --- |
| 1 | N1/N2 の同一 validTime は両方保持する。優先順位は設計で技術検証したうえで案を提示する | §4.3 に実測と案を記載 |
| 2 | 保存索引のフロント再読込は一定間隔の自動ポーリングとする。秒数は未定 | §5 に実測根拠を記載 |
| 3 | zoom・必要 XYZ 座標を実測して記録する | §6 に実測値を記載 |
| 4 | PNG 完全 decode・位置・凡例（AD-H058）を確認し結論を記録する | §7 に実測結果を記載 |
| 5 | **案 A（N1 実況優先、N2 側もカタログ保持、目盛りは 1 つ、「最新へ」も N1 最新基準）を採用する** | §4.3・§9.1。ユーザー承認済み |
| 6 | **ポーリング間隔は 60 秒。F3 (#46) も 60 秒に統一するため共通モジュール化を前提としてよい** | §5.2・§8 |
| 7 | **再生は事前のタイル温めを行わず、1 秒ごとに逐次切り替える。未読込コマは最大 12 秒待つ** | §9.3 |
| 8 | **共通モジュール 4 本（索引クライアント・ポーリングフック・タイルオーバーレイ・表示ズーム下限）は F2 が先に実装し、F3 がそれを import して流用する** | §8 |
| 9 | **表示ズーム下限は 9。ズーム 9 までは気象レイヤーを表示し、8 以下で非表示とする** | §6.1 |

## 2. 参照した資料と、そこから導いた設計判断

| 資料 | 設計判断の根拠として使った点 |
| --- | --- |
| [基本設計 §4.1〜§4.3](../basic-design.md) | 初期表示は雨雲ナウキャスト【確定】。表示窓は過去 60 分〜未来 60 分の上限で実在コマのみ。欠けたコマを生成・補間しない。再生は利用可能コマを古い順に約 1 秒間隔で繰り返し、再生中のコマ一覧を固定する。最新追従中のみ表示時刻を進める。別時刻へ無表示で置き換えない |
| [#39・#40 設計](issue-39-nowcast-kikikuru-rest-apis.md) | `GET /api/weather/nowcast/times` と単体 PNG の URL・DTO・エラーコード・ヘッダー。一覧は保存索引のみを読み上流 HTTP を発生させない。`allowedZooms` は `[10]`。全応答が `Cache-Control: no-store` |
| [#44・#47〜#49 設計](issue-44-47-49-map-foundation-controls.md) | `MapViewport` / `TimelineControlCard` / `LayerSelector` / `MapLegend` の責務境界、`TimelineViewModel`・`TimelineIntent` の接点、Z10 タイルの拡縮方式と凡例実値・濃度が F2 の実測事項であること |
| [取得方法レポート](../data-acquisition-report.md) | N1 37 件・N2 12 件、時刻一覧を固定しない、存在しないタイル URL を作らない、N1/N2 片系障害を独立に扱う |
| [棚卸し AD-H057 / AD-H058 / AD-H062](../audit-epic-a-d.md) | 未決事項の到達条件と、本書で結論を記録すべき範囲 |
| [07 気象データ業務標準](../rules/07-wx-data-protocol.md) | 確定/未確定の区別、`isTraining`、availability 3 状態、時刻の意味の維持 |
| [06 UI/MD3 業務標準](../rules/06-ui-md3-protocol.md) §MD3 トークン使用義務の例外 | ナウキャストのデータ色は `--wx-data-nowcast-*` として定義し、取得先・取得日時とともに保存する |
| 既存実装 `apps/web/src/map/*`、`apps/api/src/services/nowcastApiService.ts`、`apps/api/src/polling/nowcastTileStore.ts`、`packages/shared/src/tileApi.ts` | F1 の実装済み範囲と API の実在シグネチャ。サーバー側 PNG 検証は署名・IHDR・寸法のみで色タイプを限定していない |

## 3. 実装範囲の線引き（担当範囲と既存実装の境界）

| 項目 | 所有 | 本書での扱い |
| --- | --- | --- |
| Leaflet 地図本体・会場中心補正・ズーム・会場復帰 | F1 実装済み | 変更しない。`MapViewport` へ地図インスタンス公開の最小追加のみ行う（§8.1） |
| 時間操作カードの枠・スライダー・ボタン・キーボード操作 | F4 実装済み | 変更しない。F2 は `TimelineViewModel` を供給し `TimelineIntent` を受ける |
| レイヤー選択ボタン・凡例カードの枠・出典リンク | F5 実装済み | 変更しない。F2 は雨雲の凡例実値（階級・色）と気象出典を供給する |
| ナウキャスト索引の取得・保持・ポーリング | **F2** | 本書 §5 |
| 表示窓の絞り込み・コマ一覧の構成・N1/N2 の扱い | **F2** | 本書 §4 |
| ナウキャスト PNG の Leaflet 重ね描画・Z10 拡縮・濃度 | **F2** | 本書 §6 |
| 再生（古い順・約 1 秒・繰り返し・一覧固定） | **F2** | 本書 §9 |
| 最新追従の状態所有・手動保持・窓外選択時の案内文言 | F7 (#50) | F2 は接点（§10）だけを用意し、文言と手動保持の意味論を決めない |
| 欠け・未取得・失敗・停止・前回値の状態表示文言 | F8 (#51) | F2 は状態を view model に載せる余地を残すが文言を作らない |
| キキクル 3 種 | F3 (#46) | 対象外。`MapLayerId` が `nowcast` 以外のときは F2 の重ね描画を行わない |

**実装済みを誤って前提にしない確認（受け入れ条件 §11.1）**: 製造着手時に、`apps/web/src/map/` に索引取得・PNG 描画・再生のコードが存在しないこと、`WeatherMapView` の既定 view model が `emptyTimeline` であることを実行して確認する。

## 4. コマの取得とタイムライン構成

### 4.1 API 応答からコマを作る

`GET /api/weather/nowcast/times?terminalId=<台帳ID>&controlStatus=normal` の `NowcastTimesResponse`（`packages/shared/src/tileApi.ts`）を唯一の入力とする。フロントは上流の `targetTimes_N*.json` を直接取得しない。

`controlStatus` は防災気象情報ビューでは `normal` 固定とする【設計案】。理由: 訓練は §3.4 の別画面であり、地図ビューを訓練データで置き換える要件が基本設計にない。`status='unsupported_control_status'` を受けた場合でも F2 は正常な非提供応答として扱い、`window`/`access`=null、`allowedZooms`=[] のまま空のコマ一覧を表示する。`isTraining` は `WeatherContext` の値をそのまま保持し、フロントで再計算しない。

```ts
// apps/web/src/map/nowcast/nowcastCatalog.ts
export type NowcastFrameKind = 'observed' | 'forecast';

export interface NowcastFrame {
  /** `${product}:${baseTime}:${validTime}`。表示・再生・タイル URL の一意キー */
  readonly id: string;
  readonly product: 'N1' | 'N2';
  readonly kind: NowcastFrameKind; // N1=observed, N2=forecast
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  /** 同じ validTime に別 product のコマが存在するか（§4.3） */
  readonly hasSameValidTimeAlternative: boolean;
  /** スライダーの目盛り・表示の代表か。重複時は N1 側が true（§4.3 案 A） */
  readonly representative: boolean;
}

export interface NowcastCatalog {
  readonly context: WeatherContext;           // terminalId/venueId/controlStatus/isTraining/evaluatedAt
  readonly window: { from: UtcIso8601String; to: UtcIso8601String } | null;
  readonly allowedZooms: readonly number[];
  readonly imageAccess: TileUpstreamAccess | null;
  readonly products: Readonly<Record<'N1' | 'N2', { metadata: WeatherMetadata }>>;
  /** 表示窓で絞り、validTime 昇順に並べたコマ。欠けは詰めない */
  readonly frames: readonly NowcastFrame[];
  /** 表示窓外・重複により除外したコマ数（F8 の状態表示用に保持のみ） */
  readonly excludedCount: number;
}

export function buildNowcastCatalog(response: NowcastTimesResponse): NowcastCatalog;
```

`buildNowcastCatalog` は純関数とし、単体テストの対象とする。

### 4.2 表示窓（過去 60 分〜未来 60 分）

- 表示窓は API 応答の `window` をそのまま採用する【設計案】。理由: `window` はサービスが保持する取得窓であり、フロントの端末時計に依存しない。端末時計で窓をずらすと、時刻の意味（`evaluatedAt` はサーバー評価時刻）を書き換えることになる。
- `window` が null（`unsupported_control_status` 等）のときはコマ一覧を空とする。フロント側で窓を代用生成しない。
- クライアント側で追加の健全性検査を行い、`window.to - window.from` が 120 分を超える、または `evaluatedAt` が窓の外にある場合は、`evaluatedAt - 60min .. evaluatedAt + 60min` で切り詰める。これは基本設計の上限（過去 60 分〜未来 60 分）を画面が超えないための上限クランプであり、コマの生成・補間ではない。
- 窓に入るコマだけを採用し、欠けた時刻を埋めない。スライダーの目盛りは実在コマの個数と等しくする。

**実測による期待値**（2026-09-15 02:45Z〜02:57Z、上流 `targetTimes_N1.json` / `targetTimes_N2.json` を 15 秒間隔で 26 回取得）:

- N1 は常に 37 件、全件が `elements` に `hrpns` を含み、`basetime == validtime`（＝実況）。直近 3 時間を 5 分刻みで覆う。
- N2 は常に 12 件、`basetime` は単一値、`validtime` は `basetime + 5 分`〜`basetime + 60 分`（＝予測）。
- したがって過去 60 分の窓に入る N1 は 12〜13 件、未来 60 分の N2 は最大 12 件。表示窓内のコマ数は **24〜25** となる。取得方法レポートの「24 コマ」と整合する。

### 4.3 N1/N2 の同一 validTime【設計案・ユーザー承認済み】

**実測（2026-09-15 02:50:47Z〜02:57:18Z、15 秒間隔）**:

| 時刻 (UTC) | N1 最新 validtime | N2 basetime | validtime 重複 |
| --- | --- | --- | --- |
| 02:50:47 | 02:45 | 02:45 | なし |
| 02:51:02 〜 02:51:50 | 02:50 | 02:45 | **02:50 の 1 件** |
| 02:52:05 〜 02:55:59 | 02:50 | 02:50 | なし |
| 02:56:15 〜 02:57:18 | 02:55 | 02:50 | **02:55 の 1 件** |

結論として、重複は次の性質を持つことを実測で確認した【確定】。

1. 重複は **常に 1 件**であり、N1 の最新 validTime と、1 世代前の basetime を持つ N2 の最も古い予測コマが一致する場合だけ生じる。
2. 発生は恒常的ではなく、5 分周期のうち N1 が公開されてから N2 が追いつくまでの間（実測 02:51:02→02:52:05 の約 63 秒、02:56:15→約 70 秒）に限られる。1 周期のおよそ 20〜25% の時間で観測される。
3. 重複時、N1 のコマは当該時刻の実況であり、N2 のコマは 5 分古い基準時刻から出された `+5 分` 予測である。同じ valid 時刻に対して N1 のほうが新しい情報である。

この実測を踏まえた優先順位の案を次の通り示す。

| 案 | 内容 | 利点 | 欠点 |
| --- | --- | --- | --- |
| **A（採用）** | 同一 validTime では **N1（実況）を表示に採用**する。N2 側のコマはカタログ模型に保持し続け、`hasSameValidTimeAlternative=true` を立てるが、スライダー上の目盛りは 1 つにする | 実況を予測より優先するため「予測を単なる実況と表現しない」（§4.3）に整合。目盛り数が安定し、約 1 分ごとに目盛りが 1 つ増減する挙動を避けられる | 同時刻の予測コマを画面から直接選べない |
| B | N2（予測）を優先 | 予測系列の連続性が保たれる | 実況があるのに 5 分古い予測を表示することになり、基本設計の趣旨に反する |
| C | 実況・予測を別枠にし、重複する 2 コマを別々の目盛りとして両方並べる | 情報を落とさない | 同じ時刻の目盛りが 2 つ並び、1 分ほどで片方が消える。F4 のスライダーと F7 の「窓外コマを黙って置換しない」規則の扱いが複雑になる |

**案 A を採用する。ユーザー承認済み（第 2 次ヒアリング、確定事項 #5）。** タグは【設計案】のままとするが、これは基本設計 §4.2・§4.3 が【設計案】区分であることに揃えたものであり、採否そのものは確定している。

案 A は「時刻だけで無条件結合しない」という Issue #139 の棚卸し反映と矛盾しない。結合するのではなく、両方を保持したうえで表示の代表を実況側に固定するためである。重複しない時刻のコマは一切落とさず、N1 の欠け・N2 の欠けはそのまま欠けとして残す。

案 A の実装上の帰結を次に固定する。

- `NowcastFrame` は N1 側・N2 側の双方を `frames` に保持する。片方を捨てない。
- スライダーの目盛りは `validTime` 単位で 1 つとし、重複時は `product='N1'` のコマを代表（`representative`）とする。
- 代表から外れた N2 のコマは `hasSameValidTimeAlternative=true` の側として保持し、画像取得のフォールバック先に**しない**。N1 の画像取得が失敗しても N2 の同時刻画像へ黙って差し替えない（基本設計 §4.3「別時刻へ無表示で置き換えない」と #39 設計「同時刻の別 product に自動フォールバックしない」に従う）。

### 4.4 N1/N2 の片系障害

`products.N1` と `products.N2` の `metadata.availability` は独立に維持する。片方が `unavailable`（`data=null`）でも、もう片方のコマだけでタイムラインを構成する。全体の availability を合成しない。`data={frames:[]}`（正常取得済みの空索引）と `data=null`（未取得・初回失敗）は区別してカタログ模型に保持する。表示文言は F8 の責務とし、F2 は状態を落とさないことだけを保証する。

## 5. 保存索引のポーリング（AD-H062）

### 5.1 契約上の確認【確定】

`GET /api/weather/nowcast/times` は保存索引だけを読み、上流 HTTP を発生させない（#39 設計 §1・§2、`readCatalog` は同期・HTTP なし）。したがってフロントの定期ポーリングは AD-H062 が警戒する「画面が `refreshTimes` を毎回呼ぶ契約違反」に当たらない。F2 は上流の `targetTimes_N*.json` も `refreshTimes` 相当の操作も呼ばない。

### 5.2 間隔【確定】

**60 秒固定間隔とする。ユーザー承認済み（確定事項 #6）。** F3 (#46) のキキクル索引も 60 秒に統一することが決定したため、間隔の定義とポーリング機構は §8.2 の共通モジュールへ置き、レイヤー種別ごとに値を分岐させない。根拠は次の通り。

- バックエンドの索引取得周期は時間帯別に 120 / 60 / 120 秒（AD-D013、#24 設計）。フロントが 60 秒より速く読んでも新しい索引は現れず、API 呼び出しだけが増える。
- 上流の公開タイミングを実測したところ、N1 は 5 分の区切りから約 6〜15 秒後（02:51:02 に 02:50 コマを確認）、N2 はさらに約 60〜70 秒後（02:52:05 に basetime 02:50 を確認）に現れる。したがって上流公開そのものに 1 分強の遅れがある。
- 最悪の表示遅延は「上流公開遅れ（〜70 秒）＋ バックエンド周期（最大 120 秒）＋ フロント周期（60 秒）」で約 4 分強。5 分周期のプロダクトに対して、これより短い周期をフロントで追う実益は小さい。

補助規則【設計案】（共通モジュールの挙動として F3 にも適用される）:

1. 初回マウント時、レイヤーがナウキャストに切り替わった時、`document.visibilityState` が `visible` へ戻った時は、間隔を待たず即時に 1 回取得する。
2. `visibilityState === 'hidden'` の間は定期取得を止める。復帰時に 1 で再開する。
3. 取得失敗（ネットワーク・5xx）時は 60 → 120 → 240 → 300 秒（上限 300 秒）の指数バックオフとし、成功で 60 秒へ戻す。直前に成功したカタログは破棄せず保持する。破棄すると欠けていない情報まで画面から消えるため。
4. 再生中もポーリングは続けるが、取得した新しいコマは再生停止まで一覧へ反映しない（§9.2）。
5. `AbortController` で前回要求を中断し、応答の到着順に依存しない。アンマウント時にタイマーと要求を解除する。

### 5.3 AD-H062 の結論（記録）

> 画面は保存索引を読む `GET /api/weather/nowcast/times` のみを呼び、上流索引更新（`refreshTimes` 相当）を呼ばない。フロントの再読込は **60 秒固定間隔**の自動ポーリングとし、可視状態でのみ動かす。バックエンドの索引取得周期 120/60/120 秒とは独立に定義し、フロント周期を短くしても新しい索引は現れないことを実測（上流は N1 が 5 分区切りの約 6〜15 秒後、N2 がさらに約 60〜70 秒後）で確認した。F3 (#46) のキキクル索引も同じ 60 秒とし、周期とポーリング機構を共通モジュール（§8.2）に一本化してレイヤーごとに分岐させない。

## 6. タイルの重ね描画と zoom・XYZ 実測

### 6.1 許可 zoom と拡縮方式【設計案】

API の `allowedZooms` は `[10]`。背景地図（地理院淡色）は 5〜18、初期表示ズームは 11。F1 の引き継ぎどおり、Leaflet の表示ズームをそのまま API パスの `z` に送ってはならない。

```ts
L.tileLayer(tileUrlTemplate, {
  minNativeZoom: 10,
  maxNativeZoom: 10,   // 常に z=10 のタイルだけを要求し、表示ズームへ CSS 拡縮させる
  minZoom: 5,
  maxZoom: 18,
  tileSize: 256,
  opacity: NOWCAST_LAYER_OPACITY,
  pane: 'overlayPane',
  crossOrigin: false,   // 同一オリジンの API から配信されるため不要
  errorTileUrl: undefined, // 失敗タイルを別画像で塗りつぶさない（F8 が状態を扱う）
  keepBuffer: 0,
})
```

`allowedZooms` が `[10]` 以外を返した場合は、その最大値を `minNativeZoom` / `maxNativeZoom` に使う。`allowedZooms` が空（`unsupported_control_status`）ならレイヤーを地図へ載せない。定数 `10` をコードへ直書きせず API 値から決める（§8.2 共通 4 `resolveTileZoomPolicy`）。

**表示ズーム下限【確定】**: `minDisplayZoom = nativeZoom - 1`（現状 **9**）とし、**表示ズーム 9 までは気象レイヤーを表示し、8 以下では地図から外す**。ユーザー承認済み。

下限が必要な理由は要求タイル数である。`minNativeZoom` を固定したまま表示ズームを下げると、Leaflet は可視範囲全体分の z10 タイルを要求する。フル HD 相当での 1 コマあたりの枚数は次の通りで、背景地図の下限 5 までそのまま追随させると 1 回の縮小操作で API へ千件以上の要求が飛ぶ。

| 表示ズーム | 1 コマあたりの z10 タイル枚数（フル HD 相当・概算） | 扱い |
| --- | --- | --- |
| 11（初期） | 12 | 表示する |
| 10 | 45 | 表示する |
| **9** | **約 144** | **表示する（下限）** |
| 8 | 約 480 | 表示しない |
| 5 | 1,500 超 | 表示しない |

下限をズーム 9 に置くことで、周辺県を含む広域の雨雲を 1 画面で確認する用途を残しつつ、1 コマあたりの要求を約 144 枚で頭打ちにする。ズーム 9 は許可 zoom（10）より 1 段引いた縮尺であり、z10 タイルを 1/2 に縮小して描画するため画質の劣化は生じない（拡大ではなく縮小のため）。

なお、ズーム 9 では再生時の負荷が初期ズーム 11 の約 12 倍になる。§9.3 の 12 秒待ちがズーム 9 で十分かは実測事項とし、§11.3・§11.4 で確認する。

下限を下回った状態は「データが無い」ではなく「この縮尺では表示しない」であり、その旨の表示は F8 の状態表示で扱う。F2 は気象レイヤーを外すところまでを行い、文言を作らない。

### 6.2 必要 XYZ 座標の実測【確定】

会場座標（`packages/shared/src/venueForecastTargets.ts`）から Web Mercator で算出した z10 タイルは次の通りで、取得方法レポートが実取得に成功した `10/909/403` と一致する。

| 会場 | 緯度 / 経度 | z10 の会場タイル |
| --- | --- | --- |
| east（東京ビッグサイト） | 35.63159368010876 / 139.79281040119963 | **909 / 403** |
| trc（東京流通センター） | 35.58138 / 139.748119 | **909 / 403** |

F1 の可視矩形補正（右列幅 R・下部カード高 B を差し引いた矩形の中心に会場を置く）を踏まえ、代表的な画面寸法で必要になる **z10 タイル範囲**を算出した（主領域からヘッダー 64px・ナビレール 72px・通知領域 56px を除いた値で試算）。

| 表示ズーム | 画面 | z10 の x 範囲 | z10 の y 範囲 | 1 コマあたりのタイル数 |
| --- | --- | --- | --- | --- |
| 11（初期） | フル HD 相当 | 908 – 911 | 402 – 404 | **12** |
| 11（初期） | iPad 横向き相当 | 909 – 910 | 402 – 404 | **6** |
| 10 | フル HD 相当 | 906 – 914 | 401 – 405 | 45 |
| 10 | iPad 横向き相当 | 908 – 912 | 402 – 404 | 15 |

初期表示（ズーム 11）では **1 コマ 12 タイル**、表示窓いっぱい 25 コマで延べ 300 リクエストが上限となる。実測した PNG は 1 枚 334〜836 バイトであり、25 コマ分を保持しても 1 MB に満たない。ユーザーが zoom 10 まで引くと 1 コマ 45 タイルまで増えるため、§9.3 の同時要求数制限を設ける。

この算出は計算による机上値であり、**実画面での実測は製造・検収フェーズの受け入れ条件（§11.3）とする。実挙動未確認。**

### 6.3 タイル URL

```
/api/weather/nowcast/{product}/tiles/{z}/{x}/{y}.png
  ?terminalId=<台帳ID>&controlStatus=normal
  &baseTime=<encodeURIComponent(ISO)>&validTime=<encodeURIComponent(ISO)>
```

`element` / `member` はサーバー固定のため送らない。時刻は `YYYY-MM-DDTHH:mm:ss.sssZ` の正準 UTC 表記を URL エンコードして渡す。Leaflet のテンプレートに `{z}/{x}/{y}` を残し、クエリはコマ確定時に組み立てる。任意 URL・パスを組み立てる汎用プロキシ的な記述をフロントに置かない。

### 6.4 濃度（opacity）【設計案】

`NOWCAST_LAYER_OPACITY = 0.8` を提案する。実測パレットは全階級 α=255 の不透明色であり（§7.2）、淡色地図の地名・行政界が読めなくなるため、レイヤー全体の不透明度で調整する。F5 は濃度コントロールを F2 へ引き継いだが、**PoC では濃度の UI コントロールを設けず固定値とする**【設計案】。理由: 操作面を増やす前に、実画面でユーザーが視認性を監修する必要があり、可変化はその後でよい。値そのものは実画面での監修事項（要ヒアリング）。

## 7. PNG の健全性・位置・凡例（AD-H058）

### 7.1 完全 decode の実測【確定】

2026-09-15 02:55Z〜03:00Z のコマについて、`N1`（basetime=validtime=02:55Z）と `N2`（basetime=02:55Z, validtime=03:00Z）の z10 タイル `909/403`・`908/402`・`911/404` を上流から取得し、次を検証した。

- 全 6 件が HTTP 200。PNG 署名一致。
- **全チャンクの CRC32 が一致**（IHDR / PLTE / tRNS / IDAT / IEND）。
- **IDAT を zlib で完全 inflate 成功**。展開後のバイト数が `(stride + 1) × height` と完全一致（パレット形式 33,024 バイト、RGBA 形式 262,400 バイト）。すなわち途中切断・破損はない。
- 画像寸法は全件 256×256。

**2 種類の PNG 形式が混在することを確認した【確定】。**

| 形式 | IHDR | 出現 | 実測サイズ |
| --- | --- | --- | --- |
| パレット | color type 3 / bit depth 4（16 色 PLTE + tRNS） | 降水域を含むタイル | 401〜836 B |
| RGBA | color type 8bit / color type 6 | 降水がまったくないタイル（全画素 RGBA=0x00000000） | 334 B |

既存のサーバー側検証（`nowcastTileStore.ts`）は署名・IHDR の存在・寸法のみを見ており色タイプを限定していないため、**両形式とも現状の実装を通過する**。色タイプやパレットの有無を条件にする検証を新たに追加してはならない（全面透明タイルを不正とみなして降水なしの地域が表示不能になる）。

サーバー側に完全 decode / CRC 検証を追加することは**採否待ちの保守事項**であり、本 Issue で修正必須へ昇格させない。本設計の実測により、上流 PNG が完全に decode できることは確認済みである。

### 7.2 データ色トークンと凡例の階級【確定】

配色・階級ともに気象庁の公式資料で確定した。

- **正とする出典**: 気象庁「気象庁ホームページにおける気象情報の配色に関する設定指針」（2020 年 7 月）
  `https://www.jma.go.jp/jma/kishou/info/colorguide/HPColorGuide_202007.pdf`
- **照合に使った実測**: `https://www.jma.go.jp/bosai/jmatile/data/nowc/20260915025500/none/20260915025500/surf/hrpns/10/908/402.png` の PLTE / tRNS チャンク（2026-09-15 03:00Z 前後に取得）

06-ui-md3-protocol の「MD3 トークン使用義務の例外」第 4 項に従い、公式値を正としてトークン化し、出典を本書に保存する。

| トークン | 降水強度 (mm/h) | 公式 RGB | HEX（トークン値） | 実測 PNG パレット索引 | 照合結果 |
| --- | --- | --- | --- | --- | --- |
| `--wx-data-nowcast-1` | 0〜1 | rgb(242,242,255) | `#f2f2ff` | 2 | 一致 |
| `--wx-data-nowcast-2` | 1〜5 | rgb(160,210,255) | `#a0d2ff` | 3 | 一致 |
| `--wx-data-nowcast-3` | 5〜10 | rgb(33,140,255) | `#218cff` | 4 | 一致 |
| `--wx-data-nowcast-4` | 10〜20 | rgb(0,65,255) | `#0041ff` | 5 | 一致 |
| `--wx-data-nowcast-5` | 20〜30 | rgb(250,245,0) | `#faf500` | 6 | 一致 |
| `--wx-data-nowcast-6` | 30〜50 | rgb(255,153,0) | `#ff9900` | 7 | 一致 |
| `--wx-data-nowcast-7` | 50〜80 | rgb(255,40,0) | `#ff2800` | 8 | 一致 |
| `--wx-data-nowcast-8` | 80 以上 | rgb(180,0,104) | `#b40068` | 9 | 一致 |

**照合結果: 公式資料の 8 階級すべてが、実測した PNG パレットの索引 2〜9 と RGB 値で完全一致した。差異はない。** これにより、実測パレットの並び順が公式の降水強度階級の昇順と対応することも裏づけられた。パレット索引 0・1 は `#ffffff` かつ α=0 の透明であり、階級を持たないためトークン化しない。

なお、最下位階級のラベルは公式表記の **「0〜1 mm/h」** とする。本設計の初期案にあった「0.1〜1 mm/h」は誤りであり、公式値で置き換えた。

トークンはテーマ生成物とは別のデータ色として `apps/web/src/theme/` 配下の CSS に定義し、凡例は `var(--wx-data-nowcast-N)` で参照する。TSX・fixture へ HEX を直書きしない。MD3 の `--md-sys-color-*` で代用しない（凡例とタイルの色が食い違うため）。

凡例の単位は mm/h、出典は「気象庁 高解像度降水ナウキャスト」を常時表示する。地理院タイルの出典（F5 実装済み）と併記し、どちらも隠さない。

### 7.3 位置（地理的重ね合わせ）

タイル URL は標準の XYZ（Web Mercator, 256px）スキームであり、会場座標から計算した z10 タイル 909/403 が、取得方法レポートで実取得に成功した URL と一致することを §6.2 で確認した。ただし **実画面で背景地図と降水域が正しく重なるかは実挙動未確認**であり、§11.3 の受け入れ条件で実画面確認する。

### 7.4 透明画素の意味

取得に成功したタイルの透明画素は「最下位階級未満（降水なしに近い）」を表す。しかし**未取得・取得失敗のタイルと、透明画素のタイルは画面上の見え方が同じ**である。したがって F2 は「透明だから降水なし」と画面に表現しない。タイル単位の取得結果（成功 / 失敗 / 未取得）は §8.5 の状態として保持し、その表示文言は F8 が決める。

### 7.5 AD-H058 の結論（記録）

> 上流ナウキャスト PNG は、全チャンク CRC 一致・IDAT の完全 inflate 成功・展開長一致により **完全 decode できることを実測で確認した**（2026-09-15、N1/N2 各 3 タイル）。PNG は「4bit パレット + tRNS」と「全透明 RGBA」の 2 形式が混在し、既存のサーバー側検証（署名・IHDR・寸法）は両形式を通す。色タイプを限定する検証を追加しない。**配色と階級は気象庁「気象庁ホームページにおける気象情報の配色に関する設定指針」（2020 年 7 月）で確定した。** 公式の 8 階級（0〜1 / 1〜5 / 5〜10 / 10〜20 / 20〜30 / 30〜50 / 50〜80 / 80 以上 mm/h）の RGB 値が、実測 PNG のパレット索引 2〜9 と**完全一致**することを照合済みで、公式値を正として `--wx-data-nowcast-1..8` に保存した。実画面での重ね合わせ位置・zoom 見え方は製造・検収時の実画面確認事項として残す。サーバー側の完全 decode/CRC 検証追加は採否待ちの保守事項であり、本 Issue では修正必須へ昇格させない。

## 8. モジュール構成

### 8.1 配置方針

確定事項 #8 により、共通モジュール 4 本は **F2 が先に実装し、F3 (#46) がそれを import して流用する**。配置は既存のディレクトリ構成・命名規則に従う。

既存の規則は次の通りである。

- `packages/shared` は `apps/api` と `apps/web` が共有する**型と純粋なデータ定義**の置き場である（`tileApi.ts`・`weatherApi.ts`・`venueForecastTargets.ts`）。React・Leaflet・`fetch` に依存するコードは置かない。`apps/api` のビルドが壊れるため。
- `apps/web/src/api/` は REST クライアント（既存 `startupNotifications.ts`）。
- `apps/web/src/map/` は地図ビューの構成要素。ファイル名はコンポーネントが PascalCase、それ以外が camelCase。ディレクトリ名は小文字。

したがって共通モジュールは **`packages/shared` ではなく `apps/web` 側に置く**。DTO 型は既に `packages/shared/src/tileApi.ts` にあり、そこへ追加はしない。

```
packages/shared/src/tileApi.ts                （既存・変更しない）DTO 型

apps/web/src/api/
  tileCatalogClient.ts   ★共通1: 索引 API クライアント基盤（fetch / 中断 / HTTP→失敗種別）
  nowcastTimes.ts          F2: ナウキャスト索引の薄いラッパー
  （kikikuruTimes.ts）     F3 が後から追加する

apps/web/src/map/tiles/                        ★F2 が新設する共通ディレクトリ
  useTileCatalogPolling.ts  ★共通2: 60 秒ポーリング hook（§5、レイヤー非依存）
  WeatherTileOverlay.tsx    ★共通3: Leaflet 重ね描画（ダブルバッファ、§9.3）
  tileZoom.ts               ★共通4: allowedZooms → native zoom と表示ズーム下限（§6.1）
  tileCatalogTypes.ts        共通の状態型（NowcastFetchFailure 等のレイヤー非依存部分）
  index.ts                   バレル

apps/web/src/map/nowcast/                      F2 固有
  nowcastCatalog.ts       純関数: NowcastTimesResponse → NowcastCatalog
  useNowcastCatalog.ts    useTileCatalogPolling を雨雲用に束ねる
  nowcastTileUrl.ts       純関数: コマ → Leaflet URL テンプレート
  usePlayback.ts          再生制御（§9）
  nowcastTimeline.ts      純関数: NowcastCatalog + 選択状態 → TimelineViewModel
  nowcastLegend.ts        凡例の階級定義（トークン名とラベル）
  index.ts                バレル
```

`apps/web/package.json` の `"sideEffects": ["*.css"]` 制約により、`index.ts` のバレルは必ず `export` を伴わせる。副作用だけの bare import を書かない（06-ui-md3-protocol 必須制約 3）。

### 8.2 共通モジュール 4 本のシグネチャ

F3 が変更なしで流用できるよう、いずれもナウキャスト固有の語彙を型・引数に持ち込まない。

```ts
// ★共通1  apps/web/src/api/tileCatalogClient.ts
export type TileCatalogFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'http'; readonly httpStatus: number; readonly code: TileApiError['code'] | null };

export type TileCatalogResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: TileCatalogFailure };

/**
 * 索引 API を 1 回呼ぶ。path はレイヤーごとに呼び出し側が渡す
 * （F2: '/api/weather/nowcast/times'、F3: '/api/weather/kikikuru/times'）。
 * terminalId/controlStatus 以外のクエリを組み立てない。
 */
export function fetchTileCatalog<T>(params: {
  readonly path: string;
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly signal: AbortSignal;
  readonly parse: (body: unknown) => T | null; // 応答形の検査はレイヤー側の純関数
  readonly fetchImpl?: typeof fetch;           // テスト差し替え用
}): Promise<TileCatalogResult<T>>;

// ★共通2  apps/web/src/map/tiles/useTileCatalogPolling.ts
export const TILE_CATALOG_POLL_INTERVAL_MS = 60_000; // 確定事項 #6。F2/F3 共通
export const TILE_CATALOG_BACKOFF_MS = [60_000, 120_000, 240_000, 300_000] as const;

export type TileCatalogState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly catalog: T; readonly fetchedAt: number }
  | { readonly status: 'stale'; readonly catalog: T; readonly fetchedAt: number;
      readonly failure: TileCatalogFailure }
  | { readonly status: 'failed'; readonly failure: TileCatalogFailure };

/** §5.2 の補助規則（即時取得・不可視停止・バックオフ・中断）をすべて内包する */
export function useTileCatalogPolling<T>(params: {
  readonly load: (signal: AbortSignal) => Promise<TileCatalogResult<T>>;
  /**
   * 値が変わると即時に 1 回取得しなおす。
   * **索引 API のレスポンス内容が変わる要因だけを含める。** 具体的には端末（terminalId）、
   * controlStatus、メインレイヤー（雨雲ナウキャスト ⇔ キキクル）の 3 つ。
   * 同じレスポンスに含まれる下位の選択（キキクル種別など）を含めてはならない（§8.3）。
   */
  readonly resetKey: string;
  /** false の間は取得しない（非選択のメインレイヤーのポーリングを止めるため） */
  readonly enabled: boolean;
}): TileCatalogState<T>;

// ★共通3  apps/web/src/map/tiles/WeatherTileOverlay.tsx
export interface WeatherTileOverlayProps {
  readonly map: L.Map | null;
  /** null なら地図から外す。id が変わったときだけ差し替える */
  readonly frame: { readonly id: string; readonly urlTemplate: string } | null;
  readonly allowedZooms: readonly number[];
  readonly opacity: number;
  readonly swapTimeoutMs: number;      // §9.3。F2 は 12_000
  readonly onSwapSettled?: (result: { frameId: string; complete: boolean }) => void;
  readonly onTileError?: (frameId: string) => void;
}
/** ダブルバッファ（同時最大 2 枚）で差し替える。レイヤー種別を知らない */
export function WeatherTileOverlay(props: WeatherTileOverlayProps): null;

// ★共通4  apps/web/src/map/tiles/tileZoom.ts
export interface TileZoomPolicy {
  /** L.TileLayer の minNativeZoom / maxNativeZoom に渡す値 */
  readonly nativeZoom: number;
  /** この表示ズーム未満では気象レイヤーを地図へ載せない。`nativeZoom - 1`（現状 9、§6.1） */
  readonly minDisplayZoom: number;
}
/** allowedZooms が空なら null（レイヤーを載せない） */
export function resolveTileZoomPolicy(allowedZooms: readonly number[]): TileZoomPolicy | null;
```

### 8.3 F3 (#46) が流用する前提

F3 は次を**新規に書かずに import する**。F2 の製造担当はこの前提を壊す変更（ナウキャスト固有の語彙を共通モジュールの型へ持ち込む、`product: 'N1' | 'N2'` を共通側の引数に置く等）をしない。

| 共通モジュール | F3 での使い方 |
| --- | --- |
| `tileCatalogClient.ts` | `path='/api/weather/kikikuru/times'`、`parse` をキキクル DTO 用に差し替える |
| `useTileCatalogPolling.ts` | そのまま。**`resetKey` にキキクル種別を含めない**（下記の理由による） |
| `WeatherTileOverlay.tsx` | そのまま。`frame.urlTemplate` をキキクルの URL（`imageId` / `member` を含む）にする |
| `tileZoom.ts` | そのまま。キキクル API の `allowedZooms` を渡す |

**`resetKey` にキキクル種別を含めない理由**（F3 設計担当の指摘、実装コードで確認済み）: キキクル索引 API は 1 回の応答で大雨・浸水・土砂の 3 レイヤーすべてを返す。`apps/api/src/services/kikikuruApiService.ts` が `KIKIKURU_LAYERS = ['heavyrain', 'inund', 'land']` をループして `layers` Record を必ず埋める実装である。したがって種別を切り替えても新しい情報は得られず、再取得は無駄な API 呼び出しになるだけである。

このため `resetKey` は **索引 API のレスポンス内容が変わる要因だけ**で構成する。

| 切替 | `resetKey` を変えるか |
| --- | --- |
| 端末（terminalId）、controlStatus | 変える |
| メインレイヤー（雨雲ナウキャスト ⇔ キキクル） | 変える。呼ぶエンドポイントが別なため |
| キキクル種別（大雨 / 浸水 / 土砂） | **変えない。** 同じ応答に 3 種とも含まれている |
| コマの選択・再生・地図操作 | 変えない |

種別切替で変わるのは表示するタイルの URL だけであり、それは `WeatherTileOverlay` の `frame.urlTemplate` の差し替えで完結する。F3 は「種別切替では索引を再取得しない」設計のままでよい。

F2（雨雲）には下位の種別選択が無いため、`resetKey` は `${terminalId}:${controlStatus}:nowcast` とする。

### 8.4 F1 への最小追加

`MapViewport` は現在 Leaflet インスタンスを外へ出していない。F2 のタイルレイヤーを載せるため、`MapViewportHandle` に読み取り専用の取得口を 1 つ足す。

```ts
export interface MapViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  returnToVenue: () => void;
  /** F2/F3 の気象レイヤー接続用。地図生成前・破棄後は null */
  getMap: () => L.Map | null;              // 追加
}
export interface MapViewportProps {
  /* 既存に加えて */
  onMapReady?: (map: L.Map | null) => void; // 追加。生成時に map、破棄時に null を通知
}
```

これ以外に F1 の中心補正・リサイズ・マーカー・背景タイル・`ViewPlacement` のロジックを変更しない。気象レイヤーは `overlayPane` に載せるため背景タイル（`tilePane`）と干渉しない。

### 8.5 状態の持ち方

```ts
// apps/web/src/map/nowcast/useNowcastCatalog.ts
export type NowcastCatalogState = TileCatalogState<NowcastCatalog>;

export function useNowcastCatalog(params: {
  readonly terminalId: string;
  readonly controlStatus: WeatherControlStatus;
  readonly enabled: boolean; // 選択レイヤーが 'nowcast' のときだけ true
}): NowcastCatalogState;
```

`status='stale'` は直前の成功値を保持したまま失敗した状態、`status='failed'` は一度も成功していない状態を表す。この区別は F8 の状態表示に必要であり、F2 は両者を混ぜない。

タイル単位の取得結果は `WeatherTileOverlay` が Leaflet の `tileerror` / `tileload` から集計し、`onTileError` / `onSwapSettled` で外へ渡す（表示は F8）。`X-Wx-Catalog-Availability` / `X-Wx-Tile-Result` / `X-Wx-Tile-Stored-At` は Leaflet の `<img>` 経由では読めないため、F2 ではこれらを読まない。必要になったら F8 が `fetch` 経由の取得へ切り替える。

### 8.6 メタ情報の維持（Issue #139 追加受け入れ条件）

- `metadata` の各フィールド（`source` / `issuedAt` / `validAt` / `validFrom` / `validTo` / `fetchedAt` / `lastSuccessAt` / `sourceVersion`）は **null を null のまま**保持し、別のフィールドで代用しない。
- `availability` は `available` / `stale` / `unavailable` の 3 状態を N1 / N2 それぞれ独立に保持する。全体値へ合成しない。
- 時刻の意味を混同しない。`baseTime` = コマの基準時刻、`validTime` = 対象時刻、`evaluatedAt` = サーバー評価時刻、`issuedAt` / `fetchedAt` / `lastSuccessAt` は保存サービスの規約どおりの意味で扱う。画面の「表示日時」は `validTime` を使い、`evaluatedAt` や `issuedAt` で代用しない。
- `venueId` / `terminalId` は API 応答の値をそのまま表示・ログに使い、フロントで推測しない。
- `isTraining` は `WeatherContext` の値を保持し、`controlStatus` から再計算しない。

## 9. 再生と表示時刻

### 9.1 選択コマと「最新」【設計案・ユーザー承認済み】

確定事項 #5 により、「最新へ」も N1 最新基準とすることが承認された。

- 初期選択および「最新へ」は、**実況（N1）の最新コマ**を選ぶ。
- 理由: タイムラインの最大 `validTime` は +60 分の予測であり、これを既定表示にすると予測を実況と誤認させる。基本設計 §4.3 の「予測を含む危険度を単なる実況と表現しない」に整合させる。
- 実況コマが 1 件も無い（N1 が `unavailable` / 空）場合は、**最も古い予測コマ**ではなく、**最も新しい実況に最も近い予測コマ**＝予測群の最も古いコマを選ぶ。実況が無いことは view model の `kind='forecast'` で表現され、F4 が実況／予報の区別を描画する。
- コマが 1 件も無い場合は `selectedFrameId=null` とし、F4 の空カタログ表示に委ねる。

タイムラインの最大 `validTime`（+60 分の予測）を「最新」としない。この解釈はユーザー承認済みである。

### 9.2 再生

- 再生は利用可能コマを **`validTime` 昇順（古い順）** に 1 コマずつ進め、末尾に達したら先頭へ戻って繰り返す。
- 間隔は 1000 ms。「約 1 秒間隔」の要件に対し、`setInterval` ではなく `setTimeout` の再帰で各コマ表示完了時刻から次を測る（タブ復帰時のバースト実行を避ける）。
- **再生開始時にコマ一覧を固定する。** 再生中にポーリングで新しいコマを得ても一覧を変えない。停止時に最新カタログへ差し替え、その時点の選択コマが新しい一覧に存在しなければ F7 の規則に従う（F2 は選択コマを黙って別時刻へ置き換えない）。
- 再生中は最新追従を行わない。
- レイヤー切替時（F5 からの `onLayerSelect`）は再生を停止する。地図の中心・ズームは変更しない。

### 9.3 描画の切り替え（ダブルバッファ）【確定】

確定事項 #7 により、**事前のタイル温め（プリフェッチ）は行わない。1 秒ごとに逐次切り替え、未読込コマは最大 12 秒待つ。** 再生開始時に最大 300 件の要求を一括で出す案は不採用となった。

API は全応答に `Cache-Control: no-store` を返すため、ブラウザキャッシュは効かない。一方 Leaflet が一度描画した `<img>` は再要求されない。この 2 点を踏まえた切替手順を次に固定する。

1. 地図へ同時に載せる `L.TileLayer` は**最大 2 枚**とする（現行コマ用・次コマ用）。3 枚以上を保持しない。保持すると地図の pan / zoom のたびに全レイヤーが新しいタイルを要求し、要求数がコマ数倍になる。
2. コマ切替では、次コマ用レイヤーを `opacity: 0` で `addLayer` し、その `load` イベントを待つ。
3. `load` が来たら `opacity` を入れ替え、旧レイヤーを `removeLayer` する。**同じ瞬間に、画面の選択コマ（表示日時）も次コマへ進める。** これにより、表示中の画像と表示日時が常に同じコマを指す。読み込み途中のコマを表示状態にせず、前のコマの画像を新しい時刻の画像として見せることもない。
4. `load` が **12,000 ms**（`swapTimeoutMs`）以内に来ない場合は待ち続けず、そのコマへ切り替えたうえで `onSwapSettled({ complete: false })` を通知する。タイル欠けの状態表示は F8 が扱う。再生を無期限に止めない。
5. 再生中の次コマの予約は、上記 3 または 4 で切替が確定した時点から 1,000 ms 後に行う（§9.2）。したがって読み込みに時間がかかるコマでは再生が実時間で遅れる。これは「約 1 秒間隔」の要件に対し、未読込コマを飛ばしたり前コマを残したりするより安全な側に倒した選択である。
6. 再生停止中の手動コマ送り・スライダー操作でも同じ手順を使う。手動操作で切替待ちの最中に別のコマが要求された場合は、待機中のレイヤーを破棄して最後の要求だけを処理する。

12 秒という値の根拠は、1 コマ 12〜45 枚のタイルを API 経由で取得する必要があり、キャッシュ未命中時には上流取得が直列に発生しうるためである。実測は §11.4 で行う。

## 10. F7（最新追従）との接点

F2 は最新追従の**状態所有者にならない**。F2 が用意するのは次の接点だけとする。

```ts
export interface NowcastSelectionController {
  readonly frames: readonly NowcastFrame[];
  readonly selectedFrameId: string | null;
  selectFrame(frameId: string): void;
  selectLatestObserved(): void;
  /** 新しいカタログが届いたときに呼ばれる。true を返した側が選択を進める */
  onCatalogUpdated(next: NowcastCatalog): void;
}
```

F2 の実装範囲では `followLatest: boolean` を内部に持ち、初期値 `true`、`select-frame` / `previous-frame` / `next-frame` の intent で `false` にし、`select-latest` で `true` に戻す最小の挙動だけを持つ。**F7 が所有する次の事項を F2 で先取りしない。**

- 手動保持中に選択コマが表示窓から外れたときの案内文言と扱い
- 再生停止後の新着反映の時機に関する追加規則
- 追従状態の常時表示文言

F7 着手時に、この内部状態を F7 のコントローラーへ差し替えられるよう、`useNowcastCatalog` と再生制御から選択状態を分離した単一のモジュールに閉じ込める。

## 11. 受け入れ条件

検収担当は各項目を実行して合否を判定する。`npm run lint` / `npm run typecheck` / `npm run format:check` / `npm run test -w apps/web` がいずれもエラーなく完了することを前提とする。

### 11.1 担当範囲と既存実装の境界（Issue #139 追加条件）

- [ ] 製造前の `main` に対し `grep -rn "nowcast" apps/web/src` を実行し、索引取得・PNG 描画・再生のフロント実装が存在しなかったことを記録する。実装済みとして飛ばした項目がないことを確認する。
- [ ] `WeatherMapView` に view model を渡さない既定状態では、F4 の空カタログ表示（「利用可能な時刻はありません」）が出ることを画面で確認する。F2 は fixture の時刻を通常画面に出さない。
- [ ] `git diff --stat` で、`MapViewport.tsx` の変更が §8.4 の `getMap` / `onMapReady` 追加に限られ、中心補正・リサイズ・マーカー・背景タイルのロジックが変更されていないことを確認する。

### 11.2 初期表示とコマ一覧

- [ ] `apps/api` と `apps/web` を起動し、端末 URL（east / trc の各 1 台）で防災気象情報ビューを開くと、レイヤー選択が「雨雲ナウキャスト」のまま、地図に降水強度タイルが重なる。キキクルは選択されていない。
- [ ] DevTools の Network で `GET /api/weather/nowcast/times?terminalId=...&controlStatus=normal` が 200 で返り、応答の `window.from` / `window.to` の差が 120 分以内、`evaluatedAt` がその範囲内にあることを確認する。
- [ ] 同じ応答の `products.N1.data.frames` / `products.N2.data.frames` の件数と、画面のスライダー目盛り数を突き合わせる。目盛り数 = 表示窓内の N1 件数 + N2 件数 −（同一 validTime の重複件数）であり、**24 前後**になる。窓外のコマが目盛りに出ていないこと、存在しない時刻の目盛りが生成されていないことを確認する。
- [ ] N1 の時刻列に 5 分の欠けを含む応答（後述の固定応答で再現）を与え、欠けた時刻の目盛りが**作られない**ことを確認する。補間された中間時刻が現れない。
- [ ] 応答の `products.N2.data` を `null`、`products.N2.metadata.availability` を `unavailable` にした固定応答で、N1 のコマだけでタイムラインが構成され、画面が例外を出さないことを確認する。N1 側を同様にした場合も対称に動く。
- [ ] `products.N1.data` が `{frames: []}`（正常取得済みの空）の場合と `null`（未取得）の場合で、カタログ模型が異なる状態を保持していることを単体テストで確認する。

### 11.3 zoom・XYZ・位置・凡例（AD-H058 / 実画面）

- [ ] DevTools の Network でナウキャストのタイル要求 URL を確認し、**パスの `z` が常に 10** であること、表示ズームを 9・11・13 に変えても `z` が 10 のままであることを確認する。
- [ ] 初期表示（ズーム 11）でフル HD 相当の画面を開き、要求された z10 タイルの x が 908–911、y が 402–404 の範囲（計 12 枚以内）であることを実測して §6.2 の机上値と突き合わせる。差異があれば記録する。
- [ ] **表示ズーム 9 では気象レイヤーが表示され続ける**ことを確認する。要求される z10 タイル枚数を Network で数え、1 コマあたり約 144 枚（フル HD 相当）の概算と突き合わせて記録する。
- [ ] **表示ズームを 8 以下へ下げると**気象タイルの要求が止まり、レイヤーが地図から外れる。ズーム 9 以上に戻すと再び表示される。ズーム 5 まで下げても数百件のタイル要求が発生しない。
- [ ] ズーム 9 で気象タイルが背景地図に対して 1/2 に縮小描画され、拡大に伴うぼけが生じていないことを実画面で確認する。
- [ ] 降水がある時間帯のコマで、降水域が背景の海岸線・行政界に対して不自然にずれていないことを実画面で確認し、スクリーンショットを検収記録に残す。会場マーカーの位置と降水域の相対位置が地図移動・ズームで追随する。
- [ ] 凡例が 8 階級で表示され、各スウォッチの計算済み色と階級ラベルが §7.2 の**公式値の表と 1 行ずつ一致する**ことを DevTools の computed style で確認する。最下位階級のラベルが「0〜1 mm/h」であること（「0.1〜1」ではない）を含めて確認する。
- [ ] `grep -rn "#f2f2ff\|#a0d2ff\|#218cff\|#0041ff\|#faf500\|#ff9900\|#ff2800\|#b40068" apps/web/src --include=*.tsx --include=*.ts` が 0 件であり、HEX が `--wx-data-nowcast-1..8` の CSS 定義 1 か所にだけ存在することを確認する。
- [ ] 凡例のスウォッチ色と、実際のタイル画像の該当階級の画素色が一致することを、降水がある時間帯のコマで確認する（画面のスクリーンショットから該当画素の RGB を拾い、トークン値と突き合わせる）。
- [ ] 凡例に「気象庁 高解像度降水ナウキャスト」の出典が表示され、地理院タイルの出典と併存して、右側情報列・時間操作カードの背後に隠れない。

### 11.4 再生

- [ ] 再生ボタンを押すと、コマが `validTime` の**古い順**に進む。2 周目（全タイル読み込み済み）で 10 コマ分の切替時刻を `performance.now()` で記録し、各間隔が **1000 ms ± 300 ms** に収まることを確認する。
- [ ] 末尾のコマの次で先頭へ戻り、繰り返し再生される。
- [ ] **再生開始時に、一覧全コマのタイルを一括で要求しない**ことを Network で確認する。再生開始直後の数秒間の要求件数が 1 コマ分（初期ズーム 11 で 12 件前後）＋次コマ分の範囲に収まり、全コマ分（数百件）のプリフェッチが走らない。
- [ ] 再生中にポーリングで新しいコマを含む応答が届いても、スライダーの目盛り数と各目盛りの時刻が変化しない。停止すると新しいコマが反映される。
- [ ] DevTools でタイル要求を遅延（Slow 3G）させて再生し、切替時に**前コマの降水域が新しい時刻の表示として残らない**こと、および**画面の表示日時と表示中の画像が同じコマを指す**ことを確認する（表示日時だけが先に進まない）。
- [ ] 同じく遅延させた状態で、1 コマの読み込みが 12 秒を超えた場合に再生が止まらず次へ進み、タイル欠けの状態が外部へ通知されることを確認する（`onSwapSettled` の `complete: false` をテストで検証する）。
- [ ] **表示ズーム 9（1 コマ約 144 枚）で再生**し、コマ切替が 12 秒の待ち時間内に収まるか、超過して欠けとして通知されるかを記録する。超過が常態化する場合は待ち時間の見直しが必要なため、実測値を統括担当へ報告する。
- [ ] 地図へ同時に載っているナウキャストのタイルレイヤーが最大 2 枚であることを、`map` の内部レイヤー数または DOM 上の `.leaflet-layer` 数で確認する。

### 11.5 ポーリング（AD-H062）

- [ ] 画面を開いたまま 3 分待ち、`GET /api/weather/nowcast/times` が **60 秒間隔**で 3〜4 回発行されることを Network で確認する。`refreshTimes` 相当の上流更新エンドポイントや上流 `targetTimes_N*.json` への要求が **1 件も無い**ことを確認する。
- [ ] タブを別タブへ切り替えて 2 分置き、その間ポーリングが止まり、戻った直後に 1 回取得されることを確認する。
- [ ] API を停止して失敗させ、取得間隔が 60 → 120 → 240 秒へ伸びること、直前に成功したコマ一覧が画面から消えないことを確認する。API を復旧すると 60 秒間隔へ戻る。
- [ ] レイヤーをキキクルへ切り替えて戻すと、間隔を待たず即時に 1 回取得される。

### 11.6 共通モジュールの再利用性（確定事項 #8）

- [ ] `apps/web/src/api/tileCatalogClient.ts`、`apps/web/src/map/tiles/useTileCatalogPolling.ts`、`apps/web/src/map/tiles/WeatherTileOverlay.tsx`、`apps/web/src/map/tiles/tileZoom.ts` の 4 本が §8.1 の配置どおりに存在する。
- [ ] この 4 本に対し `grep -n "N1\|N2\|nowcast\|Nowcast\|hrpns\|雨雲" apps/web/src/api/tileCatalogClient.ts apps/web/src/map/tiles/*.ts*` を実行し、**ナウキャスト固有の語彙が型・引数・定数に混入していない**ことを確認する（コメント中の例示を除く）。混入していれば F3 が流用できないため不合格とする。
- [ ] ポーリング間隔 60 秒がこの共通モジュールの 1 か所（`TILE_CATALOG_POLL_INTERVAL_MS`）だけで定義され、`apps/web/src/map/nowcast/` 側に別の間隔定数が無いことを確認する。
- [ ] `useTileCatalogPolling` が `resetKey` の変化だけで即時再取得することを単体テストで確認する。**F3 がキキクル種別を `resetKey` に含めないで済む設計になっているか**を、`resetKey` を固定したまま他の props（`frame.urlTemplate` 相当の値）を変えても再取得が走らないことで検証する（§8.3）。
- [ ] 4 本がいずれも `packages/shared` ではなく `apps/web` 配下にあり、`packages/shared` に React / Leaflet / `fetch` 依存のコードが追加されていないことを確認する。`npm run build` が shared → api → web の順で通る。

### 11.7 メタ情報の維持（Issue #139 追加条件）

- [ ] N1 を `available`、N2 を `stale` にした固定応答で、両者が独立の 3 状態として保持されることを単体テストで確認する。合成した単一 availability を持たない。
- [ ] `metadata` の各 null フィールドが別の時刻で埋められていないことを単体テストで確認する（`issuedAt=null` の応答で表示日時が `evaluatedAt` に差し替わらない）。
- [ ] 画面の表示日時が選択コマの `validTime` に対応する。`baseTime` や `evaluatedAt` を表示していない。
- [ ] `controlStatus=training` / `test` を与えた固定応答で、`status='unsupported_control_status'`・`window=null`・`allowedZooms=[]` を受け取り、タイルレイヤーを地図へ載せず、`normal` の画像を流用しないことを確認する。`isTraining` は応答値をそのまま保持する。
- [ ] 会場（`venueId`）が応答値のまま扱われ、east / trc で同じ全国索引を使っていても会場ごとの取り違えが起きない。

### 11.8 棚卸し項目の結論記録（Issue #139 追加条件）

- [ ] 設計書 §4.3・§5.3・§7.5 に AD-H057 / AD-H062 / AD-H058 の結論が記録されている。
- [ ] 採否待ちの保守事項（サーバー側 PNG 完全 decode 検証の追加、タイルキャッシュ容量 / LRU）が、本 Issue の修正必須へ昇格していない。

**AD-H057 の結論（記録）**:

> N1/N2 は時刻だけで無条件に結合せず、`${product}:${baseTime}:${validTime}` を一意キーとして両方を保持する。同一 validTime の重複は実測で「常に 1 件・5 分周期のうち約 60〜70 秒だけ発生」と判明したため、表示の代表を実況（N1）に固定し、予測側のコマもカタログ模型に残す（案 A、ユーザー承認済み）。同時刻の別 product へ画像取得のフォールバックをしない。「最新へ」も N1 最新を基準とする。表示窓は API の `window` を採用し、窓外のコマは欠けとして残す。再生中はコマ一覧を固定し、選択コマを別時刻へ黙って置き換えない。必要な XYZ は z10 の x 908–911 / y 402–404（初期ズーム 11・フル HD 相当、机上算出）で、会場タイルは east / trc とも 909/403 である。

### 11.9 検証用の固定応答

上記の固定応答は `apps/web` のテストフィクスチャとして `NowcastTimesResponse` の形で用意する。実データを改変して保存しない。フィクスチャには実在しない会場・端末 ID を使わず、既存の台帳 ID を使う。

## 12. 後続 Issue への引き継ぎ

| 後続 | 引き継ぐもの | F2 が先取りしないもの |
| --- | --- | --- |
| F3 (#46) | **§8.2 の共通モジュール 4 本（`tileCatalogClient` / `useTileCatalogPolling` / `WeatherTileOverlay` / `tileZoom`）を import して流用する。** 併せて `MapViewportHandle.getMap` / `onMapReady`、`--wx-data-*` の定義場所 | キキクル 3 種の catalog、初回大雨・種別保持、`reference` 時刻の意味、キキクルの色・階級、未来時刻を設けないこと |
| F7 (#50) | `NowcastSelectionController` の接点、`followLatest` の最小実装、再生中の一覧固定 | 手動保持中に選択コマが窓外へ出たときの案内、再生停止後の新着反映の追加規則、追従状態の常時表示文言 |
| F8 (#51) | `NowcastCatalogState`、タイル単位の `tileload` / `tileerror` 集計、N1/N2 独立の availability | 欠け・未取得・失敗・停止・前回値の表示文言と配置 |
| G1 | 変更なし（右側情報列に触れない） | — |
| L1 (#83) | 実画面での色・位置・zoom・凡例の確認結果（§11.3 の記録） | 両会場の総合受入条件 |

## 13. 実挙動未確認の箇所

1. **実画面での地理的重ね合わせ**（降水域と海岸線・行政界の一致）。設計フェーズでは URL スキームと会場タイル座標の一致まで。§11.3 で確認する。
2. **z10 タイルを表示ズーム 11 で拡縮したときの見え方**（ぼけ・境界の段差）。§11.3 で確認する。
3. **必要 XYZ 範囲の実測**。§6.2 は机上算出であり、実ブラウザーのタイル要求で突き合わせる。
4. **再生時の実リクエスト負荷とコマ切替の実測間隔**。§9.3 の方式は確定したが、12 秒の待ち時間が実環境で十分かは実測していない。§11.4 で確認する。
5. **新規 REST をフロントから呼んだときの挙動全般**。#39 設計も新規 REST を実挙動未確認としている。
6. **表示ズーム 9（1 コマ約 144 枚）での要求枚数と再生の実負荷**。枚数は机上算出であり、実ブラウザーでの実測と 12 秒待ちの十分性は §11.3・§11.4 で確認する。

## 14. 未確定として残す事項

1. 雷・竜巻ナウキャスト、気象レイヤーの同時重ね合わせ（基本設計 §4.2【未確定】、本 Issue 対象外）。
2. レイヤー濃度の可変 UI（§6.4。PoC では固定値）。
3. サーバー側 PNG の完全 decode / CRC 検証の追加（AD-H058、採否待ちの保守事項）。
4. タイルキャッシュの容量上限・LRU（AD-H059、L2 #84 の実測事項）。
5. レイヤー濃度の値（§6.4 の 0.8）。実画面での視認性監修待ち。
