import type {
  Account,
  AccountFormData,
  AisForecast,
  AnalyticsData,
  AppSettings,
  ClosedWonOpp,
  CsvImportResult,
  ForecastImportResult,
  ForecastOpp,
  ImportHistoryEntry,
  NotificationLogEntry,
  Quota,
} from '../shared/types';

declare global {
  interface Window {
    api: {
      // Account methods
      getAccounts(): Promise<Account[]>;
      addAccount(data: AccountFormData): Promise<{ id: number }>;
      updateAccount(id: number, data: AccountFormData): Promise<{ ok: boolean }>;
      deleteAccount(id: number): Promise<{ ok: boolean }>;
      setAccountStatus(id: number, status: string): Promise<{ ok: boolean }>;

      // Settings methods
      getSettings(): Promise<AppSettings>;
      saveSettings(settings: Partial<AppSettings>): Promise<{ ok: boolean }>;
      testSlackWebhook(): Promise<{ ok: boolean; error?: string }>;
      testMacNotification(): Promise<{ ok: boolean }>;
      runRenewalCheck(): Promise<{ sent: number }>;
      getNotificationLog(): Promise<NotificationLogEntry[]>;

      // File & CSV import methods
      importCsv(filePath: string): Promise<CsvImportResult>;
      openFileDialog(): Promise<string | null>;
      openExternal(url: string): Promise<void>;

      // Forecast methods
      getForecastOpps(): Promise<ForecastOpp[]>;
      getClosedWonOpps(): Promise<ClosedWonOpp[]>;
      getClosedLostOpps(): Promise<ClosedWonOpp[]>;
      getPipelineSnapshots(): Promise<Array<{ date: string; importedAt: string; data: ForecastOpp[] }>>;

      importForecastPipeline(filePath: string): Promise<ForecastImportResult>;
      importForecastClosedWon(filePath: string): Promise<ForecastImportResult>;
      importHistoricalCsv(filePath: string, customDate: string): Promise<ForecastImportResult>;
      importHistoricalClosedWonCsv(filePath: string, customDate: string): Promise<ForecastImportResult>;
      syncFromTableau(): Promise<{ success: boolean; error?: string; inserted?: number; updated?: number; failed?: number; synced_renewals?: number; changes_detected?: number; errors?: string[] }>;
      syncFromSnowflake(): Promise<{ success: boolean; error?: string; inserted?: number; updated?: number; failed?: number; synced_renewals?: number; changes_detected?: number; errors?: string[] }>;

      // Analytics methods
      getAnalyticsData(): Promise<AnalyticsData>;
      getHistoricalState(asOfDate: string): Promise<ForecastOpp[] | null>;
      getSnapshotsBetweenDates(fromDate: string, toDate: string): Promise<{ start: ForecastOpp[] | null; end: ForecastOpp[] | null }>;
      getAllSnapshots(): Promise<Array<{ imported_at: string; total_pipeline: number; opp_count: number; total_bookings?: number; deal_count?: number; has_pipeline: boolean; has_closed_won: boolean }>>;
      deleteSnapshot(importedAt: string): Promise<{ ok: boolean }>;
      snapshotCurrentState(): Promise<{ pipelineCount: number; cwCount: number }>;

      // Quota methods
      getQuotas(): Promise<Quota[]>;
      upsertQuota(ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }): Promise<{ ok: boolean }>;
      deleteQuota(ai_ae: string): Promise<{ ok: boolean }>;

      // Forecast editing methods
      setTopDeal(id: number, value: number): Promise<{ ok: boolean }>;
      deleteForecastOpp(id: number): Promise<{ ok: boolean }>;
      updateForecastAisField(
        id: number,
        field: 'ais_forecast' | 'ais_arr' | 'ais_close_date',
        value: AisForecast | number | string | null,
      ): Promise<{ ok: boolean }>;
      updateClosedWonBookings(id: number, editedBookings: number | null): Promise<{ ok: boolean }>;
      toggleExcludeFromAnalysis(oppId: string, exclude: boolean): Promise<{ ok: boolean }>;
      getExcludedDealIds(): Promise<string[]>;
      resetAisArrToTableau(): Promise<{ ok: boolean; updated: number }>;

      // Dealia Chat
      dealiaChat(
        messages: { role: 'user' | 'assistant'; content: string }[],
        context: string,
      ): Promise<{ ok: boolean; reply?: string; error?: string }>;

      // Import History
      getImportHistory(): Promise<ImportHistoryEntry[]>;
      openBackupCsv(filename: string): Promise<void>;

      // PDF Export
      exportPdf(defaultFilename: string, fullHeight: number): Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;

      // Commission Reconciliation
      importXactlyCommissions(filePath: string, period: string): Promise<{ inserted: number; updated: number }>;
      importTableauCommissions(filePath: string, period: string): Promise<{ inserted: number; updated: number }>;
      getCommissionReconciliation(period: string): Promise<any>;
      getCommissionPeriods(): Promise<string[]>;
      clearCommissionData(period: string): Promise<{ ok: boolean }>;
      setInvestigationStatus(opportunityNumber: string, period: string, status: string | null): Promise<{ ok: boolean }>;

      // Deal Backed Reason Tracking
      getDealBackedReasons(importedAt: string): Promise<Record<string, string | null>>;
      setDealBackedReason(crmOpportunityId: string, importedAt: string, reason: string | null): Promise<{ ok: boolean }>;

      // Weekly Notes
      getWeeklyNotes(weekStart: string, region: string): Promise<string | null>;
      setWeeklyNotes(weekStart: string, region: string, notes: string | null): Promise<{ ok: boolean }>;
    };
  }
}

export {};
