import React, { useCallback, useEffect, useState } from 'react';
import type { ForecastOpp, ClosedWonOpp, ForecastChange } from '../../shared/types';
import { toCloseQuarter, getQuarterWeeks, formatWeekRange, calculateWeightedPipe } from '../../shared/utils';

// Print styles for PDF export
const printStyles = `
  @media print {
    /* Hide sidebar navigation */
    nav {
      display: none !important;
    }

    /* Make main content full width */
    main {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }

    body, html {
      overflow: visible !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .flex-1.overflow-auto {
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
    }

    /* Force all collapsible sections to expand */
    [data-collapsible-content] {
      display: block !important;
    }

    /* Page breaks */
    .page-break-before {
      page-break-before: always;
    }

    .page-break-avoid {
      page-break-inside: avoid;
    }

    /* Hide buttons and interactive elements */
    button {
      display: none !important;
    }

    /* Ensure proper page sizing and color preservation */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }

  /* Also apply when preparing for print */
  body.preparing-print nav {
    display: none !important;
  }

  body.preparing-print main {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
  }

  body.preparing-print .flex-1.overflow-auto {
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
  }

  body.preparing-print [data-collapsible-content] {
    display: block !important;
  }

  body.preparing-print button {
    display: none !important;
  }
`;

// ── Formatters ─────────────────────────────────────────────────

function fmtDollar(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '$0';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(num: number, denom: number): string {
  if (!denom) return '—';
  const pct = ((num / denom) * 100).toFixed(1);
  return `${pct}%`;
}

function fmtDelta(current: number, previous: number): { text: string; arrow: string; color: string } {
  const delta = current - previous;
  const pct = previous !== 0 ? ((delta / previous) * 100).toFixed(1) : '—';

  if (delta > 0) {
    return {
      text: `+${fmtDollar(delta)} (+${pct}%)`,
      arrow: '↑',
      color: 'text-emerald-600',
    };
  } else if (delta < 0) {
    return {
      text: `-${fmtDollar(Math.abs(delta))} (${pct}%)`,
      arrow: '↓',
      color: 'text-red-600',
    };
  }
  return {
    text: 'No change',
    arrow: '→',
    color: 'text-gray-500',
  };
}

// ── Types ──────────────────────────────────────────────────────

interface WeekData {
  weekStart: Date;
  weekEnd: Date;
  label: string;
  hasData: boolean;
  vpPipeline: number;
  vpDealBacked: number;
  vpCommit: number;
  vpMostLikely: number;
  vpBestCase: number;
  aisPipeline: number;
  aisDealBacked: number;
  aisCommit: number;
  aisMostLikely: number;
  aisBestCase: number;
  weightedPipe: number; // CW + stage-based win rates
  closedWon: number; // Cumulative from quarter start to end of this week
  closedWonThisWeek: number; // Deals closed during just this specific week
  closedWonCount: number;
  closedWonThisWeekCount: number;
  bigDealsCount: number;
}

// ── Main Component ─────────────────────────────────────────────

export default function WeeklyTrends() {
  const [opps, setOpps] = useState<ForecastOpp[]>([]);
  const [closedWon, setClosedWon] = useState<ClosedWonOpp[]>([]);
  const [changes, setChanges] = useState<ForecastChange[]>([]);
  const [snapshots, setSnapshots] = useState<Array<{ date: string; importedAt: string; data: ForecastOpp[] }>>([]);
  const [excludedDealIds, setExcludedDealIds] = useState<Set<string>>(new Set());
  const [dealBackedReasons, setDealBackedReasons] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);

  // Weekly notes state (region-specific)
  const [weeklyNotesNA, setWeeklyNotesNA] = useState<string>('');
  const [weeklyNotesLATAM, setWeeklyNotesLATAM] = useState<string>('');

  // Track the last snapshot we loaded reasons for to avoid infinite loops
  const lastLoadedSnapshotRef = React.useRef<string | null>(null);

  // Week selection state
  const currentQuarter = toCloseQuarter(new Date().toISOString().split('T')[0]);
  const weeks = React.useMemo(() => getQuarterWeeks(currentQuarter), [currentQuarter]);
  const currentWeekIndex = weeks.findIndex((w) => {
    const now = new Date();
    return now >= w.start && now <= w.end;
  });
  // Use lazy initializer to find current week at component mount
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(() => {
    const now = new Date();
    const weeksArr = getQuarterWeeks(currentQuarter);
    const idx = weeksArr.findIndex((w) => now >= w.start && now <= w.end);
    return idx >= 0 ? idx : 0;
  });

  // Region filter state
  const [selectedRegion, setSelectedRegion] = useState<'All' | 'NA' | 'LATAM'>('NA');

  // Manager filter state (multi-select)
  const [selectedManagers, setSelectedManagers] = useState<Set<string>>(new Set());
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);

  // Chart toggle state
  const [visibleLines, setVisibleLines] = useState({
    vpPipeline: false,
    vpDealBacked: true,
    vpCommit: false,
    vpML: false,
    vpBestCase: false,
    aisDealBacked: false,
    aisCommit: false,
    aisML: false,
    aisBestCase: false,
    weightedPipe: false,
    closedWon: true,
  });

  // Print mode state
  const [preparingPrint, setPreparingPrint] = useState(false);

  const load = useCallback(async () => {
    const [o, cw, ch, snaps, excludedIds] = await Promise.all([
      window.api.getForecastOpps(),
      window.api.getClosedWonOpps(),
      window.api.getAnalyticsData().then((d) => d?.changes || []),
      window.api.getPipelineSnapshots?.() || Promise.resolve([]),
      window.api.getExcludedDealIds(),
    ]);
    setOpps(o);
    setClosedWon(cw);
    setChanges(ch);
    setSnapshots(snaps);
    setExcludedDealIds(new Set(excludedIds));
    setLoading(false);
  }, []);

  // PDF export handler
  const handleExportPdf = useCallback(async () => {
    const weekLabel = weeks[selectedWeekIndex]?.label.replace(/\s+/g, '-') || 'week';
    const defaultFilename = `what-changed-${currentQuarter}-${weekLabel}-${selectedRegion}.pdf`;

    // Enable print mode to expand all sections
    setPreparingPrint(true);
    document.body.classList.add('preparing-print');

    // Find and manipulate container elements to remove scroll constraints
    const mainContainer = document.querySelector('main');
    const pageContainer = document.querySelector('.flex-1.overflow-auto');
    const sidebar = document.querySelector('nav');

    // Store original styles
    const originalStyles = {
      mainHeight: mainContainer?.style.height,
      mainOverflow: mainContainer?.style.overflow,
      pageHeight: (pageContainer as HTMLElement)?.style.height,
      pageOverflow: (pageContainer as HTMLElement)?.style.overflow,
      pageMaxHeight: (pageContainer as HTMLElement)?.style.maxHeight,
      sidebarDisplay: (sidebar as HTMLElement)?.style.display,
    };

    // Apply print-friendly styles
    if (mainContainer) {
      (mainContainer as HTMLElement).style.height = 'auto';
      (mainContainer as HTMLElement).style.overflow = 'visible';
    }
    if (pageContainer) {
      (pageContainer as HTMLElement).style.height = 'auto';
      (pageContainer as HTMLElement).style.overflow = 'visible';
      (pageContainer as HTMLElement).style.maxHeight = 'none';
    }
    if (sidebar) {
      (sidebar as HTMLElement).style.display = 'none';
    }

    // Wait for DOM to update and layout to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Calculate full content height
    const fullHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      (pageContainer as HTMLElement)?.scrollHeight || 0
    );

    console.log('[PDF Export] Full content height:', fullHeight);

    const result = await window.api.exportPdf(defaultFilename, fullHeight);

    // Restore original styles
    if (mainContainer) {
      (mainContainer as HTMLElement).style.height = originalStyles.mainHeight || '';
      (mainContainer as HTMLElement).style.overflow = originalStyles.mainOverflow || '';
    }
    if (pageContainer) {
      (pageContainer as HTMLElement).style.height = originalStyles.pageHeight || '';
      (pageContainer as HTMLElement).style.overflow = originalStyles.pageOverflow || '';
      (pageContainer as HTMLElement).style.maxHeight = originalStyles.pageMaxHeight || '';
    }
    if (sidebar) {
      (sidebar as HTMLElement).style.display = originalStyles.sidebarDisplay || '';
    }

    // Disable print mode
    setPreparingPrint(false);
    document.body.classList.remove('preparing-print');

    if (!result.success && !result.canceled) {
      alert(`Failed to export PDF: ${result.error || 'Unknown error'}`);
    }
  }, [selectedWeekIndex, currentQuarter, selectedRegion, weeks]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset the ref when snapshots change (e.g., when navigating back to the page)
  useEffect(() => {
    lastLoadedSnapshotRef.current = null;
  }, [snapshots.length]);

  // Load deal backed reasons for the selected week's previous snapshot
  useEffect(() => {
    const loadReasons = async () => {
      if (snapshots.length === 0 || weeks.length === 0) return;
      if (selectedWeekIndex <= 0) {
        if (lastLoadedSnapshotRef.current !== null) {
          lastLoadedSnapshotRef.current = null;
          setDealBackedReasons(new Map());
        }
        return;
      }

      const previousWeek = weeks[selectedWeekIndex - 1];
      if (!previousWeek || !previousWeek.start) {
        if (lastLoadedSnapshotRef.current !== null) {
          lastLoadedSnapshotRef.current = null;
          setDealBackedReasons(new Map());
        }
        return;
      }

      const previousWeekStartStr = previousWeek.start.toISOString().split('T')[0];
      const prevSnapshot = snapshots.filter((s) => s.date <= previousWeekStartStr).sort((a, b) => b.date.localeCompare(a.date))[0];

      if (prevSnapshot && prevSnapshot.importedAt) {
        // Only reload if we're looking at a different snapshot
        if (lastLoadedSnapshotRef.current !== prevSnapshot.importedAt) {
          try {
            const reasons = await window.api.getDealBackedReasons(prevSnapshot.importedAt);
            // Convert object to Map
            const reasonsMap = new Map(Object.entries(reasons || {}));
            lastLoadedSnapshotRef.current = prevSnapshot.importedAt;
            setDealBackedReasons(reasonsMap);
          } catch (err) {
            console.error('Error loading deal backed reasons:', err);
            lastLoadedSnapshotRef.current = null;
            setDealBackedReasons(new Map());
          }
        }
      } else {
        if (lastLoadedSnapshotRef.current !== null) {
          lastLoadedSnapshotRef.current = null;
          setDealBackedReasons(new Map());
        }
      }
    };

    loadReasons();
  }, [snapshots, selectedWeekIndex, weeks]);

  // Load weekly notes when week changes
  useEffect(() => {
    const loadNotes = async () => {
      if (weeks.length === 0 || selectedWeekIndex < 0) return;

      const currentWeek = weeks[selectedWeekIndex];
      if (!currentWeek || !currentWeek.start) return;

      const weekStartStr = currentWeek.start.toISOString().split('T')[0];

      try {
        const notesNA = await window.api.getWeeklyNotes(weekStartStr, 'NA');
        const notesLATAM = await window.api.getWeeklyNotes(weekStartStr, 'LATAM');
        setWeeklyNotesNA(notesNA || '');
        setWeeklyNotesLATAM(notesLATAM || '');
      } catch (err) {
        console.error('Error loading weekly notes:', err);
      }
    };

    loadNotes();
  }, [selectedWeekIndex, weeks]);

  // Close manager dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showManagerDropdown && !target.closest('.relative')) {
        setShowManagerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showManagerDropdown]);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  // ── Filter data by quarter, region, and manager ─────────────────────────

  // Filter opportunities to only those closing in current quarter
  const quarterFilteredOpps = opps.filter((o) => toCloseQuarter(o.close_date) === currentQuarter);

  // Then apply region filter
  const regionFilteredOpps = selectedRegion === 'All' ? quarterFilteredOpps : quarterFilteredOpps.filter((o) => o.region === selectedRegion);
  const regionFilteredClosedWon = selectedRegion === 'All' ? closedWon : closedWon.filter((o) => o.region === selectedRegion);

  // Then apply manager filter (if any managers selected)
  const filteredOpps = selectedManagers.size > 0
    ? regionFilteredOpps.filter((o) => selectedManagers.has(o.manager_name))
    : regionFilteredOpps;
  const filteredClosedWon = selectedManagers.size > 0
    ? regionFilteredClosedWon.filter((o) => selectedManagers.has(o.manager_name))
    : regionFilteredClosedWon;

  // Get unique manager names for filter dropdown (from region-filtered data)
  const uniqueManagers = Array.from(
    new Set(regionFilteredOpps.map((o) => o.manager_name).filter(Boolean))
  ).sort();

  // ── Aggregate data by week ─────────────────────────────────────

  // Calculate actual quarter start date (not first week start, which may be after quarter start)
  const getQuarterStartDate = (quarter: string): Date => {
    const match = quarter.match(/(\d{4})Q(\d)/);
    if (!match) return new Date();
    const fiscalYear = parseInt(match[1]);
    const q = parseInt(match[2]);
    const calendarYear = q === 4 ? fiscalYear : fiscalYear - 1;

    if (q === 1) return new Date(calendarYear, 1, 1); // Feb 1
    if (q === 2) return new Date(calendarYear, 4, 1); // May 1
    if (q === 3) return new Date(calendarYear, 7, 1); // Aug 1
    return new Date(calendarYear, 10, 1); // Nov 1
  };

  const quarterStart = getQuarterStartDate(currentQuarter);
  const quarterStartStr = quarterStart.toISOString().split('T')[0];

  const weeklyData: WeekData[] = weeks.map((week) => {
    const now = new Date();
    const weekStartStr = week.start.toISOString().split('T')[0];
    const weekEndStr = week.end.toISOString().split('T')[0];

    // For current or future weeks, use live data; for past weeks, use snapshots
    const isCurrentOrFuture = now <= week.end;

    let hasData: boolean;
    let weekOpps: ForecastOpp[];

    if (isCurrentOrFuture) {
      // Use live data for current/future weeks (filtered by region)
      hasData = true;
      weekOpps = filteredOpps;
    } else {
      // Use snapshot for historical weeks (filtered by quarter and region)
      // Use week START date for Monday-to-Monday comparison
      const weekSnapshot = snapshots
        .filter((s) => s.date <= weekStartStr)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      hasData = !!weekSnapshot;
      const snapshotData = weekSnapshot?.data || [];
      // Filter by quarter first, then by region, then by manager
      const quarterFiltered = snapshotData.filter((o) => toCloseQuarter(o.close_date) === currentQuarter);
      const regionFiltered = selectedRegion === 'All' ? quarterFiltered : quarterFiltered.filter((o) => o.region === selectedRegion);
      weekOpps = selectedManagers.size > 0 ? regionFiltered.filter((o) => selectedManagers.has(o.manager_name)) : regionFiltered;
    }

    // Calculate VP metrics (use ais_arr if manually edited, otherwise product_arr_usd)
    const vpCommit = weekOpps
      .filter((o) => o.vp_deal_forecast === 'Commit')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const vpML = weekOpps
      .filter((o) => o.vp_deal_forecast === 'Most Likely')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const vpBestCase = weekOpps
      .filter((o) => o.vp_deal_forecast === 'Best Case')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);

    // Calculate AIS metrics
    const aisCommit = weekOpps
      .filter((o) => o.ais_forecast === 'Commit')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const aisML = weekOpps
      .filter((o) => o.ais_forecast === 'Most Likely')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);
    const aisBestCase = weekOpps
      .filter((o) => o.ais_forecast === 'Best Case')
      .reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0);

    // Cumulative closed won from quarter start to the day BEFORE this week starts
    // This allows week-over-week delta to show what closed DURING the previous week
    const qStartStr = quarterStartStr;

    // Use local date, not UTC
    const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nowStr = nowLocal.toISOString().split('T')[0];

    // For current/future weeks, use YESTERDAY (to exclude today's partial data); for past weeks, use day BEFORE week starts
    let filterEndDate: string;
    if (isCurrentOrFuture) {
      // Use yesterday to exclude today's data
      const yesterday = new Date(nowLocal);
      yesterday.setDate(yesterday.getDate() - 1);
      filterEndDate = yesterday.toISOString().split('T')[0];
    } else {
      // Calculate the day before weekStart (Sunday of previous week)
      const dayBeforeWeek = new Date(week.start);
      dayBeforeWeek.setDate(dayBeforeWeek.getDate() - 1);
      filterEndDate = dayBeforeWeek.toISOString().split('T')[0];
    }

    const cwUpToWeek = filteredClosedWon.filter(
      (o) => o.close_date >= qStartStr && o.close_date <= filterEndDate
    );

    const closedWonTotal = cwUpToWeek.reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0);
    const weekFilterEndDate = isCurrentOrFuture ? nowStr : weekEndStr; // For current week, only count up to today
    const cwThisWeek = filteredClosedWon.filter(
      (o) => o.close_date >= weekStartStr && o.close_date <= weekFilterEndDate
    );
    const closedWonThisWeekTotal = cwThisWeek.reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0);

    // Big deals (>$100K) - use ais_arr if available
    const bigDealsCount = new Set(
      weekOpps
        .filter((o) => {
          const oppTotal = weekOpps
            .filter((op) => op.crm_opportunity_id === o.crm_opportunity_id)
            .reduce((s, op) => s + (op.ais_arr ?? op.product_arr_usd), 0);
          return oppTotal >= 100_000;
        })
        .map((o) => o.crm_opportunity_id)
    ).size;

    return {
      weekStart: week.start,
      weekEnd: week.end,
      label: week.label,
      hasData,
      vpPipeline: weekOpps.reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0),
      vpDealBacked: closedWonTotal + vpCommit + vpML,
      vpCommit,
      vpMostLikely: vpML,
      vpBestCase,
      aisPipeline: weekOpps.reduce((sum, o) => sum + (o.ais_arr ?? o.product_arr_usd), 0),
      aisDealBacked: closedWonTotal + aisCommit + aisML,
      aisCommit,
      aisMostLikely: aisML,
      aisBestCase,
      weightedPipe: closedWonTotal + weekOpps.reduce((sum, o) => sum + calculateWeightedPipe(o.ais_arr ?? o.product_arr_usd, o.stage_name), 0),
      closedWon: closedWonTotal,
      closedWonThisWeek: closedWonThisWeekTotal,
      closedWonCount: new Set(cwUpToWeek.map((o) => o.crm_opportunity_id)).size,
      closedWonThisWeekCount: new Set(cwThisWeek.map((o) => o.crm_opportunity_id)).size,
      bigDealsCount,
    };
  });

  const selectedWeek = weeklyData[selectedWeekIndex];
  const previousWeek = selectedWeekIndex > 0 ? weeklyData[selectedWeekIndex - 1] : null;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto p-8">
      <style>{printStyles}</style>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">What Changed?</h2>
          <p className="text-sm text-gray-400 mt-0.5">Week-over-week pipeline trends for {currentQuarter}</p>
        </div>

        {/* Region Filter & Export */}
        <div className="flex gap-3">
          <div className="flex gap-2">
            {(['All', 'NA', 'LATAM'] as const).map((region) => (
              <button
                key={region}
                onClick={() => setSelectedRegion(region)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  selectedRegion === region
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {region}
              </button>
            ))}
          </div>

          {/* Manager Filter (Multi-select) */}
          <div className="relative">
            <button
              onClick={() => setShowManagerDropdown(!showManagerDropdown)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all border ${
                selectedManagers.size > 0
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              👤 Managers {selectedManagers.size > 0 && `(${selectedManagers.size})`}
            </button>
            {showManagerDropdown && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                <div className="p-2 border-b border-gray-200 flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-600">Select Managers</span>
                  {selectedManagers.size > 0 && (
                    <button
                      onClick={() => setSelectedManagers(new Set())}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                {uniqueManagers.map((manager) => (
                  <label
                    key={manager}
                    className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedManagers.has(manager)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedManagers);
                        if (e.target.checked) {
                          newSelected.add(manager);
                        } else {
                          newSelected.delete(manager);
                        }
                        setSelectedManagers(newSelected);
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">{manager}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleExportPdf}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
            title="Download PDF"
          >
            📄 Download PDF
          </button>
        </div>
      </div>

      {/* Week Selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedWeekIndex(Math.max(0, selectedWeekIndex - 1))}
            disabled={selectedWeekIndex === 0}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">
              {selectedWeek && `As of ${selectedWeek.weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
            </p>
            <p className="text-xs text-gray-500">
              {selectedWeek && (() => {
                if (!previousWeek) {
                  return 'First week of quarter';
                }

                // Calculate the date range for last week's changes
                const now = new Date();
                const isCurrentWeek = now <= selectedWeek.weekEnd;

                // Start date: day after previous cutoff (day before previous week starts)
                const prevCutoff = new Date(previousWeek.weekStart);
                prevCutoff.setDate(prevCutoff.getDate() - 1);
                const startDate = new Date(prevCutoff);
                startDate.setDate(startDate.getDate() + 1); // Day after cutoff

                // End date: current cutoff (yesterday for current week, day before for historical)
                const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                let endDate: Date;
                if (isCurrentWeek) {
                  endDate = new Date(nowLocal);
                  endDate.setDate(endDate.getDate() - 1); // Yesterday
                } else {
                  endDate = new Date(selectedWeek.weekStart);
                  endDate.setDate(endDate.getDate() - 1); // Day before week starts
                }

                // Format date range (e.g., "March 23-29" or "March 30 - April 5" if different months)
                const startMonth = startDate.toLocaleDateString('en-US', { month: 'long' });
                const startDay = startDate.getDate();
                const endMonth = endDate.toLocaleDateString('en-US', { month: 'long' });
                const endDay = endDate.getDate();

                const dateRange = startMonth === endMonth
                  ? `${startMonth} ${startDay}-${endDay}`
                  : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;

                return `Last Week's Changes (${dateRange})`;
              })()}
            </p>
          </div>
          <button
            onClick={() => setSelectedWeekIndex(Math.min(weeks.length - 1, selectedWeekIndex + 1))}
            disabled={selectedWeekIndex === weeks.length - 1}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>

      {/* VP vs AIS Comparison Cards */}
      {selectedWeek && (
        <>
          {/* VP Row */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-4 mb-3">
            <p className="text-xs font-bold text-blue-900 uppercase tracking-wide mb-3">VP Forecast</p>
            <div className="grid grid-cols-5 gap-4">
              <MetricCard
                label="Pipeline"
                value={fmtDollar(selectedWeek.vpPipeline)}
                delta={previousWeek && fmtDelta(selectedWeek.vpPipeline, previousWeek.vpPipeline)}
                subtitle={`${weeks.length} weeks`}
              />
              <MetricCard
                label="Deal Backed"
                value={fmtDollar(selectedWeek.vpDealBacked)}
                delta={previousWeek && fmtDelta(selectedWeek.vpDealBacked, previousWeek.vpDealBacked)}
                subtitle="CW + Commit + ML"
              />
              <MetricCard
                label="Weighted Pipe"
                value={fmtDollar(selectedWeek.weightedPipe)}
                delta={previousWeek && fmtDelta(selectedWeek.weightedPipe, previousWeek.weightedPipe)}
                subtitle="CW + Stage Win Rates"
              />
              <MetricCard
                label="Closed Won"
                value={fmtDollar(selectedWeek.closedWon)}
                delta={
                  selectedWeek.closedWonThisWeek > 0
                    ? {
                        text: `+${fmtDollar(selectedWeek.closedWonThisWeek)} (${selectedWeek.closedWonThisWeekCount} deal${selectedWeek.closedWonThisWeekCount !== 1 ? 's' : ''} this week)`,
                        arrow: '↑',
                        color: 'text-emerald-600',
                      }
                    : false
                }
                subtitle={`${selectedWeek.closedWonCount} deals total`}
              />
              <MetricCard
                label="Big Deals"
                value={String(selectedWeek.bigDealsCount)}
                delta={
                  previousWeek && {
                    text: `${selectedWeek.bigDealsCount - previousWeek.bigDealsCount >= 0 ? '+' : ''}${selectedWeek.bigDealsCount - previousWeek.bigDealsCount}`,
                    arrow: selectedWeek.bigDealsCount > previousWeek.bigDealsCount ? '↑' : selectedWeek.bigDealsCount < previousWeek.bigDealsCount ? '↓' : '→',
                    color: selectedWeek.bigDealsCount > previousWeek.bigDealsCount ? 'text-emerald-600' : selectedWeek.bigDealsCount < previousWeek.bigDealsCount ? 'text-red-600' : 'text-gray-500',
                  }
                }
                subtitle=">$100K opps"
              />
            </div>
          </div>

          {/* AIS Row */}
          <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl border border-purple-200 p-4 mb-6">
            <p className="text-xs font-bold text-purple-900 uppercase tracking-wide mb-3">AIS Forecast</p>
            <div className="grid grid-cols-5 gap-4">
              <MetricCard
                label="Pipeline"
                value={fmtDollar(selectedWeek.aisPipeline)}
                delta={previousWeek && fmtDelta(selectedWeek.aisPipeline, previousWeek.aisPipeline)}
                subtitle={`${weeks.length} weeks`}
              />
              <MetricCard
                label="Deal Backed"
                value={fmtDollar(selectedWeek.aisDealBacked)}
                delta={previousWeek && fmtDelta(selectedWeek.aisDealBacked, previousWeek.aisDealBacked)}
                subtitle="CW + Commit + ML"
              />
              <MetricCard
                label="Weighted Pipe"
                value={fmtDollar(selectedWeek.weightedPipe)}
                delta={previousWeek && fmtDelta(selectedWeek.weightedPipe, previousWeek.weightedPipe)}
                subtitle="CW + Stage Win Rates"
              />
              <MetricCard
                label="Closed Won"
                value={fmtDollar(selectedWeek.closedWon)}
                delta={
                  selectedWeek.closedWonThisWeek > 0
                    ? {
                        text: `+${fmtDollar(selectedWeek.closedWonThisWeek)} (${selectedWeek.closedWonThisWeekCount} deal${selectedWeek.closedWonThisWeekCount !== 1 ? 's' : ''} this week)`,
                        arrow: '↑',
                        color: 'text-emerald-600',
                      }
                    : false
                }
                subtitle={`${selectedWeek.closedWonCount} deals total`}
              />
              <MetricCard
                label="Big Deals"
                value={String(selectedWeek.bigDealsCount)}
                delta={
                  previousWeek && {
                    text: `${selectedWeek.bigDealsCount - previousWeek.bigDealsCount >= 0 ? '+' : ''}${selectedWeek.bigDealsCount - previousWeek.bigDealsCount}`,
                    arrow: selectedWeek.bigDealsCount > previousWeek.bigDealsCount ? '↑' : selectedWeek.bigDealsCount < previousWeek.bigDealsCount ? '↓' : '→',
                    color: selectedWeek.bigDealsCount > previousWeek.bigDealsCount ? 'text-emerald-600' : selectedWeek.bigDealsCount < previousWeek.bigDealsCount ? 'text-red-600' : 'text-gray-500',
                  }
                }
                subtitle=">$100K opps"
              />
            </div>
          </div>
        </>
      )}

      {/* Quarterly Trend Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Quarterly Trends</h3>
            <p className="text-xs text-gray-500 mt-1">{currentQuarter} week-by-week performance</p>
          </div>
          {/* Line toggles */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'vpPipeline', label: 'Pipeline', color: 'bg-blue-500' },
              { key: 'vpDealBacked', label: 'VP Deal Backed', color: 'bg-blue-700' },
              { key: 'vpCommit', label: 'VP Commit', color: 'bg-blue-600' },
              { key: 'vpML', label: 'VP Most Likely', color: 'bg-blue-400' },
              { key: 'vpBestCase', label: 'VP Best Case', color: 'bg-blue-300' },
              { key: 'aisDealBacked', label: 'AIS Deal Backed', color: 'bg-purple-700' },
              { key: 'aisCommit', label: 'AIS Commit', color: 'bg-purple-600' },
              { key: 'aisML', label: 'AIS Most Likely', color: 'bg-purple-400' },
              { key: 'aisBestCase', label: 'AIS Best Case', color: 'bg-purple-300' },
              { key: 'weightedPipe', label: 'Weighted Pipe', color: 'bg-orange-600' },
              { key: 'closedWon', label: 'Closed Won', color: 'bg-green-600' },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setVisibleLines({ ...visibleLines, [key]: !visibleLines[key as keyof typeof visibleLines] })}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border transition-all ${
                  visibleLines[key as keyof typeof visibleLines]
                    ? 'border-gray-300 bg-white'
                    : 'border-gray-200 bg-gray-50 opacity-40'
                }`}
              >
                <span className={`w-3 h-3 rounded-sm ${color}`}></span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <TrendChart weeklyData={weeklyData} visibleLines={visibleLines} selectedIndex={selectedWeekIndex} />
      </div>

      {/* Movement Breakdown Sections */}
      {selectedWeek && previousWeek && selectedWeekIndex > 0 && (() => {
        const now = new Date();
        const selectedWeekStartStr = selectedWeek.weekStart.toISOString().split('T')[0];
        const selectedWeekEndStr = selectedWeek.weekEnd.toISOString().split('T')[0];
        const previousWeekStartStr = previousWeek.weekStart.toISOString().split('T')[0];
        const previousWeekEndStr = previousWeek.weekEnd.toISOString().split('T')[0];

        // Get current week opps (use today's live data if current week, otherwise use snapshot from START of selected week)
        const currentIsCurrentOrFuture = now <= selectedWeek.weekEnd;
        let currentWeekOpps: ForecastOpp[];
        if (currentIsCurrentOrFuture) {
          currentWeekOpps = filteredOpps;
        } else {
          const snapshot = snapshots.filter((s) => s.date <= selectedWeekStartStr).sort((a, b) => b.date.localeCompare(a.date))[0];
          const snapshotData = snapshot?.data || [];
          const quarterFiltered = snapshotData.filter((o) => toCloseQuarter(o.close_date) === currentQuarter);
          // Apply region filter
          const regionFiltered = selectedRegion === 'All' ? quarterFiltered : quarterFiltered.filter((o) => o.region === selectedRegion);
          // Apply manager filter if any selected
          currentWeekOpps = selectedManagers.size > 0 ? regionFiltered.filter((o) => selectedManagers.has(o.manager_name)) : regionFiltered;
        }

        // Get previous week opps (use snapshot from START of previous week for Monday-to-Monday comparison)
        const snapshot = snapshots.filter((s) => s.date <= previousWeekStartStr).sort((a, b) => b.date.localeCompare(a.date))[0];
        const snapshotData = snapshot?.data || [];
        const quarterFiltered = snapshotData.filter((o) => toCloseQuarter(o.close_date) === currentQuarter);
        // Apply region filter
        const regionFiltered = selectedRegion === 'All' ? quarterFiltered : quarterFiltered.filter((o) => o.region === selectedRegion);
        // Apply manager filter if any selected
        const previousWeekOpps: ForecastOpp[] = selectedManagers.size > 0 ? regionFiltered.filter((o) => selectedManagers.has(o.manager_name)) : regionFiltered;

        // Get closed won this week
        const closedWonThisWeekFiltered = filteredClosedWon.filter((o) => {
          const weekStart = selectedWeek.weekStart.toISOString().split('T')[0];
          const isCurrentOrFuture = now <= selectedWeek.weekEnd;
          const nowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
          const weekEnd = selectedWeek.weekEnd.toISOString().split('T')[0];
          const filterEndDate = isCurrentOrFuture ? nowStr : weekEnd;
          return o.close_date >= weekStart && o.close_date <= filterEndDate;
        });

        // Get closed won that contributes to the delta (between the two cutoff dates)
        // This represents deals closed LAST WEEK (the week that just ended)
        const closedWonLastWeekFiltered = filteredClosedWon.filter((o) => {
          // Calculate previous week cutoff date (day before previous week starts)
          const prevWeekCutoff = new Date(previousWeek.weekStart);
          prevWeekCutoff.setDate(prevWeekCutoff.getDate() - 1);
          const prevCutoffStr = prevWeekCutoff.toISOString().split('T')[0];

          // Calculate current week cutoff date (yesterday for current week, day before for historical)
          const isCurrentWeek = now <= selectedWeek.weekEnd;
          const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          let currCutoffStr: string;
          if (isCurrentWeek) {
            const yesterday = new Date(nowLocal);
            yesterday.setDate(yesterday.getDate() - 1);
            currCutoffStr = yesterday.toISOString().split('T')[0];
          } else {
            const currWeekCutoff = new Date(selectedWeek.weekStart);
            currWeekCutoff.setDate(currWeekCutoff.getDate() - 1);
            currCutoffStr = currWeekCutoff.toISOString().split('T')[0];
          }

          // Get deals closed AFTER previous cutoff and through current cutoff
          return o.close_date > prevCutoffStr && o.close_date <= currCutoffStr;
        });

        return (
          <MovementBreakdown
            currentWeek={selectedWeek}
            previousWeek={previousWeek}
            currentWeekOpps={currentWeekOpps}
            previousWeekOpps={previousWeekOpps}
            closedWonThisWeek={closedWonThisWeekFiltered}
            closedWonLastWeek={closedWonLastWeekFiltered}
            allOpps={selectedRegion === 'All' ? opps : opps.filter((o) => o.region === selectedRegion)}
            allClosedWon={filteredClosedWon}
            preparingPrint={preparingPrint}
            snapshots={snapshots}
            previousWeekStartStr={previousWeekStartStr}
            selectedRegion={selectedRegion}
            opps={opps}
            load={load}
            excludedDealIds={excludedDealIds}
            quarterStartStr={quarterStartStr}
            dealBackedReasons={dealBackedReasons}
            setDealBackedReasons={setDealBackedReasons}
            weeks={weeks}
            selectedWeekIndex={selectedWeekIndex}
            weeklyNotesNA={weeklyNotesNA}
            weeklyNotesLATAM={weeklyNotesLATAM}
            setWeeklyNotesNA={setWeeklyNotesNA}
            setWeeklyNotesLATAM={setWeeklyNotesLATAM}
          />
        );
      })()}
    </div>
  );
}

// ── Metric Card Component ──────────────────────────────────────

function MetricCard({
  label,
  value,
  delta,
  subtitle,
}: {
  label: string;
  value: string;
  delta?: { text: string; arrow: string; color: string } | false;
  subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mb-1">{value}</p>
      {delta && (
        <p className={`text-xs font-medium ${delta.color}`}>
          {delta.arrow} {delta.text}
        </p>
      )}
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

// ── Trend Chart Component ──────────────────────────────────────

function TrendChart({
  weeklyData,
  visibleLines,
  selectedIndex,
}: {
  weeklyData: WeekData[];
  visibleLines: Record<string, boolean>;
  selectedIndex: number;
}) {
  const [hoveredPoint, setHoveredPoint] = React.useState<{ x: number; y: number; label: string; value: string } | null>(null);

  const width = 800;
  const height = 400; // Increased from 300 for better vertical separation
  const padding = { top: 20, right: 80, bottom: 40, left: 80 };

  if (weeklyData.length === 0) {
    return <div className="text-gray-400 text-sm">No data available</div>;
  }

  // Determine current week index (weeks beyond this are future/forecast)
  const now = new Date();
  const currentWeekIdx = weeklyData.findIndex((w) => now >= w.weekStart && now <= w.weekEnd);
  const futureStartIdx = currentWeekIdx >= 0 ? currentWeekIdx + 1 : weeklyData.length;

  // Calculate dual scales - Pipeline on left axis, forecasts on right axis
  // Add 15% padding to max values to prevent lines from hitting the very top
  const maxPipeline = Math.max(
    1,
    ...weeklyData.filter((d) => d.hasData).map((d) => (visibleLines.vpPipeline ? d.vpPipeline : 0))
  ) * 1.15;

  const maxForecast = Math.max(
    1,
    ...weeklyData.filter((d) => d.hasData).flatMap((d) => [
      visibleLines.vpDealBacked ? d.vpDealBacked : 0,
      visibleLines.vpCommit ? d.vpCommit : 0,
      visibleLines.vpML ? d.vpMostLikely : 0,
      visibleLines.vpBestCase ? d.vpBestCase : 0,
      visibleLines.aisDealBacked ? d.aisDealBacked : 0,
      visibleLines.aisCommit ? d.aisCommit : 0,
      visibleLines.aisML ? d.aisMostLikely : 0,
      visibleLines.aisBestCase ? d.aisBestCase : 0,
      visibleLines.weightedPipe ? d.weightedPipe : 0,
      visibleLines.closedWon ? d.closedWon : 0,
    ])
  ) * 1.15;

  const xScale = (index: number) => padding.left + (index / (weeklyData.length - 1)) * (width - padding.left - padding.right);
  const yScaleLeft = (value: number) => height - padding.bottom - (value / maxPipeline) * (height - padding.top - padding.bottom);
  const yScaleRight = (value: number) => height - padding.bottom - (value / maxForecast) * (height - padding.top - padding.bottom);

  // Generate line paths
  const lines: Array<{ path: string; color: string; label: string; dotted: boolean }> = [];

  // Helper to create paths - returns solid path and dotted path separately
  const createPaths = (getValue: (d: WeekData) => number, useLeftAxis: boolean): { solid: string; dotted: string } => {
    const yScale = useLeftAxis ? yScaleLeft : yScaleRight;
    let solidPath = '';
    let dottedPath = '';
    let solidSegment = true;
    let dottedSegment = true;

    weeklyData.forEach((d, i) => {
      if (!d.hasData) {
        solidSegment = true;
        dottedSegment = true;
        return;
      }

      if (i < futureStartIdx) {
        // Historical/current data - solid line
        const cmd = solidSegment ? 'M' : 'L';
        solidPath += `${cmd} ${xScale(i)} ${yScale(getValue(d))} `;
        solidSegment = false;
      } else {
        // Future forecast - dotted line
        const cmd = dottedSegment ? 'M' : 'L';
        dottedPath += `${cmd} ${xScale(i)} ${yScale(getValue(d))} `;
        dottedSegment = false;
      }
    });

    return { solid: solidPath.trim(), dotted: dottedPath.trim() };
  };

  if (visibleLines.vpPipeline) {
    const { solid, dotted } = createPaths((d) => d.vpPipeline, true);
    lines.push({ path: solid, color: '#3b82f6', label: 'Pipeline', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#3b82f6', label: 'Pipeline', dotted: true });
  }

  if (visibleLines.vpDealBacked) {
    const { solid, dotted } = createPaths((d) => d.vpDealBacked, false);
    lines.push({ path: solid, color: '#1d4ed8', label: 'VP Deal Backed', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#1d4ed8', label: 'VP Deal Backed', dotted: true });
  }

  if (visibleLines.vpCommit) {
    const { solid, dotted } = createPaths((d) => d.vpCommit, false);
    lines.push({ path: solid, color: '#2563eb', label: 'VP Commit', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#2563eb', label: 'VP Commit', dotted: true });
  }

  if (visibleLines.vpML) {
    const { solid, dotted } = createPaths((d) => d.vpMostLikely, false);
    lines.push({ path: solid, color: '#60a5fa', label: 'VP Most Likely', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#60a5fa', label: 'VP Most Likely', dotted: true });
  }

  if (visibleLines.vpBestCase) {
    const { solid, dotted } = createPaths((d) => d.vpBestCase, false);
    lines.push({ path: solid, color: '#93c5fd', label: 'VP Best Case', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#93c5fd', label: 'VP Best Case', dotted: true });
  }

  if (visibleLines.aisDealBacked) {
    const { solid, dotted } = createPaths((d) => d.aisDealBacked, false);
    lines.push({ path: solid, color: '#7c3aed', label: 'AIS Deal Backed', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#7c3aed', label: 'AIS Deal Backed', dotted: true });
  }

  if (visibleLines.aisCommit) {
    const { solid, dotted } = createPaths((d) => d.aisCommit, false);
    lines.push({ path: solid, color: '#6d28d9', label: 'AIS Commit', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#6d28d9', label: 'AIS Commit', dotted: true });
  }

  if (visibleLines.aisML) {
    const { solid, dotted } = createPaths((d) => d.aisMostLikely, false);
    lines.push({ path: solid, color: '#a78bfa', label: 'AIS Most Likely', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#a78bfa', label: 'AIS Most Likely', dotted: true });
  }

  if (visibleLines.aisBestCase) {
    const { solid, dotted } = createPaths((d) => d.aisBestCase, false);
    lines.push({ path: solid, color: '#c4b5fd', label: 'AIS Best Case', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#c4b5fd', label: 'AIS Best Case', dotted: true });
  }

  if (visibleLines.weightedPipe) {
    const { solid, dotted } = createPaths((d) => d.weightedPipe, false);
    lines.push({ path: solid, color: '#ea580c', label: 'Weighted Pipe', dotted: false });
    if (dotted) lines.push({ path: dotted, color: '#ea580c', label: 'Weighted Pipe', dotted: true });
  }

  // Special handling for Closed Won - always render since it's calculated from close dates, not snapshots
  if (visibleLines.closedWon) {
    const yScale = yScaleRight;
    let solidPath = '';
    let dottedPath = '';
    let solidSegment = true;
    let dottedSegment = true;

    weeklyData.forEach((d, i) => {
      // Always render Closed Won, even if hasData is false (since we have historical close dates)
      if (i < futureStartIdx) {
        // Historical/current data - solid line
        const cmd = solidSegment ? 'M' : 'L';
        solidPath += `${cmd} ${xScale(i)} ${yScale(d.closedWon)} `;
        solidSegment = false;
      } else {
        // Future forecast - dotted line (stays flat at current value)
        const cmd = dottedSegment ? 'M' : 'L';
        dottedPath += `${cmd} ${xScale(i)} ${yScale(d.closedWon)} `;
        dottedSegment = false;
      }
    });

    if (solidPath) lines.push({ path: solidPath.trim(), color: '#16a34a', label: 'Closed Won', dotted: false });
    if (dottedPath) lines.push({ path: dottedPath.trim(), color: '#16a34a', label: 'Closed Won', dotted: true });
  }

  return (
    <div className="relative">
      <svg width={width} height={height} className="mx-auto">
      {/* Y-axis labels - Left (Pipeline) */}
      {visibleLines.vpPipeline && [0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const value = maxPipeline * pct;
        const y = yScaleLeft(value);
        return (
          <g key={`left-${pct}`}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#3b82f6">
              {fmtDollar(value)}
            </text>
          </g>
        );
      })}

      {/* Y-axis labels - Right (Forecasts) */}
      {!visibleLines.vpPipeline && [0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const value = maxForecast * pct;
        const y = yScaleRight(value);
        return (
          <g key={`right-${pct}`}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={width - padding.right + 10} y={y + 4} textAnchor="start" fontSize="11" fill="#6b7280">
              {fmtDollar(value)}
            </text>
          </g>
        );
      })}

      {visibleLines.vpPipeline && [0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const value = maxForecast * pct;
        const y = yScaleRight(value);
        return (
          <text key={`right-label-${pct}`} x={width - padding.right + 10} y={y + 4} textAnchor="start" fontSize="11" fill="#6b7280">
            {fmtDollar(value)}
          </text>
        );
      })}

      {/* Lines */}
      {lines.map((line, i) => (
        <path
          key={i}
          d={line.path}
          fill="none"
          stroke={line.color}
          strokeWidth="2.5"
          strokeDasharray={line.dotted ? "6 4" : undefined}
        />
      ))}

      {/* Data points */}
      {visibleLines.vpPipeline && (
        <g>
          {weeklyData.map((d, i) => {
            if (!d.hasData) return null;
            const value = d.vpPipeline;
            const y = yScaleLeft(value);
            return (
              <circle
                key={i}
                cx={xScale(i)}
                cy={y}
                r={i === selectedIndex ? 6 : 4}
                fill={i === selectedIndex ? '#3b82f6' : 'white'}
                stroke="#3b82f6"
                strokeWidth="2"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredPoint({ x: rect.left, y: rect.top, label: 'Pipeline', value: fmtDollar(value) });
                }}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}
        </g>
      )}
      {[
        { key: 'vpDealBacked', label: 'VP Deal Backed', color: '#1d4ed8', getValue: (d: WeekData) => d.vpDealBacked },
        { key: 'vpCommit', label: 'VP Commit', color: '#2563eb', getValue: (d: WeekData) => d.vpCommit },
        { key: 'vpML', label: 'VP Most Likely', color: '#60a5fa', getValue: (d: WeekData) => d.vpMostLikely },
        { key: 'vpBestCase', label: 'VP Best Case', color: '#93c5fd', getValue: (d: WeekData) => d.vpBestCase },
        { key: 'aisDealBacked', label: 'AIS Deal Backed', color: '#7c3aed', getValue: (d: WeekData) => d.aisDealBacked },
        { key: 'aisCommit', label: 'AIS Commit', color: '#6d28d9', getValue: (d: WeekData) => d.aisCommit },
        { key: 'aisML', label: 'AIS Most Likely', color: '#a78bfa', getValue: (d: WeekData) => d.aisMostLikely },
        { key: 'aisBestCase', label: 'AIS Best Case', color: '#c4b5fd', getValue: (d: WeekData) => d.aisBestCase },
      ].map(({ key, label, color, getValue }) =>
        visibleLines[key as keyof typeof visibleLines] && (
          <g key={key}>
            {weeklyData.map((d, i) => {
              if (!d.hasData) return null;
              const value = getValue(d);
              const y = yScaleRight(value);
              return (
                <circle
                  key={i}
                  cx={xScale(i)}
                  cy={y}
                  r={i === selectedIndex ? 6 : 4}
                  fill={i === selectedIndex ? color : 'white'}
                  stroke={color}
                  strokeWidth="2"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredPoint({ x: rect.left, y: rect.top, label, value: fmtDollar(value) });
                  }}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              );
            })}
          </g>
        )
      )}

      {/* Closed Won data points - render for all weeks regardless of hasData */}
      {visibleLines.closedWon && (
        <g>
          {weeklyData.map((d, i) => {
            const value = d.closedWon;
            const y = yScaleRight(value);
            return (
              <circle
                key={i}
                cx={xScale(i)}
                cy={y}
                r={i === selectedIndex ? 6 : 4}
                fill={i === selectedIndex ? '#16a34a' : 'white'}
                stroke="#16a34a"
                strokeWidth="2"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredPoint({ x: rect.left, y: rect.top, label: 'Closed Won', value: fmtDollar(value) });
                }}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}
        </g>
      )}

      {/* X-axis labels */}
      {weeklyData.map((d, i) => (
        <text
          key={i}
          x={xScale(i)}
          y={height - padding.bottom + 20}
          textAnchor="middle"
          fontSize="10"
          fill={i === selectedIndex ? '#111827' : '#9ca3af'}
          fontWeight={i === selectedIndex ? 'bold' : 'normal'}
        >
          {d.label.replace('Week of ', '')}
        </text>
      ))}

      {/* Selected week vertical line */}
      <line
        x1={xScale(selectedIndex)}
        y1={padding.top}
        x2={xScale(selectedIndex)}
        y2={height - padding.bottom}
        stroke="#f59e0b"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      </svg>

      {hoveredPoint && (
        <div
          style={{
            position: 'fixed',
            left: hoveredPoint.x + 10,
            top: hoveredPoint.y - 30,
            pointerEvents: 'none',
          }}
          className="bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg z-50"
        >
          <div className="font-semibold">{hoveredPoint.label}</div>
          <div>{hoveredPoint.value}</div>
        </div>
      )}
    </div>
  );
}

// ── Movement Breakdown Component ───────────────────────────────

function MovementBreakdown({
  currentWeek,
  previousWeek,
  currentWeekOpps,
  previousWeekOpps,
  closedWonThisWeek,
  closedWonLastWeek,
  allOpps,
  allClosedWon,
  preparingPrint,
  snapshots,
  previousWeekStartStr,
  selectedRegion,
  opps,
  load,
  excludedDealIds,
  quarterStartStr,
  dealBackedReasons,
  setDealBackedReasons,
  weeks,
  selectedWeekIndex,
  weeklyNotesNA,
  weeklyNotesLATAM,
  setWeeklyNotesNA,
  setWeeklyNotesLATAM,
}: {
  currentWeek: WeekData;
  previousWeek: WeekData;
  currentWeekOpps: ForecastOpp[];
  previousWeekOpps: ForecastOpp[];
  closedWonThisWeek: ClosedWonOpp[];
  closedWonLastWeek: ClosedWonOpp[];
  allOpps: ForecastOpp[];
  allClosedWon: ClosedWonOpp[];
  preparingPrint: boolean;
  snapshots: Array<{ date: string; importedAt: string; data: ForecastOpp[] }>;
  previousWeekStartStr: string;
  selectedRegion: 'All' | 'NA' | 'LATAM';
  opps: ForecastOpp[];
  load: () => void;
  excludedDealIds: Set<string>;
  quarterStartStr: string;
  dealBackedReasons: Map<string, string | null>;
  setDealBackedReasons: (reasons: Map<string, string | null>) => void;
  weeks: Array<{ label: string; weekStart: Date; weekEnd: Date; start: Date; end: Date }>;
  selectedWeekIndex: number;
  weeklyNotesNA: string;
  weeklyNotesLATAM: string;
  setWeeklyNotesNA: (notes: string) => void;
  setWeeklyNotesLATAM: (notes: string) => void;
}) {
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const exportDealBackedHtml = () => {
    const prevDealBacked = previousWeek.vpDealBacked;
    const currDealBacked = currentWeek.vpDealBacked;
    const closedWonTotal = closedWonLastWeek.reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0);
    const closedWonCount = new Set(closedWonLastWeek.map(o => o.crm_opportunity_id)).size;

    // Calculate "As of EOD" dates for display
    const prevWeekEndDate = new Date(previousWeek.weekStart);
    prevWeekEndDate.setDate(prevWeekEndDate.getDate() - 1);
    const prevWeekEOD = prevWeekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const currWeekEndDate = new Date(currentWeek.weekStart);
    currWeekEndDate.setDate(currWeekEndDate.getDate() - 1);
    const currWeekEOD = currWeekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Calculate all the movement data
    const prevDealBackedOpps = previousWeekOpps.filter(o => ['Commit', 'Most Likely'].includes(o.vp_deal_forecast));
    const currDealBackedOpps = currentWeekOpps.filter(o => ['Commit', 'Most Likely'].includes(o.vp_deal_forecast));

    const now = new Date();
    const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isCurrentWeek = now <= currentWeek.weekEnd;

    // Calculate previous week end date (day before previous week starts)
    const prevWeekEndDateFilter = new Date(previousWeek.weekStart);
    prevWeekEndDateFilter.setDate(prevWeekEndDateFilter.getDate() - 1);
    const previousWeekEndStr = prevWeekEndDateFilter.toISOString().split('T')[0];
    const closedWonUpToPrevWeek = allClosedWon.filter(o =>
      o.close_date >= quarterStartStr && o.close_date <= previousWeekEndStr
    );

    // Calculate current week end date (yesterday for current week, day before for historical)
    let currentWeekEndStr: string;
    if (isCurrentWeek) {
      const yesterday = new Date(nowLocal);
      yesterday.setDate(yesterday.getDate() - 1);
      currentWeekEndStr = yesterday.toISOString().split('T')[0];
    } else {
      const currWeekEndDateFilter = new Date(currentWeek.weekStart);
      currWeekEndDateFilter.setDate(currWeekEndDateFilter.getDate() - 1);
      currentWeekEndStr = currWeekEndDateFilter.toISOString().split('T')[0];
    }
    const closedWonUpToCurrWeek = allClosedWon.filter(o =>
      o.close_date >= quarterStartStr && o.close_date <= currentWeekEndStr
    );

    // Build previous week Deal Backed map
    const prevDealBackedMap = new Map<string, {arr: number; forecast: string}>();
    prevDealBackedOpps.forEach(o => {
      const arr = o.ais_arr ?? o.product_arr_usd;
      const existing = prevDealBackedMap.get(o.crm_opportunity_id);
      prevDealBackedMap.set(o.crm_opportunity_id, {
        arr: (existing?.arr || 0) + arr,
        forecast: o.vp_deal_forecast
      });
    });
    closedWonUpToPrevWeek.forEach(cw => {
      const existing = prevDealBackedMap.get(cw.crm_opportunity_id);
      prevDealBackedMap.set(cw.crm_opportunity_id, {
        arr: (existing?.arr || 0) + (cw.edited_bookings ?? cw.bookings),
        forecast: 'Closed Won'
      });
    });

    // Build current week Deal Backed map
    const currDealBackedMap = new Map<string, {arr: number; forecast: string}>();
    currDealBackedOpps.forEach(o => {
      const arr = o.ais_arr ?? o.product_arr_usd;
      const existing = currDealBackedMap.get(o.crm_opportunity_id);
      currDealBackedMap.set(o.crm_opportunity_id, {
        arr: (existing?.arr || 0) + arr,
        forecast: o.vp_deal_forecast
      });
    });
    closedWonUpToCurrWeek.forEach(cw => {
      const existing = currDealBackedMap.get(cw.crm_opportunity_id);
      currDealBackedMap.set(cw.crm_opportunity_id, {
        arr: (existing?.arr || 0) + (cw.edited_bookings ?? cw.bookings),
        forecast: 'Closed Won'
      });
    });

    // Build opp maps
    const prevOppMap = new Map<string, ForecastOpp>();
    previousWeekOpps.forEach(o => {
      if (!prevOppMap.has(o.crm_opportunity_id)) {
        prevOppMap.set(o.crm_opportunity_id, o);
      }
    });
    closedWonUpToPrevWeek.forEach(cw => {
      if (!prevOppMap.has(cw.crm_opportunity_id)) {
        prevOppMap.set(cw.crm_opportunity_id, { ...cw, vp_deal_forecast: 'Closed Won', product_arr_usd: cw.bookings } as any);
      }
    });

    const currOppMap = new Map<string, ForecastOpp>();
    currentWeekOpps.forEach(o => {
      if (!currOppMap.has(o.crm_opportunity_id)) {
        currOppMap.set(o.crm_opportunity_id, o);
      }
    });
    closedWonUpToCurrWeek.forEach(cw => {
      if (!currOppMap.has(cw.crm_opportunity_id)) {
        currOppMap.set(cw.crm_opportunity_id, { ...cw, vp_deal_forecast: 'Closed Won', product_arr_usd: cw.bookings } as any);
      }
    });

    const enteredDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
    const leftDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
    const movedWithinDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
    const arrChangesInDealBacked: Array<{opp: ForecastOpp; prevArr: number; currArr: number; delta: number}> = [];

    // Calculate movements
    const allOppIds = new Set([...prevDealBackedMap.keys(), ...currDealBackedMap.keys()]);
    for (const oppId of allOppIds) {
      if (excludedDealIds.has(oppId)) continue;

      const wasInDB = prevDealBackedMap.has(oppId);
      const isInDB = currDealBackedMap.has(oppId);

      if (!wasInDB && isInDB) {
        const curr = currDealBackedMap.get(oppId)!;
        const opp = currOppMap.get(oppId)!;
        const prevOpp = prevOppMap.get(oppId);
        const from = prevOpp?.vp_deal_forecast || 'New';
        enteredDealBacked.push({ opp, arr: curr.arr, from, to: curr.forecast });
      } else if (wasInDB && !isInDB) {
        const prev = prevDealBackedMap.get(oppId)!;
        const prevOpp = prevOppMap.get(oppId)!;
        const currOpp = currOppMap.get(oppId);
        const to = currOpp?.vp_deal_forecast || 'Removed';
        leftDealBacked.push({ opp: prevOpp, arr: prev.arr, from: prev.forecast, to });
      } else if (wasInDB && isInDB) {
        const prev = prevDealBackedMap.get(oppId)!;
        const curr = currDealBackedMap.get(oppId)!;

        if (prev.forecast !== curr.forecast) {
          const opp = currOppMap.get(oppId)!;
          movedWithinDealBacked.push({ opp, arr: curr.arr, from: prev.forecast, to: curr.forecast });
        }

        const delta = curr.arr - prev.arr;
        if (Math.abs(delta) > 1000) {
          const opp = currOppMap.get(oppId)!;
          arrChangesInDealBacked.push({ opp, prevArr: prev.arr, currArr: curr.arr, delta });
        }
      }
    }

    enteredDealBacked.sort((a, b) => b.arr - a.arr);
    leftDealBacked.sort((a, b) => b.arr - a.arr);
    movedWithinDealBacked.sort((a, b) => b.arr - a.arr);
    arrChangesInDealBacked.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deal Backed Calculations - ${currentWeek.label} (${selectedRegion})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; background: #f9fafb; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin: 0 0 8px 0; color: #111827; }
    .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
    .section { margin-bottom: 32px; }
    .section-title { font-size: 18px; font-weight: 600; color: #111827; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .deals-list { display: flex; flex-direction: column; gap: 12px; }
    .deal-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
    .deal-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px; }
    .deal-name { font-weight: 600; color: #111827; font-size: 15px; }
    .deal-amount { font-weight: 700; color: #059669; font-size: 15px; }
    .deal-details { font-size: 13px; color: #6b7280; line-height: 1.6; }
    .forecast-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; margin-right: 8px; }
    .badge-commit { background: #d1fae5; color: #065f46; }
    .badge-ml { background: #fef3c7; color: #92400e; }
    .badge-bc { background: #dbeafe; color: #1e40af; }
    .badge-removed { background: #fee2e2; color: #991b1b; }
    .summary { background: #f0f9ff; border: 2px solid #bae6fd; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .summary-row { display: flex; justify-between; margin-bottom: 8px; font-size: 15px; }
    .summary-label { color: #0c4a6e; font-weight: 500; }
    .summary-value { color: #0c4a6e; font-weight: 700; }
    .notes-section { background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .notes-section-latam { background: #faf5ff; border: 2px solid #e9d5ff; }
    .notes-title { font-size: 16px; font-weight: 600; color: #1e3a8a; margin-bottom: 12px; }
    .notes-title-latam { color: #6b21a8; }
    .notes-content { color: #1e40af; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .notes-content-latam { color: #7e22ce; }
    @media print { body { background: white; padding: 0; } .container { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Deal Backed Calculations</h1>
    <div class="subtitle">${currentWeek.label} | ${selectedRegion} Region</div>

    <div class="summary">
      <div class="summary-row"><span class="summary-label">Previous Week (As of EOD ${prevWeekEOD}):</span><span class="summary-value">${fmtDollar(prevDealBacked)}</span></div>
      <div class="summary-row"><span class="summary-label">Current Week (As of EOD ${currWeekEOD}):</span><span class="summary-value">${fmtDollar(currDealBacked)}</span></div>
      <div class="summary-row"><span class="summary-label">Week-over-Week Change:</span><span class="summary-value" style="color: ${currDealBacked - prevDealBacked >= 0 ? '#059669' : '#dc2626'}">${currDealBacked - prevDealBacked >= 0 ? '+' : ''}${fmtDollar(currDealBacked - prevDealBacked)}</span></div>
    </div>

    ${selectedRegion === 'All' ? `
      ${weeklyNotesNA ? `
        <div class="notes-section">
          <div class="notes-title">AIS Manager Notes - NA Region</div>
          <div class="notes-content">${weeklyNotesNA}</div>
        </div>
      ` : ''}
      ${weeklyNotesLATAM ? `
        <div class="notes-section notes-section-latam">
          <div class="notes-title notes-title-latam">AIS Manager Notes - LATAM Region</div>
          <div class="notes-content notes-content-latam">${weeklyNotesLATAM}</div>
        </div>
      ` : ''}
    ` : `
      ${(selectedRegion === 'NA' && weeklyNotesNA) ? `
        <div class="notes-section">
          <div class="notes-title">AIS Manager Notes - NA Region</div>
          <div class="notes-content">${weeklyNotesNA}</div>
        </div>
      ` : ''}
      ${(selectedRegion === 'LATAM' && weeklyNotesLATAM) ? `
        <div class="notes-section notes-section-latam">
          <div class="notes-title notes-title-latam">AIS Manager Notes - LATAM Region</div>
          <div class="notes-content notes-content-latam">${weeklyNotesLATAM}</div>
        </div>
      ` : ''}
    `}

    ${closedWonCount > 0 ? `
    <div class="section">
      <div class="section-title">✅ Closed Won Last Week (+${fmtDollar(closedWonTotal)})</div>
      <div class="deals-list">
        ${groupedClosedWon.map(deal => `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-name">${deal.account_name}</div>
              <div class="deal-amount">+$${deal.totalBookings.toLocaleString()}</div>
            </div>
            <div class="deal-details">
              ${deal.ae_name} • Closed ${new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            ${deal.products.length > 1 ? `
              <div style="margin-top: 8px; margin-left: 12px; font-size: 12px; color: #6b7280;">
                ${deal.products.map(prod => `
                  <div style="display: flex; justify-between; margin-bottom: 4px;">
                    <span>↳ ${prod.product}</span>
                    <span style="font-weight: 500;">$${prod.bookings.toLocaleString()}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">📊 Deal Backed Pipeline Movement Summary</div>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; justify-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">Left Deal Backed:</span>
          <span style="color: #dc2626; font-weight: 600;">-${fmtDollar(leftDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
        </div>
        <div style="display: flex; justify-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">Entered Deal Backed:</span>
          <span style="color: #059669; font-weight: 600;">+${fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
        </div>
        ${arrChangesInDealBacked.length > 0 ? `
        <div style="display: flex; justify-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">ARR Changes:</span>
          <span style="font-weight: 600; color: ${arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '#059669' : '#dc2626'}">
            ${arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '+' : ''}${fmtDollar(arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}
          </span>
        </div>
        ` : ''}
        <div style="display: flex; justify-between; border-top: 2px solid #d1d5db; padding-top: 8px; margin-top: 8px;">
          <span style="color: #111827; font-weight: 600;">Net Pipeline Change:</span>
          <span style="font-weight: 700; color: ${enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '#059669' : '#dc2626'}">
            ${enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '+' : ''}${fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}
          </span>
        </div>
      </div>
    </div>

    ${leftDealBacked.length > 0 ? `
    <div class="section">
      <div class="section-title">⬇️ Left Deal Backed (${leftDealBacked.length} deals) -${fmtDollar(leftDealBacked.reduce((s, d) => s + d.arr, 0))}</div>
      <div class="deals-list">
        ${leftDealBacked.map(item => {
          const reason = dealBackedReasons.get(item.opp.crm_opportunity_id);
          return `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-name">${item.opp.account_name}</div>
              <div class="deal-amount" style="color: #dc2626;">-${fmtDollar(item.arr)}</div>
            </div>
            <div class="deal-details">
              <span class="forecast-badge badge-removed">${item.from} → ${item.to}</span>
              ${item.opp.manager_name || item.opp.ae_name} ${reason ? `• <strong>${reason}</strong>` : ''}
            </div>
          </div>
        `}).join('')}
      </div>
    </div>
    ` : ''}

    ${enteredDealBacked.length > 0 ? `
    <div class="section">
      <div class="section-title">⬆️ Entered Deal Backed (${enteredDealBacked.length} deals) +${fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0))}</div>
      <div class="deals-list">
        ${enteredDealBacked.map(item => `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-name">
                ${item.opp.account_name}
                ${item.opp.crm_opportunity_id ? `<a href="https://zendesk.lightning.force.com/lightning/r/Opportunity/${item.opp.crm_opportunity_id}/view" target="_blank" style="color: #2563eb; margin-left: 4px; text-decoration: none;">🔗</a>` : ''}
              </div>
              <div class="deal-amount">+${fmtDollar(item.arr)}</div>
            </div>
            <div class="deal-details">
              <span class="forecast-badge ${item.to === 'Commit' ? 'badge-commit' : 'badge-ml'}">${item.from} → ${item.to}</span>
              ${item.opp.manager_name || item.opp.ae_name}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${movedWithinDealBacked.length > 0 ? `
    <div class="section">
      <div class="section-title">↔️ Moved Within Deal Backed (${movedWithinDealBacked.length} deals) No net impact</div>
      <div class="deals-list">
        ${movedWithinDealBacked.map(item => `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-name">${item.opp.account_name}</div>
              <div class="deal-amount">${fmtDollar(item.arr)}</div>
            </div>
            <div class="deal-details">
              <span class="forecast-badge badge-ml">${item.from} → ${item.to}</span>
              ${item.opp.manager_name || item.opp.ae_name}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${arrChangesInDealBacked.length > 0 ? `
    <div class="section">
      <div class="section-title">💰 ARR Changes Within Deal Backed (${arrChangesInDealBacked.length} deals) ${fmtDollar(arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}</div>
      <div class="deals-list">
        ${arrChangesInDealBacked.map(item => `
          <div class="deal-card">
            <div class="deal-header">
              <div class="deal-name">${item.opp.account_name}</div>
              <div class="deal-amount" style="color: ${item.delta >= 0 ? '#059669' : '#dc2626'}">${item.delta >= 0 ? '+' : ''}${fmtDollar(item.delta)}</div>
            </div>
            <div class="deal-details">
              ${fmtDollar(item.prevArr)} → ${fmtDollar(item.currArr)} • ${item.opp.manager_name || item.opp.ae_name}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

  </div>
</body>
</html>`;

    // Create blob and download
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deal-backed-${currentWeek.label.replace(/\s+/g, '-')}-${selectedRegion}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Group closed won by opportunity and calculate totals
  const groupedClosedWon = Array.from(
    closedWonLastWeek.reduce((map, deal) => {
      const existing = map.get(deal.crm_opportunity_id);
      if (existing) {
        existing.products.push({ product: deal.product, bookings: deal.bookings });
        existing.totalBookings += deal.bookings;
      } else {
        map.set(deal.crm_opportunity_id, {
          crm_opportunity_id: deal.crm_opportunity_id,
          account_name: deal.account_name,
          ae_name: deal.ae_name,
          close_date: deal.close_date,
          totalBookings: deal.bookings,
          products: [{ product: deal.product, bookings: deal.bookings }],
        });
      }
      return map;
    }, new Map<string, { crm_opportunity_id: string; account_name: string; ae_name: string; close_date: string; totalBookings: number; products: Array<{ product: string; bookings: number }> }>()).values()
  ).sort((a, b) => b.totalBookings - a.totalBookings);

  // Analyze deal backed movement
  const analyzeDealBackedMovement = () => {
    // Build maps by opportunity with product details including per-product ARR
    const prevOppProducts = new Map<string, { opps: ForecastOpp[]; products: Set<string>; totalArr: number; productArr: Map<string, number> }>();
    const currOppProducts = new Map<string, { opps: ForecastOpp[]; products: Set<string>; totalArr: number; productArr: Map<string, number> }>();

    // Add pipeline opps from previous week
    for (const opp of previousWeekOpps) {
      if (!prevOppProducts.has(opp.crm_opportunity_id)) {
        prevOppProducts.set(opp.crm_opportunity_id, { opps: [], products: new Set(), totalArr: 0, productArr: new Map() });
      }
      const entry = prevOppProducts.get(opp.crm_opportunity_id)!;
      const arr = opp.ais_arr ?? opp.product_arr_usd;
      entry.opps.push(opp);
      entry.products.add(opp.product);
      entry.totalArr += arr;
      entry.productArr.set(opp.product, (entry.productArr.get(opp.product) || 0) + arr);
    }

    // Add closed won deals from previous week (cumulative from quarter start through previous week start)
    const previousWeekStartStr = previousWeek.weekStart.toISOString().split('T')[0];
    const closedWonUpToPrevWeek = allClosedWon.filter(o =>
      o.close_date >= quarterStartStr && o.close_date <= previousWeekStartStr
    );
    for (const cw of closedWonUpToPrevWeek) {
      if (!prevOppProducts.has(cw.crm_opportunity_id)) {
        prevOppProducts.set(cw.crm_opportunity_id, { opps: [], products: new Set(), totalArr: 0, productArr: new Map() });
      }
      const entry = prevOppProducts.get(cw.crm_opportunity_id)!;
      const arr = cw.edited_bookings ?? cw.bookings;
      // Create a minimal ForecastOpp-like object
      const fakeForecastOpp = {
        ...cw,
        vp_deal_forecast: 'Closed Won',
        product_arr_usd: arr,
      } as any as ForecastOpp;
      entry.opps.push(fakeForecastOpp);
      entry.products.add(cw.product);
      entry.totalArr += arr;
      entry.productArr.set(cw.product, (entry.productArr.get(cw.product) || 0) + arr);
    }

    // Add pipeline opps from current week
    for (const opp of currentWeekOpps) {
      if (!currOppProducts.has(opp.crm_opportunity_id)) {
        currOppProducts.set(opp.crm_opportunity_id, { opps: [], products: new Set(), totalArr: 0, productArr: new Map() });
      }
      const entry = currOppProducts.get(opp.crm_opportunity_id)!;
      const arr = opp.ais_arr ?? opp.product_arr_usd;
      entry.opps.push(opp);
      entry.products.add(opp.product);
      entry.totalArr += arr;
      entry.productArr.set(opp.product, (entry.productArr.get(opp.product) || 0) + arr);
    }

    // Add closed won deals from current week (cumulative from quarter start through current point)
    const now = new Date();
    const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const nowStr = nowLocal.toISOString().split('T')[0];
    const isCurrentWeek = now <= currentWeek.weekEnd;
    const currentWeekStartStr = currentWeek.weekStart.toISOString().split('T')[0];
    const currentWeekFilterDate = isCurrentWeek ? nowStr : currentWeekStartStr;
    const closedWonUpToCurrWeek = allClosedWon.filter(o =>
      o.close_date >= quarterStartStr && o.close_date <= currentWeekFilterDate
    );
    for (const cw of closedWonUpToCurrWeek) {
      if (!currOppProducts.has(cw.crm_opportunity_id)) {
        currOppProducts.set(cw.crm_opportunity_id, { opps: [], products: new Set(), totalArr: 0, productArr: new Map() });
      }
      const entry = currOppProducts.get(cw.crm_opportunity_id)!;
      const arr = cw.edited_bookings ?? cw.bookings;
      // Create a minimal ForecastOpp-like object
      const fakeForecastOpp = {
        ...cw,
        vp_deal_forecast: 'Closed Won',
        product_arr_usd: arr,
      } as any as ForecastOpp;
      entry.opps.push(fakeForecastOpp);
      entry.products.add(cw.product);
      entry.totalArr += arr;
      entry.productArr.set(cw.product, (entry.productArr.get(cw.product) || 0) + arr);
    }

    const closedWonMap = new Set(closedWonThisWeek.map((o) => o.crm_opportunity_id));
    const closedWonLastWeekMap = new Set(closedWonLastWeek.map((o) => o.crm_opportunity_id));
    const allClosedWonMap = new Set(allClosedWon.map((o) => o.crm_opportunity_id));
    const allOppsMap = new Map(allOpps.map((o) => [o.crm_opportunity_id, o]));

    const newDeals: Array<{ opp: ForecastOpp; arr: number; products: string[] }> = [];
    const lostDeals: Array<{ opp: ForecastOpp; arr: number; reason: string; products: string[] }> = [];
    const forecastChanges: Array<{ opp: ForecastOpp; oldForecast: string; newForecast: string; arr: number; products: string[]; dealBackedImpact: number }> = [];
    const arrChanges: Array<{ opp: ForecastOpp; oldArr: number; newArr: number; delta: number; products: string[]; productChanges: Array<{ product: string; oldArr: number; newArr: number; delta: number }> }> = [];
    const stageProgressions: Array<{ opp: ForecastOpp; oldStage: string; newStage: string; arr: number; products: string[] }> = [];

    // Find new deals (in current but not in previous)
    // Only include deals that are in Deal Backed (Commit, Most Likely) - EXCLUDE Closed Won
    // Closed Won deals are tracked separately in "New Closed Won" section
    for (const [oppId, currEntry] of currOppProducts) {
      const currOpp = currEntry.opps[0];
      const isInDealBacked = ['Commit', 'Most Likely'].includes(currOpp.vp_deal_forecast);

      if (!prevOppProducts.has(oppId) && isInDealBacked) {
        newDeals.push({
          opp: currOpp,
          arr: currEntry.totalArr,
          products: Array.from(currEntry.products).sort(),
        });
      }
    }

    // Get current quarter for comparison
    const currentQ = toCloseQuarter(new Date().toISOString().split('T')[0]);

    // Find lost/changed deals
    for (const [oppId, prevEntry] of prevOppProducts) {
      const currEntry = currOppProducts.get(oppId);

      if (!currEntry) {
        // Skip if this deal is excluded from analysis
        if (excludedDealIds.has(oppId)) {
          continue;
        }

        const prevOpp = prevEntry.opps[0];
        // Only show if the deal WAS in Deal Backed (Closed Won, Commit, Most Likely)
        const wasInDealBacked = ['Closed Won', 'Commit', 'Most Likely'].includes(prevOpp.vp_deal_forecast);
        if (!wasInDealBacked) {
          continue;
        }

        // Deal disappeared from Deal Backed - determine why
        let reason = 'Removed from pipeline';

        // Check if it closed won (any time, not just this week)
        if (allClosedWonMap.has(oppId)) {
          reason = '✅ Closed Won';
        }
        // Check if it still exists in pipeline but moved to different quarter
        else if (allOppsMap.has(oppId)) {
          const currentOpp = allOppsMap.get(oppId)!;
          const newQ = toCloseQuarter(currentOpp.close_date);
          if (newQ !== currentQ) {
            reason = '📅 Pushed to ' + newQ;
          } else if (currentOpp.vp_deal_forecast && currentOpp.vp_deal_forecast.toLowerCase().includes('omit')) {
            reason = '🚫 Moved to Omit';
          } else if (currentOpp.vp_deal_forecast && !['Commit', 'Most Likely'].includes(currentOpp.vp_deal_forecast)) {
            reason = `Moved to ${currentOpp.vp_deal_forecast}`;
          }
        }
        // Check if stage is Closed Lost
        else if (prevOpp.stage_name && prevOpp.stage_name.toLowerCase().includes('closed lost')) {
          reason = '❌ Closed Lost';
        }

        lostDeals.push({
          opp: prevOpp,
          arr: prevEntry.totalArr,
          reason,
          products: Array.from(prevEntry.products).sort(),
        });
      } else {
        // Deal still exists - check for changes
        const prevOpp = prevEntry.opps[0];
        const currOpp = currEntry.opps[0];
        const prevArr = prevEntry.totalArr;
        const currArr = currEntry.totalArr;

        // Detect added/dropped products
        const addedProducts = Array.from(currEntry.products).filter((p) => !prevEntry.products.has(p));
        const droppedProducts = Array.from(prevEntry.products).filter((p) => !currEntry.products.has(p));

        // Forecast changes - track impact on Deal Backed
        // Only show changes that affect Deal Backed (entering or leaving)
        if (prevOpp.vp_deal_forecast !== currOpp.vp_deal_forecast) {
          const wasInDealBacked = ['Closed Won', 'Commit', 'Most Likely'].includes(prevOpp.vp_deal_forecast);
          const isInDealBacked = ['Closed Won', 'Commit', 'Most Likely'].includes(currOpp.vp_deal_forecast);
          let impact = 0;

          if (!wasInDealBacked && isInDealBacked) {
            impact = currArr; // Added to Deal Backed
          } else if (wasInDealBacked && !isInDealBacked) {
            impact = -currArr; // Removed from Deal Backed
          }

          // Only show if it actually impacts Deal Backed (entering or leaving)
          if (impact !== 0 || (wasInDealBacked && isInDealBacked)) {
            forecastChanges.push({
              opp: currOpp,
              oldForecast: prevOpp.vp_deal_forecast,
              newForecast: currOpp.vp_deal_forecast,
              arr: currArr,
              products: Array.from(currEntry.products).sort(),
              dealBackedImpact: impact,
            });
          }
        }

        // ARR changes - track per-product changes
        // Only show if deal is currently in Deal Backed (Closed Won, Commit, Most Likely)
        const isCurrentlyInDealBacked = ['Closed Won', 'Commit', 'Most Likely'].includes(currOpp.vp_deal_forecast);
        if (Math.abs(currArr - prevArr) > 1000 && isCurrentlyInDealBacked) {
          // Build per-product change details
          const allProducts = new Set([...prevEntry.products, ...currEntry.products]);
          const productChanges: Array<{ product: string; oldArr: number; newArr: number; delta: number }> = [];

          for (const product of allProducts) {
            const oldArr = prevEntry.productArr.get(product) || 0;
            const newArr = currEntry.productArr.get(product) || 0;
            const delta = newArr - oldArr;

            // Only include products with significant changes
            if (Math.abs(delta) > 1000 || oldArr === 0 || newArr === 0) {
              productChanges.push({ product, oldArr, newArr, delta });
            }
          }

          // Sort by absolute delta (largest changes first)
          productChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

          arrChanges.push({
            opp: currOpp,
            oldArr: prevArr,
            newArr: currArr,
            delta: currArr - prevArr,
            products: Array.from(currEntry.products).sort(),
            productChanges,
          });
        }

        // Stage progressions
        // Only show if deal is currently in Deal Backed (Closed Won, Commit, Most Likely)
        // Exclude deals that closed won last week (already shown in "Closed Won Last Week")
        if (prevOpp.stage_name !== currOpp.stage_name && !closedWonLastWeekMap.has(oppId) && isCurrentlyInDealBacked) {
          stageProgressions.push({
            opp: currOpp,
            oldStage: prevOpp.stage_name,
            newStage: currOpp.stage_name,
            arr: currArr,
            products: Array.from(currEntry.products).sort(),
          });
        }
      }
    }

    // Sort by ARR (highest first)
    newDeals.sort((a, b) => b.arr - a.arr);
    lostDeals.sort((a, b) => b.arr - a.arr);
    forecastChanges.sort((a, b) => b.arr - a.arr);
    arrChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    stageProgressions.sort((a, b) => b.arr - a.arr);

    return { newDeals, lostDeals, forecastChanges, arrChanges, stageProgressions };
  };

  const movement = analyzeDealBackedMovement();

  // Helper to create SFDC URL
  const sfdcUrl = (oppId: string) => `https://zendesk.lightning.force.com/lightning/r/Opportunity/${oppId}/view`;

  // Calculate actual Deal Backed (CW + Commit + ML) for both weeks
  // Note: vpDealBacked already includes closedWon, so don't add it again
  const prevDealBacked = previousWeek.vpDealBacked;
  const currDealBacked = currentWeek.vpDealBacked;
  const dealBackedChange = currDealBacked - prevDealBacked;

  // Calculate "As of EOD" dates for display
  const prevWeekEndDate = new Date(previousWeek.weekStart);
  prevWeekEndDate.setDate(prevWeekEndDate.getDate() - 1); // Day before previous week starts
  const prevWeekEOD = prevWeekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const currWeekEndDate = new Date(currentWeek.weekStart);
  currWeekEndDate.setDate(currWeekEndDate.getDate() - 1); // Day before current week starts (yesterday for current week)
  const currWeekEOD = currWeekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Closed Won Last Week */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => toggleSection('closedWon')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{expandedSection === 'closedWon' ? '▼' : '▶'}</span>
            <div className="text-left">
              <h3 className="text-base font-bold text-gray-900">Closed Won Last Week</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Set(closedWonLastWeek.map(o => o.crm_opportunity_id)).size} deal{new Set(closedWonLastWeek.map(o => o.crm_opportunity_id)).size !== 1 ? 's' : ''} · {fmtDollar(closedWonLastWeek.reduce((sum, o) => sum + (o.edited_bookings ?? o.bookings), 0))}
              </p>
            </div>
          </div>
        </button>
        {(expandedSection === 'closedWon' || preparingPrint) && (
          <div className="px-6 pb-6 border-t border-gray-100" data-collapsible-content>
            <div className="space-y-3 mt-4">
              {groupedClosedWon.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No closed won deals last week</p>
              ) : (
                groupedClosedWon.map((deal, i) => (
                  <div key={i} className="border-b border-gray-100 pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 text-sm">{deal.account_name}</p>
                          <button
                            onClick={() => window.api.openExternal(sfdcUrl(deal.crm_opportunity_id))}
                            className="text-blue-500 hover:text-blue-700 text-xs"
                            title="Open in Salesforce"
                          >
                            SFDC ↗
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{deal.ae_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900 text-sm">{fmtDollar(deal.totalBookings)}</p>
                        <p className="text-xs text-gray-500">{fmtDateShort(deal.close_date)}</p>
                      </div>
                    </div>
                    {deal.products.length > 1 && (
                      <div className="mt-2 ml-4 space-y-1">
                        {deal.products.map((prod, j) => (
                          <div key={j} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600">↳ {prod.product}</span>
                            <span className="text-gray-700 font-medium">{fmtDollar(prod.bookings)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Big Deals Movement */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => toggleSection('bigDeals')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{expandedSection === 'bigDeals' ? '▼' : '▶'}</span>
            <div className="text-left">
              <h3 className="text-base font-bold text-gray-900">Big Deals Movement</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Deals crossing $100K threshold
              </p>
            </div>
          </div>
          <div className="text-sm font-semibold text-gray-600">
            {currentWeek.bigDealsCount - previousWeek.bigDealsCount >= 0 ? '+' : ''}
            {currentWeek.bigDealsCount - previousWeek.bigDealsCount}
          </div>
        </button>
        {(expandedSection === 'bigDeals' || preparingPrint) && (
          <div className="px-6 pb-6 border-t border-gray-100" data-collapsible-content>
            <div className="text-sm text-gray-500 py-4">
              Big deals movement will show deals that crossed or fell below the $100K threshold
            </div>
          </div>
        )}
      </div>

      {/* Team & Product Insights */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => toggleSection('insights')}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{expandedSection === 'insights' ? '▼' : '▶'}</span>
            <div className="text-left">
              <h3 className="text-base font-bold text-gray-900">Team & Product Insights</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Top movers, product changes, at-risk deals
              </p>
            </div>
          </div>
        </button>
        {(expandedSection === 'insights' || preparingPrint) && (
          <div className="px-6 pb-6 border-t border-gray-100" data-collapsible-content>
            <div className="text-sm text-gray-500 py-4">
              Team insights will show top movers by AE, changes by product, and deals at risk
            </div>
          </div>
        )}
      </div>

      {/* Deal Backed Calculations */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
          <button
            onClick={() => toggleSection('calculations')}
            className="flex items-center gap-3 flex-1"
          >
            <span className="text-2xl">{expandedSection === 'calculations' ? '▼' : '▶'}</span>
            <div className="text-left">
              <h3 className="text-base font-bold text-gray-900">Deal Backed Calculations</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                CW + Commit + ML: {fmtDollar(prevDealBacked)} → {fmtDollar(currDealBacked)}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className={`text-sm font-semibold ${dealBackedChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {dealBackedChange >= 0 ? '+' : ''}
              {fmtDollar(dealBackedChange)}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); exportDealBackedHtml(); }}
              className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-all"
              title="Export to HTML"
            >
              📤 Export
            </button>
          </div>
        </div>
        {(expandedSection === 'calculations' || preparingPrint) && (
          <div className="px-6 pb-6 border-t border-gray-100" data-collapsible-content>
            <div className="py-4">
              {/* AIS Manager Notes Section */}
              {selectedRegion === 'All' ? (
                <>
                  {/* NA Notes */}
                  <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h5 className="text-sm font-semibold text-blue-900 mb-2">AIS Manager Notes - NA Region</h5>
                    <textarea
                      value={weeklyNotesNA}
                      onChange={(e) => setWeeklyNotesNA(e.target.value)}
                      onBlur={async () => {
                        const weekStartStr = weeks[selectedWeekIndex]?.start.toISOString().split('T')[0];
                        if (weekStartStr) {
                          await window.api.setWeeklyNotes(weekStartStr, 'NA', weeklyNotesNA || null);
                        }
                      }}
                      placeholder="Add notes about NA deal backed changes..."
                      className="w-full text-sm border border-blue-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400 resize-vertical min-h-[80px] bg-white"
                    />
                  </div>

                  {/* LATAM Notes */}
                  <div className="mb-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <h5 className="text-sm font-semibold text-purple-900 mb-2">AIS Manager Notes - LATAM Region</h5>
                    <textarea
                      value={weeklyNotesLATAM}
                      onChange={(e) => setWeeklyNotesLATAM(e.target.value)}
                      onBlur={async () => {
                        const weekStartStr = weeks[selectedWeekIndex]?.start.toISOString().split('T')[0];
                        if (weekStartStr) {
                          await window.api.setWeeklyNotes(weekStartStr, 'LATAM', weeklyNotesLATAM || null);
                        }
                      }}
                      placeholder="Add notes about LATAM deal backed changes..."
                      className="w-full text-sm border border-purple-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-purple-400 resize-vertical min-h-[80px] bg-white"
                    />
                  </div>
                </>
              ) : (
                <div className={`mb-6 ${selectedRegion === 'NA' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'} border rounded-lg p-4`}>
                  <h5 className={`text-sm font-semibold mb-2 ${selectedRegion === 'NA' ? 'text-blue-900' : 'text-purple-900'}`}>
                    AIS Manager Notes - {selectedRegion} Region
                  </h5>
                  <textarea
                    value={selectedRegion === 'NA' ? weeklyNotesNA : weeklyNotesLATAM}
                    onChange={(e) => {
                      if (selectedRegion === 'NA') {
                        setWeeklyNotesNA(e.target.value);
                      } else {
                        setWeeklyNotesLATAM(e.target.value);
                      }
                    }}
                    onBlur={async () => {
                      const weekStartStr = weeks[selectedWeekIndex]?.start.toISOString().split('T')[0];
                      if (weekStartStr) {
                        const notes = selectedRegion === 'NA' ? weeklyNotesNA : weeklyNotesLATAM;
                        await window.api.setWeeklyNotes(weekStartStr, selectedRegion, notes || null);
                      }
                    }}
                    placeholder={`Add notes about ${selectedRegion} deal backed changes...`}
                    className={`w-full text-sm border rounded px-3 py-2 outline-none resize-vertical min-h-[80px] bg-white ${
                      selectedRegion === 'NA'
                        ? 'border-blue-300 focus:ring-2 focus:ring-blue-400'
                        : 'border-purple-300 focus:ring-2 focus:ring-purple-400'
                    }`}
                  />
                </div>
              )}

              {/* Previous Week Breakdown */}
              <div className="mb-6">
                <h5 className="text-sm font-semibold text-gray-700 mb-2">Previous Week (As of EOD {prevWeekEOD})</h5>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Closed Won:</span>
                    <span className="font-medium">{fmtDollar(previousWeek.closedWon)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">+ Commit:</span>
                    <span className="font-medium">{fmtDollar(previousWeek.vpCommit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">+ Most Likely:</span>
                    <span className="font-medium">{fmtDollar(previousWeek.vpMostLikely)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span className="text-gray-900 font-semibold">= Deal Backed:</span>
                    <span className="font-bold text-gray-900">{fmtDollar(previousWeek.vpDealBacked)}</span>
                  </div>
                </div>
              </div>

              {/* Current Week Breakdown */}
              <div className="mb-6">
                <h5 className="text-sm font-semibold text-gray-700 mb-2">Current Week (As of EOD {currWeekEOD})</h5>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Closed Won:</span>
                    <span className="font-medium">{fmtDollar(currentWeek.closedWon)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">+ Commit:</span>
                    <span className="font-medium">{fmtDollar(currentWeek.vpCommit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">+ Most Likely:</span>
                    <span className="font-medium">{fmtDollar(currentWeek.vpMostLikely)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span className="text-gray-900 font-semibold">= Deal Backed:</span>
                    <span className="font-bold text-gray-900">{fmtDollar(currentWeek.vpDealBacked)}</span>
                  </div>
                </div>
              </div>

              {/* Change Analysis */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h5 className="text-sm font-semibold text-gray-700 mb-3">Week-over-Week Changes</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Closed Won change:</span>
                    <span className={`font-medium ${currentWeek.closedWon - previousWeek.closedWon >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {currentWeek.closedWon - previousWeek.closedWon >= 0 ? '+' : ''}{fmtDollar(currentWeek.closedWon - previousWeek.closedWon)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Commit change:</span>
                    <span className={`font-medium ${currentWeek.vpCommit - previousWeek.vpCommit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {currentWeek.vpCommit - previousWeek.vpCommit >= 0 ? '+' : ''}{fmtDollar(currentWeek.vpCommit - previousWeek.vpCommit)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Most Likely change:</span>
                    <span className={`font-medium ${currentWeek.vpMostLikely - previousWeek.vpMostLikely >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {currentWeek.vpMostLikely - previousWeek.vpMostLikely >= 0 ? '+' : ''}{fmtDollar(currentWeek.vpMostLikely - previousWeek.vpMostLikely)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-gray-300 pt-2 mt-2">
                    <span className="text-gray-900 font-semibold">= Total Deal Backed change:</span>
                    <span className={`font-bold text-lg ${currentWeek.vpDealBacked - previousWeek.vpDealBacked >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {currentWeek.vpDealBacked - previousWeek.vpDealBacked >= 0 ? '+' : ''}{fmtDollar(currentWeek.vpDealBacked - previousWeek.vpDealBacked)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Detailed Deal-by-Deal Breakdown */}
              {(() => {
                // Build maps of opps in Deal Backed (Closed Won + Commit + Most Likely)
                const prevDealBackedOpps = previousWeekOpps.filter(o =>
                  o.vp_deal_forecast === 'Commit' || o.vp_deal_forecast === 'Most Likely'
                );
                const currDealBackedOpps = currentWeekOpps.filter(o =>
                  o.vp_deal_forecast === 'Commit' || o.vp_deal_forecast === 'Most Likely'
                );

                // Get cumulative Closed Won deals up to each week (from quarter start)
                // Use day BEFORE week starts to match the updated date logic
                const now = new Date();
                const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const isCurrentWeek = now <= currentWeek.weekEnd;

                // Calculate previous week end date (day before previous week starts)
                const prevWeekEndDate = new Date(previousWeek.weekStart);
                prevWeekEndDate.setDate(prevWeekEndDate.getDate() - 1);
                const previousWeekEndStr = prevWeekEndDate.toISOString().split('T')[0];

                // Calculate current week end date (yesterday for current week, day before for historical)
                let currentWeekEndStr: string;
                if (isCurrentWeek) {
                  const yesterday = new Date(nowLocal);
                  yesterday.setDate(yesterday.getDate() - 1);
                  currentWeekEndStr = yesterday.toISOString().split('T')[0];
                } else {
                  const currWeekEndDate = new Date(currentWeek.weekStart);
                  currWeekEndDate.setDate(currWeekEndDate.getDate() - 1);
                  currentWeekEndStr = currWeekEndDate.toISOString().split('T')[0];
                }

                // Use the same quarter start date as the top-level calculation (passed in as prop)
                // This ensures consistency between "Total Deal Backed change" and "Net Pipeline Change"

                // Closed won from quarter start to day before previous week (cumulative through EOD day before)
                const closedWonUpToPrevWeek = allClosedWon.filter(o =>
                  o.close_date >= quarterStartStr && o.close_date <= previousWeekEndStr
                );

                // Closed won from quarter start to day before current week (yesterday or EOD day before)
                const closedWonUpToCurrWeek = allClosedWon.filter(o =>
                  o.close_date >= quarterStartStr && o.close_date <= currentWeekEndStr
                );

                // Build previous week Deal Backed map (pipeline opps + cumulative closed won)
                const prevDealBackedMap = new Map<string, {arr: number; forecast: string}>();

                // Add pipeline opps (Commit + Most Likely)
                prevDealBackedOpps.forEach(o => {
                  const arr = o.ais_arr ?? o.product_arr_usd;
                  const existing = prevDealBackedMap.get(o.crm_opportunity_id);
                  prevDealBackedMap.set(o.crm_opportunity_id, {
                    arr: (existing?.arr || 0) + arr,
                    forecast: o.vp_deal_forecast
                  });
                });

                // Add cumulative Closed Won deals
                closedWonUpToPrevWeek.forEach(cw => {
                  const existing = prevDealBackedMap.get(cw.crm_opportunity_id);
                  prevDealBackedMap.set(cw.crm_opportunity_id, {
                    arr: (existing?.arr || 0) + (cw.edited_bookings ?? cw.bookings),
                    forecast: 'Closed Won'
                  });
                });

                // Build current week Deal Backed map (pipeline opps + cumulative closed won)
                const currDealBackedMap = new Map<string, {arr: number; forecast: string}>();

                // Add pipeline opps (Commit + Most Likely)
                currDealBackedOpps.forEach(o => {
                  const arr = o.ais_arr ?? o.product_arr_usd;
                  const existing = currDealBackedMap.get(o.crm_opportunity_id);
                  currDealBackedMap.set(o.crm_opportunity_id, {
                    arr: (existing?.arr || 0) + arr,
                    forecast: o.vp_deal_forecast
                  });
                });

                // Add cumulative Closed Won deals
                closedWonUpToCurrWeek.forEach(cw => {
                  const existing = currDealBackedMap.get(cw.crm_opportunity_id);
                  currDealBackedMap.set(cw.crm_opportunity_id, {
                    arr: (existing?.arr || 0) + (cw.edited_bookings ?? cw.bookings),
                    forecast: 'Closed Won'
                  });
                });

                // Build map of ALL previous week opps for context (including closed won)
                const prevOppMap = new Map<string, ForecastOpp>();
                previousWeekOpps.forEach(o => {
                  if (!prevOppMap.has(o.crm_opportunity_id)) {
                    prevOppMap.set(o.crm_opportunity_id, o);
                  }
                });
                // Add closed won deals to prev map (convert to ForecastOpp-like structure)
                closedWonUpToPrevWeek.forEach(cw => {
                  if (!prevOppMap.has(cw.crm_opportunity_id)) {
                    // Create a minimal ForecastOpp object from ClosedWonOpp
                    prevOppMap.set(cw.crm_opportunity_id, {
                      ...cw,
                      vp_deal_forecast: 'Closed Won',
                      product_arr_usd: cw.bookings,
                    } as any as ForecastOpp);
                  }
                });

                // Build map of ALL current week opps for context (including closed won)
                const currOppMap = new Map<string, ForecastOpp>();
                currentWeekOpps.forEach(o => {
                  if (!currOppMap.has(o.crm_opportunity_id)) {
                    currOppMap.set(o.crm_opportunity_id, o);
                  }
                });
                // Add closed won deals to curr map (convert to ForecastOpp-like structure)
                closedWonUpToCurrWeek.forEach(cw => {
                  if (!currOppMap.has(cw.crm_opportunity_id)) {
                    // Create a minimal ForecastOpp object from ClosedWonOpp
                    currOppMap.set(cw.crm_opportunity_id, {
                      ...cw,
                      vp_deal_forecast: 'Closed Won',
                      product_arr_usd: cw.bookings,
                    } as any as ForecastOpp);
                  }
                });

                const enteredDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
                const leftDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
                const movedWithinDealBacked: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];
                const arrChangesInDealBacked: Array<{opp: ForecastOpp; prevArr: number; currArr: number; delta: number}> = [];
                const dataCorrections: Array<{opp: ForecastOpp; arr: number; reason: string}> = [];
                const excludedDeals: Array<{opp: ForecastOpp; arr: number; from: string; to: string}> = [];

                // Build unfiltered maps to detect region changes
                const prevUnfilteredMap = new Map<string, ForecastOpp>();
                const prevUnfilteredSnapshot = snapshots.filter((s) => s.date <= previousWeekStartStr).sort((a, b) => b.date.localeCompare(a.date))[0];
                const prevUnfilteredData = prevUnfilteredSnapshot?.data || [];
                prevUnfilteredData.forEach(o => {
                  if (!prevUnfilteredMap.has(o.crm_opportunity_id)) {
                    prevUnfilteredMap.set(o.crm_opportunity_id, o);
                  }
                });

                const currUnfilteredMap = new Map<string, ForecastOpp>();
                const allCurrentOpps = selectedRegion === 'All' ? opps : opps; // Get ALL opps, not just filtered
                allCurrentOpps.forEach(o => {
                  if (!currUnfilteredMap.has(o.crm_opportunity_id)) {
                    currUnfilteredMap.set(o.crm_opportunity_id, o);
                  }
                });

                // Find all unique opportunity IDs
                const allOppIds = new Set([...prevDealBackedMap.keys(), ...currDealBackedMap.keys(), ...prevOppMap.keys(), ...currOppMap.keys()]);

                for (const oppId of allOppIds) {
                  const wasInDB = prevDealBackedMap.has(oppId);
                  const isInDB = currDealBackedMap.has(oppId);

                  // Check if this deal is manually excluded from analysis
                  const isExcluded = excludedDealIds.has(oppId);

                  const prevUnfiltered = prevUnfilteredMap.get(oppId);
                  const currUnfiltered = currUnfilteredMap.get(oppId);

                  if (isExcluded) {
                    // Deal is excluded - add to excluded list
                    if (wasInDB && !isInDB) {
                      const prev = prevDealBackedMap.get(oppId)!;
                      const prevOpp = prevOppMap.get(oppId)!;
                      excludedDeals.push({ opp: prevOpp, arr: prev.arr, from: prev.forecast, to: currUnfiltered?.vp_deal_forecast || 'Removed' });
                    } else if (!wasInDB && isInDB) {
                      const curr = currDealBackedMap.get(oppId)!;
                      const opp = currOppMap.get(oppId)!;
                      excludedDeals.push({ opp, arr: curr.arr, from: prevUnfiltered?.vp_deal_forecast || 'New', to: curr.forecast });
                    }
                    continue; // Skip from normal analysis
                  }

                  // Check if this is a region change (data correction)
                  if (prevUnfiltered && currUnfiltered && prevUnfiltered.region !== currUnfiltered.region) {
                    // Region changed - this is a data correction
                    if (wasInDB && !isInDB) {
                      const prev = prevDealBackedMap.get(oppId)!;
                      const prevOpp = prevOppMap.get(oppId)!;
                      dataCorrections.push({
                        opp: prevOpp,
                        arr: prev.arr,
                        reason: `Region changed: ${prevUnfiltered.region} → ${currUnfiltered.region}`
                      });
                      continue; // Skip adding to leftDealBacked
                    }
                  }

                  if (!wasInDB && isInDB) {
                    // Entered Deal Backed (+impact)
                    const curr = currDealBackedMap.get(oppId)!;
                    const opp = currOppMap.get(oppId)!;
                    const prevOpp = prevOppMap.get(oppId);
                    const from = prevOpp?.vp_deal_forecast || 'New';
                    enteredDealBacked.push({ opp, arr: curr.arr, from, to: curr.forecast });
                  } else if (wasInDB && !isInDB) {
                    // Left Deal Backed (-impact)
                    const prev = prevDealBackedMap.get(oppId)!;
                    const prevOpp = prevOppMap.get(oppId)!;
                    const currOpp = currOppMap.get(oppId);
                    const to = currOpp?.vp_deal_forecast || 'Removed';
                    leftDealBacked.push({ opp: prevOpp, arr: prev.arr, from: prev.forecast, to });
                  } else if (wasInDB && isInDB) {
                    // Deal stayed in Deal Backed - check for changes
                    const prev = prevDealBackedMap.get(oppId)!;
                    const curr = currDealBackedMap.get(oppId)!;

                    // Check if it moved within Deal Backed (Commit ↔ Most Likely ↔ Closed Won)
                    if (prev.forecast !== curr.forecast) {
                      const opp = currOppMap.get(oppId)!;
                      movedWithinDealBacked.push({ opp, arr: curr.arr, from: prev.forecast, to: curr.forecast });
                    }

                    // Check for ARR changes (significant changes > $1K)
                    const delta = curr.arr - prev.arr;
                    if (Math.abs(delta) > 1000) {
                      const opp = currOppMap.get(oppId)!;
                      arrChangesInDealBacked.push({ opp, prevArr: prev.arr, currArr: curr.arr, delta });
                    }
                  }
                }

                enteredDealBacked.sort((a, b) => b.arr - a.arr);
                leftDealBacked.sort((a, b) => b.arr - a.arr);
                movedWithinDealBacked.sort((a, b) => b.arr - a.arr);
                arrChangesInDealBacked.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

                return (
                  <div className="mt-6 space-y-6">
                    {/* Closed Won Details */}
                    {closedWonLastWeek.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-green-700 mb-2">✅ Closed Won Details ({closedWonLastWeek.length} deals)</h6>
                        <div className="text-xs text-gray-500 mb-2">See "Closed Won Last Week" section above for full list</div>
                      </div>
                    )}

                    {/* Deal Backed Movement Summary */}
                    {(leftDealBacked.length > 0 || enteredDealBacked.length > 0 || arrChangesInDealBacked.length > 0) && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-gray-800 mb-3">📊 Deal Backed Pipeline Movement Summary</h6>
                        <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Left Deal Backed:</span>
                            <span className="text-red-700 font-medium">-{fmtDollar(leftDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Entered Deal Backed:</span>
                            <span className="text-emerald-700 font-medium">+{fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
                          </div>
                          {arrChangesInDealBacked.length > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">ARR Changes:</span>
                              <span className={`font-medium ${arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '+' : ''}{fmtDollar(arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between border-t border-gray-300 pt-2 mt-2">
                            <span className="text-gray-900 font-semibold">Net Pipeline Change:</span>
                            <span className={`font-bold ${enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '+' : ''}
                              {fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0) - leftDealBacked.reduce((s, d) => s + d.arr, 0) + arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Deals that LEFT Deal Backed (negative impact) */}
                    {leftDealBacked.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-red-700 mb-3">
                          ⬇️ Left Deal Backed ({leftDealBacked.length} deals)
                          <span className="ml-2 text-red-600">-{fmtDollar(leftDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
                        </h6>
                        <div className="space-y-2">
                          {leftDealBacked.map((item, i) => {
                            const showReasonDropdown = item.to === 'Removed';
                            const currentReason = dealBackedReasons.get(item.opp.crm_opportunity_id);

                            return (
                              <div key={i} className="text-xs bg-white p-2 rounded border border-gray-200">
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-900">{item.opp.account_name}</span>
                                      <button
                                        onClick={() => window.api.openExternal(sfdcUrl(item.opp.crm_opportunity_id))}
                                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                        title="Open in Salesforce"
                                      >
                                        SFDC ↗
                                      </button>
                                    </div>
                                    <div className="text-gray-400 text-xs mt-0.5">
                                      {item.from} → {item.to}
                                    </div>
                                    {showReasonDropdown && (
                                      <div className="mt-1.5">
                                        <select
                                          value={currentReason || ''}
                                          onChange={async (e) => {
                                            const value = e.target.value === '' ? null : e.target.value;

                                            try {
                                              // Use previousWeekStartStr from the parent IIFE scope
                                              const prevSnapshot = snapshots.filter((s) => s.date <= previousWeekStartStr).sort((a, b) => b.date.localeCompare(a.date))[0];

                                              if (prevSnapshot && prevSnapshot.importedAt) {
                                                await window.api.setDealBackedReason(item.opp.crm_opportunity_id, prevSnapshot.importedAt, value);
                                                const newReasons = new Map(dealBackedReasons);
                                                newReasons.set(item.opp.crm_opportunity_id, value);
                                                setDealBackedReasons(newReasons);
                                              }
                                            } catch (err) {
                                              console.error('Error saving reason:', err);
                                            }
                                          }}
                                          className="text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        >
                                          <option value="">Select reason...</option>
                                          <option value="Moved from C/ML to BC">Moved from C/ML to BC</option>
                                          <option value="Pushed to next quarter">Pushed to next quarter</option>
                                          <option value="Opp Lost">Opp Lost</option>
                                          <option value="Closed Won - Non-Commish">Closed Won - Non-Commish</option>
                                          <option value="AI Products Removed">AI Products Removed</option>
                                          <option value="Other">Other</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-red-700 font-medium">-{fmtDollar(item.arr)}</span>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                          console.log('Excluding deal:', item.opp.crm_opportunity_id);
                                          await window.api.toggleExcludeFromAnalysis(item.opp.crm_opportunity_id, true);
                                          console.log('Excluded successfully, reloading...');
                                          await load();
                                        } catch (err) {
                                          console.error('Error excluding deal:', err);
                                          alert(`Failed to exclude: ${err}`);
                                        }
                                      }}
                                      className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
                                      title="Exclude from analysis (data error)"
                                    >
                                      Exclude
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Deals that ENTERED Deal Backed (positive impact) */}
                    {enteredDealBacked.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-emerald-700 mb-3">
                          ⬆️ Entered Deal Backed ({enteredDealBacked.length} deals)
                          <span className="ml-2 text-emerald-600">+{fmtDollar(enteredDealBacked.reduce((s, d) => s + d.arr, 0))}</span>
                        </h6>
                        <div className="space-y-2">
                          {enteredDealBacked.map((item, i) => (
                            <div key={i} className="text-xs bg-white p-2 rounded border border-gray-200">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-900">{item.opp.account_name}</span>
                                    {item.opp.crm_opportunity_id && (
                                      <button
                                        onClick={() => window.api.openExternal(`https://zendesk.lightning.force.com/lightning/r/Opportunity/${item.opp.crm_opportunity_id}/view`)}
                                        className="text-blue-600 hover:text-blue-800 shrink-0"
                                        title="Open in Salesforce"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  <div className="text-gray-400 text-xs mt-0.5">
                                    {item.from} → {item.to}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-emerald-700 font-medium">+{fmtDollar(item.arr)}</span>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        console.log('Excluding deal:', item.opp.crm_opportunity_id);
                                        await window.api.toggleExcludeFromAnalysis(item.opp.crm_opportunity_id, true);
                                        console.log('Excluded successfully, reloading...');
                                        await load();
                                      } catch (err) {
                                        console.error('Error excluding deal:', err);
                                        alert(`Failed to exclude: ${err}`);
                                      }
                                    }}
                                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
                                    title="Exclude from analysis (data error)"
                                  >
                                    Exclude
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Deals that MOVED WITHIN Deal Backed (no net impact) */}
                    {movedWithinDealBacked.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-gray-600 mb-3">
                          ↔️ Moved Within Deal Backed ({movedWithinDealBacked.length} deals)
                          <span className="ml-2 text-gray-500">No net impact</span>
                        </h6>
                        <div className="space-y-1">
                          {movedWithinDealBacked.map((item, i) => (
                            <div key={i} className="text-xs">
                              <div className="flex justify-between">
                                <span className="text-gray-700">{item.opp.account_name}</span>
                                <span className="text-gray-600 font-medium">{fmtDollar(item.arr)}</span>
                              </div>
                              <div className="text-gray-400 text-xs ml-2">
                                {item.from} → {item.to}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ARR Changes Within Deal Backed */}
                    {arrChangesInDealBacked.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-blue-700 mb-3">
                          💰 ARR Changes Within Deal Backed ({arrChangesInDealBacked.length} deals)
                          <span className="ml-2 text-blue-600">{arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0) >= 0 ? '+' : ''}{fmtDollar(arrChangesInDealBacked.reduce((s, d) => s + d.delta, 0))}</span>
                        </h6>
                        <div className="space-y-2">
                          {arrChangesInDealBacked.map((item, i) => (
                            <div key={i} className="text-xs bg-white p-2 rounded border border-gray-200">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900">{item.opp.account_name}</span>
                                    <button
                                      onClick={() => window.api.openExternal(sfdcUrl(item.opp.crm_opportunity_id))}
                                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                      title="Open in Salesforce"
                                    >
                                      SFDC ↗
                                    </button>
                                  </div>
                                  <div className="text-gray-400 text-xs mt-0.5">
                                    {fmtDollar(item.prevArr)} → {fmtDollar(item.currArr)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium ${item.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                    {item.delta >= 0 ? '+' : ''}{fmtDollar(item.delta)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Excluded Deals (Data Corrections) */}
                    {excludedDeals.length > 0 && (
                      <div className="border-t border-gray-200 pt-4">
                        <h6 className="text-sm font-semibold text-orange-700 mb-3">
                          🚫 Excluded from Analysis ({excludedDeals.length} deals)
                          <span className="ml-2 text-gray-500 text-xs font-normal">Data corrections</span>
                        </h6>
                        <div className="space-y-2">
                          {excludedDeals.map((item, i) => (
                            <div key={i} className="text-xs bg-orange-50 p-2 rounded border border-orange-200">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="font-medium text-gray-900">{item.opp.account_name}</div>
                                  <div className="text-gray-400 text-xs mt-0.5">
                                    {item.from} → {item.to}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-600 font-medium">{fmtDollar(item.arr)}</span>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        console.log('Including deal:', item.opp.crm_opportunity_id);
                                        await window.api.toggleExcludeFromAnalysis(item.opp.crm_opportunity_id, false);
                                        console.log('Included successfully, reloading...');
                                        await load();
                                      } catch (err) {
                                        console.error('Error including deal:', err);
                                        alert(`Failed to include: ${err}`);
                                      }
                                    }}
                                    className="text-xs px-2 py-1 bg-emerald-100 hover:bg-emerald-200 rounded text-emerald-700"
                                    title="Include back in analysis"
                                  >
                                    Include
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
