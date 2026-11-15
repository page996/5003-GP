# 数据来源、许可与使用边界

## 1. 国家与地区目录

`data/countries.json` 根据 `world-countries@5.1.0` 的国家与地区数据库生成，原始项目：<https://github.com/mledoze/countries>，许可证 **Open Database License (ODbL) 1.0**。完整许可见本目录 `LICENSE-ODbL.txt`。

本项目抽取并转换两位代码、中英文常用名、地理区域、别名及中心点，并按英文常用名排序。派生地理目录的再分发和公开使用应遵守 ODbL 的署名及适用的同方式共享等要求；不要移除原始许可。`coverage-targets.json` 基于该目录代码增加项目采集任务。

## 2. 地图几何

`data/geo/world-paths.json` 由 `world-atlas@2.0.2` 的 `countries-50m.json`（Natural Earth 1:50m）经 TopoJSON → GeoJSON → Equal Earth 投影生成。Natural Earth 数据为 **public domain**（<https://www.naturalearthdata.com/about/terms-of-use/>）。地图几何的国界线仅用于示意性可视化，**不代表本项目对任何边界、主权或领土主张的立场**，也不构成法律/外交结论。

## 3. 签证政策数据

- 真实数据：`data/source/global_249_countries_cn_passport_visa.csv`，由课程小组按公开信息整理，来源等级为 `SINGLE_SOURCE`。项目未从任何网站批量抓取全文；如未来补充官方链接，应遵守原站条款，只引用必要事实与链接，不复制大段受保护内容。
- 演示数据：`data/source/demo-details.json` 为项目组编写的**完全虚构样本**，不来自任何官方或第三方资料，仅用于验证字段与界面。
- 同义词：`data/source/synonyms.json` 为检索辅助词表，不含政策事实。

签证政策会变化，且本项目的真实数据只到「摘要级」。**任何出行/申请决定应以中国领事服务网、目的地使领馆与官方签证中心的最新公告为准。**

## 4. 代码许可

本项目为课程作业，未擅自为代码添加开源许可证。仓库公开不等于自动授予任意复制再分发许可；正式发布前由仓库所有者决定。
