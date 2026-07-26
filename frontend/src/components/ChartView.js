import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

/**
 * Live admin-overzicht van de huidige stand van een hitlijst.
 * Toont score (zelfde formule als publish) + aantal stemmen per track.
 */
export default function ChartView({ list }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [includeAll, setIncl]   = useState(false);
  const [showZero, setShowZero] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = includeAll ? { includeAll: 1 } : {};
      const res = await axios.get(`${API}/admin/chart-live/${list.id}`, { params });
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [list.id, includeAll]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p>Laden…</p>;
  if (error)   return <p style={{ color: '#c00' }}>Fout: {error}</p>;
  if (!data)   return null;

  const visible = showZero ? data.chart : data.chart.filter(r => r.vote_count > 0);

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
      }}>
        <div>
          <h2 style={{ margin: 0 }}>📊 Hitlijst: {list.name}</h2>
          <p className="helper-text" style={{ margin: '4px 0 0' }}>
            {data.totals.total_voters} stemmer{data.totals.total_voters === 1 ? '' : 's'} · {data.totals.total_votes} stem{data.totals.total_votes === 1 ? '' : 'men'}
            {' · '}max {data.list.max_votes} keuzes
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={includeAll} onChange={e => setIncl(e.target.checked)} />
            Inclusief niet-goedgekeurde stemmen
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} />
            Toon tracks zonder stemmen
          </label>
          <button className="btn btn-sm btn-outline" onClick={load}>🔄 Vernieuwen</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="helper-text">Nog geen stemmen.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-soft, #f4f4f6)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', width: 50 }}>#</th>
                <th style={{ padding: '10px 12px' }}>Artiest</th>
                <th style={{ padding: '10px 12px' }}>Titel</th>
                <th style={{ padding: '10px 12px', width: 80,  textAlign: 'right' }}>Score</th>
                <th style={{ padding: '10px 12px', width: 90,  textAlign: 'right' }}>Stemmen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => (
                <tr key={row.track_id} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ padding: '8px 12px' }}>{row.artist}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {row.title}
                    {row.release_year ? <span className="helper-text"> · {row.release_year}</span> : null}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.score}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{row.vote_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
