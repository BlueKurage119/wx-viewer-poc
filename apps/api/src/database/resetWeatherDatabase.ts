import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  resolveDatabasePairConfig,
  validateDatabasePairConfig,
  assertFixedDatabasePairConfig,
  databaseFiles,
  assertRegularFile,
  type DatabasePairConfig,
} from './pairConfig.js';
import {
  acquireWriterLeases,
  assertFilesUnchanged,
  assertStopped,
  captureFiles,
  fileIdentity,
  inspectDatabaseCopy,
  SCHEMA_FAMILY,
  type DatabaseIdentity,
  type FileIdentity,
} from './pairSafety.js';

export interface ResetPlan {
  version: 1;
  weatherPath: string;
  retainedPath: string;
  identity: DatabaseIdentity | null;
  files: (FileIdentity | null)[];
  deletePaths: string[];
  planDigest: string;
}
interface ResetJournal {
  plan: ResetPlan;
  deletedPaths: string[];
}
export interface ResetOptions {
  mode: 'plan' | 'apply' | 'resume';
  confirmStopped: boolean;
  confirm?: string;
}
/** 専用一時DBの障害注入だけに使用する同期ポート。 */
export interface ResetFaultHooks {
  afterUnlink?(path: string): void;
  beforeProgressWrite?(): void;
}
function digest(plan: Omit<ResetPlan, 'planDigest'>): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
function makePlan(config: DatabasePairConfig): ResetPlan {
  const identity = inspectDatabaseCopy(config.weather);
  const plan: Omit<ResetPlan, 'planDigest'> = {
    version: 1,
    weatherPath: config.weather.databasePath,
    retainedPath: config.retained.databasePath,
    identity,
    files: captureFiles(config.weather.databasePath),
    deletePaths: databaseFiles(config.weather.databasePath),
  };
  return { ...plan, planDigest: digest(plan) };
}
function validateJournal(
  value: unknown,
  config: DatabasePairConfig,
  confirm: string,
  inspectCurrentDatabase = true,
): ResetJournal {
  if (!value || typeof value !== 'object') throw new Error('reset journalが不正です。');
  const journal = value as ResetJournal;
  const plan = journal.plan;
  if (
    !plan ||
    plan.version !== 1 ||
    plan.weatherPath !== config.weather.databasePath ||
    plan.retainedPath !== config.retained.databasePath ||
    plan.planDigest !== confirm ||
    !Array.isArray(plan.files) ||
    plan.files.length !== 4 ||
    !Array.isArray(plan.deletePaths) ||
    JSON.stringify(plan.deletePaths) !==
      JSON.stringify(databaseFiles(config.weather.databasePath)) ||
    !Array.isArray(journal.deletedPaths) ||
    journal.deletedPaths.some((path) => !plan.deletePaths.includes(path))
  )
    throw new Error('reset journalの対象が一致しません。');
  const { planDigest, ...body } = plan;
  if (
    digest(body) !== planDigest ||
    plan.identity?.role !== 'weather' ||
    plan.identity.schema_family !== SCHEMA_FAMILY ||
    !plan.identity.instance_id
  )
    throw new Error('reset journalの識別情報/digestが不正です。');
  for (let i = 0; i < 4; i++) {
    const original = plan.files[i];
    if (original && original.path !== plan.deletePaths[i])
      throw new Error('reset journalのファイル対象が不正です。');
    const current = fileIdentity(plan.deletePaths[i]!);
    if (current && JSON.stringify(current) !== JSON.stringify(original))
      throw new Error('reset対象が再生成または変更されています。');
  }
  if (inspectCurrentDatabase && existsSync(config.weather.databasePath)) {
    const current = inspectDatabaseCopy(config.weather);
    if (JSON.stringify(current) !== JSON.stringify(plan.identity))
      throw new Error('reset対象の世代が変わりました。');
  }
  return journal;
}
export function resetWeatherDatabase(
  input: DatabasePairConfig,
  options: ResetOptions,
  hooks: ResetFaultHooks = {},
): ResetPlan {
  if (!options.confirmStopped)
    throw new Error('--confirm-stopped が必要です。全writerを正規手順で停止してください。');
  if (options.mode !== 'plan' && !options.confirm)
    throw new Error('--confirm <planDigest> が必要です。');
  const config = validateDatabasePairConfig(input);
  for (const path of [
    ...databaseFiles(config.weather.databasePath),
    ...databaseFiles(config.retained.databasePath),
  ])
    assertRegularFile(path);
  const retainedBefore = captureFiles(config.retained.databasePath);
  const release = acquireWriterLeases(config);
  const journalPath = `${config.weather.databasePath}.reset.json`;
  try {
    assertFixedDatabasePairConfig(config);
    assertStopped(config);
    inspectDatabaseCopy(config.retained);
    assertRegularFile(journalPath);
    if (options.mode === 'resume') {
      if (!existsSync(journalPath)) throw new Error('再開するreset journalがありません。');
      const journal = validateJournal(
        JSON.parse(readFileSync(journalPath, 'utf8')),
        config,
        options.confirm!,
      );
      executeDelete(journal, journalPath, config, hooks);
      return journal.plan;
    }
    if (existsSync(journalPath))
      throw new Error('未完了resetがあります。--resume を使用してください。');
    const plan = makePlan(config);
    if (options.mode === 'plan') return plan;
    // 完了後の再実行は、主・付随ファイルが全て不在の場合だけ成功する。
    if (plan.files.every((file) => file === null)) return plan;
    if (plan.planDigest !== options.confirm)
      throw new Error('planDigestが一致しません。再度planで対象を確認してください。');
    if (!plan.identity) throw new Error('識別済み気象DBだけをresetできます。');
    const journal: ResetJournal = { plan, deletedPaths: [] };
    writeFileSync(journalPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
    executeDelete(journal, journalPath, config, hooks);
    return plan;
  } finally {
    try {
      assertFilesUnchanged(config.retained.databasePath, retainedBefore);
    } finally {
      release();
    }
  }
}
function executeDelete(
  journal: ResetJournal,
  journalPath: string,
  config: DatabasePairConfig,
  hooks: ResetFaultHooks,
): void {
  for (let i = 0; i < journal.plan.deletePaths.length; i++) {
    assertFixedDatabasePairConfig(config);
    const path = journal.plan.deletePaths[i]!;
    // 削除範囲をjournalだけで信用せず、保持側の全管理パスとの非重複を確認する。
    const protectedPaths = [
      ...databaseFiles(config.retained.databasePath),
      `${config.retained.databasePath}.writer-lock`,
      `${config.retained.databasePath}.reset.json`,
    ];
    if (protectedPaths.some((protectedPath) => protectedPath.toLowerCase() === path.toLowerCase()))
      throw new Error('保持DBはreset対象にできません。');
    const current = fileIdentity(path);
    if (current) {
      if (JSON.stringify(current) !== JSON.stringify(journal.plan.files[i]))
        throw new Error('削除前に対象ファイルが変更されました。');
      unlinkSync(path);
      hooks.afterUnlink?.(path);
    }
    if (!journal.deletedPaths.includes(path)) journal.deletedPaths.push(path);
    hooks.beforeProgressWrite?.();
    const temporary = `${journalPath}.${process.pid}.tmp`;
    let temporaryOwned = false;
    try {
      writeFileSync(temporary, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
      temporaryOwned = true;
      renameSync(temporary, journalPath);
    } finally {
      if (temporaryOwned && existsSync(temporary)) unlinkSync(temporary);
    }
  }
  if (journal.plan.deletePaths.some(existsSync)) throw new Error('reset対象が残っています。');
  unlinkSync(journalPath);
}
export function parseResetOptions(args: string[]): ResetOptions {
  let mode: ResetOptions['mode'] = 'plan';
  let modeSet = false;
  let confirmStopped = false;
  let confirm: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plan' || arg === '--apply' || arg === '--resume') {
      if (modeSet) throw new Error('reset modeは1つだけ指定してください。');
      mode = arg.slice(2) as ResetOptions['mode'];
      modeSet = true;
    } else if (arg === '--confirm-stopped') confirmStopped = true;
    else if (arg === '--confirm') {
      confirm = args[++i];
      if (!confirm || confirm.startsWith('--')) throw new Error('planDigestが必要です。');
    } else throw new Error('未対応のreset引数です。');
  }
  return { mode, confirmStopped, ...(confirm === undefined ? {} : { confirm }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config: DatabasePairConfig | undefined;
  try {
    const options = parseResetOptions(process.argv.slice(2));
    config = resolveDatabasePairConfig();
    const plan = resetWeatherDatabase(config, options);
    console.log(
      JSON.stringify(
        {
          mode: options.mode,
          ...plan,
          notice:
            options.mode === 'plan'
              ? '気象原文・取得履歴・派生値を削除します。保持DBとタイルcacheは対象外です。'
              : '完了しました。次回の正規起動で気象schemaを再作成し、再取得してください。',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : '気象DB resetに失敗しました。');
    if (config && existsSync(`${config.weather.databasePath}.reset.json`)) {
      const journalPath = `${config.weather.databasePath}.reset.json`;
      try {
        assertRegularFile(journalPath);
        const value = JSON.parse(readFileSync(journalPath, 'utf8')) as ResetJournal;
        const journal = validateJournal(value, config, value.plan.planDigest, false);
        console.error(
          JSON.stringify({
            resetIncomplete: true,
            journalPath,
            planDigest: journal.plan.planDigest,
            completedPaths: journal.plan.deletePaths.filter((path) => !existsSync(path)),
            remainingPaths: journal.plan.deletePaths.filter(existsSync),
            notice:
              'journalを保持しました。同じ対象・元digestで --resume --confirm-stopped を実行してください。',
          }),
        );
      } catch {
        console.error(
          'reset journalの対象・進捗を検証できません。journalを保持したまま保守確認してください。',
        );
      }
    }
    process.exitCode = 1;
  }
}
