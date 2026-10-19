/**
 * Routes: hitlijsten beheer (admin).
 * POST   /api/lists              — nieuwe lijst aanmaken
 * GET    /api/lists              — alle lijsten ophalen
 * GET    /api/lists/:slug        — één lijst ophalen
 * PUT    /api/lists/:id          — lijst bijwerken (incl. thema)
 * DELETE /api/lists/:id          — lijst verwijderen
 * POST   /api/lists/:id/tracks   — track toevoegen aan lijst
 * DELETE /api/lists/:id/tracks/:trackId — track verwijderen
 * GET    /api/lists/:id/results  — stemresultaten
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAuth, requirePerm } = require('./auth');
const { logAction } = require('../utils/audit');

const router = express.Router();

// Multer voor achtergrondafbeeldingen
const uploadDir = path.resolve(
  __dirname, '../../',
  process.env.UPLOAD_PATH || './uploads'
);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `bg-${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

function calcVoteScore(position, maxVotes, scoreRulesJson) {
  let rules = null;
  try { if (scoreRulesJson) rules = JSON.parse(scoreRulesJson); } catch (_) {}
  if (Array.isArray(rules) && rules.length > 0) {
    return Number(rules[position - 1]) || 0;
  }
  if (maxVotes === 1) return 1;
  const s = maxVotes + 1 - position;
  return s < 0 ? 0 : s;
}

function aggregateScores(voteRows, maxVotes, scoreRulesJson) {
  const map = new Map();
  for (const row of voteRows) {
    const s = calcVoteScore(row.position, maxVotes, scoreRulesJson);
    if (!map.has(row.track_id)) map.set(row.track_id, { score: 0, vote_count: 0 });
    const e = map.get(row.track_id);
    e.score += s;
    e.vote_count += 1;
  }
  return map;
}

// ─── Lijsten ──────────────────────────────────────────────────

// GET /api/lists/by-domain?host=utrechtsetop100.nl
// Moet vóór /:slug staan zodat "by-domain" niet als slug wordt gelezen
router.get('/by-domain', (req, res) => {
  const host = (req.query.host || '').toLowerCase().replace(/^www\./, '');
  if (!host) return res.status(400).json({ error: 'host parameter ontbreekt' });

  const list = getDb()
    .prepare("SELECT slug FROM lists WHERE LOWER(TRIM(domain)) = ? AND status != 'draft'")
    .get(host);

  if (!list) return res.status(404).json({ error: 'Geen lijst gevonden voor dit domein' });
  res.json({ slug: list.slug });
});

// GET /api/lists
router.get('/', (req, res) => {
  const lists = getDb().prepare('SELECT * FROM lists ORDER BY created_at DESC').all();
  res.json(lists.map(l => ({
    ...l,
    theme: JSON.parse(l.theme || '{}'),
    score_rules: l.score_rules ? JSON.parse(l.score_rules) : null,
  })));
});

// GET /api/lists/:slug
router.get('/:slug', (req, res) => {
  const list = getDb()
    .prepare('SELECT * FROM lists WHERE slug = ?')
    .get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const tracks = getDb()
    .prepare("SELECT * FROM list_tracks WHERE list_id = ? AND moderation_status = 'approved' ORDER BY artist, title")
    .all(list.id);

  res.json({
    ...list,
    theme: JSON.parse(list.theme || '{}'),
    score_rules: list.score_rules ? JSON.parse(list.score_rules) : null,
    tracks,
  });
});

// POST /api/lists
router.post('/', ...requirePerm('lists'), upload.single('bg_image'), (req, res) => {
  const {
    name, slug, description, domain, max_votes, closes_at, theme, playit_group,
    redirect_url, privacy_url, voting_rules_text, voting_rules_required, max_tracks_per_artist,
  } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name en slug zijn verplicht' });

  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const themeJson = typeof theme === 'string' ? theme : JSON.stringify(theme || {});
  const bg_image  = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const info = getDb().prepare(`
      INSERT INTO lists (
        name, slug, description, domain, max_votes, closes_at, theme, bg_image,
        playit_group, redirect_url, privacy_url, voting_rules_text, voting_rules_required, max_tracks_per_artist
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slugClean, description || null, domain || null,
           Number(max_votes) || 10, closes_at || null, themeJson, bg_image,
           playit_group || null, redirect_url || null, privacy_url || null,
           voting_rules_text || null,
           voting_rules_required ? 1 : 0,
           Math.max(0, Number(max_tracks_per_artist) || 0));

    const list = getDb().prepare('SELECT * FROM lists WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ ...list, theme: JSON.parse(list.theme) });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Slug al in gebruik' });
    throw err;
  }
});

// PUT /api/lists/:id
router.put('/:id', ...requirePerm('lists'), upload.single('bg_image'), (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Niet gevonden' });

  const {
    name, description, domain, status, max_votes, closes_at, theme, playit_group, redirect_url,
    reminder_subject, reminder_html, privacy_url,
    voting_rules_text, voting_rules_required, max_tracks_per_artist,
  } = req.body;

  const bg_image  = req.file ? `/uploads/${req.file.filename}` : list.bg_image;
  const themeJson = theme
    ? (typeof theme === 'string' ? theme : JSON.stringify(theme))
    : list.theme;

  db.prepare(`
    UPDATE lists
    SET name=?, description=?, domain=?, status=?, max_votes=?, closes_at=?, theme=?, bg_image=?,
        playit_group=?, redirect_url=?, reminder_subject=?, reminder_html=?, privacy_url=?,
        voting_rules_text=?, voting_rules_required=?, max_tracks_per_artist=?
    WHERE id=?
  `).run(
    name ?? list.name,
    description ?? list.description,
    domain ?? list.domain,
    status ?? list.status,
    max_votes != null ? Number(max_votes) : list.max_votes,
    closes_at ?? list.closes_at,
    themeJson,
    bg_image,
    playit_group !== undefined ? (playit_group || null) : list.playit_group,
    redirect_url !== undefined ? (redirect_url || null) : list.redirect_url,
    reminder_subject !== undefined ? (reminder_subject || null) : list.reminder_subject,
    reminder_html    !== undefined ? (reminder_html    || null) : list.reminder_html,
    privacy_url      !== undefined ? (privacy_url      || null) : list.privacy_url,
    voting_rules_text !== undefined ? (voting_rules_text || null) : list.voting_rules_text,
    voting_rules_required !== undefined ? (voting_rules_required ? 1 : 0) : (list.voting_rules_required ? 1 : 0),
    max_tracks_per_artist !== undefined ? Math.max(0, Number(max_tracks_per_artist) || 0) : (Number(list.max_tracks_per_artist) || 0),
    list.id
  );

  const updated = db.prepare('SELECT * FROM lists WHERE id = ?').get(list.id);
  res.json({ ...updated, theme: JSON.parse(updated.theme) });
});

// DELETE /api/lists/:id
router.delete('/:id', ...requirePerm('lists'), (req, res) => {
  getDb().prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Tracks ───────────────────────────────────────────────────

// POST /api/lists/:id/tracks
router.post('/:id/tracks', ...requirePerm('tracks'), (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { source, external_id, title, artist, album, cover_url, preview_url, year } = req.body;
  if (!title || !artist) return res.status(400).json({ error: 'title en artist zijn verplicht' });

  const info = db.prepare(`
    INSERT INTO list_tracks (list_id, source, external_id, title, artist, album, cover_url, preview_url, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(list.id, source || 'manual', external_id || null, title, artist,
         album || null, cover_url || null, preview_url || null, year || null);

  res.status(201).json(db.prepare('SELECT * FROM list_tracks WHERE id = ?').get(info.lastInsertRowid));
});

// POST /api/lists/:id/tracks/bulk — meerdere tracks tegelijk importeren (bv. uit PlayIt groep)
router.post('/:id/tracks/bulk', ...requirePerm('tracks'), (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { tracks } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'tracks array is verplicht' });
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO list_tracks (list_id, source, external_id, title, artist, album, cover_url, preview_url, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  db.transaction(() => {
    for (const t of tracks) {
      if (!t.title || !t.artist) continue;
      const info = insert.run(list.id, t.source || 'playit', t.external_id || null,
        t.title, t.artist, t.album || null, t.cover_url || null, t.preview_url || null, t.year || null);
      if (info.changes > 0) added++;
    }
  })();

  res.json({ ok: true, added, total: tracks.length });
});

// DELETE /api/lists/:id/tracks/:trackId
router.delete('/:id/tracks/:trackId', ...requirePerm('tracks'), (req, res) => {
  const db = getDb();
  const track = db.prepare(`
    SELECT lt.artist, lt.title, l.name AS list_name
    FROM list_tracks lt JOIN lists l ON l.id = lt.list_id
    WHERE lt.id = ? AND lt.list_id = ?
  `).get(req.params.trackId, req.params.id);
  if (!track) return res.status(404).json({ error: 'Track niet gevonden' });
  const deletedVotes = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE track_id = ?').get(req.params.trackId).count;
  db.prepare('DELETE FROM list_tracks WHERE id = ? AND list_id = ?').run(req.params.trackId, req.params.id);
  logAction({
    actor: req.user?.username, action: 'track.delete', list_id: Number(req.params.id),
    target: `${track.artist} - ${track.title}`,
    detail: { list: track.list_name, votesDeleted: deletedVotes },
  });
  res.json({ ok: true });
});

// GET /api/lists/:id/results
router.get('/:id/results', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Niet gevonden' });

  // Zelfde scorebasis als publicatie/hitlijst: score_rules of max_votes-formule + score_adjustment.
  const rawVotes = db.prepare(`
    SELECT v.track_id, v.position
    FROM votes v
    JOIN registrations r ON r.id = v.registration_id
    JOIN list_tracks lt ON lt.id = v.track_id
    WHERE v.list_id = ? AND r.approved = 1
      AND v.approved = 1 AND lt.moderation_status = 'approved'
  `).all(req.params.id);

  const scoreMap = aggregateScores(rawVotes, list.max_votes, list.score_rules);

  const tracks = db.prepare(`
    SELECT lt.id, lt.title, lt.artist, lt.album, lt.cover_url, COALESCE(lt.score_adjustment, 0) AS score_adjustment
    FROM list_tracks lt
    WHERE lt.list_id = ? AND lt.moderation_status = 'approved'
  `).all(req.params.id);

  const results = tracks
    .map(t => {
      const base = scoreMap.get(t.id) || { score: 0, vote_count: 0 };
      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        cover_url: t.cover_url,
        vote_count: base.vote_count,
        score: base.score + t.score_adjustment,
      };
    })
    .sort((a, b) => b.score - a.score || b.vote_count - a.vote_count || a.artist.localeCompare(b.artist));

  res.json({ list: { ...list, theme: JSON.parse(list.theme) }, results });
});

module.exports = router;
