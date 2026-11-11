// /api/webhooks/twilio.js
// Receives inbound SMS + WhatsApp messages from Twilio and stores them in
// the raw_messages table, where /api/inbox picks them up alongside emails
// and web-form submissions.
//
// Required env vars (.env locally, Vercel Project Settings > Environment
// Variables for deployment):
//   TWILIO_AUTH_TOKEN  = the Auth Token from the Twilio Console home page
//
// Optional (local debugging only, never set in production):
//   TWILIO_SKIP_VALIDATION=true

const crypto = require('crypto');
const { sbInsert } = require('../_supabaseClient');

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function sendTwiml(res, status = 200) {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(status).send(EMPTY_TWIML);
}

// Twilio sends application/x-www-form-urlencoded. Vercel normally parses
// that into an object, but fall back to parsing manually just in case.
function getParams(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  return Object.fromEntries(new URLSearchParams(raw));
}

// Verifies the X-Twilio-Signature header so only real Twilio requests are
// accepted (otherwise anyone who finds the URL could inject fake messages).
// Algorithm: HMAC-SHA1(authToken, fullUrl + each param name+value sorted by name), base64.
function isValidTwilioRequest(req, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  if (!token || !signature) return false;

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const url = `${proto}://${host}${req.url}`;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const v = params[key];
      return acc + key + (Array.isArray(v) ? v.join('') : v);
    }, url);

  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const params = getParams(req);

  if (process.env.TWILIO_SKIP_VALIDATION !== 'true' && !isValidTwilioRequest(req, params)) {
    console.warn('[webhooks/twilio] rejected request: invalid or missing signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const from = params.From || '';
  const isWhatsApp = from.startsWith('whatsapp:');
  const numMedia = parseInt(params.NumMedia || '0', 10) || 0;

  const row = {
    source: 'twilio',
    channel: isWhatsApp ? 'WhatsApp' : 'SMS',
    message_sid: params.MessageSid || params.SmsSid || null,
    from_number: from.replace(/^whatsapp:/, '') || null,
    to_number: (params.To || '').replace(/^whatsapp:/, '') || null,
    profile_name: params.ProfileName || null, // WhatsApp display name (SMS has none)
    body_text: params.Body || null,
    num_media: numMedia,
    payload: params, // full raw Twilio payload kept as a safety net (includes MediaUrl0..n)
  };

  try {
    await sbInsert('raw_messages', [row]);
  } catch (err) {
    // Twilio can deliver the same message twice; the unique index on
    // message_sid turns that into a 409 — treat it as success.
    if (err.status === 409) {
      console.log('[webhooks/twilio] duplicate delivery ignored:', row.message_sid);
      return sendTwiml(res);
    }
    console.error('[webhooks/twilio] failed to store message:', err.status, err.body || err.message);
    return sendTwiml(res, 500);
  }

  // Empty <Response/> = store only, no auto-reply sent back to the sender.
  return sendTwiml(res);
};