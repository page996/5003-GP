/**
 * 测试用最小数据集（合法 DatasetFile，完全离线可复现）。
 *
 * 覆盖这些检索语义：
 * - 10 国，9 条真实旅游签 + 3 条演示明细（XK 目录内无真实数据）；
 * - 线索：多国 BUSINESS，用于「type=BUSINESS & demo=0 → MENTION_ONLY」；
 * - JP 同时有真实 TOURISM 与演示 TOURISM，验证「真实政策优先」；
 * - 停留期覆盖 DAY/MONTH/null，验证分桶与月份折算；
 * - 同义词覆盖国家别名、类型、多词短语，验证扩展与整句替换。
 */
import type {
  PolicyGroupInfo,
  RegionInfo,
  VisaCategoryInfo,
  VisaTypeInfo,
} from '../../shared/contracts.ts';
import {
  POLICY_GROUPS,
  REGIONS,
  VISA_CATEGORIES,
  VISA_TYPES,
} from '../../shared/contracts.ts';
import type { DatasetCountry, DatasetFile, DatasetPolicy } from '../../shared/dataset.ts';

const FIXTURE_TIME = '2026-01-01T00:00:00.000Z';

const REAL_BATCH_ID = 'batch-fixture-real';
const DEMO_BATCH_ID = 'batch-fixture-demo';
const SOURCE_ID = 'src-fixture';

function country(
  iso2: string,
  nameZh: string,
  nameEn: string,
  region: DatasetCountry['region'],
  sortKey: string,
  options: { aliases?: string[]; priority?: boolean } = {},
): DatasetCountry {
  return {
    iso2,
    nameZh,
    nameEn,
    region,
    subregion: null,
    sortKey,
    aliases: options.aliases ?? [],
    latitude: 0,
    longitude: 0,
    priority: options.priority ?? false,
  };
}

const COUNTRIES: DatasetCountry[] = [
  country('JP', '日本', 'Japan', 'AS', 'japan', { aliases: ['JPN', 'Japan', '日本'], priority: true }),
  country('GB', '英国', 'United Kingdom', 'EU', 'united kingdom', { aliases: ['UK', 'GBR', 'Britain'], priority: true }),
  country('US', '美国', 'United States', 'NA', 'united states', { aliases: ['USA', 'United States'] }),
  country('FR', '法国', 'France', 'EU', 'france', { aliases: ['FRA'] }),
  country('DE', '德国', 'Germany', 'EU', 'germany', { aliases: ['DEU'] }),
  country('SG', '新加坡', 'Singapore', 'AS', 'singapore', { aliases: ['SGP'] }),
  country('TH', '泰国', 'Thailand', 'AS', 'thailand', { aliases: ['THA'] }),
  country('BR', '巴西', 'Brazil', 'SA', 'brazil', { aliases: ['BRA'] }),
  country('KE', '肯尼亚', 'Kenya', 'AF', 'kenya', { aliases: ['KEN'] }),
  country('XK', '科索沃', 'Kosovo', 'EU', 'kosovo', { aliases: ['UNK'] }),
];

const CATEGORY = new Map(VISA_CATEGORIES.map(category => [category.code, category]));

interface PolicySeed {
  routeCode: string;
  countryCode: string;
  categoryCode: string;
  visaType?: string;
  summary: string;
  sourceCategory?: string | null;
  stayDays?: number | null;
  stayUnit?: DatasetPolicy['stayUnit'];
  stayRule?: DatasetPolicy['stayRule'];
  windowDays?: number | null;
  windowMaxDays?: number | null;
  entryScope?: DatasetPolicy['entryScope'];
  completeness?: number;
  isDemo?: boolean;
  dataStatus?: DatasetPolicy['dataStatus'];
  batchId?: string;
  documents?: DatasetPolicy['documents'];
  fees?: DatasetPolicy['fees'];
  timings?: DatasetPolicy['timings'];
  rules?: DatasetPolicy['rules'];
}

function policy(seed: PolicySeed): DatasetPolicy {
  const countryInfo = COUNTRIES.find(item => item.iso2 === seed.countryCode);
  if (!countryInfo) throw new Error(`fixture 引用未知国家：${seed.countryCode}`);
  const category = CATEGORY.get(seed.categoryCode);
  if (!category) throw new Error(`fixture 引用未知类别：${seed.categoryCode}`);
  const isDemo = seed.isDemo ?? false;
  const stayDays = seed.stayDays === undefined ? null : seed.stayDays;
  const stayUnit = seed.stayUnit === undefined ? (stayDays === null ? null : 'DAY') : seed.stayUnit;
  const searchText = [
    countryInfo.nameZh,
    countryInfo.nameEn,
    countryInfo.iso2,
    countryInfo.aliases.join(' '),
    seed.sourceCategory ?? '',
    category.nameZh,
    category.nameEn,
    category.group,
    seed.summary,
  ]
    .join(' ')
    .toLowerCase();

  return {
    routeCode: seed.routeCode,
    countryCode: seed.countryCode,
    visaType: seed.visaType ?? 'TOURISM',
    categoryCode: seed.categoryCode,
    title: `${countryInfo.nameZh} · ${seed.visaType ?? 'TOURISM'} 政策`,
    summary: seed.summary,
    conditionsText: seed.summary,
    sourceCategory: seed.sourceCategory ?? null,
    stayDays,
    stayUnit,
    stayRule: seed.stayRule ?? 'UNSPECIFIED',
    windowDays: seed.windowDays ?? null,
    windowMaxDays: seed.windowMaxDays ?? null,
    entryScope: seed.entryScope ?? 'UNKNOWN',
    validityNote: null,
    applicationChannel: isDemo ? '演示渠道' : '使领馆 / 签证中心',
    requiresVisa: category.requiresVisa,
    requiresAuthorization: category.requiresAuthorization,
    dataStatus: seed.dataStatus ?? (isDemo ? 'DEMO' : 'SUMMARY_ONLY'),
    completeness: seed.completeness ?? (isDemo ? 86 : 45),
    isDemo,
    sourceId: SOURCE_ID,
    collectedAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    searchText,
    documents: seed.documents ?? [],
    fees: seed.fees ?? [],
    timings: seed.timings ?? [],
    rules: seed.rules ?? [],
    batchId: seed.batchId ?? (isDemo ? DEMO_BATCH_ID : REAL_BATCH_ID),
  };
}

const REAL_POLICIES: DatasetPolicy[] = [
  policy({
    routeCode: 'JP-TOURISM-CN-ORD',
    countryCode: 'JP',
    categoryCode: 'EMBASSY_VISA',
    summary: '需向使领馆提前申请旅游签证，单次入境最多 90 天',
    sourceCategory: '预办签证(贴纸/电子)',
    stayDays: 90,
    stayUnit: 'DAY',
    entryScope: 'SINGLE',
    completeness: 45,
  }),
  policy({
    routeCode: 'TH-TOURISM-CN-ORD',
    countryCode: 'TH',
    categoryCode: 'UNILATERAL_FREE',
    summary: '单方面免签，停留不超过 30 天',
    sourceCategory: '单方面免签',
    stayDays: null,
    completeness: 40,
  }),
  policy({
    routeCode: 'SG-TOURISM-CN-ORD',
    countryCode: 'SG',
    categoryCode: 'MUTUAL_FREE',
    summary: '互免签证，免签停留 30 天',
    sourceCategory: '互免签证',
    stayDays: 30,
    stayUnit: 'DAY',
    completeness: 50,
  }),
  policy({
    routeCode: 'GB-TOURISM-CN-ORD',
    countryCode: 'GB',
    categoryCode: 'EMBASSY_VISA',
    summary: '需提前申请标准访客签证，默认 6 个月多次',
    sourceCategory: '预办签证',
    stayDays: 6,
    stayUnit: 'MONTH',
    entryScope: 'MULTIPLE',
    completeness: 55,
  }),
  policy({
    routeCode: 'US-TOURISM-CN-ORD',
    countryCode: 'US',
    categoryCode: 'EMBASSY_VISA',
    summary: '需面签申请 B-2 旅游签证，单次停留 1 个月',
    sourceCategory: '预办面谈签证',
    stayDays: 1,
    stayUnit: 'MONTH',
    completeness: 60,
  }),
  policy({
    routeCode: 'FR-TOURISM-CN-ORD',
    countryCode: 'FR',
    categoryCode: 'SCHENGEN_VISA',
    summary: '需办理申根短期旅游签证（3 个月）',
    sourceCategory: '预办申根签证',
    stayDays: 3,
    stayUnit: 'MONTH',
    completeness: 48,
  }),
  policy({
    routeCode: 'DE-TOURISM-CN-ORD',
    countryCode: 'DE',
    categoryCode: 'SCHENGEN_VISA',
    summary: '需办理申根短期旅游签证',
    sourceCategory: '预办申根签证',
    stayDays: 15,
    stayUnit: 'DAY',
    completeness: 52,
  }),
  policy({
    routeCode: 'BR-TOURISM-CN-ORD',
    countryCode: 'BR',
    categoryCode: 'E_VISA',
    summary: '在线申请电子旅游签证，最长停留 180 天',
    sourceCategory: '电子签证',
    stayDays: 180,
    stayUnit: 'DAY',
    completeness: 42,
  }),
  policy({
    routeCode: 'KE-TOURISM-CN-ORD',
    countryCode: 'KE',
    categoryCode: 'ETA',
    summary: '在线申请电子旅行授权，停留 7 天',
    sourceCategory: '电子旅行授权(eTA)',
    stayDays: 7,
    stayUnit: 'DAY',
    completeness: 38,
  }),
];

const DEMO_POLICIES: DatasetPolicy[] = [
  policy({
    routeCode: 'JP-BUSINESS-DEMO-01',
    countryCode: 'JP',
    categoryCode: 'EMBASSY_VISA',
    visaType: 'BUSINESS',
    summary: '演示：虚构的日本短期商务访问申请摘要',
    stayDays: 90,
    stayUnit: 'DAY',
    entryScope: 'MULTIPLE',
    completeness: 86,
    isDemo: true,
    dataStatus: 'DEMO',
    documents: [
      {
        code: 'PASSPORT',
        name: '护照',
        requirement: '演示：有效期覆盖行程结束后 6 个月',
        quantity: 1,
        required: true,
        condition: null,
        sortOrder: 1,
      },
    ],
    fees: [
      {
        code: 'APPLICATION',
        label: '申请费（演示）',
        amountMin: '3000.00',
        amountMax: '3000.00',
        currency: 'CNY',
        basis: 'PER_PERSON',
        condition: null,
        comparable: true,
      },
    ],
    timings: [
      {
        code: 'PROCESSING',
        label: '审核时间（演示）',
        minDays: 5,
        maxDays: 10,
        dayType: 'WORKING_DAY',
        startEvent: 'SUBMIT',
        note: null,
        comparable: true,
        sortOrder: 1,
      },
    ],
    rules: [
      {
        code: 'PASSPORT_CN',
        fieldName: 'passportCountryCode',
        operatorName: 'IN',
        expectedValue: '["CN"]',
        description: '仅演示：中国普通护照申请人。',
      },
    ],
  }),
  policy({
    routeCode: 'JP-TOURISM-DEMO-01',
    countryCode: 'JP',
    categoryCode: 'EMBASSY_VISA',
    summary: '演示：与真实路线同国同类型的演示明细（不应覆盖真实政策）',
    stayDays: 15,
    stayUnit: 'DAY',
    completeness: 90,
    isDemo: true,
    dataStatus: 'DEMO',
  }),
  policy({
    routeCode: 'XK-TOURISM-DEMO-01',
    countryCode: 'XK',
    categoryCode: 'E_VISA',
    summary: '演示：科索沃旅游签明细样本',
    stayDays: 30,
    stayUnit: 'DAY',
    completeness: 70,
    isDemo: true,
    dataStatus: 'DEMO',
  }),
];

const MENTIONS: DatasetFile['mentions'] = [
  { countryCode: 'JP', visaType: 'BUSINESS', rawText: '商务签、工作签', sourceId: SOURCE_ID },
  { countryCode: 'JP', visaType: 'STUDY', rawText: '留学签证', sourceId: SOURCE_ID },
  { countryCode: 'US', visaType: 'BUSINESS', rawText: 'B-1 商务签', sourceId: SOURCE_ID },
  { countryCode: 'GB', visaType: 'BUSINESS', rawText: '商务访客签', sourceId: SOURCE_ID },
  { countryCode: 'FR', visaType: 'BUSINESS', rawText: '商务申根签', sourceId: SOURCE_ID },
  { countryCode: 'FR', visaType: 'WORK', rawText: '工作居留', sourceId: SOURCE_ID },
  { countryCode: 'DE', visaType: 'BUSINESS', rawText: '商务申根签', sourceId: SOURCE_ID },
  { countryCode: 'DE', visaType: 'WORK', rawText: '工作签证', sourceId: SOURCE_ID },
  { countryCode: 'TH', visaType: 'BUSINESS', rawText: '商务签', sourceId: SOURCE_ID },
  { countryCode: 'SG', visaType: 'BUSINESS', rawText: '商务访问', sourceId: SOURCE_ID },
  { countryCode: 'BR', visaType: 'BUSINESS', rawText: '商务签证', sourceId: SOURCE_ID },
  { countryCode: 'KE', visaType: 'BUSINESS', rawText: '商务电子签', sourceId: SOURCE_ID },
];

const SYNONYMS: DatasetFile['synonyms'] = [
  { term: '大不列颠', canonical: 'GB', kind: 'COUNTRY', weight: 40 },
  { term: 'UK', canonical: 'GB', kind: 'COUNTRY', weight: 40 },
  { term: 'Britain', canonical: 'GB', kind: 'COUNTRY', weight: 25 },
  { term: 'Japan', canonical: 'JP', kind: 'COUNTRY', weight: 35 },
  { term: '商务签', canonical: 'BUSINESS', kind: 'TYPE', weight: 35 },
  { term: '留学签', canonical: 'STUDY', kind: 'TYPE', weight: 30 },
  { term: '免签', canonical: '免签', kind: 'KEYWORD', weight: 40 },
  { term: 'visa free', canonical: '免签', kind: 'KEYWORD', weight: 30 },
];

const REGION_DICTIONARY: RegionInfo[] = REGIONS;
const TYPE_DICTIONARY: VisaTypeInfo[] = VISA_TYPES;
const GROUP_DICTIONARY: PolicyGroupInfo[] = POLICY_GROUPS;
const CATEGORY_DICTIONARY: VisaCategoryInfo[] = VISA_CATEGORIES;

/** 构造 fixture 数据集（每次返回新对象，避免测试间共享可变状态） */
export function buildFixtureDataset(): DatasetFile {
  return {
    schemaVersion: '2.0',
    datasetVersion: 'fixture-v1',
    generatedAt: FIXTURE_TIME,
    source: {
      file: 'tests/fixtures/dataset.ts',
      sha256: 'fixture',
      rowCount: COUNTRIES.length,
      note: '测试用最小数据集',
    },
    dictionaries: {
      regions: REGION_DICTIONARY,
      types: TYPE_DICTIONARY,
      categories: CATEGORY_DICTIONARY,
      groups: GROUP_DICTIONARY,
    },
    sources: [
      {
        sourceId: SOURCE_ID,
        title: '测试数据集（fixture）',
        publisher: 'Visa Atlas tests',
        url: null,
        kind: 'FIXTURE',
        accessedAt: FIXTURE_TIME,
        status: 'DEMO',
        note: '仅用于自动化测试，不是真实签证资料',
      },
    ],
    batches: [
      {
        batchId: REAL_BATCH_ID,
        name: 'fixture 真实政策批次',
        sourceFile: 'tests/fixtures/dataset.ts',
        importedAt: FIXTURE_TIME,
        rowCount: REAL_POLICIES.length,
        notes: 'fixture',
      },
      {
        batchId: DEMO_BATCH_ID,
        name: 'fixture 演示明细批次',
        sourceFile: 'tests/fixtures/dataset.ts',
        importedAt: FIXTURE_TIME,
        rowCount: DEMO_POLICIES.length,
        notes: 'fixture',
      },
    ],
    countries: COUNTRIES,
    policies: [...REAL_POLICIES, ...DEMO_POLICIES],
    mentions: MENTIONS,
    synonyms: SYNONYMS,
  };
}
