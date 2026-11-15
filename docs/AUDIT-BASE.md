# 对 base v0.1 的审计与本轮修订决策

> 审计对象：`VisaAtlas-base-v0.1.zip`（2026-09 交付）、`六人协作职责规划包_v1.zip`、`交接.zip`、以及小组整理的 `global_249_countries_cn_passport_visa(1).csv`。
> 审计方式：逐文件阅读 `client/`、`server/`、`shared/contracts.ts`、`database/schema.sql`、`scripts/`、`tests/`、`docs/`；实测 `npm ci`、TypeScript、CSV 字段分布（249 行 / 76 种原始分类 / 7 个地区代码）；对照本轮需求逐项核对。以下结论是“重新实现”的依据，不是对原作者的否定——base 在数据完整度、来源可追溯性和 MySQL 事务维护上做了超出一般课程作业的设计。

## 1. 结论先行

| 维度 | base 状态 | 与本轮需求的关系 | 本轮处理 |
|---|---|---|---|
| 真实签证数据 | `data/policies.json` 为空，真实政策 **0 条**；`demo.json` 9 条明确虚构路线 | 用户已有 249 国旅游签 CSV，需求是“真实落地” | **新建 ETL**，把 CSV 归一化为 249 条真实政策，演示数据降级为未来类型的少量样本 |
| 地图 | 高德 JS API 标记点地图；无 Key 时用 250 个点散布在网格上 | 需要“可平面设计的世界地图 + 悬停边界动态高亮 + 点击查询”，点地图不满足 | **整体替换**为自绘 SVG 世界地图（world-atlas 50m，无 Key、离线可用） |
| 搜索 | 浏览器端对全量 catalog 做 `includes` 过滤；后端只有 catalog/visa/recommendation 三个读接口 | 明确要求“内置搜索框 + 后端搜索架构 + 多条件筛选” | **新写** `/api/v1/search` + `/suggest`：SQL 筛选、分面计数、分页、排序、同义词 |
| 数据模型 | 8 张表，围绕“完整路线”设计；原始 CSV 的 76 种分类、类型线索、资料成熟度无法落库 | 需要先落地“摘要级”真实数据，未来可扩展 | **扩展为 15 张表 + 2 视图**：增加分类字典、类型线索、来源/批次、`data_status`/`completeness`、`source_category` |
| 前端 | 3 栏工具型界面（245/自适应/350），单文件 73 行密集 JSX，无设计令牌 | 要求“美观、至少做平面设计”，且当前 UI 不符合交互 | **整体重写**：设计系统 + 三栏地图工作台 + 结果/档案抽屉 |
| 推荐引擎 | 个人条件 + 意图的规则匹配，设计克制、解释清楚 | 本轮不要求，且会分散地图/搜索/数据库主线 | **从 v1.0 界面移除**，保留为后续扩展点在文档中说明 |
| 测试 | 40 项 node:test + MySQL 集成测试，质量好 | 可复用测试思想 | **重写**为 ETL / 数据集 / API / 搜索 / SQLite/MySQL 同构校验 |
| 文档 | 60+ 份分工/协议/覆盖文档，流程导向 | 作业需要能讲清产品与数据库；分工文档反而干扰 | 归档为 `docs/legacy-base/`，新写架构/API/数据字典/验收文档 |

## 2. 具体问题清单（code-level）

### 2.1 数据与 ETL

1. **空数据是最大事实**：`data/policies.json` 内容为 `{"schemaVersion":"1.0","datasetVersion":"empty","policies":[]}`；唯一能展示的是 9 条 `DEMO-*` 虚构路线。UI 首屏“真实资料 0 条”的诚实做法值得保留，但不能作为课程交付成品。
2. **没有 CSV → 数据库的入口**：base 的 `data/templates/policy-template.json` 是手工填写的单条完整路线模板，`scripts/import-data.ts` 只接受 base 自有 JSON 批次。小组的 CSV（分类 + 一句说明 + 其他类型）无法被任何脚本消费。
3. **分类未建模**：CSV 的“中国护照通行政策分类”有 **76 种取值**（如“预办申根签证”“有条件免签/荷属签”“需丹麦另行签注”），base 没有分类表、没有归一化规则；直接存入 `officialName` 会丢失可筛选性。
4. **没有“类型线索”层**：CSV 第 8 列给出“商务签、工作签、黄金签证”等，base 只能把它塞进自由文本；未来扩展商务/留学/工作时没有过渡状态可展示。
5. **资料成熟度不可表达**：base 的 `Policy` 只有 `documentsStatus`/`rulesStatus`，没有整体 `data_status` / `completeness`；摘要级资料与完整资料在 UI 上无法区分。
6. **来源模型过重**：base 要求每条可见事实都有 `VERIFIED`/`SINGLE_SOURCE` 来源，且来源内嵌在每条路线的 JSON 里。小组 CSV 没有逐国官方 URL；如果照 base 的校验器，249 条数据会全部校验失败。本轮保留“来源可追溯”原则，但把来源与批次独立成表，并允许“小组整理 CSV”作为单一来源、在界面持续标注。
7. **`demo.json` 与真实数据混在同一个 `Catalog`**：演示路线没有独立过滤开关（只有角标），容易误读；本轮加 `demo=1` 参数与显著提示。

### 2.2 数据库

1. **表结构覆盖完整路线，但没有覆盖“摘要数据 + 线索 + 批次”**：缺少 `data_batches`、`mentioned_visa_types`、`data_status`、`completeness`、`source_category`、`visa_categories`/`policy_groups`。
2. **来源以 JSON 内嵌**：`visa_policies.sources JSON` 不利于按来源统计、更新和引用完整性检查；本轮改为 `data_sources` + `source_id` 外键（保留扩展空间）。
3. **两个事实来源**：文件模式读 `data/demo.json`，MySQL 模式读表；覆盖情况每次请求现算 `coverage-targets.json`。维护时容易出现“文件改了、库没改”。本轮用 `dataset.json` 作为唯一 ETL 产物、SQLite/MySQL 都由它种子，并提供幂等 seed。
4. **索引不足**：`visa_policies` 只有 `(country_code, visa_type, is_visible)`；按地区/类别/停留期/状态的筛选路径没有索引。本轮为搜索路径补齐索引。
5. **无导入批次与审计**：`data_batches` 缺失使“这批数据什么时候进来的、来源文件是什么”不可查；本轮补上。
6. **MySQL DDL 的小问题**：`visa_policies.stay_value INT UNSIGNED` 与 JSON 来源并存但没有 `CHECK` 范围；`validity_value INT UNSIGNED` 无法表达 0；`aliases JSON NOT NULL` 对 SQLite 不可移植。本轮 SQLite 用 `TEXT + json_valid()`，MySQL 用对应类型与 CHECK，并提供列一致性测试。
7. **没有 SQLite/零依赖路径**：base 的 demo 模式不走数据库，课程“数据库全栈”的核心在演示时其实缺席。本轮默认 SQLite（真实关系模型/索引/视图/事务），同时保留 MySQL 8 同构模式。

### 2.3 后端/API

1. **只有 4 个接口，没有搜索接口**：`/api/v1/catalog` 一次返回全部 policies + coverage；前端在内存过滤。250 国/249 条还能用，但需求明确要求后端搜索架构，且未来多类型、多渠道后会迅速膨胀。
2. **无分页/分面/排序/联想**：API 文档也承认“规模扩大后由 C/E 商定分页和服务端过滤”。
3. **catalog 每次全量读库**：MySQL 模式下 `/api/v1/visas/:routeCode` 也调用 `repository.load()` 读取全量国家+政策+子表，单条查询成本与全量相同。
4. **无缓存/ETag**：`Cache-Control: no-store` 对只读资料偏保守；本轮仍关闭缓存以避免陈旧，但通过快照与 `datasetVersion` 暴露版本。
5. **无自动初始化**：MySQL 模式需要手工 `db:init`；空库或错误配置会 503，学习/演示成本高。本轮 SQLite 首启自动建库+种子。
6. **输入校验较好**：zod + 统一错误体 + 参数化 SQL + 速率限制，这些优点保留。

### 2.4 前端/UI

1. **地图不满足核心交互**：`MapPanel.tsx` 用 `AMap.Marker` 添加 250 个点；无 Key 时 `offline-map` 是经纬度映射的圆点 + 网格。没有国家多边形、没有边界 hover、没有点击国家轮廓；即使有 Key，也只是点标记，不符合“鼠标悬停位置国家边界动态悬浮并高亮”。
2. **高德依赖不可交付**：README 明确“未提供项目 Key，实际高德服务尚未验收”“本 base 未实现安全代理”。对课程提交来说这是悬空依赖；且全球地图展示的授权/合规需要另行确认。本轮改为零 Key 的自绘地图，把外部依赖从“必须”降为“可选”。
3. **视觉缺少设计系统**：全局样式 13KB 单行压缩式规则，声明了 `"DM Sans"` 但没有任何 `@font-face`/字体加载，实际 fallback；无颜色令牌、无暗色/亮色体系、无组件规范。与“至少需要做一些平面设计”的要求差距明显。
4. **布局耦合与可维护性**：`App.tsx` 73 行、大量单行 JSX；“探索”页把筛选、地图、结果、详情硬编码在一个 grid 里，新交互（悬浮、联想、抽屉）很难加。
5. **状态与可分享性**：筛选状态只在内存，刷新丢失、无法分享 URL；无请求取消（切换筛选时旧请求可能回写）；无骨架屏；空态/错误态分散。
6. **推荐表单是主要交互，但本轮不需要**：它占据导航与页面空间，让“地图 + 搜索”主线不突出；本轮移除但保留后端扩展说明。
7. **可访问性弱**：地图是装饰性 SVG/无法键盘遍历；无 `aria-live` 结果计数；焦点样式不统一。
8. **桌面适配**：base 设定 `min-width: 1180px`，符合“只做桌面”；本轮保留该约束。

### 2.5 工程/文档/测试

1. **文档与交付错位**：`docs/` 中 15 份双边协议、6 份职责书、覆盖账本等更适合团队流程，不能直接作为课程产品说明；README 第一屏是分工导航而不是产品能力。
2. **测试没有覆盖数据入口**：40 项测试主要覆盖 domain/recommendation 和 API 空数据场景；没有 CSV 解析、分类归一化、地图几何、浏览器端 E2E。
3. **构建与版本**：`engines.node >= 22`，但依赖的 `world-countries` 只在 devDependencies；`npm ci` 可复现，lockfile 完整。本轮保持 Vite/Fastify/TypeScript 选型，Node 要求提升到 24（使用内置 `node:sqlite`）。
4. **分工模式不适合本轮执行**：用户明确“暂时无视分工、交接”，因此本轮不按 A–F 角色切分，而按工程模块交付；旧职责文档归档。

## 3. 保留 / 复用清单

- `data/countries.json`（250 国目录，含中英文名、ISO3/别名、质心、来源 ODbL 署名）→ **保留**，ETL 合并 CSV 名称与别名。
- `data/coverage-targets.json`（91 个重点候选、每国 7 类用途）→ **保留**，转成国家 `priority` 字段与检索筛选。
- 技术栈：React 19 + Vite + TypeScript + Fastify + zod + MySQL2 → **保留**。
- 数据完整性立场：未知字段保持 null、演示数据显式标注、不把目录当政策、不做获签概率 → **保留并强化**（`data_status`、`is_demo`、来源/批次）。
- `shared/contracts.ts` 的 Zod 严格校验思路 → 在 dataset 校验脚本中延续。
- base 的 MySQL 事务式导入/备份思路 → 简化为“重放 ETL 产物”的幂等 seed，避免课程交付引入过多维护工具。

## 4. 本轮必须新增的能力（与用户需求一一对应）

| 用户要求 | 实现 |
|---|---|
| 美观的平面设计地图 | 深墨蓝“午夜制图室”视觉系统 + 自绘 Equal Earth 世界地图 + 24 个标签锚点 + 图例/色带/统计浮层 |
| 鼠标悬停国家边界动态悬浮并高亮 | SVG 分层：hover 覆盖层重绘 + 边界发光 + 上浮 + 其余国家变暗 + 跟随鼠标玻璃浮层 |
| 点击查询国家签证信息 | 地图点击 → 地图聚焦 + 右侧国家档案：政策结论、停留期、条件原文、完整度、类型线索、来源 |
| 内置搜索框 + 后端搜索架构 | `/api/v1/search`：关键词分词、同义词、地区/政策组/类别/用途/停留期/资料状态/重点候选筛选、分面、分页、排序；`/suggest` 联想 |
| 按国家、签证类型等筛选（补充项） | 地区、政策组、16 个细分签证类别、12 种签证用途、6 档停留期、5 种资料状态、重点候选、演示开关 |
| 目前只有旅游签，先做可扩展基础版 | 249 条真实旅游签 + `mentioned_visa_types` 线索层 + 22 条演示明细（非旅游类型，显式虚构）；新增类型只换数据 |
| 用模拟数据做拟真测试，未来替换数据即可 | `data/source/demo-details.json` 演示明细 + `dataset.json` 单一中间产物 + 幂等 seed + 数据校验脚本 |
| 需要哪些外界 API | **必需：0 个**。地图几何在构建期从 npm 包生成，运行期无网络依赖。可选：MapTiler/高德底图 Key（若未来要真实卫星底图）、汇率 API（费用换算）、中国领事服务网逐国页面（人工采集，不是 API） |

## 5. 审计中发现的“不能照搬”的具体代码位置

- `client/features/map/MapPanel.tsx:19-31`：只创建 AMap.Marker/`new AMap.Map`，没有 `GeoJSON`/`Polygon`/`feature-state` 之类边界能力；无 Key 时 `offline-map` 为圆点示意。
- `client/features/search/SearchPanel.tsx:6-13`：`filterPolicies` 在浏览器内存里过滤全量 policies；后端没有对应接口。
- `server/services/catalog.ts:10-18`：demo 模式直接读 `data/demo.json`；MySQL 模式每次 `repository.load()` 全量联表。
- `server/app.ts:15-37`：共 4 个路由；`/visas/:routeCode` 触发全量 `repository.load()`。
- `database/schema.sql:15-34`：`visa_policies` 缺少类别、成熟度、来源外键、批次；无 `data_batches`/`mentioned_visa_types`。
- `shared/contracts.ts:31-48`：`policySchema` 字段面向完整路线，缺少 `dataStatus`/`completeness`/`sourceCategory`；无法表达“仅类型线索”。
- `client/styles.css:1`：声明 `"DM Sans"` 但项目没有加载该字体；整体 13KB 压缩式单行样式，无令牌体系。
- `README.md:7-9`：自述“真实签证资料目前 0 条”“高德未提供 Key”，与用户“真实落地”的期望存在明确差距。
- `docs/STATUS.md:27`：“真实政策采集：0 条”“真实高德服务未验收”，与 README 一致，也说明 base 是工程底座而非成品。

## 6. 风险与后续

- 本轮真实数据仍为**摘要级**：分类、停留期、入境次数来自小组 CSV 与规则解析；费用、材料、审核时间、逐国官方链接未采集。界面必须持续以“待采集”呈现，不能用演示值填充真实国家。
- 类型线索来自 CSV 的自由文本，覆盖不完整；未来应升级为逐国逐类型的结构化批次。
- 34 个复合分类（如“落地签/电子签”“有条件免签/预办签证”）按来源顺序归入主类别，次选方式保留在 `summary` 原文；若课程答辩需要更细口径，可扩展 `policy_category_tags` 多值标签表。
- 自绘地图的几何来自 Natural Earth 1:50m，部分微小国家无多边形（14 个），以可点击圆点呈现；这是离线零 Key 方案的取舍，已在 `data/geo/REPORT.md` 记录。
