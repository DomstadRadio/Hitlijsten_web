const https = require('https');
const { getDb } = require('/opt/hitlijsten/backend/src/db/database');

function requestJson({ method, path, auth, body }) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.mailjet.com',
      path,
      method,
      auth,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
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
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const db = getDb();
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value || '']));
  const auth = `${s.SMTP_USER}:${s.SMTP_PASS}`;

  const nonce = Date.now();
  const send = await requestJson({
    method: 'POST',
    path: '/v3.1/send',
    auth,
    body: {
      Messages: [
        {
          From: { Email: 'algemeen@domstadradio.nl', Name: 'Domstad Radio' },
          To: [{ Email: 'sales@onairlight.nl', Name: 'Sales' }],
          Subject: `Mailjet API Proof ${nonce}`,
          HTMLPart: `<p>Mailjet API proof ${nonce}</p>`,
        },
      ],
    },
  });

  console.log('SEND_STATUS=' + send.status);
  console.log('SEND_BODY=' + JSON.stringify(send.body).slice(0, 1200));

  const msg = (((send.body || {}).Messages || [])[0] || {});
  const msgId = msg.To && msg.To[0] ? (msg.To[0].MessageID || msg.To[0].MessageUUID || null) : null;
  if (!msgId) return;

  const hist = await requestJson({
    method: 'GET',
    path: `/v3/REST/messagehistory/${msgId}`,
    auth,
  });
  console.log('HIST_STATUS=' + hist.status);
  console.log('HIST_BODY=' + JSON.stringify(hist.body).slice(0, 1200));
})();
