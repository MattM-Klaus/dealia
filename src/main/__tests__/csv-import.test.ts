import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  importCsvFile,
  parseRenewalQtr,
  parseDate,
  parseARR,
  isYes,
  parseCurrentProducts,
  parseTargetProducts,
  buildNotes,
} from '../csv-import';
import { setDatabase } from '../database';
import { createTestDatabase, resetTestDatabase } from './helpers/testDatabase';
import type Database from 'better-sqlite3';

describe('CSV Import - Helper Functions', () => {
  describe('parseRenewalQtr', () => {
    it('should parse 2027Q1 format to 2027-03-31', () => {
      const result = parseRenewalQtr('2027Q1');
      expect(result).toBe('2027-03-31');
    });

    it('should parse 2026Q3 format to 2026-09-30', () => {
      const result = parseRenewalQtr('2026Q3');
      expect(result).toBe('2026-09-30');
    });

    it('should parse Q1 2027 format to 2027-03-31', () => {
      const result = parseRenewalQtr('Q1 2027');
      expect(result).toBe('2027-03-31');
    });

    it('should parse Q2 FY27 format to 2027-06-30', () => {
      const result = parseRenewalQtr('Q2 FY27');
      expect(result).toBe('2027-06-30');
    });

    it('should parse Q4 format to December 31', () => {
      const result = parseRenewalQtr('2026Q4');
      expect(result).toBe('2026-12-31');
    });

    it('should fallback to date parsing for valid date strings', () => {
      const result = parseRenewalQtr('2027-05-15');
      expect(result).toBe('2027-05-15');
    });

    it('should return null for invalid quarter format', () => {
      const result = parseRenewalQtr('invalid');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseRenewalQtr('');
      expect(result).toBeNull();
    });
  });

  describe('parseDate', () => {
    it('should parse ISO date format', () => {
      const result = parseDate('2027-03-15');
      expect(result).toBe('2027-03-15');
    });

    it('should parse US date format', () => {
      const result = parseDate('03/15/2027');
      expect(result).toBe('2027-03-15');
    });

    it('should return null for invalid date', () => {
      const result = parseDate('invalid date');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseDate('');
      expect(result).toBeNull();
    });
  });

  describe('parseARR', () => {
    it('should parse plain number', () => {
      const result = parseARR('50000');
      expect(result).toBe(50000);
    });

    it('should parse number with dollar sign', () => {
      const result = parseARR('$50000');
      expect(result).toBe(50000);
    });

    it('should parse number with commas', () => {
      const result = parseARR('50,000');
      expect(result).toBe(50000);
    });

    it('should parse number with dollar sign and commas', () => {
      const result = parseARR('$50,000.50');
      expect(result).toBe(50000.5);
    });

    it('should parse number with spaces', () => {
      const result = parseARR('$ 50 000');
      expect(result).toBe(50000);
    });

    it('should return 0 for invalid number', () => {
      const result = parseARR('invalid');
      expect(result).toBe(0);
    });

    it('should return 0 for empty string', () => {
      const result = parseARR('');
      expect(result).toBe(0);
    });
  });

  describe('isYes', () => {
    it('should return true for "yes"', () => {
      expect(isYes('yes')).toBe(true);
    });

    it('should return true for "YES"', () => {
      expect(isYes('YES')).toBe(true);
    });

    it('should return true for " yes " with spaces', () => {
      expect(isYes(' yes ')).toBe(true);
    });

    it('should return false for "no"', () => {
      expect(isYes('no')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isYes('')).toBe(false);
    });

    it('should return false for "Y"', () => {
      expect(isYes('Y')).toBe(false);
    });
  });

  describe('parseCurrentProducts', () => {
    it('should parse AI Agents from has_aiaa=yes', () => {
      const row = { has_aiaa: 'yes', has_copilot: 'no', has_qa_or_wem: 'no' };
      const result = parseCurrentProducts(row);
      expect(result).toEqual(['AI Agents']);
    });

    it('should parse multiple products', () => {
      const row = { has_aiaa: 'yes', has_copilot: 'yes', has_qa_or_wem: 'yes' };
      const result = parseCurrentProducts(row);
      expect(result).toEqual(['AI Agents', 'Copilot', 'QA']);
    });

    it('should return empty array when all flags are no', () => {
      const row = { has_aiaa: 'no', has_copilot: 'no', has_qa_or_wem: 'no' };
      const result = parseCurrentProducts(row);
      expect(result).toEqual([]);
    });

    it('should handle missing fields', () => {
      const row = {};
      const result = parseCurrentProducts(row);
      expect(result).toEqual([]);
    });
  });

  describe('parseTargetProducts', () => {
    it('should parse AI Agents from text containing "ai agent"', () => {
      const result = parseTargetProducts('AI Agent expansion');
      expect(result).toContain('AI Agents');
    });

    it('should parse Copilot from text', () => {
      const result = parseTargetProducts('Copilot, QA/WEM');
      expect(result).toContain('Copilot');
    });

    it('should parse QA from "qa" in text', () => {
      const result = parseTargetProducts('QA/WEM');
      expect(result).toContain('QA');
    });

    it('should parse multiple products from combined text', () => {
      const result = parseTargetProducts('Copilot, AI Agent, QA');
      expect(result).toEqual(['AI Agents', 'Copilot', 'QA']);
    });

    it('should return empty array for empty string', () => {
      const result = parseTargetProducts('');
      expect(result).toEqual([]);
    });

    it('should handle case insensitivity', () => {
      const result = parseTargetProducts('COPILOT, AIAA');
      expect(result).toContain('Copilot');
      expect(result).toContain('AI Agents');
    });
  });

  describe('buildNotes', () => {
    it('should build notes from multiple fields', () => {
      const row = {
        territory_name_sfdc: 'West',
        segmentation: 'Enterprise',
        urgency: 'High',
      };
      const result = buildNotes(row);
      expect(result).toContain('Territory: West');
      expect(result).toContain('Segmentation: Enterprise');
      expect(result).toContain('Urgency: High');
    });

    it('should skip empty fields', () => {
      const row = {
        territory_name_sfdc: 'West',
        segmentation: '',
        urgency: 'High',
      };
      const result = buildNotes(row);
      expect(result).toContain('Territory: West');
      expect(result).not.toContain('Segmentation');
      expect(result).toContain('Urgency: High');
    });

    it('should return empty string when no fields present', () => {
      const row = {};
      const result = buildNotes(row);
      expect(result).toBe('');
    });
  });
});

describe('CSV Import - Integration Tests', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(() => {
    // Create test database
    db = createTestDatabase();
    setDatabase(db);

    // Create temp directory for test CSV files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-import-test-'));
  });

  afterEach(() => {
    // Clean up test database
    resetTestDatabase(db);
    db.close();

    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('importCsvFile', () => {
    it('should import valid CSV with all required fields', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Next Renewal Date,AE Name,AE Manager,Has AIAA,Has Copilot,Has QA or WEM,Matched Segment(s),SFDC Link,CRM Account ID
Acme Corp,$50000,100,2027-03-31,John Doe,Jane Smith,yes,no,no,AI Agent,https://salesforce.com/account/123,ACC123`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);

      // Verify account was inserted
      const account = db
        .prepare('SELECT * FROM accounts WHERE account_name = ?')
        .get('Acme Corp') as any;
      expect(account).toBeDefined();
      expect(account.arr).toBe(50000);
      expect(account.num_agents).toBe(100);
      expect(account.renewal_date).toBe('2027-03-31');
      expect(account.account_owner).toBe('John Doe');
      expect(account.ae_manager).toBe('Jane Smith');
      expect(account.crm_account_id).toBe('ACC123');
      expect(JSON.parse(account.products)).toEqual(['AI Agents']);
      expect(JSON.parse(account.target_products)).toEqual(['AI Agents']);
    });

    it('should update existing account when CRM ID matches', () => {
      // Arrange - insert initial account
      const csvContent1 = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name,AE Manager,Has AIAA,Has Copilot,Has QA or WEM,Matched Segment(s),SFDC Link,CRM Account ID
Acme Corp,$50000,100,2027Q1,John Doe,Jane Smith,yes,no,no,AI Agent,https://salesforce.com/account/123,ACC123`;
      const csvPath1 = path.join(tempDir, 'test1.csv');
      fs.writeFileSync(csvPath1, csvContent1);
      importCsvFile(csvPath1);

      // Act - import updated data with same CRM ID
      const csvContent2 = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name,AE Manager,Has AIAA,Has Copilot,Has QA or WEM,Matched Segment(s),SFDC Link,CRM Account ID
Acme Corp Updated,$75000,150,2027Q2,John Smith,Jane Doe,yes,yes,no,AI Agent,https://salesforce.com/account/123,ACC123`;
      const csvPath2 = path.join(tempDir, 'test2.csv');
      fs.writeFileSync(csvPath2, csvContent2);
      const result = importCsvFile(csvPath2);

      // Assert
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);

      // Verify account was updated
      const account = db
        .prepare('SELECT * FROM accounts WHERE crm_account_id = ?')
        .get('ACC123') as any;
      expect(account.account_name).toBe('Acme Corp Updated');
      expect(account.arr).toBe(75000);
      expect(account.num_agents).toBe(150);
      expect(account.renewal_date).toBe('2027-06-30');
      expect(JSON.parse(account.products)).toEqual(['AI Agents', 'Copilot']);
    });

    it('should handle quarter-based renewal dates', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name,Has AIAA,Has Copilot,Has QA or WEM
Test Company,$25000,50,Q3 2027,Alice Johnson,no,yes,no`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(1);
      const account = db
        .prepare('SELECT * FROM accounts WHERE account_name = ?')
        .get('Test Company') as any;
      expect(account.renewal_date).toBe('2027-09-30');
    });

    it('should fail when account name is missing', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name
,$50000,100,2027Q1,John Doe`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Missing Account Name');
    });

    it('should fail when renewal date is missing or invalid', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Next Renewal Date,Renewal Qtr,AE Name
Test Company,$50000,100,,,John Doe`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Missing or invalid renewal date');
    });

    it('should handle empty CSV file', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should import multiple accounts in one CSV', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name,Has AIAA,Has Copilot,Has QA or WEM
Company A,$50000,100,2027Q1,John Doe,yes,no,no
Company B,$75000,150,2027Q2,Jane Smith,no,yes,yes
Company C,$100000,200,2027Q3,Bob Johnson,yes,yes,no`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(3);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);

      // Verify all accounts were inserted
      const accounts = db.prepare('SELECT * FROM accounts').all();
      expect(accounts).toHaveLength(3);
    });

    it('should handle partial failures without stopping import', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name
Company A,$50000,100,2027Q1,John Doe
,$75000,150,2027Q2,Jane Smith
Company C,$100000,200,2027Q3,Bob Johnson`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);

      // Verify successful accounts were inserted
      const accounts = db.prepare('SELECT * FROM accounts').all();
      expect(accounts).toHaveLength(2);
    });

    it('should parse all product combinations correctly', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR,Seats,Renewal Qtr,AE Name,Has AIAA,Has Copilot,Has QA or WEM,Matched Segment(s)
All Products,$50000,100,2027Q1,John Doe,yes,yes,yes,AI Agent Copilot QA`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert
      expect(result.inserted).toBe(1);
      const account = db
        .prepare('SELECT * FROM accounts WHERE account_name = ?')
        .get('All Products') as any;
      expect(JSON.parse(account.products)).toEqual(['AI Agents', 'Copilot', 'QA']);
      expect(JSON.parse(account.target_products)).toEqual([
        'AI Agents',
        'Copilot',
        'QA',
      ]);
    });

    it('should handle malformed CSV gracefully', () => {
      // Arrange
      const csvContent = `Account Name,Account ARR
"Unclosed Quote Company,$50000
Normal Company,$75000,100,2027Q1,John Doe`;
      const csvPath = path.join(tempDir, 'test.csv');
      fs.writeFileSync(csvPath, csvContent);

      // Act
      const result = importCsvFile(csvPath);

      // Assert - papaparse handles malformed CSV, so this should still parse
      expect(result.inserted + result.failed).toBeGreaterThan(0);
    });
  });
});
