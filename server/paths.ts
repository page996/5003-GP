/**
 * 仓库路径解析（ESM）。
 *
 * 以本文件位置为基准推导仓库根目录，而不是依赖 process.cwd()：
 * 服务可能被 `npm run dev`、`tsx`、测试注入等不同入口从任意工作目录拉起。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);

/** server/ 目录 */
export const SERVER_DIR = path.dirname(thisFile);
/** 仓库根目录（server/ 的上一级） */
export const REPO_ROOT = path.resolve(SERVER_DIR, '..');

/** 把相对仓库根的路径解析成绝对路径（绝对路径原样返回） */
export function resolveFromRoot(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}

export const ENV_FILE = resolveFromRoot('.env');
export const DATA_DIR = resolveFromRoot('data');
export const GENERATED_DIR = resolveFromRoot('data', 'generated');
/** ETL 产物：数据库种子的唯一输入 */
export const DATASET_FILE = resolveFromRoot('data', 'generated', 'dataset.json');
/** ETL 质量报告（只读展示方便排查） */
export const DATASET_REPORT_FILE = resolveFromRoot('data', 'generated', 'report.json');
export const SQLITE_SCHEMA_FILE = resolveFromRoot('database', 'schema.sql');
export const MYSQL_SCHEMA_FILE = resolveFromRoot('database', 'schema.mysql.sql');
/** Vite 构建产物；存在时由 Fastify 直接托管（生产同源部署） */
export const DIST_DIR = resolveFromRoot('dist');
export const DEFAULT_SQLITE_FILE = resolveFromRoot('data', 'visaatlas.sqlite');
