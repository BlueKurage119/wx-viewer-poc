# Issue #145 速報の通常通知と起動時通知の対象範囲の補完

設計担当: Codex（GPT 6）。レビュー修正設計: Codex（GPT 6）。状態: 2026-09-14 設計承認済み・製造着手可。

## 1. 目的・根拠

[D10 / Issue #145](https://github.com/BlueKurage119/wx-viewer-poc/issues/145) の対象は、速報5種の通常受信通知、system・竜巻の起動時現況通知、E9（#41）に渡す契約の補完である。

参照資料と確認した実装:

- [#17 設計](issue-17-bosai-bulletin.md)、[#18 設計](issue-18-tornado-bulletin.md)、[取得方法レポート](../data-acquisition-report.md): VPBS50の完全EventID、Control/DateTimeによる更新判定、VPHWの明示期限と目撃区域の制約。
- [#25 設計](issue-25-notification-data-model.md)、[#103 設計](issue-103-notification-message-definitions.md): D1通知事実とメッセージ定義。既存5種の発表定義はすべてquestion・確認あり。
- [#28 設計](issue-28-warning-notification-generation-rules.md)、[#29 設計](issue-29-startup-notification-api.md)、[#31 設計](issue-31-equipment-anomaly-notification.md): 通常検知と起動再提示の分離、warning出力権、取得元単位の健全性。
- `jmaVpbs50Processor.ts` / `jmaVphwProcessor.ts`: 現況保存と旧版除外を実装済み。速報通知への接続はない。`metadata.sourceVersion`は電文の仕様版（InfoKindVersion）であり、発表・訂正版の識別子ではない。
- `startupCurrentNotificationProjector.ts`: 現況警報とVPBS50の3種を実装済み。竜巻・systemは未接続。
- `FetchHealthMonitorService.getLastAggregate()`: 現在のサーバー取得監視結果を読み取り可能。通常のsystem通知は既に実装済み。
- [竜巻注意情報の解説資料](<../../../docs/260907_weather-data/jmaxml_20260826_Manual(pdf)/竜巻注意情報_解説資料.pdf>) p.4: 失効時刻、InfoTypeは発表・訂正のみ。p.5: 目撃区域は4体系・複数Itemを取り得る（統括から引継いだ調査担当の確認結果）。取消通知の非採用と区域区分保持の根拠とする。
- `apps/api/tests/fixtures/jma/manifest.json` と既存VPHW51公式サンプル: `ValidDateTime`と構造化された目撃情報区域が存在する。出典・原本/合成の区別はmanifestを正とする。

本設計で確認したのはコード・保存資料・fixtureの構造である。実サーバーを動かした検証は行っていない。VPHWの訂正・取消・訓練・試験の実電文は**実挙動未確認**であり、合成fixtureによる検証を実提供の証明としない。

## 2. ヒアリング判断記録

2026-09-14、ユーザー回答:

> 1点目、Systemとはサーバー側のことでよろしいでしょうか。現在の遅延・異常を全て出力してください。
> 2点目、提案通りで結構です。
> 3点目、提案通りとします。
> 4点目、提案通りとします。
> 5点目、重複も関係あるものはすべて出力してください。

質問画面が時間経過で消える場合があるため、判断は本節に記録し、聞き直された場合もこの記録を参照する。

| 論点 | 確定した判断 |
| --- | --- |
| system | サーバー側の取得監視。現在の遅延・異常を取得元ごとに全件出力。現行の取得元は6種なので最大6件。件数上限による打切りや集約抑止をしない。復帰・停止・過去履歴は起動再提示しない |
| warning出力権 | サーバー起動世代×会場で初回のみ。応答喪失時の再送なしを維持。questionは問い合わせごと |
| 竜巻 | 明示期限内の現況を起動時に出力。会場別目撃判定に必要な区域保持を今回補完 |
| 通常速報 | 会場×種別×版単位。同版再取得を抑止、訂正を再通知、初期取得は期限内現況を通知。対象特定可能なVPBS50取消を通知。VPHW取消は提供根拠未確認のため通知非採用・未対応追跡 |
| VPHW50/51 | 会場に関係するものを独立してすべて通知。内容重複を抑止しない。両電文の到着待ちは設けない |

訂正は「気象防災速報訂正」question・確認あり、VPBS50取消は「気象防災速報取消」warning・確認不要とする（統括から引継ぎ済み）。

## 3. 対象表・通知条件

| 対象 | 通常通知 | 起動時現況 | 判定・根拠 |
| --- | --- | --- | --- |
| VPBS50 線状降水帯発生 | 採用 | 既存を維持 | タグ`線状降水帯発生`、会場区域に交差 |
| VPBS50 線状降水帯直前予測 | 採用 | 既存を維持 | タグ`線状降水帯直前`、会場区域に交差 |
| VPBS50 記録的短時間大雨 | 採用 | 既存を維持 | タグ`記録雨`、会場区域に交差 |
| VPHW50/51 竜巻注意 | 採用 | 採用 | 目撃専用区域を除く発表区域と会場区域が交差 |
| VPHW51 竜巻目撃 | 採用 | 採用 | 構造化された目撃情報の発表区域と会場区域が交差 |
| VPHW50の本文・標題だけからの目撃判定 | 非採用 | 非採用 | #18の確定判断を維持。hasSighting=nullをtrueに補完しない |
| VPBS50の対象特定可能な取消 | 採用 | 非採用 | 完全EventID・通常/訓練を一致させ、既存対象または取消電文から会場と対象種別を特定できる |
| VPHW取消 | 非採用 | 非採用 | 取消の提供根拠・対象特定が実挙動未確認。現行の保存処理は変更しない |
| system遅延 | 既存維持 | 採用、warning出力権に従う | 取得元ごとのdelayed |
| system異常 | 既存維持 | 採用、問い合わせごと | 取得元ごとのabnormal |
| system復帰 | 既存維持 | 非採用 | 過去の変化を現在の問題として再提示しない |
| system正常・停止・未評価 | 既存維持 | 非採用 | normal / suspended / nullを異常に変換しない |
| 短時間大雪・未知タグ・試験電文 | 非採用 | 非採用 | 速報5種の範囲外。既存取得・保存を勝手に拡張しない |

発表は既存の5定義を選び、`changeType='new'`。訂正は専用定義を追加し、`changeType='corrected'`。取消は専用定義を追加し、`changeType='cancelled'`。同一内容でも新しいControl/DateTimeの発表は別版として通知する。訂正前のReportDateTimeが変わらなくても通知する。旧版を再適用・再通知しない。

VPBS50取消の【確定】: `previous`は完全EventID・controlStatusが一致する更新前の非取消行に限る。種別と区域は同一情報源の組として扱い、取消電文の種別とpreviousの区域を継ぎ合わせない。取消電文だけでVPBS50の対象3種内の種別と会場区域を確定できればその組を使用し、片方が欠ける場合はpreviousの組を使用する。ただし両者の既知の種別または区域集合が食い違う場合は`ambiguous_cancellation_target`、どちらの組も完全でない場合は`unknown_cancellation_target`として通知を見送り、受信ID・EventID・理由をログへ残す。区域を持つ取消の保存処理は従来どおりとする。区域0件の取消は§10.1の承認済み採用条件を満たす場合に限り保存し、previousによる通知判定へ接続する。この優先・見送り規則は§8、区域0件の採用拡張は§10で承認済み。

会場判定は`resolveVenueForecastTargets(venueId).bosaiBulletin.includedAreaCodes`を使用する。保存の広域和集合判定と通知の会場別判定を分離する。`normal`と`training`は識別・重複抑止・履歴・起動応答のすべてで分離し、`isTraining`を伝播する。

例: VPHW50とVPHW51が同じ東京地方に注意を発表し、VPHW51の目撃区域も会場に該当する場合、当該会場には「VPHW50注意」「VPHW51注意」「VPHW51目撃」の**3件**を出す。目撃区域だけが会場外なら**注意2件**。同じ3件を同版再取得しても通常履歴は増えない。questionの起動再提示は次の問い合わせでも3件返す。

## 4. モジュール・データ設計

### 4.1 速報判定と版

新規`apps/api/src/notifications/bosaiBulletinNotificationPlanner.ts`に、副作用を持たない会場別判定を置く。

```ts
type BosaiNotificationKind =
  | 'linear-rainband-observed' | 'linear-rainband-forecast'
  | 'record-short-rain' | 'tornado-warning' | 'tornado-sighting';

interface BosaiNotificationPlanInput {
  readonly current: BosaiBulletin;
  readonly previous: BosaiBulletin | null;
  readonly venueId: VenueId;
  readonly detectionContext: NotificationDetectionContext;
  readonly detectedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

function planBosaiBulletinNotifications(input: BosaiNotificationPlanInput): {
  readonly notifications: readonly {
    readonly notification: WeatherNotification;
    readonly output: ResolvedNotificationOutputSnapshot;
  }[];
  readonly skipped: readonly { readonly reason: string; readonly detail: string }[];
};
function resolveBosaiBulletinSourceVersion(bulletin: BosaiBulletin): string;
function resolveBosaiBulletinExpiresAt(bulletin: BosaiBulletin): UtcIso8601String | null;
```

速報通知の`sourceType='bosai_bulletin'`。`sourceVersion`は`JSON.stringify([eventId, controlStatus, controlDateTime, infoType])`を正規化した不透明な版キーとする。VPBS50は完全EventID、VPHWは既存の電文種別を含む合成EventIDを維持する。`metadata.sourceVersion`（InfoKindVersion）は変更せず、通知の版とは別概念として扱う。

通常通知の識別単位は`venueId + notificationKind + sourceVersion`。一つの電文から複数種を通知しても衝突しない。`targets`には会場（`kind='area', codeType='venue'`）を保持し、`relatedRefs`には少なくとも`bosai_bulletin/eventId`、`venue/venueId`、`bosai_notification_kind/notificationKind`を含める。受信経路では`telegram_reception/reception.id`も付す。`occurredAt=reportDateTime`、`detectedAt=検知時刻`。

期限はVPBS50がReportDateTime+3時間（アプリの現況表示期間であり気象上の解除ではない）、VPHWが`metadata.validAt`に保存済みのValidDateTime。`validTo`へ値を複製しない。初期取得・起動現況は`reportDateTime <= now < expiresAt`、取消済み除外。期限不明を3時間で補完しない。

### 4.2 目撃区域の保持

`BosaiBulletinAreaInput` / `BosaiBulletinArea`へ`informationType: string | null`を追加し、`bosai_bulletin_area`へnullableの`information_type`列を追加するマイグレーションを作成する。VPBS50はnull。VPHWはHeadline/Information@typeを保持し、重複除去キーを区域コード・codeType・informationTypeとする。同じ区域が注意と目撃の双方に含まれる情報を失わない。DBでも同一bulletin・区域コード・codeType・informationTypeの一意性を保証する。`information_type IS NULL`用と`IS NOT NULL`用の部分一意インデックスを追加する§10.2の前方マイグレーションを使用する。

目撃は`Information type='竜巻注意情報（目撃情報あり）'`かつItem/Kind/Conditionが発表の区域だけで判定する。注意は他の既知Informationの発表区域で判定する。本文文字列やBodyの非発表区域から推定しない。既存の電文単位`hasSighting`は互換用に維持する。

旧DBのinformationType=nullのVPHW行は区域を復元できない。初期評価前に、当該eventId・controlStatus・controlDateTimeに一致する保存済み受信原文を既存parserで再解析し、区域区分だけを補完する。再解析に通常通知を接続せず、旧版判定を迂回した現況上書きもしない。復元元がない場合は§8の承認どおり通知対象から除外し、保存現況を維持して理由をログへ残す。

### 4.3 通常受信と初期取得

新規`bosaiBulletinNotificationEmitter.ts`でplanner→既存`toNotificationOutputHistoryInput`→`recordNotificationOutputHistory`を接続する。

```ts
interface InitialBosaiNotificationState {
  isCompleted(venueId: VenueId, status: 'normal' | 'training'): boolean;
  markCompleted(venueId: VenueId, status: 'normal' | 'training'): void;
  isCollecting(): boolean;
  setCollecting(value: boolean): void;
}
interface BosaiNotificationEmitDeps {
  readonly now: () => UtcIso8601String;
  readonly notificationIdFactory?: () => string;
  readonly initialState: InitialBosaiNotificationState;
}
function emitBosaiBulletinNotificationsForReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  previous: BosaiBulletin | null,
  current: BosaiBulletin,
  deps: BosaiNotificationEmitDeps,
): { readonly recordedCount: number; readonly failed: boolean };
function emitInitialBosaiBulletinNotifications(
  connection: DatabaseConnection,
  venueId: VenueId,
  deps: BosaiNotificationEmitDeps,
): void;
```

`processVpbs50Reception` / `processVphwReception`の末尾にoptionalのdeps引数を追加し、保存が実際に適用された場合だけ通知する。parseResult.okだけでは適用成功にならない（現状は旧版でもokを返す）。保存トランザクション内で更新前・更新後を捕捉し、保存の成功後に通知履歴を独立トランザクションで保存する。DB障害時の通知再送保証は追加しない。`recordedCount`は成功した件数だけとする。

`JmaXmlPollOptions`とservice/server構成へdepsを引き渡す。初期取得中の受信は保存にとどめ、初期取得完了時に保存済みの最新・期限内現況を各会場1回評価し、`detectionContext='initial'`で通知する。その後の適用版は`normal`で通知。これにより初期フィード内の過去版を順に鳴らさない。初期状態はサーバーruntime所有で、通常/訓練・会場を分離する。再起動時も最新の期限内現況をinitialとして評価する。既存D5の会場評価完了マークは速報の初期評価後に立てる。

初期状態はcollecting=true・完了集合は空。初期取得のfailedでは通知評価・完了マークを行わず、failed→completedで未完了の会場×通常/訓練だけ評価する。期限内対象0件でも評価が終了すればmarkCompletedする。履歴保存失敗も再送保証を追加しないため完了扱いとし、理由を記録する。完了済みキーは同一runtimeの再評価で消さず、全会場評価後にcollecting=falseとする。サーバー再起動で新しい状態を生成する。

同版・旧版は既存processorのControl/DateTime判定で通常通知を抑止する。初期取得では最新スナップショット1回の評価で抑止する。VPHW50/51間の内容重複判定は実装しない。

### 4.4 定義・起動API・system

`packages/shared/src/notificationMessageDefinitions.ts`へ以下を追加する。5種の既存発表定義を複製・変更しない。

| ID | changeType | category / action | 表題・本文 |
| --- | --- | --- | --- |
| weather-bosai-bulletin-corrected | corrected | question / acknowledge | 気象防災速報訂正、detailに対象速報種別 |
| weather-bosai-bulletin-cancelled | cancelled | warning / none | 気象防災速報取消、detailに対象速報種別 |

`StartupCurrentNotification`はorigin/sourceTypeの組合せを判別可能なunionにする。weatherは既存2source、systemはfetch_health。その他の既存フィールドは維持する。

```ts
type StartupCurrentSource = 'warning_current' | 'bosai_bulletin' | 'fetch_health';
// 共通フィールドを持つbaseと次のunionを交差させる。
type StartupCurrentOrigin =
  | { readonly origin: 'weather'; readonly sourceType: 'warning_current' | 'bosai_bulletin' }
  | { readonly origin: 'system'; readonly sourceType: 'fetch_health' };
```

`StartupProjectionInput`へ`fetchHealth: FetchHealthAggregate | null`を追加。`CreateStartupNotificationServiceDependencies`へ`getFetchHealth: () => FetchHealthAggregate | null`を追加し、serverの両起動経路で当該runtimeの`FetchHealthMonitorService.getLastAggregate()`を渡す。未作成・未評価はnullとする。問い合わせからrunOnceや通常通知emitterを呼ばない。

system投影はaggregate.sourcesを取得元ごとに列挙する。delayed→既存`system-data-fetch-delayed`、abnormal→既存`system-data-fetch-failed`。equipment target・fetch_source ref・detailは既存plannerと揃える。`occurredAt=aggregate.evaluatedAt`（異常開始時刻とは称さない）、sourceVersion=null、isTraining=false。同時刻同区分でも取得元IDで別件とする。

`includeWarningCategory=false`ならsystem遅延も除外する。system全件とは取得元の集約抑止をしない意味であり、承認済みwarning出力権は撤廃しない。異常questionは全件を問い合わせごと返す。通常system通知の遷移判定・履歴処理は変更しない。

竜巻起動現況は§4.1・4.2の対象種別判定と期限関数を再利用する。訂正済み現況も起動時は既存発表定義で現在の情報として提示し、過去の訂正操作を再実行しない。

HTTPエンドポイント・request・initializing/ready/error契約は#29を維持。起動投影では通知検知履歴を書かず、既存D5の問い合わせ監査・応答JSONへ記録する。全体の並び順は現行のoccurredAt/sourceType/ref/outputIdを維持し、取得元別の項目を潰さない。

## 5. 変更範囲・対象外

変更対象はsharedの通知定義・起動型、apiの速報parser/processor/repository型・区域マイグレーション、通知planner/emitter/projector/service、poller/service/serverの接続と対応テスト。既存警報・system通常通知は回帰検証するが機能を二重実装しない。

E9のcursor差分API・通知UI、受領監視、指令伝達、DB障害時の再送保証変更、VPHW取消の推測実装は対象外。availabilityのavailable/stale/unavailableを変更せず、保持値と健全性を混同しない。

## 6. 受け入れ条件

合成fixtureには加工内容と「実挙動未確認」を明記する。時刻は固定時計で注入する。各項目を独立して実行可能なテストとし、検収では項目別合否を報告する。

- [ ] AC1: 既存VPBS50の発生・直前・記録雨fixtureを会場に該当する条件で通常processorへ投入し、各該当会場・種別につき1件、既存定義ID・question・ackRequired=trueのB4履歴を確認。非該当会場・短時間大雪・未知タグは0件。
- [ ] AC2: 同じ電文の再処理・同Control/DateTimeの再取得・古い版の投入で履歴0件増加。ReportDateTimeを維持しControl/DateTimeを進めた訂正fixtureで1件増加し、訂正定義・corrected・異なるsourceVersionを確認。
- [ ] AC3: 対象特定可能なVPBS50取消fixtureを投入し、該当会場のみ取消定義・warning・確認不要で記録。取消現況を起動APIが返さない。対象不明取消・VPHW取消は通常通知0件、理由が追跡可能であること。§8-3承認後は種別/区域の不一致を注入して見送り理由を検証する。
- [ ] AC4: 初期取得に同一速報の複数版を投入して完了させ、最新の期限内現況だけが会場別にinitial履歴へ1回記録される。初期取得failedでは未評価、failed→completedで1回評価。同一runtimeで初期評価を再実行して増えない。再起動runtimeでは期限内現況がinitialになる。
- [ ] AC5: VPBS50は発表直前・3時間ちょうど・経過後を除外し、発表時刻・3時間直前を採用。VPHWはValidDateTime直前を採用、同時刻以降・不明期限を除外し、3時間ルールで延長しない。初期・起動両経路で確認。
- [ ] AC6: VPHW50/51の注意区域とVPHW51目撃区域を同一会場に交差させたfixtureで通常・起動とも3件。目撃区域だけを会場外に変更すると注意2件。到着順を逆にしても同じ結果で、到着待ちがない。同版再取得の通常履歴増加は0件。
- [ ] AC7: 目撃有り・無し・VPHW50本文のみ目撃の公式fixtureをparser→repository→再読込し、informationTypeの保持、VPHW50のhasSighting=null、他会場の目撃を誤通知しないことを確認。旧DB→migration→原文補完でも同じ結果となる。§8-2承認後は原文欠落・解析失敗で行が通知から除外され、保存現況が維持されることを確認。
- [ ] AC8: 同じ速報のnormal/trainingを投入し、別通知・別版識別となり、B4履歴と起動応答のisTrainingがそれぞれfalse/true。testは通知なし。availability3状態が型・既存APIで維持される。
- [ ] AC9: system6取得元をすべてabnormal・同評価時刻として起動問い合わせし、異なるequipment codeの6件が返る。混合delayed/abnormalでも初回出力権ありなら全件返る。次の問い合わせはabnormal全件を返しdelayedを返さない。
- [ ] AC10: system normal/suspended/未評価・過去に復帰済みの状態で起動通知0件。問い合わせ前後で通常通知履歴件数と取得監視stateが変わらず、D5問い合わせ監査だけ増える。
- [ ] AC11: 同会場別端末・別会場・サーバー再起動・同session再問い合わせ・初回応答喪失を#29と同じ条件で検証し、warning出力権とat-most-onceを維持。question再提示は新しいoutputIdで返る。
- [ ] AC12: sourceVersionをInfoKindVersionに戻すと訂正識別テストが失敗すること、会場targets・venue関連参照・通知種別関連参照の必須識別情報を完全一致で検証し、それぞれを欠落させる変異でテストが失敗することを確認。意味を変えない対照改変の通過を先に確認する。識別情報の欠落は件数だけでは検出できないため、件数検査で代用しない。通常notificationIdと起動outputIdが監査・履歴で混同されない。
- [ ] AC13: 履歴保存失敗を注入し、現況保存は維持され、成功件数を誤報せず、同版再取得による再送保証を追加していないことを確認。
- [ ] AC14: 初期取得完了後に新着速報をfeed・poller経由で投入し、該当会場のnormal検知履歴が1件増えるserver統合テストを実行する。意味を変えない対照改変の通過後、通常受信の通知deps結線を外す変異でこのテストが失敗することを確認する。`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/api`、`npm run test -w packages/shared`および起動型の利用箇所に影響があればwebテストを実行して全件成功。

- [ ] AC15: 合成VPBS50を通常processorに受信させ、対象区域を持つ発表→新しいControl/DateTimeの区域0件取消の順で、取消の採用・保存・B4通知まで検証する。取消が既知タグを持つ条件で、保存行が取消済み・区域0件・タグは入力値のままであること、previousの区域に該当する会場だけ取消定義・warning・確認不要の履歴が1件増えること、起動現況に旧発表も取消も返らないことを完全一致で確認する。発表の現況表示期限が切れていても対象を特定できれば同じ結果となる。
- [ ] AC16: 区域0件取消について、タグと区域が双方欠落・previousなし・別EventIDのみ・別controlStatusのみ・previousが取消済み・previousの種別または区域不完全・既知タグ不一致・previousが対象地域外を独立に注入し、取消が採用されず既存現況と通知履歴が変わらないこと、受信ID・EventID・理由を追跡できることを確認する。同版・古いControl/DateTimeも保存・通知を増やさない。区域あり取消の既存採用結果と、通知の種別／区域不一致見送りを回帰検証する。一般parser呼出しがpreviousの検証なしに区域0件取消を採用しないことも確認する。
- [ ] AC17: 0021まで適用した一時DBにVPBS50のNULL区域とVPHWの注意／目撃区域を保存して0022を適用し、既存行の全項目を維持することを確認する。同一bulletin・区域コード・codeTypeのNULL重複、および同一非NULL informationType重複をrepositoryの保存経路から投入すると制約違反になり、失敗前の保存状態を維持する。注意と目撃、異なるbulletin・区域コード・codeTypeの行は併存できる。既存重複を持つ0021 DBでは0022が失敗・ロールバックし、行を黙って削除しない。新規DBへの全migration適用も成功し、0021の内容は変更されていないことを確認する。

## 7. E9への引継ぎ契約

| 項目 | 通常検知（B4） | 起動再提示（D5） |
| --- | --- | --- |
| 識別 | notificationId。会場・種別・版ごとの新しい検知事実 | outputId。問い合わせごとの出力識別で、検知IDではない |
| コンテキスト | detectionContext=initial/normal | session.kindと問い合わせ監査。detectionContextを捏造しない |
| 版 | 速報は§4.1の不透明な版キー。systemはnull | 速報は通常と同じ版キー。systemはnull |
| 期限 | VPBS50はアプリ3時間、VPHWは明示期限。取消は現況にしない | 同じ期限で現況投影。expiryの新規HTTPフィールドは今回追加しない |
| 再提示 | 同版再取得で通常検知を増やさない | questionは毎問い合わせ、warningは世代×会場の初回のみ |
| 訓練 | isTrainingを維持 | isTrainingを維持 |

E9はsourceVersion単独で通知を統合しない。同じ版でも会場・注意/目撃が異なり、systemは全件nullである。VPHW50/51を同内容でまとめない。起動outputIdを通常notificationIdへ置き換えず、通常検知の確認済み状態を理由に起動questionを抑止しない。

E9のAPIに期限を運ぶ場合は、本節の期限関数と保存済み現況から取得する契約を引き継ぐ。過去履歴に期限が必要な場合の永続化・cursor・差分は#41で設計する。VPHW取消の実提供確認、対象を特定できない取消、未知の速報種別は未採用事項として#145の検収報告から追跡する。

## 8. 追加ヒアリングの確定事項

2026-09-14、以下3点についてユーザーから「提案通りで大丈夫です。」と承認を得た。以下の提案を確定事項として製造へ引き継ぐ。今後の確認事項には対案と利点・懸念も添えるという希望を受領した。

1. **期限切れ・未来時刻の通常受信**: 初期取得・起動現況の期限は確定しているが、通常受信時の制限は未明示。【確定】通常の発表・訂正も§4.1と同じ期間だけ通知し、取消は対象が特定できれば期間外でも通知する。この扱いで承認済み。
2. **旧DBのVPHW区域区分を復元できない場合**: 【確定】原文がない・再解析に失敗した行は注意/目撃の会場判定ができないため、今回の通常初期通知・起動通知から行全体を除外し、理由をログへ残す。保存現況は維持する。代案は従来の混合区域を注意として通知し目撃だけ非通知とする方法だが、目撃専用区域を注意区域と誤判定するリスクがある。通知対象からの除外を採用する。
3. **VPBS50取消の対象情報が欠ける・食い違う場合**: §3のとおり、取消電文の完全な種別・区域の組を優先し、欠ける場合は更新前の組を使用する。ただし既知情報の食い違い・組を確定できない場合は通知を見送りログへ残す。この規則で承認済み。

## 9. 検証方法の補足（2026-09-14）

初回検収で、識別情報を削っても通知件数は変わらないためAC12の件数検査では契約を検証できないこと、初期現況だけの統合テストでは通常受信の結線を確認できないことが判明した。AC12・AC14の検証方法を具体化した。ユーザー承認済みの通知挙動・対象範囲は変更していない。

## 10. PR #153 レビュー修正の承認記録（2026-09-14）

ユーザーから「修正の設計承認をします。提案通り実施してください。レビュー返信・解決済みマーク・PR相当コメント（再レビュー要求を含む）までお任せします。」との承認・実施指示を受領した。以下2件を要対応として採用する。製造はAGY、修正後は独立検収と既存PRの更新を行う。マージは今回の承認に含めない。

### 10.1 P1: 区域欠落のVPBS50取消を受信経路から判定可能にする

[レビュー指摘](https://github.com/BlueKurage119/wx-viewer-poc/pull/153#discussion_r4000686592): plannerはpreviousへのフォールバックを持つが、現行parserが区域0件を先に除外するため、通常受信経路では取消の保存・通知に到達しない。旧発表も現況に残る。§3の「保存処理自体は従来どおり」と、区域欠落時にpreviousを利用する契約との矛盾を今回の承認により解消する。

【確定】変更する採用範囲は既知タグを持つ区域0件の取消だけとする。parserはDBに触れず、processorから明示的な内部オプション等で補完判定へ進める構造とし、一般のparse呼出しが区域0件取消を無条件に採用する変更はしない。更新前行を取得したprocessorで、完全EventID・controlStatusが一致する非取消のpreviousが、対象3種内の種別と対象地域に該当する完全な区域の組を持つことを検証する。取消の既知タグはpreviousと一致する必要がある。タグと区域が双方欠ける場合の既存の未対応構造拒否、および未知・未対応タグの制限は緩和しない。

採用には既存のControl/DateTimeによる新版判定も必要とする。previousなし・別区分・不完全・対象外・既知情報不一致は採用を拒否し、更新前の現況を保持する。理由は既存の受信採否記録およびログから受信ID・EventIDとともに追跡できるようにする。不一致は`ambiguous_cancellation_target`、完全な対象を確定できない場合は`unknown_cancellation_target`に対応する理由を残す。同版・旧版の既存拒否規則を維持する。

採用時は受信した取消の区域0件・タグをそのまま保存し、previousの値を取消スナップショットへ書き足さない。対象判定だけでpreviousを用い、保存成功後に捕捉済みpreviousと取消をemitterへ渡す。通知の会場判定・期限外取消・通常／訓練分離は既承認仕様を維持する。区域を持つ取消は従来の採用・保存結果を維持し、既知種別／区域の不一致は従来どおり通知を見送る。

対案は実電文確認まで区域欠落取消を対象外に維持する方法だったが、対象を確定できる取消の欠落と旧発表の残留を解消する本案を採用した。**VPBS50の区域欠落取消の実挙動は未確認**であり、合成fixtureはアプリの防御的処理を検証するものとする。気象庁の実提供形状が確認済みであるとは扱わない。

### 10.2 P2: 区域の自然キーの一意性を回復する

[レビュー指摘](https://github.com/BlueKurage119/wx-viewer-poc/pull/153#discussion_r4000686597): 0021のテーブル再作成で旧一意制約が失われ、同じ区域区分の重複も保存可能になっていた。

【確定】適用済みの可能性がある`0021_add_bosai_bulletin_area_information_type.sql`は変更しない。追加0022 migrationで、`information_type IS NULL`の場合は`(bulletin_id, area_code, code_type)`、`information_type IS NOT NULL`の場合は`(bulletin_id, area_code, code_type, information_type)`の部分一意インデックス2本を作成する。NULL同士も重複禁止とし、異なる注意／目撃区分の併存は維持する。API・parserの型契約は変更しない。

既存重複があればmigrationは失敗・ロールバックし、重複行を自動削除しない。対案のparserの重複排除だけに依存する方法は、repositoryへの他経路の入力でDB整合性を保証できないため採用しない。
