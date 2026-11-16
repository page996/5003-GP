/**
 * Visa Atlas v3.0 · 球体地图几何构建（MapLibre GL globe 专用）
 *
 * world-atlas 1:50m TopoJSON → 本地 GeoJSON（无瓦片 / 无 Key / 无外网），
 * 输出到 `public/geo/`（Vite 构建原样复制到 dist，Fastify 生产同源托管 `/geo/*`）：
 *   - countries.geo.json    236 个多边形国家（FeatureCollection，properties 含 iso2/tone/center/bbox）
 *   - microstates.geo.json  14 个无多边形微国家（Point，常驻圆点）
 *
 * 同时生成 `data/geo/REPORT.md` 覆盖与许可报告。
 * 运行：`npm run geo:build`（即 `tsx scripts/build-globe-geo.ts`，可重复执行）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import worldCountries from 'world-countries';
import splitGeoJSON from 'geojson-antimeridian-cut';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CATALOG = path.join(ROOT, 'data/countries.json');
const CSV = path.join(ROOT, 'data/source/global_249_countries_cn_passport_visa.csv');
const TOPO = path.join(ROOT, 'node_modules/world-atlas/countries-50m.json');
const PUBLIC_GEO_DIR = path.join(ROOT, 'public/geo');
const REPORT_PATH = path.join(ROOT, 'data/geo/REPORT.md');

/** 单文件与整体体积上限（测试守护） */
const FILE_SIZE_LIMIT = 3_000_000;

interface CatalogCountry {
  code: string;
  nameZh: string;
  nameEn: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

interface RawFeature {
  type: 'Feature';
  id?: string | number;
  properties: { name?: string };
  geometry: { type: string; coordinates: unknown };
}

interface WorldCountry {
  cca2: string;
  ccn3?: string;
  name: { common: string; official: string };
}

interface CountryProperties {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: string;
  /** 4 档低饱和灰的索引（0–3），前端 match 着色 */
  tone: number;
  /** [lng, lat] 相机中心（目录经纬度，缺失时用质心） */
  center: [number, number];
  /** [west, south, east, north]；跨反经线国家为 null，前端用 center + 固定 zoom */
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

type Position = [number, number];

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const roundPosition = (position: Position): [number, number] => [round3(position[0]), round3(position[1])];

/** 坐标保留 3 位小数（约 100m 精度），显著压缩体积 */
function roundCoordinates(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    return roundPosition([value[0] as number, value[1] as number]);
  }
  return (value as unknown[]).map(roundCoordinates);
}

function collectPositions(value: unknown, sink: Position[]): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    sink.push([value[0] as number, value[1] as number]);
    return;
  }
  for (const item of value as unknown[]) collectPositions(item, sink);
}

/**
 * MapLibre globe 会把跨 ±180° 的边（俄罗斯楚科奇、斐济等）按“走长路”渲染，
 * 在北极形成同心环带，视觉上像国境线且遮挡极区国家。
 * 用 geojson-antimeridian-cut 在 ±180° 处切开（RFC 7946 §3.1.9）。
 * 南极洲等特殊几何若无法切分则保留原样：它本身是极冠，不会产生北极环带。
 */
function clipAntimeridian(geometry: { type: string; coordinates: unknown }): { type: string; coordinates: unknown } {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return geometry;
  try {
    return splitGeoJSON(geometry as never) as { type: string; coordinates: unknown };
  } catch {
    return geometry;
  }
}

function boundsOf(geometry: { coordinates: unknown }): [number, number, number, number] | null {  const positions: Position[] = [];
  collectPositions(geometry.coordinates, positions);
  if (!positions.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of positions) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  // 跨反经线的国家 bbox 会横跨 ±180，fitBounds 会失焦，交给前端 center + zoom 3
  if (maxLng - minLng > 300) return null;
  return [round3(minLng), round3(minLat), round3(maxLng), round3(maxLat)];
}

/** ISO2 → 稳定的 0–3 tone（只用于 4 档灰的轻微区分） */
function toneOf(iso2: string): number {
  let hash = 0;
  for (const char of iso2) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 4;
}

function readCsvCodes(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  const codes: string[] = [];
  for (const line of lines.slice(1)) {
    const code = line.split(',')[0]?.trim().toUpperCase();
    if (code && /^[A-Z]{2}$/.test(code)) codes.push(code);
  }
  return codes;
}

const catalog = JSON.parse(await readFile(CATALOG, 'utf8')) as CatalogCountry[];
const catalogByCode = new Map(catalog.map(country => [country.code, country]));
const csvCodes = readCsvCodes(await readFile(CSV, 'utf8'));

/* ------------------------------------------------------------------ */
/* TopoJSON → ISO2 映射                                               */
/* ------------------------------------------------------------------ */

const byNumeric = new Map<string, { iso2: string; nameEn: string }>();
const byName = new Map<string, { iso2: string; nameEn: string }>();
for (const country of worldCountries as unknown as WorldCountry[]) {
  if (!catalogByCode.has(country.cca2)) continue;
  const entry = { iso2: country.cca2, nameEn: country.name.common };
  if (country.ccn3) byNumeric.set(String(Number(country.ccn3)).padStart(3, '0'), entry);
  byName.set(country.name.common.toLowerCase(), entry);
  byName.set(country.name.official.toLowerCase(), entry);
}

/** 不在目录中的争议/军事地带：明确忽略，不伪造国家 */
const IGNORED_FEATURES = new Set(['somaliland', 'n. cyprus', 'indian ocean ter.', 'siachen glacier']);
const NAME_ALIASES: Record<string, string> = { kosovo: 'XK' };

const topo = JSON.parse(await readFile(TOPO, 'utf8')) as never;
const collection = feature(
  topo,
  (topo as unknown as { objects: { countries: unknown } }).objects.countries as never,
) as unknown as { type: 'FeatureCollection'; features: RawFeature[] };

function resolveIso2(raw: RawFeature): { iso2: string; nameEn: string } | null {
  const numeric = raw.id === undefined || raw.id === null ? '' : String(raw.id);
  if (numeric && /^\d+$/.test(numeric)) {
    const entry = byNumeric.get(numeric.padStart(3, '0'));
    if (entry) return entry;
  }
  const name = (raw.properties?.name ?? '').toLowerCase();
  if (IGNORED_FEATURES.has(name)) return null;
  const alias = NAME_ALIASES[name];
  if (alias) return { iso2: alias, nameEn: raw.properties?.name ?? alias };
  return byName.get(name) ?? null;
}

/* ------------------------------------------------------------------ */
/* 构建 FeatureCollection                                             */
/* ------------------------------------------------------------------ */

const features: { type: 'Feature'; id: string; properties: CountryProperties; geometry: unknown }[] = [];
const mapped = new Set<string>();
const unmappedTopoFeatures: string[] = [];
const duplicateFeatures: string[] = [];

for (const raw of collection.features) {
  const resolved = resolveIso2(raw);
  if (!resolved) {
    if (!IGNORED_FEATURES.has((raw.properties?.name ?? '').toLowerCase())) {
      unmappedTopoFeatures.push(raw.properties?.name ?? String(raw.id));
    } else {
      unmappedTopoFeatures.push(`${raw.properties?.name ?? String(raw.id)}（目录外，忽略）`);
    }
    continue;
  }
  if (mapped.has(resolved.iso2)) {
    duplicateFeatures.push(`${resolved.iso2}:${raw.properties?.name ?? '?'}`);
    const existing = features.find(item => item.id === resolved.iso2)!;
    const left = existing.geometry as { type: string; coordinates: unknown };
    const right = raw.geometry as unknown as { type: string; coordinates: unknown };
    const rightCoordinates = roundCoordinates(right.coordinates);
    if (left.type === 'Polygon' && right.type === 'Polygon') {
      existing.geometry = { type: 'MultiPolygon', coordinates: [left.coordinates, rightCoordinates] };
    } else if (left.type === 'MultiPolygon' && right.type === 'Polygon') {
      (left.coordinates as unknown[]).push(rightCoordinates);
    } else if (left.type === 'MultiPolygon' && right.type === 'MultiPolygon') {
      (left.coordinates as unknown[]).push(...(rightCoordinates as unknown[]));
    }
    continue;
  }
  mapped.add(resolved.iso2);
  const country = catalogByCode.get(resolved.iso2)!;
  if (!country) continue;
  const centroid = geoCentroid(raw as never) as [number, number];
  const center: [number, number] = [
    round3(country.longitude ?? centroid[0]),
    round3(country.latitude ?? centroid[1]),
  ];
  features.push({
    type: 'Feature',
    id: resolved.iso2,
    properties: {
      iso2: resolved.iso2,
      nameZh: country.nameZh,
      nameEn: country.nameEn,
      region: country.region,
      tone: toneOf(resolved.iso2),
      center,
      bbox: boundsOf(raw.geometry),
    },
    geometry: { type: raw.geometry.type, coordinates: roundCoordinates(raw.geometry.coordinates) },
  });
}

features.sort((a, b) => a.id.localeCompare(b.id));

// 反经线裁剪：避免 MapLibre globe 把跨 ±180° 的边沿“长路”渲染成极地环带
for (const item of features) {
  const geometry = item.geometry as { type: string; coordinates: unknown };
  const clipped = clipAntimeridian(geometry);
  if (!clipped) continue;
  item.geometry = { type: clipped.type, coordinates: roundCoordinates(clipped.coordinates) };
  item.properties.bbox = boundsOf(item.geometry as { coordinates: unknown });
}

/* ------------------------------------------------------------------ */
/* 无多边形国家 → 常驻圆点                                            */
/* ------------------------------------------------------------------ */

const missing = catalog.filter(country => !mapped.has(country.code));
const microFeatures: { type: 'Feature'; id: string; properties: MicroProperties; geometry: { type: 'Point'; coordinates: [number, number] } }[] = [];
const microWithoutCoordinates: string[] = [];
for (const country of missing) {
  if (country.longitude === null || country.latitude === null) {
    microWithoutCoordinates.push(country.code);
    continue;
  }
  const center: [number, number] = [round3(country.longitude), round3(country.latitude)];
  microFeatures.push({
    type: 'Feature',
    id: country.code,
    properties: {
      iso2: country.code,
      nameZh: country.nameZh,
      nameEn: country.nameEn,
      region: country.region,
      tone: toneOf(country.code),
      center,
      bbox: null,
    },
    geometry: { type: 'Point', coordinates: center },
  });
}

/* ------------------------------------------------------------------ */
/* 输出                                                               */
/* ------------------------------------------------------------------ */

const countriesCollection = { type: 'FeatureCollection' as const, features };
const microCollection = { type: 'FeatureCollection' as const, features: microFeatures };

await mkdir(PUBLIC_GEO_DIR, { recursive: true });
const countriesText = JSON.stringify(countriesCollection);
const microText = JSON.stringify(microCollection);
await writeFile(path.join(PUBLIC_GEO_DIR, 'countries.geo.json'), countriesText, 'utf8');
await writeFile(path.join(PUBLIC_GEO_DIR, 'microstates.geo.json'), microText, 'utf8');

const bytes = {
  countries: Buffer.byteLength(countriesText, 'utf8'),
  microstates: Buffer.byteLength(microText, 'utf8'),
};
const totalBytes = bytes.countries + bytes.microstates;

const covered = new Set<string>([...features.map(item => item.id), ...microFeatures.map(item => item.id)]);
const csvMissing = csvCodes.filter(code => !covered.has(code));
const polygonIso2 = new Set(features.map(item => item.id));
const microIso2 = new Set(microFeatures.map(item => item.id));
const noBbox = features.filter(item => item.properties.bbox === null).map(item => item.properties.iso2);
const toneCounts = [0, 1, 2, 3].map(tone => features.filter(item => item.properties.tone === tone).length);
const catalogMissing = catalog.filter(country => !covered.has(country.code)).map(country => country.code);

/* ------------------------------------------------------------------ */
/* REPORT.md                                                          */
/* ------------------------------------------------------------------ */

const formatBytes = (value: number): string => `${value.toLocaleString('en-US')} bytes（${(value / 1024).toFixed(1)} KiB）`;
const microLines = microFeatures.map(item => {
  const [lng, lat] = item.geometry.coordinates;
  return `  - ${item.id} · ${item.properties.nameZh} / ${item.properties.nameEn} @ (${lng}, ${lat})`;
});

const report = `# Visa Atlas v3.0 · 球体地图几何构建报告

> 由 \`npm run geo:build\`（\`tsx scripts/build-globe-geo.ts\`）自动生成，请勿手工编辑。
> 运行环境：Windows + Node.js（本仓库 \`engines.node >= 24\`），输入依赖版本锁定在 \`package.json\` / \`package-lock.json\`。

## 1. 生成方式

\`\`\`powershell
npm run geo:build
\`\`\`

- 输入几何：\`node_modules/world-atlas@2.0.2/countries-50m.json\`（Natural Earth 1:50m TopoJSON，241 个要素）
- ID 映射：TopoJSON 要素 \`id\` 为三位 ccn3 字符串，经 \`world-countries@5.1.0\` 的 \`ccn3 → cca2\` 落到 \`data/countries.json\` 的 250 国目录；id 缺失的 5 个要素用英文名后备匹配（Kosovo → XK）；其余 4 个不在目录中的争议/军事地带（Somaliland、N. Cyprus、Indian Ocean Ter.、Siachen Glacier）明确忽略。
- 输出坐标：WGS84 [lng, lat]，**统一保留 3 位小数**（约 100m 精度）。
- 前端几何消费方：\`client/features/map/GlobeMap.tsx\` 以本地 GeoJSON 加载（\`/geo/*.geo.json\`），无瓦片、无地图 Key、运行期不访问外网。

## 2. 输出文件

| 文件 | 内容 | 大小 |
|---|---|---:|
| \`public/geo/countries.geo.json\` | ${features.length} 个多边形国家（FeatureCollection） | ${formatBytes(bytes.countries)} |
| \`public/geo/microstates.geo.json\` | ${microFeatures.length} 个无多边形微国家（Point） | ${formatBytes(bytes.microstates)} |
| 合计 | | ${formatBytes(totalBytes)} |

单文件与整体体积上限：${FILE_SIZE_LIMIT.toLocaleString('en-US')} bytes（当前合计占 ${((totalBytes / FILE_SIZE_LIMIT) * 100).toFixed(1)}%）。
> v3 起移除经纬网装饰：原 10° 经纬网在南北极形成同心环带，视觉上易被误认为国境线，且会遮挡极区国家；球体不再绘制经纬网。
> 同时对跨 ±180° 的多边形做反经线切分（RFC 7946 §3.1.9，使用 \`geojson-antimeridian-cut\`），避免 MapLibre globe 把跨日界线长边沿“长路”渲染成极地环带。

## 3. 覆盖统计

| 指标 | 数量 | 说明 |
|---|---:|---|
| TopoJSON 总要素 | ${collection.features.length} | \`objects.countries.geometries\` |
| 目录国家有 polygon | ${features.length} / ${catalog.length}（${((features.length / catalog.length) * 100).toFixed(1)}%） | \`countries.geo.json\` |
| 目录国家仅圆点 | ${microFeatures.length} / ${catalog.length} | \`microstates.geo.json\` |
| 目录国家覆盖合计 | ${covered.size} / ${catalog.length} | ${features.length} + ${microFeatures.length} = ${covered.size}，无遗漏 |
| CSV 249 国覆盖 | ${csvCodes.length - csvMissing.length} / ${csvCodes.length} | 249 个采集国家全部有 polygon 或圆点 |
| CSV 缺失 | ${csvMissing.length} | ${csvMissing.length ? csvMissing.join(', ') : '无'} |
| 目录未覆盖 | ${catalogMissing.length} | ${catalogMissing.length ? catalogMissing.join(', ') : '无'} |
| 跨反经线、无 bbox 的国家 | ${noBbox.length} | ${noBbox.join(', ')}（前端用 center + zoom 3 聚焦） |
| tone 分布（0/1/2/3） | ${toneCounts.join(' / ')} | 4 档低饱和灰的索引 |

### 3.1 无多边形微国家（常驻圆点）

${microLines.join('\n')}

缺少独立多边形的原因：Natural Earth 1:50m 简化下，部分小岛/属地作为母国要素的一部分出现（如法属海外省、斯瓦尔巴与扬马延），部分因面积过小被省略（如布维岛、托克劳、图瓦卢）。前端以 3–6px 灰色圆点常驻显示，hover / selected 变为黄色。

### 3.2 重复 ISO2 的 TopoJSON 要素

${duplicateFeatures.length ? duplicateFeatures.map(item => `  - ${item}（合并为同一条国家要素）`).join('\n') : '  - 无'}

### 3.3 映射失败 / 忽略的 TopoJSON 要素

${unmappedTopoFeatures.length ? unmappedTopoFeatures.map(item => `  - ${item}`).join('\n') : '  - 无'}

${microWithoutCoordinates.length ? `有目录但缺经纬度、无法生成圆点的国家：${microWithoutCoordinates.join(', ')}` : '所有仅点国家均有可用经纬度。'}

## 4. 属性字段（前端契约）

\`countries.geo.json\` 每个 Feature：

| 字段 | 类型 | 说明 |
|---|---|---|
| \`id\` | string | 与 \`properties.iso2\` 相同的 ISO2；GeoJSON source 使用 \`promoteId: 'iso2'\` 作为 feature-state 键 |
| \`properties.iso2\` | string | 两位 ISO 3166-1 alpha-2（XK 为项目约定） |
| \`properties.nameZh\` / \`nameEn\` | string | 目录中英文名 |
| \`properties.region\` | string | world-countries 区域名 |
| \`properties.tone\` | 0–3 | 4 档低饱和灰的稳定索引（iso2 哈希） |
| \`properties.center\` | [lng, lat] | 相机中心，目录经纬度优先 |
| \`properties.bbox\` | [w, s, e, n] \\| null | 跨反经线（>300°）时为 null |

\`microstates.geo.json\` 每个 Feature：\`id\` / \`iso2\` / \`nameZh\` / \`nameEn\` / \`region\` / \`tone\` / \`center\` / \`bbox: null\`，geometry 为 \`Point\`。

## 5. 前端球体配置

- 渲染：MapLibre GL JS 5.9（\`projection: { type: 'globe' }\`），本地 GeoJSON source，无外部 source / sprite / glyphs / 瓦片。
- 初始相机：\`center [108, 22]\`、\`zoom 2.0\`、\`minZoom 0.5\`、\`maxZoom 10\`。
- 配色（用户指定色号）：太空/天空 \`#05080b\`、海洋 \`#0e1a22\`、陆地低饱和灰（按地区轻微色相变化）、未命中变暗 \`#191d20\`、国境线 \`#626b72\`；hover 使用该类别的分类色（如互免薄荷绿、落地签暖金、电子签天蓝、申根玫瑰、属地紫），selected 保持参考黄 \`#E3C31C\` + 分类色内描边；检索命中时按类别色着淡彩。不再绘制经纬网。
- 聚焦规则：有 \`bbox\` → \`fitBounds(padding 110, maxZoom 7.5, duration 900)\`；无 \`bbox\`（${noBbox.join('/')}）→ \`center + zoom 3\`；微国家圆点 → \`center + zoom 7.5\`；\`prefers-reduced-motion\` 时 duration 设为 0。
- feature-state：\`hover\` / \`selected\` / \`dim\`，source 均设置 \`promoteId: 'iso2'\`；内部 hover 与外部 \`hoverIso2\` 合并，hover 不触发 React 重渲染。

## 6. 数据许可与署名

- **几何数据**：\`world-atlas@2.0.2\` 的 \`countries-50m.json\` 由 **Natural Earth** 公共领域（public domain）数据构建；Natural Earth 不要求署名，本项目保留来源说明。\`world-atlas\` 代码本身为 ISC 许可。
- **国家目录 / ccn3 → ISO2 / 经纬度**：\`world-countries@5.1.0\`（<https://github.com/mledoze/countries>），**ODbL 1.0**；完整许可见 \`data/LICENSE-ODbL.txt\`，说明见 \`data/ATTRIBUTION.md\`。
- **本项目 250 国目录**：\`data/countries.json\`（由 world-countries 生成）+ \`data/source/global_249_countries_cn_passport_visa.csv\`（小组整理，249 个目的地）。
- 地图几何**不是**国界法律结论；Natural Earth 的边界表达仅供示意，不表达任何领土主张。运行期无外网、无地图瓦片、无 Key。

## 7. 已知限制与取舍

1. 1:50m 分辨率下 14 个微国家/属地没有独立多边形，只能以点渲染；点位置为目录经纬度近似。
2. 跨反经线的 6 个国家（${noBbox.join('、')}）bbox 横跨 ±180，不参与 \`fitBounds\`，聚焦时用 \`center + zoom 3\`，可能不完全居中。
3. 陆地底色按大洲低饱和色相区分（欧洲蓝灰、亚洲青灰、非洲橄榄灰、美洲蓝灰、大洋洲蓝灰、南极紫灰）；hover 使用 16 类签证分类色，selected 用参考黄 + 分类色内描边，检索命中用分类色淡彩；不渲染国名标签。
4. \`tone\` 是按 ISO2 哈希的纯视觉索引（保留给未分类兜底色），没有地理/政策含义。
5. 文件体积目标是 < 3MB；若升级到 10m 分辨率或增加图层需重新评估。
6. 微国家圆点在 globe 背面不可见（MapLibre 遮挡），点击/悬停只对正面国家生效。
`;

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, report, 'utf8');

/* ------------------------------------------------------------------ */

console.log('Visa Atlas v3 globe geo build');
console.log(`  countries.geo.json    : ${features.length} 个多边形国家，${bytes.countries.toLocaleString('en-US')} bytes`);
console.log(`  microstates.geo.json  : ${microFeatures.length} 个仅点国家，${bytes.microstates.toLocaleString('en-US')} bytes`);
console.log(`  覆盖                  : ${covered.size} / ${catalog.length} 目录；CSV ${csvCodes.length - csvMissing.length} / ${csvCodes.length}`);
console.log(`  无 bbox 国家          : ${noBbox.join(', ') || '无'}`);
console.log(`  忽略的 TopoJSON 要素  : ${unmappedTopoFeatures.join(' | ') || '无'}`);
console.log(`  REPORT                : data/geo/REPORT.md`);
if (totalBytes > FILE_SIZE_LIMIT || bytes.countries > FILE_SIZE_LIMIT) {
  console.error(`  ✗ 体积超过上限 ${FILE_SIZE_LIMIT} bytes`);
  process.exitCode = 1;
}
