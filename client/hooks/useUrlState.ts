import {
  DATA_STATUS_META,
  DEFAULT_SEARCH_QUERY,
  POLICY_GROUPS,
  REGIONS,
  SEARCH_SORTS,
  STAY_BUCKETS,
  VISA_CATEGORIES,
  VISA_TYPES,
  toSearchParams,
} from '../../shared/contracts.ts';
import type {
  DataStatus,
  PolicyGroup,
  RegionCode,
  SearchQuery,
  SearchSort,
} from '../../shared/contracts.ts';

const REGION_CODES = new Set<string>(REGIONS.map(region => region.code));
const GROUP_CODES = new Set<string>(POLICY_GROUPS.map(group => group.code));
const CATEGORY_CODES = new Set<string>(VISA_CATEGORIES.map(category => category.code));
const STAY_CODES = new Set<string>(STAY_BUCKETS.map(bucket => bucket.code));
const STATUS_CODES = new Set<string>(Object.keys(DATA_STATUS_META));
const TYPE_CODES = new Set<string>(VISA_TYPES.map(type => type.code));
const SORT_CODES = new Set<string>(SEARCH_SORTS.map(sort => sort.code));

function splitCodes(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map(code => code.trim())
    .filter(Boolean);
}

/**
 * 从 URL 查询串恢复检索状态；任何无法识别的参数回退为默认值。
 * 只读取 `q/type/region/group/category/stay/status/priority/demo/sort/page/country`。
 */
export function parseUrlState(search: string): { query: SearchQuery; country: string | null } {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').slice(0, 80);
  const typeRaw = params.get('type');
  const type = typeRaw && TYPE_CODES.has(typeRaw) ? typeRaw : DEFAULT_SEARCH_QUERY.type;
  const sortRaw = params.get('sort');
  const sort: SearchSort = sortRaw && SORT_CODES.has(sortRaw) ? (sortRaw as SearchSort) : 'relevance';
  const pageRaw = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 99) : 1;

  const countryRaw = (params.get('country') ?? '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;

  return {
    query: {
      ...DEFAULT_SEARCH_QUERY,
      q,
      type,
      regions: splitCodes(params, 'region').filter((code): code is RegionCode => REGION_CODES.has(code)),
      groups: splitCodes(params, 'group').filter((code): code is PolicyGroup => GROUP_CODES.has(code)),
      categories: splitCodes(params, 'category').filter(code => CATEGORY_CODES.has(code)),
      stays: splitCodes(params, 'stay').filter(code => STAY_CODES.has(code)),
      statuses: splitCodes(params, 'status').filter((code): code is DataStatus => STATUS_CODES.has(code)),
      priorityOnly: params.get('priority') === '1',
      includeDemo: params.get('demo') === '1',
      sort,
      page,
      pageSize: DEFAULT_SEARCH_QUERY.pageSize,
    },
    country,
  };
}

/** 生成可分享的 URL 查询串（不包含空值） */
export function serializeUrlState(query: SearchQuery, country: string | null): string {
  const params = toSearchParams(query);
  if (country) params.set('country', country);
  return params.toString();
}
