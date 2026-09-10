import type { Availability, BosaiBulletinAreaCode, UtcIso8601String } from '@wx-viewer-poc/shared';

export type ControlStatus = 'normal' | 'training' | 'test';

export interface SnapshotMetadataInput {
  readonly source: string;
  readonly issuedAt: UtcIso8601String;
  readonly validAt: UtcIso8601String | null;
  readonly validFrom: UtcIso8601String | null;
  readonly validTo: UtcIso8601String | null;
  readonly fetchedAt: UtcIso8601String;
  readonly lastSuccessAt: UtcIso8601String | null;
  readonly availability: Availability;
  readonly sourceVersion: string | null;
}

export interface TelegramMetadataInput {
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
}

// 1. 現況警報
export interface WarningCurrentItemInput {
  readonly sequence: number;
  readonly kindCode: string;
  readonly kindName: string;
  readonly kindStatus: string;
  readonly lastKindCode: string | null;
  readonly lastKindName: string | null;
  readonly significancyCode: string | null;
  readonly significancyName: string | null;
  readonly warningLevel: string | null;
  readonly attentionText: string | null;
  readonly kindIssuedAt: UtcIso8601String | null;
  readonly sourceTelegram: string;
}

export interface WarningCurrentItem extends WarningCurrentItemInput {
  readonly id: number;
}

export interface WarningCurrentSnapshotInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly items: readonly WarningCurrentItemInput[];
}

export interface WarningCurrentSnapshot {
  readonly id: number;
  readonly areaCode: string;
  readonly areaName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly items: readonly WarningCurrentItem[];
}

// 2. 警報等時系列
export interface WarningTimeseriesTimeDefineInput {
  readonly blockId: string;
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface WarningTimeseriesTimeDefine extends WarningTimeseriesTimeDefineInput {
  readonly id: number;
}

export interface WarningTimeseriesValueInput {
  readonly blockId: string;
  readonly refId: string;
  readonly kindCode: string | null;
  readonly kindName: string | null;
  readonly kindStatus: string;
  readonly kindDateTime?: UtcIso8601String | null;
  readonly valueCategory: string;
  readonly propertyType: string;
  readonly valueType: string;
  readonly valueCode?: string | null;
  readonly valueText: string;
  readonly unit: string | null;
  readonly description?: string | null;
  readonly condition?: string | null;
  readonly areaDivision: string | null;
  readonly sequence: number;
}

export interface WarningTimeseriesValue extends WarningTimeseriesValueInput {
  readonly id: number;
  readonly kindDateTime: UtcIso8601String | null;
  readonly valueCode: string | null;
  readonly description: string | null;
  readonly condition: string | null;
}

export interface WarningTimeseriesSnapshotInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly WarningTimeseriesTimeDefineInput[];
  readonly values: readonly WarningTimeseriesValueInput[];
}

export interface WarningTimeseriesSnapshot {
  readonly id: number;
  readonly areaCode: string;
  readonly areaName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly WarningTimeseriesTimeDefine[];
  readonly values: readonly WarningTimeseriesValue[];
}

export const VPWP50_TELEGRAM_TYPE = 'VPWP50' as const;

export interface WarningTimeseriesTargetArea {
  readonly municipalCode: string;
  readonly displayName: string;
}

export interface ParsedVpwp50TimeDefine {
  readonly blockId: string;
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface ParsedVpwp50Value {
  readonly blockId: string;
  readonly refId: string;
  readonly kindStatus: string;
  readonly kindDateTime: UtcIso8601String | null;
  readonly kindCode: string | null;
  readonly kindName: string | null;
  readonly valueCategory: 'risk' | 'quantity';
  readonly propertyType: string;
  readonly valueType: string;
  readonly valueCode: string | null;
  readonly valueText: string;
  readonly unit: string | null;
  readonly description: string | null;
  readonly condition: string | null;
  readonly areaDivision: string | null;
  readonly sequence: number;
}

export interface ParsedVpwp50 {
  readonly area: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly ParsedVpwp50TimeDefine[];
  readonly values: readonly ParsedVpwp50Value[];
}

export type Vpwp50ParseResult =
  | { readonly ok: true; readonly value: ParsedVpwp50 }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

// 3. 早期注意情報
export type EarlyWarningSegment = 'near' | 'far';

export interface EarlyWarningTimeDefineInput {
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface EarlyWarningTimeDefine extends EarlyWarningTimeDefineInput {
  readonly id: number;
}

export interface EarlyWarningCellInput {
  readonly refId: string;
  readonly phenomenonCode: string;
  readonly phenomenonName: string;
  readonly rankValue: string | null;
  readonly condition: string | null;
}

export interface EarlyWarningCell extends EarlyWarningCellInput {
  readonly id: number;
}

export interface EarlyWarningSnapshotInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly segment: EarlyWarningSegment;
  readonly telegramType: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly EarlyWarningTimeDefineInput[];
  readonly cells: readonly EarlyWarningCellInput[];
}

export interface EarlyWarningSnapshot {
  readonly id: number;
  readonly areaCode: string;
  readonly areaName: string;
  readonly segment: EarlyWarningSegment;
  readonly telegramType: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly EarlyWarningTimeDefine[];
  readonly cells: readonly EarlyWarningCell[];
}

export const VPFD61_TELEGRAM_TYPE = 'VPFD61' as const;
export const VPFW60_TELEGRAM_TYPE = 'VPFW60' as const;

export interface EarlyWarningTargetArea {
  readonly forecastAreaCode: string;
  readonly displayName: string;
}

export interface ParsedEarlyWarning {
  readonly segment: 'near' | 'far';
  readonly telegramType: 'VPFD61' | 'VPFW60';
  readonly area: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly EarlyWarningTimeDefineInput[];
  readonly cells: readonly EarlyWarningCellInput[];
}

export type EarlyWarningParseResult =
  | { readonly ok: true; readonly value: ParsedEarlyWarning }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

// 4. 地域時系列予報
export interface AreaTimeseriesTimeDefineInput {
  readonly blockId: string;
  readonly timeId: string;
  readonly sequence: number;
  readonly timeFrom: UtcIso8601String;
  readonly timeTo: UtcIso8601String;
  readonly duration: string | null;
}

export interface AreaTimeseriesTimeDefine extends AreaTimeseriesTimeDefineInput {
  readonly id: number;
}

export interface AreaTimeseriesValueInput {
  readonly blockId: string;
  readonly refId: string;
  readonly element: string;
  readonly valueCode: string | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly sequence: number;
}

export interface AreaTimeseriesValue extends AreaTimeseriesValueInput {
  readonly id: number;
}

export interface AreaTimeseriesSnapshotInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly stationCode: string;
  readonly stationName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly AreaTimeseriesTimeDefineInput[];
  readonly values: readonly AreaTimeseriesValueInput[];
}

export interface AreaTimeseriesSnapshot {
  readonly id: number;
  readonly areaCode: string;
  readonly areaName: string;
  readonly stationCode: string;
  readonly stationName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly telegram: TelegramMetadataInput;
  readonly timeDefines: readonly AreaTimeseriesTimeDefine[];
  readonly values: readonly AreaTimeseriesValue[];
}

export const VPFD51_TELEGRAM_TYPE = 'VPFD51' as const;

export interface AreaTimeseriesForecastTarget {
  readonly forecastAreaCode: string;
  readonly forecastAreaName: string;
  readonly temperatureStationCode: string;
  readonly temperatureStationName: string;
}

export interface ParsedVpfd51 {
  readonly area: { readonly code: string; readonly name: string };
  readonly station: { readonly code: string; readonly name: string };
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly eventId: string | null;
  readonly controlDateTime: UtcIso8601String;
  readonly reportDateTime: UtcIso8601String;
  readonly infoKindVersion: string | null;
  readonly timeDefines: readonly AreaTimeseriesTimeDefineInput[];
  readonly values: readonly AreaTimeseriesValueInput[];
}

export type Vpfd51ParseResult =
  | { readonly ok: true; readonly value: ParsedVpfd51 }
  | {
      readonly ok: false;
      readonly disposition: '対象外' | '対象地域外' | '未対応構造';
      readonly reason: string;
    };

// 5. レーダー
export type RadarProduct = 'N1' | 'N2';

export interface RadarTileInput {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly filePath: string;
  readonly byteSize: number;
  readonly contentHash: string;
  readonly storedAt: UtcIso8601String;
}

export interface RadarTile extends RadarTileInput {
  readonly id: number;
}

export interface RadarFrameInput {
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly element: string;
  readonly member: string;
  readonly sequence: number;
  readonly tiles?: readonly RadarTileInput[];
}

export interface RadarFrame {
  readonly id: number;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly element: string;
  readonly member: string;
  readonly sequence: number;
  readonly tiles: readonly RadarTile[];
}

export interface RadarSnapshotInput {
  readonly product: RadarProduct;
  readonly metadata: SnapshotMetadataInput;
  readonly frames: readonly RadarFrameInput[];
}

export interface RadarSnapshot {
  readonly id: number;
  readonly product: RadarProduct;
  readonly metadata: SnapshotMetadataInput;
  readonly frames: readonly RadarFrame[];
}

// 6. キキクル
export type RiskLayer = 'heavyrain' | 'inund' | 'land' | 'flood';

export interface RiskTileInput {
  readonly zoom: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly filePath: string;
  readonly byteSize: number;
  readonly contentHash: string;
  readonly storedAt: UtcIso8601String;
}

export interface RiskTile extends RiskTileInput {
  readonly id: number;
}

export interface RiskFrameInput {
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: string;
  readonly member: string;
  readonly sequence: number;
  readonly tiles?: readonly RiskTileInput[];
}

export interface RiskFrame {
  readonly id: number;
  readonly baseTime: UtcIso8601String;
  readonly validTime: UtcIso8601String;
  readonly imageId: string;
  readonly member: string;
  readonly sequence: number;
  readonly tiles: readonly RiskTile[];
}

export interface RiskSnapshotInput {
  readonly layer: RiskLayer;
  readonly metadata: SnapshotMetadataInput;
  readonly frames: readonly RiskFrameInput[];
}

export interface RiskSnapshot {
  readonly id: number;
  readonly layer: RiskLayer;
  readonly metadata: SnapshotMetadataInput;
  readonly frames: readonly RiskFrame[];
}

// 7. アメダス
export interface AmedasObservationInput {
  readonly observedAt: UtcIso8601String;
  readonly element: string;
  readonly valueNumber: number | null;
  readonly valueText: string | null;
  readonly qualityFlag: number | null;
}

export interface AmedasObservation extends AmedasObservationInput {
  readonly id: number;
}

export interface AmedasSnapshotInput {
  readonly stationCode: string;
  readonly stationName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly observations: readonly AmedasObservationInput[];
}

export interface AmedasSnapshot {
  readonly id: number;
  readonly stationCode: string;
  readonly stationName: string;
  readonly metadata: SnapshotMetadataInput;
  readonly observations: readonly AmedasObservation[];
}

// 8. 気象防災速報
export interface BosaiBulletinAreaInput {
  readonly areaCode: string;
  readonly areaName: string;
  readonly codeType: string;
  readonly sequence: number;
}

export interface BosaiBulletinArea extends BosaiBulletinAreaInput {
  readonly id: number;
}

export interface BosaiBulletinInput {
  readonly eventId: string;
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly title: string;
  readonly headlineText: string;
  readonly informationTag: string;
  readonly isCancelled: boolean;
  readonly metadata: SnapshotMetadataInput;
  readonly areas: readonly BosaiBulletinAreaInput[];
}

export interface BosaiBulletin {
  readonly id: number;
  readonly eventId: string;
  readonly controlStatus: ControlStatus;
  readonly infoType: string;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly title: string;
  readonly headlineText: string;
  readonly informationTag: string;
  readonly isCancelled: boolean;
  readonly metadata: SnapshotMetadataInput;
  readonly areas: readonly BosaiBulletinArea[];
}

export interface ListBosaiBulletinsOptions {
  readonly controlStatus: ControlStatus;
  readonly includedAreaCodes?: readonly BosaiBulletinAreaCode[];
}

// --- 通信履歴 ---
export type FetchOutcome = 'success' | 'failure';

export const KNOWN_FETCH_SOURCE_KINDS = [
  'xml_feed_regular', // https://www.data.jma.go.jp/developer/xml/feed/regular.xml
  'xml_feed_extra', // 同 extra.xml
  'xml_feed_regular_long', // 同 regular_l.xml（初期化・復旧）
  'xml_feed_extra_long', // 同 extra_l.xml
  'xml_document', // フィードから辿った個別電文本体
  'radar_target_times', // targetTimes_N1.json / N2.json
  'radar_tile_frame', // nowc の hrpns PNG。1 フレーム分のタイル取得をまとめて 1 行（§3.1）
  'risk_target_times', // キキクル時刻一覧
  'risk_tile_frame', // キキクルの PNG／PBF／GeoJSON。同じく 1 フレーム＝ 1 行
  'amedas_latest_time', // latest_time.txt
  'amedas_point', // point/44136/{date}_{hh}.json
  'amedas_table', // amedastable.json
] as const;

export interface FetchAttemptInput {
  readonly sourceKind: string;
  readonly targetRef: string | null;
  readonly requestUrl: string;
  readonly triggerKind: string;
  readonly attemptNo: number;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly durationMs: number;
  readonly outcome: FetchOutcome;
  readonly httpStatus: number | null;
  readonly responseBytes: number | null;
  /** この 1 行がまとめた取得対象の件数（タイルのフレーム行のみ）。1 リクエスト＝ 1 行なら null。 */
  readonly itemCount: number | null;
  /** うち失敗した件数。itemCount が null のときは null。 */
  readonly failedItemCount: number | null;
  readonly contentHash: string | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
}

export interface FetchAttempt extends FetchAttemptInput {
  readonly id: number;
}

export interface ListFetchAttemptsOptions {
  readonly sourceKind?: string;
  readonly outcome?: FetchOutcome;
  readonly startedAtFrom?: UtcIso8601String;
  readonly startedAtTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number; // 既定 0
}

// --- 電文履歴 ---
export interface TelegramReceptionAreaInput {
  readonly areaCode: string;
  readonly areaName: string | null;
  readonly codeType: string | null;
  readonly sequence: number;
}

export interface TelegramReceptionArea extends TelegramReceptionAreaInput {
  readonly id: number;
}

export interface TelegramReceptionInput {
  readonly fetchAttemptId: number | null;
  readonly feedKind: string | null;
  readonly feedEntryId: string | null;
  readonly documentUrl: string;
  readonly telegramType: string | null;
  readonly title: string | null;
  readonly controlStatus: ControlStatus | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly controlDateTime: UtcIso8601String | null;
  readonly reportDateTime: UtcIso8601String | null;
  readonly targetDateTime: UtcIso8601String | null;
  readonly receivedAt: UtcIso8601String;
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
  readonly rawBody: string | null;
  readonly bodyBytes: number | null;
  readonly contentHash: string | null;
  readonly areas: readonly TelegramReceptionAreaInput[];
}

/** 一覧用。原文（rawBody）を含まない。 */
export interface TelegramReceptionSummary extends Omit<
  TelegramReceptionInput,
  'rawBody' | 'areas'
> {
  readonly id: number;
  readonly hasRawBody: boolean;
  readonly areas: readonly TelegramReceptionArea[];
}

/** 詳細用。原文を含む。 */
export interface TelegramReception extends TelegramReceptionSummary {
  readonly rawBody: string | null;
}

export interface ListTelegramReceptionsOptions {
  /** 指定した値の行だけを返す。NULL（不明）の行は返さない（§3.6）。 */
  readonly controlStatus?: ControlStatus;
  readonly telegramType?: string;
  readonly infoType?: string;
  readonly areaCode?: string;
  readonly documentUrl?: string;
  readonly adoptionResult?: string;
  readonly receivedAtFrom?: UtcIso8601String;
  readonly receivedAtTo?: UtcIso8601String;
  readonly reportDateTimeFrom?: UtcIso8601String;
  readonly reportDateTimeTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number;
}

export interface TelegramReceptionAdoptionInput {
  readonly adoptionResult: string | null;
  readonly adoptionReason: string | null;
  readonly adoptionDecidedAt: UtcIso8601String | null;
}

// --- 警報・注意報電文の構造化（C2） ---
export const WARNING_TELEGRAM_TYPES = [
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
  'VPWS50',
] as const;

export type WarningTelegramType = (typeof WARNING_TELEGRAM_TYPES)[number];

export interface WarningTargetArea {
  readonly municipalCode: string;
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

export interface ParsedNoWarningKind extends ParsedWarningKindBase {
  readonly kindType: 'no_warning';
  readonly status: '発表警報・注意報はなし';
}

export interface ParsedIssuedWarningKind extends ParsedWarningKindBase {
  readonly kindType: 'warning';
  readonly name: string;
  readonly code: string;
  readonly dateTime: UtcIso8601String | null;
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

export interface PendingWarningTelegramPage {
  readonly receptions: readonly TelegramReception[];
  readonly nextCursor: { readonly receivedAt: UtcIso8601String; readonly id: number } | null;
}

export interface WarningTelegramRebuildPage {
  readonly receptions: readonly TelegramReception[];
  readonly nextCursor: {
    readonly reportDateTime: UtcIso8601String;
    readonly controlDateTime: UtcIso8601String;
    readonly id: number;
  } | null;
}

// --- 気象警報・注意報の現況構成（C3） ---
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
  'new' | 'continued' | 'strengthened' | 'weakened' | 'released';

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

export type IndividualWarningTelegramType = (typeof INDIVIDUAL_WARNING_TELEGRAM_TYPES)[number];

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

export interface WarningCurrentStreamInput {
  readonly prefectureCode: string;
  readonly areaCode: string;
  readonly controlStatus: ControlStatus;
  readonly telegramType: WarningTelegramType;
  readonly receptionId: number;
  readonly reportDateTime: UtcIso8601String;
  readonly controlDateTime: UtcIso8601String;
  readonly receivedAt: UtcIso8601String;
  readonly contentHash: string;
}

export interface WarningCurrentStream extends WarningCurrentStreamInput {
  readonly id: number;
}

// --- 通知出力履歴 ---
export type NotificationOutputOrigin = 'weather' | 'system';
export type NotificationDetectionContext = 'normal' | 'initial';

export interface NotificationOutputHistoryInput {
  readonly notificationId: string;
  readonly category: string;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly targetAreaJson: string | null;
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly changeType: string;
  readonly ackRequired: boolean;
  readonly summary: string;
  readonly relatedRefsJson: string;
  readonly origin: NotificationOutputOrigin;
  readonly detectionContext: NotificationDetectionContext;
  readonly isTraining: boolean;
  readonly messageDefinitionId: string | null;
  readonly messageDefinitionVersion: string | null;
}

export interface NotificationOutputHistory extends NotificationOutputHistoryInput {
  readonly id: number;
}

export interface ListNotificationOutputHistoryOptions {
  readonly category?: string;
  readonly sourceType?: string;
  readonly changeType?: string;
  readonly origin?: NotificationOutputOrigin;
  readonly detectionContext?: NotificationDetectionContext;
  readonly isTraining?: boolean;
  readonly detectedAtFrom?: UtcIso8601String;
  readonly detectedAtTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number; // 既定 0
}

// --- 操作記録 ---
export type OperationKind = 'start' | 'stop' | 'force_refresh';
export type OperationTargetKind = 'all';
export type OperationResult = 'success' | 'failure';

export interface OperationHistoryInput {
  readonly requestId: string;
  readonly operationKind: OperationKind;
  readonly targetKind: OperationTargetKind;
  readonly result: OperationResult;
  readonly requestedAt: UtcIso8601String;
  readonly completedAt: UtcIso8601String;
  /** AuthGate 連携前は必ず NULL とする。 */
  readonly actorId: null;
  /** AuthGate 連携前は必ず NULL とする。 */
  readonly actorDisplayName: null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface OperationHistory extends Omit<
  OperationHistoryInput,
  'actorId' | 'actorDisplayName'
> {
  readonly id: number;
  /** 将来の AuthGate 連携後の履歴も読み出せるよう、返却値は NULL 固定にしない。 */
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
}

export interface ListOperationHistoryOptions {
  readonly operationKind?: OperationKind;
  readonly result?: OperationResult;
  readonly actorId?: string;
  readonly requestedAtFrom?: UtcIso8601String;
  readonly requestedAtTo?: UtcIso8601String;
  readonly completedAtFrom?: UtcIso8601String;
  readonly completedAtTo?: UtcIso8601String;
  readonly limit?: number; // 既定 100、上限 1000
  readonly offset?: number; // 既定 0
}
