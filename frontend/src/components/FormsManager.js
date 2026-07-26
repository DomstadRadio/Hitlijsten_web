import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = '/api';

/**
 * Admin overzicht van alle formulieren.
 * Props: onEdit(form), onResponses(form)
 */
export default function FormsManager({ onEdit, onResponses }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/forms`);
      setForms(r.data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const name = window.prompt('Naam van het nieuwe formulier?');
    if (!name) return;
    try {
      const r = await axios.post(`${API}/admin/forms`, { name });
      onEdit?.(r.data);
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    }
  };

  const remove = async (f) => {
    if (!window.confirm(`Formulier "${f.name}" en alle inzendingen verwijderen?`)) return;
    try {
      await axios.delete(`${API}/admin/forms/${f.id}`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    }
  };

  if (loading) return <p>Laden…</p>;
  if (error)   return <p style={{ color: '#c00' }}>{error}</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📋 Custom formulieren</h2>
        <button className="btn" onClick={create}>+ Nieuw formulier</button>
      </div>

      {forms.length === 0 ? (
        <p className="helper-text">Nog geen formulieren — maak er eentje aan.</p>
      ) : (
        <div className="card-grid">
          {forms.map(f => (
            <div key={f.id} className="card" style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>{f.name}</h3>
              <p className="helper-text" style={{ margin: '4px 0' }}>
                <code>/formulier/{f.slug}</code> · status: <strong>{f.status}</strong> · {f.response_count} inzending{f.response_count === 1 ? '' : 'en'}
              </p>
              {f.description && <p style={{ fontSize: 14, color: '#444' }}>{f.description}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn btn-sm" onClick={() => onEdit?.(f)}>✏️ Bewerken</button>
                <button className="btn btn-sm btn-outline" onClick={() => onResponses?.(f)}>📊 Inzendingen ({f.response_count})</button>
                <a className="btn btn-sm btn-outline" href={`/formulier/${f.slug}`} target="_blank" rel="noreferrer">↗ Openen</a>
                <button className="btn btn-sm btn-outline" style={{ color: '#c00' }} onClick={() => remove(f)}>🗑️ Verwijderen</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
