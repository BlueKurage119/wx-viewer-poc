import crypto from 'node:crypto';
import type {
  TerminalRegistry,
  TrainingRetractRequest,
  TrainingRetractResponse,
} from '@wx-viewer-poc/shared';
import {
  TRAINING_RETRACTION_ALREADY_RETRACTED,
  TRAINING_RETRACTION_NOT_FOUND,
  decodeRetractionRejection,
  type TrainingRetractionCommand,
  type TrainingRetractionPort,
} from '../training/trainingInjectionContracts.js';

export type TrainingRetractionOutcome =
  | { readonly kind: 'success'; readonly response: TrainingRetractResponse }
  | { readonly kind: 'unknown_terminal' }
  | { readonly kind: 'forbidden_terminal' }
  | { readonly kind: 'not_found'; readonly trainingIds: readonly string[] }
  | { readonly kind: 'already_retracted'; readonly trainingIds: readonly string[] }
  | { readonly kind: 'unavailable'; readonly code: string }
  | { readonly kind: 'result_unknown'; readonly retractionId: string }
  | { readonly kind: 'failed'; readonly retractionId?: string };

export interface TrainingRetractionServiceDependencies {
  readonly terminalRegistry: TerminalRegistry;
  readonly port?: TrainingRetractionPort;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export class TrainingRetractionService {
  private readonly terminalRegistry: TerminalRegistry;
  private readonly port: TrainingRetractionPort | undefined;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(dependencies: TrainingRetractionServiceDependencies) {
    this.terminalRegistry = dependencies.terminalRegistry;
    this.port = dependencies.port;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  }

  async retract(request: TrainingRetractRequest): Promise<TrainingRetractionOutcome> {
    // 端末検証（K 端末のみ）
    const terminal = this.terminalRegistry.resolveTerminal(request.terminalId);
    if (!terminal) return { kind: 'unknown_terminal' };
    if (terminal.mode !== 'K') return { kind: 'forbidden_terminal' };

    const port = this.port;
    if (!port) return { kind: 'unavailable', code: 'training_retraction_unavailable' };

    const retractionId = this.idFactory();
    const command: TrainingRetractionCommand = {
      retractionId,
      terminalId: request.terminalId,
      requestedAt: this.now(),
      scope: request.scope,
      trainingIds: request.scope === 'training' ? request.trainingIds : [],
      allowedTerminalIds: this.terminalRegistry
        .listTerminals()
        .filter((t) => t.mode === 'K' && t.venueId === terminal.venueId)
        .map((t) => t.id),
    };

    try {
      const response = await port.retract(command);
      return { kind: 'success', response };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const rejection = decodeRetractionRejection(message);
      if (rejection?.code === TRAINING_RETRACTION_NOT_FOUND) {
        return { kind: 'not_found', trainingIds: rejection.trainingIds };
      }
      if (rejection?.code === TRAINING_RETRACTION_ALREADY_RETRACTED) {
        return { kind: 'already_retracted', trainingIds: rejection.trainingIds };
      }
      if (message === 'not_ready' || message === 'busy') {
        return { kind: 'unavailable', code: 'training_retraction_unavailable' };
      }
      if (
        message === 'handshake_timeout' ||
        message === 'deadline_exceeded' ||
        message === 'operation_result_unknown' ||
        message.includes('Worker')
      ) {
        return { kind: 'result_unknown', retractionId };
      }
      return { kind: 'failed', retractionId };
    }
  }
}

export function createTrainingRetractionService(
  dependencies: TrainingRetractionServiceDependencies,
): TrainingRetractionService {
  return new TrainingRetractionService(dependencies);
}
