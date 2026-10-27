-- Data quality rules on the USL, registered and run with Zetaris's own DQ statements.
-- REMOVE first so a re-run does not hit "already registered" (on the first run REMOVE reports not found).
-- @id dq_remove_reach
REMOVE DQ reach_pct_in_range TABLE lightning.metastore.ripple.audience.platform_reach
-- @id dq_register_reach
-- Rule 1: a reach row must have a percentage in [0, 100] and no more reachable users than adults.
REGISTER DQ reach_pct_in_range TABLE lightning.metastore.ripple.audience.platform_reach AS pct_ever_use >= 0 AND pct_ever_use <= 100 AND reachable_users <= adults
-- @id dq_remove_customer
REMOVE DQ customer_is_adult_with_ticket TABLE lightning.metastore.ripple.audience.customer
-- @id dq_register_customer
-- Rule 2: every customer is an adult with a positive average ticket.
REGISTER DQ customer_is_adult_with_ticket TABLE lightning.metastore.ripple.audience.customer AS age >= 18 AND avg_ticket > 0
-- @id dq_remove_headline
REMOVE DQ headline_clicks_within_impressions TABLE lightning.metastore.ripple.audience.headline_package
-- @id dq_register_headline
-- Rule 3: clicks never exceed impressions, and a package was shown at least once.
REGISTER DQ headline_clicks_within_impressions TABLE lightning.metastore.ripple.audience.headline_package AS clicks <= impressions AND impressions > 0
-- @id dq_remove_backtest
REMOVE DQ backtest_min_impressions TABLE lightning.metastore.ripple.audience.headline_package
-- @id dq_register_backtest
-- Rule 4: a package needs 1000+ impressions to enter the backtest (FILTERS.min_impressions in src/backtest/select.ts). Expected to flag rows.
REGISTER DQ backtest_min_impressions TABLE lightning.metastore.ripple.audience.headline_package AS impressions >= 1000
-- @id dq_list
-- Every rule on the USL: registered DQ expressions plus the DDL's primary keys and CHECK constraints.
LIST DQ USL lightning.metastore.ripple.audience
-- @id dq_run_reach
RUN DQ reach_pct_in_range TABLE lightning.metastore.ripple.audience.platform_reach
-- @id dq_run_customer
RUN DQ customer_is_adult_with_ticket TABLE lightning.metastore.ripple.audience.customer
-- @id dq_run_headline
RUN DQ headline_clicks_within_impressions TABLE lightning.metastore.ripple.audience.headline_package
-- @id dq_run_backtest
RUN DQ backtest_min_impressions TABLE lightning.metastore.ripple.audience.headline_package
-- @id dq_invalid_rows_backtest
-- The rows rule 4 flags (first 50 kept in the receipt).
SHOW DQ INVALID RECORD backtest_min_impressions TABLE lightning.metastore.ripple.audience.headline_package
-- @id dq_run_check_constraint
-- The DDL's CHECK constraint, run as a rule by its name. (It compiles, but LIST DQ does not show it; this records what RUN DQ does.)
RUN DQ pct_at_most_100 TABLE lightning.metastore.ripple.audience.platform_reach
-- @id dq_run_primary_key
-- The DDL's primary key (customer_id), run as a uniqueness rule by its column name.
RUN DQ customer_id TABLE lightning.metastore.ripple.audience.customer
-- @id dq_check_constraints_as_select
-- Workaround today: the two CHECK constraints written as one plain SELECT over the USL (this form also runs over the REST API).
SELECT 'pct_not_negative' AS rule, COUNT(*) AS total_record, SUM(CASE WHEN pct_ever_use >= 0 THEN 1 ELSE 0 END) AS valid_record, SUM(CASE WHEN pct_ever_use >= 0 THEN 0 ELSE 1 END) AS invalid_record FROM lightning.metastore.ripple.audience.platform_reach
UNION ALL
SELECT 'pct_at_most_100' AS rule, COUNT(*) AS total_record, SUM(CASE WHEN pct_ever_use <= 100 THEN 1 ELSE 0 END) AS valid_record, SUM(CASE WHEN pct_ever_use <= 100 THEN 0 ELSE 1 END) AS invalid_record FROM lightning.metastore.ripple.audience.platform_reach
