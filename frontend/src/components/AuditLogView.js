import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api/admin';

const ACTION_LABELS = {
  'login':              { icon: '🔑', label: 'Ingelogd',               color: '#555' },
  'vote.cast':          { icon: '🗳️', label: 'Stem uitgebracht',        color: '#1565c0' },
  'submission.approve': { icon: '✅', label: 'Inzending goedgekeurd',   color: '#2e7d32' },
  'submission.reject':  { icon: '❌', label: 'Inzending afgewezen',     color: '#c62828' },
  'submission.reset':   { icon: '↺',  label: 'Inzending teruggezet',   color: '#888' },
  'track.approve':      { icon: '✅', label: 'Track goedgekeurd',       color: '#2e7d32' },
  'track.reject':       { icon: '❌', label: 'Track afgewezen',         color: '#c62828' },
  'track.reset':        { icon: '↺',  label: 'Track teruggezet',        color: '#888' },
  'track.delete':       { icon: '🗑', label: 'Track verwijderd',        color: '#c62828' },
  'track.score_adjust': { icon: '🔢', label: 'Score aangepast',         color: '#6a1b9a' },
  'user.delete':        { icon: '🗑', label: 'Gebruiker verwijderd',    color: '#c62828' },
  'voter.delete':       { icon: '🗑', label: 'Stemmer verwijderd',      color: '#c62828' },
  'voter.block':        { icon: '⛔', label: 'Stemmer geblokkeerd',     color: '#e65100' },
  'voter.unblock':      { icon: '🔓', label: 'Stemmer gedeblokkeerd',   color: '#2e7d32' },
  'chart.publish':      { icon: '📢', label: 'Hitlijst gepubliceerd',   color: '#6a1b9a' },
  'season.reset':       { icon: '♻', label: 'Seizoensreset',            color: '#c62828' },
};

function fmtTs(ts) {
  if (!ts) return '-';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('nl-NL', { day:'2-digit', month:'2-digit', year:'numeric' })
    + ' ' + d.toLocaleTimeString('nl-NL', { hour:'2-digit', minute:'2-digit' });
}

function DetailCell({ detail, action }) {
  if (!detail) return null;
  const parts = [];
  if (detail.list)   parts.push(detail.list);
  if (detail.name)   parts.push(detail.name);
  if (detail.week)   parts.push(`week ${detail.week}/${detail.year}`);
  if (detail.trackCount != null) parts.push(`${detail.trackCount} tracks`);
  if (detail.votesDeleted != null && action === 'season.reset') parts.push(`${detail.votesDeleted} stemmen, ${detail.registrationsDeleted} stemmers gewist`);
  if (detail.reason)  parts.push(`reden: ${detail.reason}`);
  if (detail.voter)   parts.push(`stemmer: ${detail.voter}`);
  if (detail.position != null) parts.push(`positie ${detail.position}`);
  if (Array.isArray(detail.tracks)) parts.push(detail.tracks.join(', '));
  if (detail.previous != null && detail.adjustment != null) parts.push(`${detail.previous} → ${detail.adjustment}`);
  if (detail.votesDeleted != null && action === 'track.delete') parts.push(`${detail.votesDeleted} gekoppelde stemmen verwijderd`);
  if (detail.role) parts.push(`rol: ${detail.role}`);
  if (detail.permissions) parts.push(`rechten: ${detail.permissions}`);
  if (detail.ip)      parts.push(`IP: ${detail.ip}`);
  return <span style={{ fontSize: 12, color: '#666' }}>{parts.join(' · ')}</span>;
}

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

export default function AuditLogView() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [page,    setPage]    = useState(1);
  const [filter,  setFilter]  = useState({ action: '', since: '' });

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit };
      if (filter.action) params.action = filter.action;
      if (filter.since)  params.since  = filter.since;
      const res = await axios.get(`${API}/audit-log`, { params });
      setRows(res.data.rows);
      setTotal(res.data.total);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>🗂 Activiteitenlog</h2>

      {/* Filter bar */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        <select
          value={filter.action}
          onChange={e => { setFilter(f => ({ ...f, action: e.target.value })); setPage(1); }}
          style={{ padding:'6px 10px', borderRadius:6, border:'1px solid #ddd' }}
        >
          <option value="">Alle acties</option>
          {ALL_ACTIONS.map(a => (
            <option key={a} value={a}>{ACTION_LABELS[a].icon} {ACTION_LABELS[a].label}</option>
          ))}
        </select>

        <input
          type="date"
          value={filter.since}
          onChange={e => { setFilter(f => ({ ...f, since: e.target.value })); setPage(1); }}
          style={{ padding:'6px 10px', borderRadius:6, border:'1px solid #ddd' }}
        />

        <button className="btn btn-sm btn-outline" onClick={() => { setFilter({ action:'', since:'' }); setPage(1); }}>
          Wis filters
        </button>

        <span className="helper-text" style={{ marginLeft:'auto' }}>
          {total} {total === 1 ? 'regel' : 'regels'}
        </span>
      </div>

      {error && <p style={{ color:'#c00' }}>Fout: {error}</p>}

      {loading ? (
        <p>Laden…</p>
      ) : rows.length === 0 ? (
        <p className="helper-text">Geen activiteit gevonden.</p>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table className="data-table" style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'var(--bg-soft, #f4f4f6)', textAlign:'left' }}>
                <th style={{ padding:'10px 12px', width:140 }}>Tijdstip</th>
                <th style={{ padding:'10px 12px', width:120 }}>Gebruiker</th>
                <th style={{ padding:'10px 12px', width:200 }}>Actie</th>
                <th style={{ padding:'10px 12px', width:160 }}>Lijst</th>
                <th style={{ padding:'10px 12px' }}>Doel / Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const meta = ACTION_LABELS[row.action] || { icon:'·', label: row.action, color:'#888' };
                return (
                  <tr key={row.id} style={{ borderTop:'1px solid var(--border, #eee)' }}>
                    <td style={{ padding:'7px 12px', fontSize:12, color:'#666', whiteSpace:'nowrap' }}>
                      {fmtTs(row.ts)}
                    </td>
                    <td style={{ padding:'7px 12px', fontWeight:600, fontSize:13 }}>
                      {row.actor === 'public' ? <span style={{ color:'#888', fontWeight:400 }}>stemmer</span> : row.actor || '—'}
                    </td>
                    <td style={{ padding:'7px 12px' }}>
                      <span style={{ color: meta.color, fontWeight:600, fontSize:13 }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td style={{ padding:'7px 12px', fontSize:13, color:'#555' }}>
                      {row.list_name || (row.list_id ? `#${row.list_id}` : '—')}
                    </td>
                    <td style={{ padding:'7px 12px' }}>
                      <div style={{ fontSize:13 }}>{row.target || ''}</div>
                      <DetailCell detail={row.detail} action={row.action} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginering */}
      {totalPages > 1 && (
        <div style={{ display:'flex', gap:8, marginTop:16, alignItems:'center', justifyContent:'center' }}>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>
            ← Vorige
          </button>
          <span className="helper-text">Pagina {page} / {totalPages}</span>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>
            Volgende →
          </button>
        </div>
      )}
    </div>
  );
}
