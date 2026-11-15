/**
 * 数据集装载与数据库种子。
 *
 * 设计要点：
 * - 每次 seed 在一个事务里「先清空、再插入」，重复执行结果一致（幂等）；
 * - 清空/插入顺序严格遵守外键依赖，MySQL 与 SQLite 共用同一份逻辑；
 * - dataset.json 是唯一输入，这里只做机械导入 + 结构和引用校验，
 *   保证错误在种子阶段以中文信息暴露，而不是变成数据库的外键报错。
 */
import { existsSync, readFileSync } from 'node:fs';
import type {
  DatasetCountry,
  DatasetFee,
  DatasetFile,
  DatasetPolicy,
  DatasetTiming,
} from '../../shared/dataset.ts';
import { DATASET_FILE } from '../paths.ts';
import type { DatabaseDriver, SqlValue } from './driver.ts';
import { normalizeIsoDateTime } from './driver.ts';

/** 插入后统计，供脚本输出与测试断言使用 */
export interface SeedStats {
  regions: number;
  types: number;
  categories: number;
  groups: number;
  sources: number;
  batches: number;
  countries: number;
  policies: number;
  demoPolicies: number;
  mentions: number;
  synonyms: number;
  documents: number;
  fees: number;
  timings: number;
  rules: number;
}

/** 按外键依赖排列：子表在前，父表在后 */
const DELETE_ORDER = [
  'policy_documents',
  'policy_fees',
  'policy_timings',
  'policy_rules',
  'mentioned_visa_types',
  'visa_policies',
  'countries',
  'data_batches',
  'data_sources',
  'visa_categories',
  'policy_groups',
  'visa_types',
  'regions',
  'search_synonyms',
  'app_meta',
] as const;

/** 读取并解析 dataset.json；文件缺失时给出可执行的中文提示 */
export function readDatasetFile(filePath: string = DATASET_FILE): DatasetFile {
  if (!existsSync(filePath)) {
    throw new Error(
      `未找到数据集文件：${filePath}\n` +
        '请先运行 `npm run data:build`（或完整初始化 `npm run setup`）生成数据集，再初始化/启动数据库。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `数据集文件解析失败：${filePath}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`数据集格式错误：${filePath} 不是 JSON 对象`);
  }
  const dataset = parsed as DatasetFile;
  if (dataset.schemaVersion !== '2.0') {
    throw new Error(`数据集版本不兼容：schemaVersion=${String(dataset.schemaVersion)}，期望 2.0`);
  }
  return dataset;
}

/** 数据集内部的引用/取值校验；宁可提前报错也不让半套数据进库 */
function validateDataset(dataset: DatasetFile): void {
  const fail = (message: string): never => {
    throw new Error(`数据集校验失败：${message}`);
  };

  const regionCodes = new Set(dataset.dictionaries.regions.map(region => region.code));
  const typeCodes = new Set(dataset.dictionaries.types.map(type => type.code));
  const groupCodes = new Set(dataset.dictionaries.groups.map(group => group.code));
  const categoryCodes = new Set(dataset.dictionaries.categories.map(category => category.code));
  const sourceIds = new Set(dataset.sources.map(source => source.sourceId));
  const batchIds = new Set(dataset.batches.map(batch => batch.batchId));

  if (!batchIds.size) fail('batches 为空，每条政策必须能回溯到导入批次');
  for (const category of dataset.dictionaries.categories) {
    if (!groupCodes.has(category.group)) {
      fail(`类别 ${category.code} 引用了不存在的政策组 ${category.group}`);
    }
  }

  const countryCodes = new Set<string>();
  for (const country of dataset.countries) {
    if (!/^[A-Z]{2}$/.test(country.iso2)) fail(`国家代码不合法：${country.iso2}`);
    if (countryCodes.has(country.iso2)) fail(`国家代码重复：${country.iso2}`);
    countryCodes.add(country.iso2);
    if (!regionCodes.has(country.region)) fail(`国家 ${country.iso2} 引用了不存在的地区 ${country.region}`);
  }

  const routeCodes = new Set<string>();
  for (const policy of dataset.policies) {
    if (routeCodes.has(policy.routeCode)) fail(`路线代码重复：${policy.routeCode}`);
    routeCodes.add(policy.routeCode);
    if (!countryCodes.has(policy.countryCode)) fail(`路线 ${policy.routeCode} 引用了不存在的国家`);
    if (!typeCodes.has(policy.visaType)) fail(`路线 ${policy.routeCode} 引用了不存在的签证类型`);
    if (!categoryCodes.has(policy.categoryCode)) fail(`路线 ${policy.routeCode} 引用了不存在的类别`);
    if (!sourceIds.has(policy.sourceId)) fail(`路线 ${policy.routeCode} 引用了不存在的来源`);
    if (!batchIds.has(policy.batchId)) fail(`路线 ${policy.routeCode} 引用了不存在的批次`);
    if ((policy.stayDays === null) !== (policy.stayUnit === null)) {
      fail(`路线 ${policy.routeCode} 的 stayDays 与 stayUnit 必须同时为空或同时有值`);
    }
    if (!Number.isInteger(policy.completeness) || policy.completeness < 0 || policy.completeness > 100) {
      fail(`路线 ${policy.routeCode} 的 completeness 必须是 0-100 的整数`);
    }
    for (const rule of policy.rules) {
      try {
        JSON.parse(rule.expectedValue);
      } catch {
        fail(`路线 ${policy.routeCode} 的规则 ${rule.code} expectedValue 不是合法 JSON`);
      }
    }
  }

  const mentionKeys = new Set<string>();
  for (const mention of dataset.mentions) {
    if (!countryCodes.has(mention.countryCode)) fail(`类型线索引用了不存在的国家：${mention.countryCode}`);
    if (!typeCodes.has(mention.visaType)) fail(`类型线索引用了不存在的签证类型：${mention.visaType}`);
    if (!sourceIds.has(mention.sourceId)) fail(`类型线索引用了不存在的来源：${mention.sourceId}`);
    const key = `${mention.countryCode}:${mention.visaType}`;
    if (mentionKeys.has(key)) fail(`类型线索重复：${key}`);
    mentionKeys.add(key);
  }

  const synonymTerms = new Set<string>();
  for (const synonym of dataset.synonyms) {
    const term = synonym.term.trim();
    if (!term) fail('同义词 term 不能为空');
    if (synonymTerms.has(term.toLowerCase())) fail(`同义词重复：${synonym.term}`);
    synonymTerms.add(term.toLowerCase());
  }
}

type ColumnRow = readonly SqlValue[];

/** 分块多行 INSERT：MySQL/SQLite 都支持，显著减少种子往返次数 */
async function insertMany(
  tx: DatabaseDriver,
  table: string,
  columns: readonly string[],
  rows: readonly ColumnRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 100;
  // 反引号标识符：SQLite 兼容，MySQL 用来规避 key/value 等关键字冲突
  const quotedTable = `\`${table}\``;
  const quotedColumns = columns.map(column => `\`${column}\``).join(', ');
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values: SqlValue[] = [];
    for (const row of chunk) values.push(...row);
    const sql = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${chunk
      .map(() => rowPlaceholder)
      .join(', ')}`;
    await tx.exec(sql, values);
  }
}

const bool = (value: boolean): number => (value ? 1 : 0);
const jsonText = (value: unknown): string => JSON.stringify(value);

function countryRow(country: DatasetCountry, timestamp: string): ColumnRow {
  return [
    country.iso2,
    country.nameZh,
    country.nameEn,
    country.region,
    country.subregion,
    country.sortKey,
    jsonText(country.aliases),
    country.latitude,
    country.longitude,
    bool(country.priority),
    timestamp,
    timestamp,
  ];
}

function policyRow(
  policy: DatasetPolicy,
  timestamps: { collectedAt: string; updatedAt: string },
): ColumnRow {
  return [
    policy.routeCode,
    policy.countryCode,
    policy.visaType,
    policy.categoryCode,
    policy.title,
    policy.summary,
    policy.conditionsText,
    policy.sourceCategory,
    policy.stayDays,
    policy.stayUnit,
    policy.stayRule,
    policy.windowDays,
    policy.windowMaxDays,
    policy.entryScope,
    policy.validityNote,
    policy.applicationChannel,
    bool(policy.requiresVisa),
    bool(policy.requiresAuthorization),
    policy.dataStatus,
    policy.completeness,
    bool(policy.isDemo),
    1, // is_visible：数据集里出现的路线默认可见
    policy.sourceId,
    policy.batchId,
    timestamps.collectedAt,
    timestamps.updatedAt,
    policy.searchText,
  ];
}

/** 主入口：清空旧数据并导入数据集（单事务，失败自动回滚） */
export async function seedDatabase(driver: DatabaseDriver, dataset: DatasetFile): Promise<SeedStats> {
  validateDataset(dataset);

  const importedAt = dataset.batches.reduce(
    (latest, batch) => (batch.importedAt > latest ? batch.importedAt : latest),
    dataset.generatedAt,
  );
  const generatedAtDb = driver.toDbDateTime(dataset.generatedAt);
  const importedAtDb = driver.toDbDateTime(importedAt);

  const stats: SeedStats = {
    regions: dataset.dictionaries.regions.length,
    types: dataset.dictionaries.types.length,
    categories: dataset.dictionaries.categories.length,
    groups: dataset.dictionaries.groups.length,
    sources: dataset.sources.length,
    batches: dataset.batches.length,
    countries: dataset.countries.length,
    policies: dataset.policies.filter(policy => !policy.isDemo).length,
    demoPolicies: dataset.policies.filter(policy => policy.isDemo).length,
    mentions: dataset.mentions.length,
    synonyms: dataset.synonyms.length,
    documents: 0,
    fees: 0,
    timings: 0,
    rules: 0,
  };

  // 明细行先收集，便于统一计数与插入
  const documentRows: ColumnRow[] = [];
  const feeRows: ColumnRow[] = [];
  const timingRows: ColumnRow[] = [];
  const ruleRows: ColumnRow[] = [];
  for (const policy of dataset.policies) {
    for (const document of policy.documents) {
      documentRows.push([
        policy.routeCode,
        document.code,
        document.name,
        document.requirement,
        document.quantity,
        document.required === null ? null : bool(document.required),
        document.condition,
        document.sortOrder,
      ]);
    }
    for (const fee of policy.fees) {
      feeRows.push(feeRow(policy.routeCode, fee));
    }
    for (const timing of policy.timings) {
      timingRows.push(timingRow(policy.routeCode, timing));
    }
    for (const rule of policy.rules) {
      ruleRows.push([
        policy.routeCode,
        rule.code,
        rule.fieldName,
        rule.operatorName,
        JSON.stringify(JSON.parse(rule.expectedValue)),
        rule.description,
      ]);
    }
  }
  stats.documents = documentRows.length;
  stats.fees = feeRows.length;
  stats.timings = timingRows.length;
  stats.rules = ruleRows.length;

  const metaRows: ColumnRow[] = [
    ['schema_version', dataset.schemaVersion],
    ['dataset_version', dataset.datasetVersion],
    ['generated_at', dataset.generatedAt],
    ['imported_at', importedAt],
    ['source_file', dataset.source.file],
    ['source_hash', dataset.source.sha256],
    ['source_row_count', String(dataset.source.rowCount)],
    ['source_note', dataset.source.note],
  ].map(([key, value]) => [key, value, importedAtDb]);

  await driver.transaction(async tx => {
    for (const table of DELETE_ORDER) {
      await tx.exec(`DELETE FROM \`${table}\``);
    }

    await insertMany(
      tx,
      'regions',
      ['code', 'name_zh', 'name_en', 'sort_order'],
      dataset.dictionaries.regions.map(region => [region.code, region.nameZh, region.nameEn, region.sortOrder]),
    );
    await insertMany(
      tx,
      'visa_types',
      ['code', 'name_zh', 'name_en', 'sort_order'],
      dataset.dictionaries.types.map(type => [type.code, type.nameZh, type.nameEn, type.sortOrder]),
    );
    await insertMany(
      tx,
      'policy_groups',
      ['code', 'name_zh', 'name_en', 'color', 'description', 'sort_order'],
      dataset.dictionaries.groups.map((group, index) => [
        group.code,
        group.nameZh,
        group.nameEn,
        group.color,
        group.description,
        index + 1,
      ]),
    );
    await insertMany(
      tx,
      'visa_categories',
      ['code', 'name_zh', 'name_en', 'policy_group', 'requires_visa', 'requires_authorization', 'severity', 'color'],
      dataset.dictionaries.categories.map(category => [
        category.code,
        category.nameZh,
        category.nameEn,
        category.group,
        bool(category.requiresVisa),
        bool(category.requiresAuthorization),
        category.severity,
        category.color,
      ]),
    );
    await insertMany(
      tx,
      'data_sources',
      ['source_id', 'title', 'publisher', 'url', 'kind', 'accessed_at', 'status', 'note'],
      dataset.sources.map(source => [
        source.sourceId,
        source.title,
        source.publisher,
        source.url,
        source.kind,
        driver.toDbDateTime(source.accessedAt),
        source.status,
        source.note,
      ]),
    );
    await insertMany(
      tx,
      'data_batches',
      ['batch_id', 'name', 'source_file', 'imported_at', 'row_count', 'notes'],
      dataset.batches.map(batch => [
        batch.batchId,
        batch.name,
        batch.sourceFile,
        driver.toDbDateTime(batch.importedAt),
        batch.rowCount,
        batch.notes,
      ]),
    );
    await insertMany(
      tx,
      'countries',
      [
        'iso2',
        'name_zh',
        'name_en',
        'region_code',
        'subregion',
        'sort_key',
        'aliases',
        'latitude',
        'longitude',
        'priority',
        'created_at',
        'updated_at',
      ],
      dataset.countries.map(country => countryRow(country, generatedAtDb)),
    );
    await insertMany(
      tx,
      'visa_policies',
      [
        'route_code',
        'country_code',
        'visa_type',
        'category_code',
        'title',
        'summary',
        'conditions_text',
        'source_category',
        'stay_days',
        'stay_unit',
        'stay_rule',
        'window_days',
        'window_max_days',
        'entry_scope',
        'validity_note',
        'application_channel',
        'requires_visa',
        'requires_authorization',
        'data_status',
        'completeness',
        'is_demo',
        'is_visible',
        'source_id',
        'batch_id',
        'collected_at',
        'updated_at',
        'search_text',
      ],
      dataset.policies.map(policy =>
        policyRow(policy, {
          collectedAt: driver.toDbDateTime(normalizeIsoDateTime(policy.collectedAt, `policy.${policy.routeCode}.collectedAt`)),
          updatedAt: driver.toDbDateTime(normalizeIsoDateTime(policy.updatedAt, `policy.${policy.routeCode}.updatedAt`)),
        }),
      ),
    );
    await insertMany(
      tx,
      'policy_documents',
      ['route_code', 'code', 'name', 'requirement', 'quantity', 'is_required', 'condition_text', 'sort_order'],
      documentRows,
    );
    await insertMany(
      tx,
      'policy_fees',
      ['route_code', 'code', 'label', 'amount_min', 'amount_max', 'currency', 'charge_basis', 'condition_text', 'comparable'],
      feeRows,
    );
    await insertMany(
      tx,
      'policy_timings',
      ['route_code', 'code', 'label', 'min_days', 'max_days', 'day_type', 'start_event', 'note', 'sort_order'],
      timingRows,
    );
    await insertMany(
      tx,
      'policy_rules',
      ['route_code', 'code', 'field_name', 'operator_name', 'expected_value', 'description'],
      ruleRows,
    );
    await insertMany(
      tx,
      'mentioned_visa_types',
      ['country_code', 'visa_type', 'raw_text', 'source_id'],
      dataset.mentions.map(mention => [mention.countryCode, mention.visaType, mention.rawText, mention.sourceId]),
    );
    await insertMany(
      tx,
      'search_synonyms',
      ['term', 'canonical', 'kind', 'weight'],
      dataset.synonyms.map(synonym => [synonym.term.trim(), synonym.canonical, synonym.kind, synonym.weight]),
    );
    await insertMany(tx, 'app_meta', ['key', 'value', 'updated_at'], metaRows);
  });

  return stats;
}

function feeRow(routeCode: string, fee: DatasetFee): ColumnRow {
  return [
    routeCode,
    fee.code,
    fee.label,
    fee.amountMin,
    fee.amountMax,
    fee.currency,
    fee.basis,
    fee.condition,
    bool(fee.comparable),
  ];
}

function timingRow(routeCode: string, timing: DatasetTiming): ColumnRow {
  return [
    routeCode,
    timing.code,
    timing.label,
    timing.minDays,
    timing.maxDays,
    timing.dayType,
    timing.startEvent,
    timing.note,
    timing.sortOrder,
  ];
}
