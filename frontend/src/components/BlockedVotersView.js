import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api/admin';

export default function BlockedVotersView({ list }) {
  const [blocks,  setBlocks]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API}/blocks/${list.id}`);
      setBlocks(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Laden mislukt');
    } finally {
      setLoading(false);
    }
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  const unblock = async (blockId) => {
    if (!window.confirm('Blokkering opheffen?')) return;
    try {
      await axios.delete(`${API}/blocks/${blockId}`);
      setBlocks(bs => bs.filter(b => b.id !== blockId));
    } catch (e) {
      alert(e.response?.data?.error || 'Opheffen mislukt');
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Blokkeringen: {list.name}</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Geblokkeerde e-mailadressen en/of apparaten kunnen niet opnieuw stemmen.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-sm btn-outline" onClick={load}>↻ Vernieuwen</button>
      </div>

      {loading && <p>Laden…</p>}
      {error   && <p style={{ color: '#c00' }}>{error}</p>}

      {!loading && blocks.length === 0 && (
        <p style={{ color: '#888' }}>Geen blokkeringen voor deze lijst.</p>
      )}

      {blocks.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--surface, #f5f5f5)', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px' }}>E-mail</th>
              <th style={{ padding: '8px 10px' }}>Apparaat-ID</th>
              <th style={{ padding: '8px 10px' }}>Reden</th>
              <th style={{ padding: '8px 10px' }}>Geblokkeerd op</th>
              <th style={{ padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {blocks.map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid var(--border, #e0e0e0)' }}>
                <td style={{ padding: '8px 10px' }}>{b.email || '—'}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>
                  {b.machine_id ? b.machine_id.substring(0, 16) + '…' : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: '#666' }}>{b.reason || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#888', fontSize: 12 }}>
                  {b.blocked_at ? new Date(b.blocked_at).toLocaleString('nl-NL') : '—'}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ color: '#080', borderColor: '#080' }}
                    onClick={() => unblock(b.id)}
                  >
                    Deblokkeer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
