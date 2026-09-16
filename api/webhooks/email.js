


const { sbInsert } = require('../_supabaseClient');

async function fetchMailSlurpEmail(emailId) {
  const res = await fetch(`https://api.mailslurp.com/emails/${emailId}`, {
    headers: { 'x-api-key': process.env.MAILSLURP_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`MailSlurp fetch email failed (${res.status})`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  // Webhooks only ever POST. Reject anything else early.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = req.body || {};
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  console.log('[webhooks/email] received event:', JSON.stringify(body));


  if (body.eventName && body.eventName !== 'NEW_EMAIL') {
    console.log(`[webhooks/email] ignoring event type: ${body.eventName}`);
    return res.status(200).json({ ok: true, skipped: body.eventName });
  }

  try {
    let full = null;
    if (body.emailId) {
      try {
        full = await fetchMailSlurpEmail(body.emailId);
      } catch (fetchErr) {
        console.error('[webhooks/email] failed to fetch full email body:', fetchErr);
      }
    }

    const row = {
      source: 'mailslurp',
      from_address: body.from || null,
      subject: body.subject || full?.subject || null,
      body_text: full?.body || null,
      body_html: full?.bodyHtml || null,
      payload: { event: body, email: full }, // both raw shapes kept, safety net
    };

    await sbInsert('raw_emails', row);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhooks/email] failed to store payload:', err);

    return res.status(500).json({ error: 'Failed to store email payload' });
  }
};