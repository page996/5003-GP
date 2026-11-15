/**
 * Visa Atlas v1.0 · 地图几何数据测试
 *
 * 守护 `npm run geo:build` 生成的 `data/geo/world-paths.json`：
 * - 250 个目录国家全部有投影质心（多边形质心优先，无多边形用世界国家库经纬度）
 * - 249 个 CSV 采集国家全部有 path 或兜底点
 * - unmapped 报告与实际缺失多边形一致
 * - path / 面积 / 标签 / 文件体积符合前端与报告约定
 *
 * 运行：`npx tsx --test tests/geo.test.ts`（或 `npm test` 的 tests/*.test.ts 全量）
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_PATH = resolve(ROOT, 'data/geo/world-paths.json');
const CATALOG_PATH = resolve(ROOT, 'data/countries.json');
const CSV_PATH = resolve(ROOT, 'data/source/global_249_countries_cn_passport_visa.csv');

/** 与 `scripts/build-geo.ts` 的 FILE_SIZE_LIMIT 对齐 */
const FILE_SIZE_LIMIT = 1_600_000;
const WIDTH = 1000;
const HEIGHT = 520;

interface GeoCountryEntry {
  iso2: string;
  path: string;
  area: number;
  cx: number;
  cy: number;
}

interface GeoLabelEntry {
  iso2: string;
  x: number;
  y: number;
  nameZh: string;
  nameEn: string;
  rank: number;
}

interface WorldGeoData {
  projection: string;
  width: number;
  height: number;
  sphere: string;
  graticule: string;
  countries: GeoCountryEntry[];
  centroids: Record<string, [number, number]>;
  labels: GeoLabelEntry[];
  unmapped: string[];
}

interface CatalogCountry {
  code: string;
  nameZh: string;
  nameEn: string;
}

const geo = JSON.parse(readFileSync(GEO_PATH, 'utf8')) as WorldGeoData;
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as CatalogCountry[];
const catalogCodes = catalog.map(country => country.code);
const catalogSet = new Set(catalogCodes);

const readCsvCodes = (): string[] => {
  const text = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const codes: string[] = [];
  for (const line of lines.slice(1)) {
    const code = line.split(',')[0]?.trim().toUpperCase();
    if (code && /^[A-Z]{2}$/.test(code)) codes.push(code);
  }
  return codes;
};

const csvCodes = readCsvCodes();
const pathByIso2 = new Map(geo.countries.map(entry => [entry.iso2, entry]));
const pathSet = new Set(geo.countries.map(entry => entry.iso2));

const inCanvas = (value: number, max: number): boolean => Number.isFinite(value) && value >= 0 && value <= max;

test('geo JSON 可解析且符合构建契约头部', () => {
  assert.equal(geo.projection, 'equal-earth', '投影必须与 REPORT 一致');
  assert.equal(geo.width, WIDTH);
  assert.equal(geo.height, HEIGHT);
  assert.equal(typeof geo.sphere, 'string');
  assert.ok(geo.sphere.startsWith('M') && geo.sphere.length > 20, '球面轮廓 path 不能为空');
  assert.equal(typeof geo.graticule, 'string');
  assert.ok(geo.graticule.length > 100, '经纬网 path 不能为空');
  assert.ok(!geo.sphere.includes('NaN') && !geo.graticule.includes('NaN'), 'path 中不能出现 NaN');
  assert.equal(typeof geo.centroids, 'object');
  assert.ok(Array.isArray(geo.countries) && geo.countries.length > 0);
  assert.ok(Array.isArray(geo.labels));
  assert.ok(Array.isArray(geo.unmapped));
});

test('data/countries.json 仍是 250 国目录', () => {
  assert.equal(catalog.length, 250);
  assert.equal(new Set(catalogCodes).size, 250, '目录 ISO2 不能重复');
  assert.ok(catalogSet.has('XK'), '目录应包含 XK（科索沃）');
});

test('250 个目录国家全部有投影质心', () => {
  assert.equal(Object.keys(geo.centroids).length, 250, 'centroids 必须覆盖全部 250 个目录国家');
  for (const code of catalogCodes) {
    const centroid = geo.centroids[code];
    assert.ok(Array.isArray(centroid) && centroid.length === 2, `${code} 缺少投影质心`);
    assert.ok(inCanvas(centroid[0], WIDTH), `${code} 质心 x 超出画布`);
    assert.ok(inCanvas(centroid[1], HEIGHT), `${code} 质心 y 超出画布`);
  }
});

test('249 个 CSV 采集中目的国全部有 path 或兜底点', () => {
  assert.equal(csvCodes.length, 249, 'CSV 应包含 249 个 ISO2');
  assert.equal(new Set(csvCodes).size, 249, 'CSV ISO2 不能重复');
  const missing: string[] = [];
  for (const code of csvCodes) {
    assert.ok(catalogSet.has(code), `CSV 国家 ${code} 不在 250 国目录中`);
    const hasPath = pathSet.has(code);
    const hasCentroid = Array.isArray(geo.centroids[code]);
    if (!hasPath && !hasCentroid) missing.push(code);
  }
  assert.deepEqual(missing, [], `以下 CSV 国家既无 path 也无兜底点：${missing.join(', ')}`);
  assert.equal(csvCodes.filter(code => pathSet.has(code)).length, 235, 'CSV 中有 polygon 的数量应为 235');
  assert.equal(csvCodes.filter(code => !pathSet.has(code)).length, 14, 'CSV 中仅点渲染的数量应为 14');
});

test('国家 path 均非空，且面积/质心元数据合法', () => {
  const seen = new Set<string>();
  for (const country of geo.countries) {
    assert.equal(typeof country.iso2, 'string');
    assert.ok(catalogSet.has(country.iso2), `${country.iso2} 不在 250 国目录中`);
    assert.ok(!seen.has(country.iso2), `${country.iso2} 出现重复 path`);
    seen.add(country.iso2);
    assert.ok(typeof country.path === 'string' && country.path.startsWith('M'), `${country.iso2} path 为空`);
    assert.ok(country.path.length > 10, `${country.iso2} path 过短`);
    assert.ok(!country.path.includes('NaN'), `${country.iso2} path 含 NaN`);
    assert.ok(Number.isFinite(country.area) && country.area >= 0, `${country.iso2} 面积非法`);
    assert.ok(inCanvas(country.cx, WIDTH), `${country.iso2} cx 超出画布`);
    assert.ok(inCanvas(country.cy, HEIGHT), `${country.iso2} cy 超出画布`);
    const centroid = geo.centroids[country.iso2];
    assert.ok(centroid, `${country.iso2} 有 polygon 但缺少质心`);
  }
  // 236 个目录国家在 world-atlas@2.0.2 的 1:50m 数据中有独立多边形（含 Kosovo 名后备匹配）
  assert.equal(geo.countries.length, 236, '有 polygon 的目录国家数量应为 236');
});

test('unmapped 报告与「有目录但无多边形」的实际情况一致', () => {
  const expected = catalogCodes.filter(code => !pathSet.has(code)).sort();
  assert.deepEqual([...geo.unmapped].sort(), expected, 'unmapped 必须等于目录中无 polygon 的国家集合');
  assert.equal(geo.unmapped.length, 14);
  assert.deepEqual(
    expected,
    ['BQ', 'BV', 'CC', 'CX', 'GF', 'GI', 'GP', 'MQ', 'RE', 'SJ', 'TK', 'TV', 'UM', 'YT'],
    '仅点渲染清单应与 REPORT.md 一致',
  );
  for (const code of geo.unmapped) {
    assert.ok(Array.isArray(geo.centroids[code]), `${code} 无 polygon 时必须提供兜底质心`);
    assert.ok(!pathSet.has(code), `${code} 不应同时出现在 countries 与 unmapped 中`);
  }
  assert.equal(geo.countries.length + geo.unmapped.length, 250, 'polygon 国家 + 仅点国家应覆盖 250 目录');
});

test('视觉锚点标签为 20–28 个，rank/x/y/名称合法', () => {
  assert.ok(geo.labels.length >= 20 && geo.labels.length <= 28, `标签数量 ${geo.labels.length} 超出 20–28`);
  const seenIso2 = new Set<string>();
  const seenRank = new Set<number>();
  const ranks = geo.labels.map(label => label.rank).sort((a, b) => a - b);
  assert.deepEqual(
    ranks,
    Array.from({ length: geo.labels.length }, (_, index) => index + 1),
    'rank 应从 1 开始连续递增',
  );
  for (const label of geo.labels) {
    assert.ok(catalogSet.has(label.iso2), `${label.iso2} 不在目录中`);
    assert.ok(pathSet.has(label.iso2), `标签 ${label.iso2} 必须有 polygon 才适合作为视觉锚点`);
    assert.ok(!seenIso2.has(label.iso2), `标签 ${label.iso2} 重复`);
    assert.ok(!seenRank.has(label.rank), `rank ${label.rank} 重复`);
    seenIso2.add(label.iso2);
    seenRank.add(label.rank);
    assert.ok(label.nameZh.length > 0 && label.nameEn.length > 0, `${label.iso2} 名称不能为空`);
    assert.ok(inCanvas(label.x, WIDTH), `${label.iso2} 标签 x 超出画布`);
    assert.ok(inCanvas(label.y, HEIGHT), `${label.iso2} 标签 y 超出画布`);
  }
});

test('几何文件体积低于前端可接受上限', () => {
  const bytes = statSync(GEO_PATH).size;
  assert.ok(bytes > 0, '几何文件不应为空');
  assert.ok(bytes < FILE_SIZE_LIMIT, `文件体积 ${bytes} 超过 ${FILE_SIZE_LIMIT} bytes`);
});
