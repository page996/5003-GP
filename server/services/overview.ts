/**
 * 首屏总览：数据集元信息 + 统计 + 地图着色数据 + 全部字典。
 *
 * 统计只认真实数据（is_demo = 0），演示明细单独计数，
 * 这样「249 国旅游签」的口径不会被演示样本污染。
 */
import type {
  DashboardStats,
  DatasetMeta,
  FacetBucket,
  MapCountry,
  OverviewResponse,
  PolicyGroup,
  RegionCode,
} from '../../shared/contracts.ts';
import { DISCLAIMER, STAY_BUCKETS, formatStay } from '../../shared/contracts.ts';
import type { DatabaseDriver, Row } from '../db/driver.ts';
import type { Dictionaries } from '../db/repository.ts';
import {
  asBoolean,
  asNullableNumber,
  asNullableString,
  asNumber,
  asString,
  loadAppMeta,
  loadDictionaries,
  parseStayRule,
  parseStayUnit,
} from '../db/repository.ts';

async function scalarCount(driver: DatabaseDriver, sql: string): Promise<number> {
  const row = await driver.get(sql);
  return asNumber(row ?? {}, 'count');
}

export async function getOverview(driver: DatabaseDriver): Promise<OverviewResponse> {
  const dictionaries = await loadDictionaries(driver);
  const metaMap = await loadAppMeta(driver);

  const policyCount = await scalarCount(
    driver,
    'SELECT COUNT(*) AS count FROM visa_policies WHERE is_visible = 1 AND is_demo = 0',
  );
  const demoPolicyCount = await scalarCount(
    driver,
    'SELECT COUNT(*) AS count FROM visa_policies WHERE is_visible = 1 AND is_demo = 1',
  );
  const countryCount = await scalarCount(driver, 'SELECT COUNT(*) AS count FROM countries');
  const withPolicy = await scalarCount(
    driver,
    'SELECT COUNT(DISTINCT country_code) AS count FROM visa_policies WHERE is_visible = 1 AND is_demo = 0',
  );
  const priorityTargets = await scalarCount(driver, 'SELECT COUNT(*) AS count FROM countries WHERE priority = 1');
  const averageRow = await driver.get(
    'SELECT AVG(completeness) AS average FROM visa_policies WHERE is_visible = 1 AND is_demo = 0',
  );

  const meta: DatasetMeta = {
    schemaVersion: metaMap.get('schema_version') ?? '2.0',
    datasetVersion: metaMap.get('dataset_version') ?? 'unknown',
    mode: driver.mode,
    generatedAt: metaMap.get('generated_at') ?? '',
    importedAt: metaMap.get('imported_at') ?? null,
    sourceFile: metaMap.get('source_file') ?? '',
    sourceHash: metaMap.get('source_hash') ?? '',
    policyCount,
    countryCount,
    demoPolicyCount,
    categoryCount: dictionaries.categories.length,
    typeCount: dictionaries.types.length,
    disclaimer: DISCLAIMER,
  };

  const stats: DashboardStats = {
    countries: countryCount,
    policies: policyCount,
    withPolicy,
    withoutPolicy: Math.max(0, countryCount - withPolicy),
    priorityTargets,
    demoDetails: demoPolicyCount,
    averageCompleteness: roundMetric(asNullableNumber(averageRow ?? {}, 'average')),
    byGroup: await buildGroupBuckets(driver, dictionaries),
    byRegion: await buildRegionCoverage(driver, dictionaries),
    byType: await buildTypeCoverage(driver, dictionaries),
  };

  return {
    meta,
    stats,
    mapCountries: await loadMapCountries(driver, dictionaries),
    dictionaries: {
      regions: dictionaries.regions,
      types: dictionaries.types,
      categories: dictionaries.categories,
      groups: dictionaries.groups,
      stayBuckets: STAY_BUCKETS,
    },
  };
}

function roundMetric(value: number | null): number {
  if (value === null || Number.isNaN(value)) return 0;
  return Math.round(value * 10) / 10;
}

async function buildGroupBuckets(driver: DatabaseDriver, dictionaries: Dictionaries): Promise<FacetBucket[]> {
  const rows = await driver.query(
    'SELECT vc.policy_group AS code, COUNT(*) AS count FROM visa_policies p ' +
      'JOIN visa_categories vc ON vc.code = p.category_code ' +
      'WHERE p.is_visible = 1 AND p.is_demo = 0 GROUP BY vc.policy_group',
  );
  const counts = new Map(rows.map(row => [asString(row, 'code'), asNumber(row, 'count')]));
  return dictionaries.groups.map(group => ({
    code: group.code,
    label: group.nameZh,
    count: counts.get(group.code) ?? 0,
    color: group.color,
  }));
}

async function buildRegionCoverage(
  driver: DatabaseDriver,
  dictionaries: Dictionaries,
): Promise<DashboardStats['byRegion']> {
  const rows = await driver.query(
    'SELECT c.region_code AS code, COUNT(*) AS countries, ' +
      'SUM(CASE WHEN EXISTS (SELECT 1 FROM visa_policies p WHERE p.country_code = c.iso2 ' +
      'AND p.is_visible = 1 AND p.is_demo = 0) THEN 1 ELSE 0 END) AS with_data ' +
      'FROM countries c GROUP BY c.region_code',
  );
  const byRegion = new Map(
    rows.map(row => [
      asString(row, 'code'),
      { countries: asNumber(row, 'countries'), withData: asNumber(row, 'with_data') },
    ]),
  );
  return dictionaries.regions.map(region => ({
    code: region.code as RegionCode,
    label: region.nameZh,
    countries: byRegion.get(region.code)?.countries ?? 0,
    withData: byRegion.get(region.code)?.withData ?? 0,
  }));
}

/** 类型覆盖：真实政策或类型线索覆盖到的国家数（去重） */
async function buildTypeCoverage(driver: DatabaseDriver, dictionaries: Dictionaries): Promise<FacetBucket[]> {
  const rows = await driver.query(
    'SELECT visa_type AS code, country_code AS iso2 FROM visa_policies WHERE is_visible = 1 AND is_demo = 0 ' +
      'UNION SELECT visa_type AS code, country_code AS iso2 FROM mentioned_visa_types',
  );
  const countriesByType = new Map<string, Set<string>>();
  for (const row of rows) {
    const code = asString(row, 'code');
    const set = countriesByType.get(code) ?? new Set<string>();
    set.add(asString(row, 'iso2'));
    countriesByType.set(code, set);
  }
  return dictionaries.types.map(type => ({
    code: type.code,
    label: type.nameZh,
    count: countriesByType.get(type.code)?.size ?? 0,
  }));
}

async function loadMapCountries(driver: DatabaseDriver, dictionaries: Dictionaries): Promise<MapCountry[]> {
  const rows = await driver.query(
    'SELECT c.iso2, c.name_zh, c.name_en, c.region_code, c.priority, ' +
      'p.category_code, p.stay_days, p.stay_unit, p.stay_rule, p.window_days, p.window_max_days, p.completeness, ' +
      'vc.policy_group, vc.requires_visa, ' +
      'CASE WHEN EXISTS (SELECT 1 FROM visa_policies d WHERE d.country_code = c.iso2 ' +
      'AND d.is_demo = 1 AND d.is_visible = 1) THEN 1 ELSE 0 END AS has_demo_detail ' +
      'FROM countries c ' +
      "LEFT JOIN visa_policies p ON p.country_code = c.iso2 AND p.visa_type = 'TOURISM' " +
      'AND p.is_visible = 1 AND p.is_demo = 0 ' +
      'LEFT JOIN visa_categories vc ON vc.code = p.category_code ' +
      'ORDER BY c.sort_key, c.iso2',
  );

  const seen = new Set<string>();
  const countries: MapCountry[] = [];
  for (const row of rows) {
    const iso2 = asString(row, 'iso2');
    // 理论上一国一条旅游签；若数据出现多条，只取排序最前的一条，保证地图唯一
    if (seen.has(iso2)) continue;
    seen.add(iso2);
    countries.push(mapMapCountry(row, dictionaries));
  }
  return countries;
}

function mapMapCountry(row: Row, dictionaries: Dictionaries): MapCountry {
  const region = asString(row, 'region_code') as RegionCode;
  const categoryCode = asNullableString(row, 'category_code');
  const groupCode = asNullableString(row, 'policy_group') as PolicyGroup | null;
  const hasData = categoryCode !== null;
  const stayDays = asNullableNumber(row, 'stay_days');
  const stayUnit = parseStayUnit(row['stay_unit']);
  return {
    iso2: asString(row, 'iso2'),
    nameZh: asString(row, 'name_zh'),
    nameEn: asString(row, 'name_en'),
    region,
    regionLabel: dictionaries.regionMap.get(region)?.nameZh ?? region,
    hasData,
    priority: asBoolean(row, 'priority'),
    categoryCode,
    categoryLabel: categoryCode ? dictionaries.categoryMap.get(categoryCode)?.nameZh ?? categoryCode : null,
    group: groupCode,
    groupLabel: groupCode ? dictionaries.groupMap.get(groupCode)?.nameZh ?? groupCode : null,
    requiresVisa: hasData ? asBoolean(row, 'requires_visa') : null,
    stayDays,
    stayUnit,
    stayLabel: formatStay(
      stayDays,
      stayUnit,
      hasData ? parseStayRule(row['stay_rule']) : 'UNSPECIFIED',
      asNullableNumber(row, 'window_days'),
      asNullableNumber(row, 'window_max_days'),
    ),
    completeness: hasData ? asNumber(row, 'completeness') : 0,
    hasDemoDetail: asBoolean(row, 'has_demo_detail'),
  };
}
