-- ============================================================================
-- Visa Atlas v1.0 · MySQL 8.0 schema（课程数据库 / 生产路径）
-- 与 database/schema.sql（SQLite）同构，字段含义见 docs/DATA-DICTIONARY.md
-- 执行：npm run db:init:mysql  （需要 .env 中 DB_ADMIN_* 有建库权限）
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_meta (
  `key`       VARCHAR(64) PRIMARY KEY,
  `value`     TEXT NOT NULL,
  updated_at  DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS regions (
  code        VARCHAR(8) PRIMARY KEY,
  name_zh     VARCHAR(60) NOT NULL,
  name_en     VARCHAR(80) NOT NULL,
  sort_order  SMALLINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS visa_types (
  code        VARCHAR(32) PRIMARY KEY,
  name_zh     VARCHAR(60) NOT NULL,
  name_en     VARCHAR(80) NOT NULL,
  sort_order  SMALLINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_groups (
  code        VARCHAR(16) PRIMARY KEY,
  name_zh     VARCHAR(60) NOT NULL,
  name_en     VARCHAR(80) NOT NULL,
  color       CHAR(7) NOT NULL,
  description VARCHAR(300) NOT NULL,
  sort_order  SMALLINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS visa_categories (
  code                   VARCHAR(40) PRIMARY KEY,
  name_zh                VARCHAR(80) NOT NULL,
  name_en                VARCHAR(120) NOT NULL,
  policy_group           VARCHAR(16) NOT NULL,
  requires_visa          TINYINT(1) NOT NULL,
  requires_authorization TINYINT(1) NOT NULL,
  severity               SMALLINT NOT NULL,
  color                  CHAR(7) NOT NULL,
  CONSTRAINT fk_category_group FOREIGN KEY (policy_group) REFERENCES policy_groups(code),
  CONSTRAINT chk_category_bool CHECK (requires_visa IN (0,1) AND requires_authorization IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_sources (
  source_id   VARCHAR(64) PRIMARY KEY,
  title       VARCHAR(300) NOT NULL,
  publisher   VARCHAR(200) NOT NULL,
  url         TEXT,
  kind        VARCHAR(40) NOT NULL,
  accessed_at DATETIME(3) NOT NULL,
  status      VARCHAR(40) NOT NULL,
  note        TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_batches (
  batch_id    VARCHAR(120) PRIMARY KEY,
  name        VARCHAR(300) NOT NULL,
  source_file VARCHAR(300) NOT NULL,
  imported_at DATETIME(3) NOT NULL,
  row_count   INT NOT NULL,
  notes       TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS countries (
  iso2        CHAR(2) PRIMARY KEY,
  name_zh     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(120) NOT NULL,
  region_code VARCHAR(8) NOT NULL,
  subregion   VARCHAR(120),
  sort_key    VARCHAR(160) NOT NULL,
  aliases     TEXT NOT NULL,
  latitude    DECIMAL(9,6),
  longitude   DECIMAL(10,6),
  priority    TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL,
  updated_at  DATETIME(3) NOT NULL,
  CONSTRAINT fk_country_region FOREIGN KEY (region_code) REFERENCES regions(code),
  CONSTRAINT chk_country_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_country_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_country_aliases CHECK (JSON_VALID(aliases)),
  INDEX idx_countries_region (region_code),
  INDEX idx_countries_sort (sort_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS visa_policies (
  route_code             VARCHAR(80) PRIMARY KEY,
  country_code           CHAR(2) NOT NULL,
  visa_type              VARCHAR(32) NOT NULL,
  category_code          VARCHAR(40) NOT NULL,
  title                  VARCHAR(300) NOT NULL,
  summary                TEXT,
  conditions_text        TEXT,
  source_category        VARCHAR(200),
  stay_days              INT,
  stay_unit              VARCHAR(12),
  stay_rule              VARCHAR(20) NOT NULL DEFAULT 'UNSPECIFIED',
  window_days            INT,
  window_max_days        INT,
  entry_scope            VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
  validity_note          TEXT,
  application_channel    TEXT,
  requires_visa          TINYINT(1) NOT NULL,
  requires_authorization TINYINT(1) NOT NULL,
  data_status            VARCHAR(20) NOT NULL,
  completeness           TINYINT UNSIGNED NOT NULL,
  is_demo                TINYINT(1) NOT NULL DEFAULT 0,
  is_visible             TINYINT(1) NOT NULL DEFAULT 1,
  source_id              VARCHAR(64),
  batch_id               VARCHAR(120),
  collected_at           DATETIME(3) NOT NULL,
  updated_at             DATETIME(3) NOT NULL,
  search_text            TEXT NOT NULL,
  CONSTRAINT fk_policy_country FOREIGN KEY (country_code) REFERENCES countries(iso2),
  CONSTRAINT fk_policy_type FOREIGN KEY (visa_type) REFERENCES visa_types(code),
  CONSTRAINT fk_policy_category FOREIGN KEY (category_code) REFERENCES visa_categories(code),
  CONSTRAINT fk_policy_source FOREIGN KEY (source_id) REFERENCES data_sources(source_id),
  CONSTRAINT fk_policy_batch FOREIGN KEY (batch_id) REFERENCES data_batches(batch_id),
  CONSTRAINT chk_policy_stay CHECK (stay_days IS NULL OR stay_days >= 0),
  CONSTRAINT chk_policy_completeness CHECK (completeness BETWEEN 0 AND 100),
  CONSTRAINT chk_policy_demo CHECK (is_demo IN (0,1) AND is_visible IN (0,1)),
  CONSTRAINT chk_policy_rule CHECK (stay_rule IN ('PER_ENTRY','ROLLING_WINDOW','UNSPECIFIED')),
  CONSTRAINT chk_policy_entry CHECK (entry_scope IN ('SINGLE','MULTIPLE','UNKNOWN')),
  CONSTRAINT chk_policy_status CHECK (data_status IN ('DETAILED','PARTIAL','SUMMARY_ONLY','DEMO')),
  INDEX idx_policies_country (country_code, visa_type, is_visible),
  INDEX idx_policies_type (visa_type, is_visible, is_demo),
  INDEX idx_policies_category (category_code, is_visible),
  INDEX idx_policies_stay (stay_days),
  INDEX idx_policies_status (data_status, is_visible),
  INDEX idx_policies_complete (completeness)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mentioned_visa_types (
  country_code CHAR(2) NOT NULL,
  visa_type    VARCHAR(32) NOT NULL,
  raw_text     TEXT,
  source_id    VARCHAR(64),
  PRIMARY KEY (country_code, visa_type),
  CONSTRAINT fk_mention_country FOREIGN KEY (country_code) REFERENCES countries(iso2),
  CONSTRAINT fk_mention_type FOREIGN KEY (visa_type) REFERENCES visa_types(code),
  CONSTRAINT fk_mention_source FOREIGN KEY (source_id) REFERENCES data_sources(source_id),
  INDEX idx_mentioned_type (visa_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_documents (
  route_code     VARCHAR(80) NOT NULL,
  code           VARCHAR(60) NOT NULL,
  name           VARCHAR(200) NOT NULL,
  requirement    TEXT,
  quantity       INT,
  is_required    TINYINT(1),
  condition_text TEXT,
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (route_code, code),
  CONSTRAINT fk_document_policy FOREIGN KEY (route_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_fees (
  route_code     VARCHAR(80) NOT NULL,
  code           VARCHAR(60) NOT NULL,
  label          VARCHAR(200) NOT NULL,
  amount_min     DECIMAL(12,2),
  amount_max     DECIMAL(12,2),
  currency       CHAR(3),
  charge_basis   TEXT,
  condition_text TEXT,
  comparable     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (route_code, code),
  CONSTRAINT fk_fee_policy FOREIGN KEY (route_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  CONSTRAINT chk_fee_amount CHECK (amount_min IS NULL OR amount_min >= 0),
  CONSTRAINT chk_fee_max CHECK (amount_max IS NULL OR amount_max >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_timings (
  route_code  VARCHAR(80) NOT NULL,
  code        VARCHAR(60) NOT NULL,
  label       VARCHAR(200) NOT NULL,
  min_days    INT,
  max_days    INT,
  day_type    VARCHAR(20),
  start_event TEXT,
  note        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (route_code, code),
  CONSTRAINT fk_timing_policy FOREIGN KEY (route_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  CONSTRAINT chk_timing_day CHECK (day_type IS NULL OR day_type IN ('WORKING_DAY','CALENDAR_DAY')),
  CONSTRAINT chk_timing_range CHECK (min_days IS NULL OR max_days IS NULL OR min_days <= max_days)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS policy_rules (
  route_code     VARCHAR(80) NOT NULL,
  code           VARCHAR(60) NOT NULL,
  field_name     VARCHAR(40) NOT NULL,
  operator_name  VARCHAR(12) NOT NULL,
  expected_value TEXT NOT NULL,
  description    TEXT NOT NULL,
  PRIMARY KEY (route_code, code),
  CONSTRAINT fk_rule_policy FOREIGN KEY (route_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  CONSTRAINT chk_rule_json CHECK (JSON_VALID(expected_value))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS search_synonyms (
  term      VARCHAR(120) PRIMARY KEY,
  canonical VARCHAR(120) NOT NULL,
  kind      VARCHAR(20) NOT NULL,
  weight    SMALLINT NOT NULL DEFAULT 10
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE OR REPLACE VIEW v_country_map AS
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

CREATE OR REPLACE VIEW v_policy_cards AS
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
JOIN countries c        ON c.iso2 = p.country_code
JOIN visa_types vt      ON vt.code = p.visa_type
JOIN visa_categories vc ON vc.code = p.category_code
JOIN policy_groups pg   ON pg.code = vc.policy_group
WHERE p.is_visible = 1;
