/**
 * PlayIt Live API service.
 * Correcte endpoints (ontdekt via JS bundle reverse engineering):
 *  - GET /api/control/trackGroups/listItems       → alle groepen
 *  - GET /api/control/trackGroups/listed/{guid}   → tracks in een groep (guid + artistAndTitle)
 *  - GET /api/control/tracks/{guid}               → track details (artist, title, album, ...)
 */

const axios    = require('axios');
const https    = require('https');
const { getDb } = require('../db/database');

const api = axios.create({
  baseURL: `${process.env.PLAYIT_BASE_URL}/api/control`,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${process.env.PLAYIT_API_KEY}`,
    Accept: 'application/json',
  },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

// Cache groepen (TTL 10 min)
let _groupsCache = null;
let _groupsCacheAt = 0;

// Cache groep-tracks per guid (TTL 5 min)
const _groupTracksCache = new Map();

/**
 * Haal alle (niet-verborgen) trackgroepen op.
 * Gebruikt eerst de lokale DB (na sync); valt terug op PlayIt API.
 * @returns {Array<{id: string, name: string, trackCount: number}>}
 */
async function getGroups() {
  // Gebruik lokale DB als er gesynchroniseerde data is
  const db = getDb();
  const local = db.prepare(
    "SELECT guid AS id, name, track_count AS trackCount FROM playit_groups WHERE hidden = 0 ORDER BY name"
  ).all();
  if (local.length > 0) return local;

  // Fallback: rechtstreeks van de PlayIt API
  if (_groupsCache && Date.now() - _groupsCacheAt < 10 * 60 * 1000) return _groupsCache;
  try {
    const res = await api.get('/trackGroups/listItems');
    const groups = res.data?.trackGroups ?? [];
    _groupsCache = groups
      .filter(g => !g.hidden)
      .map(g => ({ id: g.guid, name: g.name, trackCount: g.trackCount ?? 0 }));
    _groupsCacheAt = Date.now();
    return _groupsCache;
  } catch (err) {
    console.warn('TrackGroups ophalen mislukt:', err.message);
    return [];
  }
}

/**
 * Zoek een groep op naam en geef de GUID terug.
 */
async function findGroupGuid(groupName) {
  const groups = await getGroups();
  const match = groups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
  return match?.id ?? null;
}

/**
 * Haal alle tracks in een specifieke groep op via GUID.
 * Retourneert genormaliseerde tracks (artist/title gesplitst uit artistAndTitle).
 */
async function getGroupTracksByGuid(guid) {
  const cached = _groupTracksCache.get(guid);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;

  const res = await api.get(`/trackGroups/listed/${guid}`);
  const raw = res.data?.tracks ?? [];
  const tracks = raw.map(t => normalizeGroupTrack(t));

  _groupTracksCache.set(guid, { data: tracks, at: Date.now() });
  return tracks;
}

/**
 * Haal alle tracks in een specifieke groep op via groepnaam.
 * @param {string} groupName
 */
async function getGroupTracks(groupName) {
  const guid = await findGroupGuid(groupName);
  if (!guid) return [];
  return getGroupTracksByGuid(guid);
}

/**
 * Zoek tracks in PlayIt Live, gefilterd op groep en/of query.
 * Gebruikt de lokale DB (na sync) voor snelle full-text zoekopdrachten.
 * Zonder lokale data: valt terug op API-cache (alleen bij groepsfilter).
 * Zonder groepsfilter én zonder lokale data → geen PlayIt resultaten.
 */
async function searchTracks(query, groupName) {
  const q    = (query ?? '').trim();
  const qLow = q.toLowerCase();
  const group = (groupName ?? '').trim();
  const db   = getDb();

  // Saniteer LIKE-wildcards om injection via zoekterm te voorkomen
  const safeLike = (s) => `%${s.replace(/[%_\\]/g, c => `\\${c}`)}%`;

  const hasLocalData = db.prepare('SELECT COUNT(*) AS n FROM playit_tracks').get().n > 0;

  if (hasLocalData) {
    let rows;
    if (group) {
      rows = db.prepare(`
        SELECT pt.guid, pt.title, pt.artist
        FROM playit_tracks pt
        JOIN playit_track_groups ptg ON ptg.track_guid = pt.guid
        JOIN playit_groups pg        ON pg.guid = ptg.group_guid
        WHERE LOWER(TRIM(pg.name)) = LOWER(TRIM(?))
          AND (pt.title LIKE ? ESCAPE '\\' OR pt.artist LIKE ? ESCAPE '\\')
        LIMIT 100
      `).all(group, safeLike(q), safeLike(q));

      // Als de groepsnaam niet (meer) exact overeenkomt of de groep leeg is,
      // geef dan toch PlayIt-resultaten terug uit alle tracks.
      if (!rows.length && q) {
        rows = db.prepare(`
          SELECT guid, title, artist
          FROM playit_tracks
          WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'
          LIMIT 50
        `).all(safeLike(q), safeLike(q));
      }
    } else if (q) {
      rows = db.prepare(`
        SELECT guid, title, artist
        FROM playit_tracks
        WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'
        LIMIT 50
      `).all(safeLike(q), safeLike(q));
    } else {
      return [];
    }
    return rows.map(r => ({
      source: 'playit', external_id: r.guid,
      title: r.title, artist: r.artist,
      album: '', cover_url: null, preview_url: null, year: null,
    }));
  }

  // Fallback op API (alleen zinvol als er een groepsfilter is)
  if (groupName) {
    const tracks = await getGroupTracks(groupName);
    if (!qLow) return tracks.slice(0, 50);
    return tracks
      .filter(t => `${t.artist} ${t.title}`.toLowerCase().includes(qLow))
      .slice(0, 50);
  }

  // Geen groep + geen lokale data → Spotify fallback in de route
  return [];
}

/**
 * Haal één track op via GUID (volledige details).
 */
async function getTrack(guid) {
  const res = await api.get(`/tracks/${guid}`);
  const t = res.data;
  return normalizePlayitTrack(t);
}

/**
 * Splits "Artist - Title" string. Neemt het eerste " - " als scheidingsteken.
 */
function splitArtistTitle(artistAndTitle) {
  const idx = (artistAndTitle ?? '').indexOf(' - ');
  if (idx === -1) return { artist: '', title: artistAndTitle ?? '' };
  return {
    artist: artistAndTitle.slice(0, idx).trim(),
    title:  artistAndTitle.slice(idx + 3).trim(),
  };
}

/** Normaliseer een track uit /trackGroups/listed/{guid} */
function normalizeGroupTrack(t) {
  const { artist, title } = splitArtistTitle(t.artistAndTitle);
  return {
    source:      'playit',
    external_id: t.guid,
    title,
    artist,
    album:       '',
    cover_url:   null,
    preview_url: null,
    year:        null,
  };
}

/** Normaliseer een track uit /tracks/{guid} (volledige details) */
function normalizePlayitTrack(t) {
  return {
    source:      'playit',
    external_id: t.guid,
    title:       t.title  || '',
    artist:      t.artist || '',
    album:       t.album  || '',
    cover_url:   null,
    preview_url: null,
    year:        t.year ? Number(t.year) : null,
  };
}

module.exports = { searchTracks, getTrack, getGroups, getGroupTracks };
