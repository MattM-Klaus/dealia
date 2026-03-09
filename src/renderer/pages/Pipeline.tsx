import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AisForecast, ClosedWonOpp, ForecastImportResult, ForecastOpp } from '../../shared/types';
import { AIS_FORECAST_OPTIONS } from '../../shared/types';
import { toCloseQuarter, mapForecast } from '../../shared/utils';

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

const OPP_ARR_THRESHOLD = 50_000;

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

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return '';
  // SQLite datetime('now') is UTC: "2026-02-26 15:45:30"
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDelta(delta: number): string {
  return '$' + Math.abs(delta).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function oppSfdcUrl(oppId: string): string {
  return `https://zendesk.lightning.force.com/lightning/r/Opportunity/${oppId}/view`;
}

const VP_FORECAST_COLORS: Record<string, string> = {
  'commit':         'bg-green-100 text-green-800',
  'best case':      'bg-blue-100 text-blue-800',
  'most likely':    'bg-yellow-100 text-yellow-800',
  'remaining pipe': 'bg-gray-100 text-gray-500',
  'omit':           'bg-red-100 text-red-500',
};

function forecastPillClass(val: string): string {
  return VP_FORECAST_COLORS[val.toLowerCase()] ?? 'bg-gray-100 text-gray-500';
}

const AIS_FORECAST_COLORS: Record<AisForecast, string> = {
  'Commit':         'bg-green-600 text-white',
  'Best Case':      'bg-blue-600 text-white',
  'Most Likely':    'bg-yellow-500 text-white',
  'Remaining Pipe': 'bg-gray-400 text-white',
};

// ── Main Page ──────────────────────────────────────────────────

export default function Pipeline() {
  const [opps, setOpps]             = useState<ForecastOpp[]>([]);
  const [closedWon, setClosedWon]   = useState<ClosedWonOpp[]>([]);
  const [loading, setLoading]       = useState(true);
  const [importMsg, setImportMsg]     = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting]     = useState(false);
  const [prevTiles, setPrevTiles]     = useState<{ cw: number; commit: number; ml: number; bestCase: number; remaining: number; totalPipe: number } | null>(null);

  // Ref always holds the latest tile values so handleImport can snapshot them
  const tileRef = useRef({ cw: 0, commit: 0, ml: 0, bestCase: 0, remaining: 0, totalPipe: 0 });

  // Filters
  const [searchQuery, setSearchQuery]     = useState('');
  const [managerFilter, setManagerFilter] = useState<Set<string>>(new Set());
  const [quarterFilter, setQuarterFilter] = useState<Set<string>>(new Set([toCloseQuarter(new Date().toISOString().split('T')[0])]));
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [regionFilter, setRegionFilter]   = useState<Set<string>>(new Set());
  const [vpFcstFilter, setVpFcstFilter]   = useState<Set<string>>(new Set());
  const [aisFcstFilter, setAisFcstFilter] = useState<Set<string>>(new Set());
  const [minOppArr, setMinOppArr]         = useState(0);
  const [aiAeFilter, setAiAeFilter]       = useState<Set<string>>(new Set());
  const [topDealOnly, setTopDealOnly]     = useState(false);

  const load = useCallback(async () => {
    const [o, cw] = await Promise.all([window.api.getForecastOpps(), window.api.getClosedWonOpps()]);
    setOpps(o);
    setClosedWon(cw);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleImport() {
    const filePath = await window.api.openFileDialog();
    if (!filePath) return;

    // Snapshot current tile values before the reload
    setPrevTiles({ ...tileRef.current });

    setImportMsg(null);
    setImportError(null);
    setImporting(true);

    try {
      const result: ForecastImportResult = await window.api.importForecastPipeline(filePath);
      await load();

      const parts = [`${result.inserted} new, ${result.updated} updated`];
      if (result.changes_detected > 0) parts.push(`${result.changes_detected} change${result.changes_detected !== 1 ? 's' : ''} detected — check Analytics`);
      if (result.synced_renewals > 0) parts.push(`${result.synced_renewals} renewal${result.synced_renewals !== 1 ? 's' : ''} auto-set to Deal Live`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.errors.length > 0) parts.push(`First error: ${result.errors[0]}`);
      setImportMsg(parts.join(' · '));
      setTimeout(() => setImportMsg(null), 15000);
    } catch (err) {
      console.error('[Pipeline] Import error:', err);
      setImportError(`Import failed: ${(err as Error).message ?? String(err)}`);
      setTimeout(() => setImportError(null), 15000);
    } finally {
      setImporting(false);
    }
  }

  async function handleTableauSync() {
    // Snapshot current tile values before the reload
    setPrevTiles({ ...tileRef.current });

    setImportMsg(null);
    setImportError(null);
    setImporting(true);

    try {
      const response: { success: boolean; result?: ForecastImportResult; error?: string } = await window.api.syncFromTableau();

      if (!response.success || !response.result) {
        setImportError(response.error || 'Tableau sync failed');
        setTimeout(() => setImportError(null), 15000);
        return;
      }

      await load();

      const result = response.result;
      const parts = [`Synced from Tableau: ${result.inserted} new, ${result.updated} updated`];
      if (result.changes_detected > 0) parts.push(`${result.changes_detected} change${result.changes_detected !== 1 ? 's' : ''} detected — check Analytics`);
      if (result.synced_renewals > 0) parts.push(`${result.synced_renewals} renewal${result.synced_renewals !== 1 ? 's' : ''} auto-set to Deal Live`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.errors.length > 0) parts.push(`First error: ${result.errors[0]}`);
      setImportMsg(parts.join(' · '));
      setTimeout(() => setImportMsg(null), 15000);
    } catch (err) {
      console.error('[Pipeline] Tableau sync error:', err);
      setImportError(`Tableau sync failed: ${(err as Error).message ?? String(err)}`);
      setTimeout(() => setImportError(null), 15000);
    } finally {
      setImporting(false);
    }
  }

  // Derived filter options
  const allManagers = [...new Set(opps.map((o) => o.manager_name).filter(Boolean))].sort();
  const allQuarters = [...new Set(opps.map((o) => toCloseQuarter(o.close_date)).filter(Boolean))].sort();
  const allProducts = [...new Set(opps.map((o) => o.product).filter(Boolean))].sort();
  const allRegions  = [...new Set(opps.map((o) => o.region).filter(Boolean))].sort();
  const allVpFcsts  = [...new Set(opps.map((o) => o.vp_deal_forecast).filter(Boolean))].sort();
  const allAiAes    = [...new Set(opps.map((o) => o.ai_ae).filter(Boolean))].sort();

  // Opp-level total ARR — always from CSV (product_arr_usd), never from manual AIS edits
  const oppTotalArrMap = new Map<string, number>();
  for (const o of opps) {
    const prev = oppTotalArrMap.get(o.crm_opportunity_id) ?? 0;
    oppTotalArrMap.set(o.crm_opportunity_id, prev + o.product_arr_usd);
  }

  const filteredOpps = opps.filter((o) => {
    if (searchQuery && !o.account_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.close_date))) return false;
    if (productFilter.size > 0 && !productFilter.has(o.product)) return false;
    if (regionFilter.size > 0 && !regionFilter.has(o.region)) return false;
    if (vpFcstFilter.size > 0 && !vpFcstFilter.has(o.vp_deal_forecast)) return false;
    if (aisFcstFilter.size > 0) {
      const wantUnset = aisFcstFilter.has('Needs to be set');
      const passes = (wantUnset && o.ais_forecast == null) ||
        [...aisFcstFilter].filter((v) => v !== 'Needs to be set').some((v) => v === (o.ais_forecast ?? ''));
      if (!passes) return false;
    }
    if (aiAeFilter.size > 0 && !aiAeFilter.has(o.ai_ae)) return false;
    if (minOppArr > 0 && (oppTotalArrMap.get(o.crm_opportunity_id) ?? 0) < minOppArr) return false;
    if (topDealOnly && !o.ais_top_deal) return false;
    return true;
  });

  // Tile ARR values (computed from filtered opps)
  const commitArr    = filteredOpps.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
  const mlArr        = filteredOpps.filter((o) => o.ais_forecast === 'Most Likely').reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
  const bestCaseArr  = filteredOpps.filter((o) => o.ais_forecast === 'Best Case').reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
  const remainingArr = filteredOpps.filter((o) => o.ais_forecast === 'Remaining Pipe').reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
  const totalPipe    = filteredOpps.reduce((s, o) => s + (o.ais_arr ?? o.product_arr_usd), 0);
  const totalCW      = closedWon.filter((o) => {
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.close_date))) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    if (regionFilter.size > 0  && !regionFilter.has(o.region))        return false;
    if (aiAeFilter.size > 0    && !aiAeFilter.has(o.ai_ae))           return false;
    return true;
  }).reduce((s, o) => s + o.bookings, 0);
  const dealBacked   = totalCW + commitArr + mlArr;

  // Keep ref in sync so handleImport can snapshot before reload
  tileRef.current = { cw: totalCW, commit: commitArr, ml: mlArr, bestCase: bestCaseArr, remaining: remainingArr, totalPipe };

  // Last upload timestamp from most recent updated_at across all opps
  const lastUpdated = opps.length > 0
    ? opps.reduce((max, o) => o.updated_at > max ? o.updated_at : max, opps[0].updated_at)
    : null;

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="flex-1 overflow-auto p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Pipeline</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {lastUpdated ? `Open pipeline — last updated ${fmtDateTime(lastUpdated)}` : 'Open pipeline — no data yet'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTableauSync}
            disabled={importing}
            className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sync from Tableau
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload CSV
          </button>
        </div>
      </div>

      {importing && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="px-4 py-2.5 text-sm text-blue-700 font-medium">Importing… this may take a moment for large files</div>
          <div className="h-1 bg-blue-100 overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: '40%', animation: 'pulse-bar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}
      {importMsg && !importing && (
        <div className="mb-4 px-4 py-2.5 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">
          ✓ {importMsg}
        </div>
      )}
      {importError && !importing && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
          ✗ {importError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3 mb-4">
        <StatCard label="Deal Backed"        value={fmtCurrency(dealBacked)}   sub="CW + Commit + Most Likely" color="blue"  delta={prevTiles ? dealBacked - (prevTiles.cw + prevTiles.commit + prevTiles.ml) : undefined} />
        <StatCard label="AIS Commit"         value={fmtCurrency(commitArr)}    color="green"              delta={prevTiles ? commitArr    - prevTiles.commit    : undefined} />
        <StatCard label="AIS Most Likely"    value={fmtCurrency(mlArr)}        color="yellow"             delta={prevTiles ? mlArr        - prevTiles.ml        : undefined} />
        <StatCard label="AIS Best Case"      value={fmtCurrency(bestCaseArr)}  color="orange"             delta={prevTiles ? bestCaseArr  - prevTiles.bestCase  : undefined} />
        <StatCard label="AIS Remaining Pipe" value={fmtCurrency(remainingArr)} color="gray"               delta={prevTiles ? remainingArr - prevTiles.remaining : undefined} />
        <StatCard label="Total Pipeline"     value={fmtCurrency(totalPipe)}    color="blue"               delta={prevTiles ? totalPipe    - prevTiles.totalPipe : undefined} />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by account name…"
          className="w-full text-sm border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-green-400 bg-white placeholder-gray-300"
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
        <MultiSelect options={allManagers} selected={managerFilter} onChange={setManagerFilter} placeholder="All Managers" noun="Managers" />
        <MultiSelect options={allQuarters} selected={quarterFilter} onChange={setQuarterFilter} placeholder="All Quarters" noun="Quarters" />
        <MultiSelect options={allProducts} selected={productFilter} onChange={setProductFilter} placeholder="All Products" noun="Products" />
        <MultiSelect options={allRegions}  selected={regionFilter}  onChange={setRegionFilter}  placeholder="All Regions"  noun="Regions"  />
        <MultiSelect options={allVpFcsts}  selected={vpFcstFilter}  onChange={setVpFcstFilter}  placeholder="All VP Forecasts"  noun="VP Forecasts"  />
        <MultiSelect
          options={['Needs to be set', ...AIS_FORECAST_OPTIONS]}
          selected={aisFcstFilter}
          onChange={setAisFcstFilter}
          placeholder="All AIS Forecasts"
          noun="Forecasts"
        />
        <MultiSelect options={allAiAes} selected={aiAeFilter} onChange={setAiAeFilter} placeholder="All AI AEs" noun="AI AEs" />
        <select
          value={minOppArr}
          onChange={(e) => setMinOppArr(Number(e.target.value))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-green-400 bg-white"
        >
          <option value={0}>All Opp Sizes</option>
          <option value={50000}>Opp ≥ $50k</option>
          <option value={100000}>Opp ≥ $100k</option>
          <option value={250000}>Opp ≥ $250k</option>
          <option value={500000}>Opp ≥ $500k</option>
          <option value={1000000}>Opp ≥ $1M</option>
        </select>
        <button
          onClick={() => setTopDealOnly((v) => !v)}
          className={`text-sm border rounded-lg px-3 py-1.5 outline-none ${topDealOnly ? 'border-green-400 text-green-700 font-medium bg-white' : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'}`}
        >
          ⭐ Top Deals
        </button>
        {(managerFilter.size > 0 || quarterFilter.size > 0 || productFilter.size > 0 || regionFilter.size > 0 || vpFcstFilter.size > 0 || aisFcstFilter.size > 0 || aiAeFilter.size > 0 || minOppArr > 0 || topDealOnly) && (
          <button
            onClick={() => { setSearchQuery(''); setManagerFilter(new Set()); setQuarterFilter(new Set()); setProductFilter(new Set()); setRegionFilter(new Set()); setVpFcstFilter(new Set()); setAisFcstFilter(new Set()); setAiAeFilter(new Set()); setMinOppArr(0); setTopDealOnly(false); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{filteredOpps.length} opp{filteredOpps.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {opps.length === 0 ? (
        <EmptyState message="No pipeline data yet. Upload a Pipeline CSV to get started." />
      ) : filteredOpps.length === 0 ? (
        <EmptyState message="No opps match the current filters." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <Th>Opp</Th>
                  <Th>Account</Th>
                  <Th>Opp Total</Th>
                  <Th>VP Forecast</Th>
                  <Th highlight>AIS Forecast</Th>
                  <Th highlight>AIS ARR</Th>
                  <Th highlight>AIS Close Date</Th>
                  <Th highlight>AIS Close Qtr</Th>
                  <Th highlight>AIS Top Deal</Th>
                  <Th>Notes</Th>
                  <Th>Manager</Th>
                  <Th>AE</Th>
                  <Th>AI AE</Th>
                  <Th>Region</Th>
                  <Th>Segment</Th>
                  <Th>Product</Th>
                  <Th>Type</Th>
                  <Th>Stage</Th>
                  <Th>Close Qtr</Th>
                  <Th>Close Date</Th>
                  <Th>S2+ Date</Th>
                  <Th>Tableau ARR</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOpps.map((opp) => (
                  <PipelineRow
                    key={opp.id}
                    opp={opp}
                    oppTotalArr={oppTotalArrMap.get(opp.crm_opportunity_id) ?? 0}
                    onUpdate={(field, val) => {
                      setOpps((prev) => prev.map((o) => o.id === opp.id ? { ...o, [field]: val } : o));
                      window.api.updateForecastAisField(opp.id, field, val);
                    }}
                    onToggleTopDeal={(val) => {
                      setOpps((prev) => prev.map((o) => o.id === opp.id ? { ...o, ais_top_deal: val } : o));
                      window.api.setTopDeal(opp.id, val);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pipeline Row ───────────────────────────────────────────────

function PipelineRow({
  opp,
  oppTotalArr,
  onUpdate,
  onToggleTopDeal,
}: {
  opp: ForecastOpp;
  oppTotalArr: number;
  onUpdate: (field: 'ais_forecast' | 'ais_arr' | 'ais_close_date', val: AisForecast | number | string | null) => void;
  onToggleTopDeal: (val: number) => void;
}) {
  const [editingArr, setEditingArr]   = useState(false);
  const [arrDraft, setArrDraft]       = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const [notesOpen, setNotesOpen]     = useState(false);
  const [notesPos, setNotesPos]       = useState<{ top: number; left: number } | null>(null);
  const arrInputRef                   = useRef<HTMLInputElement>(null);

  function commitArr() {
    const val = parseFloat(arrDraft.replace(/[$,\s]/g, ''));
    if (!isNaN(val)) onUpdate('ais_arr', val);
    else if (arrDraft === '') onUpdate('ais_arr', null);
    setEditingArr(false);
  }

  function commitDate(val: string) {
    onUpdate('ais_close_date', val || null);
    setEditingDate(false);
  }

  const aisCloseQtr = toCloseQuarter(opp.ais_close_date || opp.close_date);
  const hasNotes    = !!opp.product_specialist_notes?.trim();

  const forecastEdited = opp.ais_forecast_manual === 1;
  const arrEdited      = opp.ais_arr_manual === 1;
  const dateEdited     = opp.ais_close_date_manual === 1;

  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
      <Td>
        <button
          onClick={() => window.api.openExternal(oppSfdcUrl(opp.crm_opportunity_id))}
          className="text-blue-500 hover:text-blue-700 hover:underline whitespace-nowrap"
        >
          SFDC ↗
        </button>
      </Td>

      <Td bold>{opp.account_name}</Td>

      <Td right>
        <span className="font-semibold text-gray-800">{fmtCurrency(oppTotalArr)}</span>
      </Td>

      <Td>
        {opp.vp_deal_forecast ? (
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${forecastPillClass(opp.vp_deal_forecast)}`}>
            {opp.vp_deal_forecast}
          </span>
        ) : '—'}
      </Td>

      <Td highlight edited={forecastEdited}>
        <select
          value={opp.ais_forecast ?? ''}
          onChange={(e) => onUpdate('ais_forecast', (e.target.value as AisForecast) || null)}
          className={`w-full rounded px-1.5 py-0.5 text-xs font-medium border-0 outline-none cursor-pointer ${
            opp.ais_forecast ? AIS_FORECAST_COLORS[opp.ais_forecast] : 'bg-gray-100 text-gray-400'
          }`}
        >
          <option value="">— set —</option>
          {AIS_FORECAST_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </Td>

      <Td highlight edited={arrEdited} right>
        {editingArr ? (
          <input
            ref={arrInputRef}
            autoFocus
            type="text"
            value={arrDraft}
            onChange={(e) => setArrDraft(e.target.value)}
            onBlur={commitArr}
            onKeyDown={(e) => { if (e.key === 'Enter') commitArr(); if (e.key === 'Escape') setEditingArr(false); }}
            className="w-24 border border-blue-400 rounded px-1.5 py-0.5 text-xs outline-none text-right bg-white"
          />
        ) : (
          <button
            onClick={() => { setArrDraft(opp.ais_arr != null ? String(opp.ais_arr) : ''); setEditingArr(true); }}
            className="font-semibold text-gray-700 hover:text-blue-600 hover:underline text-right w-full"
            title="Click to edit AIS ARR"
          >
            {opp.ais_arr != null ? fmtCurrency(opp.ais_arr) : <span className="text-gray-300 font-normal">edit</span>}
          </button>
        )}
      </Td>

      <Td highlight edited={dateEdited}>
        {editingDate ? (
          <input
            autoFocus
            type="date"
            defaultValue={opp.ais_close_date ?? ''}
            onBlur={(e) => commitDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditingDate(false); }}
            className="border border-blue-400 rounded px-1.5 py-0.5 text-xs outline-none bg-white"
          />
        ) : (
          <button
            onClick={() => setEditingDate(true)}
            className="text-gray-700 hover:text-blue-600 hover:underline whitespace-nowrap"
            title="Click to edit AIS Close Date"
          >
            {opp.ais_close_date ? fmtDate(opp.ais_close_date) : <span className="text-gray-300">edit</span>}
          </button>
        )}
      </Td>

      <Td highlight>
        <span className={`font-mono ${dateEdited ? 'text-amber-700 font-semibold' : opp.ais_close_date ? 'text-blue-700' : 'text-gray-500'}`}>
          {aisCloseQtr || '—'}
        </span>
      </Td>

      <Td highlight>
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={opp.ais_top_deal === 1}
            onChange={(e) => onToggleTopDeal(e.target.checked ? 1 : 0)}
            className="w-4 h-4 accent-green-600 cursor-pointer"
            title="Mark as AIS Top Deal"
          />
        </div>
      </Td>

      <Td>
        {hasNotes ? (
          <div className="relative">
            <button
              onMouseEnter={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setNotesPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) });
                setNotesOpen(true);
              }}
              onMouseLeave={() => setNotesOpen(false)}
              className="text-gray-400 hover:text-blue-500 max-w-[120px] truncate block text-left"
              title={opp.product_specialist_notes}
            >
              {opp.product_specialist_notes}
            </button>
            {notesOpen && notesPos && (
              <div
                style={{ position: 'fixed', top: notesPos.top, left: notesPos.left }}
                className="z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72 text-xs text-gray-700 whitespace-pre-wrap pointer-events-none max-h-48 overflow-y-auto"
              >
                {opp.product_specialist_notes}
              </div>
            )}
          </div>
        ) : <span className="text-gray-200">—</span>}
      </Td>

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
      <Td>{opp.stage_name}</Td>
      <Td>
        <span className="font-mono text-gray-600">{toCloseQuarter(opp.close_date) || '—'}</span>
      </Td>
      <Td nowrap>{fmtDate(opp.close_date)}</Td>
      <Td nowrap>{fmtDate(opp.s2_plus_date)}</Td>
      <Td right>
        <span className="font-semibold text-gray-700">{fmtCurrency(opp.product_arr_usd)}</span>
      </Td>
    </tr>
  );
}

// ── Shared UI ──────────────────────────────────────────────────

const STAT_COLORS: Record<string, string> = {
  green:  'text-green-700',
  blue:   'text-blue-700',
  yellow: 'text-yellow-600',
  orange: 'text-orange-600',
  gray:   'text-gray-900',
};

function StatCard({ label, value, color = 'gray', sub, delta }: {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
  delta?: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${STAT_COLORS[color] ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {delta != null && delta !== 0 && (
        <p className={`text-xs mt-1 font-medium ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {delta > 0 ? '▲' : '▼'} {fmtDelta(delta)} vs last upload
        </p>
      )}
    </div>
  );
}

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
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[180px]">
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
      {message}
    </div>
  );
}

function Th({ children, highlight = false, right = false }: { children: React.ReactNode; highlight?: boolean; right?: boolean }) {
  return (
    <th className={`px-3 py-2.5 text-left font-semibold whitespace-nowrap ${highlight ? 'bg-blue-50 text-blue-700' : 'text-gray-500'} ${right ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

function Td({
  children, bold = false, highlight = false, edited = false, right = false, nowrap = false,
}: {
  children: React.ReactNode;
  bold?: boolean;
  highlight?: boolean;
  edited?: boolean;
  right?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${bold ? 'font-medium text-gray-900' : 'text-gray-600'} ${edited ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : highlight ? 'bg-blue-50/40' : ''} ${right ? 'text-right' : ''} ${nowrap ? 'whitespace-nowrap' : ''}`}>
      {children}
    </td>
  );
}
