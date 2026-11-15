/**
 * 数据库驱动的统一抽象。
 *
 * 服务层只依赖本接口，SQLite（node:sqlite）与 MySQL（mysql2）实现同构语义：
 * - 同步驱动被包成 Promise，调用方一律 await；
 * - SQL 永远使用 `?` 占位符，用户输入只作为参数传入；
 * - DATETIME 在两种驱动里都换算成 UTC，保证 API 输出与库内值一致。
 */
import type { DbMode } from '../../shared/contracts.ts';

/** 允许绑定到占位符的值类型 */
export type SqlValue = string | number | bigint | null | Uint8Array;

/** 查询结果行：列名 → 归一化后的值（Date 已转 ISO 字符串） */
export type Row = Record<string, SqlValue>;

export interface DatabaseDriver {
  readonly mode: DbMode;
  readonly dialect: 'sqlite' | 'mysql';
  /** 查询多行；调用方可用自定义行接口（T 默认 Row） */
  query<T = Row>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** 查询单行 */
  get<T = Row>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /** 执行写/DDL，返回受影响行数（DDL 返回 0） */
  exec(sql: string, params?: readonly SqlValue[]): Promise<number>;
  /** 在单个事务中执行；MySQL 会独占一条连接，SQLite 串行化事务 */
  transaction<T>(work: (tx: DatabaseDriver) => Promise<T>): Promise<T>;
  /** 把 ISO 时间串转成该驱动需要的时间绑定值（SQLite=TEXT，MySQL=DATETIME(3)） */
  toDbDateTime(iso: string): string;
  close(): Promise<void>;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 统一成 UTC 'YYYY-MM-DD HH:MM:SS.mmm'（MySQL DATETIME(3) 用） */
export function formatUtcDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.` +
    `${String(date.getUTCMilliseconds()).padStart(3, '0')}`
  );
}

/** 校验并规范化 ISO 时间串；数据集里的错误时间要在种子阶段就暴露出来 */
export function normalizeIsoDateTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`数据错误：${field}=${JSON.stringify(value)} 不是合法的 ISO 时间`);
  }
  return date.toISOString();
}

/** 把驱动返回的原始行归一化：Date → ISO 字符串，undefined → null */
export function normalizeRow(raw: Record<string, unknown>): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) {
      row[key] = null;
    } else if (value instanceof Date) {
      row[key] = Number.isNaN(value.getTime()) ? null : value.toISOString();
    } else {
      row[key] = value as SqlValue;
    }
  }
  return row;
}

export function normalizeRows(rows: ReadonlyArray<Record<string, unknown>>): Row[] {
  return rows.map(normalizeRow);
}
