// /api/_supabaseClient.js
// Thin wrapper around Supabase's auto-generated REST API (PostgREST), used
// instead of the @supabase/supabase-js package so this project stays
// dependency-free (no npm install / node_modules needed) — same philosophy
// as the plain-fetch approach used for the Gemini calls.
//
// Required env vars (set in .env locally, and in Vercel Project Settings >
// Environment Variables for deployment):
//   SUPABASE_URL         = https://yourproject.supabase.co
//   SUPABASE_SECRET_KEY  = sb_secret_... (or the legacy service_role JWT —
//                          both work; get either from Supabase Dashboard →
//                          Settings → API Keys)
//
// This key bypasses Row Level Security entirely, so it must ONLY ever be
// read from process.env on the server — never sent to the browser, never
// put in app.js.

function supabaseHeaders() {
  const key = process.env.SUPABASE_SECRET_KEY;
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function supabaseUrl(path) {
  const base = process.env.SUPABASE_URL || '';
  return `${base.replace(/\/$/, '')}/rest/v1${path}`;
}

/** GET rows from a table. `query` is a raw query string, e.g. 'order=created_at.desc'. */
async function sbSelect(table, query = '') {
  const res = await fetch(supabaseUrl(`/${table}${query ? `?${query}` : ''}`), {
    headers: supabaseHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Supabase select failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/** Insert one or more rows. Returns the inserted row(s) (Prefer: return=representation). */
async function sbInsert(table, rows) {
  const res = await fetch(supabaseUrl(`/${table}`), {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Supabase insert failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/** Delete all rows in a table (used only by the demo-data reset endpoint). */
async function sbDeleteAll(table) {
  // PostgREST requires a filter on delete — this matches every row, since
  // created_at is always set and always after this fixed epoch date.
  const res = await fetch(supabaseUrl(`/${table}?created_at=gte.1970-01-01`), {
    method: 'DELETE',
    headers: supabaseHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Supabase delete failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
}

module.exports = { sbSelect, sbInsert, sbDeleteAll };
