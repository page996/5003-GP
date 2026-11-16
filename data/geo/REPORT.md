# Visa Atlas v4.0 · 球体地图几何构建报告

> 由 `npm run geo:build`（`tsx scripts/build-globe-geo.ts`）自动生成，请勿手工编辑。
> 运行环境：Windows + Node.js（本仓库 `engines.node >= 24`），输入依赖版本锁定在 `package.json` / `package-lock.json`。

## 1. 生成方式

```powershell
npm run geo:build
```

- 输入几何：`node_modules/world-atlas@2.0.2/countries-50m.json`（Natural Earth 1:50m TopoJSON，241 个要素）
- ID 映射：TopoJSON 要素 `id` 为三位 ccn3 字符串，经 `world-countries@5.1.0` 的 `ccn3 → cca2` 落到 `data/countries.json` 的 250 国目录；id 缺失的 5 个要素用英文名后备匹配（Kosovo → XK）；其余 4 个不在目录中的争议/军事地带（Somaliland、N. Cyprus、Indian Ocean Ter.、Siachen Glacier）明确忽略。
- 输出坐标：WGS84 [lng, lat]，**统一保留 3 位小数**（约 100m 精度）。
- 前端几何消费方：`client/features/map/GlobeMap.tsx` 以本地 GeoJSON 加载（`/geo/*.geo.json`），无瓦片、无地图 Key、运行期不访问外网。

## 2. 输出文件

| 文件 | 内容 | 大小 |
|---|---|---:|
| `public/geo/countries.geo.json` | 236 个多边形国家（FeatureCollection） | 1,700,129 bytes（1660.3 KiB） |
| `public/geo/microstates.geo.json` | 14 个无多边形微国家（Point） | 3,186 bytes（3.1 KiB） |
| 合计 | | 1,703,315 bytes（1663.4 KiB） |

单文件与整体体积上限：3,000,000 bytes（当前合计占 56.8%）。
> v4 起移除经纬网装饰：原 10° 经纬网在南北极形成同心环带，视觉上易被误认为国境线，且会遮挡极区国家；球体不再绘制经纬网。
> 同时对跨 ±180° 的多边形做反经线切分（RFC 7946 §3.1.9，使用 `geojson-antimeridian-cut`），避免 MapLibre globe 把跨日界线长边沿“长路”渲染成极地环带。

## 3. 覆盖统计

| 指标 | 数量 | 说明 |
|---|---:|---|
| TopoJSON 总要素 | 241 | `objects.countries.geometries` |
| 目录国家有 polygon | 236 / 250（94.4%） | `countries.geo.json` |
| 目录国家仅圆点 | 14 / 250 | `microstates.geo.json` |
| 目录国家覆盖合计 | 250 / 250 | 236 + 14 = 250，无遗漏 |
| CSV 249 国覆盖 | 249 / 249 | 249 个采集国家全部有 polygon 或圆点 |
| CSV 缺失 | 0 | 无 |
| 目录未覆盖 | 0 | 无 |
| 跨反经线、无 bbox 的国家 | 6 | AQ, FJ, KI, NZ, RU, US（前端用 center + zoom 3 聚焦） |
| tone 分布（0/1/2/3） | 54 / 55 / 60 / 67 | 4 档低饱和灰的索引 |

### 3.1 无多边形微国家（常驻圆点）

  - BV · 布维岛 / Bouvet Island @ (3.4, -54.433)
  - BQ · 荷蘭加勒比區 / Caribbean Netherlands @ (-68.25, 12.18)
  - CX · 圣诞岛 / Christmas Island @ (105.667, -10.5)
  - CC · 科科斯 / Cocos (Keeling) Islands @ (96.833, -12.5)
  - GF · 法属圭亚那 / French Guiana @ (-53, 4)
  - GI · 直布罗陀 / Gibraltar @ (-5.35, 36.133)
  - GP · 瓜德罗普岛 / Guadeloupe @ (-61.583, 16.25)
  - MQ · 马提尼克 / Martinique @ (-61, 14.667)
  - YT · 马约特 / Mayotte @ (45.167, -12.833)
  - RE · 留尼旺岛 / Réunion @ (55.5, -21.15)
  - SJ · 斯瓦尔巴特 / Svalbard and Jan Mayen @ (20, 78)
  - TK · 托克劳 / Tokelau @ (-172, -9)
  - TV · 图瓦卢 / Tuvalu @ (178, -8)
  - UM · 美国本土外小岛屿 / United States Minor Outlying Islands @ (166.633, 19.3)

缺少独立多边形的原因：Natural Earth 1:50m 简化下，部分小岛/属地作为母国要素的一部分出现（如法属海外省、斯瓦尔巴与扬马延），部分因面积过小被省略（如布维岛、托克劳、图瓦卢）。前端以 3–6px 灰色圆点常驻显示，hover / selected 变为黄色。

### 3.2 重复 ISO2 的 TopoJSON 要素

  - AU:Ashmore and Cartier Is.（合并为同一条国家要素）

### 3.3 映射失败 / 忽略的 TopoJSON 要素

  - Somaliland（目录外，忽略）
  - N. Cyprus（目录外，忽略）
  - Indian Ocean Ter.（目录外，忽略）
  - Siachen Glacier（目录外，忽略）

所有仅点国家均有可用经纬度。

## 4. 属性字段（前端契约）

`countries.geo.json` 每个 Feature：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 与 `properties.iso2` 相同的 ISO2；GeoJSON source 使用 `promoteId: 'iso2'` 作为 feature-state 键 |
| `properties.iso2` | string | 两位 ISO 3166-1 alpha-2（XK 为项目约定） |
| `properties.nameZh` / `nameEn` | string | 目录中英文名 |
| `properties.region` | string | world-countries 区域名 |
| `properties.tone` | 0–3 | 4 档低饱和灰的稳定索引（iso2 哈希） |
| `properties.center` | [lng, lat] | 相机中心，目录经纬度优先 |
| `properties.bbox` | [w, s, e, n] \| null | 跨反经线（>300°）时为 null |

`microstates.geo.json` 每个 Feature：`id` / `iso2` / `nameZh` / `nameEn` / `region` / `tone` / `center` / `bbox: null`，geometry 为 `Point`。

## 5. 前端球体配置

- 渲染：MapLibre GL JS 5.9（`projection: { type: 'globe' }`），本地 GeoJSON source，无外部 source / sprite / glyphs / 瓦片。
- 初始相机：`center [108, 22]`、`zoom 2.0`、`minZoom 0.5`、`maxZoom 10`。
- 配色（用户指定语义色板）：太空/天空 `#05080b`、海洋 `#0e1a22`、未命中变暗 `#191d20`、国境线 `#626b72`；陆地基色按 5 个政策组语义色低饱和化——免签绿 `#A0DA26`、落地签黄 `#DFC11D`、电子签青 `#1DC5CE`、预办珊瑚 `#FF633D`、特殊中性灰 `#8C9AA3`；hover 用政策组亮色，selected 保持参考黄 `#E3C31C` + 政策组内描边；选中国家后其他地区进入统一深灰 focus 静默态。不再绘制经纬网。
- 聚焦规则：有 `bbox` → `fitBounds(padding 110, maxZoom 7.5, duration 900)`；无 `bbox`（AQ/FJ/KI/NZ/RU/US）→ `center + zoom 3`；微国家圆点 → `center + zoom 7.5`；`prefers-reduced-motion` 时 duration 设为 0。
- feature-state：`hover` / `selected` / `focus` / `dim` / `match`，source 均设置 `promoteId: 'iso2'`；内部 hover 与外部 `hoverIso2` 合并，hover 不触发 React 重渲染；focus 用于选中国家后静默其他地区。

## 6. 数据许可与署名

- **几何数据**：`world-atlas@2.0.2` 的 `countries-50m.json` 由 **Natural Earth** 公共领域（public domain）数据构建；Natural Earth 不要求署名，本项目保留来源说明。`world-atlas` 代码本身为 ISC 许可。
- **国家目录 / ccn3 → ISO2 / 经纬度**：`world-countries@5.1.0`（<https://github.com/mledoze/countries>），**ODbL 1.0**；完整许可见 `data/LICENSE-ODbL.txt`，说明见 `data/ATTRIBUTION.md`。
- **本项目 250 国目录**：`data/countries.json`（由 world-countries 生成）+ `data/source/global_249_countries_cn_passport_visa.csv`（小组整理，249 个目的地）。
- 地图几何**不是**国界法律结论；Natural Earth 的边界表达仅供示意，不表达任何领土主张。运行期无外网、无地图瓦片、无 Key。

## 7. 已知限制与取舍

1. 1:50m 分辨率下 14 个微国家/属地没有独立多边形，只能以点渲染；点位置为目录经纬度近似。
2. 跨反经线的 6 个国家（AQ、FJ、KI、NZ、RU、US）bbox 横跨 ±180，不参与 `fitBounds`，聚焦时用 `center + zoom 3`，可能不完全居中。
3. 陆地底色按 5 个政策组语义色低饱和化（免签绿、落地签黄、电子签青、预办珊瑚、特殊中性灰）；hover 用政策组亮色，selected 用参考黄 + 政策组内描边；选中国家后其他地区进入统一深灰静默态；不渲染国名标签。
4. `tone` 是按 ISO2 哈希的纯视觉索引（保留给未分类兜底色），没有地理/政策含义。
5. 文件体积目标是 < 3MB；若升级到 10m 分辨率或增加图层需重新评估。
6. 微国家圆点在 globe 背面不可见（MapLibre 遮挡），点击/悬停只对正面国家生效。
