export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Shape of the `error` object Meta's Graph API embeds in error responses. */
export interface GraphApiErrorPayload {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export interface GraphApiCursors {
  before?: string;
  after?: string;
}

export interface GraphApiPaging {
  cursors?: GraphApiCursors;
  next?: string;
  previous?: string;
}

export interface GraphApiListResponse<T> {
  data: T[];
  paging?: GraphApiPaging;
}

/** Generic pagination envelope returned by our list_* tools. */
export interface PagedResult<T> {
  count: number;
  items: T[];
  has_more: boolean;
  next_cursor?: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  buying_type?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
}

export interface AdSet {
  id: string;
  name: string;
  status: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: string;
  targeting?: Record<string, unknown>;
  start_time?: string;
  end_time?: string;
}

export interface Ad {
  id: string;
  name: string;
  status: string;
  adset_id?: string;
  campaign_id?: string;
  creative?: { id: string };
  created_time?: string;
  updated_time?: string;
}

export interface AdCreative {
  id: string;
  name?: string;
  object_story_spec?: Record<string, unknown>;
  thumbnail_url?: string;
  status?: string;
}

export interface AdAccount {
  id: string;
  account_id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  amount_spent?: string;
  spend_cap?: string;
  balance?: string;
}

export interface Page {
  id: string;
  name: string;
  category?: string;
}

export interface AudienceRef {
  id: string;
  name: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  operation_status?: { code: number; description: string };
  delivery_status?: { code: number; description: string };
}

export interface InsightRow {
  date_start?: string;
  date_stop?: string;
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
  [key: string]: unknown;
}
