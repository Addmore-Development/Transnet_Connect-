// POST /api/auth/login  { email, password }
//   Signs in against Supabase Auth and returns a session token plus the
//   user's role/division. The browser sends this token as
//   "Authorization: Bearer <token>" on every other /api call.
//   Each sign-in is also recorded in login_sessions (for the admin "Logins" tab).
//
// The same endpoint also handles session tracking, so the project stays within
// Vercel's function limit on the free plan:
//   POST { action: 'heartbeat' | 'logout', sessionId }   (signed-in user)
//   GET                                                  (admin only: list division sessions)

const { authConfig, accessFromSupabaseUser, requireUser } = require('../_auth');
const { sbSelect, sbInsert, sbUpdate } = require('../_supabaseClient');
const { labelFor } = require('../_divisions');

// A heartbeat arrives about once a minute while the app is open and visible.
// We add the time since the previous one (capped) to active_seconds, so the
// total reflects time actually spent on the platform, not time a token stayed valid.
const MAX_GAP_SECONDS = 120;

async function sessionPing(req, res, body) {
  const user = await requireUser(req, res);
  if (!user) return;
  const { sessionId, action } = body;
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  try {
    const rows = await sbSelect('login_sessions', `id=eq.${encodeURIComponent(sessionId)}`);
    const row = rows[0];
    if (!row || String(row.email).toLowerCase() !== String(user.email).toLowerCase()) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (row.logout_at) return res.status(200).json({ ok: true, ended: true });
    const now = new Date();
    const gap = Math.max(0, (now - new Date(row.last_seen_at)) / 1000);
    const patch = {
      last_seen_at: now.toISOString(),
      active_seconds: (row.active_seconds || 0) + Math.min(gap, MAX_GAP_SECONDS),
    };
    if (action === 'logout') patch.logout_at = now.toISOString();
    await sbUpdate('login_sessions', sessionId, patch);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[auth/session] error:', err.status, err.body || err.message);
    return res.status(500).json({ error: 'Could not update the session.' });
  }
}

async function listSessions(req, res) {
  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;
  try {
    const sessions = await sbSelect('login_sessions', 'role=eq.division&order=login_at.desc&limit=500');
    return res.status(200).json({ now: new Date().toISOString(), sessions });
  } catch (err) {
    console.error('[auth/sessions] error:', err.status, err.body || err.message);
    const missing = err.status === 404 || /login_sessions/.test(String(err.body || ''));
    return res.status(500).json({
      error: missing
        ? 'The login_sessions table does not exist yet. Run the SQL in supabase_schema.sql (login_sessions section) in Supabase.'
        : 'Could not load login activity.',
    });
  }
}

// ---- Stakeholder directory (admin only) --------------------------------------
// Lists the division/stakeholder accounts that can sign in, with their contact
// details. Contact details live in each account's user_metadata (contact_name,
// job_title, contact_phone); the sign-in email is always shown.
// Handled here (not in a new file) to stay within Vercel's function limit.
function adminHeaders() {
  const key = process.env.SUPABASE_SECRET_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function authAdminUrl(path) {
  return `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1/admin${path}`;
}
function stakeholderFromUser(u) {
  const app = u.app_metadata || {};
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email,
    division: app.division,
    divisionLabel: labelFor(app.division),
    contactName: meta.contact_name || '',
    jobTitle: meta.job_title || '',
    phone: meta.contact_phone || '',
    lastSignIn: u.last_sign_in_at || null,
  };
}

async function listStakeholders(req, res) {
  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;
  try {
    const r = await fetch(authAdminUrl('/users?page=1&per_page=200'), { headers: adminHeaders() });
    if (!r.ok) throw new Error(`Supabase returned ${r.status}`);
    const body = await r.json();
    const order = require('../_divisions').DIVISIONS.map((d) => d.code);
    const stakeholders = (body.users || [])
      .filter((u) => u.app_metadata && u.app_metadata.role === 'division' && order.includes(u.app_metadata.division))
      .map(stakeholderFromUser)
      .sort((a, b) => order.indexOf(a.division) - order.indexOf(b.division) || String(a.email).localeCompare(String(b.email)));
    return res.status(200).json({ stakeholders });
  } catch (err) {
    console.error('[auth/stakeholders] error:', err.message);
    return res.status(500).json({ error: 'Could not load stakeholders.' });
  }
}

async function updateContact(req, res, body) {
  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;
  const { id } = body;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'A stakeholder id is required.' });
  }
  const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  try {
    const g = await fetch(authAdminUrl(`/users/${id}`), { headers: adminHeaders() });
    if (!g.ok) return res.status(404).json({ error: 'Stakeholder not found.' });
    const existing = await g.json();
    if (!existing.app_metadata || existing.app_metadata.role !== 'division') {
      return res.status(403).json({ error: 'Only stakeholder accounts can be edited here.' });
    }
    const user_metadata = {
      ...(existing.user_metadata || {}),
      contact_name: clean(body.contactName, 120),
      job_title: clean(body.jobTitle, 120),
      contact_phone: clean(body.phone, 40),
    };
    const p = await fetch(authAdminUrl(`/users/${id}`), { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ user_metadata }) });
    if (!p.ok) throw new Error(`Supabase returned ${p.status}`);
    return res.status(200).json({ ok: true, stakeholder: stakeholderFromUser(await p.json()) });
  } catch (err) {
    console.error('[auth/update-contact] error:', err.message);
    return res.status(500).json({ error: 'Could not save the contact details.' });
  }
}module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    let resource = req.query && req.query.resource;
    if (!resource) { try { resource = new URL(req.url, 'http://localhost').searchParams.get('resource'); } catch (e) { resource = null; } }
    return resource === 'stakeholders' ? listStakeholders(req, res) : listSessions(req, res);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  if (body.action === 'heartbeat' || body.action === 'logout') return sessionPing(req, res, body);
  if (body.action === 'update_contact') return updateContact(req, res, body);

  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  try {
    const { base, key } = authConfig();
    const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    if (r.status === 400 || r.status === 401 || r.status === 422) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (!r.ok) {
      console.error('[auth/login] Supabase returned', r.status, await r.text());
      return res.status(502).json({ error: 'Sign-in service is unavailable. Please try again.' });
    }

    const data = await r.json();
    const user = accessFromSupabaseUser(data.user);
    if (!user) {
      return res.status(403).json({ error: 'This account has not been given access to Transnet Connect.' });
    }

    // Record the sign-in. Never block a login because tracking failed (e.g. table not created yet).
    let sessionId = null;
    try {
      const now = new Date().toISOString();
      const [row] = await sbInsert('login_sessions', [{
        user_id: user.id,
        email: user.email,
        role: user.role,
        division: user.division,
        division_label: user.division ? labelFor(user.division) : null,
        login_at: now,
        last_seen_at: now,
        active_seconds: 0,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      }]);
      sessionId = row && row.id;
    } catch (trackErr) {
      console.error('[auth/login] could not record session:', trackErr.status, trackErr.body || trackErr.message);
    }

    return res.status(200).json({
      sessionId,
      token: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      user: {
        email: user.email,
        role: user.role,
        division: user.division,
        divisionLabel: user.division ? labelFor(user.division) : null,
      },
    });
  } catch (err) {
    console.error('[auth/login] error:', err.message);
    return res.status(500).json({
      error: err.config ? 'Server auth is not configured (missing SUPABASE_PUBLISHABLE_KEY).' : 'Sign-in failed. Please try again.',
    });
  }
};
