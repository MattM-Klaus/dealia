import Database from 'better-sqlite3';

/**
 * Creates an in-memory SQLite database with the same schema as production.
 * This database is isolated and fast, perfect for integration tests.
 *
 * @returns A new in-memory database instance with all tables created
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');

  // Run the same migrations as production database
  runTestMigrations(db);

  return db;
}

/**
 * Resets the test database by clearing all data from all tables.
 * This is useful for cleaning up between tests to ensure isolation.
 *
 * @param db - The database instance to reset
 */
export function resetTestDatabase(db: Database.Database): void {
  // Get all table names
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];

  // Delete all data from each table
  for (const table of tables) {
    db.prepare(`DELETE FROM ${table.name}`).run();
  }
}

/**
 * Runs the same migrations as production database (from src/main/database.ts).
 * This ensures the test database has the exact same schema.
 *
 * @param db - The database instance to run migrations on
 */
function runTestMigrations(db: Database.Database): void {
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
      contact_status  TEXT    NOT NULL DEFAULT 'needs_action',
      contacted_at    TEXT    DEFAULT NULL,
      ae_manager      TEXT    NOT NULL DEFAULT '',
      crm_account_id  TEXT    DEFAULT NULL,
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
      ais_top_deal                INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS closed_lost_opps (
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
      q1_target  REAL NOT NULL DEFAULT 0,
      q2_target  REAL NOT NULL DEFAULT 0,
      q3_target  REAL NOT NULL DEFAULT 0,
      q4_target  REAL NOT NULL DEFAULT 0,
      region     TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

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

  // pipeline_snapshots: stores complete pipeline state at each import for historical reconstruction
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL UNIQUE,
      snapshot_data TEXT NOT NULL,
      total_pipeline REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_snapshots_imported_at
      ON pipeline_snapshots(imported_at);
  `);

  // closed_won_snapshots: stores complete closed won state at each import for historical reconstruction
  db.exec(`
    CREATE TABLE IF NOT EXISTS closed_won_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL UNIQUE,
      snapshot_data TEXT NOT NULL,
      total_bookings REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_closed_won_snapshots_imported_at
      ON closed_won_snapshots(imported_at);
  `);

  // excluded_deals: tracks manually excluded opportunities (persists even when deals are removed from pipeline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS excluded_deals (
      crm_opportunity_id TEXT PRIMARY KEY,
      excluded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Commission Reconciliation tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS xactly_commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_number TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      commissionable_date TEXT NOT NULL DEFAULT '',
      credit_type TEXT NOT NULL DEFAULT '',
      credit_amount REAL NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(opportunity_number, credit_type, period)
    );

    CREATE TABLE IF NOT EXISTS tableau_closed_won (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_number TEXT NOT NULL,
      crm_opportunity_id TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      ae_name TEXT NOT NULL DEFAULT '',
      manager_name TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      bookings REAL NOT NULL DEFAULT 0,
      close_date TEXT NOT NULL DEFAULT '',
      period TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(opportunity_number, product, period)
    );

    CREATE TABLE IF NOT EXISTS commission_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_number TEXT NOT NULL,
      period TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      tableau_amount REAL DEFAULT NULL,
      xactly_amount REAL DEFAULT NULL,
      variance REAL DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT DEFAULT '',
      reviewed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commission_investigations (
      opportunity_number TEXT NOT NULL,
      period TEXT NOT NULL,
      status TEXT DEFAULT NULL,
      notes TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (opportunity_number, period)
    );

    CREATE INDEX IF NOT EXISTS idx_xactly_period ON xactly_commissions(period);
    CREATE INDEX IF NOT EXISTS idx_tableau_period ON tableau_closed_won(period);
    CREATE INDEX IF NOT EXISTS idx_commission_issues_period ON commission_issues(period);
  `);

  // Deal Backed Reason Tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS deal_backed_reasons (
      crm_opportunity_id TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      reason TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (crm_opportunity_id, imported_at)
    );
  `);

  // Weekly Notes table for Deal Backed commentary
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_notes (
      week_start TEXT NOT NULL,
      region TEXT NOT NULL,
      notes TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (week_start, region)
    );
  `);
}
