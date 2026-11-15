/**
 * Visa Atlas v1.0 · 地图几何构建脚本
 *
 * 命令：`npm run geo:build`（即 `tsx scripts/build-geo.ts`，可重复执行）
 *
 * 输入（全部来自本地依赖与仓库文件，不访问外网、不需要地图 Key）：
 *   - node_modules/world-atlas/countries-50m.json   Natural Earth 1:50m TopoJSON
 *   - node_modules/world-countries/countries.json    ccn3 → cca2 映射、缺失多边形的经纬度兜底
 *   - data/countries.json                            250 个国家/地区目录（含 XK）
 *   - data/source/global_249_countries_cn_passport_visa.csv  249 条真实采集范围
 *
 * 输出：
 *   - data/geo/world-paths.json  前端直接 import 的预投影几何（紧凑 JSON）
 *   - data/geo/REPORT.md         覆盖统计、映射失败清单、许可与生成说明
 *
 * 投影：d3-geo `geoEqualEarth`（等积、视觉均衡、经线不撕裂），
 *       fitExtent 到 1000×520 画布、四周留 12px 边距，球面整体居中。
 *       d3 的 geoPath 负责处理反经线切割（俄罗斯/斐济/美国等）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  geoArea,
  geoCentroid,
  geoEqualEarth,
  geoGraticule10,
  geoPath,
  type GeoPermissibleObjects,
} from 'd3-geo';
import type { Geometry, LineString, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';

/* ------------------------------------------------------------------ */
/* 配置                                                               */
/* ------------------------------------------------------------------ */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');

const WIDTH = 1000;
const HEIGHT = 520;
const PADDING = 12;
/** 国家路径保留 1 位小数（0.1px 精度），显著压缩 JSON 体积 */
const COUNTRY_DIGITS = 1;
const LINE_DIGITS = 2;

const PATHS = {
  topo: join(ROOT, 'node_modules/world-atlas/countries-50m.json'),
  worldCountries: join(ROOT, 'node_modules/world-countries/countries.json'),
  catalog: join(ROOT, 'data/countries.json'),
  csv: join(ROOT, 'data/source/global_249_countries_cn_passport_visa.csv'),
  outputJson: join(ROOT, 'data/geo/world-paths.json'),
  outputReport: join(ROOT, 'data/geo/REPORT.md'),
};

const FILE_SIZE_LIMIT = 1_600_000;

/**
 * 视觉锚点国家：rank 越小越先显示（低缩放时只显示 rank 靠前的几个）。
 * dx/dy 是在投影质心基础上的手工偏移（px），用于缓解欧洲/东南亚等密集区重叠；
 * 构建脚本最后还会做一次贪心防重叠，保证标签不互相压住。
 */
const LABEL_ANCHORS: { iso2: string; rank: number; dx?: number; dy?: number }[] = [
  { iso2: 'CN', rank: 1, dy: -6 },
  { iso2: 'US', rank: 2 },
  { iso2: 'BR', rank: 3 },
  { iso2: 'RU', rank: 4 },
  { iso2: 'AU', rank: 5 },
  { iso2: 'JP', rank: 6, dx: 14, dy: 2 },
  { iso2: 'GB', rank: 7, dx: -8, dy: -8 },
  { iso2: 'FR', rank: 8, dx: -6, dy: 12 },
  { iso2: 'DE', rank: 9, dx: 16, dy: -6 },
  { iso2: 'IN', rank: 10 },
  { iso2: 'CA', rank: 11 },
  { iso2: 'ES', rank: 12, dx: -6, dy: 18 },
  { iso2: 'IT', rank: 13, dx: 20, dy: 12 },
  { iso2: 'TR', rank: 14, dx: 8, dy: -2 },
  { iso2: 'AE', rank: 15, dx: 16, dy: 4 },
  { iso2: 'SA', rank: 16, dx: 8, dy: 10 },
  { iso2: 'TH', rank: 17, dx: 6, dy: 6 },
  { iso2: 'SG', rank: 18, dx: 24, dy: 14 },
  { iso2: 'KR', rank: 19, dx: 22, dy: -4 },
  { iso2: 'MX', rank: 20 },
  { iso2: 'ZA', rank: 21 },
  { iso2: 'EG', rank: 22, dx: 6, dy: 6 },
  { iso2: 'NZ', rank: 23 },
  { iso2: 'AR', rank: 24 },
];

/* ------------------------------------------------------------------ */
/* 类型                                                               */
/* ------------------------------------------------------------------ */

interface CatalogCountry {
  code: string;
  nameZh: string;
  nameEn: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

interface WorldCountry {
  cca2: string;
  ccn3: string;
  name: { common: string; official: string };
  latlng?: [number, number];
}

interface TopoGeometry {
  id?: string | number;
  type: string;
  arcs?: unknown;
  properties?: { name?: string } | null;
}

interface TopoGeographyObject {
  type: string;
  geometries: TopoGeometry[];
}

interface TopoTopology {
  type: string;
  objects: { countries: TopoGeographyObject };
  arcs: unknown[];
}

/** topojson-client `feature()` 输出的 GeoJSON Feature（只取本脚本需要的字段） */
interface MappedFeature {
  id?: string | number;
  properties?: { name?: string } | null;
  geometry: Geometry | null;
}

interface CountryPathEntry {
  iso2: string;
  path: string;
  area: number;
  cx: number;
  cy: number;
}

interface LabelEntry {
  iso2: string;
  x: number;
  y: number;
  nameZh: string;
  nameEn: string;
  rank: number;
}

interface ProjectionPoint {
  x: number;
  y: number;
}

interface MappingStats {
  features: number;
  matchedById: number;
  matchedByName: number;
  unmatchedFeatures: { name: string; reason: string }[];
  duplicateIso2: { iso2: string; names: string[] }[];
  labelFailures: string[];
  matchedIso2: Set<string>;
  catalogWithoutPolygon: string[];
  csvWithoutPolygon: string[];
  csvWithoutPoint: string[];
}

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 把 ccn3 / TopoJSON id 归一化成三位字符串（"36"、"036"、36 都对齐成 "036"） */
const numericCode = (value: string | number | undefined): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return text.padStart(3, '0');
};

/** 英文名归一化：去变音符号、标点、统一大小写，用于 id 缺失时的名后备匹配 */
const normalizeName = (value: string | undefined | null): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const formatPercent = (part: number, total: number): string =>
  total === 0 ? '0%' : `${((part / total) * 100).toFixed(1)}%`;

/* ------------------------------------------------------------------ */
/* 构建                                                               */
/* ------------------------------------------------------------------ */

function build(): void {
  const catalog = readJson<CatalogCountry[]>(PATHS.catalog);
  const worldCountries = readJson<WorldCountry[]>(PATHS.worldCountries);
  const topology = readJson<TopoTopology>(PATHS.topo);
  const csvCodes = readCsvCodes(PATHS.csv);

  const catalogByCode = new Map(catalog.map(country => [country.code, country]));
  const worldByCcn3 = new Map<string, WorldCountry>();
  const worldByCca2 = new Map<string, WorldCountry>();
  const worldByName = new Map<string, WorldCountry>();
  for (const country of worldCountries) {
    const ccn3 = numericCode(country.ccn3);
    if (ccn3) worldByCcn3.set(ccn3, country);
    worldByCca2.set(country.cca2, country);
    for (const name of [country.name.common, country.name.official]) {
      const key = normalizeName(name);
      if (key && !worldByName.has(key)) worldByName.set(key, country);
    }
  }

  // 极少数 TopoJSON 要素没有 id（Kosovo 等），用英文名后备匹配；其余显式别名表兜底。
  const NAME_ALIASES: Record<string, string> = {
    kosovo: 'XK',
  };

  const topoFeatures = topoToFeatures(topology);
  const stats: MappingStats = {
    features: topoFeatures.length,
    matchedById: 0,
    matchedByName: 0,
    unmatchedFeatures: [],
    duplicateIso2: [],
    labelFailures: [],
    matchedIso2: new Set<string>(),
    catalogWithoutPolygon: [],
    csvWithoutPolygon: [],
    csvWithoutPoint: [],
  };

  /** iso2 → 该国的 TopoJSON 要素（AU 有两个要素：Australia + Ashmore and Cartier Is.） */
  const featuresByIso2 = new Map<string, MappedFeature[]>();
  for (const geoFeature of topoFeatures) {
    const name = geoFeature.properties?.name ?? '';
    const byId = numericCode(geoFeature.id);
    const fromId = byId ? worldByCcn3.get(byId) : undefined;
    let matched: WorldCountry | undefined = fromId;
    let matchedByName = false;
    if (!matched) {
      const alias = NAME_ALIASES[normalizeName(name)];
      const worldByNameMatch = worldByName.get(normalizeName(name));
      matched = alias ? worldByCca2.get(alias) : worldByNameMatch;
      matchedByName = Boolean(matched);
    }
    if (!matched || !catalogByCode.has(matched.cca2)) {
      stats.unmatchedFeatures.push({
        name,
        reason: matched
          ? `ISO2 ${matched.cca2} 不在 250 国目录内`
          : `feature.id=${String(geoFeature.id ?? '缺失')}；英文名后备匹配失败，未找到对应目录国家`,
      });
      continue;
    }
    const iso2 = matched.cca2;
    if (fromId) stats.matchedById += 1;
    if (matchedByName) stats.matchedByName += 1;
    stats.matchedIso2.add(iso2);
    const list = featuresByIso2.get(iso2) ?? [];
    list.push(geoFeature);
    featuresByIso2.set(iso2, list);
  }
  for (const [iso2, features] of featuresByIso2) {
    if (features.length > 1) {
      stats.duplicateIso2.push({ iso2, names: features.map(item => item.properties?.name ?? '?') });
    }
  }

  /* ---------------- 投影与底图 path ---------------- */
  const projection = geoEqualEarth().fitExtent(
    [
      [PADDING, PADDING],
      [WIDTH - PADDING, HEIGHT - PADDING],
    ],
    { type: 'Sphere' } as unknown as GeoPermissibleObjects,
  );
  const project = (lonLat: [number, number]): ProjectionPoint => {
    const point = projection(lonLat);
    return point ? { x: point[0], y: point[1] } : { x: Number.NaN, y: Number.NaN };
  };
  const spherePath = geoPath(projection).digits(LINE_DIGITS)({ type: 'Sphere' } as unknown as GeoPermissibleObjects);
  const graticulePath = geoPath(projection).digits(LINE_DIGITS)(
    geoGraticule10() as unknown as GeoPermissibleObjects,
  );
  const equatorPath = geoPath(projection).digits(LINE_DIGITS)(
    lineString(-180, 180, 0) as unknown as GeoPermissibleObjects,
  );
  const primeMeridianPath = geoPath(projection).digits(LINE_DIGITS)(
    meridian(0) as unknown as GeoPermissibleObjects,
  );
  const countryPath = geoPath(projection).digits(COUNTRY_DIGITS);

  /* ---------------- 国家 path / 面积 / 质心 ---------------- */
  const countries: CountryPathEntry[] = [];
  const centroids: Record<string, [number, number]> = {};
  for (const [iso2, features] of featuresByIso2) {
    const pathParts: string[] = [];
    let area = 0;
    let largest: { polygon: Polygon; sphericalArea: number } | null = null;
    for (const item of features) {
      if (!item.geometry) continue;
      const rendered = countryPath(item.geometry as unknown as GeoPermissibleObjects);
      if (!rendered) continue;
      pathParts.push(rendered);
      area += countryPath.area(item.geometry as unknown as GeoPermissibleObjects);
      for (const polygon of polygonsOf(item.geometry)) {
        const sphericalArea = geoArea(polygon as unknown as GeoPermissibleObjects);
        if (!largest || sphericalArea > largest.sphericalArea) largest = { polygon, sphericalArea };
      }
    }
    if (!pathParts.length || !largest) continue;
    const projected = project(geoCentroid(largest.polygon as unknown as GeoPermissibleObjects));
    countries.push({
      iso2,
      path: pathParts.join(' '),
      area: round(area, 2),
      cx: round(clamp(projected.x, 2, WIDTH - 2), 2),
      cy: round(clamp(projected.y, 2, HEIGHT - 2), 2),
    });
  }
  countries.sort((a, b) => a.iso2.localeCompare(b.iso2));

  const pathByIso2 = new Map(countries.map(country => [country.iso2, country]));
  stats.catalogWithoutPolygon = catalog
    .map(country => country.code)
    .filter(code => !pathByIso2.has(code))
    .sort();

  /* ---------------- 250 国投影质心（多边形优先，缺失用经纬度） ---------------- */
  for (const country of catalog) {
    const polygonCountry = pathByIso2.get(country.code);
    if (polygonCountry) {
      centroids[country.code] = [polygonCountry.cx, polygonCountry.cy];
      continue;
    }
    const worldCountry = worldByCca2.get(country.code);
    const latlng = worldCountry?.latlng;
    if (!latlng || latlng.length !== 2) {
      // 目录本身带 latitude/longitude，但 latlng 字段才是世界国家库的权威值；再退一层。
      if (typeof country.longitude === 'number' && typeof country.latitude === 'number') {
        const point = project([country.longitude, country.latitude]);
        centroids[country.code] = [
          round(clamp(point.x, 2, WIDTH - 2), 2),
          round(clamp(point.y, 2, HEIGHT - 2), 2),
        ];
      }
      continue;
    }
    const point = project([latlng[1], latlng[0]]);
    centroids[country.code] = [
      round(clamp(point.x, 2, WIDTH - 2), 2),
      round(clamp(point.y, 2, HEIGHT - 2), 2),
    ];
  }

  /* ---------------- 视觉锚点标签 ---------------- */
  const labels = buildLabels(catalogByCode, centroids, stats);

  /* ---------------- CSV 覆盖校验 ---------------- */
  const csvSet = new Set(csvCodes);
  for (const code of csvCodes) {
    if (!pathByIso2.has(code)) stats.csvWithoutPolygon.push(code);
    if (!centroids[code]) stats.csvWithoutPoint.push(code);
  }
  const csvUnknown = csvCodes.filter(code => !catalogByCode.has(code));

  /* ---------------- 写出 JSON ---------------- */
  const payload = {
    projection: 'equal-earth' as const,
    width: WIDTH,
    height: HEIGHT,
    sphere: spherePath,
    graticule: graticulePath,
    equator: equatorPath,
    primeMeridian: primeMeridianPath,
    countries,
    centroids,
    labels,
    unmapped: stats.catalogWithoutPolygon,
  };
  mkdirSync(dirname(PATHS.outputJson), { recursive: true });
  const jsonText = JSON.stringify(payload);
  writeFileSync(PATHS.outputJson, jsonText, 'utf8');
  const jsonBytes = Buffer.byteLength(jsonText, 'utf8');

  /* ---------------- 写 REPORT.md ---------------- */
  const report = renderReport({
    stats,
    catalog,
    csvCodes,
    csvUnknown,
    labels,
    jsonBytes,
    countries,
    topoFeatures: topoFeatures.length,
    topoIds: topoFeatures.filter(item => numericCode(item.id) !== null).length,
  });
  writeFileSync(PATHS.outputReport, report, 'utf8');

  console.log('Visa Atlas geo build');
  console.log(`  TopoJSON 要素        : ${stats.features}（含 feature.id ${topoFeatures.filter(f => numericCode(f.id) !== null).length} 个）`);
  console.log(`  目录国家多边形       : ${countries.length} / ${catalog.length}`);
  console.log(`  仅点国家（unmapped） : ${stats.catalogWithoutPolygon.length} → ${stats.catalogWithoutPolygon.join(', ')}`);
  console.log(`  CSV 249 覆盖         : ${csvCodes.length - stats.csvWithoutPoint.length} / ${csvCodes.length}（有 path 或质心点）`);
  console.log(`  标签                 : ${labels.length} 个视觉锚点`);
  console.log(`  输出                 : ${PATHS.outputJson.replace(ROOT, '.')}（${jsonBytes} bytes，限制 ${FILE_SIZE_LIMIT}）`);
  if (jsonBytes > FILE_SIZE_LIMIT) {
    console.error(`  ✗ 几何文件超过体积上限 ${FILE_SIZE_LIMIT} bytes`);
    process.exitCode = 1;
  }
  if (csvUnknown.length) console.warn(`  ! CSV 中存在目录外代码: ${csvUnknown.join(', ')}`);
}

/* ------------------------------------------------------------------ */
/* 子步骤                                                             */
/* ------------------------------------------------------------------ */

function readCsvCodes(path: string): string[] {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const codes: string[] = [];
  for (const line of lines.slice(1)) {
    const code = line.split(',')[0]?.trim().toUpperCase();
    if (code && /^[A-Z]{2}$/.test(code)) codes.push(code);
  }
  return codes;
}

function topoToFeatures(topology: TopoTopology): MappedFeature[] {
  const collection = feature(
    topology as unknown as Parameters<typeof feature>[0],
    topology.objects.countries as unknown as Parameters<typeof feature>[1],
  ) as unknown as { features: MappedFeature[] };
  return collection.features;
}

function polygonsOf(geometry: Geometry): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry as Polygon];
  if (geometry.type === 'MultiPolygon') return (geometry as MultiPolygon).coordinates.map(coordinates => ({ type: 'Polygon', coordinates }));
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap(child => polygonsOf(child));
  }
  return [];
}

function lineString(lonStart: number, lonEnd: number, lat: number): LineString {
  const coordinates: [number, number][] = [];
  const step = lonStart <= lonEnd ? 2 : -2;
  for (let lon = lonStart; step > 0 ? lon <= lonEnd : lon >= lonEnd; lon += step) {
    coordinates.push([lon, lat]);
  }
  return { type: 'LineString', coordinates };
}

function meridian(lon: number): LineString {
  const coordinates: [number, number][] = [];
  for (let lat = -90; lat <= 90; lat += 2) coordinates.push([lon, lat]);
  return { type: 'LineString', coordinates };
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function buildLabels(
  catalogByCode: Map<string, CatalogCountry>,
  centroids: Record<string, [number, number]>,
  stats: MappingStats,
): LabelEntry[] {
  const anchors = [...LABEL_ANCHORS].sort((a, b) => a.rank - b.rank);
  const placed: (LabelEntry & { box: LabelBox })[] = [];
  for (const anchor of anchors) {
    const country = catalogByCode.get(anchor.iso2);
    const centroid = centroids[anchor.iso2];
    if (!country || !centroid) continue;
    const baseX = centroid[0] + (anchor.dx ?? 0);
    const baseY = centroid[1] + (anchor.dy ?? 0);
    // 依次尝试：默认位置 → 上下错位，直到不与已放标签重叠
    const offsets: [number, number][] = [
      [0, 0],
      [0, -14],
      [0, 14],
      [0, -28],
      [0, 28],
      [20, 0],
      [-20, 0],
      [0, -42],
      [0, 42],
    ];
    let chosen: LabelEntry | null = null;
    for (const [offsetX, offsetY] of offsets) {
      const candidate: LabelEntry = {
        iso2: anchor.iso2,
        x: round(clamp(baseX + offsetX, 26, WIDTH - 26), 1),
        y: round(clamp(baseY + offsetY, 14, HEIGHT - 14), 1),
        nameZh: country.nameZh,
        nameEn: country.nameEn,
        rank: anchor.rank,
      };
      const width = country.nameZh.length * 11 + 6;
      const height = 13;
      const box: LabelBox = {
        x1: candidate.x - width / 2,
        y1: candidate.y - height / 2,
        x2: candidate.x + width / 2,
        y2: candidate.y + height / 2,
      };
      const overlaps = placed.some(other => boxesOverlap(box, other.box, 4));
      if (!overlaps) {
        placed.push({ ...candidate, box });
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      stats.labelFailures.push(`${country.nameZh} / ${country.nameEn}（${anchor.iso2}）`);
    }
  }
  return placed
    .sort((a, b) => a.rank - b.rank)
    .map(({ box: _box, ...label }) => label);
}

function boxesOverlap(a: LabelBox, b: LabelBox, gap: number): boolean {
  return a.x1 - gap < b.x2 && b.x1 - gap < a.x2 && a.y1 - gap < b.y2 && b.y1 - gap < a.y2;
}

/* ------------------------------------------------------------------ */
/* REPORT.md                                                          */
/* ------------------------------------------------------------------ */

interface ReportInput {
  stats: MappingStats;
  catalog: CatalogCountry[];
  csvCodes: string[];
  csvUnknown: string[];
  labels: LabelEntry[];
  jsonBytes: number;
  countries: CountryPathEntry[];
  topoFeatures: number;
  topoIds: number;
}

function renderReport(input: ReportInput): string {
  const { stats, catalog, csvCodes, csvUnknown, labels, jsonBytes, countries, topoFeatures, topoIds } = input;
  const catalogCount = catalog.length;
  const polygonCount = countries.length;
  const csvCount = csvCodes.length;
  const csvPolygonCount = csvCount - stats.csvWithoutPolygon.length;
  const pointOnlyCatalog = stats.catalogWithoutPolygon;
  const nameOnly = catalog.filter(country => pointOnlyCatalog.includes(country.code));
  const catalogByCode = new Map(catalog.map(country => [country.code, country]));
  const unmappedFeatureLines = stats.unmatchedFeatures.length
    ? stats.unmatchedFeatures.map(item => `  - ${item.name}：${item.reason}`).join('\n')
    : '  - 无';
  const labelFailureLines = stats.labelFailures.length
    ? stats.labelFailures.map(item => `  - ${item}`).join('\n')
    : '  - 无（所有锚点均成功放置）';
  const duplicateLines = stats.duplicateIso2.length
    ? stats.duplicateIso2.map(item => `  - ${item.iso2}：${item.names.join(' + ')}（合并为一条 path）`).join('\n')
    : '  - 无';
  const pointOnlyLines = nameOnly.length
    ? nameOnly.map(country => `  - ${country.code} · ${country.nameZh} / ${country.nameEn}`).join('\n')
    : '  - 无';
  const labelLines = labels.map(label => {
    const country = catalogByCode.get(label.iso2);
    return `  ${label.rank}. ${label.iso2} · ${country?.nameZh ?? '?'}（${country?.nameEn ?? '?'}）@ (${label.x}, ${label.y})`;
  });
  const smallest = [...countries].sort((a, b) => a.area - b.area).slice(0, 12);

  return `# Visa Atlas · 世界地图几何构建报告

> 由 \`npm run geo:build\`（\`tsx scripts/build-geo.ts\`）自动生成，请勿手工编辑。
> 运行环境：Windows + Node.js（本仓库 \`engines.node >= 24\`），输入依赖版本锁定在 \`package.json\` / \`package-lock.json\`。

## 1. 生成方式

\`\`\`powershell
npm run geo:build
\`\`\`

- 输入几何：\`node_modules/world-atlas@2.0.2/countries-50m.json\`（Natural Earth 1:50m TopoJSON，241 个要素）
- ID 映射：\`world-atlas\` 要素的 \`id\` 是三位字符串形式的 ccn3（如 \`"036"\`），先用 \`world-countries@5.1.0\` 的 \`ccn3 → cca2\` 映射，再落到 \`data/countries.json\` 的 250 国目录；id 缺失的 5 个要素用英文名后备匹配（Kosovo → XK），其余 4 个（Somaliland、N. Cyprus、Indian Ocean Ter.、Siachen Glacier）不在目录中，忽略并记录在下方。
- 投影：\`d3-geo\` 的 **Equal Earth**（等积圆柱类投影，视觉上南北半球平衡、经线平滑）；\`fitExtent([[12,12],[988,508]], Sphere)\`，画布 1000×520，四周 12px 边距，球面整体居中。
- 路径精度：国家 path 保留 1 位小数（0.1px），经纬网/球面轮廓保留 2 位小数；这是文件体积与视觉质量的折中。
- 前端使用：\`client/features/map/WorldMap.tsx\` 直接 \`import\` 本文件，运行期不访问网络、不需要地图 Key。

## 2. 输出文件

| 项目 | 值 |
|---|---|
| 文件 | \`data/geo/world-paths.json\` |
| 大小 | ${jsonBytes.toLocaleString('en-US')} bytes（${(jsonBytes / 1024).toFixed(1)} KiB，上限 1,600,000 bytes） |
| 画布 | ${WIDTH} × ${HEIGHT} |
| 国家 path 数 | ${polygonCount} |
| 目录国家质心数 | ${catalogCount} / ${catalogCount}（全部目录代码） |
| 标签锚点 | ${labels.length} 个 |

> 结构说明：除约定字段 \`projection / width / height / sphere / graticule / countries / centroids / labels / unmapped\`
> 外，额外输出 \`equator\` 与 \`primeMeridian\` 两条 path，用于按设计规范把赤道 / 本初子午线画亮一点；
> 前端可选用，不读取也不影响兼容性。

## 3. 覆盖统计

| 指标 | 数量 | 说明 |
|---|---:|---|
| TopoJSON 总要素 | ${topoFeatures} | \`objects.countries.geometries\` |
| 带 \`feature.id\` 的要素 | ${topoIds} | 全部为三位 ccn3 字符串 |
| \`ccn3 → ISO2\` 直接映射成功 | ${stats.matchedById} 个要素 | 落在 250 国目录内 |
| 英文名后备匹配成功 | ${stats.matchedByName} 个要素 | Kosovo → XK |
| 映射失败/忽略的要素 | ${stats.unmatchedFeatures.length} | 见 3.3 |
| 目录国家有 polygon | ${polygonCount} / ${catalogCount}（${formatPercent(polygonCount, catalogCount)}） | 生成 path |
| 目录国家仅点渲染 | ${pointOnlyCatalog.length} / ${catalogCount} | 无 1:50m 多边形，用投影质心圆点 |
| CSV 249 国有 polygon | ${csvPolygonCount} / ${csvCount}（${formatPercent(csvPolygonCount, csvCount)}） | |
| CSV 249 国有 path 或质心点 | ${csvCount - stats.csvWithoutPoint.length} / ${csvCount}（${formatPercent(csvCount - stats.csvWithoutPoint.length, csvCount)}） | 测试守护项 |
| CSV 中目录外代码 | ${csvUnknown.length} | ${csvUnknown.length ? csvUnknown.join(', ') : '无'} |

### 3.1 仅点渲染的目录国家（无 1:50m 多边形）

${pointOnlyLines}

这些国家/地区在地图上以投影质心为圆心、半径 3.2px 的圆点 + 10px 透明点击热区渲染，点击仍会打开国家档案；hover 放大 1.5 倍并显示浮层。缺少独立多边形的原因是 Natural Earth 1:50m 的简化：一部分小岛/属地作为母国要素的一部分出现（如法属海外省、斯瓦尔巴与扬马延），另一部分因面积过小被直接省略（如布维岛、托克劳、图瓦卢）。

### 3.2 重复 ISO2 的 TopoJSON 要素

${duplicateLines}

### 3.3 映射失败/忽略的 TopoJSON 要素

${unmappedFeatureLines}

## 4. 前端阈值（与地图组件对齐）

- **微国家圆点**：无 polygon 的国家 + \`area < 20 px²\` 的多边形国家（如梵蒂冈、摩纳哥、新加坡等）在质心位置额外绘制圆点 + 10px 透明热区，避免点击不到；面积单位是 Equal Earth 投影后的 px²。圆点屏幕半径恒定为 3.2px（前端用 ResizeObserver 换算，不随舞台宽度伸缩），颜色在 category 模式跟随政策组、在 completeness 模式用薄荷绿强度，无资料国家用天空蓝兜底。
- **hover / selected**：hover 覆盖层在最后绘制（1.6px 类别色 / 薄荷绿描边 + 外发光 + 上浮），selected 覆盖层为金色 2px 描边 + 发光 + 质心脉冲点；两者都由前端 \`client/features/map/map.css\` 实现，本文件只提供几何与质心。
- 面积最小的 12 个已映射国家（用于校核阈值）：

${smallest.map(item => `  - ${item.iso2}：${item.area} px² @ (${item.cx}, ${item.cy})`).join('\n')}

- **selected 聚焦**：以 \`centroids\` 为焦点，缩放约 2.2×。质心规则：有 polygon 时取「面积最大的多边形」的球形质心再投影（避免俄罗斯/斐济等跨反经线国家质心落进大西洋），无 polygon 时用 \`world-countries\` 的 \`latlng\` 投影。
- **标签分级**：低缩放显示 rank ≤ 8（窄舞台自动降到 6），继续放大依次显示 rank ≤ 14 / 20 / 24（窄舞台为 12 / 18 / 24）；中文名字号按屏幕恒定为约 9.6px（非 SVG 用户单位），最多 ${labels.length} 个，避免遮挡。

## 5. 视觉锚点标签

${labelLines.join('\n')}

标签防重叠失败（构建时自动跳过）：
${labelFailureLines}

## 6. 数据许可与署名

- **几何数据**：\`world-atlas\` npm 包的 \`countries-*.json\` 由 **Natural Earth** 公共领域（public domain）数据构建；Natural Earth 不要求署名，但本项目保留来源说明。\`world-atlas\` 代码本身为 ISC 许可。
- **国家目录 / ccn3→ISO2 / 缺失国经纬度**：\`world-countries@5.1.0\`（<https://github.com/mledoze/countries>），**ODbL 1.0**。派生目录的再分发与公开使用须保留署名并遵守 ODbL 条款；完整许可见 \`data/LICENSE-ODbL.txt\`，项目内说明见 \`data/ATTRIBUTION.md\`。
- **本项目 250 国目录**：\`data/countries.json\`（由 world-countries 生成）+ \`data/source/global_249_countries_cn_passport_visa.csv\`（小组整理）。
- 地图几何**不是**国界法律结论；Natural Earth 的边界表示仅供示意，不表达任何领土主张。运行期无外网、无地图瓦片、无 Key。

## 7. 已知限制

1. 1:50m 分辨率下，微型国家与偏远小岛（见 3.1）没有独立多边形，只能以点渲染；贴近海岸线时点位置是「最大多边形/世界国家库中心点」的投影近似。
2. 俄罗斯、斐济、美国等跨反经线国家的 path 由 d3-geo 自动切割，投影后左右两段并存属正常现象；质心取「最大多边形」，不会落到大西洋。
3. 目录中 \`XK\`（科索沃）的 ISO2 不是 ISO 3166-1 官方代码，沿用 world-countries/项目目录约定；其 TopoJSON 要素无 id，由英文名后备匹配。
4. 标签位置在构建期做了一次基于 1000×520 基准的贪心防重叠；高缩放后自然拉开。字号与显隐由前端按缩放级别控制。
5. 文件体积目标是 < 1.6MB；若未来升级到 10m 分辨率或增加图层，需要重新评估体积（当前 ${(jsonBytes / 1024).toFixed(1)} KiB）。
`;
}

build();
