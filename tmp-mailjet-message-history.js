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

  const list = await get('/v3/REST/message?Limit=1&Sort=ArrivedAt+DESC', auth);
  console.log('LIST_STATUS=' + list.status);
  if (list.status !== 200) {
    console.log('LIST_BODY=' + JSON.stringify(list.body).slice(0, 600));
    return;
  }

  const rows = Array.isArray(list.body.Data) ? list.body.Data : [];
  if (!rows[0]) {
    console.log('NO_MESSAGE_ROWS');
    return;
  }

  const id = rows[0].ID;
  console.log('LATEST_ID=' + id);
  console.log('LATEST_ARRIVED=' + (rows[0].ArrivedAt || 'n/a'));

  const endpoints = [
    `/v3/REST/message/${id}`,
    `/v3/REST/message/${id}/history`,
    `/v3/REST/messagehistory/${id}`,
    `/v3/REST/message/${id}/statistics`,
    `/v3/REST/message/${id}/details`,
  ];

  for (const ep of endpoints) {
    const r = await get(ep, auth);
    console.log('EP=' + ep);
    console.log('STATUS=' + r.status);
    if (r.status === 200) {
      const rows2 = Array.isArray(r.body.Data) ? r.body.Data : [];
      console.log('COUNT=' + rows2.length);
      if (rows2[0]) {
        const sample = {};
        for (const k of Object.keys(rows2[0]).slice(0, 16)) sample[k] = rows2[0][k];
        console.log('SAMPLE=' + JSON.stringify(sample));
      }
    } else {
      console.log('BODY=' + JSON.stringify(r.body).slice(0, 700));
    }
  }
})();
