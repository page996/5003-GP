/**
 * Visa Atlas v1.0 · 数据集校验
 *
 * 在 ETL 之后、写库之前运行：npm run data:check
 * 校验范围：结构、字典引用、国家目录、路线唯一性、真实/演示边界、来源引用、
 *          停留期与完整度范围、同义词与线索的合法代码。
 * 出现结构性错误时退出码为 1，CI / 本地提交前均可运行。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_GROUPS, REGIONS, VISA_CATEGORIES, VISA_TYPES } from '../shared/contracts.ts';
import type { DatasetFile } from '../shared/dataset.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = path.join(ROOT, 'data/generated/dataset.json');
const CATALOG = path.join(ROOT, 'data/countries.json');

interface CatalogCountry { code: string }

const errors: string[] = [];
const warnings: string[] = [];
const check = (condition: boolean, message: string) => { if (!condition) errors.push(message); };
const warn = (condition: boolean, message: string) => { if (!condition) warnings.push(message); };

async function main() {
  const dataset = JSON.parse(await readFile(DATASET, 'utf8')) as DatasetFile;
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8')) as CatalogCountry[];
  const countryCodes = new Set(catalog.map(country => country.code));
  const regionCodes = new Set(REGIONS.map(region => region.code));
  const typeCodes = new Set(VISA_TYPES.map(type => type.code));
  const categoryCodes = new Set(VISA_CATEGORIES.map(category => category.code));
  const groupCodes = new Set(POLICY_GROUPS.map(group => group.code));
  const sourceIds = new Set(dataset.sources.map(source => source.sourceId));
  const batchIds = new Set(dataset.batches.map(batch => batch.batchId));

  check(dataset.schemaVersion === '2.0', `schemaVersion 应为 2.0，实际 ${dataset.schemaVersion}`);
  check(dataset.countries.length === 250, `国家目录应为 250，实际 ${dataset.countries.length}`);
  check(dataset.policies.filter(policy => !policy.isDemo).length === 249, `真实政策应为 249，实际 ${dataset.policies.filter(policy => !policy.isDemo).length}`);
  check(dataset.countries.filter(country => country.priority).length === 91, `重点候选应为 91，实际 ${dataset.countries.filter(country => country.priority).length}`);
  check(dataset.dictionaries.regions.length === REGIONS.length, '地区字典数量不一致');
  check(dataset.dictionaries.types.length === VISA_TYPES.length, '签证类型字典数量不一致');
  check(dataset.dictionaries.categories.length === VISA_CATEGORIES.length, '签证类别字典数量不一致');

  const seenCountries = new Set<string>();
  for (const country of dataset.countries) {
    check(countryCodes.has(country.iso2), `国家不在目录：${country.iso2}`);
    check(!seenCountries.has(country.iso2), `国家重复：${country.iso2}`);
    seenCountries.add(country.iso2);
    check(regionCodes.has(country.region), `${country.iso2} 地区代码非法：${country.region}`);
    check(country.nameZh.length > 0 && country.nameEn.length > 0, `${country.iso2} 缺少名称`);
    check(country.aliases.every(alias => typeof alias === 'string'), `${country.iso2} 别名非法`);
    check(country.latitude === null || (country.latitude >= -90 && country.latitude <= 90), `${country.iso2} 纬度越界`);
    check(country.longitude === null || (country.longitude >= -180 && country.longitude <= 180), `${country.iso2} 经度越界`);
  }

  const routes = new Set<string>();
  for (const policy of dataset.policies) {
    const label = `${policy.routeCode}`;
    check(!routes.has(policy.routeCode), `路线重复：${policy.routeCode}`);
    routes.add(policy.routeCode);
    check(/^[A-Z0-9_-]{1,80}$/.test(policy.routeCode), `${label} routeCode 格式非法`);
    check(seenCountries.has(policy.countryCode), `${label} 国家不存在：${policy.countryCode}`);
    check(typeCodes.has(policy.visaType), `${label} 签证类型非法：${policy.visaType}`);
    check(categoryCodes.has(policy.categoryCode), `${label} 签证类别非法：${policy.categoryCode}`);
    check(sourceIds.has(policy.sourceId), `${label} 来源不存在：${policy.sourceId}`);
    check(batchIds.has(policy.batchId), `${label} 批次不存在：${policy.batchId}`);
    check(policy.title.length > 0 && policy.title.length <= 200, `${label} 标题长度非法`);
    check(policy.completeness >= 0 && policy.completeness <= 100, `${label} 完整度越界`);
    check(!Number.isNaN(Date.parse(policy.updatedAt)), `${label} updatedAt 非法`);
    check(!Number.isNaN(Date.parse(policy.collectedAt)), `${label} collectedAt 非法`);
    check(policy.searchText.length > 0, `${label} searchText 为空`);
    if (policy.stayDays !== null) {
      check(Number.isInteger(policy.stayDays) && policy.stayDays >= 0 && policy.stayDays <= 3650, `${label} 停留期非法：${policy.stayDays}`);
      check(policy.stayUnit !== null, `${label} 有停留期但缺单位`);
    } else {
      check(policy.stayUnit === null, `${label} 无停留期但设置了单位`);
    }
    if (policy.windowMaxDays !== null) {
      check(policy.windowDays !== null, `${label} 有累计上限但缺窗口`);
      check(policy.windowDays! > 0 && policy.windowMaxDays > 0, `${label} 窗口参数非法`);
    }
    if (policy.isDemo) {
      check(policy.dataStatus === 'DEMO', `${label} 演示数据状态必须为 DEMO`);
      check(policy.completeness >= 40, `${label} 演示明细完整度过低`);
      warn(/演示/.test(policy.title), `${label} 演示路线标题未标注“演示”`);
    } else {
      check(policy.dataStatus !== 'DEMO', `${label} 真实数据不能标记 DEMO`);
      check(policy.sourceCategory !== null && policy.sourceCategory.length > 0, `${label} 真实数据缺少原始分类`);
    }
    if (policy.categoryCode === 'HOME_REGION') warnings.push(`${label} 为“本国/地区”政策，检索时建议说明`);
    if (policy.requiresVisa && policy.requiresAuthorization === false) warnings.push(`${label} requiresVisa 与 requiresAuthorization 组合可疑`);
    for (const document of policy.documents) check(document.code.length > 0 && document.name.length > 0, `${label} 材料字段为空`);
    for (const fee of policy.fees) {
      check(fee.currency === null || /^[A-Z]{3}$/.test(fee.currency), `${label} 费用币种非法：${fee.currency}`);
      check(fee.amountMin === null || Number(fee.amountMin) >= 0, `${label} 费用为负`);
      if (fee.amountMin && fee.amountMax) check(Number(fee.amountMin) <= Number(fee.amountMax), `${label} 费用下限大于上限`);
    }
    for (const timing of policy.timings) {
      check(timing.dayType === null || ['WORKING_DAY', 'CALENDAR_DAY'].includes(timing.dayType), `${label} 办理时间类型非法`);
      check(timing.minDays === null || timing.maxDays === null || timing.minDays <= timing.maxDays, `${label} 办理时间范围非法`);
    }
    for (const rule of policy.rules) {
      try { JSON.parse(rule.expectedValue); } catch { errors.push(`${label} 规则 expectedValue 非 JSON`); }
      check(['passportCountryCode', 'residenceCountryCode', 'age', 'employment', 'passportValidityMonths', 'heldVisaCodes'].includes(rule.fieldName), `${label} 规则字段非法：${rule.fieldName}`);
      check(['IN', 'ANY_OF', 'GTE', 'LTE', 'BETWEEN'].includes(rule.operatorName), `${label} 规则操作符非法：${rule.operatorName}`);
    }
  }

  const mentionKeys = new Set<string>();
  for (const mention of dataset.mentions) {
    const key = `${mention.countryCode}:${mention.visaType}`;
    check(!mentionKeys.has(key), `线索重复：${key}`);
    mentionKeys.add(key);
    check(seenCountries.has(mention.countryCode), `线索国家不存在：${mention.countryCode}`);
    check(typeCodes.has(mention.visaType), `线索类型非法：${mention.visaType}`);
    check(sourceIds.has(mention.sourceId), `线索来源不存在：${mention.sourceId}`);
    check(mention.visaType !== 'TOURISM', `旅游签不应作为“其他类型线索”：${mention.countryCode}`);
  }

  const synonymKeys = new Set<string>();
  for (const synonym of dataset.synonyms) {
    const key = synonym.term.toLowerCase();
    check(!synonymKeys.has(key), `同义词重复：${synonym.term}`);
    synonymKeys.add(key);
    check(['COUNTRY', 'CATEGORY', 'TYPE', 'KEYWORD'].includes(synonym.kind), `同义词 kind 非法：${synonym.term}`);
    if (synonym.kind === 'COUNTRY') check(countryCodes.has(synonym.canonical), `同义词国家不存在：${synonym.term} → ${synonym.canonical}`);
    if (synonym.kind === 'CATEGORY') check(categoryCodes.has(synonym.canonical), `同义词类别不存在：${synonym.term} → ${synonym.canonical}`);
    if (synonym.kind === 'TYPE') check(typeCodes.has(synonym.canonical), `同义词类型不存在：${synonym.term} → ${synonym.canonical}`);
    check(synonym.weight > 0 && synonym.weight <= 100, `同义词权重非法：${synonym.term}`);
  }

  for (const source of dataset.sources) {
    check(source.sourceId.length > 0 && source.title.length > 0 && source.publisher.length > 0, '来源字段不完整');
    check(!Number.isNaN(Date.parse(source.accessedAt)), `来源访问时间非法：${source.sourceId}`);
    if (source.url !== null) check(/^https?:\/\//.test(source.url), `来源 URL 非法：${source.sourceId}`);
  }
  for (const batch of dataset.batches) check(batch.rowCount >= 0, `批次行数非法：${batch.batchId}`);
  for (const group of POLICY_GROUPS) check(groupCodes.has(group.code), `政策组代码不一致：${group.code}`);

  const realPolicies = dataset.policies.filter(policy => !policy.isDemo);
  const coveredCountries = new Set(realPolicies.map(policy => policy.countryCode));
  for (const country of dataset.countries) warn(coveredCountries.has(country.iso2), `${country.iso2} 尚无真实政策（预期仅 XK）`);

  console.log('Visa Atlas 数据集校验');
  console.log(`  版本：${dataset.datasetVersion}`);
  console.log(`  国家 ${dataset.countries.length} · 真实政策 ${realPolicies.length} · 演示 ${dataset.policies.length - realPolicies.length} · 类型线索 ${dataset.mentions.length} · 同义词 ${dataset.synonyms.length}`);
  if (warnings.length) {
    console.log(`\n  警告 ${warnings.length} 条：`);
    for (const warning of warnings.slice(0, 20)) console.log(`   - ${warning}`);
    if (warnings.length > 20) console.log(`   … 其余 ${warnings.length - 20} 条省略`);
  }
  if (errors.length) {
    console.error(`\n✘ 校验失败，${errors.length} 个错误：`);
    for (const error of errors.slice(0, 40)) console.error(`   - ${error}`);
    if (errors.length > 40) console.error(`   … 其余 ${errors.length - 40} 个错误省略`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✔ 数据集校验通过');
}

main().catch(error => { console.error('✘ 校验异常：', error); process.exitCode = 1; });
