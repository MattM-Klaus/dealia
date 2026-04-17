import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { app } from 'electron';
import { importXactlyCommissions, importTableauClosedWon } from './database';

interface XactlyRow {
  '# Opportunity Number': string;
  'Customer Name': string;
  'Commissionable Date': string;
  'Credit Type': string;
  'Credit Amount': string;
  'Credit Amount Unit Type': string;
}

interface TableauRow {
  'Crm Opportunity Id': string;
  'OPPORTUNITY_NUMBER_C': string;
  'Account Name': string;
  'AE Name': string;
  'Manager Name': string;
  'Product': string;
  'Bookings': string;
  'Closedate': string;
  'Raw Closedate': string;
}

function parseAmount(value: string): number {
  if (!value) return 0;
  // Remove commas and parse
  return parseFloat(value.replace(/,/g, ''));
}

function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  // Handle MM/DD/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

function periodMatchesDate(period: string, dateStr: string): boolean {
  if (!dateStr) return false;

  // Parse period like "Feb 2026" into month and year
  const periodParts = period.trim().split(' ');
  if (periodParts.length !== 2) return true; // If period format is unexpected, include all

  const [monthName, yearStr] = periodParts;
  const periodYear = parseInt(yearStr, 10);

  const monthMap: { [key: string]: number } = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
    'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
    'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12,
  };

  const periodMonth = monthMap[monthName];
  if (!periodMonth) return true; // If month name is unexpected, include all

  // Parse the date string (YYYY-MM-DD format after parseDate)
  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) return true; // If date format is unexpected, include all

  const dateYear = parseInt(dateParts[0], 10);
  const dateMonth = parseInt(dateParts[1], 10);

  return dateYear === periodYear && dateMonth === periodMonth;
}

export async function importXactlyCSV(filePath: string, period: string): Promise<{ inserted: number; updated: number }> {
  const content = fs.readFileSync(filePath, 'utf-8');

  return new Promise((resolve, reject) => {
    Papa.parse<XactlyRow>(content, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const data = results.data
            .filter(row => row['# Opportunity Number']) // Skip empty rows
            .map(row => ({
              opportunity_number: row['# Opportunity Number'].trim(),
              customer_name: row['Customer Name'] || '',
              commissionable_date: parseDate(row['Commissionable Date']),
              credit_type: row['Credit Type'] || '',
              credit_amount: parseAmount(row['Credit Amount']),
              period,
            }));

          const result = importXactlyCommissions(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

export async function importTableauCSV(filePath: string, period: string): Promise<{ inserted: number; updated: number }> {
  // Read as buffer first to detect encoding
  const buffer = fs.readFileSync(filePath);

  // Check for UTF-16 LE BOM (FF FE)
  let content: string;
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    content = buffer.toString('utf16le');
  } else {
    content = buffer.toString('utf-8');
  }

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  return new Promise((resolve, reject) => {
    Papa.parse<any>(content, {
      header: true,
      delimiter: '\t', // Tableau exports are tab-delimited
      skipEmptyLines: true,
      complete: (results) => {
        try {
          console.log('[importTableauCSV] Total rows parsed:', results.data.length);

          // Clean up null bytes from column names and find the actual keys
          const cleanRow = (row: any): TableauRow | null => {
            const cleanedRow: any = {};
            for (const key in row) {
              const cleanKey = key.replace(/\x00/g, '');
              const cleanValue = typeof row[key] === 'string' ? row[key].replace(/\x00/g, '') : row[key];
              cleanedRow[cleanKey] = cleanValue;
            }
            return cleanedRow as TableauRow;
          };

          const cleanedData = results.data.map(cleanRow).filter((row): row is TableauRow => row !== null);
          console.log('[importTableauCSV] Sample cleaned row:', cleanedData[0]);

          const data = cleanedData
            .filter(row => row['OPPORTUNITY_NUMBER_C']) // Skip empty rows
            .map(row => ({
              opportunity_number: row['OPPORTUNITY_NUMBER_C'].trim(),
              crm_opportunity_id: row['Crm Opportunity Id'] || '',
              account_name: row['Account Name'] || '',
              ae_name: row['AE Name'] || '',
              manager_name: row['Manager Name'] || '',
              product: row['Product'] || '',
              bookings: parseAmount(row['Bookings']),
              close_date: parseDate(row['Raw Closedate'] || row['Closedate']), // Use Raw Closedate, fallback to Closedate
              period,
            }));
            // Period filter removed - import all deals in CSV regardless of close date

          console.log('[importTableauCSV] Filtered data count:', data.length);
          console.log('[importTableauCSV] Sample data:', data[0]);

          const result = importTableauClosedWon(data);
          console.log('[importTableauCSV] Import result:', result);
          resolve(result);
        } catch (error) {
          console.error('[importTableauCSV] Error:', error);
          reject(error);
        }
      },
      error: (error) => {
        console.error('[importTableauCSV] Parse error:', error);
        reject(error);
      },
    });
  });
}
