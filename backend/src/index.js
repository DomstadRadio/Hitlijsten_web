require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const listsRouter  = require('./routes/lists');
const searchRouter = require('./routes/search');
const voteRouter   = require('./routes/vote');
const adminRouter  = require('./routes/admin');
const chartRouter  = require('./routes/chart');
const formsRouter  = require('./routes/forms');
const { router: authRouter } = require('./routes/auth');

// DB initialiseren bij startup
require('./db/database').getDb();

// Automatische publicatie-scheduler starten
require('./services/scheduler');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Statische uploads (achtergrondafbeeldingen)
const uploadPath = path.resolve(
  __dirname, '../',
  process.env.UPLOAD_PATH || './uploads'
);
app.use('/uploads', express.static(uploadPath));

// Routes
app.use('/api/lists',  listsRouter);
app.use('/api/search', searchRouter);
app.use('/api/vote',   voteRouter);
app.use('/api/admin',  adminRouter);
app.use('/api/auth',   authRouter);
app.use('/api/chart',  chartRouter);
app.use('/api/forms',  formsRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Domeingebaseerde redirect ─────────────────────────────────────────────
// Als iemand via een eigen domein langskomt (bijv. utrechtsetop100.nl),
// zoek dan de bijbehorende lijst op en stuur door naar /stem/:slug
const { getDb } = require('./db/database');

app.use((req, res, next) => {
  // Alleen rootpaden doorsturen; API + uploads + assets overslaan
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/stem') || req.path.startsWith('/admin') || req.path.startsWith('/formulier') || req.path.startsWith('/static')) {
    return next();
  }
  // Haal hostnaam op zonder poort en zonder www
  const host = (req.hostname || '').toLowerCase().replace(/^www\./, '');
  // Bekende beheer-hostnamen overslaan
  const ownHosts = (process.env.OWN_HOSTS || '').split(',').map(h => h.trim().toLowerCase());
  if (!host || ownHosts.includes(host) || host === 'localhost') return next();

  try {
    const list = getDb()
      .prepare("SELECT slug FROM lists WHERE LOWER(TRIM(domain)) = ? AND status != 'draft'")
      .get(host);
    if (list) return res.redirect(302, `/stem/${list.slug}`);
  } catch (_) { /* DB nog niet klaar */ }
  next();
});

// ─── React frontend (productie) ──────────────────────────────────────────────
// Serveer de gebouwde React app als statische bestanden
const frontendBuild = path.join(__dirname, '../../frontend/build');
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
  // SPA fallback: alle onbekende paden gaan naar index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendBuild, 'index.html'));
    }
  });
}

// Globale foutafhandeling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Interne serverfout' });
});

app.listen(PORT, () => {
  console.log(`Hitlijsten API draait op poort ${PORT}`);
});
