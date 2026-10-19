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
        let body;
        try { body = JSON.parse(data || '{}'); } catch { body = { raw: data }; }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    req.end();
  });
}

(async () => {
  const uuid = process.argv[2];
  if (!uuid) {
    console.log('USAGE: node script.js <uuid>');
    process.exit(1);
  }
  const db = getDb();
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value || '']));
  const auth = `${s.SMTP_USER}:${s.SMTP_PASS}`;

  const endpoints = [
    `/v3/REST/message?MessageUUID=${uuid}`,
    `/v3/REST/message?Limit=50&Sort=ArrivedAt+DESC&MessageUUID=${uuid}`,
    `/v3/REST/messagehistory?MessageUUID=${uuid}`,
  ];

  for (const ep of endpoints) {
    const r = await get(ep, auth);
    console.log('EP=' + ep);
    console.log('STATUS=' + r.status);
    console.log('BODY=' + JSON.stringify(r.body).slice(0, 1500));
  }
})();
