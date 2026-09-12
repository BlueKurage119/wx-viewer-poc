import crypto from 'node:crypto';

import {
  resolveTerminalDefinition,
  type StartupNotificationInitializingResponse,
  type StartupNotificationReadyResponse,
  type TerminalSessionId,
  type UtcIso8601String,
  type VenueId,
} from '@wx-viewer-poc/shared';
import type { InitialFetchPhase } from '../polling/index.js';
import {
  claimStartupWarning,
  recordStartupNotificationInquiry,
  recordTerminalSessionInquiry,
} from '../repositories/index.js';
import type { DatabaseConnection } from '../database/index.js';
import type { StartupNotificationInquiryRecord } from '../repositories/startupNotificationRepository.js';
import {
  projectStartupCurrentNotifications,
  type StartupProjectionResult,
} from './startupCurrentNotificationProjector.js';

export interface StartupNotificationInitializationStatus {
  readonly initialFetchPhase: InitialFetchPhase;
  readonly evaluatedVenueIds: ReadonlySet<VenueId>;
}

/** 起動世代ごとの初期取得・会場評価の状態。DB には保存しない。 */
export class StartupNotificationInitialization {
  private initialFetchPhase: InitialFetchPhase = 'not_started';
  private readonly evaluatedVenueIds = new Set<VenueId>();

  getStatus(): StartupNotificationInitializationStatus {
    return {
      initialFetchPhase: this.initialFetchPhase,
      evaluatedVenueIds: new Set(this.evaluatedVenueIds),
    };
  }

  setInitialFetchPhase(phase: InitialFetchPhase): void {
    this.initialFetchPhase = phase;
    if (phase !== 'completed') this.evaluatedVenueIds.clear();
  }

  markVenueEvaluated(venueId: VenueId): void {
    this.evaluatedVenueIds.add(venueId);
  }

  isReady(venueId: VenueId): boolean {
    return this.initialFetchPhase === 'completed' && this.evaluatedVenueIds.has(venueId);
  }
}

export interface StartupNotificationInquiryInput {
  readonly terminalId: string;
  readonly venueId: VenueId;
  readonly sessionId: TerminalSessionId;
  readonly inquiredAt: UtcIso8601String;
}

export interface StartupNotificationService {
  inquire(
    input: StartupNotificationInquiryInput,
  ): StartupNotificationInitializingResponse | StartupNotificationReadyResponse;
}

export interface CreateStartupNotificationServiceDependencies {
  readonly connection: DatabaseConnection;
  readonly initialization: StartupNotificationInitialization;
  readonly serverGenerationId: string;
  readonly now?: () => UtcIso8601String;
  readonly outputIdFactory?: () => string;
  readonly projector?: (
    connection: DatabaseConnection,
    input: Parameters<typeof projectStartupCurrentNotifications>[1],
    outputIdFactory?: () => string,
  ) => StartupProjectionResult;
  readonly recordInquiry?: (
    connection: DatabaseConnection,
    input: StartupNotificationInquiryRecord,
  ) => void;
}

export function createStartupNotificationService(
  dependencies: CreateStartupNotificationServiceDependencies,
): StartupNotificationService {
  const now = dependencies.now ?? (() => new Date().toISOString() as UtcIso8601String);
  const projector = dependencies.projector ?? projectStartupCurrentNotifications;
  const outputIdFactory = dependencies.outputIdFactory ?? (() => crypto.randomUUID());
  const recordInquiry = dependencies.recordInquiry ?? recordStartupNotificationInquiry;

  return {
    inquire(input) {
      const terminal = resolveTerminalDefinition(input.terminalId);
      if (terminal === null || terminal.venueId !== input.venueId) {
        throw new Error('terminalId and venueId do not match the terminal registry');
      }
      if (!dependencies.initialization.isReady(input.venueId)) {
        return { status: 'initializing', venueId: input.venueId };
      }

      const inquiredAt = input.inquiredAt || now();
      return dependencies.connection
        .transaction(() => {
          const session = recordTerminalSessionInquiry(
            dependencies.connection,
            input.sessionId,
            inquiredAt,
          );
          const warningClaimed =
            session.kind === 'startup' &&
            claimStartupWarning(dependencies.connection, {
              serverGenerationId: dependencies.serverGenerationId,
              venueId: input.venueId,
              claimedAt: inquiredAt,
              sessionId: input.sessionId,
            });
          const projection = projector(
            dependencies.connection,
            {
              venueId: input.venueId,
              now: inquiredAt,
              includeWarningCategory: warningClaimed,
            },
            outputIdFactory,
          );
          const response: StartupNotificationReadyResponse = {
            status: 'ready',
            terminalId: input.terminalId,
            venueId: input.venueId,
            serverGenerationId: dependencies.serverGenerationId,
            generatedAt: inquiredAt,
            session: {
              kind: session.kind,
              firstInquiredAt: session.firstInquiredAt as UtcIso8601String,
            },
            warningClaimed,
            notifications: projection.notifications,
          };
          recordInquiry(dependencies.connection, {
            serverGenerationId: dependencies.serverGenerationId,
            venueId: input.venueId,
            terminalId: input.terminalId,
            sessionId: input.sessionId,
            sessionKind: session.kind,
            inquiredAt,
            warningClaimed,
            responseJson: JSON.stringify(response),
          });
          return response;
        })
        .immediate();
    },
  };
}
