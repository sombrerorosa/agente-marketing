export interface RawInsightRow {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
}

export interface InsightsRow {
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  reach: number | null;
  frequency: number | null;
  purchase_roas: number | null;
  purchases: number | null;
  leads: number | null;
  link_clicks: number | null;
  actions_json: string | null;
}

export interface GraphApiErrorPayload {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export interface GraphApiListResponse<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export interface BigQueryEnv {
  GCP_PROJECT_ID: string;
  GCP_CLIENT_EMAIL: string;
  GCP_PRIVATE_KEY: string;
}
