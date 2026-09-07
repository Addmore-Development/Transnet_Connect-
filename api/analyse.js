// /api/analyse.js
// Vercel serverless function. Deploy this file inside an "api" folder at your
// project root and Vercel will automatically expose it at POST /api/analyse.
//
// Required environment variable for real AI calls (set in Vercel Project
// Settings > Environment Variables — never put this in app.js or any
// client-side file):
//   GEMINI_API_KEY = AIza... (from https://aistudio.google.com/apikey)
//
// Uses Google's free-tier Gemini API (Gemini 3 Flash by default). Free tier
// has rate limits (requests per minute/day) — fine for prototyping, not for
// production volume. See https://ai.google.dev/gemini-api/docs for current
// limits, since Google adjusts these periodically.
//
// MOCK MODE (free, no API calls) — set in .env:
//   MOCK_AI=true
// When set, this endpoint skips Gemini entirely and returns a canned,
// slightly-randomized classification after a short artificial delay, so you
// can test the full submit -> loading -> render -> case-creation flow with
// zero cost/quota use. Set MOCK_AI=false (or remove it) to use the real
// model again.

const { callGemini } = require('./_geminiClient');

const GEMINI_MODEL = 'gemini-flash-latest';

const ALLOWED_OD = ['TFR', 'TNPA', 'TE / SCM', 'Group CA'];
const ALLOWED_RISK = ['Low', 'Medium', 'High'];
const ALLOWED_SENTIMENT = ['Positive', 'Neutral', 'Negative'];
const ALLOWED_PRIORITY = ['P1', 'P2', 'P3'];

function mockClassify(message, stakeholderType, history) {
  // Same lightweight logic style as the old local fallback, just returned in
  // the exact shape the real API gives back, plus a clear "this is fake" flag
  // in reasoning so it's obvious in testing which path served the response.
  const lower = message.toLowerCase();
  let issue = 'General stakeholder enquiry', od = 'Group CA', risk = 'Medium',
    sentiment = 'Neutral', priority = 'P2', sla = '4 hours', owner = 'Corporate Affairs Queue';

  if (/crossing|train|rail|wagon|capacity|slot/.test(lower)) {
    issue = /crossing|child|hurt|safety/.test(lower) ? 'Rail crossing safety' : 'Rail operations / capacity';
    od = 'TFR'; owner = 'TFR Stakeholder Relations';
  }
  if (/port|permit|terminal|berth/.test(lower)) { issue = 'Port access / operations'; od = 'TNPA'; owner = 'TNPA Stakeholder Relations'; }
  if (/payment|invoice|supplier/.test(lower)) { issue = 'Supplier payment'; od = 'TE / SCM'; owner = 'Supplier Resolution Desk'; }
  if (/media|journalist|press/.test(lower)) { issue = 'Media query'; od = 'Group CA'; owner = 'Media Relations'; }

  if (/urgent|hurt|danger|accident|blocked|fatal|legal|protest/.test(lower)) { risk = 'High'; priority = 'P1'; sla = '1 hour'; sentiment = 'Negative'; }
  else if (/complaint|delay|overdue|problem|again|pending/.test(lower)) { risk = 'Medium'; priority = 'P2'; sla = '4 hours'; sentiment = 'Negative'; }
  else if (/thank|appreciate|resolved|good/.test(lower)) { risk = 'Low'; priority = 'P3'; sla = '8 hours'; sentiment = 'Positive'; }

  if (['Media', 'Regulator', 'Investor'].includes(stakeholderType) && risk === 'Medium') risk = 'High';

  const duplicate = Array.isArray(history) && history.length
    ? 'Likely — matches recurring theme from stakeholder history'
    : 'No strong match';

  const score = risk === 'High' ? 86 : risk === 'Medium' ? 58 : 24;

  return {
    issue, od, risk, sentiment, priority, sla, owner, duplicate, score,
    reasoning: '[MOCK MODE] Canned classification — no live API call was made.',
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let message, stakeholderType, province, stakeholder, history;
  try {
    // req.body can throw (not just be undefined) if the incoming body isn't
    // valid JSON — accessing it here, inside try/catch, means a malformed
    // request returns a clean 400 instead of crashing the whole process.
    const parsedBody = req.body || {};
    ({ message, stakeholderType, province, stakeholder, history } = parsedBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // --- MOCK MODE: short circuit before any Gemini call ---
  if (String(process.env.MOCK_AI).toLowerCase() === 'true') {
    await new Promise((r) => setTimeout(r, 600)); // simulate latency
    return res.status(200).json(mockClassify(message, stakeholderType, history));
  }

  const historyBlock =
    Array.isArray(history) && history.length
      ? `\n\nRecent prior cases from this stakeholder (for duplicate/pattern detection):\n${history
          .slice(0, 5)
          .map((h) => `- [${h.created}] ${h.issue}: ${h.message}`)
          .join('\n')}`
      : '';

  const prompt = `You are the triage engine for Transnet Connect, a stakeholder engagement platform. Classify the interaction below and respond with ONLY a JSON object — no markdown fences, no commentary.

Stakeholder type: ${stakeholderType || 'Unknown'}
Province: ${province || 'Unknown'}
Organisation: ${stakeholder || 'Unknown'}
Message: "${message}"${historyBlock}

Return JSON with exactly these fields:
{
  "issue": string (a short 2-6 word issue label, e.g. "Rail crossing safety"),
  "od": one of ${JSON.stringify(ALLOWED_OD)},
  "risk": one of ${JSON.stringify(ALLOWED_RISK)},
  "sentiment": one of ${JSON.stringify(ALLOWED_SENTIMENT)},
  "priority": one of ${JSON.stringify(ALLOWED_PRIORITY)},
  "sla": string (e.g. "1 hour", "4 hours", "8 hours"),
  "owner": string (suggested owning team, e.g. "TFR Stakeholder Relations"),
  "duplicate": string (short note on whether this matches a recurring/prior theme, or "No strong match"),
  "score": integer 0-100 (reputational/operational risk score),
  "reasoning": string (one sentence explaining the classification, for an internal reviewer)
}`;

  try {
    const data = await callGemini({
      model: GEMINI_MODEL,
      apiKey: process.env.GEMINI_API_KEY,
      prompt,
      maxOutputTokens: 500,
    });

    const textPart = data.candidates?.[0]?.content?.parts?.find((p) => p.text);
    if (!textPart) {
      console.error('Unexpected Gemini response shape:', JSON.stringify(data));
      return res.status(502).json({ error: 'No text response from model' });
    }

    let parsed;
    try {
      const cleaned = textPart.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse model JSON:', textPart.text);
      return res.status(502).json({ error: 'Malformed AI response' });
    }

    // Guardrails: fall back to safe defaults if the model returns something
    // outside the allowed enums, so a bad/unexpected response can't break the UI.
    if (!ALLOWED_OD.includes(parsed.od)) parsed.od = 'Group CA';
    if (!ALLOWED_RISK.includes(parsed.risk)) parsed.risk = 'Medium';
    if (!ALLOWED_SENTIMENT.includes(parsed.sentiment)) parsed.sentiment = 'Neutral';
    if (!ALLOWED_PRIORITY.includes(parsed.priority)) parsed.priority = 'P2';
    if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 100) {
      parsed.score = parsed.risk === 'High' ? 86 : parsed.risk === 'Medium' ? 58 : 24;
    }

    return res.status(200).json(parsed);
  } catch (err) {
    if (err.status) {
      console.error('Gemini API error:', err.status, err.body);
      const message = err.status === 503
        ? 'AI service is temporarily overloaded — please try again shortly.'
        : 'AI classification failed';
      return res.status(502).json({ error: message });
    }
    console.error('Analyse endpoint error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
