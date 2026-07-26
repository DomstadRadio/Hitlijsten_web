import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API = '/api';

const FIELD_TYPES = [
  { type: 'text',         label: 'Korte tekst' },
  { type: 'textarea',     label: 'Lange tekst' },
  { type: 'email',        label: 'E-mailadres' },
  { type: 'phone',        label: 'Telefoonnummer' },
  { type: 'number',       label: 'Getal' },
  { type: 'radio',        label: 'Radio (één keuze)' },
  { type: 'checkbox',     label: 'Checkbox (meerdere)' },
  { type: 'track_single', label: 'Track-picker enkel (fase 2)' },
  { type: 'track_topN',   label: 'Track-picker top-N (fase 2)' },
];

const newId = () => 'f_' + Math.random().toString(36).slice(2, 9);

/**
 * Formulier-builder met drag-to-reorder velden en multi-page tabs.
 * Props: form, onBack(), onSaved()
 */
export default function FormBuilder({ form: initial, onBack, onSaved }) {
  const [form, setForm]     = useState(null);
  const [activePage, setAP] = useState(0);
  const [selectedField, setSF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty]   = useState(false);
  const [loadError, setLoadError] = useState('');

  // Volledige form (incl. schema + settings) ophalen — de lijst-endpoint geeft die niet mee.
  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setLoadError('');
    axios.get(`${API}/admin/forms/${initial.id}`)
      .then(r => { if (!cancelled) setForm(normalizeForm(r.data)); })
      .catch(e => { if (!cancelled) setLoadError(e?.response?.data?.error || e.message); });
    return () => { cancelled = true; };
  }, [initial.id]);

  if (loadError) return <p style={{ color: '#c00' }}>{loadError} <button className="btn btn-sm btn-outline" onClick={onBack}>← Terug</button></p>;
  if (!form)     return <p>Laden…</p>;

  const update = (patch) => {
    setForm(f => ({ ...f, ...patch }));
    setDirty(true);
  };
  const updateSchema = (fn) => {
    setForm(f => {
      const next = JSON.parse(JSON.stringify(f));
      fn(next.schema);
      return next;
    });
    setDirty(true);
  };
  const updateSettings = (patch) => {
    setForm(f => ({ ...f, settings: { ...f.settings, ...patch } }));
    setDirty(true);
  };

  const page = form.schema.pages[activePage] || form.schema.pages[0];

  const addField = (type) => {
    const id = newId();
    updateSchema(s => {
      s.pages[activePage].fields.push({
        id, type,
        label: defaultLabel(type),
        required: false,
        ...(type === 'radio' || type === 'checkbox' ? { options: [{ label: 'Optie 1', value: 'optie-1' }] } : {}),
        ...(type === 'track_topN' ? { config: { topN: 5, sources: ['playit'], trackgroupIds: [] } } : {}),
      });
    });
    setSF(id);
  };

  const removeField = (id) => {
    updateSchema(s => {
      s.pages[activePage].fields = s.pages[activePage].fields.filter(f => f.id !== id);
    });
    if (selectedField === id) setSF(null);
  };

  const moveField = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    updateSchema(s => {
      const arr = s.pages[activePage].fields;
      const [it] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, it);
    });
  };

  const patchField = (id, patch) => {
    updateSchema(s => {
      for (const p of s.pages) {
        const f = p.fields.find(x => x.id === id);
        if (f) Object.assign(f, patch);
      }
    });
  };

  const addPage = () => {
    updateSchema(s => {
      s.pages.push({ id: 'p_' + Math.random().toString(36).slice(2, 7), title: `Pagina ${s.pages.length + 1}`, fields: [] });
    });
    setAP(form.schema.pages.length);
  };

  const removePage = (idx) => {
    if (form.schema.pages.length === 1) { alert('Een formulier moet minstens 1 pagina hebben.'); return; }
    if (!window.confirm('Pagina + alle velden verwijderen?')) return;
    updateSchema(s => { s.pages.splice(idx, 1); });
    setAP(Math.max(0, idx - 1));
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await axios.put(`${API}/admin/forms/${form.id}`, {
        name:        form.name,
        description: form.description,
        slug:        form.slug,
        status:      form.status,
        settings:    form.settings,
        schema:      form.schema,
      });
      setForm(normalizeForm(r.data));
      setDirty(false);
      onSaved?.();
    } catch (e) {
      alert(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={topBar}>
        <div>
          <input
            value={form.name}
            onChange={e => update({ name: e.target.value })}
            style={{ ...inp, fontSize: 18, fontWeight: 600, width: 320 }}
          />
          <code style={{ marginLeft: 12, color: '#666' }}>/formulier/{form.slug}</code>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={form.status} onChange={e => update({ status: e.target.value })} style={inp}>
            <option value="draft">Concept</option>
            <option value="open">Open</option>
            <option value="closed">Gesloten</option>
          </select>
          <button className="btn btn-outline" onClick={onBack}>← Terug</button>
          <button className="btn" disabled={saving} onClick={save}>{saving ? 'Opslaan…' : (dirty ? '💾 Opslaan' : '✓ Opgeslagen')}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>

        {/* ── 1. Algemene instellingen ── */}
        <Section title="⚙️ Algemene instellingen" defaultOpen={false}>
          <div style={twoCol}>
            <label style={lbl}>Slug
              <input value={form.slug} onChange={e => update({ slug: e.target.value })} style={inp} />
            </label>
            <label style={lbl}>Notificatie e-mail (admin)
              <input value={form.settings.notify_email || ''} onChange={e => updateSettings({ notify_email: e.target.value })} style={inp} placeholder="admin@..."/>
            </label>
          </div>
          <label style={lbl}>Beschrijving
            <textarea value={form.description || ''} onChange={e => update({ description: e.target.value })} style={{ ...inp, minHeight: 60 }} />
          </label>
          <div style={twoCol}>
            <label style={chk}>
              <input type="checkbox" checked={!!form.settings.verify_email}    onChange={e => updateSettings({ verify_email: e.target.checked })} /> E-mailverificatie
            </label>
            <label style={chk}>
              <input type="checkbox" checked={!!form.settings.verify_machine}  onChange={e => updateSettings({ verify_machine: e.target.checked })} /> Machine-id check
            </label>
            <label style={chk}>
              <input type="checkbox" checked={!!form.settings.one_per_email}   onChange={e => updateSettings({ one_per_email: e.target.checked })} /> 1 inzending per e-mail
            </label>
            <label style={chk}>
              <input type="checkbox" checked={form.settings.confirm_email !== false} onChange={e => updateSettings({ confirm_email: e.target.checked })} /> Bevestiging naar inzender
            </label>
          </div>
          <label style={lbl}>Bedankt-bericht
            <textarea value={form.settings.success_message || ''} onChange={e => updateSettings({ success_message: e.target.value })} style={{ ...inp, minHeight: 50 }} />
          </label>
          <label style={lbl}>Redirect-URL na inzending
            <input value={form.settings.redirect_url || ''} onChange={e => updateSettings({ redirect_url: e.target.value })} style={inp} placeholder="https://…"/>
          </label>
        </Section>

        {/* ── 2. Pagina-tabs ── */}
        <div style={panel}>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ddd', marginBottom: 12, flexWrap: 'wrap' }}>
            {form.schema.pages.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  className={'btn btn-sm ' + (i === activePage ? '' : 'btn-outline')}
                  onClick={() => setAP(i)}
                  style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
                >{p.title}</button>
                {i === activePage && form.schema.pages.length > 1 && (
                  <button className="btn btn-sm btn-outline" onClick={() => removePage(i)} style={{ marginLeft: 2 }}>×</button>
                )}
              </div>
            ))}
            <button className="btn btn-sm btn-outline" onClick={addPage}>+ Pagina</button>
          </div>

          <label style={lbl}>Paginatitel
            <input
              value={page.title}
              onChange={e => updateSchema(s => { s.pages[activePage].title = e.target.value; })}
              style={{ ...inp, fontSize: 16, fontWeight: 600 }}
            />
          </label>

          {/* ── 3. Velden van deze pagina (klik = uitklappen om te bewerken) ── */}
          <h4 style={{ marginTop: 16, marginBottom: 8 }}>Velden</h4>
          {page.fields.length === 0 && <p className="helper-text">Nog geen velden — kies hieronder een type om er een toe te voegen.</p>}

          <DragList
            items={page.fields}
            onMove={moveField}
            renderItem={(f, i) => (
              <div>
                <FieldRow
                  field={f}
                  selected={f.id === selectedField}
                  onSelect={() => setSF(f.id === selectedField ? null : f.id)}
                  onRemove={() => removeField(f.id)}
                />
                {f.id === selectedField && (
                  <div style={inlineEditor}>
                    <FieldEditor
                      key={f.id}
                      field={f}
                      onChange={patch => patchField(f.id, patch)}
                    />
                  </div>
                )}
              </div>
            )}
          />

          {/* ── 4. Veld toevoegen (palette onderaan) ── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed #ddd' }}>
            <h4 style={{ marginTop: 0, marginBottom: 8 }}>+ Veld toevoegen</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FIELD_TYPES.map(t => (
                <button key={t.type} className="btn btn-sm btn-outline" onClick={() => addField(t.type)}>
                  + {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Inklapbare sectie ───────────────────────────────────────────────────────

function Section({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={panel}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 16, fontWeight: 600, marginBottom: open ? 12 : 0,
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
        }}
      >
        <span style={{ display: 'inline-block', width: 16 }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Drag-to-reorder list (native HTML5) ─────────────────────────────────────

function DragList({ items, onMove, renderItem }) {
  const dragIdx = useRef(null);
  return (
    <div>
      {items.map((it, i) => (
        <div
          key={it.id}
          draggable
          onDragStart={() => { dragIdx.current = i; }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={() => {
            if (dragIdx.current !== null) onMove(dragIdx.current, i);
            dragIdx.current = null;
          }}
          style={{ marginBottom: 6 }}
        >
          {renderItem(it, i)}
        </div>
      ))}
    </div>
  );
}

function FieldRow({ field, selected, onSelect, onRemove }) {
  const typeMeta = FIELD_TYPES.find(t => t.type === field.type);
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px', borderRadius: 6,
        border: '1px solid ' + (selected ? '#e00' : '#ddd'),
        background: selected ? '#fff5f5' : '#fff',
        cursor: 'grab',
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase' }}>
          ⋮⋮ {typeMeta?.label || field.type}{field.required ? ' *' : ''}
        </div>
        <div style={{ fontWeight: 600 }}>{field.label || '(zonder label)'}</div>
      </div>
      <button className="btn btn-sm btn-outline" style={{ color: '#c00' }} onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
    </div>
  );
}

function FieldEditor({ field, onChange }) {
  const isOpts = field.type === 'radio' || field.type === 'checkbox';
  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Veld bewerken</h4>
      <label style={lbl}>Label
        <input value={field.label || ''} onChange={e => onChange({ label: e.target.value })} style={inp} />
      </label>
      <label style={lbl}>Hulptekst
        <input value={field.help || ''} onChange={e => onChange({ help: e.target.value })} style={inp} />
      </label>
      <label style={chk}>
        <input type="checkbox" checked={!!field.required} onChange={e => onChange({ required: e.target.checked })} /> Verplicht
      </label>

      {isOpts && (
        <div>
          <h5>Opties</h5>
          {(field.options || []).map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input
                value={o.label}
                onChange={e => {
                  const opts = [...field.options];
                  opts[i] = { label: e.target.value, value: slugifyOpt(e.target.value) };
                  onChange({ options: opts });
                }}
                style={inp}
              />
              <button className="btn btn-sm btn-outline" onClick={() => {
                onChange({ options: field.options.filter((_, j) => j !== i) });
              }}>×</button>
            </div>
          ))}
          <button className="btn btn-sm btn-outline" onClick={() => {
            const opts = [...(field.options || [])];
            opts.push({ label: `Optie ${opts.length + 1}`, value: `optie-${opts.length + 1}` });
            onChange({ options: opts });
          }}>+ Optie</button>
        </div>
      )}

      {field.type === 'track_topN' && (
        <label style={lbl}>Aantal tracks (top-N)
          <input type="number" min={1} max={50}
                 value={field.config?.topN || 5}
                 onChange={e => onChange({ config: { ...(field.config || {}), topN: Number(e.target.value) } })}
                 style={inp} />
        </label>
      )}

      {(field.type === 'track_single' || field.type === 'track_topN') && (
        <TrackFieldConfig field={field} onChange={onChange} />
      )}
    </div>
  );
}

function TrackFieldConfig({ field, onChange }) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    axios.get(`${API}/search/groups`)
      .then(r => setGroups(Array.isArray(r.data) ? r.data : []))
      .catch(() => setGroups([]));
  }, []);

  const cfg = field.config || {};
  const sources = Array.isArray(cfg.sources) && cfg.sources.length ? cfg.sources : ['playit', 'spotify'];
  const setCfg  = (patch) => onChange({ config: { ...cfg, ...patch } });
  const toggleSource = (s) => {
    const next = sources.includes(s) ? sources.filter(x => x !== s) : [...sources, s];
    setCfg({ sources: next });
  };

  return (
    <div style={{ marginTop: 8, padding: 8, border: '1px dashed #ccc', borderRadius: 6 }}>
      <h5 style={{ margin: '0 0 6px' }}>Track-bron</h5>

      <label style={lbl}>PlayIt trackgroep (filter)
        <select
          value={cfg.trackgroup || ''}
          onChange={e => setCfg({ trackgroup: e.target.value || null })}
          style={inp}
        >
          <option value="">— alle groepen —</option>
          {groups.map(g => {
            // /api/search/groups kan strings of objects teruggeven
            const name = typeof g === 'string' ? g : (g.name || g.title || g.groupName || '');
            return name ? <option key={name} value={name}>{name}</option> : null;
          })}
        </select>
      </label>

      <div style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>Bronnen:</strong>
        <label style={chk}>
          <input type="checkbox" checked={sources.includes('playit')}  onChange={() => toggleSource('playit')} /> PlayIt
        </label>
        <label style={chk}>
          <input type="checkbox" checked={sources.includes('spotify')} onChange={() => toggleSource('spotify')} /> Spotify
        </label>
      </div>
    </div>
  );
}

function normalizeForm(f) {
  if (!f) return f;
  const out = { ...f };
  if (!out.schema || typeof out.schema !== 'object') {
    out.schema = { pages: [{ id: 'p1', title: 'Pagina 1', fields: [] }] };
  }
  if (!Array.isArray(out.schema.pages) || out.schema.pages.length === 0) {
    out.schema.pages = [{ id: 'p1', title: 'Pagina 1', fields: [] }];
  }
  out.schema.pages = out.schema.pages.map(p => ({
    id: p.id || ('p_' + Math.random().toString(36).slice(2, 7)),
    title: p.title || 'Pagina',
    fields: Array.isArray(p.fields) ? p.fields : [],
  }));
  if (!out.settings || typeof out.settings !== 'object') out.settings = {};
  return out;
}

function defaultLabel(type) {
  return ({
    text: 'Korte tekst', textarea: 'Lange tekst', email: 'E-mailadres',
    phone: 'Telefoonnummer', number: 'Getal',
    radio: 'Maak een keuze', checkbox: 'Selecteer één of meer',
    track_single: 'Kies een track', track_topN: 'Top 5 tracks',
  }[type] || 'Nieuw veld');
}
function slugifyOpt(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'optie';
}

// ── Styles ──────────────────────────────────────────────────────────────────

const topBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const panel  = { background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 12 };
const inp    = { width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontSize: 14 };
const lbl    = { display: 'block', marginBottom: 8, fontSize: 13 };
const chk    = { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', fontSize: 13 };
const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 };
const inlineEditor = {
  margin: '4px 0 10px 16px', padding: 12,
  background: '#fff', border: '1px solid #e0e0e0', borderLeft: '3px solid #e00', borderRadius: 6,
};
