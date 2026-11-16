# 前后端技术栈与架构说明（v5.0）

> 按第四轮反馈第 4 点：这里只说明**语言、框架和架构分工**，不展开逐行代码。具体实现见源码与 [VERIFICATION.md](VERIFICATION.md)。

## 1. 总体架构

```
┌────────────────────────────── 浏览器（桌面 Web） ──────────────────────────────┐
│  React 19 + TypeScript + Vite 6                                               │
│  ├─ MapLibre GL JS 5.24：globe 投影、交互、feature-state 着色              │
│  ├─ SearchOverlay：预置词 / 本地模糊建议 / 后端结果 / 图谱命中解释              │
│  ├─ CountrySheet：精简版国家签证抽屉                                          │
│  ├─ i18n.tsx：中英文 UI 字典、切换按钮、字典标签本地化                         │
│  └─ CSS：深色玻璃 UI、语义色图例、装饰性轨道/角标                               │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ HTTP JSON（同源 /api/v1/*）
┌───────────────────────────────▼───────────────────────────────────────────────┐
│  Fastify 5 + Node.js 24 + TypeScript + zod                                    │
│  ├─ API 层：health / overview / search / suggest / countries / route           │
│  ├─ 知识图谱：国家-地区-政策组-类别-签证类型节点 + 别名/同义词边，图谱优先检索    │
│  ├─ 检索服务：SQL 过滤/分面/分页 + 图谱精确集合 + 相关度排序                    │
│  └─ 数据访问层：SQLite（默认，node:sqlite）/ MySQL 8（mysql2，同构）            │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────────────────────┐
│  数据与构建                                                                    │
│  ├─ CSV + 演示夹具 + 同义词 → scripts/etl.ts → data/generated/dataset.json    │
│  ├─ dataset.json → scripts/db-seed.ts → SQLite / MySQL                        │
│  └─ world-atlas → scripts/build-globe-geo.ts → public/geo/*.geo.json          │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 前端（React + TypeScript + Vite + MapLibre）

| 模块 | 职责 |
|---|---|
| `client/App.tsx` | 页面状态编排：overview、搜索防抖、图谱结果、地图选中/悬停、国家抽屉、重置视角 |
| `client/features/map/GlobeMap.tsx` | MapLibre globe；政策组语义色、hover/selected/focus/dim/match 的 feature-state；拖拽/缩放/飞行聚焦；微国家点；180° 海洋接缝同色覆盖 |
| `client/features/search/SearchOverlay.tsx` | 8 个预置词、本地模糊建议、后端结果、**图谱命中提示**、键盘导航 |
| `client/features/details/CountrySheet.tsx` | 精简抽屉：类别/停留/入境/摘要/其他类型线索/来源 |
| `client/features/search/fuzzy.ts` | 250 国中英文名/ISO/别名的本地容错匹配 |
| `client/i18n.tsx` | 中英文 UI 字典、LanguageProvider、localStorage 持久化、字典/停留期本地化 |
| `client/styles.css` | 深色玻璃设计系统、语义色图例、轨道/角标/微光装饰、响应式 |

前端不依赖任何外部地图 Key/瓦片/在线 API；地图 GeoJSON 在构建期生成并由 Vite 随静态资源提供。

## 3. 后端（Fastify + TypeScript）

| 层 | 职责 |
|---|---|
| API 路由 | `/api/health`、`/api/v1/overview`、`/api/v1/search`、`/api/v1/suggest`、`/api/v1/countries/:iso2`、`/api/v1/route/:routeCode` |
| 参数校验 | zod + 枚举白名单；统一错误信封 `{error:{code,message,details?}}`；`no-store`、限流 |
| 知识图谱服务 | 国家/地区/政策组/类别/签证类型节点；别名、政策、类型线索、同义词构成边；把查询解析为图谱实体→精确国家/类型约束 |
| 检索服务 | SQL 完成筛选、分面、分页；图谱命中时按实体集合精确返回，未命中才回退全文检索；服务层相关度排序 |
| 数据访问 | SQLite 与 MySQL 同构 schema；15 表 + 2 视图；参数化查询、视图统一地图/卡片字段 |
| ETL | CSV + 演示夹具 + 同义词合并为唯一 `dataset.json`，可重放；未来换数据不改前端/API |

### 知识图谱检索流程

1. 查询词先做归一化与别名/同义词匹配（中英文、别称、ISO、业务同义词）；
2. 命中「国家 / 地区 / 政策组 / 类别 / 签证类型」节点后，沿图谱边取精确国家集合（如 欧洲→EU 国家；免签→FREE 政策组；申根→SCHENGEN_VISA 类别；商务签→BUSINESS 类型线索）；
3. 未命中实体才回退原有全文 SQL 检索；
4. 检索响应附带可解释的 `graph` 元数据（命中实体与路径），前端显示「知识图谱 · 国家·美国」；
5. 因此「美国」只返回美国，不再把摘要里提到美国签证的其他国家混进结果。

## 4. 数据与数据库

- 主数据：249 条真实旅游签政策 + 250 国目录（`XK` 未采集）。
- 词典：76 种原始分类归一化为 16 类 / 5 个政策组；569 条其他签证类型线索；351 条检索同义词。
- 表：`countries`、`visa_policies`、`visa_categories`、`policy_groups`、`mentioned_visa_types`、`search_synonyms`、来源/批次、明细扩展表等；视图 `v_country_map`、`v_policy_cards`。
- 演示数据 22 条只作为后端回归夹具，不进入 v5 UI。

## 5. 运行方式

```powershell
npm install
npm run setup       # ETL → 地图几何 → SQLite 初始化/导入
npm run dev         # API :3001 + Web :5173
npm run build; npm start   # 生产模式 :3001
```

当前开发地址：<http://127.0.0.1:5173>。

## 6. 验收摘要

- `npx tsc --noEmit`：0 errors（strict）
- `npm test`：全部通过（含图谱精确检索、反经线切分、无经纬网断言）
- `npm run e2e`：全部通过，0 console error / 0 pageerror
- `npm run build`：通过；生产模式同源 API/GeoJSON 可访问
- 截图：`docs/screenshots/`（含 `globe-pole.png` 极区验证、`graph-search.png` 图谱检索）
