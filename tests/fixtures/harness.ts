/**
 * 测试装配：临时 SQLite 文件 + 真实 dataset.json（存在时）或 fixture 数据集。
 *
 * 每个测试文件在独立进程里运行（node --test 默认隔离），因此可以各自建库；
 * 全部临时文件在 cleanup() 中删除，不污染 data/ 目录。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DatasetFile } from '../../shared/dataset.ts';
import { buildApp } from '../../server/app.ts';
import { loadConfig, type AppConfig } from '../../server/config.ts';
import type { DatabaseDriver } from '../../server/db/driver.ts';
import { applySqliteSchema, removeSqliteDatabase } from '../../server/db/schema.ts';
import { readDatasetFile, seedDatabase } from '../../server/db/seed.ts';
import { openSqliteDriver } from '../../server/db/sqlite.ts';
import { DATASET_FILE } from '../../server/paths.ts';
import { buildFixtureDataset } from './dataset.ts';

/** ETL 产物是否已生成（决定 api.test 用真数据还是 fixture） */
export const REAL_DATASET_AVAILABLE = existsSync(DATASET_FILE);

export interface TestContext {
  driver: DatabaseDriver;
  app: FastifyInstance;
  dataset: DatasetFile;
  /** true = 使用 data/generated/dataset.json 真实数据 */
  isRealDataset: boolean;
  dbPath: string;
  workspaceDir: string;
  /** 关闭连接并删除临时文件 */
  cleanup: () => Promise<void>;
}

export interface CreateTestContextOptions {
  /** 默认：真实 dataset 存在则用真实数据，否则用 fixture */
  dataset?: 'real' | 'fixture';
  /** 是否额外写一份 dataset JSON（bootstrap 测试用） */
  writeDatasetFile?: boolean;
}

export function createTestConfig(sqlitePath: string): AppConfig {
  return loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '3001',
    DB_DRIVER: 'sqlite',
    DATA_DB_PATH: sqlitePath,
  } as NodeJS.ProcessEnv);
}

export async function createTestContext(options: CreateTestContextOptions = {}): Promise<TestContext> {
  const useReal = options.dataset !== 'fixture' && REAL_DATASET_AVAILABLE;
  const dataset = useReal ? readDatasetFile(DATASET_FILE) : buildFixtureDataset();

  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-test-'));
  const dbPath = path.join(workspaceDir, 'test.sqlite');
  const driver = openSqliteDriver(dbPath);
  try {
    await applySqliteSchema(driver);
    await seedDatabase(driver, dataset);
    if (options.writeDatasetFile) {
      writeFileSync(path.join(workspaceDir, 'dataset.json'), JSON.stringify(dataset), 'utf8');
    }
    const app = await buildApp({
      db: driver,
      config: createTestConfig(dbPath),
      logger: false,
      serveStatic: false,
    });
    await app.ready();

    return {
      driver,
      app,
      dataset,
      isRealDataset: useReal,
      dbPath,
      workspaceDir,
      cleanup: async () => {
        await app.close();
        await driver.close();
        removeSqliteDatabase(dbPath);
        rmSync(workspaceDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await driver.close().catch(() => undefined);
    removeSqliteDatabase(dbPath);
    rmSync(workspaceDir, { recursive: true, force: true });
    throw error;
  }
}

/** 便捷函数：注入 GET 请求并返回解析后的 JSON body（不校验状态码） */
export async function getJson(app: FastifyInstance, url: string): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() };
}
