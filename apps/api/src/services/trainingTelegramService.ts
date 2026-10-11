import {
  TRAINING_ITEMS,
  TRAINING_TARGET_LABEL,
  type TerminalRegistry,
  type TrainingGenerateRequest,
  type TrainingGenerateResponse,
  type TrainingItemsResponse,
} from '@wx-viewer-poc/shared';
import { generateTrainingTelegrams } from '../training/trainingTelegramGenerator.js';
import { verifyGeneratedTelegram } from '../training/trainingTelegramVerifier.js';

export interface TrainingTelegramServiceDependencies {
  readonly terminalRegistry: TerminalRegistry;
  /** 生成時計（UTC ISO）。1回の生成で1度だけ読む。 */
  readonly now: () => string;
  /** UUID v4 文字列を返す。 */
  readonly idFactory: () => string;
}

export type TrainingServiceResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'unknown_terminal' }
  | { readonly kind: 'forbidden_terminal' };

export interface TrainingTelegramService {
  listItems(terminalId: string): TrainingServiceResult<TrainingItemsResponse>;
  /** 入力形式の検証（parseTrainingGenerateRequest）は呼出し側の責務。 */
  generate(request: TrainingGenerateRequest): TrainingServiceResult<TrainingGenerateResponse>;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DB・受信・processor・通知に依存しない。weather workerが利用できなくても生成できる。 */
export function createTrainingTelegramService(
  dependencies: TrainingTelegramServiceDependencies,
): TrainingTelegramService {
  function authorize(terminalId: string): 'ok' | 'unknown_terminal' | 'forbidden_terminal' {
    const terminal = dependencies.terminalRegistry.resolveTerminal(terminalId);
    if (terminal === null) return 'unknown_terminal';
    return terminal.mode === 'K' ? 'ok' : 'forbidden_terminal';
  }

  return {
    listItems(terminalId) {
      const access = authorize(terminalId);
      if (access !== 'ok') return { kind: access };
      return { kind: 'ok', value: { items: TRAINING_ITEMS, targetLabel: TRAINING_TARGET_LABEL } };
    },
    generate(request) {
      const access = authorize(request.terminalId);
      if (access !== 'ok') return { kind: access };
      const now = new Date(dependencies.now()).toISOString();
      const generationId = dependencies.idFactory();
      if (!UUID_V4.test(generationId)) throw new Error('生成セットIDがUUID v4ではありません');
      const generated = generateTrainingTelegrams(request.itemIds, { now, generationId });
      const context = { now, generationId };
      for (const telegram of generated) verifyGeneratedTelegram(telegram, context);
      return {
        kind: 'ok',
        value: {
          generationId,
          generatedAt: now,
          telegrams: generated.map((telegram, index) => ({
            id: `${generationId}:${index}`,
            itemIds: telegram.itemIds,
            telegramType: telegram.telegramType,
            title: telegram.title,
            xml: telegram.xml,
            reportDateTime: telegram.reportDateTime,
            targetDateTime: telegram.targetDateTime,
            validDateTime: telegram.validDateTime,
            areaNames: telegram.areaNames,
            provenance: 'synthetic',
            isTraining: true,
          })),
        },
      };
    },
  };
}
