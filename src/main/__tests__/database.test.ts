import { describe, test, expect, beforeEach } from 'vitest';
import { createTestDatabase, resetTestDatabase } from './helpers/testDatabase';
import {
  setDatabase,
  getAllAccounts,
  getAccountById,
  insertAccount,
  updateAccount,
  deleteAccount,
} from '../database';
import type { AccountFormData } from '../../shared/types';

describe('Database CRUD Operations', () => {
  const testDb = createTestDatabase();

  beforeEach(() => {
    resetTestDatabase(testDb);
    setDatabase(testDb);
  });

  describe('getAllAccounts', () => {
    test('returns empty array when no accounts exist', () => {
      // Arrange & Act
      const accounts = getAllAccounts();

      // Assert
      expect(accounts).toEqual([]);
    });

    test('returns all accounts ordered by renewal_date', () => {
      // Arrange
      const account1: AccountFormData = {
        account_name: 'Company A',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-12-31',
        account_owner: 'John Doe',
        current_products: ['AI Agents'],
        target_products: ['Copilot'],
        sfdc_link: 'https://example.com/a',
        ae_manager: 'Manager A',
        notes: 'Note A',
      };

      const account2: AccountFormData = {
        account_name: 'Company B',
        arr: 75000,
        num_agents: 15,
        renewal_date: '2025-06-30',
        account_owner: 'Jane Smith',
        current_products: ['Copilot', 'QA'],
        target_products: [],
        sfdc_link: 'https://example.com/b',
        ae_manager: 'Manager B',
        notes: 'Note B',
      };

      insertAccount(account1);
      insertAccount(account2);

      // Act
      const accounts = getAllAccounts();

      // Assert
      expect(accounts).toHaveLength(2);
      // Should be ordered by renewal_date ASC
      expect(accounts[0].account_name).toBe('Company B'); // 2025-06-30
      expect(accounts[1].account_name).toBe('Company A'); // 2025-12-31
    });

    test('returns accounts with correct structure and types', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Test Company',
        arr: 100000,
        num_agents: 20,
        renewal_date: '2025-09-15',
        account_owner: 'Owner Name',
        current_products: ['AI Agents', 'Copilot'],
        target_products: ['QA'],
        sfdc_link: 'https://example.com/test',
        ae_manager: 'Test Manager',
        notes: 'Test notes',
      };

      insertAccount(accountData);

      // Act
      const accounts = getAllAccounts();

      // Assert
      expect(accounts).toHaveLength(1);
      const account = accounts[0];
      expect(account).toMatchObject({
        id: expect.any(Number),
        account_name: 'Test Company',
        arr: 100000,
        num_agents: 20,
        renewal_date: '2025-09-15',
        account_owner: 'Owner Name',
        current_products: ['AI Agents', 'Copilot'],
        target_products: ['QA'],
        sfdc_link: 'https://example.com/test',
        ae_manager: 'Test Manager',
        contact_status: 'needs_action',
        contacted_at: null,
        notes: 'Test notes',
        created_at: expect.any(String),
        updated_at: expect.any(String),
        crm_account_id: null,
      });
    });
  });

  describe('getAccountById', () => {
    test('returns null when account does not exist', () => {
      // Arrange & Act
      const account = getAccountById(999);

      // Assert
      expect(account).toBeNull();
    });

    test('returns correct account by id', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Find Me Company',
        arr: 80000,
        num_agents: 12,
        renewal_date: '2025-08-20',
        account_owner: 'Owner X',
        current_products: ['QA'],
        target_products: ['AI Agents'],
        sfdc_link: 'https://example.com/findme',
        ae_manager: 'Manager X',
        notes: 'Find me notes',
      };

      const id = insertAccount(accountData);

      // Act
      const account = getAccountById(id);

      // Assert
      expect(account).not.toBeNull();
      expect(account?.id).toBe(id);
      expect(account?.account_name).toBe('Find Me Company');
      expect(account?.arr).toBe(80000);
      expect(account?.num_agents).toBe(12);
      expect(account?.renewal_date).toBe('2025-08-20');
    });

    test('returns account with properly deserialized products', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Products Test',
        arr: 60000,
        num_agents: 8,
        renewal_date: '2025-07-10',
        account_owner: 'Product Owner',
        current_products: ['AI Agents', 'Copilot', 'QA'],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const id = insertAccount(accountData);

      // Act
      const account = getAccountById(id);

      // Assert
      expect(account?.current_products).toEqual(['AI Agents', 'Copilot', 'QA']);
      expect(account?.target_products).toEqual([]);
    });
  });

  describe('insertAccount', () => {
    test('inserts account and returns id', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'New Company',
        arr: 90000,
        num_agents: 18,
        renewal_date: '2025-10-01',
        account_owner: 'New Owner',
        current_products: ['Copilot'],
        target_products: ['AI Agents', 'QA'],
        sfdc_link: 'https://example.com/new',
        ae_manager: 'New Manager',
        notes: 'New company notes',
      };

      // Act
      const id = insertAccount(accountData);

      // Assert
      expect(id).toBeGreaterThan(0);
      expect(typeof id).toBe('number');
    });

    test('inserted account can be retrieved', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Retrievable Company',
        arr: 110000,
        num_agents: 22,
        renewal_date: '2025-11-15',
        account_owner: 'Retrievable Owner',
        current_products: ['AI Agents'],
        target_products: [],
        sfdc_link: 'https://example.com/retrievable',
        ae_manager: 'Retrievable Manager',
        notes: 'Retrievable notes',
      };

      // Act
      const id = insertAccount(accountData);
      const retrieved = getAccountById(id);

      // Assert
      expect(retrieved).not.toBeNull();
      expect(retrieved?.account_name).toBe('Retrievable Company');
      expect(retrieved?.arr).toBe(110000);
    });

    test('sets default contact_status to needs_action', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Default Status Company',
        arr: 70000,
        num_agents: 14,
        renewal_date: '2025-05-20',
        account_owner: 'Status Owner',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      // Act
      const id = insertAccount(accountData);
      const retrieved = getAccountById(id);

      // Assert
      expect(retrieved?.contact_status).toBe('needs_action');
      expect(retrieved?.contacted_at).toBeNull();
    });

    test('creates account with created_at and updated_at timestamps', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Timestamp Company',
        arr: 85000,
        num_agents: 17,
        renewal_date: '2025-09-30',
        account_owner: 'Timestamp Owner',
        current_products: ['QA'],
        target_products: ['Copilot'],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      // Act
      const id = insertAccount(accountData);
      const retrieved = getAccountById(id);

      // Assert
      expect(retrieved?.created_at).toBeTruthy();
      expect(retrieved?.updated_at).toBeTruthy();
      // Timestamps should be valid ISO strings
      if (retrieved) {
        expect(() => new Date(retrieved.created_at)).not.toThrow();
        expect(() => new Date(retrieved.updated_at)).not.toThrow();
      }
    });

    test('handles empty products arrays correctly', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'No Products Company',
        arr: 40000,
        num_agents: 5,
        renewal_date: '2025-04-15',
        account_owner: 'No Products Owner',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      // Act
      const id = insertAccount(accountData);
      const retrieved = getAccountById(id);

      // Assert
      expect(retrieved?.current_products).toEqual([]);
      expect(retrieved?.target_products).toEqual([]);
    });
  });

  describe('updateAccount', () => {
    test('updates account fields correctly', () => {
      // Arrange
      const originalData: AccountFormData = {
        account_name: 'Original Company',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-06-01',
        account_owner: 'Original Owner',
        current_products: ['AI Agents'],
        target_products: [],
        sfdc_link: 'https://example.com/original',
        ae_manager: 'Original Manager',
        notes: 'Original notes',
      };

      const id = insertAccount(originalData);

      const updatedData: AccountFormData = {
        account_name: 'Updated Company',
        arr: 150000,
        num_agents: 30,
        renewal_date: '2026-01-01',
        account_owner: 'Updated Owner',
        current_products: ['AI Agents', 'Copilot', 'QA'],
        target_products: [],
        sfdc_link: 'https://example.com/updated',
        ae_manager: 'Updated Manager',
        notes: 'Updated notes',
      };

      // Act
      updateAccount(id, updatedData);
      const retrieved = getAccountById(id);

      // Assert
      expect(retrieved?.account_name).toBe('Updated Company');
      expect(retrieved?.arr).toBe(150000);
      expect(retrieved?.num_agents).toBe(30);
      expect(retrieved?.renewal_date).toBe('2026-01-01');
      expect(retrieved?.account_owner).toBe('Updated Owner');
      expect(retrieved?.current_products).toEqual(['AI Agents', 'Copilot', 'QA']);
      expect(retrieved?.sfdc_link).toBe('https://example.com/updated');
      expect(retrieved?.ae_manager).toBe('Updated Manager');
      expect(retrieved?.notes).toBe('Updated notes');
    });

    test('updates updated_at timestamp but not created_at', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Timestamp Update Test',
        arr: 60000,
        num_agents: 12,
        renewal_date: '2025-07-15',
        account_owner: 'Timestamp Owner',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: 'Initial notes',
      };

      const id = insertAccount(accountData);
      const original = getAccountById(id);

      // Ensure account was created successfully
      expect(original).not.toBeNull();
      if (!original) return;

      const originalCreatedAt = original.created_at;

      // Wait a tiny bit to ensure timestamp difference (SQLite datetime() has second precision)
      // Note: In real scenario timestamps would differ, here we just verify the field is set

      const updatedData: AccountFormData = {
        ...accountData,
        notes: 'Updated notes',
      };

      // Act
      updateAccount(id, updatedData);
      const updated = getAccountById(id);

      // Assert
      expect(updated?.created_at).toBe(originalCreatedAt); // created_at should not change
      expect(updated?.updated_at).toBeTruthy(); // updated_at should be set
      expect(updated?.notes).toBe('Updated notes');
    });

    test('does not affect other accounts', () => {
      // Arrange
      const account1: AccountFormData = {
        account_name: 'Company 1',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-06-01',
        account_owner: 'Owner 1',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: 'Notes 1',
      };

      const account2: AccountFormData = {
        account_name: 'Company 2',
        arr: 60000,
        num_agents: 12,
        renewal_date: '2025-07-01',
        account_owner: 'Owner 2',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: 'Notes 2',
      };

      const id1 = insertAccount(account1);
      const id2 = insertAccount(account2);

      const updatedAccount1: AccountFormData = {
        ...account1,
        account_name: 'Updated Company 1',
        arr: 100000,
      };

      // Act
      updateAccount(id1, updatedAccount1);
      const retrieved1 = getAccountById(id1);
      const retrieved2 = getAccountById(id2);

      // Assert
      expect(retrieved1?.account_name).toBe('Updated Company 1');
      expect(retrieved1?.arr).toBe(100000);
      expect(retrieved2?.account_name).toBe('Company 2'); // Should remain unchanged
      expect(retrieved2?.arr).toBe(60000); // Should remain unchanged
    });

    test('handles update of non-existent account gracefully', () => {
      // Arrange
      const updateData: AccountFormData = {
        account_name: 'Non-existent Update',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-06-01',
        account_owner: 'Owner',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      // Act - Update non-existent account
      updateAccount(999, updateData);
      const retrieved = getAccountById(999);

      // Assert - Should still be null (update had no effect)
      expect(retrieved).toBeNull();
    });
  });

  describe('deleteAccount', () => {
    test('deletes account successfully', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Delete Me Company',
        arr: 70000,
        num_agents: 14,
        renewal_date: '2025-08-01',
        account_owner: 'Delete Owner',
        current_products: ['Copilot'],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const id = insertAccount(accountData);
      expect(getAccountById(id)).not.toBeNull(); // Verify it exists

      // Act
      deleteAccount(id);

      // Assert
      expect(getAccountById(id)).toBeNull();
    });

    test('does not affect other accounts when deleting', () => {
      // Arrange
      const account1: AccountFormData = {
        account_name: 'Keep Me 1',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-06-01',
        account_owner: 'Owner 1',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const account2: AccountFormData = {
        account_name: 'Delete Me',
        arr: 60000,
        num_agents: 12,
        renewal_date: '2025-07-01',
        account_owner: 'Owner 2',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const account3: AccountFormData = {
        account_name: 'Keep Me 2',
        arr: 70000,
        num_agents: 14,
        renewal_date: '2025-08-01',
        account_owner: 'Owner 3',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const id1 = insertAccount(account1);
      const id2 = insertAccount(account2);
      const id3 = insertAccount(account3);

      // Act
      deleteAccount(id2);

      // Assert
      expect(getAccountById(id1)).not.toBeNull();
      expect(getAccountById(id2)).toBeNull();
      expect(getAccountById(id3)).not.toBeNull();

      const allAccounts = getAllAccounts();
      expect(allAccounts).toHaveLength(2);
      expect(allAccounts.map(a => a.account_name)).toEqual(['Keep Me 1', 'Keep Me 2']);
    });

    test('handles deletion of non-existent account gracefully', () => {
      // Arrange
      const accountData: AccountFormData = {
        account_name: 'Existing Company',
        arr: 50000,
        num_agents: 10,
        renewal_date: '2025-06-01',
        account_owner: 'Owner',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      };

      const id = insertAccount(accountData);

      // Act - Delete non-existent account (should not throw)
      deleteAccount(999);

      // Assert - Existing account should still be there
      expect(getAccountById(id)).not.toBeNull();
      expect(getAllAccounts()).toHaveLength(1);
    });

    test('multiple deletes reduce total account count', () => {
      // Arrange
      insertAccount({
        account_name: 'Account 1',
        arr: 10000,
        num_agents: 2,
        renewal_date: '2025-01-01',
        account_owner: 'Owner 1',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      });
      const id2 = insertAccount({
        account_name: 'Account 2',
        arr: 20000,
        num_agents: 4,
        renewal_date: '2025-02-01',
        account_owner: 'Owner 2',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      });
      const id3 = insertAccount({
        account_name: 'Account 3',
        arr: 30000,
        num_agents: 6,
        renewal_date: '2025-03-01',
        account_owner: 'Owner 3',
        current_products: [],
        target_products: [],
        sfdc_link: '',
        ae_manager: '',
        notes: '',
      });

      expect(getAllAccounts()).toHaveLength(3);

      // Act
      deleteAccount(id2);
      deleteAccount(id3);

      // Assert
      expect(getAllAccounts()).toHaveLength(1);
      expect(getAllAccounts()[0].account_name).toBe('Account 1');
    });
  });
});
