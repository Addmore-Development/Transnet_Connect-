// POST /api/webhooks/email — inbound email (Resend) -> raw_emails.
// Reserves a case reference number for each real sender and emails them an
// acknowledgement quoting it.
//
// Setup (Resend dashboard):
//   Emails > Receiving      -> enabled, MX record added for your domain
//   Webhooks                -> https://<your-app>.vercel.app/api/webhooks/email, event: email.received
//
// Env vars (.env locally, Vercel > Project Settings > Environment Variables):
//   RESEND_API_KEY         must be a Full access key (needed to read received emails)
//   RESEND_WEBHOOK_SECRET  whsec_... (Webhooks > your webhook > Signing secret)
//   RESEND_FROM            e.g. Transnet Connect <updates@wizeempire.com>

const crypto = require('crypto');
const { sbInsert } = require('../_supabaseClient');
const { htmlToText } = require('../_htmlToText');
const { newCaseRef } = require('../_caseRef');
const { sendEmail, parseAddress, isAutomatedSender, friendlyName, acknowledgementEmail } = require('../_email');

// We need the exact raw request body to verify Resend's signature, so Vercel's
// automatic JSON parsing is switched off for this route.
// (the config export is at the bottom of this file)

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    // If something upstream already consumed/parsed the body, fall back to it.
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
      if (typeof req.body === 'string') return resolve(req.body);
      return resolve(JSON.stringify(req.body));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Verifies a Resend (Svix) webhook signature.
 * Returns true if valid. Rejects timestamps more than 5 minutes old (replay protection).
 */
function verifyResendSignature(rawBody, headers, secret) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatureHeader = headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  // Header looks like: "v1,<sig> v1,<sig2>" (multiple during secret rotation)
  return signatureHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

async function fetchReceivedEmail(emailId) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Resend fetch received email failed (${res.status})`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

async function handler(req, res) {
  // Webhooks only ever POST. Reject anything else early.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  // Only Resend may call this endpoint.
  if (!verifyResendSignature(rawBody, req.headers, process.env.RESEND_WEBHOOK_SECRET)) {
    console.warn('[webhooks/email] rejected request: invalid or missing signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  console.log('[webhooks/email] received event:', event.type, event.data && event.data.email_id);

  if (event.type !== 'email.received') {
    console.log(`[webhooks/email] ignoring event type: ${event.type}`);
    return res.status(200).json({ ok: true, skipped: event.type });
  }

  const data = event.data || {};

  try {
    // The webhook only carries metadata — fetch the body from Resend.
    let full = null;
    if (data.email_id) {
      try {
        full = await fetchReceivedEmail(data.email_id);
      } catch (fetchErr) {
        console.error('[webhooks/email] failed to fetch full email body:', fetchErr.message, fetchErr.body || '');
      }
    }

    const fromRaw = (full && full.from) || data.from || null; // "Name <a@b.com>" or bare address
    const sender = parseAddress(fromRaw);
    const subject = data.subject || (full && full.subject) || null;

    // Real people get a reference + acknowledgement; no-reply/bounce/own-address
    // senders don't (replying to them would risk an endless mail loop).
    let reference = null;
    if (sender && !isAutomatedSender(sender)) {
      try {
        reference = await newCaseRef();
      } catch (refErr) {
        console.error('[webhooks/email] could not reserve a reference number:', refErr.message, refErr.body || '');
      }
    }

    const bodyHtml = (full && full.html) || null;
    const bodyText = (full && full.text) || htmlToText(bodyHtml) || null;

    const row = {
      source: 'resend',
      from_address: fromRaw,
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      reference,
      payload: { event, email: full }, // both raw shapes kept, safety net
    };

    await sbInsert('raw_emails', row);

    if (reference) {
      try {
        await sendEmail({ to: sender, ...acknowledgementEmail({ name: friendlyName(fromRaw), reference, divisionLabel: null }) });
      } catch (mailErr) {
        console.error('[webhooks/email] acknowledgement email failed:', mailErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhooks/email] failed to store payload:', err.status, err.body || err.message);
    return res.status(500).json({ error: 'Failed to store email payload' });
  }
}

module.exports = Object.assign(handler, { config: { api: { bodyParser: false } } });