import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.response?.data?.error || 'Inloggen mislukt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #f4f6fb)',
    }}>
      <div className="card" style={{ width: 360, padding: '2rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem', textAlign: 'center' }}>
          🎵 Hitlijsten Beheer
        </h2>
        <form onSubmit={handleSubmit}>
          <label className="field-label">Gebruikersnaam</label>
          <input
            className="input"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            required
            autoComplete="username"
          />

          <label className="field-label" style={{ marginTop: '1rem', display: 'block' }}>
            Wachtwoord
          </label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          {error && (
            <p style={{ color: '#c00', fontSize: 14, marginTop: 8 }}>{error}</p>
          )}

          <button
            className="btn"
            type="submit"
            disabled={busy}
            style={{ width: '100%', marginTop: '1.5rem' }}
          >
            {busy ? 'Inloggen…' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  );
}
