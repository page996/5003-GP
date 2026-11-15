# Visa Atlas v1.0 · 系统架构

> 本文件描述本轮「真实落地」后的架构。旧版 `README.md` 中的 base 说明已被本文件与根目录 README 取代。
> 状态：可运行的课程项目，不是官方签证数据库；资料来自小组整理的 CSV，未经使领馆逐条确认。

## 1. 一句话目标

以**中国普通护照持有人的旅游签/免签/落地签政策**为第一份真实数据，做出一套「世界地图探索 + 全文检索 + 多条件筛选 + 国家签证档案」的桌面 Web 全栈系统；数据库、API、前端字段一次到位，未来补采商务/留学/工作等类型时**只换数据、不改代码**。

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
React 19 + Vite 前端：SVG 交互世界地图 + 全局搜索 + 分面筛选 + 国家档案抽屉
```

**为什么保留中间 JSON**：数据库不是唯一副本。ETL 可重放、可 diff、可校验；`dataset.json` 是数据审查单位，种子脚本只做机械导入。未来追加数据时，向 `data/source/` 增加批次文件，在 ETL 中合并即可。

## 3. 技术栈与取舍

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 6 | 沿用 base 的工程底座，组件生态成熟 |
| 地图 | 自绘 SVG（d3-geo 预投影，world-atlas 50m） | 不依赖任何地图 Key/瓦片服务；可完全控制视觉、悬浮抬升、微国家点击热区、离线可用 |
| 后端 | Fastify 5 + zod | 沿用 base；轻量、schema 明确 |
| 数据库（默认） | SQLite（Node 24 内置 `node:sqlite`） | 零安装、可复现；真实关系模型、索引、视图、外键、事务 |
| 数据库（课程） | MySQL 8.0，schema 同构 | 满足课程「数据库全栈」要求，可切换验证 |
| 搜索 | 服务端 SQL 过滤 + 分面统计 + 词法排序 | 249 条规模不需要向量检索；筛选、分面、分页全部在数据库执行，前端不做全量过滤 |
| 字体 | `@fontsource-variable` 本地打包 | 无运行时外网依赖 |

**不需要任何外部 API Key**。地图几何数据在构建期从 `world-atlas` npm 包生成；运行期完全离线可展示。可选增强（非必需）：MapTiler/高德底图 Key（若想把自绘地图换成真实底图）、汇率 API（未来采集费用后换算人民币）、中国领事服务网逐国官方页面（需人工采集，不是 API）。

## 4. 数据库设计

核心实体 15 张表 + 2 个视图，完整字段见 [DATA-DICTIONARY.md](DATA-DICTIONARY.md) 与 `database/schema.sql`。

| 表 | 作用 | 关键设计 |
|---|---|---|
| `app_meta` | schema/数据集版本 | 让 API 能报告「这是哪一批数据」 |
| `regions` / `visa_types` / `policy_groups` / `visa_categories` | 四层字典 | 分类归一化，ETL 原始 60+ 种中文分类收敛为 16 个可筛选类别 / 5 个政策组 |
| `countries` | 250 个国家与地区目录 | ISO2 主键、区域外键、别名 JSON、质心坐标、重点候选标记 |
| `visa_policies` | 一条 = 国家 × 用途 × 可说明白的手续 | 主键 `route_code`；停留期用 days + rule + window 表达；`data_status` + `completeness` 表示资料成熟度；`is_demo` 隔离演示数据 |
| `mentioned_visa_types` | 「该国还有商务签/工作签」等类型线索 | 让未来扩展在检索中可被发现，同时不伪造结构化事实 |
| `policy_documents` / `policy_fees` / `policy_timings` / `policy_rules` | 结构化明细 | 当前真实数据为空（诚实地表示「未采集」），演示路线用于验证界面 |
| `data_sources` / `data_batches` | 来源与批次 | 每条路线可回溯到来源、导入批次与时间 |
| `search_synonyms` | 检索同义词 | 国家别名、中文/英文/缩写互搜 |
| `v_country_map` / `v_policy_cards` | 地图与卡片复用视图 | 统一 JOIN，避免前端各算一份国家/类别标签 |

约束与索引要点：外键开启；`visa_policies` 上 `(country_code, visa_type, is_visible)`、`(visa_type, is_visible, is_demo)`、`(category_code)`、`(stay_days)`、`(data_status)` 覆盖筛选路径；`CHECK` 约束保证 `completeness`、布尔列、停留期区间合法。
检索使用参数化 SQL，不在字符串里拼接用户输入。

**资料成熟度**（`data_status`）：
- `SUMMARY_ONLY`：本轮 CSV 的真实水平——有政策类别 + 一句摘要，费用/材料/审核时间未知；
- `PARTIAL` / `DETAILED`：未来补采后升级；
- `DEMO`：演示明细，不得当作事实；
- `MENTION_ONLY`：不是数据库里的政策行，而是检索时为「仅类型线索」生成的结果状态。

## 5. API 设计

详见 [API.md](API.md)。主要读接口（另有 health）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 存活、当前数据库模式、数据集版本 |
| GET | `/api/v1/overview` | 数据集元信息 + 统计 + 地图着色数据 + 全部字典（首屏一次拉取） |
| GET | `/api/v1/search` | 关键词 + 地区/政策组/类别/签证类型/停留期/资料状态/演示数据筛选，分面计数、分页、SQL 排序 |
| GET | `/api/v1/suggest?q=` | 搜索框联想（国家/别名/类别/签证类型） |
| GET | `/api/v1/countries/:iso2` | 国家签证档案（真实政策、类型线索、演示明细、来源） |

约定：`{data}` / `{error:{code,message,details?}}` 包裹；`Cache-Control: no-store`；参数用 zod 校验；分页上限 96；未知国家 404，目录内无资料国家返回 200 + 空政策（`XK` 即如此）。

**检索语义**：
- 对象是「国家 × 签证类型」。默认 `type=TOURISM` 返回 249 条真实政策；切换到 `BUSINESS/STUDY/...` 时，若有结构化政策则返回政策卡，否则返回「仅类型线索」卡（来源 CSV 的「其他常见签证类型」列），不会伪造费用和材料。
- 关键词分词后 AND 匹配；SQL `LIKE` 覆盖国家中英文/别名/摘要/线索文本；同义词表扩展缩写与英文名。
- 分面计数按「除自身维度外的其他筛选」计算（标准分面语义），前端直接显示。
- 排序：相关度（国家名精确 > 前缀 > 别名 > 政策文本 > 线索）、名称、停留期、完整度。

## 6. 前端结构

```
client/
├─ App.tsx                     页面状态编排（筛选、检索、选中、面板切换）
├─ api.ts                      带类型的 fetch 封装与取消
├─ styles.css                  设计令牌 + 全局布局 + 组件样式
├─ features/
│  ├─ search/GlobalSearch.tsx  顶部搜索框 + 联想下拉 + 键盘操作
│  ├─ filters/FilterRail.tsx   分面筛选栏（地图联动 hover）
│  ├─ map/WorldMap.tsx         SVG 世界地图（自绘、缩放/拖拽、悬浮抬升、选中）
│  ├─ results/ResultsPanel.tsx 结果列表/卡片/分页/空态
│  └─ details/CountryDossier.tsx 国家档案抽屉（政策、停留期、线索、来源、演示明细）
└─ components/                 徽章、完整度环、骨架、图标等小组件
```

交互主线：
1. 首屏加载 `overview` → 地图着色（按政策组或资料完整度）→ 默认检索 249 条旅游签；
2. 输入关键词 → 250ms 防抖 → 服务端检索 → 地图高亮命中、非命中变暗、右侧结果列表更新；
3. 悬停地图国家 → 边界描边发光 + 轻微抬升 + 跟随鼠标浮层（国家、类别、停留期）；
4. 点击国家 → 地图聚焦 + 右侧切换「国家档案」→ 展示真实政策/类型线索/来源/完整度；
5. 分面筛选（地区、政策组、类别、停留期、资料状态、重点候选、演示开关）→ 与搜索组合；
6. 地图/列表视图切换；URL 查询参数可复制分享（可选增强）。

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
2. **补全真实明细**：把费用/材料/时间/规则写进批次，`data_status` 升为 `PARTIAL/DETAILED`，界面自动从空态升级为明细卡。
3. **地图底图**：`WorldMap` 与国家几何解耦，可替换为 MapLibre/tiles，不影响检索与档案。
4. **新来源**：`data_sources` + `source_id` 已就位；可在国家档案显示多来源与核验状态。
5. **MySQL 迁移**：SQLite 与 MySQL 字段同构；`docs/sql-parity` 测试比较两者列名。

## 9. 已知限制（诚实声明）

- 本轮真实数据只有旅游签，且是**摘要级**（无费用、材料、审核时间、官方逐条来源 URL）；界面用「待采集」而不是编造。
- 政策分类归一化存在解释空间；`conditions_text` 保留原文句子，避免过度结构化。
- 演示明细为虚构内容，仅在显式开启「演示数据」时出现，并在界面持续标注。
- 仅面向桌面 Web（≥1180px），不做移动端、账户、后台管理、自动采集。
