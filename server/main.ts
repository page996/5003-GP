/**
 * 服务入口：加载配置 → 打开/自动初始化数据库 → 启动 Fastify。
 *
 * SQLite 模式下 DB 文件缺失会自动建表并从 dataset.json 导入；
 * MySQL 模式需要先运行 npm run db:init:mysql / db:seed:mysql。
 */
import { buildApp } from './app.ts';
import { loadConfig, type AppConfig } from './config.ts';
import type { DatabaseDriver } from './db/driver.ts';
import { createDatabase } from './db/index.ts';
import { asNumber, loadAppMeta } from './db/repository.ts';

async function countRealPolicies(driver: DatabaseDriver): Promise<number> {
  const row = await driver.get(
    'SELECT COUNT(*) AS count FROM visa_policies WHERE is_visible = 1 AND is_demo = 0',
  );
  return asNumber(row ?? {}, 'count');
}

async function start(): Promise<void> {
  const config: AppConfig = loadConfig();
  const bootstrap = await createDatabase(config, {
    log: message => console.log(`[db] ${message}`),
  });
  const app = await buildApp({
    db: bootstrap.driver,
    config,
    logger: { level: process.env.LOG_LEVEL?.trim() || 'info' },
    serveStatic: true,
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await bootstrap.driver.close();
    throw error;
  }

  const [meta, policyCount] = await Promise.all([
    loadAppMeta(bootstrap.driver),
    countRealPolicies(bootstrap.driver),
  ]);
  const datasetVersion = meta.get('dataset_version') ?? 'unknown';
  app.log.info(
    {
      mode: config.dbDriver,
      datasetVersion,
      port: config.port,
      policyCount,
      ...(config.dbDriver === 'sqlite'
        ? { sqlitePath: config.sqlitePath }
        : { mysql: `${config.mysql.host}:${config.mysql.port}/${config.mysql.database}` }),
    },
    'Visa Atlas API 已启动',
  );
  console.log(
    `Visa Atlas API · http://${config.host}:${config.port} · ` +
      `mode=${config.dbDriver} · dataset=${datasetVersion} · policies=${policyCount}`,
  );

  const shutdown = (signal: string): void => {
    app.log.info(`收到 ${signal}，正在关闭服务…`);
    void app
      .close()
      .then(() => bootstrap.driver.close())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ 服务启动失败：${message}`);
  if (error instanceof Error && error.cause instanceof Error) {
    console.error(`  底层原因：${error.cause.message}`);
  }
  process.exitCode = 1;
});
