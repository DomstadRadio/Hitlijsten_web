/**
 * Artwork lookup service.
 * Volgorde: Last.fm track → Last.fm artiest → iTunes
 */

const axios = require('axios');

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

/**
 * Zoek artwork voor een track. Geeft de URL terug of null als niets gevonden.
 * Volgorde: Last.fm (track) → Last.fm (artiest) → iTunes
 */
async function getArtwork(artist, title) {
  const lfm = await fromLastFm(artist, title);
  if (lfm) return lfm;
  return fromItunes(artist, title);
}

module.exports = { getArtwork };
