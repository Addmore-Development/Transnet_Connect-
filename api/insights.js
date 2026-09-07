// /api/insights.js
// Vercel serverless function. Runs a batch analysis across the current set
// of cases to surface commonalities, anomalies, and an executive summary.
// Unlike /api/analyse.js (one interaction in, one classification out), this
// takes the whole case list and looks for patterns across it.
//
// Same env vars as analyse.js:
//   GEMINI_API_KEY = AIza... (from https://aistudio.google.com/apikey)
//   MOCK_AI=true to skip the real API call and return canned data for free.

const { callGemini } = require('./_geminiClient');

const GEMINI_MODEL = 'gemini-flash-latest';

function mockInsights(cases) {
  const open = cases.filter((c) => c.status !== 'Resolved');
  const high = cases.filter((c) => c.risk === 'High');
  const byOd = {};
  cases.forEach((c) => { byOd[c.od] = (byOd[c.od] || 0) + 1; });
  const topOd = Object.entries(byOd).sort((a, b) => b[1] - a[1])[0];

  return {
    summary: `[MOCK MODE] ${open.length} open cases across ${Object.keys(byOd).length} operating divisions, ${high.length} flagged high-risk. ${topOd ? topOd[0] : 'N/A'} carries the largest share of current case volume.`,
    commonalities: [
      { title: 'Rail-related cases cluster in Gauteng', detail: 'Several TFR cases this week share both province and issue type, suggesting a localised operational pattern rather than isolated complaints.' },
      { title: 'WhatsApp is the dominant community channel', detail: 'Community-type stakeholders overwhelmingly report via WhatsApp, while Customer and Supplier types favour email — worth reflecting in channel resourcing.' },
    ],
    anomalies: [
      { title: 'Escalated case with short SLA remaining', detail: 'One or more escalated cases have SLA windows under an hour — disproportionate to typical resolution time for their issue type.' },
      { title: 'Single stakeholder, repeated contact', detail: 'At least one stakeholder organisation appears multiple times in a short window, which may indicate an unresolved root cause rather than separate issues.' },
    ],
    recommended_actions: [
      'Review open high-risk TFR cases in Gauteng as a group rather than individually.',
      'Check whether recently escalated cases have adequate owner capacity given SLA windows.',
    ],
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let cases;
  try {
    const body = req.body || {};
    cases = body.cases;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  if (!Array.isArray(cases) || cases.length === 0) {
    return res.status(400).json({ error: 'cases array is required and must be non-empty' });
  }

  if (String(process.env.MOCK_AI).toLowerCase() === 'true') {
    await new Promise((r) => setTimeout(r, 900)); // simulate a heavier batch call
    return res.status(200).json(mockInsights(cases));
  }

  // Trim each case to the fields the model actually needs — keeps the prompt
  // smaller/cheaper and avoids sending anything not relevant to pattern analysis.
  const trimmed = cases.slice(0, 200).map((c) => ({
    id: c.id, created: c.created, stakeholder: c.stakeholder, type: c.type,
    channel: c.channel, issue: c.issue, od: c.od, risk: c.risk, status: c.status,
    sla: c.sla, province: c.province, sentiment: c.sentiment,
  }));

  const prompt = `You are analysing a set of stakeholder-engagement cases for Transnet Connect. Look across ALL the cases below (not one at a time) and identify genuine commonalities and anomalies — patterns a human skimming a table might miss. Respond with ONLY a JSON object, no markdown fences, no commentary.

Cases (JSON array):
${JSON.stringify(trimmed)}

Return JSON with exactly these fields:
{
  "summary": string (2-3 sentence executive summary of the overall state — volume, risk concentration, notable trend),
  "commonalities": [ { "title": string (short), "detail": string (1-2 sentences) } ] (2-4 items — real patterns across multiple cases: shared OD+province+issue clusters, channel preferences by stakeholder type, timing patterns, etc),
  "anomalies": [ { "title": string (short), "detail": string (1-2 sentences) } ] (1-3 items — cases or patterns that stand out from the norm: risk/SLA mismatches, unusual repeat contact, outlier sentiment for a stakeholder type, etc),
  "recommended_actions": [ string ] (1-3 short, concrete suggestions for what to do given the above)
}

Only report patterns you can actually support from the data given — do not invent cases or figures not present in the input.`;

  try {
    const data = await callGemini({
      model: GEMINI_MODEL,
      apiKey: process.env.GEMINI_API_KEY,
      prompt,
      maxOutputTokens: 1200,
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
      console.error('Failed to parse model JSON (insights):', textPart.text);
      return res.status(502).json({ error: 'Malformed AI response' });
    }

    // Guardrails — make sure the shape is safe to render even if the model
    // drops a field or returns the wrong type for it.
    if (typeof parsed.summary !== 'string') parsed.summary = 'No summary available.';
    if (!Array.isArray(parsed.commonalities)) parsed.commonalities = [];
    if (!Array.isArray(parsed.anomalies)) parsed.anomalies = [];
    if (!Array.isArray(parsed.recommended_actions)) parsed.recommended_actions = [];

    return res.status(200).json(parsed);
  } catch (err) {
    if (err.status) {
      console.error('Gemini API error (insights):', err.status, err.body);
      const message = err.status === 503
        ? 'AI service is temporarily overloaded — please try again shortly.'
        : 'AI insight generation failed';
      return res.status(502).json({ error: message });
    }
    console.error('Insights endpoint error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
