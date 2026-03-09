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

  useEffect(() => {
    Promise.all([
      window.api.getNotificationLog(),
      window.api.getImportHistory(),
    ]).then(([logData, importData]) => {
      setLog(logData);
      setImports(importData);
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
