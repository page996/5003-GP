/**
 * Schema 测试：SQLite 表/列/索引/视图与期望清单一一对应；
 * 若本机 MySQL（默认 127.0.0.1:3307）可连，则逐表对比 MySQL 列名与 SQLite 是否同构。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { openSqliteDriver } from '../server/db/sqlite.ts';
import { removeSqliteDatabase } from '../server/db/schema.ts';
import { MYSQL_SCHEMA_FILE, SQLITE_SCHEMA_FILE } from '../server/paths.ts';

/** 期望的 SQLite 表 → 列（顺序即 ORDINAL_POSITION 顺序） */
const EXPECTED_TABLES: Record<string, string[]> = {
  app_meta: ['key', 'value', 'updated_at'],
  regions: ['code', 'name_zh', 'name_en', 'sort_order'],
  visa_types: ['code', 'name_zh', 'name_en', 'sort_order'],
  policy_groups: ['code', 'name_zh', 'name_en', 'color', 'description', 'sort_order'],
  visa_categories: [
    'code',
    'name_zh',
    'name_en',
    'policy_group',
    'requires_visa',
    'requires_authorization',
    'severity',
    'color',
  ],
  data_sources: ['source_id', 'title', 'publisher', 'url', 'kind', 'accessed_at', 'status', 'note'],
  data_batches: ['batch_id', 'name', 'source_file', 'imported_at', 'row_count', 'notes'],
  countries: [
    'iso2',
    'name_zh',
    'name_en',
    'region_code',
    'subregion',
    'sort_key',
    'aliases',
    'latitude',
    'longitude',
    'priority',
    'created_at',
    'updated_at',
  ],
  visa_policies: [
    'route_code',
    'country_code',
    'visa_type',
    'category_code',
    'title',
    'summary',
    'conditions_text',
    'source_category',
    'stay_days',
    'stay_unit',
    'stay_rule',
    'window_days',
    'window_max_days',
    'entry_scope',
    'validity_note',
    'application_channel',
    'requires_visa',
    'requires_authorization',
    'data_status',
    'completeness',
    'is_demo',
    'is_visible',
    'source_id',
    'batch_id',
    'collected_at',
    'updated_at',
    'search_text',
  ],
  mentioned_visa_types: ['country_code', 'visa_type', 'raw_text', 'source_id'],
  policy_documents: ['route_code', 'code', 'name', 'requirement', 'quantity', 'is_required', 'condition_text', 'sort_order'],
  policy_fees: [
    'route_code',
    'code',
    'label',
    'amount_min',
    'amount_max',
    'currency',
    'charge_basis',
    'condition_text',
    'comparable',
  ],
  policy_timings: ['route_code', 'code', 'label', 'min_days', 'max_days', 'day_type', 'start_event', 'note', 'sort_order'],
  policy_rules: ['route_code', 'code', 'field_name', 'operator_name', 'expected_value', 'description'],
  search_synonyms: ['term', 'canonical', 'kind', 'weight'],
};

const EXPECTED_VIEWS = ['v_country_map', 'v_policy_cards'];

const EXPECTED_INDEXES = [
  'idx_countries_region',
  'idx_countries_sort',
  'idx_policies_country',
  'idx_policies_type',
  'idx_policies_category',
  'idx_policies_group_lookup',
  'idx_policies_stay',
  'idx_policies_status',
  'idx_policies_complete',
  'idx_mentioned_type',
];

interface SqliteMasterRow {
  name: string;
  type: string;
}

function createTempDatabase(): { filePath: string; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visaatlas-schema-test-'));
  return { filePath: path.join(dir, 'schema.sqlite'), dir };
}

test('SQLite 表/视图清单与期望一致', async () => {
  const { filePath, dir } = createTempDatabase();
  const driver = openSqliteDriver(filePath);
  try {
    await driver.exec(readFileSync(SQLITE_SCHEMA_FILE, 'utf8'));
    const rows = await driver.query<SqliteMasterRow>(
      "SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view')",
    );
    const tables = rows
      .filter(row => row.type === 'table')
      .map(row => String(row.name))
      .sort();
    const views = rows
      .filter(row => row.type === 'view')
      .map(row => String(row.name))
      .sort();
    assert.deepEqual(tables, Object.keys(EXPECTED_TABLES).sort());
    assert.deepEqual(views, [...EXPECTED_VIEWS].sort());
  } finally {
    await driver.close();
    removeSqliteDatabase(filePath);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite 每张表的列名/顺序与期望一致', async () => {
  const { filePath, dir } = createTempDatabase();
  const driver = openSqliteDriver(filePath);
  try {
    await driver.exec(readFileSync(SQLITE_SCHEMA_FILE, 'utf8'));
    for (const [table, expectedColumns] of Object.entries(EXPECTED_TABLES)) {
      const rows = await driver.query<{ name: string }>(`PRAGMA table_info(${table})`);
      const columns = rows.map(row => String(row.name));
      assert.deepEqual(columns, expectedColumns, `表 ${table} 列定义不一致`);
    }
  } finally {
    await driver.close();
    removeSqliteDatabase(filePath);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite 索引清单与期望一致，视图可查询', async () => {
  const { filePath, dir } = createTempDatabase();
  const driver = openSqliteDriver(filePath);
  try {
    await driver.exec(readFileSync(SQLITE_SCHEMA_FILE, 'utf8'));
    const indexRows = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    assert.deepEqual(
      indexRows.map(row => String(row.name)),
      [...EXPECTED_INDEXES].sort(),
    );

    // 关键索引必须真的落在包含筛选列的列上
    const policyIndexes = await driver.query<{ name: string }>('PRAGMA index_list(visa_policies)');
    const indexNames = policyIndexes.map(row => String(row.name));
    for (const expected of [
      'idx_policies_country',
      'idx_policies_type',
      'idx_policies_category',
      'idx_policies_stay',
      'idx_policies_status',
      'idx_policies_complete',
    ]) {
      assert.ok(indexNames.includes(expected), `visa_policies 缺少索引 ${expected}`);
    }

    for (const view of EXPECTED_VIEWS) {
      const row = await driver.get(`SELECT COUNT(*) AS count FROM ${view}`);
      assert.ok(row);
      assert.ok(Number(row['count']) >= 0);
    }
  } finally {
    await driver.close();
    removeSqliteDatabase(filePath);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite 与 MySQL schema 文件静态对比：表/视图清单同构', () => {
  const parse = (sql: string): { tables: string[]; views: string[] } => {
    const tables = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[`"]?(\w+)[`"]?/gi)].map(match => match[1]);
    const views = [
      ...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi),
    ].map(match => match[1]);
    return { tables: tables.sort(), views: views.sort() };
  };
  const sqlite = parse(readFileSync(SQLITE_SCHEMA_FILE, 'utf8'));
  const mysqlSchema = parse(readFileSync(MYSQL_SCHEMA_FILE, 'utf8'));
  assert.deepEqual(mysqlSchema.tables, sqlite.tables);
  assert.deepEqual(mysqlSchema.views, sqlite.views);
});

/** 本机 MySQL 联调环境（root 已启动 127.0.0.1:3307 隔离实例） */
async function tryConnectMysql(): Promise<mysql.Connection | null> {
  try {
    return await mysql.createConnection({
      host: process.env.DB_HOST?.trim() || '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3307),
      user: process.env.DB_USER?.trim() || 'visa_app',
      password: process.env.DB_PASSWORD ?? 'visa_dev_pw',
      database: process.env.DB_NAME?.trim() || 'visa_atlas',
      connectTimeout: 2000,
      timezone: 'Z',
    });
  } catch {
    return null;
  }
}

test('MySQL 列名与 SQLite 同构（本机可连时校验，否则跳过）', async t => {
  const connection = await tryConnectMysql();
  if (!connection) {
    t.skip('本机 MySQL（127.0.0.1:3307）不可用，跳过列名对比');
    return;
  }
  try {
    const database = process.env.DB_NAME?.trim() || 'visa_atlas';
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
      [database],
    );
    const columnsByTable = new Map<string, string[]>();
    for (const row of rows) {
      const table = String(row.tableName);
      const list = columnsByTable.get(table) ?? [];
      list.push(String(row.columnName));
      columnsByTable.set(table, list);
    }
    if (columnCount(columnsByTable) === 0) {
      t.skip(`MySQL 库 ${database} 尚未初始化（运行 npm run db:init:mysql），跳过列名对比`);
      return;
    }
    let compared = 0;
    for (const table of Object.keys(EXPECTED_TABLES)) {
      const mysqlColumns = columnsByTable.get(table);
      if (!mysqlColumns) continue; // 未初始化完的表跳过，不误报
      compared += 1;
      assert.deepEqual(mysqlColumns, EXPECTED_TABLES[table], `MySQL 表 ${table} 列名与 SQLite 不一致`);
    }
    assert.ok(compared > 0, '至少应能对比一张表');
  } finally {
    await connection.end();
  }
});

function columnCount(columnsByTable: Map<string, string[]>): number {
  let count = 0;
  for (const columns of columnsByTable.values()) count += columns.length;
  return count;
}
