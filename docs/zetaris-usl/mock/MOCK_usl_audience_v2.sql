-- =====================================================================================================
-- MOCK. NOT RUNNABLE ON ZETARIS 2.4.3. Proposed syntax for the requirement in docs/ZETARIS_USL.md 2c.
-- Everything marked "PROPOSED" does not exist today.
-- =====================================================================================================

-- 1. Constraints in the USL DDL become named, runnable rules (today CHECK compiles but LIST DQ / RUN DQ
--    do not see it). Each rule gets a severity and says when it runs.
COMPILE USL IF NOT EXISTS audience_v2 DEPLOY NAMESPACE lightning.metastore.ripple DDL
CREATE TABLE IF NOT EXISTS platform_reach (
  geo_id STRING NOT NULL,
  geo_name STRING,
  platform STRING NOT NULL,
  age_band STRING NOT NULL,
  adults BIGINT NOT NULL,
  pct_ever_use DOUBLE NOT NULL,
  reachable_users BIGINT NOT NULL,
  CONSTRAINT pct_in_range CHECK (pct_ever_use BETWEEN 0 AND 100) SEVERITY ERROR RUN ON ACTIVATE,      -- PROPOSED: SEVERITY, RUN ON
  CONSTRAINT reach_within_adults CHECK (reachable_users <= adults) SEVERITY ERROR RUN ON ACTIVATE,
  CONSTRAINT age_band_known CHECK (age_band IN ('18-29', '30-49', '50-64', '65+')) SEVERITY WARN RUN DAILY
);
CREATE TABLE IF NOT EXISTS customer (
  customer_id STRING NOT NULL PRIMARY KEY,
  age INT NOT NULL,
  age_band STRING NOT NULL REFERENCES platform_reach (age_band),                                      -- FK as a rule: every band must exist upstream
  zip STRING NOT NULL,
  avg_ticket DOUBLE,
  CONSTRAINT adult_with_ticket CHECK (age >= 18 AND avg_ticket > 0) SEVERITY ERROR RUN ON ACTIVATE
)
WITH QUALITY (results = 'lightning.metastore.ripple.audience_v2.__quality', on_error = 'refuse_activation');  -- PROPOSED

-- 2. Results are a plain table, so any client that can SELECT can read them -- including the REST API,
--    which today rejects LIST DQ / RUN DQ with "Bad Select SQL".
SELECT rule, table_name, severity, total_record, invalid_record, last_run_at, status        -- PROPOSED table
FROM lightning.metastore.ripple.audience_v2.__quality
WHERE status <> 'pass';

-- 3. Queries can ask for a quality gate, so an app gets an error instead of silently wrong rows.
SELECT age_band, reachable_users
FROM lightning.metastore.ripple.audience_v2.platform_reach
WHERE geo_id = '86000US78704' AND platform = 'instagram'
REQUIRE QUALITY severity ERROR;                                                              -- PROPOSED clause
