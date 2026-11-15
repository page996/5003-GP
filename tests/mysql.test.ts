/**
 * MySQL 端到端冒烟测试。
 *
 * 默认跳过；只有显式开启时才连接真实 MySQL 实例并打 API：
 *   $env:DB_DRIVER='mysql'; $env:DB_PORT='3307'; ... npm.cmd run test:mysql
 * 或 RUN_MYSQL_TESTS=1 npm.cmd test
 *
 * 前置条件：已执行 npm.cmd run db:init:mysql + db:seed:mysql。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import test, { after, before } from 'node:test';
import type { CountryDossier, HealthResponse, SearchResponse } from '../shared/contracts.ts';
import { buildApp } from '../server/app.ts';
import { loadConfig, type AppConfig } from '../server/config.ts';
import type { DatabaseDriver } from '../server/db/driver.ts';
import { createMysqlDriver } from '../server/db/mysql.ts';
import { readDatasetFile } from '../server/db/seed.ts';
import { DATASET_FILE } from '../server/paths.ts';

const ENABLED = process.env.DB_DRIVER === 'mysql' || process.env.RUN_MYSQL_TESTS === '1';

if (!ENABLED) {
  test('MySQL 端到端（未启用，跳过）', t => {
    t.skip('设置 DB_DRIVER=mysql 或 RUN_MYSQL_TESTS=1 后运行 npm run test:mysql');
  });
} else {
  let driver: DatabaseDriver;
  let app: FastifyInstance;

  before(async () => {
    const config: AppConfig = loadConfig({
      ...process.env,
      DB_DRIVER: 'mysql',
      DB_HOST: process.env.DB_HOST?.trim() || '127.0.0.1',
      DB_PORT: process.env.DB_PORT?.trim() || '3307',
      DB_USER: process.env.DB_USER?.trim() || 'visa_app',
      DB_PASSWORD: process.env.DB_PASSWORD ?? 'visa_dev_pw',
      DB_NAME: process.env.DB_NAME?.trim() || 'visa_atlas',
    } as NodeJS.ProcessEnv);
    driver = createMysqlDriver(config.mysql);
    app = await buildApp({ db: driver, config, logger: false, serveStatic: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (driver) await driver.close();
  });

  async function get<T>(url: string): Promise<{ status: number; data: T | undefined }> {
    const response = await app.inject({ method: 'GET', url });
    const body = response.json() as { data?: T };
    return { status: response.statusCode, data: body.data };
  }

  test('MySQL health 返回 mode=mysql 与数据集版本', async () => {
    const { status, data } = await get<HealthResponse>('/api/health');
    assert.equal(status, 200);
    assert.ok(data);
    assert.equal(data.status, 'ok');
    assert.equal(data.mode, 'mysql');
    assert.ok(data.datasetVersion.length > 0);
  });

  test('MySQL search：默认 TOURISM 有结果且结构一致', async () => {
    const { status, data } = await get<SearchResponse>('/api/v1/search');
    assert.equal(status, 200);
    assert.ok(data);
    assert.equal(data.mode, 'mysql');
    assert.equal(data.query.type, 'TOURISM');
    assert.ok(data.total > 0, 'MySQL 库应已 seed 真实数据集');
    assert.equal(data.items.length, Math.min(data.pageSize, data.total));
    assert.equal(data.facets.regions.length, 7);
    assert.equal(data.facets.types.length, 12);
    assert.equal(data.matchedCountries.length, data.total);

    // 与当前 dataset.json 是同一版本时，校验 249 条口径
    if (existsSync(DATASET_FILE)) {
      const dataset = readDatasetFile(DATASET_FILE);
      if (dataset.datasetVersion === data.datasetVersion) {
        const expected = new Set(
          dataset.policies
            .filter(policy => !policy.isDemo && policy.visaType === 'TOURISM')
            .map(policy => policy.countryCode),
        ).size;
        assert.equal(data.total, expected);
        if (expected === 249) assert.equal(data.total, 249);
      }
    }
  });

  test('MySQL search：关键词与筛选走 SQL', async () => {
    const japanese = await get<SearchResponse>(`/api/v1/search?q=${encodeURIComponent('日本')}`);
    assert.equal(japanese.status, 200);
    assert.equal(japanese.data?.items[0]?.iso2, 'JP');

    const business = await get<SearchResponse>('/api/v1/search?type=BUSINESS');
    assert.equal(business.status, 200);
    assert.ok(business.data);
    assert.equal(business.data.query.type, 'BUSINESS');
  });

  test('MySQL 国家档案与契约字段', async () => {
    const { status, data } = await get<CountryDossier>('/api/v1/countries/JP');
    assert.equal(status, 200);
    assert.ok(data);
    assert.equal(data.country.iso2, 'JP');
    assert.ok(data.tourism);
    assert.ok(Array.isArray(data.tourism.documents));
    assert.ok(Array.isArray(data.tourism.fees));
    assert.ok(Array.isArray(data.tourism.timings));
    assert.ok(Array.isArray(data.tourism.rules));
  });

  test('MySQL 模式下错误码与 SQLite 一致', async () => {
    const badType = await app.inject({ method: 'GET', url: '/api/v1/search?type=BOGUS' });
    assert.equal(badType.statusCode, 400);
    const missingCountry = await app.inject({ method: 'GET', url: '/api/v1/countries/ZZ' });
    assert.equal(missingCountry.statusCode, 404);
  });
}
