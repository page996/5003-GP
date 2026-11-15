/**
 * MySQL 驱动：mysql2/promise 连接池 + 单连接事务。
 *
 * 约定：
 * - 连接 timezone 固定 'Z'，DATETIME(3) 读写统一走 UTC；
 * - DECIMAL（费用金额）保持字符串，避免浮点误差；
 * - JSON 文本列在 schema 里就是 TEXT，驱动不做二次解析；
 * - 连接类错误统一包成 503 DATA_UNAVAILABLE。
 */
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { DataUnavailableError, isDatabaseUnavailableError } from '../errors.ts';
import type { DatabaseDriver, Row, SqlValue } from './driver.ts';
import { formatUtcDateTime, normalizeIsoDateTime, normalizeRows } from './driver.ts';

export interface MysqlDriverOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit?: number;
}

function wrapMysqlError(error: unknown): unknown {
  if (isDatabaseUnavailableError(error)) {
    return new DataUnavailableError('数据库暂不可用，请稍后重试', { cause: error });
  }
  return error;
}

/** 创建 MySQL 连接池；此函数不会建库/建表（显式脚本负责） */
export function createMysqlDriver(options: MysqlDriverOptions): DatabaseDriver {
  const pool: Pool = mysql.createPool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    waitForConnections: true,
    connectionLimit: options.connectionLimit ?? 10,
    queueLimit: 0,
    connectTimeout: 5000,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
  });

  // 连接池后台连接断开时避免未捕获的 'error' 事件终止进程
  pool.pool.on('error', () => undefined);

  return new MysqlDriver(pool);
}

class MysqlDriver implements DatabaseDriver {
  readonly mode = 'mysql' as const;
  readonly dialect = 'mysql' as const;
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async query<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      const [result] = await this.pool.query(sql, params as unknown as unknown[]);
      if (!Array.isArray(result)) return [];
      return normalizeRows(result as Array<Record<string, unknown>>) as unknown as T[];
    } catch (error) {
      throw wrapMysqlError(error);
    }
  }

  async get<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async exec(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    try {
      const [result] = await this.pool.query(sql, params as unknown as unknown[]);
      if (Array.isArray(result)) return 0;
      const header = result as { affectedRows?: number };
      return header.affectedRows ?? 0;
    } catch (error) {
      throw wrapMysqlError(error);
    }
  }

  async transaction<T>(work: (tx: DatabaseDriver) => Promise<T>): Promise<T> {
    let connection: PoolConnection;
    try {
      connection = await this.pool.getConnection();
      await connection.beginTransaction();
    } catch (error) {
      throw wrapMysqlError(error);
    }
    try {
      const result = await work(new MysqlTransactionDriver(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // 回滚失败时保留原始错误
      }
      throw error instanceof Error ? error : wrapMysqlError(error);
    } finally {
      connection.release();
    }
  }

  toDbDateTime(iso: string): string {
    return formatUtcDateTime(new Date(normalizeIsoDateTime(iso, 'datetime')));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** 事务内驱动：绑定单条连接，禁止嵌套事务 */
class MysqlTransactionDriver implements DatabaseDriver {
  readonly mode = 'mysql' as const;
  readonly dialect = 'mysql' as const;
  private readonly connection: PoolConnection;

  constructor(connection: PoolConnection) {
    this.connection = connection;
  }

  async query<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    try {
      const [result] = await this.connection.query(sql, params as unknown as unknown[]);
      if (!Array.isArray(result)) return [];
      return normalizeRows(result as Array<Record<string, unknown>>) as unknown as T[];
    } catch (error) {
      throw wrapMysqlError(error);
    }
  }

  async get<T = Row>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async exec(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    try {
      const [result] = await this.connection.query(sql, params as unknown as unknown[]);
      if (Array.isArray(result)) return 0;
      return (result as { affectedRows?: number }).affectedRows ?? 0;
    } catch (error) {
      throw wrapMysqlError(error);
    }
  }

  async transaction<T>(_work: (tx: DatabaseDriver) => Promise<T>): Promise<T> {
    throw new Error('MySQL 事务不支持嵌套');
  }

  toDbDateTime(iso: string): string {
    return formatUtcDateTime(new Date(normalizeIsoDateTime(iso, 'datetime')));
  }

  async close(): Promise<void> {
    // 连接由外层 transaction 释放
  }
}
