import crypto from 'node:crypto';

import {
  type TerminalRegistry,
  toNotificationDeltaCursor,
  type StartupNotificationInitializingResponse,
  type StartupNotificationReadyResponse,
  type TerminalSessionId,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';
import type { InitialFetchPhase } from '../polling/index.js';
import {
  claimStartupWarning,
  findMaxNotificationOutputSequence,
  recordStartupNotificationInquiry,
  recordTerminalSessionInquiry,
} from '../repositories/index.js';
import type { DatabaseConnection } from '../database/index.js';
import type { StartupNotificationInquiryRecord } from '../repositories/startupNotificationRepository.js';
import type { FetchHealthAggregate } from '../monitoring/fetchHealthEvaluator.js';
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
  readonly weatherConnection: DatabaseConnection;
  readonly retainedConnection: DatabaseConnection;
  readonly weatherDatabaseGenerationId: string;
  readonly venueRegistry: VenueRegistry;
  readonly terminalRegistry: TerminalRegistry;
  readonly initialization: StartupNotificationInitialization;
  readonly serverGenerationId: string;
  readonly now?: () => UtcIso8601String;
  readonly outputIdFactory?: () => string;
  readonly getFetchHealth?: () => FetchHealthAggregate | null;
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
      const terminal = dependencies.terminalRegistry.resolveTerminal(input.terminalId);
      if (terminal === null || terminal.venueId !== input.venueId) {
        throw new Error('terminalId and venueId do not match the terminal registry');
      }
      if (!dependencies.initialization.isReady(input.venueId)) {
        return { status: 'initializing', venueId: input.venueId };
      }

      const inquiredAt = input.inquiredAt || now();
      return dependencies.retainedConnection
        .transaction(() => {
          const session = recordTerminalSessionInquiry(
            dependencies.retainedConnection,
            input.sessionId,
            inquiredAt,
          );
          const warningClaimed =
            session.kind === 'startup' &&
            claimStartupWarning(dependencies.retainedConnection, {
              serverGenerationId: dependencies.serverGenerationId,
              venueId: input.venueId,
              claimedAt: inquiredAt,
              sessionId: input.sessionId,
            });
          const fetchHealth = dependencies.getFetchHealth?.() ?? null;
          const maxSequence = findMaxNotificationOutputSequence(dependencies.retainedConnection);
          const projection = dependencies.weatherConnection.transaction(() =>
            projector(
              dependencies.weatherConnection,
              {
                venueRegistry: dependencies.venueRegistry,
                venueId: input.venueId,
                now: inquiredAt,
                includeWarningCategory: warningClaimed,
                fetchHealth,
              },
              outputIdFactory,
            ),
          )();
          if (
            projection &&
            typeof (projection as unknown as { then?: unknown }).then === 'function'
          ) {
            throw new Error('起動現況の投影は同期処理である必要があります');
          }
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
            cursor: toNotificationDeltaCursor(maxSequence),
          };
          recordInquiry(dependencies.retainedConnection, {
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
