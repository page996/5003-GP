/**
 * Visa Atlas v1.0 · ETL
 *
 * 输入：
 *   data/source/global_249_countries_cn_passport_visa.csv   249 个目的地的真实旅游签摘要
 *   data/source/demo-details.json                            可选：虚构演示明细（未来类型的展示样本）
 *   data/source/synonyms.json                                可选：检索同义词
 *   data/countries.json                                      250 个国家与地区目录（含 XK）
 *   data/coverage-targets.json                               91 个重点候选目的地
 * 输出：
 *   data/generated/dataset.json                              数据库种子的唯一来源
 *   data/generated/report.json + report.md                   ETL 质量报告
 *
 * 运行：npm run data:build
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POLICY_GROUPS,
  REGIONS,
  VISA_CATEGORIES,
  VISA_TYPES,
  type DataStatus,
  type EntryScope,
  type PolicyGroup,
  type RegionCode,
  type StayRule,
  type StayUnit,
} from '../shared/contracts.ts';
import type {
  DatasetBatch,
  DatasetCountry,
  DatasetDocument,
  DatasetFee,
  DatasetFile,
  DatasetMention,
  DatasetPolicy,
  DatasetRule,
  DatasetSynonym,
  DatasetTiming,
} from '../shared/dataset.ts';
import type { SourceInfo } from '../shared/contracts.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SOURCE_DIR = path.join(ROOT, 'data/source');
const GENERATED_DIR = path.join(ROOT, 'data/generated');
const CSV_PATH = path.join(SOURCE_DIR, 'global_249_countries_cn_passport_visa.csv');
const DEMO_PATH = path.join(SOURCE_DIR, 'demo-details.json');
const SYNONYMS_PATH = path.join(SOURCE_DIR, 'synonyms.json');
const CATALOG_PATH = path.join(ROOT, 'data/countries.json');
const TARGETS_PATH = path.join(ROOT, 'data/coverage-targets.json');

const GENERATED_AT = new Date().toISOString();
const REAL_SOURCE_ID = 'src-group-csv-249';
const DEMO_SOURCE_ID = 'src-demo-samples';
const REAL_BATCH_ID = 'batch-csv-249';
const DEMO_BATCH_ID = 'batch-demo-details-1';

/* ------------------------------------------------------------------------- */
/* 基础工具                                                                   */
/* ------------------------------------------------------------------------- */

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const exists = async (file: string) => { try { await readFile(file); return true; } catch { return false; } };
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const uniq = <T>(items: T[]) => [...new Set(items)];
const clean = (value: string | undefined) => (value ?? '').replace(/\uFEFF/g, '').trim();

/** 极简 CSV 解析：支持引号、转义引号、CRLF、空行。该数据源无复杂转义，但保持健壮。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/* ------------------------------------------------------------------------- */
/* 1. 分类归一化：76 种原始中文分类 → 16 个可筛选类别                         */
/* ------------------------------------------------------------------------- */

const RAW_CATEGORY_MAP: Record<string, string> = {
  预办申根签证: 'SCHENGEN_VISA',
  互免签证: 'MUTUAL_FREE',
  单方面免签: 'UNILATERAL_FREE',
  预办签证: 'EMBASSY_VISA',
  电子签证: 'E_VISA',
  '有条件免签/预办签证': 'CONDITIONAL_FREE',
  '落地签/电子签': 'VISA_ON_ARRIVAL',
  '电子签证/落地签': 'E_VISA',
  '电子签证/预办签证': 'E_VISA',
  '落地签/预办签证': 'VISA_ON_ARRIVAL',
  落地签: 'VISA_ON_ARRIVAL',
  '有条件免签/荷属签': 'CONDITIONAL_FREE',
  法属海外省签证: 'TERRITORY_VISA',
  法属海外领地签证: 'TERRITORY_VISA',
  澳大利亚签证通用: 'TERRITORY_VISA',
  申根签证通用: 'SCHENGEN_VISA',
  英国签证通用: 'TERRITORY_VISA',
  需美国签证: 'US_VISA_ROUTE',
  '预办签证/电子签': 'EMBASSY_VISA',
  无人自然保护区: 'NO_SOVEREIGN',
  有条件免签: 'CONDITIONAL_FREE',
  '有条件免签/电子签': 'CONDITIONAL_FREE',
  '法属海外领地签/免签': 'TERRITORY_VISA',
  '港澳通行证/签注': 'REGION_PERMIT',
  '电子旅行授权(eTA)': 'ETA',
  '电子签证/有条件免签': 'E_VISA',
  '落地签(免签证费)': 'VISA_ON_ARRIVAL',
  '需丹麦另行签注': 'TERRITORY_VISA',
  '预办签证(十年多次)': 'EMBASSY_VISA',
  '严格军事/生态管制': 'SPECIAL_PERMIT',
  '严格军事管制': 'SPECIAL_PERMIT',
  '互免签证(需申根过境)': 'MUTUAL_FREE',
  '互免签证/入境卡': 'MUTUAL_FREE',
  '互免签证/旅行授权': 'MUTUAL_FREE',
  '免签(需电子预登记)': 'FREE_WITH_REGISTRATION',
  '单方面免签(14天内)': 'UNILATERAL_FREE',
  '单方面免签/电子签': 'UNILATERAL_FREE',
  参照摩洛哥入境政策: 'REFERENCE_POLICY',
  '受以/约口岸管制': 'SPECIAL_PERMIT',
  大通证及入台证: 'REGION_PERMIT',
  挪威申根多次签证: 'SCHENGEN_VISA',
  '无主权签证(需过境国签)': 'NO_SOVEREIGN',
  '有条件免签(EVATS)/美签': 'CONDITIONAL_FREE',
  '有条件免签/CA-4签证': 'CONDITIONAL_FREE',
  '有条件免签/团队免签': 'CONDITIONAL_FREE',
  '有条件免签/英属领地签': 'CONDITIONAL_FREE',
  '有条件免签/领地签': 'CONDITIONAL_FREE',
  '本国/地区': 'HOME_REGION',
  '法属海外省签/免签': 'TERRITORY_VISA',
  '电子旅行授权(AVE)/十年签': 'ETA',
  '电子旅行授权(ETA)': 'ETA',
  '电子旅行授权(eTAS)': 'ETA',
  '电子旅行授权/免签': 'ETA',
  '电子签/团队免签/贴纸签': 'E_VISA',
  '电子签证/另纸签证': 'E_VISA',
  '电子签证/预办签': 'E_VISA',
  '落地签(需在线预登记)': 'VISA_ON_ARRIVAL',
  '落地签/电子落地签': 'VISA_ON_ARRIVAL',
  需专门入境许可: 'SPECIAL_PERMIT',
  需专门访客许可: 'SPECIAL_PERMIT',
  需办理登岛访问许可: 'SPECIAL_PERMIT',
  需多次申根签证: 'SCHENGEN_VISA',
  需新西兰签及许可: 'TERRITORY_VISA',
  需法属南部领地许可: 'SPECIAL_PERMIT',
  预办生物识别签证: 'EMBASSY_VISA',
  预办电子签证: 'E_VISA',
  '预办签证(互免暂行中止)': 'EMBASSY_VISA',
  '预办签证(申根多次免签)': 'EMBASSY_VISA',
  '预办签证(英爱体系)': 'EMBASSY_VISA',
  '预办签证(贴纸/电子)': 'EMBASSY_VISA',
  '预办签证(需邀请函)': 'EMBASSY_VISA',
  '预办签证/有条件免签': 'EMBASSY_VISA',
  '预办签证/济州岛免签': 'EMBASSY_VISA',
  '预办签证/落地批文': 'EMBASSY_VISA',
  '预办签证/落地签(批文)': 'EMBASSY_VISA',
  预办面谈签证: 'EMBASSY_VISA',
};

const categoryByCode = new Map(VISA_CATEGORIES.map(category => [category.code, category]));
const groupByCode = new Map(POLICY_GROUPS.map(group => [group.code, group]));
const typeByCode = new Map(VISA_TYPES.map(type => [type.code, type]));

/* ------------------------------------------------------------------------- */
/* 2. 停留期 / 入境次数解析                                                   */
/* ------------------------------------------------------------------------- */

interface StayFact {
  days: number | null;
  unit: StayUnit | null;
  rule: StayRule;
  windowDays: number | null;
  windowMaxDays: number | null;
}

function parseStay(description: string, rawCategory: string): StayFact {
  const text = description.replace(/\s+/g, '');
  const empty: StayFact = { days: null, unit: null, rule: 'UNSPECIFIED', windowDays: null, windowMaxDays: null };

  // 180 天 / 12 个月滚动窗口内的累计上限
  const windowDaysMatch = text.match(/(\d{2,3})\s*天(?:内)?[，,]?\s*累计(?:停留)?(?:不超过?|不超|最多)\s*(\d{1,3})\s*天/);
  const windowMonthsMatch = text.match(/(\d{1,2})\s*个月内[，,]?\s*累计(?:停留)?(?:不超过?|不超|最多)\s*(\d{1,3})\s*天/);
  const yearlyCapMatch = text.match(/(?:一|1)\s*年(?:内)?[，,]?\s*累计(?:停留)?(?:不超过?|不超|最多)\s*(\d{1,3})\s*天/);
  let windowDays: number | null = null;
  let windowMaxDays: number | null = null;
  if (windowDaysMatch) {
    windowDays = Number(windowDaysMatch[1]);
    windowMaxDays = Number(windowDaysMatch[2]);
  } else if (windowMonthsMatch) {
    const months = Number(windowMonthsMatch[1]);
    windowDays = months >= 12 ? 365 : months * 30;
    windowMaxDays = Number(windowMonthsMatch[2]);
  } else if (yearlyCapMatch) {
    windowDays = 365;
    windowMaxDays = Number(yearlyCapMatch[1]);
  }

  // 每次/单次入境的停留上限
  const perEntryMatch = text.match(/(?:每次|单次|一次)(?:入境)?(?:停留)?(?:不超过?|不超|最多)?\s*(\d{1,3})\s*天/);
  if (perEntryMatch) {
    const days = Number(perEntryMatch[1]);
    return { days, unit: 'DAY', rule: 'PER_ENTRY', windowDays, windowMaxDays };
  }
  if (windowMaxDays !== null) {
    return { days: windowMaxDays, unit: 'DAY', rule: 'ROLLING_WINDOW', windowDays, windowMaxDays };
  }

  // 每月/每年停留的写法（例：停留不超过 6 个月）
  const monthMatch = text.match(/(?:停留|入境|逗留)(?:不超过?|不超|最多)?\s*(\d{1,2})\s*个月/);
  if (monthMatch) return { days: Number(monthMatch[1]), unit: 'MONTH', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };
  const parenMonthMatch = text.match(/[（(](\d{1,2})个月[）)]/);
  if (parenMonthMatch) return { days: Number(parenMonthMatch[1]), unit: 'MONTH', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };

  // “15/30/90 天”这类多档落地签，取最大允许停留
  const multiMatch = text.match(/(\d{1,3})\s*(?:\/\s*\d{1,3})+\s*天/);
  if (multiMatch) {
    const values = multiMatch[0].match(/\d{1,3}/g)?.map(Number) ?? [];
    return { days: Math.max(...values), unit: 'DAY', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };
  }

  // 常规“停留/免签 X 天”
  const genericMatch = text.match(/(?:停留(?:期)?(?:不超过?|最多|为|可达|不超)?|免签(?:入境)?(?:停留)?|可免签(?:停留)?|可停留|允许停留|停留时间(?:不超过?)?)\s*(\d{1,3})\s*天/);
  if (genericMatch) return { days: Number(genericMatch[1]), unit: 'DAY', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };

  // 括号内的天数（例：C类申根短期旅游签证(90天)）
  const parenDayMatch = text.match(/[（(](\d{1,3})\s*天[）)]/);
  if (parenDayMatch) return { days: Number(parenDayMatch[1]), unit: 'DAY', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };

  // 兜底：取最后一个“X 天”前面的数字（跳过“180天内累计”这类窗口描述）
  const fallback = [...text.matchAll(/(\d{1,3})\s*天/g)]
    .filter(match => !/天(?:内)?[^。；;]{0,8}?累计/.test(text.slice((match.index ?? 0), (match.index ?? 0) + 18)))
    .pop();
  if (fallback) return { days: Number(fallback[1]), unit: 'DAY', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };

  // 从分类括注里取（例：单方面免签(14天内)）
  const categoryDays = rawCategory.match(/[（(](\d{1,3})\s*天内[）)]/);
  if (categoryDays) return { days: Number(categoryDays[1]), unit: 'DAY', rule: 'PER_ENTRY', windowDays: null, windowMaxDays: null };

  return empty;
}

function parseEntryScope(description: string, rawCategory: string): EntryScope {
  const joined = `${rawCategory} ${description}`;
  if (/(?:十年|10年|五年|5年|三年|3年|两年|2年|一年|1年)\s*多次/.test(joined)) return 'MULTIPLE';
  if (/单次\//.test(joined)) return 'MULTIPLE';
  if (/单次/.test(joined) && !/多次/.test(joined)) return 'SINGLE';
  if (/多次/.test(rawCategory)) return 'MULTIPLE';
  return 'UNKNOWN';
}

function parseValidityNote(description: string, rawCategory: string): string | null {
  const descriptionMatch = description.match(/(?:十年|10年|五年|5年|三年|3年|两年|2年|一年|1年)\s*多次/);
  if (descriptionMatch) return descriptionMatch[0].replace(/\s+/g, '');
  const match = rawCategory.match(/[（(]([^）)]{2,20})[）)]/);
  if (!match) return null;
  const note = match[1].trim();
  if (/十年|5年|五年|一年|多次/.test(note)) return note.includes('多次') ? note : `${note}多次`;
  return note;
}

/* ------------------------------------------------------------------------- */
/* 3. “其他常见签证类型” → 类型代码                                          */
/* ------------------------------------------------------------------------- */

const TYPE_KEYWORDS: { code: string; keywords: string[] }[] = [
  { code: 'DIGITAL_NOMAD', keywords: ['数字游民'] },
  { code: 'GOLDEN_VISA', keywords: ['黄金签证', '投资移民', '购房移民', '投资签证'] },
  { code: 'WORKING_HOLIDAY', keywords: ['打工度假', '度假打工', '工作假期'] },
  { code: 'RESEARCH', keywords: ['科研', '科考', '访问学者', '研究'] },
  { code: 'BUSINESS', keywords: ['商务', '商签', '商业', '专业交流'] },
  { code: 'STUDY', keywords: ['留学', '学生签', '学生签证', '学习', '学生居留', '学生许可', '学生准证', '高等教育', '就学'] },
  { code: 'WORK', keywords: ['工作', '劳务', '就业', '工签', '打工', '蓝卡', '人才护照', '技术工人', '红白红卡'] },
  { code: 'FAMILY', keywords: ['探亲', '家庭', '亲属'] },
  { code: 'TRANSIT', keywords: ['过境', '转机'] },
  { code: 'MEDICAL', keywords: ['医疗', '就医'] },
  { code: 'RESIDENCE', keywords: ['居留', '永居', '长期签证', '长期定居', '第二家园', 'D7', '被动收入'] },
];

function parseMentionTypes(raw: string): { code: string; keyword: string }[] {
  const text = clean(raw);
  if (!text) return [];
  const found: { code: string; keyword: string }[] = [];
  for (const entry of TYPE_KEYWORDS) {
    const keyword = entry.keywords.find(item => text.includes(item));
    if (keyword) found.push({ code: entry.code, keyword });
  }
  return uniq(found.map(item => item.code)).map(code => ({ code, keyword: found.find(item => item.code === code)!.keyword }));
}

/* ------------------------------------------------------------------------- */
/* 4. 国家目录与保底别名                                                      */
/* ------------------------------------------------------------------------- */

const CATALOG_REGION_MAP: Record<string, RegionCode> = {
  Asia: 'AS', Europe: 'EU', Africa: 'AF', 'North America': 'NA', 'South America': 'SA',
  Oceania: 'OC', Antarctic: 'AN', Americas: 'NA',
};

const EXTRA_ALIASES: Record<string, string[]> = {
  CN: ['中国', '中华人民共和国', 'PRC', 'China'],
  US: ['美国', '美利坚', 'USA', 'U.S.', 'America', 'United States of America'],
  GB: ['英国', 'UK', 'U.K.', 'Britain', 'Great Britain', 'England', '苏格兰', '英格兰'],
  AE: ['阿联酋', 'UAE', '迪拜', 'Dubai', '阿布扎比'],
  KR: ['韩国', '南韩', 'South Korea', 'Korea'],
  KP: ['朝鲜', '北韩', 'North Korea'],
  JP: ['日本', 'Japan', '东京'],
  SG: ['新加坡', 'Singapore', '狮城'],
  TH: ['泰国', 'Thailand', '曼谷'],
  VN: ['越南', 'Vietnam', 'Viet Nam'],
  MY: ['马来西亚', 'Malaysia'],
  ID: ['印尼', '印度尼西亚', 'Indonesia', '巴厘岛'],
  PH: ['菲律宾', 'Philippines'],
  AU: ['澳大利亚', '澳洲', 'Australia'],
  NZ: ['新西兰', '纽西兰', 'New Zealand'],
  DE: ['德国', 'Germany', 'Deutschland'],
  FR: ['法国', 'France'],
  IT: ['意大利', 'Italy'],
  ES: ['西班牙', 'Spain'],
  NL: ['荷兰', 'Netherlands', 'Holland'],
  CH: ['瑞士', 'Switzerland'],
  RU: ['俄罗斯', 'Russia'],
  CA: ['加拿大', 'Canada'],
  BR: ['巴西', 'Brazil'],
  MX: ['墨西哥', 'Mexico'],
  TR: ['土耳其', 'Turkey', 'Türkiye'],
  EG: ['埃及', 'Egypt'],
  ZA: ['南非', 'South Africa'],
  IN: ['印度', 'India'],
  HK: ['香港', 'Hong Kong', 'Hongkong'],
  MO: ['澳门', 'Macau', 'Macao'],
  TW: ['台湾', 'Taiwan', '台湾地区'],
  AQ: ['南极', 'Antarctica'],
};

interface CatalogCountry {
  code: string; nameZh: string; nameEn: string; region: string; subregion: string;
  sortKey: string; aliases: string[]; latitude: number | null; longitude: number | null; sourceUrl: string;
}

/* ------------------------------------------------------------------------- */
/* 5. 主流程                                                                  */
/* ------------------------------------------------------------------------- */

async function main() {
  await mkdir(GENERATED_DIR, { recursive: true });

  const csvText = await readFile(CSV_PATH, 'utf8');
  const sourceHash = sha256(csvText);
  const rows = parseCsv(csvText);
  const header = rows[0].map(cell => clean(cell));
  const columnIndex = (needle: string) => {
    const index = header.findIndex(cell => cell.includes(needle));
    if (index < 0) throw new Error(`CSV 缺少列：${needle}；实际表头：${header.join(' | ')}`);
    return index;
  };
  const col = {
    iso2: columnIndex('国家/地区代码'),
    region: columnIndex('大洲分组'),
    nameZh: columnIndex('中文名称'),
    nameEn: columnIndex('英文名称'),
    routeCode: columnIndex('推荐路线编号'),
    rawCategory: columnIndex('中国护照通行政策分类'),
    description: columnIndex('旅游签证及免签/落地签说明'),
    otherTypes: columnIndex('其他常见签证类型'),
  };

  const csvRows = rows.slice(1).map((cells, index) => ({
    line: index + 2,
    iso2: clean(cells[col.iso2]),
    region: clean(cells[col.region]),
    nameZh: clean(cells[col.nameZh]),
    nameEn: clean(cells[col.nameEn]),
    routeCode: clean(cells[col.routeCode]),
    rawCategory: clean(cells[col.rawCategory]),
    description: clean(cells[col.description]),
    otherTypes: clean(cells[col.otherTypes]),
  }));
  if (csvRows.length !== 249) console.warn(`⚠ CSV 行数 ${csvRows.length}，预期 249`);
  const duplicateCodes = csvRows.map(row => row.iso2).filter((code, index, all) => all.indexOf(code) !== index);
  if (duplicateCodes.length) throw new Error(`CSV 国家代码重复：${uniq(duplicateCodes).join(',')}`);
  const duplicateRoutes = csvRows.map(row => row.routeCode).filter((code, index, all) => all.indexOf(code) !== index);
  if (duplicateRoutes.length) throw new Error(`CSV 路线编号重复：${uniq(duplicateRoutes).join(',')}`);

  const catalog = await readJson<CatalogCountry[]>(CATALOG_PATH);
  const catalogByCode = new Map(catalog.map(country => [country.code, country]));
  const targets = await readJson<{ countryCode: string; priority: boolean }[]>(TARGETS_PATH);
  const priorityByCode = new Map(targets.map(target => [target.countryCode, Boolean(target.priority)]));
  const csvCodes = new Set(csvRows.map(row => row.iso2));
  const missingInCatalog = csvRows.filter(row => !catalogByCode.has(row.iso2));
  if (missingInCatalog.length) throw new Error(`CSV 国家不在目录中：${missingInCatalog.map(row => row.iso2).join(',')}`);

  const sources: SourceInfo[] = [
    {
      sourceId: REAL_SOURCE_ID,
      title: '全球 249 个国家/地区 · 中国普通护照旅游签政策整理表',
      publisher: 'Visa Atlas 课程项目组（小组整理）',
      url: null,
      kind: 'COMPILED_DATASET',
      accessedAt: GENERATED_AT,
      status: 'SINGLE_SOURCE',
      note: '由课程小组按公开信息汇总的 CSV；未附逐国官方链接，未经过使领馆逐条复核。以官方最新公告为准。',
    },
  ];
  const batches: DatasetBatch[] = [
    {
      batchId: REAL_BATCH_ID,
      name: '249 国旅游签摘要（真实落地批次）',
      sourceFile: 'data/source/global_249_countries_cn_passport_visa.csv',
      importedAt: GENERATED_AT,
      rowCount: csvRows.length,
      notes: '本轮唯一真实数据批次；仅摘要级（政策分类 + 一句说明），费用/材料/审核时间未采集。',
    },
  ];

  const countries: DatasetCountry[] = [];
  const policies: DatasetPolicy[] = [];
  const mentions: DatasetMention[] = [];
  const categoryUsage = new Map<string, number>();
  const rawCategoryUsage = new Map<string, { count: number; canonical: string }>();
  const warnings: string[] = [];
  const unmappedMentions: { iso2: string; raw: string }[] = [];

  const allCodes = uniq([...catalog.map(country => country.code), ...csvRows.map(row => row.iso2)]);
  for (const iso2 of allCodes) {
    const catalogCountry = catalogByCode.get(iso2);
    if (!catalogCountry) throw new Error(`目录缺少国家 ${iso2}`);
    const csvRow = csvRows.find(row => row.iso2 === iso2);
    const regionCode: RegionCode = csvRow
      ? ((csvRow.region as RegionCode) ?? 'AS')
      : CATALOG_REGION_MAP[catalogCountry.region] ?? 'AS';
    const aliases = uniq([
      ...catalogCountry.aliases,
      ...(EXTRA_ALIASES[iso2] ?? []),
      ...(csvRow && csvRow.nameEn !== catalogCountry.nameEn ? [catalogCountry.nameEn] : []),
    ]).filter(Boolean);
    countries.push({
      iso2,
      nameZh: csvRow?.nameZh || catalogCountry.nameZh,
      nameEn: csvRow?.nameEn || catalogCountry.nameEn,
      region: regionCode,
      subregion: catalogCountry.subregion ?? null,
      sortKey: catalogCountry.sortKey,
      aliases,
      latitude: catalogCountry.latitude ?? null,
      longitude: catalogCountry.longitude ?? null,
      priority: priorityByCode.get(iso2) ?? false,
    });
  }

  for (const row of csvRows) {
    const canonical = RAW_CATEGORY_MAP[row.rawCategory];
    if (!canonical) throw new Error(`第 ${row.line} 行分类未归一化：${row.rawCategory}`);
    const category = categoryByCode.get(canonical);
    if (!category) throw new Error(`未知类别代码：${canonical}`);
    rawCategoryUsage.set(row.rawCategory, {
      count: (rawCategoryUsage.get(row.rawCategory)?.count ?? 0) + 1,
      canonical,
    });
    categoryUsage.set(canonical, (categoryUsage.get(canonical) ?? 0) + 1);

    const country = countries.find(item => item.iso2 === row.iso2)!;
    const stay = parseStay(row.description, row.rawCategory);
    const entryScope = parseEntryScope(row.description, row.rawCategory);
    const validityNote = parseValidityNote(row.description, row.rawCategory);

    const mentionTypes = parseMentionTypes(row.otherTypes);
    const rawTokens = row.otherTypes.split(/[、,，/／;；]/).map(token => token.trim()).filter(Boolean);
    for (const token of rawTokens) {
      if (!parseMentionTypes(token).length) unmappedMentions.push({ iso2: row.iso2, raw: token });
    }
    for (const mention of mentionTypes) {
      mentions.push({
        countryCode: row.iso2,
        visaType: mention.code,
        rawText: row.otherTypes,
        sourceId: REAL_SOURCE_ID,
      });
    }

    let completeness = 15;
    if (row.description.length >= 6) completeness += 10;
    if (stay.days !== null) completeness += 15;
    if (entryScope !== 'UNKNOWN') completeness += 5;
    completeness += 10; // 来源可追溯
    if (mentionTypes.length) completeness += 5;
    completeness = Math.min(completeness, 55);

    const typeLabel = typeByCode.get('TOURISM')?.nameZh ?? '旅游观光';
    // 注意：不把“其他常见签证类型”原文并入旅游签 search_text，否则搜索「商签」会误命中旅游签卡片；
    // 类型线索由 mentioned_visa_types.raw_text 在 DB 侧按所选签证类型单独匹配。
    const searchText = [
      country.nameZh, country.nameEn, country.iso2, ...country.aliases,
      row.rawCategory, category.nameZh, category.nameEn, groupByCode.get(category.group)?.nameZh ?? '',
      typeLabel, row.description,
    ].join(' ').toLowerCase();

    policies.push({
      routeCode: row.routeCode,
      countryCode: row.iso2,
      visaType: 'TOURISM',
      categoryCode: canonical,
      title: `${country.nameZh} · 旅游签证（${category.nameZh}）`,
      summary: row.description || null,
      conditionsText: row.description || null,
      sourceCategory: row.rawCategory,
      stayDays: stay.days,
      stayUnit: stay.unit,
      stayRule: stay.rule,
      windowDays: stay.windowDays,
      windowMaxDays: stay.windowMaxDays,
      entryScope,
      validityNote,
      applicationChannel: category.group === 'PREARRANGED' ? '使领馆 / 签证申请中心（以官方要求为准）' : null,
      requiresVisa: category.requiresVisa,
      requiresAuthorization: category.requiresAuthorization,
      dataStatus: 'SUMMARY_ONLY',
      completeness,
      isDemo: false,
      sourceId: REAL_SOURCE_ID,
      collectedAt: GENERATED_AT,
      updatedAt: GENERATED_AT,
      searchText,
      documents: [],
      fees: [],
      timings: [],
      rules: [],
      batchId: REAL_BATCH_ID,
    });
  }

  /* ---------------- 演示明细（可选，未来类型展示样本） ---------------- */
  let demoPolicies: DatasetPolicy[] = [];
  let demoBusinessTypes: string[] = [];
  if (await exists(DEMO_PATH)) {
    const demo = await readJson<{
      schemaVersion: string;
      batchId: string;
      generatedAt: string;
      note: string;
      policies: Omit<DatasetPolicy, 'isDemo' | 'dataStatus' | 'sourceId' | 'collectedAt' | 'updatedAt' | 'searchText' | 'batchId' | 'sourceCategory'>[];
    }>(DEMO_PATH);
    if (demo.schemaVersion !== '2.0') throw new Error('demo-details.json schemaVersion 必须为 2.0');
    const realRoutes = new Set(policies.map(policy => policy.routeCode));
    const demoCountries = new Set<string>();
    for (const item of demo.policies) {
      if (realRoutes.has(item.routeCode)) throw new Error(`演示路线与真实路线冲突：${item.routeCode}`);
      if (!catalogByCode.has(item.countryCode)) throw new Error(`演示路线国家不存在：${item.countryCode}`);
      if (!typeByCode.has(item.visaType)) throw new Error(`演示路线类型不存在：${item.visaType}`);
      const category = categoryByCode.get(item.categoryCode);
      if (!category) throw new Error(`演示路线类别不存在：${item.categoryCode}`);
      const country = countries.find(entry => entry.iso2 === item.countryCode)!;
      const documents: DatasetDocument[] = (item.documents ?? []).map((document, index) => ({
        code: document.code, name: document.name, requirement: document.requirement ?? null,
        quantity: document.quantity ?? null, required: document.required ?? null,
        condition: document.condition ?? null, sortOrder: document.sortOrder ?? index + 1,
      }));
      const fees: DatasetFee[] = (item.fees ?? []).map(fee => ({
        code: fee.code, label: fee.label, amountMin: fee.amountMin ?? null, amountMax: fee.amountMax ?? null,
        currency: fee.currency ?? null, basis: fee.basis ?? null, condition: fee.condition ?? null,
        comparable: Boolean(fee.comparable),
      }));
      const timings: DatasetTiming[] = (item.timings ?? []).map((timing, index) => ({
        code: timing.code, label: timing.label, minDays: timing.minDays ?? null, maxDays: timing.maxDays ?? null,
        dayType: timing.dayType ?? null, startEvent: timing.startEvent ?? null, note: timing.note ?? null,
        comparable: Boolean(timing.comparable), sortOrder: timing.sortOrder ?? index + 1,
      }));
      const rules: DatasetRule[] = (item.rules ?? []).map(rule => ({
        code: rule.code, fieldName: rule.fieldName, operatorName: rule.operatorName,
        expectedValue: typeof rule.expectedValue === 'string' ? rule.expectedValue : JSON.stringify(rule.expectedValue),
        description: rule.description,
      }));
      const searchText = [
        country.nameZh, country.nameEn, country.iso2, ...country.aliases,
        typeByCode.get(item.visaType)?.nameZh ?? '', category.nameZh,
        groupByCode.get(category.group)?.nameZh ?? '', item.title, item.summary ?? '', item.conditionsText ?? '',
        documents.map(document => document.name).join(' '),
      ].join(' ').toLowerCase();
      demoPolicies.push({
        ...item,
        title: item.title.includes('演示') ? item.title : `${item.title}（演示样本）`,
        summary: item.summary ? `${item.summary}（演示）` : null,
        conditionsText: item.conditionsText ?? null,
        sourceCategory: null,
        documents, fees, timings, rules,
        completeness: Math.max(0, Math.min(100, item.completeness ?? 80)),
        isDemo: true,
        dataStatus: 'DEMO',
        sourceId: DEMO_SOURCE_ID,
        collectedAt: demo.generatedAt ?? GENERATED_AT,
        updatedAt: GENERATED_AT,
        searchText,
        batchId: DEMO_BATCH_ID,
      });
      demoCountries.add(item.countryCode);
      demoBusinessTypes.push(item.visaType);
    }
    sources.push({
      sourceId: DEMO_SOURCE_ID,
      title: 'Visa Atlas 演示明细样本（虚构）',
      publisher: 'Visa Atlas 课程项目组',
      url: null,
      kind: 'DEMO',
      accessedAt: GENERATED_AT,
      status: 'DEMO',
      note: '完全虚构，仅用于验证费用/材料/办理时间/资格规则字段的展示与检索流程，不可用于任何申请。',
    });
    batches.push({
      batchId: DEMO_BATCH_ID,
      name: `演示明细样本（${demoPolicies.length} 条，虚构）`,
      sourceFile: 'data/source/demo-details.json',
      importedAt: GENERATED_AT,
      rowCount: demoPolicies.length,
      notes: demo.note ?? '虚构演示数据，不代表任何真实政策。',
    });
  }

  /* ---------------- 检索同义词（可选） ---------------- */
  let synonyms: DatasetSynonym[] = [];
  if (await exists(SYNONYMS_PATH)) {
    const raw = await readJson<{ schemaVersion: string; terms: DatasetSynonym[] }>(SYNONYMS_PATH);
    const validKinds = new Set(['COUNTRY', 'CATEGORY', 'TYPE', 'KEYWORD']);
    const seen = new Set<string>();
    for (const term of raw.terms ?? []) {
      const key = clean(term.term).toLowerCase();
      if (!key) { warnings.push('同义词存在空 term'); continue; }
      if (seen.has(key)) { warnings.push(`同义词重复：${term.term}`); continue; }
      if (!validKinds.has(term.kind)) { warnings.push(`同义词 kind 非法：${term.term}`); continue; }
      if (term.kind === 'COUNTRY' && !catalogByCode.has(term.canonical)) { warnings.push(`同义词国家代码不存在：${term.term} → ${term.canonical}`); continue; }
      if (term.kind === 'CATEGORY' && !categoryByCode.has(term.canonical)) { warnings.push(`同义词类别代码不存在：${term.term} → ${term.canonical}`); continue; }
      if (term.kind === 'TYPE' && !typeByCode.has(term.canonical)) { warnings.push(`同义词类型代码不存在：${term.term} → ${term.canonical}`); continue; }
      seen.add(key);
      synonyms.push({ term: clean(term.term), canonical: term.canonical, kind: term.kind, weight: Number(term.weight) || 10 });
    }
  }

  /* ---------------- 组装并写出 dataset ---------------- */
  const allPolicies = [...policies, ...demoPolicies];
  // 内容指纹：同一批数量但字段修订时，datasetVersion 也会变化，便于发现“库没刷新”
  const contentHash = sha256(JSON.stringify({ countries, policies: allPolicies, mentions, synonyms })).slice(0, 8);
  const dataset: DatasetFile = {
    schemaVersion: '2.0',
    datasetVersion: `v1.0.0-csv${policies.length}-demo${demoPolicies.length}-syn${synonyms.length}-${contentHash}`,
    generatedAt: GENERATED_AT,
    source: {
      file: 'data/source/global_249_countries_cn_passport_visa.csv',
      sha256: sourceHash,
      rowCount: csvRows.length,
      note: '小组整理的 249 国旅游签摘要；分类已归一化，停留期与入境次数由文本规则抽取，未采集字段保持 null。',
    },
    dictionaries: {
      regions: REGIONS,
      types: VISA_TYPES,
      categories: VISA_CATEGORIES,
      groups: POLICY_GROUPS,
    },
    sources,
    batches,
    countries,
    policies: allPolicies,
    mentions,
    synonyms,
  };

  const categoryCounts = Object.fromEntries([...categoryUsage.entries()].sort((a, b) => b[1] - a[1]));
  const groupCounts = Object.fromEntries(POLICY_GROUPS.map(group => [group.code, 0])) as Record<string, number>;
  for (const [code, count] of categoryUsage) groupCounts[categoryByCode.get(code)!.group] += count;
  const regionCounts = Object.fromEntries(REGIONS.map(region => [region.code, policies.filter(policy => countries.find(country => country.iso2 === policy.countryCode)?.region === region.code).length]));
  const countryNameMismatches = csvRows
    .filter(row => catalogByCode.get(row.iso2) && (catalogByCode.get(row.iso2)!.nameZh !== row.nameZh || catalogByCode.get(row.iso2)!.nameEn !== row.nameEn))
    .map(row => ({ iso2: row.iso2, csv: [row.nameZh, row.nameEn], catalog: [catalogByCode.get(row.iso2)!.nameZh, catalogByCode.get(row.iso2)!.nameEn] }));
  const missingCountries = catalog.filter(country => !csvCodes.has(country.code)).map(country => country.code);
  const stayKnown = policies.filter(policy => policy.stayDays !== null).length;
  const entryKnown = policies.filter(policy => policy.entryScope !== 'UNKNOWN').length;
  const requiresVisaCounts = {
    visaFree: policies.filter(policy => !policy.requiresVisa && policy.categoryCode !== 'HOME_REGION').length,
    authorization: policies.filter(policy => policy.categoryCode === 'VISA_ON_ARRIVAL' || policy.categoryCode === 'ETA').length,
    visaRequired: policies.filter(policy => policy.requiresVisa).length,
  };

  const report = {
    generatedAt: GENERATED_AT,
    datasetVersion: dataset.datasetVersion,
    source: { file: dataset.source.file, sha256: sourceHash.slice(0, 16), rows: csvRows.length },
    counts: {
      countries: countries.length,
      realPolicies: policies.length,
      demoPolicies: demoPolicies.length,
      mentions: mentions.length,
      synonymTerms: synonyms.length,
      byCategory: categoryCounts,
      byGroup: groupCounts,
      byRegion: regionCounts,
      byType: Object.fromEntries(VISA_TYPES.map(type => [type.code, policies.filter(policy => policy.visaType === type.code).length + demoPolicies.filter(policy => policy.visaType === type.code).length])),
      stayKnown,
      stayUnknown: policies.length - stayKnown,
      entryKnown,
      requiresVisa: requiresVisaCounts,
      citedCountryCoverage: csvCodes.size,
    },
    categoryMapping: [...rawCategoryUsage.entries()].map(([raw, value]) => ({ raw, canonical: value.canonical, count: value.count })).sort((a, b) => b.count - a.count),
    quality: {
      priorityTargets: countries.filter(country => country.priority).length,
      missingCountries,
      countryNameMismatches,
      unmappedMentions: uniq(unmappedMentions.map(item => item.raw)),
      warnings,
      demoTypes: uniq(demoBusinessTypes),
    },
    completeness: {
      averageReal: Math.round(policies.reduce((sum, policy) => sum + policy.completeness, 0) / policies.length),
      minReal: Math.min(...policies.map(policy => policy.completeness)),
      maxReal: Math.max(...policies.map(policy => policy.completeness)),
      statusDistribution: policies.reduce<Record<string, number>>((acc, policy) => { acc[policy.dataStatus] = (acc[policy.dataStatus] ?? 0) + 1; return acc; }, {}),
    },
  };

  await writeFile(path.join(GENERATED_DIR, 'dataset.json'), JSON.stringify(dataset), 'utf8');
  await writeFile(path.join(GENERATED_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  const markdown = [
    '# ETL 质量报告',
    '',
    `- 生成时间：${GENERATED_AT}`,
    `- 数据集版本：${dataset.datasetVersion}`,
    `- 源文件：${dataset.source.file}（${csvRows.length} 行，sha256 ${sourceHash.slice(0, 16)}…）`,
    '',
    '## 数量',
    `- 国家/地区目录：${countries.length}（CSV 覆盖 ${csvCodes.size}，未采集：${missingCountries.join(', ') || '无'}）`,
    `- 真实旅游签政策：${policies.length}`,
    `- 演示明细：${demoPolicies.length}`,
    `- 其他签证类型线索：${mentions.length}`,
    `- 检索同义词：${synonyms.length}`,
    `- 重点候选目的地：${report.quality.priorityTargets}`,
    '',
    '## 政策组分布',
    ...Object.entries(groupCounts).map(([code, count]) => `- ${groupByCode.get(code as PolicyGroup)?.nameZh ?? code}：${count}`),
    '',
    '## 类别分布',
    ...Object.entries(categoryCounts).map(([code, count]) => `- ${categoryByCode.get(code)?.nameZh ?? code}（${code}）：${count}`),
    '',
    '## 字段完整度',
    `- 平均完整度：${report.completeness.averageReal} / 100（摘要级，费用/材料/时间为 0）`,
    `- 可解析停留期：${stayKnown} / ${policies.length}`,
    `- 可识别入境次数：${entryKnown} / ${policies.length}`,
    '',
    '## 需要人工复核',
    ...(warnings.length ? warnings.map(item => `- ${item}`) : ['- 无']),
    ...(unmappedMentions.length ? [`- 其他签证类型列中未识别词：${uniq(unmappedMentions.map(item => item.raw)).join('、')}`] : []),
    ...(countryNameMismatches.length ? [`- 与目录名称不一致：${countryNameMismatches.map(item => item.iso2).join('、')}`] : []),
    '',
    '## 限制',
    '- 分类归一化为 16 个类别，原始 76 种中文分类保存在 `visa_policies.source_category`。',
    '- 复合路线（如“落地签/电子签”）按原始顺序的第一种方式归入主类别，另一方式保留在摘要原文中。',
    '- 停留期由中文文本规则抽取，可能存在解释空间；以 `summary` 原文与官方公告为准。',
    '- 演示明细为完全虚构内容，`is_demo=1` 且 `data_status=DEMO`。',
  ].join('\n');
  await writeFile(path.join(GENERATED_DIR, 'report.md'), markdown, 'utf8');

  console.log('✔ ETL 完成');
  console.log(`  数据集：${dataset.datasetVersion}`);
  console.log(`  国家 ${countries.length} · 真实政策 ${policies.length} · 演示 ${demoPolicies.length} · 线索 ${mentions.length} · 同义词 ${synonyms.length}`);
  console.log(`  类别分布：${JSON.stringify(categoryCounts)}`);
  console.log(`  提示：${warnings.length} 条警告，${unmappedMentions.length} 个未识别类型词（详见 data/generated/report.md）`);
}

main().catch(error => {
  console.error('✘ ETL 失败：', error);
  process.exitCode = 1;
});
