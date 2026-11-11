const { sbSelect } = require('./_supabaseClient');
const { htmlToText } = require('./_htmlToText');
const { requireUser } = require('./_auth');
const { divisionFromPayload, labelFor } = require('./_divisions');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireUser(req, res, { adminOnly: true });
    if (!user) return;

    const emails = await sbSelect('raw_emails', 'processed=eq.false&order=received_at.desc');
    const webforms = await sbSelect('raw_webform', 'processed=eq.false&order=received_at.desc');
    // Twilio SMS + WhatsApp. Non-fatal if it fails so email/web-form inbox keeps working.
    const messages = await sbSelect('raw_messages', 'processed=eq.false&order=received_at.desc').catch((e) => {
      console.error('Inbox: could not load raw_messages:', e.status, e.body || e.message);
      return [];
    });

    // Normalise into one shape the frontend can render regardless of
    // channel — id + table together let /api/inbox/analyse know where to
    // fetch the full row from and what to mark processed afterwards.
    const emailItems = emails.map((e) => ({
      id: e.id,
      table: 'raw_emails',
      channel: 'Email',
      from: e.from_address,
      subject: e.subject,
      preview: htmlToText(e.body_text || e.body_html).slice(0, 140),
      received_at: e.received_at,
    }));

    const webformItems = webforms.map((w) => ({
      directedTo: divisionFromPayload(w) ? labelFor(divisionFromPayload(w)) : null,
      id: w.id,
      table: 'raw_webform',
      channel: 'Web / QR',
      from: w.name || w.organisation || 'Anonymous',
      subject: w.organisation || w.location || '',
      preview: (w.message || '').slice(0, 140),
      received_at: w.received_at,
    }));

    const messageItems = messages.map((m) => ({
      id: m.id,
      table: 'raw_messages',
      channel: m.channel,
      from: m.profile_name ? `${m.profile_name} (${m.from_number})` : m.from_number,
      subject: '',
      preview: (m.body_text || (m.num_media > 0 ? '[Media attachment]' : '')).slice(0, 140),
      received_at: m.received_at,
    }));

    const items = [...emailItems, ...webformItems, ...messageItems].sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

    return res.status(200).json(items);
  } catch (err) {
    console.error('Inbox list error:', err);
    return res.status(500).json({ error: 'Failed to load inbox' });
  }
};