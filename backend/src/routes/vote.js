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
const { logAction } = require('../utils/audit');

const router = express.Router();

const WHITELIST    = (process.env.MACHINE_ID_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean);
const TEST_EMAILS  = (process.env.TEST_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isWhitelisted = (id) => id && WHITELIST.includes(id);
// Test-emailadressen mogen altijd stemmen, ongeacht machine/cookie/duplicaat-checks
const isTestEmail = (addr) => addr && TEST_EMAILS.includes(addr.toLowerCase());

// POST /api/vote/:slug/register
router.post('/:slug/register', async (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list)  return res.status(404).json({ error: 'Lijst niet gevonden' });
  if (list.status !== 'open') return res.status(403).json({ error: 'Stemmen is gesloten' });
  if (list.voting_paused) return res.status(403).json({ error: list.voting_paused_message || 'Stemmen is tijdelijk gepauzeerd', paused: true });

  const { emailAddr, name, phone, machineId, rulesAccepted } = req.body;
  if (!emailAddr) return res.status(400).json({ error: 'E-mailadres is verplicht' });
  if (list.voting_rules_required && !rulesAccepted) {
    return res.status(400).json({ error: 'Je moet eerst akkoord gaan met de spelregels' });
  }

  const tester = isTestEmail(emailAddr);

  // Blokkeerlijst overslaan voor testemail
  if (!tester) {
    const isBlocked = db.prepare(`
      SELECT id FROM blocked_voters
      WHERE list_id = ?
        AND (
          (email IS NOT NULL AND lower(email) = lower(?))
          OR (machine_id IS NOT NULL AND machine_id = ? AND ? IS NOT NULL)
        )
      LIMIT 1
    `).get(list.id, emailAddr, machineId || '', machineId || null);
    if (isBlocked) return res.status(403).json({ error: 'Je kunt niet deelnemen aan deze stemming' });
  }

  // Bestaande registratie altijd opzoeken (nodig voor UPDATE vs INSERT verderop)
  const existingEmail = db.prepare(
    'SELECT id, verified FROM registrations WHERE list_id = ? AND email = ?'
  ).get(list.id, emailAddr.toLowerCase());

  // Machine- en email-duplicaatchecks overslaan voor testemail
  if (!tester) {
    if (machineId && !isWhitelisted(machineId)) {
      const existing = db.prepare(`
        SELECT r.id FROM registrations r
        WHERE r.list_id = ? AND r.machine_id = ? AND r.verified = 1
          AND EXISTS (SELECT 1 FROM votes v WHERE v.registration_id = r.id)
      `).get(list.id, machineId);
      if (existing) return res.status(409).json({ error: 'Je hebt al gestemd vanaf dit apparaat' });
    }

    if (existingEmail?.verified && !isWhitelisted(machineId)) {
      const hasVoted = db.prepare('SELECT id FROM votes WHERE registration_id = ?').get(existingEmail.id);
      if (hasVoted) return res.status(409).json({ error: 'Dit e-mailadres heeft al gestemd' });
    }
  }

  const token = uuidv4();
  const code  = String(Math.floor(100000 + Math.random() * 900000));
  // Code geldig voor 24 uur
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  if (existingEmail) {
    // Opnieuw code sturen
    db.prepare('UPDATE registrations SET verify_token = ?, verify_code = ?, code_expires_at = ?, machine_id = ?, name = ?, phone = ? WHERE id = ?')
      .run(token, code, expiresAt, machineId || null, name || null, phone || null, existingEmail.id);
  } else {
    db.prepare(`
      INSERT INTO registrations (list_id, email, name, phone, verify_token, verify_code, code_expires_at, machine_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(list.id, emailAddr.toLowerCase(), name || null, phone || null, token, code, expiresAt, machineId || null);
  }

  try {
    await email.sendVerificationEmail({
      to: emailAddr,
      name,
      listName: list.name,
      code,
      verifyToken: token,
      listSlug: list.slug,
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

  // Check of code niet verlopen is
  if (reg.code_expires_at) {
    const now = new Date();
    const expiresAt = new Date(reg.code_expires_at);
    if (now > expiresAt) {
      return res.status(403).json({ error: 'Verificatiecode is verlopen. Vraag een nieuwe aan.' });
    }
  }

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
    scoreRules:     list.score_rules ? JSON.parse(list.score_rules) : null,
  });
});

// GET /api/vote/:slug/verify/:token
router.get('/:slug/verify/:token', (req, res) => {
  const db = getDb();
  const reg = db.prepare(
    'SELECT * FROM registrations WHERE verify_token = ?'
  ).get(req.params.token);

  if (!reg) return res.status(404).json({ error: 'Ongeldige of verlopen link' });

  // Check of code niet verlopen is
  if (reg.code_expires_at) {
    const now = new Date();
    const expiresAt = new Date(reg.code_expires_at);
    if (now > expiresAt) {
      return res.status(403).json({ error: 'Verificatiecode is verlopen. Vraag een nieuwe aan.' });
    }
  }

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
    scoreRules: list.score_rules ? JSON.parse(list.score_rules) : null,
  });
});

// POST /api/vote/:slug/submit
router.post('/:slug/submit', async (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list)  return res.status(404).json({ error: 'Lijst niet gevonden' });
  if (list.status !== 'open') return res.status(403).json({ error: 'Stemmen is gesloten' });
  if (list.voting_paused) return res.status(403).json({ error: list.voting_paused_message || 'Stemmen is tijdelijk gepauzeerd', paused: true });

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

  // Voorkom dubbele tracks in dezelfde inzending
  const uniqueIds = new Set(votes.map(v => v.external_id));
  if (uniqueIds.size !== votes.length) {
    return res.status(400).json({ error: 'Je kunt niet twee keer dezelfde track kiezen' });
  }

  const perArtistCap = Math.max(0, Number(list.max_tracks_per_artist) || 0);
  if (perArtistCap > 0) {
    const artistCounter = new Map();
    for (const v of votes) {
      const artistKey = String(v.artist || '').trim().toLowerCase();
      const count = (artistCounter.get(artistKey) || 0) + 1;
      artistCounter.set(artistKey, count);
      if (count > perArtistCap) {
        return res.status(400).json({
          error: `Je mag maximaal ${perArtistCap} nummer(s) van dezelfde artiest kiezen`,
        });
      }
    }
  }

  const reg = db.prepare(
    'SELECT * FROM registrations WHERE verify_token = ? AND list_id = ? AND verified = 1'
  ).get(token, list.id);

  if (!reg) return res.status(403).json({ error: 'Ongeldige token of niet geverifieerd' });

  // Controleer of er al stemmen zijn
  const existingVote = db.prepare(
    'SELECT id FROM votes WHERE registration_id = ?'
  ).get(reg.id);
  if (existingVote && !isWhitelisted(reg.machine_id) && !isTestEmail(reg.email)) return res.status(409).json({ error: 'Je hebt al gestemd' });

  const findByArtistTitle = db.prepare(`
    SELECT id, title, artist, moderation_status, submitted_only FROM list_tracks
     WHERE list_id = ?
       AND LOWER(artist) = LOWER(?)
       AND LOWER(title)  = LOWER(?)
     LIMIT 1
  `);
  const findByExternal = db.prepare(
    'SELECT id, title, artist, moderation_status, submitted_only FROM list_tracks WHERE list_id = ? AND source = ? AND external_id = ?'
  );
  const insertTrack = db.prepare(`
    INSERT INTO list_tracks (
      list_id, source, external_id, title, artist, album, cover_url, year,
      moderation_status, submitted_only
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)
  `);
  const reopenSubmittedTrack = db.prepare(
    "UPDATE list_tracks SET moderation_status = 'pending' WHERE id = ? AND submitted_only = 1 AND moderation_status = 'rejected'"
  );
  const insertVote = db.prepare(
    'INSERT INTO votes (registration_id, list_id, track_id, position) VALUES (?, ?, ?, ?)'
  );
  const deleteVotes = db.prepare('DELETE FROM votes WHERE registration_id = ?');

  // Alles in één atomaire transactie: delete oude stemmen (whitelist), upsert tracks, insert nieuwe stemmen
  let resolvedTracks;
  try {
    resolvedTracks = db.transaction(() => {
    if (existingVote) deleteVotes.run(reg.id);
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
      } else if (row.submitted_only && row.moderation_status === 'rejected') {
        reopenSubmittedTrack.run(row.id);
      }
      result.push({ ...row, position: Number(v.position) });
    }
    for (const t of result) {
      insertVote.run(reg.id, list.id, t.id, t.position);
    }
    return result;
    })();
  } catch (err) {
    console.error('Stem opslaan mislukt:', err.message);
    return res.status(500).json({ error: 'Je stem kon niet worden opgeslagen. Probeer het opnieuw.' });
  }

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

  logAction({ actor: 'public', action: 'vote.cast', list_id: list.id,
    target: reg.email, detail: { name: reg.name, trackCount: resolvedTracks.length } });

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
