# 发布包

- `visaatlas-source.zip`：源码 + 数据 + 文档 + 启动脚本；首次运行 `start.cmd` 会自动 `npm ci`。
- 完整离线包（含 `node_modules`、`dist`、SQLite）体积较大，不进入 Git；由交接人单独提供 `deliverables/visaatlas-full-win-x64.zip`。

校验/解压后启动：

```powershell
Expand-Archive .\visaatlas-source.zip -DestinationPath .\visaatlas
cd .\visaatlas
.\start.cmd
```
