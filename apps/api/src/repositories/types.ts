import type { Availability, UtcIso8601String } from '@wx-viewer-poc/shared';

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
  readonly kindCode: string;
  readonly kindName: string;
  readonly kindStatus: string;
  readonly valueCategory: string;
  readonly propertyType: string;
  readonly valueType: string;
  readonly valueText: string;
  readonly unit: string | null;
  readonly areaDivision: string | null;
  readonly sequence: number;
}

export interface WarningTimeseriesValue extends WarningTimeseriesValueInput {
  readonly id: number;
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
  readonly includesKoto?: boolean;
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
