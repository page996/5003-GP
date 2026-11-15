/**
 * API 参数解析与校验。
 *
 * query/param 先用 zod 校验类型与基本范围，再对枚举做白名单检查
 * （未知 type/region/group/category/stay/status/sort 一律 400，details 指出字段），
 * 确保不合法的输入不会进入服务层，也不会变成 500。
 */
import { z } from 'zod';
import type { DataStatus, PolicyGroup, RegionCode, SearchQuery, SearchSort } from '../../shared/contracts.ts';
import {
  DATA_STATUS_META,
  POLICY_GROUPS,
  REGIONS,
  SEARCH_SORTS,
  STAY_BUCKETS,
  VISA_CATEGORIES,
  VISA_TYPES,
} from '../../shared/contracts.ts';
import { ValidationError, type ErrorDetail } from '../errors.ts';

const REGION_CODES = REGIONS.map(region => region.code);
const GROUP_CODES = POLICY_GROUPS.map(group => group.code);
const TYPE_CODES = VISA_TYPES.map(type => type.code);
const CATEGORY_CODES = VISA_CATEGORIES.map(category => category.code);
const STAY_CODES = STAY_BUCKETS.map(bucket => bucket.code);
const STATUS_CODES = Object.keys(DATA_STATUS_META);
const SORT_CODES = SEARCH_SORTS.map(item => item.code);

const csvParam = z.union([z.string(), z.array(z.string())]).optional();

const searchQuerySchema = z
  .object({
    q: z.string().max(80, '关键词最多 80 个字符').optional(),
    type: z.string().optional(),
    region: csvParam,
    group: csvParam,
    category: csvParam,
    stay: csvParam,
    status: csvParam,
    priority: z.string().optional(),
    demo: z.string().optional(),
    sort: z.string().optional(),
    page: z.string().regex(/^\d+$/, 'page 必须是正整数').optional(),
    pageSize: z.string().regex(/^\d+$/, 'pageSize 必须是正整数').optional(),
  })
  .passthrough();

function zodDetails(error: z.ZodError): ErrorDetail[] {  return error.issues.map(issue => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'query',
    message: issue.message,
  }));
}

function splitCsv(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const pieces = Array.isArray(value) ? value : [value];
  return pieces
    .flatMap(piece => piece.split(','))
    .map(piece => piece.trim())
    .filter(piece => piece.length > 0);
}

function requireEnum<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[],
  label: string,
  details: ErrorDetail[],
): T | null {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  details.push({ field, message: `未知的${label}：${value}` });
  return null;
}

function requireEnumList<T extends string>(
  field: string,
  values: readonly string[],
  allowed: readonly T[],
  label: string,
  details: ErrorDetail[],
): T[] {
  const result: T[] = [];
  for (const value of values) {
    const parsed = requireEnum(field, value, allowed, label, details);
    if (parsed !== null && !result.includes(parsed)) result.push(parsed);
  }
  return result;
}

function parseFlag(
  field: string,
  value: string | undefined,
  details: ErrorDetail[],
): boolean {
  if (value === undefined) return false;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  details.push({ field, message: `${field} 只接受 1 或 0` });
  return false;
}

function parsePositiveInt(
  field: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  details: ErrorDetail[],
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    details.push({ field, message: `${field} 必须是 ${min}-${max} 之间的整数` });
    return fallback;
  }
  return parsed;
}

/** 解析 /api/v1/search 查询参数 */
export function parseSearchQuery(raw: unknown): SearchQuery {
  const parsed = searchQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(zodDetails(parsed.error));
  const input = parsed.data;
  const details: ErrorDetail[] = [];

  const type = input.type ?? 'TOURISM';
  requireEnum('type', type, TYPE_CODES, '签证类型', details);

  const sortValue = input.sort ?? 'relevance';
  const sort = requireEnum('sort', sortValue, SORT_CODES, '排序方式', details) ?? 'relevance';

  const q = input.q ?? '';
  if (q.length > 80) details.push({ field: 'q', message: '关键词最多 80 个字符' });

  const query: SearchQuery = {
    q,
    type,
    regions: requireEnumList('region', splitCsv(input.region), REGION_CODES, '地区', details) as RegionCode[],
    groups: requireEnumList('group', splitCsv(input.group), GROUP_CODES, '政策组', details) as PolicyGroup[],
    categories: requireEnumList('category', splitCsv(input.category), CATEGORY_CODES, '政策类别', details),
    stays: requireEnumList('stay', splitCsv(input.stay), STAY_CODES, '停留期分桶', details),
    statuses: requireEnumList('status', splitCsv(input.status), STATUS_CODES, '资料状态', details) as DataStatus[],
    priorityOnly: parseFlag('priority', input.priority, details),
    includeDemo: parseFlag('demo', input.demo, details),
    sort: sort as SearchSort,
    page: parsePositiveInt('page', input.page, 1, 1, 100000, details),
    pageSize: parsePositiveInt('pageSize', input.pageSize, 24, 1, 96, details),
  };

  if (details.length > 0) throw new ValidationError(details);
  return query;
}

const iso2Schema = z.string().regex(/^[A-Z]{2}$/, 'iso2 必须是两位大写字母');

/** 解析 /api/v1/countries/:iso2 */
export function parseIso2Param(raw: unknown): string {
  const parsed = iso2Schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(zodDetails(parsed.error).map(detail => ({ ...detail, field: 'iso2' })));
  return parsed.data;
}

const routeCodeSchema = z
  .string()
  .max(80, 'routeCode 最长 80 个字符')
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/, 'routeCode 只能包含大写字母/数字/连字符，且形如 JP-TOURISM-CN-ORD');

/** 解析 /api/v1/route/:routeCode */
export function parseRouteCodeParam(raw: unknown): string {
  const parsed = routeCodeSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(zodDetails(parsed.error).map(detail => ({ ...detail, field: 'routeCode' })));
  return parsed.data;
}

/** 解析国家档案的 demo 开关（demo=1 时返回演示明细） */
export function parseDemoFlag(raw: unknown): boolean {
  const details: ErrorDetail[] = [];
  if (raw === undefined || raw === null) return false;
  if (typeof raw !== 'string') {
    throw new ValidationError([{ field: 'demo', message: 'demo 只接受 1 或 0' }]);
  }
  const flag = parseFlag('demo', raw, details);
  if (details.length > 0) throw new ValidationError(details);
  return flag;
}

const suggestSchema = z.object({
  q: z.string().max(40, 'q 最多 40 个字符').optional(),
});

/** 解析 /api/v1/suggest?q=；空 q 返回空数组（不报错） */
export function parseSuggestQuery(raw: unknown): string {
  const parsed = suggestSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(zodDetails(parsed.error));
  return (parsed.data.q ?? '').trim();
}
