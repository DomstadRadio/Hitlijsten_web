/**
 * Artwork lookup service.
 * Volgorde: Last.fm track → Last.fm artiest → iTunes → MusicBrainz/CAA
 */

const axios = require('axios');

const MB_BASE = 'https://musicbrainz.org/ws/2/release/';
const CAA_BASE = 'https://coverartarchive.org/release';
const MB_USER_AGENT = process.env.MUSICBRAINZ_USER_AGENT || 'HitlijstenWebsite/1.0 (https://domstadradio.nl)';

function isPlaceholderCoverUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const v = url.toLowerCase();
  return (
    v.includes('2a96cbd8b46e442fc41c2b86b821562f') || // bekende Last.fm no-art image
    v.includes('placeholder') ||
    v.includes('noimage') ||
    v.includes('/default.') ||
    v.includes('/default_')
  );
}

async function fromLastFm(artist, title) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  const pick = (images) => {
    if (!Array.isArray(images)) return null;
    for (const size of ['extralarge', 'large', 'medium']) {
      const img = images.find(i => i.size === size);
      if (img?.['#text']) return img['#text'];
    }
    return null;
  };
  try {
    // Probeer eerst op tracknaam
    const r1 = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: { method: 'track.getInfo', api_key: key, artist, track: title, format: 'json' },
      timeout: 5000,
    });
    const url1 = pick(r1.data?.track?.album?.image);
    if (url1) return url1;

    // Fallback: zoek op artiest alleen
    const r2 = await axios.get('https://ws.audioscrobbler.com/2.0/', {
      params: { method: 'artist.getInfo', api_key: key, artist, format: 'json' },
      timeout: 5000,
    });
    return pick(r2.data?.artist?.image);
  } catch {
    return null;
  }
}

async function fromItunes(artist, title) {
  const search = async (term) => {
    try {
      const res = await axios.get(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=3&country=NL`,
        { timeout: 6000 }
      );
      const url = res.data?.results?.[0]?.artworkUrl100;
      return url ? url.replace('100x100bb', '500x500bb') : null;
    } catch { return null; }
  };

  // Probeer volledige titel
  const url1 = await search(`${artist} ${title}`);
  if (url1) return url1;

  // Striphaakjes/brackets en herprobeer (bijv. "(Badr Hari)" of "[Radio Edit]")
  const stripped = title.replace(/[\(\[][^\)\]]*[\)\]]/g, '').trim();
  if (stripped && stripped !== title) {
    const url2 = await search(`${artist} ${stripped}`);
    if (url2) return url2;
  }

  // Fallback: zoek op alleen artiest, pak eerste nummer met artwork
  return search(artist);
}

function stripTitle(rawTitle) {
  return String(rawTitle || '').replace(/[\(\[][\s\S]*?[\)\]]/g, '').trim();
}

async function findReleaseIds(artist, title) {
  const variants = [title, stripTitle(title)].filter(Boolean);
  const unique = [...new Set(variants)];
  const ids = [];

  for (const t of unique) {
    try {
      const query = `artist:"${artist}" AND release:"${t}"`;
      const res = await axios.get(MB_BASE, {
        params: { query, fmt: 'json', limit: 5 },
        timeout: 7000,
        headers: { 'User-Agent': MB_USER_AGENT },
      });

      const releases = Array.isArray(res.data?.releases) ? res.data.releases : [];
      for (const r of releases) {
        if (!r?.id) continue;
        const hasFront = r['cover-art-archive']?.front === true;
        if (hasFront) ids.unshift(r.id);
        else ids.push(r.id);
      }

      if (ids.length > 0) break;
    } catch {
      // Best-effort fallback path.
    }
  }

  return [...new Set(ids)];
}

async function coverFromReleaseId(releaseId) {
  const url = `${CAA_BASE}/${releaseId}/front-500`;
  try {
    const res = await axios.get(url, {
      timeout: 7000,
      maxRedirects: 0,
      validateStatus: (s) => (s >= 200 && s < 400) || s === 404,
      headers: { 'User-Agent': MB_USER_AGENT },
    });

    if (res.status === 404) return null;
    if (res.headers?.location) return res.headers.location;
    return url;
  } catch {
    return null;
  }
}

async function fromMusicBrainz(artist, title) {
  if (!artist || !title) return null;
  const releaseIds = await findReleaseIds(artist, title);
  for (const id of releaseIds) {
    const cover = await coverFromReleaseId(id);
    if (cover) return cover;
  }
  return null;
}

/**
 * Zoek artwork voor een track. Geeft de URL terug of null als niets gevonden.
 * Volgorde: Last.fm (track) → Last.fm (artiest) → iTunes → MusicBrainz/CAA
 */
async function getArtwork(artist, title) {
  const lfm = await fromLastFm(artist, title);
  if (lfm && !isPlaceholderCoverUrl(lfm)) return lfm;
  const itunes = await fromItunes(artist, title);
  if (itunes && !isPlaceholderCoverUrl(itunes)) return itunes;
  const musicbrainz = await fromMusicBrainz(artist, title);
  if (musicbrainz && !isPlaceholderCoverUrl(musicbrainz)) return musicbrainz;
  return null;
}

module.exports = { getArtwork, isPlaceholderCoverUrl };
