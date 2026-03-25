export type Product = 'AI Agents' | 'Copilot' | 'QA';

export type ContactStatus = 'needs_action' | 'in_contact' | 'deal_live';

export type AisForecast = 'Commit' | 'Best Case' | 'Most Likely' | 'Remaining Pipe';

export const PRODUCTS: Product[] = ['AI Agents', 'Copilot', 'QA'];

export const AIS_FORECAST_OPTIONS: AisForecast[] = ['Commit', 'Best Case', 'Most Likely', 'Remaining Pipe'];

export interface Account {
  id: number;
  crm_account_id: string | null;
  account_name: string;
  arr: number;
  num_agents: number;
  renewal_date: string; // "YYYY-MM-DD"
  account_owner: string;
  current_products: Product[];
  target_products: Product[];
  sfdc_link: string;
  ae_manager: string;
  contact_status: ContactStatus;
  contacted_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AccountFormData {
  account_name: string;
  arr: number;
  num_agents: number;
  renewal_date: string;
  account_owner: string;
  current_products: Product[];
  target_products: Product[];
  sfdc_link: string;
  ae_manager: string;
  notes: string;
}

export interface TableauFilters {
  product_group: string[];
  segments: string[];
  close_quarter: string[];
  commissionable: string[];
  ai_ae: string[];
  svp_leader: string[];
  svp_minus_1: string[];
  vp_team: string[];
}

export interface AppSettings {
  slack_webhook_url: string;
  notification_enabled: boolean;
  anthropic_api_key: string;
  tableau_pat_name: string;
  tableau_pat_secret: string;
  tableau_site: string;
  tableau_view_id: string;
  tableau_filters: TableauFilters;
}

export interface CsvImportResult {
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
}

export interface NotificationLogEntry {
  id: number;
  account_id: number;
  account_name: string;
  notification_type: string;
  sent_at: string;
  fiscal_year: string;
}

export interface ForecastOpp {
  id: number;
  crm_opportunity_id: string;
  sfdc_account_id: string;
  account_name: string;
  manager_name: string;
  ae_name: string;
  region: string;
  segment: string;
  product: string;
  type: string;
  stage_name: string;
  vp_deal_forecast: string;
  product_specialist_forecast: string;
  product_specialist_notes: string;
  ai_ae: string;
  close_date: string;
  s2_plus_date: string;
  product_arr_usd: number;
  // AIS editable fields
  ais_forecast: AisForecast | null;
  ais_arr: number | null;
  ais_close_date: string | null;
  // AIS manual-edit flags (1 = user explicitly set, 0 = system default)
  ais_arr_manual: number;
  ais_forecast_manual: number;
  ais_close_date_manual: number;
  // AIS top deal flag (1 = starred by AIS as a top focus deal)
  ais_top_deal: number;
  // Change-tracking fields
  push_count: number;
  total_days_pushed: number;
  stage_entered_at: string | null;
  // Exclude from analysis flag (for data corrections)
  exclude_from_analysis: number;
  created_at: string;
  updated_at: string;
}

export interface Quota {
  ai_ae: string;
  region: string;
  quota: number;      // annual
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
}

export interface ClosedWonOpp {
  id: number;
  crm_opportunity_id: string;
  account_name: string;
  manager_name: string;
  ae_name: string;
  region: string;
  segment: string;
  product: string;
  type: string;
  ai_ae: string;
  close_date: string;
  bookings: number;
  edited_bookings: number | null;
  created_at: string;
  updated_at: string;
}

export interface ForecastImportResult {
  inserted: number;
  updated: number;
  failed: number;
  synced_renewals: number;
  changes_detected: number;
  errors: string[];
}

export type ChangeType =
  | 'arr_up' | 'arr_down'
  | 'date_pushed' | 'date_pulled'
  | 'stage_progressed' | 'stage_regressed'
  | 'vp_forecast_changed'
  | 'ais_forecast_changed'
  | 'opp_added' | 'opp_dropped';

export type AlertReason =
  | 'pushed_out_of_quarter'
  | 'multi_push'
  | 'stage_regression'
  | 'large_new_opp';

export interface ForecastChange {
  id: number;
  imported_at: string;
  crm_opportunity_id: string;
  product: string;
  account_name: string;
  ae_name: string;
  ai_ae: string;
  manager_name: string;
  change_type: ChangeType;
  old_value: string | null;
  new_value: string | null;
  delta_numeric: number | null;
  is_alert: number;       // 0 | 1
  alert_reason: AlertReason | null;
  created_at: string;
}

export interface OppPushStats {
  crm_opportunity_id: string;
  product: string;
  account_name: string;
  ae_name: string;
  ai_ae: string;
  manager_name: string;
  push_count: number;
  total_days_pushed: number;
  current_arr: number;
}

export interface ForecastDifference {
  crm_opportunity_id: string;
  account_name: string;
  product: string;
  ai_ae: string;
  manager_name: string;
  region: string;
  segment: string;
  diff_type: 'category' | 'arr' | 'date';
  vp_value: string;
  ais_value: string;
  opp_arr: number;
  ais_arr: number;
  close_date: string;
  arr_delta?: number;
  days_delta?: number;
}

export interface AnalyticsData {
  changes: ForecastChange[];
  lastImportAt: string | null;
  multiPushOpps: OppPushStats[];
  totalPipelineNow: number;
  totalPipelinePrev: number;
  forecastDifferences: ForecastDifference[];
}

export interface ImportHistoryEntry {
  id: number;
  imported_at: string;
  source_type: string;
  backup_filename: string;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  total_pipeline: number;
  created_at: string;
}
