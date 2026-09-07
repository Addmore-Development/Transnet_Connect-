// /api/cases.js
// GET  /api/cases  -> returns all cases, newest first
// POST /api/cases  -> creates one case; server assigns the id and created
//                     label so numbering stays consistent regardless of who
//                     else might be creating cases at the same time.

const { sbSelect, sbInsert } = require('./_supabaseClient');

function nextCaseId(existingRows) {
  // Find the highest numeric suffix among ids like 'TC-2026-1042' and
  // increment it, so new cases keep counting up rather than colliding.
  let max = 1042; // seed data starts here, so new cases start from 1043
  for (const row of existingRows) {
    const match = /^TC-2026-(\d+)$/.exec(row.id || '');
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `TC-2026-${max + 1}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const rows = await sbSelect('cases', 'order=created_at.desc');
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
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

      // Look at existing ids to pick the next sequential number.
      const existing = await sbSelect('cases', 'select=id');
      const id = nextCaseId(existing);

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
        od: body.od,
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
