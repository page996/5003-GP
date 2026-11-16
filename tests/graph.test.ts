/**
 * 知识图谱优先检索测试：预置词必须解析到唯一实体并返回精确集合，
 * 避免「美国」命中摘要中提到美国的其他国别。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { SearchResponse } from '../shared/contracts.ts';
import { createTestContext, type TestContext } from './fixtures/harness.ts';

let ctx: TestContext;

before(async () => {
  ctx = await createTestContext({ dataset: 'real' });
});

after(async () => {
  if (ctx) await ctx.cleanup();
});

async function search(query: string): Promise<SearchResponse> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/search?type=TOURISM&pageSize=96&${query}`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { data: SearchResponse }).data;
}

test('「美国」图谱命中唯一国家，而不是提到美国的其他政策', async () => {
  const data = await search('q=' + encodeURIComponent('美国'));
  assert.equal(data.total, 1);
  assert.equal(data.items[0]?.iso2, 'US');
  assert.equal(data.graph?.matched[0]?.type, 'COUNTRY');
  assert.equal(data.graph?.matched[0]?.code, 'US');
});

test('「日本」与模糊「Japn」精确命中日本', async () => {
  for (const query of ['日本', 'Japn']) {
    const data = await search('q=' + encodeURIComponent(query));
    assert.equal(data.total, 1, query);
    assert.equal(data.items[0]?.iso2, 'JP', query);
    assert.equal(data.graph?.matched[0]?.type, 'COUNTRY', query);
  }
});

test('「免签」解析为免签政策组，返回全部免签国家', async () => {
  const data = await search('q=' + encodeURIComponent('免签'));
  assert.equal(data.graph?.matched[0]?.type, 'GROUP');
  assert.equal(data.graph?.matched[0]?.code, 'FREE');
  assert.ok(data.total >= 70, `免签国家数量异常：${data.total}`);
  assert.ok(data.items.every(item => item.group === 'FREE'));
});

test('「落地签」「电子签」解析为政策组，不因子类别交集漏掉同组国家', async () => {
  const arrival = await search('q=' + encodeURIComponent('落地签'));
  assert.equal(arrival.graph?.matched.length, 1);
  assert.equal(arrival.graph?.matched[0]?.code, 'ARRIVAL');
  assert.ok(arrival.total > 20);
  assert.ok(arrival.items.every(item => item.group === 'ARRIVAL'));

  const online = await search('q=' + encodeURIComponent('电子签'));
  assert.equal(online.graph?.matched.length, 1);
  assert.equal(online.graph?.matched[0]?.code, 'ONLINE');
  assert.ok(online.total > 35);
  assert.ok(online.items.every(item => item.group === 'ONLINE'));
});

test('「申根」解析为申根签证类别，返回申根国家', async () => {
  const data = await search('q=' + encodeURIComponent('申根'));
  assert.equal(data.graph?.matched[0]?.type, 'CATEGORY');
  assert.equal(data.graph?.matched[0]?.code, 'SCHENGEN_VISA');
  assert.ok(data.total >= 30);
  assert.ok(data.items.every(item => item.categoryCode === 'SCHENGEN_VISA'));
});

test('「商务签」解析为签证类型，返回 MENTION_ONLY 线索而不是伪造政策', async () => {
  const data = await search('q=' + encodeURIComponent('商务签'));
  assert.equal(data.graph?.matched[0]?.type, 'VISA_TYPE');
  assert.equal(data.graph?.matched[0]?.code, 'BUSINESS');
  assert.ok(data.total > 150);
  assert.ok(data.items.every(item => item.visaType === 'BUSINESS' && item.matchKind === 'MENTION_ONLY'));
});

test('「欧洲」「亚洲」解析为地区节点，结果全部属于该地区', async () => {
  const europe = await search('q=' + encodeURIComponent('欧洲'));
  assert.equal(europe.graph?.matched[0]?.type, 'REGION');
  assert.equal(europe.graph?.matched[0]?.code, 'EU');
  assert.ok(europe.total >= 40);
  assert.ok(europe.items.every(item => item.region === 'EU'));

  const asia = await search('q=' + encodeURIComponent('亚洲'));
  assert.equal(asia.graph?.matched[0]?.code, 'AS');
  assert.ok(asia.items.every(item => item.region === 'AS'));
});

test('普通自由文本不命中图谱时仍走原全文检索', async () => {
  const data = await search('q=' + encodeURIComponent('极光观测'));
  assert.equal(data.graph, undefined);
});
