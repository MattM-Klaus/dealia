import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Hardcoded Snowflake Google Sheets export URL
const SNOWFLAKE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1nhTjmKfnqkoh0EaFyvB1R5qQOEjeFWyFViDJqwnpQMw/export?format=csv&gid=266570174';

interface SnowflakeSyncResult {
  success: boolean;
  csvPath?: string;
  error?: string;
}

/**
 * Fetch CSV from Snowflake Google Sheets export
 */
export async function syncFromSnowflake(): Promise<SnowflakeSyncResult> {
  try {
    console.log('[snowflake] Fetching CSV from Google Sheets...');

    // Fetch the CSV
    const response = await fetch(SNOWFLAKE_SHEET_URL);

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch Snowflake data: ${response.status} ${response.statusText}`,
      };
    }

    const csvData = await response.text();

    // Save to temp file
    const tempDir = path.join(app.getPath('userData'), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csvPath = path.join(tempDir, `snowflake-sync-${timestamp}.csv`);
    fs.writeFileSync(csvPath, csvData, 'utf-8');

    console.log(`[snowflake] CSV saved to: ${csvPath}`);
    console.log(`[snowflake] CSV size: ${csvData.length} bytes`);

    return {
      success: true,
      csvPath,
    };
  } catch (err) {
    console.error('[snowflake] Sync error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred',
    };
  }
}
