# Visa Atlas · 世界地图几何构建报告

> 由 `npm run geo:build`（`tsx scripts/build-geo.ts`）自动生成，请勿手工编辑。
> 运行环境：Windows + Node.js（本仓库 `engines.node >= 24`），输入依赖版本锁定在 `package.json` / `package-lock.json`。

## 1. 生成方式

```powershell
npm run geo:build
```

- 输入几何：`node_modules/world-atlas@2.0.2/countries-50m.json`（Natural Earth 1:50m TopoJSON，241 个要素）
- ID 映射：`world-atlas` 要素的 `id` 是三位字符串形式的 ccn3（如 `"036"`），先用 `world-countries@5.1.0` 的 `ccn3 → cca2` 映射，再落到 `data/countries.json` 的 250 国目录；id 缺失的 5 个要素用英文名后备匹配（Kosovo → XK），其余 4 个（Somaliland、N. Cyprus、Indian Ocean Ter.、Siachen Glacier）不在目录中，忽略并记录在下方。
- 投影：`d3-geo` 的 **Equal Earth**（等积圆柱类投影，视觉上南北半球平衡、经线平滑）；`fitExtent([[12,12],[988,508]], Sphere)`，画布 1000×520，四周 12px 边距，球面整体居中。
- 路径精度：国家 path 保留 1 位小数（0.1px），经纬网/球面轮廓保留 2 位小数；这是文件体积与视觉质量的折中。
- 前端使用：`client/features/map/WorldMap.tsx` 直接 `import` 本文件，运行期不访问网络、不需要地图 Key。

## 2. 输出文件

| 项目 | 值 |
|---|---|
| 文件 | `data/geo/world-paths.json` |
| 大小 | 1,168,278 bytes（1140.9 KiB，上限 1,600,000 bytes） |
| 画布 | 1000 × 520 |
| 国家 path 数 | 236 |
| 目录国家质心数 | 250 / 250（全部目录代码） |
| 标签锚点 | 24 个 |

> 结构说明：除约定字段 `projection / width / height / sphere / graticule / countries / centroids / labels / unmapped`
> 外，额外输出 `equator` 与 `primeMeridian` 两条 path，用于按设计规范把赤道 / 本初子午线画亮一点；
> 前端可选用，不读取也不影响兼容性。

## 3. 覆盖统计

| 指标 | 数量 | 说明 |
|---|---:|---|
| TopoJSON 总要素 | 241 | `objects.countries.geometries` |
| 带 `feature.id` 的要素 | 236 | 全部为三位 ccn3 字符串 |
| `ccn3 → ISO2` 直接映射成功 | 236 个要素 | 落在 250 国目录内 |
| 英文名后备匹配成功 | 1 个要素 | Kosovo → XK |
| 映射失败/忽略的要素 | 4 | 见 3.3 |
| 目录国家有 polygon | 236 / 250（94.4%） | 生成 path |
| 目录国家仅点渲染 | 14 / 250 | 无 1:50m 多边形，用投影质心圆点 |
| CSV 249 国有 polygon | 235 / 249（94.4%） | |
| CSV 249 国有 path 或质心点 | 249 / 249（100.0%） | 测试守护项 |
| CSV 中目录外代码 | 0 | 无 |

### 3.1 仅点渲染的目录国家（无 1:50m 多边形）

  - BV · 布维岛 / Bouvet Island
  - BQ · 荷蘭加勒比區 / Caribbean Netherlands
  - CX · 圣诞岛 / Christmas Island
  - CC · 科科斯 / Cocos (Keeling) Islands
  - GF · 法属圭亚那 / French Guiana
  - GI · 直布罗陀 / Gibraltar
  - GP · 瓜德罗普岛 / Guadeloupe
  - MQ · 马提尼克 / Martinique
  - YT · 马约特 / Mayotte
  - RE · 留尼旺岛 / Réunion
  - SJ · 斯瓦尔巴特 / Svalbard and Jan Mayen
  - TK · 托克劳 / Tokelau
  - TV · 图瓦卢 / Tuvalu
  - UM · 美国本土外小岛屿 / United States Minor Outlying Islands

这些国家/地区在地图上以投影质心为圆心、半径 3.2px 的圆点 + 10px 透明点击热区渲染，点击仍会打开国家档案；hover 放大 1.5 倍并显示浮层。缺少独立多边形的原因是 Natural Earth 1:50m 的简化：一部分小岛/属地作为母国要素的一部分出现（如法属海外省、斯瓦尔巴与扬马延），另一部分因面积过小被直接省略（如布维岛、托克劳、图瓦卢）。

### 3.2 重复 ISO2 的 TopoJSON 要素

  - AU：Australia + Ashmore and Cartier Is.（合并为一条 path）

### 3.3 映射失败/忽略的 TopoJSON 要素

  - Somaliland：feature.id=缺失；英文名后备匹配失败，未找到对应目录国家
  - N. Cyprus：feature.id=缺失；英文名后备匹配失败，未找到对应目录国家
  - Indian Ocean Ter.：feature.id=缺失；英文名后备匹配失败，未找到对应目录国家
  - Siachen Glacier：feature.id=缺失；英文名后备匹配失败，未找到对应目录国家

## 4. 前端阈值（与地图组件对齐）

- **微国家圆点**：无 polygon 的国家 + `area < 20 px²` 的多边形国家（如梵蒂冈、摩纳哥、新加坡等）在质心位置额外绘制圆点 + 10px 透明热区，避免点击不到；面积单位是 Equal Earth 投影后的 px²。圆点屏幕半径恒定为 3.2px（前端用 ResizeObserver 换算，不随舞台宽度伸缩），颜色在 category 模式跟随政策组、在 completeness 模式用薄荷绿强度，无资料国家用天空蓝兜底。
- **hover / selected**：hover 覆盖层在最后绘制（1.6px 类别色 / 薄荷绿描边 + 外发光 + 上浮），selected 覆盖层为金色 2px 描边 + 发光 + 质心脉冲点；两者都由前端 `client/features/map/map.css` 实现，本文件只提供几何与质心。
- 面积最小的 12 个已映射国家（用于校核阈值）：

  - VA：0 px² @ (529.51, 114.38)
  - MC：0.01 px² @ (517.36, 108.68)
  - BL：0.02 px² @ (333.58, 195.18)
  - MO：0.02 px² @ (796.76, 179.91)
  - NR：0.02 px² @ (952.56, 261.9)
  - NF：0.03 px² @ (927.71, 363.69)
  - PN：0.03 px² @ (167.02, 347.57)
  - SX：0.03 px² @ (333.08, 194.64)
  - GG：0.04 px² @ (494.22, 91.76)
  - MF：0.04 px² @ (333.09, 194.51)
  - BM：0.05 px² @ (337.58, 145.32)
  - CK：0.05 px² @ (80.9, 336.57)

- **selected 聚焦**：以 `centroids` 为焦点，缩放约 2.2×。质心规则：有 polygon 时取「面积最大的多边形」的球形质心再投影（避免俄罗斯/斐济等跨反经线国家质心落进大西洋），无 polygon 时用 `world-countries` 的 `latlng` 投影。
- **标签分级**：低缩放显示 rank ≤ 8（窄舞台自动降到 6），继续放大依次显示 rank ≤ 14 / 20 / 24（窄舞台为 12 / 18 / 24）；中文名字号按屏幕恒定为约 9.6px（非 SVG 用户单位），最多 24 个，避免遮挡。

## 5. 视觉锚点标签

  1. CN · 中国（China）@ (753.2, 124.7)
  2. US · 美国（United States）@ (262.4, 120.7)
  3. BR · 巴西（Brazil）@ (356.9, 298.9)
  4. RU · 俄罗斯（Russia）@ (683.6, 50.4)
  5. AU · 澳大利亚（Australia）@ (846.6, 352)
  6. JP · 日本（Japan）@ (852, 133.1)
  7. GB · 英国（United Kingdom）@ (486.8, 71.6)
  8. FR · 法国（France）@ (499.7, 112.2)
  9. DE · 德国（Germany）@ (539, 81.3)
  10. IN · 印度（India）@ (707.5, 177.9)
  11. CA · 加拿大（Canada）@ (295, 67.2)
  12. ES · 西班牙（Spain）@ (485.4, 137.2)
  13. IT · 意大利（Italy）@ (548.9, 121.5)
  14. TR · 土耳其（Türkiye）@ (593.6, 121.3)
  15. AE · 阿拉伯联合酋长国（United Arab Emirates）@ (657.1, 150)
  16. SA · 沙特阿拉伯（Saudi Arabia）@ (624, 183.4)
  17. TH · 泰国（Thailand）@ (775.3, 211.2)
  18. SG · 新加坡（Singapore）@ (805.4, 269)
  19. KR · 韩国（South Korea）@ (835.8, 113.7)
  20. MX · 墨西哥（Mexico）@ (234.5, 174)
  21. ZA · 南非（South Africa）@ (564.2, 363.4)
  22. EG · 埃及（Egypt）@ (582.9, 157.2)
  23. NZ · 新西兰（New Zealand）@ (899.4, 411.9)
  24. AR · 阿根廷（Argentina）@ (339.4, 382)

标签防重叠失败（构建时自动跳过）：
  - 无（所有锚点均成功放置）

## 6. 数据许可与署名

- **几何数据**：`world-atlas` npm 包的 `countries-*.json` 由 **Natural Earth** 公共领域（public domain）数据构建；Natural Earth 不要求署名，但本项目保留来源说明。`world-atlas` 代码本身为 ISC 许可。
- **国家目录 / ccn3→ISO2 / 缺失国经纬度**：`world-countries@5.1.0`（<https://github.com/mledoze/countries>），**ODbL 1.0**。派生目录的再分发与公开使用须保留署名并遵守 ODbL 条款；完整许可见 `data/LICENSE-ODbL.txt`，项目内说明见 `data/ATTRIBUTION.md`。
- **本项目 250 国目录**：`data/countries.json`（由 world-countries 生成）+ `data/source/global_249_countries_cn_passport_visa.csv`（小组整理）。
- 地图几何**不是**国界法律结论；Natural Earth 的边界表示仅供示意，不表达任何领土主张。运行期无外网、无地图瓦片、无 Key。

## 7. 已知限制

1. 1:50m 分辨率下，微型国家与偏远小岛（见 3.1）没有独立多边形，只能以点渲染；贴近海岸线时点位置是「最大多边形/世界国家库中心点」的投影近似。
2. 俄罗斯、斐济、美国等跨反经线国家的 path 由 d3-geo 自动切割，投影后左右两段并存属正常现象；质心取「最大多边形」，不会落到大西洋。
3. 目录中 `XK`（科索沃）的 ISO2 不是 ISO 3166-1 官方代码，沿用 world-countries/项目目录约定；其 TopoJSON 要素无 id，由英文名后备匹配。
4. 标签位置在构建期做了一次基于 1000×520 基准的贪心防重叠；高缩放后自然拉开。字号与显隐由前端按缩放级别控制。
5. 文件体积目标是 < 1.6MB；若未来升级到 10m 分辨率或增加图层，需要重新评估体积（当前 1140.9 KiB）。
