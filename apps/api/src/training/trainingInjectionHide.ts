import type { DatabaseConnection } from '../database/index.js';
import {
  findTrainingInjection,
  hideTrainingInjectionsFromList,
} from '../repositories/trainingInjectionRepository.js';
import { mapRetractedTrainingIds } from '../repositories/trainingRetractionRepository.js';
import {
  TRAINING_NOT_RETRACTED,
  TRAINING_RETRACTION_NOT_FOUND,
  encodeRetractionRejection,
  type TrainingInjectionsHideCommand,
} from './trainingInjectionContracts.js';

/**
 * Worker 側の「一覧から外す」処理。抹消済み（completed の抹消の対象）の訓練だけを対象にし、
 * 1件でも不可なら1件も記録しない。既に外した訓練は成功扱い（記録は変えない）。
 */
export function hideTrainingInjections(
  connection: DatabaseConnection,
  command: TrainingInjectionsHideCommand,
): { readonly hiddenTrainingIds: readonly string[] } {
  const retracted = mapRetractedTrainingIds(connection);
  const notFound: string[] = [];
  const notRetracted: string[] = [];
  for (const id of command.trainingIds) {
    const injection = findTrainingInjection(connection, id);
    if (
      !injection ||
      injection.status !== 'completed' ||
      !command.allowedTerminalIds.includes(injection.terminalId)
    ) {
      notFound.push(id);
    } else if (!retracted.has(id)) {
      notRetracted.push(id);
    }
  }
  if (notFound.length > 0) {
    throw new Error(encodeRetractionRejection(TRAINING_RETRACTION_NOT_FOUND, notFound));
  }
  if (notRetracted.length > 0) {
    throw new Error(encodeRetractionRejection(TRAINING_NOT_RETRACTED, notRetracted));
  }
  hideTrainingInjectionsFromList(connection, {
    trainingIds: command.trainingIds,
    terminalId: command.terminalId,
    hiddenAt: command.hiddenAt,
  });
  return { hiddenTrainingIds: [...command.trainingIds].sort() };
}
