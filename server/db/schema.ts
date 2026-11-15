/**
 * SQLite 建库/删库与 schema 探测。
 *
 * schema.sql 是一次性建表脚本（IF NOT EXISTS），所以「初始化」对已有库是幂等的。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SQLITE_SCHEMA_FILE } from '../paths.ts';
import type { DatabaseDriver } from './driver.ts';

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

/** 执行 database/schema.sql（含表、索引、视图） */
export async function applySqliteSchema(driver: DatabaseDriver): Promise<void> {
  if (driver.mode !== 'sqlite') {
    throw new Error('applySqliteSchema 仅适用于 sqlite 模式');
  }
  const sql = readFileSync(SQLITE_SCHEMA_FILE, 'utf8');
  await driver.exec(sql);
}

/** app_meta 表是否存在；用于判断空文件是否需要建表 */
export async function sqliteHasSchema(driver: DatabaseDriver): Promise<boolean> {
  const row = await driver.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'");
  return row !== undefined;
}

/** 是否已经导入过数据集（app_meta 有内容） */
export async function sqliteIsSeeded(driver: DatabaseDriver): Promise<boolean> {
  if (!(await sqliteHasSchema(driver))) return false;
  const row = await driver.get('SELECT COUNT(*) AS count FROM app_meta');
  return Number(row?.count ?? 0) > 0;
}

/** 删除 SQLite 主文件与 WAL 附属文件，返回实际删除的路径 */
export function removeSqliteDatabase(filePath: string): string[] {
  const removed: string[] = [];
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
      removed.push(candidate);
    }
  }
  return removed;
}
