import type {
  TrainingInjectionsResponse,
  TrainingRetractResponse,
  TrainingInjectResponse,
  TrainingTelegramType,
} from '@wx-viewer-poc/shared';

export const TRAINING_FEED_KIND = 'training';
export const TRAINING_SOURCE_KIND = 'training_injection';
export const TRAINING_TRIGGER_KIND = 'training';

export function trainingDocumentUrl(
  trainingId: string,
  sequence: number,
  telegramType: TrainingTelegramType | 'VPWS50',
): string {
  return `training://${trainingId}/${sequence}_${telegramType}_training.xml`;
}

export interface TrainingInjectionCommand {
  readonly trainingId: string;
  readonly terminalId: string;
  readonly requestedAt: string; // HTTPメインの受付時刻 UTC ISO
  readonly telegrams: readonly {
    readonly order: number; // 0 始まり。投入順
    readonly previewId: string;
    readonly reportDateTime: string; // 再生成結果の発表時刻 UTC ISO（基準電文の時刻決定に使う）
    readonly telegramType: TrainingTelegramType;
    readonly xml: string;
  }[];
}

export type TrainingInjectionResult = TrainingInjectResponse;

export interface TrainingInjectionListCommand {
  /** 一覧の対象とする端末（要求端末と同じ会場の K 端末）。 */
  readonly terminalIds: readonly string[];
  readonly limit: number;
}

export type TrainingInjectionListResult = TrainingInjectionsResponse;

export interface TrainingInjectionPort {
  inject(command: TrainingInjectionCommand): Promise<TrainingInjectionResult>;
  /** 投入済み一覧の読み取り（weather DB の書き手である取得 Worker 経由）。未実装なら 503 扱い。 */
  list?(command: TrainingInjectionListCommand): Promise<TrainingInjectionListResult>;
}

// ---------------------------------------------------------------------------
// 訓練データの抹消（Issue #71 J3）
// ---------------------------------------------------------------------------

export const TRAINING_RETRACTION_SOURCE_KIND = 'training_retraction';

/** 取消電文の documentUrl。`_VPWW55_` 等で種別を決める既存 parseTelegramXml に合わせる。 */
export function trainingRetractionDocumentUrl(
  retractionId: string,
  itemNo: number,
  telegramType: string,
): string {
  return `training://${retractionId}/r${itemNo}_${telegramType}_training.xml`;
}

export interface TrainingRetractionCommand {
  readonly retractionId: string;
  readonly terminalId: string;
  readonly requestedAt: string;
  readonly scope: 'training' | 'all';
  /** scope='all' では空。 */
  readonly trainingIds: readonly string[];
  /** 要求端末と同じ会場の K 端末（scope='training' の所有判定）。 */
  readonly allowedTerminalIds: readonly string[];
}

export type TrainingRetractionResult = TrainingRetractResponse;

export interface TrainingRetractionPort {
  retract(command: TrainingRetractionCommand): Promise<TrainingRetractionResult>;
}

/** Worker が返す拒否・失敗のエラーメッセージ（Worker 境界を通るのは文字列のみ）。 */
export const TRAINING_RETRACTION_NOT_FOUND = 'training_not_found';
export const TRAINING_RETRACTION_ALREADY_RETRACTED = 'training_already_retracted';
export const TRAINING_RETRACTION_FAILED = 'training_retraction_failed';

/** `training_not_found:<id>,<id>` の形式にする。 */
export function encodeRetractionRejection(
  code: typeof TRAINING_RETRACTION_NOT_FOUND | typeof TRAINING_RETRACTION_ALREADY_RETRACTED,
  trainingIds: readonly string[],
): string {
  return `${code}:${trainingIds.join(',')}`;
}

export function decodeRetractionRejection(
  message: string,
): { code: string; trainingIds: string[] } | null {
  for (const code of [TRAINING_RETRACTION_NOT_FOUND, TRAINING_RETRACTION_ALREADY_RETRACTED]) {
    if (message.startsWith(`${code}:`)) {
      const rest = message.slice(code.length + 1);
      return { code, trainingIds: rest.length === 0 ? [] : rest.split(',') };
    }
  }
  return null;
}
