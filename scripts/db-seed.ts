/**
 * npm run db:seed
 *
 * 把 data/generated/dataset.json 导入 SQLite（单事务，幂等）。
 * 会先确保 schema 存在，可直接在空目录下运行。
 */
import { loadConfig } from '../server/config.ts';
import { applySqliteSchema, ensureParentDirectory, sqliteHasSchema } from '../server/db/schema.ts';
import { readDatasetFile, seedDatabase } from '../server/db/seed.ts';
import { openSqliteDriver } from '../server/db/sqlite.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.dbDriver !== 'sqlite') {
    console.error(
      `当前 DB_DRIVER=${config.dbDriver}；db:seed 只导入 SQLite。MySQL 请运行：npm run db:seed:mysql`,
    );
    process.exitCode = 1;
    return;
  }

  ensureParentDirectory(config.sqlitePath);
  const driver = openSqliteDriver(config.sqlitePath);
  try {
    if (!(await sqliteHasSchema(driver))) {
      await applySqliteSchema(driver);
      console.log('· 数据库尚未建表，已自动执行 database/schema.sql');
    }
    const dataset = readDatasetFile();
    const stats = await seedDatabase(driver, dataset);
    console.log(`✓ 数据集 ${dataset.datasetVersion} 已导入 SQLite：${config.sqlitePath}`);
    console.log(
      `  · 国家 ${stats.countries} · 真实政策 ${stats.policies} · 演示明细 ${stats.demoPolicies} · ` +
        `类型线索 ${stats.mentions} · 同义词 ${stats.synonyms}`,
    );
    console.log(
      `  · 明细行：材料 ${stats.documents} · 费用 ${stats.fees} · 办理时间 ${stats.timings} · 规则 ${stats.rules}`,
    );
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ 导入 SQLite 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
