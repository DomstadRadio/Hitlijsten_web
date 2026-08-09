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
 *
 * GET  /api/admin/no-voters/:listId                           — aangemeld maar niet gestemd
 * POST /api/admin/no-voters/:regId/remind                     — stuur herinnering aan één persoon
 * POST /api/admin/no-voters/:listId/remind-next               — stuur herinnering aan volgende die nog geen mail kreeg
 */

const express     = require('express');
const fs          = require('fs');
const path        = require('path');
const { getDb }   = require('../db/database');
const { requireAuth, requirePerm } = require('./auth');
const playitSync  = require('../services/playit-sync');
const { sendMail, sendVoteApprovedEmail, sendNoVoteReminderEmail } = require('../services/email');
const { getArtwork } = require('../services/artwork');
const { reloadSchedules } = require('../services/scheduler');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { logAction } = require('../utils/audit');

const router = express.Router();

// Helper: voeg een externe track (PlayIt/Spotify) in list_tracks in als die er nog niet is
function upsertListTrack(db, listId, track) {
  const { external_id, source, title, artist, album, cover_url, year } = track;
  let lt = db.prepare('SELECT id FROM list_tracks WHERE list_id = ? AND external_id = ? AND source = ?')
    .get(listId, external_id, source || 'playit');
  if (!lt) {
    const info = db.prepare(`
      INSERT INTO list_tracks (list_id, external_id, source, title, artist, album, cover_url, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(listId, external_id, source || 'playit', title, artist, album || null, cover_url || null, year || null);
    lt = { id: info.lastInsertRowid };
  }
  return lt.id;
}

// Alle admin routes vereisen minimaal authenticatie
router.use(requireAuth);

// GET /api/admin/submissions/:listId?status=pending|approved|rejected
router.get('/submissions/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let approvedFilter = '';
  if (status === 'pending')  approvedFilter = 'AND r.approved IS NULL';
  if (status === 'approved') approvedFilter = 'AND r.approved = 1';
  // Toon inzendingen die volledig afgewezen zijn, OF waarvoor minstens één track afgewezen is
  if (status === 'rejected') approvedFilter = `AND (
      r.approved = 0
      OR EXISTS (SELECT 1 FROM votes vr WHERE vr.registration_id = r.id AND vr.approved = 0)
    )`;

  const submissions = db.prepare(`
    SELECT
      r.id, r.email, r.name, r.phone, r.verified, r.approved, r.comment, r.machine_id, r.created_at,
      COUNT(v.id) AS vote_count
    FROM registrations r
    LEFT JOIN votes v ON v.registration_id = r.id
    WHERE r.list_id = ? AND r.verified = 1 ${approvedFilter}
    GROUP BY r.id
    HAVING COUNT(v.id) > 0
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
  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// PUT /api/admin/submissions/:regId/tracks/:voteId/replace — vervang track door andere listtrack
router.put('/submissions/:regId/tracks/:voteId/replace', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const { list_track_id, track } = req.body;
  if (!list_track_id && !track) return res.status(400).json({ error: 'list_track_id of track vereist' });

  const vote = db.prepare(`
    SELECT v.id, v.registration_id, r.list_id
    FROM votes v JOIN registrations r ON r.id = v.registration_id
    WHERE v.id = ? AND v.registration_id = ?
  `).get(req.params.voteId, req.params.regId);
  if (!vote) return res.status(404).json({ error: 'Stem niet gevonden' });

  const trackId = list_track_id || upsertListTrack(db, vote.list_id, track);
  const newTrack = db.prepare('SELECT id FROM list_tracks WHERE id = ? AND list_id = ?')
    .get(trackId, vote.list_id);
  if (!newTrack) return res.status(404).json({ error: 'Track niet in deze lijst' });

  db.prepare('UPDATE votes SET track_id = ?, approved = NULL WHERE id = ?').run(trackId, vote.id);
  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  republishChart(vote.list_id);
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/tracks/add — voeg een extra track toe aan een inzending
router.post('/submissions/:regId/tracks/add', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const { list_track_id, track } = req.body;
  if (!list_track_id && !track) return res.status(400).json({ error: 'list_track_id of track vereist' });

  const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Inzending niet gevonden' });

  const trackId = list_track_id || upsertListTrack(db, reg.list_id, track);
  const lt = db.prepare('SELECT id FROM list_tracks WHERE id = ? AND list_id = ?')
    .get(trackId, reg.list_id);
  if (!lt) return res.status(404).json({ error: 'Track niet in deze lijst' });

  const exists = db.prepare('SELECT id FROM votes WHERE registration_id = ? AND track_id = ?')
    .get(req.params.regId, trackId);
  if (exists) return res.status(409).json({ error: 'Track al ingediend door deze stemmer' });

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM votes WHERE registration_id = ?')
    .get(req.params.regId).m;

  db.prepare(`
    INSERT INTO votes (registration_id, list_id, track_id, position, approved)
    VALUES (?, ?, ?, ?, NULL)
  `).run(req.params.regId, reg.list_id, trackId, maxPos + 1);

  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// GET /api/admin/list-tracks-search/:listId?q= — zoek in bestaande list tracks (voor vervang-dropdown)
router.get('/list-tracks-search/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id AS list_track_id, external_id, source, title, artist, cover_url, year
    FROM list_tracks
    WHERE list_id = ? AND (LOWER(title) LIKE ? OR LOWER(artist) LIKE ?)
    ORDER BY title ASC LIMIT 30
  `).all(req.params.listId, like, like);
  res.json(rows);
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
  const reg = db.prepare('SELECT r.list_id, r.email, r.name, l.name AS list_name FROM registrations r JOIN lists l ON l.id=r.list_id WHERE r.id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE registrations SET approved = 1 WHERE id = ?')
    .run(req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Niet gevonden' });
  logAction({ actor: req.user?.username, action: 'submission.approve', list_id: reg.list_id, target: reg.email, detail: { list: reg.list_name, name: reg.name } });
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/reject
router.post('/submissions/:regId/reject', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT r.list_id, r.email, r.name, l.name AS list_name FROM registrations r JOIN lists l ON l.id=r.list_id WHERE r.id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Niet gevonden' });
  const changes = db.prepare('UPDATE registrations SET approved = 0 WHERE id = ?')
    .run(req.params.regId).changes;
  if (!changes) return res.status(404).json({ error: 'Niet gevonden' });
  logAction({ actor: req.user?.username, action: 'submission.reject', list_id: reg.list_id, target: reg.email, detail: { list: reg.list_name, name: reg.name } });
  republishChart(reg.list_id);
  res.json({ ok: true });
});

// POST /api/admin/submissions/:regId/reset — terugzetten naar wacht op goedkeuring
router.post('/submissions/:regId/reset', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const reg = db.prepare('SELECT r.list_id, r.email, l.name AS list_name FROM registrations r JOIN lists l ON l.id=r.list_id WHERE r.id = ?').get(req.params.regId);
  db.prepare('UPDATE registrations SET approved = NULL WHERE id = ?').run(req.params.regId);
  if (reg) {
    logAction({ actor: req.user?.username, action: 'submission.reset', list_id: reg.list_id, target: reg.email, detail: { list: reg.list_name } });
    republishChart(reg.list_id);
  }
  res.json({ ok: true });
});

// GET /api/admin/stats/:listId — tellingen per status
router.get('/stats/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE verified = 1 AND vote_count > 0)                      AS total,
      COUNT(*) FILTER (WHERE verified = 1 AND vote_count > 0 AND approved IS NULL) AS pending,
      COUNT(*) FILTER (WHERE verified = 1 AND vote_count > 0 AND approved = 1)     AS approved,
      COUNT(*) FILTER (WHERE verified = 1 AND vote_count > 0 AND approved = 0)     AS rejected
    FROM (
      SELECT r.approved, r.verified, COUNT(v.id) AS vote_count
      FROM registrations r
      LEFT JOIN votes v ON v.registration_id = r.id
      WHERE r.list_id = ?
      GROUP BY r.id
    )
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

  const list = db.prepare('SELECT id, name, slug, max_votes, score_rules FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const approvedFilter = includeAll
    ? ''
    : 'AND r.approved = 1 AND (v.approved IS NULL OR v.approved = 1)';

  // Haal raw stemmen op
  const rawVotes = db.prepare(`
    SELECT v.track_id, v.position, v.registration_id
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    WHERE v.list_id = ? ${approvedFilter}
  `).all(listId);

  const adjustments = db.prepare(
    'SELECT id, score_adjustment FROM list_tracks WHERE list_id = ?'
  ).all(listId);
  const adjustMap = new Map(adjustments.map(a => [a.id, a.score_adjustment || 0]));

  // Score per track berekenen
  const scoreMap = aggregateScores(rawVotes, list.max_votes, list.score_rules);

  // Track-metadata ophalen
  const allTracks = db.prepare(`
    SELECT lt.id AS track_id, lt.title, lt.artist, lt.album, lt.cover_url,
           lt.year AS release_year, lt.score_adjustment
    FROM list_tracks lt
    WHERE lt.list_id = ?
    ORDER BY lt.artist, lt.title
  `).all(listId);

  // Bouw gecombineerde lijst
  const combined = allTracks.map(lt => {
    const s = scoreMap.get(lt.track_id) || { score: 0, vote_count: 0 };
    return {
      ...lt,
      score:      s.score + (adjustMap.get(lt.track_id) || 0),
      vote_count: s.vote_count,
    };
  }).sort((a, b) => b.score - a.score || b.vote_count - a.vote_count || a.artist.localeCompare(b.artist));

  const limited = limit > 0 ? combined.slice(0, limit) : combined;

  // Totalen
  const totalsRow = db.prepare(`
    SELECT
      COUNT(DISTINCT v.registration_id) AS total_voters,
      COUNT(*)                          AS total_votes
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    WHERE v.list_id = ? ${approvedFilter}
  `).get(listId);

  res.json({
    list: { id: list.id, name: list.name, slug: list.slug, max_votes: list.max_votes,
            score_rules: list.score_rules || null },
    includeAll,
    totals: totalsRow,
    chart: limited.map((row, i) => ({ position: i + 1, ...row })),
  });
});

// ── PlayIt sync ──────────────────────────────────────────────────────────────

// POST /api/admin/lists/:listId/artwork-sync — haal albumhoezen op via iTunes/Last.fm (SSE stream)
router.post('/lists/:listId/artwork-sync', ...requirePerm('tracks'), async (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  const { overwrite = false } = req.body;

  const tracks = overwrite
    ? db.prepare('SELECT id, artist, title FROM list_tracks WHERE list_id = ?').all(listId)
    : db.prepare('SELECT id, artist, title FROM list_tracks WHERE list_id = ? AND (cover_url IS NULL OR cover_url = \'\')').all(listId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sse = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  sse({ type: 'start', total: tracks.length });
  let found = 0, skipped = 0;

  for (const t of tracks) {
    const url = await getArtwork(t.artist, t.title);
    if (url) {
      db.prepare('UPDATE list_tracks SET cover_url = ? WHERE id = ?').run(url, t.id);
      found++;
      sse({ type: 'found', found, skipped, total: tracks.length, artist: t.artist, title: t.title });
    } else {
      skipped++;
      sse({ type: 'miss', found, skipped, total: tracks.length, artist: t.artist, title: t.title });
    }
    // Korte pauze om rate limits te vermijden
    await sleep(300);
  }

  sse({ type: 'done', found, skipped, total: tracks.length });
  res.end();
});

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
 * Bereken de score voor één stem op positie `position`.
 * @param {number} position  1-based positie
 * @param {number} maxVotes  aantal keuzes op de lijst
 * @param {string|null} scoreRulesJson  JSON-array, bijv. "[10,7,5,3,1]"
 * @returns {number}
 */
function calcVoteScore(position, maxVotes, scoreRulesJson) {
  let rules = null;
  try { if (scoreRulesJson) rules = JSON.parse(scoreRulesJson); } catch (_) {}
  if (Array.isArray(rules) && rules.length > 0) {
    return Number(rules[position - 1]) || 0;
  }
  // Standaard-formule
  if (maxVotes === 1) return 1;
  const s = maxVotes + 1 - position;
  return s < 0 ? 0 : s;
}

/**
 * Bereken scores per track vanuit ruwe stemrijen.
 * @param {{track_id, position}[]} voteRows
 * @param {number} maxVotes
 * @param {string|null} scoreRulesJson
 * @returns {Map<number, {score:number, vote_count:number}>}
 */
function aggregateScores(voteRows, maxVotes, scoreRulesJson) {
  const map = new Map();
  for (const row of voteRows) {
    const s = calcVoteScore(row.position, maxVotes, scoreRulesJson);
    if (!map.has(row.track_id)) map.set(row.track_id, { score: 0, vote_count: 0 });
    const e = map.get(row.track_id);
    e.score      += s;
    e.vote_count += 1;
  }
  return map;
}

/**
 * Herbereken en sla chart op voor een lijst op basis van alle goedgekeurde stemmen.
 * Stille functie: logt alleen fouten, gooit nooit.
 */
function republishChart(listId) {
  try {
    const db   = getDb();
    const list = db.prepare('SELECT id, max_votes, score_rules FROM lists WHERE id = ?').get(listId);
    if (!list) return;

    const { week, year } = currentISOWeek();

    const voteRows = db.prepare(`
      SELECT v.track_id, v.position
      FROM votes v
      JOIN registrations r ON r.id = v.registration_id
      WHERE v.list_id = ? AND r.approved = 1
        AND (v.approved IS NULL OR v.approved = 1)
    `).all(listId);

    if (voteRows.length === 0) return;

    const adjustments = db.prepare(
      'SELECT id, score_adjustment FROM list_tracks WHERE list_id = ?'
    ).all(listId);
    const adjustMap = new Map(adjustments.map(a => [a.id, a.score_adjustment || 0]));

    const scoreMap = aggregateScores(voteRows, list.max_votes, list.score_rules);

    const results = [...scoreMap.entries()].map(([track_id, s]) => ({
      track_id,
      score:      s.score + (adjustMap.get(track_id) || 0),
      vote_count: s.vote_count,
    })).sort((a, b) => b.score - a.score || b.vote_count - a.vote_count).slice(0, 100);

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
  const list   = db.prepare('SELECT id, max_votes, score_rules FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { week, year } = currentISOWeek();

  const voteRows = db.prepare(`
    SELECT v.track_id, v.position
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    WHERE v.list_id = ? AND r.approved = 1
      AND (v.approved IS NULL OR v.approved = 1)
  `).all(listId);

  if (voteRows.length === 0) {
    return res.status(400).json({ error: 'Geen goedgekeurde stemmen gevonden voor deze lijst' });
  }

  const adjustments = db.prepare(
    'SELECT id, score_adjustment FROM list_tracks WHERE list_id = ?'
  ).all(listId);
  const adjustMap = new Map(adjustments.map(a => [a.id, a.score_adjustment || 0]));

  const scoreMap = aggregateScores(voteRows, list.max_votes, list.score_rules);

  const results = [...scoreMap.entries()].map(([track_id, s]) => ({
    track_id,
    score:      s.score + (adjustMap.get(track_id) || 0),
    vote_count: s.vote_count,
  })).sort((a, b) => b.score - a.score || b.vote_count - a.vote_count).slice(0, 100);

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

  logAction({ actor: req.user?.username, action: 'chart.publish', list_id: listId, target: list.name || String(listId), detail: { week, year, trackCount: results.length } });
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

// ── Niet-stemmers (aangemeld maar geen stem uitgebracht) ─────────────────────

// POST /api/admin/voters/:listId/broadcast — verstuur een mail naar alle (gestemmende) deelnemers
// GET /api/admin/lists/:listId/registrations/export.csv
router.get('/lists/:listId/registrations/export.csv', ...requirePerm('voters'), (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(Number(req.params.listId));
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const rows = db.prepare(`
    SELECT name, email, phone, created_at, verified, approved
      FROM registrations
     WHERE list_id = ? AND verified = 1
     ORDER BY name COLLATE NOCASE ASC
  `).all(list.id);

  const header = ['Naam', 'E-mail', 'Telefoon', 'Aangemeld op', 'Geverifieerd', 'Goedgekeurd'];
  const lines  = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.name    || '',
      r.email   || '',
      r.phone   || '',
      r.created_at || '',
      r.verified  ? 'Ja' : 'Nee',
      r.approved === 1 ? 'Ja' : r.approved === 0 ? 'Nee' : '',
    ].map(csvCell).join(','));
  }

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${list.slug}-deelnemers.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

router.post('/voters/:listId/broadcast', ...requirePerm('submissions'), async (req, res) => {
  const db = getDb();
  const listId = Number(req.params.listId);
  const { subject, html, batchSize = 2, delayMs = 2000, filter = 'voted' } = req.body;

  if (!subject || !html) return res.status(400).json({ error: 'subject en html zijn verplicht' });

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const extraFilter = filter === 'all'
    ? ''
    : 'AND EXISTS (SELECT 1 FROM votes v WHERE v.registration_id = r.id)';
  const voters = db.prepare(`
    SELECT r.id, r.email, r.name
    FROM registrations r
    WHERE r.list_id = ? AND r.verified = 1 AND r.email IS NOT NULL AND r.email != ''
    ${extraFilter}
    ORDER BY r.created_at ASC
  `).all(listId);

  // SSE streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sse = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const total = voters.length;
  sse({ type: 'start', total });

  let sent = 0, failed = 0;
  const bs    = Math.max(1, Math.min(Number(batchSize) || 2, 10));
  const delay = Math.max(500, Math.min(Number(delayMs)  || 2000, 30000));

  const fill = (str, name) => (str || '')
    .replace(/\{\{naam\}\}/gi,  name        || 'stemmer')
    .replace(/\{\{lijst\}\}/gi, list.name   || '');

  for (let i = 0; i < voters.length; i += bs) {
    const batch = voters.slice(i, i + bs);
    await Promise.all(batch.map(async (v) => {
      try {
        await sendMail({ to: v.email, subject: fill(subject, v.name), html: fill(html, v.name) });
        sent++;
        sse({ type: 'progress', sent, failed, total, email: v.email, name: v.name });
      } catch (err) {
        failed++;
        sse({ type: 'error', sent, failed, total, email: v.email, error: err.message });
      }
    }));
    if (i + bs < voters.length) await sleep(delay);
  }

  sse({ type: 'done', sent, failed, total });
  res.end();
});


/**
 * GET /api/admin/no-voters/:listId
 * Geeft alle geverifieerde registraties terug die GEEN enkele stem hebben
 * uitgebracht. Inclusief of er al een herinnering gestuurd is (reminder_sent_at).
 */
router.get('/no-voters/:listId', ...requirePerm('submissions'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.email, r.name, r.created_at, r.reminder_sent_at
    FROM registrations r
    WHERE r.list_id = ?
      AND r.verified = 1
      AND NOT EXISTS (
        SELECT 1 FROM votes v WHERE v.registration_id = r.id
      )
    ORDER BY r.reminder_sent_at IS NOT NULL ASC, r.created_at ASC
  `).all(req.params.listId);
  res.json(rows);
});

/**
 * POST /api/admin/no-voters/:regId/remind
 * Stuur een herinnerings-e-mail aan één specifieke niet-stemmer.
 * Kan altijd opnieuw gestuurd worden (ook als al eerder verstuurd).
 */
router.post('/no-voters/:regId/remind', ...requirePerm('submissions'), async (req, res) => {
  const db  = getDb();
  const reg = db.prepare(`
    SELECT r.*, l.name AS list_name, l.slug AS list_slug, l.domain AS list_domain,
           l.reminder_subject, l.reminder_html
    FROM registrations r
    JOIN lists l ON l.id = r.list_id
    WHERE r.id = ?
  `).get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Registratie niet gevonden' });

  // Controleer: heeft deze persoon nog steeds geen stem?
  const hasVote = db.prepare('SELECT 1 FROM votes WHERE registration_id = ?').get(reg.id);
  if (hasVote) return res.status(400).json({ error: 'Deze persoon heeft al gestemd.' });

  const frontendUrl = process.env.FRONTEND_URL || `https://${reg.list_domain || 'domstadradio.nl'}`;
  const voteUrl = reg.verify_token
    ? `${frontendUrl}/stem/${reg.list_slug}/stemmen/${reg.verify_token}`
    : `${frontendUrl}/stem/${reg.list_slug}`;

  try {
    await sendNoVoteReminderEmail({
      to: reg.email, name: reg.name, listName: reg.list_name, voteUrl,
      customSubject: reg.reminder_subject || null,
      customHtml:    reg.reminder_html    || null,
    });
    db.prepare('UPDATE registrations SET reminder_sent_at = datetime(\'now\') WHERE id = ?').run(reg.id);
    res.json({ ok: true, email: reg.email });
  } catch (e) {
    res.status(500).json({ error: 'E-mail sturen mislukt: ' + e.message });
  }
});

/**
 * POST /api/admin/no-voters/:listId/remind-next
 * Automatische modus: stuur ONE herinnering aan de eerstvolgende niet-stemmer
 * die nog GEEN herinnering heeft ontvangen (reminder_sent_at IS NULL).
 * Geeft { ok: true, email, remaining } terug, of { done: true } als iedereen al gemaild is.
 */
router.post('/no-voters/:listId/remind-next', ...requirePerm('submissions'), async (req, res) => {
  const db = getDb();
  const reg = db.prepare(`
    SELECT r.*, l.name AS list_name, l.slug AS list_slug, l.domain AS list_domain,
           l.reminder_subject, l.reminder_html
    FROM registrations r
    JOIN lists l ON l.id = r.list_id
    WHERE r.list_id = ?
      AND r.verified = 1
      AND r.reminder_sent_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.registration_id = r.id)
    ORDER BY r.created_at ASC
    LIMIT 1
  `).get(req.params.listId);

  if (!reg) return res.json({ done: true, remaining: 0 });

  const frontendUrl = process.env.FRONTEND_URL || `https://${reg.list_domain || 'domstadradio.nl'}`;
  const voteUrl = reg.verify_token
    ? `${frontendUrl}/stem/${reg.list_slug}/stemmen/${reg.verify_token}`
    : `${frontendUrl}/stem/${reg.list_slug}`;

  try {
    await sendNoVoteReminderEmail({
      to: reg.email, name: reg.name, listName: reg.list_name, voteUrl,
      customSubject: reg.reminder_subject || null,
      customHtml:    reg.reminder_html    || null,
    });
    db.prepare('UPDATE registrations SET reminder_sent_at = datetime(\'now\') WHERE id = ?').run(reg.id);

    const remaining = db.prepare(`
      SELECT COUNT(*) AS c FROM registrations r
      WHERE r.list_id = ? AND r.verified = 1 AND r.reminder_sent_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.registration_id = r.id)
    `).get(req.params.listId).c;

    res.json({ ok: true, email: reg.email, remaining });
  } catch (e) {
    res.status(500).json({ error: 'E-mail sturen mislukt: ' + e.message });
  }
});

// ── Feature 1: Stemmers verwijderen / blokkeren ───────────────────────────────

/**
 * DELETE /api/admin/registrations/:regId
 * Verwijder een stemmer (registratie + stemmen) volledig.
 */
router.delete('/registrations/:regId', ...requirePerm('blocks'), (req, res) => {
  const db  = getDb();
  const reg = db.prepare('SELECT r.*, l.name AS list_name FROM registrations r JOIN lists l ON l.id=r.list_id WHERE r.id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Stemmer niet gevonden' });

  db.prepare('DELETE FROM registrations WHERE id = ?').run(reg.id);
  logAction({ actor: req.user?.username, action: 'voter.delete', list_id: reg.list_id, target: reg.email, detail: { name: reg.name, list: reg.list_name } });
  republishChart(reg.list_id);
  res.json({ ok: true });
});

/**
 * POST /api/admin/registrations/:regId/block
 * Blokkeer een stemmer: voeg email + machine_id toe aan blocked_voters, verwijder optioneel de registratie.
 * Body: { reason?: string, deleteReg?: boolean }
 */
router.post('/registrations/:regId/block', ...requirePerm('blocks'), (req, res) => {
  const db  = getDb();
  const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(req.params.regId);
  if (!reg) return res.status(404).json({ error: 'Stemmer niet gevonden' });

  const { reason = '', deleteReg = true } = req.body;

  // Voeg toe aan blokkeerlijst
  db.prepare(`
    INSERT OR IGNORE INTO blocked_voters (list_id, email, machine_id, reason)
    VALUES (?, ?, ?, ?)
  `).run(reg.list_id, reg.email || null, reg.machine_id || null, reason);

  if (deleteReg) {
    db.prepare('DELETE FROM registrations WHERE id = ?').run(reg.id);
    republishChart(reg.list_id);
  }

  logAction({ actor: req.user?.username, action: 'voter.block', list_id: reg.list_id, target: reg.email, detail: { name: reg.name, reason, deleteReg } });
  res.json({ ok: true });
});

/**
 * GET /api/admin/blocks/:listId
 * Haal alle blokkeringen op voor een lijst.
 */
router.get('/blocks/:listId', ...requirePerm('blocks'), (req, res) => {
  const db = getDb();
  const blocks = db.prepare(
    'SELECT * FROM blocked_voters WHERE list_id = ? ORDER BY blocked_at DESC'
  ).all(req.params.listId);
  res.json(blocks);
});

/**
 * DELETE /api/admin/blocks/:blockId
 * Verwijder een blokkering (deblokkeer).
 */
router.delete('/blocks/:blockId', ...requirePerm('blocks'), (req, res) => {
  const db = getDb();
  const b  = db.prepare('SELECT * FROM blocked_voters WHERE id = ?').get(req.params.blockId);
  if (!b) return res.status(404).json({ error: 'Blokkering niet gevonden' });
  db.prepare('DELETE FROM blocked_voters WHERE id = ?').run(b.id);
  logAction({ actor: req.user?.username, action: 'voter.unblock', list_id: b.list_id, target: b.email });
  res.json({ ok: true });
});

// ── Feature 2: Seizoensreset ───────────────────────────────────────────────

/**
 * POST /api/admin/season-reset/:listId
 * Verwijder alle stemmen en stemmers voor een lijst, maar behoud chart_history en list_tracks.
 * Body: { confirm: true }
 */
router.post('/season-reset/:listId', ...requirePerm('reset'), (req, res) => {
  if (!req.body?.confirm) {
    return res.status(400).json({ error: 'Bevestiging vereist: stuur { confirm: true }' });
  }

  const db     = getDb();
  const listId = Number(req.params.listId);
  const list   = db.prepare('SELECT id, name FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { changes: voteChanges }  = db.prepare('DELETE FROM votes         WHERE list_id = ?').run(listId);
  const { changes: regChanges  }  = db.prepare('DELETE FROM registrations WHERE list_id = ?').run(listId);
  // Reset reminder-tellingen zijn al weg door cascades; score_adjustment blijft bewust staan.

  console.log(`[season-reset] Lijst "${list.name}" gereset: ${voteChanges} stemmen, ${regChanges} stemmers verwijderd.`);
  logAction({ actor: req.user?.username, action: 'season.reset', list_id: listId, target: list.name, detail: { votesDeleted: voteChanges, registrationsDeleted: regChanges } });
  res.json({ ok: true, votesDeleted: voteChanges, registrationsDeleted: regChanges });
});

// ── Feature 3: Score-aanpassing per track ─────────────────────────────────

/**
 * PATCH /api/admin/tracks/:trackId/score-adjustment
 * Stel een handmatige score-bonus/-malus in voor een track.
 * Body: { adjustment: number }
 */
router.patch('/tracks/:trackId/score-adjustment', ...requirePerm('scoring'), (req, res) => {
  const db      = getDb();
  const trackId = Number(req.params.trackId);
  const track   = db.prepare('SELECT id, list_id FROM list_tracks WHERE id = ?').get(trackId);
  if (!track) return res.status(404).json({ error: 'Track niet gevonden' });

  const adjustment = Number(req.body?.adjustment ?? 0);
  if (isNaN(adjustment)) return res.status(400).json({ error: 'Ongeldige waarde' });

  db.prepare('UPDATE list_tracks SET score_adjustment = ? WHERE id = ?').run(adjustment, trackId);
  republishChart(track.list_id);
  res.json({ ok: true, adjustment });
});

/**
 * PUT /api/admin/lists/:listId/score-rules
 * Sla score-regels op voor een lijst (JSON array van punten per positie).
 * Body: { rules: [10, 7, 5, 3, 1] }
 */
router.put('/lists/:listId/score-rules', ...requirePerm('scoring'), (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  const list   = db.prepare('SELECT id FROM lists WHERE id = ?').get(listId);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { rules } = req.body;
  if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules moet een array zijn' });
  if (rules.some(r => typeof r !== 'number' || isNaN(r))) {
    return res.status(400).json({ error: 'Alle waarden moeten getallen zijn' });
  }

  const json = rules.length === 0 ? null : JSON.stringify(rules);
  db.prepare('UPDATE lists SET score_rules = ? WHERE id = ?').run(json, listId);
  republishChart(listId);
  res.json({ ok: true, score_rules: json });
});

/**
 * PUT /api/admin/lists/:listId/publish-schedule
 * Stel automatisch publiceer-schema in. Body: { cron: "0 7 * * 5" } of { cron: "" } om uit te zetten.
 */
router.put('/lists/:listId/publish-schedule', ...requirePerm('chart'), (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  if (!db.prepare('SELECT id FROM lists WHERE id = ?').get(listId)) {
    return res.status(404).json({ error: 'Lijst niet gevonden' });
  }
  const cronExpr = (req.body.cron || '').trim() || null;
  if (cronExpr && !require('node-cron').validate(cronExpr)) {
    return res.status(400).json({ error: 'Ongeldig cron-schema' });
  }
  db.prepare('UPDATE lists SET auto_publish_cron = ? WHERE id = ?').run(cronExpr, listId);
  reloadSchedules();
  res.json({ ok: true, auto_publish_cron: cronExpr });
});

/**
 * PUT /api/admin/lists/:listId/voting-pause
 * Pauzeer of hervat stemmen. Body: { paused: true/false, message: "..." }
 */
router.put('/lists/:listId/voting-pause', ...requirePerm('lists'), (req, res) => {
  const db     = getDb();
  const listId = Number(req.params.listId);
  if (!db.prepare('SELECT id FROM lists WHERE id = ?').get(listId)) {
    return res.status(404).json({ error: 'Lijst niet gevonden' });
  }
  const paused  = req.body.paused ? 1 : 0;
  const message = (req.body.message || '').trim() || null;
  db.prepare('UPDATE lists SET voting_paused = ?, voting_paused_message = ? WHERE id = ?').run(paused, message, listId);
  res.json({ ok: true, voting_paused: paused, voting_paused_message: message });
});

// ── Radioprogramma's ────────────────────────────────────────────────────────

router.get('/programs', ...requirePerm('forms'), (req, res) => {
  res.json(getDb().prepare('SELECT * FROM programs ORDER BY name ASC').all());
});

router.post('/programs', ...requirePerm('forms'), (req, res) => {
  const { name, email, description, active = 1 } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Naam en e-mail zijn verplicht' });
  const info = getDb().prepare(
    'INSERT INTO programs (name, email, description, active) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), email.trim(), description || null, active ? 1 : 0);
  res.status(201).json(getDb().prepare('SELECT * FROM programs WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/programs/:id', ...requirePerm('forms'), (req, res) => {
  const db = getDb();
  const p  = db.prepare('SELECT * FROM programs WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Programma niet gevonden' });
  const { name, email, description, active } = req.body || {};
  db.prepare('UPDATE programs SET name=?, email=?, description=?, active=? WHERE id=?').run(
    name        !== undefined ? name.trim()        : p.name,
    email       !== undefined ? email.trim()       : p.email,
    description !== undefined ? (description || null) : p.description,
    active      !== undefined ? (active ? 1 : 0)  : p.active,
    p.id
  );
  res.json(db.prepare('SELECT * FROM programs WHERE id = ?').get(p.id));
});

router.delete('/programs/:id', ...requirePerm('forms'), (req, res) => {
  const info = getDb().prepare('DELETE FROM programs WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Programma niet gevonden' });
  res.json({ ok: true });
});

// ── Audit log ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-log
 * Pagineerde audit log. Alleen voor gebruikers met 'audit' of '*' permissie.
 * Query: ?listId=&action=&page=&limit=&since=
 */
router.get('/audit-log', ...requirePerm('audit'), (req, res) => {
  const db = getDb();
  const { listId, action, since } = req.query;
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const wheres = [];
  const params = [];

  if (listId) { wheres.push('a.list_id = ?'); params.push(Number(listId)); }
  if (action) { wheres.push('a.action = ?');  params.push(action); }
  if (since)  { wheres.push('a.ts >= ?');     params.push(since); }

  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${where}`).get(...params).n;
  const rows  = db.prepare(`
    SELECT a.id, a.ts, a.actor, a.action, a.list_id, a.target, a.detail,
           l.name AS list_name
    FROM audit_log a
    LEFT JOIN lists l ON l.id = a.list_id
    ${where}
    ORDER BY a.ts DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    total, page, limit,
    rows: rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })),
  });
});

module.exports = router;
