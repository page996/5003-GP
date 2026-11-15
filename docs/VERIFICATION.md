# 验收记录（Visa Atlas v1.0.0）

> 验收日期：2026-11-16（本机） · Node.js **24.13.0** · npm **11.6.2** · Chrome **157.0.8103.52** · MySQL **8.0.46**（隔离实例，仅用于 MySQL 模式验收）
> 数据集版本：`v1.0.0-csv249-demo22-syn351-f8887472`（内容指纹随数据修订变化）
> 说明：以下是本机实测记录，不代表远程 CI 或官方数据核验；真实签证政策仍为「摘要级」，见 README 与 `docs/AUDIT-BASE.md`。

## 1. 数据链路

| 步骤 | 命令 | 结果 |
|---|---|---|
| ETL | `npm run data:build` | ✔ 250 国 / 249 条真实旅游签 / 22 条演示明细 / 569 条类型线索 / 351 条同义词；76 种原始分类全部归一化；0 条未映射分类 |
| 数据校验 | `npm run data:check` | ✔ 结构、枚举、外键引用、路线唯一性、真实/演示边界、来源与批次全部通过（仅 2 条预期警告：CN 本国政策、XK 未采集） |
| 地图几何 | `npm run geo:build` | ✔ 241 个 TopoJSON 要素 → 236 个目录国家 path + 14 个微国家点；250/250 目录国家有投影质心；文件 1,168,278 bytes |
| SQLite 种子 | `npm run db:rebuild` | ✔ 15 表 / 2 视图；250 国 / 249 真实 / 22 演示 / 569 线索 / 351 同义词；材料 123 / 费用 33 / 时间 35 / 规则 32 |
| MySQL 种子 | `npm run db:init:mysql` + `db:seed:mysql` | ✔ 15 表 / 2 视图；行数与 SQLite 一致；`db:check:mysql` 列名完全一致 |
| 幂等性 | 重复 `db:seed` | ✔ 结果一致，无重复行 |

## 2. 自动化测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 全量 Node 测试 | `npm test` | **77 tests / 76 pass / 0 fail / 1 skipped**（MySQL 用例未显式启用时跳过），826ms |
| MySQL 集成 | `npm run test:mysql`（`DB_DRIVER=mysql` 指本机 3307） | **5 / 5 pass**，704ms |
| 地图几何守护 | `npx tsx --test tests/geo.test.ts` | **8 / 8 pass** |
| 演示/同义词夹具 | `npx tsx --test tests/fixtures.test.ts` | **26 / 26 pass** |
| TypeScript | `npx tsc --noEmit` | **0 errors**（strict） |
| 浏览器 E2E | `npm run e2e`（开发 5173 与生产 3033 各跑一次） | **17 / 17 通过**：地图 236 多边形、首屏 24 卡、搜索日本收窄、国家档案、待采集字段、地图悬停浮层、亚洲筛选 49、列表模式、演示开关、数据说明弹层、0 console error、0 pageerror |
| 截图 | `npm run screenshots` | 8 张：`docs/screenshots/explore.png`、`map-hover.png`、`search.png`、`dossier.png`、`filters-asia.png`、`list-view.png`、`demo-business.png`、`explore-1920.png` |

测试覆盖要点：API 默认搜索 249、分面与总数一致性、分页/排序、同义词与分词 AND、`type=BUSINESS` 的 MENTION_ONLY、`demo=1` 的同国同类型真实优先、SQL 注入式关键词、404/400/503/429 错误信封、seed 幂等与外键、SQLite/MySQL 表列索引同构、XK 空档案、国家档案 rules 字段。

## 3. API 冒烟（SQLite / MySQL 两种模式一致）

| 接口 | 观察 |
|---|---|
| `GET /api/health` | `{status:"ok", mode:"sqlite"|"mysql", datasetVersion, uptimeSeconds}` |
| `GET /api/v1/overview` | 250 国、249 真实政策、22 演示、5 政策组、12 用途、250 个 mapCountries；首屏一次请求 |
| `GET /api/v1/search?type=TOURISM` | total 249，pageSize 24，pageCount 11，`tookMs` 6–17ms（SQLite）/ 27ms（MySQL） |
| `GET /api/v1/search?q=日本` | total 1，首位 JP，`matchedCountries=["JP"]` |
| `GET /api/v1/search?region=AS` | total 49；合成分面的 region 计数仍为 249（标准分面语义） |
| `GET /api/v1/search?group=FREE` | total 73，五组合计 249 |
| `GET /api/v1/search?type=BUSINESS`（demo 关） | 179 条 MENTION_ONLY，无伪造政策行 |
| `GET /api/v1/search?type=BUSINESS&demo=1` | 179 条中 5 条演示明细卡（JP/SG/US/FR/AE） |
| `GET /api/v1/countries/JP?demo=1` | 1 条真实政策 + 3 条演示明细；演示明细含材料/费用/时间/资格规则 |
| `GET /api/v1/countries/XK` | 200 空政策（目录内、本轮未采集） |
| `GET /api/v1/suggest?q=英国` | 去重后的国家建议 |
| 错误 | 非法 `pageSize/sort/type/category/region/stay` → 400 VALIDATION_ERROR + 字段 details；未知国家/路线 → 404；未初始化/连接失败 → 503 DATA_UNAVAILABLE |

性能（db-core 25 次采样，真实数据）：默认搜索 p50 **7.6ms** / p95 **9.6ms**；关键词最慢 p95 **33ms**（要求 <150ms）。

## 4. 生产构建与托管

```powershell
$env:TEMP='E:\dsh-new-1\visaatlas\.esbuild-tmp'; $env:TMP=$env:TEMP   # 仅本机防 Windows 临时目录 ACL 干扰
npm run build
$env:PORT='3033'; npm start
```

- `tsc --noEmit` 通过；Vite 构建：`dist/assets/index-*.js` 1,488.44 kB（gzip 427.51 kB，含 1.1MB 地图几何）、CSS 64.30 kB（gzip 14.65 kB）、字体 9 个 woff2 ≤ 36.6 kB。
- 生产同源验证：`/` 200、bundle 200、`/api/health` 200、`/api/v1/search` 200、SPA 深链回退 200、缺失 `/assets/not-exists.js` 正确返回 **404**。
- 对生产模式（3033）重跑浏览器 E2E：17/17 通过，无 console/pageerror。

## 5. 浏览器与视觉验收

- 视口：1440×900、1920×1080、1280×800、1180×800 均无整页横向/纵向滚动，三栏不重叠；1180 为设计下限。
- 截图：首屏（深墨蓝地图工作台）、地图悬停（国家边界发光+浮层）、搜索、国家档案、地区筛选、列表模式、演示明细、1920 宽屏。
- 交互：地图拖拽/滚轮/按钮缩放/双击/重置、悬停浮层、点击国家聚焦并打开档案、地区 hover 联动、筛选与检索服务端联调、加载更多/排序、URL 查询参数同步（含深页码恢复）、`/` 聚焦、Esc 关闭联想/清空、演示开关金色提示、数据说明弹层、空态/错误态/重试。
- 可访问性：输入 combobox + aria-activedescendant、按钮 aria-label、地图 SVG role/aria-label/`<title>`、焦点可见、`prefers-reduced-motion` 降级；右侧结果列表提供地图点击的键盘等价路径。

## 6. 未验证 / 已知限制

1. **MySQL 只在隔离本机实例验证**（127.0.0.1:3307，库 `visa_atlas`）；未验证远程/生产网络、TLS、权限最小化与备份策略。
2. **真实政策仅摘要级**：费用、材料、审核时间、逐国官方链接与完整个人条件规则未采集；演示明细为虚构，不可用于申请。
3. **34 个复合分类**按来源顺序归主类别，次选方式保留原文；分类存在解释空间。
4. **14 个微国家无 1:50m 多边形**，以可点击圆点呈现（见 `data/geo/REPORT.md`）。
5. **ESBuild 临时目录问题**：本机 Windows 偶发 `%TEMP%` 清理被拒绝导致 `vite build` 失败，已通过把 TEMP 指向项目内 `.esbuild-tmp` 解决；这是本机环境问题，不是构建配置错误。
6. 未做移动端、账户、后台管理、自动采集、压测、多实例并发、浏览器兼容矩阵（仅 Chrome 157）。
7. 地图离线可用且无外部 API Key；若未来换成真实底图（MapTiler/高德等）需重新做来源限制、授权与隐私评估。

## 7. 复现命令

```powershell
npm install
npm run setup          # data:build → geo:build → db:rebuild
npm test               # 76 pass / 1 skip
npm run dev            # http://127.0.0.1:5173 （API :3001）
# 另一个终端：
npm run e2e            # 浏览器验收
npm run screenshots    # 生成 docs/screenshots
npm run build          # 生产构建
$env:PORT='3033'; npm start
```

MySQL 模式：复制 `.env.mysql.example` 为 `.env`，填写本机账号后运行 `npm run db:init:mysql && npm run db:seed:mysql && npm run db:check:mysql`。
