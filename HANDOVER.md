# Visa Atlas · 交接与启动说明书

版本：v5.0（2026-11-16）  
代码仓库：<https://github.com/page996/5003-GP>  
默认本地地址：<http://127.0.0.1:3001>（生产）/ <http://127.0.0.1:5173>（开发）

本文用于项目交接、部署启动和后续数据补充。**启动/部署优先看第 2、3 节；需要继续补数据看第 5、6 节。**

---

## 1. 交付物清单

| 交付物 | 位置 | 说明 |
|---|---|---|
| 源代码与素材 | Git 仓库 `main` 分支 | 前端、后端、脚本、SQL、数据、文档、截图 |
| 源码压缩包 | `release/visaatlas-source.zip` | 源码 + 数据 + 文档 + 启动脚本；首次运行自动安装依赖 |
| 完整离线包（Windows x64） | `deliverables/visaatlas-full-win-x64.zip` | 含 `node_modules`、构建产物和运行数据，解压后可直接启动 |
| 启动脚本 | `start.cmd` / `start-dev.cmd` / `setup.cmd` / `start.sh` | Windows 一键启动 / 开发 / 初始化；macOS/Linux 启动 |
| 交接说明书 | `HANDOVER.md`（本文） | 部署、启动、数据补充清单 |
| 数据补充模板 | `data/templates/data-supplement-template.csv` | 后续补充费用/材料/时间/规则/来源时使用 |
| 验收记录 | `docs/VERIFICATION.md` | 测试、E2E、构建结果 |
| 截图 | `docs/screenshots/` | 中文界面、英文界面、知识图谱、日期变更线、极地等 |

> 体积较大的完整离线包不进入 Git（避免仓库过大）；源码压缩包和源代码在仓库中，其他成员 clone 后可运行 `start.cmd` 自动安装依赖。

---

## 2. 技术架构速览

```
浏览器
  React 19 + TypeScript + Vite 6
  MapLibre GL JS 5.24（globe 投影、本地 GeoJSON）
  SearchOverlay / CountrySheet / i18n / 语义色地图
        │  /api/v1/*
Fastify 5 + TypeScript + zod
  知识图谱（国家/地区/政策组/类别/签证类型）
  检索服务（图谱优先 + SQL 分面/分页/排序）
  SQLite（默认） / MySQL 8（可选）
        │
ETL：CSV + 演示夹具 + 同义词 → dataset.json → DB
几何：world-atlas 50m → public/geo/*.geo.json
```

- 前端无地图 Key、无在线瓦片、运行期无外部网络请求。
- 后端默认 SQLite，零安装；MySQL 通过 `.env` 切换。
- 当前真实数据：249 条中国普通护照旅游签政策；250 国目录（`XK` 未采集）；22 条虚构演示只作为后端回归夹具，不在界面展示。

---

## 3. 启动与部署

### 3.1 环境要求

- **Node.js 24+**（必须，后端使用内置 `node:sqlite`）
- npm
- Windows（推荐 `.cmd` 脚本）或 macOS/Linux（`start.sh`）
- 可选：MySQL 8

### 3.2 从源码包启动（Windows，推荐）

1. 解压 `visaatlas-source.zip`；
2. 双击 `start.cmd`（或在 PowerShell 执行 `.\start.cmd`）；
3. 浏览器打开 <http://127.0.0.1:3001>。

`start.cmd` 会自动：

- 检查 Node.js 版本；
- 首次运行时 `npm ci` 安装依赖；
- 检查/生成 ETL 数据、地图几何、SQLite；
- 缺少 `dist/` 时执行生产构建；
- 启动 `npm start`。

开发模式双击 `start-dev.cmd`，访问 <http://127.0.0.1:5173>。

### 3.3 从完整离线包启动（Windows）

解压 `visaatlas-full-win-x64.zip`，直接双击根目录 `start.cmd`。包内已包含 `node_modules`、`dist`、数据和构建产物，不要求联网安装依赖。

### 3.4 手动命令

```powershell
npm install
npm run setup       # ETL → 地图几何 → SQLite 初始化/导入
npm run dev         # API :3001 + Web :5173
```

生产：

```powershell
npm run build
$env:PORT=3001
npm start
```

自定义端口：

```powershell
$env:PORT=3033; npm start
```

macOS / Linux：

```bash
chmod +x start.sh
./start.sh
```

### 3.5 MySQL 8（可选）

```powershell
Copy-Item .env.mysql.example .env
# 编辑 .env，填写 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
npm run data:build
npm run db:init:mysql
npm run db:seed:mysql
npm run dev
```

SQLite 与 MySQL schema 同构；数据结构见 `database/schema.sql`、`database/schema.mysql.sql`。

### 3.6 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | API/生产站点端口 |
| `DB_DRIVER` | `sqlite` | `sqlite` 或 `mysql` |
| `DATA_DB_PATH` | `data/visaatlas.sqlite` | SQLite 文件路径 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | — | MySQL 连接参数 |

模板：`.env.example`、`.env.mysql.example`。

### 3.7 验证部署

```powershell
npm test              # Node 测试
npm run e2e           # 浏览器验收（需先启动开发服务）
npm run build         # TypeScript + Vite 生产构建
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

---

## 4. 数据文件与当前状态

| 路径 | 内容 |
|---|---|
| `data/source/global_249_countries_cn_passport_visa.csv` | 249 个目的地真实旅游签摘要（本轮主数据） |
| `data/source/demo-details.json` | 22 条虚构演示明细（后端回归夹具，界面不展示） |
| `data/source/synonyms.json` | 351 条检索同义词 |
| `data/countries.json` | 250 国目录 |
| `data/generated/dataset.json` | ETL 唯一产物，数据库种子的来源 |
| `data/generated/report.md` | ETL 数据质量报告 |
| `data/geo/REPORT.md` | 地球几何覆盖与生成报告 |
| `public/geo/countries.geo.json` | 236 个多边形国家（构建期生成） |
| `public/geo/microstates.geo.json` | 14 个无多边形微国家点 |
| `docs/screenshots/` | 中文界面、英文界面、图谱、日期变更线、极地截图 |

当前真实字段覆盖：政策类别、停留期、入境次数、原文摘要、其他签证类型线索、来源/批次、路线编号。  
**费用、材料、办理时间、资格规则、逐国官方来源链接尚未采集**，界面不展示这些空位；后端已有对应表结构，可按第 5、6 节补充。

---

## 5. 可补充的数据（交接清单）

以下数据可直接按优先级补充。P0 建议优先，P1 用于提升可用性，P2 用于长期维护/扩展。

| 优先级 | 数据项 | 当前状态 | 建议落库字段/表 | 建议来源/说明 |
|---|---|---|---|---|
| P0 | 逐国官方来源 URL、发布方、核验日期、核验状态 | 只有小组汇总 CSV，无逐国链接 | `data_sources`、`visa_policies.source_id` | 中国领事服务网、目的地使领馆/移民局官网；一条来源可被多条路线引用 |
| P0 | 签证费用明细 | 无（空表） | `policy_fees`：名称、金额、币种、计费单位、适用条件、是否可比较、来源 | 官方费用页；未知金额用 NULL，不要用 0 表示免费 |
| P0 | 材料清单 | 无（空表） | `policy_documents`：材料名、要求、份数、是否必须、条件、来源 | 官方材料清单；条件材料单独一行 |
| P0 | 办理/审核时间 | 无（空表） | `policy_timings`：普通/加急、最短/最长工作日、备注、来源 | 官方办理时限页面；未知保留 NULL |
| P1 | 签证有效期、入境次数、停留期口径 | 部分停留期；有效期/入境次数多为待确认 | `visa_policies.validity_note`、`entry_scope`、`stay_*` | 官方签证页；区分每次停留/滚动窗口/有效期 |
| P1 | 资格与豁免规则 | 无 | `policy_rules`：字段、操作符、期望值、适用说明、来源 | 国籍/居住地/年龄/就业/持有第三国签证等条件 |
| P1 | 商务、留学、工作、探亲、过境等类型的结构化政策 | 只有 CSV 中的类型线索（MENTION_ONLY） | `visa_policies` + 对应 `visa_type`；线索仍保留在 `mentioned_visa_types` | 逐类型官方政策；不要把旅游签摘要复制到其他类型 |
| P1 | 申请渠道、预约、生物信息、递交/领取方式 | 多为推断或空 | `visa_policies.application_channel`、路线字段 | 使领馆/签证中心/在线门户说明 |
| P1 | 费用币种与人民币参考 | 无 | `policy_fees.currency`；如需展示换算则新增汇率批次 | 官方币种优先；汇率只用于展示，不写回政策事实 |
| P2 | 多路线/多渠道拆分 | 部分复合分类按主类别归并 | 一个 `route_code` = 国家 × 用途 × 一条可说明白的手续路线 | 不同渠道/加急/多次入境应拆成独立路线 |
| P2 | 属地、特殊许可、过境管制说明 | 有类别但无逐项规则 | `policy_rules` + `visa_policies.conditions_text` | 属地签证、许可、军事/生态管制等 |
| P2 | 生效日期、更新日期、政策变更记录 | 导入时间/核验时间不完整 | `visa_policies.collected_at/updated_at`、`data_batches` | 每次批次记录来源版本、行数、哈希、导入时间 |
| P2 | 国家别名、检索同义词补充 | 351 条 | `search_synonyms`（term/canonical/kind/weight） | 新国家简称、英文别名、错拼、业务术语 |
| P2 | 免签登记/电子授权细节 | 部分摘要提及 | `visa_policies` 条件/规则 + 来源 | ETA/eTA/登记入口、有效期、费用 |
| P2 | 图片/附件表格（可选） | 无 | 外部素材目录 + 来源字段 | 只存可公开引用素材，记录授权与来源 |

### 5.1 数据补充格式

模板：`data/templates/data-supplement-template.csv`

CSV 列（一行 = 一条可导入的补充事实；明细可用后续批次表扩展）：

```text
country_code,visa_type,route_code,category_code,stay_days,stay_unit,stay_rule,entry_scope,validity_note,application_channel,summary,conditions_text,fee_name,fee_amount,fee_currency,fee_unit,fee_notes,document_name,document_requirement,document_required,document_notes,timing_type,timing_min_days,timing_max_days,timing_notes,rule_field,rule_operator,rule_value,source_title,source_publisher,source_url,source_accessed_at,verified_at,data_status
```

填写原则：

1. **未知就留空/NULL**，不要用 0 表示免费，不要用空数组暗示“无需材料”。
2. 费用、材料、时间、规则必须保留来源与采集时间。
3. 先补 P0 官方来源、费用、材料、时间；再补 P1 规则/类型；最后补 P2 多路线与维护字段。
4. 一条路线只对应一个可说明白的申请手续；不同渠道/加急/入境次数拆分为不同 `route_code`。
5. 演示数据 (`is_demo=1`) 不得与真实数据混算，也不得作为真实结论。

### 5.2 补充后的入库方式

当前项目的数据入口是 `data/source/` → ETL (`scripts/etl.ts`) → `data/generated/dataset.json` → `scripts/db-seed.ts`。新增结构化明细时需要：

1. 在 `data/source/` 放置批次文件（CSV/JSON，可按模板扩展）；
2. 在 `scripts/etl.ts` 增加该批次解析与字段映射（费用/材料/时间/规则/来源）；
3. 运行 `npm run data:build && npm run data:check && npm run db:rebuild`（MySQL 用对应 `db:*:mysql`）；
4. 如界面需要展示明细，再扩展 `client/features/details/CountrySheet.tsx`；当前 v5 界面只展示摘要级字段，不预留空位。

---

## 6. 交接注意事项

- **Node 版本必须 ≥24**；否则 `node:sqlite` 不可用。
- Windows 若生产构建报 `%TEMP%` 权限错误，执行 `setup.cmd`/`start.cmd` 已自动把临时目录设为项目内 `.esbuild-tmp`。
- 端口冲突：启动前设置 `PORT`（如 `$env:PORT=3033`）。
- SQLite 文件位于 `data/visaatlas.sqlite`（不提交仓库）；删除后 `npm run db:rebuild` 重新生成。
- 仓库不提交 `node_modules/`、`dist/`、SQLite 数据库；完整离线包在 `deliverables/` 本地交付。
- 没有外部 API Key；如未来接入底图/汇率，需单独评估授权与隐私。
- API 约定与字段见 `docs/API.md`、`docs/DATA-DICTIONARY.md`。

---

## 7. 常见问题

| 问题 | 处理 |
|---|---|
| 启动提示 Node 版本过低 | 安装 Node.js 24+，重新打开终端 |
| `npm ci` 失败 | 检查网络/npm registry；也可在可联网机器执行 `npm ci` 后使用完整离线包 |
| 页面打不开 | 确认端口 `3001` 未被占用；检查 `/api/health` |
| 地图空白/无 WebGL | 使用 Chrome/Edge 并开启硬件加速；确认浏览器支持 WebGL |
| 数据库没有数据 | 运行 `npm run setup` 或 `npm run db:rebuild` |
| 依赖包体积过大 | GitHub 只保留源码；完整依赖包使用 `deliverables/visaatlas-full-win-x64.zip` 线下交接 |
