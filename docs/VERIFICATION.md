# 验收记录（Visa Atlas v2.0）

> 验收日期：2026-11-16（本机） · Node.js **24.13.0** · npm **11.6.2** · Chrome **157.0.8103.52** · MySQL **8.0.46**（隔离实例，仅用于 MySQL 模式验收） · MapLibre GL JS **5.9.0**
> 数据集版本：`v1.0.0-csv249-demo22-syn351-f8887472`（内容指纹随数据修订变化）
> 说明：v1（三栏工作台 + 自绘平面 SVG 地图）已被 v2（全屏地球 + 搜索胶囊 + 国家抽屉）取代；本文件记录 v2 验收。真实签证政策仍为「摘要级」，见 README 与 `docs/AUDIT-BASE.md`。

## 1. 数据链路

| 步骤 | 命令 | 结果 |
|---|---|---|
| ETL | `npm run data:build` | ✔ 250 国 / 249 条真实旅游签 / 22 条演示明细 / 569 条类型线索 / 351 条同义词；76 种原始分类全部归一化 |
| 数据校验 | `npm run data:check` | ✔ 结构、枚举、外键引用、路线唯一性、真实/演示边界、来源与批次全部通过（仅 2 条预期警告：CN 本国政策、XK 未采集） |
| 地球几何 | `npm run geo:build` | ✔ world-atlas 1:50m → `public/geo/countries.geo.json` 236 个多边形国家 + `microstates.geo.json` 14 个点 + `graticule.geo.json` 经纬网；250/250 目录国家有几何或点；坐标 3 位小数，countries 约 1.63 MB |
| SQLite 种子 | `npm run db:rebuild` | ✔ 15 表 / 2 视图；250 国 / 249 真实 / 22 演示 / 569 线索 / 351 同义词；材料 123 / 费用 33 / 时间 35 / 规则 32 |
| MySQL 种子 | `npm run db:init:mysql` + `db:seed:mysql` | ✔ 15 表 / 2 视图；行数与 SQLite 一致；`db:check:mysql` 列名完全一致 |
| 幂等性 | 重复 `db:seed` | ✔ 结果一致，无重复行 |

## 2. 自动化测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 全量 Node 测试 | `npm test` | **77 tests / 75 pass / 0 fail / 2 skipped**（MySQL 连接类用例未配置环境时跳过；配置本机 MySQL 后为 76 pass / 1 skip） |
| MySQL 集成 | `npm run test:mysql`（`DB_DRIVER=mysql` 指本机 3307） | **5 / 5 pass** |
| 地球几何守护 | `npx tsx --test tests/globe.test.ts` | 数据覆盖/结构/bbox/体积等断言（见任务交付报告；`npm test` 已包含） |
| 演示/同义词夹具 | `npx tsx --test tests/fixtures.test.ts` | **26 / 26 pass** |
| TypeScript | `npx tsc --noEmit` | **0 errors**（strict） |
| 浏览器 E2E | `npm run e2e` | **20 / 20 通过**（地球 canvas 加载、搜索框/8 预置词、免签 8 行结果、hover 固定悬浮卡、抽屉收起/展开、日本查询、`Japn` 模糊建议、点击地球中心选国、欧洲预置、数据说明弹层、0 console error / 0 pageerror） |
| 截图 | `npm run screenshots` | 8 张：`globe.png`、`globe-1920.png`、`hover-card.png`、`country-sheet.png`、`country-sheet-expanded.png`、`search-preset.png`、`search-japan.png`、`search-fuzzy.png` |

测试覆盖要点：API 默认搜索 249、分面与总数一致性、分页/排序、同义词与分词 AND、`type=BUSINESS` 的 MENTION_ONLY、`demo=1` 的同国同类型真实优先、SQL 注入式关键词、404/400/503/429 错误信封、seed 幂等与外键、SQLite/MySQL 表列索引同构、XK 空档案、国家档案 rules 字段、地球 GeoJSON 覆盖 250 国。

## 3. API 冒烟（SQLite / MySQL 两种模式一致）

| 接口 | 观察 |
|---|---|
| `GET /api/health` | `{status:"ok", mode:"sqlite"|"mysql", datasetVersion, uptimeSeconds}` |
| `GET /api/v1/overview` | 250 国、249 真实政策、22 演示、5 政策组、12 用途、250 个 mapCountries；首屏一次请求 |
| `GET /api/v1/search?type=TOURISM` | total 249，pageSize 24，pageCount 11，`tookMs` 6–17ms（SQLite）/ 27ms（MySQL） |
| `GET /api/v1/search?q=日本` | total 1，首位 JP，`matchedCountries=["JP"]` |
| `GET /api/v1/search?region=AS` | total 49；分面 region 计数仍为 249（标准分面语义） |
| `GET /api/v1/search?group=FREE` | total 73，五组合计 249 |
| `GET /api/v1/search?type=BUSINESS`（demo 关） | 179 条 MENTION_ONLY，无伪造政策行 |
| `GET /api/v1/search?type=BUSINESS&demo=1` | 179 条中 5 条演示明细卡（JP/SG/US/FR/AE） |
| `GET /api/v1/countries/JP?demo=1` | 1 条真实政策 + 3 条演示明细；演示明细含材料/费用/时间/资格规则 |
| `GET /api/v1/countries/XK` | 200 空政策（目录内、本轮未采集） |
| 错误 | 非法 `pageSize/sort/type/category/region/stay` → 400 VALIDATION_ERROR + 字段 details；未知国家/路线 → 404；未初始化/连接失败 → 503 |

性能（db-core 25 次采样，真实数据）：默认搜索 p50 **7.6ms** / p95 **9.6ms**；关键词最慢 p95 **33ms**（要求 <150ms）。

## 4. 生产构建与托管

```powershell
$env:TEMP='E:\dsh-new-1\visaatlas\.esbuild-tmp'; $env:TMP=$env:TEMP   # 仅本机防 Windows 临时目录 ACL 干扰
npm run build
$env:PORT='3033'; npm start
```

- `tsc --noEmit` 通过；Vite 构建包含 MapLibre GL JS 与地球 GeoJSON，静态资源由 Fastify 同源托管。
- 生产验证：`/` 200、前端 bundle 200、`/api/health` 200、`/api/v1/search` 200、SPA 深链回退 200、缺失 `/assets/*` 返回 404、`/geo/countries.geo.json` 可访问。
- 对生产模式重跑浏览器 E2E：全部通过（见第 7 节 / 本次会话记录）。

## 5. 地球与交互验收

- 渲染：全屏 MapLibre globe，初始视角 center 108°E/22°N；海洋深蓝黑、太空近黑、陆地低饱和灰 4 档、国境线/经纬网分层；hover 与选中国家为高饱和黄 `#DFC11D / #E3C31C` + 黄色描边/柔光（与参考图一致），未选中保持灰色。
- 操作：拖拽旋转、滚轮/双指缩放（0.5–10×）、双击放大、右下 +/−/重置；点击空白关闭抽屉；hover 国家在底部出现固定悬浮卡（不跟随鼠标，可点击进入抽屉，移入卡片不消失）。
- 搜索：8 个预置词（免签/落地签/电子签/申根/商务签/日本/美国/欧洲）；本地模糊建议（`Japn` → 日本）；300ms 防抖后端检索；未命中变暗；命中明确国家时自动飞近；点击结果行打开抽屉。
- 抽屉：收起态国家名/黄色类别 chip/停留/入境/完整度/一句话结论/摘要/类型 chips；展开态费用/材料/审核时间「待采集」三宫格、演示明细（金色标注）、来源与限制、路线编号；XK 明确空态。
- 视口：1180×800、1280×800、1440×900、1920×1080 浮层无重叠、无整页横向/纵向滚动（v2 为全屏画布 + 浮层，均通过）；Chrome 无 console error / pageerror。

## 6. 配色与参考图对照

| 用途 | 色值 |
|---|---|
| 主高亮/选中（参考图 1/2 黄） | `#DFC11D`（hover）/ `#E3C31C`（selected） |
| 描边/发光 | `#F6DD55` |
| 未选中陆地 | `#30363a` / `#343a3e` / `#2c3236` / `#383e42`（4 档低饱和灰） |
| 海洋 | `#0e1a22` |
| 太空/背景 | `#05080b` |
| 未命中变暗 | `#191d20` |

## 7. 未验证 / 已知限制

1. **MySQL 只在隔离本机实例验证**（127.0.0.1:3307，库 `visa_atlas`）；未验证远程/生产网络、TLS、权限最小化与备份策略。
2. **真实政策仅摘要级**：费用、材料、审核时间、逐国官方链接与完整个人条件规则未采集；演示明细为虚构，不可用于申请。
3. **34 个复合分类**按来源顺序归主类别，次选方式保留原文；分类存在解释空间。
4. **14 个微国家无 1:50m 多边形**，以可点击圆点呈现（见 `data/geo/REPORT.md`）。
5. 地球依赖浏览器 **WebGL**（MapLibre）；本机 Chrome 通过；未做 Firefox/Safari/WebGL 降级矩阵。
6. 未做移动端、账户、后台管理、自动采集、压测、多实例并发。
7. 地球无卫星/街道底图；如需真实底图需引入 MapTiler 等 Key 并重新做授权/隐私评估。
8. **ESBuild 临时目录问题**：本机 Windows 偶发 `%TEMP%` 清理被拒绝导致 `vite build` 失败，已通过把 TEMP 指向项目内 `.esbuild-tmp` 解决；属本机环境问题，不是构建配置错误。

## 8. 复现命令

```powershell
npm install
npm run setup          # data:build → geo:build → db:rebuild
npm test               # 75 pass / 2 skip（未配置 MySQL 时）
npm run dev            # http://127.0.0.1:5173 （API :3001）
# 另一个终端：
npm run e2e            # 浏览器验收
npm run screenshots    # 生成 docs/screenshots
npm run build          # 生产构建
$env:PORT='3033'; npm start
```

MySQL 模式：复制 `.env.mysql.example` 为 `.env`，填写本机账号后运行 `npm run db:init:mysql && npm run db:seed:mysql && npm run db:check:mysql`。
