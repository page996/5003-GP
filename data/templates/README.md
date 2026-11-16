# 数据补充模板

`data-supplement-template.csv` 用于后续补充费用、材料、办理时间、资格规则、官方来源等数据。

- 一行代表一条政策路线的补充事实；表头字段与 `HANDOVER.md` 第 5 节一致。
- 未知字段留空，不要用 `0` 表示免费，不要用空数组表示“无需材料”。
- 费用/材料/时间/规则需要填写来源标题、发布方、来源 URL、核验日期。
- 复合路线按“一条可说明白的申请手续”拆分 `route_code`；不同渠道/加急/入境次数拆行。
- 模板首行 `XX` 只是示例占位，不能直接导入真实数据。

当前 ETL 入口为 `scripts/etl.ts`；新增批次后运行：

```powershell
npm run data:build
npm run data:check
npm run db:rebuild
```

如需在界面展示费用/材料/时间/规则，需要同步扩展 `client/features/details/CountrySheet.tsx`。
