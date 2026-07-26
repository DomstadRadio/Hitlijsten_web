import React, { useState, useEffect } from 'react';
import axios from 'axios';

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

export default function ListEditor({ list, onSaved }) {
  const existing = list || {};
  const [name,       setName]       = useState(existing.name        || '');
  const [slug,       setSlug]       = useState(existing.slug        || '');
  const [description,setDescription]= useState(existing.description || '');
  const [domain,     setDomain]     = useState(existing.domain      || '');
  const [status,     setStatus]     = useState(existing.status      || 'draft');
  const [maxVotes,   setMaxVotes]   = useState(existing.max_votes   || 10);
  const [closesAt,   setClosesAt]   = useState(existing.closes_at   || '');
  const [playitGroup,setPlayitGroup]= useState(existing.playit_group|| '');
  const [redirectUrl, setRedirectUrl]= useState(existing.redirect_url || '');
  const [theme,      setTheme]      = useState({ ...DEFAULT_THEME, ...(existing.theme || {}) });
  const [bgFile,     setBgFile]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [groups,     setGroups]     = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

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
      if (bgFile) form.append('bg_image', bgFile);

      if (list?.id) {
        await axios.put(`${API}/lists/${list.id}`, form);
      } else {
        await axios.post(`${API}/lists`, form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Opslaan mislukt');
    } finally {
      setSaving(false);
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
                onChange={e => setMaxVotes(Number(e.target.value))} />
            </div>
          </div>
          <div className="form-group">
            <label>Sluitingsdatum</label>
            <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Redirect URL na stemmen</label>
            <input type="url" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)}
              placeholder="https://domstadradio.nl/hitlijst" />
            <span className="helper-text">Stemmers worden hierheen doorgestuurd na het indienen.</span>
          </div>
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
      <div style={{ marginTop:24 }}>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </div>
  );
}
