/**
 * Visa Atlas v2.0 · 球体地图几何数据测试
 *
 * 守护 `npm run geo:build`（`scripts/build-globe-geo.ts`）生成的 `public/geo/*.geo.json`：
 * - 236 个多边形国家 + 14 个微国家点 = 250 个目录国家全覆盖
 * - iso2 唯一、id 与 properties.iso2 一致、properties 字段齐全
 * - center / bbox 合法（bbox 为 null 的跨反经线国家单独记录）
 * - 坐标 3 位小数、geometr 有效、经纬网非空、文件体积 < 3MB
 *
 * 运行：`npx tsx --test tests/globe.test.ts`（或 `npm test` 的 tests/*.test.ts 全量）
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_DIR = resolve(ROOT, 'public/geo');
const COUNTRIES_PATH = resolve(GEO_DIR, 'countries.geo.json');
const MICRO_PATH = resolve(GEO_DIR, 'microstates.geo.json');
const GRATICULE_PATH = resolve(GEO_DIR, 'graticule.geo.json');
const CATALOG_PATH = resolve(ROOT, 'data/countries.json');
const CSV_PATH = resolve(ROOT, 'data/source/global_249_countries_cn_passport_visa.csv');

const FILE_SIZE_LIMIT = 3_000_000;
/** 沿反经线 bbox 超过 300° 的国家，前端改用 center + zoom */
const EXPECTED_NO_BBOX = ['AQ', 'FJ', 'KI', 'NZ', 'RU', 'US'];
/** Natural Earth 1:50m 中无独立多边形的 14 个目录国家 */
const EXPECTED_MICRO = ['BQ', 'BV', 'CC', 'CX', 'GF', 'GI', 'GP', 'MQ', 'RE', 'SJ', 'TK', 'TV', 'UM', 'YT'];

interface CountryProperties {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: string;
  tone: number;
  center: [number, number];
  bbox: [number, number, number, number] | null;
}

interface MicroProperties {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: string;
  tone: number;
  center: [number, number];
  bbox: null;
}

interface GeoFeature<Properties> {
  type: 'Feature';
  id?: string;
  properties: Properties;
  geometry: { type: string; coordinates: unknown };
}

interface FeatureCollection<Properties> {
  type: 'FeatureCollection';
  features: GeoFeature<Properties>[];
}

interface CatalogCountry {
  code: string;
  nameZh: string;
  nameEn: string;
}

const countries = JSON.parse(readFileSync(COUNTRIES_PATH, 'utf8')) as FeatureCollection<CountryProperties>;
const micro = JSON.parse(readFileSync(MICRO_PATH, 'utf8')) as FeatureCollection<MicroProperties>;
const graticule = JSON.parse(readFileSync(GRATICULE_PATH, 'utf8')) as {
  type: string;
  geometry: { type: string; coordinates: unknown };
};
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as CatalogCountry[];
const catalogCodes = catalog.map(country => country.code);
const countryIds = countries.features.map(feature => feature.id ?? feature.properties.iso2);
const microIds = micro.features.map(feature => feature.id ?? feature.properties.iso2);

const validLng = (value: number): boolean => Number.isFinite(value) && value >= -180 && value <= 180;
const validLat = (value: number): boolean => Number.isFinite(value) && value >= -90 && value <= 90;
const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';

/** 递归收集 GeoJSON 所有坐标，校验 3 位小数与经纬度范围 */
function collectPositions(
  value: unknown,
  sink: [number, number][],
  checkRounded: boolean,
): void {
  if (!Array.isArray(value)) return;
  if (isPosition(value)) {
    const [lng, lat] = value;
    assert.ok(validLng(lng), `经度越界：${lng}`);
    assert.ok(validLat(lat), `纬度越界：${lat}`);
    if (checkRounded) {
      assert.equal(Math.round(lng * 1000) / 1000, lng, `经度未保留 3 位小数：${lng}`);
      assert.equal(Math.round(lat * 1000) / 1000, lat, `纬度未保留 3 位小数：${lat}`);
    }
    sink.push([lng, lat]);
    return;
  }
  for (const item of value as unknown[]) collectPositions(item, sink, checkRounded);
}

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

test('geo 文件存在、可解析且体积在上限内', () => {
  for (const [name, path] of [
    ['countries', COUNTRIES_PATH],
    ['microstates', MICRO_PATH],
    ['graticule', GRATICULE_PATH],
  ] as const) {
    const bytes = statSync(path).size;
    assert.ok(bytes > 0, `${name}.geo.json 不能为空`);
    assert.ok(bytes < FILE_SIZE_LIMIT, `${name}.geo.json 体积 ${bytes} 超过 ${FILE_SIZE_LIMIT}`);
  }
  assert.equal(countries.type, 'FeatureCollection');
  assert.equal(micro.type, 'FeatureCollection');
  assert.equal(graticule.type, 'Feature');
  assert.equal(graticule.geometry.type, 'MultiLineString');
});

test('236 个多边形国家 + 14 个微国家点覆盖 250 国目录', () => {
  assert.equal(countries.features.length, 236, '多边形国家数量应为 236');
  assert.equal(micro.features.length, 14, '微国家点数量应为 14');
  assert.equal(catalog.length, 250, '目录应为 250 国');
  assert.equal(countryIds.length + microIds.length, 250, '236 + 14 应覆盖 250 目录');
  assert.deepEqual([...microIds].sort(), EXPECTED_MICRO, '微国家清单应与 REPORT 一致');
  const missing = catalogCodes.filter(code => !countryIds.includes(code) && !microIds.includes(code));
  assert.deepEqual(missing, [], `以下目录国家没有几何：${missing.join(', ')}`);
  const unknown = [...countryIds, ...microIds].filter(code => !catalogCodes.includes(code));
  assert.deepEqual(unknown, [], `几何中出现目录外代码：${unknown.join(', ')}`);
});

test('CSV 249 个国家全部有 polygon 或圆点', () => {
  const csvCodes = readCsvCodes();
  assert.equal(csvCodes.length, 249);
  const covered = new Set([...countryIds, ...microIds]);
  const missing = csvCodes.filter(code => !covered.has(code));
  assert.deepEqual(missing, [], `CSV 国家缺少几何：${missing.join(', ')}`);
  assert.equal(csvCodes.filter(code => countryIds.includes(code)).length, 235);
  assert.equal(csvCodes.filter(code => microIds.includes(code)).length, 14);
});

test('iso2 唯一，Feature.id 与 properties.iso2 一致', () => {
  assert.equal(new Set(countryIds).size, 236, '多边形国家 iso2 不能重复');
  assert.equal(new Set(microIds).size, 14, '微国家 iso2 不能重复');
  for (const feature of countries.features) {
    assert.equal(feature.id, feature.properties.iso2, `${feature.properties.iso2} 的 Feature.id 不一致`);
  }
  for (const feature of micro.features) {
    assert.equal(feature.id, feature.properties.iso2, `${feature.properties.iso2} 的 Feature.id 不一致`);
  }
  const overlap = countryIds.filter(code => microIds.includes(code));
  assert.deepEqual(overlap, [], '同一国家不能同时出现在多边形与微国家中');
});

test('国家 properties 字段完整，center/bbox 合法', () => {
  const tones = new Set<number>();
  const noBbox: string[] = [];
  for (const feature of countries.features) {
    const properties = feature.properties;
    assert.match(properties.iso2, /^[A-Z]{2}$/);
    assert.ok(properties.nameZh.length > 0 && properties.nameEn.length > 0);
    assert.ok(typeof properties.region === 'string' && properties.region.length > 0);
    assert.ok(Number.isInteger(properties.tone) && properties.tone >= 0 && properties.tone <= 3, `${properties.iso2} tone 非法`);
    tones.add(properties.tone);
    assert.ok(isPosition(properties.center), `${properties.iso2} center 非法`);
    assert.ok(validLng(properties.center[0]) && validLat(properties.center[1]), `${properties.iso2} center 越界`);
    if (properties.bbox === null) {
      noBbox.push(properties.iso2);
    } else {
      assert.equal(properties.bbox.length, 4);
      const [west, south, east, north] = properties.bbox;
      assert.ok(validLng(west) && validLng(east), `${properties.iso2} bbox 经度越界`);
      assert.ok(validLat(south) && validLat(north), `${properties.iso2} bbox 纬度越界`);
      assert.ok(west < east, `${properties.iso2} bbox west 应小于 east`);
      assert.ok(south < north, `${properties.iso2} bbox south 应小于 north`);
      assert.ok(east - west <= 300, `${properties.iso2} bbox 跨度超过 300°，应记为 null`);
    }
    assert.ok(
      feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
      `${properties.iso2} geometry 类型应为 Polygon/MultiPolygon`,
    );
  }
  assert.deepEqual([...tones].sort(), [0, 1, 2, 3], '4 档 tone 应全部出现');
  assert.deepEqual(noBbox.sort(), EXPECTED_NO_BBOX, '无 bbox 国家清单应与 REPORT 一致（跨反经线）');
});

test('全部坐标保留 3 位小数且在经纬度范围内', () => {
  const positions: [number, number][] = [];
  for (const feature of countries.features) collectPositions(feature.geometry.coordinates, positions, true);
  for (const feature of micro.features) collectPositions(feature.geometry.coordinates, positions, true);
  assert.ok(positions.length > 5000, `坐标点数量异常：${positions.length}`);
});

test('微国家 features 为 Point，字段完整且与 center 一致', () => {
  for (const feature of micro.features) {
    assert.equal(feature.geometry.type, 'Point');
    const coordinates = feature.geometry.coordinates as [number, number];
    assert.ok(isPosition(coordinates));
    assert.deepEqual(coordinates, feature.properties.center, `${feature.properties.iso2} Point 与 center 不一致`);
    assert.ok(isPosition(feature.properties.center));
    assert.ok(validLng(coordinates[0]) && validLat(coordinates[1]));
    assert.ok(feature.properties.nameZh.length > 0 && feature.properties.nameEn.length > 0);
    assert.equal(feature.properties.bbox, null);
    assert.equal(feature.properties.tone >= 0 && feature.properties.tone <= 3, true);
  }
});

test('经纬网非空且坐标合法', () => {
  const positions: [number, number][] = [];
  collectPositions(graticule.geometry.coordinates, positions, false);
  assert.ok(positions.length > 100, `经纬网坐标点过少：${positions.length}`);
  // 10° 经纬网：至少包含多条横线与竖线
  const lines = graticule.geometry.coordinates as unknown[];
  assert.ok(Array.isArray(lines) && lines.length >= 30, `经纬网线数量过少：${lines.length}`);
});
