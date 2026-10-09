import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { initializeDatabases } from '../src/database/pair.js';
import { openWeatherReader } from '../src/database/roleDatabase.js';
import { resetWeatherDatabase } from '../src/database/resetWeatherDatabase.js';
import { captureFiles } from '../src/database/pairSafety.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestDatabasePairConfig,
} from './helpers/databasePair.js';

for (const interrupt of [false, true]) {
  test(`新readonly readerだけが残ればreset拒否、全close後${interrupt ? '中断・resume' : 'plan・apply'}で保持不変`, () => {
    const f = createTemporaryTestDatabaseFixture();
    const config = createTestDatabasePairConfig(f.config);
    const databases = initializeDatabases(config);
    databases.retained.connection.exec(
      "INSERT INTO terminal_session VALUES ('kept-session','2026-10-09'); INSERT INTO operation_history VALUES (1,'kept-operation','stop','all','success','2026-10-09','2026-10-09','actor','担当者',NULL,NULL)",
    );
    const generation = databases.weatherDatabaseGenerationId;
    const schema = databases.weather.connection
      .prepare('SELECT MAX(version) AS version FROM __schema_migrations')
      .get() as { version: number };
    const preservedTables = [
      '__database_identity',
      'terminal_session',
      'operation_history',
      'notification_output_history',
    ];
    const preservedRows = preservedTables.map((table) =>
      databases.retained.connection.prepare(`SELECT * FROM ${table}`).all(),
    );
    databases.close();
    const beforeRetained = captureFiles(config.retained.databasePath);
    let reader: ReturnType<typeof openWeatherReader> | undefined = openWeatherReader(
      config.weather,
      generation,
      schema.version,
    );
    try {
      assert.equal(existsSync(`${config.weather.databasePath}.writer-lock`), false);
      assert.equal(existsSync(`${config.retained.databasePath}.writer-lock`), false);
      const beforeWeather = captureFiles(config.weather.databasePath);
      if (process.env.WX_TEST_RESET_NEGATIVE_CONTROL === '1') {
        reader.close();
        reader = undefined;
      }
      assert.throws(
        () => resetWeatherDatabase(config, { mode: 'plan', confirmStopped: true }),
        /対象DBを開いているプロセスがあります/,
      );
      assert.deepEqual(captureFiles(config.weather.databasePath), beforeWeather);
      assert.deepEqual(captureFiles(config.retained.databasePath), beforeRetained);
      reader!.close();
      reader = undefined;
      const plan = resetWeatherDatabase(config, { mode: 'plan', confirmStopped: true });
      const apply = { mode: 'apply' as const, confirmStopped: true, confirm: plan.planDigest };
      if (interrupt) {
        assert.throws(
          () =>
            resetWeatherDatabase(config, apply, {
              afterUnlink() {
                throw new Error('固定fixtureの削除直後中断');
              },
            }),
          /固定fixtureの削除直後中断/,
        );
        assert.equal(existsSync(`${config.weather.databasePath}.reset.json`), true);
        resetWeatherDatabase(config, {
          mode: 'resume',
          confirmStopped: true,
          confirm: plan.planDigest,
        });
      } else resetWeatherDatabase(config, apply);
      assert.deepEqual(captureFiles(config.weather.databasePath), [null, null, null, null]);
      assert.deepEqual(captureFiles(config.retained.databasePath), beforeRetained);
      assert.equal(existsSync(`${config.weather.databasePath}.reset.json`), false);
      const restarted = initializeDatabases(config);
      try {
        assert.notEqual(restarted.weatherDatabaseGenerationId, generation);
        assert.deepEqual(
          preservedTables.map((table) =>
            restarted.retained.connection.prepare(`SELECT * FROM ${table}`).all(),
          ),
          preservedRows,
        );
      } finally {
        restarted.close();
      }
    } finally {
      reader?.close();
      f.cleanup();
    }
  });
}
