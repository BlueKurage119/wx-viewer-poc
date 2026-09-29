import fs from 'node:fs';
import yaml from 'js-yaml';
import { validatePollingScheduleConfig, type PollingScheduleConfig } from './pollingSchedule.js';

export const DEFAULT_CONFIG_URL = new URL('../../../../config/polling.yaml', import.meta.url);
export const LOCAL_CONFIG_URL = new URL('polling.local.yaml', DEFAULT_CONFIG_URL);

export type LocalPollingOverrideStatus =
  'applied' | 'absent' | 'disabled-production' | 'not-applicable';

export interface LoadedPollingScheduleConfig {
  readonly config: PollingScheduleConfig;
  readonly sources: readonly URL[];
  readonly localOverride: LocalPollingOverrideStatus;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseYaml(content: string, configUrl: URL): unknown {
  try {
    return yaml.load(content, { schema: yaml.CORE_SCHEMA, json: false });
  } catch (error) {
    throw new Error(
      `ポーリング設定ファイル (${configUrl.href}) のYAML解析に失敗しました: ${errorMessage(error)}`,
    );
  }
}

function readYaml(configUrl: URL): unknown {
  let content: string;
  try {
    content = fs.readFileSync(configUrl, 'utf-8');
  } catch (error) {
    throw new Error(
      `ポーリング設定ファイル (${configUrl.href}) の読み込みに失敗しました: ${errorMessage(error)}`,
    );
  }
  return parseYaml(content, configUrl);
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneWithoutCycles(value: unknown, stack: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (stack.has(value)) throw new Error('YAMLに循環参照があります');
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => cloneWithoutCycles(item, stack));
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(copy, key, {
        value: cloneWithoutCycles(item, stack),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    stack.delete(value);
  }
}

function mergeMappings(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const merged = cloneWithoutCycles(base, new WeakSet()) as Record<string, unknown>;
  for (const [key, value] of Object.entries(local)) {
    const previous = Object.hasOwn(merged, key) ? merged[key] : undefined;
    const replacement =
      isMapping(previous) && isMapping(value)
        ? mergeMappings(previous, value)
        : cloneWithoutCycles(value, new WeakSet());
    Object.defineProperty(merged, key, {
      value: replacement,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return merged;
}

export function loadPollingScheduleConfigWithSources(
  configUrl: URL = DEFAULT_CONFIG_URL,
): LoadedPollingScheduleConfig {
  const base = readYaml(configUrl);
  const applicable = configUrl.href === DEFAULT_CONFIG_URL.href;
  let localOverride: LocalPollingOverrideStatus = 'not-applicable';
  let local: unknown;
  let hasLocal = false;

  if (applicable) {
    if (process.env.NODE_ENV === 'production') {
      localOverride = 'disabled-production';
    } else {
      let localContent: string | undefined;
      try {
        localContent = fs.readFileSync(LOCAL_CONFIG_URL, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error(
            `ポーリング設定ファイル (${LOCAL_CONFIG_URL.href}) の読み込みに失敗しました: ${errorMessage(error)}`,
          );
        }
        localOverride = 'absent';
      }
      if (localContent !== undefined) {
        local = parseYaml(localContent, LOCAL_CONFIG_URL);
        localOverride = 'applied';
        hasLocal = true;
      }
    }
  }

  const sources = hasLocal ? [configUrl, LOCAL_CONFIG_URL] : [configUrl];
  try {
    if (hasLocal && !isMapping(local)) {
      throw new Error('ローカル設定のルートはマッピングである必要があります');
    }
    if (hasLocal && !isMapping(base)) {
      throw new Error('共有設定のルートはマッピングである必要があります');
    }
    const combined = hasLocal
      ? mergeMappings(
          base as Record<string, unknown>,
          cloneWithoutCycles(local, new WeakSet()) as Record<string, unknown>,
        )
      : base;
    return {
      config: validatePollingScheduleConfig(combined),
      sources,
      localOverride,
    };
  } catch (error) {
    throw new Error(
      `ポーリング設定ファイル (${sources.map((source) => source.href).join(', ')}) の検証に失敗しました: ${errorMessage(error)}`,
    );
  }
}

/** 外部YAML設定を同期的に読み込み、合成後の設定を厳密に検証する。 */
export function loadPollingScheduleConfig(configUrl?: URL): PollingScheduleConfig {
  return loadPollingScheduleConfigWithSources(configUrl).config;
}
