import { ipcMain, dialog, shell, Notification, app } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import fs from 'node:fs';
import {
  getAllAccounts,
  insertAccount,
  updateAccount,
  deleteAccount,
  setContactStatus,
  getSettings,
  saveSettings,
  getNotificationLog,
  getForecastOpps,
  getClosedWonOpps,
  updateForecastAisField,
  getAnalyticsData,
  getQuotas,
  upsertQuota,
  deleteQuota,
  setForecastTopDeal,
  logImport,
  getImportHistory,
} from './database';
import type { AisForecast, ContactStatus } from '../shared/types';
import { sendTestNotification } from './slack';
import { runRenewalCheck } from './scheduler';
import { importCsvFile } from './csv-import';
import { importForecastCsv, importClosedWonCsv } from './forecast-import';
import { syncFromTableau } from './tableau-api';
import type { AccountFormData, AppSettings } from '../shared/types';

/**
 * Save a backup copy of a CSV file before importing
 */
function saveBackupCsv(sourcePath: string): string {
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = `pipeline-backup-${timestamp}.csv`;
  const backupPath = path.join(backupsDir, filename);

  fs.copyFileSync(sourcePath, backupPath);
  console.log('[ipc-handlers] Saved backup CSV:', backupPath);

  return filename;
}

export function registerIpcHandlers(): void {
  ipcMain.handle('accounts:getAll', () => getAllAccounts());

  ipcMain.handle('accounts:add', (_event, data: AccountFormData) => {
    const id = insertAccount(data);
    return { id };
  });

  ipcMain.handle('accounts:update', (_event, id: number, data: AccountFormData) => {
    updateAccount(id, data);
    return { ok: true };
  });

  ipcMain.handle('accounts:setStatus', (_event, id: number, status: ContactStatus) => {
    setContactStatus(id, status);
    return { ok: true };
  });

  ipcMain.handle('accounts:delete', (_event, id: number) => {
    deleteAccount(id);
    return { ok: true };
  });

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => {
    saveSettings(settings);
    return { ok: true };
  });

  ipcMain.handle('slack:test', () => sendTestNotification());

  ipcMain.handle('notify:test', () => {
    new Notification({
      title: 'Deal Tracker — Test Notification',
      body: 'macOS notifications are working correctly.',
    }).show();
    return { ok: true };
  });

  ipcMain.handle('scheduler:runNow', async () => {
    const count = await runRenewalCheck();
    return { sent: count };
  });

  ipcMain.handle('notifications:getLog', () => getNotificationLog());

  ipcMain.handle('csv:import', (_event, filePath: string) => importCsvFile(filePath));

  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url));

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Forecast
  ipcMain.handle('forecast:getOpps', () => getForecastOpps());
  ipcMain.handle('forecast:getClosedWon', () => getClosedWonOpps());

  ipcMain.handle('forecast:importPipeline', (_event, filePath: string) => {
    try {
      // Save backup before importing
      const backupFilename = saveBackupCsv(filePath);

      // Import the CSV
      const result = importForecastCsv(filePath);

      // Calculate total pipeline
      const opps = getForecastOpps();
      const totalPipeline = opps.reduce((sum, opp) => sum + (opp.ais_arr ?? opp.product_arr_usd), 0);

      // Count rows from CSV
      const csvContent = fs.readFileSync(filePath, 'utf-8');
      const rowCount = csvContent.split('\n').filter(line => line.trim()).length - 1; // -1 for header

      // Log the import
      logImport({
        source_type: 'csv_upload',
        backup_filename: backupFilename,
        row_count: rowCount,
        inserted_count: result.inserted,
        updated_count: result.updated,
        total_pipeline: totalPipeline,
      });

      return result;
    } catch (err: any) {
      console.error('[forecast:importPipeline] Error:', err);
      throw err;
    }
  });

  ipcMain.handle('forecast:importClosedWon', (_event, filePath: string) => importClosedWonCsv(filePath));
  ipcMain.handle('analytics:getData', () => getAnalyticsData());

  // Tableau sync
  ipcMain.handle('tableau:sync', async () => {
    const settings = getSettings();

    // Validate settings
    if (!settings.tableau_pat_name || !settings.tableau_pat_secret) {
      return { success: false, error: 'Tableau PAT credentials not configured. Please add them in Settings.' };
    }
    if (!settings.tableau_view_id) {
      return { success: false, error: 'Tableau View ID not configured. Please add it in Settings.' };
    }

    // Sync from Tableau
    const result = await syncFromTableau(
      settings.tableau_site || 'zendesktableau',
      settings.tableau_pat_name,
      settings.tableau_pat_secret,
      settings.tableau_view_id,
      settings.tableau_filters,
    );

    if (!result.success || !result.csvPath) {
      return { success: false, error: result.error || 'Failed to sync from Tableau' };
    }

    // Save backup before importing
    const backupFilename = saveBackupCsv(result.csvPath);

    // Import the CSV data
    try {
      const importResult = importForecastCsv(result.csvPath);

      // Calculate total pipeline
      const opps = getForecastOpps();
      const totalPipeline = opps.reduce((sum, opp) => sum + (opp.ais_arr ?? opp.product_arr_usd), 0);

      // Count rows from CSV
      const csvContent = fs.readFileSync(result.csvPath, 'utf-8');
      const rowCount = csvContent.split('\n').filter(line => line.trim()).length - 1;

      // Log the import
      logImport({
        source_type: 'tableau_sync',
        backup_filename: backupFilename,
        row_count: rowCount,
        inserted_count: importResult.inserted,
        updated_count: importResult.updated,
        total_pipeline: totalPipeline,
      });

      // Clean up the temp file
      try {
        fs.unlinkSync(result.csvPath);
      } catch (err) {
        console.error('[tableau:sync] Failed to delete temp file:', err);
      }

      return { success: true, result: importResult };
    } catch (err: any) {
      return { success: false, error: `Import failed: ${err.message}` };
    }
  });

  // Quotas
  ipcMain.handle('quotas:getAll', () => getQuotas());
  ipcMain.handle('quotas:upsert', (_event, ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }) => { upsertQuota(ai_ae, data); return { ok: true }; });
  ipcMain.handle('quotas:delete', (_event, ai_ae: string) => { deleteQuota(ai_ae); return { ok: true }; });

  // Dealia AI chat
  ipcMain.handle('dealia:chat', async (_event, messages: { role: 'user' | 'assistant'; content: string }[], context: string) => {
    const settings = getSettings();
    if (!settings.anthropic_api_key) {
      return { ok: false, error: 'No Anthropic API key configured. Add it in Settings → AI Assistant.' };
    }
    try {
      const client = new Anthropic({ apiKey: settings.anthropic_api_key });
      const systemPrompt = `You are Dealia, an AI sales analytics assistant for an enterprise SaaS company's AI Solutions team. You help the CRO and sales leadership understand their pipeline, forecast accuracy, and team performance.

You have access to real-time pipeline data provided below. Be concise, insightful, and direct. Cite specific numbers from the data. Use a confident, executive-level tone. When you identify risks or opportunities, be specific about which deals or reps are involved.

Focus areas: pipeline health, forecast accuracy, quota attainment, risk identification, team performance, actionable next steps.

Today's date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

${context}`;
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });
      const reply = response.content[0].type === 'text' ? response.content[0].text : '';
      return { ok: true, reply };
    } catch (err: any) {
      return { ok: false, error: err.message ?? 'API call failed' };
    }
  });

  ipcMain.handle('forecast:setTopDeal', (_event, id: number, value: number) => {
    setForecastTopDeal(id, value);
    return { ok: true };
  });

  ipcMain.handle(
    'forecast:updateAisField',
    (_event, id: number, field: 'ais_forecast' | 'ais_arr' | 'ais_close_date', value: AisForecast | number | string | null) => {
      updateForecastAisField(id, field, value);
      return { ok: true };
    },
  );

  // Import History
  ipcMain.handle('importHistory:getAll', () => getImportHistory());

  ipcMain.handle('importHistory:openBackup', async (_event, filename: string) => {
    const backupsDir = path.join(app.getPath('userData'), 'backups');
    const backupPath = path.join(backupsDir, filename);

    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file not found');
    }

    await shell.openPath(backupPath);
    return { ok: true };
  });
}
