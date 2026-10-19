import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

const API = '/api';
const SRC = { playit: '🎙️ PlayIt', spotify: '🟢 Spotify', manual: '✏️ Handmatig' };

function isPlaceholderCoverUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const v = url.toLowerCase();
  return (
    v.includes('2a96cbd8b46e442fc41c2b86b821562f') ||
    v.includes('placeholder') ||
    v.includes('noimage') ||
    v.includes('/default.') ||
    v.includes('/default_')
  );
}

function Cover({ url, size = 38, isPlaceholder = false }) {
  if (url && !isPlaceholder) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />;
  return <div style={{ width: size, height: size, background: '#e8e8e8', borderRadius: 4, flexShrink: 0,
                       display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: size * 0.45 }}>♪</div>;
}

function CoverPlaceholder({ size = 56 }) {
  return (
    <div style={{ width:size, height:size, background:'#e8e8e8', borderRadius:8, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center', color:'#bbb', fontSize:size * 0.45 }}>
      ♪
    </div>
  );
}
export default function TrackManager({ list }) {
  const [tracks,   setTracks]   = useState([]);
  const [voteResults, setVoteResults] = useState([]);
  const [pending,  setPending]  = useState({});
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState('');
  const [deleting, setDeleting] = useState(null);
  const [filter,   setFilter]   = useState('');

  const [query,     setQuery]     = useState('');
  const [srResults, setSrResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [addErr,    setAddErr]    = useState('');

  const [manTitle,  setManTitle]  = useState('');
  const [manArtist, setManArtist] = useState('');
  const [manYear,   setManYear]   = useState('');
  const [manAdding, setManAdding] = useState(false);

  const [artworkLog,  setArtworkLog]  = useState([]);
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [artworkDone, setArtworkDone] = useState(null);

  const [missingPlayitTracks, setMissingPlayitTracks] = useState([]);
  const [missingPlayitLoading, setMissingPlayitLoading] = useState(false);
  const [showMissingPlayit, setShowMissingPlayit] = useState(false);
  const [missingPlayitErr, setMissingPlayitErr] = useState('');

  const load = useCallback(async () => {
    const [listRes, resultRes] = await Promise.all([
      axios.get(`${API}/lists/${list.slug}`),
      axios.get(`${API}/lists/${list.id}/results`).catch(() => ({ data: { results: [] } })),
    ]);
    setTracks(listRes.data.tracks || []);
    setVoteResults(resultRes.data.results || []);
    setPending({});
  }, [list.slug, list.id]);

  useEffect(() => { load(); }, [load]);

  // Combineer tracks + stemresultaten, sorteer op totaalscore
  const merged = useMemo(() => {
    const rMap = new Map(voteResults.map(r => [r.id, r]));
    return tracks.map(t => {
      const r   = rMap.get(t.id) || {};
      const adj = pending[t.id] !== undefined ? Number(pending[t.id]) : (t.score_adjustment || 0);
      const base = r.score || 0;
      return {
        ...t,
        cover_is_placeholder: Number(t.cover_is_placeholder || 0) === 1 || isPlaceholderCoverUrl(t.cover_url),
        vote_count: r.vote_count || 0,
        base_score: base,
        adjustment: adj,
        total:      base + adj,
        changed:    pending[t.id] !== undefined && Number(pending[t.id]) !== (t.score_adjustment || 0),
      };
    }).sort((a, b) => b.total - a.total || b.vote_count - a.vote_count || a.artist.localeCompare(b.artist));
  }, [tracks, voteResults, pending]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return merged;
    return merged.filter(t => t.title.toLowerCase().includes(f) || t.artist.toLowerCase().includes(f));
  }, [merged, filter]);

  const changedCount = Object.keys(pending).filter(
    id => Number(pending[id]) !== (tracks.find(t => t.id === Number(id))?.score_adjustment || 0)
  ).length;

  const placeholderCount = useMemo(
    () => merged.filter(t => t.cover_is_placeholder || !t.cover_url).length,
    [merged]
  );

  const saveAll = async () => {
    setSaving(true); setSaveMsg('');
    try {
      const changes = Object.entries(pending)
        .filter(([id, v]) => Number(v) !== (tracks.find(t => t.id === Number(id))?.score_adjustment || 0))
        .map(([id, score_adjustment]) => ({ id: Number(id), score_adjustment: Number(score_adjustment) }));
      await axios.patch(`${API}/admin/lists/${list.id}/tracks/batch-adjust`, changes);
      setSaveMsg('✓ Opgeslagen');
      await load();
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg('Fout: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const removeTrack = async (trackId) => {
    setDeleting(trackId);
    try {
      await axios.delete(`${API}/admin/tracks/${trackId}`);
      load();
    } catch (err) {
      alert('Verwijderen mislukt: ' + (err.response?.data?.error || err.message));
      setDeleting(null);
    }
  };

  const editCover = async (track) => {
    const current = track.cover_url || '';
    const next = window.prompt(
      `Nieuwe cover URL voor:\n${track.artist} - ${track.title}\n\nLaat leeg om te verwijderen.`,
      current
    );
    if (next === null) return;
    try {
      await axios.patch(`${API}/admin/tracks/${track.id}/cover`, {
        cover_url: next.trim() ? next.trim() : null,
      });
      await load();
    } catch (err) {
      alert('Cover aanpassen mislukt: ' + (err.response?.data?.error || err.message));
    }
  };

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true); setSearchErr('');
    try {
      const params = { q: query, sources: 'playit,spotify' };
      if (list.playit_group) params.group = list.playit_group;
      const res = await axios.get(`${API}/search`, { params });
      setSrResults(res.data);
      if (res.data.length === 0) setSearchErr('Geen resultaten gevonden.');
    } catch (err) {
      setSearchErr('Zoeken mislukt: ' + (err.response?.data?.error || err.message));
    } finally { setSearching(false); }
  };

  const addTrack = async (track) => {
    setAddErr('');
    try {
      await axios.post(`${API}/lists/${list.id}/tracks`, track);
      await load();
      setSrResults(r => r.filter(t => !(t.title === track.title && t.artist === track.artist)));
    } catch (err) {
      setAddErr('Toevoegen mislukt: ' + (err.response?.data?.error || err.message));
    }
  };

  const addManual = async () => {
    if (!manTitle.trim() || !manArtist.trim()) { setAddErr('Titel en artiest zijn verplicht.'); return; }
    setManAdding(true); setAddErr('');
    try {
      await axios.post(`${API}/lists/${list.id}/tracks`, {
        source: 'manual', title: manTitle.trim(), artist: manArtist.trim(),
        year: manYear ? parseInt(manYear, 10) : null,
      });
      await load();
      setManTitle(''); setManArtist(''); setManYear('');
    } catch (err) {
      setAddErr('Toevoegen mislukt: ' + (err.response?.data?.error || err.message));
    } finally { setManAdding(false); }
  };

  const syncArtwork = async (overwrite = false) => {
    setArtworkBusy(true); setArtworkLog([]); setArtworkDone(null);
    const token = localStorage.getItem('hitlijsten_token');
    try {
      const resp = await fetch(`/api/admin/lists/${list.id}/artwork-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ overwrite }),
      });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'found') setArtworkLog(l => [...l, { ok: true,  text: `✓ ${ev.artist} – ${ev.title}` }]);
            if (ev.type === 'miss')  setArtworkLog(l => [...l, { ok: false, text: `– ${ev.artist} – ${ev.title}` }]);
            if (ev.type === 'placeholder') setArtworkLog(l => [...l, { ok: false, text: `◌ Placeholder: ${ev.artist} – ${ev.title}` }]);
            if (ev.type === 'done')  { setArtworkDone(ev); load(); }
          } catch { /* ignore */ }
        }
      }
    } finally { setArtworkBusy(false); }
  };

  const checkMissingPlayitTracks = async () => {
    setMissingPlayitLoading(true);
    setMissingPlayitErr('');
    const token = localStorage.getItem('hitlijsten_token');
    try {
      const resp = await axios.get(`/api/admin/lists/${list.id}/missing-playit-tracks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setMissingPlayitTracks(resp.data.missing || []);
      setShowMissingPlayit(true);
    } catch (err) {
      setMissingPlayitErr('Fout bij ophalen rapport: ' + (err.response?.data?.error || err.message));
    } finally {
      setMissingPlayitLoading(false);
    }
  };

  const exportMissingTracksToExcel = () => {
    if (!missingPlayitTracks.length) return;
    const data = missingPlayitTracks.map((t, i) => ({
      '#': i + 1,
      'Titel': t.title,
      'Artiest': t.artist,
      'Album': t.album || '',
      'Jaar': t.year || '',
      'Positie': t.chart_position || '–',
      'Score': t.chart_score > 0 ? t.chart_score : '–',
      'Stemmen': t.vote_count || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch: 4}, {wch: 30}, {wch: 25}, {wch: 25}, {wch: 6}, {wch: 8}, {wch: 8}, {wch: 8}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ontbrekende tracks');
    XLSX.writeFile(wb, `Ontbrekende-PlayIt-tracks-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const thS = { padding: '6px 8px', background: '#f5f5f5', fontWeight: 600, fontSize: 12,
                borderBottom: '2px solid #e0e0e0', whiteSpace: 'nowrap' };
  const tdS = { padding: '5px 8px', borderBottom: '1px solid #eee', verticalAlign: 'middle' };

  return (
    <div>
      {/* Header + opslaan */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Tracks: {list.name}</h2>
        <span style={{ color: '#888', fontSize: 13 }}>{tracks.length} tracks · max {list.max_votes} per stemmer</span>
        <span style={{ color: '#b06a00', fontSize: 13 }}>{placeholderCount} zonder echte hoes</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {saveMsg && <span style={{ fontSize: 13, color: saveMsg.startsWith('✓') ? '#080' : '#c00' }}>{saveMsg}</span>}
          <button className="btn" onClick={saveAll} disabled={saving || changedCount === 0}
            style={{ background: changedCount > 0 ? '#28a745' : undefined, color: changedCount > 0 ? '#fff' : undefined }}>
            {saving ? 'Opslaan…' : `💾 Opslaan${changedCount > 0 ? ` (${changedCount})` : ''}`}
          </button>
        </div>
      </div>
      <p className="helper-text" style={{ marginBottom: 12 }}>
        Wijzig aanpassingen en klik één keer op Opslaan. Gewijzigde rijen zijn geel.
        {list.playit_group && <> · PlayIt groep: <strong>{list.playit_group}</strong></>}
      </p>

      {/* Filter */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Zoek in gekoppelde tracks…" style={{ width: '100%', marginBottom: 10 }} />

      {/* Tracktabel */}
      <div style={{ overflowX: 'auto', marginBottom: 24, border: '1px solid #e8e8e8', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...thS, width: 34, textAlign: 'center' }}>#</th>
              <th style={{ ...thS, width: 46 }}></th>
              <th style={thS}>Titel / Artiest</th>
              <th style={{ ...thS, textAlign: 'right', width: 70 }} title="Aantal stemmers dat deze track heeft gekozen">Stemmen</th>
              <th style={{ ...thS, textAlign: 'right', width: 60 }} title="Berekende score op basis van posities">Score</th>
              <th style={{ ...thS, textAlign: 'center', width: 100 }} title="Handmatige bonus of malus">Aanpassing</th>
              <th style={{ ...thS, textAlign: 'right', width: 62 }} title="Score + aanpassing">Totaal</th>
              <th style={{ ...thS, width: 72 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ ...tdS, color: '#aaa', textAlign: 'center', padding: 24 }}>
                {filter ? 'Geen tracks gevonden.' : 'Nog geen tracks. Gebruik de zoekvelden hieronder.'}
              </td></tr>
            )}
            {filtered.map((t, i) => (
              <tr key={t.id} style={{ background: t.changed ? '#fffbe6' : (i % 2 === 0 ? '#fff' : '#fafafa') }}>
                <td style={{ ...tdS, textAlign: 'center', color: '#aaa', fontSize: 11 }}>{i + 1}</td>
                <td style={tdS}><Cover url={t.cover_url} isPlaceholder={t.cover_is_placeholder} /></td>
                <td style={tdS}>
                  <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{t.title}</div>
                  <div style={{ color: '#666', fontSize: 11, marginTop: 1 }}>
                    {t.artist}{t.year ? ` · ${t.year}` : ''} · <span style={{ color: '#aaa' }}>{SRC[t.source] || t.source}</span>
                    {t.cover_is_placeholder || !t.cover_url ? <span style={{ color: '#b06a00' }}> · placeholder-hoes</span> : null}
                  </div>
                </td>
                <td style={{ ...tdS, textAlign: 'right', color: t.vote_count > 0 ? '#333' : '#ccc' }}>
                  {t.vote_count > 0 ? t.vote_count : '–'}
                </td>
                <td style={{ ...tdS, textAlign: 'right', color: t.base_score > 0 ? '#333' : '#ccc' }}>
                  {t.base_score > 0 ? t.base_score : '–'}
                </td>
                <td style={{ ...tdS, textAlign: 'center' }}>
                  <input type="number" value={t.adjustment}
                    onChange={e => setPending(p => ({ ...p, [t.id]: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: 72, textAlign: 'center', padding: '3px 6px', fontSize: 13,
                             border: `1px solid ${t.changed ? '#f90' : '#ddd'}`,
                             borderRadius: 4, background: t.changed ? '#fffbe6' : '#fff' }} />
                </td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: t.total > 0 ? 600 : 400, color: t.total > 0 ? '#111' : '#ccc' }}>
                  {t.total > 0 ? t.total : '–'}
                </td>
                <td style={tdS}>
                  <button onClick={() => editCover(t)} title="Cover aanpassen"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a73e8', fontSize: 15, padding: 2, marginRight: 6 }}>
                    🖼
                  </button>
                  <button onClick={() => removeTrack(t.id)} disabled={deleting === t.id} title="Verwijder track"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', fontSize: 16, padding: 2,
                             opacity: deleting === t.id ? 0.4 : 1 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Albumhoezen */}
      <div style={{ marginBottom: 16, padding: 12, background: '#f5f0ff', borderRadius: 8, border: '1px solid #d8c8ff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 14 }}>
            🖼 Albumhoezen ophalen via iTunes / Last.fm / MusicBrainz
            {artworkDone && <span style={{ marginLeft: 8, fontSize: 12, color: '#080' }}>✓ {artworkDone.found} gevonden, {artworkDone.skipped} niet gevonden, {artworkDone.placeholders || 0} placeholders</span>}
          </span>
          <button className="btn btn-sm" onClick={() => syncArtwork(false)} disabled={artworkBusy}>{artworkBusy ? 'Bezig…' : '⬇ Ontbrekende hoezen'}</button>
          <button className="btn btn-sm btn-outline" onClick={() => syncArtwork(true)} disabled={artworkBusy}>↺ Alles opnieuw</button>
        </div>
        {artworkLog.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {artworkLog.map((e, i) => <div key={i} style={{ fontSize: 11, color: e.ok ? '#080' : '#aaa' }}>{e.text}</div>)}
          </div>
        )}
      </div>

      {/* PlayIt integratie: Ontbrekende tracks */}
      <div style={{ marginBottom: 16, padding: 12, background: '#f0f8ff', borderRadius: 8, border: '1px solid #c8e0ff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 14 }}>
            🔍 Tracks die ontbreken in PlayIt Live
          </span>
          <button className="btn btn-sm" onClick={checkMissingPlayitTracks} disabled={missingPlayitLoading}>
            {missingPlayitLoading ? 'Bezig…' : '📋 Rapport ophalen'}
          </button>
        </div>
        {missingPlayitErr && <p style={{ color: '#c00', fontSize: 12, marginTop: 8 }}>{missingPlayitErr}</p>}
      </div>

      {/* Modal voor ontbrekende PlayIt tracks */}
      {showMissingPlayit && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }} onClick={() => setShowMissingPlayit(false)}>
          <div style={{
            background: '#fff', borderRadius: 8, padding: 20, maxWidth: 800, maxHeight: '80vh',
            overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>🔍 Ontbrekende PlayIt tracks</h3>
              <button onClick={() => setShowMissingPlayit(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>✕</button>
            </div>

            <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
              <strong>{missingPlayitTracks.length} van {tracks.length}</strong> approved tracks staan niet in PlayIt Live.
            </p>

            {missingPlayitTracks.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#080', padding: 24 }}>✓ Alle tracks staan in PlayIt!</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: 8, textAlign: 'center', width: 30 }}>#</th>
                      <th style={{ padding: 8, textAlign: 'center', width: 40 }}></th>
                      <th style={{ padding: 8, textAlign: 'left' }}>Titel</th>
                      <th style={{ padding: 8, textAlign: 'left' }}>Artiest</th>
                      <th style={{ padding: 8, textAlign: 'center', width: 50 }}>Pos</th>
                      <th style={{ padding: 8, textAlign: 'center', width: 50 }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingPlayitTracks.map((t, i) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: 8, textAlign: 'center', color: '#aaa' }}>{i + 1}</td>
                        <td style={{ padding: 8, textAlign: 'center' }}><Cover url={t.cover_url} size={30} /></td>
                        <td style={{ padding: 8, textAlign: 'left', fontWeight: 500 }}>{t.title}</td>
                        <td style={{ padding: 8, textAlign: 'left', color: '#666' }}>{t.artist}</td>
                        <td style={{ padding: 8, textAlign: 'center', color: t.chart_position ? '#333' : '#ccc' }}>
                          {t.chart_position || '–'}
                        </td>
                        <td style={{ padding: 8, textAlign: 'center', color: t.chart_score > 0 ? '#333' : '#ccc' }}>
                          {t.chart_score > 0 ? t.chart_score : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button className="btn btn-primary" onClick={exportMissingTracksToExcel} disabled={missingPlayitTracks.length === 0}>
                📊 Exporteren naar Excel
              </button>
              <button className="btn" onClick={() => setShowMissingPlayit(false)}>Sluiten</button>
            </div>
          </div>
        </div>
      )}

      {/* Handmatig toevoegen */}
      <div style={{ marginBottom: 16, padding: 12, background: '#f9f9f9', borderRadius: 8, border: '1px solid #e0e0e0' }}>
        <strong style={{ fontSize: 14 }}>✏️ Handmatig toevoegen</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input value={manTitle}  onChange={e => setManTitle(e.target.value)}  placeholder="Titel *"   style={{ flex: 2, minWidth: 140 }} />
          <input value={manArtist} onChange={e => setManArtist(e.target.value)} placeholder="Artiest *" style={{ flex: 2, minWidth: 140 }}
            onKeyDown={e => e.key === 'Enter' && addManual()} />
          <input value={manYear}   onChange={e => setManYear(e.target.value)}   placeholder="Jaar" type="number" style={{ flex: 1, minWidth: 80 }} />
          <button className="btn btn-sm" onClick={addManual} disabled={manAdding}>{manAdding ? '…' : '+ Toevoegen'}</button>
        </div>
      </div>

      {/* Zoeken + toevoegen */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Zoek via PlayIt / Spotify…"
          onKeyDown={e => e.key === 'Enter' && search()} style={{ flex: 1 }} />
        <button className="btn" onClick={search} disabled={searching}>{searching ? '…' : 'Zoeken'}</button>
      </div>
      <p className="helper-text" style={{ marginBottom: srResults.length > 0 ? 10 : 0 }}>
        Zoekt in PlayIt Live{list.playit_group ? ` (groep: ${list.playit_group})` : ''}, daarna Spotify als fallback.
      </p>
      {searchErr && <p style={{ color: '#c00', fontSize: 13, margin: '4px 0' }}>{searchErr}</p>}
      {addErr    && <p style={{ color: '#c00', fontSize: 13, margin: '4px 0' }}>{addErr}</p>}
      {srResults.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {srResults.map((t, i) => (
            <div key={i} className="track-card">
              <Cover url={t.cover_url} size={44} />
              <div className="track-info">
                <div className="track-title">{t.title}</div>
                <div className="track-artist">{t.artist}</div>
                <div className="track-year">{SRC[t.source]} {t.year ? `· ${t.year}` : ''}</div>
              </div>
              <button className="btn btn-sm" onClick={() => addTrack(t)}>+ Toevoegen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
