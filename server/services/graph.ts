/**
 * 签证知识图谱（轻量、可解释、数据库驱动）
 *
 * 节点：
 * - 国家 COUNTRY：国家目录 + 别名 + ISO2
 * - 地区 REGION：欧洲/亚洲/…
 * - 政策组 GROUP：免签入境/落地签/电子签/预办签证/特殊
 * - 签证类别 CATEGORY：16 类（互免、单方面免签、申根签证…）
 * - 签证类型 VISA_TYPE：旅游/商务/留学…
 *
 * 边：
 * - COUNTRY -IN_REGION-> REGION
 * - COUNTRY -HAS_POLICY-> CATEGORY（真实旅游签等政策）
 * - COUNTRY -MENTIONS_TYPE-> VISA_TYPE（来源提到的其他类型线索）
 * - CATEGORY -BELONGS_TO-> GROUP
 * - 同义词/别名 -ALIAS_OF-> 上述实体
 *
 * 检索时先把查询词解析为图谱实体，再用实体→国家/类型的边生成精确过滤条件；
 * 解析不到实体才退回原有全文检索，避免「美国」把提到美国签证的无关国家也混进来。
 */
import type { SearchQuery, GraphEntityRef, GraphEntityType } from '../../shared/contracts.ts';
import { POLICY_GROUPS, REGIONS, VISA_CATEGORIES, VISA_TYPES } from '../../shared/contracts.ts';
import type { DatabaseDriver, Row } from '../db/driver.ts';
import {
  asString,
  loadDictionaries,
  loadSynonyms,
  parseJsonStringArray,
} from '../db/repository.ts';

export interface GraphNode {
  type: GraphEntityType;
  code: string;
  label: string;
  aliases: string[];
}

interface GraphIndex {
  nodes: GraphNode[];
  aliasIndex: Map<string, GraphNode[]>;
  countriesByRegion: Map<string, string[]>;
  countriesByGroup: Map<string, string[]>;
  countriesByCategory: Map<string, string[]>;
  countriesByType: Map<string, string[]>;
  regionNodes: Map<string, GraphNode>;
  groupNodes: Map<string, GraphNode>;
  categoryNodes: Map<string, GraphNode>;
  typeNodes: Map<string, GraphNode>;
  countryNodes: Map<string, GraphNode>;
  categoryGroup: Map<string, string>;
}

export interface GraphResolution {
  used: boolean;
  matched: GraphEntityRef[];
  /** 图谱解析出的国家集合；null 表示不限制国家 */
  countryCodes: string[] | null;
  /** 图谱解析出的签证类型，覆盖 query.type（如「商务签」） */
  visaType: string | null;
  path: string;
}

const EMPTY_RESOLUTION: GraphResolution = {
  used: false,
  matched: [],
  countryCodes: null,
  visaType: null,
  path: '',
};

const GROUP_ALIASES: Record<string, string[]> = {
  FREE: ['免签', '免签证', '免签入境', 'visa free', 'visa-free', '免签政策'],
  ARRIVAL: ['落地签', '落地签证', '抵达签', 'visa on arrival', '到岸签'],
  ONLINE: ['电子签', '电子签证', '电子授权', '电子旅行授权', 'evisa', 'e-visa', 'eta'],
  PREARRANGED: ['预办签证', '提前办理', '使领馆签证', '贴纸签', '面签'],
  SPECIAL: ['特殊许可', '属地签证', '特殊地区', '过境管制'],
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  MUTUAL_FREE: ['互免', '互免签证', '双向免签'],
  UNILATERAL_FREE: ['单方面免签', '单方免签', '单向免签'],
  CONDITIONAL_FREE: ['有条件免签', '条件免签'],
  FREE_WITH_REGISTRATION: ['免签预登记', '免签登记', '电子登记免签'],
  VISA_ON_ARRIVAL: ['落地签', '落地签证', '到岸签'],
  E_VISA: ['电子签', '电子签证', 'evisa'],
  ETA: ['电子旅行授权', 'eta', '电子授权'],
  EMBASSY_VISA: ['使领馆预办', '使馆签', '使领馆签证', '面签'],
  SCHENGEN_VISA: ['申根', '申根区', '申根国', '申根签证'],
  US_VISA_ROUTE: ['美国签证', '美签', '美国签'],
  TERRITORY_VISA: ['属地签证', '海外领地签证', '属地'],
  REGION_PERMIT: ['地区许可', '地区通行证'],
  SPECIAL_PERMIT: ['特殊许可', '管制许可'],
  NO_SOVEREIGN: ['无主权', '无主权签证'],
  REFERENCE_POLICY: ['参照政策', '过境管制'],
  HOME_REGION: ['本国', '本地区', '本国政策'],
};

const TYPE_ALIASES: Record<string, string[]> = {
  TOURISM: ['旅游签', '旅游签证', '旅行签', '观光签', '旅游', 'tourist visa'],
  BUSINESS: ['商务签', '商务签证', '商务访问', '商务', 'business visa'],
  STUDY: ['留学签', '留学签证', '学生签', '留学', 'study visa'],
  WORK: ['工作签', '工作签证', '工签', '工作', 'work visa'],
  FAMILY: ['探亲签', '探亲签证', '探亲访友', '探亲', 'family visa'],
  TRANSIT: ['过境签', '过境签证', '过境', 'transit visa'],
  MEDICAL: ['医疗签', '医疗签证', '医疗', 'medical visa'],
  RESIDENCE: ['居留签', '长期居留', '居留', 'residence visa'],
  DIGITAL_NOMAD: ['数字游民', '数字游民签', 'digital nomad'],
  GOLDEN_VISA: ['黄金签证', '投资签证', '黄金', 'golden visa'],
  WORKING_HOLIDAY: ['打工度假', '打工度假签', 'working holiday'],
  RESEARCH: ['科研访学', '访学签', '访学', 'research visa'],
};

const REGION_ALIASES: Record<string, string[]> = {
  EU: ['欧洲', '欧盟', 'europe'],
  AS: ['亚洲', 'asia'],
  AF: ['非洲', 'africa'],
  NA: ['北美', '北美洲', '加勒比', 'north america'],
  SA: ['南美', '南美洲', 'south america'],
  OC: ['大洋洲', 'oceania'],
  AN: ['南极', '南极洲', 'antarctica'],
};


const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s·・\-_/／，,。.？?！!、]/g, '');

/** 编辑距离 ≤1 的轻量容错（仅用于英文/拼音短词，避免中文误配） */
function isOneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let indexA = 0;
  let indexB = 0;
  let edits = 0;
  while (indexA < a.length && indexB < b.length) {
    if (a[indexA] === b[indexB]) { indexA += 1; indexB += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) indexA += 1;
    else if (a.length < b.length) indexB += 1;
    else { indexA += 1; indexB += 1; }
  }
  return edits + (a.length - indexA) + (b.length - indexB) <= 1;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/* ------------------------------------------------------------------ */
/* 建图                                                               */
/* ------------------------------------------------------------------ */

const graphCache = new WeakMap<DatabaseDriver, Promise<GraphIndex>>();

async function buildGraph(driver: DatabaseDriver): Promise<GraphIndex> {
  const [dictionaries, countryRows, policyRows, mentionRows, synonymRows] = await Promise.all([
    loadDictionaries(driver),
    driver.query('SELECT iso2, name_zh, name_en, aliases, region_code FROM countries ORDER BY iso2'),
    driver.query(
      'SELECT p.country_code, p.category_code, p.visa_type FROM visa_policies p ' +
        'WHERE p.is_visible = 1 AND p.is_demo = 0',
    ),
    driver.query('SELECT country_code, visa_type FROM mentioned_visa_types'),
    loadSynonyms(driver),
  ]);

  const countryNodes = new Map<string, GraphNode>();
  const regionNodes = new Map<string, GraphNode>();
  const groupNodes = new Map<string, GraphNode>();
  const categoryNodes = new Map<string, GraphNode>();
  const typeNodes = new Map<string, GraphNode>();
  const aliasIndex = new Map<string, GraphNode[]>();

  const addNode = (target: Map<string, GraphNode>, node: Omit<GraphNode, 'aliases'>, aliases: string[]): GraphNode => {
    const merged = unique([node.label, ...aliases].map(item => normalize(item)).filter(item => item.length > 0));
    const existing = target.get(node.code);
    if (existing) {
      existing.aliases = unique([...existing.aliases, ...merged]);
      registerAliases(existing);
      return existing;
    }
    const created: GraphNode = { ...node, aliases: merged };
    target.set(node.code, created);
    registerAliases(created);
    return created;
  };

  const registerAliases = (node: GraphNode): void => {
    for (const alias of node.aliases) {
      const list = aliasIndex.get(alias) ?? [];
      if (!list.includes(node)) list.push(node);
      aliasIndex.set(alias, list);
    }
  };

  for (const row of countryRows) {
    const iso2 = asString(row, 'iso2');
    const aliases = [
      asString(row, 'name_zh'),
      asString(row, 'name_en'),
      iso2,
      ...parseJsonStringArray(row['aliases']),
    ];
    addNode(countryNodes, { type: 'COUNTRY', code: iso2, label: asString(row, 'name_zh') }, aliases);
  }

  for (const region of dictionaries.regions) {
    addNode(regionNodes, { type: 'REGION', code: region.code, label: region.nameZh }, [
      region.nameZh,
      region.nameEn,
      region.code,
      ...(REGION_ALIASES[region.code] ?? []),
    ]);
  }

  for (const group of dictionaries.groups) {
    addNode(groupNodes, { type: 'GROUP', code: group.code, label: group.nameZh }, [
      group.nameZh,
      group.nameEn,
      group.code,
      ...(GROUP_ALIASES[group.code] ?? []),
    ]);
  }

  for (const category of dictionaries.categories) {
    addNode(categoryNodes, { type: 'CATEGORY', code: category.code, label: category.nameZh }, [
      category.nameZh,
      category.nameEn,
      category.code,
      ...(CATEGORY_ALIASES[category.code] ?? []),
    ]);
  }

  for (const type of dictionaries.types) {
    addNode(typeNodes, { type: 'VISA_TYPE', code: type.code, label: type.nameZh }, [
      type.nameZh,
      type.nameEn,
      type.code,
      ...(TYPE_ALIASES[type.code] ?? []),
    ]);
  }

  // 同义词：COUNTRY/CATEGORY/TYPE 的 canonical 是代码；KEYWORD 映射到政策组/类别
  const keywordTargets: Record<string, GraphEntityRef> = {
    免签: { type: 'GROUP', code: 'FREE', label: '免签入境' },
    免签入境: { type: 'GROUP', code: 'FREE', label: '免签入境' },
    落地签: { type: 'GROUP', code: 'ARRIVAL', label: '落地签' },
    电子签: { type: 'GROUP', code: 'ONLINE', label: '电子签 / 电子授权' },
    申根: { type: 'CATEGORY', code: 'SCHENGEN_VISA', label: '申根签证' },
    商务签: { type: 'VISA_TYPE', code: 'BUSINESS', label: '商务访问' },
  };
  const nodeForSynonym = (kind: string, canonical: string): GraphNode | undefined => {
    if (kind === 'COUNTRY') return countryNodes.get(canonical);
    if (kind === 'CATEGORY') return categoryNodes.get(canonical);
    if (kind === 'TYPE') return typeNodes.get(canonical);
    if (kind === 'KEYWORD') {
      const target = keywordTargets[canonical];
      if (!target) return undefined;
      if (target.type === 'GROUP') return groupNodes.get(target.code);
      if (target.type === 'CATEGORY') return categoryNodes.get(target.code);
      return typeNodes.get(target.code);
    }
    return undefined;
  };
  for (const synonym of synonymRows) {
    const node = nodeForSynonym(synonym.kind, synonym.canonical);
    if (!node) continue;
    const alias = normalize(synonym.term);
    if (!alias) continue;
    if (!node.aliases.includes(alias)) {
      node.aliases.push(alias);
      registerAliases(node);
    }
  }

  // 国家 → 地区
  const countriesByRegion = new Map<string, string[]>();
  for (const row of countryRows) {
    const iso2 = asString(row, 'iso2');
    const region = asString(row, 'region_code');
    const list = countriesByRegion.get(region) ?? [];
    list.push(iso2);
    countriesByRegion.set(region, list);
  }

  // 国家 → 类别/政策组/签证类型（政策）
  const countriesByGroup = new Map<string, string[]>();
  const countriesByCategory = new Map<string, string[]>();
  const countriesByType = new Map<string, string[]>();
  const categoryGroup = new Map(dictionaries.categories.map(category => [category.code, category.group]));
  for (const row of policyRows) {
    const iso2 = asString(row, 'country_code');
    const category = asString(row, 'category_code');
    const group = categoryGroup.get(category);
    const type = asString(row, 'visa_type');
    if (group) countriesByGroup.set(group, unique([...(countriesByGroup.get(group) ?? []), iso2]));
    countriesByCategory.set(category, unique([...(countriesByCategory.get(category) ?? []), iso2]));
    countriesByType.set(type, unique([...(countriesByType.get(type) ?? []), iso2]));
  }
  // 仅类型线索
  for (const row of mentionRows) {
    const iso2 = asString(row, 'country_code');
    const type = asString(row, 'visa_type');
    countriesByType.set(type, unique([...(countriesByType.get(type) ?? []), iso2]));
  }

  return {
    nodes: [...countryNodes.values(), ...regionNodes.values(), ...groupNodes.values(), ...categoryNodes.values(), ...typeNodes.values()],
    aliasIndex,
    countriesByRegion,
    countriesByGroup,
    countriesByCategory,
    countriesByType,
    regionNodes,
    groupNodes,
    categoryNodes,
    typeNodes,
    countryNodes,
    categoryGroup,
  };
}

export function getGraph(driver: DatabaseDriver): Promise<GraphIndex> {
  const cached = graphCache.get(driver);
  if (cached) return cached;
  const pending = buildGraph(driver);
  graphCache.set(driver, pending);
  return pending;
}

/* ------------------------------------------------------------------ */
/* 查询解析                                                           */
/* ------------------------------------------------------------------ */

const ENTITY_PRIORITY: GraphEntityType[] = ['COUNTRY', 'REGION', 'GROUP', 'CATEGORY', 'VISA_TYPE'];

function preferEntities(nodes: GraphNode[]): GraphNode[] {
  const distinct = unique(nodes);
  if (distinct.length <= 1) return distinct;
  // 同一查询命中多个类型时给出全部命中；LLM 图谱查询可解释性优先于静默丢弃
  return distinct.sort((a, b) => ENTITY_PRIORITY.indexOf(a.type) - ENTITY_PRIORITY.indexOf(b.type));
}

function matchEntities(index: GraphIndex, rawQuery: string): GraphNode[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const exact = index.aliasIndex.get(query);
  if (exact && exact.length > 0) return pruneRedundant(index, preferEntities(exact));

  // 完整实体名包含在查询中（如「日本旅游签」「欧洲国家」）：优先最长别名。
  // 拉丁字母别名至少 3 个字符，避免 ISO2 短码（如 PN）被「Japn」这类输入误命中。
  const contained = [...index.aliasIndex.entries()]
    .filter(([alias]) => (alias.length >= 3 || /^[\u4e00-\u9fff]{2,}$/.test(alias)) && query.includes(alias))
    .sort((a, b) => b[0].length - a[0].length)
    .flatMap(([, nodes]) => nodes);
  if (contained.length > 0) return pruneRedundant(index, preferEntities(contained));

  // 轻量容错：仅对长度 ≥3 的拉丁字母查询做 1 次编辑距离匹配
  if (/^[a-z0-9]{3,}$/.test(query)) {
    const fuzzy = index.nodes.filter(node =>
      node.aliases.some(alias => /^[a-z0-9]{3,}$/.test(alias) && isOneEditApart(query, alias)),
    );
    if (fuzzy.length > 0) return pruneRedundant(index, preferEntities(fuzzy));
  }
  return [];
}

/**
 * 同一查询可能同时命中政策组与其子类别（「电子签」→ ONLINE + E_VISA）。
 * 组已覆盖其下类别，保留组即可，避免交集把 ETA 国家排除。
 */
function pruneRedundant(index: GraphIndex, nodes: GraphNode[]): GraphNode[] {
  const groupCodes = new Set(nodes.filter(node => node.type === 'GROUP').map(node => node.code));
  if (groupCodes.size === 0) return nodes;
  return nodes.filter(
    node => node.type !== 'CATEGORY' || !groupCodes.has(index.categoryGroup.get(node.code) ?? ''),
  );
}

function countryCodesForEntity(index: GraphIndex, node: GraphNode, effectiveType: string): string[] {
  switch (node.type) {
    case 'COUNTRY':
      return [node.code];
    case 'REGION':
      return index.countriesByRegion.get(node.code) ?? [];
    case 'GROUP':
      return index.countriesByGroup.get(node.code) ?? [];
    case 'CATEGORY':
      return index.countriesByCategory.get(node.code) ?? [];
    case 'VISA_TYPE':
      return index.countriesByType.get(node.code) ?? [];
    default:
      return [];
  }
}

const typeLabel = (code: string): string => VISA_TYPES.find(type => type.code === code)?.nameZh ?? code;
const groupLabel = (code: string): string => POLICY_GROUPS.find(group => group.code === code)?.nameZh ?? code;
const categoryLabel = (code: string): string => VISA_CATEGORIES.find(category => category.code === code)?.nameZh ?? code;
const regionLabel = (code: string): string => REGIONS.find(region => region.code === code)?.nameZh ?? code;

function pathForEntity(index: GraphIndex, node: GraphNode, countryCount: number): string {
  const countText = node.type === 'VISA_TYPE' ? `${countryCount} 个国家/地区` : `${countryCount} 个国家/地区`;
  const label =
    node.type === 'COUNTRY'
      ? node.label
      : node.type === 'REGION'
        ? regionLabel(node.code)
        : node.type === 'GROUP'
          ? groupLabel(node.code)
          : node.type === 'CATEGORY'
            ? categoryLabel(node.code)
            : typeLabel(node.code);
  return `${graphTypeLabel(node.type)} · ${label} → ${countText}`;
}

export function graphTypeLabel(type: GraphEntityType): string {
  switch (type) {
    case 'COUNTRY': return '国家';
    case 'REGION': return '地区';
    case 'GROUP': return '政策组';
    case 'CATEGORY': return '签证类别';
    case 'VISA_TYPE': return '签证类型';
  }
}

/**
 * 解析用户查询到图谱实体，并返回精确的国家/类型约束。
 * 未命中任何实体时 used=false，检索回退全文。
 */
export async function resolveSearchGraph(driver: DatabaseDriver, query: SearchQuery): Promise<GraphResolution> {
  const raw = query.q.trim();
  if (!raw) return EMPTY_RESOLUTION;
  const index = await getGraph(driver);
  const matches = matchEntities(index, raw);
  if (matches.length === 0) return EMPTY_RESOLUTION;

  // 一个国家 + 其他实体组合时，保留国家约束，其他实体作为附加过滤（仅支持类型覆盖）
  const countryMatch = matches.find(node => node.type === 'COUNTRY');
  const typeMatch = matches.find(node => node.type === 'VISA_TYPE');
  const primary = countryMatch ?? matches[0];
  const effectiveType = typeMatch?.code ?? query.type;

  const countrySets = matches.map(node => countryCodesForEntity(index, node, effectiveType));
  let countryCodes: string[] | null = null;
  if (primary.type === 'COUNTRY') {
    countryCodes = countryCodesForEntity(index, primary, effectiveType);
  } else if (matches.some(node => node.type !== 'COUNTRY')) {
    // 多个非国家实体取交集（如「欧洲 申根」）
    const nonCountry = matches.filter(node => node.type !== 'COUNTRY');
    const intersection = nonCountry
      .map(node => new Set(countryCodesForEntity(index, node, effectiveType)))
      .reduce<Set<string> | null>((acc, current) => {
        if (!acc) return current;
        return new Set([...acc].filter(code => current.has(code)));
      }, null);
    countryCodes = intersection ? [...intersection] : [];
  }
  if (countryCodes !== null) countryCodes = unique(countryCodes).sort();

  const matched: GraphEntityRef[] = matches.slice(0, 4).map(node => ({
    type: node.type,
    code: node.code,
    label:
      node.type === 'COUNTRY'
        ? node.label
        : node.type === 'REGION'
          ? regionLabel(node.code)
          : node.type === 'GROUP'
            ? groupLabel(node.code)
            : node.type === 'CATEGORY'
              ? categoryLabel(node.code)
              : typeLabel(node.code),
  }));

  const path = matches
    .slice(0, 3)
    .map(node => pathForEntity(index, node, countrySets[matches.indexOf(node)].length))
    .join(' + ');

  return {
    used: true,
    matched,
    countryCodes,
    visaType: typeMatch ? typeMatch.code : null,
    path,
  };
}

/** 图谱节点计数（调试/测试用） */
export async function graphStats(driver: DatabaseDriver): Promise<{ nodes: number; aliases: number }> {
  const index = await getGraph(driver);
  return { nodes: index.nodes.length, aliases: index.aliasIndex.size };
}
