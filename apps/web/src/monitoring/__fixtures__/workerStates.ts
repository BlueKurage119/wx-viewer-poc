import type {
  MonitoringStatusResponse,
  WeatherRestartOperation,
  WeatherRole,
  WeatherRuntimeStatus,
} from '@wx-viewer-poc/shared';
import type { WeatherRestartState } from '../weatherRestartController';

/** 状態fixtureの基準時刻（監視応答の generatedAt）。 */
export const WORKER_FIXTURE_NOW = '2026-09-20T05:25:28.000Z';

const secondsBefore = (seconds: number) =>
  new Date(Date.parse(WORKER_FIXTURE_NOW) - seconds * 1000).toISOString();

/** 稼働中（fresh）の Worker 状態。overrides で各状態を作る。 */
export function runtimeFixture(
  role: WeatherRole,
  overrides: Partial<WeatherRuntimeStatus> = {},
): WeatherRuntimeStatus {
  return {
    role,
    mode: 'worker',
    workerGeneration: `${role}-1`,
    lifecycle: 'ready',
    reportedAt: secondsBefore(3),
    receivedAt: secondsBefore(3),
    reportFreshness: 'fresh',
    stopReason: null,
    restartAllowed: false,
    pendingRequests: 0,
    exitConfirmed: false,
    failureCode: null,
    ...(role === 'acquisition' ? { prepared: true } : {}),
    ...overrides,
  };
}

export function completedOperation(
  role: WeatherRole,
  overrides: Partial<Extract<WeatherRestartOperation, { status: 'completed' }>> = {},
): Extract<WeatherRestartOperation, { status: 'completed' }> {
  return {
    status: 'completed',
    requestId: `restart-${role}`,
    role,
    result: 'success',
    workerGeneration: `${role}-2`,
    errorCode: null,
    historyRecorded: true,
    ...overrides,
  };
}

export function completedRestart(
  role: WeatherRole,
  overrides: Partial<Extract<WeatherRestartOperation, { status: 'completed' }>> = {},
): WeatherRestartState {
  return {
    phase: 'completed',
    request: { requestId: `restart-${role}`, expectedWorkerGeneration: `${role}-1` },
    operation: completedOperation(role, overrides),
  };
}

export interface WorkerStateFixture {
  readonly name: string;
  readonly acquisition: Partial<WeatherRuntimeStatus>;
  readonly delivery: Partial<WeatherRuntimeStatus>;
  readonly restarts?: Partial<Record<WeatherRole, WeatherRestartState>>;
  /** 集計受領の秒前。undefined なら 3 秒前、null は未受領。 */
  readonly sampleSecondsAgo?: number | null;
}

const allowed = { restartAllowed: true };

/** 設計書 §4.5 の10状態（D2）。提供Workerもworkerモードで与える。 */
export const workerStateFixtures: readonly WorkerStateFixture[] = [
  { name: '正常', acquisition: {}, delivery: {} },
  {
    name: '準備中',
    acquisition: { lifecycle: 'starting' },
    delivery: { lifecycle: 'starting' },
    sampleSecondsAgo: null,
  },
  {
    name: '取得のみ通常停止',
    acquisition: { lifecycle: 'stopped', stopReason: 'requested', ...allowed },
    delivery: {},
  },
  {
    name: '取得のみ異常停止',
    acquisition: {
      lifecycle: 'failed',
      stopReason: 'unexpected_exit',
      failureCode: 'unexpected_exit',
      ...allowed,
    },
    delivery: {},
  },
  {
    name: '提供のみ異常停止',
    acquisition: {},
    delivery: { lifecycle: 'failed', failureCode: 'protocol_error', ...allowed },
    sampleSecondsAgo: 20,
  },
  { name: 'DB失敗', acquisition: {}, delivery: {} },
  {
    name: '再起動中',
    acquisition: { lifecycle: 'restarting' },
    delivery: { lifecycle: 'restarting' },
    restarts: {
      acquisition: {
        phase: 'checking',
        request: { requestId: 'restart-acquisition', expectedWorkerGeneration: 'acquisition-1' },
      },
    },
  },
  {
    name: '再起動失敗',
    acquisition: { lifecycle: 'failed', failureCode: 'unexpected_exit', ...allowed },
    delivery: {},
    restarts: {
      acquisition: completedRestart('acquisition', {
        result: 'failure',
        errorCode: 'restart_not_allowed',
      }),
    },
  },
  {
    name: '再起動結果不明',
    acquisition: { lifecycle: 'failed', failureCode: 'unexpected_exit', ...allowed },
    delivery: {},
    restarts: {
      acquisition: {
        phase: 'unverifiable',
        request: { requestId: 'restart-acquisition', expectedWorkerGeneration: 'acquisition-1' },
      },
    },
  },
  {
    name: '再起動受付後の接続失敗',
    acquisition: {},
    delivery: {
      workerGeneration: 'delivery-2',
      lifecycle: 'failed',
      failureCode: 'initialization_failed',
      ...allowed,
    },
    restarts: { delivery: completedRestart('delivery') },
  },
  {
    name: '報告途絶',
    acquisition: { reportFreshness: 'stale', receivedAt: secondsBefore(40), ...allowed },
    delivery: { reportFreshness: 'stale', receivedAt: secondsBefore(40), ...allowed },
  },
];

export interface AppliedWorkerState {
  readonly data: MonitoringStatusResponse;
  readonly restarts: Readonly<Record<WeatherRole, WeatherRestartState>>;
}

/** 基準の監視応答へ Worker 状態fixtureを適用する。 */
export function applyWorkerState(
  base: MonitoringStatusResponse,
  fixture: Pick<WorkerStateFixture, 'acquisition' | 'delivery' | 'restarts' | 'sampleSecondsAgo'>,
): AppliedWorkerState {
  const sampleSeconds = fixture.sampleSecondsAgo === undefined ? 3 : fixture.sampleSecondsAgo;
  return {
    data: {
      ...base,
      generatedAt: WORKER_FIXTURE_NOW,
      weatherSampleReceivedAt: sampleSeconds === null ? null : secondsBefore(sampleSeconds),
      weatherRuntimes: {
        acquisition: runtimeFixture('acquisition', fixture.acquisition),
        delivery: runtimeFixture('delivery', fixture.delivery),
      },
    },
    restarts: {
      acquisition: fixture.restarts?.acquisition ?? { phase: 'idle' },
      delivery: fixture.restarts?.delivery ?? { phase: 'idle' },
    },
  };
}

export interface TelegramStateFixture {
  readonly name: string;
  readonly apply: (base: MonitoringStatusResponse) => MonitoringStatusResponse;
}

const withReprocessing = (
  base: MonitoringStatusResponse,
  reprocessing: MonitoringStatusResponse['venues'][number]['reprocessing'],
): MonitoringStatusResponse => ({
  ...base,
  venues: base.venues.map((venue) =>
    venue.venueId === base.requestedVenueId ? { ...venue, reprocessing } : venue,
  ),
});

/** 設計書 §4.4 の電文処理6状態（D2）。 */
export const telegramStateFixtures: readonly TelegramStateFixture[] = [
  {
    name: '準備失敗',
    apply: (base) => ({
      ...base,
      readiness: {
        ...base.readiness,
        preparationFailures: [
          {
            stage: 'service_setup',
            venueId: base.requestedVenueId,
            failedAt: WORKER_FIXTURE_NOW,
            code: 'weather_preparation_failed',
          },
        ],
        errorReason: 'サービスの準備に失敗',
      },
    }),
  },
  {
    name: '初回同期中',
    apply: (base) => ({ ...base, readiness: { ...base.readiness, initialFetchPhase: 'running' } }),
  },
  {
    name: '再処理中',
    apply: (base) =>
      withReprocessing(base, {
        status: 'running',
        total: 150,
        processedCount: 60,
        startedAt: WORKER_FIXTURE_NOW,
        finishedAt: null,
        elapsedMs: null,
      }),
  },
  {
    name: '未判定あり',
    apply: (base) => ({
      ...base,
      warningTelegrams: { venueId: base.requestedVenueId, pendingCount: 3 },
    }),
  },
  {
    name: '未判定なし',
    apply: (base) => ({
      ...base,
      warningTelegrams: { venueId: base.requestedVenueId, pendingCount: 0 },
    }),
  },
  {
    name: '読取失敗',
    apply: (base) => ({
      ...base,
      warningTelegrams: null,
      readErrors: [
        {
          section: 'information',
          venueId: base.requestedVenueId,
          kind: 'warning',
          code: 'weather_data_read_failed',
        },
      ],
    }),
  },
];
