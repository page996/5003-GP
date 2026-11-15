/**
 * 国家签证档案：国家目录字段 + 真实政策 + 演示明细（默认不返回）+ 类型线索 + 主来源。
 *
 * 目录内但本轮未采集的国家（如 XK）返回 200 + 空政策，而不是 404；
 * 只有完全不在 countries 目录里的代码才是 404（由 API 层判断 null）。
 */
import type { CountryDossier, PolicyRecord } from '../../shared/contracts.ts';
import type { DatabaseDriver, Row } from '../db/driver.ts';
import type { Dictionaries } from '../db/repository.ts';
import {
  asString,
  findCountry,
  findPoliciesByCountry,
  findPolicyByRouteCode,
  findSource,
  listMentions,
  loadDictionaries,
  loadPolicyChildren,
  mapCountryInfo,
  mapPolicyRecord,
} from '../db/repository.ts';

async function mapPolicyRows(
  driver: DatabaseDriver,
  dictionaries: Dictionaries,
  rows: readonly Row[],
): Promise<PolicyRecord[]> {
  if (rows.length === 0) return [];
  const routeCodes = rows.map(row => asString(row, 'route_code'));
  const children = await loadPolicyChildren(driver, routeCodes);
  return rows.map(row => mapPolicyRecord(row, dictionaries, children)).sort((a, b) => {
    const aOrder = dictionaries.typeMap.get(a.visaType)?.sortOrder ?? 99;
    const bOrder = dictionaries.typeMap.get(b.visaType)?.sortOrder ?? 99;
    return aOrder - bOrder || a.routeCode.localeCompare(b.routeCode);
  });
}

export async function getCountryDossier(
  driver: DatabaseDriver,
  iso2: string,
  options: { includeDemo: boolean },
): Promise<CountryDossier | null> {
  const countryRow = await findCountry(driver, iso2);
  if (!countryRow) return null;

  const dictionaries = await loadDictionaries(driver);
  const [realRows, demoRows] = await Promise.all([
    findPoliciesByCountry(driver, iso2, { isDemo: false }),
    options.includeDemo ? findPoliciesByCountry(driver, iso2, { isDemo: true }) : Promise.resolve([] as Row[]),
  ]);
  const [policies, demoPolicies, mentions] = await Promise.all([
    mapPolicyRows(driver, dictionaries, realRows),
    mapPolicyRows(driver, dictionaries, demoRows),
    listMentions(driver, iso2),
  ]);

  const country = mapCountryInfo(countryRow, dictionaries);
  const tourism = policies.find(policy => policy.visaType === 'TOURISM') ?? null;
  const primarySourceId = tourism?.sourceId ?? policies[0]?.sourceId ?? null;
  const source = primarySourceId ? (await findSource(driver, primarySourceId)) ?? null : null;
  const maxCompleteness = policies.reduce((max, policy) => Math.max(max, policy.completeness), 0);

  return {
    country,
    source,
    policies,
    demoPolicies,
    mentions,
    tourism,
    stats: {
      policyCount: policies.length,
      demoCount: demoPolicies.length,
      mentionCount: mentions.length,
      maxCompleteness,
      regionLabel: country.regionLabel,
    },
  };
}

/** 单条路线完整记录（分享深链用）；不可见/不存在返回 null */
export async function getPolicyRecord(driver: DatabaseDriver, routeCode: string): Promise<PolicyRecord | null> {
  const row = await findPolicyByRouteCode(driver, routeCode);
  if (!row) return null;
  const dictionaries = await loadDictionaries(driver);
  const children = await loadPolicyChildren(driver, [routeCode]);
  return mapPolicyRecord(row, dictionaries, children);
}
