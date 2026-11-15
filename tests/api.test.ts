/**
 * API 端到端测试（fastify inject）：health / overview / search / countries / route / suggest / 错误约定。
 *
 * 默认优先使用 data/generated/dataset.json 真实数据（默认搜索应为 249 条）；
 * 若 ETL 产物尚未生成则退回 tests/fixtures 的最小数据集，断言按数据集自身推导。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type {
  CountryDossier,
  HealthResponse,
  OverviewResponse,
  PolicyRecord,
  SearchResponse,
  Suggestion,
} from '../shared/contracts.ts';
import { REGIONS, VISA_CATEGORIES, VISA_TYPES } from '../shared/contracts.ts';
import { createTestContext, type TestContext } from './fixtures/harness.ts';

let ctx: TestContext;

before(async () => {
  ctx = await createTestContext();
});

after(async () => {
  if (ctx) await ctx.cleanup();
});

interface ApiErrorBody {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
}

interface ApiResult<T> {
  status: number;
  data: T | undefined;
  error: ApiErrorBody | undefined;
  headers: Record<string, unknown>;
}

async function get<T>(url: string): Promise<ApiResult<T>> {
  const response = await ctx.app.inject({ method: 'GET', url });
  const body = response.json() as { data?: T; error?: ApiErrorBody };
  return {
    status: response.statusCode,
    data: body.data,
    error: body.error,
    headers: response.headers as Record<string, unknown>,
  };
}

function expectData<T>(result: ApiResult<T>): T {
  assert.equal(result.status, 200, `期望 200，实际 ${result.status}：${JSON.stringify(result.error)}`);
  assert.ok(result.data, '响应缺少 data');
  return result.data;
}

function sumCounts(buckets: { count: number }[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

/** 当前数据集里真实（非演示）旅游签覆盖的国家集合 */
function realTourismCountries(): Set<string> {
  return new Set(
    ctx.dataset.policies
      .filter(policy => !policy.isDemo && policy.visaType === 'TOURISM')
      .map(policy => policy.countryCode),
  );
}

test('GET /api/health 返回 ok/sqlite/datasetVersion，并带 no-store 头', async () => {
  const result = await get<HealthResponse>('/api/health');
  const data = expectData(result);
  assert.equal(data.status, 'ok');
  assert.equal(data.mode, 'sqlite');
  assert.equal(data.datasetVersion, ctx.dataset.datasetVersion);
  assert.equal(typeof data.uptimeSeconds, 'number');
  assert.ok(data.uptimeSeconds >= 0);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
});

test('GET /api/v1/overview 结构与统计口径正确', async () => {
  const data = expectData(await get<OverviewResponse>('/api/v1/overview'));
  const tourismCountries = realTourismCountries();
  const demoCount = ctx.dataset.policies.filter(policy => policy.isDemo).length;

  assert.equal(data.meta.mode, 'sqlite');
  assert.equal(data.meta.datasetVersion, ctx.dataset.datasetVersion);
  assert.equal(data.meta.policyCount, tourismCountries.size);
  assert.equal(data.meta.demoPolicyCount, demoCount);
  assert.equal(data.meta.countryCount, ctx.dataset.countries.length);
  assert.equal(data.meta.categoryCount, VISA_CATEGORIES.length);
  assert.equal(data.meta.typeCount, VISA_TYPES.length);
  assert.ok(data.meta.disclaimer.includes('课程项目'));

  assert.equal(data.stats.countries, ctx.dataset.countries.length);
  assert.equal(data.stats.policies, tourismCountries.size);
  assert.equal(data.stats.withPolicy, tourismCountries.size);
  assert.equal(data.stats.withoutPolicy, ctx.dataset.countries.length - tourismCountries.size);
  assert.equal(data.stats.priorityTargets, ctx.dataset.countries.filter(country => country.priority).length);
  assert.equal(data.stats.demoDetails, demoCount);
  assert.ok(data.stats.averageCompleteness > 0);

  assert.equal(data.stats.byGroup.length, 5);
  assert.equal(data.stats.byRegion.length, REGIONS.length);
  assert.equal(data.stats.byType.length, VISA_TYPES.length);
  assert.equal(sumCounts(data.stats.byGroup), tourismCountries.size);
  assert.equal(
    data.stats.byRegion.reduce((total, region) => total + region.countries, 0),
    ctx.dataset.countries.length,
  );
  assert.equal(
    data.stats.byRegion.reduce((total, region) => total + region.withData, 0),
    tourismCountries.size,
  );
  const tourismBucket = data.stats.byType.find(bucket => bucket.code === 'TOURISM');
  assert.equal(tourismBucket?.count, tourismCountries.size);

  assert.equal(data.mapCountries.length, ctx.dataset.countries.length);
  assert.equal(new Set(data.mapCountries.map(country => country.iso2)).size, ctx.dataset.countries.length);
  const jp = data.mapCountries.find(country => country.iso2 === 'JP');
  assert.ok(jp);
  assert.equal(jp.hasData, true);
  assert.equal(jp.region, 'AS');
  for (const country of data.mapCountries) {
    assert.ok(country.iso2.length === 2);
    assert.ok(country.regionLabel.length > 0);
    assert.equal(country.hasData, tourismCountries.has(country.iso2));
  }

  assert.equal(data.dictionaries.regions.length, REGIONS.length);
  assert.equal(data.dictionaries.types.length, VISA_TYPES.length);
  assert.equal(data.dictionaries.categories.length, VISA_CATEGORIES.length);
  assert.equal(data.dictionaries.groups.length, 5);
  assert.equal(data.dictionaries.stayBuckets.length, 6);

  if (ctx.isRealDataset) {
    // 真实数据里程碑：250 国目录 / 249 条真实旅游签
    assert.equal(data.meta.policyCount, 249);
    assert.equal(data.meta.countryCount, 250);
    assert.equal(data.stats.priorityTargets, 91);
    assert.equal(data.stats.demoDetails, 22);
  }
});

test('GET /api/v1/search 默认返回真实数据集全部 TOURISM 政策', async () => {
  const data = expectData(await get<SearchResponse>('/api/v1/search'));
  const expectedTotal = realTourismCountries().size;

  assert.equal(data.query.type, 'TOURISM');
  assert.equal(data.query.includeDemo, false);
  assert.equal(data.total, expectedTotal);
  assert.equal(data.page, 1);
  assert.equal(data.pageSize, 24);
  assert.equal(data.pageCount, Math.ceil(expectedTotal / 24));
  assert.equal(data.items.length, Math.min(24, expectedTotal));
  assert.equal(data.mode, 'sqlite');
  assert.equal(data.datasetVersion, ctx.dataset.datasetVersion);
  assert.ok(data.tookMs < 150, `检索耗时 ${data.tookMs}ms 超过 150ms`);
  assert.equal(data.matchedCountries.length, expectedTotal);
  assert.ok(data.tookMs >= 0);

  const keys = new Set<string>();
  for (const item of data.items) {
    assert.equal(item.matchKind, 'POLICY');
    assert.equal(item.isDemo, false);
    assert.equal(item.visaType, 'TOURISM');
    assert.ok(item.routeCode);
    assert.equal(item.key, item.routeCode);
    assert.ok(!keys.has(item.key), `key 重复：${item.key}`);
    keys.add(item.key);
    assert.ok(item.nameZh.length > 0);
    assert.equal(item.regionLabel.length > 0, true);
    assert.equal(item.visaTypeLabel, '旅游观光');
    assert.equal(item.statusLabel.length > 0, true);
    assert.equal(typeof item.score, 'number');
    assert.ok(item.completeness >= 0 && item.completeness <= 100);
  }

  if (ctx.isRealDataset) assert.equal(data.total, 249);
});

test('GET /api/v1/search 分页与 pageSize 上限', async () => {
  const expectedTotal = realTourismCountries().size;
  const page2 = expectData(await get<SearchResponse>('/api/v1/search?page=2&pageSize=10'));
  assert.equal(page2.page, 2);
  assert.equal(page2.pageSize, 10);
  assert.equal(page2.total, expectedTotal);
  assert.equal(page2.items.length, Math.max(0, Math.min(10, expectedTotal - 10)));
  assert.equal(page2.pageCount, Math.ceil(expectedTotal / 10));

  const beyond = expectData(await get<SearchResponse>('/api/v1/search?page=999&pageSize=10'));
  assert.equal(beyond.items.length, 0);
  assert.equal(beyond.page, 999);

  const tooLarge = await get('/api/v1/search?pageSize=97');
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.error?.code, 'VALIDATION_ERROR');
  assert.equal(tooLarge.error?.details?.[0]?.field, 'pageSize');

  const zero = await get('/api/v1/search?page=0');
  assert.equal(zero.status, 400);
});

test('GET /api/v1/search?q=日本 相关度第一为 JP', async () => {
  const data = expectData(await get<SearchResponse>(`/api/v1/search?q=${encodeURIComponent('日本')}`));
  assert.ok(data.total >= 1);
  assert.equal(data.items[0]?.iso2, 'JP');
  assert.ok((data.items[0]?.score ?? 0) >= 1000);

  const alias = expectData(await get<SearchResponse>('/api/v1/search?q=Japan'));
  assert.equal(alias.items[0]?.iso2, 'JP');
});

test('GET /api/v1/search?region=AS 数量与标准分面语义', async () => {
  const expectedTotal = realTourismCountries().size;
  const asCountries = ctx.dataset.countries.filter(
    country => country.region === 'AS' && realTourismCountries().has(country.iso2),
  );
  const data = expectData(await get<SearchResponse>('/api/v1/search?region=AS'));

  assert.equal(data.query.regions.length, 1);
  assert.equal(data.query.regions[0], 'AS');
  assert.equal(data.total, asCountries.length);
  assert.ok(data.matchedCountries.every(iso2 => asCountries.some(country => country.iso2 === iso2)));
  assert.ok(data.items.every(item => item.region === 'AS'));

  // 自身维度忽略：region 分面之和应等于未按 region 过滤的总数
  assert.equal(sumCounts(data.facets.regions), expectedTotal);
  // 其他维度：保留 region 过滤，分面之和等于当前 total
  assert.equal(sumCounts(data.facets.groups), data.total);
  assert.equal(sumCounts(data.facets.categories), data.total);
  assert.equal(sumCounts(data.facets.stays), data.total);
  assert.equal(sumCounts(data.facets.statuses), data.total);
});

test('GET /api/v1/search 分面与 total 一致（默认无筛选）', async () => {
  const data = expectData(await get<SearchResponse>('/api/v1/search'));
  assert.equal(sumCounts(data.facets.regions), data.total);
  assert.equal(sumCounts(data.facets.groups), data.total);
  assert.equal(sumCounts(data.facets.categories), data.total);
  assert.equal(sumCounts(data.facets.stays), data.total);
  assert.equal(sumCounts(data.facets.statuses), data.total);
  assert.equal(data.facets.stays.length, 6);
  assert.equal(data.facets.types.length, 12);
  assert.equal(data.facets.groups.length, 5);
  assert.equal(data.facets.categories.length, VISA_CATEGORIES.length);
  assert.equal(data.facets.types.find(bucket => bucket.code === 'TOURISM')?.count, realTourismCountries().size);
});

test('GET /api/v1/countries/JP 国家档案完整', async () => {
  const data = expectData(await get<CountryDossier>('/api/v1/countries/JP'));
  assert.equal(data.country.iso2, 'JP');
  assert.equal(data.country.region, 'AS');
  assert.ok(data.country.regionLabel.length > 0);
  assert.ok(Array.isArray(data.country.aliases));
  assert.ok(data.policies.length >= 1);
  assert.ok(data.policies.every(policy => policy.countryCode === 'JP' && policy.isDemo === false));
  assert.ok(data.tourism);
  assert.equal(data.tourism.visaType, 'TOURISM');
  assert.ok(data.tourism.routeCode.length > 0);
  assert.equal(typeof data.tourism.sourceCategory, 'string');
  assert.ok(Array.isArray(data.tourism.documents));
  assert.ok(Array.isArray(data.tourism.fees));
  assert.ok(Array.isArray(data.tourism.timings));
  assert.ok(Array.isArray(data.tourism.rules));
  assert.deepEqual(data.demoPolicies, []);
  assert.ok(data.source);
  assert.ok(data.mentions.length >= 1);
  assert.equal(data.stats.policyCount, data.policies.length);
  assert.equal(data.stats.demoCount, 0);
  assert.equal(data.stats.regionLabel, data.country.regionLabel);
});

test('GET /api/v1/countries/XK 目录内无资料国家返回 200 + 空政策', async () => {
  const result = await get<CountryDossier>('/api/v1/countries/XK');
  const data = expectData(result);
  assert.equal(data.country.iso2, 'XK');
  assert.deepEqual(data.policies, []);
  assert.equal(data.tourism, null);
  assert.equal(data.stats.policyCount, 0);
});

test('GET /api/v1/route/:routeCode 返回完整 PolicyRecord', async () => {
  const realPolicy = ctx.dataset.policies.find(policy => !policy.isDemo);
  assert.ok(realPolicy);
  const data = expectData(await get<PolicyRecord>(`/api/v1/route/${realPolicy.routeCode}`));
  assert.equal(data.routeCode, realPolicy.routeCode);
  assert.equal(data.countryCode, realPolicy.countryCode);
  assert.equal(data.isDemo, false);
  assert.equal(typeof data.sourceCategory, 'string');
  assert.ok(Array.isArray(data.documents));
  assert.ok(Array.isArray(data.fees));
  assert.ok(Array.isArray(data.timings));
  assert.ok(Array.isArray(data.rules));

  const demoPolicy = ctx.dataset.policies.find(policy => policy.isDemo);
  if (demoPolicy) {
    const demo = expectData(await get<PolicyRecord>(`/api/v1/route/${demoPolicy.routeCode}`));
    assert.equal(demo.isDemo, true);
    assert.equal(demo.dataStatus, 'DEMO');
    assert.ok(demo.rules.length > 0, '演示路线应包含可解释规则');
  }
});

test('404 / 400 错误约定', async () => {
  const unknownCountry = await get('/api/v1/countries/ZZ');
  assert.equal(unknownCountry.status, 404);
  assert.equal(unknownCountry.error?.code, 'NOT_FOUND');

  const lowerIso = await get('/api/v1/countries/jp');
  assert.equal(lowerIso.status, 400);
  assert.equal(lowerIso.error?.code, 'VALIDATION_ERROR');
  assert.equal(lowerIso.error?.details?.[0]?.field, 'iso2');

  const badType = await get('/api/v1/search?type=BOGUS');
  assert.equal(badType.status, 400);
  assert.equal(badType.error?.code, 'VALIDATION_ERROR');
  assert.equal(badType.error?.details?.[0]?.field, 'type');

  const badSort = await get('/api/v1/search?sort=bogus');
  assert.equal(badSort.status, 400);
  assert.equal(badSort.error?.details?.[0]?.field, 'sort');

  const badRegion = await get('/api/v1/search?region=EU,XX');
  assert.equal(badRegion.status, 400);
  assert.equal(badRegion.error?.details?.[0]?.field, 'region');

  const badRoute = await get('/api/v1/route/lower-case');
  assert.equal(badRoute.status, 400);
  assert.equal(badRoute.error?.details?.[0]?.field, 'routeCode');

  const missingRoute = await get('/api/v1/route/XX-NOTHING-01');
  assert.equal(missingRoute.status, 404);

  const unknownApi = await get('/api/v1/does-not-exist');
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.error?.code, 'NOT_FOUND');
  assert.equal(unknownApi.headers['cache-control'], 'no-store');
});

test('GET /api/v1/suggest 国家联想、空串与超长校验', async () => {
  const result = expectData(await get<Suggestion[]>(`/api/v1/suggest?q=${encodeURIComponent('日')}`));
  assert.ok(result.length >= 1);
  assert.ok(result.length <= 8);
  assert.equal(result[0]?.kind, 'country');
  assert.equal(result[0]?.iso2, 'JP');
  for (const suggestion of result) {
    assert.ok(['country', 'alias', 'category', 'type', 'keyword'].includes(suggestion.kind));
    assert.ok(suggestion.code.length > 0);
    assert.ok(suggestion.label.length > 0);
    assert.ok(suggestion.hint.length > 0);
  }

  // 同一国家的中文名不应同时以 country/alias 重复出现
  const uk = expectData(await get<Suggestion[]>(`/api/v1/suggest?q=${encodeURIComponent('英国')}`));
  const ukLabels = uk.filter(suggestion => suggestion.iso2 === 'GB').map(suggestion => suggestion.label);
  assert.equal(new Set(ukLabels).size, ukLabels.length);
  assert.equal(uk[0]?.kind, 'country');

  const empty = expectData(await get<Suggestion[]>('/api/v1/suggest?q='));
  assert.deepEqual(empty, []);

  const tooLong = await get(`/api/v1/suggest?q=${'x'.repeat(41)}`);
  assert.equal(tooLong.status, 400);
});

test('type=BUSINESS & demo 关闭时返回 MENTION_ONLY 线索', async () => {
  const realBusiness = ctx.dataset.policies.filter(policy => !policy.isDemo && policy.visaType === 'BUSINESS');
  if (realBusiness.length > 0) return; // 数据里已有真实商务政策时该断言不适用
  const mentionCountries = new Set(
    ctx.dataset.mentions.filter(mention => mention.visaType === 'BUSINESS').map(mention => mention.countryCode),
  );
  const data = expectData(await get<SearchResponse>('/api/v1/search?type=BUSINESS'));
  assert.equal(data.total, mentionCountries.size);
  for (const item of data.items) {
    assert.equal(item.matchKind, 'MENTION_ONLY');
    assert.equal(item.dataStatus, 'MENTION_ONLY');
    assert.equal(item.routeCode, null);
    assert.equal(item.categoryCode, null);
    assert.equal(item.stayDays, null);
    assert.ok(item.mentionText !== null);
  }
});

test('安全响应头覆盖 API 响应', async () => {
  const result = await get<SearchResponse>('/api/v1/search');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['x-frame-options'], 'DENY');
});
