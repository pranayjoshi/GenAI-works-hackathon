-- Exploratory queries, 2-3 per source. Each asks one plain question about the data.
-- ## Census ACS (dryrun.census_acs_zips: the cached Census Reporter responses for 3 ZIPs + the US)
-- @id census_q1_geographies
-- Which geographies and releases are loaded, and how many cells each?
SELECT geo_id, geo_name, release, COUNT(*) AS cells FROM dryrun.census_acs_zips GROUP BY geo_id, geo_name, release ORDER BY geo_id
-- @id census_q2_population
-- Total population per geography (B01001001 = Total).
SELECT geo_id, geo_name, estimate AS population, moe FROM dryrun.census_acs_zips WHERE column_id = 'B01001001' ORDER BY population DESC
-- @id census_q3_degree_share_78704
-- Share of adults 25+ in ZIP 78704 with a bachelor's degree or higher (B15003 022-025 over 001).
SELECT ROUND(SUM(CASE WHEN column_id IN ('B15003022','B15003023','B15003024','B15003025') THEN estimate ELSE 0 END) * 1.0 / MAX(CASE WHEN column_id = 'B15003001' THEN estimate END), 3) AS bachelors_plus_share FROM dryrun.census_acs_zips WHERE geo_id = '86000US78704' AND table_id = 'B15003'
-- ## Pew platform use
-- @id pew_q1_coverage
-- Which platforms and dimensions does the fact sheet extract cover?
SELECT platform, dimension, COUNT(*) AS bands FROM dryrun.pew_platform_use GROUP BY platform, dimension ORDER BY platform, dimension
-- @id pew_q2_instagram_by_age
-- Instagram use by age band (percent of US adults who ever use it).
SELECT band, pct_us_adults_ever_use FROM dryrun.pew_platform_use WHERE platform = 'instagram' AND dimension = 'age' ORDER BY band
-- @id pew_q3_top_platform_18_29
-- Which platform reaches the most 18-29 year olds?
SELECT platform, pct_us_adults_ever_use FROM dryrun.pew_platform_use WHERE dimension = 'age' AND band = '18-29' ORDER BY pct_us_adults_ever_use DESC
-- ## Behaviour priors (labelled assumptions)
-- @id priors_q1_labels
-- How many priors are MODELED PRIOR vs ASSUMED?
SELECT label, COUNT(*) AS n FROM dryrun.priors_behaviour GROUP BY label ORDER BY n DESC
-- @id priors_q2_params
-- Which parameters exist, over which dimension, with which distribution?
SELECT param, dimension, dist, COUNT(*) AS bands FROM dryrun.priors_behaviour GROUP BY param, dimension, dist ORDER BY param
-- @id priors_q3_price_sensitivity_mean
-- Mean price sensitivity by income band (Beta mean a / (a + b)).
SELECT band, a, b, ROUND(a / (a + b), 3) AS beta_mean FROM dryrun.priors_behaviour WHERE param = 'price_sensitivity' ORDER BY beta_mean DESC
-- ## Business customers (synthetic demo cafe)
-- @id customers_q1_profile
-- How many customers, and their average age, visits and ticket?
SELECT COUNT(*) AS customers, ROUND(AVG(age), 1) AS avg_age, ROUND(AVG(visits_per_month), 2) AS avg_visits, ROUND(AVG(avg_ticket), 2) AS avg_ticket FROM dryrun.biz_customers
-- @id customers_q2_by_zip
-- Where do customers live (top ZIPs)?
SELECT zip, COUNT(*) AS customers FROM dryrun.biz_customers GROUP BY zip ORDER BY customers DESC LIMIT 5
-- @id customers_q3_monthly_value_by_age
-- Monthly spend per customer by age band.
SELECT CASE WHEN age < 30 THEN '18-29' WHEN age < 50 THEN '30-49' WHEN age < 65 THEN '50-64' ELSE '65+' END AS age_band, COUNT(*) AS customers, ROUND(AVG(visits_per_month * avg_ticket), 2) AS avg_monthly_spend FROM dryrun.biz_customers GROUP BY 1 ORDER BY 1
-- ## Upworthy Research Archive (exploratory sample)
-- @id upworthy_q1_size
-- How many packages and distinct tests, over which dates?
SELECT COUNT(*) AS packages, COUNT(DISTINCT clickability_test_id) AS tests, MIN(created_at) AS first_created, MAX(created_at) AS last_created FROM dryrun.upworthy_tests
-- @id upworthy_q2_packages_per_test
-- How many packages does a test usually compare?
SELECT packages_in_test, COUNT(*) AS tests FROM (SELECT clickability_test_id, COUNT(*) AS packages_in_test FROM dryrun.upworthy_tests GROUP BY clickability_test_id) t GROUP BY packages_in_test ORDER BY packages_in_test LIMIT 12
-- @id upworthy_q3_ctr
-- Overall click-through rate, and the spread of package CTRs with 1000+ impressions.
SELECT COUNT(*) AS packages_1000plus, ROUND(SUM(clicks) * 1.0 / SUM(impressions), 4) AS pooled_ctr, ROUND(MIN(clicks * 1.0 / impressions), 4) AS min_ctr, ROUND(MAX(clicks * 1.0 / impressions), 4) AS max_ctr FROM dryrun.upworthy_tests WHERE impressions >= 1000
