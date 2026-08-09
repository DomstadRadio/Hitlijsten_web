import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api/admin';

const emptyProgram = { name: '', email: '', description: '', active: true };

export default function ProgramsManager() {
  const [programs, setPrograms] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);  // null | {} | program-object
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/programs`, { withCredentials: true })
      .then(r => setPrograms(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing.name.trim() || !editing.email.trim()) {
      return setError('Naam en e-mail zijn verplicht');
    }
    setSaving(true); setError('');
    try {
      if (editing.id) {
        await axios.put(`${API}/programs/${editing.id}`, editing, { withCredentials: true });
      } else {
        await axios.post(`${API}/programs`, editing, { withCredentials: true });
      }
      setEditing(null);
      load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (prog) => {
    try {
      await axios.put(`${API}/programs/${prog.id}`, { active: !prog.active }, { withCredentials: true });
      load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Programma verwijderen?')) return;
    try {
      await axios.delete(`${API}/programs/${id}`, { withCredentials: true });
      load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>📻 Radioprogramma's</h2>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Beheer hier de radioprogramma's die in formulieren gekozen kunnen worden.
        Bij een suggestie-inzending krijgt de DJ een e-mailnotificatie.
      </p>

      {error && (
        <div style={{ background: '#fdecea', color: '#c62828', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <button
        onClick={() => { setEditing({ ...emptyProgram }); setError(''); }}
        style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', marginBottom: 16 }}
      >
        + Programma toevoegen
      </button>

      {/* Formulier (add / edit) */}
      {editing && (
        <div style={{ background: '#f5f7fa', border: '1px solid #c5cae9', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>{editing.id ? 'Programma bewerken' : 'Nieuw programma'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Naam *</span>
              <input
                value={editing.name}
                onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                placeholder="bijv. Utrechtse Top 100"
                style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>E-mail DJ *</span>
              <input
                type="email"
                value={editing.email}
                onChange={e => setEditing(p => ({ ...p, email: e.target.value }))}
                placeholder="dj@domstad.nl"
                style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span>Omschrijving (optioneel)</span>
              <input
                value={editing.description || ''}
                onChange={e => setEditing(p => ({ ...p, description: e.target.value }))}
                placeholder="bijv. Zaterdag 14:00 – 16:00"
                style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={!!editing.active}
                onChange={e => setEditing(p => ({ ...p, active: e.target.checked }))}
              />
              Actief (zichtbaar in formulieren)
            </label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}
            >
              {saving ? 'Opslaan…' : '💾 Opslaan'}
            </button>
            <button
              onClick={() => setEditing(null)}
              style={{ background: '#eee', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p>Laden…</p>
      ) : programs.length === 0 ? (
        <p style={{ color: '#888' }}>Nog geen programma's toegevoegd.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e8eaf6' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Naam</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>E-mail DJ</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Omschrijving</th>
              <th style={{ padding: '8px 12px', textAlign: 'center' }}>Actief</th>
              <th style={{ padding: '8px 12px' }}></th>
            </tr>
          </thead>
          <tbody>
            {programs.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee', opacity: p.active ? 1 : 0.5 }}>
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 13 }}>{p.email}</td>
                <td style={{ padding: '8px 12px', color: '#666', fontSize: 13 }}>{p.description || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <button
                    onClick={() => toggleActive(p)}
                    title={p.active ? 'Deactiveren' : 'Activeren'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
                  >
                    {p.active ? '✅' : '⭕'}
                  </button>
                </td>
                <td style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setEditing({ ...p }); setError(''); }}
                    style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                  >
                    ✏️ Bewerken
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    style={{ background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                  >
                    🗑 Verwijder
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
