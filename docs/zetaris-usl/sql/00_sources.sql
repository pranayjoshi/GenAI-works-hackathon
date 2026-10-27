-- Source check: every source table answers on Zetaris (row counts).
-- @id src_census_acs
SELECT COUNT(*) AS n FROM dryrun.census_acs
-- @id src_census_acs_zips
SELECT COUNT(*) AS n FROM dryrun.census_acs_zips
-- @id src_pew
SELECT COUNT(*) AS n FROM dryrun.pew_platform_use
-- @id src_priors
SELECT COUNT(*) AS n FROM dryrun.priors_behaviour
-- @id src_customers
SELECT COUNT(*) AS n FROM dryrun.biz_customers
-- @id src_upworthy
SELECT COUNT(*) AS n FROM dryrun.upworthy_tests
