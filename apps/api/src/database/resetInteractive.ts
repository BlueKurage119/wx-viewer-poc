import * as readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { validateDatabasePairConfig, type DatabasePairConfig } from './pairConfig.js';
import {
  describeResetPlan,
  readResetJournalStatus,
  resetWeatherDatabase,
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
}

const defaultDeps: InteractiveResetDeps = {
  inspectLock: inspectWriterLock,
  quarantine: quarantineStaleWriterLock,
  reset: resetWeatherDatabase,
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

  // 2. 残留lockの確認
  const locks = [
    { role: 'weather', path: `${validatedConfig.weather.databasePath}.writer-lock` },
    { role: 'retained', path: `${validatedConfig.retained.databasePath}.writer-lock` },
  ];

  for (const lock of locks) {
    const inspection = effectiveDeps.inspectLock(lock.path);
    if (inspection.state === 'absent') {
      continue;
    }
    if (inspection.state === 'alive') {
      io.print(
        `writer lock が存在し、プロセスが稼働中です (path: ${basename(lock.path)}, role: ${inspection.role ?? lock.role}, pid: ${inspection.pid}, reason: ${inspection.reason})。`,
      );
      throw new Error(`writer lock が存在し、プロセスが稼働中です (${lock.path})。`);
    }
    if (inspection.state === 'undeterminable') {
      io.print(
        `writer lock の状態を判定できません (path: ${basename(lock.path)}, reason: ${inspection.reason})。`,
      );
      throw new Error(`writer lock の状態を判定できません (${lock.path})。`);
    }
    if (inspection.state === 'stale') {
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
        io.print('中止しました。変更はありません。');
        return 'cancelled';
      }
      effectiveDeps.quarantine(lock.path, inspection.token);
    }
  }

  // 3. journalの確認
  const journalPath = `${validatedConfig.weather.databasePath}.reset.json`;
  let isResume = false;
  let journalStatus: ReturnType<typeof readResetJournalStatus> = null;

  if (existsSync(journalPath)) {
    isResume = true;
    try {
      journalStatus = readResetJournalStatus(validatedConfig);
      if (!journalStatus) {
        throw new Error('reset journalが見つかりません。');
      }
    } catch {
      io.print(
        'reset journalの対象・進捗を検証できません。journalを保持したまま保守確認してください。',
      );
      throw new Error(
        'reset journalの対象・進捗を検証できません。journalを保持したまま保守確認してください。',
      );
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
    io.print('中止しました。変更はありません。');
    return 'cancelled';
  }

  // 5. plan (新規時)
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
    plan = journalStatus!.plan;
  }

  // 6. 確認表示
  if (!isResume) {
    io.print(describeResetPlan(plan));
    const confirmAnswer = await io.ask('削除を実行しますか? [y/N]');
    if (!isAffirmative(confirmAnswer)) {
      io.print('中止しました。変更はありません。');
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
      io.print('中止しました。変更はありません。');
      return 'cancelled';
    }
  }

  // 7. 実行
  try {
    if (!isResume) {
      effectiveDeps.reset(validatedConfig, {
        mode: 'apply',
        confirmStopped: true,
        confirm: plan.planDigest,
      });
    } else {
      effectiveDeps.reset(validatedConfig, {
        mode: 'resume',
        confirmStopped: true,
        confirm: plan.planDigest,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('planDigestが一致しません')) {
      io.print('対象が変わりました。もう一度実行してください。');
    } else if (existsSync(journalPath)) {
      io.print('気象DB resetに失敗しました。');
      io.print('同じコマンド npm run db:reset:weather を再実行すると再開します。');
    }
    throw error;
  }

  // 8. 完了表示
  io.print('完了しました。次回の正規起動で気象schemaを再作成し、再取得します。');
  return isResume ? 'resumed' : 'completed';
}
