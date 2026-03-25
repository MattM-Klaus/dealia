import { contextBridge, ipcRenderer } from 'electron';
import type { AccountFormData, AisForecast, AppSettings, AnalyticsData, Quota } from './shared/types';


contextBridge.exposeInMainWorld('api', {
  getAccounts: () => ipcRenderer.invoke('accounts:getAll'),
  addAccount: (data: AccountFormData) => ipcRenderer.invoke('accounts:add', data),
  updateAccount: (id: number, data: AccountFormData) =>
    ipcRenderer.invoke('accounts:update', id, data),
  deleteAccount: (id: number) => ipcRenderer.invoke('accounts:delete', id),
  setAccountStatus: (id: number, status: string) =>
    ipcRenderer.invoke('accounts:setStatus', id, status),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:save', settings),
  testSlackWebhook: () => ipcRenderer.invoke('slack:test'),
  testMacNotification: () => ipcRenderer.invoke('notify:test'),
  runRenewalCheck: () => ipcRenderer.invoke('scheduler:runNow'),
  getNotificationLog: () => ipcRenderer.invoke('notifications:getLog'),

  importCsv: (filePath: string) => ipcRenderer.invoke('csv:import', filePath),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Forecast
  getForecastOpps: () => ipcRenderer.invoke('forecast:getOpps'),
  getClosedWonOpps: () => ipcRenderer.invoke('forecast:getClosedWon'),
  getPipelineSnapshots: () => ipcRenderer.invoke('forecast:getPipelineSnapshots'),
  importForecastPipeline: (filePath: string) => ipcRenderer.invoke('forecast:importPipeline', filePath),
  importForecastClosedWon: (filePath: string) => ipcRenderer.invoke('forecast:importClosedWon', filePath),
  importHistoricalCsv: (filePath: string, customDate: string) => ipcRenderer.invoke('forecast:importHistorical', filePath, customDate),
  importHistoricalClosedWonCsv: (filePath: string, customDate: string) => ipcRenderer.invoke('forecast:importHistoricalClosedWon', filePath, customDate),
  syncFromTableau: () => ipcRenderer.invoke('tableau:sync'),
  getAnalyticsData: (): Promise<AnalyticsData> => ipcRenderer.invoke('analytics:getData'),
  getHistoricalState: (asOfDate: string): Promise<ForecastOpp[] | null> => ipcRenderer.invoke('analytics:getHistoricalState', asOfDate),
  getSnapshotsBetweenDates: (fromDate: string, toDate: string): Promise<{ start: ForecastOpp[] | null; end: ForecastOpp[] | null }> => ipcRenderer.invoke('analytics:getSnapshotsBetweenDates', fromDate, toDate),
  getAllSnapshots: (): Promise<Array<{ imported_at: string; total_pipeline: number; opp_count: number; total_bookings?: number; deal_count?: number; has_pipeline: boolean; has_closed_won: boolean }>> => ipcRenderer.invoke('analytics:getAllSnapshots'),
  deleteSnapshot: (importedAt: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('analytics:deleteSnapshot', importedAt),
  snapshotCurrentState: (): Promise<{ pipelineCount: number; cwCount: number }> => ipcRenderer.invoke('analytics:snapshotCurrentState'),
  getQuotas: (): Promise<Quota[]> => ipcRenderer.invoke('quotas:getAll'),
  upsertQuota: (ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }): Promise<{ ok: boolean }> => ipcRenderer.invoke('quotas:upsert', ai_ae, data),
  deleteQuota: (ai_ae: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('quotas:delete', ai_ae),

  setTopDeal: (id: number, value: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('forecast:setTopDeal', id, value),
  deleteForecastOpp: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('forecast:deleteOpp', id),

  updateForecastAisField: (
    id: number,
    field: 'ais_forecast' | 'ais_arr' | 'ais_close_date',
    value: AisForecast | number | string | null,
  ) => ipcRenderer.invoke('forecast:updateAisField', id, field, value),

  updateClosedWonBookings: (id: number, editedBookings: number | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('forecast:updateClosedWonBookings', id, editedBookings),

  toggleExcludeFromAnalysis: (oppId: string, exclude: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('forecast:toggleExcludeFromAnalysis', oppId, exclude),

  getExcludedDealIds: (): Promise<string[]> =>
    ipcRenderer.invoke('forecast:getExcludedDealIds'),

  dealiaChat: (
    messages: { role: 'user' | 'assistant'; content: string }[],
    context: string,
  ): Promise<{ ok: boolean; reply?: string; error?: string }> =>
    ipcRenderer.invoke('dealia:chat', messages, context),

  // Import History
  getImportHistory: () => ipcRenderer.invoke('importHistory:getAll'),
  openBackupCsv: (filename: string) => ipcRenderer.invoke('importHistory:openBackup', filename),

  // PDF Export
  exportPdf: (defaultFilename: string): Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('pdf:export', defaultFilename),
});
