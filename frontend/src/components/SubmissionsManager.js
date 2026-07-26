import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

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

export default function SubmissionsManager({ list }) {
  const [filter,      setFilter]      = useState('pending');
  const [submissions, setSubmissions] = useState([]);
  const [stats,       setStats]       = useState(null);
  const [expanded,    setExpanded]    = useState(null); // regId
  const [detail,      setDetail]      = useState({});   // regId → votes
  const [loading,     setLoading]     = useState(true);

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
        <button className="btn btn-sm btn-outline" onClick={load} style={{ marginLeft:'auto' }}>
          ↻ Vernieuwen
        </button>
      </div>

      {loading ? <p>Laden…</p> : submissions.length === 0 ? (
        <p className="helper-text">Geen inzendingen met status "{STATUS_LABELS[filter]?.label}".</p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {submissions.map(s => {
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
                        return (
                          <div key={v.vote_id} style={{
                            display:'flex', alignItems:'center', gap:8,
                            padding:'4px 8px', borderRadius:6, background: tSt.bg,
                            border: `1px solid ${tSt.color}22`,
                          }}>
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="helper-text" style={{ fontSize:12, margin:'4px 0' }}>Laden…</p>}

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
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
