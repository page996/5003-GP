# 前后端代码实现说明（v3.0）

> 对应第四轮反馈：**① 高亮色彩更丰富 ② 修复地球南北极环带 ③ 信息预留空位瘦身 ④ 汇报中给出前后端代码实现**。
> 本文摘录真正落地的代码位置与关键实现，便于答辩/验收时快速定位。完整源码在仓库中。

## 0. 技术与运行

| 层 | 实现 |
|---|---|
| 前端 | React 19 + TypeScript strict + Vite 6；MapLibre GL JS 5.9 球体投影 |
| 后端 | Fastify 5 + zod；SQLite（Node 24 内置 `node:sqlite`，默认）/ MySQL 8（mysql2，同构可选） |
| 数据 | CSV + 演示夹具 + 同义词 → ETL `dataset.json` → SQLite/MySQL |
| 地图几何 | `world-atlas` 1:50m → 构建期 GeoJSON；跨反经线切分；无底图瓦片/Key |
| 运行 | `npm run setup && npm run dev`（API 3001 + Web 5173）；生产 `npm run build && npm start` |

## 1. 前端：球体地图与高亮实现

### 1.1 分层样式与“多色高亮”（`client/features/map/GlobeMap.tsx`）

分类色来自共享契约的 16 类 `VISA_CATEGORIES`，不再写死单一黄色：

```ts
const CATEGORY_COLOR = new Map(VISA_CATEGORIES.map(category => [category.code, category.color]));
const GROUP_COLOR = new Map(POLICY_GROUPS.map(group => [group.code, group.color]));

/** 大洲低饱和灰底：未选中时也有轻微色相变化 */
const REGION_BASE: Record<RegionCode, string> = {
  EU: '#3a4148', AS: '#3c4244', AF: '#40433d',
  NA: '#394047', SA: '#3d433f', OC: '#37434a', AN: '#41414a',
};

const featureState = (key: string) => ['boolean', ['feature-state', key], false];
const categoryColorExpr = ['coalesce', ['get', 'categoryColor'], FALLBACK_ACCENT];
const matchColorExpr = ['coalesce', ['get', 'matchColor'], PALETTE.land[0]];

/** selected = 参考黄；hover = 分类色；未命中 = 深灰；命中 = 分类色淡彩；默认大洲灰 */
const landFillColor = [
  'case',
  featureState('selected'), PALETTE.selected,
  featureState('hover'), categoryColorExpr,
  featureState('dim'), PALETTE.dim,
  featureState('match'), matchColorExpr,
  baseColorExpr,
];
```

关键点：**hover / 命中 / 未命中都是 MapLibre `feature-state` + 表达式**，不在 React 状态里逐国改样式；运行时只同步状态：

```ts
const setFeatureStateSafe = (map, source, id, state) => {
  try { map.setFeatureState({ source, id }, state); } catch { /* 源未就绪时忽略 */ }
};
```

构建期把 API 返回的 `categoryCode/categoryColor/matchColor/baseColor` 合入 GeoJSON properties，避免每帧计算：

```ts
function decorateCountries(collection, countries) {
  const metaByIso = new Map(countries.map(country => [country.iso2, country]));
  for (const feature of collection.features) {
    const meta = metaByIso.get(feature.properties.iso2);
    const accent = categoryAccentOf(meta);
    feature.properties.categoryCode = meta?.categoryCode ?? null;
    feature.properties.categoryColor = accent;
    feature.properties.matchColor = matchTint(accent);
    feature.properties.baseColor = regionBaseColor(feature.properties.region);
  }
}
```

UI 侧同样使用分类色：搜索结果行类别徽章的分类色点、hover 卡片分类色点、抽屉分类色 chip。见 `SearchOverlay.tsx`、`App.tsx` 与 `CountrySheet.tsx`。

### 1.2 极区修复：移除经纬网 + 反经线切分

**原因**：原 10° 经纬网在南北极形成同心环带；同时 MapLibre globe 会把跨 ±180° 的边（如俄罗斯楚科奇）按“长路”渲染成环带，被误认为国境线，遮挡极区国家。

修复分两处：

1. 删除 `graticule.geo.json` 的生成、加载与 `line` 图层（`scripts/build-globe-geo.ts`、`GlobeMap.tsx` 的 `GEO_URLS`/`buildStyle`）；
2. 构建期做 RFC 7946 §3.1.9 反经线切分（`scripts/build-globe-geo.ts`）：

```ts
import splitGeoJSON from 'geojson-antimeridian-cut';

function clipAntimeridian(geometry) {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return geometry;
  try {
    return splitGeoJSON(geometry);       // 180° 处切成两块，避免 globe 长跨段
  } catch {
    return geometry;                     // 南极洲等极冠几何无法切分时保留原样
  }
}
```

第 7 步：构建后统一对全部 feature 切分并重算 bbox：

```ts
for (const item of features) {
  const clipped = clipAntimeridian(item.geometry);
  item.geometry = { type: clipped.type, coordinates: roundCoordinates(clipped.coordinates) };
  item.properties.bbox = boundsOf(item.geometry);
}
```

验收：`docs/screenshots/globe-pole.png`（北极视角）不再出现同心环带；俄罗斯/加拿大/格陵兰等极区国家完整显示；南极洲多边形正常。

### 1.3 搜索与地球联动（`client/App.tsx`）

300ms 防抖 + AbortController 取消旧请求；命中集合传给 GlobeMap 做 dim/match：

```ts
useEffect(() => {
  const timer = window.setTimeout(() => setDebouncedText(searchText.trim()), 300);
  return () => window.clearTimeout(timer);
}, [searchText]);

useEffect(() => {
  if (!queryActive) { setSearchResponse(null); return; }
  const controller = new AbortController();
  setSearchLoading(true);
  fetchSearch(query, controller.signal)
    .then(data => { if (!controller.signal.aborted) { setSearchResponse(data); setSearchLoading(false); } })
    .catch(error => { if (!controller.signal.aborted && !isAbortError(error)) { setSearchError(toApiError(error)); setSearchLoading(false); } });
  return () => controller.abort();
}, [query, queryActive, searchRetry]);

const matched = useMemo<Set<string> | null>(
  () => (queryActive && searchResponse ? new Set(searchResponse.matchedCountries) : null),
  [queryActive, searchResponse],
);
```

搜索到明确国家时自动飞行、并把目标国设为参考黄选中；宽筛选（免签/欧洲）只做变暗，不强制拉镜头。悬浮卡采用 **280/2500ms 双定时器**，鼠标移向卡片时卡片不消失、不追鼠标。

### 1.4 搜索结果行（`client/features/search/SearchOverlay.tsx`）

```tsx
{row.categoryLabel ? (
  <span className="va-search-row__badge">
    <i className="va-search-row__dot" style={{ background: categoryColor(row.categoryCode) }} />
    {row.categoryLabel}
  </span>
) : row.isMention ? <span className="va-search-row__badge is-hint">类型线索</span> : null}
```

本地模糊建议（`fuzzy.ts`）覆盖 250 国中英文名/ISO/别名；后端结果行 `data-testid="result-row"` 供 E2E 定位，hover 行回传 `onHoverCountry` 同步地球。

### 1.5 抽屉瘦身（`client/features/details/CountrySheet.tsx`）

只渲染可规模化采集字段：

```tsx
<div className="va-sheet__meta">
  <span className="va-chip va-chip--accent" style={{ color: accent }}>{categoryText}</span>
  <span className="va-chip">{stayText}</span>
  <span className="va-chip">{entryScopeLabel(mainPolicy.entryScope)}</span>
  {priority ? <span className="va-chip va-chip--gold">重点候选</span> : null}
</div>
<p className="va-sheet__conclusion">{conclusion}</p>
{summary ? <p className="va-sheet__excerpt">{summary}</p> : null}
<div className="va-sheet__footer">
  …其他常见签证类型 chips + 来源 + 路线编号 + 免责声明
</div>
```

已删除：展开/收起状态、完整度环、费用/材料/审核时间三宫格、演示明细、所有「待采集」占位。`App.tsx` 不再保存 `sheetExpanded`，抽屉只请求一次 `fetchCountry(iso2, false)`。

## 2. 后端：API、检索与数据库

### 2.1 路由与错误/缓存

`server/api/index.ts` 注册 health / overview / search / suggest / countries；`server/api/search.ts` 只做参数解析与调用服务：

```ts
app.get('/api/v1/search', async (request): Promise<{ data: SearchResponse }> => {
  const query = parseSearchQuery(request.query);
  return { data: await search(deps.db, query) };
});
```

`server/api/query.ts` 用 zod + 枚举白名单校验 `type/region/group/category/stay/status/sort/page/pageSize`，非法值 400 且 details 指字段；`server/app.ts` 统一 `{data}` / `{error:{code,message,details?}}`、`Cache-Control: no-store`、速率限制 240 次/分钟、生产静态托管与 SPA 回退。

### 2.2 检索 SQL 与服务层（`server/services/search.ts`）

对象是「国家 × 签证类型」；真实政策优先，无真实政策但有类型线索时返回 `MENTION_ONLY`，`demo=1` 才纳入演示：

```ts
let policyWhere = 'p.is_visible = 1';
if (options.type !== null) { policyWhere += ' AND p.visa_type = ?'; params.push(options.type); }
policyWhere += ' AND (p.is_demo = 0 OR (? = 1 AND p.is_demo = 1))';
params.push(demoFlag);
// 同一国家同一类型存在真实政策时，不取演示政策
policyWhere +=
  ' AND (p.is_demo = 0 OR NOT EXISTS (SELECT 1 FROM visa_policies r ' +
  'WHERE r.country_code = p.country_code AND r.visa_type = p.visa_type AND r.is_demo = 0 AND r.is_visible = 1))';
```

- 关键词按空格分词后 AND，每词命中 `name_zh/name_en/iso2/aliases/summary/search_text/raw_text/category_*/visa_type_*` 任一；同义词表扩展（`services/synonyms.ts`）。
- 全部过滤在 SQL 完成；分面计数用“忽略自身维度”的标准语义；排序在服务层（相关度/名称/停留期/完整度）稳定计算。
- 响应契约由 `shared/contracts.ts` 统一，前后端共享类型。

### 2.3 数据库（`database/schema.sql` / `database/schema.mysql.sql`）

15 张表 + 2 视图，关键设计：

```sql
CREATE TABLE countries (
  iso2 TEXT PRIMARY KEY CHECK (length(iso2) = 2),
  name_zh TEXT NOT NULL, name_en TEXT NOT NULL,
  region_code TEXT NOT NULL REFERENCES regions(code),
  aliases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)),
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  …
);

CREATE TABLE visa_policies (
  route_code TEXT PRIMARY KEY,          -- 稳定主键：国家-用途-手续
  country_code TEXT NOT NULL REFERENCES countries(iso2),
  visa_type TEXT NOT NULL REFERENCES visa_types(code),
  category_code TEXT REFERENCES visa_categories(code),
  stay_days INTEGER, stay_unit TEXT, stay_rule TEXT,
  data_status TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
  completeness INTEGER NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  …
);
```

视图 `v_country_map`（地图着色/统计）与 `v_policy_cards`（卡片字段统一）；索引覆盖 `(country_code, visa_type, is_visible)`、`(visa_type, is_visible, is_demo)`、`category_code`、`stay_days`、`data_status`；SQLite 与 MySQL schema 同构（测试校验列名一致）。

### 2.4 ETL 与可替换数据（`scripts/etl.ts`）

CSV → 分类归一化 → 停留期/入境次数抽取 → 类型线索 → `dataset.json`（数据库唯一种子）：

```ts
const canonical = RAW_CATEGORY_MAP[row.rawCategory];   // 76 种原始分类 → 16 类
const category = categoryByCode.get(canonical);
const stay = parseStay(row.description, row.rawCategory);
const mentionTypes = parseMentionTypes(row.otherTypes);

policies.push({
  routeCode: row.routeCode, countryCode: row.iso2, visaType: 'TOURISM',
  categoryCode: canonical, summary: row.description || null,
  stayDays: stay.days, stayUnit: stay.unit, stayRule: stay.rule,
  entryScope, dataStatus: 'SUMMARY_ONLY', completeness, isDemo: false,
  …
});
```

未来替换数据只需替换 `data/source/` 并通过 `npm run data:build && npm run db:rebuild` 重放；前端/API 契约不变。

## 3. 构建期地球几何（`scripts/build-globe-geo.ts`）

- 输入 `world-atlas/countries-50m.json`，用 `world-countries` 的 `ccn3 → cca2` 映射到 250 国目录；目录外争议地带忽略并记录；
- 输出 `public/geo/countries.geo.json`（236 多边形）、`microstates.geo.json`（14 点）；坐标统一 3 位小数；
- 每个 feature 带 `iso2/nameZh/nameEn/region/tone/center/bbox`，并对跨反经线多边形切分；
- 运行期由 `GlobeMap.tsx` fetch 本地文件，无外部请求/Key；`promoteId: 'iso2'` 让 feature-state 与国家 id 对齐；
- 依据/许可与覆盖报告见 `data/geo/REPORT.md`。

## 4. 验收结果（v3.0 本机）

| 项目 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | 0 errors（strict） |
| Node 测试 | `npm test` | 78 tests / 76 pass / 0 fail / 2 skip（未配置 MySQL） |
| 地球几何 | `npm run geo:build` + `tests/globe.test.ts` | 236 多边形 + 14 点；250/250 覆盖；9/9 通过（含无经纬网、反经线切分断言） |
| 浏览器 E2E | `npm run e2e` | 21/21 通过，0 console error / 0 pageerror |
| 截图 | `npm run screenshots` | 8 张（含极地视角） |
| 生产构建 | `npm run build` + `npm start` | 通过；同源页面/API/GeoJSON 可访问 |

完整命令与截图见 [VERIFICATION.md](VERIFICATION.md)。

## 5. 第四轮反馈 ↔ 代码对照

| 反馈 | 实现位置 |
|---|---|
| 高亮色彩更丰富 | `GlobeMap.tsx` 的 `CATEGORY_COLOR/GROUP_COLOR/REGION_BASE` 与 `landFillColor`/描边/微国家表达式；`SearchOverlay.tsx` 分类色点；`CountrySheet.tsx` 分类色 chip；`App.tsx` hover 卡片分类色点 |
| 南北极环带 | `scripts/build-globe-geo.ts` 移除经纬网 + `clipAntimeridian`；`GlobeMap.tsx` 移除 graticule 源/图层；`tests/globe.test.ts` 守护 |
| 信息预留空位瘦身 | `CountrySheet.tsx` 精简布局；`App.tsx` 删除 `sheetExpanded`；`styles.css` 仅保留精简抽屉用到的样式 |
| 前后端代码实现 | 本文；另见 README 文档索引 |
