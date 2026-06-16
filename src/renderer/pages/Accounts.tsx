import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import type { Account } from '../../shared/types';
import AccountTable from '../components/AccountTable';
import AccountForm from '../components/AccountForm';
import ImportModal from '../components/ImportModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useFilters } from '../contexts/FilterContext';

export default function Accounts() {
  const location = useLocation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Persistent filter state (sessionStorage-backed via FilterContext).
  const { filters, updateAccountsFilters } = useFilters();
  const search = filters.accounts.search;
  const setSearch = (next: string) => updateAccountsFilters({ search: next });

  const load = useCallback(async () => {
    const data = await window.api.getAccounts();
    setAccounts(data);
    setLoading(false);
    // If navigated from Dashboard with a specific account, open its edit form
    const openId = (location.state as { openAccountId?: number } | null)?.openAccountId;
    if (openId) {
      const target = data.find((a) => a.id === openId);
      if (target) {
        setEditAccount(target);
        setShowForm(true);
      }
    }
  }, [location.state]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditAccount(null);
    setShowForm(true);
  }

  function openEdit(account: Account) {
    setEditAccount(account);
    setShowForm(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await window.api.deleteAccount(deleteTarget.id);
    setDeleteTarget(null);
    load();
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Fixed header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 bg-white shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Accounts</h2>
          <p className="text-sm text-gray-400 mt-0.5">{accounts.length} total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            Import CSV
          </button>
          <button
            onClick={openAdd}
            className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            + Add Account
          </button>
        </div>
      </div>

      {/* Fixed search bar */}
      <div className="shrink-0 px-8 py-3 border-b border-gray-100 bg-gray-50">
        <input
          type="text"
          placeholder="Search accounts or owners…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-400 bg-white"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Scrollable table area */}
      <div className="flex-1 overflow-auto px-8 py-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <AccountTable
            accounts={accounts}
            onEdit={openEdit}
            onDelete={(a) => setDeleteTarget(a)}
            search={search}
            onSearchChange={setSearch}
          />
        )}
      </div>

      {showForm && (
        <AccountForm
          account={editAccount}
          onSave={() => {
            setShowForm(false);
            load();
          }}
          onClose={() => setShowForm(false)}
        />
      )}

      {showImport && (
        <ImportModal
          onImported={load}
          onClose={() => setShowImport(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={`Delete "${deleteTarget.account_name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
