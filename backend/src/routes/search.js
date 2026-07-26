/**
 * Routes: zoeken naar tracks.
 * Volgorde: 1) bestaande list_tracks (zelfde lijst) 2) PlayIt Live 3) Spotify.
 * GET /api/search?q=query&group=groepnaam&slug=hitlijst-slug
 * GET /api/search/groups  — beschikbare PlayIt trackgroepen
 */

const express = require('express');
const playit  = require('../services/playit');
const spotify = require('../services/spotify');
const { getDb } = require('../db/database');

const router = express.Router();

// GET /api/search/groups
router.get('/groups', async (req, res) => {
  try {
    const groups = await playit.getGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hulpfunctie: zoek in list_tracks van een lijst
function searchListTracks(slug, q) {
  if (!slug || !q) return [];
  try {
    const db = getDb();
    const list = db.prepare('SELECT id FROM lists WHERE slug = ?').get(slug);
    if (!list) return [];
    const like = `%${q.toLowerCase()}%`;
    const rows = db.prepare(`
      SELECT external_id, source, title, artist, album, cover_url, year
      FROM list_tracks
      WHERE list_id = ?
        AND (LOWER(title) LIKE ? OR LOWER(artist) LIKE ?)
      ORDER BY added_at ASC
      LIMIT 20
    `).all(list.id, like, like);
    return rows.map(r => ({
      external_id: r.external_id,
      source:      r.source || 'playit',
      title:       r.title,
      artist:      r.artist,
      album:       r.album || null,
      cover_url:   r.cover_url || null,
      year:        r.year || null,
      existing:    true,
    }));
  } catch (err) {
    console.warn('Zoeken in list_tracks mislukt:', err.message);
    return [];
  }
}

// GET /api/search?q=query&group=groepnaam&slug=hitlijst-slug
router.get('/', async (req, res) => {
  const q     = (req.query.q     || '').trim();
  const group = (req.query.group || '').trim() || null;
  const slug  = (req.query.slug  || '').trim() || null;
  // Optionele expliciete bronnen-filter: ?sources=playit,spotify
  // Standaard (geen param) = oude gedrag: PlayIt + alleen Spotify als aanvulling.
  const sourcesParam = (req.query.sources || '').trim();
  const sources = sourcesParam
    ? sourcesParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const wantPlayIt  = !sources || sources.includes('playit');
  const wantSpotify = !sources || sources.includes('spotify');
  if (q.length < 2) return res.json([]);

  try {
    const seen = new Set(); // artist|title lowercased
    const addUnique = (arr, items) => {
      for (const it of items) {
        const key = `${(it.artist || '').toLowerCase()}|${(it.title || '').toLowerCase()}`;
        if (!key.trim() || key === '|') continue;
        if (seen.has(key)) continue;
        seen.add(key);
        arr.push(it);
      }
    };

    const merged = [];

    // 1. Eerst bestaande tracks in deze lijst (alleen als er een slug is en geen groepfilter)
    if (slug && !group && wantPlayIt) {
      addUnique(merged, searchListTracks(slug, q));
    }

    // 2. PlayIt Live
    if (wantPlayIt) {
      try {
        const playitResults = await playit.searchTracks(q, group);
        addUnique(merged, playitResults);
      } catch (e) {
        console.warn('PlayIt search mislukt:', e.message);
      }
    }

    // 3. Spotify
    //    - Bij expliciete sources-param: altijd zoeken als 'spotify' is opgegeven (groep wordt genegeerd voor Spotify).
    //    - Zonder param: oude gedrag — alleen aanvullen bij weinig resultaten en geen groep.
    const spotifyForced = sources && wantSpotify;
    const spotifyFallback = !sources && wantSpotify && merged.length < 5 && !group;
    if (spotifyForced || spotifyFallback) {
      try {
        const spotifyResults = await spotify.searchTracks(q);
        addUnique(merged, spotifyResults);
      } catch (spotifyErr) {
        console.warn('Spotify search mislukt:', spotifyErr.message);
      }
    }

    res.json(merged.slice(0, 30));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
