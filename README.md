# Visa Atlas · 世界签证图谱

中国普通护照出境旅游签查询系统：**可旋转/缩放的 MapLibre 地球 + 知识图谱检索 + 国家签证抽屉**。
本 README 只说明实现方式、部署和启动；交接清单与启动细节见 [HANDOVER.md](HANDOVER.md)。

## 1. 实现概览

| 层 | 实现 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 6 + MapLibre GL JS 5.24（globe 投影）；本地 GeoJSON，无地图 Key/瓦片/运行时外网 |
| 后端 | Node.js 24 + TypeScript + Fastify 5 + zod；SQLite（默认，`node:sqlite`）/ MySQL 8（可选，mysql2） |
| 检索 | 知识图谱节点：国家、地区、政策组、签证类别、签证类型；查询先解析实体再精确取国家/类型；未命中回退全文检索 |
| 数据 | CSV + 演示夹具 + 同义词 → TypeScript ETL → `data/generated/dataset.json` → SQLite/MySQL 种子 |
| 地图几何 | `world-atlas` 1:50m → 构建期 GeoJSON；跨 ±180° 切分；180° 海洋接缝用同色窄线覆盖 |
| 界面 | 深色极简玻璃 UI；5 个政策组语义色、底部图例、轨道/角标装饰；中英文切换 |

## 2. 目录结构

```
client/            React 前端（App、地图、搜索、抽屉、i18n、样式）
server/            Fastify API、知识图谱、检索、数据库访问
shared/            前后端共享类型、字典
database/          SQLite / MySQL 建表 SQL
scripts/           ETL、几何构建、数据库初始化/导入
tests/             Node 测试、E2E、截图脚本
data/              source（原始数据）· generated（ETL 产物）· geo（几何报告）
public/geo/        运行期地球 GeoJSON（Vite 构建复制到 dist）
docs/              架构、验收、设计、API、数据字典、实现说明
start.cmd          Windows 一键生产启动
start-dev.cmd      Windows 一键开发启动
setup.cmd          Windows 一次性安装/初始化
start.sh           macOS / Linux 启动
```

## 3. 环境要求

- **Node.js 24+**（必须；使用内置 `node:sqlite`）
- npm（随 Node 安装）
- Chrome / Edge 等支持 WebGL 的桌面浏览器
- 可选：MySQL 8（仅 MySQL 模式需要）
- Windows 推荐直接使用 `.cmd` 脚本；macOS/Linux 使用 `start.sh`

## 4. 快速启动

### Windows：一键启动（生产模式）

双击 `start.cmd`，或在 PowerShell 中：

```powershell
.\start.cmd
```

脚本会自动：

1. 检查 Node.js 版本；
2. 首次运行时执行 `npm ci` 安装依赖；
3. 检查/生成 `data/generated/dataset.json`、`public/geo/*.geo.json`、`data/visaatlas.sqlite`；
4. 若 `dist/index.html` 不存在则执行生产构建；
5. 启动服务，默认地址 **<http://127.0.0.1:3001>**。

### Windows：开发模式

```powershell
.\start-dev.cmd
```

启动 API `http://127.0.0.1:3001` 和 Vite 开发页 `http://127.0.0.1:5173`，支持前端热更新。

### 仅初始化环境

```powershell
.\setup.cmd
```

安装依赖、构建数据与几何、重建 SQLite，并生成生产构建；不启动服务。

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

`start.sh` 会检查依赖/数据/构建，然后启动生产服务。

## 5. 手动启动

```bash
npm install
npm run setup       # ETL → 地图几何 → SQLite 初始化/导入
npm run dev         # 开发：API :3001 + Web :5173
```

生产模式：

```bash
npm run build
npm start           # http://127.0.0.1:3001
```

自定义端口：

```powershell
$env:PORT=3033; npm start
# 或 start.cmd 前设置 PORT
```

## 6. 数据初始化与重建

```bash
npm run data:build    # CSV + 演示 + 同义词 → data/generated/dataset.json
npm run data:check    # 数据校验
npm run geo:build     # 生成 public/geo/*.geo.json
npm run db:rebuild    # 重建 SQLite 并导入
```

原始数据位于 `data/source/`；生成产物位于 `data/generated/`，不要手工修改生成文件。

## 7. MySQL 8（可选）

复制环境模板并填写本机 MySQL 账号：

```powershell
Copy-Item .env.mysql.example .env
npm run data:build
npm run db:init:mysql
npm run db:seed:mysql
npm run dev
```

SQLite 与 MySQL schema 同构；具体字段见 `docs/DATA-DICTIONARY.md`。

## 8. 配置

- 默认使用 SQLite：`data/visaatlas.sqlite`，无需配置文件即可启动。
- 示例配置：`.env.example`（通用）、`.env.mysql.example`（MySQL）。
- 服务端默认监听 `127.0.0.1:3001`；可通过 `PORT` 覆盖。
- 无外部 API Key、无在线地图瓦片；地图 GeoJSON 与字体均本地打包。

## 9. 验证

```bash
npm test             # Node 测试
npm run e2e          # Playwright 浏览器验收（需先启动开发服务）
npm run screenshots  # 重新生成 docs/screenshots
```

## 10. 交接资料

- [HANDOVER.md](HANDOVER.md)：交接说明与启动/部署
- [docs/IMPLEMENTATION-REPORT.md](docs/IMPLEMENTATION-REPORT.md)：前后端技术栈与架构
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：系统架构与数据链路
- [docs/VERIFICATION.md](docs/VERIFICATION.md)：验收记录
- [docs/DESIGN-SYSTEM-V2.md](docs/DESIGN-SYSTEM-V2.md)：界面与交互规范
- [docs/API.md](docs/API.md)：接口约定
