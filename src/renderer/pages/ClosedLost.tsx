import React, { useCallback, useEffect, useState } from 'react';
import type { ClosedWonOpp } from '../../shared/types';
import { toCloseQuarter } from '../../shared/utils';

const PRODUCT_COLORS: Record<string, string> = {
  'ai agents': 'bg-purple-50 text-purple-700',
  'copilot':   'bg-blue-50 text-blue-700',
  'qa':        'bg-teal-50 text-teal-700',
  'ai expert': 'bg-indigo-50 text-indigo-700',
  'wem':       'bg-orange-50 text-orange-700',
};

function productClass(product: string): string {
  return PRODUCT_COLORS[product.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return '—';
  return '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toCloseMonth(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function oppSfdcUrl(oppId: string): string {
  return `https://zendesk.lightning.force.com/lightning/r/Opportunity/${oppId}/view`;
}

// ── Main Page ──────────────────────────────────────────────────

export default function ClosedLost() {
  const [closedLost, setClosedLost] = useState<ClosedWonOpp[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [quarterFilter, setQuarterFilter] = useState(toCloseQuarter(new Date().toISOString().split('T')[0]));
  const [monthFilter, setMonthFilter] = useState('');
  const [aiAeFilter, setAiAeFilter] = useState('');

  const load = useCallback(async () => {
    const cl = await window.api.getClosedLostOpps();
    setClosedLost(cl);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived filter options
  const allManagers = [...new Set(closedLost.map((o) => o.manager_name).filter(Boolean))].sort();
  const allQuarters = [...new Set(closedLost.map((o) => toCloseQuarter(o.close_date)).filter(Boolean))].sort();
  const allMonths = [...new Set(closedLost.map((o) => toCloseMonth(o.close_date)).filter(Boolean))].sort().reverse();
  const allAiAes = [...new Set(closedLost.map((o) => o.ai_ae).filter(Boolean))].sort();

  const filtered = closedLost.filter((o) => {
    if (searchQuery && !o.account_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (managerFilter && o.manager_name !== managerFilter) return false;
    if (quarterFilter && toCloseQuarter(o.close_date) !== quarterFilter) return false;
    if (monthFilter && toCloseMonth(o.close_date) !== monthFilter) return false;
    if (aiAeFilter && o.ai_ae !== aiAeFilter) return false;
    return true;
  });

  const totalLost = filtered.reduce((s, o) => s + o.bookings, 0);

  // Unique opps: group by crm_opportunity_id (one opp may have multiple product rows)
  const uniqueOppIds = new Set(filtered.map((o) => o.crm_opportunity_id));
  const uniqueOppCount = uniqueOppIds.size;
  const avgDeal = uniqueOppCount > 0 ? totalLost / uniqueOppCount : 0;

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="flex-1 overflow-auto p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Closed Lost</h2>
          <p className="text-sm text-gray-400 mt-0.5">Lost deals — synced from Snowflake</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Total Lost ARR" value={fmtCurrency(totalLost)} red />
        <StatCard label="Unique Deals" value={uniqueOppCount} sub={`${filtered.length} product line${filtered.length !== 1 ? 's' : ''}`} />
        <StatCard label="Avg Deal" value={uniqueOppCount > 0 ? fmtCurrency(avgDeal) : '—'} sub="per opp, all products" />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by account name…"
          className="w-full text-sm border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-red-400 bg-white placeholder-gray-300"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <FilterSelect value={managerFilter} onChange={setManagerFilter} options={allManagers} placeholder="All Managers" />
        <FilterSelect value={quarterFilter} onChange={setQuarterFilter} options={allQuarters} placeholder="All Quarters" />
        <FilterSelect value={monthFilter} onChange={setMonthFilter} options={allMonths} placeholder="All Months" />
        <FilterSelect value={aiAeFilter} onChange={setAiAeFilter} options={allAiAes} placeholder="All AI AEs" />
        {(searchQuery || managerFilter || quarterFilter || monthFilter || aiAeFilter) && (
          <button
            onClick={() => { setSearchQuery(''); setManagerFilter(''); setQuarterFilter(''); setMonthFilter(''); setAiAeFilter(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{uniqueOppCount} deal{uniqueOppCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {closedLost.length === 0 ? (
        <EmptyState message="No closed lost data yet. Sync from Snowflake to import lost deals." />
      ) : filtered.length === 0 ? (
        <EmptyState message="No deals match the current filters." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <Th>Opp</Th>
                  <Th>Account</Th>
                  <Th>Manager</Th>
                  <Th>AE</Th>
                  <Th>AI AE</Th>
                  <Th>Region</Th>
                  <Th>Segment</Th>
                  <Th>Product</Th>
                  <Th>Type</Th>
                  <Th>Close Date</Th>
                  <Th>Close Qtr</Th>
                  <Th>Lost ARR</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((opp) => (
                  <tr key={opp.id} className="hover:bg-gray-50 transition-colors">
                    <Td>
                      <button
                        onClick={() => window.api.openExternal(oppSfdcUrl(opp.crm_opportunity_id))}
                        className="text-blue-500 hover:text-blue-700 hover:underline whitespace-nowrap"
                      >
                        SFDC ↗
                      </button>
                    </Td>
                    <Td bold>{opp.account_name}</Td>
                    <Td>{opp.manager_name}</Td>
                    <Td>{opp.ae_name}</Td>
                    <Td>{opp.ai_ae}</Td>
                    <Td>{opp.region}</Td>
                    <Td>{opp.segment}</Td>
                    <Td>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${productClass(opp.product)}`}>
                        {opp.product}
                      </span>
                    </Td>
                    <Td>{opp.type}</Td>
                    <Td nowrap>{fmtDate(opp.close_date)}</Td>
                    <Td>
                      <span className="font-mono text-gray-600">{toCloseQuarter(opp.close_date) || '—'}</span>
                    </Td>
                    <Td right>
                      <span className="font-semibold text-red-700">{fmtCurrency(opp.bookings)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────────────

function StatCard({ label, value, red = false, sub }: { label: string; value: string | number; red?: boolean; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${red ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-red-400 bg-white"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
      {message}
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap text-gray-500 ${right ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

function Td({
  children, bold = false, right = false, nowrap = false,
}: {
  children: React.ReactNode;
  bold?: boolean;
  right?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${bold ? 'font-medium text-gray-900' : 'text-gray-600'} ${right ? 'text-right' : ''} ${nowrap ? 'whitespace-nowrap' : ''}`}>
      {children}
    </td>
  );
}
