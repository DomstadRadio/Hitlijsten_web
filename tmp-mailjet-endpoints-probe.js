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
  const db = getDb();
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value || '']));
  const auth = `${s.SMTP_USER}:${s.SMTP_PASS}`;

  const endpoints = [
    '/v3/REST/apikey',
    '/v3/REST/message?Limit=3&Sort=ArrivedAt+DESC',
    '/v3/REST/messagehistory?Limit=3&Sort=ArrivedAt+DESC',
    '/v3/REST/messageevent?Limit=3&Sort=ArrivedAt+DESC',
    '/v3/REST/statcounters?Limit=3',
    '/v3/REST/sender?Limit=3',
  ];

  for (const ep of endpoints) {
    const r = await get(ep, auth);
    console.log('EP=' + ep);
    console.log('STATUS=' + r.status);
    if (r.status === 200) {
      const rows = Array.isArray(r.body.Data) ? r.body.Data : [];
      console.log('COUNT=' + rows.length);
      if (rows[0]) {
        const first = rows[0];
        const sample = {};
        for (const k of Object.keys(first).slice(0, 8)) sample[k] = first[k];
        console.log('SAMPLE=' + JSON.stringify(sample));
      }
    } else {
      console.log('BODY=' + JSON.stringify(r.body).slice(0, 700));
    }
  }
})();
