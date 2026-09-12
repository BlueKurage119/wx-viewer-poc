import type { NotificationCategory } from '@wx-viewer-poc/shared';
import type {
  WarningCurrentChange,
  WarningCurrentItemInput,
  WarningPhenomenonKey,
} from '../repositories/types.js';
import { classifyWarningNotificationCategory } from './warningNotificationCategoryClassifier.js';

/** D3 が担当する状態変化。new / continued は D4 の責務であり含めない。 */
export type WarningStateChangeKind = 'strengthened' | 'weakened' | 'released';

export type WarningStateChangeDecisionInput =
  | {
      readonly phenomenonKey: WarningPhenomenonKey;
      readonly changeType: 'strengthened' | 'weakened';
      readonly before: WarningCurrentItemInput;
      readonly after: WarningCurrentItemInput;
    }
  | {
      readonly phenomenonKey: WarningPhenomenonKey;
      readonly changeType: 'released';
      readonly before: WarningCurrentItemInput;
      readonly after: null;
    };

/** C3 の差分が D3 の担当範囲かを判定する型ガード。new / continued は false。 */
export function isWarningStateChangeDecisionInput(
  change: WarningCurrentChange,
): change is WarningCurrentChange & WarningStateChangeDecisionInput {
  if (change.changeType === 'strengthened' || change.changeType === 'weakened') {
    return change.before !== null && change.after !== null;
  }
  if (change.changeType === 'released') {
    return change.before !== null && change.after === null;
  }
  return false;
}

export interface WarningStateChangeNotificationDecision {
  /** §7.5 により、担当する 3 種の状態変化はすべて通知対象。区分同一でも false にしない。 */
  readonly notify: true;
  readonly changeType: WarningStateChangeKind;
  readonly phenomenonKey: WarningPhenomenonKey;
  readonly category: NotificationCategory;
  /** §7.2・§7.3: warning=false、question/emergency=true。 */
  readonly ackRequired: boolean;
  /** 区分をどの規則で決めたか。'release_rule' のとき basisKindCode は null。 */
  readonly categoryBasis: 'after_kind_code' | 'release_rule';
  readonly basisKindCode: string | null;
}

export type WarningStateChangeDecisionErrorReason =
  'unsupported_change_type' | 'malformed_change' | 'unclassifiable_kind_code';

export class WarningStateChangeDecisionError extends Error {
  constructor(
    public readonly reason: WarningStateChangeDecisionErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'WarningStateChangeDecisionError';
  }
}

const ACK_REQUIRED_BY_CATEGORY: Record<NotificationCategory, boolean> = {
  warning: false,
  question: true,
  emergency: true,
};

/**
 * 強化・緩和・解除時の状態変化から通知生成判定を行う純粋関数。
 */
export function decideWarningStateChangeNotification(
  input: WarningStateChangeDecisionInput,
): WarningStateChangeNotificationDecision {
  const changeType = (input as { readonly changeType?: string }).changeType;

  if (changeType !== 'strengthened' && changeType !== 'weakened' && changeType !== 'released') {
    throw new WarningStateChangeDecisionError(
      'unsupported_change_type',
      `Unsupported change type: ${String(changeType)}`,
    );
  }

  if (input.changeType === 'released') {
    if (input.before === null || input.after !== null) {
      throw new WarningStateChangeDecisionError(
        'malformed_change',
        'Released change must have non-null before and null after',
      );
    }
    return {
      notify: true,
      changeType: 'released',
      phenomenonKey: input.phenomenonKey,
      category: 'warning',
      ackRequired: ACK_REQUIRED_BY_CATEGORY.warning,
      categoryBasis: 'release_rule',
      basisKindCode: null,
    };
  }

  if (input.changeType === 'strengthened' || input.changeType === 'weakened') {
    if (input.before === null || input.after === null) {
      throw new WarningStateChangeDecisionError(
        'malformed_change',
        `${input.changeType} change must have non-null before and after`,
      );
    }

    const classification = classifyWarningNotificationCategory(input.after.kindCode);
    if (classification.kind !== 'classified') {
      throw new WarningStateChangeDecisionError(
        'unclassifiable_kind_code',
        `Unclassifiable kindCode in after: ${input.after.kindCode} (result kind: ${classification.kind})`,
      );
    }

    return {
      notify: true,
      changeType: input.changeType,
      phenomenonKey: input.phenomenonKey,
      category: classification.category,
      ackRequired: ACK_REQUIRED_BY_CATEGORY[classification.category],
      categoryBasis: 'after_kind_code',
      basisKindCode: input.after.kindCode,
    };
  }

  throw new WarningStateChangeDecisionError(
    'unsupported_change_type',
    `Unhandled change type: ${String(input.changeType)}`,
  );
}
