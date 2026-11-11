// /api/_auth.js
// Server-side authentication using Supabase Auth (GoTrue) over plain fetch,
// so the project stays dependency-free.
//
// Who can do what is decided HERE, on the server, from the user's
// app_metadata (which only the service-role key can write — a user cannot
// edit their own role or division):
//   app_metadata.role = 'admin'                       -> sees everything
//   app_metadata.role = 'division' + .division = 'TFR' -> sees only TFR cases
//
// Required env vars:
//   SUPABASE_URL              (already set)
//   SUPABASE_PUBLISHABLE_KEY  sb_publishable_... (or legacy anon key) — Supabase
//                             Dashboard -> Settings -> API Keys. Safe-ish to expose,
//                             but we only ever use it server-side.

const { isDivisionCode } = require('./_divisions');

function authConfig() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) {
    const err = new Error('Auth is not configured: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
    err.config = true;
    throw err;
  }
  return { base, key };
}

/** Turns a Supabase user object into our {role, division}, or null if the account has no valid access role. */
function accessFromSupabaseUser(u) {
  const meta = (u && u.app_metadata) || {};
  if (meta.role === 'admin') {
    return { id: u.id, email: u.email, role: 'admin', division: null };
  }
  if (meta.role === 'division' && isDivisionCode(meta.division)) {
    return { id: u.id, email: u.email, role: 'division', division: meta.division };
  }
  return null;
}

function bearerToken(req) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

/**
 * Validates the caller's token with Supabase and returns the user.
 * On failure it sends the response itself and returns null — callers just do:
 *   const user = await requireUser(req, res); if (!user) return;
 */
async function requireUser(req, res, { adminOnly = false } = {}) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Please sign in.' });
    return null;
  }

  let supaUser;
  try {
    const { base, key } = authConfig();
    const r = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (r.status === 401 || r.status === 403) {
      res.status(401).json({ error: 'Your session has expired — please sign in again.' });
      return null;
    }
    if (!r.ok) throw new Error(`Supabase auth check failed (${r.status})`);
    supaUser = await r.json();
  } catch (err) {
    console.error('[auth] could not verify session:', err.message);
    res.status(500).json({ error: err.config ? 'Server auth is not configured.' : 'Could not verify your session.' });
    return null;
  }

  const user = accessFromSupabaseUser(supaUser);
  if (!user) {
    res.status(403).json({ error: 'This account has not been given access to Transnet Connect.' });
    return null;
  }
  if (adminOnly && user.role !== 'admin') {
    res.status(403).json({ error: 'You do not have permission to do this.' });
    return null;
  }
  return user;
}

module.exports = { requireUser, accessFromSupabaseUser, authConfig };
