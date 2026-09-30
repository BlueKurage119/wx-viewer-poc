import crypto from 'node:crypto';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {
  createTerminalRegistry,
  isValidTerminalId,
  type TerminalConfigResponse,
  type TerminalDefinition,
  type TerminalRegistry,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';

export const DEFAULT_TERMINALS_CONFIG_URL = new URL(
  '../../../../config/terminals.yaml',
  import.meta.url,
);
export const LOCAL_TERMINALS_CONFIG_URL = new URL(
  'terminals.local.yaml',
  DEFAULT_TERMINALS_CONFIG_URL,
);

export interface LoadedTerminalConfig {
  readonly registry: TerminalRegistry;
  readonly response: TerminalConfigResponse;
  readonly sources: readonly URL[];
  readonly localOverride: 'applied' | 'absent' | 'disabled-production' | 'not-applicable';
}

type Mapping = Record<string, unknown>;
class TerminalConfigReadError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}
const keys = ['id', 'name', 'mode', 'venueId'] as const;
function relative(url: URL): string {
  if (url.href === DEFAULT_TERMINALS_CONFIG_URL.href) return 'config/terminals.yaml';
  if (url.href === LOCAL_TERMINALS_CONFIG_URL.href) return 'config/terminals.local.yaml';
  return url.pathname.split('/').filter(Boolean).at(-1) ?? 'terminals.yaml';
}
function mapping(value: unknown, path: string): Mapping {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} はマッピングである必要があります`);
  return value as Mapping;
}
function exactKeys(
  value: Mapping,
  allowed: readonly string[],
  path: string,
  partial = false,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${path}.${key} は未知の設定キーです`);
  if (!partial)
    for (const key of allowed) if (!(key in value)) throw new Error(`${path}.${key} が必要です`);
}
function validId(value: unknown, path: string): string {
  if (!isValidTerminalId(value)) throw new Error(`${path} の形式または予約語が不正です`);
  return value;
}
function read(url: URL): unknown {
  let content: string;
  try {
    content = fs.readFileSync(url, 'utf8');
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    throw new TerminalConfigReadError(`${relative(url)} の読み込みに失敗しました`, code);
  }
  try {
    return yaml.load(content, { schema: yaml.CORE_SCHEMA, json: false });
  } catch (error) {
    const mark = error instanceof yaml.YAMLException ? error.mark : undefined;
    const location = mark ? `${mark.line + 1}行${mark.column + 1}列` : '位置を特定できません';
    throw new Error(`${relative(url)} のYAML解析に失敗しました: ${location}`);
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function isNotFound(error: unknown): boolean {
  return error instanceof TerminalConfigReadError && error.code === 'ENOENT';
}
function validateLoaded(
  url: URL,
  value: unknown,
  venues: VenueRegistry,
): readonly TerminalDefinition[] {
  try {
    return validateTerminalConfig(value, venues);
  } catch (error) {
    throw new Error(`${relative(url)}: ${errorMessage(error)}`);
  }
}
export function validateTerminalConfig(
  value: unknown,
  venues: VenueRegistry,
): readonly TerminalDefinition[] {
  const root = mapping(value, 'root');
  exactKeys(root, ['terminals'], 'root');
  if (!Array.isArray(root.terminals) || root.terminals.length === 0)
    throw new Error('terminals は1件以上の配列で指定してください');
  const ids = new Set<string>();
  const names = new Set<string>();
  return root.terminals.map((item, index) => {
    const path = `terminals[${index}]`;
    const terminal = mapping(item, path);
    exactKeys(terminal, keys, path);
    const id = validId(terminal.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id が重複しています`);
    ids.add(id);
    if (
      typeof terminal.name !== 'string' ||
      terminal.name.trim() !== terminal.name ||
      terminal.name.length < 1 ||
      terminal.name.length > 80
    )
      throw new Error(`${path}.name は前後空白なしの1〜80文字で指定してください`);
    if (names.has(terminal.name)) throw new Error(`${path}.name が重複しています`);
    names.add(terminal.name);
    if (terminal.mode !== 'H' && terminal.mode !== 'K')
      throw new Error(`${path}.mode は H または K で指定してください`);
    const venueId = venues.resolveVenueId(terminal.venueId);
    if (venueId === null) throw new Error(`${path}.venueId は登録済み会場で指定してください`);
    return { id, name: terminal.name, mode: terminal.mode, venueId };
  });
}
export function validateLocalTerminalConfig(value: unknown): readonly Mapping[] {
  const root = mapping(value, 'root');
  exactKeys(root, ['terminals'], 'root');
  if (!Array.isArray(root.terminals) || root.terminals.length === 0)
    throw new Error('terminals は1件以上の配列で指定してください');
  const ids = new Set<string>();
  return root.terminals.map((item, index) => {
    const path = `terminals[${index}]`;
    const terminal = mapping(item, path);
    exactKeys(terminal, keys, path, true);
    const id = validId(terminal.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id が重複しています`);
    ids.add(id);
    for (const [key, entry] of Object.entries(terminal)) {
      if (
        key === 'name' &&
        (typeof entry !== 'string' ||
          entry.trim() !== entry ||
          entry.length < 1 ||
          entry.length > 80)
      )
        throw new Error(`${path}.name は前後空白なしの1〜80文字で指定してください`);
      if (key === 'mode' && entry !== 'H' && entry !== 'K')
        throw new Error(`${path}.mode は H または K で指定してください`);
      if (key === 'venueId' && (typeof entry !== 'string' || entry.length === 0))
        throw new Error(`${path}.venueId は空でない文字列で指定してください`);
    }
    return terminal;
  });
}
export function loadTerminalConfig(options: {
  readonly baseUrl?: URL;
  readonly localUrl?: URL;
  readonly environment?: string;
  readonly venueRegistry: VenueRegistry;
  readonly venueGeneration?: string;
}): LoadedTerminalConfig {
  const baseUrl = options.baseUrl ?? DEFAULT_TERMINALS_CONFIG_URL;
  const localUrl = options.localUrl ?? LOCAL_TERMINALS_CONFIG_URL;
  const applicable =
    baseUrl.href === DEFAULT_TERMINALS_CONFIG_URL.href ||
    (options.baseUrl !== undefined && options.localUrl !== undefined);
  const base = read(baseUrl);
  let terminals = validateLoaded(baseUrl, base, options.venueRegistry);
  const sources: URL[] = [baseUrl];
  let localOverride: LoadedTerminalConfig['localOverride'] = applicable
    ? 'absent'
    : 'not-applicable';
  if (applicable && (options.environment ?? process.env.NODE_ENV) === 'production') {
    localOverride = 'disabled-production';
  } else if (applicable) {
    try {
      let local: readonly Mapping[];
      try {
        local = validateLocalTerminalConfig(read(localUrl));
      } catch (error) {
        if (isNotFound(error)) throw error;
        throw new Error(`${relative(localUrl)}: ${errorMessage(error)}`);
      }
      const combined: Mapping[] = terminals.map((terminal) => ({ ...terminal }));
      const byId = new Map(combined.map((terminal) => [terminal.id, terminal]));
      for (const change of local) {
        const previous = byId.get(change.id);
        if (previous) Object.assign(previous, change);
        else combined.push({ ...change });
      }
      terminals = validateLoaded(localUrl, { terminals: combined }, options.venueRegistry);
      localOverride = 'applied';
      sources.push(localUrl);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  const generation = crypto.createHash('sha256').update(JSON.stringify(terminals)).digest('hex');
  const registry = createTerminalRegistry(terminals, generation);
  return {
    registry,
    response: {
      generation,
      venueGeneration: options.venueGeneration ?? options.venueRegistry.generation,
      terminals: registry.listTerminals(),
    },
    sources,
    localOverride,
  };
}
