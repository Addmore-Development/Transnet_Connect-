#!/usr/bin/env node
// Sends one test email through Resend using the same env vars as the app.
//   node scripts/test-resend.js you@example.com
// Needs RESEND_API_KEY and RESEND_FROM in .env (or in your environment).

const { loadEnv } = require('./_env');
loadEnv();

const to = process.argv[2];
const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM;

if (!to) { console.error('Usage: node scripts/test-resend.js you@example.com'); process.exit(1); }
if (!apiKey) { console.error('RESEND_API_KEY is not set (add it to .env).'); process.exit(1); }
if (!from) { console.error('RESEND_FROM is not set (add it to .env, e.g. Transnet Connect <onboarding@resend.dev>).'); process.exit(1); }

(async () => {
  console.log(`Sending test email\n  from: ${from}\n  to:   ${to}\n`);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Transnet Connect — Resend test',
      html: '<p>If you can read this, Resend is connected correctly. ✅</p>',
    }),
  });
  const text = await res.text();
  console.log(`Resend responded ${res.status}: ${text}\n`);

  if (res.ok) {
    console.log('Success. Check the inbox (and spam) of the address above, and the Emails tab in the Resend dashboard.');
    return;
  }
  if (res.status === 401 || (res.status === 403 && /api key/i.test(text))) console.log('Hint: the API key looks invalid or was revoked — create a new one in Resend → API Keys.');
  else if (res.status === 403) console.log('Hint: Resend only lets you send FROM a verified domain. Until yours is verified, use RESEND_FROM=Transnet Connect <onboarding@resend.dev> and send only TO the email address you signed up to Resend with.');
  else if (res.status === 422) console.log('Hint: check the format of RESEND_FROM — it must be an address or "Name <address@domain>".');
  process.exit(1);
})().catch((err) => { console.error('Request failed:', err.message); process.exit(1); });
