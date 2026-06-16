import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDatabase, resetTestDatabase } from './helpers/testDatabase';
import { setDatabase } from '../database';
import { importXactlyCSV, importTableauCSV } from '../commission-import';

// Mock Electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-app-data'),
  },
}));

describe('Commission Import', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create a fresh test database for each test
    db = createTestDatabase();

    // Inject test database into the database module
    setDatabase(db);
  });

  describe('Xactly CSV Import', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    const xactlySamplePath = path.join(fixturesDir, 'xactly-sample.csv');

    it('should import Xactly CSV with correct data', async () => {
      const result = await importXactlyCSV(xactlySamplePath, 'Feb 2026');

      expect(result.inserted).toBe(3);
      expect(result.updated).toBe(0);

      // Verify data in database
      const rows = db.prepare('SELECT * FROM xactly_commissions ORDER BY opportunity_number').all();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        opportunity_number: '00123456',
        customer_name: 'Acme Corporation',
        credit_type: 'New Business',
        credit_amount: 150000,
        period: 'Feb 2026',
      });
    });

    it('should parse dates correctly from MM/DD/YYYY format', async () => {
      await importXactlyCSV(xactlySamplePath, 'Feb 2026');

      const row = db.prepare('SELECT commissionable_date FROM xactly_commissions WHERE opportunity_number = ?').get('00123456') as any;
      expect(row.commissionable_date).toBe('2026-02-15');
    });

    it('should parse amounts correctly (remove commas)', async () => {
      // Create a CSV with comma-formatted amounts
      const csvWithCommas = path.join(fixturesDir, 'xactly-commas.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00999999,Test Company,02/15/2026,New Business,"1,500,000",USD`;

      fs.writeFileSync(csvWithCommas, content);

      try {
        await importXactlyCSV(csvWithCommas, 'Feb 2026');

        const row = db.prepare('SELECT credit_amount FROM xactly_commissions WHERE opportunity_number = ?').get('00999999') as any;
        expect(row.credit_amount).toBe(1500000);
      } finally {
        fs.unlinkSync(csvWithCommas);
      }
    });

    it('should handle empty fields gracefully', async () => {
      const csvWithEmpty = path.join(fixturesDir, 'xactly-empty.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00888888,,,,,USD`;

      fs.writeFileSync(csvWithEmpty, content);

      try {
        await importXactlyCSV(csvWithEmpty, 'Feb 2026');

        const row = db.prepare('SELECT * FROM xactly_commissions WHERE opportunity_number = ?').get('00888888') as any;
        expect(row.customer_name).toBe('');
        expect(row.credit_type).toBe('');
        expect(row.credit_amount).toBe(0);
        expect(row.commissionable_date).toBe('');
      } finally {
        fs.unlinkSync(csvWithEmpty);
      }
    });

    it('should skip rows with missing opportunity number', async () => {
      const csvWithMissing = path.join(fixturesDir, 'xactly-missing.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
,Test Company,02/15/2026,New Business,100000,USD
00777777,Valid Company,02/16/2026,Renewal,50000,USD`;

      fs.writeFileSync(csvWithMissing, content);

      try {
        const result = await importXactlyCSV(csvWithMissing, 'Feb 2026');

        expect(result.inserted).toBe(1);

        const rows = db.prepare('SELECT * FROM xactly_commissions').all();
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).opportunity_number).toBe('00777777');
      } finally {
        fs.unlinkSync(csvWithMissing);
      }
    });

    it('should handle duplicate imports with UPSERT (update existing)', async () => {
      // First import
      await importXactlyCSV(xactlySamplePath, 'Feb 2026');

      // Second import with updated data
      const csvUpdated = path.join(fixturesDir, 'xactly-updated.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00123456,Acme Corporation Updated,02/16/2026,New Business,175000,USD`;

      fs.writeFileSync(csvUpdated, content);

      try {
        const result = await importXactlyCSV(csvUpdated, 'Feb 2026');

        expect(result.inserted).toBe(0);
        expect(result.updated).toBe(1);

        const row = db.prepare('SELECT * FROM xactly_commissions WHERE opportunity_number = ?').get('00123456') as any;
        expect(row.customer_name).toBe('Acme Corporation Updated');
        expect(row.credit_amount).toBe(175000);
        expect(row.commissionable_date).toBe('2026-02-16');
      } finally {
        fs.unlinkSync(csvUpdated);
      }
    });

    it('should allow same opportunity with different credit types', async () => {
      const csvMultiCredit = path.join(fixturesDir, 'xactly-multi-credit.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00666666,Multi Credit Co,02/15/2026,New Business,100000,USD
00666666,Multi Credit Co,02/15/2026,Renewal,50000,USD
00666666,Multi Credit Co,02/15/2026,Upsell,25000,USD`;

      fs.writeFileSync(csvMultiCredit, content);

      try {
        const result = await importXactlyCSV(csvMultiCredit, 'Feb 2026');

        expect(result.inserted).toBe(3);

        const rows = db.prepare('SELECT * FROM xactly_commissions WHERE opportunity_number = ?').all('00666666');
        expect(rows).toHaveLength(3);
      } finally {
        fs.unlinkSync(csvMultiCredit);
      }
    });
  });

  describe('Tableau CSV Import', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    const tableauSamplePath = path.join(fixturesDir, 'tableau-sample.csv');

    it('should import Tableau CSV with correct data', async () => {
      const result = await importTableauCSV(tableauSamplePath, 'Feb 2026');

      expect(result.inserted).toBe(3);
      expect(result.updated).toBe(0);

      // Verify data in database
      const rows = db.prepare('SELECT * FROM tableau_closed_won ORDER BY opportunity_number').all();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        opportunity_number: '00123456',
        crm_opportunity_id: '0061234567890ABC',
        account_name: 'Acme Corporation',
        ae_name: 'John Smith',
        manager_name: 'Jane Doe',
        product: 'AI Agents',
        bookings: 150000,
        period: 'Feb 2026',
      });
    });

    it('should parse tab-delimited format correctly', async () => {
      await importTableauCSV(tableauSamplePath, 'Feb 2026');

      const rows = db.prepare('SELECT * FROM tableau_closed_won').all();

      // Verify all fields were parsed (tab-delimited)
      expect(rows).toHaveLength(3);
      rows.forEach((row: any) => {
        expect(row.opportunity_number).toBeTruthy();
        expect(row.account_name).toBeTruthy();
        expect(row.product).toBeTruthy();
      });
    });

    it('should parse dates from Raw Closedate field', async () => {
      await importTableauCSV(tableauSamplePath, 'Feb 2026');

      const row = db.prepare('SELECT close_date FROM tableau_closed_won WHERE opportunity_number = ?').get('00123456') as any;
      expect(row.close_date).toBe('2026-02-15');
    });

    it('should fallback to Closedate if Raw Closedate is missing', async () => {
      const csvNoRaw = path.join(fixturesDir, 'tableau-no-raw.csv');
      const content = `Crm Opportunity Id\tOPPORTUNITY_NUMBER_C\tAccount Name\tAE Name\tManager Name\tProduct\tBookings\tClosedate\tRaw Closedate
0061234567890ABC\t00555555\tFallback Co\tJohn Doe\tJane Doe\tAI Agents\t100000\t2/10/2026\t`;

      fs.writeFileSync(csvNoRaw, content);

      try {
        await importTableauCSV(csvNoRaw, 'Feb 2026');

        const row = db.prepare('SELECT close_date FROM tableau_closed_won WHERE opportunity_number = ?').get('00555555') as any;
        expect(row.close_date).toBe('2026-02-10');
      } finally {
        fs.unlinkSync(csvNoRaw);
      }
    });

    it('should parse bookings amounts correctly', async () => {
      await importTableauCSV(tableauSamplePath, 'Feb 2026');

      const row = db.prepare('SELECT bookings FROM tableau_closed_won WHERE opportunity_number = ?').get('00123458') as any;
      expect(row.bookings).toBe(250000);
    });

    it('should handle null bytes in data', async () => {
      const csvWithNulls = path.join(fixturesDir, 'tableau-nulls.csv');
      // Simulate null bytes in column names and values
      const content = `Crm Opportunity Id\u0000\tOPPORTUNITY_NUMBER_C\tAccount Name\u0000\tAE Name\tManager Name\tProduct\tBookings\tClosedate\tRaw Closedate
0061234567890ABC\t00444444\tNull\u0000Byte\u0000Co\tJohn Doe\tJane Doe\tAI Agents\t100000\t2/10/2026\t02/10/2026`;

      fs.writeFileSync(csvWithNulls, content);

      try {
        const result = await importTableauCSV(csvWithNulls, 'Feb 2026');

        expect(result.inserted).toBe(1);

        const row = db.prepare('SELECT * FROM tableau_closed_won WHERE opportunity_number = ?').get('00444444') as any;
        expect(row.account_name).toBe('NullByteCo'); // Null bytes removed
      } finally {
        fs.unlinkSync(csvWithNulls);
      }
    });

    it('should handle duplicate imports with UPSERT (update existing)', async () => {
      // First import
      await importTableauCSV(tableauSamplePath, 'Feb 2026');

      // Second import with updated data
      const csvUpdated = path.join(fixturesDir, 'tableau-updated.csv');
      const content = `Crm Opportunity Id\tOPPORTUNITY_NUMBER_C\tAccount Name\tAE Name\tManager Name\tProduct\tBookings\tClosedate\tRaw Closedate
0061234567890ABC\t00123456\tAcme Corporation Updated\tJohn Smith Jr\tJane Doe\tAI Agents\t175000\t2/16/2026\t02/16/2026`;

      fs.writeFileSync(csvUpdated, content);

      try {
        const result = await importTableauCSV(csvUpdated, 'Feb 2026');

        expect(result.inserted).toBe(0);
        expect(result.updated).toBe(1);

        const row = db.prepare('SELECT * FROM tableau_closed_won WHERE opportunity_number = ? AND product = ?').get('00123456', 'AI Agents') as any;
        expect(row.account_name).toBe('Acme Corporation Updated');
        expect(row.ae_name).toBe('John Smith Jr');
        expect(row.bookings).toBe(175000);
      } finally {
        fs.unlinkSync(csvUpdated);
      }
    });

    it('should allow same opportunity with different products', async () => {
      const csvMultiProduct = path.join(fixturesDir, 'tableau-multi-product.csv');
      const content = `Crm Opportunity Id\tOPPORTUNITY_NUMBER_C\tAccount Name\tAE Name\tManager Name\tProduct\tBookings\tClosedate\tRaw Closedate
0061234567890ABC\t00333333\tMulti Product Co\tJohn Doe\tJane Doe\tAI Agents\t100000\t2/15/2026\t02/15/2026
0061234567890ABC\t00333333\tMulti Product Co\tJohn Doe\tJane Doe\tCopilot\t50000\t2/15/2026\t02/15/2026
0061234567890ABC\t00333333\tMulti Product Co\tJohn Doe\tJane Doe\tQA\t25000\t2/15/2026\t02/15/2026`;

      fs.writeFileSync(csvMultiProduct, content);

      try {
        const result = await importTableauCSV(csvMultiProduct, 'Feb 2026');

        expect(result.inserted).toBe(3);

        const rows = db.prepare('SELECT * FROM tableau_closed_won WHERE opportunity_number = ?').all('00333333');
        expect(rows).toHaveLength(3);
      } finally {
        fs.unlinkSync(csvMultiProduct);
      }
    });

    it('should skip rows with missing OPPORTUNITY_NUMBER_C', async () => {
      const csvWithMissing = path.join(fixturesDir, 'tableau-missing.csv');
      const content = `Crm Opportunity Id\tOPPORTUNITY_NUMBER_C\tAccount Name\tAE Name\tManager Name\tProduct\tBookings\tClosedate\tRaw Closedate
0061234567890ABC\t\tMissing Opp Number\tJohn Doe\tJane Doe\tAI Agents\t100000\t2/15/2026\t02/15/2026
0061234567890DEF\t00222222\tValid Company\tBob Smith\tJane Doe\tCopilot\t50000\t2/16/2026\t02/16/2026`;

      fs.writeFileSync(csvWithMissing, content);

      try {
        const result = await importTableauCSV(csvWithMissing, 'Feb 2026');

        expect(result.inserted).toBe(1);

        const rows = db.prepare('SELECT * FROM tableau_closed_won').all();
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).opportunity_number).toBe('00222222');
      } finally {
        fs.unlinkSync(csvWithMissing);
      }
    });
  });

  describe('Reconciliation Scenarios', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');

    it('should allow querying matching records between Xactly and Tableau', async () => {
      // Import both datasets
      await importXactlyCSV(path.join(fixturesDir, 'xactly-sample.csv'), 'Feb 2026');
      await importTableauCSV(path.join(fixturesDir, 'tableau-sample.csv'), 'Feb 2026');

      // Query for matching records
      const matches = db.prepare(`
        SELECT
          x.opportunity_number,
          x.credit_amount as xactly_amount,
          t.bookings as tableau_amount
        FROM xactly_commissions x
        INNER JOIN tableau_closed_won t ON x.opportunity_number = t.opportunity_number
        WHERE x.period = ? AND t.period = ?
      `).all('Feb 2026', 'Feb 2026');

      expect(matches.length).toBeGreaterThan(0);
    });

    it('should detect missing records in Xactly (exists in Tableau)', async () => {
      // Import Tableau data
      await importTableauCSV(path.join(fixturesDir, 'tableau-sample.csv'), 'Feb 2026');

      // Import limited Xactly data (missing one record)
      const csvLimited = path.join(fixturesDir, 'xactly-limited.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00123456,Acme Corporation,02/15/2026,New Business,150000,USD`;

      fs.writeFileSync(csvLimited, content);

      try {
        await importXactlyCSV(csvLimited, 'Feb 2026');

        // Query for records in Tableau but not in Xactly
        const missingInXactly = db.prepare(`
          SELECT t.opportunity_number, t.account_name
          FROM tableau_closed_won t
          LEFT JOIN xactly_commissions x ON t.opportunity_number = x.opportunity_number AND t.period = x.period
          WHERE t.period = ? AND x.opportunity_number IS NULL
        `).all('Feb 2026');

        expect(missingInXactly).toHaveLength(2); // 00123457 and 00123458 missing
      } finally {
        fs.unlinkSync(csvLimited);
      }
    });

    it('should detect amount variances between Xactly and Tableau', async () => {
      // Import Tableau data
      await importTableauCSV(path.join(fixturesDir, 'tableau-sample.csv'), 'Feb 2026');

      // Import Xactly with different amounts
      const csvVariance = path.join(fixturesDir, 'xactly-variance.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00123456,Acme Corporation,02/15/2026,New Business,140000,USD
00123457,Beta Industries,02/20/2026,Renewal,75000,USD`;

      fs.writeFileSync(csvVariance, content);

      try {
        await importXactlyCSV(csvVariance, 'Feb 2026');

        // Query for amount variances
        const variances = db.prepare(`
          SELECT
            x.opportunity_number,
            x.credit_amount as xactly_amount,
            t.bookings as tableau_amount,
            ABS(x.credit_amount - t.bookings) as variance
          FROM xactly_commissions x
          INNER JOIN tableau_closed_won t ON x.opportunity_number = t.opportunity_number
          WHERE x.period = ? AND t.period = ? AND x.credit_amount != t.bookings
        `).all('Feb 2026', 'Feb 2026');

        expect(variances).toHaveLength(1);
        expect((variances[0] as any).opportunity_number).toBe('00123456');
        expect((variances[0] as any).variance).toBe(10000); // 150000 - 140000
      } finally {
        fs.unlinkSync(csvVariance);
      }
    });

    it('should support period-based filtering for reconciliation', async () => {
      // Import data for Feb 2026
      await importXactlyCSV(path.join(fixturesDir, 'xactly-sample.csv'), 'Feb 2026');
      await importTableauCSV(path.join(fixturesDir, 'tableau-sample.csv'), 'Feb 2026');

      // Import data for Mar 2026
      const csvMar = path.join(fixturesDir, 'xactly-mar.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount,Credit Amount Unit Type
00999999,March Company,03/15/2026,New Business,100000,USD`;

      fs.writeFileSync(csvMar, content);

      try {
        await importXactlyCSV(csvMar, 'Mar 2026');

        // Query Feb 2026 only
        const febRows = db.prepare('SELECT * FROM xactly_commissions WHERE period = ?').all('Feb 2026');
        expect(febRows).toHaveLength(3);

        // Query Mar 2026 only
        const marRows = db.prepare('SELECT * FROM xactly_commissions WHERE period = ?').all('Mar 2026');
        expect(marRows).toHaveLength(1);
      } finally {
        fs.unlinkSync(csvMar);
      }
    });
  });

  describe('Error Handling', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');

    it('should reject non-existent file paths', async () => {
      await expect(
        importXactlyCSV('/nonexistent/file.csv', 'Feb 2026')
      ).rejects.toThrow();
    });

    it('should handle malformed CSV gracefully', async () => {
      const csvMalformed = path.join(fixturesDir, 'xactly-malformed.csv');
      const content = `# Opportunity Number,Customer Name,Commissionable Date,Credit Type,Credit Amount
00111111,"Unclosed Quote Company,02/15/2026,New Business,100000`;

      fs.writeFileSync(csvMalformed, content);

      try {
        // Should still parse what it can (PapaParse is forgiving)
        const result = await importXactlyCSV(csvMalformed, 'Feb 2026');

        // PapaParse will attempt to parse even malformed data
        // The test verifies it doesn't crash the import process
        expect(result).toBeDefined();
      } finally {
        fs.unlinkSync(csvMalformed);
      }
    });
  });
});
