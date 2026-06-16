import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase, resetTestDatabase } from './testDatabase';
import type Database from 'better-sqlite3';

describe('testDatabase', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDatabase();
  });

  describe('createTestDatabase', () => {
    it('should create an in-memory database', () => {
      // Arrange & Act
      const testDb = createTestDatabase();

      // Assert
      expect(testDb).toBeDefined();
      expect(testDb.memory).toBe(true);
    });

    it('should create accounts table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('account_name');
      expect(result?.sql).toContain('arr');
      expect(result?.sql).toContain('num_agents');
      expect(result?.sql).toContain('renewal_date');
    });

    it('should create notification_log table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notification_log'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('account_id');
      expect(result?.sql).toContain('notification_type');
      expect(result?.sql).toContain('sent_at');
    });

    it('should create settings table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('key');
      expect(result?.sql).toContain('value');
    });

    it('should create forecast_opps table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='forecast_opps'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
      expect(result?.sql).toContain('account_name');
      expect(result?.sql).toContain('product');
      expect(result?.sql).toContain('UNIQUE(crm_opportunity_id, product)');
    });

    it('should create closed_won_opps table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='closed_won_opps'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
      expect(result?.sql).toContain('bookings');
      expect(result?.sql).toContain('UNIQUE(crm_opportunity_id, product)');
    });

    it('should create closed_lost_opps table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='closed_lost_opps'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
      expect(result?.sql).toContain('bookings');
    });

    it('should create quotas table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='quotas'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('ai_ae');
      expect(result?.sql).toContain('quota');
    });

    it('should create forecast_changes table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='forecast_changes'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
      expect(result?.sql).toContain('change_type');
    });

    it('should create import_history table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='import_history'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('imported_at');
      expect(result?.sql).toContain('source_type');
    });

    it('should create pipeline_snapshots table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pipeline_snapshots'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('snapshot_data');
      expect(result?.sql).toContain('total_pipeline');
    });

    it('should create closed_won_snapshots table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='closed_won_snapshots'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('snapshot_data');
      expect(result?.sql).toContain('total_bookings');
    });

    it('should create excluded_deals table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='excluded_deals'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
    });

    it('should create xactly_commissions table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='xactly_commissions'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('opportunity_number');
      expect(result?.sql).toContain('credit_amount');
    });

    it('should create tableau_closed_won table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tableau_closed_won'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('opportunity_number');
      expect(result?.sql).toContain('bookings');
    });

    it('should create commission_issues table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='commission_issues'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('issue_type');
      expect(result?.sql).toContain('variance');
    });

    it('should create commission_investigations table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='commission_investigations'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('opportunity_number');
      expect(result?.sql).toContain('status');
    });

    it('should create deal_backed_reasons table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='deal_backed_reasons'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('crm_opportunity_id');
      expect(result?.sql).toContain('reason');
    });

    it('should create weekly_notes table with correct schema', () => {
      // Arrange & Act
      const result = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='weekly_notes'")
        .get() as { sql: string } | undefined;

      // Assert
      expect(result).toBeDefined();
      expect(result?.sql).toContain('week_start');
      expect(result?.sql).toContain('region');
    });

    it('should allow inserting and querying data', () => {
      // Arrange
      const insertStmt = db.prepare(`
        INSERT INTO accounts (account_name, arr, num_agents, renewal_date, account_owner)
        VALUES (?, ?, ?, ?, ?)
      `);

      // Act
      insertStmt.run('Test Account', 100000, 50, '2025-12-31', 'John Doe');
      const result = db
        .prepare('SELECT * FROM accounts WHERE account_name = ?')
        .get('Test Account') as any;

      // Assert
      expect(result).toBeDefined();
      expect(result.account_name).toBe('Test Account');
      expect(result.arr).toBe(100000);
      expect(result.num_agents).toBe(50);
    });
  });

  describe('resetTestDatabase', () => {
    it('should clear all data from accounts table', () => {
      // Arrange
      db.prepare(`
        INSERT INTO accounts (account_name, arr, num_agents, renewal_date, account_owner)
        VALUES (?, ?, ?, ?, ?)
      `).run('Test Account', 100000, 50, '2025-12-31', 'John Doe');

      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
      expect(beforeCount.count).toBe(1);

      // Act
      resetTestDatabase(db);

      // Assert
      const afterCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
      expect(afterCount.count).toBe(0);
    });

    it('should clear all data from forecast_opps table', () => {
      // Arrange
      db.prepare(`
        INSERT INTO forecast_opps (crm_opportunity_id, account_name, product)
        VALUES (?, ?, ?)
      `).run('OPP-001', 'Test Account', 'AI Agents');

      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM forecast_opps').get() as { count: number };
      expect(beforeCount.count).toBe(1);

      // Act
      resetTestDatabase(db);

      // Assert
      const afterCount = db.prepare('SELECT COUNT(*) as count FROM forecast_opps').get() as { count: number };
      expect(afterCount.count).toBe(0);
    });

    it('should clear data from all tables', () => {
      // Arrange
      db.prepare(`INSERT INTO accounts (account_name, arr, num_agents, renewal_date) VALUES (?, ?, ?, ?)`).run('Account 1', 50000, 10, '2025-06-30');
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('test_key', 'test_value');
      db.prepare(`INSERT INTO forecast_opps (crm_opportunity_id, account_name, product) VALUES (?, ?, ?)`).run('OPP-001', 'Account 1', 'AI Agents');
      db.prepare(`INSERT INTO quotas (ai_ae, quota) VALUES (?, ?)`).run('AE-001', 500000);

      // Act
      resetTestDatabase(db);

      // Assert
      const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
      const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
      const forecastCount = db.prepare('SELECT COUNT(*) as count FROM forecast_opps').get() as { count: number };
      const quotaCount = db.prepare('SELECT COUNT(*) as count FROM quotas').get() as { count: number };

      expect(accountCount.count).toBe(0);
      expect(settingsCount.count).toBe(0);
      expect(forecastCount.count).toBe(0);
      expect(quotaCount.count).toBe(0);
    });

    it('should maintain table structure after reset', () => {
      // Arrange
      db.prepare(`INSERT INTO accounts (account_name, arr, num_agents, renewal_date) VALUES (?, ?, ?, ?)`).run('Account 1', 50000, 10, '2025-06-30');
      resetTestDatabase(db);

      // Act - Insert after reset should work
      db.prepare(`INSERT INTO accounts (account_name, arr, num_agents, renewal_date) VALUES (?, ?, ?, ?)`).run('Account 2', 75000, 15, '2025-09-30');
      const result = db.prepare('SELECT * FROM accounts WHERE account_name = ?').get('Account 2') as any;

      // Assert
      expect(result).toBeDefined();
      expect(result.account_name).toBe('Account 2');
      expect(result.arr).toBe(75000);
    });
  });
});
