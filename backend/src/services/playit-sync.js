/**
 * PlayIt Live sync service.
 * Synchroniseert alle trackgroepen (type=Listed) en hun tracks naar de lokale database,
 * zodat zoekopdrachten sneller kunnen plaatsvinden zonder API-calls.
 *
 * Gebruik:
 *   const { syncAll, getStatus } = require('./playit-sync');
 *   await syncAll();  // start volledige sync
 *   getStatus();      // { running, lastSync, trackCount, groupCount, progress, error }
 */

const axios = require('axios');
const https = require('https');
const { getDb } = require('../db/database');

const api = axios.create({
  baseURL: `${process.env.PLAYIT_BASE_URL}/api/control`,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${process.env.PLAYIT_API_KEY}`,
    Accept: 'application/json',
  },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

let _status = {
  running:    false,
  lastSync:   null,
  trackCount: 0,
  groupCount: 0,
  error:      null,
  progress:   null,
};

/** Geef huidige sync-status terug (kopie). */
function getStatus() {
  return { ..._status };
}

/** Splits "Artiest - Titel" string op eerste " - ". */
function splitArtistTitle(s) {
  const i = (s || '').indexOf(' - ');
  if (i === -1) return { artist: '', title: s || '' };
  return { artist: s.slice(0, i).trim(), title: s.slice(i + 3).trim() };
}

/**
 * Volledige PlayIt sync:
 *  1. Haal alle groepen op en sla op in playit_groups
 *  2. Voor elke Listed-groep: haal tracks op en sla op in playit_tracks + playit_track_groups
 *
 * De sync is idempotent (INSERT OR REPLACE / ON CONFLICT DO UPDATE).
 * Gooit een fout als er al een sync bezig is.
 */
async function syncAll() {
  if (_status.running) throw new Error('Sync is al bezig');

  _status.running  = true;
  _status.error    = null;
  _status.progress = 'Groepen ophalen…';

  const db = getDb();
  let groupCount = 0;

  try {
    // ── Stap 1: Groepen ─────────────────────────────────────────────────────
    const grRes = await api.get('/trackGroups/listItems');
    const groups = grRes.data?.trackGroups ?? [];

    const upsertGroup = db.prepare(`
      INSERT INTO playit_groups (guid, name, type, hidden, track_count, synced_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(guid) DO UPDATE SET
        name        = excluded.name,
        type        = excluded.type,
        hidden      = excluded.hidden,
        track_count = excluded.track_count,
        synced_at   = excluded.synced_at
    `);

    db.transaction(() => {
      for (const g of groups) {
        upsertGroup.run(
          g.guid,
          g.name,
          g.type || 'Unknown',
          g.hidden ? 1 : 0,
          g.trackCount || 0
        );
        groupCount++;
      }
    })();

    _status.groupCount = groupCount;
    _status.progress   = `${groupCount} groepen opgeslagen. Tracks ophalen…`;

    // ── Stap 2: Tracks per Listed groep ─────────────────────────────────────
    const upsertTrack = db.prepare(`
      INSERT INTO playit_tracks (guid, title, artist, synced_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(guid) DO UPDATE SET
        title     = excluded.title,
        artist    = excluded.artist,
        synced_at = excluded.synced_at
    `);

    const insertRel = db.prepare(`
      INSERT OR IGNORE INTO playit_track_groups (track_guid, group_guid) VALUES (?, ?)
    `);

    const listedGroups = groups.filter(g => g.type === 'Listed');
    let idx = 0;

    for (const group of listedGroups) {
      idx++;
      _status.progress = `Groep ${idx}/${listedGroups.length}: ${group.name}…`;

      try {
        const trRes = await api.get(`/trackGroups/listed/${group.guid}`);
        const tracks = trRes.data?.tracks ?? [];

        db.transaction(() => {
          for (const t of tracks) {
            const { artist, title } = splitArtistTitle(t.artistAndTitle);
            upsertTrack.run(t.guid, title, artist);
            insertRel.run(t.guid, group.guid);
          }
        })();
      } catch (err) {
        console.warn(`[playit-sync] Groep "${group.name}" overgeslagen:`, err.message);
      }
    }

    // ── Klaar ────────────────────────────────────────────────────────────────
    _status.lastSync   = new Date().toISOString();
    _status.trackCount = db.prepare('SELECT COUNT(*) AS n FROM playit_tracks').get().n;
    _status.groupCount = groupCount;
    _status.progress   = null;

    console.log(`[playit-sync] Klaar: ${groupCount} groepen, ${_status.trackCount} tracks`);
    return { groupCount, trackCount: _status.trackCount };

  } catch (err) {
    _status.error    = err.message;
    _status.progress = null;
    throw err;
  } finally {
    _status.running = false;
  }
}

module.exports = { syncAll, getStatus };
