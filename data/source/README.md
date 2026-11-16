# data/source · 数据来源、批次与演示夹具说明

> **数据成熟度提醒：** 本轮真实数据只有「摘要级」旅游签信息（政策分类 + 一句说明），**没有费用、材料、审核时间**。
> `demo-details.json` 是**明确标注为虚构的演示明细**，只用于验证未来类型扩展的入库/检索流程与字段契约，**不代表任何国家真实政策，不可用于申请**。v4 起前端不再展示演示明细，仅保留在后端作为回归夹具。
> 本目录所有内容都是课程项目资料整理，不构成签证、法律或出行建议。

本文档说明 `data/source/` 下三份输入文件的来源、字段含义、使用边界与未来扩展方式。
数据链路的唯一事实来源是 `shared/contracts.ts`（字段/枚举）与 `shared/dataset.ts`（ETL 产物结构）：

```
data/source/global_249_countries_cn_passport_visa.csv   真实摘要（小组整理，2026-11）
data/source/demo-details.json                           虚构演示明细（batchId = demo-details-1）
data/source/synonyms.json                               检索同义词（term → canonical）
                │
                ▼  scripts/etl.ts（解析、分类归一化、停留期抽取、批次合并、完整度评分）
data/generated/dataset.json → data/generated/report.json
                │
                ▼  scripts/db-seed.ts / db-seed-mysql.ts
SQLite（默认）或 MySQL 8 的 visa_policies / search_synonyms 等表
                │
                ▼
Fastify API（/api/v1/overview · search · suggest · countries/:iso2 · route/:routeCode）
```

`data/generated/` 是 ETL 产物，**不要手工编辑**；所有数据修改都发生在 `data/source/`（或未来的新批次文件）里，然后重跑 ETL 与种子脚本。

---

## 1. 数据来源与批次

| 文件 | 性质 | 当前内容 | 被谁消费 |
|---|---|---|---|
| `global_249_countries_cn_passport_visa.csv` | **真实摘要** | 249 个目的地（目录 250 项中缺 `XK`）的旅游签分类 + 一句说明 | `scripts/etl.ts` → 真实 `visa_policies` / `mentioned_visa_types` |
| `demo-details.json` | **虚构演示** | 22 条演示明细，覆盖 10 种签证类型、9 个国家 | ETL 合并为 `data_status = DEMO`、`is_demo = 1` 的路线 |
| `synonyms.json` | 检索辅助 | 351 条同义词映射（国家/类别/类型/关键词） | ETL 合并进 `search_synonyms` 表，供检索与联想扩展召回 |

- **CSV 来源：** 课程小组自行整理的《中国普通护照 249 国旅游签摘要》，采集/整理时间 **2026-11**。每一行是「一个目的地 × 旅游目的」的一条摘要，不是官方数据库的完整镜像。
- **批次元信息（可复核）：**
  - CSV 行数 249（不含表头），唯一 ISO2 也是 249；UTF-8（带 BOM）、LF 换行，36,409 字节；
  - CSV SHA-256：`ad7416b1d779bcf8a7f741cda44a0d465efc67b363509e874028084316570558`；
  - 目录 `data/countries.json` 共 250 项，来自 `world-countries@5.1.0`（见第 7 节许可），其中 `XK` 在本批 CSV 中没有政策行；
  - 演示批次 `batchId = demo-details-1`、`generatedAt = 2026-11-16T00:00:00.000Z`（`schemaVersion = 2.0`）；
  - 同义词表 `schemaVersion = 1.0`。

> 换批次时请在本表/本段追加新批次的文件名、行数、哈希与日期，**不要改写历史批次的描述**。

---

## 2. CSV 各列含义

表头（8 列，按顺序）：

| 列名 | 含义 | 进入数据集后的用途 | 注意事项 |
|---|---|---|---|
| `国家/地区代码 (ISO2)` | ISO 3166-1 alpha-2 两位代码 | 关联 `countries.iso2`，检索/地图主键 | 必须存在于 `data/countries.json`；本批 249 个 |
| `大洲分组 (Region)` | 大洲分组（EU/AS/AF/NA/SA/OC/AN） | 归一到 `REGIONS` 的 7 个区域 | 地图分组与分面筛选用；不代表地理边界结论 |
| `中文名称` | 国家/地区中文名 | 检索文本、展示名 | 与目录名称不一致时以目录 + 别名共同召回 |
| `英文名称` | 国家/地区英文名 | 检索文本（英文搜索） | **部分英文名含逗号（如 `Bolivia, Plurinational State of`），CSV 用双引号包裹——必须使用标准 CSV 解析器，不能按 `,` 直接 split** |
| `推荐路线编号 (route_code)` | 稳定路线编号，形式 `<ISO2>-TOURISM-CN-ORD`；中国本国行为 `CN-DOMESTIC-HOME` | 真实政策行的稳定主键 `visa_policies.route_code` | **一经发布不可改名**；未来同国同用途的不同渠道用不同 routeCode |
| `中国护照通行政策分类` | 小组整理的原始中文分类（本批有 76 种写法） | ETL 归一化为 `shared/contracts.ts` 的 16 个 `VISA_CATEGORIES`、5 个 `POLICY_GROUPS` | 大量复合分类（如「电子签证/落地签」「有条件免签/预办签证」）存在解释空间；归一化规则应在 ETL 与 `report.json` 中可审查 |
| `旅游签证及免签/落地签说明` | 一句话摘要（可含停留期、入境次数、条件） | 作为 `summary` 原文；ETL 从中启发式抽取 `stay_days / entry_scope` | **只是摘要**；抽取不到时保留 `null`，不得猜测补全；不要把摘要当逐条官方依据 |
| `其他常见签证类型 (商务/留学/工作等)` | 该国「还存在哪些类型」的类型线索文本 | 生成 `mentioned_visa_types`，检索时显示为 `MENTION_ONLY` 类型线索卡 | **只是线索，不是结构化事实**：不能据此写费用/材料/时间，也不能生成真实政策行 |

设计原则：**「摘要级」列只承载摘要级事实。** 任何「未知」都用 `null` / 空数组表示，不用 0 或空数组暗示「免费」「无需材料」。

---

## 3. `demo-details.json` — 虚构演示明细（不可用于申请）

### 3.1 它是什么

本轮真实数据只有旅游签摘要，无法验证未来「商务 / 留学 / 工作 / 探亲 / 医疗 / 居留 / 数字游民 / 黄金签证 / 打工度假 / 科研访学」等类型的界面、明细结构、筛选与检索。因此提供一份**结构齐全、数值合理、但内容明确虚构**的演示明细：

- 顶层字段：`schemaVersion`（`"2.0"`）、`batchId`（`"demo-details-1"`）、`generatedAt`、`note`、`policies`；
- 当前 **22 条**演示政策，覆盖 **10 种**签证类型：
  `BUSINESS`、`STUDY`、`WORK`、`FAMILY`、`MEDICAL`、`RESIDENCE`、`DIGITAL_NOMAD`、`GOLDEN_VISA`、`WORKING_HOLIDAY`、`RESEARCH`；
- 涉及 **9 个国家**：JP、GB、US、FR、DE、SG、AE、NZ、TH；
- 每条包含 4–6 份材料、1–2 项费用、1–2 项办理时间、0–2 条资格规则；`completeness` 在 70–95 之间，故意不完全相同；
- `routeCode` 格式 `<ISO2>-<TYPE>-DEMO-NN`，与真实 CSV 路线编号（`...-CN-ORD` / `...-DOMESTIC-HOME`）不会冲突；
- `visaType` / `categoryCode` 必须来自 `shared/contracts.ts`；`requiresVisa` / `requiresAuthorization` 必须与类别定义一致；
- `rules.fieldName` 只允许 `passportCountryCode`、`residenceCountryCode`、`age`、`employment`、`passportValidityMonths`、`heldVisaCodes`；`operatorName` 只允许 `IN`、`ANY_OF`、`GTE`、`LTE`、`BETWEEN`；`expectedValue` 是**合法 JSON 字符串**（如 `"[\"CN\"]"`、`"6"`、`"[18,30]"`）；
- 费用金额使用两位小数字符串，币种使用 ISO 4217 三位大写代码（本批用到 JPY / GBP / USD / EUR / SGD / AED / NZD / THB）。

### 3.2 使用边界（必须遵守）

1. **持续标注：** 每条 `title` 都含「演示样本」，`summary` / `applicationChannel` 都含「演示」；ETL 写入时置 `data_status = DEMO`、`is_demo = 1`。API 返回仍带 `is_demo`；v4 UI 不再展示演示明细，但后端标注保留。
2. **默认不出现：** 检索默认 `includeDemo = false`，只有显式开启演示开关（API `demo=1`）或国家档案中显式请求时才返回；`mentions` 线索不受演示开关影响。
3. **不可用于申请与比较：** 演示数据不得用于真实申请、真实预算对比、真实资格判断；不得与真实数据混算「平均完整度」「最低费用」「最快出签」等统计。演示的 `completeness` 仅表示夹具字段填充程度，**不是真实资料核验程度**。
4. **不可反推真实政策：** 某国出现某演示类型，只说明「夹具覆盖了该类型」，**不能说明该国真实存在该签证**。真实类型线索以 CSV 最后一列与权威来源为准。
5. **规则值是演示占位：** 例如 `employment` 的 `EMPLOYED / SELF_EMPLOYED / FREELANCER`、`heldVisaCodes` 的 `US / GB / SCHENGEN` 只是夹具约定，未与真实签证代码表签订完整语义；不可当作真实可判定资格。
6. **修改纪律：** 新增/编辑演示条目时必须保持虚构标注与 `DEMO-NN` 编号、`routeCode` 唯一，并同步更新 `tests/fixtures.test.ts` 覆盖的数量/枚举约束；**禁止**把演示内容改写成真实政策口吻或去掉「演示」字样。

### 3.3 字段与 ETL 产物的关系

演示条目的字段与 `shared/dataset.ts` 的 `DatasetPolicy` / 明细结构对齐，但**不是**完整 ETL 产物：`dataStatus`、`isDemo`、`sourceId`、`collectedAt`、`updatedAt`、`batchId`、`searchText` 等由 ETL 依据批次补齐（演示来源、导入时间、`is_demo = 1`）。演示明细不提供真实来源 URL，来源状态必须是演示（`DEMO`），不能伪造为已核验来源。

---

## 4. `synonyms.json` — 检索同义词

结构：

```json
{ "schemaVersion": "1.0", "terms": [{ "term": "英国", "canonical": "GB", "kind": "COUNTRY", "weight": 40 }] }
```

| `kind` | `canonical` 含义 | 典型用途 |
|---|---|---|
| `COUNTRY` | `data/countries.json` 中存在的 ISO2 代码 | 「英国」→ `GB`、「美国」→ `US`、「UAE」→ `AE`，扩展中英文名/缩写/常见别称召回 |
| `CATEGORY` | `shared/contracts.ts` 中 `VISA_CATEGORIES` 的类别代码 | 「互免」→ `MUTUAL_FREE`、「落地签」→ `VISA_ON_ARRIVAL`、「电子签」→ `E_VISA`，扩展口语分类召回 |
| `TYPE` | `shared/contracts.ts` 中 `VISA_TYPES` 的类型代码 | 「商签/商务签证」→ `BUSINESS`、「留学签/学生签」→ `STUDY`，扩展类型口语召回 |
| `KEYWORD` | 可检索短语（不要求是枚举代码） | 「visa free」→「免签」、「绿卡」→「永居」，补充摘要文本层面的召回 |

- 当前共 **351 条**：`COUNTRY` 221、`CATEGORY` 44、`TYPE` 45、`KEYWORD` 41。
- `term` **不区分大小写唯一**（数据库用 `COLLATE NOCASE` 主键约束），同一个 term 只能有一个 `canonical`，不允许互相冲突的映射。
- `weight` 范围 10–40，用于检索排序加权；精确中文全称/常见中文简称给较高权重，缩写/别名给较低权重。
- 维护规则：
  1. 新增前先查 term 是否已存在（忽略大小写）；
  2. `COUNTRY` 的 canonical 必须是目录里的 ISO2，**不能用地名/城市/非目录代码**（「迪拜」作为阿联酋的检索别名是常见搜索习惯，但 canonical 仍是 `AE`）；
  3. `CATEGORY` / `TYPE` 的 canonical 必须来自共享字典；类别代码里**没有** `TRANSIT` 类别（过境是签证类型 `TRANSIT`），这类口语词请映射到最接近的类别或放到 `KEYWORD`；
  4. 缩写（`US`、`IN`、`IT`、`NO` 等）与英文普通词可能撞词，依靠检索分词与权重兜底，不保证语义完美；
  5. 修改后运行 `npx.cmd tsx --test tests/fixtures.test.ts` 校验唯一性、枚举合法性与数量下限。

---

## 5. 数据成熟度（SUMMARY_ONLY → PARTIAL → DETAILED）

| 状态 | 含义 | 本项目当前用法 |
|---|---|---|
| `SUMMARY_ONLY` | 只有政策分类 + 一句摘要，明细待采集 | **249 条真实旅游签路线就是这一级**：无费用、材料、审核时间 |
| `PARTIAL` | 已有部分结构化明细（如费用与材料），其余待补 | 未来补采真实明细时使用 |
| `DETAILED` | 费用、材料、办理时间、资格规则、来源均已收集并复核 | 未来目标状态 |
| `DEMO` | 虚构演示明细 | 22 条演示路线，只在显式开启演示时展示 |
| `MENTION_ONLY` | 不是政策行，而是检索结果状态：仅有「其他常见签证类型」线索 | 切换非旅游类型且无结构化政策时展示，不伪造字段 |

成熟度原则（与 `docs/ARCHITECTURE.md`、`shared/contracts.ts` 一致）：

1. **未知就留空：** `null` 表示「未采集/未公开」，不是 0，也不是「免费/无需材料」；空数组要区分「无需材料」与「未采集」。
2. **不编造、不混合：** 费用、材料、审核时间、资格规则的真实值与演示值不得混算；演示数据的 `completeness` 不参与真实资料覆盖率统计。
3. **升级路径：** 新批次补到费用/材料/时间/规则 → `PARTIAL`；再补齐来源、字段级核验与复核时间 → `DETAILED`。升级只改数据与状态，不改 API/前端字段（字段一次到位）。
4. **覆盖不要用单一百分比：** 覆盖面 = 目的地清单 × 用途 × 申请人范围 × 渠道 × 明细完整度 × 来源可访问性，分开汇报。

---

## 6. 如何追加真实批次

> 数据契约：先读 `shared/contracts.ts`（枚举/字段）与 `shared/dataset.ts`（ETL 产物结构）。**不要为了塞进数据而改字段含义**；确需改契约时，`shared/` 是只读协作区，必须先评审并同步所有消费方（ETL、种子、API、前端、测试）。

1. **新增文件，不改历史：** 在 `data/source/` 放入新批次文件（CSV 或与 `DatasetPolicy` 同构的 JSON），文件名带日期/批次标识。历史批次文件保留，便于重放与 diff。
2. **遵守结构：** JSON 批次顶层与 `shared/dataset.ts` 的 `DatasetFile`/`DatasetPolicy` 保持一致；未知事实用 `null`，必填的技术标识（版本、状态、数组结构）不能省。
3. **`routeCode` 稳定：** 一条路线一个稳定编号（如 `JP-TOURISM-CN-ORD`、`JP-BUSINESS-CN-DEMO-01`）。**已发布编号永不改名、永不复用**；同一条路线更新是「覆盖该路线 + 记录新批次/新版本」，不是换编号。
4. **来源字段必填（真实批次）：** 每条真实路线需可回溯来源：`sourceId`（对应来源表/来源清单）、`collectedAt`、`updatedAt`、`dataStatus`、`isDemo = false`；来源至少含标题、发布方、公开 URL、`accessedAt`、核验状态。**演示/未核验内容不能写成真实来源。**
5. **不要覆盖已核验事实：** 新批次只补充/新增自己的路线；修正已发布的事实要显式记录变更（新批次 + 复核说明），保留历史；下架用 `isVisible = false`，不做物理删除。
6. **在 ETL 中登记批次：** 在 `scripts/etl.ts` 增加/更新该批次的解析与合并规则（真实批次按 `DatasetPolicy` 落库；`demo-details.json` 继续按演示批次合并为 `DEMO`；`synonyms.json` 合并进 `search_synonyms`）。批次信息（文件、行数、哈希、导入时间、备注）进入 `data_batches` / `report.json`。
7. **重建并验证（Windows PowerShell 用 `npm.cmd` / `npx.cmd`，避免 `.ps1` 执行策略拦截）：**

```powershell
npm.cmd run data:build        # 重新生成 data/generated/dataset.json 与 report.json
npm.cmd run data:check        # 数据质量检查
npm.cmd run db:rebuild        # SQLite：重建 schema 并导入种子数据
# MySQL：npm.cmd run db:init:mysql && npm.cmd run db:seed:mysql
npm.cmd test                  # 全量测试（含 API/搜索/夹具校验）
npx.cmd tsx --test tests/fixtures.test.ts   # 仅校验 demo/synonyms 夹具
```

8. **验收口径：** 新批次必须能解释「新增了多少国家/用途/路线、哪些字段仍为 null、来源核验到什么程度」；不得为了通过覆盖率或测试而删字段、删国家、伪造明细。

---

## 7. 许可与免责声明

- **国家/地区目录：** `data/countries.json` 由 `world-countries@5.1.0`（上游 <https://github.com/mledoze/countries>）生成，许可证 **ODbL-1.0**。完整许可见 `data/LICENSE-ODbL.txt`，署名与使用边界见 `data/ATTRIBUTION.md`：再分发派生目录需遵守 ODbL 的署名/同方式共享要求，不要移除原始许可。地理目录**不是**签证政策依据，坐标只是示意中心点。
- **政策内容：** CSV 与批次整理来自课程小组从公开信息的人工汇总（2026-11 及后续批次），**未经使领馆逐条核验**；引用需保留来源与采集时间，注意原站条款。`demo-details.json` 的内容为**完全虚构**的演示文本。
- **免责声明：** Visa Atlas 是课程项目：资料由小组从公开信息整理，未经使领馆逐条确认，不构成签证、法律或出行建议，请以官方最新公告为准。演示数据不可用于任何真实申请或决策。
- 应用代码的开源许可由仓库所有者另行决定；本目录数据许可不自动覆盖代码，也不自动授予对上游数据的额外权利。
