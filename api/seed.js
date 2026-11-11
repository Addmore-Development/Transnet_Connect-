// /api/seed.js
// POST /api/seed -> wipes the cases table and reinserts the original demo
// dataset. Backs the "Reset demo data" button. Same 7 rows that used to
// live in app.js's seedCases constant.

const { sbDeleteAll, sbInsert } = require('./_supabaseClient');
const { requireUser } = require('./_auth');

const SEED_CASES = [];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Destructive (wipes the cases table), so admins only.
  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;

 
  try {
    await sbDeleteAll('cases');
    const inserted = SEED_CASES.length ? await sbInsert('cases', SEED_CASES) : [];
    return res.status(200).json({ reset: true, count: inserted.length });
  } catch (err) {
  }
};
