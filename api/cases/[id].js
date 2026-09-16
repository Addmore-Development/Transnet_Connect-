// /api/cases/[id].js
// PATCH /api/cases/TC-2026-1042  -> update one or more fields on that case
//   (used right now for status changes: Open / In Progress / Escalated / Resolved)
// GET   /api/cases/TC-2026-1042  -> fetch a single case (not currently used
//   by the frontend, which already has the full case in memory, but useful
//   for testing/curl and for future direct-link support)

const { sbSelect, sbUpdate } = require('../_supabaseClient');

const ALLOWED_STATUS = ['Open', 'In Progress', 'Escalated', 'Resolved'];

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Case id is required' });
  }

  try {
    if (req.method === 'GET') {
      const rows = await sbSelect('cases', `id=eq.${encodeURIComponent(id)}`);
      if (!rows.length) return res.status(404).json({ error: 'Case not found' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PATCH') {
      let body;
      try {
        body = req.body || {};
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }

      const patch = {};
      if (body.status !== undefined) {
        if (!ALLOWED_STATUS.includes(body.status)) {
          return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUS.join(', ')}` });
        }
        patch.status = body.status;
      }
      // Only status updates are supported today. Other fields (risk, owner,
      // etc) could be added here the same way later if needed.

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }

      const updated = await sbUpdate('cases', id, patch);
      if (!updated) return res.status(404).json({ error: 'Case not found' });
      return res.status(200).json(updated);
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('cases/[id] endpoint error:', err.status, err.body || err.message);
    return res.status(502).json({ error: 'Database request failed' });
  }
};
