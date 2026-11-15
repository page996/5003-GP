/**
 * SQLite 驱动：使用 Node 24 内置 node:sqlite（DatabaseSync），零外部依赖。
 *
 * 为什么同步驱动也包成 Promise：服务层与 MySQL 驱动共用同一接口，
 * 运行时（249 条量级）同步查询耗时远低于 1ms，包装成本可以忽略。
 */
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseDriver, Row, SqlValue } from './driver.ts';
import { normalizeIsoDateTime, normalizeRow } from './driver.ts';

/** 打开 SQLite 并设置 WAL / 外键等运行参数 */
export function openSqliteDriver(filePath: string, options: { readOnly?: boolean } = {}): DatabaseDriver {
  const database = new DatabaseSync(filePath, {
    readOnly: options.readOnly ?? false,
    enableForeignKeyConstraints: true,
  });

  if (!options.readOnly) {
    // WAL：读写并发更好；NORMAL 在 WAL 下仍能保证崩溃一致性
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = NORMAL');
    database.exec('PRAGMA busy_timeout = 5000');
  }
  database.exec('PRAGMA foreign_keys = ON');

  return new SqliteDriver(database);
}

class SqliteDriver implements DatabaseDriver {
  readonly mode = 'sqlite' as const;
  readonly dialect = 'sqlite' as const;
  private readonly database: DatabaseSync;
  /** 事务串行化：SQLite 单写者，避免同一进程内两个事务交错执行 */
  private transactionQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async query<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    this.assertOpen();
    const rows = this.database.prepare(sql).all(...params);
    return rows.map(normalizeRow) as unknown as T[];
  }

  async get<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    this.assertOpen();
    const row = this.database.prepare(sql).get(...params);
    return row === undefined ? undefined : (normalizeRow(row) as unknown as T);
  }

  async exec(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    this.assertOpen();
    if (params.length > 0) {
      const result = this.database.prepare(sql).run(...params);
      return Number(result.changes);
    }
    this.database.exec(sql);
    return 0;
  }

  async transaction<T>(work: (tx: DatabaseDriver) => Promise<T>): Promise<T> {
    this.assertOpen();
    const previous = this.transactionQueue;
    let release: () => void = () => undefined;
    this.transactionQueue = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(this);
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // 回滚失败时保留原始错误，避免掩盖根因
        }
        throw error;
      }
    } finally {
      release();
    }
  }

  toDbDateTime(iso: string): string {
    return normalizeIsoDateTime(iso, 'datetime');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertOpen(): void {
    if (this.closed || !this.database.isOpen) {
      throw new Error('SQLite 数据库连接已关闭');
    }
  }
}
