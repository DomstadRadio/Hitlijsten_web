/**
 * Database setup & migraties voor het Hitlijsten stemplatform.
 * Tabellen:
 *   - lists       : de hitlijsten (configuratie + thema)
 *   - list_tracks : kandidaat-nummers per lijst
 *   - votes       : uitgebrachte stemmen
 *   - registrations : e-mailadressen + verificatie tokens
 */

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DB_PATH = process.env.DB_PATH
  ? path.resolve(__dirname, '../../', process.env.DB_PATH)
  : path.join(__dirname, '../../data/hitlijsten.db');

let _db = null;

function safeAddColumn(db, table, column, definition) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (_) {}
}

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');    // veilig met WAL, minder fsync
  _db.pragma('cache_size = -32000');    // 32 MB page cache
  _db.pragma('temp_store = MEMORY');    // temp tabellen in RAM
  _db.pragma('mmap_size = 134217728'); // 128 MB memory-mapped I/O
  migrate(_db);
  // Veilig upgraden van bestaande databases
  safeAddColumn(_db, 'lists',         'playit_group',      'TEXT');
  safeAddColumn(_db, 'registrations', 'approved',          'INTEGER DEFAULT NULL');
  safeAddColumn(_db, 'registrations', 'verify_code',       'TEXT');
  safeAddColumn(_db, 'registrations', 'reminder_sent_at',  'TEXT DEFAULT NULL');
  // Feature: flexibele puntentelling
  safeAddColumn(_db, 'lists',         'score_rules',        'TEXT DEFAULT NULL');  // JSON: [10,7,5,…]
  safeAddColumn(_db, 'list_tracks',   'score_adjustment',   'INTEGER DEFAULT 0');  // handmatige bonus/malus
  // Feature: aanpasbare herinnerings-e-mail per lijst
  safeAddColumn(_db, 'lists',         'reminder_subject',       'TEXT DEFAULT NULL');
  safeAddColumn(_db, 'lists',         'reminder_html',          'TEXT DEFAULT NULL');
  // Feature: automatisch publiceren + stemmen pauzeren
  safeAddColumn(_db, 'lists',         'auto_publish_cron',       'TEXT DEFAULT NULL');   // bijv. "0 7 * * 5" = vrijdag 07:00
  safeAddColumn(_db, 'lists',         'voting_paused',           'INTEGER DEFAULT 0');
  safeAddColumn(_db, 'lists',         'voting_paused_message',   'TEXT DEFAULT NULL');
  // Feature: privacy statement link
  safeAddColumn(_db, 'lists',         'privacy_url',             'TEXT DEFAULT NULL');
  // Feature: audit log tabel
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       TEXT NOT NULL DEFAULT (datetime('now')),
        actor    TEXT,
        action   TEXT NOT NULL,
        list_id  INTEGER,
        target   TEXT,
        detail   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_list    ON audit_log(list_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action, ts DESC);
    `);
  } catch (_) {}
  // Feature: radioprogramma's voor formulieren
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS programs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        description TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (_) {}
  // Indices (kunnen falen als kolom nog niet bestaat — wordt genegeerd)
  try { _db.exec('CREATE INDEX IF NOT EXISTS idx_reg_approved ON registrations(list_id, approved)'); } catch (_) {}
  try { _db.exec('CREATE INDEX IF NOT EXISTS idx_reg_reminder ON registrations(list_id, reminder_sent_at)'); } catch (_) {}
  // Feature: blokkeerlijst
  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_voters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        email      TEXT,
        machine_id TEXT,
        reason     TEXT,
        blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_blocked_list ON blocked_voters(list_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_email ON blocked_voters(list_id, email);
    `);
  } catch (_) {}

  // Dedupliceer list_tracks op (list_id, lower(artist), lower(title)) en zet unique index
  dedupeListTracks(_db);
  try {
    _db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_list_tracks_artist_title
        ON list_tracks(list_id, LOWER(artist), LOWER(title))
    `);
  } catch (e) {
    console.warn('Unique index op list_tracks niet aangemaakt:', e.message);
  }

  // Seed default admin als users tabel leeg is
  seedDefaultAdmin(_db);

  // Laad instellingen uit DB in process.env
  loadSettingsIntoEnv(_db);

  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT    NOT NULL UNIQUE,
      name          TEXT    NOT NULL,
      description   TEXT,
      domain        TEXT,
      status        TEXT    NOT NULL DEFAULT 'draft',  -- draft | open | closed
      max_votes     INTEGER NOT NULL DEFAULT 10,
      bg_image      TEXT,
      theme         TEXT    NOT NULL DEFAULT '{}',     -- JSON: kleuren, lettertype, hoeken
      playit_group  TEXT,                              -- PlayIt Live trackgroep filter
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      closes_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS list_tracks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      source        TEXT    NOT NULL DEFAULT 'playit',  -- playit | spotify | manual
      external_id   TEXT,                               -- PlayIt GUID of Spotify track id
      title         TEXT    NOT NULL,
      artist        TEXT    NOT NULL,
      album         TEXT,
      cover_url     TEXT,
      preview_url   TEXT,
      year          INTEGER,
      added_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_list_tracks_list ON list_tracks(list_id);

    CREATE TABLE IF NOT EXISTS registrations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      email         TEXT    NOT NULL,
      name          TEXT,
      verified      INTEGER NOT NULL DEFAULT 0,
      verify_token  TEXT    NOT NULL UNIQUE,
      machine_id    TEXT,
      approved      INTEGER DEFAULT NULL,               -- NULL=wacht, 1=goedgekeurd, 0=afgewezen
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_list_email ON registrations(list_id, email);
    CREATE INDEX IF NOT EXISTS idx_reg_machine ON registrations(list_id, machine_id);

    CREATE TABLE IF NOT EXISTS votes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
      list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      track_id        INTEGER NOT NULL REFERENCES list_tracks(id) ON DELETE CASCADE,
      position        INTEGER NOT NULL,
      voted_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_reg_track  ON votes(registration_id, track_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_reg_pos    ON votes(registration_id, position);

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'admin',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- PlayIt Live sync tabellen
    CREATE TABLE IF NOT EXISTS playit_groups (
      guid        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT,
      hidden      INTEGER NOT NULL DEFAULT 0,
      track_count INTEGER NOT NULL DEFAULT 0,
      synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playit_tracks (
      guid      TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      artist    TEXT NOT NULL,
      album     TEXT,
      year      INTEGER,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_playit_tracks_artist ON playit_tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_playit_tracks_title  ON playit_tracks(title);

    CREATE TABLE IF NOT EXISTS playit_track_groups (
      track_guid TEXT NOT NULL REFERENCES playit_tracks(guid) ON DELETE CASCADE,
      group_guid TEXT NOT NULL REFERENCES playit_groups(guid) ON DELETE CASCADE,
      PRIMARY KEY (track_guid, group_guid)
    );

    -- Wekelijkse hitlijst snapshots (publiceer-moment)
    CREATE TABLE IF NOT EXISTS chart_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      track_id   INTEGER NOT NULL REFERENCES list_tracks(id) ON DELETE CASCADE,
      week       INTEGER NOT NULL,
      year       INTEGER NOT NULL,
      position   INTEGER NOT NULL,
      score      INTEGER NOT NULL DEFAULT 0,
      vote_count INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_week_track
      ON chart_history(list_id, year, week, track_id);
    CREATE INDEX IF NOT EXISTS idx_chart_list_track
      ON chart_history(list_id, track_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- ── Custom formulieren (enquêtes, top-N lijstjes met track-pickers) ──
    CREATE TABLE IF NOT EXISTS forms (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT    NOT NULL UNIQUE,
      name         TEXT    NOT NULL,
      description  TEXT,
      status       TEXT    NOT NULL DEFAULT 'draft',  -- draft | open | closed
      settings     TEXT    NOT NULL DEFAULT '{}',     -- JSON: verify_email, verify_machine, one_per_email, success_message, redirect_url, notify_email
      schema       TEXT    NOT NULL DEFAULT '{"pages":[{"id":"p1","title":"Pagina 1","fields":[]}]}',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      closes_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS form_registrations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id       INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      email         TEXT,
      name          TEXT,
      phone         TEXT,
      verified      INTEGER NOT NULL DEFAULT 0,
      verify_token  TEXT    NOT NULL UNIQUE,
      verify_code   TEXT,
      machine_id    TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_form_reg_form    ON form_registrations(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_reg_email   ON form_registrations(form_id, email);
    CREATE INDEX IF NOT EXISTS idx_form_reg_machine ON form_registrations(form_id, machine_id);

    CREATE TABLE IF NOT EXISTS form_responses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id         INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      registration_id INTEGER REFERENCES form_registrations(id) ON DELETE SET NULL,
      answers         TEXT    NOT NULL DEFAULT '{}',   -- JSON: { fieldId: value }
      comment         TEXT,
      submitted_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_form_resp_form ON form_responses(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_resp_reg  ON form_responses(registration_id);
  `);
}

/**
 * Laad alle instellingen uit de settings-tabel in process.env.
 * Lege waarden worden overgeslagen zodat .env-defaults intact blijven.
 */
function loadSettingsIntoEnv(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    for (const { key, value } of rows) {
      if (value) process.env[key] = value;
    }
  } catch (_) {}
}

/**
 * Dedupliceer list_tracks: voor elke (list_id, lower(artist), lower(title))-combinatie
 * houden we de oudste row (laagste id) en verplaatsen alle votes/chart_history naar die id.
 * Dubbele rijen worden daarna verwijderd. Idempotent.
 */
function dedupeListTracks(db) {
  try {
    const dupes = db.prepare(`
      SELECT list_id, LOWER(artist) AS la, LOWER(title) AS lt, COUNT(*) AS n, MIN(id) AS keep_id
        FROM list_tracks
       GROUP BY list_id, LOWER(artist), LOWER(title)
      HAVING n > 1
    `).all();

    if (dupes.length === 0) return;
    console.log(`🧹 list_tracks dedup: ${dupes.length} duplicaat-groep(en) gevonden, samenvoegen…`);

    const getDupIds = db.prepare(`
      SELECT id FROM list_tracks
       WHERE list_id = ? AND LOWER(artist) = ? AND LOWER(title) = ? AND id != ?
    `);
    const moveVotes        = db.prepare('UPDATE OR IGNORE votes         SET track_id = ? WHERE track_id = ?');
    const deleteLeftVotes  = db.prepare('DELETE FROM votes WHERE track_id = ?');
    const moveCharts       = db.prepare('UPDATE OR IGNORE chart_history SET track_id = ? WHERE track_id = ?');
    const deleteLeftCharts = db.prepare('DELETE FROM chart_history WHERE track_id = ?');
    const deleteTrack      = db.prepare('DELETE FROM list_tracks WHERE id = ?');

    const tx = db.transaction(() => {
      for (const d of dupes) {
        const others = getDupIds.all(d.list_id, d.la, d.lt, d.keep_id);
        for (const o of others) {
          // Verplaats wat kan; rest verwijderen (zou alleen falen bij unieke (reg,track)-clash).
          moveVotes.run(d.keep_id, o.id);
          deleteLeftVotes.run(o.id);
          moveCharts.run(d.keep_id, o.id);
          deleteLeftCharts.run(o.id);
          deleteTrack.run(o.id);
        }
      }
    });
    tx();
    console.log('🧹 list_tracks dedup klaar');
  } catch (e) {
    console.warn('list_tracks dedup mislukt:', e.message);
  }
}

function seedDefaultAdmin(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  // Standaard wachtwoord: "domstad2025" — moet direct worden gewijzigd!
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('domstad2025', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run('admin', hash);
  console.log('⚠️  Standaard admin aangemaakt: gebruiker=admin wachtwoord=domstad2025 — wijzig dit direct!');
}

module.exports = { getDb };
