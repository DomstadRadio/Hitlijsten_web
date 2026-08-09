import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useTheme from '../hooks/useTheme';
import '../index.css';

const API = '/api';

// Genereer een stabiel machine-ID op basis van browser fingerprint
function getMachineId() {
  let id = localStorage.getItem('_mid');
  if (!id) {
    const nav = navigator;
    const raw = [
      nav.userAgent, nav.language, nav.platform,
      screen.width, screen.height, screen.colorDepth,
      new Date().getTimezoneOffset(),
    ].join('|');
    // Simpele hash
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = Math.imul(31, h) + raw.charCodeAt(i) | 0;
    }
    id = Math.abs(h).toString(36) + '-' + Date.now().toString(36);
    localStorage.setItem('_mid', id);
  }
  return id;
}

export default function VotePage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [list,    setList]    = useState(null);
  const [status,  setStatus]  = useState(null);
  const [loading, setLoading] = useState(true);

  const [name,      setName]      = useState('');
  const [emailAddr, setEmailAddr] = useState('');
  const [phone,     setPhone]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState('');

  const [codeInput,  setCodeInput]  = useState('');
  const [verifying,  setVerifying]  = useState(false);
  const [codeError,  setCodeError]  = useState('');

  useTheme(list?.theme || {});

  useEffect(() => {
    (async () => {
      try {
        const [listRes, statusRes] = await Promise.all([
          axios.get(`${API}/lists/${slug}`),
          axios.get(`${API}/vote/${slug}/status`, { params: { machineId: getMachineId() } }),
        ]);
        setList(listRes.data);
        setStatus(statusRes.data);
      } catch {
        setList(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const register = async () => {
    if (!name.trim()) return setError('Naam is verplicht');
    if (!emailAddr) return setError('E-mailadres is verplicht');
    setError('');
    setSubmitting(true);
    try {
      await axios.post(`${API}/vote/${slug}/register`, {
        emailAddr, name, phone, machineId: getMachineId(),
      });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Aanmelden mislukt');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (codeInput.length !== 6) return setCodeError('Voer 6 cijfers in');
    setCodeError('');
    setVerifying(true);
    try {
      const res = await axios.post(`${API}/vote/${slug}/verify-code`, { emailAddr, code: codeInput });
      navigate(`/stem/${slug}/stemmen/${res.data.token}`);
    } catch (err) {
      setCodeError(err.response?.data?.error || 'Onjuiste code, probeer opnieuw');
      setVerifying(false);
    }
  };

  if (loading) return <div className="page-center"><p>Laden…</p></div>;
  if (!list)   return <div className="page-center"><h2>Lijst niet gevonden</h2></div>;

  const bgStyle = list.bg_image
    ? { backgroundImage: `url(${list.bg_image})`, backgroundSize:'cover', backgroundPosition:'center' }
    : {};

  if (list.voting_paused) {
    return (
      <div className="page-center" style={bgStyle}>
        <div className="card" style={{ textAlign:'center', maxWidth:480 }}>
          <h2>{list.name}</h2>
          <p style={{ marginTop:12 }}>{list.voting_paused_message || 'Stemmen is tijdelijk gepauzeerd.'}</p>
        </div>
      </div>
    );
  }

  if (status?.status === 'closed') {
    return (
      <div className="page-center" style={bgStyle}>
        <div className="card" style={{ textAlign:'center', maxWidth:480 }}>
          <h2>{list.name}</h2>
          <p style={{ marginTop:12 }}>Het stemmen is gesloten.</p>
          <button className="btn" style={{ marginTop:20 }}
            onClick={() => navigate(`/stem/${slug}/resultaten`)}>
            Bekijk de resultaten
          </button>
        </div>
      </div>
    );
  }

  if (status?.hasVoted) {
    return (
      <div className="page-center" style={bgStyle}>
        <div className="card" style={{ textAlign:'center', maxWidth:480 }}>
          <h2>{list.name}</h2>
          <p style={{ marginTop:12 }}>Je hebt al gestemd vanaf dit apparaat.</p>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="page-center" style={bgStyle}>
        <div className="card" style={{ maxWidth:480, width:'100%' }}>
          <h2 style={{ marginBottom:8 }}>✉️ Voer je code in</h2>
          <p style={{ marginBottom:24 }}>
            We hebben een 6-cijferige code gestuurd naar <strong>{emailAddr}</strong>.<br />
            Voer de code hieronder in om verder te gaan.
          </p>
          <p style={{ marginBottom:16, fontSize:13, color:'#888', background:'#fffbe6', borderRadius:6, padding:'8px 12px' }}>
            📬 Geen e-mail ontvangen? Controleer ook je <strong>spam-</strong> of <strong>ongewenste e-mail</strong> map.
          </p>
          <div className="form-group">
            <label>Verificatiecode</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && verifyCode()}
              placeholder="123456"
              autoFocus
              style={{ fontSize: 30, letterSpacing: 10, textAlign: 'center', fontWeight: 700 }}
            />
          </div>
          {codeError && <p className="error-text">{codeError}</p>}
          <button className="btn" style={{ width:'100%', marginTop:8 }}
            onClick={verifyCode} disabled={verifying || codeInput.length !== 6}>
            {verifying ? 'Controleren…' : 'Code bevestigen →'}
          </button>
          <p style={{ marginTop:16, fontSize:12, color:'#888', textAlign:'center' }}>
            Geen e-mail ontvangen?{' '}
            <button style={{ background:'none', border:'none', color:'var(--color-primary)', cursor:'pointer', fontSize:12, padding:0, fontWeight:600 }}
              onClick={() => { setSent(false); setCodeInput(''); setCodeError(''); }}>
              Opnieuw proberen
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-center" style={bgStyle}>
      <div className="card" style={{ maxWidth:480, width:'100%' }}>
        {list.bg_image && (
          <img src={list.bg_image} alt="" style={{ width:'100%', height:140, objectFit:'cover',
            borderRadius:'var(--border-radius) var(--border-radius) 0 0', marginBottom:16, marginTop:-20,
            marginLeft:-20, width:'calc(100% + 40px)' }} />
        )}
        <h1 style={{ marginBottom:6 }}>{list.name}</h1>
        {list.description && <p className="helper-text" style={{ marginBottom:20 }}>{list.description}</p>}

        <p style={{ marginBottom:20 }}>
          Vul eerst je gegevens in — we sturen je een verificatiecode via de e-mail. 
          Kies daarna jouw favoriete {list.max_votes} nummers.
        </p>

        <div className="form-group">
          <label>Naam (optioneel)</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jouw naam" />
        </div>
        <div className="form-group">
          <label>E-mailadres *</label>
          <input type="email" value={emailAddr} onChange={e => setEmailAddr(e.target.value)}
            placeholder="jouw@email.nl" />
        </div>
        <div className="form-group">
          <label>Telefoonnummer (optioneel)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="06-12345678" onKeyDown={e => e.key === 'Enter' && register()} />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" style={{ width:'100%', marginTop:8 }}
          onClick={register} disabled={submitting}>
          {submitting ? 'Aanmelden…' : 'Aanmelden & e-mail ontvangen →'}
        </button>

        {list.privacy_url
          ? <p style={{ marginTop:12, fontSize:12, color:'#888', textAlign:'center' }}>
              Door op aanmelden te klikken gaat u akkoord met het{' '}
              <a href={list.privacy_url} target="_blank" rel="noopener noreferrer"
                style={{ color:'var(--color-primary)' }}>Privacy Statement</a>.
            </p>
          : null
        }
      </div>
    </div>
  );
}
