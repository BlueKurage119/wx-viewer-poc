# Issue #13 設計書: 気象警報・注意報の現況構成

作成日: 2026-09-09

## 1. 目的と範囲

Issue #12（C2）が 1 電文単位で構造化した `VPWS50` と `VPWW55`〜`VPWW61` を、対象地域・電文の適用範囲・要素時刻に従って合成し、気象警報・注意報の現況を構成して `warning_current_snapshot` / `warning_current_item` に保存する。

`VPWS50` は全要素の初期化・復旧基準、`VPWW55`〜`VPWW61` は現象別の更新として扱う。単一の現象別電文に全現象が含まれるとは仮定しない。集約電文が受信順では後でも、より新しい個別更新を過去の状態へ巻き戻さない。既定対象は江東区（市町村等コード `1310800`、対象府県コード `130000`）とする。

この Issue には次を含む。

- 初回の有効な `VPWS50` による初期化と、保存済み受信履歴からの復旧
- `VPWW55`〜`VPWW61` の適用範囲ごとの積み上げ
- 重複、遅着、逆順受信、同版競合を含む版比較
- 新規、継続、強化、緩和、解除の差分計算
- 現況の永続化と、正常な発表なし・未初期化の区別
- 通常・訓練・試験の分離

次は対象外とする。

- 警報等コードから通知区分を決めること、通知生成・通知履歴への保存（Epic D）
- REST API と現況の UI 表示（Epic E、G3）
- 会場設定から対象地域を解決する機構。C3 は解決済み対象コードを受け取るだけとする
- `VPWP50`、指定河川洪水予報等、対象 8 電文以外の現況構成
- `availability` の取得失敗・鮮度低下による `stale` 遷移。C3 は正常に解析できた電文による内容更新だけを担う
- 一般の `InfoType=取消` による巻き戻しと、その通知。取消を現行の発表として適用しないことだけを保証し、復元規則は D4 等の別 Issue で扱う

## 2. 参照資料と判断根拠

- GitHub Issue #13「C3. 気象警報・注意報の現況構成ロジック（新規・継続・強化・緩和・解除の判定）」
- `docs/issues-draft.md` C3
- `docs/basic-design.md` §5.7、§6.1〜§6.3、§7.5、§7.6
- `docs/data-acquisition-report.md` §3.1、§3.2、§9
- `docs/design/issue-6-info-type-schema.md` §4.1（現況スナップショットの保存契約）
- `docs/design/issue-7-reception-history.md`（受信履歴は追記ログであり、現況は派生スナップショットであること）
- `docs/design/issue-12-warning-xml-parser.md`（C2 の型・構造検証・対象地域・再処理境界）
- 気象庁「気象警報・注意報（Ｒ０６）_解説資料」pp.2、8〜13、20〜24
- Issue #12 で照合済みの公式提供サンプル `15_16_03_241226_VPWW55.xml` 〜 `15_16_07_250825_VPWW61.xml`、`15_17_01_251222_VPWW55.xml`、`15_18_01_250630_VPWS50.xml`
- `/Users/yuta/claudeworks/cmk-gsx/docs/260812_高潮サンプル電文/` の実電文 2 件（高潮危険警報への強化と、その解除）。リポジトリへ原文を複製しない
- ユーザー共有の [高潮個別電文 VPWW57（香川県）](https://agora.ex.nii.ac.jp/cgi-bin/cps/report_xml.pl?id=20260812041022_0_VPWW57_370000) と [対応する集約電文 VPWS50](https://agora.ex.nii.ac.jp/cgi-bin/cps/report_xml.pl?id=20260812153057_0_VPWS50_010000)
- 実装済みの `apps/api/src/polling/jmaWarningTelegramParser.ts`、`jmaWarningTelegramProcessor.ts`、`jmaXmlPoller.ts`、`apps/api/src/repositories/warningCurrentRepository.ts`、`telegramReceptionRepository.ts`

公式 R06 解説資料では、現象別電文は対象府県予報区等について気象要素別に都度発表され、`VPWS50` は各気象要素の最新発表状況を一定時間ごとに集約する。市町村等の `Kind` は発表中の種別と当該電文で解除された種別をすべて含み、発表中・解除ともない場合は `発表警報・注意報はなし` を 1 件含む。`VPWS50` の `Kind/DateTime` はその要素の更新日時である。このため、現象別電文はその電文の適用範囲内では完全状態、`VPWS50` は全適用範囲の完全な基準状態として扱える。

共有された高潮実電文では、市町村等の `VPWW57` に `Code=48`（レベル 4 高潮危険警報）、`Status=発表`、`LastKind/Code=08` があり、同日の後続 `VPWW57` に `Code=48`、`Status=解除`、`LastKind/Code=48` がある。対応する `VPWS50` にも `Code=48`、`Status=解除`、`LastKind/Code=48` が確認できる。したがって `VPWW57` を除外せず、他現象と同じ市町村等・要素時刻・解除対象コードの規則で処理する。東京での発表実績が確認できないことを、将来も発表されない根拠にはしない。

`EventID` と `Serial` は対象の実電文で空になり得るため、両者を現況の一意キーまたは版順序に使わない。対象市町村だけでは現象別ストリームを区別できないため、§4 の地域別ストリームキーを追加する。

## 3. 設計原則

### 3.1 C2 を唯一の XML 解釈器とする

C3 は XML DOM を探索せず、必ず `parseWarningTelegram` を呼んで `ParsedWarningTelegram` を得る。`ParsedWarningKind` は `kindType` で絞り込む。

- `kindType === 'warning'`: `name`、`code`、`status`、`dateTime`、`lastKind`、`properties`、`addition` を参照できる
- `kindType === 'no_warning'`: 対象区域に発表中・解除対象がないことを示す正常入力。パース失敗、対象地域外、空配列と同一視しない

C3 の都合で XML を再探索したり、`Headline` の上位区域を江東区へ転用したりしない。保存済み受信履歴から復旧するときも、原文を `parseWarningTelegram` へ通す。

### 3.2 初期化前の個別更新を失わない

有効な `VPWS50` が 1 件もない間、`warning_current_snapshot` は作成しない。これは未初期化であり、明細 0 件の `availability='available'`（正常な発表なし）とは異なる。

ただし、初期化前に受け取った有効な `VPWW55`〜`VPWW61` は捨てない。§4 のストリームポインターへ最新版を保存する。後から `VPWS50` が届いたとき、基準時刻より新しい個別ストリームをその上に合成する。これにより、遅着した集約電文で初期化しても、先に受信した新しい個別更新を失わない。

### 3.3 現象別電文は適用範囲内の完全状態とする

各 `VPWW55`〜`VPWW61` は、対象市町村について、その電文が担当する現象群だけを置き換える。他の電文が担当する現象は保持する。担当範囲は次のとおりで、コードの数値大小や名称の部分一致では決めない。

| ストリーム | 現象キー | Kind コード |
| --- | --- | --- |
| `VPWW55` | `heavy_rain` | `10`, `03`, `43`, `33` |
| `VPWW56` | `landslide` | `29`, `09`, `49`, `39` |
| `VPWW57` | `storm_surge` | `19`, `08`, `48`, `38` |
| `VPWW58` | `snowstorm` | `13`, `02`, `32` |
| `VPWW58` | `storm` | `15`, `05`, `35` |
| `VPWW59` | `waves` | `16`, `07`, `37` |
| `VPWW60` | `heavy_snow` | `12`, `06`, `36` |
| `VPWW61` | コードごとの独立現象 | `14`, `17`, `20`, `21`, `22`, `23`, `24`, `25`, `26`, `27` |

`VPWW61` は複数 Kind を保持する。同一現象キーに発表中 Kind が複数ある、コードが表にない、または電文種別とコードの所属が矛盾する場合は `未対応コード` とし、その電文をストリームポインターへ採用しない。未知コードを近い数値、名称、低い段階へ割り当てない。

指定河川等に関するコード・電文はこの表へ追加しない。

### 3.4 有効時刻と版順序

時刻はすべて C2 が UTC 正規化した `UtcIso8601String` を使う。

- 個々の Kind の要素時刻: `kind.dateTime ?? telegram.reportDateTime`
- 現象別ストリームの版時刻: `telegram.reportDateTime`
- 同一ストリーム内の版比較: `reportDateTime`、次に `controlDateTime`

同じストリームキーへの入力は次の順で判定する。

1. `reportDateTime` が新しい入力を採用する。
2. `reportDateTime` が同じなら `controlDateTime` が新しい入力を採用する。
3. 両時刻と `contentHash` が同じなら重複として無変更にする。
4. 両時刻が同じで `contentHash` が異なる場合は同版競合とし、既存を保持する。受信順や SQLite の `id` で勝者を決めない。
5. 古い入力は遅着として無変更にする。

`EventID`、`Serial`、受信時刻、URL の辞書順は版比較に使わない。

`VPWS50` からストリームごとの基準時刻を作る。各 warning Kind はコード表で担当ストリームへ割り当て、その `kind.dateTime ?? reportDateTime` を使う。同一ストリームに複数 Kind があれば最大値を使う。`no_warning` はその `dateTime ?? reportDateTime` を全 7 ストリームの基準時刻とする。完全な `VPWS50` に当該ストリームの Kind が存在しない場合は `VPWS50.reportDateTime` を基準時刻とする。

現況を合成するとき、個別ストリームの `reportDateTime` が対応する集約基準時刻より新しい場合に限り、集約側の同ストリームを個別側の完全状態で置き換える。同時刻では集約と個別の内容が一致することを期待し、異なる場合は同版競合として現在のスナップショットを更新しない。この規則により、`Control/DateTime` だけが新しい集約電文で個別更新を上書きしない。

### 3.5 発表中・解除・発表なし

`ParsedIssuedWarningKind` は次の規則でストリームの発表中集合へ変換する。

- `Status` が `解除`: 発表中集合へ入れない。`kind.code` を解除対象とし、`lastKind.code` がある場合は同じ現象キーであることを検証する
- `Status` が `発表`、`継続`、`特別警報から危険警報`、`特別警報から警報`、`特別警報から注意報`、`危険警報から警報`、`危険警報から注意報`、`警報から注意報`: 発表中集合へ入れる
- 上記以外の Status: `未対応状態` とし、ストリームを更新しない

市町村単位の `kind.code === '00'` は、その現象別電文が担当する範囲の全解除として扱い、行として保存しない。`VPWS50` では `00` を全解除として使わない。集約電文の解除は `Status=解除` の `kind.code`（および整合確認用の `lastKind.code`）で対象現象を特定する。この 2 規則を共通の「解除コード」分岐へまとめない。

`no_warning` は、現象別電文ではそのストリーム全体を空にし、`VPWS50` では全ストリームを空にする。パース失敗・対象地域外・未対応コード・未対応状態は現況を空にしない。

共有された高潮例の `VPWS50` にある `Code=48`、`Status=解除`、`LastKind/Code=48` は、高潮だけを解除する入力であり、大雨等を削除しない。

### 3.6 差分種別

合成前後の発表中集合を `phenomenonKey` 単位で完全比較し、次の `WarningCurrentChangeType` を返す。差分は C3 の戻り値であり、本 Issue では通知を生成・保存しない。

| 前 | 後 | 差分種別 |
| --- | --- | --- |
| なし | あり | `new` |
| あり | なし | `released` |
| 同一コード | 同一コード | `continued`（Property 等だけの変更を含む） |
| 低い段階 | 高い段階 | `strengthened` |
| 高い段階 | 低い段階 | `weakened` |

段階比較はコードごとの明示表を使い、`注意報=1`、`警報=2`、`危険警報=3`、`特別警報=4` とする。`VPWW61` の独立注意報は 1。コードの整数値比較や名称比較はしない。前後コードが異なるのに同じ段階である場合、または `LastKind` が示す前状態と保存済み前状態が矛盾する場合は `conflict` とし、当該ストリームもスナップショットも更新しない。

> **Issue #26 による訂正注記**:
> 初版実装の明示コード表では注意報と特別警報のコード対応が逆転（`10` が特別警報、`33` が注意報など）していたため、公式コード表（気象庁「警報等情報要素コード管理表」）に基づき以下の正しい段階対応へ訂正された。
> 
> | 現象キー / 電文 | level 1 (注意報) | level 2 (警報) | level 3 (危険警報) | level 4 (特別警報) |
> | --- | --- | --- | --- | --- |
> | `heavy_rain` / VPWW55 | `10` 大雨注意報 | `03` 大雨警報 | `43` 大雨危険警報 | `33` 大雨特別警報 |
> | `landslide` / VPWW56 | `29` 土砂災害注意報 | `09` 土砂災害警報 | `49` 土砂災害危険警報 | `39` 土砂災害特別警報 |
> | `storm_surge` / VPWW57 | `19` 高潮注意報 | `08` 高潮警報 | `48` 高潮危険警報 | `38` 高潮特別警報 |
> | `snowstorm` / VPWW58 | `13` 風雪注意報 | `02` 暴風雪警報 | — | `32` 暴風雪特別警報 |
> | `storm` / VPWW58 | `15` 強風注意報 | `05` 暴風警報 | — | `35` 暴風特別警報 |
> | `waves` / VPWW59 | `16` 波浪注意報 | `07` 波浪警報 | — | `37` 波浪特別警報 |
> | `heavy_snow` / VPWW60 | `12` 大雪注意報 | `06` 大雪警報 | — | `36` 大雪特別警報 |
> | `VPWW61` 各現象 | `14`, `17`, `20`〜`27`（全10種） | — | — | — |

初回 `VPWS50` による構成は `origin: 'initial'`、初期化済み状態への更新は `origin: 'normal'` を付ける。初期構成で既に発表中の各現象も `new` として返す。D 系はこの結果から通知を生成できるが、C3 自身は抑制・通知区分判定をしない。

### 3.7 訓練・試験と InfoType

ストリームキーと現況スナップショットの両方に `controlStatus` を含め、`normal`、`training`、`test` を相互に上書きさせない。通常画面の読み出しは引き続き `normal` を明示する。

`InfoType=発表` と `InfoType=訂正` は同じ版比較・合成規則で処理し、原文値はスナップショットに保持する。`InfoType=取消` と未知値はストリームへ採用しない。取消された電文を発表中として有効化しない。取消によりどの過去版へ戻すかは、空の EventID / Serial を含む対象同定を別途設計する必要があるため本 Issue の対象外とする。

## 4. 地域別保存キーと DB 設計

### 4.1 ストリームポインター

新規 migration `0013_create_warning_current_stream.sql` で `warning_current_stream` を追加する。適用済みの `0001_create_warning_current.sql` は編集しない。

| 列 | 型・制約 | 内容 |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY` | |
| `prefecture_code` | `TEXT NOT NULL CHECK (<> '')` | 対象府県コード。既定 `130000` |
| `area_code` | `TEXT NOT NULL CHECK (<> '')` | 対象市町村等コード。既定 `1310800` |
| `control_status` | `TEXT NOT NULL CHECK (...)` | `normal` / `training` / `test` |
| `telegram_type` | `TEXT NOT NULL CHECK (...)` | `VPWW55`〜`VPWW61` / `VPWS50` |
| `reception_id` | `INTEGER NOT NULL` | 採用中の `telegram_reception.id`。履歴の独立性を保つため FK は張らない |
| `report_datetime` | `TEXT NOT NULL` | 版比較の第 1 キー |
| `control_datetime` | `TEXT NOT NULL` | 版比較の第 2 キー |
| `received_at` | `TEXT NOT NULL` | 取得時刻。版比較には使わない |
| `content_hash` | `TEXT NOT NULL CHECK (<> '')` | 重複・同版競合の判定 |
| 一意キー | `UNIQUE (prefecture_code, area_code, control_status, telegram_type)` | 地域別ストリームキー |

索引は一意キーが作る索引だけで足りる。`EventID` / `Serial` は列にもキーにも追加しない。`warning_current_snapshot` の `(area_code, control_status)` は最終的な市町村現況のキーとして維持し、ストリーム競合解決だけをこの新表へ分離する。

`warning_current_stream` は受信履歴ではなく再構成可能な派生ポインターである。自動 TTL、削除トリガーは設けない。起動時再構成では 8 ストリームを 1 トランザクションで置き換え、途中状態を公開しない。

### 4.2 最終スナップショットへの写像

合成後の発表中 Kind だけを既存 `WarningCurrentSnapshotInput.items` へ写像し、`saveWarningCurrentSnapshot` で一括置換する。

- `sequence`: `telegramType` の `VPWW55`〜`VPWW61` 順、同一ストリーム内は C2 の `sequence` 順に 1 から振り直す。UI の段階別固定順は G3 の責務
- `kindCode` / `kindName` / `kindStatus`: C2 原文値
- `lastKindCode` / `lastKindName`: C2 原文値
- `kindIssuedAt`: `kind.dateTime ?? source.reportDateTime`
- `sourceTelegram`: 実際に当該 Kind を供給した `VPWS50` または `VPWW55`〜`VPWW61`
- `significancyCode` / `significancyName` / `warningLevel` / `attentionText`: C3 の状態競合解決には使わない。本 Issue では既存値を推測せず `null` とする。C2 の `properties` / `addition` は再構成時に受信原文から再取得可能であり、表示用の具体的抽出規則は G3 で定義する

解除 Kind と `no_warning` は明細行へ保存しない。有効な `VPWS50` により全件発表なしと確認できた場合は、`availability='available'`、`items=[]` のスナップショットを保存する。初期化前はスナップショット行そのものが存在しない。

スナップショットメタ情報は次で固定する。

- `source`: `jma_xml_warning_current`
- `issuedAt` / `telegram.reportDateTime`: 合成に寄与したストリームの最大 `reportDateTime`
- `fetchedAt` / `lastSuccessAt`: 合成に寄与したストリームの最大 `receivedAt`
- `validAt` / `validFrom` / `validTo`: `null`
- `availability`: `available`
- `sourceVersion`: 寄与したストリームを `telegramType` 順に並べ、`telegramType:reportDateTime:controlDateTime:contentHash` を連結した文字列の SHA-256（小文字 16 進）
- `telegram.infoType`、`eventId`、`controlDateTime`: 最大 `reportDateTime` に寄与した電文の値。最大値が同じ場合は `telegramType` 順で後の電文を選ぶ。これは表示用メタ情報であり、版競合解決には使わない

`sourceVersion` が保存済みスナップショットと同じ場合は明細の削除・再挿入を行わず、重複適用を無変更として返す。

## 5. モジュール・型・内部 API

### 5.1 変更対象

```text
apps/api/
├── migrations/
│   └── 0013_create_warning_current_stream.sql       # 新規: 地域別ストリームポインター
├── src/
│   ├── polling/
│   │   ├── jmaWarningCurrentReducer.ts              # 新規: 純粋な適用範囲・版・差分計算
│   │   ├── jmaWarningCurrentProcessor.ts            # 新規: C2、ポインター、現況保存を1トランザクションで接続
│   │   ├── jmaWarningTelegramProcessor.ts           # 変更: 成功結果をC3 processorへ渡せる境界
│   │   ├── jmaXmlPoller.ts                          # 変更: 新規受信後にC3を実行
│   │   └── index.ts                                 # 変更: C3 APIを再export
│   ├── repositories/
│   │   ├── types.ts                                 # 変更: C3型を追加
│   │   ├── warningCurrentStreamRepository.ts        # 新規: ポインターCRUD
│   │   ├── warningCurrentRepository.ts              # 変更: sourceVersion同一時の無変更保存
│   │   ├── telegramReceptionRepository.ts           # 変更: 復旧対象一覧
│   │   └── index.ts                                 # 変更: repositoryを再export
│   └── server.ts                                    # 変更: C2再処理後、polling開始前にC3復旧
└── tests/
    ├── warningCurrentSchema.test.ts                 # 新規: migration・キー・制約
    ├── jmaWarningCurrentReducer.test.ts             # 新規: 純粋ロジック
    └── jmaWarningCurrentProcessor.test.ts           # 新規: DB統合・復旧・原子性
```

`apps/web`、REST API、既存 migration は変更しない。

### 5.2 型

```ts
export interface WarningCurrentTargetArea extends WarningTargetArea {
  readonly prefectureCode: string;
}

export type WarningPhenomenonKey =
  | 'heavy_rain'
  | 'landslide'
  | 'storm_surge'
  | 'snowstorm'
  | 'storm'
  | 'waves'
  | 'heavy_snow'
  | 'thunder'
  | 'snowmelt'
  | 'fog'
  | 'dry_air'
  | 'avalanche'
  | 'low_temperature'
  | 'frost'
  | 'icing'
  | 'snow_accumulation'
  | 'other_advisory';

export type WarningCurrentChangeType =
  | 'new'
  | 'continued'
  | 'strengthened'
  | 'weakened'
  | 'released';

export interface WarningCurrentChange {
  readonly phenomenonKey: WarningPhenomenonKey;
  readonly changeType: WarningCurrentChangeType;
  readonly before: WarningCurrentItemInput | null;
  readonly after: WarningCurrentItemInput | null;
}

export const INDIVIDUAL_WARNING_TELEGRAM_TYPES = [
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
] as const;

export type IndividualWarningTelegramType =
  (typeof INDIVIDUAL_WARNING_TELEGRAM_TYPES)[number];

export interface WarningCurrentReductionResult {
  readonly items: readonly WarningCurrentItemInput[];
  readonly contributingTelegramTypes: readonly WarningTelegramType[];
}

export type WarningCurrentApplyResult =
  | {
      readonly applied: true;
      readonly origin: 'initial' | 'normal';
      readonly snapshot: WarningCurrentSnapshot;
      readonly changes: readonly WarningCurrentChange[];
    }
  | {
      readonly applied: false;
      readonly reason:
        | 'uninitialized'
        | 'duplicate'
        | 'stale'
        | 'same_version_conflict'
        | 'unsupported_code'
        | 'unsupported_status'
        | 'cancelled';
      readonly detail: string;
    };
```

### 5.3 内部 API

```ts
export const DEFAULT_WARNING_CURRENT_TARGET_AREA: WarningCurrentTargetArea = {
  municipalCode: '1310800',
  displayName: '江東区',
  prefectureCode: '130000',
};

export function reduceWarningCurrent(
  aggregate: ParsedWarningTelegram,
  individuals: ReadonlyMap<IndividualWarningTelegramType, ParsedWarningTelegram>,
): WarningCurrentReductionResult;

export function diffWarningCurrent(
  before: readonly WarningCurrentItemInput[],
  after: readonly WarningCurrentItemInput[],
): readonly WarningCurrentChange[];

export function applyWarningCurrentReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  parsed: ParsedWarningTelegram,
  targetArea: WarningCurrentTargetArea,
): WarningCurrentApplyResult;

export function rebuildWarningCurrentFromReceptions(
  connection: DatabaseConnection,
  targetArea: WarningCurrentTargetArea,
): WarningCurrentApplyResult;
```

`reduceWarningCurrent` は DB と時計を参照しない純粋関数とする。`applyWarningCurrentReception` はストリームポインター更新、必要な最大 8 原文の C2 再解析、現況保存を 1 トランザクションで行う。途中で例外になれば、ポインターと最終スナップショットをともにロールバックする。

`WarningCurrentReductionResult.contributingTelegramTypes` は、最終明細を供給した電文と、空状態を供給した電文を重複なしで含む。processor はこれと `warning_current_stream` のメタ情報から §4.2 のスナップショットメタ情報を構成する。`diffWarningCurrent` は保存済みスナップショットの明細と reducer の出力を比較する。初期化前だけは before を空集合として `origin='initial'` を付ける。

`processWarningTelegramReception` は C2 の採用結果更新を維持し、`ok: true` のときだけ同じパース結果を C3 へ渡す。対象外・対象地域外・未対応構造は C3 を呼ばない。C3 の `uninitialized` / `stale` / `duplicate` は C2 の解析成功を取り消さない。

## 6. 処理フロー

### 6.1 新規受信

```text
C1: 原文を telegram_reception へ追記
  └─ C2: parseWarningTelegram
       ├─ 失敗: 受信履歴に採用結果を記録し終了（現況不変）
       └─ 成功: ParsedWarningTelegram を C3 へ渡す
            ├─ InfoType、コード、Status、ストリーム版を検証
            ├─ warning_current_stream を更新または無変更
            ├─ VPWS50 ポインターなし: snapshot を作らず uninitialized
            └─ VPWS50 ポインターあり
                 ├─ 最大8原文を C2 で再解析
                 ├─ VPWS50 を基準に、より新しい個別ストリームを合成
                 ├─ 前後差分を計算
                 └─ sourceVersionが変わる場合だけ snapshot/items を原子的に保存
```

### 6.2 起動時復旧

DB migration 完了後、C1 のポーリング開始前に次を直列実行する。

1. Issue #12 の `reprocessPendingWarningTelegramReceptions` を完了する。
2. 対象 8 電文かつ原文ありの受信履歴を、C2 の採用結果にかかわらず `report_datetime ASC, control_datetime ASC, id ASC` の 100 件 keyset pagination で読む。対象地域を替えた場合に、過去の `対象地域外` 判定で復旧候補を失わないためである。
3. 各原文を C2 で再検証し、地域別ストリームごとに最新ポインターを選ぶ。同版異内容は競合として復旧を失敗させ、受信順で選ばない。
4. 新しいポインター集合と最終スナップショットを 1 トランザクションで保存する。
5. 有効な `VPWS50` がなければスナップショットを作成せず、未初期化のままポーリングを開始する。

復旧は HTTP GET、`fetch_attempt` / `telegram_reception` の追加、通知生成を行わない。同じ履歴から何度実行しても同じ `sourceVersion` と明細を得る。

## 7. テスト設計

### 7.1 テストの有効性確認

新規テストごとに次を行う。

1. 意味を変えないダミー変更でテストが生存する対照実験を行う。
2. 実装を意図的に壊し、対象テストが失敗する red を確認する。
3. 復元後に対象 workspace テストを通す。

版比較の `>` を `>=` にする、`VPWW57` をコード表から外す、`00` と集約解除を同じ分岐にする、`kind.dateTime` の代わりに常に `controlDateTime` を使う、といった各ミューテーションで対応テストが失敗することを確認する。

### 7.2 純粋 reducer

- 初回 `VPWS50` の発表中 Kind が現況になり、すべて `origin='initial'` / `new` になる
- `no_warning` の `VPWS50` が `items=[]` の正常状態になる
- `VPWW55` の更新が大雨だけを置き換え、`VPWW56`、`VPWW57`、`VPWW61` の現況を保持する
- `VPWW61` の複数 Kind をすべて保持し、同ストリームの no-warning でだけすべて解除する
- `Code=00` の個別解除がそのストリームだけを空にする
- `VPWS50` の `Status=解除` が `kind.code` / `lastKind.code` の対象現象だけを解除し、`00` の全解除分岐へ入らない
- `Code=08` から `48` を `strengthened`、`48` から `08` を `weakened`、同一コードを `continued` とする
- 未知コード・未知 Status・同一現象の複数発表中 Kind・矛盾する LastKind は現況を更新しない
- ローカル高潮サンプルは参照資料として読み取りにだけ使い、テストリポジトリへコピーしない。テストでは対象市町村等 Item の `Code`、`Status`、`LastKind`、`DateTime` だけを持つ最小 XML fixture を組み立てる

### 7.3 版競合と初期化

- 個別更新が初期 `VPWS50` より先に届いてもポインターへ保持され、後着 `VPWS50` の該当要素時刻より個別 `reportDateTime` が新しければ個別が現況になる
- 新しい個別更新の後に、古い `Kind/DateTime` を持つ `VPWS50` が届いても巻き戻らない
- 個別更新より新しい要素時刻を持つ `VPWS50` は現況を更新できる
- `Control/DateTime` だけが新しい集約では巻き戻らない
- 同じ時刻・同じ hash は duplicate、同じ時刻・異なる hash は same-version conflict になり、後着順で勝者が変わらない
- `VPWS50` がないとスナップショット行はなく、個別ポインターだけが残る
- `VPWS50` の正常な発表なしでは `available` かつ明細 0 件になり、未初期化と区別できる

### 7.4 DB・統合

- 一意キーが `(prefecture_code, area_code, control_status, telegram_type)` で、空 EventID / Serial の異なる地域・電文種別が衝突しない
- `normal` / `training` / `test` のポインターとスナップショットが分離される
- C2 の失敗、対象地域外、取消、未知コード、未知 Status で既存現況が完全一致のまま残る
- ポインター保存後に現況保存を故意に失敗させると両方がロールバックされる
- 同じ履歴からの復旧を 2 回行って DB 内容と `sourceVersion` が完全一致する
- 復旧は受信履歴・取得履歴・通知履歴の件数を増やさない

## 8. 受け入れ条件

検収担当は次を上から順に実行する。

1. `npm run build`、`npm run typecheck`、`npm run lint`、`npm run format:check` がすべて成功する。
2. `npm run test -w apps/api` が全件成功する。
3. `apps/api/migrations/0013_create_warning_current_stream.sql` が存在し、既存 migration に差分がなく、`warning_current_stream` に §4.1 の列・CHECK・一意キーが存在する。
4. 初期 DB で個別 `VPWW55` だけを処理しても `warning_current_snapshot` は 0 件で、個別ストリームポインターは 1 件になる。
5. その後に古い要素時刻の `VPWS50` を処理すると初期化され、個別の新しい大雨状態を保持した現況になる。
6. `VPWS50` の大雨・高潮・雷の 3 現象を初期化後、`VPWW55` の no-warning または `Code=00` 解除を処理すると大雨だけが消え、高潮・雷は完全一致で残る。
7. 共有された構造を再現した `VPWW57`（`Code=48`, `LastKind=08`）で高潮が強化され、対応 `VPWS50`（`Code=48`, `Status=解除`, `LastKind=48`）で高潮だけが解除される。
8. 新しい個別高潮更新の後に、それより古い `Kind/DateTime` の `VPWS50` を受けても `warning_current_snapshot` と `sourceVersion` が変わらない。
9. `VPWW61` の雷・濃霧等の複数 Kind を処理すると全件が残り、その後の `VPWW61` 更新でも他ストリームの明細が消えない。
10. 同じ `reportDateTime` / `controlDateTime` / hash の再処理は duplicate で DB を書き換えず、同時刻・異なる hash は conflict で既存現況を保持する。
11. `normal` の初期化後に同内容の `training` / `test` を処理しても、`findWarningCurrentSnapshot(..., 'normal')` が完全一致で変わらない。
12. パース失敗、対象地域外、未知コード、未知 Status、`InfoType=取消` を順に処理しても正常現況が空に縮退しない。
13. `VPWS50` の正常な no-warning は `availability='available'` / 明細 0 件、`VPWS50` 未取得はスナップショット不在として区別される。
14. 保存済み受信履歴だけから復旧し、ライブ処理前と同じポインター、スナップショット、明細、`sourceVersion` を完全一致で再構成できる。
15. 受信順を逆にした fixture でも最終状態が同じであり、復旧中の HTTP 呼出しと履歴追記が 0 件である。
16. `git status --porcelain` に、設計書で列挙した実装・テストファイル以外の変更が含まれない。

## 9. 後続 Issue への引き継ぎ

- **D2〜D4**: `WarningCurrentChange` と `origin` を入力に通知区分・通知生成を行う。C3 の `sourceVersion` を重複防止材料に使える。C3 のコード段階表は相対的な強化・緩和判定用であり、通知区分表の代用にはしない。
- **C12**: 長期フィードによる取得とプロセス起動単位の「初期取得済み」管理を接続する。C3 の DB 復旧は通知を生成しない。C12 / D4 が起動単位の再評価契機を渡す。
- **E1 / G3**: 通常 API は `controlStatus='normal'` を明示する。未初期化（スナップショット不在）、正常な発表なし（available・明細 0）、取得失敗 / stale を別表示にする。`Property` / `Addition` から表示補足を作る規則は G3 で実データと照合して定義する。
- **会場設定**: 将来の会場設定は `municipalCode`、`displayName`、`prefectureCode` を解決して C3 へ渡す。H/K 端末モードは気象状態キーに含めない。
- **取消**: 空の EventID / Serial の電文を含む取消対象同定と、取消前状態への復元規則を別 Issue で設計する。
- **河川情報**: `VXKOii` / `VXSUii` 等はこの現象コード表へ混入させず、対象地域との対応を確認して別の取得・現況設計を行う。

## 10. 未確認事項

- 東京を対象とする `VPWW57` の実発表は確認できていない。ただし香川県の `VPWW57` / `VPWS50` で、市町村等の強化・解除構造と高潮コードを確認できたため、C3 の状態遷移設計を左右する未確認事項ではない。
- 高潮予報区間の専用 `Warning[@type="気象警報・注意報（高潮予報区間）"]` と `AdditionalInfo` は、C2 が採用する市町村等 Warning とは別構造であり、本 Issue では保存・表示しない。江東区現況の警報種別は市町村等 Warning から構成できる。
- 一般の `InfoType=取消` の復元先は未確認であり、§1・§3.7 のとおり対象外とする。

上記はいずれも本 Issue の製造開始を妨げる追加ヒアリング事項ではない。
