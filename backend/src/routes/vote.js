/**
 * Routes: stemmen.
 * POST /api/vote/:slug/register   — aanmelden (email + naam + machineId)
 * GET  /api/vote/:slug/verify/:token — e-mail bevestigen
 * POST /api/vote/:slug/submit     — stem indienen (na verificatie)
 * GET  /api/vote/:slug/status     — check of machineId al gestemd heeft
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const email = require('../services/email');

const router = express.Router();

const WHITELIST = (process.env.MACHINE_ID_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);
const isWhitelisted = (id) => id && WHITELIST.includes(id);

// POST /api/vote/:slug/register
router.post('/:slug/register', async (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list)  return res.status(404).json({ error: 'Lijst niet gevonden' });
  if (list.status !== 'open') return res.status(403).json({ error: 'Stemmen is gesloten' });

  const { emailAddr, name, phone, machineId } = req.body;
  if (!emailAddr) return res.status(400).json({ error: 'E-mailadres is verplicht' });

  // Controleer of machineId al gestemd heeft
  if (machineId && !isWhitelisted(machineId)) {
    const existing = db.prepare(
      'SELECT id FROM registrations WHERE list_id = ? AND machine_id = ? AND verified = 1'
    ).get(list.id, machineId);
    if (existing) return res.status(409).json({ error: 'Je hebt al gestemd vanaf dit apparaat' });
  }

  // Controleer of email al geregistreerd is
  const existingEmail = db.prepare(
    'SELECT id, verified FROM registrations WHERE list_id = ? AND email = ?'
  ).get(list.id, emailAddr.toLowerCase());

  if (existingEmail?.verified && !isWhitelisted(machineId)) {
    return res.status(409).json({ error: 'Dit e-mailadres heeft al gestemd' });
  }

  const token = uuidv4();
  const code  = String(Math.floor(100000 + Math.random() * 900000));

  if (existingEmail) {
    // Opnieuw code sturen
    db.prepare('UPDATE registrations SET verify_token = ?, verify_code = ?, machine_id = ?, name = ?, phone = ? WHERE id = ?')
      .run(token, code, machineId || null, name || null, phone || null, existingEmail.id);
  } else {
    db.prepare(`
      INSERT INTO registrations (list_id, email, name, phone, verify_token, verify_code, machine_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(list.id, emailAddr.toLowerCase(), name || null, phone || null, token, code, machineId || null);
  }

  try {
    await email.sendVerificationEmail({
      to: emailAddr,
      name,
      listName: list.name,
      code,
    });
  } catch (mailErr) {
    console.error('E-mail versturen mislukt:', mailErr.message);
    return res.status(500).json({ error: 'E-mail versturen mislukt, probeer opnieuw' });
  }

  res.json({ ok: true, message: 'Verificatiecode verstuurd' });
});

// POST /api/vote/:slug/verify-code
router.post('/:slug/verify-code', (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { emailAddr, code } = req.body;
  if (!emailAddr || !code) return res.status(400).json({ error: 'E-mailadres en code zijn verplicht' });

  const reg = db.prepare(
    'SELECT * FROM registrations WHERE list_id = ? AND email = ? AND verify_code = ?'
  ).get(list.id, emailAddr.toLowerCase(), String(code));

  if (!reg) return res.status(400).json({ error: 'Onjuiste code. Controleer je e-mail en probeer opnieuw.' });

  if (!reg.verified) {
    db.prepare('UPDATE registrations SET verified = 1 WHERE id = ?').run(reg.id);
  }

  res.json({
    ok: true,
    token:          reg.verify_token,
    registrationId: reg.id,
    listSlug:       list.slug,
    maxVotes:       list.max_votes,
    listName:       list.name,
  });
});

// GET /api/vote/:slug/verify/:token
router.get('/:slug/verify/:token', (req, res) => {
  const db = getDb();
  const reg = db.prepare(
    'SELECT * FROM registrations WHERE verify_token = ?'
  ).get(req.params.token);

  if (!reg) return res.status(404).json({ error: 'Ongeldige of verlopen link' });

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(reg.list_id);
  if (!list || list.slug !== req.params.slug) {
    return res.status(404).json({ error: 'Lijst niet gevonden' });
  }

  if (!reg.verified) {
    db.prepare('UPDATE registrations SET verified = 1 WHERE id = ?').run(reg.id);
  }

  // Geef terug: registratie-id + token (nodig voor submit stap)
  res.json({
    ok: true,
    registrationId: reg.id,
    token: reg.verify_token,
    listSlug: list.slug,
    maxVotes: list.max_votes,
    listName: list.name,
  });
});

// POST /api/vote/:slug/submit
router.post('/:slug/submit', async (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list)  return res.status(404).json({ error: 'Lijst niet gevonden' });
  if (list.status !== 'open') return res.status(403).json({ error: 'Stemmen is gesloten' });

  const { token, votes, comment } = req.body;
  // votes = [{ external_id, source, title, artist, album, cover_url, year, position }]

  if (!token || !Array.isArray(votes) || votes.length === 0) {
    return res.status(400).json({ error: 'Token en stemmen zijn verplicht' });
  }

  if (votes.length > list.max_votes) {
    return res.status(400).json({ error: `Maximaal ${list.max_votes} tracks toegestaan` });
  }

  // Valideer dat elke stem een external_id heeft
  if (votes.some(v => !v.external_id || !v.title || !v.artist)) {
    return res.status(400).json({ error: 'Ongeldige track-gegevens' });
  }

  const reg = db.prepare(
    'SELECT * FROM registrations WHERE verify_token = ? AND list_id = ? AND verified = 1'
  ).get(token, list.id);

  if (!reg) return res.status(403).json({ error: 'Ongeldige token of niet geverifieerd' });

  // Controleer of er al stemmen zijn
  const existingVote = db.prepare(
    'SELECT id FROM votes WHERE registration_id = ?'
  ).get(reg.id);
  if (existingVote && !isWhitelisted(reg.machine_id)) return res.status(409).json({ error: 'Je hebt al gestemd' });

  // Verwijder bestaande stemmen bij whitelist (hertest)
  if (existingVote && isWhitelisted(reg.machine_id)) {
    db.prepare('DELETE FROM votes WHERE registration_id = ?').run(reg.id);
  }

  // Upsert tracks: zoek eerst op artist+title (case-insensitive) in deze lijst;
  // bestaat de track al, hergebruik dan diens id zodat de stem optelt.
  // Anders insert nieuw. Dit voorkomt duplicaten over verschillende bronnen heen.
  const findByArtistTitle = db.prepare(`
    SELECT id, title, artist FROM list_tracks
     WHERE list_id = ?
       AND LOWER(artist) = LOWER(?)
       AND LOWER(title)  = LOWER(?)
     LIMIT 1
  `);
  const findByExternal = db.prepare(
    'SELECT id, title, artist FROM list_tracks WHERE list_id = ? AND source = ? AND external_id = ?'
  );
  const insertTrack = db.prepare(`
    INSERT INTO list_tracks (list_id, source, external_id, title, artist, album, cover_url, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const resolvedTracks = db.transaction(() => {
    const result = [];
    for (const v of votes) {
      // 1) Match op artist+title (definitieve dedupe)
      let row = findByArtistTitle.get(list.id, v.artist, v.title);
      // 2) Anders match op external_id (backwards compat)
      if (!row) {
        row = findByExternal.get(list.id, v.source || 'playit', v.external_id);
      }
      // 3) Anders nieuw invoegen
      if (!row) {
        const info = insertTrack.run(
          list.id,
          v.source  || 'playit',
          v.external_id,
          v.title,
          v.artist,
          v.album   || null,
          v.cover_url || null,
          v.year    || null,
        );
        row = { id: info.lastInsertRowid, title: v.title, artist: v.artist };
      }
      result.push({ ...row, position: Number(v.position) });
    }
    return result;
  })();

  // Sla stemmen op in transactie
  const insertVote = db.prepare(
    'INSERT INTO votes (registration_id, list_id, track_id, position) VALUES (?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const t of resolvedTracks) {
      insertVote.run(reg.id, list.id, t.id, t.position);
    }
  })();

  // Sla opmerking op indien meegegeven
  if (comment) {
    db.prepare('UPDATE registrations SET comment = ? WHERE id = ?').run(comment.trim() || null, reg.id);
  }

  // Bevestigingsmail
  try {
    const tracksForMail = resolvedTracks
      .sort((a, b) => a.position - b.position);

    await email.sendVoteConfirmationEmail({
      to:       reg.email,
      name:     reg.name,
      listName: list.name,
      tracks:   tracksForMail,
    });
  } catch (mailErr) {
    console.error('Bevestigingsmail mislukt:', mailErr.message);
    // Niet fataal — stem is al opgeslagen
  }

  res.json({ ok: true });
});

// GET /api/vote/:slug/status?machineId=xxx
router.get('/:slug/status', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  const { machineId } = req.query;
  let hasVoted = false;

  if (machineId && !isWhitelisted(machineId)) {
    const reg = db.prepare(
      'SELECT r.id FROM registrations r WHERE r.list_id = ? AND r.machine_id = ? AND r.verified = 1'
    ).get(list.id, machineId);

    if (reg) {
      const vote = db.prepare('SELECT id FROM votes WHERE registration_id = ?').get(reg.id);
      hasVoted = !!vote;
    }
  }

  res.json({
    status:   list.status,
    hasVoted,
    listName: list.name,
    maxVotes: list.max_votes,
  });
});

module.exports = router;
