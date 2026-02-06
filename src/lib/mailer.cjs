'use strict';

/**
 * Minimal mailer for Tempasi.
 *
 * - If SMTP_URL is present and "nodemailer" is installed -> sends email
 * - Otherwise logs the email to console (MVP fallback)
 *
 * Env:
 *   SMTP_URL="smtp://user:pass@host:587"
 *   MAIL_FROM="Tempasi <no-reply@tempasi.test>"
 */

function getFrom() {
  return String(process.env.MAIL_FROM || 'Tempasi <no-reply@tempasi.test>');
}

function hasSmtp() {
  return Boolean(String(process.env.SMTP_URL || '').trim());
}

async function sendViaNodemailer({ to, subject, text }) {
  // Lazy require so project doesn't hard-depend on nodemailer in MVP
  // eslint-disable-next-line global-require
  const nodemailer = require('nodemailer');

  const transporter = nodemailer.createTransport(String(process.env.SMTP_URL));
  await transporter.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
  });
}

async function sendToConsole({ to, subject, text }) {
  // eslint-disable-next-line no-console
  console.log('[MAIL:FALLBACK]', { to, subject, text });
}

/**
 * sendMail({ to, subject, text })
 */
async function sendMail({ to, subject, text }) {
  const payload = {
    to: String(to || '').trim(),
    subject: String(subject || '').trim(),
    text: String(text || ''),
  };

  if (!payload.to) throw new Error('MAIL_BAD_REQUEST: "to" is required');
  if (!payload.subject) throw new Error('MAIL_BAD_REQUEST: "subject" is required');

  if (hasSmtp()) {
    try {
      await sendViaNodemailer(payload);
      return;
    } catch (err) {
      // SMTP configured but failed (or nodemailer missing) -> fallback to console
      await sendToConsole({
        ...payload,
        text: `${payload.text}\n\n[MAILER_NOTE] SMTP send failed, used console fallback: ${err?.message || err}`,
      });
      return;
    }
  }

  await sendToConsole(payload);
}

module.exports = { sendMail };
