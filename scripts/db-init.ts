/**
 * npm run db:init [-- --reset]
 *
 * SQLite 建库脚本：执行 database/schema.sql 建表/索引/视图。
 * --reset 会先删除现有 DB 文件（含 WAL 附属文件），用于从零重建。
 */
import { loadConfig } from '../server/config.ts';
import { applySqliteSchema, ensureParentDirectory, removeSqliteDatabase, sqliteHasSchema, sqliteIsSeeded } from '../server/db/schema.ts';
import { openSqliteDriver } from '../server/db/sqlite.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.dbDriver !== 'sqlite') {
    console.error(
      `当前 DB_DRIVER=${config.dbDriver}；db:init 只初始化 SQLite。MySQL 请运行：npm run db:init:mysql`,
    );
    process.exitCode = 1;
    return;
  }

  const reset = process.argv.includes('--reset');
  ensureParentDirectory(config.sqlitePath);
  if (reset) {
    const removed = removeSqliteDatabase(config.sqlitePath);
    console.log(removed.length > 0 ? `· 已删除旧数据库文件：${removed.join(', ')}` : '· 没有可删除的旧数据库文件');
  }

  const driver = openSqliteDriver(config.sqlitePath);
  try {
    const hadSchema = await sqliteHasSchema(driver);
    await applySqliteSchema(driver);
    const seeded = await sqliteIsSeeded(driver);
    console.log(`✓ SQLite schema 已就绪：${config.sqlitePath}`);
    console.log(`  · 表结构：${hadSchema && !reset ? '已存在（IF NOT EXISTS，保持原状）' : '已创建'}`);
    console.log(
      seeded
        ? '  · 数据：已有数据集，如需重新导入请运行 npm run db:seed'
        : '  · 数据：为空，下一步运行 npm run db:seed 导入 dataset.json',
    );
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ 初始化 SQLite 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
