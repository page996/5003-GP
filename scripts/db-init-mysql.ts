/**
 * npm run db:init:mysql
 *
 * 1) 用 DB_ADMIN_* 连接 MySQL 主库（不指定 database），CREATE DATABASE IF NOT EXISTS；
 * 2) 用应用账户（DB_USER/DB_PASSWORD）连接目标库，执行 database/schema.mysql.sql
 *    （建表/索引/视图，multipleStatements 一次执行）。
 *
 * 只建「库 + 表」，不 DROP 任何已有对象；重复运行安全。
 */
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { loadConfig } from '../server/config.ts';
import { MYSQL_SCHEMA_FILE } from '../server/paths.ts';

function assertIdentifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`配置错误：${field}=${JSON.stringify(value)} 不是合法的 MySQL 标识符（只允许字母/数字/下划线）`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = config.mysql;
  const database = assertIdentifier(db.database, 'DB_NAME');
  const target = `${db.host}:${db.port}/${database}`;

  console.log(`· 目标 MySQL：${target}（应用账户 ${db.user}）`);

  // 1) 管理员账户建库（失败时回退：库可能已由 DBA 手工创建）
  try {
    const admin = await mysql.createConnection({
      host: db.host,
      port: db.port,
      user: db.adminUser,
      password: db.adminPassword,
      multipleStatements: true,
      connectTimeout: 5000,
      timezone: 'Z',
    });
    try {
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      console.log(`  · CREATE DATABASE IF NOT EXISTS ${database}：OK`);
    } finally {
      await admin.end();
    }
  } catch (error) {
    console.warn(`  ! 管理员账户建库失败：${errorMessage(error)}`);
    console.warn('    将尝试直接用应用账户连接已存在的数据库（请确认 DB_ADMIN_* 或库已由 DBA 创建）');
  }

  // 2) 应用账户执行 schema
  const schemaSql = readFileSync(MYSQL_SCHEMA_FILE, 'utf8');
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database,
      multipleStatements: true,
      connectTimeout: 5000,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
    await connection.query(schemaSql);

    const [tableRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME',
      [database],
    );
    const tables = tableRows.filter(row => row.type === 'BASE TABLE').length;
    const views = tableRows.filter(row => row.type === 'VIEW').length;

    const [charsetRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [database],
    );
    const charset = charsetRows[0];

    console.log(`✓ MySQL schema 已就绪：${target}`);
    console.log(`  · 表 ${tables} 个 · 视图 ${views} 个`);
    if (charset) console.log(`  · 字符集 ${charset.charset} / ${charset.collation}`);
    console.log('  · 下一步：npm run db:seed:mysql');
  } finally {
    if (connection) await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ 初始化 MySQL 失败：${errorMessage(error)}`);
  process.exitCode = 1;
});
