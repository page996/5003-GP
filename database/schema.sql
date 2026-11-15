-- ============================================================================
-- Visa Atlas v1.0 · SQLite schema（默认本地可运行数据库）
-- 与 database/schema.mysql.sql 保持同构；字段含义见 docs/DATA-DICTIONARY.md
-- 执行：npm run db:init  （或 sqlite3 data/visaatlas.sqlite < database/schema.sql）
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ---------------------------------------------------------------------------
-- 0. 元数据：schema 版本、导入批次、数据集版本
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1. 字典表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regions (
  code        TEXT PRIMARY KEY,
  name_zh     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visa_types (
  code        TEXT PRIMARY KEY,
  name_zh     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_groups (
  code        TEXT PRIMARY KEY,
  name_zh     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  color       TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visa_categories (
  code                   TEXT PRIMARY KEY,
  name_zh                TEXT NOT NULL,
  name_en                TEXT NOT NULL,
  policy_group           TEXT NOT NULL REFERENCES policy_groups(code),
  requires_visa          INTEGER NOT NULL CHECK (requires_visa IN (0, 1)),
  requires_authorization INTEGER NOT NULL CHECK (requires_authorization IN (0, 1)),
  severity               INTEGER NOT NULL CHECK (severity >= 0),
  color                  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. 数据来源与导入批次：每条政策必须能回溯到来源与批次
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_sources (
  source_id   TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  publisher   TEXT NOT NULL,
  url         TEXT,
  kind        TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  status      TEXT NOT NULL,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS data_batches (
  batch_id    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_file TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  notes       TEXT
);

-- ---------------------------------------------------------------------------
-- 3. 国家目录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
  iso2        TEXT PRIMARY KEY CHECK (length(iso2) = 2),
  name_zh     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  region_code TEXT NOT NULL REFERENCES regions(code),
  subregion   TEXT,
  sort_key    TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)),
  latitude    REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude   REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  priority    INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_countries_region ON countries(region_code);
CREATE INDEX IF NOT EXISTS idx_countries_sort ON countries(sort_key);

-- ---------------------------------------------------------------------------
-- 4. 签证政策（一条 = 一个国家 × 一种用途 × 一条可说明白的手续路线）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visa_policies (
  route_code             TEXT PRIMARY KEY,
  country_code           TEXT NOT NULL REFERENCES countries(iso2),
  visa_type              TEXT NOT NULL REFERENCES visa_types(code),
  category_code          TEXT NOT NULL REFERENCES visa_categories(code),
  title                  TEXT NOT NULL,
  summary                TEXT,
  conditions_text        TEXT,
  source_category        TEXT,
  stay_days              INTEGER CHECK (stay_days IS NULL OR stay_days >= 0),
  stay_unit              TEXT,
  stay_rule              TEXT NOT NULL DEFAULT 'UNSPECIFIED'
                         CHECK (stay_rule IN ('PER_ENTRY','ROLLING_WINDOW','UNSPECIFIED')),
  window_days            INTEGER CHECK (window_days IS NULL OR window_days > 0),
  window_max_days        INTEGER CHECK (window_max_days IS NULL OR window_max_days > 0),
  entry_scope            TEXT NOT NULL DEFAULT 'UNKNOWN'
                         CHECK (entry_scope IN ('SINGLE','MULTIPLE','UNKNOWN')),
  validity_note          TEXT,
  application_channel    TEXT,
  requires_visa          INTEGER NOT NULL CHECK (requires_visa IN (0, 1)),
  requires_authorization INTEGER NOT NULL CHECK (requires_authorization IN (0, 1)),
  data_status            TEXT NOT NULL
                         CHECK (data_status IN ('DETAILED','PARTIAL','SUMMARY_ONLY','DEMO')),
  completeness           INTEGER NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  is_demo                INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  is_visible             INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  source_id              TEXT REFERENCES data_sources(source_id),
  batch_id               TEXT REFERENCES data_batches(batch_id),
  collected_at           TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  search_text            TEXT NOT NULL,
  CHECK (window_max_days IS NULL OR window_days IS NOT NULL),
  CHECK ((stay_days IS NULL AND stay_unit IS NULL) OR (stay_days IS NOT NULL AND stay_unit IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_policies_country  ON visa_policies(country_code, visa_type, is_visible);
CREATE INDEX IF NOT EXISTS idx_policies_type     ON visa_policies(visa_type, is_visible, is_demo);
CREATE INDEX IF NOT EXISTS idx_policies_category ON visa_policies(category_code, is_visible);
CREATE INDEX IF NOT EXISTS idx_policies_group_lookup ON visa_policies(category_code, is_demo, is_visible);
CREATE INDEX IF NOT EXISTS idx_policies_stay     ON visa_policies(stay_days);
CREATE INDEX IF NOT EXISTS idx_policies_status   ON visa_policies(data_status, is_visible);
CREATE INDEX IF NOT EXISTS idx_policies_complete ON visa_policies(completeness DESC);

-- 其他国家识别到的签证类型线索（尚未形成结构化路线）
CREATE TABLE IF NOT EXISTS mentioned_visa_types (
  country_code TEXT NOT NULL REFERENCES countries(iso2),
  visa_type    TEXT NOT NULL REFERENCES visa_types(code),
  raw_text     TEXT,
  source_id    TEXT REFERENCES data_sources(source_id),
  PRIMARY KEY (country_code, visa_type)
);

CREATE INDEX IF NOT EXISTS idx_mentioned_type ON mentioned_visa_types(visa_type);

-- ---------------------------------------------------------------------------
-- 5. 结构化明细（当前真实数据未采集，演示明细用于验证界面与检索）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_documents (
  route_code      TEXT NOT NULL REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  requirement     TEXT,
  quantity        INTEGER,
  is_required     INTEGER CHECK (is_required IN (0, 1) OR is_required IS NULL),
  condition_text  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (route_code, code)
);

CREATE TABLE IF NOT EXISTS policy_fees (
  route_code      TEXT NOT NULL REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  amount_min      TEXT,
  amount_max      TEXT,
  currency        TEXT,
  charge_basis    TEXT,
  condition_text  TEXT,
  comparable      INTEGER NOT NULL DEFAULT 0 CHECK (comparable IN (0, 1)),
  PRIMARY KEY (route_code, code)
);

CREATE TABLE IF NOT EXISTS policy_timings (
  route_code     TEXT NOT NULL REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  label          TEXT NOT NULL,
  min_days       INTEGER,
  max_days       INTEGER,
  day_type       TEXT CHECK (day_type IN ('WORKING_DAY','CALENDAR_DAY') OR day_type IS NULL),
  start_event    TEXT,
  note           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (route_code, code),
  CHECK (min_days IS NULL OR max_days IS NULL OR min_days <= max_days)
);

CREATE TABLE IF NOT EXISTS policy_rules (
  route_code      TEXT NOT NULL REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  field_name      TEXT NOT NULL,
  operator_name   TEXT NOT NULL,
  expected_value  TEXT NOT NULL CHECK (json_valid(expected_value)),
  description     TEXT NOT NULL,
  PRIMARY KEY (route_code, code)
);

-- ---------------------------------------------------------------------------
-- 6. 搜索增强：同义词（英国/UK/GBR、免签/visa free 等）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_synonyms (
  term        TEXT PRIMARY KEY COLLATE NOCASE,
  canonical   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('COUNTRY','CATEGORY','TYPE','KEYWORD')),
  weight      INTEGER NOT NULL DEFAULT 10
);

-- ---------------------------------------------------------------------------
-- 7. 查询视图：地图着色与卡片列表复用同一套 JOIN，避免前端各算一份
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_country_map AS
SELECT
  c.iso2,
  c.name_zh,
  c.name_en,
  c.region_code,
  c.priority,
  p.route_code          AS tourism_route_code,
  p.category_code,
  p.stay_days,
  p.completeness,
  CASE WHEN p.route_code IS NULL THEN 0 ELSE 1 END AS has_data,
  EXISTS (
    SELECT 1 FROM visa_policies d
    WHERE d.country_code = c.iso2 AND d.is_demo = 1 AND d.is_visible = 1
  ) AS has_demo_detail
FROM countries c
LEFT JOIN visa_policies p
  ON p.country_code = c.iso2
 AND p.visa_type = 'TOURISM'
 AND p.is_visible = 1
 AND p.is_demo = 0;

CREATE VIEW IF NOT EXISTS v_policy_cards AS
SELECT
  p.route_code,
  p.country_code,
  c.name_zh        AS country_name_zh,
  c.name_en        AS country_name_en,
  c.sort_key,
  c.region_code,
  c.priority,
  p.visa_type,
  vt.name_zh       AS visa_type_zh,
  p.category_code,
  vc.name_zh       AS category_zh,
  vc.policy_group,
  pg.name_zh       AS group_zh,
  pg.color         AS group_color,
  p.requires_visa,
  p.requires_authorization,
  p.stay_days,
  p.stay_rule,
  p.window_days,
  p.window_max_days,
  p.entry_scope,
  p.summary,
  p.conditions_text,
  p.data_status,
  p.completeness,
  p.is_demo,
  p.source_id,
  p.updated_at
FROM visa_policies p
JOIN countries c     ON c.iso2 = p.country_code
JOIN visa_types vt   ON vt.code = p.visa_type
JOIN visa_categories vc ON vc.code = p.category_code
JOIN policy_groups pg   ON pg.code = vc.policy_group
WHERE p.is_visible = 1;
