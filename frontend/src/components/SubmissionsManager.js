import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = '/api/admin';

const STATUS_LABELS = {
  pending:  { label: 'Wacht',       color: '#888',  bg: '#f5f5f5'  },
  approved: { label: 'Goedgekeurd', color: '#080',  bg: '#e8f5e9'  },
  rejected: { label: 'Afgewezen',   color: '#c00',  bg: '#fce4e4'  },
};

function approvedToStatus(approved) {
  if (approved === null || approved === undefined) return 'pending';
  return approved ? 'approved' : 'rejected';
}

export default function SubmissionsManager({ list, onNoVoters }) {
  const { hasPerm } = useAuth();
  const [filter,      setFilter]      = useState('pending');
  const [search,      setSearch]      = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [stats,       setStats]       = useState(null);
  const [expanded,    setExpanded]    = useState(null); // regId
  const [detail,      setDetail]      = useState({});   // regId → votes
  const [loading,     setLoading]     = useState(true);
  const [replaceState,    setReplaceState]    = useState(null);  // { regId, voteId }
  const [replaceQuery,    setReplaceQuery]    = useState('');
  const [replaceResults,  setReplaceResults]  = useState([]);
  const [replaceSearching,setReplaceSearching]= useState(false);
  const replaceDebounce = useRef(null);
  const [addState,    setAddState]    = useState(null);  // { regId } — track toevoegen aan inzending
  const [addQuery,    setAddQuery]    = useState('');
  const [addResults,  setAddResults]  = useState([]);
  const [addSearching,setAddSearching]= useState(false);
  const addDebounce = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, statRes] = await Promise.all([
        axios.get(`${API}/submissions/${list.id}`, { params: { status: filter } }),
        axios.get(`${API}/stats/${list.id}`),
      ]);
      const subs = subRes.data;
      setSubmissions(subs);
      setStats(statRes.data);
      // Laad alle track-details meteen zodat ze altijd zichtbaar zijn
      const detailResults = await Promise.all(
        subs.map(s => axios.get(`${API}/submissions/${list.id}/${s.id}`))
      );
      const detailMap = {};
      detailResults.forEach((res, i) => { detailMap[subs[i].id] = res.data.votes; });
      setDetail(detailMap);
    } finally {
      setLoading(false);
    }
  }, [list.id, filter]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (regId) => {
    if (detail[regId]) return; // al geladen
    const res = await axios.get(`${API}/submissions/${list.id}/${regId}`);
    setDetail(d => ({ ...d, [regId]: res.data.votes }));
  };

  const reloadDetail = async (regId) => {
    const res = await axios.get(`${API}/submissions/${list.id}/${regId}`);
    setDetail(d => ({ ...d, [regId]: res.data.votes }));
  };

  const toggle = (regId) => {
    const newExpanded = expanded === regId ? null : regId;
    setExpanded(newExpanded);
    if (newExpanded) loadDetail(newExpanded);
  };

  const approve = async (regId) => {
    await axios.post(`${API}/submissions/${regId}/approve`);
    load();
  };

  const reject = async (regId) => {
    await axios.post(`${API}/submissions/${regId}/reject`);
    load();
  };

  const reset = async (regId) => {
    await axios.post(`${API}/submissions/${regId}/reset`);
    load();
  };

  const openReplace = (regId, voteId) => {
    setReplaceState({ regId, voteId });
    setReplaceQuery('');
    setReplaceResults([]);
  };

  const closeReplace = () => { setReplaceState(null); setReplaceQuery(''); setReplaceResults([]); };

  // Zoek via /api/search (lijst + PlayIt + Spotify) voor vervang-dropdown
  useEffect(() => {
    clearTimeout(replaceDebounce.current);
    if (!replaceState || replaceQuery.length < 2) { setReplaceResults([]); return; }
    replaceDebounce.current = setTimeout(async () => {
      setReplaceSearching(true);
      try {
        const [listRes, extRes] = await Promise.all([
          axios.get(`${API}/list-tracks-search/${list.id}`, { params: { q: replaceQuery } }),
          axios.get('/api/search', { params: { q: replaceQuery, slug: list.slug, sources: 'playit,spotify' } }),
        ]);
        const listTracks = (listRes.data || []).map(t => ({ ...t, _source: 'list' }));
        const listExtIds = new Set(listTracks.map(t => `${t.source}::${t.external_id}`));
        const ext = (extRes.data?.tracks || extRes.data || [])
          .filter(t => !t.existing && !listExtIds.has(`${t.source}::${t.external_id}`))
          .map(t => ({ ...t, _source: t.source || 'playit' }));
        setReplaceResults([...listTracks, ...ext]);
      } finally { setReplaceSearching(false); }
    }, 300);
  }, [replaceQuery, replaceState, list.id, list.slug]);

  const doReplace = async (track) => {
    const { regId, voteId } = replaceState;
    const payload = track.list_track_id
      ? { list_track_id: track.list_track_id }
      : { track: { external_id: track.external_id, source: track.source, title: track.title, artist: track.artist, album: track.album || null, cover_url: track.cover_url || null, year: track.year || null } };
    await axios.put(`${API}/submissions/${regId}/tracks/${voteId}/replace`, payload);
    closeReplace();
    await reloadDetail(regId);
    load();
  };

  const openAdd  = (regId) => { setAddState({ regId }); setAddQuery(''); setAddResults([]); };
  const closeAdd = () => { setAddState(null); setAddQuery(''); setAddResults([]); };

  useEffect(() => {
    clearTimeout(addDebounce.current);
    if (!addState || addQuery.length < 2) { setAddResults([]); return; }
    addDebounce.current = setTimeout(async () => {
      setAddSearching(true);
      try {
        const [listRes, extRes] = await Promise.all([
          axios.get(`${API}/list-tracks-search/${list.id}`, { params: { q: addQuery } }),
          axios.get('/api/search', { params: { q: addQuery, slug: list.slug, sources: 'playit,spotify' } }),
        ]);
        const listTracks = (listRes.data || []).map(t => ({ ...t, _source: 'list' }));
        const listExtIds = new Set(listTracks.map(t => `${t.source}::${t.external_id}`));
        const ext = (extRes.data?.tracks || extRes.data || [])
          .filter(t => !t.existing && !listExtIds.has(`${t.source}::${t.external_id}`))
          .map(t => ({ ...t, _source: t.source || 'playit' }));
        setAddResults([...listTracks, ...ext]);
      } finally { setAddSearching(false); }
    }, 300);
  }, [addQuery, addState, list.id, list.slug]);

  const doAdd = async (track) => {
    const { regId } = addState;
    const payload = track.list_track_id
      ? { list_track_id: track.list_track_id }
      : { track: { external_id: track.external_id, source: track.source, title: track.title, artist: track.artist, album: track.album || null, cover_url: track.cover_url || null, year: track.year || null } };
    try {
      await axios.post(`${API}/submissions/${regId}/tracks/add`, payload);
      closeAdd();
      await reloadDetail(regId);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Toevoegen mislukt');
    }
  };

  const approveTrack = async (regId, voteId) => {
    await axios.post(`${API}/submissions/${regId}/tracks/${voteId}/approve`);
    await reloadDetail(regId);
    load();
  };

  const rejectTrack = async (regId, voteId) => {
    await axios.post(`${API}/submissions/${regId}/tracks/${voteId}/reject`);
    await reloadDetail(regId);
    load();
  };

  const resetTrack = async (regId, voteId) => {
    await axios.post(`${API}/submissions/${regId}/tracks/${voteId}/reset`);
    await reloadDetail(regId);
  };

  const deleteVoter = async (regId) => {
    if (!window.confirm('Stemmer en alle stemmen definitief verwijderen?')) return;
    try {
      await axios.delete(`${API}/registrations/${regId}`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || 'Verwijderen mislukt');
    }
  };

  const blockVoter = async (s) => {
    const reason = window.prompt(`Reden voor blokkering van ${s.email || s.name || 'deze stemmer'} (optioneel):`);
    if (reason === null) return; // cancel
    try {
      await axios.post(`${API}/registrations/${s.id}/block`, { reason, deleteReg: true });
      load();
    } catch (e) {
      alert(e.response?.data?.error || 'Blokkeren mislukt');
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Inzendingen: {list.name}</h2>

      {/* Statistieken */}
      {stats && (
        <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
          {[
            ['Totaal',       stats.total,    '#333', '#eee'],
            ['Wacht',        stats.pending,  STATUS_LABELS.pending.color,  STATUS_LABELS.pending.bg],
            ['Goedgekeurd',  stats.approved, STATUS_LABELS.approved.color, STATUS_LABELS.approved.bg],
            ['Afgewezen',    stats.rejected, STATUS_LABELS.rejected.color, STATUS_LABELS.rejected.bg],
          ].map(([label, count, color, bg]) => (
            <div key={label} style={{ background:bg, borderRadius:10, padding:'10px 20px', textAlign:'center' }}>
              <div style={{ fontSize:24, fontWeight:700, color }}>{count}</div>
              <div style={{ fontSize:12, color:'#666' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {['pending','approved','rejected'].map(s => (
          <button key={s} className={`btn btn-sm${filter === s ? '' : ' btn-outline'}`}
            onClick={() => setFilter(s)}>
            {STATUS_LABELS[s].label} {stats ? `(${stats[s]})` : ''}
          </button>
        ))}
        {onNoVoters && (
          <button className="btn btn-sm btn-outline" onClick={onNoVoters}>
            ⚠️ Niet gestemd
          </button>
        )}
        <button className="btn btn-sm btn-outline" onClick={load} style={{ marginLeft:'auto' }}>
          ↻ Vernieuwen
        </button>
      </div>

      {/* Zoekbalk */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Zoek op naam, e-mail of track…"
        style={{ marginBottom:12, width:'100%', maxWidth:400 }}
      />

      {loading ? <p>Laden…</p> : (() => {
        const q = search.toLowerCase().trim();
        const visible = !q ? submissions : submissions.filter(s => {
          if (s.name?.toLowerCase().includes(q))  return true;
          if (s.email?.toLowerCase().includes(q)) return true;
          return (detail[s.id] || []).some(v =>
            v.title?.toLowerCase().includes(q) || v.artist?.toLowerCase().includes(q)
          );
        });
        if (visible.length === 0) return (
          <p className="helper-text">Geen inzendingen gevonden.</p>
        );
        return (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {visible.map(s => {
            const statusKey = approvedToStatus(s.approved);
            const st = STATUS_LABELS[statusKey];
            const isOpen = expanded === s.id;

            return (
              <div key={s.id} className="card" style={{ padding:0, overflow:'hidden' }}>
                {/* Altijd zichtbaar: naam + tracks met approve-knoppen */}
                <div style={{ padding:'12px 16px', borderLeft:`4px solid ${st.color}` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <span style={{ fontWeight:700, flex:1 }}>{s.name || '(geen naam)'}</span>
                    <span style={{
                      background: st.bg, color: st.color, borderRadius:20,
                      padding:'2px 10px', fontSize:12, fontWeight:600, whiteSpace:'nowrap',
                    }}>{st.label}</span>
                  </div>

                  {/* Track-lijst met knoppen */}
                  {detail[s.id] ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {detail[s.id].map(v => {
                        const tStatus = v.track_approved === 1 ? 'approved' : v.track_approved === 0 ? 'rejected' : 'pending';
                        const tSt = STATUS_LABELS[tStatus];
                        const isReplacing = replaceState?.regId === s.id && replaceState?.voteId === v.vote_id;
                        return (
                          <div key={v.vote_id} style={{ borderRadius:6, background: tSt.bg, border: `1px solid ${tSt.color}22`, overflow:'hidden' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 8px' }}>
                              <span style={{ color:'#bbb', width:18, textAlign:'right', fontWeight:700, flexShrink:0 }}>{v.position}.</span>
                              <span style={{ flex:1, fontSize:14 }}>{v.artist} – {v.title}</span>
                              <span style={{ fontSize:11, color: tSt.color, fontWeight:600, minWidth:68, flexShrink:0 }}>{tSt.label}</span>
                              <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                                {tStatus !== 'approved' && (
                                  <button style={{ fontSize:11, padding:'2px 7px', background:'#080', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}
                                    onClick={() => approveTrack(s.id, v.vote_id)}>✓</button>
                                )}
                                {tStatus !== 'rejected' && (
                                  <button style={{ fontSize:11, padding:'2px 7px', background:'#c00', color:'#fff', border:'none', borderRadius:4, cursor:'pointer' }}
                                    onClick={() => rejectTrack(s.id, v.vote_id)}>✕</button>
                                )}
                                {tStatus !== 'pending' && (
                                  <button style={{ fontSize:11, padding:'2px 7px', background:'#eee', color:'#333', border:'none', borderRadius:4, cursor:'pointer' }}
                                    onClick={() => resetTrack(s.id, v.vote_id)}>↺</button>
                                )}
                                <button title="Vervang door andere track"
                                  style={{ fontSize:11, padding:'2px 7px', background: isReplacing ? '#e8a000' : '#eee', color: isReplacing ? '#fff' : '#555', border:'none', borderRadius:4, cursor:'pointer' }}
                                  onClick={() => isReplacing ? closeReplace() : openReplace(s.id, v.vote_id)}>🔄</button>
                              </div>
                            </div>
                            {isReplacing && (
                              <div style={{ padding:'8px 10px', background:'#fff8e8', borderTop:'1px solid #e8a00044' }}>
                                <div style={{ fontSize:12, fontWeight:600, marginBottom:4, color:'#8a5000' }}>Vervang door een andere track:</div>
                                <input
                                  autoFocus
                                  value={replaceQuery}
                                  onChange={e => setReplaceQuery(e.target.value)}
                                  placeholder="Zoek op artiest of titel…"
                                  style={{ width:'100%', padding:'5px 8px', borderRadius:5, border:'1px solid #ddd', fontSize:13, marginBottom:4 }}
                                />
                                {replaceSearching && <div style={{ fontSize:12, color:'#888' }}>Zoeken…</div>}
                                {replaceResults.map((r, i) => {
                                  const srcLabel = r._source === 'list' ? { txt:'Lijst', color:'#080' } : r._source === 'spotify' ? { txt:'Spotify', color:'#1db954' } : { txt:'PlayIt', color:'#e8a000' };
                                  return (
                                    <div key={r.list_track_id || `${r.source}-${r.external_id}-${i}`} onClick={() => doReplace(r)}
                                      style={{ padding:'4px 8px', borderRadius:4, cursor:'pointer', fontSize:13, display:'flex', gap:8, alignItems:'center' }}
                                      onMouseEnter={e => e.currentTarget.style.background='#f0e0b0'}
                                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                                      <span style={{ fontSize:10, fontWeight:700, color: srcLabel.color, minWidth:38 }}>{srcLabel.txt}</span>
                                      <span style={{ flex:1 }}>{r.artist} – {r.title}</span>
                                      <span style={{ fontSize:11, color:'#888' }}>{r.year || ''}</span>
                                    </div>
                                  );
                                })}
                                {replaceQuery.length >= 2 && !replaceSearching && replaceResults.length === 0 && (
                                  <div style={{ fontSize:12, color:'#888' }}>Geen tracks gevonden.</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="helper-text" style={{ fontSize:12, margin:'4px 0' }}>Laden…</p>}

                  {/* Track toevoegen als inzending onvolledig is */}
                  {detail[s.id] && detail[s.id].length < (list.max_votes || 3) && (() => {
                    const isAdding = addState?.regId === s.id;
                    return (
                      <div style={{ marginTop:6 }}>
                        <button
                          style={{ fontSize:11, padding:'3px 10px', background: isAdding ? '#e8a000' : '#e8f0ff', color: isAdding ? '#fff' : '#335', border:'none', borderRadius:4, cursor:'pointer' }}
                          onClick={() => isAdding ? closeAdd() : openAdd(s.id)}>
                          {isAdding ? '✕ Annuleer' : `+ Track toevoegen (${detail[s.id].length}/${list.max_votes || 3})`}
                        </button>
                        {isAdding && (
                          <div style={{ marginTop:6, padding:'8px 10px', background:'#f0f4ff', borderRadius:6, border:'1px solid #b0c4ff' }}>
                            <div style={{ fontSize:12, fontWeight:600, marginBottom:4, color:'#2244aa' }}>Voeg een track toe:</div>
                            <input
                              autoFocus
                              value={addQuery}
                              onChange={e => setAddQuery(e.target.value)}
                              placeholder="Zoek op artiest of titel…"
                              style={{ width:'100%', padding:'5px 8px', borderRadius:5, border:'1px solid #ddd', fontSize:13, marginBottom:4 }}
                            />
                            {addSearching && <div style={{ fontSize:12, color:'#888' }}>Zoeken…</div>}
                            {addResults.map((r, i) => {
                              const srcLabel = r._source === 'list' ? { txt:'Lijst', color:'#080' } : r._source === 'spotify' ? { txt:'Spotify', color:'#1db954' } : { txt:'PlayIt', color:'#e8a000' };
                              return (
                                <div key={r.list_track_id || `${r.source}-${r.external_id}-${i}`} onClick={() => doAdd(r)}
                                  style={{ padding:'4px 8px', borderRadius:4, cursor:'pointer', fontSize:13, display:'flex', gap:8, alignItems:'center' }}
                                  onMouseEnter={e => e.currentTarget.style.background='#d8e4ff'}
                                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                                  <span style={{ fontSize:10, fontWeight:700, color: srcLabel.color, minWidth:38 }}>{srcLabel.txt}</span>
                                  <span style={{ flex:1 }}>{r.artist} – {r.title}</span>
                                  <span style={{ fontSize:11, color:'#888' }}>{r.year || ''}</span>
                                </div>
                              );
                            })}
                            {addQuery.length >= 2 && !addSearching && addResults.length === 0 && (
                              <div style={{ fontSize:12, color:'#888' }}>Geen tracks gevonden.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Uitvouw-knop voor contactgegevens */}
                  <button
                    onClick={() => toggle(s.id)}
                    style={{ marginTop:10, fontSize:12, background:'none', border:'none', color:'#999', cursor:'pointer', padding:0 }}
                  >
                    {isOpen ? '▲ Verberg contactgegevens' : '▼ Toon contactgegevens & acties'}
                  </button>
                </div>

                {/* Uitklapbaar: contactgegevens + acties */}
                {isOpen && (
                  <div style={{ padding:'10px 16px 14px', borderTop:'1px solid #f0f0f0', background:'#fafafa' }}>
                    <div style={{ fontSize:13, display:'flex', flexDirection:'column', gap:4, marginBottom:8 }}>
                      <div>✉️ <a href={`mailto:${s.email}`} style={{ color:'#555' }}>{s.email}</a></div>
                      {s.phone && <div>📞 <strong>{s.phone}</strong></div>}
                      <div style={{ color:'#aaa', fontSize:11 }}>{new Date(s.created_at).toLocaleString('nl-NL')}</div>
                    </div>

                    {s.comment && (
                      <div style={{ marginBottom:10, padding:'8px 12px', background:'#fffbea', borderRadius:8, border:'1px solid #ffe58f' }}>
                        <strong style={{ fontSize:12, color:'#8a7000' }}>Opmerking van stemmer:</strong>
                        <p style={{ margin:'4px 0 0', fontSize:14 }}>{s.comment}</p>
                      </div>
                    )}

                    {/* Acties voor de hele inzending */}
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {statusKey !== 'approved' && (
                        <button className="btn btn-sm" style={{ background:'#080' }} onClick={() => approve(s.id)}>
                          ✓ Alles goedkeuren
                        </button>
                      )}
                      {statusKey !== 'rejected' && (
                        <button className="btn btn-sm" style={{ background:'#c00' }} onClick={() => reject(s.id)}>
                          ✕ Alles afwijzen
                        </button>
                      )}
                      {statusKey !== 'pending' && (
                        <button className="btn btn-sm btn-outline" onClick={() => reset(s.id)}>
                          ↺ Terugzetten
                        </button>
                      )}
                      {hasPerm('blocks') && (<>
                      <button className="btn btn-sm btn-outline"
                        style={{ color:'#c44', borderColor:'#c44', marginLeft:'auto' }}
                        onClick={() => deleteVoter(s.id)}>
                        🗑 Verwijder
                      </button>
                      <button className="btn btn-sm btn-outline"
                        style={{ color:'#a00', borderColor:'#a00' }}
                        onClick={() => blockVoter(s)}>
                        ⛔ Blokkeer
                      </button>
                      </>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
