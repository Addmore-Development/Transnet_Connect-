#!/usr/bin/env node
// Creates (or updates) the Transnet Connect logins in Supabase Auth:
//   - one ADMIN account that sees every division's cases + the inbox, and
//   - one account per operating division that only sees cases directed to it.
//
// Run from the project root (needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env):
//   node scripts/create-division-users.js
//   node scripts/create-division-users.js --domain=yourcompany.co.za
//   node scripts/create-division-users.js --reset-passwords     (new passwords for accounts that already exist)
//
// Passwords are random and are printed ONCE at the end — copy them into a
// password manager and hand them to each division securely. They are never
// written to a file.

const crypto = require('crypto');
const { loadEnv } = require('./_env');
loadEnv();
const { DIVISIONS } = require('../api/_divisions');

const args = process.argv.slice(2);
const domain = (args.find((a) => a.startsWith('--domain=')) || '--domain=transnet.net').split('=')[1];
const resetPasswords = args.includes('--reset-passwords');

const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY (check your .env file).');
  process.exit(1);
}

const localPart = (code) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

const ACCOUNTS = [
  { email: `admin@${domain}`, role: 'admin', division: null, name: 'Transnet Connect Admin', access: 'All divisions + inbox' },
  ...DIVISIONS.map((d) => ({
    email: `${localPart(d.code)}@${domain}`,
    role: 'division',
    division: d.code,
    name: d.label,
    access: `${d.label} cases only`,
  })),
];

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('');
}

async function adminCall(path, options = {}) {
  const res = await fetch(`${base}/auth/v1/admin${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
  return { res, body };
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { res, body } = await adminCall(`/users?page=${page}&per_page=200`);
    if (!res.ok) throw new Error(`List users failed (${res.status}): ${JSON.stringify(body)}`);
    const users = body.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

(async () => {
  const results = [];
  for (const acct of ACCOUNTS) {
    const app_metadata = { role: acct.role, division: acct.division };
    const password = randomPassword();

    const created = await adminCall('/users', {
      method: 'POST',
      body: JSON.stringify({ email: acct.email, password, email_confirm: true, app_metadata, user_metadata: { display_name: acct.name } }),
    });

    if (created.res.ok) {
      results.push({ ...acct, status: 'created', password });
      continue;
    }

    const already = created.res.status === 422 && /already|exists|registered/i.test(JSON.stringify(created.body));
    if (!already) {
      console.error(`\nFailed to create ${acct.email}: ${created.res.status} ${JSON.stringify(created.body)}`);
      process.exit(1);
    }

    const existing = await findUserByEmail(acct.email);
    if (!existing) {
      console.error(`\n${acct.email} already exists but could not be found to update.`);
      process.exit(1);
    }
    const patch = { app_metadata };
    if (resetPasswords) patch.password = password;
    const updated = await adminCall(`/users/${existing.id}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (!updated.res.ok) {
      console.error(`\nFailed to update ${acct.email}: ${updated.res.status} ${JSON.stringify(updated.body)}`);
      process.exit(1);
    }
    results.push({ ...acct, status: resetPasswords ? 'updated + new password' : 'updated (password unchanged)', password: resetPasswords ? password : null });
  }

  console.log('\nTransnet Connect logins\n');
  const w = (s, n) => String(s).padEnd(n);
  console.log(w('LOGIN', 28), w('PASSWORD', 20), w('STATUS', 30), 'ACCESS');
  console.log('-'.repeat(120));
  for (const r of results) {
    console.log(w(r.email, 28), w(r.password || '(unchanged)', 20), w(r.status, 30), r.access);
  }
  console.log('\nSave these passwords now — they are not stored anywhere and cannot be shown again.');
  console.log('(To issue new ones later: node scripts/create-division-users.js --reset-passwords)');
})().catch((err) => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
