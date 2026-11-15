# A｜数据收集与首次建库职责书

## 你要完成什么

把官方资料整理成大家能直接使用的一批批数据，并用现成脚本建立本地数据库。不需要从零设计一套后端。

1. 阅读 `docs/DATA.md` 和完整模板，与 B 确认首批国家、用途、申请人范围与渠道。
2. 收集国家/地区、签证官方名称与用途、适用范围、全部材料及条件、签证有效期、停留期、全部费用项目、办理时间和规则依据。字段不能因难收集而从模型删除。
3. 每条事实附可访问来源、页面定位和访问时间。没查到填 null，说明缺项；别把 0、空字符串或“无要求”当未知。
4. 在你自己的 MySQL 建立 8 张表和国家字典，确认中文、null、小数金额正常。别人可按同一 README 自建，不要求六个人连你电脑。
5. 每次交完整路线批次给 B。B 退回冲突或缺项时，补原始依据，不擅自把验证状态改成通过。

## 交什么、什么时候交

| 时点 | 提交物 | 接收人 | 通过标准 |
|---|---|---|---|
| 第一阶段 | 建库结果、环境说明、不含密码的截图/命令结果 | C/D | `db:init` 成功；目录可读；不声称自动迁移 |
| 首条真实路线 | `data/batches/<批次>.json` 与来源记录 | B | 字段齐、引用可追溯、`data:validate` 通过 |
| 后续每批 | 3–5 目的地资料及缺项清单 | B | 稳定路线号，无重复，无不同渠道混合 |
| 要改表时 | 原因、迁移 SQL、旧数据处理方法 | C，D复核 | C 同步读写适配，D 可回归后才合并 |

采集草稿默认 `isVisible=false`；只有 B 复核通过可发布的部分后才改公开状态。A 可以运行预览验证，但正式演示库由 B 统一应用更新，避免两个人同时改同一份事实。

## 你的文件与沟通边界

主责 `data/batches/`、国家字典修改建议、`database/schema.sql` 的业务含义。已有 schema 不随便重写；涉及数据库实现先和 C 确认。不得修改 `client/`、接口路径或推荐评分。

- 对 B：A-B 协议，交可核对的完整数据和问题清单。
- 对 C：A-C 协议，建库、字段和迁移；不传真实密码到 GitHub。
- 对 D：A-D 协议，采集覆盖与建库验收。
- 对 E/F：A-E、A-F 协议，只说明名称、显示、坐标来源，不旁路 API 发一套独立数据文件。

## 建表 SQL（与仓库初始 schema 同版）

使用 UTF-8 数据库；实际初始化优先 `npm run db:init`。以下直接列出全部建表语句满足独立交付要求；以后以 `database/schema.sql` 和迁移文件为可执行唯一来源，改表时同步本附录。

```sql
CREATE TABLE IF NOT EXISTS regions (
  code VARCHAR(32) PRIMARY KEY, name_zh VARCHAR(100) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS countries (
  code CHAR(2) PRIMARY KEY, name_zh VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL, region_code VARCHAR(32) NOT NULL,
  subregion VARCHAR(100) NOT NULL, sort_key VARCHAR(150) NOT NULL,
  aliases JSON NOT NULL, latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL, source_url TEXT NOT NULL,
  FOREIGN KEY (region_code) REFERENCES regions(code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS visa_types (
  code VARCHAR(32) PRIMARY KEY, name_zh VARCHAR(100) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS visa_policies (
  route_code VARCHAR(80) PRIMARY KEY, country_code CHAR(2) NOT NULL,
  visa_type VARCHAR(32) NOT NULL, official_name VARCHAR(200) NULL,
  application_channel TEXT NULL, application_scope TEXT NULL,
  entry_count VARCHAR(100) NULL, scope_source_ids JSON NOT NULL,
  validity_value INT UNSIGNED NULL, validity_unit VARCHAR(10) NULL,
  validity_note TEXT NULL, validity_source_ids JSON NOT NULL,
  stay_value INT UNSIGNED NULL, stay_unit VARCHAR(10) NULL,
  stay_basis VARCHAR(32) NULL, stay_note TEXT NULL,
  stay_source_ids JSON NOT NULL, documents_status VARCHAR(20) NOT NULL,
  rules_status VARCHAR(20) NOT NULL, sources JSON NOT NULL,
  last_verified_at DATETIME(3) NULL, refresh_due_at DATETIME(3) NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  is_visible BOOLEAN NOT NULL DEFAULT FALSE, updated_at DATETIME(3) NOT NULL,
  FOREIGN KEY (country_code) REFERENCES countries(code),
  FOREIGN KEY (visa_type) REFERENCES visa_types(code),
  CHECK ((validity_value IS NULL) = (validity_unit IS NULL)),
  CHECK ((stay_value IS NULL) = (stay_unit IS NULL)),
  INDEX idx_policy_country_type (country_code, visa_type, is_visible)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS required_documents (
  policy_code VARCHAR(80) NOT NULL, code VARCHAR(60) NOT NULL,
  name VARCHAR(200) NOT NULL, requirement_text TEXT NULL,
  quantity INT UNSIGNED NULL, is_required BOOLEAN NULL,
  condition_text TEXT NULL, source_ids JSON NOT NULL,
  PRIMARY KEY (policy_code, code),
  FOREIGN KEY (policy_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS visa_fees (
  policy_code VARCHAR(80) NOT NULL, code VARCHAR(60) NOT NULL,
  label VARCHAR(200) NOT NULL, amount_min DECIMAL(12,2) NULL,
  amount_max DECIMAL(12,2) NULL, currency CHAR(3) NULL,
  charge_basis TEXT NULL, condition_text TEXT NULL,
  includes_text TEXT NULL, excludes_text TEXT NULL,
  comparable BOOLEAN NOT NULL DEFAULT FALSE, source_ids JSON NOT NULL,
  PRIMARY KEY (policy_code, code),
  FOREIGN KEY (policy_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  CHECK (amount_min IS NULL OR amount_min >= 0),
  CHECK (amount_max IS NULL OR amount_max >= 0),
  CHECK (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS visa_processing_times (
  policy_code VARCHAR(80) NOT NULL, code VARCHAR(60) NOT NULL,
  label VARCHAR(200) NOT NULL, min_days INT UNSIGNED NULL,
  max_days INT UNSIGNED NULL, day_type VARCHAR(20) NULL,
  start_event TEXT NULL, condition_text TEXT NULL, note TEXT NULL,
  comparable BOOLEAN NOT NULL DEFAULT FALSE, source_ids JSON NOT NULL,
  PRIMARY KEY (policy_code, code),
  FOREIGN KEY (policy_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE,
  CHECK (min_days IS NULL OR max_days IS NULL OR min_days <= max_days)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS eligibility_rules (
  policy_code VARCHAR(80) NOT NULL, code VARCHAR(60) NOT NULL,
  field_name VARCHAR(40) NOT NULL, operator_name VARCHAR(12) NOT NULL,
  expected_value JSON NOT NULL, description TEXT NOT NULL,
  source_ids JSON NOT NULL, PRIMARY KEY (policy_code, code),
  FOREIGN KEY (policy_code) REFERENCES visa_policies(route_code) ON DELETE CASCADE
) ENGINE=InnoDB;
```

