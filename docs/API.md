# Visa Atlas v1.0 · API 约定

- Base URL（开发）：`http://127.0.0.1:3001`，Vite 通过 `/api` 代理；构建后同源。
- 响应包裹：成功 `{ "data": ... }`；失败 `{ "error": { "code": "...", "message": "中文可展示文案", "details"?: [...] } }`。
- 所有 API 响应 `Cache-Control: no-store`，`X-Content-Type-Options: nosniff`。
- 类型定义唯一来源：`shared/contracts.ts`。字段名以该文件为准，本文件只做行为说明。
- SQLite 模式为默认；`DB_DRIVER=mysql` 时连接 `.env` 的 MySQL，两种模式响应结构完全一致。

## 1. GET /api/health

```json
{ "data": { "status": "ok", "mode": "sqlite", "datasetVersion": "2026-11-16-csv-249", "uptimeSeconds": 12.4 } }
```

## 2. GET /api/v1/overview

首屏一次拉取：数据集元信息、统计、地图着色数据、全部字典、分面基础计数。

```ts
{ data: OverviewResponse }
```

`OverviewResponse` 包含：
- `meta`：`schemaVersion / datasetVersion / mode / generatedAt / importedAt / sourceFile / sourceHash / policyCount / countryCount / demoPolicyCount / categoryCount / typeCount / disclaimer`
- `stats`：国家数、政策数、有资料/无资料国家数、91 个重点候选、演示条数、平均完整度、政策组分布、地区覆盖、签证类型覆盖
- `mapCountries: MapCountry[]`：250 个国家的旅游签着色数据（含无资料国家）
- `dictionaries`：regions / types / categories / groups / stayBuckets

## 3. GET /api/v1/search

查询参数（全部可选）：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `q` | string | `""` | 关键词，≤ 80 字符；先做**知识图谱实体解析**（国家/地区/政策组/类别/签证类型，含别名与同义词），命中实体则按实体→国家/类型边精确取集合；未命中实体才回退空格分词 AND 全文检索 |
| `type` | string | `TOURISM` | 签证用途代码（`VISA_TYPES`）；未知代码 400 |
| `region` | `EU,AS,...` | 空 | 地区多选 |
| `group` | `FREE,ARRIVAL,...` | 空 | 政策组多选 |
| `category` | `MUTUAL_FREE,...` | 空 | 细分类别多选；与 group 同时出现时取交集 |
| `stay` | `D8_30,...` 或 `UNKNOWN` | 空 | 停留期分桶多选 |
| `status` | `DETAILED,PARTIAL,SUMMARY_ONLY,MENTION_ONLY` | 空 | 资料状态多选 |
| `priority` | `1` | 空 | 只看 91 个重点候选目的地 |
| `demo` | `1` | 空 | 包含演示明细（默认不包含；`MENTION_ONLY` 线索不受此开关影响） |
| `sort` | `relevance\|name\|stay_desc\|completeness` | relevance | 排序 |
| `page` | int ≥ 1 | 1 | 页码 |
| `pageSize` | int 1–96 | 24 | 每页条数 |

响应：`{ data: SearchResponse }`，其中：

- `items: SearchItem[]`
  - `matchKind = "POLICY"`：该国家该用途有结构化政策行；
  - `matchKind = "MENTION_ONLY"`：只在 CSV「其他常见签证类型」列中出现过，`categoryCode/stayDays/summary` 为空，`dataStatus = "MENTION_ONLY"`；
  - `dataStatus`：`DETAILED/PARTIAL/SUMMARY_ONLY/DEMO/MENTION_ONLY`；
  - `isDemo`、`completeness`、`priority` 用于角标与排序。
- `facets`：`regions / groups / categories / types / stays / statuses` 数组，每项 `{code,label,count,color?}`。**分面计数规则：该维度计数忽略自身已选筛选，保留其他维度筛选与关键词**（标准分面语义）。
- `matchedCountries: string[]`：当前筛选命中的全部国家 ISO2 去重集合，前端用于地图高亮/变暗。
- `graph?: { used: true; matched: {type,code,label}[]; path: string }`：知识图谱优先检索命中结果与可解释路径；未命中实体时省略。例如 `q=美国` 返回 `国家·美国`，`q=免签` 返回 `政策组·免签入境`，`q=商务签` 返回 `签证类型·商务访问`。
- `total / page / pageSize / pageCount / tookMs / mode / datasetVersion`。

错误：`400 VALIDATION_ERROR`（参数非法）、`503 DATA_UNAVAILABLE`（数据库不可用）。

## 4. GET /api/v1/suggest?q=

`q` 1–40 字符；返回 `{ data: Suggestion[] }`，最多 8 条，按「国家 > 别名 > 政策类别 > 签证类型」排序。空 q 返回 `[]`。用于搜索框下拉，不用于结果分页。

## 5. GET /api/v1/countries/:iso2?demo=1

`iso2` 两位大写字母。返回 `{ data: CountryDossier }`：

- `country`：国家目录字段（`CountryInfo`）；
- `policies`：真实政策 `PolicyRecord[]`（当前每国最多 1 条旅游签；未来可有多种用途）；
- `demoPolicies`：演示明细（仅 `demo=1` 时返回，默认 `[]`）；
- `mentions`：`其他常见签证类型` 线索；
- `tourism`：旅游签主政策或 `null`；
- `source`：主来源 `SourceInfo`；
- `stats`：`policyCount / demoCount / mentionCount / maxCompleteness / regionLabel`。

目录内但本轮未采集的国家（如 `XK`）返回 200 + 空政策；目录外代码返回 `404 NOT_FOUND`。

## 6. GET /api/v1/route/:routeCode

单条路线完整记录 `PolicyRecord`，用于分享链接/深链。格式不符 400，未找到或不可见 404。

## 7. 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 查询参数格式/枚举非法，`details` 给出字段 |
| 404 | `NOT_FOUND` | 国家/路线不存在或未公开 |
| 429 | `RATE_LIMITED` | 超过 240 次/分钟 |
| 500 | `INTERNAL_ERROR` | 未预期异常，不返回堆栈 |
| 503 | `DATA_UNAVAILABLE` | 数据库未初始化/连接失败 |

## 8. 缓存、安全与并发

- 只读 API；没有公共写接口。数据更新只通过本地 `npm run db:seed`（或 MySQL 种子脚本）。
- 参数化 SQL；动态排序字段使用白名单映射；`pageSize` 上限 96。
- API 关闭缓存；前端请求带 `AbortController`，旧请求不覆盖新结果。
- 演示数据必须由 `demo=1` 显式请求或在国家档案中展示，并在 UI 持续标注。

## 9. 数据更新流程（未来扩展）

```powershell
# 1. 把新批次 CSV / JSON 放进 data/source/
# 2. 修改 scripts/etl.ts 中该批次的解析与合并（已内置 demo-details.json 合并）
npm run data:build
npm run data:check
npm run db:rebuild            # SQLite；MySQL 用 db:init:mysql + db:seed:mysql
```

新增签证类型时只需数据里出现该 `visaType` 代码并已在 `VISA_TYPES` 声明；前端筛选器与徽章会自动出现，无需改 UI 代码。
