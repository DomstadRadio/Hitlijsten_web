import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

export default function SettingsPanel() {
  const [form, setForm] = useState({
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: '', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASS: '',
    SMTP_FROM: '', FRONTEND_URL: '', SENDGRID_API_KEY: '', RESEND_API_KEY: '',
  });
  const [info, setInfo]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    axios.get(`${API}/admin/settings`).then(r => {
      setInfo(r.data);
      setForm(f => ({
        ...f,
        EMAIL_PROVIDER:   r.data.EMAIL_PROVIDER || 'smtp',
        SMTP_HOST:        r.data.SMTP_HOST,
        SMTP_PORT:        r.data.SMTP_PORT,
        SMTP_USER:        r.data.SMTP_USER,
        SMTP_FROM:        r.data.SMTP_FROM,
        FRONTEND_URL:     r.data.FRONTEND_URL,
        SMTP_PASS:        '',
        SENDGRID_API_KEY: '',
        RESEND_API_KEY:   '',
      }));
    });
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const payload = { ...form };
      if (!payload.SMTP_PASS)        payload.SMTP_PASS        = '••••••••';
      if (!payload.SENDGRID_API_KEY) payload.SENDGRID_API_KEY = '••••••••';
      if (!payload.RESEND_API_KEY)   payload.RESEND_API_KEY   = '••••••••';
      await axios.put(`${API}/admin/settings`, payload);
      setMsg({ ok: true, text: '✅ Instellingen opgeslagen' });
    } catch (e) {
      setMsg({ ok: false, text: `❌ ${e.response?.data?.error || e.message}` });
    }
    setSaving(false);
  };

  const sendTest = async () => {
    if (!testTo) return;
    setTesting(true); setTestMsg(null);
    try {
      const payload = { to: testTo, ...form };
      if (!payload.SMTP_PASS)        payload.SMTP_PASS        = '••••••••';
      if (!payload.SENDGRID_API_KEY) payload.SENDGRID_API_KEY = '••••••••';
      if (!payload.RESEND_API_KEY)   payload.RESEND_API_KEY   = '••••••••';
      await axios.post(`${API}/admin/settings/test-email`, payload);
      setTestMsg({ ok: true, text: `✅ Testmail verzonden via ${form.EMAIL_PROVIDER.toUpperCase()}` });
    } catch (e) {
      setTestMsg({ ok: false, text: `❌ ${e.response?.data?.error || e.message}` });
    }
    setTesting(false);
  };

  const inp = { style: { width: '100%', padding: '8px 12px', border: '1.5px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: 'sans-serif' } };

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ marginBottom: 20 }}>⚙️ Instellingen</h2>

      {/* ── Provider keuze ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>E-mail provider</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Kies welke dienst gebruikt wordt voor het versturen van e-mails.
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 15 }}>
            <input type="radio" name="provider" value="smtp"
              checked={form.EMAIL_PROVIDER === 'smtp'}
              onChange={() => set('EMAIL_PROVIDER', 'smtp')} />
            SMTP (eigen mailserver)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 15 }}>
            <input type="radio" name="provider" value="resend"
              checked={form.EMAIL_PROVIDER === 'resend'}
              onChange={() => set('EMAIL_PROVIDER', 'resend')} />
            Resend (aanbevolen — geen mailserver nodig)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 15 }}>
            <input type="radio" name="provider" value="sendgrid"
              checked={form.EMAIL_PROVIDER === 'sendgrid'}
              onChange={() => set('EMAIL_PROVIDER', 'sendgrid')} />
            SendGrid
          </label>
        </div>
      </div>

      {/* ── Resend (alleen als gekozen) ── */}
      {form.EMAIL_PROVIDER === 'resend' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Resend</h3>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            Gratis account op <a href="https://resend.com" target="_blank" rel="noreferrer">resend.com</a> → API Keys → Create API Key.{' '}
            {info?.hasResend && <strong style={{ color: '#080' }}>✓ API key is ingesteld.</strong>}
          </p>
          <div className="form-group">
            <label>API Key</label>
            <input {...inp} type="password" placeholder={info?.hasResend ? '(ongewijzigd)' : 're_xxxxx'}
              value={form.RESEND_API_KEY} onChange={e => set('RESEND_API_KEY', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Afzender (From) — moet een verified domein zijn in Resend</label>
            <input {...inp} placeholder='Domstad Radio <noreply@domstadradio.nl>' value={form.SMTP_FROM} onChange={e => set('SMTP_FROM', e.target.value)} />
          </div>
        </div>
      )}

      {/* ── SendGrid (alleen als gekozen) ── */}
      {form.EMAIL_PROVIDER === 'sendgrid' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>SendGrid</h3>
          {info?.hasSendgrid && <p style={{ fontSize: 13, color: '#080', marginBottom: 12 }}>✓ API key is ingesteld.</p>}
          <div className="form-group">
            <label>API Key</label>
            <input {...inp} type="password" placeholder={info?.hasSendgrid ? '(ongewijzigd)' : 'SG.xxxxx'}
              value={form.SENDGRID_API_KEY} onChange={e => set('SENDGRID_API_KEY', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Afzender (From)</label>
            <input {...inp} placeholder='Domstad Radio <noreply@domstadradio.nl>' value={form.SMTP_FROM} onChange={e => set('SMTP_FROM', e.target.value)} />
          </div>
        </div>
      )}

      {/* ── SMTP (alleen als gekozen) ── */}
      {form.EMAIL_PROVIDER === 'smtp' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>SMTP</h3>
          {info?.hasSmtpPass && <p style={{ fontSize: 13, color: '#080', marginBottom: 12 }}>✓ Wachtwoord is ingesteld.</p>}
          <div className="form-group">
            <label>Host</label>
            <input {...inp} placeholder="smtp.gmail.com" value={form.SMTP_HOST} onChange={e => set('SMTP_HOST', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Poort</label>
              <input {...inp} placeholder="587" value={form.SMTP_PORT} onChange={e => set('SMTP_PORT', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Gebruikersnaam</label>
              <input {...inp} placeholder="noreply@domstadradio.nl" value={form.SMTP_USER} onChange={e => set('SMTP_USER', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Wachtwoord</label>
            <input {...inp} type="password" placeholder={info?.hasSmtpPass ? '(ongewijzigd)' : 'wachtwoord'}
              value={form.SMTP_PASS} onChange={e => set('SMTP_PASS', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Afzender (From)</label>
            <input {...inp} placeholder='Domstad Radio <noreply@domstadradio.nl>' value={form.SMTP_FROM} onChange={e => set('SMTP_FROM', e.target.value)} />
          </div>
        </div>
      )}

      {/* ── Frontend URL ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Frontend URL</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Wordt gebruikt in verificatielinks in e-mails. Zet hier je hoofddomein met https://.
        </p>
        <div className="form-group">
          <label>URL</label>
          <input {...inp} placeholder="https://utregsetop100.nl" value={form.FRONTEND_URL} onChange={e => set('FRONTEND_URL', e.target.value)} />
        </div>
      </div>

      <button className="btn" onClick={save} disabled={saving} style={{ marginBottom: 12 }}>
        {saving ? 'Opslaan…' : '💾 Opslaan'}
      </button>
      {msg && <p style={{ marginTop: 8, color: msg.ok ? '#080' : '#c00', fontSize: 14 }}>{msg.text}</p>}

      {/* ── Testmail ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>📧 Testmail versturen</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Sla eerst de instellingen op, stuur dan een testmail om te controleren of het werkt.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input {...inp} style={{ ...inp.style, flex: 1 }} type="email"
            placeholder="jouw@email.nl" value={testTo} onChange={e => setTestTo(e.target.value)} />
          <button className="btn btn-sm" onClick={sendTest} disabled={testing || !testTo}>
            {testing ? 'Bezig…' : 'Verstuur'}
          </button>
        </div>
        {testMsg && <p style={{ marginTop: 8, color: testMsg.ok ? '#080' : '#c00', fontSize: 14 }}>{testMsg.text}</p>}
      </div>
    </div>
  );
}

