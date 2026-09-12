import fs from 'node:fs';
import yaml from 'js-yaml';
import { validatePollingScheduleConfig, type PollingScheduleConfig } from './pollingSchedule.js';

export const DEFAULT_CONFIG_URL = new URL('../../../../config/polling.yaml', import.meta.url);

/**
 * 外部YAML設定ファイルを同期的に読み込み、厳密に検証して設定オブジェクトを返す。
 *
 * - ファイル不在、読み込み失敗、YAML構文エラー、スキーマ検証違反はパスと詳細理由を含むエラーをスロー。
 * - 既定値フォールバックは行わない。
 */
export function loadPollingScheduleConfig(
  configUrl: URL = DEFAULT_CONFIG_URL,
): PollingScheduleConfig {
  let content: string;
  try {
    content = fs.readFileSync(configUrl, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ポーリング設定ファイル (${configUrl.toString()}) の読み込みに失敗しました: ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content, {
      schema: yaml.CORE_SCHEMA,
      json: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ポーリング設定ファイル (${configUrl.toString()}) のYAML解析に失敗しました: ${message}`,
    );
  }

  try {
    return validatePollingScheduleConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ポーリング設定ファイル (${configUrl.toString()}) の検証に失敗しました: ${message}`,
    );
  }
}
