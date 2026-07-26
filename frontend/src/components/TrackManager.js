import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

export default function TrackManager({ list }) {
  const [tracks,  setTracks]  = useState([]);
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const loadTracks = useCallback(async () => {
    const res = await axios.get(`${API}/lists/${list.slug}`);
    setTracks(res.data.tracks || []);
  }, [list.slug]);

  useEffect(() => { loadTracks(); }, [loadTracks]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const params = { q: query };
      if (list.playit_group) params.group = list.playit_group;
      const res = await axios.get(`${API}/search`, { params });
      setResults(res.data);
    } finally {
      setSearching(false);
    }
  };

  const importGroup = async () => {
    if (!list.playit_group) return;
    if (!window.confirm(`Alle tracks uit groep "${list.playit_group}" importeren?`)) return;
    setImporting(true);
    setImportMsg('');
    try {
      // Haal groeptracks op via search zonder query (lege string niet toegestaan, gebruik speciale route)
      const res = await axios.get(`${API}/search`, { params: { q: ' ', group: list.playit_group } });
      const all  = res.data;
      if (all.length === 0) { setImportMsg('Geen tracks gevonden in deze groep.'); return; }
      const bulkRes = await axios.post(`${API}/lists/${list.id}/tracks/bulk`, { tracks: all });
      setImportMsg(`✓ ${bulkRes.data.added} tracks toegevoegd (${bulkRes.data.total} gevonden).`);
      await loadTracks();
    } catch (err) {
      setImportMsg('Importeren mislukt: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
    }
  };

  const addTrack = async (track) => {
    await axios.post(`${API}/lists/${list.id}/tracks`, track);
    await loadTracks();
    setResults(r => r.filter(t =>
      !(t.title === track.title && t.artist === track.artist)
    ));
  };

  const removeTrack = async (trackId) => {
    await axios.delete(`${API}/lists/${list.id}/tracks/${trackId}`);
    loadTracks();
  };

  const sourceLabel = { playit: '🎙️ PlayIt', spotify: '🟢 Spotify', manual: '✏️ Handmatig' };

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Tracks: {list.name}</h2>
      <p className="helper-text" style={{ marginBottom: 20 }}>
        {tracks.length} track(s) gekoppeld · maximaal {list.max_votes} keuzes voor stemmer
        {list.playit_group && <> · PlayIt groep: <strong>{list.playit_group}</strong></>}
      </p>

      {/* Importeer hele groep */}
      {list.playit_group && (
        <div style={{ marginBottom:16, padding:12, background:'#f0f7ff', borderRadius:8, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ flex:1, fontSize:14 }}>
            Groepfilter actief: <strong>{list.playit_group}</strong>
          </span>
          <button className="btn btn-sm" onClick={importGroup} disabled={importing}>
            {importing ? 'Importeren…' : `⬇ Importeer hele groep`}
          </button>
        </div>
      )}
      {importMsg && <p className="helper-text" style={{ marginBottom:12 }}>{importMsg}</p>}

      {/* Zoekbalk */}
      <div style={{ display:'flex', gap:8, marginBottom:8 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Zoek op artiest of titel…"
          onKeyDown={e => e.key === 'Enter' && search()}
          style={{ flex:1 }}
        />
        <button className="btn" onClick={search} disabled={searching}>
          {searching ? '…' : 'Zoeken'}
        </button>
      </div>
      <p className="helper-text" style={{ marginBottom:16 }}>
        Zoekt eerst in PlayIt Live{list.playit_group ? ` (groep: ${list.playit_group})` : ''}, dan Spotify als fallback.
      </p>

      {/* Zoekresultaten */}
      {results.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <h3 style={{ marginBottom:8 }}>Zoekresultaten</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {results.map((t, i) => (
              <div key={i} className="track-card">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" />
                  : <div style={{ width:56, height:56, background:'#ddd', borderRadius:8, flexShrink:0 }} />
                }
                <div className="track-info">
                  <div className="track-title">{t.title}</div>
                  <div className="track-artist">{t.artist}</div>
                  <div className="track-year">{sourceLabel[t.source]} {t.year ? `· ${t.year}` : ''}</div>
                </div>
                <button className="btn btn-sm" onClick={() => addTrack(t)}>+ Toevoegen</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gekoppelde tracks */}
      <h3 style={{ marginBottom:8 }}>Gekoppelde tracks ({tracks.length})</h3>
      {tracks.length === 0
        ? <p className="helper-text">Nog geen tracks. Zoek hierboven.</p>
        : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {tracks.map(t => (
              <div key={t.id} className="track-card">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" />
                  : <div style={{ width:56, height:56, background:'#ddd', borderRadius:8, flexShrink:0 }} />
                }
                <div className="track-info">
                  <div className="track-title">{t.title}</div>
                  <div className="track-artist">{t.artist}</div>
                  <div className="track-year">{sourceLabel[t.source] || t.source} {t.year ? `· ${t.year}` : ''}</div>
                </div>
                <button className="btn btn-sm" style={{ background:'#c00' }}
                  onClick={() => removeTrack(t.id)}>🗑</button>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}
