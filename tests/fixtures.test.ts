/**
 * 数据夹具校验：data/source/demo-details.json 与 data/source/synonyms.json
 *
 * 运行：npx.cmd tsx --test tests/fixtures.test.ts（Windows PowerShell）
 * 只读校验，不写入任何数据；不依赖任何第三方测试库。
 *
 * 覆盖：
 *  - 两个 JSON 可解析、顶层结构正确；
 *  - 演示明细条数、routeCode 唯一性与格式、国家/类型/类别枚举、类别布尔位一致；
 *  - 材料/费用/时间/规则的必填数组、唯一键、金额币种、时间区间、规则 JSON 与字段枚举；
 *  - 同义词 term 唯一（忽略大小写）、kind 合法、weight 范围、canonical 与共享字典/国家目录一致、数量下限。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VISA_CATEGORIES, VISA_TYPES } from '../shared/contracts.ts';

/* ------------------------------------------------------------------ */
/* 读取工具与类型                                                      */
/* ------------------------------------------------------------------ */

const rootDir = fileURLToPath(new URL('..', import.meta.url));

function readJson<T>(relativePath: string): T {
  const absolutePath = `${rootDir}/${relativePath}`;
  assert.ok(fs.existsSync(absolutePath), `缺少夹具文件：${relativePath}`);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as T;
}

function readText(relativePath: string): string {
  return fs.readFileSync(`${rootDir}/${relativePath}`, 'utf8');
}

interface DemoDocument {
  code: string;
  name: string;
  requirement: string | null;
  quantity: number | null;
  required: boolean | null;
  condition: string | null;
  sortOrder: number;
}

interface DemoFee {
  code: string;
  label: string;
  amountMin: string | null;
  amountMax: string | null;
  currency: string | null;
  basis: string | null;
  condition: string | null;
  comparable: boolean;
}

interface DemoTiming {
  code: string;
  label: string;
  minDays: number | null;
  maxDays: number | null;
  dayType: 'WORKING_DAY' | 'CALENDAR_DAY' | null;
  startEvent: string | null;
  note: string | null;
  comparable: boolean;
  sortOrder: number;
}

interface DemoRule {
  code: string;
  fieldName: string;
  operatorName: string;
  expectedValue: string;
  description: string;
}

interface DemoPolicy {
  routeCode: string;
  countryCode: string;
  visaType: string;
  categoryCode: string;
  title: string;
  summary: string | null;
  conditionsText: string | null;
  stayDays: number | null;
  stayUnit: 'DAY' | 'MONTH' | 'YEAR' | null;
  stayRule: 'PER_ENTRY' | 'ROLLING_WINDOW' | 'UNSPECIFIED';
  windowDays: number | null;
  windowMaxDays: number | null;
  entryScope: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
  validityNote: string | null;
  applicationChannel: string | null;
  requiresVisa: boolean;
  requiresAuthorization: boolean;
  completeness: number;
  documents: DemoDocument[];
  fees: DemoFee[];
  timings: DemoTiming[];
  rules: DemoRule[];
}

interface DemoDetailsFile {
  schemaVersion: string;
  batchId: string;
  generatedAt: string;
  note: string;
  policies: DemoPolicy[];
}

interface SynonymTerm {
  term: string;
  canonical: string;
  kind: 'COUNTRY' | 'CATEGORY' | 'TYPE' | 'KEYWORD';
  weight: number;
}

interface SynonymsFile {
  schemaVersion: string;
  terms: SynonymTerm[];
}

interface CountryEntry {
  code: string;
  nameZh: string;
  nameEn: string;
}

/* ------------------------------------------------------------------ */
/* 常量与共享字典                                                      */
/* ------------------------------------------------------------------ */

const demo = readJson<DemoDetailsFile>('data/source/demo-details.json');
const synonyms = readJson<SynonymsFile>('data/source/synonyms.json');
const countries = readJson<CountryEntry[]>('data/countries.json');

const countryCodes = new Set(countries.map(country => country.code));
const visaTypeCodes = new Set(VISA_TYPES.map(type => type.code));
const visaCategories = new Map(VISA_CATEGORIES.map(category => [category.code, category]));
const policyGroupCodes = new Set(VISA_CATEGORIES.map(category => category.group));

const ROUTE_CODE_PATTERN = /^[A-Z]{2}-[A-Z_]+-DEMO-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const AMOUNT_PATTERN = /^\d+\.\d{2}$/;
const DEMO_TYPES = new Set([
  'BUSINESS',
  'STUDY',
  'WORK',
  'FAMILY',
  'MEDICAL',
  'RESIDENCE',
  'DIGITAL_NOMAD',
  'GOLDEN_VISA',
  'WORKING_HOLIDAY',
  'RESEARCH',
]);
const RULE_FIELDS = new Set([
  'passportCountryCode',
  'residenceCountryCode',
  'age',
  'employment',
  'passportValidityMonths',
  'heldVisaCodes',
]);
const RULE_OPERATORS = new Set(['IN', 'ANY_OF', 'GTE', 'LTE', 'BETWEEN']);
const SYNONYM_KINDS = new Set(['COUNTRY', 'CATEGORY', 'TYPE', 'KEYWORD']);

const fail = (message: string): never => {
  throw new Error(message);
};

/** 判定「非空数组」并返回之，用于必填数组字段检查 */
function requiredArray<T>(value: T[] | undefined, label: string): T[] {
  assert.ok(Array.isArray(value), `${label} 必须是数组`);
  return value as T[];
}

function assertUniqueCodes(items: { code: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    assert.equal(typeof item.code, 'string', `${label} 的 code 必须是字符串`);
    assert.ok(item.code.length > 0, `${label} 的 code 不能为空`);
    assert.ok(!seen.has(item.code), `${label} 出现重复 code：${item.code}`);
    seen.add(item.code);
  }
}

/* ------------------------------------------------------------------ */
/* 1. demo-details.json 顶层结构                                        */
/* ------------------------------------------------------------------ */

describe('demo-details.json · 顶层结构', () => {
  it('可解析且含全部顶层字段', () => {
    assert.equal(demo.schemaVersion, '2.0');
    assert.equal(demo.batchId, 'demo-details-1');
    assert.match(demo.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(!Number.isNaN(new Date(demo.generatedAt).getTime()), 'generatedAt 必须是合法 ISO 时间');
    assert.equal(typeof demo.note, 'string');
    assert.ok(demo.note.includes('虚构'), 'note 必须声明演示数据为虚构内容');
  });

  it('演示政策条数在 18–22 之间', () => {
    const policies = requiredArray(demo.policies, 'policies');
    assert.ok(policies.length >= 18 && policies.length <= 22, `演示条数 ${policies.length} 不在 18–22 区间`);
  });
});

/* ------------------------------------------------------------------ */
/* 2. 每条演示路线的枚举、编号与类别一致性                              */
/* ------------------------------------------------------------------ */

describe('demo-details.json · 路线与枚举', () => {
  const policies = requiredArray(demo.policies, 'policies');

  it('routeCode 唯一且符合 ISO2-TYPE-DEMO-NN 格式', () => {
    const seen = new Set<string>();
    for (const policy of policies) {
      assert.match(policy.routeCode, ROUTE_CODE_PATTERN, `routeCode 格式非法：${policy.routeCode}`);
      assert.ok(!seen.has(policy.routeCode), `routeCode 重复：${policy.routeCode}`);
      seen.add(policy.routeCode);
      assert.equal(policy.routeCode.slice(0, 2), policy.countryCode, `routeCode 前缀应等于 countryCode：${policy.routeCode}`);
      assert.ok(policy.routeCode.includes(`-${policy.visaType}-`), `routeCode 中应含签证类型：${policy.routeCode}`);
    }
  });

  it('countryCode 全部存在于 data/countries.json', () => {
    for (const policy of policies) {
      assert.ok(countryCodes.has(policy.countryCode), `未知国家代码：${policy.routeCode} → ${policy.countryCode}`);
    }
  });

  it('visaType 来自 VISA_TYPES 且覆盖演示类型清单', () => {
    for (const policy of policies) {
      assert.ok(visaTypeCodes.has(policy.visaType), `未知签证类型：${policy.routeCode} → ${policy.visaType}`);
      assert.ok(DEMO_TYPES.has(policy.visaType), `演示类型超出约定范围：${policy.visaType}`);
    }
  });

  it('categoryCode 来自 VISA_CATEGORIES，且 requiresVisa / requiresAuthorization 与类别一致', () => {
    for (const policy of policies) {
      const category = visaCategories.get(policy.categoryCode);
      assert.ok(category, `未知类别代码：${policy.routeCode} → ${policy.categoryCode}`);
      assert.ok(policyGroupCodes.has(category.group), `类别分组非法：${policy.categoryCode}`);
      assert.equal(policy.requiresVisa, category.requiresVisa, `${policy.routeCode} requiresVisa 与类别不一致`);
      assert.equal(
        policy.requiresAuthorization,
        category.requiresAuthorization,
        `${policy.routeCode} requiresAuthorization 与类别不一致`,
      );
    }
  });

  it('覆盖至少 8 种签证类型、8–10 个国家', () => {
    const typeCount = new Set(policies.map(policy => policy.visaType)).size;
    const countryCount = new Set(policies.map(policy => policy.countryCode)).size;
    assert.ok(typeCount >= 8, `演示类型数 ${typeCount} 少于 8`);
    assert.ok(countryCount >= 8 && countryCount <= 10, `演示国家数 ${countryCount} 不在 8–10 区间`);
  });

  it('停留期、停留规则、入境次数与窗口字段自洽', () => {
    for (const policy of policies) {
      const hasDays = policy.stayDays !== null;
      const hasUnit = policy.stayUnit !== null;
      assert.equal(hasDays, hasUnit, `${policy.routeCode} 的 stayDays / stayUnit 必须同时有值或同时为空`);
      if (hasDays) assert.ok(Number.isInteger(policy.stayDays) && policy.stayDays! > 0, `${policy.routeCode} stayDays 非法`);
      if (hasUnit) assert.ok(['DAY', 'MONTH', 'YEAR'].includes(policy.stayUnit!), `${policy.routeCode} stayUnit 非法`);
      assert.ok(['PER_ENTRY', 'ROLLING_WINDOW', 'UNSPECIFIED'].includes(policy.stayRule), `${policy.routeCode} stayRule 非法`);
      assert.ok(['SINGLE', 'MULTIPLE', 'UNKNOWN'].includes(policy.entryScope), `${policy.routeCode} entryScope 非法`);
      if (policy.stayRule === 'ROLLING_WINDOW') {
        assert.ok(policy.windowDays !== null && policy.windowMaxDays !== null, `${policy.routeCode} 滚动窗口缺少 windowDays/windowMaxDays`);
      }
      if (policy.windowMaxDays !== null) {
        assert.ok(policy.windowDays !== null, `${policy.routeCode} 有 windowMaxDays 时必须同时有 windowDays`);
      }
    }
  });

  it('内容必须是明确的虚构演示', () => {
    for (const policy of policies) {
      assert.ok(policy.title.includes('演示样本'), `${policy.routeCode} 标题缺少「演示样本」`);
      assert.ok(String(policy.summary ?? '').includes('演示'), `${policy.routeCode} summary 缺少「演示」字样`);
      assert.ok(String(policy.applicationChannel ?? '').includes('演示'), `${policy.routeCode} applicationChannel 缺少「演示」字样`);
      assert.ok(Number.isInteger(policy.completeness), `${policy.routeCode} completeness 必须是整数`);
      assert.ok(policy.completeness >= 70 && policy.completeness <= 95, `${policy.routeCode} completeness 不在 70–95 区间`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. 材料 / 费用 / 办理时间 / 资格规则明细                             */
/* ------------------------------------------------------------------ */

describe('demo-details.json · 明细数组', () => {
  const policies = requiredArray(demo.policies, 'policies');

  it('每条路线必有 documents / fees / timings / rules 数组', () => {
    for (const policy of policies) {
      requiredArray(policy.documents, `${policy.routeCode}.documents`);
      requiredArray(policy.fees, `${policy.routeCode}.fees`);
      requiredArray(policy.timings, `${policy.routeCode}.timings`);
      requiredArray(policy.rules, `${policy.routeCode}.rules`);
    }
  });

  it('材料 4–6 份，code 在路线内唯一，字段类型合法', () => {
    for (const policy of policies) {
      const documents = requiredArray(policy.documents, `${policy.routeCode}.documents`);
      assert.ok(documents.length >= 4 && documents.length <= 6, `${policy.routeCode} 材料数 ${documents.length} 不在 4–6`);
      assertUniqueCodes(documents, `${policy.routeCode}.documents`);
      for (const document of documents) {
        assert.equal(typeof document.name, 'string');
        assert.ok(document.name.length > 0, `${policy.routeCode} 材料名不能为空`);
        assert.ok(document.requirement === null || typeof document.requirement === 'string');
        assert.ok(document.quantity === null || (Number.isInteger(document.quantity) && document.quantity! > 0));
        assert.ok(document.required === null || typeof document.required === 'boolean');
        assert.ok(document.condition === null || typeof document.condition === 'string');
        assert.ok(Number.isInteger(document.sortOrder), `${policy.routeCode} 材料 sortOrder 必须是整数`);
      }
      assert.equal(new Set(documents.map(document => document.sortOrder)).size, documents.length, `${policy.routeCode} 材料 sortOrder 重复`);
    }
  });

  it('费用 1–2 项，币种为 3 位大写 ISO 4217，金额为两位小数字符串', () => {
    for (const policy of policies) {
      const fees = requiredArray(policy.fees, `${policy.routeCode}.fees`);
      assert.ok(fees.length >= 1 && fees.length <= 2, `${policy.routeCode} 费用数 ${fees.length} 不在 1–2`);
      assertUniqueCodes(fees, `${policy.routeCode}.fees`);
      let comparableCount = 0;
      for (const fee of fees) {
        assert.equal(typeof fee.label, 'string');
        assert.ok(fee.label.length > 0, `${policy.routeCode} 费用标签不能为空`);
        assert.ok(fee.currency !== null && CURRENCY_PATTERN.test(fee.currency), `${policy.routeCode} 费用币种非法：${fee.currency}`);
        for (const amount of [fee.amountMin, fee.amountMax]) {
          assert.ok(amount !== null && AMOUNT_PATTERN.test(amount), `${policy.routeCode} 费用金额格式非法：${amount}`);
        }
        assert.equal(typeof fee.comparable, 'boolean');
        if (fee.comparable) comparableCount += 1;
      }
      assert.ok(comparableCount <= 1, `${policy.routeCode} 可比费用不应超过 1 项`);
    }
  });

  it('办理时间 1–2 项，区间合法、天数非负整数、可比时间不超过 1 项', () => {
    for (const policy of policies) {
      const timings = requiredArray(policy.timings, `${policy.routeCode}.timings`);
      assert.ok(timings.length >= 1 && timings.length <= 2, `${policy.routeCode} 办理时间数 ${timings.length} 不在 1–2`);
      assertUniqueCodes(timings, `${policy.routeCode}.timings`);
      let comparableCount = 0;
      for (const timing of timings) {
        assert.equal(typeof timing.label, 'string');
        assert.ok(timing.label.length > 0, `${policy.routeCode} 办理时间标签不能为空`);
        assert.ok(timing.dayType === null || ['WORKING_DAY', 'CALENDAR_DAY'].includes(timing.dayType), `${policy.routeCode} dayType 非法`);
        assert.ok(timing.startEvent === null || typeof timing.startEvent === 'string');
        assert.ok(timing.note === null || typeof timing.note === 'string');
        if (timing.minDays !== null) {
          assert.ok(Number.isInteger(timing.minDays) && timing.minDays >= 0, `${policy.routeCode} minDays 非法`);
        }
        if (timing.maxDays !== null) {
          assert.ok(Number.isInteger(timing.maxDays) && timing.maxDays >= 0, `${policy.routeCode} maxDays 非法`);
        }
        if (timing.minDays !== null && timing.maxDays !== null) {
          assert.ok(timing.minDays <= timing.maxDays, `${policy.routeCode} 办理时间区间倒置：${timing.minDays} > ${timing.maxDays}`);
        }
        assert.equal(typeof timing.comparable, 'boolean');
        assert.ok(Number.isInteger(timing.sortOrder), `${policy.routeCode} 办理时间 sortOrder 必须是整数`);
        if (timing.comparable) comparableCount += 1;
      }
      assert.ok(comparableCount <= 1, `${policy.routeCode} 可比办理时间不应超过 1 项`);
    }
  });

  it('资格规则 0–2 条，field / operator 合法，expectedValue 可 JSON.parse', () => {
    for (const policy of policies) {
      const rules = requiredArray(policy.rules, `${policy.routeCode}.rules`);
      assert.ok(rules.length <= 2, `${policy.routeCode} 规则数 ${rules.length} 超过 2`);
      assertUniqueCodes(rules, `${policy.routeCode}.rules`);
      for (const rule of rules) {
        assert.ok(RULE_FIELDS.has(rule.fieldName), `${policy.routeCode} 规则字段非法：${rule.fieldName}`);
        assert.ok(RULE_OPERATORS.has(rule.operatorName), `${policy.routeCode} 规则运算符非法：${rule.operatorName}`);
        assert.equal(typeof rule.expectedValue, 'string');
        const parsed: unknown = JSON.parse(rule.expectedValue);
        assert.ok(parsed !== null && parsed !== undefined, `${policy.routeCode} expectedValue 解析结果不能为 null`);
        assert.ok(typeof rule.description === 'string' && rule.description.length > 0, `${policy.routeCode} 规则描述不能为空`);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. 与真实 CSV 批次的交叉检查                                         */
/* ------------------------------------------------------------------ */

describe('demo-details.json · 与真实批次隔离', () => {
  const csvText = readText('data/source/global_249_countries_cn_passport_visa.csv');
  const policies = requiredArray(demo.policies, 'policies');

  it('演示 routeCode 不与真实 CSV 路线编号冲突', () => {
    for (const policy of policies) {
      assert.ok(!csvText.includes(policy.routeCode), `演示 routeCode 与真实 CSV 冲突：${policy.routeCode}`);
    }
  });

  it('每个演示国家在真实 CSV 中都有对应旅游签摘要行', () => {
    for (const policy of policies) {
      assert.ok(
        csvText.includes(`${policy.countryCode}-TOURISM-CN-ORD`) || csvText.includes(`${policy.countryCode}-DOMESTIC`),
        `演示国家 ${policy.countryCode} 在真实 CSV 中没有旅游签摘要行`,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. synonyms.json                                                     */
/* ------------------------------------------------------------------ */

describe('synonyms.json · 结构与唯一性', () => {
  it('可解析且顶层结构正确', () => {
    assert.equal(synonyms.schemaVersion, '1.0');
    assert.ok(Array.isArray(synonyms.terms), 'terms 必须是数组');
  });

  it('同义词总条数不少于 90', () => {
    const terms = requiredArray(synonyms.terms, 'terms');
    assert.ok(terms.length >= 90, `同义词条数 ${terms.length} 少于 90`);
  });

  it('term 忽略大小写唯一、kind 合法、weight 在 10–40', () => {
    const terms = requiredArray(synonyms.terms, 'terms');
    const seen = new Map<string, string>();
    for (const item of terms) {
      assert.equal(typeof item.term, 'string');
      const trimmed = item.term.trim();
      assert.ok(trimmed.length > 0, 'term 不能为空');
      const key = trimmed.toLowerCase();
      assert.ok(!seen.has(key), `term 重复（忽略大小写）：${item.term}（已存在：${seen.get(key)}）`);
      seen.set(key, item.term);
      assert.ok(SYNONYM_KINDS.has(item.kind), `kind 非法：${item.term} → ${item.kind}`);
      assert.ok(Number.isInteger(item.weight), `weight 必须是整数：${item.term}`);
      assert.ok(item.weight >= 10 && item.weight <= 40, `weight 越界：${item.term} → ${item.weight}`);
      assert.equal(typeof item.canonical, 'string');
      assert.ok(item.canonical.trim().length > 0, `canonical 不能为空：${item.term}`);
    }
  });
});

describe('synonyms.json · canonical 枚举校验', () => {
  it('COUNTRY 的 canonical 必须是 data/countries.json 中的 ISO2', () => {
    const terms = requiredArray(synonyms.terms, 'terms').filter(item => item.kind === 'COUNTRY');
    assert.ok(terms.length >= 50, `COUNTRY 同义词仅 ${terms.length} 条，少于 50`);
    for (const item of terms) {
      assert.ok(countryCodes.has(item.canonical), `COUNTRY canonical 不在国家目录：${item.term} → ${item.canonical}`);
    }
  });

  it('CATEGORY 的 canonical 必须来自 VISA_CATEGORIES', () => {
    const terms = requiredArray(synonyms.terms, 'terms').filter(item => item.kind === 'CATEGORY');
    assert.ok(terms.length >= 10, `CATEGORY 同义词仅 ${terms.length} 条`);
    for (const item of terms) {
      assert.ok(visaCategories.has(item.canonical), `CATEGORY canonical 非法：${item.term} → ${item.canonical}`);
    }
  });

  it('TYPE 的 canonical 必须来自 VISA_TYPES', () => {
    const terms = requiredArray(synonyms.terms, 'terms').filter(item => item.kind === 'TYPE');
    assert.ok(terms.length >= 25, `TYPE 同义词仅 ${terms.length} 条，少于 25`);
    for (const item of terms) {
      assert.ok(visaTypeCodes.has(item.canonical), `TYPE canonical 非法：${item.term} → ${item.canonical}`);
    }
  });

  it('KEYWORD 的 canonical 必须是非空短语', () => {
    const terms = requiredArray(synonyms.terms, 'terms').filter(item => item.kind === 'KEYWORD');
    assert.ok(terms.length >= 15, `KEYWORD 同义词仅 ${terms.length} 条，少于 15`);
    for (const item of terms) {
      assert.ok(item.canonical.trim().length > 0, `KEYWORD canonical 不能为空：${item.term}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. 夹具文件存在性别名                                               */
/* ------------------------------------------------------------------ */

describe('夹具文件', () => {
  it('data/source/demo-details.json 与 data/source/synonyms.json 均存在', () => {
    assert.ok(fs.existsSync(`${rootDir}/data/source/demo-details.json`));
    assert.ok(fs.existsSync(`${rootDir}/data/source/synonyms.json`));
    assert.ok(fs.existsSync(`${rootDir}/data/source/README.md`), '缺少 data/source/README.md 数据说明');
  });

  it('国家目录可解析且非空', () => {
    assert.ok(Array.isArray(countries));
    assert.ok(countries.length > 0);
  });

  it('共享字典非空（防止空导入误判通过）', () => {
    assert.ok(VISA_TYPES.length > 0);
    assert.ok(VISA_CATEGORIES.length > 0);
    if (VISA_TYPES.length === 0 || VISA_CATEGORIES.length === 0) fail('共享字典为空');
  });
});
