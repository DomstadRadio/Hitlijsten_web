import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const API = '/api';

const FONT_OPTIONS = [
  { label: 'Standaard (sans-serif)', value: 'sans-serif' },
  { label: 'Georgia (serif)',        value: 'Georgia, serif' },
  { label: 'Courier (mono)',         value: "'Courier New', monospace" },
  { label: 'Arial',                  value: 'Arial, sans-serif' },
  { label: 'Trebuchet',              value: "'Trebuchet MS', sans-serif" },
];

const RADIUS_OPTIONS = [
  { label: 'Scherp (0)',     value: '0px' },
  { label: 'Licht (6px)',   value: '6px' },
  { label: 'Afgerond (12px)', value: '12px' },
  { label: 'Volledig rond (24px)', value: '24px' },
];

const DEFAULT_THEME = {
  primaryColor:   '#cc0000',
  secondaryColor: '#222222',
  bgColor:        '#f5f5f5',
  textColor:      '#111111',
  cardBg:         '#ffffff',
  fontFamily:     'sans-serif',
  borderRadius:   '12px',
};

/** Parseer score_rules: [array] of null als ongeldig */
function parseRules(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return null; }
}

export default function ListEditor({ list, onSaved }) {
  const existing = list || {};
  const { hasPerm } = useAuth();
  const [name,       setName]       = useState(existing.name        || '');
  const [slug,       setSlug]       = useState(existing.slug        || '');
  const [description,setDescription]= useState(existing.description || '');
  const [domain,     setDomain]     = useState(existing.domain      || '');
  const [status,     setStatus]     = useState(existing.status      || 'draft');
  const [maxVotes,   setMaxVotes]   = useState(existing.max_votes   || 10);
  const [closesAt,   setClosesAt]   = useState(existing.closes_at   || '');
  const [playitGroup,setPlayitGroup]= useState(existing.playit_group|| '');
  const [redirectUrl, setRedirectUrl]= useState(existing.redirect_url || '');
  const [privacyUrl,   setPrivacyUrl]  = useState(existing.privacy_url   || '');
  const [votingRulesText, setVotingRulesText] = useState(existing.voting_rules_text || '');
  const [votingRulesRequired, setVotingRulesRequired] = useState(!!existing.voting_rules_required);
  const [maxTracksPerArtist, setMaxTracksPerArtist] = useState(Number(existing.max_tracks_per_artist) || 0);
  const [theme,      setTheme]      = useState({ ...DEFAULT_THEME, ...(existing.theme || {}) });
  const [bgFile,     setBgFile]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [groups,     setGroups]     = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Herinnerings-e-mail template
  const [reminderSubject, setReminderSubject] = useState(existing.reminder_subject || '');
  const [reminderHtml,    setReminderHtml]    = useState(existing.reminder_html    || '');

  // Stemmen pauzeren
  const [votingPaused,   setVotingPaused]   = useState(!!existing.voting_paused);
  const [pauseMessage,   setPauseMessage]   = useState(existing.voting_paused_message || '');
  const [pauseSaving,    setPauseSaving]    = useState(false);

  // Auto-publicatie schema
  const parseCron = (expr) => {
    if (!expr) return { day: '', hour: '07', minute: '00' };
    const p = expr.split(' ');
    return { minute: p[0] || '00', hour: p[1] || '07', day: p[4] || '' };
  };
  const initCron = parseCron(existing.auto_publish_cron);
  const [schedDay,    setSchedDay]    = useState(initCron.day);
  const [schedHour,   setSchedHour]   = useState(initCron.hour);
  const [schedMinute, setSchedMinute] = useState(initCron.minute);
  const [schedSaving, setSchedSaving] = useState(false);
  const cronExpr = schedDay !== '' ? `${schedMinute} ${schedHour} * * ${schedDay}` : '';

  // Score-regels: array van punten per positie
  const initRules = parseRules(existing.score_rules);
  const [useCustomRules, setUseCustomRules] = useState(!!initRules);
  const [scoreRules,     setScoreRules]     = useState(
    initRules || Array.from({ length: existing.max_votes || 10 }, (_, i) => Math.max(1, (existing.max_votes || 10) - i))
  );

  useEffect(() => {
    setGroupsLoading(true);
    axios.get('/api/search/groups')
      .then(res => setGroups(res.data || []))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, []);

  const setThemeKey = (key, val) => setTheme(t => ({ ...t, [key]: val }));

  const autoSlug = (val) => {
    setName(val);
    if (!list) setSlug(val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
  };

  // Pas score-regels aan als maxVotes verandert
  const changeMaxVotes = (n) => {
    setMaxVotes(n);
    setScoreRules(prev => {
      const next = Array.from({ length: n }, (_, i) => prev[i] !== undefined ? prev[i] : Math.max(0, n - i));
      return next;
    });
  };

  const setRuleAt = (idx, val) => {
    setScoreRules(prev => prev.map((v, i) => i === idx ? Number(val) || 0 : v));
  };

  const save = async () => {
    setError('');
    if (!name || !slug) return setError('Naam en slug zijn verplicht');

    setSaving(true);
    try {
      const form = new FormData();
      form.append('name',        name);
      form.append('slug',        slug);
      form.append('description', description);
      form.append('domain',      domain);
      form.append('status',      status);
      form.append('max_votes',   maxVotes);
      form.append('closes_at',   closesAt);
      form.append('theme',       JSON.stringify(theme));
      form.append('playit_group', playitGroup);
      form.append('redirect_url', redirectUrl);
      form.append('privacy_url',   privacyUrl);
      form.append('voting_rules_text', votingRulesText);
      form.append('voting_rules_required', votingRulesRequired ? '1' : '0');
      form.append('max_tracks_per_artist', String(maxTracksPerArtist));
      form.append('reminder_subject', reminderSubject);
      form.append('reminder_html',    reminderHtml);
      if (bgFile) form.append('bg_image', bgFile);

      if (list?.id) {
        await axios.put(`${API}/lists/${list.id}`, form);
        if (hasPerm('scoring')) {
          await axios.put(`/api/admin/lists/${list.id}/score-rules`, {
            rules: useCustomRules ? scoreRules : [],
          });
        }
      } else {
        const res = await axios.post(`${API}/lists`, form);
        const newId = res.data.id;
        if (hasPerm('scoring') && useCustomRules && newId) {
          await axios.put(`/api/admin/lists/${newId}/score-rules`, { rules: scoreRules });
        }
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Opslaan mislukt');
    } finally {
      setSaving(false);
    }
  };

  const seasonReset = async () => {
    if (!list?.id) return;
    const confirmed = window.confirm(
      `WAARSCHUWING: dit verwijdert ALLE stemmen en stemmers voor "${list.name}".\n\n` +
      `De puntentelling (chart history) blijft bewaard. Typ OK om te bevestigen.`
    );
    if (!confirmed) return;
    const double = window.confirm('Weet je het zeker? Deze actie kan niet ongedaan worden gemaakt.');
    if (!double) return;
    try {
      await axios.post(`/api/admin/season-reset/${list.id}`, { confirm: true });
      alert('Seizoensreset voltooid. Stemmers en stemmen zijn verwijderd.');
    } catch (e) {
      alert(e.response?.data?.error || 'Reset mislukt');
    }
  };

  const preview = {
    background: theme.bgColor,
    fontFamily: theme.fontFamily,
    borderRadius: theme.borderRadius,
    color: theme.textColor,
    padding: 20,
    border: `2px solid ${theme.primaryColor}`,
  };

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>{list ? 'Lijst bewerken' : 'Nieuwe lijst'}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* Linker kolom: basisinstellingen */}
        <div>
          <div className="form-group">
            <label>Naam van de lijst *</label>
            <input value={name} onChange={e => autoSlug(e.target.value)} placeholder="Utrechtse Top 100" />
          </div>
          <div className="form-group">
            <label>Slug (URL) *</label>
            <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="utrechtse-top-100" />
            <span className="helper-text">/stem/<strong>{slug || '...'}</strong></span>
          </div>
          <div className="form-group">
            <label>Omschrijving</label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Gekoppeld domein</label>
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="utrechtsetop100.nl" />
          </div>
          <div className="form-group">
            <label>PlayIt Live trackgroep (zoekfilter)</label>
            <select value={playitGroup} onChange={e => setPlayitGroup(e.target.value)}
              disabled={groupsLoading}>
              <option value="">— Alle tracks (geen filter) —</option>
              {groups.map(g => (
                <option key={g.id ?? g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
            <span className="helper-text">
              {groupsLoading ? 'Groepen laden…' : 'Zoeken en importeren beperkt tot deze groep.'}
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div className="form-group">
              <label>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="draft">Concept</option>
                <option value="open">Open</option>
                <option value="closed">Gesloten</option>
              </select>
            </div>
            <div className="form-group">
              <label>Aantal keuzes</label>
              <input type="number" min={1} max={100} value={maxVotes}
                onChange={e => changeMaxVotes(Number(e.target.value))} />
            </div>
          </div>

          {/* ── Puntentelling ── */}
          {hasPerm('scoring') && (
          <div className="form-group" style={{ background:'var(--surface, #f9f9f9)', borderRadius:8, padding:12, border:'1px solid var(--border, #e8e8e8)' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={useCustomRules}
                onChange={e => setUseCustomRules(e.target.checked)} />
              Aangepaste puntentelling
            </label>
            <span className="helper-text" style={{ display:'block', marginBottom: useCustomRules ? 8 : 0 }}>
              Standaard: keuze 1 = {maxVotes} pt, keuze 2 = {maxVotes - 1} pt, … keuze {maxVotes} = 1 pt
            </span>
            {useCustomRules && (
              <div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {scoreRules.map((pts, i) => (
                    <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                      <span style={{ fontSize:11, color:'#888' }}>#{i + 1}</span>
                      <input
                        type="number" min={0} value={pts}
                        onChange={e => setRuleAt(i, e.target.value)}
                        style={{ width:52, textAlign:'center', padding:'4px 0' }}
                      />
                      <span style={{ fontSize:10, color:'#aaa' }}>pt</span>
                    </div>
                  ))}
                </div>
                <span className="helper-text" style={{ display:'block', marginTop:6 }}>
                  Punten per positie (keuze 1 t/m {maxVotes}). Wordt getoond bij het stemmen.
                </span>
              </div>
            )}
          </div>
          )}

          <div className="form-group">
            <label>Sluitingsdatum</label>
            <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
          </div>

          {/* ── Herinnerings-e-mail ── */}
          <details className="form-group" style={{ background:'var(--surface, #f9f9f9)', borderRadius:8, padding:12, border:'1px solid var(--border, #e8e8e8)' }}>
            <summary style={{ fontWeight:600, cursor:'pointer', userSelect:'none' }}>
              ✉ Herinnerings-e-mail aanpassen
            </summary>
            <span className="helper-text" style={{ display:'block', margin:'6px 0 10px' }}>
              Laat leeg voor de standaardtekst. Beschikbare variabelen: <code>{'{{naam}}'}</code>, <code>{'{{lijst}}'}</code>, <code>{'{{url}}'}</code>
            </span>
            <div className="form-group" style={{ marginBottom:10 }}>
              <label>Onderwerpregel</label>
              <input
                type="text"
                value={reminderSubject}
                onChange={e => setReminderSubject(e.target.value)}
                placeholder={`Vergeet niet te stemmen voor {{lijst}}!`}
              />
            </div>
            <div className="form-group">
              <label>E-mail inhoud (HTML)</label>
              <textarea
                rows={10}
                value={reminderHtml}
                onChange={e => setReminderHtml(e.target.value)}
                placeholder={`<p>Hoi {{naam}}!</p>\n<p>Stem nu via <a href="{{url}}">deze link</a>.</p>`}
                style={{ fontFamily:'monospace', fontSize:13 }}
              />
              <span className="helper-text">Volledige HTML is toegestaan. Laat leeg voor de standaard Domstad Radio template.</span>
            </div>
          </details>

          <div className="form-group">
            <label>Redirect URL na stemmen</label>
            <input type="url" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)}
              placeholder="https://domstadradio.nl/hitlijst" />
            <span className="helper-text">Stemmers worden hierheen doorgestuurd na het indienen.</span>
          </div>
          <div className="form-group">
            <label>Privacy Statement URL</label>
            <input type="url" value={privacyUrl} onChange={e => setPrivacyUrl(e.target.value)}
              placeholder="https://domstadradio.nl/privacy" />
            <span className="helper-text">Wordt getoond als link op het aanmeldformulier. Laat leeg om te verbergen.</span>
          </div>

          <details className="form-group" style={{ background:'var(--surface, #f9f9f9)', borderRadius:8, padding:12, border:'1px solid var(--border, #e8e8e8)' }}>
            <summary style={{ fontWeight:600, cursor:'pointer', userSelect:'none' }}>
              🛡 Spelregels tegen stem-bombs
            </summary>
            <span className="helper-text" style={{ display:'block', margin:'6px 0 10px' }}>
              Stel hier regels in die stemmers moeten accepteren, en beperk eventueel hoeveel nummers per artiest gekozen mogen worden.
            </span>

            <label style={{ display:'flex', flexDirection:'row', alignItems:'center', gap:8, marginBottom:10 }}>
              <input
                type="checkbox"
                checked={votingRulesRequired}
                onChange={e => setVotingRulesRequired(e.target.checked)}
              />
              Akkoord op spelregels verplicht maken
            </label>

            <div className="form-group" style={{ marginBottom:10 }}>
              <label>Spelregeltekst (zichtbaar op het stemformulier)</label>
              <textarea
                rows={5}
                value={votingRulesText}
                onChange={e => setVotingRulesText(e.target.value)}
                placeholder={'Voorbeeld:\n- Geen stem-bombs of georganiseerde acties\n- Maximaal 1 nummer per artiest\n- Bij twijfel kan een stem ongeldig worden verklaard'}
              />
            </div>

            <div className="form-group" style={{ marginBottom:0 }}>
              <label>Maximaal aantal nummers per artiest</label>
              <input
                type="number"
                min={0}
                max={10}
                value={maxTracksPerArtist}
                onChange={e => setMaxTracksPerArtist(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="helper-text">
                0 = geen automatische limiet. Zet bijvoorbeeld 1 om stem-bombs met 3 nummers van dezelfde artiest te blokkeren.
              </span>
            </div>
          </details>

          <div className="form-group">
            <label>Achtergrondafbeelding</label>
            <input type="file" accept="image/*" onChange={e => setBgFile(e.target.files[0])} />
            {list?.bg_image && !bgFile && (
              <img src={list.bg_image} alt="bg" style={{ marginTop:8, height:60, borderRadius:6, objectFit:'cover' }} />
            )}
          </div>
        </div>

        {/* Rechter kolom: thema */}
        <div>
          <h3 style={{ marginBottom:16 }}>Thema</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            {[
              ['Primaire kleur',    'primaryColor'],
              ['Secundaire kleur',  'secondaryColor'],
              ['Achtergrondkleur',  'bgColor'],
              ['Tekstkleur',        'textColor'],
              ['Kaart achtergrond', 'cardBg'],
            ].map(([label, key]) => (
              <div key={key} className="form-group" style={{ marginBottom:8 }}>
                <label>{label}</label>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input type="color" value={theme[key]}
                    onChange={e => setThemeKey(key, e.target.value)}
                    style={{ width:44, height:36, padding:2, border:'1.5px solid #ddd', borderRadius:6 }}
                  />
                  <input value={theme[key]} onChange={e => setThemeKey(key, e.target.value)}
                    style={{ flex:1 }} />
                </div>
              </div>
            ))}
          </div>

          <div className="form-group">
            <label>Lettertype</label>
            <select value={theme.fontFamily} onChange={e => setThemeKey('fontFamily', e.target.value)}>
              {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Hoeken kaarten</label>
            <select value={theme.borderRadius} onChange={e => setThemeKey('borderRadius', e.target.value)}>
              {RADIUS_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* Preview */}
          <div style={preview}>
            <div style={{ fontWeight:700, marginBottom:6, color: theme.primaryColor }}>Voorbeeld kaart</div>
            <div style={{ background: theme.cardBg, borderRadius: theme.borderRadius, padding:12 }}>
              <div style={{ fontWeight:700 }}>Artiest – Nummer</div>
              <div style={{ fontSize:13, opacity:.7 }}>Album · 1999</div>
            </div>
            <button className="btn" style={{
              marginTop:10, background: theme.primaryColor,
              borderRadius: theme.borderRadius, fontFamily: theme.fontFamily,
            }}>Stem indienen</button>
          </div>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div style={{ marginTop:24, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        {list?.id && hasPerm('reset') && (
          <button className="btn btn-outline"
            style={{ color:'#c00', borderColor:'#c00', marginLeft:'auto' }}
            onClick={seasonReset}>
            ♻ Seizoensreset
          </button>
        )}
      </div>
      {list?.id && hasPerm('reset') && (
        <p className="helper-text" style={{ marginTop:6, color:'#c00' }}>
          Seizoensreset verwijdert alle stemmen en stemmers. Chart history blijft bewaard.
        </p>
      )}

      {/* ── Stemmen pauzeren ── */}
      {list?.id && hasPerm('lists') && (
        <div style={{ marginTop:32, background:'#fff8e1', border:'1px solid #ffe082', borderRadius:8, padding:16 }}>
          <h3 style={{ margin:'0 0 12px' }}>⏸ Stemmen pauzeren</h3>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginBottom:10 }}>
            <input type="checkbox" checked={votingPaused} onChange={e => setVotingPaused(e.target.checked)} />
            <span style={{ fontWeight:600 }}>{votingPaused ? 'Stemmen is gepauzeerd' : 'Stemmen loopt normaal'}</span>
          </label>
          <div className="form-group" style={{ marginBottom:10 }}>
            <label>Mededeling voor stemmers</label>
            <textarea rows={2} value={pauseMessage} onChange={e => setPauseMessage(e.target.value)}
              placeholder="We zijn bezig met de verwerking. Stem binnenkort weer mogelijk." />
          </div>
          <button className="btn btn-sm" disabled={pauseSaving} onClick={async () => {
            setPauseSaving(true);
            try {
              await axios.put(`/api/admin/lists/${list.id}/voting-pause`, { paused: votingPaused, message: pauseMessage });
            } catch (e) { alert(e.response?.data?.error || 'Opslaan mislukt'); }
            finally { setPauseSaving(false); }
          }}>
            {pauseSaving ? 'Opslaan…' : 'Pauze instelling opslaan'}
          </button>
        </div>
      )}

      {/* ── Automatisch publiceren ── */}
      {list?.id && hasPerm('chart') && (
        <div style={{ marginTop:16, background:'#e8f5e9', border:'1px solid #a5d6a7', borderRadius:8, padding:16 }}>
          <h3 style={{ margin:'0 0 12px' }}>🕐 Automatisch publiceren</h3>
          <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap', marginBottom:10 }}>
            <div className="form-group" style={{ margin:0 }}>
              <label>Dag</label>
              <select value={schedDay} onChange={e => setSchedDay(e.target.value)}>
                <option value="">— Uitgeschakeld —</option>
                <option value="1">Maandag</option>
                <option value="2">Dinsdag</option>
                <option value="3">Woensdag</option>
                <option value="4">Donderdag</option>
                <option value="5">Vrijdag</option>
                <option value="6">Zaterdag</option>
                <option value="0">Zondag</option>
              </select>
            </div>
            <div className="form-group" style={{ margin:0 }}>
              <label>Tijd</label>
              <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                <input type="number" min={0} max={23} value={schedHour} onChange={e => setSchedHour(e.target.value.padStart(2,'0'))}
                  style={{ width:60, textAlign:'center' }} />
                <span>:</span>
                <input type="number" min={0} max={59} value={schedMinute} onChange={e => setSchedMinute(e.target.value.padStart(2,'0'))}
                  style={{ width:60, textAlign:'center' }} />
              </div>
            </div>
            <button className="btn btn-sm" disabled={schedSaving} onClick={async () => {
              setSchedSaving(true);
              try {
                await axios.put(`/api/admin/lists/${list.id}/publish-schedule`, { cron: cronExpr });
                alert(cronExpr ? `Ingepland: ${['zo','ma','di','wo','do','vr','za','zo'][+schedDay]} om ${schedHour}:${schedMinute}` : 'Automatisch publiceren uitgeschakeld');
              } catch (e) { alert(e.response?.data?.error || 'Opslaan mislukt'); }
              finally { setSchedSaving(false); }
            }}>
              {schedSaving ? 'Opslaan…' : 'Schema opslaan'}
            </button>
          </div>
          {cronExpr && <p className="helper-text">Actief cron-schema: <code>{cronExpr}</code> (Amsterdam-tijd)</p>}
          {!schedDay && <p className="helper-text">Selecteer een dag om automatisch publiceren in te stellen.</p>}
        </div>
      )}
    </div>
  );
}
