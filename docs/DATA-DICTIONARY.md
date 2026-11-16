# Visa Atlas v1.0 · 数据字典

> 数据库结构唯一可执行版本：`database/schema.sql`（SQLite，默认）与 `database/schema.mysql.sql`（MySQL 8，课程数据库路径）。两套结构同构，字段含义相同。
> 种子来源：`data/generated/dataset.json`（由 `scripts/etl.ts` 生成，类型见 `shared/dataset.ts`）。

## 0. 设计原则

1. **一条政策 = 国家 × 签证用途 × 一条可说明白的手续路线**，主键为稳定的 `route_code`（例如 `JP-TOURISM-CN-ORD`）。不把不同渠道的最便宜费用和最快时长拼成一条不存在的路线。
2. **未知就是 NULL**：本轮真实数据只到「摘要级」，费用/材料/审核时间/个人条件规则为空数组；不能用 0 或演示值填充。
3. **真实性可追溯**：每条政策有 `source_id`（来源）与 `batch_id`（导入批次）；`is_demo` + `data_status` 明确区分真实、演示与线索。
4. **未来扩展只换数据**：新增签证类型/国家/批次时，向 ETL 增加数据后重跑 `data:build` 与 `db:seed`，前端与 API 不需要改字段。
5. **搜索路径有索引**：见第 4 节。

## 1. 实体关系

```
regions ─┬─< countries ─┬─< visa_policies >── visa_types
         │              │        │
         │              │        ├──< policy_documents
         │              │        ├──< policy_fees
         │              │        ├──< policy_timings
         │              │        ├──< policy_rules
         │              │        └──> data_sources / data_batches
         │              └─< mentioned_visa_types >── visa_types
         │
policy_groups ─< visa_categories ─< visa_policies

search_synonyms（独立检索辅助表）
app_meta（数据集版本/导入信息）
```

## 2. 表定义

### 2.1 `regions` 地区字典（7 行）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `code` | TEXT/VARCHAR(8) | PK | `EU/AS/AF/NA/SA/OC/AN` |
| `name_zh` / `name_en` | TEXT | NOT NULL | 中文/英文名 |
| `sort_order` | INTEGER | NOT NULL | 展示顺序 |

### 2.2 `visa_types` 签证用途字典（12 行）

`code` PK；`name_zh`、`name_en`、`sort_order`。当前代码：`TOURISM, BUSINESS, STUDY, WORK, FAMILY, TRANSIT, MEDICAL, RESIDENCE, DIGITAL_NOMAD, GOLDEN_VISA, WORKING_HOLIDAY, RESEARCH`。本轮真实数据只填充 `TOURISM`；其余类型的「线索」在 `mentioned_visa_types`，演示明细在 `visa_policies(is_demo=1)`。

### 2.3 `policy_groups` 政策组字典（5 行）

| code | 含义 | 颜色 |
|---|---|---|
| `FREE` | 免签入境（互免/单方面/有条件/免费登记） | `#A0DA26` |
| `ARRIVAL` | 落地签 | `#DFC11D` |
| `ONLINE` | 电子签 / 电子授权 | `#1DC5CE` |
| `PREARRANGED` | 使领馆/签证中心预办 | `#FF633D` |
| `SPECIAL` | 特殊许可、属地、军事/生态管制、无主权地区 | `#8C9AA3` |

字段：`code` PK、`name_zh`、`name_en`、`color`、`description`、`sort_order`。

### 2.4 `visa_categories` 细分签证类别字典（16 行）

| 字段 | 说明 |
|---|---|
| `code` | PK，如 `MUTUAL_FREE`、`VISA_ON_ARRIVAL`、`SCHENGEN_VISA` |
| `name_zh` / `name_en` | 展示名 |
| `policy_group` | FK → `policy_groups.code`，用于五组筛选与地图着色 |
| `requires_visa` | 0/1：是否必须事先取得签证 |
| `requires_authorization` | 0/1：是否仍需授权/预登记/批文（如 ETA、VOA、免费登记） |
| `severity` | 0–13，越大越繁琐，用于排序/视觉编码 |
| `color` | 十六进制颜色 |

16 个类别：`MUTUAL_FREE`、`UNILATERAL_FREE`、`CONDITIONAL_FREE`、`FREE_WITH_REGISTRATION`、`VISA_ON_ARRIVAL`、`E_VISA`、`ETA`、`EMBASSY_VISA`、`SCHENGEN_VISA`、`US_VISA_ROUTE`、`TERRITORY_VISA`、`REGION_PERMIT`、`SPECIAL_PERMIT`、`NO_SOVEREIGN`、`REFERENCE_POLICY`、`HOME_REGION`。

> ETL 把 CSV 原始 76 种中文分类映射到 16 类；原始分类保存在 `visa_policies.source_category`，可回查归一化是否合理。

### 2.5 `countries` 国家与地区目录（250 行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `iso2` | CHAR(2) PK | ISO 3166-1 alpha-2；`XK` 为课程目录中的科索沃，本轮未采集 |
| `name_zh` / `name_en` | VARCHAR | 优先采用小组 CSV 名称，未采集国家取目录名 |
| `region_code` | FK → regions | CSV 的 7 个地区分组 |
| `subregion` | VARCHAR | 目录中的次级地区（仅参考） |
| `sort_key` | VARCHAR | 英文 A–Z 排序键 |
| `aliases` | TEXT JSON | 目录别名 + 常见中英文别称；SQLite 有 `json_valid` 约束 |
| `latitude` / `longitude` | REAL/DECIMAL | 质心坐标（地图兜底点、聚焦用） |
| `priority` | 0/1 | 是否 91 个重点候选目的地 |
| `created_at` / `updated_at` | TEXT/DATETIME | ISO UTC |

### 2.6 `visa_policies` 签证政策（本轮 249 真实 + 22 演示）

| 字段 | 类型 | 说明 |
|---|---|---|
| `route_code` | PK | 稳定路线编号，来自 CSV，或 `ISO2-TYPE-DEMO-NN` |
| `country_code` | FK → countries | 目的地 |
| `visa_type` | FK → visa_types | 本轮真实数据均为 `TOURISM` |
| `category_code` | FK → visa_categories | 归一化类别 |
| `title` | VARCHAR(300) | 展示标题 |
| `summary` | TEXT | 原始一句说明（卡片摘要） |
| `conditions_text` | TEXT | 条件原文（详情引用块） |
| `source_category` | VARCHAR(200) | CSV 原始分类原文（16 类归一化的审计依据） |
| `stay_days` | INT | 停留期数值；未知为 NULL；单位见 `stay_unit` |
| `stay_unit` | VARCHAR(12) | `DAY/MONTH/YEAR` |
| `stay_rule` | VARCHAR(20) | `PER_ENTRY` / `ROLLING_WINDOW` / `UNSPECIFIED` |
| `window_days` / `window_max_days` | INT | 滚动窗口天数与窗口内累计上限，如「180 天内累计不超过 90 天」 |
| `entry_scope` | VARCHAR(12) | `SINGLE/MULTIPLE/UNKNOWN` |
| `validity_note` | TEXT | 签证有效期文字（如「十年多次」） |
| `application_channel` | TEXT | 办理渠道（本轮仅预办类给出泛化说明） |
| `requires_visa` | 0/1 | 来自类别字典 |
| `requires_authorization` | 0/1 | 来自类别字典 |
| `data_status` | VARCHAR(20) | `DETAILED/PARTIAL/SUMMARY_ONLY/DEMO` |
| `completeness` | 0–100 | 展示「资料完整度」；本轮真实数据 40–55（摘要级） |
| `is_demo` | 0/1 | 演示数据边界 |
| `is_visible` | 0/1 | 下架不删除 |
| `source_id` | FK → data_sources | 来源 |
| `batch_id` | FK → data_batches | 批次 |
| `collected_at` / `updated_at` | TEXT/DATETIME | ISO UTC |
| `search_text` | TEXT | ETL 预拼接的检索文本（国家名/别名/分类/摘要/类型线索） |

约束：金额/时长范围、`stay_unit` 与 `stay_days` 成对、`completeness` 0–100、`stay_rule`/`entry_scope`/`data_status` 枚举、外键完整性。

### 2.7 `mentioned_visa_types` 签证类型线索（本轮 569 行）

| 字段 | 说明 |
|---|---|
| `country_code` + `visa_type` | 复合主键 |
| `raw_text` | CSV「其他常见签证类型」原文 |
| `source_id` | 来源 |

用途：当用户筛选商务/留学/工作等尚未采集明细的类型时，搜索返回「仅类型线索」结果，而不是空结果或伪造数据。

### 2.8 `policy_documents` / `policy_fees` / `policy_timings` / `policy_rules`

真实数据本轮为空数组（诚实表示未采集）；演示明细只作为未来字段/检索回归夹具保留在后端，v4 界面不展示。

- `policy_documents(route_code, code, name, requirement, quantity, is_required, condition_text, sort_order)`
- `policy_fees(route_code, code, label, amount_min, amount_max, currency, charge_basis, condition_text, comparable)`：金额用 DECIMAL(12,2)（MySQL）/ TEXT（SQLite），`comparable` 标记能否跨路线比较。
- `policy_timings(route_code, code, label, min_days, max_days, day_type, start_event, note, sort_order)`：区分工作日/自然日与起算事件。
- `policy_rules(route_code, code, field_name, operator_name, expected_value JSON, description)`：`IN/ANY_OF/GTE/LTE/BETWEEN`，可解释、可回溯。

### 2.9 `data_sources` 来源（本轮 2 行）

`source_id` PK、`title`、`publisher`、`url`、`kind`、`accessed_at`、`status`、`note`。
真实来源：`src-group-csv-249`（小组整理的 CSV，`SINGLE_SOURCE`）；演示来源：`src-demo-samples`（`DEMO`）。

### 2.10 `data_batches` 导入批次（本轮 2 行）

`batch_id` PK、`name`、`source_file`、`imported_at`、`row_count`、`notes`。用于回答「这批数据哪来的、什么时候进来的」。

### 2.11 `search_synonyms` 检索同义词（本轮 351 行）

`term` PK、`canonical`、`kind`（`COUNTRY/CATEGORY/TYPE/KEYWORD`）、`weight`。例：`英国 → GB`、`商签 → BUSINESS`、`落地签 → VISA_ON_ARRIVAL`。搜索服务把用户词扩展为同义命中，提升中文口语检索体验。

### 2.12 `app_meta` 元数据

键值对：`schema_version`、`dataset_version`、`generated_at`、`imported_at`、`source_file`、`source_hash`、`policy_count`、`country_count`。API 的 `/overview` 与页脚会展示数据集版本。

## 3. 视图

- `v_country_map`：每国一行，LEFT JOIN 旅游签政策，输出 `tourism_route_code / category_code / stay_days / completeness / has_data / has_demo_detail`，供地图着色与统计复用。
- `v_policy_cards`：政策 JOIN 国家/类型/类别/政策组，输出卡片所需的全部展示字段；检索 SQL 与详情页字段保持一致。

## 4. 索引清单

| 表 | 索引 | 用途 |
|---|---|---|
| countries | `region_code`、`sort_key` | 地区筛选、A–Z 排序 |
| visa_policies | `(country_code, visa_type, is_visible)` | 国家 × 类型查询 |
| visa_policies | `(visa_type, is_visible, is_demo)` | 用途筛选、演示开关 |
| visa_policies | `(category_code, is_visible)` | 类别/政策组筛选 |
| visa_policies | `(stay_days)` | 停留期分桶 |
| visa_policies | `(data_status, is_visible)`、`(completeness)` | 资料状态筛选、完整度排序 |
| mentioned_visa_types | `(visa_type)` | 类型线索检索 |

## 5. 数据成熟度与界面映射

| `data_status` | 中文 | 界面表现 |
|---|---|---|
| `SUMMARY_ONLY` | 摘要级资料 | 政策类别、停留期、原文摘要；费用/材料/时间字段未采集，v4 界面不预留空位 |
| `PARTIAL` | 部分明细 | 已有部分结构化字段 |
| `DETAILED` | 完整明细 | 完整材料/费用/时间/规则 |
| `DEMO` | 演示明细 | 仅后端夹具，API 保留 `is_demo` 边界；v4 UI 不展示，不与真实结论混淆 |
| `MENTION_ONLY`（检索期生成） | 仅类型线索 | 提示「来源仅标注该类型，结构化明细待采集」 |

## 6. 扩展数据时要遵守的规则

1. `route_code` 一旦发布不再改变；下架用 `is_visible=0`，不物理删除历史事实。
2. 新增事实必须有 `source_id`；没有可靠来源的字段保持 NULL。
3. 演示数据必须 `is_demo=1`，routeCode 带 `DEMO`，不能混入真实批次。
4. 新增签证类型先在 `VISA_TYPES`（`shared/contracts.ts`）声明，再在 `visa_types` 字典表出现；前端自动识别。
5. 金额用字符串（两位小数）输出，币种用 ISO 4217；不能把不同币种直接比较。
6. 停留期不要用「月 × 30」近似写入真实值；用 `stay_unit=MONTH` 表达，筛选时再由服务层近似分桶。
