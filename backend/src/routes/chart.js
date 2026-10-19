/**
 * Publieke hitlijst route.
 *
 * GET /api/chart/:slug  — geeft de meest recente gepubliceerde hitlijst terug
 *                         inclusief positie, trend, weken in de lijst en vorige positie.
 *
 * Respons:
 *   {
 *     list:      { id, name, slug, description },
 *     chart:     [ { position, track_id, title, artist, album, cover_url, release_year,
 *                    score, vote_count, week, year,
 *                    last_week_position, weeks_in_chart, trend, diff } ],
 *     week:      <ISO week>,
 *     year:      <jaar>,
 *     published: <boolean: true als chart.length >= 25>
 *   }
 */

const express  = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

// GET /api/chart/:slug
router.get('/:slug', (req, res) => {
  const db   = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'Lijst niet gevonden' });

  // Meest recente gepubliceerde week
  const latest = db.prepare(`
    SELECT year, week FROM chart_history
    WHERE list_id = ?
    ORDER BY year DESC, week DESC
    LIMIT 1
  `).get(list.id);

  if (!latest) {
    return res.json({
      list: pick(list),
      chart: [],
      week: null,
      year: null,
      published: false,
    });
  }

  // Op één na meest recente gepubliceerde week (voor trend-berekening)
  const prev = db.prepare(`
    SELECT year, week FROM chart_history
    WHERE list_id = ?
      AND (year < ? OR (year = ? AND week < ?))
    ORDER BY year DESC, week DESC
    LIMIT 1
  `).get(list.id, latest.year, latest.year, latest.week);

  // Haal huidige chart op; weken-in-lijst via pre-aggregatie (één GROUP BY i.p.v. correlated subquery per rij)
  const rows = db.prepare(`
    WITH prev_week AS (
      SELECT track_id, position
      FROM chart_history
      WHERE list_id = ? AND year = ? AND week = ?
    ),
    weeks_per_track AS (
      SELECT track_id, COUNT(DISTINCT year * 100 + week) AS cnt
      FROM chart_history
      WHERE list_id = ?
      GROUP BY track_id
    )
    SELECT
      ch.position,
      ch.score,
      ch.vote_count,
      ch.week,
      ch.year,
      lt.id         AS track_id,
      lt.title,
      lt.artist,
      lt.album,
      lt.cover_url,
      lt.year       AS release_year,
      pw.position   AS last_week_position,
      COALESCE(wpt.cnt, 1) AS weeks_in_chart
    FROM chart_history ch
    JOIN list_tracks lt ON lt.id = ch.track_id
    LEFT JOIN prev_week pw ON pw.track_id = ch.track_id
    LEFT JOIN weeks_per_track wpt ON wpt.track_id = ch.track_id
    WHERE ch.list_id = ? AND ch.year = ? AND ch.week = ?
      AND lt.moderation_status = 'approved'
    ORDER BY ch.position
  `).all(
    list.id, prev?.year ?? -1, prev?.week ?? -1,  // prev_week CTE
    list.id,                                        // weeks_per_track CTE
    list.id, latest.year, latest.week              // hoofd-query filter
  );

  // Bereken trend per track
  const chart = rows.map(row => {
    let trend, diff;
    if (!row.last_week_position) {
      trend = 'new';
      diff  = 0;
    } else if (row.position < row.last_week_position) {
      trend = 'up';
      diff  = row.last_week_position - row.position;
    } else if (row.position > row.last_week_position) {
      trend = 'down';
      diff  = row.position - row.last_week_position;
    } else {
      trend = 'same';
      diff  = 0;
    }
    return { ...row, trend, diff };
  });

  res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
  res.json({
    list: pick(list),
    chart,
    week:      latest.week,
    year:      latest.year,
    published: chart.length >= 25,
  });
});

function pick(list) {
  return { id: list.id, name: list.name, slug: list.slug, description: list.description };
}

module.exports = router;
