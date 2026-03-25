import React, { useEffect, useState } from 'react';
import type { NotificationLogEntry, ImportHistoryEntry } from '../../shared/types';

const TYPE_LABEL: Record<string, string> = {
  '3_month_warning': '3-month warning',
};

const SOURCE_LABEL: Record<string, string> = {
  'csv_upload': 'CSV Upload',
  'tableau_sync': 'Tableau Sync',
};

function fmtCurrency(val: number): string {
  return '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDateTime(raw: string): string {
  // SQLite datetime is UTC: "2026-02-26 15:45:30"
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function History() {
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [imports, setImports] = useState<ImportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Historical Import state
  const [snapshots, setSnapshots] = useState<Array<{ imported_at: string; total_pipeline: number; opp_count: number; total_bookings?: number; deal_count?: number; has_pipeline: boolean; has_closed_won: boolean }>>([]);
  const [historicalDate, setHistoricalDate] = useState('');
  const [historicalFile, setHistoricalFile] = useState<string | null>(null);
  const [historicalType, setHistoricalType] = useState<'pipeline' | 'closed_won'>('pipeline');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    Promise.all([
      window.api.getNotificationLog(),
      window.api.getImportHistory(),
      window.api.getAllSnapshots(),
    ]).then(([logData, importData, snapshotsData]) => {
      setLog(logData);
      setImports(importData);
      setSnapshots(snapshotsData);
      setLoading(false);
    });
  }, []);

  async function handleOpenBackup(filename: string) {
    try {
      await window.api.openBackupCsv(filename);
    } catch (err: any) {
      alert('Failed to open backup: ' + err.message);
    }
  }

  async function handleSelectHistoricalFile() {
    try {
      const result = await window.api.openFileDialog();
      if (result) {
        setHistoricalFile(result);
      }
    } catch (err: any) {
      alert('Failed to select file: ' + err.message);
    }
  }

  async function handleHistoricalImport() {
    if (!historicalFile || !historicalDate) {
      alert('Please select a file and enter a date');
      return;
    }

    setImporting(true);
    try {
      const result = historicalType === 'pipeline'
        ? await window.api.importHistoricalCsv(historicalFile, historicalDate)
        : await window.api.importHistoricalClosedWonCsv(historicalFile, historicalDate);

      const itemType = historicalType === 'pipeline' ? 'opportunities' : 'deals';
      alert(`Historical import complete!\n\n${result.inserted} ${itemType} imported for ${historicalDate}`);

      // Refresh snapshots list
      const snapshotsData = await window.api.getAllSnapshots();
      setSnapshots(snapshotsData);

      // Reset form
      setHistoricalFile(null);
      setHistoricalDate('');
    } catch (err: any) {
      alert('Historical import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteSnapshot(importedAt: string) {
    if (!confirm(`Delete snapshot from ${fmtDateTime(importedAt)}?\n\nThis will remove both pipeline and closed won data for this date. This action cannot be undone.`)) {
      return;
    }

    try {
      await window.api.deleteSnapshot(importedAt);

      // Refresh snapshots list
      const snapshotsData = await window.api.getAllSnapshots();
      setSnapshots(snapshotsData);
    } catch (err: any) {
      alert('Failed to delete snapshot: ' + err.message);
    }
  }

  async function handleSnapshotNow() {
    try {
      const result = await window.api.snapshotCurrentState();
      alert(`Snapshot saved!\n\n${result.pipelineCount} pipeline opportunities\n${result.cwCount} closed won deals`);

      // Refresh snapshots list
      const snapshotsData = await window.api.getAllSnapshots();
      setSnapshots(snapshotsData);
    } catch (err: any) {
      alert('Failed to save snapshot: ' + err.message);
    }
  }

  return (
    <div className="flex-1 overflow-auto p-8">
      {/* Import History */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Import History</h2>
          <p className="text-sm text-gray-400 mt-0.5">CSV backups from pipeline uploads</p>
        </div>

        {loading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : imports.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
            No imports yet.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Source</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Rows</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">New</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Updated</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Total Pipeline</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500">Backup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {imports.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-900 text-xs">{fmtDateTime(entry.imported_at)}</td>
                    <td className="px-5 py-2.5 text-gray-600">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {SOURCE_LABEL[entry.source_type] ?? entry.source_type}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-600">{entry.row_count}</td>
                    <td className="px-5 py-2.5 text-right text-green-600 font-medium">{entry.inserted_count}</td>
                    <td className="px-5 py-2.5 text-right text-blue-600">{entry.updated_count}</td>
                    <td className="px-5 py-2.5 text-right text-gray-900 font-medium">{fmtCurrency(entry.total_pipeline)}</td>
                    <td className="px-5 py-2.5 text-center">
                      <button
                        onClick={() => handleOpenBackup(entry.backup_filename)}
                        className="text-blue-600 hover:text-blue-800 text-xs underline"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historical Import */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Historical Import</h2>
          <p className="text-sm text-gray-400 mt-0.5">Upload old CSV files with custom dates to backfill historical snapshots</p>
        </div>

        {/* Upload form */}
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Import Type</label>
              <select
                value={historicalType}
                onChange={(e) => setHistoricalType(e.target.value as 'pipeline' | 'closed_won')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="pipeline">Pipeline</option>
                <option value="closed_won">Closed Won</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Type of CSV to import</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Snapshot Date</label>
              <input
                type="date"
                value={historicalDate}
                onChange={(e) => setHistoricalDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">The date this CSV snapshot represents</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">CSV File</label>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectHistoricalFile}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                >
                  {historicalFile ? 'Change File' : 'Select File'}
                </button>
              </div>
              {historicalFile && (
                <p className="text-xs text-gray-600 mt-1 truncate" title={historicalFile}>
                  {historicalFile.split('/').pop()}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={handleHistoricalImport}
            disabled={!historicalFile || !historicalDate || importing}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              !historicalFile || !historicalDate || importing
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {importing ? 'Importing...' : 'Import Historical Snapshot'}
          </button>
        </div>

        {/* Existing snapshots list */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Existing Snapshots ({snapshots.length})</h3>
          <button
            onClick={handleSnapshotNow}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            📸 Snapshot Current State
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
            No snapshots yet. Import your first historical CSV above or upload a current pipeline.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Snapshot Date</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Pipeline Opps</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Total Pipeline</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">CW Deals</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Total Bookings</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.imported_at} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-900 font-medium">{fmtDateTime(snapshot.imported_at)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-600">
                      {snapshot.has_pipeline ? snapshot.opp_count : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-900 font-medium">
                      {snapshot.has_pipeline ? fmtCurrency(snapshot.total_pipeline) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-600">
                      {snapshot.has_closed_won ? (snapshot.deal_count ?? 0) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-900 font-medium">
                      {snapshot.has_closed_won ? fmtCurrency(snapshot.total_bookings ?? 0) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <button
                        onClick={() => handleDeleteSnapshot(snapshot.imported_at)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notification History */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Notification History</h2>
        <p className="text-sm text-gray-400 mt-0.5">All renewal alerts that have been sent</p>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : log.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">No notifications sent yet.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Account</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Alert Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Fiscal Year</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {log.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-900 font-medium">{entry.account_name}</td>
                  <td className="px-5 py-2.5 text-gray-500">
                    {TYPE_LABEL[entry.notification_type] ?? entry.notification_type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 py-2.5 text-gray-500">{entry.fiscal_year}</td>
                  <td className="px-5 py-2.5 text-gray-400 text-xs">
                    {new Date(entry.sent_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
