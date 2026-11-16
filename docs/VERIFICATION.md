# 验收记录（Visa Atlas v5.0）

> 验收日期：2026-11-16（本机） · Node.js **24.13.0** · npm **11.6.2** · Chrome **157.0.8103.52** · MySQL **8.0.46**（隔离实例，仅用于 MySQL 模式验收） · MapLibre GL JS **5.24.1**
> 数据集版本：`v1.0.0-csv249-demo22-syn351-af33c70a`（内容指纹随数据修订变化）
> 说明：v1（三栏工作台 + 自绘平面 SVG 地图）已被 v2（全屏地球 + 搜索胶囊 + 国家抽屉）取代；v3 完成高亮多色化、极区环带修复、抽屉瘦身；v4 完成语义色板/装饰 HUD、知识图谱精确检索、拖动后悬停恢复、选中后其他地区静默；v5 完成 180° 接缝线移除与全界面中英文切换。本文件记录当前 v5 验收。真实签证政策仍为「摘要级」，见 README 与 `docs/AUDIT-BASE.md`。

## 1. 数据链路

| 步骤 | 命令 | 结果 |
|---|---|---|
| ETL | `npm run data:build` | ✔ 250 国 / 249 条真实旅游签 / 22 条演示明细 / 569 条类型线索 / 351 条同义词；76 种原始分类全部归一化 |
| 数据校验 | `npm run data:check` | ✔ 结构、枚举、外键引用、路线唯一性、真实/演示边界、来源与批次全部通过（仅 2 条预期警告：CN 本国政策、XK 未采集） |
| 地球几何 | `npm run geo:build` | ✔ world-atlas 1:50m → `public/geo/countries.geo.json` 236 个多边形国家 + `microstates.geo.json` 14 个点；跨 ±180° 多边形在构建期切分（`geojson-antimeridian-cut`），不再输出经纬网；250/250 目录国家有几何或点；坐标 3 位小数，countries 约 1.62 MB || SQLite 种子 | `npm run db:rebuild` | ✔ 15 表 / 2 视图；250 国 / 249 真实 / 22 演示 / 569 线索 / 351 同义词；材料 123 / 费用 33 / 时间 35 / 规则 32 |
| MySQL 种子 | `npm run db:init:mysql` + `db:seed:mysql` | ✔ 15 表 / 2 视图；行数与 SQLite 一致；`db:check:mysql` 列名完全一致 |
| 幂等性 | 重复 `db:seed` | ✔ 结果一致，无重复行 |

## 2. 自动化测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 全量 Node 测试 | `npm test` | **86 tests / 84 pass / 0 fail / 2 skipped**（MySQL 连接类用例未配置环境时跳过；含图谱精确检索 8 项、反经线/无经纬网断言） |
| MySQL 集成 | `npm run test:mysql`（`DB_DRIVER=mysql` 指本机 3307） | **5 / 5 pass** |
| 地球几何守护 | `npx tsx --test tests/globe.test.ts` | 数据覆盖/结构/bbox/体积等断言（见任务交付报告；`npm test` 已包含） |
| 演示/同义词夹具 | `npx tsx --test tests/fixtures.test.ts` | **26 / 26 pass** |
| TypeScript | `npx tsc --noEmit` | **0 errors**（strict） |
| 浏览器 E2E | `npm run e2e` | **30 / 30 通过**（地球 canvas、8 预置词、语义图例、hover 固定卡、精简抽屉、图谱「美国」仅 1 行 US、**中英文切换（占位符/图例/预置词/抽屉全英文）**、日本、`Japn` 模糊、点击地球选国、欧洲、数据说明、0 console error / 0 pageerror） |
| 截图 | `npm run screenshots` | 11 张：`globe.png`、`globe-en.png`、`globe-pole.png`、`globe-dateline.png`、`globe-1920.png`、`hover-card.png`、`country-sheet.png`、`search-preset.png`、`search-japan.png`、`search-fuzzy.png`、`graph-search.png` |

测试覆盖要点：API 默认搜索 249、分面与总数一致性、分页/排序、同义词与分词 AND、`type=BUSINESS` 的 MENTION_ONLY、`demo=1` 的同国同类型真实优先、SQL 注入式关键词、404/400/503/429 错误信封、seed 幂等与外键、SQLite/MySQL 表列索引同构、XK 空档案、国家档案 rules 字段、地球 GeoJSON 覆盖 250 国（236 多边形 + 14 微国家点）、跨反经线切片与无经纬网。

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
| `GET /api/v1/search?q=美国` | total 1，仅 US；响应含 `graph: { used:true, matched:[国家·美国] }` |
| `GET /api/v1/search?q=免签` | total 73，全部 FREE 政策组；`graph` 显示 `政策组·免签入境` |
| `GET /api/v1/search?q=申根` | total 34，全部 `SCHENGEN_VISA`；`graph` 显示 `签证类别·申根签证` |
| `GET /api/v1/search?q=商务签` | total 179，全部 `BUSINESS` 的 MENTION_ONLY 线索；`graph` 显示 `签证类型·商务访问` |
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

- 渲染：全屏 MapLibre globe，初始视角 center 108°E/22°N；海洋深蓝黑、太空近黑；**陆地底色 = 5 个旅游签政策组语义色的低饱和版本**（免签绿 / 落地签黄 / 电子签青 / 预办珊瑚 / 特殊灰），左下角常驻图例解释颜色含义；hover = 政策组亮色，selected = 参考黄 `#E3C31C` + 政策组内描边/柔光；检索命中按政策组淡彩，未命中 `#191d20`；微国家圆点同样带语义色。
- 选中国家后其他地区静默：`focus` feature-state 让所有非选中地区统一进入深灰 `#10161a`，只保留选中黄与克制 hover；关闭抽屉后恢复语义底色。
- 装饰 HUD：球体外圈缓慢旋转轨道、四角括号、彩色微光点、品牌渐变点；全部 pointer-events:none，不遮挡交互；选中国家时轨道自动淡出。
- 极区修复：移除经纬网装饰；对跨 ±180° 多边形做反经线切分；北极视角实测不再出现同心环带，俄罗斯/加拿大/格陵兰等极区国家可正常显示；南极洲多边形保留且渲染正常。
- **180° 接缝移除**：MapLibre globe 在 180° 经线会渲染内部接缝竖线（无对应 feature，queryRenderedFeatures 无法命中）；在 `GlobeMap` 顶部增加仅覆盖海洋纬带（±58°）的同色窄线层。实测在斐济/日期变更线平视视角，接缝像素由灰线变为纯海洋色；高纬陆地不覆盖。
- **中英文切换**：右上角 `EN / 中文` 按钮；实测切换后搜索 placeholder、图例、8 个预置词、搜索结果/抽屉类别、数据说明均变英文；英文抽屉不再出现「其他常见签证类型/来源：/停留期待确认」等中文 UI 标签；切回中文恢复正常；选择写入 localStorage。
- 操作：拖拽旋转、滚轮/双指缩放（0.5–10×）、双击放大、右下 +/−/重置；点击空白关闭抽屉；hover 国家出现固定悬浮卡（不跟随鼠标，可点击进入抽屉，移入卡片不消失）。
- **拖动后悬停恢复**：在空白/球体外/UI 上松开拖拽均会清空 pointerDown 状态；Playwright 复现“空白拖动→移动回国家”后 hover 卡正常出现，不需要额外点击唤醒。
- 搜索：8 个预置词统一走知识图谱解析；`美国`/`日本` 精确返回 1 国，`欧洲`→地区国家，`申根`→类别，`免签`/`落地签`/`电子签`→政策组，`商务签`→MENTION_ONLY 线索；结果面板显示图谱命中解释；本地模糊建议 `Japn`→日本；未命中变暗；命中明确国家自动飞近。
- 抽屉：精简版只保留国家名/语义色类别 chip/停留/入境/一句话结论/摘要/其他类型 chips/来源/路线编号；不再渲染费用、材料、审核时间、完整度、演示明细空位；XK 明确空态。
- 视口：1180×800、1280×800、1440×900、1920×1080 浮层无重叠、无整页横向/纵向滚动；Chrome 无 console error / pageerror。

## 6. 配色与参考图对照

| 用途 | 色值 |
|---|---|
| 选中（用户参考黄） | `#E3C31C`；描边/发光 `#F6DD55` |
| 免签入境（政策组） | `#A0DA26`（用户提供绿） |
| 落地签（政策组） | `#DFC11D`（此前参考黄，保留） |
| 电子签 / 电子授权（政策组） | `#1DC5CE`（用户提供青） |
| 预办签证（政策组） | `#FF633D`（用户提供珊瑚） |
| 特殊许可 / 属地（政策组） | `#8C9AA3`（中性灰） |
| 海洋 | `#0e1a22` |
| 太空/背景 | `#05080b` |
| 检索未命中变暗 | `#191d20` |
| 选中后其他地区静默 | `#10161a` |

## 7. 未验证 / 已知限制

1. **MySQL 只在隔离本机实例验证**（127.0.0.1:3307，库 `visa_atlas`）；未验证远程/生产网络、TLS、权限最小化与备份策略。
2. **真实政策仅摘要级**：费用、材料、审核时间、逐国官方链接与完整个人条件规则未采集；v5 界面不再预留这些空位，演示明细为虚构且不展示，不可用于申请。
3. **34 个复合分类**按来源顺序归主类别，次选方式保留原文；分类存在解释空间。
4. **14 个微国家无 1:50m 多边形**，以可点击圆点呈现（见 `data/geo/REPORT.md`）。
5. 知识图谱基于当前数据库快照启动时构建；运行期更新数据需重启 API（本项目数据为静态批次）。
6. 地球依赖浏览器 **WebGL**（MapLibre）；本机 Chrome 通过；未做 Firefox/Safari/WebGL 降级矩阵。
7. 未做移动端、账户、后台管理、自动采集、压测、多实例并发。
8. 地球无卫星/街道底图；如需真实底图需引入 MapTiler 等 Key 并重新做授权/隐私评估。
9. **ESBuild 临时目录问题**：本机 Windows 偶发 `%TEMP%` 清理被拒绝导致 `vite build` 失败，已通过把 TEMP 指向项目内 `.esbuild-tmp` 解决；属本机环境问题，不是构建配置错误。

## 8. 复现命令

```powershell
npm install
npm run setup          # data:build → geo:build → db:rebuild
npm test               # 84 pass / 2 skip（未配置 MySQL 时）
npm run dev            # http://127.0.0.1:5173 （API :3001）
# 另一个终端：
npm run e2e            # 浏览器验收
npm run screenshots    # 生成 docs/screenshots
npm run build          # 生产构建
$env:PORT='3033'; npm start
```

MySQL 模式：复制 `.env.mysql.example` 为 `.env`，填写本机账号后运行 `npm run db:init:mysql && npm run db:seed:mysql && npm run db:check:mysql`。
