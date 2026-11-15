/**
 * npm run db:seed:mysql
 *
 * 把 dataset.json 导入 MySQL（单事务，幂等）。不会自动建库/建表：
 * 必须先运行 npm run db:init:mysql。
 */
import { loadConfig } from '../server/config.ts';
import { createMysqlDriver } from '../server/db/mysql.ts';
import { readDatasetFile, seedDatabase } from '../server/db/seed.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = config.mysql;
  const driver = createMysqlDriver(db);
  try {
    const table = await driver.get(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'app_meta'",
      [db.database],
    );
    if (table === undefined) {
      throw new Error(`数据库 ${db.database} 尚未建表：请先运行 npm run db:init:mysql`);
    }
    const dataset = readDatasetFile();
    const stats = await seedDatabase(driver, dataset);
    console.log(`✓ 数据集 ${dataset.datasetVersion} 已导入 MySQL：${db.host}:${db.port}/${db.database}`);
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
  console.error(`✗ 导入 MySQL 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
