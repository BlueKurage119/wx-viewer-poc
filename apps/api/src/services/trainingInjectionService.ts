import crypto from 'node:crypto';
import type {
  TerminalRegistry,
  TrainingInjectRejectReason,
  TrainingInjectRequest,
  TrainingInjectResponse,
} from '@wx-viewer-poc/shared';
import type {
  TrainingInjectionCommand,
  TrainingInjectionPort,
} from '../training/trainingInjectionContracts.js';
import {
  generateTrainingTelegrams,
  type GeneratedTrainingTelegram,
} from '../training/trainingTelegramGenerator.js';
import { verifyGeneratedTelegram } from '../training/trainingTelegramVerifier.js';

export interface TrainingVerificationFailure {
  readonly previewId: string;
  readonly reason: TrainingInjectRejectReason;
}

export type TrainingInjectionOutcome =
  | { readonly kind: 'success'; readonly response: TrainingInjectResponse }
  | { readonly kind: 'unknown_terminal' }
  | { readonly kind: 'forbidden_terminal' }
  | {
      readonly kind: 'verification_failed';
      readonly failures: readonly TrainingVerificationFailure[];
    }
  | { readonly kind: 'unavailable'; readonly code: string }
  | { readonly kind: 'result_unknown'; readonly trainingId: string }
  | { readonly kind: 'failed'; readonly trainingId?: string };

export interface TrainingInjectionServiceDependencies {
  readonly terminalRegistry: TerminalRegistry;
  readonly port?: TrainingInjectionPort;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export class TrainingInjectionService {
  private readonly terminalRegistry: TerminalRegistry;
  private readonly port: TrainingInjectionPort | undefined;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(dependencies: TrainingInjectionServiceDependencies) {
    this.terminalRegistry = dependencies.terminalRegistry;
    this.port = dependencies.port;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  }

  async inject(request: TrainingInjectRequest): Promise<TrainingInjectionOutcome> {
    // 1. 端末検証（K 端末のみ）
    const terminal = this.terminalRegistry.resolveTerminal(request.terminalId);
    if (!terminal) {
      return { kind: 'unknown_terminal' };
    }
    if (terminal.mode !== 'K') {
      return { kind: 'forbidden_terminal' };
    }

    // 2. ポート有無チェック
    if (!this.port) {
      return { kind: 'unavailable', code: 'training_injection_unavailable' };
    }

    // 3. 各電文の受理検証（再生成・バイト一致・生成後検証）
    const failures: TrainingVerificationFailure[] = [];
    interface ValidatedTelegram {
      readonly previewId: string;
      readonly generatedAt: string;
      readonly index: number;
      readonly reportDateTime: string;
      readonly telegramType: GeneratedTrainingTelegram['telegramType'];
      readonly xml: string;
    }
    const validatedTelegrams: ValidatedTelegram[] = [];

    for (const telegram of request.telegrams) {
      const parts = telegram.previewId.split(':');
      const generationId = parts[0]!;
      const index = Number(parts[1]!);

      let regenerated: GeneratedTrainingTelegram[];
      try {
        regenerated = generateTrainingTelegrams(telegram.itemIds, {
          now: telegram.generatedAt,
          generationId,
        });
      } catch {
        failures.push({ previewId: telegram.previewId, reason: 'verification_failed' });
        continue;
      }

      if (regenerated.length !== 1) {
        failures.push({ previewId: telegram.previewId, reason: 'verification_failed' });
        continue;
      }

      const generated = regenerated[0]!;
      if (generated.telegramType !== telegram.telegramType || generated.xml !== telegram.xml) {
        failures.push({ previewId: telegram.previewId, reason: 'regeneration_mismatch' });
        continue;
      }

      try {
        verifyGeneratedTelegram(generated, {
          now: telegram.generatedAt,
          generationId,
        });
      } catch {
        failures.push({ previewId: telegram.previewId, reason: 'verification_failed' });
        continue;
      }

      validatedTelegrams.push({
        previewId: telegram.previewId,
        generatedAt: telegram.generatedAt,
        index,
        reportDateTime: generated.reportDateTime,
        telegramType: generated.telegramType,
        xml: telegram.xml,
      });
    }

    if (failures.length > 0) {
      return { kind: 'verification_failed', failures };
    }

    // 4. 投入順の決定: (reportDateTime 昇順, generatedAt 昇順, index 昇順)
    const sorted = [...validatedTelegrams].sort((a, b) => {
      const rDiff = Date.parse(a.reportDateTime) - Date.parse(b.reportDateTime);
      if (rDiff !== 0) return rDiff;
      const gDiff = Date.parse(a.generatedAt) - Date.parse(b.generatedAt);
      if (gDiff !== 0) return gDiff;
      return a.index - b.index;
    });

    const trainingId = this.idFactory();
    const command: TrainingInjectionCommand = {
      trainingId,
      terminalId: request.terminalId,
      requestedAt: this.now(),
      telegrams: sorted.map((t, order) => ({
        order,
        previewId: t.previewId,
        reportDateTime: t.reportDateTime,
        telegramType: t.telegramType,
        xml: t.xml,
      })),
    };

    // 5. ポート呼出し
    if (!this.port) {
      return { kind: 'unavailable', code: 'training_injection_unavailable' };
    }
    try {
      const response = await this.port.inject(command);
      return { kind: 'success', response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'not_ready' || msg === 'busy') {
        return { kind: 'unavailable', code: 'training_injection_unavailable' };
      }
      if (
        msg === 'handshake_timeout' ||
        msg === 'deadline_exceeded' ||
        msg === 'operation_result_unknown' ||
        msg.includes('Worker')
      ) {
        return { kind: 'result_unknown', trainingId };
      }
      if (msg === 'training_injection_failed') {
        return { kind: 'failed', trainingId };
      }
      return { kind: 'failed', trainingId };
    }
  }
}

export function createTrainingInjectionService(
  dependencies: TrainingInjectionServiceDependencies,
): TrainingInjectionService {
  return new TrainingInjectionService(dependencies);
}
