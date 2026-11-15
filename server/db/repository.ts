/**
 * 数据访问层：把数据库行映射成 shared/contracts.ts 的类型。
 *
 * 约定：
 * - SQL 只出现在本文件与 search.ts（检索查询）里；
 * - 行 → 契约对象的转换集中在此，服务层不关心 snake_case 列名；
 * - 布尔列（TINYINT/INTEGER 0/1）在边界统一转 boolean。
 */
import type {
  CountryInfo,
  DataStatus,
  EntryScope,
  PolicyDocument,
  PolicyFee,
  PolicyGroup,
  PolicyGroupInfo,
  PolicyRecord,
  PolicyRule,
  PolicyTiming,
  RegionCode,
  RegionInfo,
  SourceInfo,
  StayRule,
  StayUnit,
  VisaCategoryInfo,
  VisaTypeInfo,
} from '../../shared/contracts.ts';
import type { DatabaseDriver, Row, SqlValue } from './driver.ts';

/* ------------------------------------------------------------------ */
/* 行读取工具                                                          */
/* ------------------------------------------------------------------ */

export function asString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

export function asNullableString(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

export function asNumber(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return fallback;
}

export function asNullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return null;
}

export function asBoolean(row: Row, key: string): boolean {
  return asNumber(row, key) === 1;
}

export function asNullableBoolean(row: Row, key: string): boolean | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return asNumber(row, key) === 1;
}

/** aliases 列是 JSON 数组文本；坏数据退化成空数组而不是让接口 500 */
export function parseJsonStringArray(value: SqlValue | undefined): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function parseStayUnit(value: SqlValue | undefined): StayUnit | null {
  return value === 'DAY' || value === 'MONTH' || value === 'YEAR' ? value : null;
}

export function parseStayRule(value: SqlValue | undefined): StayRule {
  return value === 'PER_ENTRY' || value === 'ROLLING_WINDOW' ? value : 'UNSPECIFIED';
}

export function parseEntryScope(value: SqlValue | undefined): EntryScope {
  return value === 'SINGLE' || value === 'MULTIPLE' ? value : 'UNKNOWN';
}

export function parseDataStatus(value: SqlValue | undefined): DataStatus {
  switch (value) {
    case 'DETAILED':
    case 'PARTIAL':
    case 'SUMMARY_ONLY':
    case 'MENTION_ONLY':
    case 'DEMO':
      return value;
    default:
      return 'SUMMARY_ONLY';
  }
}

/* ------------------------------------------------------------------ */
/* 字典                                                                */
/* ------------------------------------------------------------------ */

export interface Dictionaries {
  regions: RegionInfo[];
  types: VisaTypeInfo[];
  categories: VisaCategoryInfo[];
  groups: PolicyGroupInfo[];
  regionMap: ReadonlyMap<string, RegionInfo>;
  typeMap: ReadonlyMap<string, VisaTypeInfo>;
  categoryMap: ReadonlyMap<string, VisaCategoryInfo>;
  groupMap: ReadonlyMap<string, PolicyGroupInfo>;
}

export async function loadDictionaries(driver: DatabaseDriver): Promise<Dictionaries> {
  const regionRows = await driver.query(
    'SELECT code, name_zh, name_en, sort_order FROM regions ORDER BY sort_order, code',
  );
  const typeRows = await driver.query(
    'SELECT code, name_zh, name_en, sort_order FROM visa_types ORDER BY sort_order, code',
  );
  const groupRows = await driver.query(
    'SELECT code, name_zh, name_en, color, description FROM policy_groups ORDER BY sort_order, code',
  );
  const categoryRows = await driver.query(
    'SELECT code, name_zh, name_en, policy_group, requires_visa, requires_authorization, severity, color ' +
      'FROM visa_categories',
  );

  const regions: RegionInfo[] = regionRows.map(row => ({
    code: asString(row, 'code') as RegionCode,
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    sortOrder: asNumber(row, 'sort_order'),
  }));
  const types: VisaTypeInfo[] = typeRows.map(row => ({
    code: asString(row, 'code'),
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    sortOrder: asNumber(row, 'sort_order'),
  }));
  const groups: PolicyGroupInfo[] = groupRows.map(row => ({
    code: asString(row, 'code') as PolicyGroup,
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    color: asString(row, 'color'),
    description: asString(row, 'description'),
  }));
  const groupOrder = new Map(groups.map((group, index) => [group.code, index]));
  const categories: VisaCategoryInfo[] = categoryRows
    .map(row => ({
      code: asString(row, 'code'),
      nameZh: asString(row, 'name_zh'),
      nameEn: asString(row, 'name_en'),
      group: asString(row, 'policy_group') as PolicyGroup,
      requiresVisa: asBoolean(row, 'requires_visa'),
      requiresAuthorization: asBoolean(row, 'requires_authorization'),
      severity: asNumber(row, 'severity'),
      color: asString(row, 'color'),
    }))
    .sort(
      (a, b) =>
        (groupOrder.get(a.group) ?? 99) - (groupOrder.get(b.group) ?? 99) ||
        a.severity - b.severity ||
        a.code.localeCompare(b.code),
    );

  return {
    regions,
    types,
    categories,
    groups,
    regionMap: new Map(regions.map(region => [region.code, region])),
    typeMap: new Map(types.map(type => [type.code, type])),
    categoryMap: new Map(categories.map(category => [category.code, category])),
    groupMap: new Map(groups.map(group => [group.code, group])),
  };
}

/* ------------------------------------------------------------------ */
/* 元数据                                                              */
/* ------------------------------------------------------------------ */

export type AppMetaMap = ReadonlyMap<string, string>;

export async function loadAppMeta(driver: DatabaseDriver): Promise<AppMetaMap> {
  // key/value 在 MySQL 8 中是关键字，反引号在 SQLite 同样合法
  const rows = await driver.query('SELECT `key`, `value` FROM app_meta');
  return new Map(rows.map(row => [asString(row, 'key'), asString(row, 'value')]));
}

/* ------------------------------------------------------------------ */
/* 国家                                                                */
/* ------------------------------------------------------------------ */

export function mapCountryInfo(row: Row, dictionaries: Dictionaries): CountryInfo {
  const region = asString(row, 'region_code');
  return {
    iso2: asString(row, 'iso2'),
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    region: region as RegionCode,
    regionLabel: dictionaries.regionMap.get(region)?.nameZh ?? region,
    aliases: parseJsonStringArray(row['aliases']),
    latitude: asNullableNumber(row, 'latitude'),
    longitude: asNullableNumber(row, 'longitude'),
    priority: asBoolean(row, 'priority'),
  };
}

export async function findCountry(driver: DatabaseDriver, iso2: string): Promise<Row | undefined> {
  return driver.get(
    'SELECT iso2, name_zh, name_en, region_code, subregion, sort_key, aliases, latitude, longitude, priority ' +
      'FROM countries WHERE iso2 = ?',
    [iso2],
  );
}

export interface CountrySuggestionRow {
  iso2: string;
  nameZh: string;
  nameEn: string;
  regionCode: string;
  priority: boolean;
  sortKey: string;
  aliases: string[];
}

export async function listCountriesForSuggest(
  driver: DatabaseDriver,
  keyword: string,
): Promise<CountrySuggestionRow[]> {
  const like = `%${keyword.toLowerCase()}%`;
  const rows = await driver.query(
    'SELECT iso2, name_zh, name_en, region_code, sort_key, aliases, priority FROM countries ' +
      'WHERE LOWER(name_zh) LIKE ? OR LOWER(name_en) LIKE ? OR LOWER(iso2) = ? OR LOWER(aliases) LIKE ? ' +
      'ORDER BY priority DESC, sort_key ASC LIMIT 12',
    [like, like, keyword.toLowerCase(), like],
  );
  return rows.map(row => ({
    iso2: asString(row, 'iso2'),
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    regionCode: asString(row, 'region_code'),
    priority: asBoolean(row, 'priority'),
    sortKey: asString(row, 'sort_key'),
    aliases: parseJsonStringArray(row['aliases']),
  }));
}

/* ------------------------------------------------------------------ */
/* 政策与明细                                                          */
/* ------------------------------------------------------------------ */

const POLICY_COLUMNS =
  'route_code, country_code, visa_type, category_code, title, summary, conditions_text, source_category, ' +
  'stay_days, stay_unit, stay_rule, window_days, window_max_days, entry_scope, validity_note, ' +
  'application_channel, requires_visa, requires_authorization, data_status, completeness, is_demo, ' +
  'is_visible, source_id, batch_id, collected_at, updated_at';

export async function findPoliciesByCountry(
  driver: DatabaseDriver,
  iso2: string,
  options: { isDemo: boolean },
): Promise<Row[]> {
  return driver.query(
    `SELECT ${POLICY_COLUMNS} FROM visa_policies ` +
      'WHERE country_code = ? AND is_visible = 1 AND is_demo = ? ORDER BY visa_type, route_code',
    [iso2, options.isDemo ? 1 : 0],
  );
}

export async function findPolicyByRouteCode(driver: DatabaseDriver, routeCode: string): Promise<Row | undefined> {
  return driver.get(`SELECT ${POLICY_COLUMNS} FROM visa_policies WHERE route_code = ? AND is_visible = 1`, [
    routeCode,
  ]);
}

export interface PolicyChildren {
  documents: Map<string, PolicyDocument[]>;
  fees: Map<string, PolicyFee[]>;
  timings: Map<string, PolicyTiming[]>;
  rules: Map<string, PolicyRule[]>;
}

export function emptyPolicyChildren(): PolicyChildren {
  return {
    documents: new Map(),
    fees: new Map(),
    timings: new Map(),
    rules: new Map(),
  };
}

/** 批量加载明细，避免国家档案里 N+1 查询 */
export async function loadPolicyChildren(
  driver: DatabaseDriver,
  routeCodes: readonly string[],
): Promise<PolicyChildren> {
  const children = emptyPolicyChildren();
  if (routeCodes.length === 0) return children;
  const placeholders = routeCodes.map(() => '?').join(', ');
  const params: SqlValue[] = [...routeCodes];

  const documentRows = await driver.query(
    'SELECT route_code, code, name, requirement, quantity, is_required, condition_text FROM policy_documents ' +
      `WHERE route_code IN (${placeholders}) ORDER BY route_code, sort_order, code`,
    params,
  );
  for (const row of documentRows) {
    const routeCode = asString(row, 'route_code');
    const list = children.documents.get(routeCode) ?? [];
    list.push({
      code: asString(row, 'code'),
      name: asString(row, 'name'),
      requirement: asNullableString(row, 'requirement'),
      quantity: asNullableNumber(row, 'quantity'),
      required: asNullableBoolean(row, 'is_required'),
      condition: asNullableString(row, 'condition_text'),
    });
    children.documents.set(routeCode, list);
  }

  const feeRows = await driver.query(
    'SELECT route_code, code, label, amount_min, amount_max, currency, charge_basis, condition_text, comparable ' +
      `FROM policy_fees WHERE route_code IN (${placeholders}) ORDER BY route_code, code`,
    params,
  );
  for (const row of feeRows) {
    const routeCode = asString(row, 'route_code');
    const list = children.fees.get(routeCode) ?? [];
    list.push({
      code: asString(row, 'code'),
      label: asString(row, 'label'),
      amountMin: asNullableString(row, 'amount_min'),
      amountMax: asNullableString(row, 'amount_max'),
      currency: asNullableString(row, 'currency'),
      basis: asNullableString(row, 'charge_basis'),
      condition: asNullableString(row, 'condition_text'),
      comparable: asBoolean(row, 'comparable'),
    });
    children.fees.set(routeCode, list);
  }

  const timingRows = await driver.query(
    'SELECT route_code, code, label, min_days, max_days, day_type, start_event, note ' +
      `FROM policy_timings WHERE route_code IN (${placeholders}) ORDER BY route_code, sort_order, code`,
    params,
  );
  for (const row of timingRows) {
    const routeCode = asString(row, 'route_code');
    const list = children.timings.get(routeCode) ?? [];
    const dayType = asString(row, 'day_type');
    list.push({
      code: asString(row, 'code'),
      label: asString(row, 'label'),
      minDays: asNullableNumber(row, 'min_days'),
      maxDays: asNullableNumber(row, 'max_days'),
      dayType: dayType === 'WORKING_DAY' || dayType === 'CALENDAR_DAY' ? dayType : null,
      startEvent: asNullableString(row, 'start_event'),
      note: asNullableString(row, 'note'),
      // policy_timings 表没有 comparable 列：契约字段按不可比较处理
      comparable: false,
    });
    children.timings.set(routeCode, list);
  }

  const ruleRows = await driver.query(
    'SELECT route_code, code, field_name, operator_name, expected_value, description FROM policy_rules ' +
      `WHERE route_code IN (${placeholders}) ORDER BY route_code, code`,
    params,
  );
  for (const row of ruleRows) {
    const routeCode = asString(row, 'route_code');
    const list = children.rules.get(routeCode) ?? [];
    list.push({
      code: asString(row, 'code'),
      fieldName: asString(row, 'field_name'),
      operatorName: parseRuleOperator(row['operator_name']),
      expectedValue: asString(row, 'expected_value'),
      description: asString(row, 'description'),
    });
    children.rules.set(routeCode, list);
  }

  return children;
}

const RULE_OPERATORS: ReadonlyArray<PolicyRule['operatorName']> = ['IN', 'ANY_OF', 'GTE', 'LTE', 'BETWEEN'];

function parseRuleOperator(value: SqlValue | undefined): PolicyRule['operatorName'] {
  return RULE_OPERATORS.find(operator => operator === value) ?? 'IN';
}

export function mapPolicyRecord(
  row: Row,
  dictionaries: Dictionaries,
  children: PolicyChildren = emptyPolicyChildren(),
): PolicyRecord {
  const routeCode = asString(row, 'route_code');
  const visaType = asString(row, 'visa_type');
  const categoryCode = asString(row, 'category_code');
  const category = dictionaries.categoryMap.get(categoryCode);
  const group = category?.group ?? 'SPECIAL';
  const stayDays = asNullableNumber(row, 'stay_days');
  const stayUnit = parseStayUnit(row['stay_unit']);
  const stayRule = parseStayRule(row['stay_rule']);

  return {
    routeCode,
    countryCode: asString(row, 'country_code'),
    visaType,
    visaTypeLabel: dictionaries.typeMap.get(visaType)?.nameZh ?? visaType,
    categoryCode,
    categoryLabel: category?.nameZh ?? categoryCode,
    group,
    groupLabel: dictionaries.groupMap.get(group)?.nameZh ?? group,
    title: asString(row, 'title'),
    summary: asNullableString(row, 'summary'),
    conditionsText: asNullableString(row, 'conditions_text'),
    sourceCategory: asNullableString(row, 'source_category'),
    stayDays,
    stayUnit,
    stayRule,
    windowDays: asNullableNumber(row, 'window_days'),
    windowMaxDays: asNullableNumber(row, 'window_max_days'),
    entryScope: parseEntryScope(row['entry_scope']),
    validityNote: asNullableString(row, 'validity_note'),
    applicationChannel: asNullableString(row, 'application_channel'),
    requiresVisa: asBoolean(row, 'requires_visa'),
    requiresAuthorization: asBoolean(row, 'requires_authorization'),
    dataStatus: parseDataStatus(row['data_status']),
    completeness: asNumber(row, 'completeness'),
    isDemo: asBoolean(row, 'is_demo'),
    sourceId: asNullableString(row, 'source_id'),
    collectedAt: asString(row, 'collected_at'),
    updatedAt: asString(row, 'updated_at'),
    documents: children.documents.get(routeCode) ?? [],
    fees: children.fees.get(routeCode) ?? [],
    timings: children.timings.get(routeCode) ?? [],
    rules: children.rules.get(routeCode) ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* 线索 / 来源 / 同义词                                                */
/* ------------------------------------------------------------------ */

export interface MentionRowData {
  visaType: string;
  visaTypeLabel: string;
  rawText: string | null;
}

export async function listMentions(driver: DatabaseDriver, iso2: string): Promise<MentionRowData[]> {
  const rows = await driver.query(
    'SELECT m.visa_type, m.raw_text, vt.name_zh AS visa_type_zh FROM mentioned_visa_types m ' +
      'JOIN visa_types vt ON vt.code = m.visa_type WHERE m.country_code = ? ORDER BY vt.sort_order, m.visa_type',
    [iso2],
  );
  return rows.map(row => ({
    visaType: asString(row, 'visa_type'),
    visaTypeLabel: asString(row, 'visa_type_zh'),
    rawText: asNullableString(row, 'raw_text'),
  }));
}

export async function findSource(driver: DatabaseDriver, sourceId: string): Promise<SourceInfo | undefined> {
  const row = await driver.get(
    'SELECT source_id, title, publisher, url, kind, accessed_at, status, note FROM data_sources WHERE source_id = ?',
    [sourceId],
  );
  if (!row) return undefined;
  return {
    sourceId: asString(row, 'source_id'),
    title: asString(row, 'title'),
    publisher: asString(row, 'publisher'),
    url: asNullableString(row, 'url'),
    kind: asString(row, 'kind'),
    accessedAt: asString(row, 'accessed_at'),
    status: asString(row, 'status'),
    note: asNullableString(row, 'note'),
  };
}

export interface SynonymRowData {
  term: string;
  canonical: string;
  kind: string;
  weight: number;
}

export async function loadSynonyms(driver: DatabaseDriver): Promise<SynonymRowData[]> {
  const rows = await driver.query('SELECT term, canonical, kind, weight FROM search_synonyms');
  return rows.map(row => ({
    term: asString(row, 'term'),
    canonical: asString(row, 'canonical'),
    kind: asString(row, 'kind'),
    weight: asNumber(row, 'weight'),
  }));
}
