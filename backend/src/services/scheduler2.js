/**
 * Automatische publicatie-scheduler.
 * Laadt per lijst de `auto_publish_cron` instelling en publiceert de hitlijst op het ingestelde moment.
 */

const cron      = require('node-cron');
const { getDb } = require('../db/database');

function currentISOWeek() {
  const now  = new Date();
  const d    = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  };
}

function aggregateScores(voteRows, maxVotes, scoreRulesJson) {
  let rules;
  try { rules = scoreRulesJson ? JSON.parse(scoreRulesJson) : null; } catch { rules = null; }
  if (!Array.isArray(rules) || rules.length === 0) {
    rules = Array.from({ length: maxVotes }, (_, i) => Math.max(1, maxVotes - i));
  }
  const map = new Map();
  for (const { track_id, position } of voteRows) {
    const pts = rules[position - 1] ?? 0;
    const cur = map.get(track_id) || { score: 0, vote_count: 0 };
    map.set(track_id, { score: cur.score + pts, vote_count: cur.vote_count + 1 });
  }
  return map;
}

function publishChart(listId) {
  try {
    const db   = getDb();
    const list = db.prepare('SELECT id, max_votes, score_rules FROM lists WHERE id = ?').get(listId);
    if (!list) return;

    const { week, year } = currentISOWeek();

    const voteRows = db.prepare(`
      SELECT v.track_id, v.position
      FROM votes v
      JOIN registrations r ON r.id = v.registration_id
      WHERE v.list_id = ? AND r.approved = 1
        AND (v.approved IS NULL OR v.approved = 1)
    `).all(listId);

    if (voteRows.length === 0) {
      console.log(`[scheduler] Lijst ${listId}: geen stemmen, publicatie overgeslagen`);
      return;
    }

    const adjustMap = new Map(
      db.prepare('SELECT id, score_adjustment FROM list_tracks WHERE list_id = ?').all(listId)
        .map(a => [a.id, a.score_adjustment || 0])
    );

    const scoreMap = aggregateScores(voteRows, list.max_votes, list.score_rules);

    const results = [...scoreMap.entries()].map(([track_id, s]) => ({
      track_id,
      score:      s.score + (adjustMap.get(track_id) || 0),
      vote_count: s.vote_count,
    })).sort((a, b) => b.score - a.score || b.vote_count - a.vote_count).slice(0, 100);

    const upsert = db.prepare(`
      INSERT INTO chart_history (list_id, track_id, week, year, position, score, vote_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_id, year, week, track_id) DO UPDATE SET
        position    = excluded.position,
        score       = excluded.score,
        vote_count  = excluded.vote_count,
        recorded_at = datetime('now')
    `);

    const currentIds = results.map(r => r.track_id);
    if (currentIds.length > 0) {
      db.prepare(
        `DELETE FROM chart_history WHERE list_id = ? AND week = ? AND year = ? AND track_id NOT IN (${currentIds.map(() => '?').join(',')})`
      ).run(listId, week, year, ...currentIds);
    }

    db.transaction(() => {
      results.forEach((row, i) => upsert.run(listId, row.track_id, week, year, i + 1, row.score, row.vote_count));
    })();

    console.log(`[scheduler] Lijst ${listId} gepubliceerd: week ${week}/${year}, ${results.length} tracks`);
  } catch (e) {
    console.error(`[scheduler] Publicatie lijst ${listId} mislukt:`, e.message);
  }
}

// Actieve cron-taken per lijst-id
const tasks = new Map();

/** Herlaad cron-schema's uit de database. Aanroepen na instelling wijzigen. */
function reloadSchedules() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  try {
    const rows = getDb().prepare(
      "SELECT id, name, auto_publish_cron FROM lists WHERE auto_publish_cron IS NOT NULL AND auto_publish_cron != ''"
    ).all();

    for (const row of rows) {
      if (!cron.validate(row.auto_publish_cron)) {
        console.warn(`[scheduler] Ongeldige cron voor lijst ${row.id}: ${row.auto_publish_cron}`);
        continue;
      }
      const task = cron.schedule(row.auto_publish_cron, () => publishChart(row.id), { timezone: 'Europe/Amsterdam' });
      tasks.set(row.id, task);
      console.log(`[scheduler] "${row.name}" ingepland: ${row.auto_publish_cron}`);
    }
  } catch (e) {
    console.error('[scheduler] Laden mislukt:', e.message);
  }
}

reloadSchedules();

module.exports = { reloadSchedules };
