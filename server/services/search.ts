/**
 * 检索服务：对象是「国家 × 所选签证类型」。
 *
 * 语义（与 docs/API.md 对齐）：
 * - 有真实（is_demo=0）结构化政策 → POLICY；
 * - 没有真实政策但有类型线索（mentioned_visa_types）→ MENTION_ONLY；
 * - 演示政策只在 demo=1 时参与，且同一国家同一类型真实政策优先；
 * - 关键词空格分词后 AND，每个词必须命中任一可检索字段，同义词表做扩展；
 * - region/group/category/stay/status/priority 与关键词过滤全部在 SQL 完成；
 * - 分面按标准语义：计算某维度计数时忽略该维度自身已选值，其余筛选保留。
 *
 * 排序/评分在服务层完成：数据量是「国家 × 类型」（默认 249 条），
 * 一次取回做稳定排序比分页 SQL 更可控，也保证 score 是同一套确定性算法。
 */
import type {
  DataStatus,
  FacetBucket,
  MatchKind,
  PolicyGroup,
  RegionCode,
  SearchFacets,
  SearchItem,
  SearchQuery,
  SearchResponse,
  SearchSort,
  StayUnit,
} from '../../shared/contracts.ts';
import { DATA_STATUS_META, STAY_BUCKETS, formatStay } from '../../shared/contracts.ts';
import type { DatabaseDriver, Row, SqlValue } from '../db/driver.ts';
import type { Dictionaries } from '../db/repository.ts';
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asNumber,
  asString,
  loadAppMeta,
  loadDictionaries,
  loadSynonyms,
  parseDataStatus,
  parseEntryScope,
  parseStayRule,
  parseStayUnit,
  parseJsonStringArray,
} from '../db/repository.ts';
import { buildSynonymIndex, expandQuery, type TokenGroup } from './synonyms.ts';

interface SqlFragment {
  sql: string;
  params: SqlValue[];
}

/* ------------------------------------------------------------------ */
/* SQL：候选条目（政策 UNION 线索）                                     */
/* ------------------------------------------------------------------ */

/** 停留期分桶的 SQL 表达式：MONTH/YEAR 折算成天，仅用于筛选与分面 */
const STAY_EFFECTIVE_DAYS =
  "(CASE stay_unit WHEN 'MONTH' THEN stay_days * 30 WHEN 'YEAR' THEN stay_days * 365 ELSE stay_days END)";
const STAY_BUCKET_EXPR =
  `CASE WHEN stay_days IS NULL THEN 'UNKNOWN' ` +
  `WHEN ${STAY_EFFECTIVE_DAYS} <= 7 THEN 'LE_7' ` +
  `WHEN ${STAY_EFFECTIVE_DAYS} <= 30 THEN 'D8_30' ` +
  `WHEN ${STAY_EFFECTIVE_DAYS} <= 90 THEN 'D31_90' ` +
  `WHEN ${STAY_EFFECTIVE_DAYS} <= 180 THEN 'D91_180' ` +
  `ELSE 'GT_180' END`;

/** 关键词可命中的字段（国家、政策、类别/类型标签、线索文本） */
const KEYWORD_FIELDS = [
  'name_zh',
  'name_en',
  'iso2',
  'aliases',
  'title',
  'summary',
  'search_text',
  'raw_text',
  'category_zh',
  'category_en',
  'category_code',
  'visa_type_zh',
  'visa_type_en',
  'visa_type',
] as const;

/**
 * 构造 items CTE：
 * typeFilter 为 null 时覆盖全部签证类型（types 分面用）。
 */
export function buildItemsCte(options: { type: string | null; includeDemo: boolean }): SqlFragment {
  const params: SqlValue[] = [];
  const demoFlag: SqlValue = options.includeDemo ? 1 : 0;

  let policyWhere = 'p.is_visible = 1';
  if (options.type !== null) {
    policyWhere += ' AND p.visa_type = ?';
    params.push(options.type);
  }
  policyWhere += ' AND (p.is_demo = 0 OR (? = 1 AND p.is_demo = 1))';
  params.push(demoFlag);
  // 同一国家同一类型存在真实政策时，不再取该国家该类型的演示政策
  policyWhere +=
    ' AND (p.is_demo = 0 OR NOT EXISTS (SELECT 1 FROM visa_policies r ' +
    'WHERE r.country_code = p.country_code AND r.visa_type = p.visa_type AND r.is_demo = 0 AND r.is_visible = 1))';

  let mentionWhere = '1 = 1';
  if (options.type !== null) {
    mentionWhere += ' AND m.visa_type = ?';
    params.push(options.type);
  }
  // 已有「生效中」的政策（真实，或 demo=1 时的演示）时不再生成仅类型线索
  mentionWhere +=
    ' AND NOT EXISTS (SELECT 1 FROM visa_policies e WHERE e.country_code = m.country_code ' +
    'AND e.visa_type = m.visa_type AND e.is_visible = 1 ' +
    'AND (e.is_demo = 0 OR (? = 1 AND e.is_demo = 1)))';
  params.push(demoFlag);

  const sql =
    'WITH items AS (' +
    'SELECT c.iso2 AS iso2, c.name_zh AS name_zh, c.name_en AS name_en, c.aliases AS aliases, ' +
    'c.region_code AS region_code, c.priority AS priority, c.sort_key AS sort_key, ' +
    'p.visa_type AS visa_type, vt.name_zh AS visa_type_zh, vt.name_en AS visa_type_en, ' +
    "'POLICY' AS match_kind, p.route_code AS route_code, p.title AS title, p.summary AS summary, " +
    'p.search_text AS search_text, NULL AS raw_text, p.category_code AS category_code, ' +
    'vc.name_zh AS category_zh, vc.name_en AS category_en, vc.policy_group AS group_code, ' +
    'p.requires_visa AS requires_visa, p.stay_days AS stay_days, p.stay_unit AS stay_unit, ' +
    'p.stay_rule AS stay_rule, p.window_days AS window_days, p.window_max_days AS window_max_days, ' +
    'p.entry_scope AS entry_scope, p.data_status AS data_status, p.completeness AS completeness, ' +
    'p.is_demo AS is_demo, p.source_id AS source_id ' +
    'FROM visa_policies p ' +
    'JOIN countries c ON c.iso2 = p.country_code ' +
    'JOIN visa_types vt ON vt.code = p.visa_type ' +
    'JOIN visa_categories vc ON vc.code = p.category_code ' +
    `WHERE ${policyWhere} ` +
    'UNION ALL ' +
    'SELECT c.iso2, c.name_zh, c.name_en, c.aliases, c.region_code, c.priority, c.sort_key, ' +
    'm.visa_type, vt.name_zh, vt.name_en, ' +
    "'MENTION_ONLY', NULL, NULL, NULL, NULL, m.raw_text, " +
    'NULL, NULL, NULL, NULL, NULL, ' +
    "NULL, NULL, 'UNSPECIFIED', NULL, NULL, NULL, 'MENTION_ONLY', 0, 0, m.source_id " +
    'FROM mentioned_visa_types m ' +
    'JOIN countries c ON c.iso2 = m.country_code ' +
    'JOIN visa_types vt ON vt.code = m.visa_type ' +
    `WHERE ${mentionWhere})`;

  return { sql, params };
}

/* ------------------------------------------------------------------ */
/* SQL：筛选条件                                                       */
/* ------------------------------------------------------------------ */

export interface ItemFilterOptions {
  regions?: readonly string[];
  groups?: readonly string[];
  categories?: readonly string[];
  stays?: readonly string[];
  statuses?: readonly string[];
  priorityOnly?: boolean;
  tokenGroups?: readonly TokenGroup[];
}

const LIKE_ESCAPE_CHAR = '!';

/** LIKE 通配符转义，避免用户输入 % _ 时变成模式 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, match => `${LIKE_ESCAPE_CHAR}${match}`);
}

/** 生成追加在 `WHERE 1 = 1` 后面的 AND 条件；只拼接固定 SQL，值全部参数化 */
export function buildItemFilters(options: ItemFilterOptions): SqlFragment {
  const clauses: string[] = [];
  const params: SqlValue[] = [];

  const inClause = (column: string, values: readonly string[]): string => {
    const placeholders = values.map(() => '?').join(', ');
    params.push(...values);
    return `${column} IN (${placeholders})`;
  };

  if (options.regions?.length) clauses.push(inClause('region_code', options.regions));
  if (options.groups?.length) clauses.push(inClause('group_code', options.groups));
  if (options.categories?.length) clauses.push(inClause('category_code', options.categories));
  if (options.statuses?.length) clauses.push(inClause('data_status', options.statuses));
  if (options.stays?.length) clauses.push(inClause(STAY_BUCKET_EXPR, options.stays));
  if (options.priorityOnly) clauses.push('priority = 1');

  for (const group of options.tokenGroups ?? []) {
    const orParts: string[] = [];
    for (const alternative of group.alternatives) {
      const pattern = `%${escapeLikePattern(alternative.toLowerCase())}%`;
      for (const field of KEYWORD_FIELDS) {
        orParts.push(`LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'`);
        params.push(pattern);
      }
    }
    if (orParts.length > 0) clauses.push(`(${orParts.join(' OR ')})`);
  }

  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params };
}

/* ------------------------------------------------------------------ */
/* 排序与评分                                                          */
/* ------------------------------------------------------------------ */

interface Candidate {
  row: Row;
  item: SearchItem;
  sortKey: string;
  /** 停留期折算成天，仅用于 stay_desc 排序 */
  staySortDays: number | null;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortCandidates(candidates: Candidate[], sort: SearchSort): Candidate[] {
  const byName = (a: Candidate, b: Candidate): number =>
    compareText(a.sortKey, b.sortKey) || compareText(a.item.iso2, b.item.iso2);

  return [...candidates].sort((a, b) => {
    switch (sort) {
      case 'name':
        return byName(a, b);
      case 'stay_desc': {
        const aNull = a.staySortDays === null ? 1 : 0;
        const bNull = b.staySortDays === null ? 1 : 0;
        if (aNull !== bNull) return aNull - bNull;
        const diff = (b.staySortDays ?? 0) - (a.staySortDays ?? 0);
        return diff !== 0 ? diff : byName(a, b);
      }
      case 'completeness':
        return b.item.completeness - a.item.completeness || byName(a, b);
      case 'relevance':
      default:
        return b.item.score - a.item.score || b.item.completeness - a.item.completeness || byName(a, b);
    }
  });
}

/**
 * 相关度：国家名/ISO 精确 > 国家名前缀 > 别名 > 政策文本 > 线索文本。
 * 多个关键词时逐词累加，保证排序值稳定、可解释。
 */
function computeScore(row: Row, tokenGroups: readonly TokenGroup[]): number {
  if (tokenGroups.length === 0) return 0;
  const nameZh = asString(row, 'name_zh').toLowerCase();
  const nameEn = asString(row, 'name_en').toLowerCase();
  const iso2 = asString(row, 'iso2').toLowerCase();
  const aliases = parseJsonStringArray(row['aliases']).map(alias => alias.toLowerCase());
  const policyBlob = [
    asString(row, 'title'),
    asString(row, 'summary'),
    asString(row, 'search_text'),
    asString(row, 'category_zh'),
    asString(row, 'category_en'),
    asString(row, 'category_code'),
    asString(row, 'visa_type_zh'),
    asString(row, 'visa_type_en'),
    asString(row, 'visa_type'),
  ]
    .join(' ')
    .toLowerCase();
  const mentionBlob = asString(row, 'raw_text').toLowerCase();

  let score = 0;
  for (const group of tokenGroups) {
    let best = 0;
    for (const alternative of group.alternatives) {
      const token = alternative.toLowerCase();
      if (nameZh === token || nameEn === token || iso2 === token) {
        best = 1000;
        break;
      }
      if (nameZh.startsWith(token) || nameEn.startsWith(token)) {
        best = Math.max(best, 600);
      } else if (aliases.includes(token)) {
        best = Math.max(best, 500);
      } else if (aliases.some(alias => alias.includes(token))) {
        best = Math.max(best, 300);
      } else if (policyBlob.includes(token)) {
        best = Math.max(best, 100);
      } else if (mentionBlob.includes(token)) {
        best = Math.max(best, 40);
      }
    }
    score += best;
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* 行 → SearchItem                                                     */
/* ------------------------------------------------------------------ */

function normalizeStayDays(row: Row): number | null {
  const days = asNullableNumber(row, 'stay_days');
  if (days === null) return null;
  const unit = parseStayUnit(row['stay_unit'] ?? null);
  if (unit === 'MONTH') return days * 30;
  if (unit === 'YEAR') return days * 365;
  return days;
}

function mapSearchItem(row: Row, dictionaries: Dictionaries, score: number): SearchItem {
  const matchKind: MatchKind = asString(row, 'match_kind') === 'MENTION_ONLY' ? 'MENTION_ONLY' : 'POLICY';
  const visaType = asString(row, 'visa_type');
  const categoryCode = asNullableString(row, 'category_code');
  const category = categoryCode ? dictionaries.categoryMap.get(categoryCode) : undefined;
  const group = (category?.group ?? null) as PolicyGroup | null;
  const stayDays = asNullableNumber(row, 'stay_days');
  const stayUnit: StayUnit | null = parseStayUnit(row['stay_unit'] ?? null);
  const dataStatus = parseDataStatus(row['data_status']);
  const isPolicy = matchKind === 'POLICY';
  const routeCode = asNullableString(row, 'route_code');

  return {
    key: isPolicy && routeCode !== null ? routeCode : `${asString(row, 'iso2')}:${visaType}`,
    iso2: asString(row, 'iso2'),
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    region: asString(row, 'region_code') as RegionCode,
    regionLabel: dictionaries.regionMap.get(asString(row, 'region_code'))?.nameZh ?? asString(row, 'region_code'),
    visaType,
    visaTypeLabel: dictionaries.typeMap.get(visaType)?.nameZh ?? visaType,
    matchKind,
    routeCode,
    categoryCode,
    categoryLabel: category?.nameZh ?? null,
    group,
    groupLabel: group ? dictionaries.groupMap.get(group)?.nameZh ?? group : null,
    requiresVisa: isPolicy ? asBoolean(row, 'requires_visa') : null,
    stayDays: isPolicy ? stayDays : null,
    stayUnit: isPolicy ? stayUnit : null,
    stayLabel: isPolicy
      ? formatStay(
          stayDays,
          stayUnit,
          parseStayRule(row['stay_rule'] ?? null),
          asNullableNumber(row, 'window_days'),
          asNullableNumber(row, 'window_max_days'),
        )
      : null,
    entryScope: isPolicy ? parseEntryScope(row['entry_scope'] ?? null) : null,
    summary: isPolicy ? asNullableString(row, 'summary') : null,
    mentionText: isPolicy ? null : asNullableString(row, 'raw_text'),
    dataStatus,
    statusLabel: DATA_STATUS_META[dataStatus].label,
    completeness: asNumber(row, 'completeness'),
    isDemo: asBoolean(row, 'is_demo'),
    priority: asBoolean(row, 'priority'),
    sourceId: asNullableString(row, 'source_id'),
    score,
  };
}

/* ------------------------------------------------------------------ */
/* 分面                                                                */
/* ------------------------------------------------------------------ */

const STATUS_FACET_ORDER: DataStatus[] = ['DETAILED', 'PARTIAL', 'SUMMARY_ONLY', 'MENTION_ONLY', 'DEMO'];

type FacetDimension = 'regions' | 'groups' | 'categories' | 'stays' | 'statuses';

function facetExpression(dimension: FacetDimension): string {
  switch (dimension) {
    case 'regions':
      return 'region_code';
    case 'groups':
      return 'group_code';
    case 'categories':
      return 'category_code';
    case 'stays':
      return STAY_BUCKET_EXPR;
    case 'statuses':
      return 'data_status';
  }
}

async function queryFacetCounts(
  driver: DatabaseDriver,
  cte: SqlFragment,
  filters: SqlFragment,
  dimension: FacetDimension,
): Promise<Map<string, number>> {
  const expression = facetExpression(dimension);
  const rows = await driver.query(
    `${cte.sql} SELECT ${expression} AS code, COUNT(*) AS count FROM items WHERE 1 = 1${filters.sql} ` +
      `GROUP BY ${expression}`,
    [...cte.params, ...filters.params],
  );
  return new Map(rows.map(row => [asString(row, 'code'), asNumber(row, 'count')]));
}

function facetBuckets(
  dictionaries: Dictionaries,
  counts: {
    regions: Map<string, number>;
    groups: Map<string, number>;
    categories: Map<string, number>;
    types: Map<string, number>;
    stays: Map<string, number>;
    statuses: Map<string, number>;
  },
  options: { includeDemo: boolean },
): SearchFacets {
  const bucket = (code: string, label: string, count: number, color?: string): FacetBucket => ({
    code,
    label,
    count,
    ...(color ? { color } : {}),
  });

  return {
    regions: dictionaries.regions.map(region => bucket(region.code, region.nameZh, counts.regions.get(region.code) ?? 0)),
    groups: dictionaries.groups.map(group =>
      bucket(group.code, group.nameZh, counts.groups.get(group.code) ?? 0, group.color),
    ),
    categories: dictionaries.categories.map(category =>
      bucket(category.code, category.nameZh, counts.categories.get(category.code) ?? 0, category.color),
    ),
    types: dictionaries.types.map(type => bucket(type.code, type.nameZh, counts.types.get(type.code) ?? 0)),
    stays: STAY_BUCKETS.map(stay => bucket(stay.code, stay.label, counts.stays.get(stay.code) ?? 0)),
    statuses: STATUS_FACET_ORDER.filter(status => options.includeDemo || status !== 'DEMO').map(status =>
      bucket(status, DATA_STATUS_META[status].label, counts.statuses.get(status) ?? 0),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

/** 分面的类型覆盖：count = 该类型下被覆盖的国家数（真实政策或线索） */
async function queryTypeCounts(
  driver: DatabaseDriver,
  filters: SqlFragment,
  includeDemo: boolean,
): Promise<Map<string, number>> {
  const cte = buildItemsCte({ type: null, includeDemo });
  const rows = await driver.query(
    `${cte.sql} SELECT visa_type AS code, COUNT(DISTINCT iso2) AS count FROM items WHERE 1 = 1${filters.sql} ` +
      'GROUP BY visa_type',
    [...cte.params, ...filters.params],
  );
  return new Map(rows.map(row => [asString(row, 'code'), asNumber(row, 'count')]));
}

export async function search(driver: DatabaseDriver, query: SearchQuery): Promise<SearchResponse> {
  const startedAt = performance.now();
  const dictionaries = await loadDictionaries(driver);
  const [synonymRows, meta] = await Promise.all([loadSynonyms(driver), loadAppMeta(driver)]);
  const synonymIndex = buildSynonymIndex(synonymRows);
  const expandedQuery = expandQuery(query.q, synonymIndex);
  const tokenGroups = expandedQuery.tokenGroups;

  const cte = buildItemsCte({ type: query.type, includeDemo: query.includeDemo });
  const baseFilters: ItemFilterOptions = {
    tokenGroups,
    priorityOnly: query.priorityOnly,
  };

  const mainFilters = buildItemFilters({
    ...baseFilters,
    regions: query.regions,
    groups: query.groups,
    categories: query.categories,
    stays: query.stays,
    statuses: query.statuses,
  });
  const rows = await driver.query(
    `${cte.sql} SELECT * FROM items WHERE 1 = 1${mainFilters.sql}`,
    [...cte.params, ...mainFilters.params],
  );

  const candidates: Candidate[] = rows.map(row => {
    const score = computeScore(row, tokenGroups);
    return {
      row,
      item: mapSearchItem(row, dictionaries, score),
      sortKey: asString(row, 'sort_key'),
      staySortDays: normalizeStayDays(row),
    };
  });
  const sorted = sortCandidates(candidates, query.sort);

  const total = sorted.length;
  const pageCount = Math.ceil(total / query.pageSize);
  const pageStart = (query.page - 1) * query.pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + query.pageSize).map(candidate => candidate.item);

  // 分面：忽略自身维度已选值，保留其他筛选与关键词
  const buildFiltersExcept = (excluded: FacetDimension): SqlFragment => {
    const regions = excluded === 'regions' ? [] : query.regions;
    const groups = excluded === 'groups' ? [] : query.groups;
    const categories = excluded === 'categories' ? [] : query.categories;
    const stays = excluded === 'stays' ? [] : query.stays;
    const statuses = excluded === 'statuses' ? [] : query.statuses;
    return buildItemFilters({
      tokenGroups,
      priorityOnly: query.priorityOnly,
      regions,
      groups,
      categories,
      stays,
      statuses,
    });
  };

  const [regionCounts, groupCounts, categoryCounts, stayCounts, statusCounts, typeCounts] = await Promise.all([
    queryFacetCounts(driver, cte, buildFiltersExcept('regions'), 'regions'),
    queryFacetCounts(driver, cte, buildFiltersExcept('groups'), 'groups'),
    queryFacetCounts(driver, cte, buildFiltersExcept('categories'), 'categories'),
    queryFacetCounts(driver, cte, buildFiltersExcept('stays'), 'stays'),
    queryFacetCounts(driver, cte, buildFiltersExcept('statuses'), 'statuses'),
    queryTypeCounts(
      driver,
      buildItemFilters({
        tokenGroups,
        priorityOnly: query.priorityOnly,
        regions: query.regions,
        groups: query.groups,
        categories: query.categories,
        stays: query.stays,
        statuses: query.statuses,
      }),
      query.includeDemo,
    ),
  ]);

  const facets = facetBuckets(
    dictionaries,
    {
      regions: regionCounts,
      groups: groupCounts,
      categories: categoryCounts,
      types: typeCounts,
      stays: stayCounts,
      statuses: statusCounts,
    },
    { includeDemo: query.includeDemo },
  );

  const matchedCountries = Array.from(new Set(sorted.map(candidate => candidate.item.iso2))).sort();

  return {
    query,
    items: pageItems,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount,
    facets,
    matchedCountries,
    tookMs: Math.round(performance.now() - startedAt),
    mode: driver.mode,
    datasetVersion: meta.get('dataset_version') ?? 'unknown',
  };
}
