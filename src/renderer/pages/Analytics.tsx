import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertReason, AnalyticsData, ChangeType, ClosedWonOpp, ForecastChange, ForecastDifference, ForecastOpp, OppPushStats, Quota } from '../../shared/types';
import { mapForecast, toCloseQuarter, calculateWeightedPipe } from '../../shared/utils';
import { useFilters } from '../contexts/FilterContext';

// ── Formatters ─────────────────────────────────────────────────

function fmtDollar(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtCurrency(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : val > 0 ? '+' : '';
  return sign + '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtCurrencyAbs(val: number): string {
  return '$' + Math.abs(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtImportAt(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function pct(num: number, denom: number): string {
  if (!denom) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

function countUniqueOpps(list: ForecastOpp[]): number {
  return new Set(list.map((o) => o.crm_opportunity_id)).size;
}

function quarterToDateRange(quarter: string): string {
  const match = quarter.match(/(\d{4})Q(\d)/);
  if (!match) return quarter;
  const fiscalYear = parseInt(match[1]);
  const q = parseInt(match[2]);

  // Fiscal year starts Feb 1, so FY27 Q1 = Feb 1, 2026 - Apr 30, 2026
  const calendarYear = q === 4 ? fiscalYear : fiscalYear - 1;

  const ranges = {
    1: { start: 'Feb 1', end: 'Apr 30', year: calendarYear },
    2: { start: 'May 1', end: 'Jul 31', year: calendarYear },
    3: { start: 'Aug 1', end: 'Oct 31', year: calendarYear },
    4: { start: 'Nov 1', end: 'Jan 31', startYear: calendarYear, endYear: fiscalYear },
  };

  const range = ranges[q as keyof typeof ranges];
  if (!range) return quarter;

  if (q === 4) {
    return `${range.start}, ${range.startYear} - ${range.end}, ${range.endYear}`;
  }
  return `${range.start} - ${range.end}, ${range.year}`;
}

// ── Constants ──────────────────────────────────────────────────

const CHANGE_LABELS: Record<ChangeType, string> = {
  arr_up:               'ARR ↑',
  arr_down:             'ARR ↓',
  date_pushed:          'Date pushed',
  date_pulled:          'Date pulled in',
  stage_progressed:     'Stage ↑',
  stage_regressed:      'Stage ↓',
  vp_forecast_changed:  'VP Forecast changed',
  ais_forecast_changed: 'AIS Forecast changed',
  opp_added:            'New opp',
  opp_dropped:          'Opp dropped',
};

const CHANGE_COLORS: Record<ChangeType, string> = {
  arr_up:               'bg-emerald-100 text-emerald-800',
  arr_down:             'bg-red-100 text-red-700',
  date_pushed:          'bg-orange-100 text-orange-800',
  date_pulled:          'bg-blue-100 text-blue-700',
  stage_progressed:     'bg-green-100 text-green-800',
  stage_regressed:      'bg-red-100 text-red-700',
  vp_forecast_changed:  'bg-yellow-100 text-yellow-800',
  ais_forecast_changed: 'bg-indigo-100 text-indigo-800',
  opp_added:            'bg-purple-100 text-purple-700',
  opp_dropped:          'bg-gray-100 text-gray-500',
};

const ALERT_LABELS: Record<AlertReason, string> = {
  pushed_out_of_quarter: 'Pushed out of quarter',
  multi_push:            'Pushed multiple times',
  stage_regression:      'Stage went backward',
  large_new_opp:         'Large new opp',
};

const PRODUCT_COLORS: Record<string, string> = {
  'ai agents': 'bg-purple-50 text-purple-700',
  'copilot':   'bg-blue-50 text-blue-700',
  'qa':        'bg-teal-50 text-teal-700',
  'ai expert': 'bg-indigo-50 text-indigo-700',
  'wem':       'bg-orange-50 text-orange-700',
};
function productClass(p: string): string {
  return PRODUCT_COLORS[p.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

const PRODUCTS = ['AI Agents', 'Copilot', 'QA', 'AI Expert', 'WEM'];

type PageTab = 'overview' | 'executive';
type ChangesTab = 'all' | 'alerts' | 'arr' | 'dates' | 'stages' | 'forecast' | 'new_dropped';

const CHANGE_TABS: { id: ChangesTab; label: string }[] = [
  { id: 'all',         label: 'All' },
  { id: 'alerts',      label: '⚠️ Alerts' },
  { id: 'arr',         label: 'ARR' },
  { id: 'dates',       label: 'Dates' },
  { id: 'stages',      label: 'Stages' },
  { id: 'forecast',    label: 'Forecast' },
  { id: 'new_dropped', label: 'New / Dropped' },
];

// ── Main Page ──────────────────────────────────────────────────

export default function Analytics() {
  const [data, setData]         = useState<AnalyticsData | null>(null);
  const [opps, setOpps]         = useState<ForecastOpp[]>([]);
  const [closedWon, setClosedWon] = useState<ClosedWonOpp[]>([]);
  const [quotas, setQuotas]     = useState<Quota[]>([]);
  const [loading, setLoading]   = useState(true);
  const [pageTab, setPageTab]   = useState<PageTab>('executive');

  // Filters from context
  const { filters, updateAnalyticsOverviewFilters, updateAnalyticsChangesFilters } = useFilters();

  // Overview filters
  const { quarterFilter, managerFilter: managerFilterOv, aiAeFilter: aiAeFilterOv, regionFilter: regionFilterOv, segmentFilter: segmentFilterOv } = filters.analyticsOverview;

  // Changes filters
  const { changesTab, aiAeFilter, managerFilter, regionFilter, segmentFilter, importFilter, chDatePreset, chCustomFrom, chCustomTo } = filters.analyticsChanges;

  const load = useCallback(async () => {
    const [d, o, cw, q] = await Promise.all([
      window.api.getAnalyticsData(),
      window.api.getForecastOpps(),
      window.api.getClosedWonOpps(),
      window.api.getQuotas(),
    ]);
    setData(d);
    setOpps(o);
    setClosedWon(cw);
    setQuotas(q);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="flex-1 overflow-auto p-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {data?.lastImportAt
              ? `Last import: ${fmtImportAt(data.lastImportAt)}`
              : 'Upload a Pipeline CSV to start tracking changes'}
          </p>
        </div>
        {/* Page-level tabs */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['overview', 'executive'] as PageTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setPageTab(t)}
              className={`px-4 py-2 font-medium transition-colors ${
                pageTab === t
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {t === 'overview' ? 'CRO Overview' : 'Executive Summary'}
            </button>
          ))}
        </div>
      </div>

      {pageTab === 'overview'
        ? <OverviewTab
            opps={opps}
            closedWon={closedWon}
            quotas={quotas}
            multiPushOpps={data?.multiPushOpps ?? []}
            forecastDifferences={data?.forecastDifferences ?? []}
            quarterFilter={quarterFilter}
            setQuarterFilter={(v) => updateAnalyticsOverviewFilters({ quarterFilter: v })}
            managerFilter={managerFilterOv}
            setManagerFilter={(v) => updateAnalyticsOverviewFilters({ managerFilter: v })}
            aiAeFilter={aiAeFilterOv}
            setAiAeFilter={(v) => updateAnalyticsOverviewFilters({ aiAeFilter: v })}
            regionFilter={regionFilterOv}
            setRegionFilter={(v) => updateAnalyticsOverviewFilters({ regionFilter: v })}
            segmentFilter={segmentFilterOv}
            setSegmentFilter={(v) => updateAnalyticsOverviewFilters({ segmentFilter: v })}
          />
        : <ExecutiveSummaryTab
            changes={data?.changes ?? []}
            opps={opps}
            closedWon={closedWon}
            quotas={quotas}
            forecastDifferences={data?.forecastDifferences ?? []}
          />
      }
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════

function OverviewTab({
  opps, closedWon, quotas, multiPushOpps, forecastDifferences,
  quarterFilter, setQuarterFilter,
  managerFilter, setManagerFilter,
  aiAeFilter, setAiAeFilter,
  regionFilter, setRegionFilter,
  segmentFilter, setSegmentFilter,
}: {
  opps: ForecastOpp[];
  closedWon: ClosedWonOpp[];
  quotas: Quota[];
  multiPushOpps: OppPushStats[];
  forecastDifferences: ForecastDifference[];
  quarterFilter: Set<string>;
  setQuarterFilter: (v: Set<string>) => void;
  managerFilter: Set<string>;
  setManagerFilter: (v: Set<string>) => void;
  aiAeFilter: Set<string>;
  setAiAeFilter: (v: Set<string>) => void;
  regionFilter: Set<string>;
  setRegionFilter: (v: Set<string>) => void;
  segmentFilter: Set<string>;
  setSegmentFilter: (v: Set<string>) => void;
}) {
  // Filter option lists
  const allQuarters = [...new Set([
    ...opps.map((o) => toCloseQuarter(o.ais_close_date ?? o.close_date)),
    ...closedWon.map((o) => toCloseQuarter(o.close_date)),
  ])].filter(Boolean).sort();

  const allManagers  = [...new Set(opps.map((o) => o.manager_name).filter(Boolean))].sort();
  const allRegions   = [...new Set([...opps.map((o) => o.region), ...closedWon.map((o) => o.region)].filter(Boolean))].sort();
  const allSegments  = [...new Set([...opps.map((o) => o.segment), ...closedWon.map((o) => o.segment)].filter(Boolean))].sort();

  // Pass 1: quarter + manager + region + segment (for AI AE dropdown options)
  const baseOpps = opps.filter((o) => {
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.ais_close_date ?? o.close_date))) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    if (regionFilter.size > 0  && !regionFilter.has(o.region))        return false;
    if (segmentFilter.size > 0 && !segmentFilter.has(o.segment))      return false;
    return true;
  });
  const baseCW = closedWon.filter((o) => {
    if (quarterFilter.size > 0 && !quarterFilter.has(toCloseQuarter(o.close_date))) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name)) return false;
    if (regionFilter.size > 0  && !regionFilter.has(o.region))        return false;
    if (segmentFilter.size > 0 && !segmentFilter.has(o.segment))      return false;
    return true;
  });

  const allAiAes = [...new Set([
    ...baseOpps.map((o) => o.ai_ae),
    ...baseCW.map((o) => o.ai_ae),
  ].filter(Boolean))].sort();

  // Pass 2: apply AI AE multi-select
  const filteredOpps = baseOpps.filter((o) => aiAeFilter.size === 0 || aiAeFilter.has(o.ai_ae));
  const filteredCW   = baseCW.filter((o) => aiAeFilter.size === 0 || aiAeFilter.has(o.ai_ae));

  // Always use a quarter target — default to current fiscal quarter when no filter set
  const currentQuarter    = toCloseQuarter(new Date().toISOString().split('T')[0]);
  const effectiveQuarter  = quarterFilter.size === 1 ? [...quarterFilter][0] : currentQuarter;
  const targetLabel       = `${effectiveQuarter} Target`;

  function getTarget(q: typeof quotas[number] | undefined): number | null {
    if (!q) return null;
    const match = effectiveQuarter.match(/Q(\d)/);
    if (match) {
      const n = parseInt(match[1]);
      if (n === 1) return q.q1_target || null;
      if (n === 2) return q.q2_target || null;
      if (n === 3) return q.q3_target || null;
      if (n === 4) return q.q4_target || null;
    }
    return null;
  }

  // ── 1. Executive Summary ──────────────────────────────────────
  const arrOf = (o: ForecastOpp) => o.ais_arr ?? o.product_arr_usd;

  const totalPipeline  = filteredOpps.reduce((s, o) => s + arrOf(o), 0);
  const aisCommit      = filteredOpps.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + arrOf(o), 0);
  const aisMostLikely  = filteredOpps.filter((o) => o.ais_forecast === 'Most Likely').reduce((s, o) => s + arrOf(o), 0);
  const aisBestCase    = filteredOpps.filter((o) => o.ais_forecast === 'Best Case').reduce((s, o) => s + arrOf(o), 0);
  const aisRemaining   = filteredOpps.filter((o) => o.ais_forecast === 'Remaining Pipe').reduce((s, o) => s + arrOf(o), 0);
  const totalCW        = filteredCW.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
  const uniqueCWDeals  = new Set(filteredCW.map((o) => o.crm_opportunity_id)).size;
  const totalTarget    = quotas
    .filter((q) => {
      if (regionFilter.size > 0 && !regionFilter.has(q.region)) return false;
      if (aiAeFilter.size > 0   && !aiAeFilter.has(q.ai_ae))    return false;
      return true;
    })
    .reduce((s, q) => s + (getTarget(q) ?? 0), 0);

  // ── 2. Team Leaderboard ───────────────────────────────────────
  // Include quota holders even if they have no opps in the current filter
  const leaderboardAiAes = [...new Set([
    ...filteredOpps.map((o) => o.ai_ae).filter(Boolean),
    ...filteredCW.map((o) => o.ai_ae).filter(Boolean),
    ...quotas.map((q) => q.ai_ae),
  ])].sort();

  const leaderboard = leaderboardAiAes.map((ae) => {
    const aeOpps   = filteredOpps.filter((o) => o.ai_ae === ae);
    const aeCW     = filteredCW.filter((o) => o.ai_ae === ae);
    const quotaObj = quotas.find((q) => q.ai_ae === ae);
    const target   = getTarget(quotaObj);
    const cwTotal  = aeCW.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
    const commit   = aeOpps.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + arrOf(o), 0);
    const ml       = aeOpps.filter((o) => o.ais_forecast === 'Most Likely').reduce((s, o) => s + arrOf(o), 0);
    const pipeline = aeOpps.reduce((s, o) => s + arrOf(o), 0);
    const pushes   = aeOpps.reduce((s, o) => s + o.push_count, 0);
    const attainPct = target ? Math.round((cwTotal / target) * 100) : null;
    return { ae, cwTotal, commit, ml, pipeline, target, attainPct, pushes };
  }).sort((a, b) => b.cwTotal - a.cwTotal);

  const hasQuotas = quotas.length > 0;

  // ── 3. Pipeline Health ────────────────────────────────────────
  // By stage
  const stageMap: Record<string, { count: number; arr: number }> = {};
  filteredOpps.forEach((o) => {
    const stage = o.stage_name || 'Unknown';
    if (!stageMap[stage]) stageMap[stage] = { count: 0, arr: 0 };
    stageMap[stage].count++;
    stageMap[stage].arr += arrOf(o);
  });
  const byStage = Object.entries(stageMap).sort((a, b) => b[1].arr - a[1].arr);
  const totalStageArr = byStage.reduce((s, [, v]) => s + v.arr, 0);

  // By quarter (use all opps, not filtered by quarter)
  const quarterMap: Record<string, { count: number; arr: number; commit: number; ml: number }> = {};
  opps
    .filter((o) => managerFilter.size === 0 || managerFilter.has(o.manager_name))
    .forEach((o) => {
      const q = toCloseQuarter(o.ais_close_date ?? o.close_date) || 'Unknown';
      if (!quarterMap[q]) quarterMap[q] = { count: 0, arr: 0, commit: 0, ml: 0 };
      quarterMap[q].count++;
      quarterMap[q].arr += arrOf(o);
      if (o.ais_forecast === 'Commit') quarterMap[q].commit += arrOf(o);
      if (o.ais_forecast === 'Most Likely') quarterMap[q].ml += arrOf(o);
    });
  const byQuarter = Object.entries(quarterMap).sort((a, b) => a[0].localeCompare(b[0]));

  // ── 4. Product Mix ────────────────────────────────────────────
  const productPipeline = PRODUCTS.map((p) => {
    const rows = filteredOpps.filter((o) => o.product.toLowerCase() === p.toLowerCase());
    return {
      product: p,
      deals: new Set(rows.map((o) => o.crm_opportunity_id)).size,
      arr: rows.reduce((s, o) => s + arrOf(o), 0),
      commit: rows.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + arrOf(o), 0),
    };
  });

  const productCW = PRODUCTS.map((p) => {
    const rows = filteredCW.filter((o) => o.product.toLowerCase() === p.toLowerCase());
    const uniqueDeals = new Set(rows.map((o) => o.crm_opportunity_id)).size;
    const bookings = rows.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
    return { product: p, deals: uniqueDeals, bookings, avg: uniqueDeals > 0 ? bookings / uniqueDeals : 0 };
  });


  // ── 5a. Top Closed Deals (effective quarter) ─────────────────
  const cwForQuarter = filteredCW.filter((o) => toCloseQuarter(o.close_date) === effectiveQuarter);
  const cwOppMap: Record<string, { account_name: string; ai_ae: string; close_date: string; products: string[]; bookings: number }> = {};
  cwForQuarter.forEach((o) => {
    if (!cwOppMap[o.crm_opportunity_id]) {
      cwOppMap[o.crm_opportunity_id] = { account_name: o.account_name, ai_ae: o.ai_ae, close_date: o.close_date, products: [], bookings: 0 };
    }
    cwOppMap[o.crm_opportunity_id].products.push(o.product);
    cwOppMap[o.crm_opportunity_id].bookings += (o.edited_bookings ?? o.bookings);
  });
  const top10CW = Object.values(cwOppMap).sort((a, b) => b.bookings - a.bookings).slice(0, 10);

  // ── 5b. Top Deals in Pipe (>= $150k total ARR) ────────────────
  const pipeOppMap: Record<string, { crm_opportunity_id: string; account_name: string; ai_ae: string; close_date: string; stage_name: string; vp_forecast: string; ais_forecast: string | null; products: string[]; arr: number }> = {};
  filteredOpps.forEach((o) => {
    if (!pipeOppMap[o.crm_opportunity_id]) {
      pipeOppMap[o.crm_opportunity_id] = { crm_opportunity_id: o.crm_opportunity_id, account_name: o.account_name, ai_ae: o.ai_ae, close_date: o.close_date, stage_name: o.stage_name, vp_forecast: o.vp_deal_forecast, ais_forecast: o.ais_forecast, products: [], arr: 0 };
    }
    pipeOppMap[o.crm_opportunity_id].products.push(o.product);
    pipeOppMap[o.crm_opportunity_id].arr += arrOf(o);
  });
  const topPipeDeals = Object.values(pipeOppMap)
    .filter((o) => o.arr >= 100_000)
    .sort((a, b) => b.arr - a.arr);

  // ── 5. At-Risk Deals ──────────────────────────────────────────
  const pushedOpps = filteredOpps
    .filter((o) => o.push_count > 0)
    .sort((a, b) => b.push_count - a.push_count)
    .slice(0, 10);

  const noForecast = filteredOpps
    .filter((o) => !o.ais_forecast && arrOf(o) >= 25_000)
    .sort((a, b) => arrOf(b) - arrOf(a))
    .slice(0, 10);

  // ── 6. Closed Won Analysis ────────────────────────────────────
  const cwQtrMap: Record<string, { bookings: number; deals: Set<string> }> = {};
  closedWon
    .filter((o) => managerFilter.size === 0 || managerFilter.has(o.manager_name))
    .forEach((o) => {
      const q = toCloseQuarter(o.close_date) || 'Unknown';
      if (!cwQtrMap[q]) cwQtrMap[q] = { bookings: 0, deals: new Set() };
      cwQtrMap[q].bookings += (o.edited_bookings ?? o.bookings);
      cwQtrMap[q].deals.add(o.crm_opportunity_id);
    });
  const cwByQuarter = Object.entries(cwQtrMap)
    .map(([q, v]) => ({ quarter: q, bookings: v.bookings, deals: v.deals.size }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));

  const cwByProduct = PRODUCTS.map((p) => {
    const rows = closedWon
      .filter((o) => (managerFilter.size === 0 || managerFilter.has(o.manager_name)) && o.product.toLowerCase() === p.toLowerCase());
    const uniqueDeals = new Set(rows.map((o) => o.crm_opportunity_id)).size;
    const bookings = rows.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
    return { product: p, deals: uniqueDeals, bookings, avg: uniqueDeals > 0 ? bookings / uniqueDeals : 0 };
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <MultiSelect options={allQuarters}  selected={quarterFilter}  onChange={setQuarterFilter}  placeholder="All Quarters"  noun="Quarters"  />
        <MultiSelect options={allRegions}   selected={regionFilter}   onChange={setRegionFilter}   placeholder="All Regions"   noun="Regions"   />
        <MultiSelect options={allManagers}  selected={managerFilter}  onChange={setManagerFilter}  placeholder="All Managers"  noun="Managers"  />
        <MultiSelect options={allSegments}  selected={segmentFilter}  onChange={setSegmentFilter}  placeholder="All Segments"  noun="Segments"  />
        <MultiSelect options={allAiAes}     selected={aiAeFilter}     onChange={setAiAeFilter}     placeholder="All AI AEs"    noun="AI AEs"    />
        {(quarterFilter.size > 0 || managerFilter.size > 0 || aiAeFilter.size > 0 || regionFilter.size > 0 || segmentFilter.size > 0) && (
          <button
            onClick={() => { setQuarterFilter(new Set()); setManagerFilter(new Set()); setAiAeFilter(new Set()); setRegionFilter(new Set()); setSegmentFilter(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Section 1: Executive Summary ── */}
      <Section title="Executive Summary" emoji="📋">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <BigCard label="Target" value={totalTarget > 0 ? fmtDollar(totalTarget) : '—'} sub={effectiveQuarter} color="gray" />
          <BigCard label="Deal Backed" value={fmtDollar(totalCW + aisCommit + aisMostLikely)} sub="CW + Commit + Most Likely" color="blue" />
          <BigCard label="Closed Won" value={fmtDollar(totalCW)} sub={`${uniqueCWDeals} deals`} color="green" />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <BigCard label="AIS Commit" value={fmtDollar(aisCommit)} sub={`${pct(aisCommit, totalPipeline)} of pipe`} color="emerald" />
          <BigCard label="AIS Most Likely" value={fmtDollar(aisMostLikely)} sub={`${pct(aisMostLikely, totalPipeline)} of pipe`} color="yellow" />
          <BigCard label="AIS Best Case" value={fmtDollar(aisBestCase)} sub={`${pct(aisBestCase, totalPipeline)} of pipe`} color="orange" />
          <BigCard label="Remaining Pipe" value={fmtDollar(aisRemaining)} sub="no forecast assigned" color="gray" />
          <BigCard label="Total Pipeline" value={fmtDollar(totalPipeline)} sub={`${countUniqueOpps(filteredOpps)} opps`} color="gray" />
        </div>
      </Section>

      {/* ── Section 2: Team Leaderboard ── */}
      <Section title="Team Leaderboard" emoji="🏆">
        {leaderboard.length === 0 ? (
          <EmptyState text="No pipeline data yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                <th className="text-left pb-2">AI AE</th>
                {hasQuotas && <th className="text-right pb-2">{targetLabel}</th>}
                <th className="text-right pb-2 text-green-700">Closed Won</th>
                {hasQuotas && <th className="text-right pb-2 text-green-700">Attainment</th>}
                <th className="text-right pb-2 text-emerald-700">Commit</th>
                <th className="text-right pb-2 text-yellow-700">Most Likely</th>
                <th className="text-right pb-2">Pipeline</th>
                <th className="text-right pb-2 text-orange-500">Pushes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leaderboard.map((row) => {
                const attainColor = row.attainPct == null ? ''
                  : row.attainPct >= 100 ? 'text-green-700 font-bold'
                  : row.attainPct >= 75  ? 'text-yellow-700'
                  : 'text-red-600';
                return (
                  <tr key={row.ae} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2 font-medium text-gray-900">{row.ae}</td>
                    {hasQuotas && <td className="py-2 text-right text-gray-500">{row.target != null ? fmtDollar(row.target) : <span className="text-gray-300">—</span>}</td>}
                    <td className="py-2 text-right font-semibold text-green-700">{fmtDollar(row.cwTotal)}</td>
                    {hasQuotas && (
                      <td className={`py-2 text-right font-semibold ${attainColor}`}>
                        {row.attainPct != null ? `${row.attainPct}%` : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="py-2 text-right text-emerald-700">{fmtDollar(row.commit)}</td>
                    <td className="py-2 text-right text-yellow-700">{fmtDollar(row.ml)}</td>
                    <td className="py-2 text-right text-gray-700">{fmtDollar(row.pipeline)}</td>
                    <td className={`py-2 text-right font-medium ${row.pushes > 0 ? 'text-orange-500' : 'text-gray-300'}`}>
                      {row.pushes > 0 ? row.pushes : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {leaderboard.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-sm">
                  <td className="pt-2 text-gray-700">Total</td>
                  {hasQuotas && (
                    <td className="pt-2 text-right text-gray-500">
                      {(() => {
                        const total = leaderboard.reduce((s, r) => s + (r.target ?? 0), 0);
                        return total > 0 ? fmtDollar(total) : '—';
                      })()}
                    </td>
                  )}
                  <td className="pt-2 text-right text-green-700">{fmtDollar(leaderboard.reduce((s, r) => s + r.cwTotal, 0))}</td>
                  {hasQuotas && (
                    <td className="pt-2 text-right text-green-700">
                      {(() => {
                        const totalTarget = leaderboard.reduce((s, r) => s + (r.target ?? 0), 0);
                        const totalCwSum  = leaderboard.reduce((s, r) => s + r.cwTotal, 0);
                        return totalTarget > 0 ? `${Math.round((totalCwSum / totalTarget) * 100)}%` : '—';
                      })()}
                    </td>
                  )}
                  <td className="pt-2 text-right text-emerald-700">{fmtDollar(leaderboard.reduce((s, r) => s + r.commit, 0))}</td>
                  <td className="pt-2 text-right text-yellow-700">{fmtDollar(leaderboard.reduce((s, r) => s + r.ml, 0))}</td>
                  <td className="pt-2 text-right text-gray-700">{fmtDollar(leaderboard.reduce((s, r) => s + r.pipeline, 0))}</td>
                  <td className="pt-2 text-right text-orange-500">{leaderboard.reduce((s, r) => s + r.pushes, 0) || '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </Section>

      {/* ── Top Deals in Pipe ── */}
      <Section title="Top Deals in Pipe ($100K+)" emoji="🔭">
        {topPipeDeals.length === 0 ? (
          <EmptyState text="No pipeline deals over $100K." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                <th className="text-left pb-2">Account</th>
                <th className="text-left pb-2">VP Forecast</th>
                <th className="text-left pb-2">AIS Forecast</th>
                <th className="text-left pb-2">Products</th>
                <th className="text-left pb-2">Stage</th>
                <th className="text-left pb-2">Close</th>
                <th className="text-left pb-2">AI AE</th>
                <th className="text-right pb-2">Total ARR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topPipeDeals.map((deal, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-900">
                    <div className="flex items-center gap-1.5">
                      {deal.account_name}
                      <button
                        onClick={() => window.api.openExternal(`https://zendesk.lightning.force.com/lightning/r/Opportunity/${deal.crm_opportunity_id}/view`)}
                        className="text-blue-400 hover:text-blue-600 text-xs shrink-0"
                        title="Open in Salesforce"
                      >
                        ↗
                      </button>
                    </div>
                  </td>
                  {(() => {
                    const vpNorm = mapForecast(deal.vp_forecast);
                    const mismatch = !!vpNorm && !!deal.ais_forecast && vpNorm !== deal.ais_forecast;
                    return (
                      <>
                        <td className="py-2 text-xs text-gray-500">{deal.vp_forecast || '—'}</td>
                        <td className="py-2 text-xs">
                          {deal.ais_forecast ? (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${mismatch ? 'bg-amber-100 text-amber-800' : 'bg-green-50 text-green-700'}`}>
                              {deal.ais_forecast}
                              {mismatch && <span title={`VP: ${deal.vp_forecast}`}>⚠</span>}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </>
                    );
                  })()}
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(deal.products)].map((p) => (
                        <span key={p} className={`px-1.5 py-0.5 rounded text-xs font-medium ${productClass(p)}`}>{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-gray-500 text-xs max-w-[140px] truncate">{deal.stage_name}</td>
                  <td className="py-2 text-gray-500 text-xs whitespace-nowrap">{toCloseQuarter(deal.close_date)}</td>
                  <td className="py-2 text-gray-500">{deal.ai_ae || '—'}</td>
                  <td className="py-2 text-right font-bold text-gray-800">{fmtDollar(deal.arr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Section 3: Pipeline Health ── */}
      <Section title="Pipeline Health" emoji="📊">
        <div className="grid grid-cols-2 gap-6">
          {/* By Quarter */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Quarter</p>
            {byQuarter.length === 0 ? <EmptyState text="No data." /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                    <th className="text-left pb-2">Quarter</th>
                    <th className="text-right pb-2">Opps</th>
                    <th className="text-right pb-2">Pipeline</th>
                    <th className="text-right pb-2 text-emerald-700">Commit</th>
                    <th className="text-right pb-2 text-yellow-700">ML</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {byQuarter.map(([q, v]) => (
                    <tr key={q} className="hover:bg-gray-50">
                      <td className="py-1.5 font-medium text-gray-900">{q}</td>
                      <td className="py-1.5 text-right text-gray-500">{v.count}</td>
                      <td className="py-1.5 text-right text-gray-700 font-semibold">{fmtDollar(v.arr)}</td>
                      <td className="py-1.5 text-right text-emerald-700">{fmtDollar(v.commit)}</td>
                      <td className="py-1.5 text-right text-yellow-700">{fmtDollar(v.ml)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* By Stage */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Stage</p>
            {byStage.length === 0 ? <EmptyState text="No data." /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                    <th className="text-left pb-2">Stage</th>
                    <th className="text-right pb-2">Opps</th>
                    <th className="text-right pb-2">ARR</th>
                    <th className="text-right pb-2">% of Pipe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {byStage.map(([stage, v]) => (
                    <tr key={stage} className="hover:bg-gray-50">
                      <td className="py-1.5 text-gray-900 max-w-[160px] truncate">{stage}</td>
                      <td className="py-1.5 text-right text-gray-500">{v.count}</td>
                      <td className="py-1.5 text-right text-gray-700 font-semibold">{fmtDollar(v.arr)}</td>
                      <td className="py-1.5 text-right text-gray-400">{pct(v.arr, totalStageArr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Section>

      {/* ── Section 4: Product Mix ── */}
      <Section title="Product Mix & Cross-sell" emoji="🧩">
        <div className="grid grid-cols-2 gap-6 mb-4">
          {/* Pipeline by product */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pipeline by Product</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                  <th className="text-left pb-2">Product</th>
                  <th className="text-right pb-2">Deals</th>
                  <th className="text-right pb-2">ARR</th>
                  <th className="text-right pb-2 text-emerald-700">Commit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {productPipeline.map((row) => (
                  <tr key={row.product} className="hover:bg-gray-50">
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${productClass(row.product)}`}>{row.product}</span>
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{row.deals}</td>
                    <td className="py-1.5 text-right text-gray-700 font-semibold">{fmtDollar(row.arr)}</td>
                    <td className="py-1.5 text-right text-emerald-700">{fmtDollar(row.commit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="pt-2 text-gray-700">Total</td>
                  <td className="pt-2 text-right text-gray-500">{productPipeline.reduce((s, r) => s + r.deals, 0)}</td>
                  <td className="pt-2 text-right text-gray-700">{fmtDollar(productPipeline.reduce((s, r) => s + r.arr, 0))}</td>
                  <td className="pt-2 text-right text-emerald-700">{fmtDollar(productPipeline.reduce((s, r) => s + r.commit, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Closed Won by product */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Closed Won by Product</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                  <th className="text-left pb-2">Product</th>
                  <th className="text-right pb-2">Deals</th>
                  <th className="text-right pb-2">Bookings</th>
                  <th className="text-right pb-2">Avg Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cwByProduct.map((row) => (
                  <tr key={row.product} className="hover:bg-gray-50">
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${productClass(row.product)}`}>{row.product}</span>
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{row.deals || '—'}</td>
                    <td className="py-1.5 text-right text-gray-700 font-semibold">{row.bookings > 0 ? fmtDollar(row.bookings) : '—'}</td>
                    <td className="py-1.5 text-right text-gray-500">{row.avg > 0 ? fmtDollar(row.avg) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(() => {
                  const totalDeals    = cwByProduct.reduce((s, r) => s + r.deals, 0);
                  const totalBookings = cwByProduct.reduce((s, r) => s + r.bookings, 0);
                  return (
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td className="pt-2 text-gray-700">Total</td>
                      <td className="pt-2 text-right text-gray-500">{totalDeals || '—'}</td>
                      <td className="pt-2 text-right text-gray-700">{totalBookings > 0 ? fmtDollar(totalBookings) : '—'}</td>
                      <td className="pt-2 text-right text-gray-500">{totalDeals > 0 ? fmtDollar(totalBookings / totalDeals) : '—'}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        </div>
      </Section>

      {/* ── Section 4b: Top 10 Closed Deals ── */}
      <Section title={`Top Closed Deals — ${effectiveQuarter}`} emoji="🏆">
        {top10CW.length === 0 ? (
          <EmptyState text={`No closed won deals in ${effectiveQuarter}.`} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                <th className="text-left pb-2">#</th>
                <th className="text-left pb-2">Account</th>
                <th className="text-left pb-2">Products</th>
                <th className="text-left pb-2">AI AE</th>
                <th className="text-right pb-2 text-green-700">Bookings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {top10CW.map((deal, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-2 text-gray-400 text-xs w-6">{i + 1}</td>
                  <td className="py-2 font-medium text-gray-900">{deal.account_name}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(deal.products)].map((p) => (
                        <span key={p} className={`px-1.5 py-0.5 rounded text-xs font-medium ${productClass(p)}`}>{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-gray-500">{deal.ai_ae || '—'}</td>
                  <td className="py-2 text-right font-semibold text-green-700">{fmtDollar(deal.bookings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Section 5: At-Risk Deals ── */}
      <Section title="At-Risk Deals" emoji="⚠️">
        <div className="grid grid-cols-2 gap-6">
          {/* Pushed opps */}
          <div>
            <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-2">Pushed Deals (push count &gt; 0)</p>
            {pushedOpps.length === 0 ? (
              <p className="text-xs text-gray-400">No pushed deals.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 font-semibold">
                    <th className="text-left pb-1.5">Account</th>
                    <th className="text-left pb-1.5">Product</th>
                    <th className="text-right pb-1.5 text-orange-500">Pushes</th>
                    <th className="text-right pb-1.5">ARR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pushedOpps.map((o) => (
                    <tr key={o.id} className="hover:bg-orange-50/30">
                      <td className="py-1.5 font-medium text-gray-900 max-w-[140px] truncate">{o.account_name}</td>
                      <td className="py-1.5">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${productClass(o.product)}`}>{o.product}</span>
                      </td>
                      <td className="py-1.5 text-right font-bold text-orange-600">{o.push_count}</td>
                      <td className="py-1.5 text-right text-gray-700">{fmtDollar(o.ais_arr ?? o.product_arr_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* No AIS forecast */}
          <div>
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">No AIS Forecast Set ($25K+)</p>
            {noForecast.length === 0 ? (
              <p className="text-xs text-gray-400">All significant opps have forecasts assigned.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 font-semibold">
                    <th className="text-left pb-1.5">Account</th>
                    <th className="text-left pb-1.5">Product</th>
                    <th className="text-left pb-1.5">Stage</th>
                    <th className="text-right pb-1.5">ARR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {noForecast.map((o) => (
                    <tr key={o.id} className="hover:bg-red-50/20">
                      <td className="py-1.5 font-medium text-gray-900 max-w-[120px] truncate">{o.account_name}</td>
                      <td className="py-1.5">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${productClass(o.product)}`}>{o.product}</span>
                      </td>
                      <td className="py-1.5 text-gray-500 max-w-[100px] truncate">{o.stage_name}</td>
                      <td className="py-1.5 text-right font-semibold text-gray-700">{fmtDollar(o.product_arr_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Section>

      {/* ── Section 6: Closed Won Analysis ── */}
      <Section title="Closed Won Analysis" emoji="✅">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Quarter</p>
            {cwByQuarter.length === 0 ? <EmptyState text="No closed won data." /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                    <th className="text-left pb-2">Quarter</th>
                    <th className="text-right pb-2">Deals</th>
                    <th className="text-right pb-2">Bookings</th>
                    <th className="text-right pb-2">Avg Deal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cwByQuarter.map((row) => (
                    <tr key={row.quarter} className="hover:bg-gray-50">
                      <td className="py-1.5 font-medium text-gray-900">{row.quarter}</td>
                      <td className="py-1.5 text-right text-gray-500">{row.deals}</td>
                      <td className="py-1.5 text-right font-semibold text-green-700">{fmtDollar(row.bookings)}</td>
                      <td className="py-1.5 text-right text-gray-500">{fmtDollar(row.bookings / row.deals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Product</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                  <th className="text-left pb-2">Product</th>
                  <th className="text-right pb-2">Deals</th>
                  <th className="text-right pb-2">Bookings</th>
                  <th className="text-right pb-2">Avg Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cwByProduct.map((row) => (
                  <tr key={row.product} className="hover:bg-gray-50">
                    <td className="py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${productClass(row.product)}`}>{row.product}</span>
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{row.deals || '—'}</td>
                    <td className="py-1.5 text-right font-semibold text-green-700">{row.bookings > 0 ? fmtDollar(row.bookings) : '—'}</td>
                    <td className="py-1.5 text-right text-gray-500">{row.avg > 0 ? fmtDollar(row.avg) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
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
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[200px]">
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

// ── Section wrapper ────────────────────────────────────────────

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-4">
      <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span>{emoji}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function BigCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue:    'bg-blue-50 border-blue-100',
    green:   'bg-green-50 border-green-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    yellow:  'bg-yellow-50 border-yellow-100',
    orange:  'bg-orange-50 border-orange-100',
    gray:    'bg-gray-50 border-gray-100',
  };
  const valueColors: Record<string, string> = {
    blue: 'text-blue-900', green: 'text-green-900', emerald: 'text-emerald-900',
    yellow: 'text-yellow-900', orange: 'text-orange-900', gray: 'text-gray-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color] ?? colors.gray}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueColors[color] ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 italic py-2">{text}</p>;
}

function ForecastDifferencesSection({
  differences,
  regionFilter,
  managerFilter,
  segmentFilter,
  aiAeFilter,
  snapshotStart,
  snapshotEnd,
  liveOpps,
  closedWon,
  dateFrom,
  dateTo,
}: {
  differences: ForecastDifference[];
  regionFilter: Set<string>;
  managerFilter: Set<string>;
  segmentFilter: Set<string>;
  aiAeFilter: Set<string>;
  snapshotStart: ForecastOpp[] | null;
  snapshotEnd: ForecastOpp[] | null;
  liveOpps: ForecastOpp[];
  closedWon: ClosedWonOpp[];
  dateFrom: string;
  dateTo: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Safety check
  if (!differences || !Array.isArray(differences)) {
    return null;
  }

  // Apply filters
  const filteredDifferences = differences.filter(d => {
    if (regionFilter.size > 0 && !regionFilter.has(d.region ?? '')) return false;
    if (managerFilter.size > 0 && !managerFilter.has(d.manager_name ?? '')) return false;
    if (segmentFilter.size > 0 && !segmentFilter.has(d.segment ?? '')) return false;
    if (aiAeFilter.size > 0 && !aiAeFilter.has(d.ai_ae ?? '')) return false;
    return true;
  });

  // Calculate summary stats
  const categoryDiffs = filteredDifferences.filter(d => d?.diff_type === 'category');
  const arrDiffs = filteredDifferences.filter(d => d?.diff_type === 'arr');
  const dateDiffs = filteredDifferences.filter(d => d?.diff_type === 'date');

  // Category breakdown
  const moreConservative = categoryDiffs.filter(d => {
    const vp = d.vp_value;
    const ais = d.ais_value;
    // More conservative means moving from better to worse: Commit→ML, ML→BestCase, BestCase→Remaining
    if (vp === 'Commit' && (ais === 'Most Likely' || ais === 'Best Case' || ais === 'Remaining Pipe')) return true;
    if (vp === 'Most Likely' && (ais === 'Best Case' || ais === 'Remaining Pipe')) return true;
    if (vp === 'Best Case' && ais === 'Remaining Pipe') return true;
    return false;
  }).length;
  const moreOptimistic = categoryDiffs.length - moreConservative;

  // ARR stats
  const totalArrDelta = arrDiffs.reduce((sum, d) => sum + (d.arr_delta || 0), 0);
  const avgArrChange = arrDiffs.length > 0 ? Math.round(totalArrDelta / arrDiffs.length) : 0;

  // Date stats
  const pushedOut = dateDiffs.filter(d => (d.days_delta || 0) > 0).length;
  const pulledIn = dateDiffs.filter(d => (d.days_delta || 0) < 0).length;
  const avgDaysDelta = dateDiffs.length > 0 ? Math.round(dateDiffs.reduce((sum, d) => sum + (d.days_delta || 0), 0) / dateDiffs.length) : 0;

  // ARR by forecast category - calculate delta between AIS and VP
  const categories = ['Commit', 'Most Likely', 'Best Case', 'Remaining Pipe'];
  const categoryDeltas: Record<string, { ais: number; vp: number; delta: number; count: number }> = {};

  categories.forEach(cat => {
    // AIS total: sum of ais_arr where ais_value = this category
    const aisTotal = filteredDifferences
      .filter(d => d.ais_value === cat)
      .reduce((sum, d) => sum + d.ais_arr, 0);

    // VP total: sum of opp_arr where vp_value = this category
    const vpTotal = filteredDifferences
      .filter(d => d.vp_value === cat)
      .reduce((sum, d) => sum + d.opp_arr, 0);

    // Count: how many opps involve this category (either AIS or VP)
    const count = new Set([
      ...filteredDifferences.filter(d => d.ais_value === cat).map(d => d.crm_opportunity_id),
      ...filteredDifferences.filter(d => d.vp_value === cat).map(d => d.crm_opportunity_id),
    ]).size;

    categoryDeltas[cat] = {
      ais: aisTotal,
      vp: vpTotal,
      delta: aisTotal - vpTotal,
      count,
    };
  });

  // Calculate Deal Backed and Closed Won deltas from snapshots
  const passesFilters = (o: { region?: string; manager_name?: string; segment?: string; ai_ae?: string }) => {
    if (regionFilter.size > 0 && !regionFilter.has(o.region ?? '')) return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name ?? '')) return false;
    if (segmentFilter.size > 0 && !segmentFilter.has(o.segment ?? '')) return false;
    if (aiAeFilter.size > 0 && !aiAeFilter.has(o.ai_ae ?? '')) return false;
    return true;
  };

  // CW that closed in period - always calculate this regardless of snapshots
  const cwInPeriod = closedWon
    .filter(o => o.close_date >= dateFrom && o.close_date <= dateTo && passesFilters(o))
    .reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0);

  let dealBackedDelta = 0;
  const closedWonDelta = cwInPeriod; // Always show total CW for the period

  if (snapshotStart && (snapshotEnd || liveOpps)) {
    // Calculate start state (Commit + ML)
    const startCommit = snapshotStart.filter(o => passesFilters(o) && o.ais_forecast === 'Commit').reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const startML = snapshotStart.filter(o => passesFilters(o) && o.ais_forecast === 'Most Likely').reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const startDealBacked = startCommit + startML;

    // Calculate end state (Commit + ML) - use live data if dateTo is today, otherwise use snapshot
    const today = new Date().toISOString().split('T')[0];
    const effectiveEndOpps = dateTo >= today ? liveOpps : (snapshotEnd || liveOpps);
    const endCommit = effectiveEndOpps.filter(o => passesFilters(o) && o.ais_forecast === 'Commit').reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const endML = effectiveEndOpps.filter(o => passesFilters(o) && o.ais_forecast === 'Most Likely').reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const endDealBacked = endCommit + endML;

    // Deal Backed delta = (end - start) + CW
    dealBackedDelta = (endDealBacked - startDealBacked) + cwInPeriod;
  }

  const oppSfdcUrl = (oppId: string) => `https://zendesk.lightning.force.com/lightning/r/Opportunity/${oppId}/view`;

  const dateRangeLabel = dateFrom && dateTo ? ` (${fmtDate(dateFrom)} - ${fmtDate(dateTo)})` : '';

  return (
    <Section title={`Forecast Differences${dateRangeLabel}`} emoji="🎯">
      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <BigCard
          label="AIS Deal Backed Δ"
          value={dealBackedDelta === 0 ? '—' : `${dealBackedDelta > 0 ? '+' : ''}${fmtDollar(Math.abs(dealBackedDelta))}`}
          sub="CW + Commit + ML change"
          color={dealBackedDelta > 0 ? 'emerald' : dealBackedDelta < 0 ? 'orange' : 'gray'}
        />
        <BigCard
          label="Closed Won"
          value={closedWonDelta === 0 ? '—' : fmtDollar(closedWonDelta)}
          sub="Deals closed in period"
          color={closedWonDelta > 0 ? 'green' : 'gray'}
        />
        <BigCard
          label="AIS Category Overrides"
          value={String(categoryDiffs.length)}
          sub={categoryDiffs.length > 0 ? `↓ ${moreConservative} conservative, ↑ ${moreOptimistic} optimistic` : 'No overrides'}
          color="blue"
        />
        <BigCard
          label="AIS ARR Adjustments"
          value={String(arrDiffs.length)}
          sub={arrDiffs.length > 0 ? `Avg: ${fmtCurrency(avgArrChange)} | Total: ${fmtCurrency(totalArrDelta)}` : 'No adjustments'}
          color="gray"
        />
        <BigCard
          label="AIS Date Changes"
          value={String(dateDiffs.length)}
          sub={dateDiffs.length > 0 ? `⏰ ${pushedOut} pushed, ⏩ ${pulledIn} pulled in | Avg: ${avgDaysDelta > 0 ? '+' : ''}${avgDaysDelta}d` : 'No changes'}
          color="orange"
        />
      </div>

      {/* Forecast category breakdown */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Commit</p>
          <p className={`text-lg font-bold ${categoryDeltas['Commit'].delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {categoryDeltas['Commit'].delta > 0 ? '+' : categoryDeltas['Commit'].delta < 0 ? '-' : ''}{fmtCurrencyAbs(categoryDeltas['Commit'].delta)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            AIS vs VP | {categoryDeltas['Commit'].count} opp{categoryDeltas['Commit'].count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Most Likely</p>
          <p className={`text-lg font-bold ${categoryDeltas['Most Likely'].delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {categoryDeltas['Most Likely'].delta > 0 ? '+' : categoryDeltas['Most Likely'].delta < 0 ? '-' : ''}{fmtCurrencyAbs(categoryDeltas['Most Likely'].delta)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            AIS vs VP | {categoryDeltas['Most Likely'].count} opp{categoryDeltas['Most Likely'].count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Best Case</p>
          <p className={`text-lg font-bold ${categoryDeltas['Best Case'].delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {categoryDeltas['Best Case'].delta > 0 ? '+' : categoryDeltas['Best Case'].delta < 0 ? '-' : ''}{fmtCurrencyAbs(categoryDeltas['Best Case'].delta)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            AIS vs VP | {categoryDeltas['Best Case'].count} opp{categoryDeltas['Best Case'].count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Remaining Pipe</p>
          <p className={`text-lg font-bold ${categoryDeltas['Remaining Pipe'].delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {categoryDeltas['Remaining Pipe'].delta > 0 ? '+' : categoryDeltas['Remaining Pipe'].delta < 0 ? '-' : ''}{fmtCurrencyAbs(categoryDeltas['Remaining Pipe'].delta)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            AIS vs VP | {categoryDeltas['Remaining Pipe'].count} opp{categoryDeltas['Remaining Pipe'].count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {filteredDifferences.length === 0 ? (
        <EmptyState text="No forecast differences match current filters." />
      ) : (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:text-blue-800 underline mb-3"
          >
            {expanded ? '▼ Hide details' : `▶ Show ${filteredDifferences.length} difference${filteredDifferences.length === 1 ? '' : 's'}`}
          </button>

          {expanded && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Account</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Product</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">AI AE</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Close Date</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Opp ARR</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">AIS ARR</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">VP Forecast</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">AIS Forecast</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500">SFDC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredDifferences.map((diff, idx) => {
                    const forecastColors: Record<string, string> = {
                      'Commit': 'bg-green-600 text-white',
                      'Best Case': 'bg-blue-600 text-white',
                      'Most Likely': 'bg-yellow-500 text-white',
                      'Remaining Pipe': 'bg-gray-400 text-white',
                    };

                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-900 font-medium">{diff.account_name}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${productClass(diff.product)}`}>
                            {diff.product}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">{diff.ai_ae || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">{fmtDate(diff.close_date)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900">{fmtCurrencyAbs(diff.opp_arr)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtCurrencyAbs(diff.ais_arr)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            diff.diff_type === 'category' ? 'bg-blue-100 text-blue-800' :
                            diff.diff_type === 'arr' ? 'bg-green-100 text-green-800' :
                            'bg-orange-100 text-orange-800'
                          }`}>
                            {diff.diff_type === 'category' ? 'Category' : diff.diff_type === 'arr' ? 'ARR' : 'Date'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {diff.diff_type === 'category' ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${forecastColors[diff.vp_value] || 'bg-gray-100 text-gray-600'}`}>
                              {diff.vp_value}
                            </span>
                          ) : diff.diff_type === 'arr' ? (
                            <span className="text-xs text-gray-600">{diff.vp_value}</span>
                          ) : (
                            <span className="text-xs text-gray-600">{fmtDate(diff.vp_value)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {diff.diff_type === 'category' ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${forecastColors[diff.ais_value] || 'bg-gray-100 text-gray-600'}`}>
                              {diff.ais_value}
                            </span>
                          ) : diff.diff_type === 'arr' ? (
                            <span className={`text-xs font-medium ${diff.arr_delta && diff.arr_delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {diff.ais_value} {diff.arr_delta != null && `(${fmtCurrencyAbs(diff.arr_delta)})`}
                            </span>
                          ) : (
                            <span className={`text-xs font-medium ${diff.days_delta && diff.days_delta > 0 ? 'text-orange-600' : 'text-blue-600'}`}>
                              {fmtDate(diff.ais_value)} {diff.days_delta != null && `(${diff.days_delta > 0 ? '+' : ''}${diff.days_delta}d)`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <a
                            href={oppSfdcUrl(diff.crm_opportunity_id)}
                            onClick={(e) => { e.preventDefault(); window.api.openExternal(oppSfdcUrl(diff.crm_opportunity_id)); }}
                            className="text-blue-600 hover:text-blue-800 text-xs underline"
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════
// CHANGES TAB
// ══════════════════════════════════════════════════════════════

function ChangesTab({
  data, opps,
  tab, setTab,
  aiAeFilter, setAiAeFilter,
  managerFilter, setManagerFilter,
  regionFilter, setRegionFilter,
  segmentFilter, setSegmentFilter,
  importFilter, setImportFilter,
  chDatePreset, setChDatePreset,
  chCustomFrom, setChCustomFrom,
  chCustomTo, setChCustomTo,
}: {
  data: AnalyticsData | null;
  opps: ForecastOpp[];
  tab: ChangesTab;
  setTab: (t: ChangesTab) => void;
  aiAeFilter: Set<string>;
  setAiAeFilter: (v: Set<string>) => void;
  managerFilter: Set<string>;
  setManagerFilter: (v: Set<string>) => void;
  regionFilter: Set<string>;
  setRegionFilter: (v: Set<string>) => void;
  segmentFilter: Set<string>;
  setSegmentFilter: (v: Set<string>) => void;
  importFilter: string;
  setImportFilter: (v: string) => void;
  chDatePreset: 'latest' | 'last7' | 'last14' | 'this_month' | 'custom';
  setChDatePreset: (v: 'latest' | 'last7' | 'last14' | 'this_month' | 'custom') => void;
  chCustomFrom: string;
  setChCustomFrom: (v: string) => void;
  chCustomTo: string;
  setChCustomTo: (v: string) => void;
}) {
  if (!data) return <div className="text-gray-400 text-sm">No data.</div>;

  const { changes, lastImportAt, multiPushOpps, totalPipelineNow, totalPipelinePrev } = data;

  // Build region/segment lookup from current opps (keyed by crm_opportunity_id)
  const oppInfoMap = new Map<string, { region: string; segment: string }>();
  for (const o of opps) {
    if (!oppInfoMap.has(o.crm_opportunity_id)) {
      oppInfoMap.set(o.crm_opportunity_id, { region: o.region, segment: o.segment });
    }
  }

  const allAiAes    = [...new Set(changes.map((c) => c.ai_ae).filter(Boolean))].sort();
  const allManagers = [...new Set(changes.map((c) => c.manager_name).filter(Boolean))].sort();
  const allRegions  = [...new Set(opps.map((o) => o.region).filter(Boolean))].sort();
  const allSegments = [...new Set(opps.map((o) => o.segment).filter(Boolean))].sort();
  const importDates  = [...new Set(changes.map((c) => c.imported_at))].sort().reverse();
  const latestImport = importDates[0] ?? null;

  // Compute date range for presets
  const todayStr = new Date().toISOString().split('T')[0];
  let chDateFrom = '';
  let chDateTo   = todayStr;
  if (chDatePreset === 'last7')       chDateFrom = new Date(Date.now() - 7  * 86400000).toISOString().split('T')[0];
  else if (chDatePreset === 'last14') chDateFrom = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  else if (chDatePreset === 'this_month') {
    const now = new Date();
    chDateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  } else if (chDatePreset === 'custom') {
    chDateFrom = chCustomFrom || todayStr;
    chDateTo   = chCustomTo   || todayStr;
  }

  const filtered = changes.filter((c) => {
    // Date filter
    if (chDatePreset === 'latest') {
      const imp = importFilter || latestImport;
      if (imp && c.imported_at !== imp) return false;
    } else {
      const d = c.imported_at.split('T')[0];
      if (d < chDateFrom || d > chDateTo) return false;
    }
    if (aiAeFilter.size > 0    && !aiAeFilter.has(c.ai_ae))           return false;
    if (managerFilter.size > 0 && !managerFilter.has(c.manager_name)) return false;
    if (regionFilter.size > 0 || segmentFilter.size > 0) {
      const info = oppInfoMap.get(c.crm_opportunity_id);
      if (regionFilter.size > 0  && !regionFilter.has(info?.region ?? ''))   return false;
      if (segmentFilter.size > 0 && !segmentFilter.has(info?.segment ?? '')) return false;
    }
    return true;
  });

  const tabFiltered = filtered.filter((c) => {
    if (tab === 'alerts')      return c.is_alert === 1;
    if (tab === 'arr')         return c.change_type === 'arr_up' || c.change_type === 'arr_down';
    if (tab === 'dates')       return c.change_type === 'date_pushed' || c.change_type === 'date_pulled';
    if (tab === 'stages')      return c.change_type === 'stage_progressed' || c.change_type === 'stage_regressed';
    if (tab === 'forecast')    return c.change_type === 'vp_forecast_changed' || c.change_type === 'ais_forecast_changed';
    if (tab === 'new_dropped') return c.change_type === 'opp_added' || c.change_type === 'opp_dropped';
    return true;
  });

  const alerts       = filtered.filter((c) => c.is_alert === 1);
  const arrUp        = filtered.filter((c) => c.change_type === 'arr_up').reduce((s, c) => s + (c.delta_numeric ?? 0), 0);
  const arrDown      = filtered.filter((c) => c.change_type === 'arr_down').reduce((s, c) => s + (c.delta_numeric ?? 0), 0);
  const datePushed   = filtered.filter((c) => c.change_type === 'date_pushed');
  const totalDaysPushed = datePushed.reduce((s, c) => s + (c.delta_numeric ?? 0), 0);
  const stageUp      = filtered.filter((c) => c.change_type === 'stage_progressed').length;
  const stageDown    = filtered.filter((c) => c.change_type === 'stage_regressed').length;
  const added        = filtered.filter((c) => c.change_type === 'opp_added').length;
  const dropped      = filtered.filter((c) => c.change_type === 'opp_dropped').length;
  const pipelineDiff = totalPipelineNow - totalPipelinePrev;
  const hasFilters = aiAeFilter.size > 0 || managerFilter.size > 0 || regionFilter.size > 0 || segmentFilter.size > 0;

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Date range presets */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
          {(['latest', 'last7', 'last14', 'this_month', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setChDatePreset(p)}
              className={`px-3 py-1.5 font-medium transition-colors ${chDatePreset === p ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {p === 'latest' ? 'Latest' : p === 'last7' ? 'Last 7d' : p === 'last14' ? 'Last 14d' : p === 'this_month' ? 'This Month' : 'Custom'}
            </button>
          ))}
        </div>
        {/* Import selector — only shown on Latest preset */}
        {chDatePreset === 'latest' && (
          <select
            value={importFilter}
            onChange={(e) => setImportFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 outline-none focus:ring-2 focus:ring-green-400 bg-white"
          >
            <option value="">Latest import</option>
            {importDates.map((ts) => (
              <option key={ts} value={ts}>{fmtImportAt(ts)}</option>
            ))}
          </select>
        )}
        {/* Custom date inputs */}
        {chDatePreset === 'custom' && (
          <>
            <input type="date" value={chCustomFrom} onChange={(e) => setChCustomFrom(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-green-400" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={chCustomTo} onChange={(e) => setChCustomTo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-green-400" />
          </>
        )}
        <MultiSelect options={allRegions}   selected={regionFilter}   onChange={setRegionFilter}   placeholder="All Regions"   noun="Regions"   />
        <MultiSelect options={allManagers}  selected={managerFilter}  onChange={setManagerFilter}  placeholder="All Managers"  noun="Managers"  />
        <MultiSelect options={allSegments}  selected={segmentFilter}  onChange={setSegmentFilter}  placeholder="All Segments"  noun="Segments"  />
        <MultiSelect options={allAiAes}     selected={aiAeFilter}     onChange={setAiAeFilter}     placeholder="All AI AEs"    noun="AI AEs"    />
        {hasFilters && (
          <button
            onClick={() => { setAiAeFilter(new Set()); setManagerFilter(new Set()); setRegionFilter(new Set()); setSegmentFilter(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Clear
          </button>
        )}
      </div>

      {changes.length === 0 ? (
        <div className="text-center py-24 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
          No change history yet. Upload a Pipeline CSV to begin tracking what changes between imports.
        </div>
      ) : (
        <>
          {/* Alerts Banner */}
          {alerts.length > 0 && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">
                {alerts.length} Alert{alerts.length !== 1 ? 's' : ''} — needs attention
              </p>
              <div className="flex flex-col gap-2">
                {alerts.map((c) => <AlertCard key={c.id} change={c} />)}
              </div>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            <SummaryCard
              label="Pipeline Change"
              value={fmtCurrency(pipelineDiff)}
              sub="vs previous import"
              positive={pipelineDiff > 0}
              negative={pipelineDiff < 0}
            />
            <SummaryCard
              label="ARR Changes"
              value={`+${fmtCurrencyAbs(arrUp)} / ${fmtCurrencyAbs(arrDown)}`}
              sub={`${filtered.filter(c => c.change_type === 'arr_up' || c.change_type === 'arr_down').length} opps`}
            />
            <SummaryCard
              label="Dates Pushed"
              value={datePushed.length}
              sub={`${Math.round(totalDaysPushed)} total days slipped`}
              negative={datePushed.length > 0}
            />
            <SummaryCard
              label="Stage Movement"
              value={`${stageUp} ↑  ${stageDown} ↓`}
              sub={stageDown > 0 ? `${stageDown} regression${stageDown !== 1 ? 's' : ''}` : 'no regressions'}
              negative={stageDown > 0}
            />
            <SummaryCard
              label="New / Dropped"
              value={`+${added} / -${dropped}`}
              sub={`${filtered.length} total changes`}
            />
          </div>

          {/* Change Feed */}
          <section className="mb-8">
            <div className="flex items-center gap-1 mb-3 border-b border-gray-100 pb-2">
              {CHANGE_TABS.map((t) => {
                const count = t.id === 'all' ? filtered.length
                  : t.id === 'alerts' ? alerts.length
                  : filtered.filter((c) => {
                    if (t.id === 'arr')         return c.change_type === 'arr_up' || c.change_type === 'arr_down';
                    if (t.id === 'dates')       return c.change_type === 'date_pushed' || c.change_type === 'date_pulled';
                    if (t.id === 'stages')      return c.change_type === 'stage_progressed' || c.change_type === 'stage_regressed';
                    if (t.id === 'forecast')    return c.change_type === 'vp_forecast_changed' || c.change_type === 'ais_forecast_changed';
                    if (t.id === 'new_dropped') return c.change_type === 'opp_added' || c.change_type === 'opp_dropped';
                    return false;
                  }).length;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                      tab === t.id
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {t.label} {count > 0 && <span className={tab === t.id ? 'text-gray-300' : 'text-gray-400'}>({count})</span>}
                  </button>
                );
              })}
            </div>

            {tabFiltered.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
                No changes in this category for the selected import.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
                      <th className="px-4 py-2.5 text-left">Account</th>
                      <th className="px-4 py-2.5 text-left">Opp</th>
                      <th className="px-4 py-2.5 text-left">Product</th>
                      <th className="px-4 py-2.5 text-left">Change</th>
                      <th className="px-4 py-2.5 text-left">Detail</th>
                      <th className="px-4 py-2.5 text-left">AI AE</th>
                      <th className="px-4 py-2.5 text-left">Manager</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tabFiltered.map((c) => <ChangeRow key={c.id} change={c} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Multi-Push Leaderboard */}
          {multiPushOpps.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Most Pushed Opps</h3>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-semibold">
                      <th className="px-4 py-2.5 text-left">Account</th>
                      <th className="px-4 py-2.5 text-left">Product</th>
                      <th className="px-4 py-2.5 text-right text-orange-500">Pushes</th>
                      <th className="px-4 py-2.5 text-right text-orange-500">Total Days Slipped</th>
                      <th className="px-4 py-2.5 text-right">Current ARR</th>
                      <th className="px-4 py-2.5 text-left">AI AE</th>
                      <th className="px-4 py-2.5 text-left">Manager</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {multiPushOpps.map((opp) => <PushRow key={`${opp.crm_opportunity_id}::${opp.product}`} opp={opp} />)}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Alert Card ─────────────────────────────────────────────────

function AlertCard({ change: c }: { change: ForecastChange }) {
  const alertLabel = c.alert_reason ? ALERT_LABELS[c.alert_reason] : 'Alert';
  const icon = c.alert_reason === 'stage_regression' ? '⬇️'
    : c.alert_reason === 'large_new_opp' ? '🐟'
    : '⚠️';

  return (
    <div className="flex items-start gap-3 bg-white rounded-lg px-3 py-2 border border-red-100">
      <span className="text-sm mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-gray-900">{c.account_name}</span>
        {' — '}
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRODUCT_COLORS[c.product.toLowerCase()] ?? 'bg-gray-100 text-gray-600'}`}>{c.product}</span>
        {' '}
        <span className="text-red-700 font-medium">{alertLabel}</span>
        {c.change_type === 'date_pushed' && c.old_value && c.new_value && (
          <span className="text-gray-500 ml-1">
            {toCloseQuarter(c.old_value)} → {toCloseQuarter(c.new_value)}
            {c.delta_numeric != null && ` (+${Math.round(c.delta_numeric)} days)`}
          </span>
        )}
        {c.change_type === 'stage_regressed' && c.old_value && c.new_value && (
          <span className="text-gray-500 ml-1">{c.old_value} → {c.new_value}</span>
        )}
        {c.change_type === 'opp_added' && c.delta_numeric != null && (
          <span className="text-gray-500 ml-1">{fmtCurrencyAbs(c.delta_numeric)} ARR</span>
        )}
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">{c.ai_ae}</span>
    </div>
  );
}

// ── Change Row ─────────────────────────────────────────────────

function ChangeRow({ change: c }: { change: ForecastChange }) {
  function detail(): string {
    switch (c.change_type) {
      case 'arr_up':
      case 'arr_down':
        return `${fmtCurrencyAbs(c.old_value ? parseFloat(c.old_value) : 0)} → ${fmtCurrencyAbs(c.new_value ? parseFloat(c.new_value) : 0)} (${c.delta_numeric != null ? fmtCurrency(c.delta_numeric) : ''})`;
      case 'date_pushed':
      case 'date_pulled':
        return `${fmtDate(c.old_value)} → ${fmtDate(c.new_value)}${c.delta_numeric != null ? ` (${c.delta_numeric > 0 ? '+' : ''}${Math.round(c.delta_numeric)} days)` : ''}`;
      case 'stage_progressed':
      case 'stage_regressed':
        return `${c.old_value} → ${c.new_value}`;
      case 'vp_forecast_changed':
      case 'ais_forecast_changed':
        return `${c.old_value || '(none)'} → ${c.new_value || '(none)'}`;
      case 'opp_added':
        return c.new_value ? `${fmtCurrencyAbs(parseFloat(c.new_value))} ARR` : '';
      case 'opp_dropped':
        return c.old_value ? `${fmtCurrencyAbs(parseFloat(c.old_value))} ARR` : '';
      default:
        return '';
    }
  }

  return (
    <tr className={`transition-colors ${c.is_alert ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}`}>
      <td className="px-4 py-2.5 font-medium text-gray-900">{c.account_name}</td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => window.api.openExternal(`https://zendesk.lightning.force.com/lightning/r/Opportunity/${c.crm_opportunity_id}/view`)}
          className="text-blue-500 hover:text-blue-700 hover:underline text-xs whitespace-nowrap"
        >
          SFDC ↗
        </button>
      </td>
      <td className="px-4 py-2.5">
        <span className={`px-1.5 py-0.5 rounded font-medium ${productClass(c.product)}`}>{c.product}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${CHANGE_COLORS[c.change_type]}`}>
          {CHANGE_LABELS[c.change_type]}
        </span>
        {c.is_alert === 1 && c.alert_reason && (
          <span className="ml-1.5 text-red-500 font-semibold text-xs">{ALERT_LABELS[c.alert_reason]}</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-gray-600">{detail()}</td>
      <td className="px-4 py-2.5 text-gray-500">{c.ai_ae || '—'}</td>
      <td className="px-4 py-2.5 text-gray-500">{c.manager_name || '—'}</td>
    </tr>
  );
}

// ── Push Row ───────────────────────────────────────────────────

function PushRow({ opp }: { opp: OppPushStats }) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5 font-medium text-gray-900">{opp.account_name}</td>
      <td className="px-4 py-2.5">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${productClass(opp.product)}`}>{opp.product}</span>
      </td>
      <td className="px-4 py-2.5 text-right font-bold text-orange-600">{opp.push_count}</td>
      <td className="px-4 py-2.5 text-right font-semibold text-orange-600">{opp.total_days_pushed} days</td>
      <td className="px-4 py-2.5 text-right text-gray-700 font-semibold">${opp.current_arr.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
      <td className="px-4 py-2.5 text-gray-500">{opp.ai_ae || '—'}</td>
      <td className="px-4 py-2.5 text-gray-500">{opp.manager_name || '—'}</td>
    </tr>
  );
}

// ══════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY TAB
// ══════════════════════════════════════════════════════════════

function ExecutiveSummaryTab({
  changes,
  opps,
  closedWon,
  quotas,
  forecastDifferences,
}: {
  changes: ForecastChange[];
  opps: ForecastOpp[];
  closedWon: ClosedWonOpp[];
  quotas: Quota[];
  forecastDifferences: ForecastDifference[];
}) {
  const [datePreset, setDatePreset] = useState<'last7' | 'last14' | 'this_month' | 'this_qtr' | 'custom'>('this_qtr');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [regionFilter, setRegionFilter]   = useState<Set<string>>(new Set());
  const [managerFilter, setManagerFilter] = useState<Set<string>>(new Set());
  const [segmentFilter, setSegmentFilter] = useState<Set<string>>(new Set());
  const [aiAeFilter, setAiAeFilter]       = useState<Set<string>>(new Set());
  const [forecastType, setForecastType]   = useState<'ais' | 'vp'>('ais');
  const [changesQtrScope, setChangesQtrScope] = useState<'this_qtr' | 'next_qtr' | 'all'>('this_qtr');
  const [arrFilter, setArrFilter]             = useState<'all' | '50k_plus'>('50k_plus');
  const [newOppFilter, setNewOppFilter]       = useState<'all' | '50k_plus'>('50k_plus');

  // Historical snapshots state
  const [snapshotStart, setSnapshotStart] = useState<ForecastOpp[] | null>(null);
  const [snapshotEnd, setSnapshotEnd] = useState<ForecastOpp[] | null>(null);
  const [useHistorical, setUseHistorical] = useState(true);

  // Compute date range
  const today = new Date().toISOString().split('T')[0];
  let dateFrom: string;
  let dateTo: string = today;
  if (datePreset === 'last7') {
    dateFrom = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  } else if (datePreset === 'last14') {
    dateFrom = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  } else if (datePreset === 'this_month') {
    const now = new Date();
    dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  } else if (datePreset === 'this_qtr') {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    let qStart: Date;
    if (m === 1)      qStart = new Date(y - 1, 10, 1); // Nov 1 prev year
    else if (m <= 4)  qStart = new Date(y, 1, 1);       // Feb 1
    else if (m <= 7)  qStart = new Date(y, 4, 1);       // May 1
    else if (m <= 10) qStart = new Date(y, 7, 1);       // Aug 1
    else              qStart = new Date(y, 10, 1);      // Nov 1
    dateFrom = qStart.toISOString().split('T')[0];
  } else {
    dateFrom = customFrom || today;
    dateTo   = customTo   || today;
  }

  // Fetch historical snapshots when date range changes
  useEffect(() => {
    if (!useHistorical) {
      setSnapshotStart(null);
      setSnapshotEnd(null);
      return;
    }

    window.api.getSnapshotsBetweenDates(dateFrom, dateTo).then(({ start, end }) => {
      setSnapshotStart(start);
      setSnapshotEnd(end);
    });
  }, [dateFrom, dateTo, useHistorical]);

  // Dropdown options
  const allRegions   = [...new Set([...opps.map((o) => o.region),   ...closedWon.map((o) => o.region)].filter(Boolean))].sort();
  const allManagers  = [...new Set([...opps.map((o) => o.manager_name), ...closedWon.map((o) => o.manager_name)].filter(Boolean))].sort();
  const allSegments  = [...new Set([...opps.map((o) => o.segment),  ...closedWon.map((o) => o.segment)].filter(Boolean))].sort();
  const allExecAiAes = [...new Set([...opps.map((o) => o.ai_ae),    ...closedWon.map((o) => o.ai_ae)].filter(Boolean))].sort();

  function passesOtherFilters(o: { region?: string; manager_name?: string; segment?: string; ai_ae?: string }) {
    if (regionFilter.size > 0  && !regionFilter.has(o.region ?? ''))       return false;
    if (managerFilter.size > 0 && !managerFilter.has(o.manager_name ?? '')) return false;
    if (segmentFilter.size > 0 && !segmentFilter.has(o.segment ?? ''))      return false;
    if (aiAeFilter.size > 0    && !aiAeFilter.has(o.ai_ae ?? ''))           return false;
    return true;
  }

  const filteredCW   = closedWon.filter((o) => o.close_date >= dateFrom && o.close_date <= dateTo && passesOtherFilters(o));
  const filteredOpps = opps.filter((o) => passesOtherFilters(o));
  // Build key set from filteredOpps for region/segment cross-referencing on change records
  // (ForecastChange records don't carry region/segment, so we use current opp state as proxy)
  const filteredOppKeys = new Set(filteredOpps.map((o) => `${o.crm_opportunity_id}::${o.product}`));
  const filteredChanges = changes.filter((c) => {
    const d = c.imported_at.split('T')[0];
    if (d < dateFrom || d > dateTo) return false;
    if (managerFilter.size > 0 && !managerFilter.has(c.manager_name)) return false;
    if (aiAeFilter.size > 0    && !aiAeFilter.has(c.ai_ae))           return false;
    if ((regionFilter.size > 0 || segmentFilter.size > 0) && !filteredOppKeys.has(`${c.crm_opportunity_id}::${c.product}`)) return false;
    return true;
  });

  const currentQuarter = toCloseQuarter(today);
  const nextQuarter = (() => {
    const m = currentQuarter.match(/(\d{4})Q(\d)/);
    if (!m) return currentQuarter;
    const y = parseInt(m[1]); const q = parseInt(m[2]);
    return q === 4 ? `${y + 1}Q1` : `${y}Q${q + 1}`;
  })();

  // Lookup maps keyed by crm_opportunity_id::product for scoping changes by quarter
  const oppQuarterMap   = new Map<string, string>();
  const oppArrMap       = new Map<string, number>();
  const oppCloseDateMap = new Map<string, string>();
  const oppTotalArrMap  = new Map<string, number>(); // crm_opportunity_id → total ARR across products
  const oppForecastMap  = new Map<string, string | null>(); // crm_opportunity_id → highest-ranked forecast
  const oppAiAeMap      = new Map<string, string>(); // crm_opportunity_id → AI AE (first non-empty value)
  const forecastRank: Record<string, number> = { 'Commit': 3, 'Most Likely': 2, 'Best Case': 1, 'Remaining Pipe': 0 };
  for (const o of opps) {
    const key = `${o.crm_opportunity_id}::${o.product}`;
    const arr = o.ais_arr ?? o.product_arr_usd;
    oppQuarterMap.set(key, toCloseQuarter(o.ais_close_date ?? o.close_date));
    oppArrMap.set(key, arr);
    oppCloseDateMap.set(key, o.ais_close_date ?? o.close_date);
    oppTotalArrMap.set(o.crm_opportunity_id, (oppTotalArrMap.get(o.crm_opportunity_id) ?? 0) + arr);
    const forecast = forecastType === 'ais' ? (o.ais_forecast ?? null) : (o.vp_deal_forecast || null);
    const existingRank = forecastRank[oppForecastMap.get(o.crm_opportunity_id) ?? ''] ?? -1;
    const newRank = forecastRank[forecast ?? ''] ?? -1;
    if (newRank > existingRank) oppForecastMap.set(o.crm_opportunity_id, forecast);
    // Capture AI AE - prefer clean names (skip values that look like notes with " | " or are too long)
    if (o.ai_ae) {
      const isCleanName = o.ai_ae.length < 50 && !o.ai_ae.includes(' | ');
      const existing = oppAiAeMap.get(o.crm_opportunity_id);
      // Use this value if: (1) no existing value, (2) this is clean and existing isn't, or (3) this is shorter and both are clean
      if (!existing || (isCleanName && existing.length > 50) || (isCleanName && existing.includes(' | '))) {
        oppAiAeMap.set(o.crm_opportunity_id, o.ai_ae);
      }
    }
  }

  const getArr = (o: ForecastOpp) => o.ais_arr ?? o.product_arr_usd;
  const isCommit = (o: ForecastOpp) => forecastType === 'ais' ? o.ais_forecast === 'Commit' : o.vp_deal_forecast === 'Commit';
  const isML     = (o: ForecastOpp) => forecastType === 'ais' ? o.ais_forecast === 'Most Likely' : o.vp_deal_forecast === 'Most Likely';

  // ── Section 1: What's Closed ─────────────────────────────────
  const cwOppMap: Record<string, { account_name: string; ai_ae: string; close_date: string; products: string[]; bookings: number }> = {};
  filteredCW.forEach((o) => {
    if (!cwOppMap[o.crm_opportunity_id]) {
      cwOppMap[o.crm_opportunity_id] = { account_name: o.account_name, ai_ae: o.ai_ae, close_date: o.close_date, products: [], bookings: 0 };
    }
    cwOppMap[o.crm_opportunity_id].products.push(o.product);
    cwOppMap[o.crm_opportunity_id].bookings += (o.edited_bookings ?? o.bookings);
  });
  const cwOpps       = Object.values(cwOppMap).sort((a, b) => b.bookings - a.bookings);
  const totalClosed  = filteredCW.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
  const bigCwOpps    = cwOpps.filter((o) => (o.edited_bookings ?? o.bookings) >= 50_000);
  const cwByProduct  = PRODUCTS.map((p) => {
    const rows = filteredCW.filter((o) => o.product.toLowerCase() === p.toLowerCase());
    return { product: p, deals: new Set(rows.map((o) => o.crm_opportunity_id)).size, bookings: rows.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0) };
  }).filter((r) => r.deals > 0);

  // ── Section 2: What's Forecast This Quarter ───────────────────
  // Use historical snapshot only if looking at past dates; for today, always use live data
  const effectiveOpps = useHistorical && snapshotEnd && dateTo < today ? snapshotEnd : opps;
  const effectiveFilteredOpps = effectiveOpps.filter((o) => passesOtherFilters(o));
  const isBestCase = (o: ForecastOpp) => forecastType === 'ais' ? o.ais_forecast === 'Best Case' : o.vp_deal_forecast === 'Best Case';
  const qtrOpps        = effectiveFilteredOpps.filter((o) => toCloseQuarter(o.ais_close_date ?? o.close_date) === currentQuarter);
  const commitArr      = qtrOpps.filter(isCommit).reduce((s, o) => s + getArr(o), 0);
  const mlArr          = qtrOpps.filter(isML).reduce((s, o) => s + getArr(o), 0);
  const bestCaseArr    = qtrOpps.filter(isBestCase).reduce((s, o) => s + getArr(o), 0);
  const remainingArr   = qtrOpps.filter((o) => o.ais_forecast === 'Remaining Pipe').reduce((s, o) => s + getArr(o), 0);
  const totalQtrPipe   = qtrOpps.reduce((s, o) => s + getArr(o), 0);
  const qtrCWTotal     = closedWon
    .filter((o) => toCloseQuarter(o.close_date) === currentQuarter && passesOtherFilters(o))
    .reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
  const dealBacked     = qtrCWTotal + commitArr + mlArr;
  const weightedPipe   = qtrCWTotal + qtrOpps.reduce((s, o) => s + calculateWeightedPipe(getArr(o), o.stage_name), 0);
  const qtrNum         = parseInt((currentQuarter.match(/Q(\d)/) ?? [])[1] ?? '0');
  const totalQtrTarget = quotas
    .filter((q) => {
      if (regionFilter.size > 0 && !regionFilter.has(q.region)) return false;
      if (aiAeFilter.size > 0   && !aiAeFilter.has(q.ai_ae))    return false;
      return true;
    })
    .reduce((s, q) => {
      const t = qtrNum === 1 ? q.q1_target : qtrNum === 2 ? q.q2_target : qtrNum === 3 ? q.q3_target : qtrNum === 4 ? q.q4_target : 0;
      return s + (t || 0);
    }, 0);

  // ── Section 2.5: Top Deals in the Pipe ───────────────────────
  // Only show deals closing in the current quarter (same as "What's Forecast This Quarter")
  const topDealsMap: Record<string, {
    account_name: string;
    ai_ae: string;
    vp_close_date: string;
    ais_close_date: string;
    products: string[];
    totalArr: number;
    totalAisArr: number;
    vp_forecast: string;
    ais_forecast: string;
    product_specialist_notes: string;
  }> = {};

  qtrOpps.forEach((o) => {
    if (!topDealsMap[o.crm_opportunity_id]) {
      topDealsMap[o.crm_opportunity_id] = {
        account_name: o.account_name,
        ai_ae: o.ai_ae,
        vp_close_date: o.close_date,
        ais_close_date: o.ais_close_date ?? o.close_date,
        products: [],
        totalArr: 0,
        totalAisArr: 0,
        vp_forecast: o.vp_deal_forecast || '',
        ais_forecast: o.ais_forecast || '',
        product_specialist_notes: o.product_specialist_notes || '',
      };
    }
    topDealsMap[o.crm_opportunity_id].products.push(o.product);
    topDealsMap[o.crm_opportunity_id].totalArr += o.product_arr_usd;
    topDealsMap[o.crm_opportunity_id].totalAisArr += o.ais_arr ?? o.product_arr_usd;
  });

  const topDeals = Object.entries(topDealsMap)
    .map(([id, deal]) => ({ crm_opportunity_id: id, ...deal }))
    .filter((d) => d.totalArr >= 100_000)
    .sort((a, b) => b.totalArr - a.totalArr);

  // ── Section 3: What's Changed ─────────────────────────────────
  // Scope changes to selected quarter (dropped opps only appear in "all")
  const scopedChanges = filteredChanges.filter((c) => {
    if (changesQtrScope === 'all') return true;
    const key = `${c.crm_opportunity_id}::${c.product}`;
    const qtr = oppQuarterMap.get(key);
    if (!qtr) return false;
    return qtr === (changesQtrScope === 'this_qtr' ? currentQuarter : nextQuarter);
  });

  const addedChanges   = scopedChanges.filter((c) => c.change_type === 'opp_added');
  const droppedChanges = scopedChanges.filter((c) => c.change_type === 'opp_dropped');
  const arrUpChanges   = scopedChanges.filter((c) => c.change_type === 'arr_up');
  const arrDownChanges = scopedChanges.filter((c) => c.change_type === 'arr_down');
  const datePushedList = scopedChanges.filter((c) => c.change_type === 'date_pushed');
  const datePulledList = scopedChanges.filter((c) => c.change_type === 'date_pulled');
  const totalArrUp     = arrUpChanges.reduce((s, c) => s + (c.delta_numeric ?? 0), 0);
  const totalArrDown   = arrDownChanges.reduce((s, c) => s + (c.delta_numeric ?? 0), 0);
  const longPushes     = datePushedList.filter((c) => (c.delta_numeric ?? 0) >= 30);
  const pushedOutOfQtr = datePushedList.filter((c) => c.old_value && c.new_value && toCloseQuarter(c.old_value) !== toCloseQuarter(c.new_value));

  // New opps: filter by opp-level total ARR, then group by crm_opportunity_id
  const addedChangesFiltered = newOppFilter === '50k_plus'
    ? addedChanges.filter((c) => (oppTotalArrMap.get(c.crm_opportunity_id) ?? parseFloat(c.new_value ?? '0')) >= 50_000)
    : addedChanges;
  const addedGrouped = (() => {
    const map = new Map<string, { crm_opportunity_id: string; account_name: string; products: string[]; totalArr: number; closeDate: string; ai_ae: string; importedAt: string; forecast: string | null }>();
    for (const c of addedChangesFiltered) {
      const oppKey = `${c.crm_opportunity_id}::${c.product}`;
      if (!map.has(c.crm_opportunity_id)) {
        map.set(c.crm_opportunity_id, {
          crm_opportunity_id: c.crm_opportunity_id,
          account_name: c.account_name,
          products: [c.product],
          totalArr: oppTotalArrMap.get(c.crm_opportunity_id) ?? parseFloat(c.new_value ?? '0'),
          closeDate: oppCloseDateMap.get(oppKey) ?? '',
          ai_ae: oppAiAeMap.get(c.crm_opportunity_id) ?? c.ai_ae,
          importedAt: c.imported_at,
          forecast: oppForecastMap.get(c.crm_opportunity_id) ?? null,
        });
      } else {
        const g = map.get(c.crm_opportunity_id)!;
        if (!g.products.includes(c.product)) g.products.push(c.product);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalArr - a.totalArr);
  })();

  // ARR increases: filter by opp-level total ARR, then group by crm_opportunity_id
  // ARR increases: net change per opp (arr_up + arr_down) — only show opps with a positive net
  const arrNetGrouped = (() => {
    const allArrChanges = scopedChanges.filter((c) => c.change_type === 'arr_up' || c.change_type === 'arr_down');
    const map = new Map<string, { crm_opportunity_id: string; account_name: string; products: string[]; totalArr: number; netDelta: number; ai_ae: string; importedAt: string; closeDate: string; forecast: string | null }>();
    for (const c of allArrChanges) {
      const id = c.crm_opportunity_id;
      if (!map.has(id)) {
        map.set(id, {
          crm_opportunity_id: id,
          account_name: c.account_name,
          products: [c.product],
          totalArr: oppTotalArrMap.get(id) ?? 0,
          netDelta: c.delta_numeric ?? 0,
          ai_ae: oppAiAeMap.get(id) ?? c.ai_ae,
          importedAt: c.imported_at,
          closeDate: oppCloseDateMap.get(`${id}::${c.product}`) ?? '',
          forecast: oppForecastMap.get(id) ?? null,
        });
      } else {
        const g = map.get(id)!;
        if (!g.products.includes(c.product)) g.products.push(c.product);
        g.netDelta += c.delta_numeric ?? 0;
        if (c.imported_at > g.importedAt) g.importedAt = c.imported_at;
      }
    }
    return Array.from(map.values())
      .filter((g) => g.netDelta > 0)
      .filter((g) => arrFilter === 'all' || g.totalArr >= 50_000)
      .sort((a, b) => b.netDelta - a.netDelta);
  })();

  // ── Forecast category deltas ──────────────────────────────────
  // Calculate deltas by comparing historical snapshots
  const forecastDeltas = (() => {
    const scopeQtr = changesQtrScope === 'this_qtr' ? currentQuarter : changesQtrScope === 'next_qtr' ? nextQuarter : null;

    // Helper to categorize opps by forecast and sum ARR
    const categorizeOpps = (opps: ForecastOpp[]) => {
      const cats = { commit: 0, ml: 0, bestCase: 0, remaining: 0, total: 0 };
      for (const o of opps) {
        if (!passesOtherFilters(o)) continue;
        if (scopeQtr && toCloseQuarter(o.ais_close_date ?? o.close_date) !== scopeQtr) continue;

        const arr = o.ais_arr ?? o.product_arr_usd;
        cats.total += arr;

        if (o.ais_forecast === 'Commit') cats.commit += arr;
        else if (o.ais_forecast === 'Most Likely') cats.ml += arr;
        else if (o.ais_forecast === 'Best Case') cats.bestCase += arr;
        else cats.remaining += arr;
      }
      return cats;
    };

    // If we have snapshots, compare them directly
    if (snapshotStart && snapshotEnd) {
      const start = categorizeOpps(snapshotStart);
      const end = categorizeOpps(snapshotEnd);

      const delta = {
        commit: end.commit - start.commit,
        ml: end.ml - start.ml,
        bestCase: end.bestCase - start.bestCase,
        remaining: end.remaining - start.remaining,
        total: end.total - start.total,
      };

      // Deal Backed = (change in Commit) + (change in ML) + (CW that closed in period)
      // This accounts for: new opps added to Commit/ML, deals closing from Commit/ML to CW
      const cwInPeriod = filteredCW.reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0);
      const dealBacked = delta.commit + delta.ml + cwInPeriod;

      return { ...delta, dealBacked };
    }

    // Fallback: no snapshots available, return zeros
    return { commit: 0, ml: 0, bestCase: 0, remaining: 0, total: 0, dealBacked: 0 };
  })();

  const hasFilters = regionFilter.size > 0 || managerFilter.size > 0 || segmentFilter.size > 0 || aiAeFilter.size > 0;

  const presetLabel = datePreset === 'last7' ? 'Last 7 days' : datePreset === 'last14' ? 'Last 14 days' : datePreset === 'this_month' ? 'This month' : datePreset === 'this_qtr' ? 'This quarter' : `${dateFrom} – ${dateTo}`;

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Date presets */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
          {(['last7', 'last14', 'this_month', 'this_qtr', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setDatePreset(p)}
              className={`px-3 py-1.5 font-medium transition-colors ${datePreset === p ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {p === 'last7' ? 'Last 7d' : p === 'last14' ? 'Last 14d' : p === 'this_month' ? 'This Month' : p === 'this_qtr' ? 'This Qtr' : 'Custom'}
            </button>
          ))}
        </div>
        {datePreset === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-green-400" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-green-400" />
          </>
        )}
        <MultiSelect options={allRegions}   selected={regionFilter}  onChange={setRegionFilter}  placeholder="All Regions"  noun="Regions"  />
        <MultiSelect options={allManagers}  selected={managerFilter} onChange={setManagerFilter} placeholder="All Managers" noun="Managers" />
        <MultiSelect options={allSegments}  selected={segmentFilter} onChange={setSegmentFilter} placeholder="All Segments" noun="Segments" />
        <MultiSelect options={allExecAiAes} selected={aiAeFilter}    onChange={setAiAeFilter}    placeholder="All AI AEs"   noun="AI AEs"   />
        {/* Forecast type toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
          {(['ais', 'vp'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setForecastType(t)}
              className={`px-3 py-1.5 font-medium transition-colors ${forecastType === t ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {t === 'ais' ? 'AIS Forecast' : 'VP Forecast'}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button
            onClick={() => { setRegionFilter(new Set()); setManagerFilter(new Set()); setSegmentFilter(new Set()); setAiAeFilter(new Set()); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* Historical mode indicator */}
      {useHistorical && snapshotEnd && dateTo < today && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📸</span>
            <div>
              <p className="text-sm font-semibold text-blue-900">Historical Snapshot Mode</p>
              <p className="text-xs text-blue-700">
                Showing pipeline state as of {dateTo}. Deltas calculated from {dateFrom} to {dateTo}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 1: What's Forecast This Quarter ── */}
      <Section title={`What's Forecast This Quarter (${currentQuarter}: ${quarterToDateRange(currentQuarter)})`} emoji="🎯">
        <div className="grid grid-cols-4 gap-3 mb-3">
          <BigCard label="Target"        value={totalQtrTarget > 0 ? fmtDollar(totalQtrTarget) : '—'} sub={currentQuarter}               color="gray"    />
          <BigCard label="Deal Backed"   value={fmtDollar(dealBacked)}                                sub="CW + Commit + Most Likely"    color="blue"    />
          <BigCard label="Weighted Pipe" value={fmtDollar(weightedPipe)}                              sub="CW + Stage-based Win Rates"  color="purple"  />
          <BigCard label="Closed Won"    value={fmtDollar(qtrCWTotal)}                                sub={`${new Set(closedWon.filter((o) => toCloseQuarter(o.close_date) === currentQuarter && passesOtherFilters(o)).map((o) => o.crm_opportunity_id)).size} deals`} color="green" />
        </div>
        <div className="grid grid-cols-5 gap-3">
          <BigCard label={forecastType === 'ais' ? 'AIS Commit'       : 'VP Commit'}       value={fmtDollar(commitArr)}    sub={`${pct(commitArr,   totalQtrPipe)} of pipe`} color="emerald" />
          <BigCard label={forecastType === 'ais' ? 'AIS Most Likely'  : 'VP Most Likely'}  value={fmtDollar(mlArr)}        sub={`${pct(mlArr,       totalQtrPipe)} of pipe`} color="yellow"  />
          <BigCard label={forecastType === 'ais' ? 'AIS Best Case'    : 'VP Best Case'}    value={fmtDollar(bestCaseArr)}  sub={`${pct(bestCaseArr, totalQtrPipe)} of pipe`} color="orange"  />
          <BigCard label="Remaining Pipe"                                                   value={fmtDollar(remainingArr)} sub="no forecast assigned"                        color="gray"    />
          <BigCard label="Total Pipeline"                                                   value={fmtDollar(totalQtrPipe)} sub={`${countUniqueOpps(qtrOpps)} opps`}                   color="gray"    />
        </div>
        {qtrOpps.length === 0 && <div className="mt-3"><EmptyState text={`No pipeline opps in ${currentQuarter}.`} /></div>}
      </Section>

      {/* ── Section 2: What's Closed ── */}
      <Section title={`What's Closed (${fmtDate(dateFrom)} - ${fmtDate(dateTo)})`} emoji="✅">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <BigCard label="Total Closed ARR"  value={totalClosed > 0 ? fmtDollar(totalClosed) : '—'} sub={`${cwOpps.length} deals`} color="green" />
          <BigCard label="Deals Closed"      value={String(cwOpps.length)} sub={presetLabel} color="gray" />
          <BigCard label="Deals ≥ $50K"      value={String(bigCwOpps.length)} sub={bigCwOpps.length > 0 ? fmtDollar(bigCwOpps.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0)) : 'none'} color="blue" />
        </div>

        {cwByProduct.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Product</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                  <th className="text-left pb-2">Product</th>
                  <th className="text-right pb-2">Deals</th>
                  <th className="text-right pb-2">Bookings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cwByProduct.map((r) => (
                  <tr key={r.product} className="hover:bg-gray-50">
                    <td className="py-1.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${productClass(r.product)}`}>{r.product}</span></td>
                    <td className="py-1.5 text-right text-gray-500">{r.deals}</td>
                    <td className="py-1.5 text-right font-semibold text-green-700">{fmtDollar(r.bookings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bigCwOpps.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Deals ≥ $50K</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 font-semibold">
                  <th className="text-left pb-2">Account</th>
                  <th className="text-left pb-2">Products</th>
                  <th className="text-left pb-2">AI AE</th>
                  <th className="text-left pb-2">Closed</th>
                  <th className="text-right pb-2">Bookings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bigCwOpps.map((deal, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{deal.account_name}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(deal.products)].map((p) => <span key={p} className={`px-1.5 py-0.5 rounded text-xs font-medium ${productClass(p)}`}>{p}</span>)}
                      </div>
                    </td>
                    <td className="py-2 text-gray-500">{deal.ai_ae || '—'}</td>
                    <td className="py-2 text-gray-500 text-xs">{fmtDate(deal.close_date)}</td>
                    <td className="py-2 text-right font-semibold text-green-700">{fmtDollar(deal.bookings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {filteredCW.length === 0 && <EmptyState text={`No closed won deals in the selected range (${presetLabel}).`} />}
      </Section>

      {/* ── Section 2.5: Forecast Differences ── */}
      <ForecastDifferencesSection
        differences={forecastDifferences}
        regionFilter={regionFilter}
        managerFilter={managerFilter}
        segmentFilter={segmentFilter}
        aiAeFilter={aiAeFilter}
        snapshotStart={snapshotStart}
        snapshotEnd={snapshotEnd}
        liveOpps={opps}
        closedWon={closedWon}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* ── Section 2.6: Top Deals in the Pipe ── */}
      <Section title={`Top Deals in the Pipe (${currentQuarter}: ${quarterToDateRange(currentQuarter)})`} emoji="💰">
        {topDeals.length === 0 ? (
          <EmptyState text="No deals over $100K in the pipeline." />
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-4">Showing deals over $100K ({topDeals.length} deals, {fmtDollar(topDeals.reduce((s, d) => s + d.totalArr, 0))} total)</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-400 border-b border-gray-100 font-semibold uppercase tracking-wide">
                  <th className="text-left pb-2 pr-3">Account</th>
                  <th className="text-left pb-2 px-2">Products</th>
                  <th className="text-right pb-2 px-2">Total ARR</th>
                  <th className="text-right pb-2 px-2">AIS ARR</th>
                  <th className="text-left pb-2 px-2">VP Forecast</th>
                  <th className="text-left pb-2 px-2">AIS Forecast</th>
                  <th className="text-left pb-2 px-2">VP Close</th>
                  <th className="text-left pb-2 px-2">AIS Close</th>
                  <th className="text-left pb-2 px-2">AI AE</th>
                  <th className="text-left pb-2 pl-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topDeals.map((deal) => {
                  const arrDiff = Math.abs(deal.totalArr - deal.totalAisArr) > 1000;
                  const forecastDiff = deal.vp_forecast !== deal.ais_forecast;
                  const dateDiff = deal.vp_close_date !== deal.ais_close_date;

                  return (
                    <tr key={deal.crm_opportunity_id} className="hover:bg-gray-50">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-900">{deal.account_name}</span>
                          <button
                            onClick={() => window.api.openExternal(`https://zendesk.lightning.force.com/lightning/r/Opportunity/${deal.crm_opportunity_id}/view`)}
                            className="text-blue-400 hover:text-blue-600 text-xs"
                          >
                            ↗
                          </button>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(deal.products)].map((p) => (
                            <span key={p} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${productClass(p)}`}>
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-gray-700">{fmtDollar(deal.totalArr)}</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-700">
                        <div className="flex items-center justify-end gap-1">
                          {arrDiff && <span className="text-orange-500" title="ARR differs from VP">⚠️</span>}
                          {fmtDollar(deal.totalAisArr)}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        {deal.vp_forecast ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                              {
                                'Commit': 'bg-green-600 text-white',
                                'Most Likely': 'bg-yellow-500 text-white',
                                'Best Case': 'bg-blue-600 text-white',
                                'Remaining Pipe': 'bg-gray-400 text-white',
                              }[deal.vp_forecast] ?? 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {deal.vp_forecast}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          {forecastDiff && <span className="text-orange-500" title="Forecast differs from VP">⚠️</span>}
                          {deal.ais_forecast ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                                {
                                  'Commit': 'bg-green-600 text-white',
                                  'Most Likely': 'bg-yellow-500 text-white',
                                  'Best Case': 'bg-blue-600 text-white',
                                  'Remaining Pipe': 'bg-gray-400 text-white',
                                }[deal.ais_forecast] ?? 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {deal.ais_forecast}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-gray-500">{fmtDate(deal.vp_close_date)}</td>
                      <td className="py-2 px-2 text-gray-500">
                        <div className="flex items-center gap-1">
                          {dateDiff && <span className="text-orange-500" title="Close date differs from VP">⚠️</span>}
                          {fmtDate(deal.ais_close_date)}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-gray-500">{deal.ai_ae || '—'}</td>
                      <td className="py-2 pl-2 text-gray-500 max-w-[200px] truncate" title={deal.product_specialist_notes}>
                        {deal.product_specialist_notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Section>
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────────────────

function SummaryCard({ label, value, sub, positive = false, negative = false }: {
  label: string; value: string | number; sub?: string; positive?: boolean; negative?: boolean;
}) {
  const valueColor = positive ? 'text-emerald-700' : negative ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 mb-1 truncate">{label}</p>
      <p className={`text-base font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
