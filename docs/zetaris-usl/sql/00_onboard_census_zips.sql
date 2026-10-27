-- Onboard one more Census file: the app's dryrun.census_acs holds only the geographies the running app last
-- fetched, so the USL reads a file built from every cached Census Reporter response (US + ZIPs 78704, 60622, 43201).
-- Run only when dryrun.census_acs_zips does not exist yet (Lightning has no IF NOT EXISTS for file-store tables).
-- @id onboard_census_acs_zips
CREATE LIGHTNING FILESTORE TABLE census_acs_zips FROM dryrun FORMAT csv OPTIONS (path "/home/zetaris/customer-data/shared/dryrun/data/cache/census_usl.csv", header "true", inferSchema "true")
