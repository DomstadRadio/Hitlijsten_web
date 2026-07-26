import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api/admin';

const TRACK_STATUS = {
  approved: { label: 'Goedgekeurd', color: '#080', bg: '#e8f5e9' },
  rejected: { label: 'Afgewezen',   color: '#c00', bg: '#fce4e4' },
  pending:  { label: 'Wacht',       color: '#888', bg: '#f5f5f5' },
};

function trackStatus(trackApproved, regApproved) {
  // Expliciet per-track oordeel heeft voorrang
  if (trackApproved === 1) return TRACK_STATUS.approved;
  if (trackApproved === 0) return TRACK_STATUS.rejected;
  // Geen per-track oordeel: val terug op inzending-goedkeuring
  if (regApproved === 1) return TRACK_STATUS.approved;
  if (regApproved === 0) return TRACK_STATUS.rejected;
  return TRACK_STATUS.pending;
}

export default function VotersView({ list }) {
  const [tracks,  setTracks]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [expanded, setExpanded] = useState(null); // `${trackId}-${regId}`

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API}/tracks-voters/${list.id}`);
      if (Array.isArray(res.data)) {
        setTracks(res.data);
      } else {
        setError(res.data?.error || 'Onbekende fout');
        setTracks([]);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Laden mislukt');
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = tracks
    .map(t => ({
      ...t,
      voters: t.voters.filter(v =>
        !q
        || t.artist.toLowerCase().includes(q)
        || t.title.toLowerCase().includes(q)
        || v.name?.toLowerCase().includes(q)
        || v.email?.toLowerCase().includes(q)
        || v.phone?.toLowerCase().includes(q)
      ),
    }))
    .filter(t => !q || t.voters.length > 0);

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Stemmers per nummer: {list.name}</h2>
      <p style={{ fontSize:13, color:'#666', marginBottom:16 }}>
        Nummers op lijstvolgorde met alle stemmers. Klik op een stemmer voor contactgegevens.
      </p>

      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Zoek op nummer, artiest of stemmer…"
          style={{ flex:1 }}
        />
        <button className="btn btn-sm btn-outline" onClick={load}>↻ Vernieuwen</button>
      </div>

      {loading ? <p>Laden…</p> : error ? (
        <p style={{ color:'#c00' }}>⚠️ {error}</p>
      ) : filtered.length === 0 ? (
        <p className="helper-text">Geen nummers gevonden.</p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(t => (
            <div key={t.track_id} className="card" style={{ padding:0, overflow:'hidden' }}>
              {/* Track-header */}
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', background:'#f7f7f7', borderBottom:'1px solid #ebebeb' }}>
                {t.chart_position && (
                  <span style={{ fontWeight:800, fontSize:22, color:'#ccc', width:36, textAlign:'right', flexShrink:0 }}>
                    {t.chart_position}
                  </span>
                )}
                {t.cover_url && <img src={t.cover_url} alt="" style={{ width:40, height:40, borderRadius:6, flexShrink:0, objectFit:'cover' }} />}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.artist}</div>
                  <div style={{ fontSize:13, color:'#666', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.title}</div>
                </div>
                <span style={{ fontSize:12, color:'#999', flexShrink:0 }}>{t.voters.length} stemmer{t.voters.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Stemmers */}
              <div style={{ padding:'8px 16px 12px', display:'flex', flexDirection:'column', gap:4 }}>
                {t.voters.map(v => {
                  const key = `${t.track_id}-${v.reg_id}`;
                  const isOpen = expanded === key;
                  const ts = trackStatus(v.track_approved, v.reg_approved);
                  const regColor = v.reg_approved === 1 ? '#080' : v.reg_approved === 0 ? '#c00' : '#bbb';
                  return (
                    <div key={key} style={{ borderRadius:8, border:'1px solid #eee', overflow:'hidden' }}>
                      {/* Stemmer-rij: altijd zichtbaar */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px' }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:regColor, flexShrink:0 }} title={v.reg_approved === 1 ? 'Goedgekeurd' : v.reg_approved === 0 ? 'Afgewezen' : 'Wacht'} />
                        <span style={{ fontWeight:600, flex:1, fontSize:14 }}>{v.name || '(geen naam)'}</span>
                        <span style={{ fontSize:11, color:'#aaa', flexShrink:0 }}>keuze {v.voter_position}</span>
                        <span style={{ fontSize:11, color: ts.color, fontWeight:600, flexShrink:0, minWidth:72, textAlign:'right' }}>{ts.label}</span>
                        {(v.email || v.phone || v.comment) && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : key)}
                            style={{ fontSize:11, background:'none', border:'none', color:'#bbb', cursor:'pointer', padding:'0 0 0 4px', flexShrink:0 }}
                          >{isOpen ? '▲' : '▼'}</button>
                        )}
                      </div>

                      {/* Contactgegevens uitklapbaar */}
                      {isOpen && (
                        <div style={{ padding:'6px 12px 10px', background:'#fafafa', borderTop:'1px solid #f0f0f0', display:'flex', flexDirection:'column', gap:4 }}>
                          {v.email && <div style={{ fontSize:13 }}>✉️ <a href={`mailto:${v.email}`} style={{ color:'#555' }}>{v.email}</a></div>}
                          {v.phone && <div style={{ fontSize:13 }}>📞 <strong>{v.phone}</strong></div>}
                          {v.comment && (
                            <div style={{ marginTop:4, padding:'6px 10px', background:'#fffbea', borderRadius:6, border:'1px solid #ffe58f', fontSize:13 }}>
                              <strong style={{ color:'#8a7000', fontSize:12 }}>Opmerking: </strong>{v.comment}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

