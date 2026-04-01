import React, { useEffect, useState } from 'react';

interface ReconciliationResult {
  opportunity_number: string;
  crm_opportunity_id: string;
  issue_type: 'missing_in_xactly' | 'arr_mismatch' | 'match';
  tableau_amount: number | null;
  xactly_amount: number | null;
  variance: number | null;
  account_name: string;
  ae_name: string;
  close_date: string;
  product_book: string;
  investigation_status: string | null;
}

type SortColumn = 'opp_number' | 'account_name' | 'ae_name' | 'close_date' | 'issue_type' | 'tableau_amount' | 'xactly_amount' | 'variance';
type SortDirection = 'asc' | 'desc';

export default function CommissionReconciliation() {
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [newPeriod, setNewPeriod] = useState('');
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('opp_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterIssueTypes, setFilterIssueTypes] = useState<Set<string>>(new Set(['match', 'arr_mismatch', 'missing_in_xactly']));
  const [filterInvestigations, setFilterInvestigations] = useState<Set<string>>(new Set(['not_investigated', 'Send to Commish Team', 'Xactly Correct - Renewal', 'Xactly Correct - OTD', 'Xactly Correct - Other']));

  const [uploadStatus, setUploadStatus] = useState<{
    tableau?: { inserted: number; updated: number };
    xactlyAI?: { inserted: number; updated: number };
    xactlyWEM?: { inserted: number; updated: number };
  }>({});

  useEffect(() => {
    loadPeriods();
  }, []);

  async function loadPeriods() {
    const data = await window.api.getCommissionPeriods();
    setPeriods(data);
    if (data.length > 0) {
      setSelectedPeriod(data[0]);
      loadReconciliation(data[0]);
    }
  }

  async function loadReconciliation(period: string) {
    if (!period) return;
    setLoading(true);
    const data = await window.api.getCommissionReconciliation(period);
    setResults(data);
    setLoading(false);
  }

  async function handleFileUpload(type: 'tableau' | 'xactlyAI' | 'xactlyWEM') {
    const period = showNewPeriod ? newPeriod : selectedPeriod;
    if (!period) {
      alert('Please select or enter a period first');
      return;
    }

    // Open file dialog
    const filePath = await window.api.openFileDialog();
    if (!filePath) return;

    try {
      let result: { inserted: number; updated: number };

      if (type === 'tableau') {
        result = await window.api.importTableauCommissions(filePath, period);
        setUploadStatus(prev => ({ ...prev, tableau: result }));
      } else {
        result = await window.api.importXactlyCommissions(filePath, period);
        if (type === 'xactlyAI') {
          setUploadStatus(prev => ({ ...prev, xactlyAI: result }));
        } else {
          setUploadStatus(prev => ({ ...prev, xactlyWEM: result }));
        }
      }

      // Reload periods and reconciliation
      await loadPeriods();
      if (showNewPeriod) {
        setSelectedPeriod(period);
        setShowNewPeriod(false);
        setNewPeriod('');
      }
      loadReconciliation(period);
    } catch (error) {
      alert(`Error importing file: ${error}`);
    }
  }

  async function handleClearData() {
    if (!selectedPeriod) return;
    if (!confirm(`Clear all commission data for ${selectedPeriod}? This cannot be undone.`)) {
      return;
    }
    await window.api.clearCommissionData(selectedPeriod);
    setUploadStatus({});
    await loadPeriods();
  }

  async function handleInvestigationChange(opportunityNumber: string, status: string) {
    if (!selectedPeriod) return;
    const newStatus = status === '' ? null : status;
    await window.api.setInvestigationStatus(opportunityNumber, selectedPeriod, newStatus);
    // Update local state
    setResults(prev => prev.map(r =>
      r.opportunity_number === opportunityNumber
        ? { ...r, investigation_status: newStatus }
        : r
    ));
  }

  function fmtDollar(n: number | null): string {
    if (n === null) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  function toggleIssueType(type: string) {
    const newSet = new Set(filterIssueTypes);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setFilterIssueTypes(newSet);
  }

  function toggleInvestigation(status: string) {
    const newSet = new Set(filterInvestigations);
    if (newSet.has(status)) {
      newSet.delete(status);
    } else {
      newSet.add(status);
    }
    setFilterInvestigations(newSet);
  }

  const filteredResults = results.filter(r => {
    // Filter by issue type
    if (!filterIssueTypes.has(r.issue_type)) {
      return false;
    }

    // Filter by investigation status
    const investigationKey = r.investigation_status || 'not_investigated';
    if (!filterInvestigations.has(investigationKey)) {
      return false;
    }

    return true;
  });

  const sortedResults = [...filteredResults].sort((a, b) => {
    let aVal: any;
    let bVal: any;

    switch (sortColumn) {
      case 'opp_number':
        aVal = a.opportunity_number;
        bVal = b.opportunity_number;
        break;
      case 'account_name':
        aVal = a.account_name.toLowerCase();
        bVal = b.account_name.toLowerCase();
        break;
      case 'ae_name':
        aVal = a.ae_name.toLowerCase();
        bVal = b.ae_name.toLowerCase();
        break;
      case 'close_date':
        aVal = a.close_date || '';
        bVal = b.close_date || '';
        break;
      case 'issue_type':
        aVal = a.issue_type;
        bVal = b.issue_type;
        break;
      case 'tableau_amount':
        aVal = a.tableau_amount || 0;
        bVal = b.tableau_amount || 0;
        break;
      case 'xactly_amount':
        aVal = a.xactly_amount || 0;
        bVal = b.xactly_amount || 0;
        break;
      case 'variance':
        aVal = a.variance || 0;
        bVal = b.variance || 0;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalMissing = results.filter(r => r.issue_type === 'missing_in_xactly').length;
  const totalMismatches = results.filter(r => r.issue_type === 'arr_mismatch').length;
  const totalMatches = results.filter(r => r.issue_type === 'match').length;
  const totalVariance = results
    .filter(r => r.issue_type === 'arr_mismatch' || r.issue_type === 'missing_in_xactly')
    .reduce((sum, r) => sum + (r.variance || 0), 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Fixed header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 bg-white shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Commission Reconciliation</h2>
          <p className="text-sm text-gray-400 mt-0.5">Compare Tableau closed won vs Xactly commissions</p>
        </div>
        <div className="flex gap-2">
          {!showNewPeriod ? (
            <>
              <select
                value={selectedPeriod}
                onChange={(e) => {
                  setSelectedPeriod(e.target.value);
                  loadReconciliation(e.target.value);
                  setUploadStatus({});
                }}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="">Select Period</option>
                {periods.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button
                onClick={() => setShowNewPeriod(true)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                + New Period
              </button>
              {selectedPeriod && (
                <button
                  onClick={handleClearData}
                  className="px-3 py-2 text-sm rounded-lg border border-red-200 hover:bg-red-50 text-red-600"
                >
                  Clear Data
                </button>
              )}
            </>
          ) : (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="e.g., Feb 2026"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 outline-none focus:ring-2 focus:ring-green-400"
              />
              <button
                onClick={() => {
                  setShowNewPeriod(false);
                  setNewPeriod('');
                }}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Upload section */}
      <div className="shrink-0 px-8 py-4 border-b border-gray-100 bg-gray-50">
        <div className="grid grid-cols-3 gap-4">
          {/* Tableau upload */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Tableau Closed Won</h3>
            <button
              onClick={() => handleFileUpload('tableau')}
              className="w-full py-2 px-3 text-xs rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 text-gray-600 transition-colors mb-2"
            >
              Choose CSV File
            </button>
            {uploadStatus.tableau && (
              <p className="text-xs text-green-600">
                ✓ {uploadStatus.tableau.inserted} inserted, {uploadStatus.tableau.updated} updated
              </p>
            )}
          </div>

          {/* Xactly AI upload */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Xactly AI Commissions</h3>
            <button
              onClick={() => handleFileUpload('xactlyAI')}
              className="w-full py-2 px-3 text-xs rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 text-gray-600 transition-colors mb-2"
            >
              Choose CSV File
            </button>
            {uploadStatus.xactlyAI && (
              <p className="text-xs text-green-600">
                ✓ {uploadStatus.xactlyAI.inserted} inserted, {uploadStatus.xactlyAI.updated} updated
              </p>
            )}
          </div>

          {/* Xactly WEM upload */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Xactly WEM Commissions</h3>
            <button
              onClick={() => handleFileUpload('xactlyWEM')}
              className="w-full py-2 px-3 text-xs rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 text-gray-600 transition-colors mb-2"
            >
              Choose CSV File
            </button>
            {uploadStatus.xactlyWEM && (
              <p className="text-xs text-green-600">
                ✓ {uploadStatus.xactlyWEM.inserted} inserted, {uploadStatus.xactlyWEM.updated} updated
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      {results.length > 0 && (
        <div className="shrink-0 px-8 py-4 border-b border-gray-100 bg-white">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <p className="text-xs text-green-600 font-medium">Matched</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{totalMatches}</p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-4">
              <p className="text-xs text-red-600 font-medium">Missing in Xactly</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{totalMissing}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
              <p className="text-xs text-yellow-700 font-medium">ARR Mismatches</p>
              <p className="text-2xl font-bold text-yellow-800 mt-1">{totalMismatches}</p>
            </div>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-600 font-medium">Total Variance</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{fmtDollar(totalVariance)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {results.length > 0 && (
        <div className="shrink-0 px-8 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex gap-6 items-start">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Issue Type:</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterIssueTypes.has('match')}
                    onChange={() => toggleIssueType('match')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Match</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterIssueTypes.has('arr_mismatch')}
                    onChange={() => toggleIssueType('arr_mismatch')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Mismatch</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterIssueTypes.has('missing_in_xactly')}
                    onChange={() => toggleIssueType('missing_in_xactly')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Missing</span>
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Investigation:</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterInvestigations.has('not_investigated')}
                    onChange={() => toggleInvestigation('not_investigated')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Not Investigated</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterInvestigations.has('Send to Commish Team')}
                    onChange={() => toggleInvestigation('Send to Commish Team')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Send to Commish</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterInvestigations.has('Xactly Correct - Renewal')}
                    onChange={() => toggleInvestigation('Xactly Correct - Renewal')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Renewal</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterInvestigations.has('Xactly Correct - OTD')}
                    onChange={() => toggleInvestigation('Xactly Correct - OTD')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">OTD</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterInvestigations.has('Xactly Correct - Other')}
                    onChange={() => toggleInvestigation('Xactly Correct - Other')}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="text-xs text-gray-700">Other</span>
                </label>
              </div>
            </div>
            <div className="text-xs text-gray-500 ml-auto mt-5">
              Showing {sortedResults.length} of {results.length} deals
            </div>
          </div>
        </div>
      )}

      {/* Results table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-sm text-gray-400 px-8 py-4">Loading...</p>
        ) : results.length === 0 ? (
          <div className="text-center py-12 px-8">
            <p className="text-sm text-gray-400">
              {selectedPeriod || newPeriod
                ? 'Upload files to begin reconciliation'
                : 'Select or create a period to get started'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 z-10 bg-white shadow-sm">
              <tr className="border-b-2 border-gray-200 bg-white">
                <th
                  className="py-3 pl-8 pr-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '100px' }}
                  onClick={() => handleSort('opp_number')}
                >
                  <div className="flex items-center gap-1">
                    Opp #
                    {sortColumn === 'opp_number' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '200px' }}
                  onClick={() => handleSort('account_name')}
                >
                  <div className="flex items-center gap-1">
                    Account
                    {sortColumn === 'account_name' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '140px' }}
                  onClick={() => handleSort('ae_name')}
                >
                  <div className="flex items-center gap-1">
                    AE
                    {sortColumn === 'ae_name' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '105px' }}
                  onClick={() => handleSort('tableau_close_date')}
                >
                  <div className="flex items-center gap-1">
                    Close Date - Tableau
                    {sortColumn === 'tableau_close_date' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '105px' }}
                  onClick={() => handleSort('xactly_close_date')}
                >
                  <div className="flex items-center gap-1">
                    Close Date - Xactly
                    {sortColumn === 'xactly_close_date' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '100px' }}
                  onClick={() => handleSort('issue_type')}
                >
                  <div className="flex items-center gap-1">
                    Issue Type
                    {sortColumn === 'issue_type' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="py-3 px-2 font-semibold text-gray-700" style={{ width: '80px' }}>
                  Product
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 text-right cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '110px' }}
                  onClick={() => handleSort('tableau_amount')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Tableau ARR
                    {sortColumn === 'tableau_amount' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 text-right cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '110px' }}
                  onClick={() => handleSort('xactly_amount')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Xactly ARR
                    {sortColumn === 'xactly_amount' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-semibold text-gray-700 text-right cursor-pointer hover:bg-gray-50 select-none"
                  style={{ width: '100px' }}
                  onClick={() => handleSort('variance')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Variance
                    {sortColumn === 'variance' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="py-3 pl-2 pr-8 font-semibold text-gray-700" style={{ width: '200px' }}>
                  Investigation
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pl-8 pr-2 text-gray-900" style={{ width: '100px' }}>{row.opportunity_number}</td>
                  <td className="py-2 px-2 text-gray-700" style={{ width: '200px', maxWidth: '200px' }}>
                    <div className="flex items-center gap-1">
                      <span className="truncate" title={row.account_name}>{row.account_name}</span>
                      {row.crm_opportunity_id && (
                        <button
                          onClick={() => window.api.openExternal(`https://zendesk.lightning.force.com/lightning/r/Opportunity/${row.crm_opportunity_id}/view`)}
                          className="text-blue-600 hover:text-blue-800 shrink-0"
                          title="Open in Salesforce"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-gray-700 truncate" style={{ width: '140px', maxWidth: '140px' }} title={row.ae_name}>{row.ae_name}</td>
                  <td className="py-2 px-2 text-gray-700 text-xs" style={{ width: '105px' }}>{row.tableau_close_date || '—'}</td>
                  <td className="py-2 px-2 text-gray-700 text-xs" style={{ width: '105px' }}>{row.xactly_close_date || '—'}</td>
                  <td className="py-2 px-2" style={{ width: '100px' }}>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      row.issue_type === 'missing_in_xactly'
                        ? 'bg-red-100 text-red-700'
                        : row.issue_type === 'arr_mismatch'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {row.issue_type === 'missing_in_xactly' ? 'Missing' : row.issue_type === 'arr_mismatch' ? 'Mismatch' : 'Match'}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-700 text-xs font-medium" style={{ width: '80px' }}>
                    <span className={`inline-block px-2 py-0.5 rounded ${
                      row.product_book === 'AI' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {row.product_book}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-gray-900" style={{ width: '110px' }}>{fmtDollar(row.tableau_amount)}</td>
                  <td className="py-2 px-2 text-right text-gray-900" style={{ width: '110px' }}>{fmtDollar(row.xactly_amount)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${
                    (row.variance || 0) < 0 ? 'text-red-600' : 'text-gray-900'
                  }`} style={{ width: '100px' }}>
                    {row.variance !== null ? fmtDollar(row.variance) : '-'}
                  </td>
                  <td className="py-2 pl-2 pr-8" style={{ width: '200px' }}>
                    <select
                      value={row.investigation_status || ''}
                      onChange={(e) => handleInvestigationChange(row.opportunity_number, e.target.value)}
                      className="w-full px-2 py-1 text-xs rounded border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-green-400"
                    >
                      <option value="">Not Investigated</option>
                      <option value="Send to Commish Team">Send to Commish Team</option>
                      <option value="Xactly Correct - Renewal">Xactly Correct - Renewal</option>
                      <option value="Xactly Correct - OTD">Xactly Correct - OTD</option>
                      <option value="Xactly Correct - Other">Xactly Correct - Other</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
