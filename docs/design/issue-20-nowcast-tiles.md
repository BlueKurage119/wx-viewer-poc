# Issue #20「C10. 雨雲ナウキャストのタイル取得（オンデマンド）」設計

作成日: 2026-09-12  
作成: Codex  
状態: 承認済み（2026-09-12、§10 の3点を含む）  
予定ブランチ: `feature/issue-20-nowcast-tiles`

## 1. 目的・前提

N1／N2 時刻一覧を独立して取得・保存し、その一覧に記載された `hrpns` フレームについて、要求された座標の PNG だけを取得する。時刻一覧にない時刻を補間して URL を組み立てない。

**【確定・ユーザーヒアリング】表示窓はサーバーの現在時刻を基準に過去60分〜未来60分とする。** 最新実況時刻への丸め・窓の移動は行わない。両端を含む。以下の内部設計はユーザー承認により本 Issue で採用する方針であり、基本設計の【設計案】【未確定】を確定済み仕様へ変更するものではない。追加確認への承認結果は §10 にまとめる。

### 参照資料と実物調査

| 参照 | 設計への反映 |
| --- | --- |
| Issue #20 正式本文（統括から引継ぎ）、[Issue 下書き](../issues-draft.md) C10 | N1／N2 独立、実在フレーム、必要画角・時刻だけ取得 |
| [取得方法レポート](../data-acquisition-report.md) §4 | 14桁 UTC、`elements` の `hrpns`、基準時刻と対象時刻を別に保持。N1 37件・N2 12件、5分のずれは過去の実測例であり固定仕様ではない |
| [基本設計](../basic-design.md) §4.3、§6.1〜6.3、§8 | 窓、欠けたコマの非補間、前回値保持、取得履歴、画像未取得と降水なしの区別 |
| [B2 設計](issue-6-info-type-schema.md)、[テーブル定義](issue-6-table-definition.md)、[B3 設計](issue-7-reception-history.md)、[B6 設計](issue-10-retention-policy.md) | タイル本体は DB 外、メタ情報は DB、通信履歴はフレーム単位。B6 はタイル本体の削除を担当しない |
| [B2 リポジトリ](../../apps/api/src/repositories/radarRepository.ts) と migration `0005` | 通常保存はフレーム・タイルを全置換、stale 保存は明細を保持。既存 API をそのまま使うとタイル追記と一覧更新が競合する |
| [HTTP 共通処理](../../apps/api/src/polling/httpGet.ts)、[アメダス取得](../../apps/api/src/polling/amedasFetchService.ts) | 注入 fetch／clock、通信履歴、単発関数の構成を踏襲。既存 HTTP 処理は `res.text()` 専用で PNG に使えない |
| [共通型](../../packages/shared/src/index.ts)、[availability](../../packages/shared/src/availability.ts) | 共通メタ・3状態を使用。鮮度の具体的閾値は取得側から入力する |

本設計では最新の外部実データを再取得していない。外部提供についての根拠は取得方法レポートの検証日時に限定する。全ズーム上限、一覧公開直後の全タイル存在、画像の位置合わせ、PNG の色と降水強度の全対応、アニメーションは**実挙動未確認**。

## 2. 範囲

対象は API workspace の取得・保存・取得結果返却まで。新規 HTTP エンドポイントは作らず、E7 に関数を引き継ぐ。フロントエンド、shared の公開契約、地図の画角計算、時間操作カード、キキクル、サーバー起動時の接続、定期実行・再試行スケジュールは対象外。

呼び出し元が1フレームと必要な XYZ 座標列を指定する。緯度経度・画面サイズから XYZ を求める計算は地図側の責務とする。全コマ・全タイルの先読みは行わない。同一プロセス・同一サービスインスタンスが1つの DB／キャッシュルートを所有する。複数プロセス共有は対象外。

## 3. 時刻一覧とフレーム

### 3.1 正規化

取得先を次の定数だけに固定する。外部から URL を入力させない。

```text
https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json
https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json
https://www.jma.go.jp/bosai/jmatile/data/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png
```

- ルートは配列、各要素はオブジェクトで `basetime`／`validtime` は厳密な14桁 UTC 日時、`elements` は文字列配列とする。年月日・時分秒を UTC で往復検証し、2月30日などの自動繰り上がりを拒否する。未知の付加フィールドは無視する。
- `elements` に完全一致で `hrpns` がある行だけを採用する。その他の要素は正常な除外。構造不正な行が1件でもあれば当該 product 全体を `invalid_structure` とし、前回正常一覧を保持する。正常な空配列／hrpns なしは成功した空一覧として扱う。
- `(product, baseTime, validTime, element='hrpns', member='none')` を自然キーとする。同じキーは1件にまとめ、`validTime` → `baseTime` の昇順で並べる。`sequence` はその順番で0から採番する。
- `baseTime` を N1 の最新値などから再構築しない。DB では UTC ISO 8601、URL では当該行の時刻を14桁 UTC に戻す。
- 同じ `validTime` でも異なる product／baseTime は別候補として保持する。実況優先などの未確定な表示採用規則を C10 に入れない。
- 正常一覧は提供された全候補を保存し、返却とタイル要求のたびに `now ± 60分` で絞る。正常な空一覧でも `lastSuccessAt` は更新する。未来60分まで届かなくても水増ししない。

### 3.2 保存メタと鮮度

product ごとに `source` は時刻一覧 URL、`issuedAt` は採用行の最大 `baseTime`、`validAt=null`、`validFrom/validTo` は全採用行の最小／最大 `validTime`。空一覧は期間を null、発表時刻が存在しないため `issuedAt=fetchedAt` とする（取得時刻を代替値にする設計上の規約であり、気象庁の発表時刻と説明しない）。`sourceVersion` は取得本文の SHA-256。

成功時に `fetchedAt` と `lastSuccessAt` を更新する。失敗時は `fetchedAt` だけ更新し、前回メタとフレームを保持する。初回失敗は空の unavailable スナップショットを保存し、`issuedAt=fetchedAt`、期間・版・最終成功は null とする。

`resolveAvailability` に、`hasLastNormalValue = lastSuccessAt !== null` と判定済み freshness を渡す。正常な空一覧にも「正常値がある」。product ごとの直近失敗は abnormal、前回成功からの経過が `staleAfterMs[product]` 以上なら delayed、それ以外は normal とする。閾値は正の有限数を必須注入し、C10 に未実測の既定値を設けない。一覧読出し時にも clock から再評価するため、取得関数を呼ばない間も stale に遷移できる。永続行の状態だけを信用しない。

プロセスを作り直した際も DB の最終成功時刻・状態・前回正常一覧を読んで同じ評価を行う。失敗済みであることは保存 availability が stale である場合に保持し、次回成功で解除する。表示窓から全フレームが外れた場合も、取得状態と `frames=[]` を別に返す。期限切れフレームを表示窓に戻さない。

## 4. 型とモジュール

自然キー型 `NowcastFrameKey` は `apps/api/src/repositories/types.ts` に定義し、polling 側から import する。その他の新規型は `apps/api/src/polling/nowcastTypes.ts` に置く。repository から polling への依存は作らない。ここで示す `RadarProduct`／`RadarTile`／`RadarSnapshot` は既存 repository 型、`Availability` 等は shared 型を import する。

```ts
interface NowcastFrameKey {
  readonly product: RadarProduct;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly element: 'hrpns';
  readonly member: 'none';
}
interface TileCoordinate {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
}
interface NowcastCatalog {
  readonly now: UtcIso8601String;
  readonly window: { readonly from: UtcIso8601String; readonly to: UtcIso8601String };
  readonly products: Readonly<Record<RadarProduct, {
    readonly snapshot: RadarSnapshot | null;
    readonly availability: Availability;
    readonly frames: readonly NowcastFrameKey[];
  }>>;
}
type NowcastTileResult = {
  readonly coordinate: TileCoordinate;
  readonly availability: Availability;
} & (
  | { readonly kind: 'downloaded' | 'cached'; readonly tile: RadarTile }
  | { readonly kind: 'unavailable'; readonly tile: null; readonly errorKind: string }
);
interface NowcastOptions {
  readonly cacheRoot: string;
  readonly allowedZooms: readonly number[];
  readonly staleAfterMs: Readonly<Record<RadarProduct, number>>;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => UtcIso8601String;
  readonly timeoutMs?: number;
}
interface NowcastAttemptOptions {
  readonly triggerKind?: string; // 既定 manual
  readonly attemptNo?: number; // 既定1、C13から注入
}
class NowcastService {
  constructor(connection: DatabaseConnection, options: NowcastOptions);
  refreshTimes(options?: NowcastAttemptOptions): Promise<NowcastCatalog>;
  readCatalog(): NowcastCatalog;
  fetchFrameTiles(
    frame: NowcastFrameKey,
    coordinates: readonly TileCoordinate[],
    options?: NowcastAttemptOptions,
  ): Promise<readonly NowcastTileResult[]>;
}
```

`refreshTimes` は両 product の HTTP を独立に完了させ、各成否を保存してから catalog を返す。片側 HTTP／解析失敗を全体例外にしない。DB 破損など内部障害は例外として呼出元に返し、通信障害に偽装しない。`readCatalog` はネットワークアクセスを行わない。初期取得前は `snapshot=null`、availability は unavailable。

| ファイル | 責務 |
| --- | --- |
| `polling/nowcastSource.ts` | 固定 URL、厳密時刻変換、検証済み自然キーからの URL 構築（サービス内部のみ） |
| `polling/nowcastParser.ts` | JSON 正規化・自然キー重複除去・順序 |
| `polling/nowcastTypes.ts` | 上記型 |
| `polling/nowcastService.ts` | 単発取得、窓・存在確認、product 状態、要求排他、履歴 |
| `polling/nowcastTileStore.ts` | バイナリ GET、PNG 検証、SHA-256、ファイル保存・読出し検証 |
| `repositories/radarRepository.ts` | 以下の追加操作。既存保存関数の契約は変更しない |
| `polling/index.ts` | サービス・入力結果型の export |
| `tests/nowcastParser.test.ts`、`tests/nowcastService.test.ts`、`tests/nowcastTileStore.test.ts` | fixture、fake fetch、実 SQLite／一時ディレクトリによる検証 |

リポジトリへ次を追加する。新 migration は不要。

```ts
mergeRadarSnapshot(connection: DatabaseConnection, input: RadarSnapshotInput): RadarSnapshot;
upsertRadarTile(
  connection: DatabaseConnection,
  frame: NowcastFrameKey,
  tile: RadarTileInput,
): RadarTile | null;
```

`mergeRadarSnapshot` は成功一覧に含まれる自然キーの既存 frame ID と tile 行を保持し、追加・sequence 更新・消えた frame の削除を1つの同期トランザクションで行う。呼び出し前に読んだ古い tiles を丸ごと書き戻さない。stale／unavailable 保存には既存 `saveRadarSnapshot` を使えるが、前回正常値がある失敗は必ず stale とする。`upsertRadarTile` は保存直前に自然キーで frame を再検索し、存在すれば XYZ 単位 UPSERT、消えていれば null。古い数値 ID で別フレームに書き込まない。

## 5. PNG のオンデマンド取得

1. 一覧／タイルの変更操作はサービスの product 別キューで直列化する（N1 と N2 は並行可）。DB トランザクション中に await しない。タイル座標は要求内で重複除去し、入力順で処理する。同じ product の後続要求は先行保存後にキャッシュを参照するため HTTP が重複しない。
2. 要求開始時に現在時刻を1回取り、フレームが表示窓内・当該 product の保存済み一覧に完全一致・hrpns/none であることを検査する。不一致は全座標に `frame_not_available` を返し、URL 構築も GET もしない。空座標列は空結果、通信履歴もなし。
3. zoom は非負の安全な整数で `allowedZooms` に含まれること、x/y は安全な整数で `0 <= x,y < 2**zoom` を満たすことを検証。設定自体も安全な XYZ 計算ができる範囲で検証する。無効値は `invalid_coordinate`。これは座標形式検証であり気象庁の提供保証ではない。許可集合の案は §10。
4. DB メタとファイル本体・長さ・SHA-256・PNG 検証が一致すれば cached として返す。異なる baseTime／validTime の画像は代用しない。鮮度 stale の場合は cached の availability も stale とする。
5. キャッシュがなければ当該候補の時刻から URL を組み立てて GET。**一覧が stale の場合のキャッシュミスは取得を抑止し `catalog_stale` とする案**（§10）。成功した古い一覧から未確認タイルを取得できると扱わない。
6. HTTP は `Accept: image/png`、既存同様の User-Agent、注入 fetch・タイムアウトを使う。既定 timeout は既存共通処理と同じ10秒（新たな実測値ではない）。`arrayBuffer()` で受信する。HTTP 異常、timeout、network を区別する。空・HTML・不正 PNG は `invalid_png` で失敗し、キャッシュへ登録しない。
7. PNG は8バイト署名、IHDR 長・種別・正の幅高さ、チャンク境界が受信長内、IDAT と終端 IEND が存在することを検査する。画像の色解釈や完全デコードは対象外。256×256 はレポートの確認値であり、提供全体の固定仕様として強制しない。CRC／描画の完全性は未保証として後続に伝える。
8. 受信バイト列の SHA-256 を計算し、専用 cacheRoot 下の `radar/{product}/{base14}/{valid14}/{z}/{x}/{y}/{hash}.png` に保存する。相対パスは検証済み内部値のみで生成し DB に保存する。cacheRoot は絶対パス必須・専用ディレクトリとし、第三者が symlink を配置する運用を許容しない。
9. 同一ディレクトリのランダムな一時名へ書込み完了後 rename、続いて `upsertRadarTile`。失敗時は一時ファイルと今回新規作成し DB 未参照となった本体を除去する。既存正常本体を先に消さない。ファイル破損・欠落時はキャッシュミスとして扱う。一覧が available の場合は同じキーを再取得し、失敗時は unavailable。一覧が stale の場合は手順5の GET 抑止を優先し、再取得せず catalog_stale を返す。壊れたファイルを cached として返さない。

一覧に載る時刻でも、配信遅延・削除・対象座標未提供により個別 PNG が404となる可能性がある。「存在しない URL を生成しない」の受入条件は、**一覧にない時刻・不正な座標から URL を捏造しないこと**である。HTTP 404 の発生ゼロや全画角の画像存在を保証しない。結果には座標ごとの欠損を残し、透明画像などへ置換しない。

一覧更新で消えたフレームの本体は、その product の直列処理内で DB 非参照を確認してから専用キャッシュ内だけ削除する。起動時に専用キャッシュを走査し、DB 非参照の本体と残留一時ファイルを除去する。前回正常一覧が stale で残る間はその参照本体を削除しない。容量上限・LRU・stale の最終破棄時期は未設計であり、本 Issue は「正常一覧に残るフレームのうち要求済みのタイル」の保持までとする。任意ディレクトリ全体の削除は行わない。

## 6. 通信履歴

時刻一覧は sourceKind=`radar_times_N1`／`radar_times_N2`、targetRef は product。HTTP ごとに成功・失敗1行、itemCount／failedItemCount は null（正常空一覧も null）、本文ハッシュは取得本文の SHA-256。

タイルは sourceKind=`radar_tile`、targetRef は product と baseTime／validTime／element／member を連結した自然キー。`fetchFrameTiles` 1呼出しのうち実際に GET した座標だけを1フレーム1行へまとめる。キャッシュヒット・入力拒否のみなら記録しない。集約対象の GET が1以上の場合だけ `itemCount` を設定する。`failedItemCount` は HTTP／PNG 失敗件数、`durationMs` は各 GET 所要時間の合計、`responseBytes` は受信できたバイト数の合計（全て不明なら null）。requestUrl は実際の最初の GET、httpStatus は全取得が同じステータスならその値、混在・通信失敗を含む場合は null。複数本文の contentHash は null。errorMessage に内部パスやバイナリを出さない。

**一部タイル失敗時は outcome=failure とする案**（§10）。成功タイルはそのまま保存し返す。一部失敗を product の時刻一覧 availability に上書きしない。DB／ファイル書込みエラーは通信成功と区別して呼出元へ例外を返す。各 GET の HTTP／PNG 検証結果をメモリ上へ追加してから、成功分を逐次保存する。フレーム処理の finally で、その時点までに実施済みの GET だけを1行に集約記録する。途中の保存障害で後続 GET を中止した場合も、未実施分を件数へ加えず、実施済みの結果を記録してから保存例外を返す。保存処理を HTTP の失敗件数に混ぜない。履歴書込み自体も失敗した場合は元の保存例外を失わず併記して呼出元へ返す。

## 7. 実装手順

設計承認後、統括が予定ブランチを準備し設計書をコミットする。製造は §10 の判断を反映した本書だけを仕様とする。

1. 時刻・正規化・窓・座標検証と合成 fixture を追加する。
2. B2 を壊さないマージ・タイル追記操作、実 DB の試験を追加する。
3. バイナリ取得・ファイル保存・失敗後始末を追加する。
4. product 独立処理、鮮度評価、要求キュー、履歴を統合する。
5. §8 の検証と全品質ゲートを行う。新テストは無意味なダミー改変で通る対照実験を先に記録し、対応する意味のある改変で失敗を確認して戻す。一時ファイル・改変は必ず除去する。

## 8. 受け入れ条件

単体・統合テストはネットワークを使わず fetch／clock を注入する。DB は実 migration 適用、一時 cacheRoot と共にテスト終了時削除。期待配列・URL・件数・DB 行は完全一致を使う。fixture は `tests/fixtures/jma/manifest.json` に synthetic／original、出典・作成または取得日時を記載する。

- [ ] `node --import tsx --test apps/api/tests/nowcastParser.test.ts`：順序を崩した N1、基準時刻が5分古い N2、hrpns 以外、完全重複を入力。自然キーと順序が期待配列に完全一致し、同一 validTime の別候補を失わない。
- [ ] 同テスト：now=`2026-09-07T03:00:00.000Z`、±60分の両端と各1秒外側を含める。両端のみ採用、外側除外。N2 の最遠が03:55なら04:00を追加しない。now を03:02:30に変え、5分丸めも N1 最新への移動も起きない。
- [ ] 同テスト：2月30日・時刻形式不正・elements 形式不正は product 全体の解析失敗。空配列と hrpns なしは成功の空一覧。
- [ ] `node --import tsx --test apps/api/tests/nowcastService.test.ts`：N1 成功／N2 失敗、その逆、両方初回失敗を別ケースで実行。正常側を返し、失敗側のみ unavailable。1回成功後に失敗させ、旧フレーム・最終成功・版が保持され stale。空一覧成功は available である。
- [ ] 同テスト：サービスを同じ DB で再生成して前回正常値を取得できる。clock を注入閾値の直前／ちょうどに進め `readCatalog` だけ実行し available／stale の境界が期待どおり。進んだ窓から外れたコマは返さない。
- [ ] 同テスト：一覧にない時刻、N2 の baseTime を N1 の最新で置換したキー、窓外、非 hrpns、不正 XYZ、未許可 zoom を要求し、fake fetch の URL 配列が空であることを確認。
- [ ] 同テスト：1フレーム3座標（うち重複1つ）を要求すると異なる2 URL だけ GET。同じ要求を再実行すると GET 追加なし。別フレーム・未要求座標は取得しない。
- [ ] 同テスト：制御可能な fetch Promise で同時要求と一覧更新を重ね、同じタイルの GET が1回、保存済み別座標が消えず、自然キー継続時に frame ID が保持され、消えたフレームへ tile 行が復活しないことを検証。
- [ ] 同テスト：stale の正常キャッシュは stale と実時刻付きで返り、stale のキャッシュミスは GET せず catalog_stale（§10 承認後）。キャッシュ画像と選択時刻が完全一致する。
- [ ] `node --import tsx --test apps/api/tests/nowcastTileStore.test.ts`：既知 PNG バイト列を取得し保存ファイルと完全一致、DB byteSize／hash も期待定数と一致。空・HTML・途中切断した PNG は保存されず invalid_png。
- [ ] 同テスト：一覧が available の場合、ファイル欠損・改変後のキャッシュ参照は再 GET。一覧が stale の場合は GET せず catalog_stale を返す。HTTP 404／500／timeout／network は対応した失敗。一時ファイルが残らず、別の正常タイルが保持される。write／rename／DB 保存の障害も注入し後始末を検証。途中の保存障害時にも、実施済み GET だけを finally で履歴1行へ集約し、未実施分を計上しないことを確認。
- [ ] 同テスト：一覧から消えたフレームの本体だけ削除され、参照中・stale 保持本体は残る。再生成時に孤児・一時ファイルが除去される。cacheRoot 外の sentinel は変更されない。
- [ ] サービス試験：同じフレームの2 GET 中1失敗は履歴1行、itemCount=2／failedItemCount=1／outcome=failure（§10 承認後）。完全キャッシュ・空要求は履歴0行。時刻一覧の正常空配列でも CHECK 制約に違反しない。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` を通す。`git diff --stat` で web／shared／既存 migration／HTTP エンドポイントに変更がないことを確認する。
- [ ] 主要テストの対照実験と red を記録する。少なくとも「窓フィルター無効」「baseTime を最新時刻で置換」「片側失敗で両側破棄」「PNG を text で保存」「一覧更新で継続フレームの tile を全削除」を意図的に行い、各テストが失敗することを確認して復元する。

## 9. 後続 Issue と残留リスク

- E7：HTTP URL・レスポンスの shared 型は別途設計。`readCatalog` の product 状態と欠損座標を保持し、全体 OK/NG に潰さない。外部へ DB のパスや数値 ID を公開しない。
- 地図・時間操作：必要 XYZ の計算、同じ対象時刻の候補選択、表示可能ズーム、再生時の一覧固定、枠外へ移動した選択コマの扱いを設計する。stale 画像の日時と未取得部分を明示し、降水なしと混同しない。
- C12：サービス作成時の DB／本体復元を利用する。C10 は復旧・起動時の外部取得を自動開始しない。
- C13／C14：product 別の鮮度閾値・取得周期・バックオフ・attemptNo を決める。readCatalog 時の stale 評価を無効化しない。C10 の時間窓はサーバー now で固定。
- 監視：`radar_times_N1`／`radar_times_N2` と `radar_tile` を区別する。キャッシュ容量上限、LRU、失敗率の期間・閾値は未実測で、本設計では導入しない。
- product 別キューは同じ側の遅い HTTP で後続要求を待たせる。初版の整合性優先の内部方式であり、測定後に並列化を検討する。N1 の遅延は N2 の処理を待たせない。
- stale 一覧が長く保持される場合、参照本体も保持される。厳密な最大ディスク量は保証しない。JSON 取得成功と提供データの更新停滞は別であり、発表基準時刻の停滞判定は未確定。
- 本設計の新規削除は専用キャッシュ内でプログラムが作った非参照画像の後始末のみ。既存プロジェクトファイルや他領域の削除を含まない。

## 10. 追加確認事項の承認結果

2026-09-12、ユーザーが以下3項目の提案を含む設計全体を承認した。本文中の「案」「承認後」は、この承認により採用済みとして扱う。比較用に記した代案は採用しない。

- 許可ズームを必須注入し、C10 の検収設定は `[10]` とする。
- 一覧が stale の場合は保存済み正常画像のみ利用し、キャッシュミス・破損・欠落時の新規 GET を抑止する。
- 部分失敗は通信履歴の `outcome=failure` とし、成功画像は利用・保存する。

承認時に提示した論点と比較は以下のとおり。

1. **ズームの入口を許可集合必須注入とし、C10 の受入検証は確認済み z=10 に限定してよいか。** 提案は `[10]` を承認時の検証用設定とし、地図側で必要なズームを実データで確認後に広げる方式。未確認の提供範囲を推測しない一方、地図接続まで全ズーム利用を約束しない。代案は C10 で全ズーム調査まで拡張する方式で、追加調査が必要。
2. **時刻一覧が stale のとき、保存済みの同一コマ画像だけ返し、キャッシュにない画像の新規取得は抑止してよいか。** 提案は §5 の catalog_stale。古い一覧に基づく新規 GET を防ぐ一方、片側時刻一覧障害中に画角を移動すると未取得部分が残る。代案は古い一覧に記載済みの候補で GET を試す方式で、回復前も画角を補える可能性があるが404等を増やし得る。
3. **フレーム内の一部タイルだけ失敗した場合、通信履歴の outcome を failure としてよいか。** B3 で Epic C へ委ねられた未確定事項。提案は §6 のとおり1件でも失敗なら failure とし、成功タイルは利用・保存する。欠けを監視で拾える一方、フレーム全滅と区別するため itemCount／failedItemCount の参照が必要。
