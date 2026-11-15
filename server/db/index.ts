/**
 * 数据库入口。
 *
 * - SQLite：默认模式，DB 文件缺失/未种子时自动建库并导入 dataset.json（零配置可跑）；
 * - MySQL：显式脚本建库建表（npm run db:init:mysql / db:seed:mysql），服务只负责连接，
 *   避免服务启动时用应用账号做 DDL 这种高危行为。
 */
import { existsSync } from 'node:fs';
import type { AppConfig } from '../config.ts';
import type { DatabaseDriver } from './driver.ts';
import { createMysqlDriver } from './mysql.ts';
import { applySqliteSchema, ensureParentDirectory, removeSqliteDatabase, sqliteHasSchema, sqliteIsSeeded } from './schema.ts';
import { readDatasetFile, seedDatabase, type SeedStats } from './seed.ts';
import { openSqliteDriver } from './sqlite.ts';

export interface BootstrapOptions {
  /** 测试可覆盖数据集路径 */
  datasetPath?: string;
  log?: (message: string) => void;
}

export interface BootstrapResult {
  driver: DatabaseDriver;
  /** 本次是否执行了种子导入 */
  seeded: boolean;
  stats: SeedStats | null;
}

/** 打开数据库连接（SQLite 会按需创建空文件，不做 schema/种子） */
export async function openDatabase(config: AppConfig): Promise<DatabaseDriver> {
  if (config.dbDriver === 'mysql') {
    return createMysqlDriver(config.mysql);
  }
  ensureParentDirectory(config.sqlitePath);
  return openSqliteDriver(config.sqlitePath);
}

/** SQLite 自动引导：无 schema 则建表；无数据则导入数据集任务 */
export async function ensureSqliteDatabase(
  config: AppConfig,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  if (config.dbDriver !== 'sqlite') {
    throw new Error('ensureSqliteDatabase 只能在 DB_DRIVER=sqlite 时调用');
  }
  const fileExistedBefore = existsSync(config.sqlitePath);
  ensureParentDirectory(config.sqlitePath);
  const driver = openSqliteDriver(config.sqlitePath);
  try {
    let stats: SeedStats | null = null;
    if (!(await sqliteHasSchema(driver))) {
      await applySqliteSchema(driver);
    }
    if (!(await sqliteIsSeeded(driver))) {
      const dataset = readDatasetFile(options.datasetPath);
      stats = await seedDatabase(driver, dataset);
      options.log?.(
        `已从数据集 ${dataset.datasetVersion} 初始化 SQLite：${stats.countries} 国 / ` +
          `${stats.policies} 条真实政策 / ${stats.demoPolicies} 条演示明细`,
      );
    }
    return { driver, seeded: stats !== null, stats };
  } catch (error) {
    await driver.close().catch(() => undefined);
    // 首次启动失败时不要留下半初始化的空库，避免下次误判为「已就绪」
    if (!fileExistedBefore) removeSqliteDatabase(config.sqlitePath);
    throw error;
  }
}

/**
 * 服务启动用：SQLite 自动引导，MySQL 只连接。
 * MySQL 未建表时查询会报错，由 API 层降级为 503。
 */
export async function createDatabase(
  config: AppConfig,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  if (config.dbDriver === 'mysql') {
    const driver = createMysqlDriver(config.mysql);
    return { driver, seeded: false, stats: null };
  }
  return ensureSqliteDatabase(config, options);
}

export type { SeedStats } from './seed.ts';
export type { DatabaseDriver, Row, SqlValue } from './driver.ts';
