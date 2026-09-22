# Issue #202 キキクル大雨レイヤーの `rain_mesh` 正規化修正 設計

作成日: 2026-09-22  
対象 Issue: #202  
関連: #21、#46

## 1. 目的

気象庁の `risk/targetTimes.json` が大雨キキクルを上流 element `rain_mesh` として通知するのに対し、現行パーサーが `heavyrain` を検索しているため、大雨だけが正常な空一覧として保存される不具合を修正する。

取得境界で `rain_mesh` を既存の論理レイヤー `heavyrain`、画像識別子 `rain_mesh` へ正規化する。公開 API、DB、フロントエンドの論理レイヤー名 `heavyrain` は変更しない。

## 2. 参照資料と設計判断

| 参照 | 確認事実と本設計への反映 |
| --- | --- |
| Issue #202 の「やること」「対象外」「受け入れ条件」 | 上流 element の誤認だけを修正し、論理名、他レイヤー、UI、取得スケジュール、配信方式は維持する。実データ由来 fixture、パーサー回帰、サービスから時刻一覧 API までの結合、空 snapshot からの復旧を検証する |
| [Issue #46 設計](issue-46-kikikuru-layer-switching.md) §3.1 | 2026-09-15 に取得した実一覧 37 件の `elements` は全件 `land / inund / flood_mesh / rain_mesh / ...` であり、`heavyrain` はない。`member` は `immed0`、`immed1`、`immed2`、`none` が一覧値として存在する |
| [取得方法レポート](../data-acquisition-report.md) §4.1 | 大雨の内部レイヤー名は `heavyrain`、画像識別子は `rain_mesh`。実 URL の `/surf/rain_mesh/...png` を取得・デコード済み。ただし現行表は上流 element と内部名の列を分離しておらず、誤読を防ぐ改訂が必要 |
| `apps/api/src/polling/kikikuruParser.ts` | `SUPPORTED_ELEMENTS` が `{ element: 'heavyrain', layer: 'heavyrain', imageId: 'rain_mesh' }` であり、実一覧の `rain_mesh` を落としている。他2種は上流 element と論理名が同じため影響を受けない |
| `apps/api/tests/fixtures/jma/kikikuru/kikikuru_target_times_synthetic.json` と `kikikuruParser.test.ts` | 合成 fixture とテスト名・コメントも上流 element を `heavyrain` と誤記し、実装の誤りを追認している。入力を `rain_mesh` へ直し、`heavyrain` が入力にないことを明示的に検証する |
| `apps/api/src/polling/kikikuruService.ts` | 正常取得時はレイヤーごとに `saveRiskSnapshot` で最新一覧へ全面置換する。したがって保存済みの正常空 `heavyrain` snapshot も、次の正常更新で `rain_mesh` 由来フレームを持つ snapshot へ移行でき、migration や手動削除は不要 |
| `apps/api/src/services/kikikuruApiService.ts` | `getTimes()` はサービスの3レイヤーを既存 API DTO へ投影するだけである。サービス更新を通した結合テストにより、`GET /api/weather/kikikuru/times` までの回復を検証できる |
| `apps/api/tests/fixtures/jma/manifest.json` | fixture の由来を `kind`、`sourceUrl`、`sourceSha256`、`fixtureSha256`、`transform`、`retrievedAt`、`purpose` で管理する既存方式を踏襲する |

以上から、上流 element、アプリ内論理レイヤー、タイル URL の画像識別子は次の3概念として分ける。

| 表示種別 | 上流 `elements[]` | 内部・公開 API・DB の `layer` | 上流 URL の `imageId` |
| --- | --- | --- | --- |
| 大雨 | `rain_mesh` | `heavyrain` | `rain_mesh` |
| 浸水 | `inund` | `inund` | `inund` |
| 土砂 | `land` | `land` | `land` |

## 3. 対象範囲

### 3.1 実装すること

1. パーサーの大雨判定を上流 element `rain_mesh` に直し、出力は既存どおり `layer: 'heavyrain'`、`imageId: 'rain_mesh'` とする。
2. 実際の `targetTimes.json` から必要最小限の1行を加工した fixture を追加し、出典 URL、取得日時、取得原文 SHA-256、加工後 fixture SHA-256、加工内容を manifest に記録する。
3. 既存の合成 fixture、テスト名、コメントにある「上流 element が `heavyrain`」という前提を `rain_mesh` へ修正する。
4. パーサー単体テストに加え、`KikikuruService.refreshTimes()` から `GET /api/weather/kikikuru/times` までを通す結合テストを追加する。
5. 大雨タイル取得 URL が `/surf/rain_mesh/...png` で、`member` が入力一覧由来の値であることを完全一致で検証する。
6. 既に正常空として保存された大雨 snapshot が、次回の正常な一覧更新で自動復旧することを検証する。
7. 取得方法レポート §4.1 の対応表と本文で、上流 element、内部レイヤー名、画像識別子を区別する。

### 3.2 対象外

- 公開 API、DB、フロントエンドの論理レイヤー名 `heavyrain` の変更。
- 浸水、土砂、洪水の仕様変更。
- UI、取得周期、夜間停止、配信方式の変更。
- 洪水 PBF、GeoJSON の実装または追加検証。
- schema migration、保存済み snapshot の手動削除・一括補正。
- #21、#46 の設計書改訂。過去時点の設計記録は残し、本 Issue と取得方法レポートで訂正関係を明確にする。

## 4. モジュール構成と具体的な契約

### 4.1 変更対象

| ファイル | 変更内容 |
| --- | --- |
| `apps/api/src/polling/kikikuruParser.ts` | 大雨の取得境界マッピングを `rain_mesh -> heavyrain / rain_mesh` に修正 |
| `apps/api/tests/fixtures/jma/kikikuru/kikikuru_target_times_synthetic.json` | 大雨を含む行の `elements` を `heavyrain` から `rain_mesh` へ修正 |
| `apps/api/tests/fixtures/jma/kikikuru/kikikuru_target_times_rain_mesh_original_minimal.json` | 実データ由来の最小 fixture を追加 |
| `apps/api/tests/fixtures/jma/manifest.json` | 追加 fixture の由来・ハッシュ・加工内容を記録し、既存合成 fixture の説明も `rain_mesh` に合わせる |
| `apps/api/tests/kikikuruParser.test.ts` | 実データ由来 fixture の回帰、3レイヤー維持、テスト名・コメントを修正 |
| `apps/api/tests/kikikuruService.test.ts` | 正常空 snapshot から次回正常更新で大雨が復旧するサービステストを追加 |
| `apps/api/tests/kikikuruApi.test.ts` | 一覧更新から HTTP API、最新フレーム選択、タイル URL までの結合テストを追加 |
| `docs/data-acquisition-report.md` | 3種類の識別子を区別する表・説明へ改訂 |

既存テストの配置に合わせて同等の結合テストを一方へ集約できるが、パーサー単体、snapshot 復旧、HTTP API 投影の3境界はすべて検証する。プロダクションコードの変更は `kikikuruParser.ts` だけとし、API 型、repository、フロントは変更しない。

### 4.2 正規化シグネチャ

公開済み関数シグネチャは変更しない。

```ts
export function parseKikikuruTargetTimes(
  jsonText: string,
): ParseKikikuruTargetTimesResult;

interface LayerConfig {
  readonly element: string;
  readonly layer: KikikuruLayer;
  readonly imageId: string;
}

const SUPPORTED_ELEMENTS: readonly LayerConfig[] = [
  { element: 'rain_mesh', layer: 'heavyrain', imageId: 'rain_mesh' },
  { element: 'inund', layer: 'inund', imageId: 'inund' },
  { element: 'land', layer: 'land', imageId: 'land' },
];
```

入力行の `elements` に `rain_mesh` があれば、出力 `framesByLayer.heavyrain` に次のキーを生成する。

```ts
interface KikikuruFrameKey {
  readonly layer: 'heavyrain';
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: 'rain_mesh';
  readonly member: string;
}
```

`member`、`basetime`、`validtime` は入力行からそのまま正規化する。`heavyrain` を互換用の上流 element として併記してはならない。併記すると、誤った前提への回帰をテストで検知できず、実仕様との境界が再び曖昧になるためである。

### 4.3 fixture 契約

実データ由来最小 fixture は取得した原文を直接テストへ持ち込まず、`rain_mesh`、`inund`、`land` と一覧由来 `member` を含む代表1行だけを配列として残す。値を変更せず行の抽出だけを行う。manifest には次を記録する。

```json
{
  "path": "kikikuru/kikikuru_target_times_rain_mesh_original_minimal.json",
  "kind": "derived",
  "sourceUrl": "https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json",
  "sourceFileName": "targetTimes.json",
  "sourceSha256": "<取得原文全体のSHA-256>",
  "fixtureSha256": "<最小fixtureのSHA-256>",
  "transform": "取得原文から rain_mesh / inund / land を含む代表1行だけを値変更なしで抽出",
  "editor": "<作業担当>",
  "retrievedAt": "<実取得日時（ISO 8601）>",
  "purpose": "上流 element rain_mesh を内部 layer heavyrain へ正規化する回帰検証"
}
```

取得原文ハッシュと fixture ハッシュは、実際に取得・加工したバイト列から算出する。設計書の例示値で埋めない。fixture 本体を更新した場合は manifest のハッシュも同時に更新する。

### 4.4 サービス・API・タイル URL の流れ

```text
targetTimes.json elements=[rain_mesh,inund,land]
  -> parseKikikuruTargetTimes()
  -> framesByLayer.heavyrain[].imageId=rain_mesh
  -> KikikuruService.refreshTimes() が risk_snapshot(heavyrain) を全面置換
  -> GET /api/weather/kikikuru/times の layers.heavyrain.data.frames
  -> 選択した最新 frame の member/imageId をタイル要求へ渡す
  -> 上流 .../{basetime}/{member}/{validtime}/surf/rain_mesh/{z}/{x}/{y}.png
```

最新選択可能性は、API 応答の `layers.heavyrain.data.frames` が非空であり、既存フロントの選択規則が使う最大 `validTime` のフレームに `imageId: 'rain_mesh'` と一覧由来 `member` が残っていることで検証する。フロントコード自体は変更しない。

## 5. 状態遷移と復旧

現行サービスの成功更新は3レイヤーそれぞれを最新の解析結果で保存する。修正前に `heavyrain` が `available` かつ `frames: []` として保存されていても、次回の `refreshTimes()` が正常な `rain_mesh` 行を解析すれば、同じ `heavyrain` snapshot が非空フレームで置換される。

回帰テストでは、repository を直接最終状態へ作らず、次の順序を通す。

1. 空一覧の正常更新、または既存誤判定相当の入力で `heavyrain` の正常空 snapshot を保存する。
2. 実データ整合の `rain_mesh / inund / land` 一覧を返すよう fetch stub を切り替える。
3. 同じサービス／DB で次の `refreshTimes()` を実行する。
4. `heavyrain` が `available`、`lastSuccessAt` が今回時刻、frames が非空となり、`inund` と `land` も非空のままであることを完全一致で確認する。
5. HTTP API からも同じ非空フレームが返ることを確認する。

migration、起動時補正、手動キャッシュ削除は追加しない。HTTP・構造エラー時に前回値を `stale` として保持する既存仕様も変更しない。

## 6. テスト設計

### 6.1 パーサー単体

- 実データ由来最小 fixture の入力に文字列 `heavyrain` が含まれず、`elements` に `rain_mesh` が含まれることを前提アサーションで固定する。
- 出力は `framesByLayer.heavyrain` が1件以上、全件 `layer === 'heavyrain'` かつ `imageId === 'rain_mesh'` とする。
- 同じ入力から `inund` と `land` も各1件以上抽出され、既存動作を維持する。
- 合成 fixture の重複排除、順序、`sequence`、不正構造の既存検証を維持する。テスト名・コメントは上流 `rain_mesh` と内部 `heavyrain` を区別して書く。
- `SUPPORTED_ELEMENTS` の大雨判定を意図的に `heavyrain` へ戻すと、実データ由来 fixture のテストが失敗することを製造時に red 確認し、確認後は必ず修正状態へ戻す。

### 6.2 サービス/API 結合

fetch stub の `targetTimes.json` 応答には実データ整合 fixture を使い、PNG 応答には既存の検証済み最小 PNG を使う。

- `refreshTimes()` 後、サービスカタログの `heavyrain`、`inund`、`land` がすべて非空。
- `GET /api/weather/kikikuru/times?terminalId=hkeagh01&controlStatus=normal` が 200 / `status: 'ok'` を返し、3レイヤーが非空。
- 大雨の最新フレームを `validTime` 最大で選び、`layer === 'heavyrain'`、`imageId === 'rain_mesh'`、`member` が fixture の同じ行の値と一致する。
- そのフレームでタイル取得を行い、fetch stub が受けた上流 URLを完全一致で検証する。URL は `/surf/rain_mesh/10/...png` を含み、`/{member}/` は fixture の一覧値である。
- 正常空 snapshot からの2回目の更新で自動復旧する。

### 6.3 実上流スモーク検証

自動テストは外部ネットワークに依存させない。検収時に最新の上流一覧を1回取得し、その時点で実在する `rain_mesh` 行を選び、同じ `basetime`、`member`、`validtime` と許可ズーム10で PNG を取得する。

合格条件は HTTP 200、PNG 署名、256×256 としてデコード可能であること。全透明 PNG でも「取得成功」とし、危険度なしや安全とは判定しない。上流停止・通信不能時は実挙動未確認として検収不合格または再検証とし、fixture テストだけで代替合格にしない。

## 7. 受け入れ条件

- [ ] `apps/api/tests/fixtures/jma/kikikuru/kikikuru_target_times_rain_mesh_original_minimal.json` と manifest を照合し、入力に上流 element `rain_mesh` があり `heavyrain` がないこと、出典 URL・取得日時・原文 SHA-256・fixture SHA-256・加工内容が記録されていることを確認する。実ファイルを SHA-256 計算し manifest と一致すれば合格。
- [ ] パーサーテストを実行し、上記入力から `framesByLayer.heavyrain` が非空、各キーが `layer: 'heavyrain'` / `imageId: 'rain_mesh'`、`member` が入力値と一致すれば合格。
- [ ] 同じテストで `inund` と `land` が非空であり、各 `imageId` が同名のままなら合格。
- [ ] 既存合成 fixture、テスト名、コメントを検索し、上流 element を `heavyrain` と説明する残存記述がなく、内部名としての `heavyrain` だけが残っていれば合格。
- [ ] 実装の大雨 element 判定だけを一時的に `heavyrain` へ戻してパーサー回帰テストを実行し失敗することを確認する。修正状態へ戻して再実行し成功すれば合格。
- [ ] 正常空の `heavyrain` snapshot を作った後、同じDBで実データ整合一覧による次回更新を行うサービステストを実行し、`availability === 'available'`、`lastSuccessAt` 更新、frames 非空となれば合格。
- [ ] サービス更新から HTTP API までの結合テストを実行し、`GET /api/weather/kikikuru/times` が200で3レイヤー非空、大雨の最新フレームを選択できれば合格。
- [ ] 結合テストで大雨フレームのタイル取得を行い、fetch stub が受けたURLが一覧の `member` を含む `/surf/rain_mesh/10/{x}/{y}.png` と完全一致すれば合格。
- [ ] 検収時の最新 `targetTimes.json` から `rain_mesh` 行を選び、その行の `basetime/member/validtime` でズーム10のPNGを取得する。HTTP 200、PNG署名、256×256デコード成功なら、画像が全透明でも合格。
- [ ] [取得方法レポート](../data-acquisition-report.md) §4.1 が、大雨について「上流 element `rain_mesh`」「内部・公開名 `heavyrain`」「URL画像識別子 `rain_mesh`」を別列または同等に明記し、`heavyrain` が上流 element ではないと読めれば合格。
- [ ] `npm run test -w apps/api`、`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` がすべて終了コード0なら合格。

## 8. 後続 Issue への引き継ぎ

- #21 の表にある「時刻一覧の element = `heavyrain`」は本 Issue で判明した実データとの不整合である。今後の取得境界では本書の3概念表を正とし、過去設計の記述をコピーしない。
- #46 §3.1 の実測記録は今回の修正根拠であり、表示側の `kikikuru-heavyrain` と API の `heavyrain` は維持する。
- 新しいキキクル種別を追加する場合も、上流 element、内部論理名、URL画像識別子が同じとは仮定せず、実一覧と実タイルで対応を確認する。
- 保存済み正常空 snapshot は通常更新で復旧するため、運用手順としてDB削除を要求しない。復旧しない場合は、一覧取得の成否、fetch attempt、保存 snapshot の順に調査する。

## 9. 実挙動未確認事項

- 本設計時点では GitHub Issue ページおよび最新の気象庁上流へのネットワーク接続が利用できず、Issue本文は統括担当から渡された確定事項を用いた。最新上流 PNG の取得は実挙動未確認であり、§6.3・§7 の検収で確認する。
- 保存済み正常空 snapshot の自動復旧経路は実コード上の全面置換から確認したが、修正後コードでの実行結果は製造・検収前のため実挙動未確認である。

## 10. 要ヒアリング事項

なし。Issue本文の確定事項、#46 §3.1 の実測、実コードの不一致から実装方針は一意に定まる。
