-- Activation: bind each USL table to a query over the registered sources. Zetaris checks the query's
-- schema against the declared USL types (name, type, nullability) and refuses a mismatch.
-- @id activate_population_by_age
-- Census B01001 sex-by-age cells, one row per geography x sex x age cell, with a Pew-compatible age band.
ACTIVATE USL TABLE lightning.metastore.ripple.audience.population_by_age AS
SELECT COALESCE(geo_id, '') AS geo_id, geo_name, release,
  CASE WHEN CAST(substr(column_id, 7, 3) AS INT) <= 25 THEN 'male' ELSE 'female' END AS sex,
  COALESCE(CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) END, 0) AS age_lo,
  CASE WHEN column_name LIKE 'Under%' THEN 'under 18'
       WHEN CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) < 18 THEN 'under 18'
       WHEN CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) < 30 THEN '18-29'
       WHEN CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) < 50 THEN '30-49'
       WHEN CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) < 65 THEN '50-64' ELSE '65+' END AS age_band,
  COALESCE(CAST(estimate AS BIGINT), CAST(0 AS BIGINT)) AS people
FROM dryrun.census_acs_zips WHERE table_id = 'B01001' AND indent = 2
-- @id activate_platform_reach
-- The Census x Pew join the app uses for audience size, for every platform: adults per age band x Pew ever-use rate.
ACTIVATE USL TABLE lightning.metastore.ripple.audience.platform_reach AS
WITH ages AS (
  SELECT geo_id, geo_name, CASE WHEN column_name LIKE 'Under%' THEN 0 ELSE CAST(regexp_extract(column_name, '([0-9]+)', 1) AS INT) END AS age_lo, CAST(estimate AS BIGINT) AS estimate
  FROM dryrun.census_acs_zips WHERE table_id = 'B01001' AND indent = 2
), banded AS (
  SELECT geo_id, geo_name, CASE WHEN age_lo < 18 THEN NULL WHEN age_lo < 30 THEN '18-29' WHEN age_lo < 50 THEN '30-49' WHEN age_lo < 65 THEN '50-64' ELSE '65+' END AS band, SUM(estimate) AS adults
  FROM ages GROUP BY geo_id, geo_name, CASE WHEN age_lo < 18 THEN NULL WHEN age_lo < 30 THEN '18-29' WHEN age_lo < 50 THEN '30-49' WHEN age_lo < 65 THEN '50-64' ELSE '65+' END
)
SELECT COALESCE(b.geo_id, '') AS geo_id, b.geo_name, COALESCE(p.platform, '') AS platform, COALESCE(b.band, '') AS age_band,
  COALESCE(b.adults, CAST(0 AS BIGINT)) AS adults,
  COALESCE(CAST(p.pct_us_adults_ever_use AS DOUBLE), CAST(0 AS DOUBLE)) AS pct_ever_use,
  COALESCE(CAST(ROUND(b.adults * p.pct_us_adults_ever_use / 100.0) AS BIGINT), CAST(0 AS BIGINT)) AS reachable_users
FROM banded b JOIN dryrun.pew_platform_use p ON p.dimension = 'age' AND p.band = b.band
WHERE b.band IS NOT NULL
-- @id activate_behaviour_prior
-- Behaviour priors with their mean (Beta: a / (a + b)); the label says MODELED PRIOR or ASSUMED.
ACTIVATE USL TABLE lightning.metastore.ripple.audience.behaviour_prior AS
SELECT COALESCE(param, '') AS param, COALESCE(dimension, '') AS dimension, COALESCE(band, '') AS band, dist,
  CAST(a AS DOUBLE) AS a, CAST(b AS DOUBLE) AS b,
  CASE WHEN dist = 'beta' THEN CAST(a AS DOUBLE) / (CAST(a AS DOUBLE) + CAST(b AS DOUBLE)) ELSE CAST(NULL AS DOUBLE) END AS prior_mean,
  COALESCE(label, '') AS label
FROM dryrun.priors_behaviour
-- @id activate_customer
-- The business's customer list with a Pew-compatible age band and monthly spend.
ACTIVATE USL TABLE lightning.metastore.ripple.audience.customer AS
SELECT COALESCE(customer_id, '') AS customer_id, COALESCE(CAST(age AS INT), 0) AS age,
  CASE WHEN age < 30 THEN '18-29' WHEN age < 50 THEN '30-49' WHEN age < 65 THEN '50-64' ELSE '65+' END AS age_band,
  COALESCE(CAST(zip AS STRING), '') AS zip, CAST(visits_per_month AS INT) AS visits_per_month, CAST(avg_ticket AS DOUBLE) AS avg_ticket,
  CAST(visits_per_month * avg_ticket AS DOUBLE) AS monthly_spend, CAST(tenure_months AS INT) AS tenure_months, label
FROM dryrun.biz_customers
-- @id activate_headline_package
-- Upworthy headline packages with CTR, for the backtest.
ACTIVATE USL TABLE lightning.metastore.ripple.audience.headline_package AS
SELECT COALESCE(clickability_test_id, '') AS test_id, headline,
  COALESCE(CAST(impressions AS BIGINT), CAST(0 AS BIGINT)) AS impressions, COALESCE(CAST(clicks AS BIGINT), CAST(0 AS BIGINT)) AS clicks,
  CASE WHEN CAST(impressions AS BIGINT) > 0 THEN CAST(clicks AS DOUBLE) / CAST(impressions AS DOUBLE) ELSE CAST(NULL AS DOUBLE) END AS ctr
FROM dryrun.upworthy_tests
-- @id compile_contract_demo
-- A second, tiny USL used only to show the schema contract: it declares adults as NOT NULL.
COMPILE USL IF NOT EXISTS contract_demo DEPLOY NAMESPACE lightning.metastore.ripple DDL
CREATE TABLE IF NOT EXISTS reach_strict (geo_id STRING NOT NULL, adults BIGINT NOT NULL)
-- @id activate_contract_demo_rejected
-- Expected to FAIL: the query's adults column is nullable, the USL says NOT NULL, so Zetaris refuses to activate it.
ACTIVATE USL TABLE lightning.metastore.ripple.contract_demo.reach_strict AS
SELECT COALESCE(geo_id, '') AS geo_id, CAST(estimate AS BIGINT) AS adults FROM dryrun.census_acs_zips WHERE column_id = 'B01001001'
-- @id show_usl_activated
SHOW NAMESPACES OR TABLES IN lightning.metastore.ripple.audience
