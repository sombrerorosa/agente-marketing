-- Run once in the BigQuery console (or `bq query --use_legacy_sql=false`)
-- after creating the `meta_ads` dataset. Replace PROJECT_ID with your GCP
-- project id.
--
-- Ad-level granularity (one row per ad per day) is the finest Meta reports
-- at. Campaign/adset totals are rollups (GROUP BY / SUM in Looker Studio or
-- a view) instead of separate stored rows, so spend is never double-counted
-- across levels.
CREATE TABLE IF NOT EXISTS `PROJECT_ID.meta_ads.insights_daily` (
  date DATE NOT NULL,
  campaign_id STRING,
  campaign_name STRING,
  adset_id STRING,
  adset_name STRING,
  ad_id STRING,
  ad_name STRING,
  spend FLOAT64,
  impressions INT64,
  clicks INT64,
  ctr FLOAT64,
  cpc FLOAT64,
  cpm FLOAT64,
  reach INT64,
  frequency FLOAT64,
  purchase_roas FLOAT64,
  purchases INT64,
  leads INT64,
  link_clicks INT64,
  actions_json STRING,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
CLUSTER BY campaign_id, adset_id;
