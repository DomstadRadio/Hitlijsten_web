/**
 * Audit log helper.
 * Schrijft een actie-regel naar de audit_log tabel.
 * Fouten worden stil genegeerd zodat logging nooit een request breekt.
 */
const { getDb } = require('../db/database');

/**
 * @param {object} opts
 * @param {string}  opts.actor   - gebruikersnaam van de admin, of 'public' voor publieke acties
 * @param {string}  opts.action  - bijv. 'chart.publish', 'voter.delete', 'vote.cast'
 * @param {number}  [opts.list_id]
 * @param {string}  [opts.target]  - bijv. e-mailadres van stemmer, lijstnaam
 * @param {object}  [opts.detail]  - vrij JSON-object met extra context
 */
function logAction({ actor, action, list_id, target, detail } = {}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (actor, action, list_id, target, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      actor   || null,
      action,
      list_id || null,
      target  || null,
      detail  ? JSON.stringify(detail) : null
    );
  } catch (e) {
    console.warn('[audit] log fout:', e.message);
  }
}

module.exports = { logAction };
