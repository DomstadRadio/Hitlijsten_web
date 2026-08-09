import React, { useState } from 'react';

const API = '/api/admin';

const DEFAULT_HTML = `<div style="font-family:sans-serif;max-width:560px;margin:auto">
  <h2>Hoi {{naam}}!</h2>
  <p>Bericht over <strong>{{lijst}}</strong>.</p>
  <p>...</p>
  <hr>
  <p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
</div>`;

export default function BroadcastPanel({ list }) {
  const [subject,   setSubject]   = useState('');
  const [html,      setHtml]      = useState(DEFAULT_HTML);
  const [filter,    setFilter]    = useState('voted');
  const [batchSize, setBatchSize] = useState(2);
  const [delayMs,   setDelayMs]   = useState(2000);
  const [sending,   setSending]   = useState(false);
  const [log,       setLog]       = useState([]);   // { type, text, ok }
  const [summary,   setSummary]   = useState(null); // { sent, failed, total }
  const [preview,   setPreview]   = useState(false);

  const appendLog = (entry) => setLog(l => [...l, entry]);

  const send = async () => {
    if (!subject.trim()) { alert('Vul een onderwerp in.'); return; }
    if (!html.trim())    { alert('Vul de e-mailtekst in.'); return; }
    if (!window.confirm(`Mail versturen naar alle ${filter === 'voted' ? 'stemmers' : 'aangemelde deelnemers'} van "${list.name}"?`)) return;

    setSending(true);
    setLog([]);
    setSummary(null);

    try {
      const resp = await fetch(`${API}/voters/${list.id}/broadcast`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ subject, html, batchSize, delayMs, filter }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        appendLog({ type: 'error', text: `Fout: ${err.error}` });
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // bewaar incomplete laatste regel
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'start') {
              appendLog({ text: `Versturen gestart — ${ev.total} ontvangers.` });
            } else if (ev.type === 'progress') {
              appendLog({ ok: true, text: `✓ ${ev.name || ev.email} <${ev.email}> (${ev.sent}/${ev.total})` });
            } else if (ev.type === 'error') {
              appendLog({ ok: false, text: `✗ ${ev.email} — ${ev.error}` });
            } else if (ev.type === 'done') {
              setSummary({ sent: ev.sent, failed: ev.failed, total: ev.total });
            }
          } catch { /* ignore malformed event */ }
        }
      }
    } catch (err) {
      appendLog({ type: 'error', text: `Verbindingsfout: ${err.message}` });
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>📢 Broadcast: {list.name}</h2>
      <p className="helper-text" style={{ marginBottom: 20 }}>
        Stuur een e-mail naar alle deelnemers van deze lijst. Gebruik <code>{'{{naam}}'}</code> en <code>{'{{lijst}}'}</code> als variabelen.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Linker kolom: instellingen + editor */}
        <div>
          <label style={{ display:'block', fontWeight:600, marginBottom:4, fontSize:14 }}>Ontvangers</label>
          <div style={{ display:'flex', gap:16, marginBottom:16 }}>
            {[
              ['voted', 'Alleen stemmers (hebben gestemd)'],
              ['all',   'Alle aangemelde deelnemers'],
            ].map(([val, lbl]) => (
              <label key={val} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:14 }}>
                <input type="radio" value={val} checked={filter === val} onChange={() => setFilter(val)} />
                {lbl}
              </label>
            ))}
          </div>

          <label style={{ display:'block', fontWeight:600, marginBottom:4, fontSize:14 }}>Verzendinstellingen</label>
          <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
            <label style={{ fontSize:14 }}>
              Batch-grootte:&nbsp;
              <select value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}
                style={{ padding:'3px 8px', borderRadius:5, border:'1px solid #ddd' }}>
                <option value={1}>1 per keer</option>
                <option value={2}>2 per keer</option>
                <option value={5}>5 per keer</option>
              </select>
            </label>
            <label style={{ fontSize:14 }}>
              Vertraging:&nbsp;
              <select value={delayMs} onChange={e => setDelayMs(Number(e.target.value))}
                style={{ padding:'3px 8px', borderRadius:5, border:'1px solid #ddd' }}>
                <option value={1000}>1 seconde</option>
                <option value={2000}>2 seconden</option>
                <option value={3000}>3 seconden</option>
                <option value={5000}>5 seconden</option>
              </select>
            </label>
          </div>

          <label style={{ display:'block', fontWeight:600, marginBottom:4, fontSize:14 }}>Onderwerp *</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Onderwerp van de mail…"
            style={{ marginBottom:12, width:'100%' }}
          />

          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4 }}>
            <label style={{ fontWeight:600, fontSize:14 }}>HTML e-mailtekst *</label>
            <button className="btn btn-sm btn-outline" onClick={() => setPreview(p => !p)} style={{ fontSize:12 }}>
              {preview ? 'Editor' : 'Voorbeeld'}
            </button>
          </div>
          {preview ? (
            <div style={{ border:'1px solid #ddd', borderRadius:8, padding:16, minHeight:280, background:'#fff' }}
              dangerouslySetInnerHTML={{ __html: html
                .replace(/\{\{naam\}\}/gi, 'Jan de Vries')
                .replace(/\{\{lijst\}\}/gi, list.name) }}
            />
          ) : (
            <textarea
              value={html}
              onChange={e => setHtml(e.target.value)}
              rows={14}
              style={{ width:'100%', fontFamily:'monospace', fontSize:12, resize:'vertical', padding:10, borderRadius:8, border:'1px solid #ddd' }}
            />
          )}

          <button
            className="btn"
            style={{ marginTop:12, width:'100%', background: sending ? '#888' : undefined }}
            onClick={send}
            disabled={sending}
          >
            {sending ? 'Bezig met versturen…' : '📤 Verstuur broadcast'}
          </button>
        </div>

        {/* Rechter kolom: voortgang */}
        <div>
          <h3 style={{ marginBottom:8 }}>Voortgang</h3>
          {summary && (
            <div style={{
              padding:'12px 16px', borderRadius:8, marginBottom:12,
              background: summary.failed > 0 ? '#fff3e0' : '#e8f5e9',
              border: `1px solid ${summary.failed > 0 ? '#ff9800' : '#4caf50'}`,
            }}>
              <strong>Klaar!</strong> {summary.sent} van {summary.total} verstuurd
              {summary.failed > 0 && <span style={{ color:'#c44' }}> · {summary.failed} mislukt</span>}
            </div>
          )}
          {log.length === 0 && !sending && (
            <p className="helper-text">Hier verschijnt de voortgang tijdens het versturen.</p>
          )}
          <div style={{ maxHeight:460, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
            {log.map((entry, i) => (
              <div key={i} style={{
                fontSize:12, padding:'3px 8px', borderRadius:4,
                background: entry.ok === true ? '#f0fff0' : entry.ok === false ? '#fff0f0' : '#f5f5f5',
                color:      entry.ok === true ? '#080'   : entry.ok === false ? '#c00'   : '#555',
              }}>
                {entry.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
