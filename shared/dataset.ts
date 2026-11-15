/**
 * Visa Atlas v1.0 — ETL 输出 / 数据库种子文件格式（内部契约）
 *
 * `data/generated/dataset.json` 是本格式的唯一产物：
 *   CSV 源文件  ──scripts/etl.ts──▶  dataset.json  ──scripts/db-seed.ts──▶  SQLite / MySQL
 *
 * 任何新增数据（未来采集到的其他签证类型）都只需合并进 dataset.json，
 * 前端与 API 不需要改动字段。
 */
import type {
  DataStatus,
  EntryScope,
  PolicyGroup,
  RegionCode,
  StayRule,
  StayUnit,
  VisaCategoryInfo,
  VisaTypeInfo,
  RegionInfo,
  PolicyGroupInfo,
  SourceInfo,
} from './contracts.ts';

export interface DatasetFile {
  schemaVersion: '2.0';
  datasetVersion: string;
  generatedAt: string;
  source: {
    file: string;
    sha256: string;
    rowCount: number;
    note: string;
  };
  dictionaries: {
    regions: RegionInfo[];
    types: VisaTypeInfo[];
    categories: VisaCategoryInfo[];
    groups: PolicyGroupInfo[];
  };
  sources: SourceInfo[];
  batches: DatasetBatch[];
  countries: DatasetCountry[];
  policies: DatasetPolicy[];
  mentions: DatasetMention[];
  synonyms: DatasetSynonym[];
}

export interface DatasetBatch {
  batchId: string;
  name: string;
  sourceFile: string;
  importedAt: string;
  rowCount: number;
  notes: string;
}

export interface DatasetCountry {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: RegionCode;
  subregion: string | null;
  sortKey: string;
  aliases: string[];
  latitude: number | null;
  longitude: number | null;
  priority: boolean;
}

export interface DatasetPolicy {
  routeCode: string;
  countryCode: string;
  visaType: string;
  categoryCode: string;
  title: string;
  summary: string | null;
  conditionsText: string | null;
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
  sourceId: string;
  collectedAt: string;
  updatedAt: string;
  searchText: string;
  documents: DatasetDocument[];
  fees: DatasetFee[];
  timings: DatasetTiming[];
  rules: DatasetRule[];
  /** 该路线所属批次（真实数据 = csv-249，演示明细 = demo-details） */
  batchId: string;
}

export interface DatasetDocument {
  code: string;
  name: string;
  requirement: string | null;
  quantity: number | null;
  required: boolean | null;
  condition: string | null;
  sortOrder: number;
}

export interface DatasetFee {
  code: string;
  label: string;
  amountMin: string | null;
  amountMax: string | null;
  currency: string | null;
  basis: string | null;
  condition: string | null;
  comparable: boolean;
}

export interface DatasetTiming {
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

export interface DatasetRule {
  code: string;
  fieldName: string;
  operatorName: string;
  expectedValue: string;
  description: string;
}

export interface DatasetMention {
  countryCode: string;
  visaType: string;
  rawText: string | null;
  sourceId: string;
}

export interface DatasetSynonym {
  term: string;
  canonical: string;
  kind: 'COUNTRY' | 'CATEGORY' | 'TYPE' | 'KEYWORD';
  weight: number;
}

export type { PolicyGroup, DataStatus };
