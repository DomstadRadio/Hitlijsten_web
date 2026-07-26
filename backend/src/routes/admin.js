/**
 * Admin routes: inzendingen goedkeuren/afwijzen.
 *
 * GET  /api/admin/submissions/:listId                         — lijst met inzendingen (filter: ?status=)
 * GET  /api/admin/submissions/:listId/:regId                  — details van één inzending incl. stemmen
 * POST /api/admin/submissions/:regId/approve                  — goedkeuren
 * POST /api/admin/submissions/:regId/reject                   — afwijzen
 * POST /api/admin/submissions/:regId/reset                    — terugzetten naar wacht op goedkeuring
 * POST /api/admin/submissions/:regId/tracks/:voteId/approve   — één track goedkeuren
 * POST /api/admin/submissions/:regId/tracks/:voteId/reject    — één track afwijzen
 * POST /api/admin/submissions/:regId/tracks/:voteId/reset     — één track terugzetten
 * GET  /api/admin/voters/:listId                              — alle stemmers met details (voor radio-calls)
 * GET  /api/admin/settings                                    — instellingen ophalen
 * PUT  /api/admin/settings                                    — instellingen opslaan (SMTP / Frontend URL)
 * POST /api/admin/settings/test-email                         — testmail sturen
 */

const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const { getDb }   = require('../db/database');
const { requireAuth, requirePerm } = require('./auth');
const playitSync  = require('../services/playit-sync');
const { sendVoteApprovedEmail } = require('../services/email');

const router = express.Router();

// Alle admin routes vereisen minimaal authenticatie
router.use(requireAuth);

// GET /api/admin/submissions/:listId?status=pending|approved|rejected
router.get('/submissions/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let approvedFilter = '';
  if (status === 'pending')  approvedFilter = 'AND r.approved IS NULL';
  if (status === 'approved') approvedFilter = 'AND r.approved = 1';
  if (status === 'rejected') approvedFilter = 'AND r.approved = 0';

  const submissions = db.prepare(`
    SELECT
      r.id, r.email, r.name, r.phone, r.verified, r.approved, r.comment, r.machine_id, r.created_at,
      COUNT(v.id) AS vote_count
    FROM registrations r
    LEFT JOIN votes v ON v.registration_id = r.id
    WHERE r.list_id = ? AND r.verified = 1 ${approvedFilter}
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all(req.params.listId);

  res.json(submissions);
});

// GET /api/admin/submissions/:listId/:regId — inzending details met stemmen
router.get('/submissions/:listId/:regId', ...requirePerm('submissions'), (req, res) => {
  const db  = getDb();
  const reg = db.prepare(
    'SELECT * FROM registrations WHERE id = ? AND list_id = ?'
  ).get(req.params.regId, req.params.listId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });

  const votes = db.prepare(`
    SELECT v.id AS vote_id, v.position, v.approved AS track_approved,
           lt.id AS track_id, lt.title, lt.artist, lt.cover_url, lt.year
    FROM votes v
    JOIN list_tracks lt ON lt.id = v.track_id
    WHERE v.registration_id = ?
    ORDER BY v.position
  `).all(reg.id);

  res.json({ ...reg, votes });
});

// POST /api/admin/submissions/:regId/tracks/:voteId/approve
router.post('/submissions/:regId/tracks/:voteId/approve', ...requirePerm('submissions'), async (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT r.*, l.name AS list_name FROM registrations r JOIN lists l ON l.id = r.list_id WHERE r.id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE votes SET approved = 1 WHERE id = ? AND registration_id = ?')
    .run(req.params.voteId, req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Track niet gevonden' });
  republishChart(reg.list_id);

  // Als alle tracks een oordeel hebben: registratie automatisch promoten + mail
  const allVotes = db.prepare('SELECT v.approved AS track_approved, lt.title, lt.artist FROM votes v JOIN list_tracks lt ON lt.id = v.track_id WHERE v.registration_id = ?').all(reg.id);
  const pending = allVotes.filter(v => v.track_approved === null || v.track_approved === undefined);
  if (pending.length === 0) {
    const approved = allVotes.filter(v => v.track_approved === 1);
    const rejected = allVotes.filter(v => v.track_approved === 0);
    // Alle tracks goedgekeurd of mix → registratie goedkeuren; alles afgewezen → afwijzen
    const newStatus = approved.length > 0 ? 1 : 0;
    db.prepare('UPDATE registrations SET approved = ? WHERE id = ? AND (approved IS NULL OR approved != ?)')
      .run(newStatus, reg.id, newStatus);
    republishChart(reg.list_id);
    sendVoteApprovedEmail({ to: reg.email, name: reg.name, listName: reg.list_name, approvedTracks: approved, rejectedTracks: rejected })
      .catch(e => console.error('[email] Track-goedkeuring mail mislukt:', e.message));
  }
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/tracks/:voteId/reject
router.post('/submissions/:regId/tracks/:voteId/reject', ...requirePerm('submissions'), async (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT r.*, l.name AS list_name FROM registrations r JOIN lists l ON l.id = r.list_id WHERE r.id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE votes SET approved = 0 WHERE id = ? AND registration_id = ?')
    .run(req.params.voteId, req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Track niet gevonden' });
  republishChart(reg.list_id);

  // Als alle tracks een oordeel hebben: registratie automatisch promoten + mail
  const allVotes = db.prepare('SELECT v.approved AS track_approved, lt.title, lt.artist FROM votes v JOIN list_tracks lt ON lt.id = v.track_id WHERE v.registration_id = ?').all(reg.id);
  const pending2 = allVotes.filter(v => v.track_approved === null || v.track_approved === undefined);
  if (pending2.length === 0) {
    const approved2 = allVotes.filter(v => v.track_approved === 1);
    const rejected2 = allVotes.filter(v => v.track_approved === 0);
    const newStatus = approved2.length > 0 ? 1 : 0;
    db.prepare('UPDATE registrations SET approved = ? WHERE id = ? AND (approved IS NULL OR approved != ?)')
      .run(newStatus, reg.id, newStatus);
    republishChart(reg.list_id);
    sendVoteApprovedEmail({ to: reg.email, name: reg.name, listName: reg.list_name, approvedTracks: approved2, rejectedTracks: rejected2 })
      .catch(e => console.error('[email] Track-afwijzing mail mislukt:', e.message));
  }
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/tracks/:voteId/reset
router.post('/submissions/:regId/tracks/:voteId/reset', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT list_id FROM registrations WHERE id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE votes SET approved = NULL WHERE id = ? AND registration_id = ?')
    .run(req.params.voteId, req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Track niet gevonden' });
  // Zet registratie terug naar pending als een track gereset wordt
  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// GET /api/admin/tracks-voters/:listId — per nummer alle stemmers, op lijstvolgorde
router.get('/tracks-voters/:listId', ...requirePerm('voters'), (req, res) => {
  const db = getDb();
  const { week, year } = currentISOWeek();

  const rows = db.prepare(`
    SELECT
      lt.id AS track_id, lt.title, lt.artist, lt.cover_url,
      ch.position AS chart_position, ch.score,
      v.id AS vote_id, v.position AS voter_position, v.approved AS track_approved,
      r.id AS reg_id, r.name, r.email, r.phone, r.comment, r.approved AS reg_approved
    FROM list_tracks lt
    LEFT JOIN chart_history ch
      ON ch.track_id = lt.id AND ch.list_id = ? AND ch.week = ? AND ch.year = ?
    LEFT JOIN votes v ON v.track_id = lt.id AND v.list_id = ?
    LEFT JOIN registrations r ON r.id = v.registration_id AND r.verified = 1
    WHERE lt.list_id = ?
    ORDER BY COALESCE(ch.position, 9999) ASC, lt.title ASC, v.id ASC
  `).all(req.params.listId, week, year, req.params.listId, req.params.listId);

  // Groepeer per track
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.track_id)) {
      map.set(row.track_id, {
        track_id: row.track_id, title: row.title, artist: row.artist,
        cover_url: row.cover_url, chart_position: row.chart_position,
        score: row.score, voters: [],
      });
    }
    if (row.reg_id) {
      map.get(row.track_id).voters.push({
        vote_id: row.vote_id, voter_position: row.voter_position,
        track_approved: row.track_approved,
        reg_id: row.reg_id, name: row.name, email: row.email,
        phone: row.phone, comment: row.comment, reg_approved: row.reg_approved,
      });
    }
  }
  // Alleen tracks met stemmers
  res.json([...map.values()].filter(t => t.voters.length > 0));
});

// POST /api/admin/submissions/:regId/approve
router.post('/submissions/:regId/approve', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT list_id FROM registrations WHERE id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE registrations SET approved = 1 WHERE id = ?')
    .run(req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Niet gevonden' });
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/reject
router.post('/submissions/:regId/reject', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT list_id FROM registrations WHERE id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE registrations SET approved = 0 WHERE id = ?')
    .run(req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Niet gevonden' });
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/reset — terugzetten naar wacht op goedkeuring
router.post('/submissions/:regId/reset', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT list_id FROM registrations WHERE id = ?').get(req.params.regId);
  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  if (reg) republishChart(reg.list_id);
  res.json({ ok: true });
});

// GET /api/admin/stats/:listId — tellingen per status
router.get('/stats/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE verified = 1)                      AS total,
      COUNT(*) FILTER (WHERE verified = 1 AND approved IS NULL) AS pending,
      COUNT(*) FILTER (WHERE verified = 1 AND approved = 1)     AS approved,
      COUNT(*) FILTER (WHERE verified = 1 AND approved = 0)     AS rejected
    FROM registrations WHERE list_id = ?
  `).get(req.params.listId);
  res.json(row);
});

/**
 * GET /api/admin/chart-live/:listId
 * Live hitlijst op basis van de huidige stemmen (alleen goedgekeurde inzendingen
 * en goedgekeurde track-stemmen). Geeft per track: position, score, vote_count.
 * Optionele query:
 *   ?includeAll=1  → ook stemmen meetellen van inzendingen die nog niet zijn
 *                    goedgekeurd of afgewezen.
 *   ?limit=N       → beperk tot top N (default: alles).
 */
router.get('/chart-live/:listId', ...requirePerm('chart'), (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  const includeAll = req.query.includeAll === '1';
  const limit = Math.max(0, Number(req.query.limit) || 0);

  const list = db.prepare('SELECT id, name, slug, max_votes FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  // Zelfde score-formule als bij publish:
  //   max_votes == 1  → score = 1 per stem
  //   anders          → score = max_votes + 1 - positie
  const approvedFilter = includeAll
    ? ''
    : 'AND r.approved = 1 AND (v.approved IS NULL OR v.approved = 1)';

  const rows = db.prepare(`
    SELECT
      lt.id          AS track_id,
      lt.title,
      lt.artist,
      lt.album,
      lt.cover_url,
      lt.year        AS release_year,
      SUM(CASE WHEN l.max_votes = 1 THEN 1
               WHEN l.max_votes + 1 - v.position < 0 THEN 0
               ELSE l.max_votes + 1 - v.position END) AS score,
      COUNT(DISTINCT v.registration_id)               AS vote_count
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    JOIN lists l         ON l.id = v.list_id
    JOIN list_tracks lt  ON lt.id = v.track_id
    WHERE v.list_id = ?
      ${approvedFilter}
    GROUP BY lt.id, lt.title, lt.artist, lt.album, lt.cover_url, lt.year
    ORDER BY score DESC, vote_count DESC, lt.artist ASC, lt.title ASC
  `).all(listId);

  // Tracks zonder stemmen toevoegen onderaan (alleen als limit niet gezet)
  const withoutVotes = limit > 0 ? [] : db.prepare(`
    SELECT lt.id AS track_id, lt.title, lt.artist, lt.album, lt.cover_url,
           lt.year AS release_year,
           0 AS score, 0 AS vote_count
      FROM list_tracks lt
     WHERE lt.list_id = ?
       AND lt.id NOT IN (
         SELECT DISTINCT v.track_id
           FROM votes v
           JOIN registrations r ON r.id = v.registration_id
          WHERE v.list_id = ?
            ${approvedFilter}
       )
  `).all(listId, listId);

  const combined = [...rows, ...withoutVotes];
  const limited  = limit > 0 ? combined.slice(0, limit) : combined;

  // Totalen
  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT v.registration_id) AS total_voters,
      COUNT(*)                          AS total_votes
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    WHERE v.list_id = ?
      ${approvedFilter}
  `).get(listId);

  res.json({
    list: { id: list.id, name: list.name, slug: list.slug, max_votes: list.max_votes },
    includeAll,
    totals,
    chart: limited.map((row, i) => ({ position: i + 1, ...row })),
  });
});

// ── PlayIt sync ──────────────────────────────────────────────────────────────

// POST /api/admin/sync/playit — start volledige sync (asynchroon)
router.post('/sync/playit', ...requirePerm('tracks'), (req, res) => {
  const status = playitSync.getStatus();
  if (status.running) return res.status(409).json({ error: 'Sync is al bezig', status });

  playitSync.syncAll()
    .then(r  => console.log('[sync] Klaar:', r))
    .catch(e => console.error('[sync] Fout:', e.message));

  res.json({ ok: true, message: 'Sync gestart' });
});

// GET /api/admin/sync/status — huidige sync-status
router.get('/sync/status', ...requirePerm('tracks'), (req, res) => {
  res.json(playitSync.getStatus());
});

// ── Hitlijst publiceren ──────────────────────────────────────────────────────

/** ISO weeknummer + jaar berekenen */
function currentISOWeek() {
  const now = new Date();
  const d   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  };
}

/**
 * Herbereken en sla chart op voor een lijst op basis van alle goedgekeurde stemmen.
 * Stille functie: logt alleen fouten, gooit nooit.
 */
function republishChart(listId) {
  try {
    const db = getDb();
    const { week, year } = currentISOWeek();
    const results = db.prepare(`
      SELECT
        v.track_id,
        SUM(CASE WHEN l.max_votes = 1 THEN 1
                 WHEN l.max_votes + 1 - v.position < 0 THEN 0
                 ELSE l.max_votes + 1 - v.position END) AS score,
        COUNT(DISTINCT v.registration_id) AS vote_count
      FROM votes v
      JOIN registrations r ON r.id = v.registration_id
      JOIN lists l         ON l.id = v.list_id
      WHERE v.list_id = ? AND r.approved = 1        AND (v.approved IS NULL OR v.approved = 1)      GROUP BY v.track_id
      ORDER BY score DESC
    `).all(listId);

    if (results.length === 0) return;

    const upsert = db.prepare(`
      INSERT INTO chart_history (list_id, track_id, week, year, position, score, vote_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_id, year, week, track_id) DO UPDATE SET
        position    = excluded.position,
        score       = excluded.score,
        vote_count  = excluded.vote_count,
        recorded_at = datetime('now')
    `);

    // Verwijder tracks die niet meer in de top staan (bijv. na afwijzing)
    const currentIds = results.map(r => r.track_id);
    db.prepare(`
      DELETE FROM chart_history
      WHERE list_id = ? AND week = ? AND year = ?
      AND track_id NOT IN (${currentIds.map(() => '?').join(',')})
    `).run(listId, week, year, ...currentIds);

    db.transaction(() => {
      results.forEach((row, i) => {
        upsert.run(listId, row.track_id, week, year, i + 1, row.score, row.vote_count);
      });
    })();
  } catch (e) {
    console.error('[chart] Auto-publicatie mislukt:', e.message);
  }
}

/**
 * POST /api/admin/chart/:listId/publish
 * Maakt een wekelijkse snapshot van de huidige stemresultaten (alleen goedgekeurde stemmen).
 * Minimaal 1 goedgekeurde stem vereist. Bestaande snapshot voor dezelfde week wordt overschreven.
 */
router.post('/chart/:listId/publish', ...requirePerm('chart'), (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  const { week, year } = currentISOWeek();

  // Huidige stemresultaten — zelfde score-formule als ResultsPage
  const results = db.prepare(`
    SELECT
      v.track_id,
      SUM(CASE WHEN l.max_votes = 1 THEN 1
               WHEN l.max_votes + 1 - v.position < 0 THEN 0
               ELSE l.max_votes + 1 - v.position END) AS score,
      COUNT(DISTINCT v.registration_id) AS vote_count
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    JOIN lists l         ON l.id = v.list_id
    WHERE v.list_id = ? AND r.approved = 1
      AND (v.approved IS NULL OR v.approved = 1)
    GROUP BY v.track_id
    ORDER BY score DESC
  `).all(listId);

  if (results.length === 0) {
    return res.status(400).json({ error: 'Geen goedgekeurde stemmen gevonden voor deze lijst' });
  }

  const upsert = db.prepare(`
    INSERT INTO chart_history (list_id, track_id, week, year, position, score, vote_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_id, year, week, track_id) DO UPDATE SET
      position    = excluded.position,
      score       = excluded.score,
      vote_count  = excluded.vote_count,
      recorded_at = datetime('now')
  `);

  db.transaction(() => {
    results.forEach((row, i) => {
      upsert.run(listId, row.track_id, week, year, i + 1, row.score, row.vote_count);
    });
  })();

  res.json({ ok: true, week, year, trackCount: results.length });
});

// ── SMTP / Instellingen ──────────────────────────────────────────────────────

const SETTING_KEYS = ['EMAIL_PROVIDER','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM','FRONTEND_URL','SENDGRID_API_KEY','RESEND_API_KEY'];

/** Lees alle instellingen uit de DB als key→value object */
function readSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const { key, value } of rows) out[key] = value;
  return out;
}

/** Sla één of meerdere key/value paren op in de DB én process.env */
function writeSettings(updates) {
  const db = getDb();
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [key, val] of Object.entries(updates)) {
      upsert.run(key, val);
      process.env[key] = val;
    }
  })();
}

// GET /api/admin/settings — huidige instellingen (wachtwoord gemaskerd)
router.get('/settings', ...requirePerm('settings'), (req, res) => {
  const s = readSettings();
  res.json({
    EMAIL_PROVIDER:   s.EMAIL_PROVIDER   || 'smtp',
    SMTP_HOST:        s.SMTP_HOST        || '',
    SMTP_PORT:        s.SMTP_PORT        || '587',
    SMTP_USER:        s.SMTP_USER        || '',
    SMTP_PASS:        s.SMTP_PASS ? '••••••••' : '',
    SMTP_FROM:        s.SMTP_FROM        || '',
    FRONTEND_URL:     s.FRONTEND_URL     || '',
    SENDGRID_API_KEY: s.SENDGRID_API_KEY ? '••••••••' : '',
    RESEND_API_KEY:   s.RESEND_API_KEY   ? '••••••••' : '',
    hasSmtpPass:      !!(s.SMTP_PASS),
    hasSendgrid:      !!(s.SENDGRID_API_KEY),
    hasResend:        !!(s.RESEND_API_KEY),
  });
});

// PUT /api/admin/settings — sla nieuwe instellingen op
router.put('/settings', ...requirePerm('settings'), (req, res) => {
  const updates = {};
  for (const key of SETTING_KEYS) {
    if (req.body[key] !== undefined && req.body[key] !== '••••••••') {
      updates[key] = req.body[key];
    }
  }
  writeSettings(updates);
  res.json({ ok: true });
});

// POST /api/admin/settings/test-email — stuur een testmail
router.post('/settings/test-email', ...requirePerm('settings'), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Geef een e-mailadres op' });

  // Tijdelijk de ingestelde (maar nog niet opgeslagen) waarden toepassen
  const tempKeys = ['EMAIL_PROVIDER','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM','SENDGRID_API_KEY','RESEND_API_KEY'];
  const originals = {};
  for (const key of tempKeys) {
    originals[key] = process.env[key];
    if (req.body[key] && req.body[key] !== '••••••••') process.env[key] = req.body[key];
  }

  try {
    const { sendMail } = require('../services/email');
    const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
    await sendMail({
      to,
      subject: 'Hitlijsten – e-mail test ✅',
      html: `<p>De e-mailverbinding werkt correct! (provider: <strong>${provider}</strong>)</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    for (const [k, v] of Object.entries(originals)) process.env[k] = v;
  }
});

// ─── Custom Formulieren ──────────────────────────────────────────────────────

function parseForm(row) {
  if (!row) return null;
  return {
    ...row,
    settings: safeJson(row.settings, {}),
    schema:   safeJson(row.schema,   { pages: [{ id: 'p1', title: 'Pagina 1', fields: [] }] }),
  };
}
function safeJson(s, fb) { try { return JSON.parse(s); } catch (_) { return fb; } }
function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'formulier';
}
function uniqueFormSlug(db, base, ignoreId) {
  let slug = base, n = 1;
  while (true) {
    const row = db.prepare('SELECT id FROM forms WHERE slug = ?').get(slug);
    if (!row || row.id === ignoreId) return slug;
    n += 1; slug = `${base}-${n}`;
  }
}

// GET /api/admin/forms — overzicht
router.get('/forms', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT f.id, f.slug, f.name, f.description, f.status, f.created_at,
           (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) AS response_count
      FROM forms f
     ORDER BY f.created_at DESC
  `).all();
  res.json(rows);
});

// GET /api/admin/forms/:id — volledig formulier (incl. schema)
router.get('/forms/:id', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Formulier niet gevonden' });
  res.json(parseForm(row));
});

// POST /api/admin/forms — nieuw formulier
router.post('/forms', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const { name = 'Nieuw formulier', description = '' } = req.body || {};
  const slug = uniqueFormSlug(db, slugify(name));
  const info = db.prepare(`
    INSERT INTO forms (slug, name, description, status, settings, schema)
    VALUES (?, ?, ?, 'draft',
      json('{"verify_email":true,"verify_machine":true,"one_per_email":true,"confirm_email":true,"success_message":"Bedankt voor je inzending!","redirect_url":"","notify_email":""}'),
      json('{"pages":[{"id":"p1","title":"Pagina 1","fields":[]}]}'))
  `).run(slug, name, description);
  const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(parseForm(row));
});

// PUT /api/admin/forms/:id
router.put('/forms/:id', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Formulier niet gevonden' });

  const { name, description, status, settings, schema, slug } = req.body || {};
  const newSlug = slug ? uniqueFormSlug(db, slugify(slug), Number(req.params.id)) : existing.slug;

  db.prepare(`
    UPDATE forms
       SET name        = COALESCE(?, name),
           description = COALESCE(?, description),
           status      = COALESCE(?, status),
           settings    = COALESCE(?, settings),
           schema      = COALESCE(?, schema),
           slug        = ?
     WHERE id = ?
  `).run(
    name        ?? null,
    description ?? null,
    status      ?? null,
    settings    !== undefined ? JSON.stringify(settings) : null,
    schema      !== undefined ? JSON.stringify(schema)   : null,
    newSlug,
    req.params.id,
  );

  const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  res.json(parseForm(row));
});

// DELETE /api/admin/forms/:id
router.delete('/forms/:id', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM forms WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Formulier niet gevonden' });
  res.json({ ok: true });
});

// GET /api/admin/forms/:id/responses
router.get('/forms/:id/responses', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const formRow = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  if (!formRow) return res.status(404).json({ error: 'Formulier niet gevonden' });
  const rows = db.prepare(`
    SELECT r.id, r.submitted_at, r.answers, r.comment,
           fr.email, fr.name, fr.phone, fr.machine_id, fr.verified
      FROM form_responses r
      LEFT JOIN form_registrations fr ON fr.id = r.registration_id
     WHERE r.form_id = ?
     ORDER BY r.submitted_at DESC
  `).all(req.params.id);
  res.json({
    form:      parseForm(formRow),
    responses: rows.map(r => ({ ...r, answers: safeJson(r.answers, {}) })),
  });
});

// DELETE /api/admin/forms/:id/responses/:respId
router.delete('/forms/:id/responses/:respId', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM form_responses WHERE id = ? AND form_id = ?').run(req.params.respId, req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/forms/:id/export.csv
router.get('/forms/:id/export.csv', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const formRow = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
  if (!formRow) return res.status(404).json({ error: 'Formulier niet gevonden' });
  const form = parseForm(formRow);

  const fields = [];
  for (const p of (form.schema.pages || [])) for (const f of (p.fields || [])) fields.push(f);

  const rows = db.prepare(`
    SELECT r.id, r.submitted_at, r.answers, r.comment,
           fr.email, fr.name, fr.phone
      FROM form_responses r
      LEFT JOIN form_registrations fr ON fr.id = r.registration_id
     WHERE r.form_id = ?
     ORDER BY r.submitted_at ASC
  `).all(req.params.id);

  const header = ['Id', 'Ingediend op', 'Naam', 'E-mail', 'Telefoon', ...fields.map(f => f.label || f.id), 'Opmerking'];
  const lines  = [header.map(csvCell).join(',')];

  for (const r of rows) {
    const answers = safeJson(r.answers, {});
    const cells = [r.id, r.submitted_at, r.name || '', r.email || '', r.phone || ''];
    for (const f of fields) {
      const v = answers[f.id];
      cells.push(stringifyAnswer(v));
    }
    cells.push(r.comment || '');
    lines.push(cells.map(csvCell).join(','));
  }

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${form.slug}-responses.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function stringifyAnswer(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0].title) {
      return v.map(t => `${t.artist} – ${t.title}`).join(' | ');
    }
    return v.join(', ');
  }
  if (typeof v === 'object' && v.title) return `${v.artist} – ${v.title}`;
  return String(v);
}

module.exports = router;
