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
  res.json(lists.map(l => ({ ...l, theme: JSON.parse(l.theme || '{}') })));
});

// GET /api/lists/:slug
router.get('/:slug', (req, res) => {
  const list = getDb()
    .prepare('SELECT * FROM lists WHERE slug = ?')
    .get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const tracks = getDb()
    .prepare('SELECT * FROM list_tracks WHERE list_id = ? ORDER BY artist, title')
    .all(list.id);

  res.json({ ...list, theme: JSON.parse(list.theme || '{}'), tracks });
});

// POST /api/lists
router.post('/', ...requirePerm('lists'), upload.single('bg_image'), (req, res) => {
  const { name, slug, description, domain, max_votes, closes_at, theme, playit_group, redirect_url } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name en slug zijn verplicht' });

  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const themeJson = typeof theme === 'string' ? theme : JSON.stringify(theme || {});
  const bg_image  = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const info = getDb().prepare(`
      INSERT INTO lists (name, slug, description, domain, max_votes, closes_at, theme, bg_image, playit_group, redirect_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slugClean, description || null, domain || null,
           Number(max_votes) || 10, closes_at || null, themeJson, bg_image,
           playit_group || null, redirect_url || null);

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
    name, description, domain, status, max_votes, closes_at, theme, playit_group, redirect_url
  } = req.body;

  const bg_image  = req.file ? `/uploads/${req.file.filename}` : list.bg_image;
  const themeJson = theme
    ? (typeof theme === 'string' ? theme : JSON.stringify(theme))
    : list.theme;

  db.prepare(`
    UPDATE lists
    SET name=?, description=?, domain=?, status=?, max_votes=?, closes_at=?, theme=?, bg_image=?, playit_group=?, redirect_url=?
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
  getDb().prepare('DELETE FROM list_tracks WHERE id = ? AND list_id = ?')
    .run(req.params.trackId, req.params.id);
  res.json({ ok: true });
});

// GET /api/lists/:id/results
router.get('/:id/results', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Niet gevonden' });

  // Alleen goedgekeurde inzendingen tellen mee (approved = 1)
  const results = db.prepare(`
    SELECT
      lt.id, lt.title, lt.artist, lt.album, lt.cover_url,
      COUNT(CASE WHEN r.approved = 1 THEN v.id ELSE NULL END) AS vote_count,
      COALESCE(SUM(CASE WHEN r.approved = 1 THEN
        (CASE WHEN v.position = 1 THEN 3 WHEN v.position = 2 THEN 2 ELSE 1 END)
      ELSE 0 END), 0) AS score
    FROM list_tracks lt
    LEFT JOIN votes v ON v.track_id = lt.id
    LEFT JOIN registrations r ON r.id = v.registration_id
    WHERE lt.list_id = ?
    GROUP BY lt.id
    ORDER BY score DESC, vote_count DESC
  `).all(req.params.id);

  res.json({ list: { ...list, theme: JSON.parse(list.theme) }, results });
});

module.exports = router;
