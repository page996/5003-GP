/**
 * 运行时配置：只从环境变量/.env 读取，不在代码里写死连接信息。
 *
 * 路径类配置（DATA_DB_PATH）统一相对仓库根解析，避免从不同工作目录启动时
 * 在错误的位置创建数据库文件。
 */
import dotenv from 'dotenv';
import type { DbMode } from '../shared/contracts.ts';
import { DEFAULT_SQLITE_FILE, ENV_FILE, resolveFromRoot } from './paths.ts';

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** 建库/建表脚本用的管理员账户（默认 root） */
  adminUser: string;
  adminPassword: string;
}

export interface AppConfig {
  host: string;
  port: number;
  webPort: number;
  dbDriver: DbMode;
  /** SQLite 数据库文件绝对路径（docker/测试可覆盖） */
  sqlitePath: string;
  mysql: MysqlConfig;
}

let envFileLoaded = false;

/** 只在首次加载 .env，多个入口（server/main、scripts）共享同一个进程内状态 */
function loadEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  dotenv.config({ path: ENV_FILE });
}

function parsePort(raw: string | undefined, fallback: number, field: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`配置错误：${field}=${raw} 不是合法端口（1-65535）`);
  }
  return value;
}

function parseDriver(raw: string | undefined): DbMode {
  const value = (raw ?? 'sqlite').trim().toLowerCase();
  if (value !== 'sqlite' && value !== 'mysql') {
    throw new Error(`配置错误：DB_DRIVER=${raw} 非法，只支持 sqlite 或 mysql`);
  }
  return value;
}

/** 读取配置；env 参数便于测试注入，默认读 process.env（已合并 .env） */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadEnvFile();
  const dbDriver = parseDriver(env.DB_DRIVER);

  const rawSqlitePath = env.DATA_DB_PATH?.trim();
  const sqlitePath = rawSqlitePath === undefined || rawSqlitePath === ''
    ? DEFAULT_SQLITE_FILE
    : resolveFromRoot(rawSqlitePath);

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: parsePort(env.PORT, 3001, 'PORT'),
    webPort: parsePort(env.WEB_PORT, 5173, 'WEB_PORT'),
    dbDriver,
    sqlitePath,
    mysql: {
      host: env.DB_HOST?.trim() || '127.0.0.1',
      port: parsePort(env.DB_PORT, 3306, 'DB_PORT'),
      database: env.DB_NAME?.trim() || 'visa_atlas',
      user: env.DB_USER?.trim() || 'visa_app',
      password: env.DB_PASSWORD ?? '',
      adminUser: env.DB_ADMIN_USER?.trim() || 'root',
      adminPassword: env.DB_ADMIN_PASSWORD ?? '',
    },
  };
}
