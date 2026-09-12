# Issue #24 設計書: C14. 時間帯別取得周期とオンデマンド取得

作成日: 2026-09-12

対象 Issue: #24「C14. 時間帯別取得周期スケジューラ」

改訂: PR #125 レビュー後のヒアリングと最終承認を反映。取得周期・独立設定・固定秒鮮度・画像取得分離はユーザー承認済みであり、これらについて製造前の追加承認は不要。

## 1. 目的・確定事項

【確定】XML・アメダス、および雨雲・キキクルの索引（時刻一覧）は、閲覧の有無にかかわらず運用時間内に定期取得する。雨雲・キキクルの索引は取得周期・鮮度閾値の初期設定をXMLに揃えるが、XML側と索引側をそれぞれ独立して設定変更できるようにする。画像本体だけを閲覧要求に応じたプロキシとして取得する。画像解析による危険度通知は行わない。

【確定】既定では20:00〜翌04:00（JST）の全上流取得を停止する。オンデマンド取得も停止対象で、保存済みデータ・検証済み画像キャッシュは読み出せる。夜間稼働が必要になった場合は設定ファイルで変更できるようにし、画面からは変更しない。

索引と画像の混同を訂正し、前の草稿にあった「索引の定期取得廃止」「readCatalogは常にstale」「staleAfterMs廃止」の案は取り消す。XML・索引の周期初期値は双方120/60/120秒・夜間停止とし、設定は分離する。アメダスの既定日中周期、XMLの初期取得・バックオフ、前回値保持、検証済み画像キャッシュを維持する。鮮度はXML・索引それぞれ固定300秒を初期値とし、独立変更できる。300秒は今回承認された運用初期値であり、実測による最適値ではない。

対象外は REST の新設（E7/E8）、地図・画面（F2/F3）、画像の先読み・解析通知、設定変更 UI/API、ホットリロード、手動操作 API（E11/K2）、アメダス複数会場収集である。今回のオンデマンド入口は内部サービス API として実装・検証する。表示中の自動更新頻度は未確定であり、この Issue でクライアントタイマーを追加しない。

## 2. 参照資料・実物調査と判断根拠

| 参照 | 判断根拠 |
| --- | --- |
| 統括ヒアリング（本改訂） | 画像だけ閲覧要求時取得、XML・索引の周期と鮮度は初期同値・独立設定、アメダス定期取得、既定夜間全停止、YAML外出し・再起動のみでの設定変更を確定事項とする。 |
| docs/issues-draft.md C14 / E7・E8 / F2・F3 | C14 は取得制御を担当し、REST と画面接続は後続に残す。 |
| docs/basic-design.md §6.3、§8.1〜8.3 | available / stale / unavailable と前回値保持を維持。§8.3 の未確定周期案に対して本ヒアリング結果を適用する。 |
| docs/design/issue-19-amedas-normalization.md、既存 AmedasScheduledAdapter | latest_time と地点取得は別成功。600秒の地点再確認と単一会場 east を維持する。 |
| docs/design/issue-20-nowcast-tiles.md、issue-21-kikikuru-tiles.md と実サービス | 一覧・フレーム検証、PNG検証、キャッシュ、通信履歴を再利用。固定300秒の初期値とcatalog_staleによる画像抑止の撤廃は今回の最終承認を反映する。 |
| docs/design/issue-22-initial-recovery.md、issue-23-exponential-backoff-retry.md | XML 初期4フィード、通常高頻度2フィード、失敗フィード限定 recovery と単一タイマー調停を維持する。 |
| apps/api/src/polling/timeBasedPollingScheduler.ts | 現在は4対象。factory が雨雲・キキクルを生成し、一律300,000 msを注入している。4対象を維持し、同じサービスを索引adapterと画像要求側へ注入する。従来の未承認値を、今回明示承認されたXML用・索引用の独立300秒設定へ置き換える。 |
| apps/api/src/polling/nowcastService.ts、kikikuruService.ts と各 Types | 公開入口は refreshTimes / readCatalog / fetchFrameTiles。サービス自身にタイマーはない。一覧の経過時間で stale を算出し、stale 時の画像キャッシュミスを拒否する実装を改訂する。 |
| apps/api/src/server.ts、app.ts | startServer と main の両方が off_hours 特別分岐でXMLを開始する。app の HTTP 入口は現時点で health のみ。内部サービスを保持・公開する結線が必要。 |
| PR #125 の修正 cfc1105 / 38dee5d | 境界をまたぐ実行中取得の完了後再予約と、地点データを実際に試行した回だけ再確認時刻を更新する修正を維持する。 |

気象庁の掲載期間・更新保証を新たに仮定しない。数値は既承認のアプリ確認周期のみであり、発表から表示までの保証ではない。新たな実ネットワーク計測は行っていない。

## 3. 時間帯と設定

### 3.1 既定動作

時刻は Asia/Tokyo、開始を含み終了を含まない。OSタイムゾーンに依存しない。

| 時間帯（説明用） | JST時間帯 | XML通常・雨雲索引・キキクル索引 | アメダス最新時刻 | 画像本体 |
| --- | --- | --- | --- | --- |
| early | 04:00〜05:00 | 120秒 | 300秒 | 要求時のみ許可 |
| busy | 05:00〜18:00 | 60秒 | 60秒 | 要求時のみ許可 |
| late | 18:00〜20:00 | 120秒 | 300秒 | 要求時のみ許可 |
| off_hours | 20:00〜翌04:00 | 停止 | 停止 | 不許可（キャッシュ読取のみ） |

04:00の再開ではXML・雨雲索引・キキクル索引・アメダスを各1回投入する。画像は起動・境界・再開を契機に取得しない。XMLと索引の初期周期が同じでも、恒久連動・同時完了・同じnextRunAt・XMLバックオフの共有を意味しない。各索引ジョブは独立し、XMLの遅延・失敗で停止しない。

### 3.2 外部YAMLと反映方法

【確定】リポジトリルートの config/polling.yaml を運用設定とする。設定ファイルを編集してAPIプロセスを再起動すれば反映し、設定変更に再ビルドは不要。TypeScript側に運用値の予備定数を残さず、画面・REST・環境変数からの設定上書き、ホットリロードは行わない。

```yaml
timezone: Asia/Tokyo
amedasPointRecheckSeconds: 600
freshness:
  xml:
    staleAfterSeconds: 300
  imageCatalog:
    staleAfterSeconds: 300
periods:
  - start: "04:00"
    end: "05:00"
    xmlSeconds: 120
    imageCatalogSeconds: 120
    amedasSeconds: 300
    nowcastEnabled: true
    kikikuruEnabled: true
  - start: "05:00"
    end: "18:00"
    xmlSeconds: 60
    imageCatalogSeconds: 60
    amedasSeconds: 60
    nowcastEnabled: true
    kikikuruEnabled: true
  - start: "18:00"
    end: "20:00"
    xmlSeconds: 120
    imageCatalogSeconds: 120
    amedasSeconds: 300
    nowcastEnabled: true
    kikikuruEnabled: true
  - start: "20:00"
    end: "04:00"
    xmlSeconds: null
    imageCatalogSeconds: null
    amedasSeconds: null
    nowcastEnabled: false
    kikikuruEnabled: false
```

xmlSecondsはXML通常、imageCatalogSecondsは雨雲索引・キキクル索引共通の周期である。それぞれnullなら対応対象だけ定期停止、数値ならその対象に秒数を適用する。初期値は同じだが、一方を変更しても他方に影響しない。nowcastEnabled / kikikuruEnabledは画像本体のオンデマンド取得許可だけを表し、索引の定期取得を制御しない。

夜間も日中主時間帯と同じ方針にするには20:00〜04:00のxmlSeconds / imageCatalogSeconds / amedasSecondsをそれぞれ60にし、nowcastEnabled / kikikuruEnabledをtrueにする。これは変更方法の例であり既定値変更ではない。xmlSecondsだけ数値ならXMLだけ、imageCatalogSecondsだけ数値なら両索引だけが稼働する。画像許可がfalseなら画像上流取得は停止したままとなる。

鮮度設定もXML用と画像索引用を別キーにする（§5.2）。両方300秒を初期値として明記するが、値の等しさを検証で強制せず、一方の編集が他方へ影響しない。

### 3.3 内部型・YAML読み込み

固定4モード（early / busy / late / off_hours）は廃止し、外部形式と同じ時間帯配列を内部でも使用する。periodsの位置や時刻から固定モード名を割り当てない。時間帯は start / end で識別し、既定4区間に加えて分割・統合も可能とする。§3.1の時間帯名は既定値の説明用であり実装キーではない。

```ts
export type ScheduledSource = 'xml' | 'nowcast' | 'kikikuru' | 'amedas';
export type OnDemandSource = 'nowcast' | 'kikikuru';
export type JstTime = `${number}:${number}`;
export interface PollingPeriod {
  readonly start: JstTime;
  readonly end: JstTime;
  readonly xmlSeconds: number | null;
  readonly imageCatalogSeconds: number | null;
  readonly amedasSeconds: number | null;
  readonly nowcastEnabled: boolean;
  readonly kikikuruEnabled: boolean;
}
export interface PollingScheduleConfig {
  readonly timezone: 'Asia/Tokyo';
  readonly amedasPointRecheckSeconds: number;
  readonly periods: readonly PollingPeriod[];
  readonly freshness: FreshnessConfig; // §5.2の固定秒ポリシー
}
export function loadPollingScheduleConfig(
  configUrl?: URL,
): PollingScheduleConfig;
export function validatePollingScheduleConfig(
  value: unknown,
): PollingScheduleConfig;
export function resolvePollingPeriod(
  now: Date, schedule: PollingScheduleConfig,
): PollingPeriod;
export function getNextPeriodChangeAt(
  now: Date, schedule: PollingScheduleConfig,
): Date;
```

apps/api/src/config/pollingSchedule.ts に内部型・検証・解決を残し、同階層 pollingScheduleLoader.ts に読込を分離する。既定URLはloader内の new URL('../../../../config/polling.yaml', import.meta.url) とする。src/config と dist/config のどちらからもリポジトリルートの同じ外部ファイルへ到達し、process.cwd()へ依存しない。テスト用URL注入を許可するが、通常起動は既定URLのみ使用する。

loaderはUTF-8読込 → YAML単一文書の解析 → unknownとして厳密検証 → 検証済み設定返却の順に処理する。startServer / mainの双方でDB初期化・HTTP待受・外部取得より前に完了させる。ファイルなし・読込失敗・構文不正・検証不正はパスと原因が分かるエラーで起動失敗とし、既定値へのフォールバックをしない。設定はプロセス中に再読込せず同じ値を各サービスへ注入する。

既存node_modules/js-yaml 4.3.2を実物調査し、load(text, { schema: CORE_SCHEMA, json: false }) が利用可能であることを確認した。短い実行確認で、quoted HH:mmをstring、nullとbooleanを対応する値として読み、重複マッピングキーと複数YAML文書を拒否することを確認済み。製造時にjs-yamlをapps/apiの直接production dependencyに追加し、必要な型定義をdev dependencyに追加する。現在の推移依存だけには依存しない。DEFAULT_SCHEMAの暗黙日付解釈は使わず、JSON化による型の矯正もしない。

配布時は config/polling.yaml を外部ファイルとして同梱する。distへの埋め込みやビルド時コピーにより運用編集内容を上書きしない。配布レイアウトでも apps/api/dist/config とルートconfigの相対位置を維持する。READMEに配置・編集・再起動・ファイル不在時の起動失敗を記載する。設定ファイルの初回追加には通常のアプリ製造・ビルドが必要だが、その後の運用値変更は再ビルド不要である。

検証規則:

- ルートは timezone / amedasPointRecheckSeconds / freshness / periods の4キー、各periodは上記7キーが過不足なく存在するplain object。mode、旧intervalsSeconds等の未知キーも拒否する。YAML重複キーはparser段階で拒否する。freshness内はxml / imageCatalog、その各値はstaleAfterSecondsだけを持つobjectとし、過不足・型違いを拒否する。staleAfterSecondsは正の有限整数かつ秒からミリ秒への変換結果も安全な整数であることを検証する。xmlとimageCatalogに異なる値を許可する。
- timezoneはAsia/Tokyo固定。periodsは空でない配列。start/endは実在するquoted HH:mmとして記載し、読込後string型かつ正規形式を検証する。start=endは曖昧な全日指定として拒否する。24時間運転を指定する場合も2つ以上の非零長区間へ分ける。
- 日跨ぎ区間を0時で分割して検査し、24時間に重複・欠落がないことを確認する。配列順序には依存しない。全区間を同じ方針にする場合も正常に受理する。
- 全区間共通で各周期はnullまたは1〜86,400の有限整数秒。文字列の数値、NaN、Infinity等を拒否する。夜間数値と日中nullを許可し、時刻・名前から停止を推定しない。
- nowcastEnabled / kikikuruEnabledはboolean必須。amedasPointRecheckSecondsは正の有限整数必須で、省略時600への暗黙フォールバックを行わない。
- 全区間停止も有効。次回再開が存在しないことをnullで表す。

### 3.4 方針参照と次回再開

設定を検証後、スケジューラ・画像サービス・server が同じ設定と時計を共有する。

```ts
export interface UpstreamAccess {
  readonly allowed: boolean;
  readonly period: PollingPeriod;
  readonly nextAllowedAt: UtcIso8601String | null;
}
export function resolveOnDemandAccess(
  source: OnDemandSource, now: Date, schedule: PollingScheduleConfig,
): UpstreamAccess;
export type AcquisitionTarget =
  | { readonly kind: 'scheduled'; readonly source: ScheduledSource }
  | { readonly kind: 'image'; readonly source: OnDemandSource };
export function getNextEnabledAt(
  target: AcquisitionTarget,
  now: Date, schedule: PollingScheduleConfig,
): Date | null;
```

定期xmlは現在periodのxmlSeconds、定期nowcast / kikikuruはimageCatalogSeconds、定期amedasはamedasSeconds、画像はnowcastEnabled / kikikuruEnabledを参照する。getNextEnabledAtのtarget.kindで同名の索引と画像を区別し、resolveOnDemandAccessは画像許可だけを返す。索引の許可状態はimageCatalogSecondsから別途組み立てる。getNextEnabledAtは現在許可ならnow、停止なら翌日までの全設定境界を時系列に評価して最初の許可開始を返す。全時間帯停止ならnull。04:00や「次の時間帯境界」を再開時刻として固定しない。例えば04:00〜05:00も停止なら次回は05:00であり、20:00〜04:00が稼働なら20:00で停止しない。

## 4. XML・索引・アメダスのスケジューラ

### 4.1 構成と状態

TimeBasedPollingSchedulerのScheduledSourceと状態マップはxml / nowcast / kikikuru / amedasの4対象を維持する。ScheduledPollAdapterはnowcast / kikikuru / amedasを各1つ要求し、重複・欠落・未知対象を拒否する。XMLは既存xmlPollingServiceを別注入する。NowcastScheduledAdapter / KikikuruScheduledAdapterは共用サービスのrefreshTimes({ triggerKind: 'scheduled' })を呼び、画像は取得しない。XMLはxmlSeconds、両索引はimageCatalogSecondsを参照し、鮮度はYAMLのXML用・索引用ポリシーをそれぞれ注入し、factory側に300秒のフォールバックを残さない。

start / stop / getStatus の入口を維持する。返却状態のmodeをperiod: PollingPeriodへ、nextModeChangeAtをnextPeriodChangeAtへ変更し、未実装の後続監視も新しい型を参照する。状態は waiting / running / scheduled_stopped とし、intervalSeconds が null の対象だけ scheduled_stopped にする。取得中以外のnon-XML対象は各自の完了時刻＋適用周期をnextRunAtとするため、共通周期でも予定時刻は異なり得る。停止対象の nextRunAt は getNextEnabledAt({ kind: 'scheduled', source }, ...)、全日停止または明示 stop 後は null とする。nextPeriodChangeAt は設定上の次境界であり次回取得時刻とは区別する。

### 4.2 投入・境界・再開

- XMLの初期4フィードは、当該時刻のxml周期が非nullになって初めて start する。夜間起動でも設定でxmlを許可すれば直ちに開始する。保存済み現況の再構成は外部取得ではなく従来どおり行う。
- 起動時とnull → 数値への境界で、許可された雨雲索引・キキクル索引・アメダスをそれぞれ1回即時投入する。non-XMLはXML初期取得完了を待たない。XMLは初期未着手なら start() で初期取得、初期完了なら start({ immediateScheduled: true }) で通常取得を即時投入する。初期失敗状態の start() は既存 scheduleNextCycle に復帰するため、失敗フィードの nextAllowedFetchAt を尊重し、未到達なら即時HTTPを強制しない。初期実行中の境界競合では処理完了を共有・待機し、初期取得を再投入しない。
- 数値 → null は新規投入とXMLの通常/recovery予約を停止する。開始済み処理は中断せず完了・保存する。
- 数値 → 数値は適用周期を切り替える。non-XML各対象は完了時刻から新周期で1本だけ再予約する。
- 境界をまたぐ雨雲索引・キキクル索引・アメダスの各 in-flight Promise は共有し、新世代で完了後の再予約を引き継ぐ。古い世代の完了callbackだけに任せて予約を失う退行を防ぐ。
- stop は全定期タイマーを無効化し、実行中処理を待つ。明示停止を境界で自動解除しない。再度 start した時刻に設定を再評価する。
- XML通常周期と nextAllowedFetchAt の調停、失敗フィード限定recoveryは #23 の単一タイマーが所有する。C14に別のXML再試行タイマーを追加しない。

定期ジョブが停止境界前に始まった場合は、従来どおりそのジョブを完了させる（ジョブ内の後続HTTPを含む）。オンデマンド要求は §5.3 の規則でHTTP開始ごとに判定する。停止境界後の新しい定期ジョブ・再試行は0件とする。

### 4.3 アメダス再確認

latest_time.txt を周期ごとに確認し、通常は onLatestTimeChange、最後に地点データを実際に試行した開始時刻から600秒以上経過した回は always を渡す。result.pointData.attempted が true のときだけ lastPointFetchStartedAtMs を更新する。latest_time取得失敗で地点未試行なら時刻を更新しない。次の回復時には同じlatest_timeでも地点再確認を試みる。east の単一会場前提は維持する。

## 5. 雨雲・キキクルの索引と画像

### 5.1 到達入口とサービス共用

既存NowcastService / KikikuruServiceを索引定期取得と画像要求の双方で共用する。閲覧側はreadCatalogで保存済み索引を参照し、選択後にfetchFrameTilesを呼ぶ。readCatalogはHTTPを行わず、閲覧のたびにrefreshTimesを要求しない。索引未取得・初回取得中なら保存値なしをunavailableとして返し、閲覧を契機に定期周期を上書きしない。

```ts
// 両サービスのOptionsに追加する取得許可の内部契約
readonly getCatalogAccess: () => UpstreamAccess; // imageCatalogSecondsによる索引許可
readonly getImageAccess: () => UpstreamAccess; // *Enabledによる画像許可
readonly freshnessPolicy: FreshnessPolicy; // freshness.imageCatalogを注入
// 従来のレイヤー別staleAfterMsはこの索引共通ポリシーへ置き換える。

// 両Catalogに追加する取得許可状態
readonly catalogAccess: UpstreamAccess;
readonly imageAccess: UpstreamAccess;

// 公開入口は既存署名を維持
refreshTimes(options?: NowcastAttemptOptions): Promise<NowcastCatalog>;
readCatalog(): NowcastCatalog;
fetchFrameTiles(
  frame: NowcastFrameKey,
  coordinates: readonly TileCoordinate[],
  options?: NowcastAttemptOptions,
): Promise<readonly NowcastTileResult[]>;
// Kikikuruも対応する既存型で同じ3入口を持つ。
```

索引はtriggerKind: 'scheduled'、画像閲覧要求は既存の'manual'で通信履歴を記録する。キャッシュ読取・スケジュール停止のみでは通信失敗履歴を捏造しない。索引・画像許可関数は必須注入し、停止時間の直接呼出しでも設定を参照する。両取得許可のnextAllowedAtは、それぞれscheduled / imageのtargetで求める。

### 5.2 鮮度設定・判定（承認済み）

XMLと画像索引は固定秒方式とし、freshness.xml.staleAfterSeconds / freshness.imageCatalog.staleAfterSecondsの初期値をそれぞれ300にする。設定は独立し、雨雲N1/N2・キキクル3レイヤーはimageCatalog側を共用する。アメダスの鮮度設定は変更しない。300秒は今回ユーザーが承認した運用初期値であり、実測最適値・上流提供保証ではない。basic-design.md §8.1の未確定な周期×3を採用したものではない。

apps/api/src/polling/freshnessPolicy.tsに判定コードを共通化する。

```ts
export interface FreshnessPolicy {
  readonly staleAfterSeconds: number;
}
export interface FreshnessConfig {
  readonly xml: FreshnessPolicy;
  readonly imageCatalog: FreshnessPolicy;
}
export interface FreshnessInput {
  readonly now: UtcIso8601String;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly latestAttemptFailed: boolean;
}
export function evaluateFreshness(
  input: FreshnessInput, policy: FreshnessPolicy,
): Availability;
```

判定は次の優先順位で完全に定義する。

1. lastSuccessAtがnullならunavailable。初期未取得・初回取得失敗も含む。
2. 正常取得歴がありlatestAttemptFailedがtrueなら経過時間にかかわらずstale。
3. それ以外は now - lastSuccessAt が staleAfterSeconds × 1,000 以上ならstale、未満ならavailable。

固定300秒なら299,999 msはavailable、300,000 msはstale。失敗回数を許容する設定ではなく、最後の正常取得からの時間と直近失敗を評価する。時刻は既存clockのUTC時刻を使い、負の経過時間も閾値未満として扱う。

夜間停止中も同じ計算を続ける。停止時刻を起点にせず、時計を凍結せず、停止だけで即座に一律staleにしない。scheduledStoppedは判定入力に含めず、取得許可状態で別途表現する。readCatalog/getStatusの読取でDB・lastSuccessAt・fetchedAtを書き換えない。

#### 索引への結線

NowcastOptions / KikikuruOptionsにfreshnessPolicy: FreshnessPolicyを必須注入し、従来のレイヤー別staleAfterMsを置き換える。N1/N2とキキクル各レイヤーはそれぞれの保存lastSuccessAtと直近の取得成否を入力にする。readCatalogは共通関数でavailabilityを評価し、HTTPなしで保存値を参照することをstaleの理由にしない。

既存の「直近取得失敗なら保存availability=stale、成功ならavailable」をlatestAttemptFailedの入力として利用できる。経過時間だけのstaleをDBへ書き戻さず、直近失敗と混同しない。未取得はlastSuccessAt=nullを優先する。正常な空索引も成功として保存し、失敗時は前回フレーム・lastSuccessAtを保持する。画像の成功/失敗で索引の最終成功・成否を変更しない。

#### XMLへの結線と公開型

JmaXmlPollingServiceOptionsにfreshnessPolicy: FreshnessPolicyを必須注入し、serverはfreshness.xmlを渡す。通常のregular / extraだけをそれぞれ評価する。既存のgetStatus().feedStatusesからlastSuccessAtとconsecutiveFailuresを読み、latestAttemptFailed = consecutiveFailures > 0とする。成功でconsecutiveFailuresが0へ戻る既存契約を利用し、最終失敗時刻の大小から直近成否を推測しない。

recordSuccess後も過去のlastFailureAtは残るため、lastFailureAtが非nullという理由だけでstaleにしてはならない。回復テストではlastFailureAtが残った状態でavailableへ戻ることを確認する。constructorのoptions省略や既存テストの省略注入も改訂し、明示的なポリシーを必ず受ける。設定未注入を300秒の既定値で隠さない。

```ts
export interface XmlFeedFreshnessStatus {
  readonly availability: Availability;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly staleAfterSeconds: number;
}
export interface JmaXmlPollingStatus {
  // 既存isRunning / initialFetch / lastCycleResult / feedStatusesを維持
  readonly feedFreshness: Readonly<
    Record<'regular' | 'extra', XmlFeedFreshnessStatus>
  >;
}
```

getStatusで同じnowを取得し、feedStatusesとfeedFreshnessを組み立てる。regular_l / extra_lは既存feedStatusesに残すが、feedFreshnessへ追加せず、通常2フィード用の鮮度閾値を適用しない。XML全体availabilityの集約フィールドは追加しない。初期4フィードが未完了でもregularが正常取得済みならそのフィードを個別に評価し、未成功のextraはunavailableとする。初期完了状態は既存initialFetchが別に表す。

フィードの取得鮮度は、個別気象警報が現在有効か解除済みかとは別概念である。この判定から警報DBを書き換えたり解除を発生させたりしない。#23のバックオフ、失敗集合、nextAllowedFetchAt、タイマー、初期/recovery処理も変更しない。

### 5.3 画像取得・停止境界

既存の保存索引との完全一致、雨雲の表示窓、要素/member、座標・許可zoom、PNG/ハッシュ検証、重複座標の順序維持は変更しない。自由な上流URLを受け付けない。

【確定】索引の鮮度判定と画像取得許可を分離する。検証済みキャッシュは許可時・停止時とも返す。画像キャッシュミスでは索引staleだけを理由に拒否せず、保存索引にある有効フレームなら画像上流取得を試みる。不存在やHTTP失敗は既存画像失敗結果で返す。kind: downloaded / cachedが画像結果、availabilityは索引状態を表す。この分離もユーザー承認済みである。画像HTTP失敗は画像結果として返し、索引availabilityへ書き戻さない。

画像はgetImageAccessをキュー投入時だけでなく各キャッシュミスHTTP開始直前に評価し、停止後の未開始HTTPを行わない。画像結果はkind: unavailable / errorKind: 'scheduled_stopped'。既に開始したHTTPは完了・保存を許可し、破損キャッシュも停止中は再取得しない。

索引refreshTimesはジョブ開始時にgetCatalogAccessを評価する。許可中に開始した定期ジョブは§4.2どおり完了を許可し、停止後に新しい索引ジョブを開始しない。拒否時は保存索引の読取結果を返し、そのavailabilityは§5.2の規則による。

同一索引ジョブの重複はschedulerの対象別in-flightで防ぐ。閲覧はreadCatalogなので追加索引ジョブを生成しない。同一画像は既存直列化と保存後キャッシュ確認で成功時の重複取得を防ぎ、失敗後の独立再要求は新たな試行としてよい。索引更新と画像取得は同じサービスの既存キューを利用し、保存索引・キャッシュの競合制御を別インスタンスに分裂させない。

## 6. server結線と変更対象

server.ts の startServer / main 双方の mode === 'off_hours' による開始分岐を取り除き、検証済み設定から各対象の許可を判断する共通compositionを使用する。XMLをserver側とscheduler側で二重開始しないよう、開始責務をschedulerに集約する。

索引・画像共用サービスを独立したfactory（例:createImageServices）で各1インスタンス生成・保持し、createScheduledAdaptersへ同じインスタンスを渡す。StartedServerにimageServices（nowcast / kikikuru）を公開し、保存索引読取と画像要求の入口として利用する。startServerのテストから索引adapterと要求側の共用結線を検証する。mainも同じfactoryと設定・時計を使用する。サービス生成だけでは取得せず、索引の開始はschedulerが担う。キャッシュrootは現factoryの path.resolve(process.cwd(), 'data/cache/nowcast') / path.resolve(process.cwd(), 'data/cache/kikikuru') を維持し、allowedZooms: [10]も今回変更しない。

内部compositionは `{ nowcast: NowcastService, kikikuru: KikikuruService, close(): Promise<void> }` を返す。各サービスに `waitForIdle(): Promise<void>` を追加し、closeは先に共有許可を閉じて新規投入を停止してから、schedulerの実行中索引ジョブと既存サービスキューの終了を待つ。サーバー終了後のサービス呼出しはDB参照前に終了済みエラーとし、キャッシュ読取も受け付けない。

enablePolling: false / DISABLE_POLLING=true は既存定期停止を維持する。内部オンデマンドサービスを生成する場合も上流許可をfalseにし、テストや無通信起動が意図せずネットワーク取得しない。close開始時にも許可をfalseにし、実行中サービス処理が終了してからDBを閉じる。アプリHTTPへの結線はE7/E8で行う。

| ファイル | 変更 |
| --- | --- |
| config/polling.yaml（リポジトリルート、新規） | 外部運用設定、既定4時間帯 |
| apps/api/src/config/pollingSchedule.ts、pollingScheduleLoader.ts（新規） | 時間帯配列型、厳密検証、YAML読込、次回許可計算 |
| polling/timeBasedPollingScheduler.ts | 4定期対象維持、XML・索引の独立周期、対象別停止・予定、任意境界、共用サービス注入 |
| polling/nowcastService.ts、kikikuruService.ts | 索引と画像の許可分離、共用インスタンス、固定秒鮮度判定の結線 |
| polling/freshnessPolicy.ts（新規候補） | XML・索引用の共通判定コード、独立設定注入（XML・索引それぞれ初期300秒） |
| polling/jmaXmlPollingService.ts | 必須ポリシー注入、regular/extraのfeedFreshness公開。backoff・DB更新規則は変更しない |
| polling/nowcastTypes.ts、kikikuruTypes.ts | 索引・画像の必須許可関数とCatalog状態、固定秒ポリシー型 |
| polling/imageServices.ts（新規候補） | 索引・画像共用サービスcompositionと終了待機を集約 |
| polling/index.ts、server.ts | export、両起動経路の起動前設定読込・共通結線・終了処理 |
| apps/api/package.json、package-lock.json、README.md | YAML直接依存・型、外部設定の配布・変更手順 |
| apps/api/tests の既存関連テストと追加統合テスト | 改訂契約・レビュー回帰を検証 |

DB schema / repositories / packages/shared / apps/web / REST endpoint は変更しない。XMLサービスは既存lifecycle・周期供給・公開フィード状態を利用する。鮮度の共通判定へ公開状態を接続し、#23の取得・backoff自体は変更しない。

## 7. 製造手順と受け入れ条件

設定・scheduler変更、共用サービスと鮮度判定の結線、統合検証の順に行う。本書の製造方針はユーザー承認済みで追加承認は不要。共通関数の単体テストだけで済ませず、XMLと索引の実サービス状態を使って結線を検証する。fake clock/timer、fixture fetch、一時DBを用い、実上流・実運用DBを使わない。

1. JST 04:00 / 05:00 / 18:00 / 20:00 / 00:00 / 03:59:59.999 の時間帯start/end、XML・両索引・アメダス周期、画像許可が §3.1 と完全一致する。
2. 閲覧なしで起動・境界・1日分のtimerを進める。XML通常と両索引が120/60/120秒、アメダスが300/60/300秒で動作し、画像HTTPは0回。索引はXMLが失敗・長時間実行中でも独立して取得する。non-XMLは各自の完了時刻＋周期の次回予定が一致する。
3. 既定夜間起動で全上流HTTPは0回。04:00でXML初期4フィード各1回、雨雲索引N1/N2各1回、キキクル索引1回、アメダス1回だけ開始する。索引はXML初期完了を待たず、画像HTTPは依然0回。
4. XML周期だけ変更して索引周期が変わらず、索引周期だけ変更してXML周期が変わらないことを確認する。20:00〜04:00のxmlSeconds / imageCatalogSeconds / amedasSecondsを数値へ変更すると各対象が夜間起動で取得する。それぞれnullならXML / 両索引 / アメダスだけが停止する。画像Enabledのfalse/trueは索引回数を変えず画像HTTPだけを制御する。04:00〜05:00も停止にすると次回予定は05:00、全日停止ならnull。境界時刻を編集した設定でも04:00固定が残らない。
5. 設定の未知/欠落/重複キー、旧画像周期キー、複数YAML文書、範囲重複/欠落、非boolean、0・NaN・Infinity・小数・範囲外周期を拒否する。日中null、夜間数値、全日停止は受理する。区間の順序入替え・分割と統合（零長区間以外）でも同じ時刻の判定が一致する。
6. 境界とtimer callbackの同tick競合、長時間の各non-XML実行、明示stop/startを実行する。重複投入0回、古い世代callback投入0回、境界をまたいだ完了後に新周期timerが1本。stop後は境界でも取得0回。
7. XMLの実サービス＋fixtureで初期4フィード、高頻度通常2フィード、失敗フィードだけrecovery、バックオフ時刻、単一timerを確認する。C12/C13の正常・訓練・試験分離と現況再構成の既存テストを通す。
8. アメダス時刻不変で10分再確認。10分目のlatest_time失敗で地点未試行、11分目の復旧では同時刻でも地点再確認する。時刻更新時も取得する。
9. 閲覧でreadCatalogを複数回呼んでも索引HTTPが増えない。schedulerの雨雲N1/N2各1回・キキクル索引1回の更新が同じサービスのreadCatalogに反映され、保存フレームをfetchFrameTilesで取得できる。
10. 共通判定でlastSuccessAt=nullは未取得/失敗ともunavailable、正常値あり直近失敗は即stale、正常取得後299,999 msはavailable、300,000 msはstaleと完全一致する。freshness.xmlを600へ変更して同じ300,000 msでXMLだけavailableになり、索引はstaleのまま。逆にimageCatalogだけ600へ変更すると索引だけavailableになる。既定値は双方300。
11. JmaXmlPollingServiceとNowcastService / KikikuruServiceの実インスタンス、fixture取得・一時DB・注入clockで上記境界を再現する。XMLはregular成功/extra初回失敗でavailable/unavailable、その後extra成功でavailable、成功後の失敗でstale、回復成功でavailable。索引もN1/N2・キキクル各レイヤーで初回失敗/成功/失敗/回復を確認する。夜間に時計を進めても最後の正常取得から299,999/300,000 msで判定し、停止直後の一律staleや停止起点への変更がない。getStatus/readCatalogでDB時刻・警報状態・backoff予定が変わらず、feedFreshnessにregular/extraの2キーだけが存在し、XML全体availabilityを追加していないことを確認する。
12. 索引失敗または閾値到達でstaleとなった保存索引の有効フレームについて、画像許可中はキャッシュミス画像を取得する。画像HTTP失敗は画像結果だけに反映し、索引availability / lastSuccessAtを変更しない。正常空一覧の成功保存と読取時DB無変更も確認する。
13. 夜間のrefreshTimes / fetchFrameTiles直接呼出しで上流0回。正常キャッシュはcached、未取得/破損キャッシュはscheduled_stopped。画像のキュー待ちや複数座標の途中で20:00を越えた場合も未開始画像HTTPが0回、開始済み画像HTTPは完了できる。開始済み索引ジョブは完了を許可するが新規索引ジョブは0回。
14. 不正フレーム・範囲外座標・不正PNG・破損キャッシュ・順序/重複・保存失敗後始末の既存C10/C11テストを新しい契約で通す。
15. startServer経由のimageServicesで日中取得・夜間停止・カスタム夜間許可を確認する。mainの共通compositionも同じ設定解決を使用する。無通信起動とclose後は新規HTTP0回、終了待機中にDBを先に閉じない。
16. 一時YAMLを用いてsrc/distのloaderがcwdをリポジトリroot・apps/api・一時ディレクトリへ変えても同じ既定URLを解決することを確認する。既定設定本体をテストで書き換えず、URL注入で設定編集→プロセス再起動のみの値反映を検証する。ファイルなし・構文不正・検証不正ではDB/待受/上流呼出しが0回で起動に失敗する。既定YAMLとdistの配布配置も検査する。
17. npm run build / typecheck / lint / format:check、およびnpm run test -w apps/apiを通す。

新しい重要テストは、意味を変えない表示ラベル変更で成功を維持する対照実験後に、(a)停止判定を外す、(b)20:00〜04:00停止を設定によらず固定する、(c)索引staleによる画像拒否を戻す、(d)境界in-flight完了の再予約を外す、(e)地点未試行でも時刻更新する、に加え、(f)鮮度境界を>=から>へ変更、(g)XML/索引の注入ポリシーを取り違える、の対応ミューテーションでredを確認する。一時変更・一時ファイルを残さない。

## 8. 後続への引き継ぎ・未確認事項

- 取得周期・鮮度の独立設定、固定300秒の初期値、夜間も経過時間判定、画像取得分離は承認済み。製造前に追加判断を必要とする事項はない。後続UI/RESTの未確定事項を本Issueの製造停止条件にしない。
- E7/E8は共用サービスのreadCatalog / fetchFrameTilesへRESTを結線する。自由URLプロキシにしない。F2/F3は保存索引参照→選択→画像要求の順に接続し、catalogAccess / imageAccess / availability / lastSuccessAtを表示判断へ使う。
- 【未確定・後続確認】画面の保存索引再読込・表示中の自動更新頻度はUI/API設計時に決める。サーバー上流の索引周期は今回確定しており、画面更新のたびにrefreshTimesを呼び出さない。
- K6/E10は現在periodと実際の許可を参照し、固定モード名を復活させない。XML・索引・アメダスそれぞれのnextRunAtを表示できる状態にする。画像には定期nextRunAtを設定しない。
- E11の手動強制更新・復旧選択、設定ホットリロードは未設計。現在の停止設定を迂回する入口を本Issueで作らない。
- C10/C11既存設計の鮮度契約は本書§5.2の固定秒・索引共通ポリシーで更新する。基本設計§8.3の索引周期案は本ヒアリングのXMLと初期同値・独立変更可能な周期へ更新するが、画像本体の定期取得は行わない。
- 実上流による夜間復帰・古い画像の取得可能期間は実挙動未確認。保存フレームの存在は上流画像の存続保証ではなく、失敗を通常結果として扱う。

設計改訂: Codex (GPT-6)
