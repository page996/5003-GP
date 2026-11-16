/**
 * Visa Atlas v1.0 — 前后端共享字段约定（唯一事实来源）
 *
 * 任何接口、数据库读取、界面展示都必须使用本文件的类型与常量。
 * 国家使用 ISO 3166-1 alpha-2 两位大写代码；路线使用稳定 route_code。
 */

/* ------------------------------------------------------------------ */
/* 基础枚举与字典                                                      */
/* ------------------------------------------------------------------ */

export type RegionCode = 'EU' | 'AS' | 'AF' | 'NA' | 'SA' | 'OC' | 'AN';
export type PolicyGroup = 'FREE' | 'ARRIVAL' | 'ONLINE' | 'PREARRANGED' | 'SPECIAL';
export type StayUnit = 'DAY' | 'MONTH' | 'YEAR';
export type StayRule = 'PER_ENTRY' | 'ROLLING_WINDOW' | 'UNSPECIFIED';
export type EntryScope = 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
export type DataStatus = 'DETAILED' | 'PARTIAL' | 'SUMMARY_ONLY' | 'MENTION_ONLY' | 'DEMO';
export type SearchSort = 'relevance' | 'name' | 'stay_desc' | 'completeness';
export type MatchKind = 'POLICY' | 'MENTION_ONLY';
export type DbMode = 'sqlite' | 'mysql';

export interface RegionInfo {
  code: RegionCode;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
}

export interface VisaTypeInfo {
  code: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
}

export interface VisaCategoryInfo {
  code: string;
  nameZh: string;
  nameEn: string;
  group: PolicyGroup;
  requiresVisa: boolean;
  requiresAuthorization: boolean;
  /** 0 = 最宽松，越大表示办理门槛越高；用于排序与视觉编码 */
  severity: number;
  color: string;
}

export interface PolicyGroupInfo {
  code: PolicyGroup;
  nameZh: string;
  nameEn: string;
  color: string;
  description: string;
}

export interface StayBucketInfo {
  code: string;
  label: string;
  minDays: number | null;
  maxDays: number | null;
}

/* ------------------------------------------------------------------ */
/* 字典内容（ETL / 数据库种子 / 前端筛选共用）                          */
/* ------------------------------------------------------------------ */

export const REGIONS: RegionInfo[] = [
  { code: 'EU', nameZh: '欧洲', nameEn: 'Europe', sortOrder: 1 },
  { code: 'AS', nameZh: '亚洲', nameEn: 'Asia', sortOrder: 2 },
  { code: 'AF', nameZh: '非洲', nameEn: 'Africa', sortOrder: 3 },
  { code: 'NA', nameZh: '北美与加勒比', nameEn: 'North America & Caribbean', sortOrder: 4 },
  { code: 'SA', nameZh: '南美洲', nameEn: 'South America', sortOrder: 5 },
  { code: 'OC', nameZh: '大洋洲', nameEn: 'Oceania', sortOrder: 6 },
  { code: 'AN', nameZh: '南极地区', nameEn: 'Antarctica', sortOrder: 7 },
];

export const VISA_TYPES: VisaTypeInfo[] = [
  { code: 'TOURISM', nameZh: '旅游观光', nameEn: 'Tourism', sortOrder: 1 },
  { code: 'BUSINESS', nameZh: '商务访问', nameEn: 'Business', sortOrder: 2 },
  { code: 'STUDY', nameZh: '留学学习', nameEn: 'Study', sortOrder: 3 },
  { code: 'WORK', nameZh: '工作就业', nameEn: 'Work', sortOrder: 4 },
  { code: 'FAMILY', nameZh: '探亲访友', nameEn: 'Family visit', sortOrder: 5 },
  { code: 'TRANSIT', nameZh: '过境中转', nameEn: 'Transit', sortOrder: 6 },
  { code: 'MEDICAL', nameZh: '医疗访问', nameEn: 'Medical', sortOrder: 7 },
  { code: 'RESIDENCE', nameZh: '长期居留', nameEn: 'Residence', sortOrder: 8 },
  { code: 'DIGITAL_NOMAD', nameZh: '数字游民', nameEn: 'Digital nomad', sortOrder: 9 },
  { code: 'GOLDEN_VISA', nameZh: '投资 / 黄金签证', nameEn: 'Golden visa', sortOrder: 10 },
  { code: 'WORKING_HOLIDAY', nameZh: '打工度假', nameEn: 'Working holiday', sortOrder: 11 },
  { code: 'RESEARCH', nameZh: '科研访学', nameEn: 'Research', sortOrder: 12 },
];

export const POLICY_GROUPS: PolicyGroupInfo[] = [
  {
    code: 'FREE',
    nameZh: '免签入境',
    nameEn: 'Visa free',
    color: '#A0DA26',
    description: '互免、单方面免签、附条件免签或仅需免费登记',
  },
  {
    code: 'ARRIVAL',
    nameZh: '落地签',
    nameEn: 'Visa on arrival',
    color: '#DFC11D',
    description: '抵达口岸后现场或凭批文办理签证',
  },
  {
    code: 'ONLINE',
    nameZh: '电子签 / 电子授权',
    nameEn: 'E-visa / ETA',
    color: '#1DC5CE',
    description: '在线申请电子签证或电子旅行授权',
  },
  {
    code: 'PREARRANGED',
    nameZh: '预办签证',
    nameEn: 'Pre-arranged visa',
    color: '#FF633D',
    description: '出发前向使领馆或签证中心递交申请',
  },
  {
    code: 'SPECIAL',
    nameZh: '特殊许可 / 属地',
    nameEn: 'Special permit',
    color: '#8C9AA3',
    description: '特殊许可、军事/生态管制、属地签证或无主权地区',
  },
];

export const VISA_CATEGORIES: VisaCategoryInfo[] = [
  { code: 'MUTUAL_FREE', nameZh: '互免签证', nameEn: 'Mutual visa exemption', group: 'FREE', requiresVisa: false, requiresAuthorization: false, severity: 1, color: '#A0DA26' },
  { code: 'UNILATERAL_FREE', nameZh: '单方面免签', nameEn: 'Unilateral visa exemption', group: 'FREE', requiresVisa: false, requiresAuthorization: false, severity: 2, color: '#B7E94B' },
  { code: 'CONDITIONAL_FREE', nameZh: '有条件免签', nameEn: 'Conditional visa exemption', group: 'FREE', requiresVisa: false, requiresAuthorization: false, severity: 4, color: '#8CC61E' },
  { code: 'FREE_WITH_REGISTRATION', nameZh: '免签（需预登记）', nameEn: 'Visa free with registration', group: 'FREE', requiresVisa: false, requiresAuthorization: true, severity: 5, color: '#CFF56A' },
  { code: 'VISA_ON_ARRIVAL', nameZh: '落地签', nameEn: 'Visa on arrival', group: 'ARRIVAL', requiresVisa: false, requiresAuthorization: true, severity: 6, color: '#DFC11D' },
  { code: 'E_VISA', nameZh: '电子签证', nameEn: 'E-visa', group: 'ONLINE', requiresVisa: true, requiresAuthorization: true, severity: 7, color: '#1DC5CE' },
  { code: 'ETA', nameZh: '电子旅行授权', nameEn: 'Electronic travel authorisation', group: 'ONLINE', requiresVisa: false, requiresAuthorization: true, severity: 7, color: '#64DDE3' },
  { code: 'EMBASSY_VISA', nameZh: '使领馆预办签证', nameEn: 'Embassy / consular visa', group: 'PREARRANGED', requiresVisa: true, requiresAuthorization: true, severity: 9, color: '#FF633D' },
  { code: 'SCHENGEN_VISA', nameZh: '申根签证', nameEn: 'Schengen visa', group: 'PREARRANGED', requiresVisa: true, requiresAuthorization: true, severity: 10, color: '#FF7A57' },
  { code: 'US_VISA_ROUTE', nameZh: '需美国签证', nameEn: 'Requires US visa', group: 'PREARRANGED', requiresVisa: true, requiresAuthorization: true, severity: 11, color: '#FF9278' },
  { code: 'TERRITORY_VISA', nameZh: '属地 / 海外领地签证', nameEn: 'Territory visa', group: 'SPECIAL', requiresVisa: true, requiresAuthorization: true, severity: 8, color: '#8796A3' },
  { code: 'REGION_PERMIT', nameZh: '特殊地区通行证', nameEn: 'Regional permit', group: 'SPECIAL', requiresVisa: false, requiresAuthorization: true, severity: 9, color: '#9CA9B2' },
  { code: 'SPECIAL_PERMIT', nameZh: '特殊许可 / 管制', nameEn: 'Special permit', group: 'SPECIAL', requiresVisa: true, requiresAuthorization: true, severity: 12, color: '#B3BEC4' },
  { code: 'NO_SOVEREIGN', nameZh: '无主权签证体系', nameEn: 'No sovereign visa system', group: 'SPECIAL', requiresVisa: true, requiresAuthorization: true, severity: 13, color: '#C0C9CE' },
  { code: 'REFERENCE_POLICY', nameZh: '参照 / 过境管制', nameEn: 'Reference policy', group: 'SPECIAL', requiresVisa: true, requiresAuthorization: true, severity: 12, color: '#A6B2BA' },
  { code: 'HOME_REGION', nameZh: '本国 / 本地区', nameEn: 'Home region', group: 'SPECIAL', requiresVisa: false, requiresAuthorization: false, severity: 0, color: '#9FB3C8' },
];

export const STAY_BUCKETS: StayBucketInfo[] = [
  { code: 'LE_7', label: '7 天以内', minDays: 0, maxDays: 7 },
  { code: 'D8_30', label: '8–30 天', minDays: 8, maxDays: 30 },
  { code: 'D31_90', label: '31–90 天', minDays: 31, maxDays: 90 },
  { code: 'D91_180', label: '91–180 天', minDays: 91, maxDays: 180 },
  { code: 'GT_180', label: '180 天以上', minDays: 181, maxDays: null },
  { code: 'UNKNOWN', label: '停留期待确认', minDays: null, maxDays: null },
];

export const DATA_STATUS_META: Record<DataStatus, { label: string; description: string; tone: string }> = {
  DETAILED: { label: '完整明细', description: '费用、材料、办理时间、资格规则均已收集', tone: 'good' },
  PARTIAL: { label: '部分明细', description: '已有部分结构化明细，其余待补充', tone: 'partial' },
  SUMMARY_ONLY: { label: '摘要级资料', description: '仅有政策分类与一句官方口径摘要，明细待采集', tone: 'basic' },
  MENTION_ONLY: { label: '仅类型线索', description: '已从来源识别该签证类型，尚无结构化资料', tone: 'hint' },
  DEMO: { label: '演示明细', description: '用于验证界面与检索流程的虚构样本，不可用于申请', tone: 'demo' },
};

export const SEARCH_SORTS: { code: SearchSort; label: string }[] = [
  { code: 'relevance', label: '相关度' },
  { code: 'name', label: '国家名称 A–Z' },
  { code: 'stay_desc', label: '停留期最长' },
  { code: 'completeness', label: '资料完整度' },
];

/* ------------------------------------------------------------------ */
/* 查询与响应                                                          */
/* ------------------------------------------------------------------ */

export interface SearchQuery {
  q: string;
  type: string;
  regions: RegionCode[];
  groups: PolicyGroup[];
  categories: string[];
  stays: string[];
  statuses: DataStatus[];
  priorityOnly: boolean;
  includeDemo: boolean;
  sort: SearchSort;
  page: number;
  pageSize: number;
}

export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  q: '',
  type: 'TOURISM',
  regions: [],
  groups: [],
  categories: [],
  stays: [],
  statuses: [],
  priorityOnly: false,
  includeDemo: false,
  sort: 'relevance',
  page: 1,
  pageSize: 24,
};

export interface FacetBucket {
  code: string;
  label: string;
  count: number;
  color?: string;
}

export interface SearchFacets {
  regions: FacetBucket[];
  groups: FacetBucket[];
  categories: FacetBucket[];
  types: FacetBucket[];
  stays: FacetBucket[];
  statuses: FacetBucket[];
}

export interface SearchItem {
  /** 稳定唯一键：真实路线用 routeCode，仅类型线索用 `ISO2:TYPE` */
  key: string;
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: RegionCode;
  regionLabel: string;
  visaType: string;
  visaTypeLabel: string;
  matchKind: MatchKind;
  routeCode: string | null;
  categoryCode: string | null;
  categoryLabel: string | null;
  group: PolicyGroup | null;
  groupLabel: string | null;
  requiresVisa: boolean | null;
  stayDays: number | null;
  stayUnit: StayUnit | null;
  stayLabel: string | null;
  entryScope: EntryScope | null;
  summary: string | null;
  mentionText: string | null;
  dataStatus: DataStatus;
  statusLabel: string;
  completeness: number;
  isDemo: boolean;
  priority: boolean;
  sourceId: string | null;
  score: number;
}

export type GraphEntityType = 'COUNTRY' | 'REGION' | 'GROUP' | 'CATEGORY' | 'VISA_TYPE';

export interface GraphEntityRef {
  type: GraphEntityType;
  code: string;
  label: string;
}

export interface SearchGraphInfo {
  used: boolean;
  /** 查询解析出的图谱实体（最多 4 个） */
  matched: GraphEntityRef[];
  /** 可解释路径，如「国家 · 美国 → 1 个国家/地区」 */
  path: string;
}

export interface SearchResponse {
  query: SearchQuery;
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  facets: SearchFacets;
  /** 当前筛选命中的全部国家代码（去重，用于地图着色，最多 300 个） */
  matchedCountries: string[];
  /** 图谱优先检索的解析结果；未命中实体时不存在 */
  graph?: SearchGraphInfo;
  tookMs: number;
  mode: DbMode;
  datasetVersion: string;
}

export interface Suggestion {
  kind: 'country' | 'alias' | 'category' | 'type' | 'keyword';
  code: string;
  label: string;
  hint: string;
  iso2?: string;
}

export interface MapCountry {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: RegionCode;
  regionLabel: string;
  hasData: boolean;
  priority: boolean;
  categoryCode: string | null;
  categoryLabel: string | null;
  group: PolicyGroup | null;
  groupLabel: string | null;
  requiresVisa: boolean | null;
  stayDays: number | null;
  stayUnit: StayUnit | null;
  stayLabel: string | null;
  completeness: number;
  hasDemoDetail: boolean;
}

export interface CountryInfo {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: RegionCode;
  regionLabel: string;
  aliases: string[];
  latitude: number | null;
  longitude: number | null;
  priority: boolean;
}

export interface SourceInfo {
  sourceId: string;
  title: string;
  publisher: string;
  url: string | null;
  kind: string;
  accessedAt: string;
  status: string;
  note: string | null;
}

export interface PolicyDocument {
  code: string;
  name: string;
  requirement: string | null;
  quantity: number | null;
  required: boolean | null;
  condition: string | null;
}

export interface PolicyFee {
  code: string;
  label: string;
  amountMin: string | null;
  amountMax: string | null;
  currency: string | null;
  basis: string | null;
  condition: string | null;
  comparable: boolean;
}

export interface PolicyTiming {
  code: string;
  label: string;
  minDays: number | null;
  maxDays: number | null;
  dayType: 'WORKING_DAY' | 'CALENDAR_DAY' | null;
  startEvent: string | null;
  note: string | null;
  comparable: boolean;
}

/** 可解释的个人条件规则（演示明细中用于展示字段能力） */
export interface PolicyRule {
  code: string;
  fieldName: string;
  operatorName: 'IN' | 'ANY_OF' | 'GTE' | 'LTE' | 'BETWEEN';
  /** JSON 字符串，如 ["CN"]、6、[18,30] */
  expectedValue: string;
  description: string;
}

export interface PolicyRecord {
  routeCode: string;
  countryCode: string;
  visaType: string;
  visaTypeLabel: string;
  categoryCode: string;
  categoryLabel: string;
  group: PolicyGroup;
  groupLabel: string;
  title: string;
  summary: string | null;
  conditionsText: string | null;
  /** CSV 原始分类原文，便于回查归一化是否合理 */
  sourceCategory: string | null;
  stayDays: number | null;
  stayUnit: StayUnit | null;
  stayRule: StayRule;
  windowDays: number | null;
  windowMaxDays: number | null;
  entryScope: EntryScope;
  validityNote: string | null;
  applicationChannel: string | null;
  requiresVisa: boolean;
  requiresAuthorization: boolean;
  dataStatus: DataStatus;
  completeness: number;
  isDemo: boolean;
  sourceId: string | null;
  collectedAt: string;
  updatedAt: string;
  documents: PolicyDocument[];
  fees: PolicyFee[];
  timings: PolicyTiming[];
  rules: PolicyRule[];
}

export interface MentionInfo {
  visaType: string;
  visaTypeLabel: string;
  rawText: string | null;
}

export interface CountryDossier {
  country: CountryInfo;
  source: SourceInfo | null;
  policies: PolicyRecord[];
  demoPolicies: PolicyRecord[];
  mentions: MentionInfo[];
  tourism: PolicyRecord | null;
  stats: {
    policyCount: number;
    demoCount: number;
    mentionCount: number;
    maxCompleteness: number;
    regionLabel: string;
  };
}

export interface DatasetMeta {
  schemaVersion: string;
  datasetVersion: string;
  mode: DbMode;
  generatedAt: string;
  importedAt: string | null;
  sourceFile: string;
  sourceHash: string;
  policyCount: number;
  countryCount: number;
  demoPolicyCount: number;
  categoryCount: number;
  typeCount: number;
  disclaimer: string;
}

export interface DashboardStats {
  countries: number;
  policies: number;
  withPolicy: number;
  withoutPolicy: number;
  priorityTargets: number;
  demoDetails: number;
  averageCompleteness: number;
  byGroup: FacetBucket[];
  byRegion: { code: RegionCode; label: string; countries: number; withData: number }[];
  byType: FacetBucket[];
}

export interface OverviewResponse {
  meta: DatasetMeta;
  stats: DashboardStats;
  mapCountries: MapCountry[];
  dictionaries: {
    regions: RegionInfo[];
    types: VisaTypeInfo[];
    categories: VisaCategoryInfo[];
    groups: PolicyGroupInfo[];
    stayBuckets: StayBucketInfo[];
  };
}

export interface HealthResponse {
  status: 'ok';
  mode: DbMode;
  datasetVersion: string;
  uptimeSeconds: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

export type ApiEnvelope<T> = { data: T };

/* ------------------------------------------------------------------ */
/* 展示辅助函数（前后端共用，纯函数）                                   */
/* ------------------------------------------------------------------ */

export const regionLabel = (code: RegionCode | string): string =>
  REGIONS.find(region => region.code === code)?.nameZh ?? code;

export const policyGroupLabel = (code: PolicyGroup | string): string =>
  POLICY_GROUPS.find(group => group.code === code)?.nameZh ?? code;

export const policyGroupColor = (code: PolicyGroup | string): string =>
  POLICY_GROUPS.find(group => group.code === code)?.color ?? '#9fb3c8';

export const visaTypeLabel = (code: string): string =>
  VISA_TYPES.find(type => type.code === code)?.nameZh ?? code;

export const categoryLabel = (code: string | null): string =>
  code ? VISA_CATEGORIES.find(category => category.code === code)?.nameZh ?? code : '';

/** 分类强调色：同一政策组共享一个语义色（免签绿/落地签黄/电子签青/预办珊瑚） */
export const categoryColor = (code: string | null | undefined): string => {
  if (!code) return '#8C9AA3';
  const category = VISA_CATEGORIES.find(item => item.code === code);
  if (!category) return '#8C9AA3';
  return POLICY_GROUPS.find(group => group.code === category.group)?.color ?? '#8C9AA3';
};

export const entryScopeLabel = (scope: EntryScope | null): string =>
  scope === 'SINGLE' ? '单次入境' : scope === 'MULTIPLE' ? '多次入境' : '入境次数待确认';

export const dataStatusLabel = (status: DataStatus): string => DATA_STATUS_META[status]?.label ?? status;

/** 把数据库中的停留期字段格式化成人类可读文本 */
export function formatStay(
  days: number | null,
  unit: StayUnit | null = 'DAY',
  rule: StayRule = 'UNSPECIFIED',
  windowDays: number | null = null,
  windowMaxDays: number | null = null,
): string | null {
  if (days === null) return null;
  if (unit === 'MONTH') return `每次最多 ${days} 个月`;
  if (unit === 'YEAR') return `每次最多 ${days} 年`;
  if (rule === 'ROLLING_WINDOW' && windowDays !== null && windowMaxDays !== null) {
    return `${windowDays} 天内累计不超过 ${windowMaxDays} 天`;
  }
  if (rule === 'ROLLING_WINDOW' && windowDays !== null) {
    return `${windowDays} 天内累计停留 ${days} 天`;
  }
  if (windowDays !== null && windowMaxDays !== null) {
    return `每次最多 ${days} 天，${windowDays} 天内累计不超过 ${windowMaxDays} 天`;
  }
  return `每次最多 ${days} 天`;
}

export function completenessLabel(score: number): string {
  if (score >= 80) return '完整';
  if (score >= 55) return '较完整';
  if (score >= 30) return '摘要级';
  if (score > 0) return '线索级';
  return '待采集';
}

export function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** 把 SearchQuery 序列化为稳定、可分享的 URL 查询串（不含空值） */
export function toSearchParams(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type && query.type !== 'TOURISM') params.set('type', query.type);
  if (query.regions.length) params.set('region', query.regions.join(','));
  if (query.groups.length) params.set('group', query.groups.join(','));
  if (query.categories.length) params.set('category', query.categories.join(','));
  if (query.stays.length) params.set('stay', query.stays.join(','));
  if (query.statuses.length) params.set('status', query.statuses.join(','));
  if (query.priorityOnly) params.set('priority', '1');
  if (query.includeDemo) params.set('demo', '1');
  if (query.sort !== 'relevance') params.set('sort', query.sort);
  if (query.page > 1) params.set('page', String(query.page));
  return params;
}

export const DISCLAIMER =
  'Visa Atlas 是课程项目：资料由小组从公开信息整理，未经使领馆逐条确认，不构成签证、法律或出行建议，请以官方最新公告为准。';
