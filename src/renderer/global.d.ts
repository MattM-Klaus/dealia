import type { Account, AccountFormData, AisForecast, AnalyticsData, AppSettings, ClosedWonOpp, CsvImportResult, ForecastImportResult, ForecastOpp, NotificationLogEntry, Quota } from '../shared/types';

declare global {
  interface Window {
    api: {
      getAccounts(): Promise<Account[]>;
      addAccount(data: AccountFormData): Promise<{ id: number }>;
      updateAccount(id: number, data: AccountFormData): Promise<{ ok: boolean }>;
      deleteAccount(id: number): Promise<{ ok: boolean }>;
      setAccountStatus(id: number, status: string): Promise<{ ok: boolean }>;

      getSettings(): Promise<AppSettings>;
      saveSettings(settings: Partial<AppSettings>): Promise<{ ok: boolean }>;
      testSlackWebhook(): Promise<{ ok: boolean; error?: string }>;
      testMacNotification(): Promise<{ ok: boolean }>;
      runRenewalCheck(): Promise<{ sent: number }>;
      getNotificationLog(): Promise<NotificationLogEntry[]>;

      importCsv(filePath: string): Promise<CsvImportResult>;
      openFileDialog(): Promise<string | null>;
      openExternal(url: string): Promise<void>;

      // Forecast
      getForecastOpps(): Promise<ForecastOpp[]>;
      getClosedWonOpps(): Promise<ClosedWonOpp[]>;
      getPipelineSnapshots(): Promise<Array<{ date: string; data: ForecastOpp[] }>>;
      importForecastPipeline(filePath: string): Promise<ForecastImportResult>;
      importForecastClosedWon(filePath: string): Promise<ForecastImportResult>;
      getAnalyticsData(): Promise<AnalyticsData>;
      getQuotas(): Promise<Quota[]>;
      upsertQuota(ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }): Promise<{ ok: boolean }>;
      deleteQuota(ai_ae: string): Promise<{ ok: boolean }>;
      setTopDeal(id: number, value: number): Promise<{ ok: boolean }>;

      updateForecastAisField(
        id: number,
        field: 'ais_forecast' | 'ais_arr' | 'ais_close_date',
        value: AisForecast | number | string | null,
      ): Promise<{ ok: boolean }>;

      dealiaChat(
        messages: { role: 'user' | 'assistant'; content: string }[],
        context: string,
      ): Promise<{ ok: boolean; reply?: string; error?: string }>;
    };
  }
}

export {};
