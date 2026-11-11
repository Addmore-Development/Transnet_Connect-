// /api/cases.js
// GET  /api/cases  -> returns all cases, newest first
// POST /api/cases  -> creates one case; server assigns the id and created
//                     label so numbering stays consistent regardless of who
//                     else might be creating cases at the same time.

const { sbSelect, sbInsert, sbUpdate } = require('./_supabaseClient');
const { requireUser } = require('./_auth');
const { normaliseOd, canSeeCase, CODES } = require('./_divisions');
const { newCaseRef } = require('./_caseRef');

// GET   /api/cases?resource=support  -> support requests (admin: all, division: its own)
// PATCH /api/cases?resource=support  -> admin marks one as Handled / Open
async function supportRequests(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') {
      const filter = user.role === 'admin' ? '' : `&division=eq.${encodeURIComponent(user.division)}`;
      const rows = await sbSelect('support_requests', `order=created_at.desc&limit=200${filter}`);
      return res.status(200).json({ requests: rows });
    }
    if (req.method === 'PATCH') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can update support requests.' });
      const { id, status } = req.body || {};
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !['Open', 'Handled'].includes(status)) {
        return res.status(400).json({ error: 'A request id and a status (Open or Handled) are required.' });
      }
      const handled = status === 'Handled';
      const row = await sbUpdate('support_requests', id, {
        status,
        handled_by: handled ? user.email : null,
        handled_at: handled ? new Date().toISOString() : null,
      });
      if (!row) return res.status(404).json({ error: 'Support request not found.' });
      return res.status(200).json({ request: row });
    }
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('support requests error:', err.status, err.body || err.message);
    const missing = err.status === 404 || /PGRST205|does not exist/i.test(String(err.body || ''));
    return res.status(500).json({
      error: missing
        ? 'The support_requests table does not exist yet. Run supabase_engagement_features.sql in the Supabase SQL editor.'
        : 'Could not load support requests.',
    });
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.query && req.query.resource === 'support') return supportRequests(req, res);
    if (req.method === 'GET') {
      const user = await requireUser(req, res);
      if (!user) return;
      const rows = await sbSelect('cases', 'order=created_at.desc');
      // Division users only ever receive the cases directed to their division.
      return res.status(200).json(rows.filter((row) => canSeeCase(user, row)));
    }

    if (req.method === 'POST') {
      const user = await requireUser(req, res, { adminOnly: true });
      if (!user) return;
      let body;
      try {
        body = req.body || {};
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }

      const required = ['stakeholder', 'issue', 'od', 'risk', 'status'];
      const missing = required.filter((f) => !body[f]);
      if (missing.length) {
        return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
      }

      const od = normaliseOd(body.od);
      if (!od) {
        return res.status(400).json({ error: `od must be one of: ${CODES.join(', ')}` });
      }

      // Same counter the inbox and the acknowledgement emails use, so numbers never collide.
      const id = await newCaseRef();

      const now = new Date();
      const created = now.toLocaleString('en-ZA', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).replace(',', '');

      const row = {
        id,
        created,
        stakeholder: body.stakeholder,
        name: body.name || null,
        type: body.type || null,
        channel: body.channel || null,
        issue: body.issue,
        od,
        owner: body.owner || null,
        risk: body.risk,
        status: body.status,
        sla: body.sla || null,
        province: body.province || null,
        sentiment: body.sentiment || null,
        message: body.message || null,
      };

      const inserted = await sbInsert('cases', [row]);
      return res.status(201).json(inserted[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cases endpoint error:', err.status, err.body || err.message);
    return res.status(502).json({ error: 'Database request failed' });
  }
};
