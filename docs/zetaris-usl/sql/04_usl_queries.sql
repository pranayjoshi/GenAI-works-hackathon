-- Queries against the active USL. They name business entities (platform_reach, customer), not files.
-- @id usl_q1_instagram_reach_78704
-- How many Instagram users can the cafe reach in ZIP 78704, by age band? (the app's audience-size question)
SELECT age_band, adults, pct_ever_use, reachable_users FROM lightning.metastore.ripple.audience.platform_reach WHERE geo_id = '86000US78704' AND platform = 'instagram' ORDER BY age_band
-- @id usl_q2_customers_vs_reach
-- Do the cafe's customers look like the people it can reach on Instagram in 78704? (customer share vs reach share by age band)
WITH c AS (SELECT age_band, COUNT(*) AS customers FROM lightning.metastore.ripple.audience.customer GROUP BY age_band),
r AS (SELECT age_band, reachable_users FROM lightning.metastore.ripple.audience.platform_reach WHERE geo_id = '86000US78704' AND platform = 'instagram')
SELECT r.age_band, c.customers, ROUND(c.customers * 1.0 / SUM(c.customers) OVER (), 3) AS customer_share, r.reachable_users, ROUND(r.reachable_users * 1.0 / SUM(r.reachable_users) OVER (), 3) AS reach_share
FROM r LEFT JOIN c ON c.age_band = r.age_band ORDER BY r.age_band
-- @id usl_q3_platforms_by_geo
-- Across the loaded geographies, how many adults could each platform reach?
SELECT geo_name, platform, SUM(adults) AS adults_18plus, SUM(reachable_users) AS reachable_users, ROUND(SUM(reachable_users) * 1.0 / SUM(adults), 3) AS reach_rate
FROM lightning.metastore.ripple.audience.platform_reach GROUP BY geo_name, platform ORDER BY geo_name, reachable_users DESC
-- @id usl_q4_population_consistency
-- Does population_by_age add up to the Census total for each geography? (USL vs raw source)
SELECT u.geo_id, u.people_in_usl, t.estimate AS census_total, u.people_in_usl - t.estimate AS difference
FROM (SELECT geo_id, SUM(people) AS people_in_usl FROM lightning.metastore.ripple.audience.population_by_age GROUP BY geo_id) u
JOIN dryrun.census_acs_zips t ON t.geo_id = u.geo_id AND t.column_id = 'B01001001' ORDER BY u.geo_id
