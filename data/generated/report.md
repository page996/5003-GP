# ETL 质量报告

- 生成时间：2026-11-15T17:41:47.248Z
- 数据集版本：v1.0.0-csv249-demo22-syn351-f8887472
- 源文件：data/source/global_249_countries_cn_passport_visa.csv（249 行，sha256 ad7416b1d779bcf8…）

## 数量
- 国家/地区目录：250（CSV 覆盖 249，未采集：XK）
- 真实旅游签政策：249
- 演示明细：22
- 其他签证类型线索：569
- 检索同义词：351
- 重点候选目的地：91

## 政策组分布
- 免签入境：73
- 落地签：26
- 电子签 / 电子授权：42
- 预办签证：73
- 特殊许可 / 属地：35

## 类别分布
- 使领馆预办签证（EMBASSY_VISA）：36
- 电子签证（E_VISA）：36
- 申根签证（SCHENGEN_VISA）：34
- 互免签证（MUTUAL_FREE）：26
- 落地签（VISA_ON_ARRIVAL）：26
- 有条件免签（CONDITIONAL_FREE）：24
- 单方面免签（UNILATERAL_FREE）：22
- 属地 / 海外领地签证（TERRITORY_VISA）：20
- 特殊许可 / 管制（SPECIAL_PERMIT）：7
- 电子旅行授权（ETA）：6
- 无主权签证体系（NO_SOVEREIGN）：3
- 需美国签证（US_VISA_ROUTE）：3
- 特殊地区通行证（REGION_PERMIT）：3
- 本国 / 本地区（HOME_REGION）：1
- 参照 / 过境管制（REFERENCE_POLICY）：1
- 免签（需预登记）（FREE_WITH_REGISTRATION）：1

## 字段完整度
- 平均完整度：48 / 100（摘要级，费用/材料/时间为 0）
- 可解析停留期：132 / 249
- 可识别入境次数：11 / 249

## 需要人工复核
- 无
- 其他签证类型列中未识别词：港澳通行证、台湾通行证签注、无独立签证体系、公务许可、逗留签注、军事、外交公务签、公务签证、国家签证、高端签证、高技术移民签、公务、访问许可、Hayya许可、朝觐签证、SP)、临时、外交、教廷公务许可
- 与目录名称不一致：AE、BA、BN、BO、BQ、BV、CC、CD、CF、CG、CI、CV、DM、DO、FK、FM、GP、GS、HK、HM、IR、KP、KR、LA、MD、MF、MK、MO、PN、PS、RE、SH、SJ、ST、SX、SY、TF、TR、TW、TZ、VA、VE、VG、VI、WF

## 限制
- 分类归一化为 16 个类别，原始 76 种中文分类保存在 `visa_policies.source_category`。
- 复合路线（如“落地签/电子签”）按原始顺序的第一种方式归入主类别，另一方式保留在摘要原文中。
- 停留期由中文文本规则抽取，可能存在解释空间；以 `summary` 原文与官方公告为准。
- 演示明细为完全虚构内容，`is_demo=1` 且 `data_status=DEMO`。