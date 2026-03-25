import Papa from 'papaparse';
import fs from 'node:fs';
import {
  getAisValues,
  getExistingOppsForDiff,
  insertForecastChanges,
  replaceForecastOpps,
  replaceClosedWonOpps,
  syncForecastToRenewals,
  savePipelineSnapshot,
  saveClosedWonSnapshot,
} from './database';
import type { AisForecast, AlertReason, ChangeType, ForecastChange, ForecastImportResult, ForecastOpp, ClosedWonOpp } from '../shared/types';
import { mapForecast, normalizeProduct, toCloseQuarter } from '../shared/utils';

const LARGE_OPP_THRESHOLD = 250_000; // flag new opps at or above this ARR

function getStageOrder(stage: string): number {
  const m = stage.trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

type OppSnapshot = ReturnType<typeof getExistingOppsForDiff> extends Map<string, infer V> ? V : never;
type OppForDiff = Omit<ForecastOpp, 'id' | 'created_at' | 'updated_at'>;
type TrackingFields = { push_count: number; total_days_pushed: number; stage_entered_at: string | null };
type ChangeInsert = Omit<ForecastChange, 'id' | 'created_at'>;

function detectChanges(
  existingMap: Map<string, OppSnapshot>,
  newOpps: OppForDiff[],
  importedAt: string,
): { changes: ChangeInsert[]; trackingMap: Map<string, TrackingFields> } {
  const changes: ChangeInsert[] = [];
  const trackingMap = new Map<string, TrackingFields>();
  const processedKeys = new Set<string>();
  const today = importedAt.split('T')[0];

  function base(opp: OppForDiff): Omit<ChangeInsert, 'change_type' | 'old_value' | 'new_value' | 'delta_numeric' | 'is_alert' | 'alert_reason'> {
    return {
      imported_at: importedAt,
      crm_opportunity_id: opp.crm_opportunity_id,
      product: opp.product,
      account_name: opp.account_name,
      ae_name: opp.ae_name,
      ai_ae: opp.ai_ae,
      manager_name: opp.manager_name,
    };
  }

  function push(c: ChangeInsert) { changes.push(c); }

  for (const opp of newOpps) {
    const key = `${opp.crm_opportunity_id}::${opp.product}`;
    processedKeys.add(key);
    const old = existingMap.get(key);

    if (!old) {
      // Brand new opp
      const isLarge = opp.product_arr_usd >= LARGE_OPP_THRESHOLD;
      push({ ...base(opp), change_type: 'opp_added', old_value: null, new_value: String(opp.product_arr_usd), delta_numeric: opp.product_arr_usd, is_alert: isLarge ? 1 : 0, alert_reason: isLarge ? 'large_new_opp' : null });
      trackingMap.set(key, { push_count: 0, total_days_pushed: 0, stage_entered_at: today });
      continue;
    }

    // Carry forward existing tracking
    let { push_count, total_days_pushed, stage_entered_at } = old;

    // ARR change (ignore tiny rounding noise < $100)
    const arrDiff = opp.product_arr_usd - old.product_arr_usd;
    if (Math.abs(arrDiff) >= 100) {
      push({ ...base(opp), change_type: arrDiff > 0 ? 'arr_up' : 'arr_down', old_value: String(old.product_arr_usd), new_value: String(opp.product_arr_usd), delta_numeric: arrDiff, is_alert: 0, alert_reason: null });
    }

    // Close date change
    if (opp.close_date && old.close_date && opp.close_date !== old.close_date) {
      const daysDiff = Math.round((new Date(opp.close_date).getTime() - new Date(old.close_date).getTime()) / 86400000);
      const pushed = daysDiff > 0;
      const oldQtr = toCloseQuarter(old.close_date);
      const newQtr = toCloseQuarter(opp.close_date);

      let alertReason: AlertReason | null = null;
      let isAlert = 0;
      if (pushed) {
        if (oldQtr !== newQtr) { alertReason = 'pushed_out_of_quarter'; isAlert = 1; }
        else if (push_count > 0) { alertReason = 'multi_push'; isAlert = 1; }
        push_count += 1;
        total_days_pushed += daysDiff;
      }
      push({ ...base(opp), change_type: pushed ? 'date_pushed' : 'date_pulled', old_value: old.close_date, new_value: opp.close_date, delta_numeric: daysDiff, is_alert: isAlert, alert_reason: alertReason });
    }

    // Stage change
    if (opp.stage_name && old.stage_name && opp.stage_name !== old.stage_name) {
      const progressed = getStageOrder(opp.stage_name) > getStageOrder(old.stage_name);
      push({ ...base(opp), change_type: progressed ? 'stage_progressed' : 'stage_regressed', old_value: old.stage_name, new_value: opp.stage_name, delta_numeric: getStageOrder(opp.stage_name) - getStageOrder(old.stage_name), is_alert: progressed ? 0 : 1, alert_reason: progressed ? null : 'stage_regression' });
      stage_entered_at = today; // reset on stage change
    }

    // VP Forecast change
    if (opp.vp_deal_forecast !== old.vp_deal_forecast && (opp.vp_deal_forecast || old.vp_deal_forecast)) {
      push({ ...base(opp), change_type: 'vp_forecast_changed', old_value: old.vp_deal_forecast || '', new_value: opp.vp_deal_forecast || '', delta_numeric: null, is_alert: 0, alert_reason: null });
    }

    // AIS Forecast change
    if ((opp.ais_forecast ?? null) !== (old.ais_forecast ?? null) && (opp.ais_forecast || old.ais_forecast)) {
      push({ ...base(opp), change_type: 'ais_forecast_changed', old_value: old.ais_forecast || '', new_value: opp.ais_forecast || '', delta_numeric: null, is_alert: 0, alert_reason: null });
    }

    trackingMap.set(key, { push_count, total_days_pushed, stage_entered_at });
  }

  // Opps that dropped out of pipeline
  for (const [key, old] of existingMap) {
    if (!processedKeys.has(key)) {
      push({ imported_at: importedAt, crm_opportunity_id: old.crm_opportunity_id, product: old.product, account_name: old.account_name, ae_name: old.ae_name, ai_ae: old.ai_ae, manager_name: old.manager_name, change_type: 'opp_dropped', old_value: String(old.product_arr_usd), new_value: null, delta_numeric: -old.product_arr_usd, is_alert: 0, alert_reason: null });
    }
  }

  return { changes, trackingMap };
}

const OPP_ARR_THRESHOLD = 50_000; // opps below this use VP Deal Forecast for AIS auto-fill

function readCsvFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  // UTF-16 LE BOM: FF FE
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.toString('utf16le');
  }
  // UTF-16 BE BOM: FE FF (uncommon but handle it)
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // Swap bytes and decode as utf16le
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const tmp = buffer[i]; buffer[i] = buffer[i + 1]; buffer[i + 1] = tmp;
    }
    return buffer.toString('utf16le');
  }
  // UTF-8 (strip BOM if present)
  let str = buffer.toString('utf-8');
  if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1);
  return str;
}

function parseDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function normalizeHeaders(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Historical import: parses CSV and saves snapshot without updating live forecast_opps
export function importHistoricalCsv(filePath: string, customDate: string): ForecastImportResult {
  // Convert date to ISO timestamp (noon to avoid timezone issues)
  const importedAt = `${customDate}T12:00:00`;
  console.log('[forecast-import] Historical import for date:', importedAt);
  const fileContent = readCsvFile(filePath);
  console.log('[forecast-import] File read, length:', fileContent.length);

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeaders,
  });

  console.log('[forecast-import] Parsed rows:', data.length, 'parse errors:', parseErrors.length);

  const result: ForecastImportResult = { inserted: 0, updated: 0, failed: 0, synced_renewals: 0, changes_detected: 0, errors: [] };

  if (data.length === 0) {
    result.errors.push('No rows found in CSV');
    return result;
  }

  // Parse rows into ForecastOpp objects (same as regular import)
  const firstRow = data[0];
  const requiredCols = ['crm_opportunity_id'];
  for (const col of requiredCols) {
    if (!(col in firstRow)) {
      result.errors.push(`Missing required column: ${col}`);
      return result;
    }
  }

  const parsedOpps = data.map((row, idx) => {
    const closeDate = parseDate(row['closedate'] || '');
    const s2PlusDate = parseDate(row['s2_date'] || '');
    const product = normalizeProduct(row['product'] || '');
    const vpForecast = row['vp_deal_forecast']?.trim() || '';
    const productArr = parseAmount(row['product_arr_usd'] || '0');

    return {
      crm_opportunity_id: row['crm_opportunity_id']?.trim() || '',
      sfdc_account_id: row['account_id']?.trim() || '',
      account_name: row['account_name']?.trim() || '',
      manager_name: row['manager_name']?.trim() || '',
      ae_name: row['ae_name']?.trim() || '',
      region: row['region']?.trim() || '',
      segment: row['segment']?.trim() || '',
      product,
      type: row['type']?.trim() || '',
      stage_name: row['stage_name']?.trim() || '',
      vp_deal_forecast: vpForecast,
      product_specialist_forecast: row['product_specialist_forecast']?.trim() || '',
      product_specialist_notes: row['product_specialist_notes_c']?.trim() || '',
      ai_ae: row['ai_ae']?.trim() || '',
      close_date: closeDate,
      s2_plus_date: s2PlusDate,
      product_arr_usd: productArr,
      // For historical imports, map VP forecast to AIS forecast (since we don't have manual overrides)
      ais_forecast: mapForecast(vpForecast) ?? null,
      ais_arr: productArr,
      ais_close_date: closeDate,
      ais_arr_manual: 0,
      ais_forecast_manual: 0,
      ais_close_date_manual: 0,
      ais_top_deal: 0,
    };
  });

  // Dedupe by crm_opportunity_id::product
  const deduped = new Map<string, typeof parsedOpps[number]>();
  for (const opp of parsedOpps) {
    const key = `${opp.crm_opportunity_id}::${opp.product}`;
    deduped.set(key, opp);
  }

  const oppArray = Array.from(deduped.values()) as ForecastOpp[];

  // Save snapshot only - don't update live forecast_opps table
  savePipelineSnapshot(importedAt, oppArray);

  result.inserted = oppArray.length;
  console.log('[forecast-import] Historical snapshot saved:', oppArray.length, 'opps for', importedAt);
  return result;
}

// Historical Closed Won import: parses CSV and saves snapshot without updating live closed_won_opps
export function importHistoricalClosedWonCsv(filePath: string, customDate: string): ForecastImportResult {
  // Convert date to ISO timestamp (noon to avoid timezone issues)
  const importedAt = `${customDate}T12:00:00`;
  console.log('[forecast-import] Historical Closed Won import for date:', importedAt);
  const fileContent = readCsvFile(filePath);
  console.log('[forecast-import] File read, length:', fileContent.length);

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeaders,
  });

  console.log('[forecast-import] Parsed rows:', data.length, 'parse errors:', parseErrors.length);

  const result: ForecastImportResult = { inserted: 0, updated: 0, failed: 0, synced_renewals: 0, changes_detected: 0, errors: [] };

  if (data.length === 0) {
    result.errors.push('No rows found in CSV');
    return result;
  }

  const opps: Omit<ClosedWonOpp, 'id' | 'created_at' | 'updated_at'>[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    try {
      const oppId = row['crm_opportunity_id']?.trim() || '';
      if (!oppId) throw new Error('Missing Crm Opportunity Id');

      opps.push({
        crm_opportunity_id: oppId,
        account_name: row['account_name']?.trim() || '',
        manager_name: row['manager_name']?.trim() || '',
        ae_name: row['ae_name']?.trim() || '',
        region: row['region']?.trim() || '',
        segment: row['segment']?.trim() || '',
        product: row['product']?.trim() || '',
        type: row['type']?.trim() || '',
        ai_ae: row['ai_ae']?.trim() || '',
        close_date: parseDate(row['closedate'] || ''),
        bookings: parseAmount(row['bookings'] || '0'),
      });
    } catch (err) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: ${(err as Error).message}`);
    }
  }

  // Save snapshot only - don't update live closed_won_opps table
  saveClosedWonSnapshot(importedAt, opps as ClosedWonOpp[]);

  result.inserted = opps.length;
  console.log('[forecast-import] Historical Closed Won snapshot saved:', opps.length, 'deals for', importedAt);
  return result;
}

export function importForecastCsv(filePath: string): ForecastImportResult {
  console.log('[forecast-import] Reading pipeline CSV:', filePath);
  const fileContent = readCsvFile(filePath);
  console.log('[forecast-import] File read, length:', fileContent.length);

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeaders,
  });

  console.log('[forecast-import] Parsed rows:', data.length, 'parse errors:', parseErrors.length);

  const result: ForecastImportResult = { inserted: 0, updated: 0, failed: 0, synced_renewals: 0, changes_detected: 0, errors: [] };

  if (data.length === 0) {
    result.errors.push('No rows found in CSV');
    return result;
  }

  const firstRow = data[0];
  const foundKeys = Object.keys(firstRow);
  console.log('[forecast-import] Detected columns:', foundKeys.join(', '));

  if (!firstRow['crm_opportunity_id']) {
    result.errors.push(`Column 'crm_opportunity_id' not found. Detected columns: ${foundKeys.join(', ')}`);
    result.failed = data.length;
    return result;
  }

  // Load existing AIS values so we can preserve manual edits on re-upload
  const existingAis = getAisValues();

  // ── Pass 1: parse raw fields and compute per-opp Tableau ARR totals ──
  type RawRow = {
    rowNum: number;
    oppId: string;
    product: string;
    tableauArr: number;
    closeDate: string;
    s2PlusDate: string;
    sfdc_account_id: string;
    account_name: string;
    manager_name: string;
    ae_name: string;
    region: string;
    segment: string;
    type: string;
    stage_name: string;
    vp_deal_forecast: string;
    product_specialist_forecast: string;
    product_specialist_notes: string;
    ai_ae: string;
  };

  const rawRows: RawRow[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    try {
      const oppId = row['crm_opportunity_id']?.trim() || '';
      if (!oppId) throw new Error('Missing Crm Opportunity Id');
      rawRows.push({
        rowNum,
        oppId,
        product:                    row['product']?.trim() || '',
        tableauArr:                 parseAmount(row['product_arr_usd'] || '0'),
        closeDate:                  parseDate(row['closedate'] || ''),
        s2PlusDate:                 parseDate(row['s2_date'] || ''),
        sfdc_account_id:            row['account_id']?.trim() || '',
        account_name:               row['account_name']?.trim() || '',
        manager_name:               row['manager_name']?.trim() || '',
        ae_name:                    row['ae_name']?.trim() || '',
        region:                     row['region']?.trim() || '',
        segment:                    row['segment']?.trim() || '',
        type:                       row['type']?.trim() || '',
        stage_name:                 row['stage_name']?.trim() || '',
        vp_deal_forecast:           row['vp_deal_forecast']?.trim() || '',
        product_specialist_forecast: row['product_specialist_forecast']?.trim() || '',
        product_specialist_notes:   row['product_specialist_notes_c']?.trim() || '',
        ai_ae:                      row['ai_ae']?.trim() || '',
      });
    } catch (err) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: ${(err as Error).message}`);
    }
  }

  // Compute opp-level Tableau ARR totals (used to determine auto-fill source)
  const oppTotals = new Map<string, number>();
  for (const r of rawRows) {
    oppTotals.set(r.oppId, (oppTotals.get(r.oppId) ?? 0) + r.tableauArr);
  }

  // ── Pass 2: determine AIS values with opp-total context ──
  const opps: Omit<ForecastOpp, 'id' | 'created_at' | 'updated_at'>[] = [];
  for (const r of rawRows) {
    const normalizedProduct = normalizeProduct(r.product);
    const aisKey   = `${r.oppId}::${normalizedProduct}`;
    const existing = existingAis.get(aisKey);
    const oppTotal = oppTotals.get(r.oppId) ?? 0;

    // AIS Forecast: only preserve if the user manually set it; otherwise auto-fill from VP Deal Forecast
    const aisForecastManual = existing?.ais_forecast_manual ?? 0;
    const aisForecast = aisForecastManual
      ? existing!.ais_forecast
      : (oppTotal < OPP_ARR_THRESHOLD ? (mapForecast(r.vp_deal_forecast) ?? null) : null);

    // AIS ARR: only preserve if the user manually set it; otherwise use Tableau ARR
    const aisArrManual = existing?.ais_arr_manual ?? 0;
    const aisArr = aisArrManual ? existing!.ais_arr : r.tableauArr;

    // AIS Close Date: only preserve if the user manually set it; otherwise use Close Date
    const aisCloseDateManual = existing?.ais_close_date_manual ?? 0;
    const aisCloseDate = aisCloseDateManual ? existing!.ais_close_date : r.closeDate;

    // AIS Top Deal: always preserve user's flag
    const aisTopDeal = existing?.ais_top_deal ?? 0;

    opps.push({
      crm_opportunity_id:          r.oppId,
      sfdc_account_id:             r.sfdc_account_id,
      account_name:                r.account_name,
      manager_name:                r.manager_name,
      ae_name:                     r.ae_name,
      region:                      r.region,
      segment:                     r.segment,
      product:                     normalizedProduct,
      type:                        r.type,
      stage_name:                  r.stage_name,
      vp_deal_forecast:            r.vp_deal_forecast,
      product_specialist_forecast: r.product_specialist_forecast,
      product_specialist_notes:    r.product_specialist_notes,
      ai_ae:                       r.ai_ae,
      close_date:                  r.closeDate,
      s2_plus_date:                r.s2PlusDate,
      product_arr_usd:             r.tableauArr,
      ais_forecast:                aisForecast as AisForecast | null,
      ais_arr:                     aisArr,
      ais_close_date:              aisCloseDate,
      ais_arr_manual:              aisArrManual,
      ais_forecast_manual:         aisForecastManual,
      ais_close_date_manual:       aisCloseDateManual,
      ais_top_deal:                aisTopDeal,
    });
  }

  // ── Deduplicate: normalization may collapse two distinct raw products into one ──
  // e.g. 'ultimate_ar' + 'zendesk_ar' both become 'AI Agents' for the same opp.
  // Sum ARR for merged rows; keep last-seen values for all other fields.
  const oppsByKey = new Map<string, typeof opps[number]>();
  for (const opp of opps) {
    const key = `${opp.crm_opportunity_id}::${opp.product}`;
    if (oppsByKey.has(key)) {
      const prev = oppsByKey.get(key)!;
      oppsByKey.set(key, { ...opp, product_arr_usd: prev.product_arr_usd + opp.product_arr_usd });
    } else {
      oppsByKey.set(key, opp);
    }
  }
  const deduped = Array.from(oppsByKey.values());

  console.log('[forecast-import] Parsed opps:', opps.length, '→ deduped:', deduped.length, 'failed rows:', result.failed);
  console.log('[forecast-import] Sample deduped keys:', deduped.slice(0, 5).map((o) => `${o.crm_opportunity_id}::${o.product}`));

  // ── Detect changes vs existing pipeline ──────────────────────
  const importedAt = new Date().toISOString();
  const existingMap = getExistingOppsForDiff();
  console.log('[forecast-import] Existing opps in database before replace:', existingMap.size);
  const { changes, trackingMap } = detectChanges(existingMap, deduped, importedAt);

  // Merge tracking fields into opps before save
  const oppsWithTracking = deduped.map((opp) => {
    const key = `${opp.crm_opportunity_id}::${opp.product}`;
    const t = trackingMap.get(key) ?? { push_count: 0, total_days_pushed: 0, stage_entered_at: null };
    return { ...opp, ...t };
  });
  console.log('[forecast-import] About to call replaceForecastOpps with', oppsWithTracking.length, 'opps');

  const { inserted, updated } = replaceForecastOpps(oppsWithTracking);
  result.inserted = inserted;
  result.updated = updated;

  if (changes.length > 0) insertForecastChanges(changes);
  result.changes_detected = changes.length;

  // Save snapshot for historical reconstruction
  savePipelineSnapshot(importedAt, oppsWithTracking as ForecastOpp[]);

  console.log('[forecast-import] DB insert done. inserted:', inserted, 'updated:', updated, 'changes:', changes.length);

  // Auto-sync: opps that match renewal accounts get set to deal_live
  result.synced_renewals = syncForecastToRenewals(deduped);

  console.log('[forecast-import] Done. Result:', JSON.stringify(result));
  return result;
}

export function importClosedWonCsv(filePath: string): ForecastImportResult {
  const fileContent = readCsvFile(filePath);
  const { data } = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeaders,
  });

  const result: ForecastImportResult = { inserted: 0, updated: 0, failed: 0, synced_renewals: 0, changes_detected: 0, errors: [] };

  const opps: Omit<ClosedWonOpp, 'id' | 'created_at' | 'updated_at'>[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    try {
      const oppId = row['crm_opportunity_id']?.trim() || '';
      if (!oppId) throw new Error('Missing Crm Opportunity Id');

      opps.push({
        crm_opportunity_id: oppId,
        account_name: row['account_name']?.trim() || '',
        manager_name: row['manager_name']?.trim() || '',
        ae_name: row['ae_name']?.trim() || '',
        region: row['region']?.trim() || '',
        segment: row['segment']?.trim() || '',
        product: row['product']?.trim() || '',
        type: row['type']?.trim() || '',
        ai_ae: row['ai_ae']?.trim() || '',
        close_date: parseDate(row['closedate'] || ''),
        bookings: parseAmount(row['bookings'] || '0'),
      });
    } catch (err) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: ${(err as Error).message}`);
    }
  }

  const { inserted } = replaceClosedWonOpps(opps);
  result.inserted = inserted;

  return result;
}
