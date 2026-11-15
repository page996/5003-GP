# Visa Atlas · 世界签证图谱

> **中国普通护照出境签证查询与地图探索系统**（课程项目）
> 以小组整理的 **249 个国家/地区旅游签数据** 完成真实落地：自绘世界地图 + 悬停边界高亮 + 点击国家档案 + 服务端多条件检索。
> 数据为公开信息整理与演示样本，**非官方、不可作为申请依据**。

![探索页](docs/screenshots/explore.png)

| 地图悬停 | 国家档案 | 列表模式 |
|---|---|---|
| ![地图悬停](docs/screenshots/map-hover.png) | ![国家档案](docs/screenshots/dossier.png) | ![列表模式](docs/screenshots/list-view.png) |

## 1. 项目定位

| | 内容 |
|---|---|
| 课程主题 | 数据库全栈开发（关系模型、索引、视图、约束、事务、SQLite/MySQL 双模式、后端 API、前端交互） |
| 本轮范围 | 249 国旅游签摘要真实数据；地图、搜索、分面筛选、国家档案、数据质量说明全链路 |
| 不在范围 | 手机端、账户体系、后台管理、自动采集、实时更新、获签概率预测 |
| 外部服务依赖 | **无**。地图几何在构建期由 `world-atlas` 生成，运行期不联网、不需要任何地图 Key |

## 2. 快速开始

要求：**Node.js 24+**（使用内置 `node:sqlite`）、npm。

```powershell
npm install
npm run setup     # ETL 数据 → 地图几何 → 初始化并导入 SQLite
npm run dev       # API :3001 + Web :5173
```

打开 <http://127.0.0.1:5173>。首次启动会自动使用 `data/visaatlas.sqlite`；若数据库文件不存在，API 启动时会自动建库并导入 `data/generated/dataset.json`。

生产构建（同源提供页面与 API）：

```powershell
npm run build
npm start          # http://127.0.0.1:3001
```

### MySQL 8（课程数据库路径，可选）

```powershell
Copy-Item .env.mysql.example .env     # 填入本机 MySQL 账号
npm run data:build
npm run db:init:mysql                 # 建表（需 DB_ADMIN_*）
npm run db:seed:mysql                 # 从 data/generated/dataset.json 幂等导入
npm run dev
```

SQLite 与 MySQL 结构同构（见 `database/schema.sql` / `database/schema.mysql.sql`），API 响应完全一致，页面页脚显示当前模式。

## 3. 已实现功能

### 3.1 地图探索

- 自绘 **Equal Earth** 投影世界地图：236 个国家级多边形 + 14 个无多边形微国家可点击圆点，覆盖全部 250 个目录国家与地区。
- 鼠标悬停：国家边界发光、轻微上浮、其余国家变暗，跟随鼠标显示「国家 / 政策组 / 停留期」浮层。
- 点击国家：地图平滑聚焦到该国，右侧打开**国家档案**（政策结论、停留期、原始条件、资料完整度、类型线索、来源与限制）。
- 支持拖拽平移、滚轮缩放（0.9–8×）、双击放大、缩放按钮与重置；`/` 聚焦搜索；地图/列表两种浏览模式。
- 着色模式：按「政策组」或「资料完整度」切换；筛选联动地图：未命中目的地变暗，命中地区可悬停联动高亮。

### 3.2 搜索与筛选（服务端）

- 顶部搜索框 + 300ms 联想下拉（国家、别名、政策类别、签证类型、关键词），支持 ↑↓/Enter/Esc 键盘操作。
- 关键词分词 AND 检索：国家中英文名、ISO2、别名、政策摘要、原始分类、其他类型线索；**351 条同义词**扩展（英国/UK、商签/商务签证、电子签/e-visa…）。
- 分面筛选：地区、政策组、16 个细分签证类别、12 种签证用途（默认旅游）、6 档停留期、资料状态、91 个重点候选、是否包含演示明细。
- 分面计数、分页（默认 24，上限 96）、四种排序（相关度/名称/停留期/完整度）全部在后端 SQL 完成；前端不做全量过滤。
- URL 同步当前筛选与选中目的地，刷新/分享可复现。

### 3.3 国家档案

- 政策卡：类别徽章、是否需要签证、停留期（含「180 天内累计不超过 90 天」等规则）、入境次数、条件原文引用、来源原始分类。
- 资料完整度环 + 「费用 / 材料 / 审核时间：待采集」三宫格（真实数据未采集的字段不编造）。
- 其他常见签证类型线索 chips（点击即以该类型检索；例如「日本 · 商务访问」目前只有线索或被采集为演示明细）。
- 来源、批次、路线编号、核验状态与免责声明；演示明细单独金色区块持续标注。

### 3.4 数据与数据库

- 真实数据：**249 条旅游签政策**（250 个国家目录中仅 `XK` 未采集），CSV 原始 76 种分类归一化为 16 个可筛选类别 / 5 个政策组。
- 结构线索：**569 条**「其他国家还有商务/留学/工作等签证」线索，提前支撑未来扩展。
- 演示明细：**22 条**，覆盖商务/留学/工作/探亲/医疗/居留/数字游民/黄金签证/打工度假/科研 10 类，用于验证未来字段与界面，默认不展示，开启后持续标注「演示」。
- 数据库：15 张表 + 2 个视图 + 完整外键/CHECK/索引；SQLite（默认，零安装）与 MySQL 8（同构）。
- 数据链路：`CSV → scripts/etl.ts → data/generated/dataset.json → scripts/db-seed.ts → SQLite/MySQL`，可重放、可校验、可 diff。

## 4. 数据与来源

| 项目 | 说明 |
|---|---|
| 真实数据 | `data/source/global_249_countries_cn_passport_visa.csv`（小组整理，249 行） |
| 来源等级 | `SINGLE_SOURCE`：小组汇总，无逐国官方链接；界面与文档持续提示以官方公告为准 |
| 当前成熟度 | `SUMMARY_ONLY`：政策类别 + 一句摘要 + 抽取的停留期；费用/材料/审核时间/个人条件规则未采集 |
| 未采集国家 | `XK`（目录保留，档案显示「尚未纳入本轮采集」） |
| 演示数据 | `data/source/demo-details.json`（22 条，完全虚构，`is_demo=1`） |
| 同义词 | `data/source/synonyms.json`（351 条，检索辅助，不含政策事实） |
| 地图数据 | `world-atlas@2`（Natural Earth 1:50m，公共领域）；国家目录来自 `world-countries`（ODbL-1.0，见 `data/ATTRIBUTION.md`） |
| 质量报告 | `data/generated/report.md`（分类分布、停留期解析、未识别类型词、名称差异） |

重新生成与校验：

```powershell
npm run data:build     # CSV + 演示 + 同义词 → dataset.json / report.json / report.md
npm run data:check     # 结构、枚举、外键引用、数量与边界校验
npm run geo:build      # world-atlas 50m → data/geo/world-paths.json
npm run db:rebuild     # 重建 SQLite 并幂等导入
```

## 5. 数据库设计一览

```
regions ─< countries ─< visa_policies >─ visa_types
                │             ├─< policy_documents
                │             ├─< policy_fees
                │             ├─< policy_timings
                │             ├─< policy_rules
                │             └─> data_sources / data_batches
                └─< mentioned_visa_types >─ visa_types
policy_groups ─< visa_categories ─< visa_policies
search_synonyms / app_meta
```

- 关键视图：`v_country_map`（地图着色与统计）、`v_policy_cards`（卡片字段统一）。
- 关键约束：`route_code` 稳定主键；`is_demo`/`data_status` 隔离演示与摘要；`completeness` 0–100；`stay_rule` 支持滚动窗口；金额/币种成对。
- 完整字段、索引与扩展规则见 [docs/DATA-DICTIONARY.md](docs/DATA-DICTIONARY.md)。

## 6. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活、数据库模式、数据集版本 |
| GET | `/api/v1/overview` | 元信息 + 统计 + 地图着色 + 字典（首屏一次） |
| GET | `/api/v1/search` | 关键词 + 地区/政策组/类别/用途/停留期/资料状态/重点候选/演示 + 分面 + 分页 + 排序 |
| GET | `/api/v1/suggest?q=` | 搜索联想（≤8 条） |
| GET | `/api/v1/countries/:iso2?demo=1` | 国家档案（真实政策、类型线索、演示明细、来源） |
| GET | `/api/v1/route/:routeCode` | 单条路线（深链） |

约定：`{data}` / `{error:{code,message,details?}}`；参数校验、参数化 SQL、`no-store`、速率限制（240 次/分钟）。详见 [docs/API.md](docs/API.md)。

## 7. 测试与验收

```powershell
npm test             # 77 tests / 76 pass / 1 skip（MySQL 用例未启用时跳过）
npm run test:mysql   # 需要可用 MySQL（读取 .env 或环境变量），5/5 pass
npm run e2e          # Playwright + 系统 Chrome 浏览器验收（需先 npm run dev）
npm run screenshots  # 生成 docs/screenshots 截图
```

浏览器验收覆盖：首屏渲染、搜索、筛选、地图悬停/点击、国家档案、演示开关、空态/错误态、控制台无报错。完整证据见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 8. 项目结构

```
client/                 React 19 前端
  features/map/         自绘 SVG 世界地图（几何、悬停、缩放、聚焦）
  features/search/      全局搜索与联想
  features/filters/     分面筛选栏
  features/results/     结果列表/卡片
  features/details/     国家档案抽屉
  styles.css            设计令牌与全局样式
server/                 Fastify API（SQLite / MySQL 仓储、服务层、路由）
shared/                 前后端共享类型 + ETL 产物类型
database/               SQLite / MySQL 建表 SQL
scripts/                etl.ts · check-data.ts · build-geo.ts · db-*.ts
data/                   source（原始数据）· generated（ETL 产物）· geo（地图几何）
tests/                  node:test + Playwright 验收
docs/                   架构、审计、设计规范、API、数据字典；legacy-base 为旧版归档
```

## 9. 扩展方式（未来采集到更多数据时）

1. 把新批次放进 `data/source/`，在 `scripts/etl.ts` 中合并（字段格式见 `shared/dataset.ts`）。
2. 真实明细的 `data_status` 从 `SUMMARY_ONLY` 升为 `PARTIAL/DETAILED`，填写 `documents/fees/timings/rules` 与真实 `source_id`。
3. 运行 `npm run data:build && npm run data:check && npm run db:seed`（MySQL 用 `db:seed:mysql`）。
4. 前端筛选器、地图、档案会自动使用新类型/新字段，无需改 UI 代码。

`data/source/README.md` 说明了数据来源、字段含义与演示数据边界。

## 10. 已知限制与免责声明

- 本轮真实数据为**摘要级**：没有逐国官方 URL、费用、材料、审核时间与完整个人条件规则；界面用「待采集」呈现，不编造。
- 政策分类归一化存在解释空间；复合路线（如「落地签/电子签」）按来源顺序归入主类别，次选方式保留原文。
- 停留期由中文文本规则抽取（132/249 条可解析），可能与最新政策有出入。
- 演示明细为完全虚构样本，仅用于展示未来类型与字段；开启后界面持续标注，不可用于申请。
- 自绘地图部分微国家以圆点呈现；不依赖任何地图服务，但也不提供卫星底图/街道级细节。
- 仅面向桌面 Web（≥1180px）。

> 本项目的签证信息来自公开资料整理与虚构演示样本，未经使领馆逐条确认，不构成签证、法律或出行建议。请以中国领事服务网与目的地使领馆最新公告为准。

## 11. 文档索引

- [docs/AUDIT-BASE.md](docs/AUDIT-BASE.md)：对 base v0.1 的审计与本轮修订决策
- [docs/VERIFICATION.md](docs/VERIFICATION.md)：测试、构建、浏览器与 MySQL 验收记录
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：系统架构、数据链路、扩展点
- [docs/API.md](docs/API.md)：接口约定与检索语义
- [docs/DATA-DICTIONARY.md](docs/DATA-DICTIONARY.md)：数据库字段、视图、索引、成熟度
- [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)：视觉与交互规范
- [data/geo/REPORT.md](data/geo/REPORT.md)：地图几何覆盖与生成说明
- [data/generated/report.md](data/generated/report.md)：ETL 数据质量报告
