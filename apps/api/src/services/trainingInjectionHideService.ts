import type {
  TerminalRegistry,
  TrainingInjectionsHideRequest,
  TrainingInjectionsHideResponse,
} from '@wx-viewer-poc/shared';
import {
  TRAINING_NOT_RETRACTED,
  TRAINING_RETRACTION_NOT_FOUND,
  decodeRetractionRejection,
  type TrainingInjectionsHidePort,
} from '../training/trainingInjectionContracts.js';

export type TrainingInjectionsHideOutcome =
  | { readonly kind: 'success'; readonly response: TrainingInjectionsHideResponse }
  | { readonly kind: 'unknown_terminal' }
  | { readonly kind: 'forbidden_terminal' }
  | { readonly kind: 'not_found'; readonly trainingIds: readonly string[] }
  | { readonly kind: 'not_retracted'; readonly trainingIds: readonly string[] }
  | { readonly kind: 'unavailable' };

export interface TrainingInjectionHideServiceDependencies {
  readonly terminalRegistry: TerminalRegistry;
  readonly port?: TrainingInjectionsHidePort;
  readonly now?: () => string;
}

export class TrainingInjectionHideService {
  private readonly terminalRegistry: TerminalRegistry;
  private readonly port: TrainingInjectionsHidePort | undefined;
  private readonly now: () => string;

  constructor(dependencies: TrainingInjectionHideServiceDependencies) {
    this.terminalRegistry = dependencies.terminalRegistry;
    this.port = dependencies.port;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async hide(request: TrainingInjectionsHideRequest): Promise<TrainingInjectionsHideOutcome> {
    const terminal = this.terminalRegistry.resolveTerminal(request.terminalId);
    if (!terminal) return { kind: 'unknown_terminal' };
    if (terminal.mode !== 'K') return { kind: 'forbidden_terminal' };
    if (!this.port) return { kind: 'unavailable' };
    try {
      const response = await this.port.hide({
        terminalId: request.terminalId,
        trainingIds: request.trainingIds,
        hiddenAt: this.now(),
        allowedTerminalIds: this.terminalRegistry
          .listTerminals()
          .filter((t) => t.mode === 'K' && t.venueId === terminal.venueId)
          .map((t) => t.id),
      });
      return { kind: 'success', response };
    } catch (error) {
      const rejection = decodeRetractionRejection(error instanceof Error ? error.message : '');
      if (rejection?.code === TRAINING_RETRACTION_NOT_FOUND) {
        return { kind: 'not_found', trainingIds: rejection.trainingIds };
      }
      if (rejection?.code === TRAINING_NOT_RETRACTED) {
        return { kind: 'not_retracted', trainingIds: rejection.trainingIds };
      }
      return { kind: 'unavailable' };
    }
  }
}

export function createTrainingInjectionHideService(
  dependencies: TrainingInjectionHideServiceDependencies,
): TrainingInjectionHideService {
  return new TrainingInjectionHideService(dependencies);
}
