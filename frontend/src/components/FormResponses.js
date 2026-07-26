import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = '/api';

/**
 * Toont alle inzendingen van een formulier.
 * Props: form, onBack()
 */
export default function FormResponses({ form, onBack }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [open, setOpen]       = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/forms/${form.id}/responses`);
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [form.id]);

  const remove = async (resp) => {
    if (!window.confirm('Inzending verwijderen?')) return;
    try {
      await axios.delete(`${API}/admin/forms/${form.id}/responses/${resp.id}`);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <p>Laden…</p>;
  if (error)   return <p style={{ color: '#c00' }}>{error}</p>;
  if (!data)   return null;

  const fields = [];
  for (const p of (data.form.schema.pages || [])) for (const f of (p.fields || [])) fields.push(f);

  const downloadCsv = () => {
    const token = localStorage.getItem('hitlijsten_token');
    fetch(`${API}/admin/forms/${form.id}/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.blob()).then(b => {
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = `${form.slug}-responses.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(e => alert(e.message));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📊 Inzendingen — {data.form.name}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={load}>🔄 Vernieuwen</button>
          <button className="btn" onClick={downloadCsv} disabled={data.responses.length === 0}>⬇ CSV exporteren</button>
          <button className="btn btn-outline" onClick={onBack}>← Terug</button>
        </div>
      </div>

      {data.responses.length === 0 ? (
        <p className="helper-text">Nog geen inzendingen.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ background: '#f4f4f6', textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Ingediend</th>
                <th style={th}>Naam</th>
                <th style={th}>E-mail</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {data.responses.map(r => (
                <React.Fragment key={r.id}>
                  <tr style={{ borderTop: '1px solid #eee' }}>
                    <td style={td}>{r.id}</td>
                    <td style={td}>{r.submitted_at}</td>
                    <td style={td}>{r.name || '—'}</td>
                    <td style={td}>{r.email || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-outline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Sluiten' : 'Bekijken'}
                      </button>
                      <button className="btn btn-sm btn-outline" style={{ color: '#c00', marginLeft: 4 }} onClick={() => remove(r)}>×</button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={5} style={{ background: '#fafafa', padding: 12 }}>
                        <ResponseDetail answers={r.answers} fields={fields} />
                        {r.comment && <p><strong>Opmerking:</strong> {r.comment}</p>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResponseDetail({ answers, fields }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {fields.map(f => (
          <tr key={f.id}>
            <td style={{ padding: '6px 10px', verticalAlign: 'top', width: '30%', fontWeight: 600 }}>{f.label}</td>
            <td style={{ padding: '6px 10px' }}>{renderValue(answers[f.id])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function renderValue(v) {
  if (v === null || v === undefined || v === '') return <em>—</em>;
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object' && v[0].title) {
      return <ol style={{ margin: 0, paddingLeft: 20 }}>{v.map((t, i) => <li key={i}>{t.artist} – {t.title}</li>)}</ol>;
    }
    return v.join(', ');
  }
  if (typeof v === 'object' && v.title) return `${v.artist} – ${v.title}`;
  return String(v);
}

const th = { padding: '8px 12px', fontSize: 13 };
const td = { padding: '8px 12px', fontSize: 14 };
