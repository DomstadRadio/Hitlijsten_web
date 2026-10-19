/**
 * E-mail service.
 * EMAIL_PROVIDER bepaalt welke dienst gebruikt wordt: 'resend', 'sendgrid' of 'smtp'.
 * Standaard: 'smtp'.
 */

const nodemailer = require('nodemailer');

const FROM = () => process.env.SMTP_FROM || 'Domstad Radio <noreply@domstadradio.nl>';

async function sendMail({ to, subject, html }) {
  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();

  if (provider === 'resend') {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from:    FROM(),
      to,
      subject,
      html,
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return;
  }

  // nodemailer transport (sendgrid of smtp)
  let transport;
  if (provider === 'sendgrid') {
    transport = nodemailer.createTransport({
      host: 'smtp.sendgrid.net', port: 587, secure: false,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    });
  } else {
    transport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const info = await transport.sendMail({ from: FROM(), to, subject, html });

  const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
  const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
  const pending = Array.isArray(info?.pending) ? info.pending : [];

  // Nodemailer kan succesvol resolven terwijl recipients niet zijn geaccepteerd.
  // Door hier hard te falen wordt dit zichtbaar in API-responses en PM2 logs.
  if (accepted.length === 0 || rejected.length > 0 || pending.length > 0) {
    throw new Error(
      `Mail transport issue: accepted=${accepted.length} rejected=${rejected.length} pending=${pending.length} response=${info?.response || 'n/a'}`
    );
  }

  console.log(
    `[mail] provider=${provider} to=${to} messageId=${info?.messageId || 'n/a'} response=${info?.response || 'n/a'}`
  );
}

async function sendVerificationEmail({ to, name, listName, code }) {
  await sendMail({
    to,
    subject: `Je verificatiecode voor ${listName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Hallo ${name || 'stemmer'}!</h2>
        <p>Je hebt je aangemeld om te stemmen voor <strong>${listName}</strong>.</p>
        <p>Voer de onderstaande code in op de stempagina:</p>
        <p style="text-align:center;margin:32px 0">
          <span style="display:inline-block;background:#f5f5f5;border:2px solid #e00;border-radius:12px;padding:18px 36px;font-size:42px;font-weight:bold;letter-spacing:10px;color:#111">
            ${code}
          </span>
        </p>
        <p>Stem op tijd, de link is beperkt geldig.</p>
        <p style="font-size:12px;color:#888">Als je je niet hebt aangemeld, kun je deze e-mail negeren.</p>
        <hr>
        <p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>
    `,
  });
}

async function sendVoteConfirmationEmail({ to, name, listName, tracks }) {
  const trackList = tracks
    .map((t, i) => `<li>${i + 1}. ${t.artist} – ${t.title}</li>`)
    .join('');
  await sendMail({
    to,
    subject: `Je stem voor ${listName} is ontvangen!`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Bedankt voor je stem, ${name || ''}!</h2>
        <p>Je hebt gestemd voor <strong>${listName}</strong>.</p>
        <p><strong>Jouw keuzes:</strong></p>
        <ol style="padding-left:20px">${trackList}</ol>
        <hr>
        <p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>
    `,
  });
}

async function sendVoteApprovedEmail({ to, name, listName }) {
  await sendMail({
    to,
    subject: `Je stemmen voor ${listName} zijn verwerkt`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Hallo ${name || ''}!</h2>
        <p>Je stemmen voor <strong>${listName}</strong> zijn verwerkt.</p>
        <hr>
        <p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>
    `,
  });
}

module.exports = { sendMail, sendVerificationEmail, sendVoteConfirmationEmail, sendVoteApprovedEmail,
                   sendFormVerificationEmail, sendFormResponseEmail, sendFormAdminNotificationEmail,
                   sendNoVoteReminderEmail };

async function sendFormVerificationEmail({ to, name, formName, code }) {
  await sendMail({
    to,
    subject: `Je verificatiecode voor ${formName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Hallo ${name || ''}!</h2>
        <p>Je hebt een formulier geopend: <strong>${formName}</strong>.</p>
        <p>Voer deze code in om je inzending te bevestigen:</p>
        <p style="text-align:center;margin:32px 0">
          <span style="display:inline-block;background:#f5f5f5;border:2px solid #e00;border-radius:12px;padding:18px 36px;font-size:42px;font-weight:bold;letter-spacing:10px;color:#111">${code}</span>
        </p>
        <p style="font-size:12px;color:#888">Niet door jou aangevraagd? Negeer deze e-mail.</p>
        <hr><p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>`,
  });
}

async function sendFormResponseEmail({ to, name, formName, summaryHtml }) {
  await sendMail({
    to,
    subject: `Bevestiging: ${formName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Bedankt voor je inzending, ${name || ''}!</h2>
        <p>We hebben je antwoorden ontvangen voor <strong>${formName}</strong>.</p>
        ${summaryHtml || ''}
        <hr><p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>`,
  });
}

async function sendFormAdminNotificationEmail({ to, formName, name, email, summaryHtml }) {
  await sendMail({
    to,
    subject: `Nieuwe inzending: ${formName}`,
    html: `
      <div style="font-family:sans-serif;max-width:640px;margin:auto">
        <h2>Nieuwe inzending op <em>${formName}</em></h2>
        <p><strong>Van:</strong> ${name || '(geen naam)'} ${email ? `&lt;${email}&gt;` : ''}</p>
        ${summaryHtml || ''}
        <hr><p style="font-size:11px;color:#aaa">Domstad Radio — automatische notificatie</p>
      </div>`,
  });
}

/**
 * Herinnerings-e-mail voor mensen die zich wel aangemeld hebben maar nog
 * niet gestemd hebben. De voteUrl is de publieke stempagina van de lijst.
 */
async function sendNoVoteReminderEmail({ to, name, listName, voteUrl, customSubject, customHtml }) {
  // Vul variabelen in bij custom template
  const fill = (str) => str
    .replace(/\{\{naam\}\}/gi,  name     || 'stemmer')
    .replace(/\{\{lijst\}\}/gi, listName || '')
    .replace(/\{\{url\}\}/gi,   voteUrl  || '#');

  const subject = customSubject
    ? fill(customSubject)
    : `Vergeet niet te stemmen voor ${listName}!`;

  const html = customHtml
    ? fill(customHtml)
    : `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2>Hoi ${name || 'stemmer'}!</h2>
        <p>Je hebt je aangemeld om te stemmen voor <strong>${listName}</strong>, maar we hebben je stem nog niet ontvangen.</p>
        <p>Er is nog tijd — klik op de knop hieronder en breng nu je stem uit:</p>
        <p style="text-align:center;margin:32px 0">
          <a href="${voteUrl}"
             style="display:inline-block;background:#e00;color:#fff;text-decoration:none;
                    padding:14px 32px;border-radius:8px;font-size:18px;font-weight:bold">
            Stem nu!
          </a>
        </p>
        <p style="font-size:12px;color:#888">Of kopieer deze link: <a href="${voteUrl}">${voteUrl}</a></p>
        <p style="font-size:12px;color:#888">
          Als je niet meer wilt stemmen, kun je deze e-mail gewoon negeren.
        </p>
        <hr>
        <p style="font-size:11px;color:#aaa">Domstad Radio — Utrecht</p>
      </div>
    `;

  await sendMail({ to, subject, html });
}
