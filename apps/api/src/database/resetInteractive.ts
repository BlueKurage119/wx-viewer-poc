import * as readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { lstatSync } from 'node:fs';
import { basename } from 'node:path';
import {
  assertFixedDatabasePairConfig,
  validateDatabasePairConfig,
  type DatabasePairConfig,
} from './pairConfig.js';
import { acquireWriterLeases, assertStopped, inspectDatabaseCopy } from './pairSafety.js';
import {
  describeResetPlan,
  readResetJournalStatus,
  resetWeatherDatabase,
  type ResetJournalStatus,
  type ResetPlan,
} from './resetWeatherDatabase.js';
import {
  inspectWriterLock,
  quarantineStaleWriterLock,
  type WriterLockInspection,
} from './writerLockInspection.js';

export interface ResetIo {
  print(text: string): void;
  ask(question: string): Promise<string>;
}

export interface InteractiveResetDeps {
  inspectLock(lockPath: string): WriterLockInspection;
  quarantine(lockPath: string, expectedToken: string): void;
  reset: typeof resetWeatherDatabase;
  /** 再開モードで確認の問いの前に行う、lease・停止・保持DBの事前検査。 */
  precheck(config: DatabasePairConfig): void;
}

const MAINTENANCE_MESSAGE =
  'reset journalの対象・進捗を検証できません。journalを保持したまま保守確認してください。';

/** 壊れたsymlinkも「存在する」として扱う(ENOENTだけを不在とする)。 */
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return true;
  }
}

function defaultPrecheck(config: DatabasePairConfig): void {
  const release = acquireWriterLeases(config);
  try {
    assertFixedDatabasePairConfig(config);
    assertStopped(config);
    inspectDatabaseCopy(config.retained);
  } finally {
    release();
  }
}

function reportFailure(
  io: ResetIo,
  config: DatabasePairConfig,
  before: ResetJournalStatus | null,
): void {
  io.print('気象DB resetに失敗しました。');
  let status: ResetJournalStatus | null = null;
  try {
    status = readResetJournalStatus(config);
  } catch {
    status = null;
  }
  if (!status) {
    io.print(MAINTENANCE_MESSAGE);
    return;
  }
  io.print(
    `完了済みパス: ${status.completedPaths.length > 0 ? status.completedPaths.join(', ') : 'なし'}`,
  );
  io.print(`残りパス: ${status.remainingPaths.join(', ')}`);
  const progressed = before === null || status.completedPaths.length > before.completedPaths.length;
  if (progressed) {
    io.print('同じコマンド npm run db:reset:weather を再実行すると再開します。');
  } else {
    io.print(
      '削除は進んでいません(journalは前回のままです)。原因を解消してから再実行してください。',
    );
  }
}

const defaultDeps: InteractiveResetDeps = {
  inspectLock: inspectWriterLock,
  quarantine: quarantineStaleWriterLock,
  reset: resetWeatherDatabase,
  precheck: defaultPrecheck,
};

function isAffirmative(answer: string): boolean {
  const trimmed = answer.trim().toLowerCase();
  return trimmed === 'y' || trimmed === 'yes';
}

export function createDefaultResetIo(): ResetIo {
  return {
    print(text: string): void {
      console.log(text);
    },
    async ask(question: string): Promise<string> {
      const rl = readline.createInterface({
        input: defaultInput,
        output: defaultOutput,
      });
      try {
        return await new Promise<string>((resolve) => {
          const onSigint = () => {
            resolve('');
          };
          process.once('SIGINT', onSigint);
          rl.question(`${question} `)
            .then((ans) => {
              process.removeListener('SIGINT', onSigint);
              resolve(ans);
            })
            .catch(() => {
              process.removeListener('SIGINT', onSigint);
              resolve('');
            });
        });
      } finally {
        rl.close();
      }
    },
  };
}

export async function runInteractiveReset(
  config: DatabasePairConfig,
  io: ResetIo,
  deps?: Partial<InteractiveResetDeps>,
): Promise<'completed' | 'resumed' | 'nothing_to_do' | 'cancelled'> {
  const effectiveDeps: InteractiveResetDeps = { ...defaultDeps, ...deps };

  // 1. 設定検証
  const validatedConfig = validateDatabasePairConfig(config);

  // 2. 残留lockの確認: 両方を先に判定し、拒否すべきものがあれば何も変更せず拒否する
  const locks = [
    { role: 'weather', path: `${validatedConfig.weather.databasePath}.writer-lock` },
    { role: 'retained', path: `${validatedConfig.retained.databasePath}.writer-lock` },
  ].map((lock) => ({ ...lock, inspection: effectiveDeps.inspectLock(lock.path) }));

  const rejections: string[] = [];
  for (const lock of locks) {
    const { inspection } = lock;
    if (inspection.state === 'alive') {
      rejections.push(
        `writer lock が存在し、プロセスが稼働中です (path: ${basename(lock.path)}, role: ${inspection.role ?? lock.role}, pid: ${inspection.pid}, reason: ${inspection.reason})。`,
      );
    } else if (inspection.state === 'undeterminable') {
      rejections.push(
        `writer lock の状態を判定できません (path: ${basename(lock.path)}, reason: ${inspection.reason})。`,
      );
    }
  }
  if (rejections.length > 0) {
    for (const message of rejections) io.print(message);
    throw new Error(rejections.join('\n'));
  }

  // 残留ロックの退避は、確認後に実行する。退避後の中止では「変更なし」と表示しない。
  let quarantinedCount = 0;
  const cancelMessage = (): string =>
    quarantinedCount > 0
      ? '中止しました。残留ロックの退避以外に変更はありません。'
      : '中止しました。変更はありません。';

  const staleLocks: { path: string; token: string }[] = [];
  for (const lock of locks) {
    const { inspection } = lock;
    if (inspection.state !== 'stale') continue;
    const lines = [
      '残留 writer lock を検出しました:',
      `  lock: ${basename(lock.path)}`,
      `  role: ${inspection.role ?? lock.role}`,
      `  pid: ${inspection.pid}`,
      `  判定理由: ${inspection.reason}`,
    ];
    if (inspection.startedAt) {
      lines.push(`  記録された開始時刻: ${inspection.startedAt}`);
    }
    if (inspection.processStartedAt) {
      lines.push(`  記録されたプロセス起動時刻: ${inspection.processStartedAt}`);
    }
    if (inspection.currentProcessStartedAt) {
      lines.push(`  現在のプロセス起動時刻: ${inspection.currentProcessStartedAt}`);
    }
    io.print(lines.join('\n'));

    const answer = await io.ask('この残留ロックを解除しますか? [y/N]');
    if (!isAffirmative(answer)) {
      io.print(cancelMessage());
      return 'cancelled';
    }
    staleLocks.push({ path: lock.path, token: inspection.token });
  }
  for (const stale of staleLocks) {
    effectiveDeps.quarantine(stale.path, stale.token);
    quarantinedCount++;
  }

  // 3. journalの確認
  const journalPath = `${validatedConfig.weather.databasePath}.reset.json`;
  let isResume = false;
  let journalStatus: ResetJournalStatus | null = null;

  if (pathExists(journalPath)) {
    isResume = true;
    try {
      journalStatus = readResetJournalStatus(validatedConfig);
      if (!journalStatus) {
        throw new Error('reset journalが見つかりません。');
      }
    } catch {
      io.print(MAINTENANCE_MESSAGE);
      throw new Error(MAINTENANCE_MESSAGE);
    }
    io.print('中断された前回のreset journalを検出しました。');
    io.print(
      `完了済みパス: ${journalStatus.completedPaths.length > 0 ? journalStatus.completedPaths.join(', ') : 'なし'}`,
    );
    io.print(`残りパス: ${journalStatus.remainingPaths.join(', ')}`);
  }

  // 4. 停止の自己申告
  const stoppedAnswer = await io.ask(
    'API・取得Worker・SQLiteツールを全て正規手順で停止しましたか? [y/N]',
  );
  if (!isAffirmative(stoppedAnswer)) {
    io.print(cancelMessage());
    return 'cancelled';
  }

  // 5. plan (新規時) / 事前検査 (再開時)
  let plan: ResetPlan;
  if (!isResume) {
    plan = effectiveDeps.reset(validatedConfig, { mode: 'plan', confirmStopped: true });
    if (plan.files.every((file) => file === null)) {
      io.print('初期化対象がありません。');
      return 'nothing_to_do';
    }
    if (!plan.identity) {
      throw new Error('識別済み気象DBだけをresetできます。');
    }
  } else {
    // 確認の問いの前に、lease・停止・保持DBを再開時と同じ条件で検査する。
    effectiveDeps.precheck(validatedConfig);
    plan = journalStatus!.plan;
  }

  // 6. 確認表示
  if (!isResume) {
    io.print(describeResetPlan(plan));
    const confirmAnswer = await io.ask('削除を実行しますか? [y/N]');
    if (!isAffirmative(confirmAnswer)) {
      io.print(cancelMessage());
      return 'cancelled';
    }
  } else {
    const lines = [
      `対象気象DB: ${plan.weatherPath}`,
      `role: ${plan.identity?.role ?? 'weather'}`,
      `instance_id: ${plan.identity?.instance_id ?? '不明'}`,
      '削除残りファイル:',
      ...journalStatus!.remainingPaths.map((p) => `  - ${p}`),
      '気象原文・取得履歴・派生値を削除します。バックアップは作成しません。保持DB(操作記録・通知履歴・session・起動claim・応答監査)とタイルcacheは対象外です。',
    ];
    io.print(lines.join('\n'));
    const confirmAnswer = await io.ask('再開しますか? [y/N]');
    if (!isAffirmative(confirmAnswer)) {
      io.print(cancelMessage());
      return 'cancelled';
    }
  }

  // 7. 実行
  try {
    effectiveDeps.reset(validatedConfig, {
      mode: isResume ? 'resume' : 'apply',
      confirmStopped: true,
      confirm: plan.planDigest,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('planDigestが一致しません')) {
      io.print('対象が変わりました。もう一度実行してください。');
    } else if (pathExists(journalPath)) {
      reportFailure(io, validatedConfig, journalStatus);
    }
    throw error;
  }

  // 8. 完了表示
  io.print('完了しました。次回の正規起動で気象schemaを再作成し、再取得します。');
  return isResume ? 'resumed' : 'completed';
}
