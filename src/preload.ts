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
  importForecastPipeline: (filePath: string) => ipcRenderer.invoke('forecast:importPipeline', filePath),
  importForecastClosedWon: (filePath: string) => ipcRenderer.invoke('forecast:importClosedWon', filePath),
  syncFromTableau: () => ipcRenderer.invoke('tableau:sync'),
  getAnalyticsData: (): Promise<AnalyticsData> => ipcRenderer.invoke('analytics:getData'),
  getQuotas: (): Promise<Quota[]> => ipcRenderer.invoke('quotas:getAll'),
  upsertQuota: (ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }): Promise<{ ok: boolean }> => ipcRenderer.invoke('quotas:upsert', ai_ae, data),
  deleteQuota: (ai_ae: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('quotas:delete', ai_ae),

  setTopDeal: (id: number, value: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('forecast:setTopDeal', id, value),

  updateForecastAisField: (
    id: number,
    field: 'ais_forecast' | 'ais_arr' | 'ais_close_date',
    value: AisForecast | number | string | null,
  ) => ipcRenderer.invoke('forecast:updateAisField', id, field, value),

  dealiaChat: (
    messages: { role: 'user' | 'assistant'; content: string }[],
    context: string,
  ): Promise<{ ok: boolean; reply?: string; error?: string }> =>
    ipcRenderer.invoke('dealia:chat', messages, context),

  // Import History
  getImportHistory: () => ipcRenderer.invoke('importHistory:getAll'),
  openBackupCsv: (filename: string) => ipcRenderer.invoke('importHistory:openBackup', filename),
});
