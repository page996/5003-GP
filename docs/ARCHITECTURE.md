# Visa Atlas v4.0 · 系统架构

> 本文件描述本轮「真实数据 + 极简地球交互」重构后的架构。旧版 base 说明已被本文件与根目录 README 取代；v1 三栏 UI 已归档到 `docs/legacy-base/`。
> 状态：可运行的课程项目，不是官方签证数据库；资料来自小组整理的 CSV，未经使领馆逐条确认。

## 1. 一句话目标

以**中国普通护照持有人的旅游签/免签/落地签政策**为第一份真实数据，做出一套「可拨动地球探索 + 预置词/模糊搜索 + 国家签证抽屉」的桌面 Web 全栈系统；数据库、API、前端字段一次到位，未来补采商务/留学/工作等类型时**只换数据、不改代码**。界面收敛为「一个地球 + 一个搜索框」，筛选与查询都通过交互完成。

## 2. 数据链路

```
data/source/global_249_countries_cn_passport_visa.csv   小组整理的 249 个目的地原始 CSV
            │
            ├─ scripts/etl.ts            解析、分类归一化、停留期/入境次数抽取、完整度评分
            │   data/source/demo-details.json   22 条「演示明细」样本（虚构，标记 is_demo=1）
            │   data/source/synonyms.json       检索同义词（英国/UK、免签/visa free…）
            ▼
data/generated/dataset.json     单一可审查的中间产物（schema 见 shared/dataset.ts）
data/generated/report.json      ETL 质量报告（分类分布、未知停留期、可疑行）
            │
            ├─ scripts/db-seed.ts        SQLite（默认、零依赖）
            └─ scripts/db-seed-mysql.ts  MySQL 8（课程数据库 / 生产路径）
            ▼
data/visaatlas.sqlite 或 MySQL `visa_atlas`
            ▼
Fastify API  /api/v1/overview · search · suggest · countries/:iso2
            ▼
React 19 + Vite 前端：MapLibre GL globe + 预置词/模糊搜索 + 国家签证抽屉

构建期独立链路：
world-atlas 1:50m TopoJSON ──scripts/build-globe-geo.ts──▶ public/geo/*.geo.json
（236 多边形国家 + 14 微国家点 + 中心/bbox；跨反经线国家在 ±180° 切分；无经纬网；
 Vite 构建时复制到 dist，无运行时外部请求）
```

**为什么保留中间 JSON**：数据库不是唯一副本。ETL 可重放、可 diff、可校验；`dataset.json` 是数据审查单位，种子脚本只做机械导入。未来追加数据时，向 `data/source/` 增加批次文件，在 ETL 中合并即可。

## 3. 技术栈与取舍

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 6 | 沿用 base 的工程底座，组件生态成熟 |
| 地图 | MapLibre GL JS v5 globe + 构建期生成 GeoJSON | 真实球体投影，可拖拽旋转/自由缩放看大国小国；不依赖任何地图 Key/瓦片服务；颜色、hover、选中完全可控；离线可用 |
| 后端 | Fastify 5 + zod | 沿用 base；轻量、schema 明确 |
| 数据库（默认） | SQLite（Node 24 内置 `node:sqlite`） | 零安装、可复现；真实关系模型、索引、视图、外键、事务 |
| 数据库（课程） | MySQL 8.0，schema 同构 | 满足课程「数据库全栈」要求，可切换验证 |
| 搜索 | 服务端 SQL 过滤 + 分面统计 + 词法排序 | 249 条规模不需要向量检索；筛选、分面、分页全部在数据库执行，前端不做全量过滤 |
| 字体 | `@fontsource-variable` 本地打包 | 无运行时外网依赖 |

**不需要任何外部 API Key**。地图几何数据在构建期从 `world-atlas` npm 包生成；运行期完全离线可展示。v4 球体由 MapLibre GL JS（BSD-3-Clause）渲染，无底图瓦片。可选增强（非必需）：MapTiler/高德底图 Key（若未来想叠加卫星/街道底图）、汇率 API（未来采集费用后换算人民币）、中国领事服务网逐国官方页面（需人工采集，不是 API）。

## 4. 数据库设计

核心实体 15 张表 + 2 个视图，完整字段见 [DATA-DICTIONARY.md](DATA-DICTIONARY.md) 与 `database/schema.sql`。

| 表 | 作用 | 关键设计 |
|---|---|---|
| `app_meta` | schema/数据集版本 | 让 API 能报告「这是哪一批数据」 |
| `regions` / `visa_types` / `policy_groups` / `visa_categories` | 四层字典 | 分类归一化，ETL 原始 60+ 种中文分类收敛为 16 个可筛选类别 / 5 个政策组 |
| `countries` | 250 个国家与地区目录 | ISO2 主键、区域外键、别名 JSON、质心坐标、重点候选标记 |
| `visa_policies` | 一条 = 国家 × 用途 × 可说明白的手续 | 主键 `route_code`；停留期用 days + rule + window 表达；`data_status` + `completeness` 表示资料成熟度；`is_demo` 隔离演示数据 |
| `mentioned_visa_types` | 「该国还有商务签/工作签」等类型线索 | 让未来扩展在检索中可被发现，同时不伪造结构化事实 |
| `policy_documents` / `policy_fees` / `policy_timings` / `policy_rules` | 结构化明细（扩展位） | 当前真实数据为空；v4 界面不预留空位，未来补采时再启用；演示路线仅作为回归夹具 |
| `data_sources` / `data_batches` | 来源与批次 | 每条路线可回溯到来源、导入批次与时间 |
| `search_synonyms` | 检索同义词 | 国家别名、中文/英文/缩写互搜 |
| **知识图谱服务** | 国家/地区/政策组/类别/签证类型节点 + 别名/政策/线索/同义词边 | 查询先解析为图谱实体再精确取国家集合；未命中才回退全文检索 |
| `v_country_map` / `v_policy_cards` | 地图与卡片复用视图 | 统一 JOIN，避免前端各算一份国家/类别标签 |

约束与索引要点：外键开启；`visa_policies` 上 `(country_code, visa_type, is_visible)`、`(visa_type, is_visible, is_demo)`、`(category_code)`、`(stay_days)`、`(data_status)` 覆盖筛选路径；`CHECK` 约束保证 `completeness`、布尔列、停留期区间合法。
检索使用参数化 SQL，不在字符串里拼接用户输入。

**资料成熟度**（`data_status`）：
- `SUMMARY_ONLY`：本轮 CSV 的真实水平——有政策类别 + 一句摘要；v4 界面只展示可规模化采集的字段，不预留费用/材料/审核时间空位；
- `PARTIAL` / `DETAILED`：未来补采后升级；
- `DEMO`：演示明细，不得当作事实；
- `MENTION_ONLY`：不是数据库里的政策行，而是检索时为「仅类型线索」生成的结果状态。

## 5. API 设计

详见 [API.md](API.md)。主要读接口（另有 health）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 存活、当前数据库模式、数据集版本 |
| GET | `/api/v1/overview` | 数据集元信息 + 统计 + 地图着色数据 + 全部字典（首屏一次拉取） |
| GET | `/api/v1/search` | 关键词 + 地区/政策组/类别/签证类型/停留期/资料状态/演示数据筛选，分面计数、分页、SQL 排序；**图谱优先解析**，响应含可解释 `graph` 元数据 |
| GET | `/api/v1/suggest?q=` | 搜索框联想（后端保留；v4 前端优先本地模糊匹配，减少网络往返） |
| GET | `/api/v1/countries/:iso2` | 国家签证档案（真实政策、类型线索、演示明细、来源） |

约定：`{data}` / `{error:{code,message,details?}}` 包裹；`Cache-Control: no-store`；参数用 zod 校验；分页上限 96；未知国家 404，目录内无资料国家返回 200 + 空政策（`XK` 即如此）。

**检索语义**：
- 对象是「国家 × 签证类型」。默认 `type=TOURISM` 返回 249 条真实政策；切换到 `BUSINESS/STUDY/...` 时，若有结构化政策则返回政策卡，否则返回「仅类型线索」卡（来源 CSV 的「其他常见签证类型」列），不会伪造费用和材料。
- 关键词分词后 AND 匹配；SQL `LIKE` 覆盖国家中英文/别名/摘要/线索文本；同义词表扩展缩写与英文名。
- 分面计数按「除自身维度外的其他筛选」计算（标准分面语义），前端直接显示。
- 排序：相关度（国家名精确 > 前缀 > 别名 > 政策文本 > 线索）、名称、停留期、完整度。

## 6. 前端结构（v4 极简）

```
client/
├─ App.tsx                     状态编排（overview / 搜索 / 地球聚焦 / 抽屉 / 数据说明）
├─ api.ts                      带类型的 fetch 封装与取消
├─ styles.css                  v4 设计系统（深黑 + 政策组语义色 + 装饰 HUD）
├─ features/
│  ├─ map/GlobeMap.tsx         MapLibre GL globe：政策组语义色、hover/selected/focus/dim/match feature-state、反经线切分几何、微国家点
│  ├─ search/SearchOverlay.tsx 顶部搜索胶囊 + 8 预置词 + 本地模糊建议/后端结果 + 图谱命中解释
│  ├─ search/fuzzy.ts          250 国中英文名/ISO/别名容错匹配
│  └─ details/CountrySheet.tsx 底部国家签证抽屉（精简：名称/类别/停留/入境/摘要/类型线索/来源）
└─ components/                 ⓘ 数据说明弹层、className 工具
```

交互主线：
1. 首屏加载 `overview` → 全屏地球（中国/亚洲为初始视角），陆地低饱和灰、海洋深色、国境线可见；
2. 拖拽旋转、滚轮/按钮缩放；hover 国家 → 该国变政策组亮色 + 同类边界发光 + 底部固定悬浮卡（可点击、不会追着鼠标跑）；拖拽结束无论在何处松开都能恢复 hover；点到极区不再被经纬环带/跨日界线长边遮挡；
3. 点击国家 → 地球飞行聚焦 + 其他地区进入统一深灰静默态 + 打开精简国家签证抽屉；
4. 搜索/预置词（免签、落地签、电子签、申根、商务签、日本、美国、欧洲）→ 知识图谱解析实体，精确取国家集合；地图未命中变暗、命中按政策组淡彩；输入时本地模糊建议（`Japn` → 日本），命中明确国家时地球自动飞近，点击结果行直接打开抽屉；
5. 抽屉内「其他签证类型」chips → 切换该用途检索（如商务/留学/工作）；
6. 点击空白 / Esc 逐层关闭；ⓘ 数据说明展示数据集版本、来源、成熟度与免责声明。

## 7. 运行方式

```powershell
npm install
npm run setup          # ETL → 生成地图几何 → 初始化并导入 SQLite
npm run dev            # API 3001 + Web 5173
```

MySQL（可选）：
```powershell
Copy-Item .env.mysql.example .env
npm run data:build
npm run db:init:mysql
npm run db:seed:mysql
npm run dev
```

## 8. 可扩展点（明确的未来接口）

1. **新增签证类型**：在 `data/source/` 放入同构批次 JSON（字段见 `shared/dataset.ts`），在 `scripts/etl.ts` 合并后重跑 `db:seed`；前端筛选器自动出现该类型，无需改 UI。
2. **补全真实明细**：把费用/材料/时间/规则写进批次，`data_status` 升为 `PARTIAL/DETAILED`；v4 前端不预留空位，未来按需增加明细区块，不改检索/地图/API 结构。
3. **地图底图/样式**：`GlobeMap` 与业务状态解耦，可替换为带瓦片底图的 MapLibre 样式或其它地球实现，不影响检索与国家档案。
4. **新来源**：`data_sources` + `source_id` 已就位；可在国家档案显示多来源与核验状态。
5. **MySQL 迁移**：SQLite 与 MySQL 字段同构；`docs/sql-parity` 测试比较两者列名。

## 9. 已知限制（诚实声明）

- 本轮真实数据只有旅游签，且是**摘要级**（无费用、材料、审核时间、官方逐条来源 URL）；界面用「待采集」而不是编造。
- 政策分类归一化存在解释空间；`conditions_text` 保留原文句子，避免过度结构化。
- 演示明细为虚构内容，仅在显式开启「演示数据」时出现，并在界面持续标注。
- 仅面向桌面 Web（≥1180px），不做移动端、账户、后台管理、自动采集。
