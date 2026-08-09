import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API = '/api';

/** Persistent device id (zelfde patroon als VotePage) */
function getMachineId() {
  let id = localStorage.getItem('hitlijst_machine_id');
  if (!id) {
    id = (crypto.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));
    localStorage.setItem('hitlijst_machine_id', id);
  }
  return id;
}

export default function FormPage() {
  const { slug }      = useParams();
  const navigate      = useNavigate();
  const [form, setForm]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [step, setStep]       = useState('form');           // form | verify | done
  const [answers, setAnswers] = useState({});
  const [emailAddr, setEmail] = useState('');
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [code, setCode]       = useState('');
  const [token, setToken]     = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    axios.get(`${API}/forms/${slug}`)
      .then(r => setForm(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const setAnswer = useCallback((id, v) => {
    setAnswers(a => ({ ...a, [id]: v }));
  }, []);

  if (loading) return <p style={{ padding: 40, textAlign: 'center' }}>Laden…</p>;
  if (error)   return <div style={wrap}><h2>Fout</h2><p>{error}</p></div>;
  if (!form)   return null;

  const handleStartVerify = async (e) => {
    e?.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      // Eerst valideren of velden ingevuld zijn
      const missing = collectMissing(form.schema, answers);
      if (missing.length) {
        setError(`Vul eerst in: ${missing.join(', ')}`);
        setSubmitting(false);
        return;
      }
      if (form.settings.verify_email) {
        if (!emailAddr) { setError('E-mailadres is verplicht'); setSubmitting(false); return; }
        await axios.post(`${API}/forms/${slug}/register`, {
          emailAddr, name, phone, machineId: getMachineId(),
        });
        setStep('verify');
      } else {
        await doSubmit(null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const r = await axios.post(`${API}/forms/${slug}/verify-code`, { emailAddr, code });
      setToken(r.data.token);
      await doSubmit(r.data.token);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const doSubmit = async (tok) => {
    try {
      const r = await axios.post(`${API}/forms/${slug}/submit`, {
        token:    tok,
        answers,
        machineId: getMachineId(),
        emailAddr: form.settings.verify_email ? undefined : emailAddr,
        name:      form.settings.verify_email ? undefined : name,
        phone:     form.settings.verify_email ? undefined : phone,
      });
      setSuccessMsg(r.data?.message || form.settings.success_message || 'Bedankt!');
      setStep('done');
      if (r.data?.redirect_url) {
        setTimeout(() => { window.location.href = r.data.redirect_url; }, 2000);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
      throw e;
    }
  };

  if (step === 'done') {
    return (
      <div style={wrap}>
        <h2>{form.name}</h2>
        <p style={{ fontSize: 18 }}>{successMsg}</p>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div style={wrap}>
        <h2>Bevestig je e-mailadres</h2>
        <p>We hebben een code gestuurd naar <strong>{emailAddr}</strong>.</p>
        <form onSubmit={handleVerifyCode} style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <input
            type="text" inputMode="numeric" maxLength={6}
            placeholder="123456"
            value={code}
            onChange={e => setCode(e.target.value)}
            style={{ padding: 12, fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
          />
          {error && <p style={{ color: '#c00' }}>{error}</p>}
          <button type="submit" disabled={submitting || code.length !== 6} style={btnPrimary}>
            {submitting ? 'Bezig…' : 'Bevestigen en versturen'}
          </button>
        </form>
      </div>
    );
  }

  // step === 'form'
  return (
    <div style={wrap}>
      <h2 style={{ marginTop: 0 }}>{form.name}</h2>
      {form.description && <p style={{ color: '#555' }}>{form.description}</p>}

      <form onSubmit={handleStartVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {form.schema.pages.map(page => (
          <section key={page.id}>
            {form.schema.pages.length > 1 && <h3>{page.title}</h3>}
            {page.fields.map(f => (
              <FieldRenderer key={f.id} field={f} value={answers[f.id]} onChange={v => setAnswer(f.id, v)} />
            ))}
          </section>
        ))}

        {form.settings.verify_email && (
          <fieldset style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            <legend>Jouw gegevens</legend>
            <label style={lbl}>Naam
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={inp} />
            </label>
            <label style={lbl}>E-mailadres *
              <input type="email" required value={emailAddr} onChange={e => setEmail(e.target.value)} style={inp} />
            </label>
            <label style={lbl}>Telefoon (optioneel)
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={inp} />
            </label>
          </fieldset>
        )}

        {error && <p style={{ color: '#c00' }}>{error}</p>}
        <button type="submit" disabled={submitting} style={btnPrimary}>
          {submitting ? 'Bezig…' : form.settings.verify_email ? 'Versturen → verificatie' : 'Versturen'}
        </button>
      </form>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function collectMissing(schema, answers) {
  const out = [];
  for (const p of schema.pages) for (const f of p.fields) {
    if (!f.required || f.type === 'hidden') continue;
    const v = answers[f.id];
    const empty = v === undefined || v === null || v === '' ||
                  (Array.isArray(v) && v.length === 0);
    if (empty) out.push(f.label || f.id);
  }
  return out;
}

// ── Field renderer ──────────────────────────────────────────────────────────

function FieldRenderer({ field, value, onChange }) {
  // Verborgen velden niet tonen
  if (field.type === 'hidden') return null;

  const label = (
    <div style={{ fontWeight: 600, marginBottom: 4 }}>
      {field.label}{field.required && <span style={{ color: '#c00' }}> *</span>}
    </div>
  );
  const help = field.help ? <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{field.help}</div> : null;

  switch (field.type) {
    case 'text':
      return <div style={fieldWrap}>{label}<input type="text" style={inp} value={value || ''} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'textarea':
      return <div style={fieldWrap}>{label}<textarea style={{ ...inp, minHeight: 100 }} value={value || ''} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'email':
      return <div style={fieldWrap}>{label}<input type="email" style={inp} value={value || ''} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'phone':
      return <div style={fieldWrap}>{label}<input type="tel" style={inp} value={value || ''} onChange={e => onChange(e.target.value)} placeholder="+31 6 12345678" />{help}</div>;
    case 'number':
      return <div style={fieldWrap}>{label}<input type="number" style={inp} value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'radio': {
      const opts = field.options || [];
      return (
        <div style={fieldWrap}>
          {label}
          {opts.map((o, i) => (
            <label key={i} style={{ display: 'block', padding: '4px 0' }}>
              <input type="radio" name={field.id} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
            </label>
          ))}
          {help}
        </div>
      );
    }
    case 'checkbox': {
      const opts = field.options || [];
      const arr  = Array.isArray(value) ? value : [];
      const toggle = (v) => onChange(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
      return (
        <div style={fieldWrap}>
          {label}
          {opts.map((o, i) => (
            <label key={i} style={{ display: 'block', padding: '4px 0' }}>
              <input type="checkbox" checked={arr.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
            </label>
          ))}
          {help}
        </div>
      );
    }
    case 'track_single': {
      return (
        <div style={fieldWrap}>
          {label}
          <TrackPicker
            mode="single"
            config={field.config || {}}
            value={value}
            onChange={onChange}
          />
          {help}
        </div>
      );
    }
    case 'track_topN': {
      const topN = Number(field.config?.topN) || 5;
      return (
        <div style={fieldWrap}>
          {label}
          <TrackPicker
            mode="topN"
            topN={topN}
            config={field.config || {}}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
          {help}
        </div>
      );
    }
    case 'program_select': {
      return (
        <div style={fieldWrap}>
          {label}
          <ProgramPicker value={value} onChange={onChange} required={field.required} />
          {help}
        </div>
      );
    }
    default:
      return <div style={fieldWrap}>{label}<em>Onbekend veldtype: {field.type}</em></div>;
  }
}

// ── Program picker ──────────────────────────────────────────────────────────

function ProgramPicker({ value, onChange, required }) {
  const [programs, setPrograms] = useState([]);

  useEffect(() => {
    axios.get(`${API}/forms/programs`)
      .then(r => setPrograms(r.data))
      .catch(() => {});
  }, []);

  const selected = value?.id ? String(value.id) : '';

  const handleChange = (e) => {
    const id = Number(e.target.value);
    if (!id) { onChange(null); return; }
    const prog = programs.find(p => p.id === id);
    if (prog) onChange({ id: prog.id, name: prog.name });
  };

  return (
    <select
      value={selected}
      onChange={handleChange}
      required={required}
      style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 15, width: '100%' }}
    >
      <option value="">Kies een radioprogramma{required ? '' : ' (optioneel)'}</option>
      {programs.map(p => (
        <option key={p.id} value={String(p.id)}>
          {p.name}{p.description ? ` — ${p.description}` : ''}
        </option>
      ))}
    </select>
  );
}

// ── Track picker (fase 2) ───────────────────────────────────────────────────

function TrackPicker({ mode, topN = 5, config = {}, value, onChange }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  // Ondersteuning voor zowel nieuw (trackgroups array) als oud (trackgroup string)
  const groups  = Array.isArray(config.trackgroups) && config.trackgroups.length
    ? config.trackgroups
    : (config.trackgroup ? [config.trackgroup] : []);
  const sources = Array.isArray(config.sources) && config.sources.length
    ? config.sources : ['playit', 'spotify'];

  const selected = mode === 'single'
    ? (value && typeof value === 'object' ? [value] : [])
    : (Array.isArray(value) ? value : []);

  const max = mode === 'single' ? 1 : topN;

  // Live search met debounce
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = { q: query, sources: sources.join(',') };
        if (groups.length === 1) params.group = groups[0];
        else if (groups.length > 1) params.groups = groups.join(',');
        const res = await axios.get(`${API}/search`, { params });
        const filtered = res.data
          .filter(r => !selected.some(s => trackKey(s) === trackKey(r)));
        setResults(filtered);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, JSON.stringify(selected.map(trackKey)), JSON.stringify(groups), sources.join(',')]);

  const addTrack = (t) => {
    if (selected.length >= max) return;
    if (mode === 'single') {
      onChange(t);
    } else {
      onChange([...selected, t]);
    }
    setQuery('');
    setResults([]);
  };
  const removeAt = (i) => {
    if (mode === 'single') onChange(null);
    else onChange(selected.filter((_, j) => j !== i));
  };
  const move = (i, dir) => {
    const arr = [...selected];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };

  return (
    <div>
      {/* Geselecteerde tracks */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {selected.map((t, i) => (
            <div key={i} style={pickedRow}>
              {mode === 'topN' && <span style={posBadge}>{i + 1}</span>}
              {t.cover_url
                ? <img src={t.cover_url} alt="" style={{ width: 36, height: 36, borderRadius: 4 }} />
                : <div style={{ width: 36, height: 36, background: '#ddd', borderRadius: 4 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 13, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist}</div>
              </div>
              {mode === 'topN' && (
                <>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={miniBtn}>↑</button>
                  <button type="button" onClick={() => move(i, +1)} disabled={i === selected.length - 1} style={miniBtn}>↓</button>
                </>
              )}
              <button type="button" onClick={() => removeAt(i)} style={{ ...miniBtn, color: '#c00' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Zoekveld */}
      {selected.length < max && (
        <>
          <input
            type="text"
            placeholder="Zoek artiest of titel…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={inp}
          />
          <div style={{ marginTop: 6 }}>
            {query.length < 2 && <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Type minstens 2 tekens om te zoeken.</p>}
            {query.length >= 2 && searching && <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Zoeken…</p>}
            {query.length >= 2 && !searching && results.length === 0 && (
              <p style={{ fontSize: 13, color: '#888', margin: 0 }}>Geen nummers gevonden.</p>
            )}
            {results.map((t, i) => (
              <div key={(t.external_id || '') + i} onClick={() => addTrack(t)} style={resultRow}>
                {t.cover_url
                  ? <img src={t.cover_url} alt="" style={{ width: 36, height: 36, borderRadius: 4 }} />
                  : <div style={{ width: 36, height: 36, background: '#ddd', borderRadius: 4 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                  <div style={{ fontSize: 13, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.artist}{t.source === 'spotify' && <span style={{ color: '#1DB954', marginLeft: 6 }}>via Spotify</span>}
                  </div>
                </div>
                <span style={{ color: '#e00', fontSize: 22 }}>+</span>
              </div>
            ))}
          </div>
        </>
      )}
      {mode === 'topN' && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>{selected.length}/{max} gekozen</p>
      )}
    </div>
  );
}
function trackKey(t) {
  if (!t) return '';
  return `${(t.source || '')}:${t.external_id || ''}|${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase()}`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const wrap = { maxWidth: 640, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif' };
const inp  = { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 15 };
const lbl  = { display: 'block', marginBottom: 12, fontSize: 14 };
const fieldWrap = { marginBottom: 16 };
const btnPrimary = {
  padding: '12px 20px', fontSize: 16, border: 'none', borderRadius: 6,
  background: '#e00', color: '#fff', cursor: 'pointer', fontWeight: 600,
};
const pickedRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: 8, border: '1px solid #ddd', borderRadius: 6, background: '#fafafa',
};
const resultRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: 8, border: '1px solid #eee', borderRadius: 6, marginTop: 4,
  cursor: 'pointer', background: '#fff',
};
const posBadge = {
  display: 'inline-block', minWidth: 22, padding: '2px 6px',
  background: '#e00', color: '#fff', borderRadius: 4, textAlign: 'center',
  fontSize: 13, fontWeight: 700,
};
const miniBtn = {
  padding: '4px 8px', border: '1px solid #ccc', background: '#fff',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
