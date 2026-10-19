const https = require('https');
const { getDb } = require('/opt/hitlijsten/backend/src/db/database');

function get(path, auth) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.mailjet.com',
      path,
      method: 'GET',
      auth,
      headers: { Accept: 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data || '{}'); } catch { parsed = { raw: data }; }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    req.end();
  });
}

(async () => {
  const id = process.argv[2];
  if (!id) {
    console.log('USAGE: node script.js <messageId>');
    process.exit(1);
  }
  const db = getDb();
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value || '']));
  const auth = `${s.SMTP_USER}:${s.SMTP_PASS}`;

  const r1 = await get(`/v3/REST/message/${id}`, auth);
  console.log('MESSAGE_STATUS=' + r1.status);
  console.log('MESSAGE_BODY=' + JSON.stringify(r1.body).slice(0, 1200));

  const r2 = await get(`/v3/REST/messagehistory/${id}`, auth);
  console.log('HISTORY_STATUS=' + r2.status);
  console.log('HISTORY_BODY=' + JSON.stringify(r2.body).slice(0, 1200));
})();
