# Issue #12 設計書: XML電文の種別判定・パース（VPWW55–61 / VPWS50）

作成日: 2026-09-09

改訂日: 2026-09-09（公式提供サンプルを用いた第 2 回検収結果を反映）

## 1. 目的と範囲

気象庁 PULL 型 XML 電文として C1 が受信・原文保存した、警報・注意報の現況電文を、名前空間を検証しながら種別判定・構造化する。対象は `VPWW55`、`VPWW56`、`VPWW57`、`VPWW58`、`VPWW59`、`VPWW60`、`VPWW61` と全国集約の `VPWS50` である。今回の既定対象区域は江東区（市町村等コード `1310800`）であり、東京都や東京地方の `Headline` を江東区の現況として代用しない。

この Issue で得るのは「1 電文から読み取れた江東区向け Kind の正規化結果」である。`Control/Status` の通常・訓練・試験を保持し、`Body/Warning` の対象種別を選んだうえで、`Item/Area/Code=1310800` に属するすべての `Kind` について、`Name`、`Code`、`Status`、`LastKind`、出現順を保った全 `Property`、`Addition`、`Kind/DateTime` を失わずに取得する。`Status` と任意の `DateTime` で表される公式な「発表警報・注意報はなし」も、正常な Kind として明示表現する。

次は対象外とする。

- 個別・集約電文を積み上げて現況を作ること、新規・継続・強化・緩和・解除の状態遷移、集約電文による完全スナップショット判定（C3）
- 警報等コードから通知区分を決めること（D2）と、通知生成（D3 以降）
- 警報等時系列（VPWP50）や早期注意情報など他電文の構造化（C4 以降）
- REST API、画面、availability の更新、既存 migration・現況スナップショットの書込み
- 会場別の地域・地点・地図・広域予報・速報を一括して解決する設定機構（後続設計）

## 2. 参照資料と判断根拠

- Issue #12「C2. XML電文の種別判定・パース（VPWW55-61: 警報・注意報）」
- `docs/issues-draft.md` C2（ドラフトでは VPWW54 系とあるが、Issue 本文・取得方法レポートで確認済みの対象である VPWW55–61 / VPWS50 を正とする）
- `docs/basic-design.md` §5.7、§7.4
- `docs/data-acquisition-report.md` §3.1、§3.2、§9
- `docs/design/issue-11-xml-feed-polling.md`（C1 の受信・共通エンベロープ検証・採用結果更新の境界）
- `docs/design/issue-6-info-type-schema.md` §4.1（将来の現況スナップショット項目の意味）
- Issue #2 コメント「気象取得・地図・情報パネル」への申し送り（会場別設定への拡張）
- `/Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples/` の公式提供サンプル（`15_16_03_241226_VPWW55.xml`、`15_16_01_241031_VPWW56.xml`、`15_16_02_251222_VPWW57.xml`、`15_16_04_251222_VPWW58.xml`、`15_16_05_241226_VPWW59.xml`、`15_16_06_241226_VPWW60.xml`、`15_16_07_250825_VPWW61.xml`、`15_18_01_250630_VPWS50.xml`）
- 実装済みの `apps/api/src/polling/jmaXmlFeedParser.ts`、`jmaXmlPoller.ts`、`apps/api/src/repositories/telegramReceptionRepository.ts`、`apps/api/src/repositories/types.ts`、`warningCurrentRepository.ts`

取得方法レポートで、現象別電文と集約電文の対象現象、`Body/Warning` の型選択、市町村等 `Item`、`Kind` の保持対象が確認済みである。また、`Kind/Code` と `Significancy/Code` は別辞書であり、コードの数値大小や名称の部分一致から段階・通知区分を推測してはならない。D2 が §7.4 の確定済み対応表を使って通知区分を担うため、C2 はコードを文字列のまま保持し、分類しない。

C1 は `@xmldom/xmldom` により、ルート、`Control`、`Head` の名前空間を検証して原文を `telegram_reception` に保存する。C2 はこの共通検証を緩めず、`Body` とその子孫をローカル名だけで探索しない。異なる名前空間の同名要素を業務データとして誤採用しないことを優先する。

既存の `warning_current_snapshot` / `warning_current_item` は C3 の現況結果の保存先である。特に `warning_current_item.attention_text` は `Property` / `Addition` 由来の表示補足を置く予定の単一 TEXT 列であり、構造を失わずに取り出す本 Issue の出力先ではない。

Issue #2 の協議では、同一会場の H/K 端末が気象対象を共有し、既存の江東区・江戸川臨海固定を会場別設定へ拡張することが申し送られた。TRC 会場の警報対象は大田区、最寄りアメダスは羽田空港である。ただし地域・地点コード、羽田で取得できる要素、広域予報・速報の対象判定は後続設計で確認する事項である。C2 は警報の市町村等コードだけを注入可能にし、未確認の他の取得対象を推測して設定化しない。

初回検収で公式提供サンプルと実装を再照合した結果、既存実装の `parseKind` は `Property` を最大 1 件としていたが、VPWW61 には同一 Kind 内に 2 件ある。また `Name`・`Code` を全 Kind で必須にしていたが、VPWS50 には `Status` だけの正常 Kind がある。日時の既存実装は `new Date(raw)` の成否だけを見ており、日付だけの文字列も受け入れていた。第 2 回検収では、同じ VPWS50 に `Status` と `DateTime` を持つ正常な no-warning Kind も確認した。これらは実データで通常到達する設計不一致として、本改訂で型、分岐、エラー分類、テスト、受け入れ条件を揃えて修正対象とする。

## 3. 設計判断

### 3.1 対象地域の注入境界

パーサーは、固定の `1310800` ではなく、呼出元から `WarningTargetArea` を受け取る。今回の実運用接続で渡す既定値は `{ municipalCode: '1310800', displayName: '江東区' }` とする。`municipalCode` は市町村等コードとして完全一致で比較し、表示名は XML の名称との照合・表示補助にのみ使う。コードが一致しても名称が異なる場合に採用を止めるかは、公式コード表と代表電文の照合結果を待つため、現段階では原文名を保持して統括確認事項とする。

この注入は、C2 が会場別設定全体を持つことを意味しない。端末 URL と会場の対応、H/K モードとの分離、地域コードの選択元、アメダス地点、地図基準位置、東京地方等の広域予報、速報の対象地域は本 Issue では解決しない。後続の会場設定設計が会場ごとの `WarningTargetArea` を解決し、C2 にはその結果だけを渡す。これにより、TRC 用の大田区コードが確定した後も XML 解釈器の改修を不要にする。

### 3.2 採用対象とエラーの扱い

受信履歴の `telegramType` が上記 8 種のいずれでもない電文は、C2 の対象外として採用しない。URL から得た種別は C1 の候補値であるため、C2 は XML のルート、`Control`、`Head`、`Body`、選択した `Warning` の名前空間・必須構造も検証して初めて採用する。種別候補だけ、Atom の title だけ、`Head/Title` の文字列部分一致だけでは採用しない。

`Control/Status` は `通常` / `訓練` / `試験` を既存の `ControlStatus`（`normal` / `training` / `test`）に変換して結果へそのまま伝播する。通常を既定値にせず、C1 の保存値とパース結果が食い違う場合は採用しない。訓練・試験を通常へ混入させず、C3・D 系が `isTraining` 等を一貫して判断できる入力にする。

構造不正、必須名前空間の不一致、対象 `Warning` 不在、対象 `Item` 不在、通常 Kind の必須 `Name`・`Code`・`Status` の欠損、または日付形式不正は「正常な発表なし」や空の Kind 配列に変換しない。受信原文は C1 が残したまま、`updateTelegramReceptionAdoption` で採用不可の理由を記録する。注入した対象地域に該当する `Item` が存在しないことだけは、構造が有効な対象電文である事実と区別して「対象地域外」とする。この場合も C3 の現況を空に更新しない。

ただし、直下に `Status` をちょうど 1 件持ち、その値が完全一致で `発表警報・注意報はなし` の Kind は、公式提供サンプルの VPWS50 に存在する正常 Kind として受け入れる。`DateTime` は 0 件または 1 件を許し、存在時は通常 Kind と同じ厳密な ISO 8601 検証と UTC 正規化を行う。この Kind は構造不正でも対象地域外でもなく、空の `kinds` 配列にも変換しない。後述の `kindType: 'no_warning'` と `sequence`、`status`、`dateTime` を持つ 1 件の結果として、存在した Kind 自体を明示する。`DateTime` 不在は `dateTime: null` とするが、存在しない通常 Kind の `Name`・`Code`・`LastKind`・`Property`・`Addition` は補わない。

公式 VPWS50 で確認した no-warning Kind は、一次細分区域等・市町村等をまとめた地域等では `Status` のみ、市町村等では `Status` と `<DateTime type="発表時刻">…</DateTime>` の順の形態である。いずれも Kind 自体と Status に属性はなく、`Status`・`DateTime` 以外の直下子要素もない。ユーザー承認により、C2 の no-warning 型は地域階層による形態差を吸収して DateTime を任意とし、この 2 形態だけを受理する。DateTime がある場合は `type="発表時刻"` を完全一致で検証するが、全実例で同値のため出力に別フィールドとして重複保持せず、意味を正規化した `dateTime` を保持する。Kind 自体または Status の属性、DateTime の他属性、`Status`・`DateTime` 以外の直下子要素、順序違反、重複要素がある場合は、未確認の意味を推測したり黙って捨てたりせず `未対応構造` とする。`Status` がこの値以外なら通常 Kind として `Name` と `Code` を必須にし、Status だけの Kind を許容しない。

### 3.3 名前空間と要素探索

パーサーは次を明示定数として使い、親子関係ごとに「直下の要素」「期待する namespace URI」「localName」を同時に照合するヘルパーに閉じ込める。

- Report / Control: `http://xml.kishou.go.jp/jmaxml1/`
- Head: `http://xml.kishou.go.jp/jmaxml1/informationBasis1/`
- Body の警報要素: `http://xml.kishou.go.jp/jmaxml1/body/meteorology1/`

既存の C1 共通パーサーにある、全子孫を localName だけで探索する `Area` 抽出は C2 の業務判定に再利用しない。C2 は選択済み `Body/Warning` 配下の `Item`、その直下の `Area/Code` を参照する。これにより `Headline` や他用途の `Area`、異なる namespace の偽要素を江東区の警報として採用しない。

公式提供サンプル 8 種を照合した結果、C2 が選択する `Warning/@type` は VPWW55–61 / VPWS50 のすべてで完全一致の `気象警報・注意報（市町村等）` であり、各代表 XML に 1 件ずつ存在する。これを電文種別ごとの定数表に明記する。型対応表にない値、同一電文内で型に一致する `Warning` が 0 件または複数件の場合は、暗黙に先頭を採らず `未対応構造` とする。

### 3.4 Kind の保持形式

`Kind` は対象地域の `Item` ごとに出現順を維持し、同一 `Kind/Code` を C2 で統合・解除・並べ替えしない。`VPWW61` の複数 Kind を 1 件へ縮退させない。後続の C3 が電文種別、対象要素時刻、状態、コードを使って正しく現況を構成する。

`LastKind` と `Addition` は任意である。存在しないものは `null` とし、空文字・空要素を意味のある値へ置換しない。`Property` は 0 件以上あり得るため、各 `Kind` の直下に出現した全要素を XML 順の `properties: readonly XmlFragment[]` として保持する。先頭だけを採る、`Type` で上書きする、表示用の 1 文へ連結することはしない。公式提供サンプルの VPWW61 には、同じ濃霧注意報 Kind に `濃霧危険度` と `濃霧` の 2 個の `Property` がこの順で入る実例がある。`Property` と `Addition` は属性を含む XML 断片を原文どおり保持する `XmlFragment` として出力し、C3 が現況の `attentionText` を導出するとき、または後続の詳細表示が必要になったときに、情報を失わず再解釈できるようにする。

コードは先頭ゼロを含む文字列とする。`00` の解除と上位集約の解除対象種別コードの解釈は C3 の責務であり、C2 は `Kind` と `LastKind` の原文値を返すだけとする。

`Control/DateTime`、`Head/ReportDateTime`、`Head/TargetDateTime`、`Kind/DateTime` を読むときは、日付だけを許さない厳密な ISO 8601 検証を使う。この Issue で受け入れる字句形式は `YYYY-MM-DDTHH:mm:ss(.秒小数)?(Z|±HH:MM)` とし、年・月・日、`T`、時・分・秒、任意の秒小数部、タイムゾーンをすべて必須の順序で検証する。字句形式の照合後に、うるう年を含む暦日、時分秒、UTC オフセットが有効であることを構成要素ごとに検証し、その後で UTC の `UtcIso8601String` に正規化する。`new Date(raw)` の成否だけを字句検証には使わない。日付のみ（例: `2026-09-09`）、タイムゾーンなし、時刻なし、不正な暦日・時刻・オフセットは `未対応構造` とする。

公式提供サンプルの VPWW55・VPWW61 は `2020-06-22T14:00:00Z`、VPWS50 は `2019-10-12T00:02:45Z` を `Control/DateTime` に持ち、`ReportDateTime` / `TargetDateTime` と `Kind/DateTime` には `+09:00` の実例がある。`Kind/DateTime` 自体は任意なので、不在は正常であるが、存在する値には同じ厳密検証を適用する。必須日時の欠損と、任意日時の不正値はいずれも要素パスを理由に含む `未対応構造` とし、対象地域外や正常な発表なしへ変換しない。

### 3.5 C1 との接続と履歴の採用結果

`recordTelegramReception` の成功後、C1 の個別電文処理から C2 のハンドラを 1 回呼ぶ。ハンドラは保存済みの `TelegramReception`（原文を含む）を入力にして解析し、`updateTelegramReceptionAdoption` で結果と理由・判定時刻を記録する。HTTP 取得、URL 重複抑止、受信履歴の追記、fetch attempt の記録は C1 のままとし、C2 の失敗を電文 HTTP 失敗へ読み替えない。

採用済みの構造化結果はこの段階で現況表へ保存しない。C3 が同じ純粋関数を利用して、受信順に依存せず原文から再解析し、電文種別・要素時刻を比較して現況を更新する。C2 はユニットテスト可能な純粋パーサーと、履歴の採用結果を更新する薄いハンドラを提供する。

### 3.6 既受信原文の一度だけの再解析

C2 を初めて有効にしたアプリケーション起動時は、DB migration 完了後かつ C1 の `JmaXmlPollingService.start()` より前に、既受信の対象原文を再解析する。HTTP GET、Atom フィード取得、`fetch_attempt` の追加を行わず、DB 内の原文だけを読む。通常ポーリング開始前に完了させるため、既受信行と新規受信行が同時に processor へ入ることはない。

再処理対象は `telegram_type IN ('VPWW55', ..., 'VPWW61', 'VPWS50')` かつ `adoption_decided_at IS NULL` の行すべてである。`raw_body` が NULL の行も除外せず、processor が `未対応構造` として判定時刻を記録する。C1 が既に `adoption_result='未対応形式'` を入れていても `adoption_decided_at` が NULL なら、C2 の種別固有検証で一度だけ再評価する。逆に、`adoption_decided_at` が非 NULL の行は、成功・対象外・構造不正を問わず既に C2 または運用者が判定済みとして再処理しない。

対象行は `received_at ASC, id ASC` の安定順で、100 件ずつ keyset pagination により取得する。次ページの基準は直前に取得した行の `(received_at, id)` とし、処理中に `adoption_decided_at` を更新しても順序・対象集合が揺れないようにする。各行の `updateTelegramReceptionAdoption` は 1 トランザクションで完了させる。途中でプロセスが停止した場合、判定時刻を書けた行は次回対象外となり、未更新行だけが次回起動で続行される。この at-least-once の再開は、processor が現況・通知・HTTP 履歴を変更しないため冪等である。

再処理は C2 導入時の未判定行を解消する互換処理であり、判定済み行を強制的に再解析する管理 API や、起動ごとの全件走査にはしない。将来、パーサー仕様を更新して意図的な再判定が必要になった場合は、対象バージョン・監査記録・C3 への影響を別 Issue で設計する。

## 4. モジュール・型・内部 API

### 4.1 変更対象

```text
apps/api/src/
├── polling/
│   ├── jmaWarningTelegramParser.ts      # 変更: 純粋な種別判定・名前空間付き構文解析
│   ├── jmaWarningTelegramProcessor.ts   # 既存: 受信履歴の採用結果を更新
│   └── jmaXmlPoller.ts                  # 保存成功後に processor を接続
└── repositories/
    ├── telegramReceptionRepository.ts   # 未判定対象電文の keyset 取得
    └── types.ts                          # C2 の公開入力・出力型を export
apps/api/src/server.ts                   # 再解析完了後に C1 ポーリングを開始
apps/api/tests/
└── jmaWarningTelegramParser.test.ts     # 変更
```

既存 migration、`warningCurrentRepository`、REST route、`apps/web`、`packages/shared` は変更しない。既存 `jmaXmlFeedParser.ts` は C1 の共通エンベロープ検証専用として保ち、Body 固有の探索を混在させない。

### 4.2 型

実装で次のような API を提供する。`telegramType` と Control / Head の値は C1 が保存したものとの整合検証にも使う。

```ts
export const WARNING_TELEGRAM_TYPES = [
  'VPWW55', 'VPWW56', 'VPWW57', 'VPWW58',
  'VPWW59', 'VPWW60', 'VPWW61', 'VPWS50',
] as const;

export type WarningTelegramType = (typeof WARNING_TELEGRAM_TYPES)[number];

export interface WarningTargetArea {
  /** 市町村等コード。前方一致・部分一致を許さない。 */
  readonly municipalCode: string;
  /** 会場設定が解決した表示名。XML の原文名は別途保持する。 */
  readonly displayName: string;
}

export interface XmlAttribute {
  readonly namespaceUri: string | null;
  readonly localName: string;
  readonly value: string;
}

export interface XmlFragment {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly attributes: readonly XmlAttribute[];
  readonly text: string | null;
  readonly children: readonly XmlFragment[];
}

export interface ParsedWarningKindBase {
  readonly sequence: number;
  readonly status: string;
  readonly dateTime: UtcIso8601String | null;
}

/** `Status` と任意の `DateTime` で正常な「発表警報・注意報はなし」を表す。 */
export interface ParsedNoWarningKind extends ParsedWarningKindBase {
  readonly kindType: 'no_warning';
  readonly status: '発表警報・注意報はなし';
}

export interface ParsedIssuedWarningKind extends ParsedWarningKindBase {
  readonly kindType: 'warning';
  readonly name: string;
  readonly code: string;
  readonly lastKind: {
    readonly name: string | null;
    readonly code: string | null;
  } | null;
  readonly properties: readonly XmlFragment[];
  readonly addition: XmlFragment | null;
}

export type ParsedWarningKind = ParsedNoWarningKind | ParsedIssuedWarningKind;

export interface ParsedWarningTelegram {
  readonly telegramType: WarningTelegramType;
  readonly controlStatus: ControlStatus;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly targetDateTime: UtcIso8601String | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly area: { readonly code: string; readonly name: string | null };
  readonly warningType: string;
  readonly kinds: readonly ParsedWarningKind[];
}

export type WarningTelegramParseResult =
  | { readonly ok: true; readonly value: ParsedWarningTelegram }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

export function parseWarningTelegram(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  targetArea: WarningTargetArea,
): WarningTelegramParseResult;

export function processWarningTelegramReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  decidedAt: UtcIso8601String,
  targetArea: WarningTargetArea,
): WarningTelegramParseResult;

export interface PendingWarningTelegramPage {
  readonly receptions: readonly TelegramReception[];
  readonly nextCursor: { readonly receivedAt: UtcIso8601String; readonly id: number } | null;
}

export function listPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  options?: {
    readonly after?: { readonly receivedAt: UtcIso8601String; readonly id: number };
    readonly limit?: number;
  },
): PendingWarningTelegramPage;

export function reprocessPendingWarningTelegramReceptions(
  connection: DatabaseConnection,
  targetArea: WarningTargetArea,
  clock: () => UtcIso8601String,
): Promise<{ readonly processedCount: number }>;
```

`processWarningTelegramReception` は `rawBody === null` を `未対応構造` として記録し、返却結果と同じ判定を履歴へ残す。正常解析は `adoptionResult: '警報・注意報として解析済み'`、対象外は `対象外`、対象地域外は `対象地域外`、構造不正は `未対応構造` とする。`adoptionReason` には、要素パスと期待値を含む短い日本語理由を残し、原文や秘密情報を複製しない。

## 5. 処理フロー

```text
C1 が個別 XML を取得して telegram_reception に原文を保存
  └─ C2 processor（保存成功後に 1 回）
       ├─ telegramType が VPWW55–61 / VPWS50 か確認
       ├─ Report / Control / Head / Body の namespace と必須値を検証
       ├─ Control/Status と C1 保存値の整合を検証
       ├─ 電文種別に対応する Body/Warning[@type] を完全一致で 1 件選択
       ├─ その直下の Item を順に確認
       │    └─ 直下 Area/Code = 呼出元の市町村等コード の Item のみ選択
       ├─ 選択 Item の Kind を順序どおり構造化
       │    └─ 通常 Kind: Name / Code / Status / DateTime / LastKind / Properties[] / Addition
       │       正常な発表なし: kindType / sequence / Status / DateTime（0..1）
       └─ adoption result / reason / decidedAt を受信履歴へ更新

アプリケーション起動（DB migration 完了、C1 start 前）
  └─ telegram_type が対象かつ adoption_decided_at IS NULL の既受信行を
     received_at ASC, id ASC で 100 件ずつ取得
       └─ 各行を同じ C2 processor へ渡し、判定時刻を更新
          └─ 中断時は未更新行だけを次回起動で再開

C3
  └─ 上記の純粋パーサーを再利用し、個別・集約電文を時刻・現象ごとに積み上げて
     warning_current_snapshot / warning_current_item を更新
```

## 6. テスト計画

`apps/api/tests/jmaWarningTelegramParser.test.ts` では、ネットワークを使わず、名前空間を明示した最小 XML fixture と、取得方法レポートで確認済みの代表電文を利用する。代表電文の原文はリポジトリへ複製せず、テストで必要な構造・値のみを最小化した fixture にする。

1. VPWW55–61 と VPWS50 の各電文種別が `Warning/@type="気象警報・注意報（市町村等）"` を完全一致で 1 件選び、注入した対象市町村等コードの Item の `Kind` を出現順・文字列コードのまま抽出する。通常 Kind の期待値には `kindType: 'warning'` と、Property がない場合の `properties: []` を含めて完全一致する。既定の江東区コード `1310800` と、将来の別会場コードを模した fixture の両方でコードの完全一致を確認する。
2. VPWW61 の同一 Kind に複数 `Property` がある fixture（`濃霧危険度`、`濃霧` の順）で、全 `properties` が XML 順・属性・子要素・テキストまで完全一致で残る。先頭だけの採用、Type による上書き、単一文字列化では失敗する。
3. `Control/Status` が通常・訓練・試験の各 XML でそれぞれ `normal`・`training`・`test` となり、C1 保存値と不一致の fixture は採用されない。
4. 東京都または東京地方の `Headline/Area/Code` に対象コードらしい別要素を置いても、選択済み `Body/Warning/Item` の直下 `Area` に注入コードがなければ `対象地域外` になる。上位地域の Kind を返さない。
5. 同名の `Body`、`Warning`、`Item`、`Area` を別 namespace に置いた fixture は採用されない。`Body/Warning` の type 不一致、0 件、複数件も先頭採用せず失敗する。
6. 通常 Kind の必須 `Name`・`Code`・`Status` の欠損、不正日時、未知 `telegramType`、原文なしが、空一覧や通常ステータスに縮退せず、採用結果・要素パスを含む理由として完全一致で保存される。
7. 正常な対象電文で注入対象地域の Item が 0 件の場合は、構造不正ではなく `対象地域外` として保存され、既存の現況スナップショットを変更しない。
8. `recordTelegramReception` 後に processor が 1 回呼ばれ、HTTP 取得成功の `fetch_attempt.outcome` を変更せず、受信履歴だけの採用結果が更新される。
9. C2 が `warning_current_snapshot` / `warning_current_item` へ書き込まず、C3 の現況構成を先取りしないことを DB 件数の完全一致で確認する。
10. no-warning の公式正常 2 形態を別々の fixture で確認する。Status だけの Kind は `{ kindType: 'no_warning', sequence: 1, status: '発表警報・注意報はなし', dateTime: null }` と完全一致する。`<Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2019-10-12T04:11:00+09:00</DateTime>` の Kind は、`dateTime: '2019-10-11T19:11:00.000Z'` を持つ同じ判別型の正常結果と完全一致する。いずれも `Name`・`Code` 欠損を構造不正や対象地域外、空の `kinds` 配列にしない。一方、同じ Status 以外で `Name`・`Code` を欠く Kind、no-warning Kind の空または不正な DateTime、DateTime の重複・type 不一致・他属性、Kind または Status の属性、未確認の直下子要素、子要素の順序違反は `未対応構造` となる。
11. `Control/DateTime`、`Head/ReportDateTime`、存在する `Head/TargetDateTime` と `Kind/DateTime` について、`2026-09-09T00:00:00Z`、`2026-09-09T09:00:00+09:00`、秒小数部付きの値を受け入れ、UTC へ正規化した値と完全一致する。日付のみの `2026-09-09`、タイムゾーンなし、時刻なし、存在しない暦日、範囲外の時刻・オフセットは `未対応構造` になる。任意の `Kind/DateTime` が存在しない fixture は正常となる。
12. 起動時の再処理は C1 ポーリング開始前に実行され、対象 8 種かつ `adoptionDecidedAt === null` の既受信行だけを `receivedAt ASC, id ASC` で処理する。既に判定時刻がある行は processor を呼ばない。
13. 101 件以上の fixture で keyset pagination の境界を越えて全件を 1 回ずつ処理し、各行に判定時刻が残る。再起動相当の 2 回目では対象 0 件となる。
14. 再処理の途中で processor を失敗させた fixture では、更新済みの先行行を再処理せず、未更新行だけを次回実行で処理する。`fetch_attempt`、現況スナップショット、通知履歴の件数は実行前後で完全一致とする。

今回追加する各回帰テストは、対応する旧挙動で先に red を確認する。具体的には、複数 Property fixture は「最大 1 件」の制限または先頭 1 件への縮退で失敗し、Status-only fixture は全 Kind への Name / Code 必須化で失敗し、DateTime 付き no-warning fixture は Status 以外を許さない分岐で失敗し、日付のみ fixture は `new Date(raw)` だけの判定で誤って成功することを確認する。その前に、意味を変えない fixture の整形だけを変更してテストが成功し続ける対照実験を行う。次に、それぞれ Property の 2 件目を捨てる、no-warning 分岐を外す、no-warning の DateTime を捨てる、日時の字句検証を外すミューテーションが該当テストにより KILLED となることを確認する。一時変更は完成コードへ残さない。従来の `Area/Code` 直下関係と `Warning/@type` 完全一致の回帰テストも維持する。

## 7. 受け入れ条件

1. VPWW55–61 および VPWS50 の各代表電文を、名前空間を考慮して解析し、注入した市町村等コードの Item の `Kind` 情報を抽出できる。既定の江東区 `1310800` を含む。
2. 通常 Kind の `Name`、`Code`、`Status`、`LastKind`、出現順の全 `Property`、`Addition`、`DateTime` が、空文字・先頭要素・単一の表示文・数値分類へ縮退せずに保持される。
3. `Control/Status` の通常・訓練・試験が `normal`・`training`・`test` として区別され、通常へ既定化されない。
4. `Body/Warning/@type` は電文種別ごとの確定した完全一致表で 1 件だけ選ばれる。東京都・東京地方の `Headline` や、選択範囲外・別 namespace の `Area` は江東区の代用にならない。
5. 注入対象地域の Item が存在しない有効な対象電文、対象外種別、構造不正は互いに区別され、いずれも正常な発表なしや現況の空配列に変換されない。
6. 直下に `Status` と任意の `DateTime` を持ち、Status が完全一致で `発表警報・注意報はなし` の Kind は、Name・Code を要求せず `kindType: 'no_warning'` の正常結果 1 件として保持される。DateTime の不在は `null`、存在時は `type="発表時刻"` と厳密 ISO 8601 値を検証して UTC 正規化値を保持する。構造不正・対象地域外・空配列に縮退させず、存在しない通常 Kind の項目を補わない。C3 は判別子で通常 Kind と区別できる。
7. 読み取るすべての DateTime 値は、時刻・タイムゾーンを持つ厳密 ISO 8601 として検証される。日付のみ、時刻なし、タイムゾーンなし、不正な暦日・オフセットは `未対応構造` となる。任意の `Kind/DateTime` は不在を許すが、存在時は同じ検証を通る。
8. C1 の原文・受信履歴・HTTP 試行記録は保持され、C2 の判定結果と理由が受信履歴に残る。C2 の解析失敗で HTTP 取得結果を失敗へ変更しない。
9. C2 は `warning_current_snapshot` / `warning_current_item`、availability、通知、REST API、画面を更新しない。
10. DB migration 完了後かつ C1 の通常ポーリング開始前に、未判定の既受信対象原文が安定順で一度だけ再解析される。成功・対象地域外・対象外・構造不正のいずれも `adoption_decided_at` を残し、次回起動で再処理されない。中断した場合は未更新行だけが再開される。
11. `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api` が成功する。

## 8. 後続 Issue への引き継ぎ

- **C3**: `parseWarningTelegram` を唯一の種別固有 XML 解釈器として再利用し、個別 VPWW55–61 と VPWS50 を要素時刻・電文適用範囲に基づき積み上げる。共通の `dateTime` は通常 Kind と no-warning Kind のどちらでも要素時刻として参照できる。`kindType === 'warning'` へ型を絞り込んだ後にだけ `name`、`code`、全 `properties`、`LastKind`、`Addition` を参照する。`kindType === 'no_warning'` は対象区域について「発表警報・注意報はなし」と明示する正常入力であり、対象地域外やパース失敗、`kinds: []` と同一視しない。C3 が no-warning の `dateTime` を含む要素時刻、電文の適用範囲、集約／個別の規則に従って現況への反映を決め、C2 の段階では現況を上書きしない。市町村の解除 `00` と上位集約の解除対象種別の規則も混同しない。
- **D2 / D3 以降**: `Kind/Code` を §7.4 のコード表で照合して通知区分・変化通知を判定する。C2 の `Significancy` やコードの数値大小、名称一致で代替しない。未知・予約コードを低い通知区分へ自動割当しない。
- **訓練通知（3.4）**: C2 が保存した `ControlStatus` を通常データと混同せず、訓練由来を `isTraining` として通知・履歴・表示まで伝播させる具体的な変換は、訓練注入機能の設計で確定する。
- **C12**: 初期化・復旧時に既存原文を再評価する必要がある場合、C2 の純粋関数を使用する。C2 導入時の未判定既受信行は §3.6 の起動時一度だけ再解析で解消済みであり、C12 はそれを起動ごとの全件再解析へ拡張しない。
- **UI / E 系**: `Property` / `Addition` を画面用の補助テキストへ変形する場合も、C2 の `XmlFragment` を原本として扱う。`warning_current_item.attention_text` の単一文字列だけを原文の保管先にしない。
- **会場設定・気象取得の後続設計**: 会場から `WarningTargetArea` を解決し、同会場の H/K 端末には同じ値を渡す。TRC は大田区、最寄りアメダスは羽田空港というユーザー指定を引き継ぐ。ただし大田区の市町村等コード、羽田の地点コード・取得可能要素、地図基準位置、広域予報・速報の対象判定は公式資料・実データで確認してから設定する。C2 は警報の市町村等コードのみを受け取り、これらを代替しない。

## 9. 確認事項

1. **解消済み: `Body/Warning/@type` の電文種別ごとの完全一致表**: 公式提供サンプル 8 種すべてで、市町村等の対象は `気象警報・注意報（市町村等）` と確認した。各代表 XML に 1 件ずつ存在する。C2 はこれを完全一致で選択する。
2. **解消済み: 既受信原文の再評価範囲**: 統括判断により、`telegram_reception` の未判定対象原文を一度だけ再解析する。起動点、対象抽出、安定順、途中中断時の再開、判定済み行の除外は §3.6 に確定した。
3. **解消済み: no-warning Kind の形態**: 公式 VPWS50 では、一次細分区域等に Status のみが 4 件、市町村等をまとめた地域等に Status のみが 9 件、市町村等に Status と `DateTime type="発表時刻"` が 54 件存在した。全 67 件に Kind 属性やその他の直下子要素は確認されなかった。ユーザー承認により、地域階層による 2 形態を `dateTime` が任意の共通 no-warning 型として扱う。
4. **高潮（VPWW57）の完全な集約空状態・解除の実代表**: Issue 本文と取得方法レポート §9 のとおり、江東区の高潮実電文が未確認である。C2 は構造を保持するだけで解除判定をしないが、C3 の完全スナップショット・解除判定を開始する前に、代表電文で `Warning/@type` と `Kind` の実構造を確認する必要があります。
5. **会場設定の受渡し元**: C2 は `WarningTargetArea` を注入する形に限定した。江東区（`1310800`）を既定に用いること、TRC は大田区を対象にすることは判明しているが、大田区の市町村等コードは未確認である。どの後続 Issue / 設定機構が会場からこのコードを解決して C2・C3 に渡すかを決めてください。アメダス羽田、地図、広域予報、速報は別対象なので、この型へ混在させない前提です。

本改訂で追加された検収指摘について、Issue #12 の製造を止める未確認事項はない。4、5 は後続 Issue の設計開始前に解消する。
