import { MONITORED_FETCH_SOURCES } from '../monitoring/fetchHealthSources.js';
import type { DecisionCheckpoint, WeatherEpoch } from './weatherContracts.js';
import { sameWeatherEpoch } from './weatherContracts.js';

export interface WeatherUpdateUnit {
  readonly unitId: string;
  readonly epoch: WeatherEpoch;
  readonly beforeRevision: number;
  readonly scopes: readonly string[];
  readonly initialWarningKeys: readonly string[];
  readonly initialBosaiKeys: readonly string[];
}
export function emptyDecisionCheckpoint(): DecisionCheckpoint {
  const previousStatusBySource = Object.fromEntries(
    MONITORED_FETCH_SOURCES.map((s) => [s.id, null]),
  ) as DecisionCheckpoint['fetchHealth']['previousStatusBySource'];
  const activeSinceAtBySource = Object.fromEntries(
    MONITORED_FETCH_SOURCES.map((s) => [s.id, null]),
  ) as DecisionCheckpoint['fetchHealth']['activeSinceAtBySource'];
  return {
    revision: 0,
    warningDoneKeys: [],
    bosaiCompletedKeys: [],
    bosaiCollecting: true,
    fetchHealth: { previousStatusBySource, activeSinceAtBySource },
  };
}
/** メインが所有する判定状態。結果不明は登録したscopeの初回keyだけを消費する。 */
export class WeatherDecisionState {
  private checkpoint: DecisionCheckpoint;
  private pending: WeatherUpdateUnit | null = null;
  private readonly unknownUnits: WeatherUpdateUnit[] = [];
  constructor(
    private epoch: WeatherEpoch,
    initial = emptyDecisionCheckpoint(),
  ) {
    this.checkpoint = structuredClone(initial);
  }
  snapshot(): DecisionCheckpoint {
    return structuredClone(this.checkpoint);
  }
  get pendingUnit(): WeatherUpdateUnit | null {
    return structuredClone(this.pending);
  }
  getUnknownUnits(): readonly WeatherUpdateUnit[] {
    return structuredClone(this.unknownUnits);
  }
  begin(unit: WeatherUpdateUnit): void {
    if (
      this.pending ||
      !sameWeatherEpoch(unit.epoch, this.epoch) ||
      unit.beforeRevision !== this.checkpoint.revision
    )
      throw new Error('更新単位の世代または順序が不正です');
    this.pending = structuredClone(unit);
  }
  accept(unitId: string, beforeRevision: number, after: DecisionCheckpoint): void {
    if (
      this.pending?.unitId !== unitId ||
      beforeRevision !== this.checkpoint.revision ||
      after.revision !== beforeRevision + 1
    )
      throw new Error('判定状態の順序が不正です');
    this.checkpoint = structuredClone(after);
  }
  complete(unitId: string): void {
    if (
      this.pending?.unitId !== unitId ||
      this.checkpoint.revision !== this.pending.beforeRevision + 1
    )
      throw new Error('未受領の更新単位です');
    this.pending = null;
  }
  replaceEpoch(epoch: WeatherEpoch): void {
    if (this.pending) {
      if (this.checkpoint.revision === this.pending.beforeRevision) {
        this.unknownUnits.push(this.pending);
        if (this.unknownUnits.length > 200) this.unknownUnits.shift();
        this.checkpoint = {
          ...this.checkpoint,
          revision: this.checkpoint.revision + 1,
          warningDoneKeys: [
            ...new Set([...this.checkpoint.warningDoneKeys, ...this.pending.initialWarningKeys]),
          ],
          bosaiCompletedKeys: [
            ...new Set([...this.checkpoint.bosaiCompletedKeys, ...this.pending.initialBosaiKeys]),
          ],
        };
      }
      this.pending = null;
    }
    this.epoch = { ...epoch };
  }
}
