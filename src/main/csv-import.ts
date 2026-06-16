import Papa from 'papaparse';
import fs from 'node:fs';
import { upsertAccount } from './database';
import type { CsvImportResult, Product } from '../shared/types';

// Converts "2027Q1" → "2027-03-31", "2026Q3" → "2026-09-30", etc.
export function parseRenewalQtr(raw: string): string | null {
  if (!raw) return null;

  const match =
    raw.match(/^(\d{4})Q(\d)$/i) ||
    raw.match(/^Q(\d)\s+(\d{4})$/i) ||
    raw.match(/^Q(\d)\s+FY(\d{2,4})$/i);

  let year: number;
  let quarter: number;

  if (!match) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  }

  if (/^\d{4}Q\d$/i.test(raw)) {
    year = parseInt(match[1], 10);
    quarter = parseInt(match[2], 10);
  } else if (/^Q\d\s+\d{4}$/i.test(raw)) {
    quarter = parseInt(match[1], 10);
    year = parseInt(match[2], 10);
  } else {
    quarter = parseInt(match[1], 10);
    const fy = parseInt(match[2], 10);
    year = fy < 100 ? 2000 + fy : fy;
  }

  const quarterEndMonth: Record<number, string> = {
    1: '03-31',
    2: '06-30',
    3: '09-30',
    4: '12-31',
  };

  const monthDay = quarterEndMonth[quarter];
  if (!monthDay) return null;
  return `${year}-${monthDay}`;
}

export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

export function parseARR(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

export function isYes(val: string): boolean {
  return val?.trim().toLowerCase() === 'yes';
}

// Current Products — from "Has AIAA", "Has Copilot", "Has QA or WEM" columns
export function parseCurrentProducts(row: Record<string, string>): Product[] {
  const products: Product[] = [];
  if (isYes(row['has_aiaa'])) products.push('AI Agents');
  if (isYes(row['has_copilot'])) products.push('Copilot');
  if (isYes(row['has_qa_or_wem'])) products.push('QA');
  return products;
}

// Target Products — from "Matched Segment(s)" column
// e.g. "Copilot, QA/WEM" → ["Copilot", "QA"]
export function parseTargetProducts(raw: string): Product[] {
  if (!raw) return [];
  const products: Product[] = [];
  const lower = raw.toLowerCase();
  if (lower.includes('ai agent') || lower.includes('aiaa') || lower.includes('automated resolution')) {
    products.push('AI Agents');
  }
  if (lower.includes('copilot')) products.push('Copilot');
  if (lower.includes('qa') || lower.includes('wem')) products.push('QA');
  return products;
}

export function buildNotes(row: Record<string, string>): string {
  const parts: string[] = [];
  const add = (label: string, key: string) => {
    const val = row[key]?.trim();
    if (val) parts.push(`${label}: ${val}`);
  };

  add('Territory', 'territory_name_sfdc');
  add('Segmentation', 'segmentation');
  add('Urgency', 'urgency');
  add('Health Score', 'health_score');
  add('4 Motions', '4_motions');
  add('Key Metrics', 'key_metrics');
  add('Open AI Opps ARR', 'open_ai_opps_total_arr');
  add('3rd Party AI Bot', 'third_party_ai_bot');
  add('3P Bot Last Seen', 'max_date_with_3p_bot_signal');
  add('3P Bot Sources', 'third_party_bot_data_sources');
  add('Ticket Vol', 'ticket_vol');
  add('Msg Vol', 'msg_vol');
  add('Articles', 'articles');

  return parts.join('\n');
}

export function importCsvFile(filePath: string): CsvImportResult {
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  const { data } = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, ''),
  });

  const result: CsvImportResult = { inserted: 0, updated: 0, failed: 0, errors: [] };

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;

    try {
      const accountName = row['account_name']?.trim() || '';
      if (!accountName) throw new Error('Missing Account Name');

      // Prefer NEXT_RENEWAL_DATE (exact date); fall back to Renewal Qtr (quarter-based)
      const nextRenewalRaw = row['next_renewal_date']?.trim() || '';
      const renewalQtrRaw = row['renewal_qtr']?.trim() || '';
      const renewalDate =
        (nextRenewalRaw ? parseDate(nextRenewalRaw) : null) ??
        (renewalQtrRaw ? parseRenewalQtr(renewalQtrRaw) : null);
      if (!renewalDate) throw new Error(`Missing or invalid renewal date`);

      const crmId = row['crm_account_id']?.trim() || null;
      const { updated } = upsertAccount({
        account_name: accountName,
        arr: parseARR(row['account_arr'] || '0'),
        num_agents: parseInt((row['seats'] || '0').replace(/[^0-9]/g, '') || '0', 10),
        renewal_date: renewalDate,
        account_owner: row['ae_name']?.trim() || '',
        ae_manager: row['ae_manager']?.trim() || '',
        current_products: parseCurrentProducts(row),
        target_products: parseTargetProducts(row['matched_segment_s'] || ''),
        sfdc_link: row['sfdc_link']?.trim() || '',
        notes: buildNotes(row),
        crm_account_id: crmId,
      });

      if (updated) result.updated++;
      else result.inserted++;
    } catch (err) {
      result.failed++;
      result.errors.push(`Row ${rowNum}: ${(err as Error).message}`);
    }
  }

  return result;
}
