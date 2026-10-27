# Ripple on Zetaris: the Unified Semantic Layer

This page answers the "Build with Zetaris" criteria. Everything was run on the local hackathon bundle (Zetaris 2.4.3) on 27 Oct 2026. Every number below comes from a Zetaris result saved in [`docs/zetaris-usl/receipts.json`](zetaris-usl/receipts.json). Nothing in the results was typed by hand.

Reproduce (bundle running, `scripts/zetaris-register.sh` done once, Java 17+ installed):

```bash
scripts/zetaris-usl.sh            # bundle folder is found from the running container; or pass it as $1
npx tsx scripts/usl-handcoded-compare.ts
```

It takes about 4 minutes, most of it JVM start-up and the Upworthy scans. Each run sends 57 statements: 54 over JDBC (`jdbc:zetaris:lightning@localhost:10000`) and 3 over the REST API. One onboarding statement runs only the first time. The receipts hold 58 statements: 54 succeeded, and 4 failed with real errors, all explained below. JDBC is used because the REST API only accepts SELECT, and the USL and data-quality statements are not SELECT. The JDBC runner is [`scripts/zetaris-usl/LightningRunner.java`](../scripts/zetaris-usl/LightningRunner.java), about 90 lines, using the bundle's own driver jar.

| Files | What |
|---|---|
| `docs/zetaris-usl/sql/00_onboard_census_zips.sql` | onboarding of one extra Census file |
| `docs/zetaris-usl/sql/00_sources.sql`, `01_explore.sql` | source checks and 15 exploratory queries |
| `docs/zetaris-usl/sql/02_usl_ddl.sql` | **the USL DDL** |
| `docs/zetaris-usl/sql/03_activate.sql` | binds each USL table to a query over the sources |
| `docs/zetaris-usl/sql/04_usl_queries.sql` | 4 queries against the USL |
| `docs/zetaris-usl/sql/05_data_quality.sql` | data-quality rules: register, list, run, show failing rows |
| `docs/zetaris-usl/receipts/*.jsonl`, `receipts.json` | every statement, the rows Zetaris returned (up to 50), row count, time in ms, real errors |
| `docs/zetaris-usl/usl_audience_compiled.json` | the catalog's record of the compiled USL, as `COMPILE USL` returned it |
| `scripts/usl-handcoded-compare.ts`, `docs/zetaris-usl/handcoded-compare.json` | the hand-coded version (2a) and its comparison |
| `docs/zetaris-usl/mock/` | the proposed feature (2c), marked MOCK |

## 1a. Use case and data sources

**Use case.** A small business (the demo is a café in Austin, ZIP 78704) wants to know whether a new ad is worth paying to test. Ripple builds a crowd of local people from public data, runs the ad in a simulated feed, and decides whether a real A/B test is worth the money. To do that it needs answers to plain questions:

- How many adults live in the ZIP, by age and sex?
- How many of them use Instagram (or another platform)?
- How price-sensitive or sceptical is each group, and which of those numbers are assumptions?
- Who are the business's current customers, and do they look like the people it can reach?
- Does the simulator pick the right headline on real past tests?

No single source answers these. They need five.

| Source | Zetaris table | Rows | Origin | Licence / status (as in the README) |
|---|---|---|---|---|
| US Census ACS (B01001 sex by age, B19037 income, B15003 education) | `dryrun.census_acs` (the app's live table) and `dryrun.census_acs_zips` (US + ZIPs 78704, 60622, 43201) | 572 in `census_acs_zips` | Census Reporter API, ACS 2024 5-year (ZIPs) and 1-year (US) | public US Census data |
| Pew Research Center Social Media Fact Sheet | `dryrun.pew_platform_use` | 36 | `data/sources/pew_platform_use.csv`, each row has its `source_url` | cited fact sheet figures |
| Behaviour priors | `dryrun.priors_behaviour` | 28 | `data/sources/priors_behaviour.csv` | labelled assumptions: each row says MODELED PRIOR or ASSUMED |
| Business customers | `dryrun.biz_customers` | 640 | `data/sources/biz_customers_cafe.csv` | synthetic demo data |
| Upworthy Research Archive | `dryrun.upworthy_tests` | 22,666 | `data/raw/upworthy-exploratory.csv` | CC BY 4.0 |

All five are Lightning file-store tables over CSV files. They were registered by `scripts/zetaris-register.sh`. `census_acs_zips` is new. The app's `census_acs` holds only the geographies the running app last fetched (today the US fallback and 78704). So the USL reads a file built from every cached Census response (`data/cache/census_usl.csv`, built by the script). Same columns, same source.

## 1b. Onboarding and exploratory queries

**Onboarding.** One statement onboarded the extra Census file (7.7 s):

```sql
CREATE LIGHTNING FILESTORE TABLE census_acs_zips FROM dryrun FORMAT csv
OPTIONS (path "/home/zetaris/customer-data/shared/dryrun/data/cache/census_usl.csv", header "true", inferSchema "true")
```

**Operable.** `00_sources.sql` counts the rows of every table on Zetaris. All 6 answered: 286 in `census_acs` at the time of the last run (it changes with the app), 572 in `census_acs_zips`, 36, 28, 640 and 22,666.

**Exploratory queries.** Three per source, 15 in all, all answered by Zetaris. Excerpts (full rows in the receipts):

| Source | Question | Zetaris answer |
|---|---|---|
| Census | Which geographies are loaded? | 4: United States (ACS 2024 1-year), 43201, 60622, 78704 (ACS 2024 5-year), 143 cells each |
| Census | Total population per geography | US 340,110,980; 60622 54,609; 78704 50,688 (MOE 2,711); 43201 34,322 |
| Census | Share of adults 25+ in 78704 with a bachelor's or higher | 0.705 |
| Pew | What does the extract cover? | 6 platforms (Facebook, Instagram, Reddit, TikTok, X, YouTube), 4 age bands and 2 gender bands each |
| Pew | Instagram use by age | 18-29: 79%, 30-49: 64%, 50-64: 41%, 65+: 21% |
| Pew | Which platform reaches the most 18-29s? | YouTube 95%, Instagram 79%, Facebook 69%, TikTok 65%, Reddit 40%, X 31% |
| Priors | MODELED PRIOR vs ASSUMED | 19 modeled, 9 assumed |
| Priors | Which parameters and distributions? | 7 parameters: beta (price sensitivity, scepticism, speak probability, susceptibility), lognormal (daily minutes, influence), rate (customer share) |
| Priors | Mean price sensitivity by income | from 0.75 (under $25k) down to 0.25 ($150k+) |
| Customers | Profile | 640 customers, average age 34.4, 5.63 visits a month, $5.36 ticket |
| Customers | Top ZIPs | 78704: 406, 78703: 54, 78745: 49, 78701: 45, 78741: 43 |
| Customers | Monthly spend by age band | 18-29: $33.71, 30-49: $29.60, 50-64: $27.29, 65+: $24.79 |
| Upworthy | Size | 22,666 packages in 4,873 tests, Jan 2013 to Apr 2015 |
| Upworthy | Packages per test | most tests compare 4 (2,516 tests), then 5 (928) and 6 (865) |
| Upworthy | CTR of packages with 1000+ impressions | 22,625 packages, pooled CTR 0.0152, range 0 to 0.1361 |

Times in the last run: 0.3 to 2.4 s for the small sources, 2.4 to 5 s for the Upworthy scans (a 14 MB multi-line CSV read in place on 2 cores). Earlier runs were slower before Spark had warmed up: up to 24 s.

## 1c. The USL

### What Zetaris 2.4.3 offers

The bundle has no docs for this, so we read the parser in the driver jar. It contains a "Lightning Catalog" grammar with `COMPILE USL`, `ACTIVATE USL TABLE`, `REGISTER DQ`, `RUN DQ`, `LIST DQ USL` and `SHOW DQ INVALID RECORD`. These run over JDBC. A USL lives in a namespace under `lightning.metastore`.

- `COMPILE USL ... DDL` takes ordinary `CREATE TABLE` statements: types, `NOT NULL`, `PRIMARY KEY`, named `CHECK` constraints. It stores the result in the catalog.
- `ACTIVATE USL TABLE <t> AS <SELECT>` binds a declared table to a query over the sources. Zetaris checks the query's schema against the declaration. This includes nullability.
- After activation, the USL tables can be queried like any table, over JDBC and over the REST API.

### The DDL

USL `audience` in namespace `lightning.metastore.ripple`. Five business entities. The full file is [`02_usl_ddl.sql`](zetaris-usl/sql/02_usl_ddl.sql). Here is part of it:

```sql
CREATE NAMESPACE IF NOT EXISTS lightning.metastore;
CREATE NAMESPACE IF NOT EXISTS lightning.metastore.ripple;
COMPILE USL IF NOT EXISTS audience DEPLOY NAMESPACE lightning.metastore.ripple DDL
CREATE TABLE IF NOT EXISTS population_by_age (geo_id STRING NOT NULL, geo_name STRING, release STRING,
  sex STRING NOT NULL, age_lo INT NOT NULL, age_band STRING NOT NULL, people BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS platform_reach (geo_id STRING NOT NULL, geo_name STRING, platform STRING NOT NULL,
  age_band STRING NOT NULL, adults BIGINT NOT NULL, pct_ever_use DOUBLE NOT NULL, reachable_users BIGINT NOT NULL,
  CONSTRAINT pct_not_negative CHECK (pct_ever_use >= 0),
  CONSTRAINT pct_at_most_100 CHECK (pct_ever_use <= 100));
CREATE TABLE IF NOT EXISTS behaviour_prior (param STRING NOT NULL, dimension STRING NOT NULL, band STRING NOT NULL,
  dist STRING, a DOUBLE, b DOUBLE, prior_mean DOUBLE, label STRING NOT NULL);
CREATE TABLE IF NOT EXISTS customer (customer_id STRING NOT NULL PRIMARY KEY, age INT NOT NULL, age_band STRING NOT NULL,
  zip STRING NOT NULL, visits_per_month INT, avg_ticket DOUBLE, monthly_spend DOUBLE, tenure_months INT, label STRING);
CREATE TABLE IF NOT EXISTS headline_package (test_id STRING NOT NULL, headline STRING,
  impressions BIGINT NOT NULL, clicks BIGINT NOT NULL, ctr DOUBLE)
```

| USL table | Built from | Meaning |
|---|---|---|
| `population_by_age` | Census B01001 | people per geography, sex and age cell, with a Pew-compatible age band |
| `platform_reach` | Census x Pew join | adults per age band x Pew ever-use rate = reachable users, per geography and platform. This is the app's audience-size join (`src/audience/sampler.ts`), extended to every platform |
| `behaviour_prior` | priors | each prior with its mean (Beta: a / (a + b)) and its MODELED PRIOR / ASSUMED label |
| `customer` | customers | the customer list with age band and monthly spend |
| `headline_package` | Upworthy | packages with CTR, for the backtest |

All 5 activations succeeded (0.1 to 0.5 s each). `SHOW NAMESPACES OR TABLES IN lightning.metastore.ripple.audience` then lists all five tables with `activated = true`.

**The schema contract works.** `03_activate.sql` also compiles a tiny second USL (`contract_demo`) that declares `adults BIGINT NOT NULL`. It then tries to activate it with a query whose `adults` column is nullable. Zetaris refuses, as expected. The receipt (`activate_contract_demo_rejected`) has the real message: "Schema mismatch ... Column 'adults': nullable -> NOT NULL", followed by a suggested `COALESCE` fix. We hit the same check by accident while building the USL, and it made us add `COALESCE` where a column is declared `NOT NULL`.

### Queries showing the USL is active

They name business entities, not files or CSV columns.

1. **Reachable Instagram users in 78704 by age band** (`usl_q1`, 2.8 s): 18-29: 10,501 of 13,292 adults; 30-49: 12,707 of 19,854; 50-64: 2,960 of 7,219; 65+: 838 of 3,992. The same query through the REST API with the app's own client (`usl_q1_via_rest_api`) returns the same four rows.
2. **Customers vs reachable audience** (`usl_q2`, USL-to-USL join, 4.5 s). Customer share vs reach share: 18-29 0.345 vs 0.389, 30-49 0.573 vs 0.471, 50-64 0.061 vs 0.110, 65+ 0.020 vs 0.031. The café's customers lean 30-49 compared with who it can reach.
3. **Reach by platform across geographies** (`usl_q3`, 1.5 s): 24 rows. Example: in 78704, YouTube reaches 0.889 of adults, Facebook 0.725, Instagram 0.609.
4. **USL vs raw source** (`usl_q4`): the sum of `population_by_age` matches the Census total exactly for the 3 ZIPs. For the US it is 10 people higher (340,110,990 vs 340,110,980). The age cells of the national 1-year estimate do not add up exactly to its published total. We report this; we did not "fix" it.

### Data-quality rules

Registered with Zetaris's own DQ statements (`REGISTER DQ <name> TABLE <usl table> AS <expression>`) and run with `RUN DQ`:

| Rule | Table | Expression | Total | Valid | Invalid |
|---|---|---|---|---|---|
| `reach_pct_in_range` | platform_reach | `pct_ever_use >= 0 AND pct_ever_use <= 100 AND reachable_users <= adults` | 96 | 96 | 0 |
| `customer_is_adult_with_ticket` | customer | `age >= 18 AND avg_ticket > 0` | 640 | 640 | 0 |
| `headline_clicks_within_impressions` | headline_package | `clicks <= impressions AND impressions > 0` | 22,666 | 22,666 | 0 |
| `backtest_min_impressions` | headline_package | `impressions >= 1000` (the backtest's `FILTERS.min_impressions`) | 22,666 | 22,625 | **41** |
| `customer_id` (from the DDL's PRIMARY KEY) | customer | uniqueness | 640 | 640 | 0 |

`LIST DQ USL lightning.metastore.ripple.audience` lists the four custom rules and the primary key. `SHOW DQ INVALID RECORD backtest_min_impressions TABLE ...` returns the 41 failing packages; the first 50 rows are kept in the receipt. These are the packages the backtest drops. So the rule finds real rows, not only zero counts.

Two things did not work, and the receipts keep the real errors:

- The DDL's `CHECK` constraints compile and are stored (see `"checks"` in `usl_audience_compiled.json`). But `LIST DQ` does not show them, and `RUN DQ pct_at_most_100` fails with `DataQualityNotFoundException`. The workaround is to write them as a SELECT (`dq_check_constraints_as_select`: 96 of 96 valid for both).
- The REST API rejects `LIST DQ` and `RUN DQ` with `HTTP 400 ... Bad Select SQL`. An app that only has the REST API, like Ripple's runtime, cannot see or run the rules.

## 2a. Did the USL save time here?

**Honest answer: not on this project's first pass.** Most of the time went into finding the syntax, because the bundle ships no USL docs. We read rule names out of the parser class and probed: namespaces first, then `COMPILE`, `ACTIVATE` and `DQ`. That took about 30 minutes. With docs it would have taken 5. Writing the DDL, activations, queries and rules took about 20 minutes.

**Bonus: hand-coded comparison.** `scripts/usl-handcoded-compare.ts` produces the same `platform_reach` and `customer` answers and the same two DQ checks in plain TypeScript over the CSVs: parse CSV with quotes, type the cells, band the ages, join Census to Pew, aggregate, check. Then it compares its output with the Zetaris receipts. Result (`docs/zetaris-usl/handcoded-compare.json`): `usl_q1` and `usl_q2` match row for row, and both DQ checks give 0 invalid of 96 and 640, the same as Zetaris.

| | USL on Zetaris | Hand-coded TypeScript |
|---|---|---|
| Lines for the same scope (platform_reach + customer, 2 queries, 2 rules) | 51 lines of SQL (22 DDL, 20 activation, 5 queries, 4 DQ) | 50 lines of logic (70 with the compare step) |
| Run time | 1.5 to 4.5 s per USL query on the 2-core laptop bundle | about 20 ms in-process |
| Type and nullability contract | declared once, checked by the engine on activation | hand-written `num()` checks, only where we remembered |
| Rules | named, stored, listed, runnable by any JDBC client, failing rows on request | code in one script; a second app would copy them |
| Who can use it | any SQL client, BI tool or the app's REST client (for SELECT) | only this script |
| New source or moved file | re-activate one table; queries stay the same | edit the parser and join code |

So the USL did not save lines or run time at this size. Where it saved time was in what it gave us for free: the schema check (it caught our nullable columns), rules you can find by name, and one join that both the REST client and JDBC tools can read without copying code. The honest estimate for this project is that it breaks even on the second consumer of the same entities. That would be the report agent or a BI view.

## 2b. Would the USL help in our work?

**Where it would help.** Ripple's audience builder sends 7 SQL queries per run, and the Census x Pew join is written twice in the code (`src/audience/sampler.ts`, `src/api.ts`). A third copy, in `src/report/tools.ts`, does a similar Census banding. The bug fixed in commit `e47d5af` (`'\d'` read as `'d'` in a Spark SQL string, so every age fell into 65+) was fixed in `sampler.ts` and `tools.ts`, and a finished run had to be recomputed. While writing this page we found that the copy in `src/api.ts` (the `/api/audience` preview) still uses `'(\\d+)'`, so on Zetaris that preview most likely still puts every age in 65+. That is the cost of copies. With `platform_reach` in the USL, the banding and the join live in one place, and the `reach_pct_in_range` and `population_consistency` checks run against it. That bug would have shown as a quality failure: all adults in one band, and reach shares far from the Census age shape.

**Where it would not help.** The per-run simulation tables (`sim.*`) are created fresh for every run and queried at once by the report agent. They stay on in-process DuckDB. Compiling and activating a USL for each run adds JDBC round trips for no gain. The 600-person runs also need answers in milliseconds, and the 2-core bundle takes seconds per query.

**Not done yet.** The app still queries `dryrun.*` directly. Moving it onto the USL means changing two queries in `src/audience/sampler.ts` to read `lightning.metastore.ripple.audience.platform_reach` (it already works over REST, see `usl_q1_via_rest_api`) and keeping DuckDB as the fallback.

**Bonus: a project that would benefit, with a forecast.** A regional chain of 40 cafés wants a weekly "who can we reach" report per store: ZIP Census profile, platform reach, loyalty-card customers, and a promo price-sensitivity prior.

- Hand-coded: a pipeline per data source, plus joins and checks, and each analyst's notebook re-implements the banding. Our estimate is 3 to 4 days to build and about half a day a month keeping 3 to 4 copies of the logic in sync.
- With a USL: the same five entities as here. That is about 1 day to build, given working syntax and docs, and new stores are a new `geo_id`, not new code.
- Forecast: roughly 2 to 3 days saved up front and about 5 days a year after that. This is a rough estimate from this build, not a measurement. Most of the saving comes from one definition of "reachable users", not from fewer lines.

## 2c. How to make the USL stronger: one requirement

**Requirement: quality rules are part of the semantic layer, readable by every client, and able to block bad data.**

*Problem.* In 2.4.3 a USL can declare `CHECK` constraints, and they compile, but nothing runs them. Custom rules exist (`REGISTER DQ`), but only over JDBC. The REST API, which is how apps call Zetaris, rejects `LIST DQ` and `RUN DQ`. Results come back as a one-off statement result, not as data you can query. So an app cannot ask "is the layer I am about to read healthy?" It reads the rows either way.

*User.* An app or agent developer who reads the USL over REST and must not act on broken numbers. For us, "spend money on an A/B test" is decided from `platform_reach`.

*Must have:*

1. Every `CHECK`, `NOT NULL`, `PRIMARY KEY` and `REFERENCES` in the USL DDL becomes a named rule that `LIST DQ` shows and `RUN DQ` runs. No separate `REGISTER` step.
2. Each rule has a severity (`ERROR` / `WARN`) and a schedule: `RUN ON ACTIVATE`, `DAILY`, or on demand.
3. Results go to a queryable table, `<usl>.__quality`, with rule, table, severity, total, invalid, last_run_at and status. Any client that can SELECT can read it, the REST API included.
4. `ON ERROR REFUSE ACTIVATION`: an `ERROR` rule that fails stops the activation, the same way the schema check stops a nullable column today.
5. Optional query gate: `... REQUIRE QUALITY severity ERROR` makes a query fail when an `ERROR` rule on its tables is failing, instead of returning the rows.

*Acceptance.* With the USL in this repo: `SELECT * FROM lightning.metastore.ripple.audience.__quality` over REST returns 7 rows. `pct_at_most_100` appears without a `REGISTER`. Changing the Pew file so one percentage is 120 makes re-activation of `platform_reach` fail and names the rule.

*Why it matters.* The schema check is the most useful thing we found in the USL. It caught our mistake before any query ran. This requirement applies the same idea to values: the layer refuses to serve data that breaks its own definition.

**Bonus: a mock of the feature.** Both files are labelled MOCK:

- [`docs/zetaris-usl/mock/MOCK_usl_audience_v2.sql`](zetaris-usl/mock/MOCK_usl_audience_v2.sql): the proposed DDL. Constraints carry `SEVERITY` and `RUN ON`, there is a `REFERENCES` rule from `customer.age_band` to `platform_reach`, a `WITH QUALITY (...)` clause, a query on `__quality`, and a `REQUIRE QUALITY` gate.
- [`docs/zetaris-usl/mock/MOCK_quality_table.json`](zetaris-usl/mock/MOCK_quality_table.json), made by `node scripts/zetaris-usl/mock-quality-table.cjs`: what `__quality` would return for this USL. The counts are copied from the real Zetaris results (RUN DQ, and the CHECK-as-SELECT workaround). The table, its columns and the severity and status values are the proposal. It shows 7 rules: 6 pass, and `backtest_min_impressions` is `warn` with 41 rows.

## Notes and limits

- The probing left a scratch namespace, `lightning.metastore.probe`, on the local bundle, with USLs `probe_usl`, `p2` and `p4`. It is not used by anything.
- `CREATE NAMESPACE`, `COMPILE USL` (`IF NOT EXISTS`) and the DQ statements (`REMOVE` before `REGISTER`) are safe to re-run. Re-activation replaces the binding. The extra file-store table is created only if it is missing, because Lightning file-store tables have no `IF NOT EXISTS`.
- `SHOW DDL` in any form we tried is a parse error, so the DDL is kept as the `.sql` file plus the catalog's JSON record.
- Timings are from a laptop bundle with 2 GB and 2 cores. They are not a benchmark.
