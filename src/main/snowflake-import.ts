import * as fs from 'fs';
import * as papa from 'papaparse';
import { replaceForecastOpps, replaceClosedWonOpps, replaceClosedLostOpps, getSettings } from './database';
import type { ForecastOpp, ClosedWonOpp, CsvImportResult } from '../shared/types';
import { mapForecast } from '../shared/utils';

interface SnowflakeRow {
  'Crm_Opportunity_Id': string;
  'OPPORTUNITY_NUMBER_C': string;
  'Account Name': string;
  'Account ID': string;
  'Stage Name': string;
  'VP Deal Forecast': string;
  'AI AE Forecast': string;
  'Manager Name': string;
  'Owner Name': string;
  'Region': string;
  'Segment': string;
  'AI_Product': string;
  'Type': string;
  'GTM Team': string;
  'AI AE': string;
  'AI AE Manager': string;
  'PRODUCT_SPECIALIST_NOTES_C': string;
  'SC Name': string;
  'sc_manager_notes_c': string;
  'Primary Competitor': string;
  'Top 3k Flag': string;
  'Sales Motion': string;
  'Partner Deal Source': string;
  'REFERRING_PARTNER_C': string;
  'Closedate': string;
  'D-Score': string;
  'S2 + Date': string;
  'AI_Booking_ARR': string;
  'AI_Pipeline_ARR': string;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function isClosedWon(stage: string): boolean {
  const stagePrefix = stage.substring(0, 2);
  return stagePrefix === '07' || stagePrefix === '08';
}

function isClosedLost(stage: string): boolean {
  return stage.toLowerCase().includes('lost') || stage.toLowerCase().includes('closed lost');
}

/**
 * Import Snowflake CSV and split into forecast_opps, closed_won_opps, and closed_lost_opps
 */
export function importSnowflakeCsv(filePath: string): CsvImportResult {
  try {
    console.log('[snowflake-import] Reading CSV from:', filePath);

    const csvContent = fs.readFileSync(filePath, 'utf-8');

    // Google Sheets exports include the sheet title in the first few rows.
    // We need to find the actual header row containing "Crm_Opportunity_Id"
    const lines = csvContent.split('\n');
    let headerLineIndex = -1;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      if (lines[i].includes('Crm_Opportunity_Id')) {
        headerLineIndex = i;
        break;
      }
    }

    if (headerLineIndex === -1) {
      throw new Error('Could not find header row with "Crm_Opportunity_Id" in first 10 lines');
    }

    console.log(`[snowflake-import] Found header row at line ${headerLineIndex + 1}`);

    // Rejoin from the header row onwards
    const csvWithoutTitle = lines.slice(headerLineIndex).join('\n');

    const parsed = papa.parse<SnowflakeRow>(csvWithoutTitle, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors.length > 0) {
      console.warn('[snowflake-import] Parse errors:', parsed.errors);
    }

    const rows = parsed.data;
    console.log(`[snowflake-import] Parsed ${rows.length} rows`);

    // Debug: show actual column headers in CSV
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      console.log(`[snowflake-import] DEBUG: CSV has ${headers.length} columns`);
      console.log(`[snowflake-import] DEBUG: All column headers:`, headers);
    }

    // Get AI AE filter from settings
    const settings = getSettings();
    const aiAeFilter = new Set(settings.my_ai_ae_team);
    const shouldFilter = aiAeFilter.size > 0;

    console.log(`[snowflake-import] AI AE Filter: ${shouldFilter ? Array.from(aiAeFilter).join(', ') : 'None (importing all)'}`);

    const forecastOpps: Omit<ForecastOpp, 'id' | 'created_at' | 'updated_at'>[] = [];
    const closedWonOpps: Omit<ClosedWonOpp, 'id' | 'created_at' | 'updated_at'>[] = [];
    const closedLostOpps: Omit<ClosedWonOpp, 'id' | 'created_at' | 'updated_at'>[] = [];

    let skippedByFilter = 0;
    const errors: string[] = [];

    // Debug: collect unique AI AE values to help diagnose filter mismatches
    const uniqueAiAes = new Set<string>();
    const sampleForecasts: string[] = [];

    for (const row of rows) {
      try {
        const aiAe = (row['AI AE'] || '').trim();

        // Debug: track all unique AI AE values
        if (aiAe) uniqueAiAes.add(aiAe);

        // Filter by AI AE team if configured
        if (shouldFilter && !aiAeFilter.has(aiAe)) {
          skippedByFilter++;
          continue;
        }

        const oppId = row['Crm_Opportunity_Id']?.trim();
        const stageName = (row['Stage Name'] || '').trim();

        if (!oppId) {
          errors.push('Missing opportunity ID');
          continue;
        }

        // Determine which table this row belongs to
        if (isClosedWon(stageName)) {
          // CLOSED WON - use AI_Booking_ARR only
          const bookings = parseNumber(row['AI_Booking_ARR']);

          closedWonOpps.push({
            crm_opportunity_id: oppId,
            account_name: (row['Account Name'] || '').trim(),
            manager_name: (row['Manager Name'] || '').trim(),
            ae_name: (row['Owner Name'] || '').trim(),
            region: (row['Region'] || '').trim(),
            segment: (row['Segment'] || '').trim(),
            product: (row['AI_Product'] || '').trim(),
            type: (row['Type'] || '').trim(),
            ai_ae: aiAe,
            close_date: (row['Closedate'] || '').trim(),
            bookings,
            edited_bookings: null,
          });
        } else if (isClosedLost(stageName)) {
          // CLOSED LOST - use AI_Pipeline_ARR
          const bookings = parseNumber(row['AI_Pipeline_ARR']);

          closedLostOpps.push({
            crm_opportunity_id: oppId,
            account_name: (row['Account Name'] || '').trim(),
            manager_name: (row['Manager Name'] || '').trim(),
            ae_name: (row['Owner Name'] || '').trim(),
            region: (row['Region'] || '').trim(),
            segment: (row['Segment'] || '').trim(),
            product: (row['AI_Product'] || '').trim(),
            type: (row['Type'] || '').trim(),
            ai_ae: aiAe,
            close_date: (row['Closedate'] || '').trim(),
            bookings,
            edited_bookings: null,
          });
        } else {
          // OPEN PIPELINE - use AI_Pipeline_ARR
          const productArrUsd = parseNumber(row['AI_Pipeline_ARR']);
          const aiAeForecast = (row['AI AE Forecast'] || '').trim();
          const closeDate = (row['Closedate'] || '').trim();

          // Debug: collect sample forecasts
          if (sampleForecasts.length < 10 && aiAeForecast) {
            sampleForecasts.push(`${row['Account Name']}: ${aiAeForecast}`);
          }

          forecastOpps.push({
            crm_opportunity_id: oppId,
            sfdc_account_id: (row['Account ID'] || '').trim(),
            account_name: (row['Account Name'] || '').trim(),
            manager_name: (row['Manager Name'] || '').trim(),
            ae_name: (row['Owner Name'] || '').trim(),
            region: (row['Region'] || '').trim(),
            segment: (row['Segment'] || '').trim(),
            product: (row['AI_Product'] || '').trim(),
            type: (row['Type'] || '').trim(),
            stage_name: stageName,
            vp_deal_forecast: (row['VP Deal Forecast'] || '').trim(),
            product_specialist_forecast: aiAeForecast,
            product_specialist_notes: (row['PRODUCT_SPECIALIST_NOTES_C'] || '').trim(),
            ai_ae: aiAe,
            close_date: closeDate,
            s2_plus_date: (row['S2 + Date'] || '').trim(),
            product_arr_usd: productArrUsd,
            // AIS fields - populated from Snowflake, matching original CSV import behavior
            ais_forecast: mapForecast(aiAeForecast),  // Map "3 - Best Case" -> "Best Case"
            ais_arr: productArrUsd,                   // Always populate from AI_Pipeline_ARR
            ais_close_date: closeDate || null,        // Always populate from Close Date
            ais_arr_manual: 0,
            ais_forecast_manual: 0,
            ais_close_date_manual: 0,
            ais_top_deal: 0,
            push_count: 0,
          });
        }
      } catch (err) {
        const errorMsg = `Row error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error('[snowflake-import]', errorMsg, row);
      }
    }

    console.log(`[snowflake-import] Categorized: ${forecastOpps.length} open, ${closedWonOpps.length} closed won, ${closedLostOpps.length} closed lost`);
    if (skippedByFilter > 0) {
      console.log(`[snowflake-import] Filtered out ${skippedByFilter} rows by AI AE team`);
      console.log(`[snowflake-import] DEBUG: Found ${uniqueAiAes.size} unique AI AE values in CSV:`, Array.from(uniqueAiAes).sort().slice(0, 20));
    }
    if (sampleForecasts.length > 0) {
      console.log(`[snowflake-import] DEBUG: Sample AI AE Forecasts:`, sampleForecasts);
    } else {
      console.log(`[snowflake-import] DEBUG: No AI AE Forecast values found in any rows`);
    }

    // Import to database
    const forecastResult = replaceForecastOpps(forecastOpps);
    const closedWonResult = replaceClosedWonOpps(closedWonOpps);
    const closedLostResult = replaceClosedLostOpps(closedLostOpps);

    const totalInserted = forecastResult.inserted + closedWonResult.inserted + closedLostResult.inserted;

    console.log(`[snowflake-import] Import complete: ${totalInserted} total records`);

    return {
      inserted: totalInserted,
      updated: 0,
      failed: errors.length,
      errors,
    };
  } catch (err) {
    console.error('[snowflake-import] Import failed:', err);
    return {
      inserted: 0,
      updated: 0,
      failed: 1,
      errors: [err instanceof Error ? err.message : 'Unknown import error'],
    };
  }
}
