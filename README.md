# Visa Atlas · 六人共享开发 Base

桌面 Web 签证资料检索、地图探索及「个人条件＋出行意图」推荐。六人从同一份可运行底座继续开发，不再各写一套项目、接口或数据库。

**交付状态：工程底座，不是已完成的全球签证数据库。**

- 250 个国家与地区目录，91 个首批重点候选目的地；全部保留七类用途任务。
- 真实签证资料目前 **0 条**。`data/policies.json` 是空的真实资料集合。
- 9 条明确标注为虚构的演示路线，只用于测试资料展示、搜索、推荐与维护流程，不能用于申请。
- 完整资料字段没有缩减；未知事实允许 `null`。个人条件与意图推荐没有删除。
- 高德 JS API 加载与点击联动已预留；未提供项目 Key，实际高德服务尚未验收。无 Key 时显示明确标注的坐标示意，不冒充高德底图。
- 只做桌面浏览器，不要求手机适配、账户系统、自动采集、实时更新或复杂运维平台。

## 1. 先跑起来

需要 Node.js 22+、npm。演示模式不需要 MySQL，也不需要高德 Key。

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>。API 默认 <http://127.0.0.1:3001>。
`.env` 的 `PORT` 若改动，需要同步调整 `vite.config.ts` 的开发代理。

构建后以同一服务提供页面和 API：

```powershell
npm run build
npm start
```

打开 <http://127.0.0.1:3001>。所有命令都在仓库根目录执行。不要直接双击 `index.html`。

## 2. 成员阅读顺序

1. [六人分工与阶段安排](docs/TEAM.md)：先看自己接手什么、哪些不用重做。
2. [A：数据采集与建库](docs/roles/A-collection.md)；[B：验证与更新](docs/roles/B-verification.md)。A 文件内直接附完整建表 SQL。
3. [C：后端整合](docs/roles/C-backend.md)；[D：接线与验收](docs/roles/D-integration.md)。
4. [E：搜索与推荐界面](docs/roles/E-search.md)；[F：动态地图](docs/roles/F-map.md)。
5. [数据与维护](docs/DATA.md)、[接口约定](docs/API.md)、[双边交接协议](docs/agreements/README.md)。
6. [仓库协作与统一验收](docs/CONTRIBUTING.md)、[覆盖推进](docs/COVERAGE.md)、[验证记录及限制](docs/STATUS.md)。

## 3. 本地 MySQL

MySQL 8.0.16+，建议 8.0 最新维护版。仅绑定本机，不向公网开放 3306。
先由本机数据库所有者执行以下示例，替换密码；不要把实际密码写入仓库或 PR：

```sql
CREATE DATABASE IF NOT EXISTS visa_atlas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'visa_admin'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_LOCAL_ADMIN_PASSWORD';
CREATE USER 'visa_reader'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_LOCAL_READER_PASSWORD';
GRANT ALL PRIVILEGES ON visa_atlas.* TO 'visa_admin'@'127.0.0.1';
GRANT SELECT ON visa_atlas.* TO 'visa_reader'@'127.0.0.1';
```

若服务器按 `localhost` 匹配本地账户，请按本机设置创建对应账户，不使用 `%` 放开远程访问。`.env` 填入 `DB_ADMIN_*` 和 `DB_USER/DB_PASSWORD`，执行：

```powershell
npm run db:init
npm run data:validate -- data/policies.json
```

这只建立 8 张表和国家／用途字典，不生成真实政策。按照 [维护步骤](docs/DATA.md) 导入已核验批次，再把 `DATA_MODE=mysql` 并重启 API。空库显示待收集是正常行为。MySQL 故障不会悄悄替换成演示资料。

开发者可各有自己的本地数据库；演示用统一库由 B 手动更新，C 维护连接。公开仓库共享的是代码、可公开的资料和版本记录，不是运行中的数据库。

## 4. 地图设置

`VITE_AMAP_KEY` 是浏览器侧 Key，会进入前端构建文件，必须在高德控制台配置对应来源限制。
`VITE_AMAP_SERVICE_HOST` 指向你们按高德当期官方要求部署的安全代理；**本 base 未实现该代理**。安全密钥只留在服务端，禁止放进 `VITE_*` 或提交到 GitHub。F 与 C 共同完成真实服务设置并验收后，才可宣称高德可用。

官方参考：<https://lbs.amap.com/api/javascript-api-v2/guide/abc/load>。上线时重新核对官方文档、授权、全球地图展示能力及服务条款。只有本地坐标示意可用时，不算完成高德验收。

## 5. 已有工程与检查

```text
client/features/    地图、搜索、推荐表单、完整资料展示
server/domain/     数据校验与可解释推荐规则
server/services/   目录读取、事务式维护
server/infrastructure/  MySQL 读写
shared/contracts.ts     前后端共用字段约定
database/schema.sql     完整建表语句
data/              地理目录、覆盖任务、资料模板、演示夹具
scripts/           初始化、校验、导入计划、应用、导出
tests/             业务、API、真实 MySQL 集成检查
docs/              分工、双边协议、更新与验收办法
```

```powershell
npm test
npm run build
npm run data:coverage
npm audit
```

真实 MySQL 集成测试会修改指定测试库，只能按 [验收说明](docs/CONTRIBUTING.md) 在专用测试库运行。不要拿组内正式资料库测试。

## 6. 数据与许可

国家目录来自 `world-countries@5.1.0` / [mledoze/countries](https://github.com/mledoze/countries)，许可证 ODbL-1.0，详见 [数据署名](data/ATTRIBUTION.md)。地理目录不是签证政策依据。未为项目代码擅自添加开源许可证；仓库公开不等于自动授予任意复制再分发许可，正式发布前由仓库所有者决定。

![桌面探索页面](docs/screenshots/explore.png)
