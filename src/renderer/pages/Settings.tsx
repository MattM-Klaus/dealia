import React, { useEffect, useState } from 'react';
import type { AppSettings, ForecastOpp, Quota } from '../../shared/types';

type QuotaDraft = { region: string; quota: string; q1: string; q2: string; q3: string; q4: string };

function emptyDraft(): QuotaDraft {
  return { region: '', quota: '', q1: '', q2: '', q3: '', q4: '' };
}

function parseAmount(s: string): number {
  const clean = s.replace(/[$,\s]/g, '');
  return parseFloat(clean) || 0;
}

function parseDraft(d: QuotaDraft) {
  return {
    region:    d.region.trim(),
    quota:     parseAmount(d.quota),
    q1_target: parseAmount(d.q1),
    q2_target: parseAmount(d.q2),
    q3_target: parseAmount(d.q3),
    q4_target: parseAmount(d.q4),
  };
}

function fmtQuota(val: number): string {
  if (!val) return '—';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toLocaleString()}`;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    slack_webhook_url: '',
    notification_enabled: true,
    anthropic_api_key: '',
    tableau_pat_name: '',
    tableau_pat_secret: '',
    tableau_site: 'zendesktableau',
    tableau_view_id: '',
    tableau_filters: {
      product_group: [],
      segments: [],
      close_quarter: [],
      commissionable: [],
      ai_ae: [],
      svp_leader: [],
      svp_minus_1: [],
      vp_team: [],
    },
    my_ai_ae_team: [],
  });
  const [saved, setSaved] = useState(false);
  const [testingMac, setTestingMac] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackResult, setSlackResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [checkResult, setCheckResult] = useState<{ sent: number } | null>(null);
  const [testingTableau, setTestingTableau] = useState(false);
  const [tableauTestResult, setTableauTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Quotas
  const [quotas, setQuotas]           = useState<Quota[]>([]);
  const [aiAeSuggestions, setAiAeSuggestions] = useState<string[]>([]);
  const [addingQuota, setAddingQuota]   = useState(false);
  const [newAiAe, setNewAiAe]           = useState('');
  const [addDraft, setAddDraft]         = useState(emptyDraft());
  const [editingQuota, setEditingQuota] = useState<string | null>(null);
  const [editDraft, setEditDraft]       = useState(emptyDraft());

  // Data Reset Tools
  const [resettingAisArr, setResettingAisArr] = useState(false);
  const [resetResult, setResetResult] = useState<{ updated: number } | null>(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.getQuotas().then(setQuotas);
    // Load AI AE names from forecast opps as suggestions
    window.api.getForecastOpps().then((opps: ForecastOpp[]) => {
      const names = [...new Set(opps.map((o) => o.ai_ae).filter(Boolean))].sort();
      setAiAeSuggestions(names);
    });
  }, []);

  async function handleAddQuota() {
    const name = newAiAe.trim();
    const data = parseDraft(addDraft);
    if (!name || isNaN(data.quota) || data.quota < 0) return;
    await window.api.upsertQuota(name, data);
    setQuotas(await window.api.getQuotas());
    setNewAiAe('');
    setAddDraft(emptyDraft());
    setAddingQuota(false);
  }

  async function handleSaveEdit(ai_ae: string) {
    const data = parseDraft(editDraft);
    if (!isNaN(data.quota) && data.quota >= 0) {
      await window.api.upsertQuota(ai_ae, data);
      setQuotas(await window.api.getQuotas());
    }
    setEditingQuota(null);
  }

  async function handleDeleteQuota(ai_ae: string) {
    await window.api.deleteQuota(ai_ae);
    setQuotas((prev) => prev.filter((q) => q.ai_ae !== ai_ae));
  }

  function startEdit(q: Quota) {
    setEditingQuota(q.ai_ae);
    setEditDraft({
      region: q.region ?? '',
      quota: q.quota      > 0 ? String(q.quota)      : '',
      q1:    q.q1_target  > 0 ? String(q.q1_target)  : '',
      q2:    q.q2_target  > 0 ? String(q.q2_target)  : '',
      q3:    q.q3_target  > 0 ? String(q.q3_target)  : '',
      q4:    q.q4_target  > 0 ? String(q.q4_target)  : '',
    });
  }

  // AI AEs not yet in quotas
  const unsetAiAes = aiAeSuggestions.filter((name) => !quotas.find((q) => q.ai_ae === name));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await window.api.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestMac() {
    setTestingMac(true);
    await window.api.testMacNotification();
    setTestingMac(false);
  }

  async function handleTestSlack() {
    setTestingSlack(true);
    setSlackResult(null);
    const result = await window.api.testSlackWebhook();
    setSlackResult(result);
    setTestingSlack(false);
  }

  async function handleRunCheck() {
    setRunning(true);
    setCheckResult(null);
    const result = await window.api.runRenewalCheck();
    setCheckResult(result);
    setRunning(false);
  }

  async function handleTestTableau() {
    // Save settings first
    await window.api.saveSettings(settings);

    setTestingTableau(true);
    setTableauTestResult(null);

    const result = await window.api.syncFromTableau();

    if (result.success) {
      const inserted = result.inserted || 0;
      const updated = result.updated || 0;
      setTableauTestResult({
        success: true,
        message: `✓ Connection successful! Found ${inserted + updated} opportunities.`
      });
    } else {
      setTableauTestResult({
        success: false,
        message: result.error || 'Connection failed. Check terminal console for details.'
      });
    }

    setTestingTableau(false);
  }

  async function handleResetAisArr() {
    const confirmed = confirm(
      '⚠️ Reset All AIS ARR to Tableau ARR?\n\n' +
      'This will:\n' +
      '• Set all AIS ARR values to match the Tableau Pipeline ARR column\n' +
      '• Clear all manual AIS ARR edits (yellow highlights will disappear)\n' +
      '• Cannot be undone\n\n' +
      'Your AIS Forecast and AIS Close Date edits will NOT be affected.\n\n' +
      'Continue?'
    );

    if (!confirmed) return;

    setResettingAisArr(true);
    setResetResult(null);

    const result = await window.api.resetAisArrToTableau();
    setResetResult(result);

    setResettingAisArr(false);
  }

  return (
    <div className="flex-1 overflow-auto p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Configure renewal notifications</p>
      </div>

      {/* General */}
      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 px-6 py-5 flex flex-col gap-5 mb-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="notify-enabled"
            checked={settings.notification_enabled}
            onChange={(e) => setSettings((s) => ({ ...s, notification_enabled: e.target.checked }))}
            className="accent-green-600 w-4 h-4"
          />
          <label htmlFor="notify-enabled" className="text-sm text-gray-700">
            Enable renewal notifications
          </label>
        </div>
        <div className="flex gap-3 items-center">
          <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">
            Save Settings
          </button>
          {saved && <span className="text-xs text-green-600">✓ Saved</span>}
        </div>
      </form>

      {/* macOS notifications */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 flex flex-col gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-0.5">macOS Notifications</h3>
          <p className="text-xs text-gray-400 mb-3">
            Renewal alerts will appear as native Mac notifications. No setup required — click below to test.
          </p>
          <button
            onClick={handleTestMac}
            disabled={testingMac}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-40"
          >
            {testingMac ? 'Sending…' : 'Send Test Notification'}
          </button>
          <p className="text-xs text-gray-400 mt-2">
            If you don't see it, check <span className="font-medium text-gray-600">System Settings → Notifications → Deal Tracker</span> and make sure notifications are allowed.
          </p>
        </div>
      </div>

      {/* Slack (optional) */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 flex flex-col gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-0.5">Slack <span className="text-xs font-normal text-gray-400 ml-1">optional</span></h3>
          <p className="text-xs text-gray-400 mb-3">
            If you get Slack access, paste your webhook URL here and alerts will also be sent to Slack.
          </p>
          <input
            type="url"
            placeholder="https://hooks.slack.com/services/…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-400 mb-3"
            value={settings.slack_webhook_url}
            onChange={(e) => setSettings((s) => ({ ...s, slack_webhook_url: e.target.value }))}
          />
          <div className="flex gap-3 items-center">
            <button
              onClick={handleSave as React.MouseEventHandler}
              className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
            >
              Save
            </button>
            <button
              onClick={handleTestSlack}
              disabled={testingSlack || !settings.slack_webhook_url}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-40"
            >
              {testingSlack ? 'Sending…' : 'Test Slack'}
            </button>
          </div>
          {slackResult && (
            <p className={`text-xs mt-2 ${slackResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {slackResult.ok ? '✓ Slack message sent' : `✗ ${slackResult.error}`}
            </p>
          )}
        </div>
      </div>

      {/* Run check */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Run Renewal Check Now</h3>
        <p className="text-xs text-gray-400 mb-3">
          Manually trigger the check. Any accounts within 90 days that haven't been notified yet will fire immediately.
        </p>
        <button
          onClick={handleRunCheck}
          disabled={running}
          className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-40"
        >
          {running ? 'Running…' : 'Run Check Now'}
        </button>
        {checkResult !== null && (
          <p className="text-xs mt-2 text-gray-600">
            {checkResult.sent === 0
              ? 'No new notifications to send.'
              : `✓ Sent ${checkResult.sent} notification${checkResult.sent !== 1 ? 's' : ''}.`}
          </p>
        )}
      </div>

      {/* AI Assistant */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">AI Assistant (Dealia)</h3>
        <p className="text-xs text-gray-400 mb-4">Used for the "Talk to Dealia" chat in Analytics. Get your API key from console.anthropic.com.</p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Anthropic API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={settings.anthropic_api_key}
              onChange={(e) => setSettings((s) => ({ ...s, anthropic_api_key: e.target.value }))}
              placeholder="sk-ant-api03-…"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 font-mono"
            />
            <button
              onClick={handleSave as any}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Save
            </button>
          </div>
          {settings.anthropic_api_key && (
            <p className="text-xs text-green-600 mt-1">✓ API key configured</p>
          )}
        </div>
      </div>

      {/* Snowflake Sync - AI AE Team Filter */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Snowflake Sync Filter</h3>
        <p className="text-xs text-gray-400 mb-4">
          Specify which AI AEs to include when syncing from Snowflake. Only deals assigned to these AI AEs will be imported.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">My AI AE Team (comma-separated)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.my_ai_ae_team.join(', ')}
              onChange={(e) => setSettings((s) => ({
                ...s,
                my_ai_ae_team: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
              }))}
              placeholder="e.g. John Smith, Jane Doe, Bob Johnson"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400"
            />
            <button
              onClick={handleSave as any}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Save
            </button>
          </div>
          {settings.my_ai_ae_team.length > 0 && (
            <p className="text-xs text-green-600 mt-1">✓ Filtering for {settings.my_ai_ae_team.length} AI AE{settings.my_ai_ae_team.length !== 1 ? 's' : ''}</p>
          )}
        </div>
      </div>

      {/* Data Reset Tools */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Data Reset Tools</h3>
        <p className="text-xs text-gray-400 mb-4">
          Bulk operations to fix data issues. Use with caution — these actions cannot be undone.
        </p>

        <div className="border border-orange-200 bg-orange-50/30 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-1">Reset All AIS ARR to Tableau ARR</h4>
          <p className="text-xs text-gray-500 mb-3">
            If your AIS ARR values are incorrect (e.g., after a bad Snowflake sync), this will reset all AIS ARR values
            to match the Tableau Pipeline ARR column. This clears all manual AIS ARR edits and removes yellow highlighting.
            Your AIS Forecast and AIS Close Date edits will NOT be affected.
          </p>
          <button
            onClick={handleResetAisArr}
            disabled={resettingAisArr}
            className="px-4 py-2 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40 transition-colors"
          >
            {resettingAisArr ? 'Resetting...' : 'Reset All AIS ARR'}
          </button>
          {resetResult && (
            <p className="text-xs text-green-600 mt-2">
              ✓ Reset complete! Updated {resetResult.updated} deal{resetResult.updated !== 1 ? 's' : ''}.
            </p>
          )}
        </div>
      </div>

      {/* Quotas */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-700">AI AE Quotas</h3>
          {!addingQuota && (
            <button
              onClick={() => setAddingQuota(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
            >
              + Add
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">Set annual and quarterly targets per AI AE — used in Analytics attainment reporting.</p>

        {/* Existing quotas table */}
        {quotas.length > 0 && (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 font-medium">
                <th className="text-left pb-2">AI AE</th>
                <th className="text-left pb-2 pl-2">Region</th>
                <th className="text-right pb-2">Annual</th>
                <th className="text-right pb-2">Q1</th>
                <th className="text-right pb-2">Q2</th>
                <th className="text-right pb-2">Q3</th>
                <th className="text-right pb-2">Q4</th>
                <th className="w-20 pb-2" />
              </tr>
            </thead>
            <tbody>
              {quotas.map((q) => (
                editingQuota === q.ai_ae ? (
                  <tr key={q.ai_ae} className="border-b border-gray-100 bg-green-50/30">
                    <td className="py-2 font-medium text-gray-800">{q.ai_ae}</td>
                    <td className="py-2 pl-2">
                      <input
                        type="text"
                        value={editDraft.region}
                        onChange={(e) => setEditDraft((d) => ({ ...d, region: e.target.value }))}
                        placeholder="e.g. NA"
                        className="w-full border border-green-300 rounded px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-green-400"
                      />
                    </td>
                    {(['quota', 'q1', 'q2', 'q3', 'q4'] as const).map((field) => (
                      <td key={field} className="py-2 pl-2">
                        <input
                          type="text"
                          value={editDraft[field]}
                          onChange={(e) => setEditDraft((d) => ({ ...d, [field]: e.target.value }))}
                          placeholder="—"
                          className="w-full text-right border border-green-300 rounded px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-green-400"
                        />
                      </td>
                    ))}
                    <td className="py-2 pl-2">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => handleSaveEdit(q.ai_ae)} className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700">Save</button>
                        <button onClick={() => setEditingQuota(null)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={q.ai_ae} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-2 text-gray-800 font-medium">{q.ai_ae}</td>
                    <td className="py-2 pl-2 text-gray-500 text-xs">{q.region || <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 text-right text-gray-700 font-semibold">{fmtQuota(q.quota)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtQuota(q.q1_target)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtQuota(q.q2_target)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtQuota(q.q3_target)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtQuota(q.q4_target)}</td>
                    <td className="py-2">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => startEdit(q)} className="text-xs text-gray-400 hover:text-green-700 transition-colors">Edit</button>
                        <button onClick={() => handleDeleteQuota(q.ai_ae)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">✕</button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}

        {/* AI AEs from forecast without a quota yet */}
        {unsetAiAes.length > 0 && !addingQuota && (
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-1.5">AI AEs in pipeline without a quota:</p>
            <div className="flex flex-wrap gap-1.5">
              {unsetAiAes.map((name) => (
                <button
                  key={name}
                  onClick={() => { setNewAiAe(name); setAddingQuota(true); }}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-green-400 hover:text-green-700 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add quota form */}
        {addingQuota && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-600 mb-3">New AI AE Quota</p>
            <div className="flex gap-2 items-center mb-3">
              <input
                type="text"
                placeholder="AI AE name"
                value={newAiAe}
                onChange={(e) => setNewAiAe(e.target.value)}
                list="ai-ae-suggestions"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-400 bg-white"
              />
              <datalist id="ai-ae-suggestions">
                {unsetAiAes.map((n) => <option key={n} value={n} />)}
              </datalist>
              <input
                type="text"
                placeholder="Region (e.g. NA)"
                value={addDraft.region}
                onChange={(e) => setAddDraft((d) => ({ ...d, region: e.target.value }))}
                className="w-32 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-400 bg-white"
              />
            </div>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {(['quota', 'q1', 'q2', 'q3', 'q4'] as const).map((field) => (
                <div key={field}>
                  <label className="text-xs text-gray-400 block mb-1">{field === 'quota' ? 'Annual' : field.toUpperCase()}</label>
                  <input
                    type="text"
                    placeholder="—"
                    value={addDraft[field]}
                    onChange={(e) => setAddDraft((d) => ({ ...d, [field]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddQuota(); }}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-400 bg-white text-right"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddQuota} className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">Save</button>
              <button onClick={() => { setAddingQuota(false); setNewAiAe(''); setAddDraft(emptyDraft()); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {quotas.length === 0 && !addingQuota && (
          <p className="text-xs text-gray-400 italic">No quotas set yet.</p>
        )}
      </div>
    </div>
  );
}
