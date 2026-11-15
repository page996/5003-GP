/**
 * 检索语义测试（固定使用 tests/fixtures 的小数据集，断言完全确定）：
 * 组合筛选、停留期分桶（含 MONTH 折算）、mention-only、demo 开关与真实政策优先、
 * 关键词 AND/同义词、分面标准语义、排序与错误参数。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { SearchItem, SearchResponse } from '../shared/contracts.ts';
import { createTestContext, type TestContext } from './fixtures/harness.ts';

let ctx: TestContext;

before(async () => {
  ctx = await createTestContext({ dataset: 'fixture' });
});

after(async () => {
  if (ctx) await ctx.cleanup();
});

async function search(query: string): Promise<SearchResponse> {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/search?${query}` });
  assert.equal(response.statusCode, 200, `查询失败 ${query}：${response.body}`);
  return (response.json() as { data: SearchResponse }).data;
}

async function searchStatus(query: string): Promise<number> {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/search?${query}` });
  return response.statusCode;
}

function sum(buckets: { count: number }[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

function iso2List(items: SearchItem[]): string[] {
  return items.map(item => item.iso2);
}

test('默认 TOURISM 返回 fixture 中 9 条真实旅游签', async () => {
  const data = await search('');
  assert.equal(data.total, 9);
  assert.equal(data.pageCount, 1);
  assert.equal(data.items.length, 9);
  assert.equal(data.matchedCountries.length, 9);
  assert.deepEqual([...data.matchedCountries].sort(), ['BR', 'DE', 'FR', 'GB', 'JP', 'KE', 'SG', 'TH', 'US']);
  assert.ok(data.items.every(item => !item.isDemo && item.visaType === 'TOURISM'));
});

test('组合筛选：region + group 在 SQL 中取交集', async () => {
  const data = await search('region=AS&group=FREE');
  assert.equal(data.total, 2);
  assert.deepEqual(iso2List(data.items).sort(), ['SG', 'TH']);
  assert.ok(data.items.every(item => item.region === 'AS' && item.group === 'FREE'));

  const categoryAndGroup = await search('category=SCHENGEN_VISA&group=PREARRANGED');
  assert.equal(categoryAndGroup.total, 2);
  assert.deepEqual(iso2List(categoryAndGroup.items).sort(), ['DE', 'FR']);

  const contradiction = await search('category=SCHENGEN_VISA&group=FREE');
  assert.equal(contradiction.total, 0);
  assert.deepEqual(contradiction.items, []);
});

test('停留期分桶：MONTH 按 30 天折算参与筛选', async () => {
  const eightToThirty = await search('stay=D8_30');
  // SG 30 DAY / US 1 MONTH(=30) / DE 15 DAY
  assert.deepEqual(iso2List(eightToThirty.items).sort(), ['DE', 'SG', 'US']);

  const thirtyOneToNinety = await search('stay=D31_90');
  // JP 90 DAY / FR 3 MONTH(=90)
  assert.deepEqual(iso2List(thirtyOneToNinety.items).sort(), ['FR', 'JP']);

  const ninetyOneToOneEighty = await search('stay=D91_180');
  // GB 6 MONTH(=180) / BR 180 DAY
  assert.deepEqual(iso2List(ninetyOneToOneEighty.items).sort(), ['BR', 'GB']);

  const withinSeven = await search('stay=LE_7');
  assert.deepEqual(iso2List(withinSeven.items), ['KE']);

  const unknown = await search('stay=UNKNOWN');
  assert.deepEqual(iso2List(unknown.items), ['TH']);
  assert.equal(unknown.items[0]?.stayDays, null);

  // 多选分桶 = OR
  const multi = await search('stay=UNKNOWN&demo=0');
  assert.equal(multi.total, 1);
});

test('type=BUSINESS & demo 关闭 → 全部为 MENTION_ONLY 线索', async () => {
  const data = await search('type=BUSINESS');
  assert.equal(data.total, 9);
  for (const item of data.items) {
    assert.equal(item.matchKind, 'MENTION_ONLY');
    assert.equal(item.dataStatus, 'MENTION_ONLY');
    assert.equal(item.routeCode, null);
    assert.equal(item.categoryCode, null);
    assert.equal(item.stayDays, null);
    assert.equal(item.isDemo, false);
    assert.ok(item.mentionText);
    assert.match(item.key, /^[A-Z]{2}:BUSINESS$/);
  }
});

test('demo=1 时展示演示明细，且同国同类型真实政策优先', async () => {
  // demo 关闭：XK 无政策、JP 只有真实旅游签
  const plain = await search('type=TOURISM');
  assert.equal(plain.total, 9);
  assert.ok(!plain.items.some(item => item.iso2 === 'XK'));

  // demo 开启：XK 的演示旅游签出现；JP 仍然用真实政策（演示同类型政策被压制）
  const withDemo = await search('type=TOURISM&demo=1');
  assert.equal(withDemo.total, 10);
  const jpItem = withDemo.items.find(item => item.iso2 === 'JP');
  assert.ok(jpItem);
  assert.equal(jpItem.routeCode, 'JP-TOURISM-CN-ORD');
  assert.equal(jpItem.isDemo, false);
  const xkItem = withDemo.items.find(item => item.iso2 === 'XK');
  assert.ok(xkItem);
  assert.equal(xkItem.routeCode, 'XK-TOURISM-DEMO-01');
  assert.equal(xkItem.matchKind, 'POLICY');
  assert.equal(xkItem.dataStatus, 'DEMO');
  assert.equal(xkItem.isDemo, true);

  // BUSINESS：demo 关闭全为线索；demo 开启后 JP 的演示商务签替代其线索并进入结果
  const businessOff = await search('type=BUSINESS');
  assert.equal(businessOff.total, 9);
  const businessOn = await search('type=BUSINESS&demo=1');
  assert.equal(businessOn.total, 9);
  const jpBusiness = businessOn.items.find(item => item.iso2 === 'JP');
  assert.ok(jpBusiness);
  assert.equal(jpBusiness.routeCode, 'JP-BUSINESS-DEMO-01');
  assert.equal(jpBusiness.isDemo, true);
  assert.equal(jpBusiness.dataStatus, 'DEMO');
  const demoBucket = businessOn.facets.statuses.find(bucket => bucket.code === 'DEMO');
  assert.equal(demoBucket?.count, 1);
  const mentionOnlyBucket = businessOn.facets.statuses.find(bucket => bucket.code === 'MENTION_ONLY');
  assert.equal(mentionOnlyBucket?.count, 8);
});

test('优先候选筛选 priority=1', async () => {
  const data = await search('priority=1');
  assert.equal(data.total, 2);
  assert.deepEqual(iso2List(data.items).sort(), ['GB', 'JP']);
  assert.ok(data.items.every(item => item.priority));
});

test('排序：name / stay_desc / completeness / relevance', async () => {
  const byName = await search('sort=name');
  assert.deepEqual(iso2List(byName.items), ['BR', 'FR', 'DE', 'JP', 'KE', 'SG', 'TH', 'GB', 'US']);

  const byStay = await search('sort=stay_desc');
  assert.deepEqual(iso2List(byStay.items), ['BR', 'GB', 'FR', 'JP', 'SG', 'US', 'DE', 'KE', 'TH']);
  assert.equal(byStay.items.at(-1)?.iso2, 'TH');
  assert.equal(byStay.items.at(-1)?.stayDays, null);

  const byCompleteness = await search('sort=completeness');
  assert.deepEqual(iso2List(byCompleteness.items), ['US', 'GB', 'DE', 'SG', 'FR', 'JP', 'BR', 'TH', 'KE']);

  // 空关键词时 relevance 退化为完整度排序（稳定）
  const byRelevance = await search('sort=relevance');
  assert.equal(byRelevance.items[0]?.iso2, 'US');
});

test('关键词：空格分词 AND；国家名/别名/同义词扩展', async () => {
  const japanese = await search(`q=${encodeURIComponent('日本')}`);
  assert.equal(japanese.total, 1);
  assert.equal(japanese.items[0]?.iso2, 'JP');
  assert.ok((japanese.items[0]?.score ?? 0) >= 1000);

  const english = await search('q=Japan');
  assert.equal(english.items[0]?.iso2, 'JP');

  const alias = await search(`q=${encodeURIComponent('大不列颠')}`);
  assert.equal(alias.total, 1);
  assert.equal(alias.items[0]?.iso2, 'GB');

  const uk = await search('q=UK');
  assert.equal(uk.total, 1);
  assert.equal(uk.items[0]?.iso2, 'GB');

  // 多词 AND：只有同时命中「日本」和「旅游」的 JP 政策
  const multi = await search(`q=${encodeURIComponent('日本 旅游')}`);
  assert.equal(multi.total, 1);
  assert.equal(multi.items[0]?.iso2, 'JP');

  // 关键词命中政策文本（summary 中的「申根」）
  const schengen = await search(`q=${encodeURIComponent('申根')}`);
  assert.deepEqual(iso2List(schengen.items).sort(), ['DE', 'FR']);
});

test('关键词：类别标签与同义词（免签 / 多词短语 / 类型代码）', async () => {
  const visaFree = await search(`q=${encodeURIComponent('免签')}`);
  assert.equal(visaFree.total, 2);
  assert.deepEqual(iso2List(visaFree.items).sort(), ['SG', 'TH']);

  const multiWord = await search(`q=${encodeURIComponent('visa free')}`);
  assert.equal(multiWord.total, 2);
  assert.deepEqual(iso2List(multiWord.items).sort(), ['SG', 'TH']);

  const businessType = await search(`q=${encodeURIComponent('商务签')}&type=BUSINESS`);
  assert.equal(businessType.total, 9);
  assert.ok(businessType.items.every(item => item.visaType === 'BUSINESS'));
});

test('分面标准语义：某维度忽略自身筛选', async () => {
  const noFilter = await search('');
  assert.equal(sum(noFilter.facets.regions), 9);
  assert.equal(sum(noFilter.facets.groups), 9);
  assert.equal(sum(noFilter.facets.categories), 9);
  assert.equal(sum(noFilter.facets.stays), 9);
  assert.equal(sum(noFilter.facets.statuses), 9);

  const byGroup = await search('group=FREE');
  assert.equal(byGroup.total, 2);
  // 忽略 group 自身 → 计入所有组，和 = 9
  assert.equal(sum(byGroup.facets.groups), 9);
  // 其他维度保留 group 过滤 → 和 = 2
  assert.equal(sum(byGroup.facets.regions), 2);
  assert.equal(sum(byGroup.facets.categories), 2);
  assert.equal(sum(byGroup.facets.stays), 2);

  const keyword = await search(`q=${encodeURIComponent('免签')}`);
  assert.equal(keyword.total, 2);
  const freeBucket = keyword.facets.groups.find(bucket => bucket.code === 'FREE');
  assert.equal(freeBucket?.count, 2);
  const arrivalBucket = keyword.facets.groups.find(bucket => bucket.code === 'ARRIVAL');
  assert.equal(arrivalBucket?.count, 0);

  // types 分面：count = 该类型下被覆盖的国家数（真实政策或线索）
  const types = await search('group=FREE');
  const tourismType = types.facets.types.find(bucket => bucket.code === 'TOURISM');
  assert.equal(tourismType?.count, 2);
  const businessTypeFacet = (await search('')).facets.types.find(bucket => bucket.code === 'BUSINESS');
  assert.equal(businessTypeFacet?.count, 9);
});

test('状态筛选与 statuses 分面', async () => {
  const mentionOnly = await search('type=BUSINESS&status=MENTION_ONLY');
  assert.equal(mentionOnly.total, 9);
  assert.equal(mentionOnly.facets.statuses.find(bucket => bucket.code === 'MENTION_ONLY')?.count, 9);

  const noSummary = await search('type=BUSINESS&status=SUMMARY_ONLY');
  assert.equal(noSummary.total, 0);

  const demoStatus = await search('type=BUSINESS&demo=1&status=DEMO');
  assert.equal(demoStatus.total, 1);
  assert.equal(demoStatus.items[0]?.routeCode, 'JP-BUSINESS-DEMO-01');

  const demoOff = await search('type=BUSINESS');
  assert.equal(demoOff.facets.statuses.length, 4);
  assert.ok(!demoOff.facets.statuses.some(bucket => bucket.code === 'DEMO'));
  const demoOn = await search('type=BUSINESS&demo=1');
  assert.equal(demoOn.facets.statuses.length, 5);
});

test('分页与 pageSize 上限，分页在排序后进行', async () => {
  const firstPage = await search('sort=name&pageSize=4&page=1');
  assert.equal(firstPage.pageSize, 4);
  assert.equal(firstPage.pageCount, 3);
  assert.deepEqual(iso2List(firstPage.items), ['BR', 'FR', 'DE', 'JP']);

  const secondPage = await search('sort=name&pageSize=4&page=2');
  assert.deepEqual(iso2List(secondPage.items), ['KE', 'SG', 'TH', 'GB']);

  const maxPageSize = await search('pageSize=96');
  assert.equal(maxPageSize.pageSize, 96);
  assert.equal(maxPageSize.items.length, 9);
  assert.equal(await searchStatus('pageSize=97'), 400);
  assert.equal(await searchStatus('pageSize=0'), 400);
  assert.equal(await searchStatus('status=BOGUS'), 400);
  assert.equal(await searchStatus('sort=BOGUS'), 400);
  assert.equal(await searchStatus('region=XX'), 400);
});

test('SQL 注入式关键词不报错且不扩大结果集', async () => {
  for (const payload of ["' OR 1=1 --", '%', '"; DROP TABLE countries; --', "%' OR '1'='1"]) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(payload)}`,
    });
    assert.equal(response.statusCode, 200, `关键词 ${payload} 不应导致 500`);
    const data = (response.json() as { data: SearchResponse }).data;
    assert.equal(data.total, 0, `关键词 ${payload} 不应扩大结果集`);
  }

  // "_" 必须按普通字符匹配（只命中编码中真的含下划线的类别）
  const underscoreResponse = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent('_')}`,
  });
  assert.equal(underscoreResponse.statusCode, 200);
  const underscoreData = (underscoreResponse.json() as { data: SearchResponse }).data;
  assert.ok(underscoreData.total > 0 && underscoreData.total < 9);
  assert.ok(underscoreData.items.every(item => item.categoryCode?.includes('_') ?? false));
});

test('matchedCountries 为筛选命中的国家去重集合', async () => {
  const data = await search('region=AS');
  assert.deepEqual([...data.matchedCountries].sort(), ['JP', 'SG', 'TH']);
  assert.equal(new Set(data.matchedCountries).size, data.matchedCountries.length);
});
