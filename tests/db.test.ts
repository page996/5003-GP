/**
 * 数据层测试：seed 幂等、外键生效、行数与数据集一致、视图可用、
 * 注入式关键词安全、SQLite 自动引导（缺库建库/缺数据集清晰报错）。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_SEARCH_QUERY } from '../shared/contracts.ts';
import type { DatasetFile } from '../shared/dataset.ts';
import { ensureSqliteDatabase } from '../server/db/index.ts';
import type { DatabaseDriver } from '../server/db/driver.ts';
import { applySqliteSchema, removeSqliteDatabase } from '../server/db/schema.ts';
import { readDatasetFile, seedDatabase } from '../server/db/seed.ts';
import { openSqliteDriver } from '../server/db/sqlite.ts';
import { asNumber, loadAppMeta } from '../server/db/repository.ts';
import { search } from '../server/services/search.ts';
import { DATASET_FILE, SQLITE_SCHEMA_FILE } from '../server/paths.ts';
import { buildFixtureDataset } from './fixtures/dataset.ts';
import { createTestConfig } from './fixtures/harness.ts';

const TABLES = [
  'app_meta',
  'regions',
  'visa_types',
  'policy_groups',
  'visa_categories',
  'data_sources',
  'data_batches',
  'countries',
  'visa_policies',
  'mentioned_visa_types',
  'policy_documents',
  'policy_fees',
  'policy_timings',
  'policy_rules',
  'search_synonyms',
] as const;

async function withTempDatabase(
  run: (context: { driver: DatabaseDriver; dbPath: string; dir: string; dataset: DatasetFile }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-db-test-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const driver = openSqliteDriver(dbPath);
  const dataset = buildFixtureDataset();
  try {
    await applySqliteSchema(driver);
    await seedDatabase(driver, dataset);
    await run({ driver, dbPath, dir, dataset });
  } finally {
    await driver.close();
    removeSqliteDatabase(dbPath);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function snapshotTable(driver: DatabaseDriver, table: string): Promise<unknown[]> {
  return driver.query(`SELECT * FROM ${table}`);
}

async function snapshotAll(driver: DatabaseDriver): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    snapshot[table] = await snapshotTable(driver, table);
  }
  return snapshot;
}

test('重复 seed 幂等：两次导入后所有表数据完全一致', async () => {
  await withTempDatabase(async ({ driver, dataset }) => {
    const first = await snapshotAll(driver);
    const stats = await seedDatabase(driver, dataset);
    const second = await snapshotAll(driver);
    assert.deepEqual(second, first);
    assert.equal(stats.countries, dataset.countries.length);
    assert.equal(stats.policies + stats.demoPolicies, dataset.policies.length);
  });
});

test('行数与数据集一致，明细行完整导入', async () => {
  await withTempDatabase(async ({ driver, dataset }) => {
    const count = async (sql: string): Promise<number> => asNumber((await driver.get(sql)) ?? {}, 'count');
    assert.equal(await count('SELECT COUNT(*) AS count FROM countries'), dataset.countries.length);
    assert.equal(await count('SELECT COUNT(*) AS count FROM visa_policies'), dataset.policies.length);
    assert.equal(
      await count('SELECT COUNT(*) AS count FROM visa_policies WHERE is_demo = 1'),
      dataset.policies.filter(policy => policy.isDemo).length,
    );
    assert.equal(await count('SELECT COUNT(*) AS count FROM mentioned_visa_types'), dataset.mentions.length);
    assert.equal(await count('SELECT COUNT(*) AS count FROM search_synonyms'), dataset.synonyms.length);

    const expectedDocuments = dataset.policies.reduce((total, policy) => total + policy.documents.length, 0);
    const expectedFees = dataset.policies.reduce((total, policy) => total + policy.fees.length, 0);
    const expectedTimings = dataset.policies.reduce((total, policy) => total + policy.timings.length, 0);
    const expectedRules = dataset.policies.reduce((total, policy) => total + policy.rules.length, 0);
    assert.equal(await count('SELECT COUNT(*) AS count FROM policy_documents'), expectedDocuments);
    assert.equal(await count('SELECT COUNT(*) AS count FROM policy_fees'), expectedFees);
    assert.equal(await count('SELECT COUNT(*) AS count FROM policy_timings'), expectedTimings);
    assert.equal(await count('SELECT COUNT(*) AS count FROM policy_rules'), expectedRules);

    const meta = await loadAppMeta(driver);
    assert.equal(meta.get('dataset_version'), dataset.datasetVersion);
    assert.equal(meta.get('schema_version'), '2.0');
    assert.equal(meta.get('source_file'), dataset.source.file);
    assert.equal(meta.get('source_hash'), dataset.source.sha256);
  });
});

test('外键约束生效：非法引用与删除被引用行都会失败', async () => {
  await withTempDatabase(async ({ driver }) => {
    await assert.rejects(
      driver.exec("INSERT INTO mentioned_visa_types (country_code, visa_type, raw_text) VALUES ('ZZ', 'BUSINESS', 'x')"),
    );
    await assert.rejects(
      driver.exec("INSERT INTO visa_policies (route_code, country_code, visa_type, category_code, title, data_status, completeness, collected_at, updated_at, search_text) VALUES ('ZZ-X', 'ZZ', 'TOURISM', 'EMBASSY_VISA', 'x', 'SUMMARY_ONLY', 10, '2026-01-01', '2026-01-01', 'x')"),
    );
    await assert.rejects(driver.exec("DELETE FROM countries WHERE iso2 = 'JP'"));
  });
});

test('视图 v_country_map / v_policy_cards 可查询', async () => {
  await withTempDatabase(async ({ driver, dataset }) => {
    const mapCount = asNumber((await driver.get('SELECT COUNT(*) AS count FROM v_country_map')) ?? {}, 'count');
    assert.equal(mapCount, dataset.countries.length);
    const cardCount = asNumber((await driver.get('SELECT COUNT(*) AS count FROM v_policy_cards')) ?? {}, 'count');
    assert.equal(cardCount, dataset.policies.length);

    const jp = await driver.get("SELECT * FROM v_country_map WHERE iso2 = 'JP'");
    assert.ok(jp);
    assert.equal(asNumber(jp, 'has_data'), 1);
    assert.equal(typeof jp['tourism_route_code'], 'string');
  });
});

test('SQL 注入式关键词不报错，也不扩大结果集', async () => {
  await withTempDatabase(async ({ driver }) => {
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", '"; DROP TABLE countries; --', '%; DELETE FROM visa_policies; --']) {
      const result = await search(driver, { ...DEFAULT_SEARCH_QUERY, q });
      assert.equal(result.total, 0, `关键词 ${q} 不应命中任何条目`);
    }
    // 下划线是 LIKE 通配符，必须被转义成普通字符：只会命中编码里真的含 "_" 的类别
    const underscore = await search(driver, { ...DEFAULT_SEARCH_QUERY, q: '_' });
    assert.ok(underscore.items.every(item => item.categoryCode?.includes('_') ?? false));
    const tables = await driver.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'countries'");
    assert.equal(tables.length, 1);
  });
});

test('ensureSqliteDatabase：缺库时自动建表并导入数据集，第二次不再导入', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-bootstrap-'));
  const dbPath = path.join(dir, 'auto.sqlite');
  const datasetPath = path.join(dir, 'dataset.json');
  writeFileSync(datasetPath, JSON.stringify(buildFixtureDataset()), 'utf8');
  const config = createTestConfig(dbPath);
  try {
    const first = await ensureSqliteDatabase(config, { datasetPath });
    try {
      assert.equal(first.seeded, true);
      const count = asNumber((await first.driver.get('SELECT COUNT(*) AS count FROM countries')) ?? {}, 'count');
      assert.equal(count, buildFixtureDataset().countries.length);
    } finally {
      await first.driver.close();
    }

    const second = await ensureSqliteDatabase(config, { datasetPath });
    try {
      assert.equal(second.seeded, false);
      assert.equal(second.stats, null);
    } finally {
      await second.driver.close();
    }
  } finally {
    removeSqliteDatabase(dbPath);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureSqliteDatabase：数据集缺失时给出清晰中文错误且不留空库', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-bootstrap-missing-'));
  const dbPath = path.join(dir, 'auto.sqlite');
  const config = createTestConfig(dbPath);
  try {
    await assert.rejects(ensureSqliteDatabase(config, { datasetPath: path.join(dir, 'missing.json') }), /未找到数据集文件/);
    assert.equal(existsSync(dbPath), false, '引导失败后不应留下半初始化数据库');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('种子脚本可用的数据集读取：真实文件存在时能被解析', async () => {
  if (!existsSync(DATASET_FILE)) return; // ETL 未生成时跳过（fixture 已覆盖格式）
  const dataset = readDatasetFile(DATASET_FILE);
  assert.equal(dataset.schemaVersion, '2.0');
  assert.ok(dataset.countries.length >= 200);
  assert.ok(dataset.policies.some(policy => !policy.isDemo && policy.visaType === 'TOURISM'));
});

test('数据库 schema 文件可重复执行（IF NOT EXISTS 幂等）', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-schema-idempotent-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const driver = openSqliteDriver(dbPath);
  try {
    const sql = readFileSync(SQLITE_SCHEMA_FILE, 'utf8');
    await driver.exec(sql);
    await driver.exec(sql);
    const tables = await driver.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visa_policies'");
    assert.equal(tables.length, 1);
  } finally {
    await driver.close();
    removeSqliteDatabase(dbPath);
    rmSync(dir, { recursive: true, force: true });
  }
});
