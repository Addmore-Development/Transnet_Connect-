

const { classifyInteraction } = require('./_classifyEngine');
const { requireUser } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;

  let message, stakeholderType, province, stakeholder, history;
  try {
    const parsedBody = req.body || {};
    ({ message, stakeholderType, province, stakeholder, history } = parsedBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const parsed = await classifyInteraction({ message, stakeholderType, province, stakeholder, history });
    return res.status(200).json(parsed);
  } catch (err) {
    if (err.status) {
      console.error('Classification error:', err.status, err.body || err.message);
      const clientMessage = err.status === 503
        ? 'AI service is temporarily overloaded — please try again shortly.'
        : err.message || 'AI classification failed';
      return res.status(502).json({ error: clientMessage });
    }
    console.error('Analyse endpoint error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};