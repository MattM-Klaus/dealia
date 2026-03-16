import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, ContactStatus } from '../../shared/types';
import { daysUntil } from '../components/RenewalBadge';
import ProductTags from '../components/ProductTags';
import { useFilters } from '../contexts/FilterContext';

const STATUS_CYCLE: ContactStatus[] = ['needs_action', 'in_contact', 'deal_live'];

const STATUS_PILL: Record<ContactStatus, string> = {
  needs_action: 'bg-gray-100 text-gray-500 hover:bg-gray-200',
  in_contact:   'bg-blue-100 text-blue-700 hover:bg-blue-200',
  deal_live:    'bg-green-100 text-green-700 hover:bg-green-200',
};

const STATUS_LABEL: Record<ContactStatus, string> = {
  needs_action: 'Needs Action',
  in_contact:   'In Contact',
  deal_live:    'Deal Live',
};

type SectionKey = 'needs_action' | 'critical' | 'soon' | 'upcoming' | 'in_contact' | 'deal_live';

const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  needs_action: true,
  critical:     true,
  soon:         false,
  upcoming:     false,
  in_contact:   false,
  deal_live:    false,
};

function groupByManager(accounts: Account[]): [string, Account[]][] {
  const map = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = a.ae_manager?.trim() || 'Unassigned';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 'Unassigned') return 1;
    if (b[0] === 'Unassigned') return -1;
    return b[1].length - a[1].length;
  });
}

function parseNotes(notes: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of (notes || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key && val) result[key] = val;
    }
  }
  return result;
}

const NOTE_KEYS = ['Health Score', 'Urgency', 'Segmentation', '3rd Party AI Bot', 'Key Metrics'];

export default function Dashboard() {
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [loading, setLoading]           = useState(true);
  const [open, setOpen]                 = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
  const [openManagers, setOpenManagers] = useState<Set<string>>(new Set());
  const [selected, setSelected]         = useState<Set<number>>(new Set());

  // Filters from context
  const { filters, updateDashboardFilters } = useFilters();
  const { managerFilter, productFilter, aiAeFilter } = filters.dashboard;

  const load = useCallback(async () => {
    const data = await window.api.getAccounts();
    setAccounts(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Clear selection when filters change
  useEffect(() => { setSelected(new Set()); }, [managerFilter, productFilter, aiAeFilter]);

  async function cycleStatus(account: Account) {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(account.contact_status) + 1) % STATUS_CYCLE.length];
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, contact_status: next } : a)),
    );
    await window.api.setAccountStatus(account.id, next);
  }

  async function bulkSetStatus(status: ContactStatus) {
    const ids = [...selected];
    setAccounts((prev) =>
      prev.map((a) => (selected.has(a.id) ? { ...a, contact_status: status } : a)),
    );
    setSelected(new Set());
    await Promise.all(ids.map((id) => window.api.setAccountStatus(id, status)));
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function bulkToggle(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function toggleSection(key: SectionKey) {
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  }

  function toggleManager(tierKey: string, manager: string) {
    const k = `${tierKey}::${manager}`;
    setOpenManagers((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  function isManagerOpen(tierKey: string, manager: string) {
    return openManagers.has(`${tierKey}::${manager}`);
  }

  // Accounts renewing in next 90 days (before any filter)
  const renewingAll = accounts
    .filter((a) => { const d = daysUntil(a.renewal_date); return d > 0 && d <= 90; });

  // Unique filter options from the unfiltered set
  const allManagers = Array.from(
    new Set(renewingAll.map((a) => a.ae_manager?.trim() || 'Unassigned')),
  ).sort();

  const allProducts = Array.from(
    new Set(renewingAll.flatMap((a) => a.target_products)),
  ).sort();

  const allAiAes = Array.from(
    new Set(renewingAll.map((a) => a.account_owner).filter(Boolean)),
  ).sort();

  // Apply all filters
  const renewing = renewingAll
    .filter((a) => {
      if (managerFilter && (a.ae_manager?.trim() || 'Unassigned') !== managerFilter) return false;
      if (productFilter && !a.target_products.includes(productFilter as any)) return false;
      if (aiAeFilter && a.account_owner !== aiAeFilter) return false;
      return true;
    })
    .sort((a, b) => daysUntil(a.renewal_date) - daysUntil(b.renewal_date));

  const needsAction = renewing.filter((a) => a.contact_status === 'needs_action');
  const critical    = needsAction.filter((a) => daysUntil(a.renewal_date) <= 30);
  const soon        = needsAction.filter((a) => { const d = daysUntil(a.renewal_date); return d > 30 && d <= 60; });
  const upcoming    = needsAction.filter((a) => daysUntil(a.renewal_date) > 60);
  const inContact   = renewing.filter((a) => a.contact_status === 'in_contact');
  const dealLive    = renewing.filter((a) => a.contact_status === 'deal_live');

  const actioned = inContact.length + dealLive.length;
  const totalArr = renewing.reduce((s, a) => s + a.arr, 0);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-400 mt-0.5">Renewals in the next 90 days</p>
      </div>

      {renewingAll.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">No renewals in the next 90 days.</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            <StatCard label="Renewing" value={renewing.length} />
            <StatCard label="ARR at stake" value={`$${(totalArr / 1_000_000).toFixed(1)}M`} />
            <StatCard label="Critical" value={critical.length} red={critical.length > 0} />
            <StatCard label="Needs action" value={needsAction.length} red={needsAction.length > 0} />
            <StatCard label="Actioned" value={actioned} />
          </div>

          {/* Progress */}
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>{actioned} of {renewing.length} actioned</span>
              <span>{renewing.length > 0 ? Math.round((actioned / renewing.length) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: renewing.length > 0 ? `${(actioned / renewing.length) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 justify-end mb-4 flex-wrap">
            {allManagers.length > 1 && (
              <select
                value={managerFilter}
                onChange={(e) => updateDashboardFilters({ managerFilter: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">All Managers</option>
                {allManagers.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {allProducts.length > 1 && (
              <select
                value={productFilter}
                onChange={(e) => updateDashboardFilters({ productFilter: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">All Products</option>
                {allProducts.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {allAiAes.length > 1 && (
              <select
                value={aiAeFilter}
                onChange={(e) => updateDashboardFilters({ aiAeFilter: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">All AEs</option>
                {allAiAes.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            {(managerFilter || productFilter || aiAeFilter) && (
              <button
                onClick={() => updateDashboardFilters({ managerFilter: '', productFilter: '', aiAeFilter: '' })}
                className="text-xs text-gray-400 hover:text-gray-600 px-2"
              >
                Clear
              </button>
            )}
          </div>

          {renewing.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No accounts for this manager in the next 90 days.</div>
          ) : (
            <div className="flex flex-col gap-3">

              {/* ── Needs Action ── */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <SectionHeader dot="bg-orange-400" label="Needs Action" count={needsAction.length}
                  isOpen={open.needs_action} onToggle={() => toggleSection('needs_action')} />

                {open.needs_action && (
                  <div className="border-t border-gray-100">

                    <SubSectionHeader dot="bg-red-500" label="Critical" sublabel="≤ 30 days"
                      count={critical.length} isOpen={open.critical} onToggle={() => toggleSection('critical')} />
                    {open.critical && (
                      <ManagerGroupList tierKey="critical" accounts={critical}
                        isManagerOpen={isManagerOpen} onToggleManager={toggleManager}
                        onCycleStatus={cycleStatus} selected={selected}
                        onToggleSelect={toggleSelect} onBulkToggle={bulkToggle} />
                    )}

                    <SubSectionHeader dot="bg-orange-400" label="This Quarter" sublabel="31–60 days"
                      count={soon.length} isOpen={open.soon} onToggle={() => toggleSection('soon')} />
                    {open.soon && (
                      <ManagerGroupList tierKey="soon" accounts={soon}
                        isManagerOpen={isManagerOpen} onToggleManager={toggleManager}
                        onCycleStatus={cycleStatus} selected={selected}
                        onToggleSelect={toggleSelect} onBulkToggle={bulkToggle} />
                    )}

                    <SubSectionHeader dot="bg-yellow-400" label="Upcoming" sublabel="61–90 days"
                      count={upcoming.length} isOpen={open.upcoming} onToggle={() => toggleSection('upcoming')} />
                    {open.upcoming && (
                      <ManagerGroupList tierKey="upcoming" accounts={upcoming}
                        isManagerOpen={isManagerOpen} onToggleManager={toggleManager}
                        onCycleStatus={cycleStatus} selected={selected}
                        onToggleSelect={toggleSelect} onBulkToggle={bulkToggle} />
                    )}

                  </div>
                )}
              </div>

              {/* ── In Contact ── */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <SectionHeader dot="bg-blue-400" label="In Contact" count={inContact.length}
                  isOpen={open.in_contact} onToggle={() => toggleSection('in_contact')} />
                {open.in_contact && (
                  <div className="border-t border-gray-100">
                    <ManagerGroupList tierKey="in_contact" accounts={inContact}
                      isManagerOpen={isManagerOpen} onToggleManager={toggleManager}
                      onCycleStatus={cycleStatus} selected={selected}
                      onToggleSelect={toggleSelect} onBulkToggle={bulkToggle} />
                  </div>
                )}
              </div>

              {/* ── Deal Live ── */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <SectionHeader dot="bg-green-500" label="Deal Live" count={dealLive.length}
                  isOpen={open.deal_live} onToggle={() => toggleSection('deal_live')} />
                {open.deal_live && (
                  <div className="border-t border-gray-100">
                    <ManagerGroupList tierKey="deal_live" accounts={dealLive}
                      isManagerOpen={isManagerOpen} onToggleManager={toggleManager}
                      onCycleStatus={cycleStatus} selected={selected}
                      onToggleSelect={toggleSelect} onBulkToggle={bulkToggle} />
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-white border border-gray-200 rounded-xl shadow-xl px-5 py-3">
              <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
              <div className="w-px h-4 bg-gray-200 shrink-0" />
              {(Object.keys(STATUS_LABEL) as ContactStatus[]).map((status) => (
                <button
                  key={status}
                  onClick={() => bulkSetStatus(status)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${STATUS_PILL[status]}`}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
              <div className="w-px h-4 bg-gray-200 shrink-0" />
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Indeterminate checkbox ──────────────────────────────────────

function IndeterminateCheckbox({
  checked, indeterminate, onChange, className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={className}
    />
  );
}

// ── Manager group list ─────────────────────────────────────────

function ManagerGroupList({
  tierKey, accounts, isManagerOpen, onToggleManager, onCycleStatus,
  selected, onToggleSelect, onBulkToggle,
}: {
  tierKey: string;
  accounts: Account[];
  isManagerOpen: (tier: string, manager: string) => boolean;
  onToggleManager: (tier: string, manager: string) => void;
  onCycleStatus: (a: Account) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onBulkToggle: (ids: number[], checked: boolean) => void;
}) {
  if (accounts.length === 0) {
    return <p className="px-5 py-3 text-xs text-gray-400">No accounts here.</p>;
  }

  const groups = groupByManager(accounts);

  return (
    <div>
      {groups.map(([manager, managerAccounts]) => {
        const managerArr   = managerAccounts.reduce((s, a) => s + a.arr, 0);
        const isOpen       = isManagerOpen(tierKey, manager);
        const allSelected  = managerAccounts.length > 0 && managerAccounts.every((a) => selected.has(a.id));
        const someSelected = managerAccounts.some((a) => selected.has(a.id));

        return (
          <div key={manager} className="border-b border-gray-50 last:border-b-0">
            {/* Manager row */}
            <div className="flex items-center w-full hover:bg-gray-50 transition-colors">
              <div className="pl-4 pr-2 flex items-center shrink-0">
                <IndeterminateCheckbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={(chk) => onBulkToggle(managerAccounts.map((a) => a.id), chk)}
                  className="accent-green-600 w-3.5 h-3.5"
                />
              </div>
              <button
                onClick={() => onToggleManager(tierKey, manager)}
                className="flex-1 flex items-center justify-between px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-semibold text-gray-700">{manager}</span>
                  <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">
                    {managerAccounts.length} account{managerAccounts.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-gray-400">
                    ${managerArr.toLocaleString('en-US', { maximumFractionDigits: 0 })} ARR
                  </span>
                </div>
                <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>
            </div>

            {/* Account rows */}
            {isOpen && (
              <div className="divide-y divide-gray-50 bg-gray-50/40">
                {managerAccounts.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    onCycleStatus={onCycleStatus}
                    selected={selected}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Account row ────────────────────────────────────────────────

function AccountRow({
  account, onCycleStatus, selected, onToggleSelect,
}: {
  account: Account;
  onCycleStatus: (a: Account) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
}) {
  const navigate  = useNavigate();
  const [notesPos, setNotesPos] = useState<{ top: number; left: number } | null>(null);
  const days      = daysUntil(account.renewal_date);
  const arr       = `$${account.arr.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  const dayColor  = days <= 30 ? 'text-red-600' : days <= 60 ? 'text-orange-500' : 'text-yellow-600';
  const parsedNotes  = parseNotes(account.notes);
  const visibleNotes = NOTE_KEYS.filter((k) => parsedNotes[k]);
  const hasNotes     = visibleNotes.length > 0;

  return (
    <>
      <div className="flex items-center gap-3 pl-4 pr-5 py-2.5 hover:bg-gray-50 transition-colors">

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected.has(account.id)}
          onChange={() => onToggleSelect(account.id)}
          onClick={(e) => e.stopPropagation()}
          className="accent-green-600 w-3.5 h-3.5 shrink-0"
        />

        {/* Days */}
        <span className={`text-xs font-bold w-10 shrink-0 ${dayColor}`}>{days}d</span>

        {/* Account name + notes icon */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => navigate('/accounts', { state: { openAccountId: account.id } })}
              className="text-sm font-medium text-gray-900 hover:text-green-700 hover:underline truncate text-left"
              style={{ minWidth: 0 }}
            >
              {account.account_name}
            </button>
            {hasNotes && (
              <button
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setNotesPos({
                    top: rect.bottom + 6,
                    left: Math.min(rect.left, window.innerWidth - 240),
                  });
                }}
                onMouseLeave={() => setNotesPos(null)}
                className="text-gray-300 hover:text-blue-400 text-xs shrink-0 px-0.5 leading-none"
                title="View notes"
              >
                ℹ
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{account.account_owner || '—'}</p>
        </div>

        {/* Target products */}
        <div className="flex shrink-0">
          <ProductTags products={account.target_products} />
        </div>

        {/* ARR */}
        <span className="text-sm font-semibold text-gray-700 w-24 text-right shrink-0">{arr}</span>

        {/* Status pill */}
        <button
          onClick={() => onCycleStatus(account)}
          title="Click to change status"
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors w-28 text-center ${STATUS_PILL[account.contact_status]}`}
        >
          {STATUS_LABEL[account.contact_status]}
        </button>

        {/* SFDC link */}
        <div className="w-14 text-right shrink-0">
          {account.sfdc_link ? (
            <button
              onClick={() => window.api.openExternal(account.sfdc_link)}
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline"
            >
              SFDC ↗
            </button>
          ) : (
            <span className="text-xs text-gray-200">—</span>
          )}
        </div>
      </div>

      {/* Notes popover — fixed position avoids overflow-hidden clipping */}
      {notesPos && (
        <div
          style={{ position: 'fixed', top: notesPos.top, left: notesPos.left }}
          className="z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-56 text-xs pointer-events-none"
        >
          {visibleNotes.map((key) => (
            <div key={key} className="flex gap-2 py-0.5">
              <span className="text-gray-400 shrink-0">{key}:</span>
              <span className="text-gray-700 font-medium">{parsedNotes[key]}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Shared UI pieces ───────────────────────────────────────────

function StatCard({ label, value, red = false }: { label: string; value: string | number; red?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${red ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function SectionHeader({ dot, label, count, isOpen, onToggle }: {
  dot: string; label: string; count: number; isOpen: boolean; onToggle: () => void;
}) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="text-xs font-medium bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{count}</span>
      </div>
      <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
    </button>
  );
}

function SubSectionHeader({ dot, label, sublabel, count, isOpen, onToggle }: {
  dot: string; label: string; sublabel: string; count: number; isOpen: boolean; onToggle: () => void;
}) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors border-b border-gray-100">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-xs text-gray-400">{sublabel}</span>
        <span className="text-xs font-medium bg-white text-gray-500 rounded-full px-1.5 py-0.5 border border-gray-200">{count}</span>
      </div>
      <span className="text-gray-300 text-xs">{isOpen ? '▲' : '▼'}</span>
    </button>
  );
}

