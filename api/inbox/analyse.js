const { sbSelect } = require('../_supabaseClient');
const { classifyInteraction } = require('../_classifyEngine');
const { htmlToText } = require('../_htmlToText');
const { requireUser } = require('../_auth');
const { divisionFromPayload, defaultOwner } = require('../_divisions');
const { createCaseFromRaw } = require('../_createCase');


const CHANNEL_CONFIG = {
  raw_emails: {
    channel: 'Email',
    toClassifyInput: (raw) => ({
      message: [raw.subject, htmlToText(raw.body_text || raw.body_html)].filter(Boolean).join('\n') || '(no content)',
      stakeholderType: 'Community', // best guess for email-sourced contacts, no structured field available
      province: null,
      stakeholder: raw.from_address,
    }),
  },
  raw_messages: {
    channel: 'SMS / WhatsApp',
    toClassifyInput: (raw) => ({
      message: raw.body_text || '(media attachment, no text)',
      stakeholderType: 'Community', // no structured field on a text message
      province: null,
      stakeholder: raw.profile_name || raw.from_number,
    }),
  },
  raw_webform: {
    channel: 'Web / QR',
    toClassifyInput: (raw) => ({
      message: raw.message,
      stakeholderType: raw.stakeholder_type || 'Community',
      province: raw.province || null,
      stakeholder: raw.organisation || raw.name || 'Anonymous',
    }),
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res, { adminOnly: true });
  if (!user) return;

  let id, table;
  try {
    ({ id, table } = req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  const config = CHANNEL_CONFIG[table];
  if (!id || !config) {
    return res.status(400).json({ error: 'id and a supported table are required' });
  }

  try {
    const rows = await sbSelect(table, `id=eq.${encodeURIComponent(id)}`);
    const raw = rows[0];
    if (!raw) return res.status(404).json({ error: 'Message not found' });
    if (raw.processed) return res.status(409).json({ error: 'Message already processed' });

    const classifyInput = config.toClassifyInput(raw);
    const classification = await classifyInteraction({ ...classifyInput, history: [] });

    // Unclear messages are filed under Group CA as "Message unclear" straight away,
    // which also removes them from the New Intake list.
    if (classification.unclear) {
      const newCase = await createCaseFromRaw({ table, raw, classification });
      return res.status(200).json({ autoRouted: true, case: newCase, classification });
    }

    // If the enquirer chose a division on the report form, that choice decides
    // the routing — the AI's suggestion is only used when none was chosen.
    const directed = table === 'raw_webform' ? divisionFromPayload(raw) : null;
    if (directed && classification.od !== directed) {
      classification.od = directed;
      classification.owner = defaultOwner(directed);
    }
    if (directed) classification.directedByEnquirer = true;

    return res.status(200).json({
      classification,
      raw: { id: raw.id, table, ...raw },
    });
  } catch (err) {
    if (err.status) {
      console.error('Inbox analyse classification error:', err.status, err.body || err.message);
      return res.status(502).json({ error: err.message || 'AI classification failed' });
    }
    console.error('Inbox analyse error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};