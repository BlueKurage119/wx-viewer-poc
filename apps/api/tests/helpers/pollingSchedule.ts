import { fileURLToPath } from 'node:url';
import type { PollingScheduleConfig } from '../../src/config/pollingSchedule.js';
import { loadPollingScheduleConfig } from '../../src/config/pollingScheduleLoader.js';

const fixtureUrl = new URL('../fixtures/polling/schedule.yaml', import.meta.url);

/** テスト用の夜間停止スケジュールを、呼出しごとに独立して返す。 */
export function createTestPollingSchedule(): PollingScheduleConfig {
  return loadPollingScheduleConfig(fixtureUrl);
}

/** 時刻にかかわらず全取得元を稼働させるテスト用スケジュールを返す。 */
export function createAlwaysOnTestPollingSchedule(): PollingScheduleConfig {
  const schedule = createTestPollingSchedule();
  return {
    ...schedule,
    periods: schedule.periods.map((period) => ({
      ...period,
      xmlSeconds: period.xmlSeconds ?? 60,
      imageCatalogSeconds: period.imageCatalogSeconds ?? 60,
      amedasSeconds: period.amedasSeconds ?? 60,
      nowcastEnabled: true,
      kikikuruEnabled: true,
    })),
  };
}

/** main 子プロセス用 preload と同じ既定設定ファイルのパス。 */
export const testPollingScheduleFixturePath = fileURLToPath(fixtureUrl);
