import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../../src/database/index.js';
import type {
  TrainingInjectionCommand,
  TrainingRetractionCommand,
} from '../../src/training/trainingInjectionContracts.js';
import { injectTrainingTelegrams } from '../../src/training/trainingInjector.js';
import { retractTrainingTelegrams } from '../../src/training/trainingRetractor.js';
import { generateTrainingTelegrams } from '../../src/training/trainingTelegramGenerator.js';
import { initializeTestDatabases } from './databasePair.js';
import { testVenueRegistry } from './venueConfigPreload.js';

export const K_EAST = 'kkeagh01';
export const REQUESTED_AT = '2026-10-12T10:00:00.000Z';

export function setupDb() {
  return initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../../migrations'),
  });
}

export function count(connection: DatabaseConnection, table: string): number {
  return (connection.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

/** 呼ぶたびに start から 1 秒進む時計。 */
export function steppingClock(start: string, stepMs = 1000): () => UtcIso8601String {
  let ms = Date.parse(start);
  return () => {
    const value = new Date(ms).toISOString() as UtcIso8601String;
    ms += stepMs;
    return value;
  };
}

export function fixedClock(value = '2026-10-12T10:00:00.000Z'): () => UtcIso8601String {
  return () => value as UtcIso8601String;
}

/** itemIds から 1 つの注入コマンドを作る（previewId は generationId:index）。 */
export function buildInjectionCommand(
  itemIds: string[],
  options: { now: string; generationId?: string; trainingId?: string; terminalId?: string },
): TrainingInjectionCommand {
  const generationId = options.generationId ?? randomUUID();
  const generated = generateTrainingTelegrams(itemIds as never, {
    now: options.now,
    generationId,
  });
  const sorted = [...generated].sort(
    (a, b) => Date.parse(a.reportDateTime) - Date.parse(b.reportDateTime),
  );
  return {
    trainingId: options.trainingId ?? randomUUID(),
    terminalId: options.terminalId ?? K_EAST,
    requestedAt: REQUESTED_AT,
    telegrams: sorted.map((t, order) => ({
      order,
      previewId: `${generationId}:${generated.indexOf(t)}`,
      reportDateTime: t.reportDateTime,
      telegramType: t.telegramType,
      xml: t.xml,
    })),
  };
}

export async function inject(
  connection: DatabaseConnection,
  itemIds: string[],
  options: {
    now: string;
    clock: () => UtcIso8601String;
    generationId?: string;
    trainingId?: string;
    terminalId?: string;
  },
) {
  const command = buildInjectionCommand(itemIds, options);
  const result = await injectTrainingTelegrams(connection, command, {
    venueRegistry: testVenueRegistry,
    clock: options.clock,
  });
  return { command, result };
}

export function retractionCommand(
  scope: 'training' | 'all',
  trainingIds: string[] = [],
  retractionId: string = randomUUID(),
): TrainingRetractionCommand {
  return {
    retractionId,
    terminalId: K_EAST,
    requestedAt: REQUESTED_AT,
    scope,
    trainingIds: scope === 'all' ? [] : trainingIds,
    allowedTerminalIds: [K_EAST],
  };
}

export async function retract(
  connection: DatabaseConnection,
  command: TrainingRetractionCommand,
  clock: () => UtcIso8601String,
) {
  return retractTrainingTelegrams(connection, command, {
    venueRegistry: testVenueRegistry,
    clock,
  });
}
