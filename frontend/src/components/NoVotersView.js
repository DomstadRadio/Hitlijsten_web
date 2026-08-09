import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

/**
 * Toont alle geverifieerde registraties die GEEN stem hebben uitgebracht.
 * Handmatig: mail-knop per rij.
 * Auto: "Stuur volgende herinnering" verzendt steeds één mail aan de eerste
 *       ongemailde persoon en toont het restant.
 */
export default function NoVotersView({ list }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);   // regId dat momenteel verzonden wordt
  const [autoRunning, setAutoRunning] = useState(false);
  const [lastMsg, setLastMsg] = useState(null);   // { ok, text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/no-voters/${list.id}`);
      setRows(res.data);
    } catch (e) {
      setLastMsg({ ok: false, text: 'Laden mislukt: ' + (e.response?.data?.error || e.message) });
    } finally {
      setLoading(false);
    }
  }, [list.id]);

  useEffect(() => { load(); }, [load]);

  // Stuur handmatige herinnering
  async function remindOne(row) {
    setBusy(row.id);
    setLastMsg(null);
    try {
      await axios.post(`${API}/admin/no-voters/${row.id}/remind`);
      setLastMsg({ ok: true, text: `Herinnering verstuurd naar ${row.email}.` });
      await load();
    } catch (e) {
      setLastMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally {
      setBusy(null);
    }
  }

  // Auto: stuur volgende ongemailde persoon
  async function remindNext() {
    setAutoRunning(true);
    setLastMsg(null);
    try {
      const res = await axios.post(`${API}/admin/no-voters/${list.id}/remind-next`);
      if (res.data.done) {
        setLastMsg({ ok: true, text: 'Iedereen heeft al een herinnering ontvangen.' });
      } else {
        setLastMsg({
          ok: true,
          text: `Herinnering verstuurd naar ${res.data.email}. Nog ${res.data.remaining} persoon/personen te gaan.`,
        });
      }
      await load();
    } catch (e) {
      setLastMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally {
      setAutoRunning(false);
    }
  }

  const unreminded = rows.filter(r => !r.reminder_sent_at).length;

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Niet-stemmers — {list.name}</h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Geverifieerde aanmelders die nog geen stem hebben uitgebracht.
        Stuur een herinnering per persoon of gebruik de knop hieronder om
        automatisch de eerstvolgende ongemailde persoon te bereiken.
      </p>

      {lastMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 6, marginBottom: 12,
          background: lastMsg.ok ? '#d4edda' : '#f8d7da',
          color: lastMsg.ok ? '#155724' : '#721c24',
          border: `1px solid ${lastMsg.ok ? '#c3e6cb' : '#f5c6cb'}`,
        }}>
          {lastMsg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" onClick={load} disabled={loading}>
          🔄 Verversen
        </button>
        {unreminded > 0 && (
          <button
            className="btn"
            style={{ background: '#e67e00', color: '#fff' }}
            onClick={remindNext}
            disabled={autoRunning || !!busy}
          >
            {autoRunning ? 'Bezig…' : `📧 Stuur volgende herinnering (${unreminded} te gaan)`}
          </button>
        )}
        {unreminded === 0 && rows.length > 0 && (
          <span style={{ fontSize: 13, color: '#888' }}>
            ✅ Iedereen heeft al een herinnering ontvangen.
          </span>
        )}
      </div>

      {loading ? (
        <p>Laden…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#888' }}>Geen niet-stemmers gevonden. Iedereen die zich aanmeldde heeft gestemd.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
              <th style={th}>Naam</th>
              <th style={th}>E-mail</th>
              <th style={th}>Aangemeld op</th>
              <th style={th}>Herinnering</th>
              <th style={th}>Actie</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={td}>{r.name || <em style={{ color: '#aaa' }}>–</em>}</td>
                <td style={td}>{r.email}</td>
                <td style={td}>{new Date(r.created_at).toLocaleString('nl-NL')}</td>
                <td style={td}>
                  {r.reminder_sent_at
                    ? <span style={{ color: '#888', fontSize: 12 }}>
                        {new Date(r.reminder_sent_at).toLocaleString('nl-NL')}
                      </span>
                    : <span style={{ color: '#c00', fontWeight: 600, fontSize: 12 }}>Nog niet</span>
                  }
                </td>
                <td style={td}>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={busy === r.id || autoRunning}
                    onClick={() => remindOne(r)}
                  >
                    {busy === r.id ? 'Bezig…' : '📧 Mail sturen'}
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

const th = { padding: '8px 12px', fontWeight: 600, borderBottom: '2px solid #ddd' };
const td = { padding: '8px 12px', verticalAlign: 'middle' };
