const { sbSelect } = require('../_supabaseClient');
const { requireUser } = require('../_auth');
const { CHANNEL_CONFIG, createCaseFromRaw } = require('../_createCase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;

  let id, table, classification;
  try {
    ({ id, table, classification } = req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (!id || !CHANNEL_CONFIG[table] || !classification) {
    return res.status(400).json({ error: 'id, a supported table, and classification are required' });
  }

  try {
    const rows = await sbSelect(table, `id=eq.${encodeURIComponent(id)}`);
    const raw = rows[0];
    if (!raw) return res.status(404).json({ error: 'Message not found' });
    if (raw.processed) return res.status(409).json({ error: 'Message already processed' });

    const newCase = await createCaseFromRaw({ table, raw, classification });
    return res.status(200).json({ case: newCase });
  } catch (err) {
    console.error('Inbox confirm error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
