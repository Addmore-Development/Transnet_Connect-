// /api/cases/[id].js
// PATCH /api/cases/TC-2026-1042  -> update one or more fields on that case
//   (used right now for status changes: Open / In Progress / Escalated / Resolved)
//   Every time the status changes (Open / In Progress / Escalated / Resolved) the enquirer is emailed via Resend.
// GET   /api/cases/TC-2026-1042  -> fetch a single case

const { sbSelect, sbInsert, sbUpdate } = require('../_supabaseClient');
const { callOpenAI } = require('../_openaiClient');
const { requireUser } = require('../_auth');
const { canSeeCase, normaliseOd, defaultOwner } = require('../_divisions');
const { sendEmail, parseAddress, isAutomatedSender, statusUpdateEmail } = require('../_email');

const ALLOWED_STATUS = ['Open', 'In Progress', 'Escalated', 'Resolved'];

// ---- Engagement features: events log, resolved-case reports, support requests ----
const SUPPORT_TYPES = [
  'More information from the enquirer',
  'Input from another division',
  'Senior or executive escalation',
  'Resources or access',
  'Technical or system help',
  'Other',
];
const TABLES_HINT = 'The engagement tables do not exist yet. Run supabase_engagement_features.sql in the Supabase SQL editor.';
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (iso) => new Date(iso).toLocaleString('en-ZA', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg',
});

function tableError(res, err, what) {
  console.error('[cases/[id]] engagement error:', err.status, err.body || err.message);
  const missing = err.status === 404 || /PGRST205|does not exist/i.test(String(err.body || ''));
  return res.status(500).json({ error: missing ? TABLES_HINT : what });
}

/** Best-effort audit trail. Never blocks the action it records (e.g. when the table is not created yet). */
async function logEvent(caseId, kind, detail, actor) {
  try {
    await sbInsert('case_events', [{ case_id: caseId, kind, detail, actor }]);
  } catch (err) {
    console.error('[case_events] not logged:', err.status, err.body || err.message);
  }
}

/** Times and updates that reached the enquirer, as plain lines: "02 Nov 2026, 09:00 | Status changed ..." */
async function timelineFor(existing) {
  let events = [];
  try {
    events = await sbSelect('case_events', `case_id=eq.${encodeURIComponent(existing.id)}&kind=in.(status,email)&order=created_at.asc`);
  } catch (err) {
    console.error('[case_events] could not read:', err.status, err.body || err.message);
  }
  const items = [];
  if (existing.created_at) items.push({ at: existing.created_at, text: `Case received via ${existing.channel || 'the platform'} (${existing.id})` });
  events.forEach((e) => items.push({ at: e.created_at, text: e.detail }));
  const resolvedMailLogged = events.some((e) => e.kind === 'email' && /Resolved/i.test(e.detail || ''));
  if (existing.resolved_email_sent_at && !resolvedMailLogged) {
    items.push({ at: existing.resolved_email_sent_at, text: 'Resolution email sent to the enquirer' });
  }
  items.sort((a, b) => new Date(a.at) - new Date(b.at));
  return items.map((i) => `${fmtTime(i.at)} | ${i.text}`).join('\n');
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw e;
    return JSON.parse(match[0]);
  }
}

async function aiReportDraft(existing, timeline) {
  if (String(process.env.MOCK_AI).toLowerCase() === 'true') {
    return {
      summary: `[MOCK MODE] ${existing.id} (${existing.issue}) was received via ${existing.channel || 'the platform'}, handled by ${existing.od} and marked resolved.`,
      solution: 'The responsible division reviewed the enquiry and closed it. Please confirm the specific resolution.',
      confidence: 70,
      confidence_note: '[MOCK MODE] No resolution notes are recorded, so this is an estimate.',
    };
  }
  const facts = {
    reference: existing.id, issue: existing.issue, stakeholder: existing.stakeholder, enquirer: existing.name,
    channel: existing.channel, division: existing.od, owner: existing.owner, risk: existing.risk,
    sentiment: existing.sentiment, sla: existing.sla, province: existing.province,
    original_message: String(existing.message || '').slice(0, 1200),
  };
  const prompt = `You are writing a closing engagement report for a resolved stakeholder case in Transnet Connect. Respond with ONLY a JSON object, no markdown fences, no commentary.

Case facts (JSON):
${JSON.stringify(facts)}

Recorded updates that reached the enquirer (time | update):
${timeline || '(none recorded)'}

Return JSON with exactly these fields:
{
  "summary": string (2-4 sentences: what the enquiry was, who handled it, and how the engagement with the enquirer went, using the recorded updates),
  "solution": string (1-3 sentences on the solution or outcome provided; if the data does not record the actual resolution, say so plainly and describe only what can be supported),
  "confidence": integer 0-100 (how confident we can be that the solution properly resolved the enquirer's issue, based on the evidence above),
  "confidence_note": string (1-2 sentences explaining the score and naming any evidence that is missing, e.g. no enquirer feedback or no resolution notes)
}

Do not invent times, people, figures or actions that are not in the data. The stakeholder will review and edit this report before it is saved.`;
  const text = await callOpenAI({ prompt, maxOutputTokens: 6000 });
  return parseJsonLoose(text);
}

async function caseReport(req, res, user, existing) {
  try {
    if (req.method === 'GET') {
      const rows = await sbSelect('case_reports', `id=eq.${encodeURIComponent(existing.id)}`);
      return res.status(200).json({ report: rows[0] || null });
    }
    if (req.method !== 'POST' && req.method !== 'PUT') {
      res.setHeader('Allow', 'GET, POST, PUT');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (existing.status !== 'Resolved') {
      return res.status(400).json({ error: 'A report can be created once the case is resolved.' });
    }

    if (req.method === 'POST') {
      const timeline = await timelineFor(existing);
      let ai;
      try {
        ai = await aiReportDraft(existing, timeline);
      } catch (err) {
        if (err.status) {
          console.error('OpenAI error (case report):', err.status, err.body);
          return res.status(502).json({ error: err.message || 'AI report generation failed' });
        }
        console.error('Malformed AI response (case report):', err.message);
        return res.status(502).json({ error: 'Malformed AI response' });
      }
      const n = Math.round(Number(ai.confidence));
      return res.status(200).json({
        draft: {
          summary: clean(ai.summary, 4000),
          timeline,
          solution: clean(ai.solution, 3000),
          confidence: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null,
          confidence_note: clean(ai.confidence_note, 2000),
          notes: '',
          ai_generated: true,
        },
      });
    }

    // PUT: save the (possibly edited) report
    const b = req.body || {};
    let confidence = null;
    if (b.confidence !== null && b.confidence !== undefined && b.confidence !== '') {
      const n = Number(b.confidence);
      if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: 'Confidence must be between 0 and 100.' });
      confidence = Math.round(n);
    }
    const row = {
      summary: clean(b.summary, 4000),
      timeline: clean(b.timeline, 6000),
      solution: clean(b.solution, 3000),
      confidence,
      confidence_note: clean(b.confidence_note, 2000),
      notes: clean(b.notes, 3000),
      ai_generated: !!b.ai_generated,
      updated_by: user.email,
      updated_at: new Date().toISOString(),
    };
    const rows = await sbSelect('case_reports', `id=eq.${encodeURIComponent(existing.id)}`);
    let saved;
    if (rows[0]) saved = await sbUpdate('case_reports', existing.id, row);
    else [saved] = await sbInsert('case_reports', [{ id: existing.id, ...row }]);
    await logEvent(existing.id, 'report', 'Engagement report saved', user.email);
    return res.status(200).json({ report: saved });
  } catch (err) {
    return tableError(res, err, 'Could not load or save the report.');
  }
}

async function supportRequest(req, res, user, existing) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (user.role !== 'division') {
    return res.status(403).json({ error: 'Support requests are sent by stakeholders. Admins can action the case directly.' });
  }
  const b = req.body || {};
  if (!SUPPORT_TYPES.includes(b.type)) {
    return res.status(400).json({ error: 'Choose the kind of support you need.' });
  }
  const details = clean(b.details, 1000);
  try {
    const [row] = await sbInsert('support_requests', [{
      case_id: existing.id,
      division: user.division,
      support_type: b.type,
      details: details || null,
      requested_by: user.email,
    }]);
    await logEvent(existing.id, 'support', `Support requested: ${b.type}`, user.email);

    // Alert the admin team by email too (set ADMIN_ALERT_EMAIL, comma-separated, in .env / Vercel).
    let emailed = false;
    const recipients = String(process.env.ADMIN_ALERT_EMAIL || '').split(',').map((s) => parseAddress(s)).filter(Boolean);
    for (const to of recipients) {
      try {
        const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#222"><h2 style="border-bottom:3px solid #d62027;padding-bottom:8px">Support requested on ${escHtml(existing.id)}</h2>`
          + `<p><b>${escHtml(user.email)}</b> (${escHtml(user.division)}) needs: <b>${escHtml(b.type)}</b></p>`
          + `<p>Case: ${escHtml(existing.issue)}</p>${details ? `<p>${escHtml(details)}</p>` : ''}`
          + '<p style="color:#888;font-size:12px">Open Transnet Connect to respond. Transnet Connect &bull; Stakeholder Management</p></div>';
        const r = await sendEmail({
          to,
          subject: `Support requested on ${existing.id} (${user.division})`,
          html,
          text: `${user.email} (${user.division}) needs: ${b.type}\nCase ${existing.id}: ${existing.issue}\n${details}`,
        });
        emailed = emailed || !!r.sent;
      } catch (mailErr) {
        console.error('[support] alert email failed:', mailErr.message);
      }
    }
    return res.status(201).json({ ok: true, request: row, emailed });
  } catch (err) {
    return tableError(res, err, 'Could not send the support request.');
  }
}

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Case id is required' });
  }

  try {
    if (!['GET', 'PATCH', 'POST', 'PUT'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PATCH, POST, PUT');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    // A division user asking for another division's case gets a plain 404,
    // so they can't even confirm that the case exists.
    const rows = await sbSelect('cases', `id=eq.${encodeURIComponent(id)}`);
    const existing = rows[0];
    if (!existing || !canSeeCase(user, existing)) return res.status(404).json({ error: 'Case not found' });
    if (req.query.resource === 'report') return caseReport(req, res, user, existing);
    if (req.query.resource === 'support') return supportRequest(req, res, user, existing);
    if (req.method !== 'GET' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (req.method === 'GET') return res.status(200).json(existing);

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
    // Admin can reassign a case if the AI sent it to the wrong stakeholder.
    if (body.od !== undefined) {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can reassign a case.' });
      const od = normaliseOd(body.od);
      if (!od) return res.status(400).json({ error: 'Choose a valid division.' });
      if (od !== normaliseOd(existing.od)) {
        patch.od = od;
        patch.owner = defaultOwner(od);
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    let updated = await sbUpdate('cases', id, patch);
    if (!updated) return res.status(404).json({ error: 'Case not found' });
    if (patch.od) await logEvent(id, 'reassigned', `Reassigned from ${existing.od} to ${patch.od}`, user.email);
    if (patch.status !== undefined && patch.status !== existing.status) {
      await logEvent(id, 'status', `Status changed from ${existing.status} to ${patch.status}`, user.email);
    }

    // Tell the enquirer every time the status changes, not only when it is resolved.
    const statusChanged = patch.status !== undefined && patch.status !== existing.status;
    const to = parseAddress(existing.contact_email);
    let emailSent = false;
    if (statusChanged && to && !isAutomatedSender(to)) {
      try {
        const result = await sendEmail({
          to,
          ...statusUpdateEmail({ name: existing.name, reference: existing.id, issue: existing.issue, status: patch.status }),
        });
        emailSent = !!result.sent;
        if (result.sent) await logEvent(id, 'email', `Status update email (${patch.status}) sent to the enquirer`, 'system');
        if (result.sent && patch.status === 'Resolved') {
          updated = (await sbUpdate('cases', id, { resolved_email_sent_at: new Date().toISOString() })) || updated;
        }
      } catch (mailErr) {
        // The status change itself already succeeded — don't fail it because of email.
        console.error('[cases/[id]] status email failed for', id, mailErr.message);
      }
    }

    return res.status(200).json({ ...updated, emailSent });
  } catch (err) {
    console.error('cases/[id] endpoint error:', err.status, err.body || err.message);
    return res.status(502).json({ error: 'Database request failed' });
  }
};
