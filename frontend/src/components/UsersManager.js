import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function UsersManager() {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [newUser, setNewUser]   = useState({ username: '', password: '' });
  const [pwEdit, setPwEdit]     = useState({}); // { [id]: newPassword }
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const load = async () => {
    setLoading(true);
    const res = await axios.get('/api/auth/users');
    setUsers(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(''); setSuccess(''); }, 3000);
  };

  const createUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post('/api/auth/users', { ...newUser, role: 'admin' });
      setNewUser({ username: '', password: '' });
      flash('Gebruiker aangemaakt');
      load();
    } catch (err) {
      flash(err.response?.data?.error || 'Aanmaken mislukt', true);
    }
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(`Gebruiker "${username}" verwijderen?`)) return;
    try {
      await axios.delete(`/api/auth/users/${id}`);
      flash('Gebruiker verwijderd');
      load();
    } catch (err) {
      flash(err.response?.data?.error || 'Verwijderen mislukt', true);
    }
  };

  const changePassword = async (id) => {
    const pw = pwEdit[id];
    if (!pw || pw.length < 6) return flash('Wachtwoord min. 6 tekens', true);
    try {
      await axios.put(`/api/auth/users/${id}/password`, { password: pw });
      setPwEdit(p => ({ ...p, [id]: '' }));
      flash('Wachtwoord gewijzigd');
    } catch (err) {
      flash(err.response?.data?.error || 'Wijzigen mislukt', true);
    }
  };

  return (
    <div>
      <h2>Gebruikersbeheer</h2>

      {error   && <div style={{ padding:8, background:'#fdd', borderRadius:6, marginBottom:12, color:'#c00' }}>{error}</div>}
      {success && <div style={{ padding:8, background:'#dfd', borderRadius:6, marginBottom:12, color:'#080' }}>{success}</div>}

      {/* Bestaande gebruikers */}
      {loading ? <p>Laden…</p> : (
        <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:32 }}>
          <thead>
            <tr style={{ borderBottom:'2px solid #ddd', textAlign:'left' }}>
              <th style={{ padding:'8px 4px' }}>Gebruikersnaam</th>
              <th style={{ padding:'8px 4px' }}>Rol</th>
              <th style={{ padding:'8px 4px' }}>Aangemaakt</th>
              <th style={{ padding:'8px 4px' }}>Nieuw wachtwoord</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom:'1px solid #eee' }}>
                <td style={{ padding:'8px 4px' }}>{u.username}</td>
                <td style={{ padding:'8px 4px' }}>{u.role}</td>
                <td style={{ padding:'8px 4px', fontSize:12, color:'#666' }}>
                  {new Date(u.created_at).toLocaleDateString('nl')}
                </td>
                <td style={{ padding:'8px 4px' }}>
                  <div style={{ display:'flex', gap:6 }}>
                    <input
                      className="input"
                      type="password"
                      placeholder="Nieuw wachtwoord"
                      value={pwEdit[u.id] || ''}
                      onChange={e => setPwEdit(p => ({ ...p, [u.id]: e.target.value }))}
                      style={{ maxWidth:180 }}
                    />
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => changePassword(u.id)}
                    >Wijzig</button>
                  </div>
                </td>
                <td style={{ padding:'8px 4px' }}>
                  <button
                    className="btn btn-sm"
                    style={{ background:'#c00' }}
                    onClick={() => deleteUser(u.id, u.username)}
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Nieuwe gebruiker aanmaken */}
      <div className="card" style={{ padding:'1.5rem', maxWidth:400 }}>
        <h3 style={{ marginTop:0 }}>Nieuwe gebruiker</h3>
        <form onSubmit={createUser}>
          <label className="field-label">Gebruikersnaam</label>
          <input
            className="input"
            value={newUser.username}
            onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
            required
          />
          <label className="field-label" style={{ marginTop:'1rem', display:'block' }}>
            Wachtwoord
          </label>
          <input
            className="input"
            type="password"
            value={newUser.password}
            onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
            required
          />
          <button className="btn" type="submit" style={{ marginTop:'1rem' }}>
            Aanmaken
          </button>
        </form>
      </div>
    </div>
  );
}
