/**
 * Auth routes: login, logout, gebruikersbeheer.
 * Alle /api/admin/* routes worden beveiligd via requireAuth middleware.
 *
 * Permissies worden opgeslagen als komma-gescheiden string in users.permissions.
 * '*' = alle rechten (superadmin).
 * Mogelijke permissies: lists, tracks, submissions, voters, chart, settings, users
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { logAction } = require('../utils/audit');

const router = express.Router();

const JWT_SECRET  = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES = '8h';

const ALL_PERMISSIONS = ['lists', 'tracks', 'submissions', 'voters', 'chart', 'forms', 'settings', 'users'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions: user.permissions },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/** Controleer of gebruiker een permissie heeft. '*' = alles. */
function hasPerm(user, perm) {
  if (!user) return false;
  const perms = (user.permissions || '').split(',').map(p => p.trim());
  return perms.includes('*') || perms.includes(perm);
}

/**
 * requireAuth middleware — valideert JWT in Authorization header of cookie.
 * Bij succes wordt req.user gevuld.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.token;

  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sessie verlopen, log opnieuw in' });
  }
}

/**
 * requirePerm(perm) middleware factory — vereist requireAuth + specifieke permissie.
 */
function requirePerm(perm) {
  return [requireAuth, (req, res, next) => {
    if (!hasPerm(req.user, perm)) {
      return res.status(403).json({ error: 'Geen toegang' });
    }
    next();
  }];
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
  }

  const user = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord' });
  }

  const token = signToken(user);
  logAction({ actor: user.username, action: 'login', detail: { ip: req.ip || req.headers['x-forwarded-for'] } });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions },
  });
});

/** GET /api/auth/me — haalt altijd verse data op uit DB zodat permissie-wijzigingen direct doorwerken */
router.get('/me', requireAuth, (req, res) => {
  const user = getDb().prepare('SELECT id, username, role, permissions FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Gebruiker niet gevonden' });
  res.json({ id: user.id, username: user.username, role: user.role, permissions: user.permissions });
});

/** GET /api/auth/permissions — lijst van alle beschikbare permissies */
router.get('/permissions', requireAuth, (_req, res) => {
  res.json(ALL_PERMISSIONS);
});

/** POST /api/auth/logout  (client gooit token weg; server doet niets) */
router.post('/logout', (_req, res) => res.json({ ok: true }));

// ── Gebruikersbeheer (alleen users-permissie) ─────────────────────────────────────────

/** GET /api/auth/users */
router.get('/users', requirePerm('users'), (req, res) => {
  const users = getDb()
    .prepare('SELECT id, username, role, permissions, created_at FROM users ORDER BY id')
    .all();
  res.json(users);
});

/** POST /api/auth/users — maak nieuwe gebruiker */
router.post('/users', requirePerm('users'), (req, res) => {
  const { username, password, role = 'admin', permissions = '' } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
  }
  // Alleen superadmin mag '*' uitdelen
  const cleanPerms = permissions === '*' && hasPerm(req.user, '*')
    ? '*'
    : (permissions || '').split(',').map(p => p.trim()).filter(p => ALL_PERMISSIONS.includes(p)).join(',');

  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = getDb()
      .prepare("INSERT INTO users (username, password_hash, role, permissions) VALUES (?, ?, ?, ?)")
      .run(username.trim().toLowerCase(), hash, role, cleanPerms);
    res.status(201).json({ id: info.lastInsertRowid, username, role, permissions: cleanPerms });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Gebruikersnaam bestaat al' });
    }
    throw err;
  }
});

/** PUT /api/auth/users/:id/password — wijzig wachtwoord */
router.put('/users/:id/password', requirePerm('users'), (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens zijn' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hash, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ ok: true });
});

/** PUT /api/auth/users/:id/permissions — wijzig permissies */
router.put('/users/:id/permissions', requirePerm('users'), (req, res) => {
  const { permissions } = req.body ?? {};
  // Voorkom dat iemand zichzelf superadmin maakt zonder dat al te zijn
  const cleanPerms = permissions === '*' && hasPerm(req.user, '*')
    ? '*'
    : (permissions || '').split(',').map(p => p.trim()).filter(p => ALL_PERMISSIONS.includes(p)).join(',');

  const info = getDb()
    .prepare('UPDATE users SET permissions = ? WHERE id = ?')
    .run(cleanPerms, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ ok: true, permissions: cleanPerms });
});

/** DELETE /api/auth/users/:id */
router.delete('/users/:id', requirePerm('users'), (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Je kunt je eigen account niet verwijderen' });
  }
  const info = getDb()
    .prepare('DELETE FROM users WHERE id = ?')
    .run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requirePerm, hasPerm };
