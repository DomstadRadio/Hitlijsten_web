import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = '/api/auth';

const ALL_PERMS = [
  { key: 'lists',       label: '📋 Lijsten beheren',       desc: 'Aanmaken, bewerken, verwijderen' },
  { key: 'tracks',      label: '🎵 Tracks beheren',         desc: 'Tracks toevoegen, verwijderen, sync' },
  { key: 'submissions', label: '📬 Inzendingen beoordelen', desc: 'Goedkeuren, afwijzen, per track' },
  { key: 'voters',      label: '📞 Stemmers bekijken',      desc: 'Overzicht voor radio-calls' },
  { key: 'chart',       label: '🏆 Hitlijst publiceren',    desc: 'Chart berekenen en publiceren' },
  { key: 'forms',       label: '📝 Formulieren',            desc: 'Custom formulieren bouwen en inzendingen bekijken' },
  { key: 'settings',    label: '⚙️ Instellingen',           desc: 'SMTP, sync, e-mail test' },
  { key: 'users',       label: '👤 Gebruikers beheren',     desc: 'Accounts en rechten' },
];

export default function UserManager() {
  const { user: me, hasPerm } = useAuth();

  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showNew,   setShowNew]   = useState(false);
  const [editPerms, setEditPerms] = useState(null); // { id, username, permissions }
  const [pwdEdit,   setPwdEdit]   = useState(null); // { id, username }
  const [newPwd,    setNewPwd]    = useState('');
  const [newUser,   setNewUser]   = useState({ username: '', password: '', permissions: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API}/users`);
      setUsers(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Laden mislukt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isSuperAdmin = hasPerm('*');

  // ── Permissie helpers ────────────────────────────────────────────────────
  function parsePerms(str) {
    if (str === '*') return '*';
    return (str || '').split(',').map(p => p.trim()).filter(Boolean);
  }

  function hasPermInList(perms, key) {
    if (perms === '*') return true;
    return Array.isArray(perms) && perms.includes(key);
  }

  function togglePerm(perms, key) {
    if (perms === '*') return ALL_PERMS.map(p => p.key).filter(k => k !== key);
    const arr = Array.isArray(perms) ? [...perms] : [];
    return arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key];
  }

  function permsToStr(perms) {
    if (perms === '*') return '*';
    return (Array.isArray(perms) ? perms : []).join(',');
  }

  // ── Acties ───────────────────────────────────────────────────────────────
  const savePerms = async () => {
    try {
      const permStr = permsToStr(editPerms.permissions);
      await axios.put(`${API}/users/${editPerms.id}/permissions`, { permissions: permStr });
      setEditPerms(null);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Opslaan mislukt');
    }
  };

  const savePassword = async () => {
    if (!newPwd || newPwd.length < 6) return alert('Minimaal 6 tekens');
    try {
      await axios.put(`${API}/users/${pwdEdit.id}/password`, { password: newPwd });
      setPwdEdit(null);
      setNewPwd('');
    } catch (err) {
      alert(err.response?.data?.error || 'Wijzigen mislukt');
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Gebruiker "${u.username}" verwijderen?`)) return;
    try {
      await axios.delete(`${API}/users/${u.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Verwijderen mislukt');
    }
  };

  const createUser = async () => {
    if (!newUser.username || !newUser.password) return alert('Gebruikersnaam en wachtwoord zijn verplicht');
    try {
      const permStr = permsToStr(newUser.permissions);
      await axios.post(`${API}/users`, {
        username: newUser.username,
        password: newUser.password,
        role: 'admin',
        permissions: permStr,
      });
      setShowNew(false);
      setNewUser({ username: '', password: '', permissions: [] });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Aanmaken mislukt');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>👤 Gebruikers & rechten</h2>
        <button className="btn btn-sm" onClick={() => setShowNew(true)}>+ Nieuwe gebruiker</button>
      </div>

      {error && <p style={{ color: '#c00' }}>{error}</p>}
      {loading ? <p>Laden…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map(u => {
            const perms = parsePerms(u.permissions);
            const isSelf = u.id === me?.id;
            return (
              <div key={u.id} className="card" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 700, flex: 1 }}>{u.username}</span>
                  {isSelf && <span style={{ fontSize: 11, color: '#888' }}>(jij)</span>}
                  {perms === '*' && (
                    <span style={{ fontSize: 11, background: '#333', color: '#fff', borderRadius: 20, padding: '2px 10px' }}>
                      Superadmin
                    </span>
                  )}
                  <button className="btn btn-sm btn-outline" onClick={() => {
                    setEditPerms({ id: u.id, username: u.username, permissions: parsePerms(u.permissions) });
                  }}>
                    🔑 Rechten
                  </button>
                  <button className="btn btn-sm btn-outline" onClick={() => { setPwdEdit(u); setNewPwd(''); }}>
                    🔒 Wachtwoord
                  </button>
                  {!isSelf && (
                    <button className="btn btn-sm" style={{ background: '#c00' }} onClick={() => deleteUser(u)}>
                      🗑
                    </button>
                  )}
                </div>

                {/* Permissie-badges */}
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {perms === '*' ? (
                    <span style={{ fontSize: 11, color: '#666' }}>Alle rechten</span>
                  ) : perms.length === 0 ? (
                    <span style={{ fontSize: 11, color: '#c00' }}>Geen rechten</span>
                  ) : (
                    ALL_PERMS.filter(p => perms.includes(p.key)).map(p => (
                      <span key={p.key} style={{
                        fontSize: 11, background: '#e8f5e9', color: '#2e7d32',
                        borderRadius: 20, padding: '2px 8px',
                      }}>
                        {p.label}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Rechten bewerken modal ── */}
      {editPerms && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setEditPerms(null)}>
          <div className="card" style={{ width: 420, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Rechten: {editPerms.username}</h3>

            {isSuperAdmin && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff8e1', borderRadius: 8, border: '1px solid #ffe082' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editPerms.permissions === '*'}
                    onChange={() => setEditPerms(ep => ({
                      ...ep,
                      permissions: ep.permissions === '*' ? [] : '*',
                    }))}
                  />
                  <span><strong>Superadmin</strong> — alle huidige en toekomstige rechten</span>
                </label>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ALL_PERMS.map(p => (
                <label key={p.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                  padding: '8px 12px', borderRadius: 8,
                  background: hasPermInList(editPerms.permissions, p.key) ? '#e8f5e9' : '#f9f9f9',
                  border: `1px solid ${hasPermInList(editPerms.permissions, p.key) ? '#a5d6a7' : '#eee'}`,
                  opacity: editPerms.permissions === '*' ? 0.5 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={hasPermInList(editPerms.permissions, p.key)}
                    disabled={editPerms.permissions === '*'}
                    onChange={() => setEditPerms(ep => ({
                      ...ep,
                      permissions: togglePerm(ep.permissions, p.key),
                    }))}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{p.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn" onClick={savePerms} style={{ flex: 1 }}>Opslaan</button>
              <button className="btn btn-outline" onClick={() => setEditPerms(null)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Wachtwoord wijzigen modal ── */}
      {pwdEdit && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setPwdEdit(null)}>
          <div className="card" style={{ width: 360, padding: 24 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Wachtwoord: {pwdEdit.username}</h3>
            <div className="form-group">
              <label>Nieuw wachtwoord</label>
              <input
                type="password"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                placeholder="Minimaal 6 tekens"
                onKeyDown={e => e.key === 'Enter' && savePassword()}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={savePassword} style={{ flex: 1 }}>Opslaan</button>
              <button className="btn btn-outline" onClick={() => setPwdEdit(null)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Nieuwe gebruiker modal ── */}
      {showNew && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowNew(false)}>
          <div className="card" style={{ width: 420, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Nieuwe gebruiker</h3>

            <div className="form-group">
              <label>Gebruikersnaam</label>
              <input
                value={newUser.username}
                onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                placeholder="gebruikersnaam"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Wachtwoord</label>
              <input
                type="password"
                value={newUser.password}
                onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                placeholder="Minimaal 6 tekens"
              />
            </div>

            <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Rechten:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALL_PERMS.map(p => (
                <label key={p.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                  padding: '6px 10px', borderRadius: 8,
                  background: hasPermInList(newUser.permissions, p.key) ? '#e8f5e9' : '#f9f9f9',
                  border: `1px solid ${hasPermInList(newUser.permissions, p.key) ? '#a5d6a7' : '#eee'}`,
                }}>
                  <input
                    type="checkbox"
                    checked={hasPermInList(newUser.permissions, p.key)}
                    onChange={() => setNewUser(u => ({
                      ...u,
                      permissions: togglePerm(u.permissions, p.key),
                    }))}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{p.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn" onClick={createUser} style={{ flex: 1 }}>Aanmaken</button>
              <button className="btn btn-outline" onClick={() => setShowNew(false)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
