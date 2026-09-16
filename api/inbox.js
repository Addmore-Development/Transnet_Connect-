
const { sbSelect } = require('./_supabaseClient');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const emails = await sbSelect('raw_emails', 'processed=eq.false&order=received_at.desc');

   
    const items = emails.map((e) => ({
      id: e.id,
      table: 'raw_emails',
      channel: 'Email',
      from: e.from_address,
      subject: e.subject,
      preview: (e.body_text || '').slice(0, 140),
      received_at: e.received_at,
    }));

    return res.status(200).json(items);
  } catch (err) {
    console.error('Inbox list error:', err);
    return res.status(500).json({ error: 'Failed to load inbox' });
  }
};