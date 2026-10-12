import type { TrainingInjectResponse, TrainingTelegramType } from '@wx-viewer-poc/shared';

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

export interface TrainingInjectionPort {
  inject(command: TrainingInjectionCommand): Promise<TrainingInjectionResult>;
}
