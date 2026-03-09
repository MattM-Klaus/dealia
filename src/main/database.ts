import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import type { Account, AccountFormData, AppSettings, AisForecast, AnalyticsData, ContactStatus, ForecastChange, ForecastOpp, ClosedWonOpp, NotificationLogEntry, OppPushStats, Product, Quota, TableauFilters, ImportHistoryEntry, ForecastDifference } from '../shared/types';
import { normalizeProduct, mapForecast } from '../shared/utils';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'deals.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runMigrations();
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name    TEXT    NOT NULL,
      arr             REAL    NOT NULL DEFAULT 0,
      num_agents      INTEGER NOT NULL DEFAULT 0,
      renewal_date    TEXT    NOT NULL,
      account_owner   TEXT    NOT NULL DEFAULT '',
      products        TEXT    NOT NULL DEFAULT '[]',
      target_products TEXT    NOT NULL DEFAULT '[]',
      sfdc_link       TEXT    NOT NULL DEFAULT '',
      notes           TEXT    DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      notification_type TEXT    NOT NULL,
      sent_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      fiscal_year       TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forecast_opps (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_opportunity_id          TEXT    NOT NULL,
      sfdc_account_id             TEXT    NOT NULL DEFAULT '',
      account_name                TEXT    NOT NULL DEFAULT '',
      manager_name                TEXT    NOT NULL DEFAULT '',
      ae_name                     TEXT    NOT NULL DEFAULT '',
      region                      TEXT    NOT NULL DEFAULT '',
      segment                     TEXT    NOT NULL DEFAULT '',
      product                     TEXT    NOT NULL DEFAULT '',
      type                        TEXT    NOT NULL DEFAULT '',
      stage_name                  TEXT    NOT NULL DEFAULT '',
      vp_deal_forecast            TEXT    NOT NULL DEFAULT '',
      product_specialist_forecast TEXT    NOT NULL DEFAULT '',
      product_specialist_notes    TEXT    NOT NULL DEFAULT '',
      ai_ae                       TEXT    NOT NULL DEFAULT '',
      close_date                  TEXT    NOT NULL DEFAULT '',
      s2_plus_date                TEXT    NOT NULL DEFAULT '',
      product_arr_usd             REAL    NOT NULL DEFAULT 0,
      ais_forecast                TEXT    DEFAULT NULL,
      ais_arr                     REAL    DEFAULT NULL,
      ais_close_date              TEXT    DEFAULT NULL,
      ais_arr_manual              INTEGER DEFAULT 0,
      ais_forecast_manual         INTEGER DEFAULT 0,
      ais_close_date_manual       INTEGER DEFAULT 0,
      created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(crm_opportunity_id, product)
    );

    CREATE TABLE IF NOT EXISTS closed_won_opps (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_opportunity_id TEXT    NOT NULL,
      account_name       TEXT    NOT NULL DEFAULT '',
      manager_name       TEXT    NOT NULL DEFAULT '',
      ae_name            TEXT    NOT NULL DEFAULT '',
      region             TEXT    NOT NULL DEFAULT '',
      segment            TEXT    NOT NULL DEFAULT '',
      product            TEXT    NOT NULL DEFAULT '',
      type               TEXT    NOT NULL DEFAULT '',
      ai_ae              TEXT    NOT NULL DEFAULT '',
      close_date         TEXT    NOT NULL DEFAULT '',
      bookings           REAL    NOT NULL DEFAULT 0,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(crm_opportunity_id, product)
    );
  `);

  // Migrate forecast_opps / closed_won_opps if they were created with the wrong
  // UNIQUE constraint (single column instead of composite). Since no import has
  // ever succeeded with the old schema, safe to drop and recreate.
  for (const tbl of ['forecast_opps', 'closed_won_opps']) {
    const meta = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
    ).get(tbl) as { sql: string } | undefined;
    if (meta && /TEXT\s+NOT NULL UNIQUE/.test(meta.sql)) {
      db.exec(`DROP TABLE IF EXISTS ${tbl}`);
    }
  }
  // Re-run CREATE TABLE IF NOT EXISTS for the rebuilt tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS forecast_opps (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_opportunity_id          TEXT    NOT NULL,
      sfdc_account_id             TEXT    NOT NULL DEFAULT '',
      account_name                TEXT    NOT NULL DEFAULT '',
      manager_name                TEXT    NOT NULL DEFAULT '',
      ae_name                     TEXT    NOT NULL DEFAULT '',
      region                      TEXT    NOT NULL DEFAULT '',
      segment                     TEXT    NOT NULL DEFAULT '',
      product                     TEXT    NOT NULL DEFAULT '',
      type                        TEXT    NOT NULL DEFAULT '',
      stage_name                  TEXT    NOT NULL DEFAULT '',
      vp_deal_forecast            TEXT    NOT NULL DEFAULT '',
      product_specialist_forecast TEXT    NOT NULL DEFAULT '',
      product_specialist_notes    TEXT    NOT NULL DEFAULT '',
      ai_ae                       TEXT    NOT NULL DEFAULT '',
      close_date                  TEXT    NOT NULL DEFAULT '',
      s2_plus_date                TEXT    NOT NULL DEFAULT '',
      product_arr_usd             REAL    NOT NULL DEFAULT 0,
      ais_forecast                TEXT    DEFAULT NULL,
      ais_arr                     REAL    DEFAULT NULL,
      ais_close_date              TEXT    DEFAULT NULL,
      ais_arr_manual              INTEGER DEFAULT 0,
      ais_forecast_manual         INTEGER DEFAULT 0,
      ais_close_date_manual       INTEGER DEFAULT 0,
      created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(crm_opportunity_id, product)
    );
    CREATE TABLE IF NOT EXISTS closed_won_opps (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_opportunity_id TEXT    NOT NULL,
      account_name       TEXT    NOT NULL DEFAULT '',
      manager_name       TEXT    NOT NULL DEFAULT '',
      ae_name            TEXT    NOT NULL DEFAULT '',
      region             TEXT    NOT NULL DEFAULT '',
      segment            TEXT    NOT NULL DEFAULT '',
      product            TEXT    NOT NULL DEFAULT '',
      type               TEXT    NOT NULL DEFAULT '',
      ai_ae              TEXT    NOT NULL DEFAULT '',
      close_date         TEXT    NOT NULL DEFAULT '',
      bookings           REAL    NOT NULL DEFAULT 0,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(crm_opportunity_id, product)
    );
  `);

  // quotas: per-AI AE quota targets set in Settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS quotas (
      ai_ae      TEXT PRIMARY KEY,
      quota      REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Safe migrations for quarterly targets and region
  for (const col of ['q1_target', 'q2_target', 'q3_target', 'q4_target']) {
    try { db.exec(`ALTER TABLE quotas ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`); } catch {}
  }
  try { db.exec(`ALTER TABLE quotas ADD COLUMN region TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE forecast_opps ADD COLUMN ais_top_deal INTEGER DEFAULT 0`); } catch {}

  // forecast_changes: persists diffs detected on each pipeline CSV upload
  db.exec(`
    CREATE TABLE IF NOT EXISTS forecast_changes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at         TEXT    NOT NULL,
      crm_opportunity_id  TEXT    NOT NULL,
      product             TEXT    NOT NULL DEFAULT '',
      account_name        TEXT    NOT NULL DEFAULT '',
      ae_name             TEXT    NOT NULL DEFAULT '',
      ai_ae               TEXT    NOT NULL DEFAULT '',
      manager_name        TEXT    NOT NULL DEFAULT '',
      change_type         TEXT    NOT NULL,
      old_value           TEXT,
      new_value           TEXT,
      delta_numeric       REAL,
      is_alert            INTEGER NOT NULL DEFAULT 0,
      alert_reason        TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // import_history: tracks CSV uploads and backups
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      source_type      TEXT    NOT NULL DEFAULT 'csv',
      backup_filename  TEXT    NOT NULL,
      row_count        INTEGER NOT NULL DEFAULT 0,
      inserted_count   INTEGER NOT NULL DEFAULT 0,
      updated_count    INTEGER NOT NULL DEFAULT 0,
      total_pipeline   REAL    NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations for existing databases that may not have new columns yet
  for (const col of [
    `ALTER TABLE accounts ADD COLUMN target_products TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE accounts ADD COLUMN sfdc_link TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE accounts ADD COLUMN contact_status TEXT NOT NULL DEFAULT 'needs_action'`,
    `ALTER TABLE accounts ADD COLUMN contacted_at TEXT DEFAULT NULL`,
    `ALTER TABLE accounts ADD COLUMN ae_manager TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE accounts ADD COLUMN crm_account_id TEXT DEFAULT NULL`,
    // Pipeline change-tracking columns
    `ALTER TABLE forecast_opps ADD COLUMN push_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE forecast_opps ADD COLUMN total_days_pushed INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE forecast_opps ADD COLUMN stage_entered_at TEXT`,
    // AIS manual-edit flags
    `ALTER TABLE forecast_opps ADD COLUMN ais_arr_manual INTEGER DEFAULT 0`,
    `ALTER TABLE forecast_opps ADD COLUMN ais_forecast_manual INTEGER DEFAULT 0`,
    `ALTER TABLE forecast_opps ADD COLUMN ais_close_date_manual INTEGER DEFAULT 0`,
  ]) {
    try { db.exec(col); } catch { /* column already exists */ }
  }
}

function deserializeAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as number,
    crm_account_id: (row.crm_account_id as string) || null,
    account_name: row.account_name as string,
    arr: row.arr as number,
    num_agents: row.num_agents as number,
    renewal_date: row.renewal_date as string,
    account_owner: row.account_owner as string,
    // DB column is still named "products" — mapped to current_products in the app
    current_products: JSON.parse((row.products as string) || '[]') as Product[],
    target_products: JSON.parse((row.target_products as string) || '[]') as Product[],
    sfdc_link: (row.sfdc_link as string) || '',
    ae_manager: (row.ae_manager as string) || '',
    contact_status: ((row.contact_status as string) || 'needs_action') as ContactStatus,
    contacted_at: (row.contacted_at as string) || null,
    notes: (row.notes as string) || '',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getAllAccounts(): Account[] {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY renewal_date ASC').all();
  return rows.map((r) => deserializeAccount(r as Record<string, unknown>));
}

export function getAccountById(id: number): Account | null {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  return row ? deserializeAccount(row as Record<string, unknown>) : null;
}

export function insertAccount(data: AccountFormData): number {
  const result = db.prepare(`
    INSERT INTO accounts (account_name, arr, num_agents, renewal_date, account_owner, products, target_products, sfdc_link, ae_manager, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.account_name,
    data.arr,
    data.num_agents,
    data.renewal_date,
    data.account_owner,
    JSON.stringify(data.current_products),
    JSON.stringify(data.target_products),
    data.sfdc_link,
    data.ae_manager,
    data.notes,
  );
  return result.lastInsertRowid as number;
}

export function updateAccount(id: number, data: AccountFormData): void {
  db.prepare(`
    UPDATE accounts
    SET account_name = ?, arr = ?, num_agents = ?, renewal_date = ?,
        account_owner = ?, products = ?, target_products = ?, sfdc_link = ?,
        ae_manager = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.account_name,
    data.arr,
    data.num_agents,
    data.renewal_date,
    data.account_owner,
    JSON.stringify(data.current_products),
    JSON.stringify(data.target_products),
    data.sfdc_link,
    data.ae_manager,
    data.notes,
    id,
  );
}

// Upsert by crm_account_id (for CSV re-import). Falls back to insert if no crm_account_id or not found.
// Does NOT overwrite contact_status or contacted_at — those are user-managed.
export function upsertAccount(data: AccountFormData & { crm_account_id?: string | null }): { id: number; updated: boolean } {
  if (data.crm_account_id) {
    const existing = db.prepare('SELECT id FROM accounts WHERE crm_account_id = ?').get(data.crm_account_id) as { id: number } | undefined;
    if (existing) {
      db.prepare(`
        UPDATE accounts
        SET account_name = ?, arr = ?, num_agents = ?, renewal_date = ?,
            account_owner = ?, products = ?, target_products = ?, sfdc_link = ?,
            ae_manager = ?, notes = ?, updated_at = datetime('now')
        WHERE crm_account_id = ?
      `).run(
        data.account_name, data.arr, data.num_agents, data.renewal_date,
        data.account_owner, JSON.stringify(data.current_products), JSON.stringify(data.target_products),
        data.sfdc_link, data.ae_manager, data.notes, data.crm_account_id,
      );
      return { id: existing.id, updated: true };
    }
  }
  const result = db.prepare(`
    INSERT INTO accounts (account_name, arr, num_agents, renewal_date, account_owner, products, target_products, sfdc_link, ae_manager, notes, crm_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.account_name, data.arr, data.num_agents, data.renewal_date,
    data.account_owner, JSON.stringify(data.current_products), JSON.stringify(data.target_products),
    data.sfdc_link, data.ae_manager, data.notes, data.crm_account_id || null,
  );
  return { id: result.lastInsertRowid as number, updated: false };
}

export function deleteAccount(id: number): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function setContactStatus(id: number, status: ContactStatus): void {
  db.prepare(`
    UPDATE accounts
    SET contact_status = ?, contacted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(status, id);
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getSettings(): AppSettings {
  const tableauFiltersJson = getSetting('tableau_filters') || '{"product_group":[],"segments":[],"close_quarter":[],"commissionable":[],"ai_ae":[],"svp_leader":[],"svp_minus_1":[],"vp_team":[]}';

  return {
    slack_webhook_url: getSetting('slack_webhook_url') || '',
    notification_enabled: getSetting('notification_enabled') !== 'false',
    anthropic_api_key: getSetting('anthropic_api_key') || '',
    tableau_pat_name: getSetting('tableau_pat_name') || '',
    tableau_pat_secret: getSetting('tableau_pat_secret') || '',
    tableau_site: getSetting('tableau_site') || 'zendesktableau',
    tableau_view_id: getSetting('tableau_view_id') || '',
    tableau_filters: JSON.parse(tableauFiltersJson),
  };
}

export function saveSettings(settings: Partial<AppSettings>): void {
  if (settings.slack_webhook_url !== undefined) {
    setSetting('slack_webhook_url', settings.slack_webhook_url);
  }
  if (settings.notification_enabled !== undefined) {
    setSetting('notification_enabled', String(settings.notification_enabled));
  }
  if (settings.anthropic_api_key !== undefined) {
    setSetting('anthropic_api_key', settings.anthropic_api_key);
  }
  if (settings.tableau_pat_name !== undefined) {
    setSetting('tableau_pat_name', settings.tableau_pat_name);
  }
  if (settings.tableau_pat_secret !== undefined) {
    setSetting('tableau_pat_secret', settings.tableau_pat_secret);
  }
  if (settings.tableau_site !== undefined) {
    setSetting('tableau_site', settings.tableau_site);
  }
  if (settings.tableau_view_id !== undefined) {
    setSetting('tableau_view_id', settings.tableau_view_id);
  }
  if (settings.tableau_filters !== undefined) {
    setSetting('tableau_filters', JSON.stringify(settings.tableau_filters));
  }
}

export function hasNotificationBeenSent(
  accountId: number,
  notificationType: string,
  fiscalYear: string,
): boolean {
  const row = db.prepare(`
    SELECT id FROM notification_log
    WHERE account_id = ? AND notification_type = ? AND fiscal_year = ?
  `).get(accountId, notificationType, fiscalYear);
  return !!row;
}

export function logNotification(
  accountId: number,
  notificationType: string,
  fiscalYear: string,
): void {
  db.prepare(`
    INSERT INTO notification_log (account_id, notification_type, fiscal_year)
    VALUES (?, ?, ?)
  `).run(accountId, notificationType, fiscalYear);
}

export function getNotificationLog(): NotificationLogEntry[] {
  const rows = db.prepare(`
    SELECT nl.id, nl.account_id,
           COALESCE(a.account_name, 'Deleted Account') AS account_name,
           nl.notification_type, nl.sent_at, nl.fiscal_year
    FROM notification_log nl
    LEFT JOIN accounts a ON nl.account_id = a.id
    ORDER BY nl.sent_at DESC
  `).all();
  return rows as NotificationLogEntry[];
}

// ── Forecast Opps ──────────────────────────────────────────────

function deserializeForecastOpp(row: Record<string, unknown>): ForecastOpp {
  return {
    id: row.id as number,
    crm_opportunity_id: row.crm_opportunity_id as string,
    sfdc_account_id: (row.sfdc_account_id as string) || '',
    account_name: (row.account_name as string) || '',
    manager_name: (row.manager_name as string) || '',
    ae_name: (row.ae_name as string) || '',
    region: (row.region as string) || '',
    segment: (row.segment as string) || '',
    product: normalizeProduct((row.product as string) || ''),
    type: (row.type as string) || '',
    stage_name: (row.stage_name as string) || '',
    vp_deal_forecast: (row.vp_deal_forecast as string) || '',
    product_specialist_forecast: (row.product_specialist_forecast as string) || '',
    product_specialist_notes: (row.product_specialist_notes as string) || '',
    ai_ae: (row.ai_ae as string) || '',
    close_date: (row.close_date as string) || '',
    s2_plus_date: (row.s2_plus_date as string) || '',
    product_arr_usd: (row.product_arr_usd as number) || 0,
    ais_forecast: (row.ais_forecast as AisForecast) || null,
    ais_arr: row.ais_arr != null ? (row.ais_arr as number) : null,
    ais_close_date: (row.ais_close_date as string) || null,
    ais_arr_manual: (row.ais_arr_manual as number) ?? 0,
    ais_forecast_manual: (row.ais_forecast_manual as number) ?? 0,
    ais_close_date_manual: (row.ais_close_date_manual as number) ?? 0,
    ais_top_deal: (row.ais_top_deal as number) ?? 0,
    push_count: (row.push_count as number) ?? 0,
    total_days_pushed: (row.total_days_pushed as number) ?? 0,
    stage_entered_at: (row.stage_entered_at as string) || null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getForecastOpps(): ForecastOpp[] {
  const rows = db.prepare('SELECT * FROM forecast_opps ORDER BY close_date ASC').all();
  return rows.map((r) => deserializeForecastOpp(r as Record<string, unknown>));
}

// Returns a map of "crm_opportunity_id::product" -> { ais_forecast, ais_arr, ais_close_date }
// Used to preserve AIS values during a full pipeline re-import (keyed by composite to
// handle multi-product opps where same opp ID appears once per product)
export function getAisValues(): Map<string, { ais_forecast: string | null; ais_arr: number | null; ais_close_date: string | null; ais_arr_manual: number; ais_forecast_manual: number; ais_close_date_manual: number; ais_top_deal: number }> {
  const rows = db.prepare('SELECT crm_opportunity_id, product, ais_forecast, ais_arr, ais_close_date, ais_arr_manual, ais_forecast_manual, ais_close_date_manual, ais_top_deal FROM forecast_opps').all() as Array<{
    crm_opportunity_id: string;
    product: string;
    ais_forecast: string | null;
    ais_arr: number | null;
    ais_close_date: string | null;
    ais_arr_manual: number;
    ais_forecast_manual: number;
    ais_close_date_manual: number;
    ais_top_deal: number;
  }>;
  const map = new Map<string, { ais_forecast: string | null; ais_arr: number | null; ais_close_date: string | null; ais_arr_manual: number; ais_forecast_manual: number; ais_close_date_manual: number; ais_top_deal: number }>();
  for (const row of rows) {
    map.set(`${row.crm_opportunity_id}::${normalizeProduct(row.product)}`, {
      ais_forecast: row.ais_forecast,
      ais_arr: row.ais_arr,
      ais_close_date: row.ais_close_date,
      ais_arr_manual: row.ais_arr_manual ?? 0,
      ais_forecast_manual: row.ais_forecast_manual ?? 0,
      ais_close_date_manual: row.ais_close_date_manual ?? 0,
      ais_top_deal: row.ais_top_deal ?? 0,
    });
  }
  return map;
}

type ForecastOppInput = Omit<ForecastOpp, 'id' | 'created_at' | 'updated_at'> & {
  push_count?: number;
  total_days_pushed?: number;
  stage_entered_at?: string | null;
};

export function replaceForecastOpps(
  opps: ForecastOppInput[],
): { inserted: number; updated: number } {
  const insert = db.prepare(`
    INSERT INTO forecast_opps (
      crm_opportunity_id, sfdc_account_id, account_name, manager_name, ae_name,
      region, segment, product, type, stage_name, vp_deal_forecast,
      product_specialist_forecast, product_specialist_notes, ai_ae,
      close_date, s2_plus_date, product_arr_usd,
      ais_forecast, ais_arr, ais_close_date,
      ais_arr_manual, ais_forecast_manual, ais_close_date_manual, ais_top_deal,
      push_count, total_days_pushed, stage_entered_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const deleteAll = db.prepare('DELETE FROM forecast_opps');

  let inserted = 0;
  let updated = 0;

  const run = db.transaction(() => {
    // Track which keys existed before so we can count inserts vs updates
    const existingKeys = new Set(
      (db.prepare('SELECT crm_opportunity_id || \'::\'|| product AS k FROM forecast_opps').all() as { k: string }[]).map((r) => r.k),
    );
    deleteAll.run();
    for (const opp of opps) {
      insert.run(
        opp.crm_opportunity_id,
        opp.sfdc_account_id,
        opp.account_name,
        opp.manager_name,
        opp.ae_name,
        opp.region,
        opp.segment,
        opp.product,
        opp.type,
        opp.stage_name,
        opp.vp_deal_forecast,
        opp.product_specialist_forecast,
        opp.product_specialist_notes,
        opp.ai_ae,
        opp.close_date,
        opp.s2_plus_date,
        opp.product_arr_usd,
        opp.ais_forecast,
        opp.ais_arr,
        opp.ais_close_date,
        opp.ais_arr_manual ?? 0,
        opp.ais_forecast_manual ?? 0,
        opp.ais_close_date_manual ?? 0,
        opp.ais_top_deal ?? 0,
        opp.push_count ?? 0,
        opp.total_days_pushed ?? 0,
        opp.stage_entered_at ?? null,
      );
      if (existingKeys.has(`${opp.crm_opportunity_id}::${opp.product}`)) updated++;
      else inserted++;
    }
  });

  run();
  return { inserted, updated };
}

export function updateForecastAis(
  id: number,
  fields: { ais_forecast?: AisForecast | null; ais_arr?: number | null; ais_close_date?: string | null },
): void {
  db.prepare(`
    UPDATE forecast_opps
    SET ais_forecast = COALESCE(?, ais_forecast),
        ais_arr = ?,
        ais_close_date = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    fields.ais_forecast !== undefined ? fields.ais_forecast : null,
    fields.ais_arr !== undefined ? fields.ais_arr : null,
    fields.ais_close_date !== undefined ? fields.ais_close_date : null,
    id,
  );
}

export function updateForecastAisField(
  id: number,
  field: 'ais_forecast' | 'ais_arr' | 'ais_close_date',
  value: string | number | null,
): void {
  db.prepare(`UPDATE forecast_opps SET ${field} = ?, ${field}_manual = ?, updated_at = datetime('now') WHERE id = ?`).run(value, value !== null ? 1 : 0, id);
}

export function setForecastTopDeal(id: number, value: number): void {
  db.prepare(`UPDATE forecast_opps SET ais_top_deal = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
}

// Returns a snapshot of all existing pipeline opps for diff comparison before re-import
export function getExistingOppsForDiff(): Map<string, {
  crm_opportunity_id: string;
  product: string;
  account_name: string;
  ae_name: string;
  ai_ae: string;
  manager_name: string;
  product_arr_usd: number;
  close_date: string;
  stage_name: string;
  vp_deal_forecast: string;
  ais_forecast: string | null;
  push_count: number;
  total_days_pushed: number;
  stage_entered_at: string | null;
}> {
  const rows = db.prepare(`
    SELECT crm_opportunity_id, product, account_name, ae_name, ai_ae, manager_name,
           product_arr_usd, close_date, stage_name, vp_deal_forecast, ais_forecast,
           COALESCE(push_count, 0) AS push_count,
           COALESCE(total_days_pushed, 0) AS total_days_pushed,
           stage_entered_at
    FROM forecast_opps
  `).all() as Array<{
    crm_opportunity_id: string; product: string; account_name: string;
    ae_name: string; ai_ae: string; manager_name: string;
    product_arr_usd: number; close_date: string; stage_name: string;
    vp_deal_forecast: string; ais_forecast: string | null;
    push_count: number; total_days_pushed: number;
    stage_entered_at: string | null;
  }>;
  const map = new Map<string, typeof rows[number]>();
  for (const row of rows) map.set(`${row.crm_opportunity_id}::${normalizeProduct(row.product)}`, row);
  return map;
}

export function insertForecastChanges(changes: Omit<ForecastChange, 'id' | 'created_at'>[]): void {
  if (changes.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO forecast_changes (
      imported_at, crm_opportunity_id, product, account_name, ae_name, ai_ae, manager_name,
      change_type, old_value, new_value, delta_numeric, is_alert, alert_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const run = db.transaction(() => {
    for (const c of changes) {
      insert.run(
        c.imported_at, c.crm_opportunity_id, c.product, c.account_name,
        c.ae_name, c.ai_ae, c.manager_name, c.change_type,
        c.old_value, c.new_value, c.delta_numeric, c.is_alert, c.alert_reason,
      );
    }
  });
  run();
}

export function getAnalyticsData(): AnalyticsData {
  const changes = db.prepare(
    'SELECT * FROM forecast_changes ORDER BY imported_at DESC, id DESC LIMIT 1000',
  ).all() as ForecastChange[];

  const lastRow = db.prepare(
    'SELECT MAX(imported_at) AS ts FROM forecast_changes',
  ).get() as { ts: string | null };

  const multiPushOpps = db.prepare(`
    SELECT crm_opportunity_id, product, account_name, ae_name, ai_ae, manager_name,
           push_count, total_days_pushed,
           COALESCE(ais_arr, product_arr_usd) AS current_arr
    FROM forecast_opps
    WHERE push_count > 1
    ORDER BY push_count DESC, total_days_pushed DESC
    LIMIT 20
  `).all() as OppPushStats[];

  const pipelineNow = db.prepare(
    'SELECT COALESCE(SUM(COALESCE(ais_arr, product_arr_usd)), 0) AS total FROM forecast_opps',
  ).get() as { total: number };

  // Pipeline total from the import before the latest one
  const prevImport = db.prepare(`
    SELECT imported_at FROM forecast_changes
    WHERE imported_at < (SELECT MAX(imported_at) FROM forecast_changes)
    ORDER BY imported_at DESC LIMIT 1
  `).get() as { imported_at: string } | undefined;

  let totalPipelinePrev = pipelineNow.total; // default to same if no prior import
  if (prevImport) {
    const prevChanges = db.prepare(`
      SELECT change_type, delta_numeric FROM forecast_changes
      WHERE imported_at = (SELECT MAX(imported_at) FROM forecast_changes)
    `).all() as { change_type: string; delta_numeric: number | null }[];
    // Reverse ARR adds/drops/changes from the latest import to estimate prev total
    let delta = 0;
    for (const c of prevChanges) {
      if ((c.change_type === 'arr_up' || c.change_type === 'arr_down') && c.delta_numeric != null) delta += c.delta_numeric;
      if (c.change_type === 'opp_added' && c.delta_numeric != null) delta += c.delta_numeric;
      if (c.change_type === 'opp_dropped' && c.delta_numeric != null) delta += c.delta_numeric;
    }
    totalPipelinePrev = pipelineNow.total - delta;
  }

  // Forecast differences - where AIS team intentionally differed from VP forecast
  const forecastDifferences = getForecastDifferences();

  return {
    changes,
    lastImportAt: lastRow?.ts ?? null,
    multiPushOpps,
    totalPipelineNow: pipelineNow.total,
    totalPipelinePrev,
    forecastDifferences,
  };
}

function getForecastDifferences(): ForecastDifference[] {
  try {
    // Get opps where manual overrides exist
    const opps = db.prepare(`
      SELECT
        crm_opportunity_id, account_name, product, ai_ae, manager_name,
        vp_deal_forecast, ais_forecast, ais_forecast_manual,
        product_arr_usd, ais_arr, ais_arr_manual,
        close_date, ais_close_date, ais_close_date_manual
      FROM forecast_opps
      WHERE ais_forecast_manual = 1 OR ais_arr_manual = 1 OR ais_close_date_manual = 1
    `).all() as Array<{
    crm_opportunity_id: string;
    account_name: string;
    product: string;
    ai_ae: string;
    manager_name: string;
    vp_deal_forecast: string;
    ais_forecast: string | null;
    ais_forecast_manual: number;
    product_arr_usd: number;
    ais_arr: number | null;
    ais_arr_manual: number;
    close_date: string;
    ais_close_date: string | null;
    ais_close_date_manual: number;
  }>;

  const differences: ForecastDifference[] = [];

  for (const opp of opps) {
    // Category difference
    if (opp.ais_forecast_manual === 1 && opp.ais_forecast) {
      const vpMapped = mapForecast(opp.vp_deal_forecast);
      if (vpMapped !== opp.ais_forecast) {
        differences.push({
          crm_opportunity_id: opp.crm_opportunity_id,
          account_name: opp.account_name,
          product: opp.product,
          ai_ae: opp.ai_ae,
          manager_name: opp.manager_name,
          diff_type: 'category',
          vp_value: vpMapped || opp.vp_deal_forecast || '—',
          ais_value: opp.ais_forecast,
        });
      }
    }

    // ARR difference
    if (opp.ais_arr_manual === 1 && opp.ais_arr != null) {
      const delta = opp.ais_arr - opp.product_arr_usd;
      if (Math.abs(delta) >= 1000) { // Only show if difference is >= $1K
        differences.push({
          crm_opportunity_id: opp.crm_opportunity_id,
          account_name: opp.account_name,
          product: opp.product,
          ai_ae: opp.ai_ae,
          manager_name: opp.manager_name,
          diff_type: 'arr',
          vp_value: `$${opp.product_arr_usd.toLocaleString()}`,
          ais_value: `$${opp.ais_arr.toLocaleString()}`,
          arr_delta: delta,
        });
      }
    }

    // Date difference
    if (opp.ais_close_date_manual === 1 && opp.ais_close_date) {
      if (opp.close_date !== opp.ais_close_date) {
        const vpDate = new Date(opp.close_date);
        const aisDate = new Date(opp.ais_close_date);
        const daysDelta = Math.round((aisDate.getTime() - vpDate.getTime()) / (1000 * 60 * 60 * 24));

        differences.push({
          crm_opportunity_id: opp.crm_opportunity_id,
          account_name: opp.account_name,
          product: opp.product,
          ai_ae: opp.ai_ae,
          manager_name: opp.manager_name,
          diff_type: 'date',
          vp_value: opp.close_date,
          ais_value: opp.ais_close_date,
          days_delta: daysDelta,
        });
      }
    }
  }

    return differences;
  } catch (err) {
    console.error('[database] Error getting forecast differences:', err);
    return [];
  }
}

// ── Closed Won Opps ────────────────────────────────────────────

function deserializeClosedWonOpp(row: Record<string, unknown>): ClosedWonOpp {
  return {
    id: row.id as number,
    crm_opportunity_id: row.crm_opportunity_id as string,
    account_name: (row.account_name as string) || '',
    manager_name: (row.manager_name as string) || '',
    ae_name: (row.ae_name as string) || '',
    region: (row.region as string) || '',
    segment: (row.segment as string) || '',
    product: normalizeProduct((row.product as string) || ''),
    type: (row.type as string) || '',
    ai_ae: (row.ai_ae as string) || '',
    close_date: (row.close_date as string) || '',
    bookings: (row.bookings as number) || 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getClosedWonOpps(): ClosedWonOpp[] {
  const rows = db.prepare('SELECT * FROM closed_won_opps ORDER BY close_date DESC').all();
  return rows.map((r) => deserializeClosedWonOpp(r as Record<string, unknown>));
}

export function replaceClosedWonOpps(
  opps: Omit<ClosedWonOpp, 'id' | 'created_at' | 'updated_at'>[],
): { inserted: number } {
  const insert = db.prepare(`
    INSERT INTO closed_won_opps (
      crm_opportunity_id, account_name, manager_name, ae_name,
      region, segment, product, type, ai_ae, close_date, bookings
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteAll = db.prepare('DELETE FROM closed_won_opps');

  const run = db.transaction(() => {
    deleteAll.run();
    for (const opp of opps) {
      insert.run(
        opp.crm_opportunity_id,
        opp.account_name,
        opp.manager_name,
        opp.ae_name,
        opp.region,
        opp.segment,
        opp.product,
        opp.type,
        opp.ai_ae,
        opp.close_date,
        opp.bookings,
      );
    }
  });

  run();
  return { inserted: opps.length };
}

// ── Quotas ─────────────────────────────────────────────────────

export function getQuotas(): Quota[] {
  return db.prepare('SELECT ai_ae, region, quota, q1_target, q2_target, q3_target, q4_target FROM quotas ORDER BY ai_ae ASC').all() as Quota[];
}

export function upsertQuota(ai_ae: string, data: { region?: string; quota: number; q1_target?: number; q2_target?: number; q3_target?: number; q4_target?: number }): void {
  db.prepare(`
    INSERT INTO quotas (ai_ae, region, quota, q1_target, q2_target, q3_target, q4_target, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ai_ae) DO UPDATE SET
      region     = excluded.region,
      quota      = excluded.quota,
      q1_target  = excluded.q1_target,
      q2_target  = excluded.q2_target,
      q3_target  = excluded.q3_target,
      q4_target  = excluded.q4_target,
      updated_at = excluded.updated_at
  `).run(ai_ae, data.region ?? '', data.quota, data.q1_target ?? 0, data.q2_target ?? 0, data.q3_target ?? 0, data.q4_target ?? 0);
}

export function deleteQuota(ai_ae: string): void {
  db.prepare('DELETE FROM quotas WHERE ai_ae = ?').run(ai_ae);
}

// ── Auto-sync forecast → renewals ─────────────────────────────

export function syncForecastToRenewals(
  opps: Pick<ForecastOpp, 'sfdc_account_id' | 'account_name' | 'product' | 'close_date' | 'ais_close_date'>[],
): number {
  const accounts = getAllAccounts();
  const monitored = new Set(['ai agents', 'copilot', 'qa']);
  let synced = 0;

  for (const opp of opps) {
    const productLower = opp.product.toLowerCase();
    if (!monitored.has(productLower)) continue;

    // Effective close date: AIS close date if set, else original
    const effectiveCloseDate = opp.ais_close_date || opp.close_date;
    if (!effectiveCloseDate) continue;

    // Match account by sfdc_account_id first, then account name (case-insensitive)
    const match = accounts.find((a) =>
      (opp.sfdc_account_id && a.crm_account_id === opp.sfdc_account_id) ||
      a.account_name.toLowerCase() === opp.account_name.toLowerCase(),
    );
    if (!match) continue;
    if (!match.renewal_date) continue;
    if (effectiveCloseDate > match.renewal_date) continue;

    if (match.contact_status !== 'deal_live') {
      setContactStatus(match.id, 'deal_live');
      synced++;
    }
  }

  return synced;
}

// ── Import History ─────────────────────────────────────────────

export function logImport(data: {
  source_type: string;
  backup_filename: string;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  total_pipeline: number;
}): void {
  db.prepare(`
    INSERT INTO import_history (source_type, backup_filename, row_count, inserted_count, updated_count, total_pipeline)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.source_type,
    data.backup_filename,
    data.row_count,
    data.inserted_count,
    data.updated_count,
    data.total_pipeline,
  );
}

export function getImportHistory(limit = 20): ImportHistoryEntry[] {
  return db
    .prepare('SELECT * FROM import_history ORDER BY imported_at DESC LIMIT ?')
    .all(limit) as ImportHistoryEntry[];
}
