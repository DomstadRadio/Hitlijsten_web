/**
 * Spotify Web API service — client credentials flow.
 * Wordt alleen als fallback gebruikt als PlayIt Live geen match geeft.
 */

const axios = require('axios');

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
      },
    }
  );

  _token = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return _token;
}

/**
 * Zoek tracks op Spotify.
 * @param {string} query
 * @returns {Array<{source, external_id, title, artist, album, cover_url, preview_url, year}>}
 */
async function searchTracks(query) {
  const token = await getToken();
  const res = await axios.get('https://api.spotify.com/v1/search', {
    params: { q: query, type: 'track', limit: 20, market: 'NL' },
    headers: { Authorization: `Bearer ${token}` },
  });

  return (res.data?.tracks?.items ?? []).map(normalizeSpotifyTrack);
}

function normalizeSpotifyTrack(t) {
  const image = t.album?.images?.[0]?.url ?? null;
  const year   = t.album?.release_date
    ? parseInt(t.album.release_date.substring(0, 4), 10)
    : null;

  return {
    source:      'spotify',
    external_id: t.id,
    title:       t.name,
    artist:      t.artists.map(a => a.name).join(', '),
    album:       t.album?.name ?? '',
    cover_url:   image,
    preview_url: t.preview_url ?? null,
    year,
  };
}

module.exports = { searchTracks };
