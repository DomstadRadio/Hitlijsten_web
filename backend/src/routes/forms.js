/**
 * Publieke formulier-routes.
 *  GET  /api/forms/:slug                 — formulier ophalen (schema + settings)
 *  POST /api/forms/:slug/register        — e-mail + naam registreren, code mailen
 *  POST /api/forms/:slug/verify-code     — code valideren, geeft submit-token
 *  POST /api/forms/:slug/submit          — antwoorden indienen
 *  POST /api/forms/:slug/submit-direct   — direct indienen (als verificatie uit staat)
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const email     = require('../services/email');

const router = express.Router();

const WHITELIST = (process.env.MACHINE_ID_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);
const isWhitelisted = (id) => id && WHITELIST.includes(id);

function parseForm(row) {
  if (!row) return null;
  return {
    ...row,
    settings: safeJson(row.settings, {}),
    schema:   safeJson(row.schema,   { pages: [] }),
  };
}
function safeJson(s, fb) { try { return JSON.parse(s); } catch (_) { return fb; } }

function defaultSettings(s) {
  return {
    verify_email:    true,
    verify_machine:  true,
    one_per_email:   true,
    success_message: 'Bedankt voor je inzending!',
    redirect_url:    '',
    notify_email:    '',
    confirm_email:   true,
    ...(s || {}),
  };
}

function getFormBySlug(slug) {
  const row = getDb().prepare('SELECT * FROM forms WHERE slug = ?').get(slug);
  const form = parseForm(row);
  if (form) form.settings = defaultSettings(form.settings);
  return form;
}

function collectFields(schema) {
  const out = [];
  for (const p of (schema?.pages || [])) {
    for (const f of (p.fields || [])) out.push(f);
  }
  return out;
}

/** Valideer en normaliseer antwoorden tegen het schema. Gooit Error bij ongeldig. */
function validateAnswers(schema, answers) {
  const fields = collectFields(schema);
  const result = {};
  for (const f of fields) {
    const v = answers ? answers[f.id] : undefined;
    const has = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    if (f.required && !has) throw new Error(`Veld "${f.label || f.id}" is verplicht`);
    if (!has) { result[f.id] = null; continue; }

    switch (f.type) {
      case 'text':
      case 'textarea':
        result[f.id] = String(v).trim();
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) throw new Error(`Ongeldig e-mailadres in "${f.label}"`);
        result[f.id] = String(v).trim().toLowerCase();
        break;
      case 'phone':
        // basis: alleen cijfers, +, spaties, streepjes; 6–20 chars
        if (!/^[+0-9 ()\-]{6,20}$/.test(String(v))) throw new Error(`Ongeldig telefoonnummer in "${f.label}"`);
        result[f.id] = String(v).trim();
        break;
      case 'number':
        if (Number.isNaN(Number(v))) throw new Error(`Ongeldig getal in "${f.label}"`);
        result[f.id] = Number(v);
        break;
      case 'radio':
        result[f.id] = String(v);
        break;
      case 'checkbox':
        if (!Array.isArray(v)) throw new Error(`"${f.label}" verwacht een lijst`);
        result[f.id] = v.map(String);
        break;
      case 'track_single':
        // verwacht { id, source, title, artist, ... }
        if (typeof v !== 'object' || !v.title || !v.artist) throw new Error(`Ongeldige track in "${f.label}"`);
        result[f.id] = pickTrack(v);
        break;
      case 'track_topN':
        if (!Array.isArray(v)) throw new Error(`"${f.label}" verwacht een lijst tracks`);
        const max = Number(f.config?.topN) || 5;
        if (v.length > max) throw new Error(`"${f.label}" mag maximaal ${max} tracks bevatten`);
        result[f.id] = v.map(pickTrack);
        break;
      default:
        result[f.id] = v;
    }
  }
  return result;
}

function pickTrack(t) {
  return {
    id:          t.id || null,
    source:      t.source || 'manual',
    external_id: t.external_id || null,
    title:       String(t.title || '').trim(),
    artist:      String(t.artist || '').trim(),
    album:       t.album || null,
    cover_url:   t.cover_url || null,
    year:        t.year || null,
  };
}

// ── Public endpoints ────────────────────────────────────────────────────────

// GET /api/forms/:slug
router.get('/:slug', (req, res) => {
  const form = getFormBySlug(req.params.slug);
  if (!form) return res.status(404).json({ error: 'Formulier niet gevonden' });
  if (form.status === 'draft') return res.status(403).json({ error: 'Formulier is nog niet gepubliceerd' });
  // Geef alleen publieke velden terug
  res.json({
    slug:        form.slug,
    name:        form.name,
    description: form.description,
    status:      form.status,
    schema:      form.schema,
    settings: {
      verify_email:    form.settings.verify_email,
      one_per_email:   form.settings.one_per_email,
      success_message: form.settings.success_message,
      redirect_url:    form.settings.redirect_url,
    },
  });
});

// POST /api/forms/:slug/register
router.post('/:slug/register', async (req, res) => {
  const form = getFormBySlug(req.params.slug);
  if (!form) return res.status(404).json({ error: 'Formulier niet gevonden' });
  if (form.status !== 'open') return res.status(403).json({ error: 'Formulier is gesloten' });

  const { emailAddr, name, phone, machineId } = req.body || {};
  if (!emailAddr) return res.status(400).json({ error: 'E-mailadres is verplicht' });

  const db = getDb();

  if (form.settings.verify_machine && machineId && !isWhitelisted(machineId)) {
    const ex = db.prepare(
      'SELECT id FROM form_registrations WHERE form_id = ? AND machine_id = ? AND verified = 1'
    ).get(form.id, machineId);
    if (ex && form.settings.one_per_email) {
      return res.status(409).json({ error: 'Je hebt dit formulier al ingediend vanaf dit apparaat' });
    }
  }

  if (form.settings.one_per_email) {
    const dup = db.prepare(`
      SELECT fr.id FROM form_registrations fr
      JOIN form_responses resp ON resp.registration_id = fr.id
      WHERE fr.form_id = ? AND fr.email = ?
    `).get(form.id, emailAddr.toLowerCase());
    if (dup && !isWhitelisted(machineId)) {
      return res.status(409).json({ error: 'Dit e-mailadres heeft dit formulier al ingediend' });
    }
  }

  const token = uuidv4();
  const code  = String(Math.floor(100000 + Math.random() * 900000));

  const existing = db.prepare(
    'SELECT id FROM form_registrations WHERE form_id = ? AND email = ?'
  ).get(form.id, emailAddr.toLowerCase());

  if (existing) {
    db.prepare(`
      UPDATE form_registrations
         SET verify_token = ?, verify_code = ?, name = ?, phone = ?, machine_id = ?, verified = 0
       WHERE id = ?
    `).run(token, code, name || null, phone || null, machineId || null, existing.id);
  } else {
    db.prepare(`
      INSERT INTO form_registrations (form_id, email, name, phone, verify_token, verify_code, machine_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(form.id, emailAddr.toLowerCase(), name || null, phone || null, token, code, machineId || null);
  }

  try {
    await email.sendFormVerificationEmail({
      to:       emailAddr,
      name,
      formName: form.name,
      code,
    });
  } catch (e) {
    console.error('Form mail mislukt:', e.message);
    return res.status(500).json({ error: 'E-mail versturen mislukt, probeer opnieuw' });
  }

  res.json({ ok: true });
});

// POST /api/forms/:slug/verify-code
router.post('/:slug/verify-code', (req, res) => {
  const form = getFormBySlug(req.params.slug);
  if (!form) return res.status(404).json({ error: 'Formulier niet gevonden' });

  const { emailAddr, code } = req.body || {};
  if (!emailAddr || !code) return res.status(400).json({ error: 'E-mailadres en code zijn verplicht' });

  const db  = getDb();
  const reg = db.prepare(
    'SELECT * FROM form_registrations WHERE form_id = ? AND email = ? AND verify_code = ?'
  ).get(form.id, emailAddr.toLowerCase(), String(code));
  if (!reg) return res.status(400).json({ error: 'Onjuiste code' });

  if (!reg.verified) db.prepare('UPDATE form_registrations SET verified = 1 WHERE id = ?').run(reg.id);

  res.json({
    ok:             true,
    token:          reg.verify_token,
    registrationId: reg.id,
  });
});

// POST /api/forms/:slug/submit
router.post('/:slug/submit', async (req, res) => {
  const form = getFormBySlug(req.params.slug);
  if (!form) return res.status(404).json({ error: 'Formulier niet gevonden' });
  if (form.status !== 'open') return res.status(403).json({ error: 'Formulier is gesloten' });

  const { token, answers, comment, machineId, emailAddr, name, phone } = req.body || {};
  const db = getDb();

  let reg = null;
  if (form.settings.verify_email) {
    if (!token) return res.status(400).json({ error: 'Verificatie vereist' });
    reg = db.prepare(
      'SELECT * FROM form_registrations WHERE verify_token = ? AND form_id = ? AND verified = 1'
    ).get(token, form.id);
    if (!reg) return res.status(403).json({ error: 'Ongeldige of niet-geverifieerde token' });
  } else {
    // Anonieme submit — maak ad-hoc registratie zodat we e-mail/notify kunnen koppelen
    const insert = db.prepare(`
      INSERT INTO form_registrations (form_id, email, name, phone, verify_token, machine_id, verified)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(form.id, emailAddr || null, name || null, phone || null, uuidv4(), machineId || null);
    reg = db.prepare('SELECT * FROM form_registrations WHERE id = ?').get(insert.lastInsertRowid);
  }

  // 1 inzending per registratie wanneer one_per_email aan staat
  if (form.settings.one_per_email) {
    const dup = db.prepare('SELECT id FROM form_responses WHERE registration_id = ?').get(reg.id);
    if (dup && !isWhitelisted(reg.machine_id)) {
      return res.status(409).json({ error: 'Je hebt dit formulier al ingediend' });
    }
  }

  let validated;
  try {
    validated = validateAnswers(form.schema, answers || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  db.prepare(`
    INSERT INTO form_responses (form_id, registration_id, answers, comment)
    VALUES (?, ?, ?, ?)
  `).run(form.id, reg.id, JSON.stringify(validated), (comment || '').trim() || null);

  // ── Bevestigingsmail naar inzender ──
  const summaryHtml = renderAnswerSummary(form.schema, validated);
  if (reg.email && form.settings.confirm_email !== false) {
    email.sendFormResponseEmail({
      to:       reg.email,
      name:     reg.name,
      formName: form.name,
      summaryHtml,
    }).catch(e => console.error('Form bevestigingsmail:', e.message));
  }

  // ── Notificatie naar admin ──
  if (form.settings.notify_email) {
    email.sendFormAdminNotificationEmail({
      to:       form.settings.notify_email,
      formName: form.name,
      name:     reg.name,
      email:    reg.email,
      summaryHtml,
    }).catch(e => console.error('Form admin notificatie:', e.message));
  }

  res.json({ ok: true, message: form.settings.success_message, redirect_url: form.settings.redirect_url });
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderAnswerSummary(schema, answers) {
  const rows = [];
  for (const f of collectFields(schema)) {
    const v = answers[f.id];
    if (v === null || v === undefined) continue;
    let html = '';
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0].title) {
      html = '<ol style="padding-left:20px;margin:4px 0">'
        + v.map(t => `<li>${escapeHtml(t.artist)} – ${escapeHtml(t.title)}</li>`).join('')
        + '</ol>';
    } else if (typeof v === 'object' && v?.title) {
      html = `${escapeHtml(v.artist)} – ${escapeHtml(v.title)}`;
    } else if (Array.isArray(v)) {
      html = escapeHtml(v.join(', '));
    } else {
      html = escapeHtml(String(v));
    }
    rows.push(`<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top"><strong>${escapeHtml(f.label || f.id)}</strong></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${html}</td></tr>`);
  }
  return rows.length ? `<table style="width:100%;border-collapse:collapse;margin:12px 0">${rows.join('')}</table>` : '';
}

module.exports = router;
