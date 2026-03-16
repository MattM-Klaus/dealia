import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AisForecast, ClosedWonOpp, ForecastOpp } from '../../shared/types';
import { toCloseQuarter } from '../../shared/utils';
import { useFilters } from '../contexts/FilterContext';

const PRODUCT_COLORS: Record<string, string> = {
  'ai agents': 'bg-purple-100 text-purple-700',
  'copilot':   'bg-blue-100 text-blue-700',
  'qa':        'bg-teal-100 text-teal-700',
  'ai expert': 'bg-indigo-100 text-indigo-700',
  'wem':       'bg-orange-100 text-orange-700',
};

function productClass(p: string): string {
  return PRODUCT_COLORS[p.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

function fmtCurrency(val: number): string {
  return '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function sumArr(list: ForecastOpp[], forecast: AisForecast): number {
  return list
    .filter((o) => o.ais_forecast === forecast)
    .reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
}

// ── Main Page ──────────────────────────────────────────────────

export default function ForecastDashboard() {
  const [opps, setOpps]           = useState<ForecastOpp[]>([]);
  const [closedWon, setClosedWon] = useState<ClosedWonOpp[]>([]);
  const [loading, setLoading]     = useState(true);

  // Filters from context
  const { filters, updateForecastDashboardFilters } = useFilters();
  const { quarterFilter, regionFilter, managerFilter, aiAeFilter } = filters.forecastDashboard;

  const load = useCallback(async () => {
    const [o, cw] = await Promise.all([
      window.api.getForecastOpps(),
      window.api.getClosedWonOpps(),
    ]);
    setOpps(o);
    setClosedWon(cw);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  // Filter options
  const allQuarters = [...new Set([
    ...opps.map((o) => toCloseQuarter(o.close_date)),
    ...closedWon.map((o) => toCloseQuarter(o.close_date)),
  ].filter(Boolean))].sort();
  const allRegions  = [...new Set([
    ...opps.map((o) => o.region),
    ...closedWon.map((o) => o.region),
  ].filter(Boolean))].sort();
  const allManagers = [...new Set([
    ...opps.map((o) => o.manager_name),
    ...closedWon.map((o) => o.manager_name),
  ].filter(Boolean))].sort();

  // Pass 1: quarter + region + manager (used to populate AI AE dropdown)
  const baseOpps = opps.filter((o) => {
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.close_date))) return false;
    if (regionFilter.size > 0 && !regionFilter.has(o.region)) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    return true;
  });
  const baseCw = closedWon.filter((o) => {
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.close_date))) return false;
    if (regionFilter.size > 0 && !regionFilter.has(o.region)) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    return true;
  });

  // All AI AEs available given current quarter/manager filter
  const allAiAes = [...new Set([
    ...baseOpps.map((o) => o.ai_ae),
    ...baseCw.map((o) => o.ai_ae),
  ].filter(Boolean))].sort();

  // Pass 2: apply AI AE multi-select on top
  const filteredOpps = baseOpps.filter((o) => aiAeFilter.size === 0 || aiAeFilter.has(o.ai_ae));
  const filteredCw   = baseCw.filter((o) => aiAeFilter.size === 0 || aiAeFilter.has(o.ai_ae));

  // Summary totals
  const totalCwBookings = filteredCw.reduce((s, o) => s + o.bookings, 0);
  const totalCommit     = sumArr(filteredOpps, 'Commit');
  const totalMostLikely = sumArr(filteredOpps, 'Most Likely');
  const totalBestCase   = sumArr(filteredOpps, 'Best Case');
  const totalRemaining  = sumArr(filteredOpps, 'Remaining Pipe');
  const totalUnfilled   = filteredOpps.filter((o) => !o.ais_forecast).length;
  const dealBacked      = totalCwBookings + totalCommit + totalMostLikely;

  // Breakdown keys
  const allProducts = [...new Set([...filteredOpps.map((o) => o.product), ...filteredCw.map((o) => o.product)].filter(Boolean))].sort();
  const oppQuarters = [...new Set(filteredOpps.map((o) => toCloseQuarter(o.close_date)).filter(Boolean))].sort();

  return (
    <div className="flex-1 overflow-auto p-8">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Forecast Dashboard</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manager-ready summary — closed won &amp; AIS pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <MultiSelect options={allQuarters} selected={quarterFilter} onChange={(v) => updateForecastDashboardFilters({ quarterFilter: v })} placeholder="All Quarters" noun="Quarters" />
          <MultiSelect options={allRegions}  selected={regionFilter}  onChange={(v) => updateForecastDashboardFilters({ regionFilter: v })}  placeholder="All Regions"  noun="Regions"  />
          <MultiSelect options={allManagers} selected={managerFilter} onChange={(v) => updateForecastDashboardFilters({ managerFilter: v })} placeholder="All Managers" noun="Managers" />
          <MultiSelect options={allAiAes}    selected={aiAeFilter}    onChange={(v) => updateForecastDashboardFilters({ aiAeFilter: v })}    placeholder="All AI AEs"   noun="AI AEs"   />
          {(quarterFilter.size > 0 || regionFilter.size > 0 || managerFilter.size > 0 || aiAeFilter.size > 0) && (
            <button
              onClick={() => updateForecastDashboardFilters({ quarterFilter: new Set(), regionFilter: new Set(), managerFilter: new Set(), aiAeFilter: new Set() })}
              className="text-xs text-gray-400 hover:text-gray-600 px-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-7 gap-3 mb-8">
        <SummaryCard label="Deal Backed"     value={fmtCurrency(dealBacked)}      accent="blue"    sub="CW + Commit + Most Likely" />
        <SummaryCard label="Closed Won"      value={fmtCurrency(totalCwBookings)} accent="green"   sub={`${filteredCw.length} deals`} />
        <SummaryCard label="AIS Commit"      value={fmtCurrency(totalCommit)}     accent="emerald" sub={`${filteredOpps.filter((o) => o.ais_forecast === 'Commit').length} opps`} />
        <SummaryCard label="AIS Most Likely" value={fmtCurrency(totalMostLikely)} accent="yellow"  sub={`${filteredOpps.filter((o) => o.ais_forecast === 'Most Likely').length} opps`} />
        <SummaryCard label="AIS Best Case"   value={fmtCurrency(totalBestCase)}   accent="blue"    sub={`${filteredOpps.filter((o) => o.ais_forecast === 'Best Case').length} opps`} />
        <SummaryCard label="Remaining Pipe"  value={fmtCurrency(totalRemaining)}  accent="gray"    sub={`${filteredOpps.filter((o) => o.ais_forecast === 'Remaining Pipe').length} opps`} />
        <SummaryCard
          label="Unfilled AIS"
          value={totalUnfilled}
          accent={totalUnfilled > 0 ? 'red' : 'gray'}
          sub="need a forecast"
        />
      </div>

      {/* ── By AI AE ── */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">By AI AE</h3>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <Th left>AI AE</Th>
                <Th blue>Deal Backed</Th>
                <Th green>Closed Won</Th>
                <Th emerald>Commit</Th>
                <Th yellow>Most Likely</Th>
                <Th blue>Best Case</Th>
                <Th>Remaining</Th>
                <Th># Opps</Th>
                <Th red>Unfilled</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allAiAes.map((aiAe) => {
                const myOpps     = filteredOpps.filter((o) => o.ai_ae === aiAe);
                const myCw       = filteredCw.filter((o) => o.ai_ae === aiAe);
                const cwTotal    = myCw.reduce((s, o) => s + o.bookings, 0);
                const commit     = sumArr(myOpps, 'Commit');
                const mostLikely = sumArr(myOpps, 'Most Likely');
                const bestCase   = sumArr(myOpps, 'Best Case');
                const remaining  = sumArr(myOpps, 'Remaining Pipe');
                const unfilled   = myOpps.filter((o) => !o.ais_forecast).length;
                const dealBacked = cwTotal + commit + mostLikely;
                return (
                  <tr key={aiAe} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{aiAe}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-700">{fmtCurrency(dealBacked)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{fmtCurrency(cwTotal)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{commit > 0 ? fmtCurrency(commit) : <Dash />}</td>
                    <td className="px-4 py-3 text-right font-semibold text-yellow-600">{mostLikely > 0 ? fmtCurrency(mostLikely) : <Dash />}</td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-700">{bestCase > 0 ? fmtCurrency(bestCase) : <Dash />}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{remaining > 0 ? fmtCurrency(remaining) : <Dash />}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{myOpps.length}</td>
                    <td className="px-4 py-3 text-right">{unfilled > 0 ? <span className="font-semibold text-red-500">{unfilled}</span> : <Dash />}</td>
                  </tr>
                );
              })}
              <TotalsRow>
                <td className="px-4 py-3 text-gray-700 font-semibold">Total</td>
                <td className="px-4 py-3 text-right text-blue-700">{fmtCurrency(totalCwBookings + totalCommit + totalMostLikely)}</td>
                <td className="px-4 py-3 text-right text-green-700">{fmtCurrency(totalCwBookings)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{fmtCurrency(totalCommit)}</td>
                <td className="px-4 py-3 text-right text-yellow-600">{fmtCurrency(totalMostLikely)}</td>
                <td className="px-4 py-3 text-right text-blue-700">{fmtCurrency(totalBestCase)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fmtCurrency(totalRemaining)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{filteredOpps.length}</td>
                <td className="px-4 py-3 text-right">{totalUnfilled > 0 ? <span className="text-red-500">{totalUnfilled}</span> : <Dash />}</td>
              </TotalsRow>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Pipeline by Quarter ── */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Pipeline by Quarter</h3>
        {oppQuarters.length === 0 ? (
          <EmptySection />
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <Th left>Quarter</Th>
                  <Th emerald>Commit</Th>
                  <Th yellow>Most Likely</Th>
                  <Th blue>Best Case</Th>
                  <Th>Remaining</Th>
                  <Th>Total Pipeline</Th>
                  <Th># Opps</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {oppQuarters.map((q) => {
                  const qOpps      = filteredOpps.filter((o) => toCloseQuarter(o.close_date) === q);
                  const commit     = sumArr(qOpps, 'Commit');
                  const mostLikely = sumArr(qOpps, 'Most Likely');
                  const bestCase   = sumArr(qOpps, 'Best Case');
                  const remaining  = sumArr(qOpps, 'Remaining Pipe');
                  const total      = qOpps.reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
                  return (
                    <tr key={q} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-gray-800">{q}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{commit > 0 ? fmtCurrency(commit) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-yellow-600">{mostLikely > 0 ? fmtCurrency(mostLikely) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-700">{bestCase > 0 ? fmtCurrency(bestCase) : <Dash />}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{remaining > 0 ? fmtCurrency(remaining) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-700">{fmtCurrency(total)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{qOpps.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── By Product ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">By Product</h3>
        {allProducts.length === 0 ? (
          <EmptySection />
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <Th left>Product</Th>
                  <Th green>Closed Won</Th>
                  <Th emerald>Commit</Th>
                  <Th yellow>Most Likely</Th>
                  <Th blue>Best Case</Th>
                  <Th>Remaining</Th>
                  <Th># Opps</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allProducts.map((product) => {
                  const pOpps      = filteredOpps.filter((o) => o.product === product);
                  const pCw        = filteredCw.filter((o) => o.product === product);
                  const cwTotal    = pCw.reduce((s, o) => s + o.bookings, 0);
                  const commit     = sumArr(pOpps, 'Commit');
                  const mostLikely = sumArr(pOpps, 'Most Likely');
                  const bestCase   = sumArr(pOpps, 'Best Case');
                  const remaining  = sumArr(pOpps, 'Remaining Pipe');
                  return (
                    <tr key={product} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${productClass(product)}`}>{product}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">{cwTotal > 0 ? fmtCurrency(cwTotal) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{commit > 0 ? fmtCurrency(commit) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-yellow-600">{mostLikely > 0 ? fmtCurrency(mostLikely) : <Dash />}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-700">{bestCase > 0 ? fmtCurrency(bestCase) : <Dash />}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{remaining > 0 ? fmtCurrency(remaining) : <Dash />}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{pOpps.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Generic Multi-select ───────────────────────────────────────

function MultiSelect({
  options, selected, onChange, placeholder, noun,
}: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggle = (val: string) => {
    const next = new Set(selected);
    next.has(val) ? next.delete(val) : next.add(val);
    onChange(next);
  };

  const label = selected.size === 0 ? placeholder
    : selected.size === 1 ? [...selected][0]
    : `${selected.size} ${noun}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-sm border rounded-lg px-3 py-1.5 flex items-center gap-1.5 outline-none bg-white ${
          selected.size > 0
            ? 'border-green-400 text-green-700 font-medium'
            : 'border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        {label}
        <span className="text-gray-400 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && options.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[200px]">
          {selected.size > 0 && (
            <>
              <button
                onClick={() => onChange(new Set())}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              >
                Clear selection
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                className="accent-green-600 w-3.5 h-3.5 shrink-0"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────────────

const ACCENT_CLASSES: Record<string, { value: string; border: string }> = {
  green:   { value: 'text-green-700',   border: 'border-t-2 border-green-400' },
  emerald: { value: 'text-emerald-700', border: 'border-t-2 border-emerald-400' },
  yellow:  { value: 'text-yellow-600',  border: 'border-t-2 border-yellow-400' },
  blue:    { value: 'text-blue-700',    border: 'border-t-2 border-blue-400' },
  gray:    { value: 'text-gray-700',    border: 'border-t-2 border-gray-200' },
  red:     { value: 'text-red-600',     border: 'border-t-2 border-red-400' },
};

function SummaryCard({ label, value, accent = 'gray', sub }: { label: string; value: string | number; accent?: string; sub?: string }) {
  const cls = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.gray;
  return (
    <div className={`bg-white rounded-xl border border-gray-100 ${cls.border} px-4 py-3`}>
      <p className="text-xs text-gray-400 mb-1 truncate">{label}</p>
      <p className={`text-lg font-bold ${cls.value}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Th({
  children, left = false, green = false, emerald = false, yellow = false, blue = false, red = false,
}: {
  children: React.ReactNode;
  left?: boolean;
  green?: boolean;
  emerald?: boolean;
  yellow?: boolean;
  blue?: boolean;
  red?: boolean;
}) {
  const colorCls = green ? 'bg-green-50 text-green-700'
    : emerald ? 'bg-emerald-50 text-emerald-700'
    : yellow ? 'bg-yellow-50 text-yellow-700'
    : blue ? 'bg-blue-50 text-blue-700'
    : red ? 'text-red-400'
    : 'text-gray-500';
  return (
    <th className={`px-4 py-3 text-xs font-semibold whitespace-nowrap ${colorCls} ${left ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  );
}

function TotalsRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-gray-200 bg-gray-50 text-xs font-semibold">{children}</tr>;
}

function Dash() {
  return <span className="text-gray-300">—</span>;
}

function EmptySection() {
  return (
    <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
      No data yet. Upload CSVs from the Forecast page.
    </div>
  );
}
