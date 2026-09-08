import BetterSqlite3 from 'better-sqlite3';

export type DatabaseConnection = BetterSqlite3.Database;

export function openDatabase(databasePath: string): DatabaseConnection {
  const connection = new BetterSqlite3(databasePath);
  connection.pragma('foreign_keys = ON');

  if (connection.pragma('foreign_keys', { simple: true }) !== 1) {
    connection.close();
    throw new Error('SQLite foreign key constraints could not be enabled.');
  }

  return connection;
}
