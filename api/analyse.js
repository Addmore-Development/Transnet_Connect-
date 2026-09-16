

const { sbSelect, sbInsert, sbUpdate } = require('../_supabaseClient');
const { classifyInteraction } = require('../_classifyEngine');


function nextCaseId(existingRows) {
  let max = 1042;
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, table } = req.body || {};
  if (!id || table !== 'raw_emails') {

    return res.status(400).json({ error: 'id and a supported table are required' });
  }

  try {
    const rows = await sbSelect('raw_emails', `id=eq.${encodeURIComponent(id)}`);
    const raw = rows[0];
    if (!raw) return res.status(404).json({ error: 'Message not found' });
    if (raw.processed) return res.status(409).json({ error: 'Message already processed' });

    const message = raw.body_text || raw.subject || '(no content)';

    const classification = await classifyInteraction({
      message,
      stakeholderType: 'Community', // best guess for email-sourced contacts; refine once channel-specific hints exist
      province: null,
      stakeholder: raw.from_address,
      history: [],
    });

    const existingCases = await sbSelect('cases', 'order=created_at.desc&limit=1');
    const caseId = nextCaseId(existingCases);

    const [newCase] = await sbInsert('cases', [{
      id: caseId,
      created: new Date().toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      stakeholder: raw.from_address || 'Unknown (Email)',
      channel: 'Email',
      issue: classification.issue,
      od: classification.od,
      owner: classification.owner,
      risk: classification.risk,
      status: 'Open',
      sla: classification.sla,
      sentiment: classification.sentiment,
      message,
    }]);

    await sbUpdate('raw_emails', id, { processed: true, case_id: caseId });

    return res.status(200).json({ case: newCase, classification });
  } catch (err) {
    if (err.status) {
      console.error('Inbox analyse classification error:', err.status, err.body || err.message);
      return res.status(502).json({ error: err.message || 'AI classification failed' });
    }
    console.error('Inbox analyse error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};