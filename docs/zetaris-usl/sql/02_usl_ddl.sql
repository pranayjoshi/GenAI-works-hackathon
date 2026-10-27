-- The Unified Semantic Layer: namespace + USL "audience" (Lightning Catalog DDL, compiled by Zetaris).
-- Both statements are idempotent (IF NOT EXISTS), so the script can be re-run.
-- @id ns_metastore
CREATE NAMESPACE IF NOT EXISTS lightning.metastore
-- @id ns_ripple
CREATE NAMESPACE IF NOT EXISTS lightning.metastore.ripple
-- @id compile_usl_audience
-- USL "audience": the business entities Ripple's audience builder needs, independent of which file they come from.
COMPILE USL IF NOT EXISTS audience DEPLOY NAMESPACE lightning.metastore.ripple DDL
CREATE TABLE IF NOT EXISTS population_by_age (
  geo_id STRING NOT NULL,
  geo_name STRING,
  release STRING,
  sex STRING NOT NULL,
  age_lo INT NOT NULL,
  age_band STRING NOT NULL,
  people BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_reach (
  geo_id STRING NOT NULL,
  geo_name STRING,
  platform STRING NOT NULL,
  age_band STRING NOT NULL,
  adults BIGINT NOT NULL,
  pct_ever_use DOUBLE NOT NULL,
  reachable_users BIGINT NOT NULL,
  CONSTRAINT pct_not_negative CHECK (pct_ever_use >= 0),
  CONSTRAINT pct_at_most_100 CHECK (pct_ever_use <= 100)
);
CREATE TABLE IF NOT EXISTS behaviour_prior (
  param STRING NOT NULL,
  dimension STRING NOT NULL,
  band STRING NOT NULL,
  dist STRING,
  a DOUBLE,
  b DOUBLE,
  prior_mean DOUBLE,
  label STRING NOT NULL
);
CREATE TABLE IF NOT EXISTS customer (
  customer_id STRING NOT NULL PRIMARY KEY,
  age INT NOT NULL,
  age_band STRING NOT NULL,
  zip STRING NOT NULL,
  visits_per_month INT,
  avg_ticket DOUBLE,
  monthly_spend DOUBLE,
  tenure_months INT,
  label STRING
);
CREATE TABLE IF NOT EXISTS headline_package (
  test_id STRING NOT NULL,
  headline STRING,
  impressions BIGINT NOT NULL,
  clicks BIGINT NOT NULL,
  ctr DOUBLE
)
-- @id show_usl
SHOW NAMESPACES OR TABLES IN lightning.metastore.ripple.audience
