/**
 * npm run db:check:mysql
 *
 * MySQL 快检报告：连接信息/字符集 → 表与视图清单 → 行数 → 与 SQLite 的列名对比。
 * 发现缺表/缺视图/字符集错误/列名不一致时以非 0 退出码结束，便于 CI 使用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import { loadConfig } from '../server/config.ts';
import { DEFAULT_SQLITE_FILE, MYSQL_SCHEMA_FILE, SQLITE_SCHEMA_FILE } from '../server/paths.ts';

interface SchemaObjects {
  tables: string[];
  views: string[];
}

function parseSchemaObjects(sql: string): SchemaObjects {
  const tables: string[] = [];
  const views: string[] = [];
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[`"]?(\w+)[`"]?/gi)) {
    tables.push(match[1]);
  }
  for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi)) {
    views.push(match[1]);
  }
  return { tables, views };
}

function quoteSqliteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 读取 SQLite 各表列名（只读打开，不修改文件） */
function readSqliteColumns(filePath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tableRows = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    for (const table of tableRows) {
      const columns = database
        .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table.name)})`)
        .all() as Array<{ name: string }>;
      result.set(table.name, columns.map(column => column.name));
    }
  } finally {
    database.close();
  }
  return result;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = config.mysql;
  const target = `${db.host}:${db.port}/${db.database}`;
  const expected = parseSchemaObjects(readFileSync(MYSQL_SCHEMA_FILE, 'utf8'));
  const sqliteExpected = parseSchemaObjects(readFileSync(SQLITE_SCHEMA_FILE, 'utf8'));

  let failures = 0;
  const report = (ok: boolean, message: string): void => {
    console.log(`${ok ? '✓' : '✗'} ${message}`);
    if (!ok) failures += 1;
  };
  const warn = (message: string): void => console.log(`⚠ ${message}`);

  console.log(`Visa Atlas · MySQL 快检报告（${target}，账户 ${db.user}）\n`);

  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      connectTimeout: 5000,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
  } catch (error) {
    console.error(`✗ 无法连接 MySQL：${error instanceof Error ? error.message : String(error)}`);
    console.error('  请确认实例已启动，且 .env 的 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 正确。');
    process.exitCode = 1;
    return;
  }

  try {
    const [versionRows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
    console.log(`· MySQL 版本：${String(versionRows[0]?.version ?? 'unknown')}`);

    const [charsetRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation ' +
        'FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [db.database],
    );
    const schemaCharset = charsetRows[0];
    report(
      schemaCharset?.charset === 'utf8mb4',
      `库字符集：${String(schemaCharset?.charset ?? '?')} / ${String(schemaCharset?.collation ?? '?')}（期望 utf8mb4）`,
    );

    const [objectRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COLLATION AS collation ' +
        'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [db.database],
    );
    const actualTables = objectRows.filter(row => row.type === 'BASE TABLE').map(row => String(row.name));
    const actualViews = objectRows.filter(row => row.type === 'VIEW').map(row => String(row.name));

    // 表 / 视图清单
    const missingTables = expected.tables.filter(name => !actualTables.includes(name));
    const missingViews = expected.views.filter(name => !actualViews.includes(name));
    report(missingTables.length === 0, `表清单：期望 ${expected.tables.length} 个，实际 ${actualTables.length} 个`);
    if (missingTables.length > 0) console.log(`    缺少表：${missingTables.join(', ')}`);
    report(missingViews.length === 0, `视图清单：期望 ${expected.views.length} 个，实际 ${actualViews.length} 个`);
    if (missingViews.length > 0) console.log(`    缺少视图：${missingViews.join(', ')}`);
    const extraTables = actualTables.filter(name => !expected.tables.includes(name));
    if (extraTables.length > 0) warn(`存在 schema 定义之外的表：${extraTables.join(', ')}`);

    // 字符集（逐表）
    const badCollation = objectRows
      .filter(row => row.type === 'BASE TABLE' && !String(row.collation ?? '').startsWith('utf8mb4'))
      .map(row => `${String(row.name)}=${String(row.collation ?? '?')}`);
    report(badCollation.length === 0, `表字符集：${badCollation.length === 0 ? '全部 utf8mb4' : badCollation.join(', ')}`);

    // 行数
    console.log('\n· 行数：');
    for (const table of expected.tables) {
      if (!actualTables.includes(table)) {
        console.log(`    ${table.padEnd(24)} (缺表)`);
        continue;
      }
      const [countRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM \`${table}\``,
      );
      console.log(`    ${table.padEnd(24)} ${String(countRows[0]?.count ?? 0)}`);
    }
    console.log('\n· 视图可用性：');
    for (const view of expected.views) {
      if (!actualViews.includes(view)) {
        console.log(`    ${view.padEnd(24)} (缺视图)`);
        continue;
      }
      const [countRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM \`${view}\``,
      );
      console.log(`    ${view.padEnd(24)} ${String(countRows[0]?.count ?? 0)} 行`);
    }

    // 与 SQLite 的列名对比（SQLite 文件不存在时跳过）
    const sqlitePath = existsSync(config.sqlitePath) ? config.sqlitePath : DEFAULT_SQLITE_FILE;
    if (!existsSync(sqlitePath)) {
      console.log(`\n⚠ 未找到 SQLite 数据库（${sqlitePath}），跳过列名对比。`);
      console.log('  可先运行 npm run db:init && npm run db:seed 生成对照库。');
    } else {
      console.log(`\n· 与 SQLite 列名对比（${sqlitePath}）：`);
      const sqliteColumns = readSqliteColumns(sqlitePath);
      const [columnRows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS ' +
          'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
        [db.database],
      );
      const mysqlColumns = new Map<string, string[]>();
      for (const row of columnRows) {
        const table = String(row.tableName);
        const list = mysqlColumns.get(table) ?? [];
        list.push(String(row.columnName));
        mysqlColumns.set(table, list);
      }

      let compared = 0;
      for (const table of sqliteExpected.tables) {
        const sqliteList = sqliteColumns.get(table);
        const mysqlList = mysqlColumns.get(table);
        if (!sqliteList || !mysqlList) continue;
        compared += 1;
        const same = sqliteList.length === mysqlList.length && sqliteList.every((name, index) => name === mysqlList[index]);
        if (!same) {
          failures += 1;
          console.log(`    ✗ ${table}`);
          console.log(`        SQLite：${sqliteList.join(', ')}`);
          console.log(`        MySQL ：${mysqlList.join(', ')}`);
        }
      }
      report(compared > 0, `列名对比：${compared} 张表口径一致`);
    }
  } finally {
    await connection.end();
  }

  console.log('');
  if (failures === 0) {
    console.log('✓ 快检通过：MySQL schema 与 SQLite 同构。');
  } else {
    console.error(`✗ 快检发现 ${failures} 项问题，请检查上面的明细。`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`✗ 快检失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
