import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

function CoverPlaceholder({ size = 56 }) {
  return (
    <div style={{ width:size, height:size, background:'#e8e8e8', borderRadius:8, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center', color:'#bbb', fontSize:size * 0.45 }}>
      ♪
    </div>
  );
}
export default function TrackManager({ list }) {
  const [tracks,    setTracks]    = useState([]);
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [artworkLog,   setArtworkLog]   = useState([]);
  const [artworkBusy,  setArtworkBusy]  = useState(false);
  const [artworkDone,  setArtworkDone]  = useState(null);
  const [searchErr, setSearchErr] = useState('');
  const [addErr,    setAddErr]    = useState('');
  const [trackFilter, setTrackFilter] = useState('');
  // handmatig toevoegen
  const [manTitle,  setManTitle]  = useState('');
  const [manArtist, setManArtist] = useState('');
  const [manYear,   setManYear]   = useState('');
  const [manAdding, setManAdding] = useState(false);

  const loadTracks = useCallback(async () => {
    const res = await axios.get(`${API}/lists/${list.slug}`);
    setTracks(res.data.tracks || []);
  }, [list.slug]);

  useEffect(() => { loadTracks(); }, [loadTracks]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchErr('');
    try {
      const params = { q: query };
      if (list.playit_group) params.group = list.playit_group;
      const res = await axios.get(`${API}/search`, { params });
      setResults(res.data);
      if (res.data.length === 0) setSearchErr('Geen resultaten gevonden.');
    } catch (err) {
      setSearchErr('Zoeken mislukt: ' + (err.response?.data?.error || err.message));
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
    setAddErr('');
    try {
      await axios.post(`${API}/lists/${list.id}/tracks`, track);
      await loadTracks();
      setResults(r => r.filter(t =>
        !(t.title === track.title && t.artist === track.artist)
      ));
    } catch (err) {
      setAddErr('Toevoegen mislukt: ' + (err.response?.data?.error || err.message));
    }
  };

  const addManual = async () => {
    if (!manTitle.trim() || !manArtist.trim()) {
      setAddErr('Titel en artiest zijn verplicht.');
      return;
    }
    setManAdding(true);
    setAddErr('');
    try {
      await axios.post(`${API}/lists/${list.id}/tracks`, {
        source: 'manual',
        title:  manTitle.trim(),
        artist: manArtist.trim(),
        year:   manYear ? parseInt(manYear, 10) : null,
      });
      await loadTracks();
      setManTitle('');
      setManArtist('');
      setManYear('');
    } catch (err) {
      setAddErr('Toevoegen mislukt: ' + (err.response?.data?.error || err.message));
    } finally {
      setManAdding(false);
    }
  };

  const removeTrack = async (trackId) => {
    await axios.delete(`${API}/lists/${list.id}/tracks/${trackId}`);
    loadTracks();
  };

  const syncArtwork = async (overwrite = false) => {
    setArtworkBusy(true);
    setArtworkLog([]);
    setArtworkDone(null);
    const token = localStorage.getItem('hitlijsten_token');
    try {
      const resp = await fetch(`/api/admin/lists/${list.id}/artwork-sync`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ overwrite }),
      });
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'found') setArtworkLog(l => [...l, { ok: true,  text: `✓ ${ev.artist} – ${ev.title}` }]);
            if (ev.type === 'miss')  setArtworkLog(l => [...l, { ok: false, text: `– ${ev.artist} – ${ev.title}` }]);
            if (ev.type === 'done')  { setArtworkDone(ev); loadTracks(); }
          } catch { /* ignore */ }
        }
      }
    } finally {
      setArtworkBusy(false);
    }
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

      {/* Albumhoezen ophalen */}
      <div style={{ marginBottom:16, padding:12, background:'#f5f0ff', borderRadius:8, border:'1px solid #d8c8ff' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ flex:1, fontSize:14 }}>
            🖼 Albumhoezen ophalen via iTunes / Last.fm
            {artworkDone && (
              <span style={{ marginLeft:8, fontSize:12, color:'#080' }}>
                ✓ {artworkDone.found} gevonden, {artworkDone.skipped} niet gevonden
              </span>
            )}
          </span>
          <button className="btn btn-sm" onClick={() => syncArtwork(false)} disabled={artworkBusy}>
            {artworkBusy ? 'Bezig…' : '⬇ Ontbrekende hoezen ophalen'}
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => syncArtwork(true)} disabled={artworkBusy}
            title="Overschrijft ook tracks die al een hoes hebben">
            ↺ Alles opnieuw ophalen
          </button>
        </div>
        {artworkLog.length > 0 && (
          <div style={{ marginTop:8, maxHeight:140, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
            {artworkLog.map((e, i) => (
              <div key={i} style={{ fontSize:11, color: e.ok ? '#080' : '#aaa' }}>{e.text}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom:20, padding:12, background:'#f9f9f9', borderRadius:8, border:'1px solid #e0e0e0' }}>
        <strong style={{ fontSize:14 }}>✏️ Handmatig toevoegen</strong>
        <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
          <input
            value={manTitle} onChange={e => setManTitle(e.target.value)}
            placeholder="Titel *"
            style={{ flex:2, minWidth:140 }}
          />
          <input
            value={manArtist} onChange={e => setManArtist(e.target.value)}
            placeholder="Artiest *"
            style={{ flex:2, minWidth:140 }}
            onKeyDown={e => e.key === 'Enter' && addManual()}
          />
          <input
            value={manYear} onChange={e => setManYear(e.target.value)}
            placeholder="Jaar"
            type="number"
            style={{ flex:1, minWidth:80 }}
            onKeyDown={e => e.key === 'Enter' && addManual()}
          />
          <button className="btn btn-sm" onClick={addManual} disabled={manAdding}>
            {manAdding ? '…' : '+ Toevoegen'}
          </button>
        </div>
      </div>

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
      {searchErr && <p style={{ color:'#c00', fontSize:13, marginBottom:8 }}>{searchErr}</p>}
      {addErr    && <p style={{ color:'#c00', fontSize:13, marginBottom:8 }}>{addErr}</p>}

      {/* Zoekresultaten */}
      {results.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <h3 style={{ marginBottom:8 }}>Zoekresultaten</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {results.map((t, i) => (
              <div key={i} className="track-card">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" />
                  : <CoverPlaceholder />
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
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
        <h3 style={{ margin:0 }}>Gekoppelde tracks ({tracks.length})</h3>
        {tracks.length > 5 && (
          <input
            value={trackFilter}
            onChange={e => setTrackFilter(e.target.value)}
            placeholder="Zoek in lijst…"
            style={{ flex:1, maxWidth:260 }}
          />
        )}
      </div>
      {tracks.length === 0
        ? <p className="helper-text">Nog geen tracks. Zoek hierboven of voeg handmatig toe.</p>
        : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {tracks.filter(t => {
              if (!trackFilter.trim()) return true;
              const f = trackFilter.toLowerCase();
              return t.title.toLowerCase().includes(f) || t.artist.toLowerCase().includes(f);
            }).map(t => (
              <div key={t.id} className="track-card">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" />
                  : <CoverPlaceholder />
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
