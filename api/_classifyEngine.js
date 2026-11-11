const { callOpenAI } = require('./_openaiClient');
const { CODES, normaliseOd, defaultOwner } = require('./_divisions');

const ALLOWED_OD = CODES; // Group CA, TFR, TRIM, TNPA, TPT, TE, TPL, Property
const ALLOWED_RISK = ['Low', 'Medium', 'High'];
const ALLOWED_SENTIMENT = ['Positive', 'Neutral', 'Negative'];
const ALLOWED_PRIORITY = ['P1', 'P2', 'P3'];


// The public form prefixes the message with "Area of enquiry: ...\nFrom: ...\n\n<what they wrote>".
// The classifier must judge what the sender WROTE, not the dropdown they picked.
function splitFormMessage(message) {
  const raw = String(message || '');
  const m = raw.match(/^Area of enquiry:[ \t]*(.*)\r?\n(?:From:[ \t]*(.*)\r?\n)?[ \t]*\r?\n?([\s\S]*)$/i);
  if (!m) return { area: null, location: null, text: raw.trim() };
  return { area: m[1].trim() || null, location: (m[2] || '').trim() || null, text: m[3].trim() };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Detects messages that can't be acted on: empty, far too short, or keyboard-mash gibberish.
function looksUnclear(message) {
  const text = String(message || '')
    .replace(/\(no content\)|\(media attachment, no text\)/gi, ' ')
    .replace(/area of enquiry:?/gi, ' ')
    .replace(/general enquiry/gi, ' ')
    .replace(/^from:.*$/gim, ' ');
  const words = text.toLowerCase().match(/[a-z]{2,}/g) || [];
  // Nothing written at all (or only punctuation / single letters).
  if (words.join('').length < 3) return true;
  // Keyboard-mash: a word is gibberish if it has (almost) no vowels or a huge consonant run.
  // Thresholds are loose on purpose so Zulu / Sotho / Xhosa / Afrikaans text is not flagged.
  const gibberish = (w) => {
    if (w.length < 6) return false;
    const vowels = (w.match(/[aeiouy]/g) || []).length;
    return vowels === 0 || vowels / w.length < 0.15 || /[^aeiouy]{7,}/.test(w);
  };
  const bad = words.filter(gibberish).length;
  // Unclear only when gibberish is present AND there is too little readable text to act on.
  return bad > 0 && words.length - bad < 4;
}

function unclearClassification() {
  return {
    issue: 'Message unclear', od: 'Group CA', risk: 'Low', sentiment: 'Neutral', priority: 'P3',
    sla: '8 hours', owner: 'Corporate Affairs Queue', duplicate: 'No strong match', score: 10,
    unclear: true,
    reasoning: 'The message could not be understood, so it was routed to Group Corporate Affairs to follow up with the sender.',
  };
}

function mockClassify(message, stakeholderType, history) {
  const lower = message.toLowerCase();
  let issue = 'General stakeholder enquiry', od = 'Group CA', risk = 'Medium',
    sentiment = 'Neutral', priority = 'P2', sla = '4 hours', owner = 'Corporate Affairs Queue';

  if (/crossing|train|rail|wagon|capacity|slot/.test(lower)) {
    issue = /crossing|child|hurt|safety/.test(lower) ? 'Rail crossing safety' : 'Rail operations / capacity';
    od = 'TFR'; owner = 'TFR Stakeholder Relations';
  }
  if (/port|permit|terminal|berth/.test(lower)) { issue = 'Port access / operations'; od = 'TNPA'; owner = 'TNPA Stakeholder Relations'; }
  if (/pipeline|fuel|petrol|diesel/.test(lower)) { issue = 'Pipeline / fuel supply'; od = 'TPL'; owner = defaultOwner('TPL'); }
  if (/lease|tenant|property|encroach|land\b/.test(lower)) { issue = 'Property / land matter'; od = 'Property'; owner = defaultOwner('Property'); }
  if (/container|cargo|stevedor/.test(lower)) { issue = 'Terminal operations'; od = 'TPT'; owner = defaultOwner('TPT'); }
  if (/signal|track maintenance|infrastructure|electrification/.test(lower)) { issue = 'Rail infrastructure'; od = 'TRIM'; owner = defaultOwner('TRIM'); }
  if (/payment|invoice|supplier/.test(lower)) { issue = 'Supplier payment'; od = 'TE'; owner = 'Supplier Resolution Desk'; }
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


async function classifyInteraction({ message, stakeholderType, province, stakeholder, history }) {
  const { area, location, text: senderText } = splitFormMessage(message);

  // Unreadable messages never need the AI: send them straight to Group CA.
  if (looksUnclear(senderText)) return unclearClassification();

  if (String(process.env.MOCK_AI).toLowerCase() === 'true') {
    await new Promise((r) => setTimeout(r, 600));
    return mockClassify(senderText, stakeholderType, history);
  }

  const historyBlock =
    Array.isArray(history) && history.length
      ? `\n\nRecent prior cases from this stakeholder (only for duplicate detection — do NOT let them change how this message is classified):\n${history
          .slice(0, 5)
          .map((h) => `- [${h.created}] ${h.issue}: ${h.message}`)
          .join('\n')}`
      : '';

  const prompt = `You are the triage engine for Transnet Connect, a stakeholder engagement platform. Read the sender's message carefully and classify what the SENDER ACTUALLY WROTE. Respond with ONLY a JSON object — no markdown fences, no commentary.

PRECISION RULES (most important):
1. Base every field on the sender's own words in "WHAT THE SENDER WROTE". Never invent needs, requests or facts they did not state (for example, do not assume a funding request, complaint or emergency unless they said so).
2. "AREA PICKED ON THE FORM" is only a dropdown choice and is often wrong or generic. It must NOT decide the issue type. Use it only as a tie-breaker when the message itself gives no clue about who should handle it. If the message contradicts the picked area, trust the message.
3. The issue label must say specifically what the sender is reporting or asking, in 2-6 plain words (good: "Report form typing box fault", "Level crossing safety hazard", "Supplier payment delay"; bad: "General enquiry", "Funding and mentorship request" when they never asked for funding).
4. Problems with this website, the enquiry form, Transnet Connect or other digital channels (typing box, buttons, page errors, login, slow site) are platform feedback: od = "Group CA", issue like "Website / form fault". Use the sender's actual words to name the fault.
5. If the message is genuinely too vague to classify, say so in "reasoning", keep od = "Group CA" and use confidence "Low". Do not guess a specific topic.
6. "summary" must restate only what the message says, in one neutral sentence. "evidence" must be a SHORT exact quote (max 12 words) copied from the sender's message that justifies the issue label.

Operating divisions (od): "Group CA" = media, reputation, government/regulator relations, website/platform feedback and anything unclear; "TFR" = freight rail operations, level crossings, wagons, train movements; "TRIM" = rail network infrastructure (track, signalling, electrification, maintenance); "TNPA" = port authority matters (port access, permits, berths, marine); "TPT" = port terminal and cargo-handling operations; "TE" = engineering, locomotives/wagons manufacturing and repair, procurement and supplier payments; "TPL" = fuel pipelines; "Property" = land, leases, tenants, encroachment.

Priority / risk guide: P1 / High = danger to people, accidents, major disruption, legal threat, media or regulator escalation (SLA 1 hour). P2 / Medium = a real service problem, fault or complaint affecting the sender (SLA 4 hours). P3 / Low = information requests, general feedback, minor faults, compliments (SLA 8 hours).

Examples:
- Message: "the box where I type my message keeps jumping and I cannot see what I wrote" -> issue "Report form typing box fault", od "Group CA", P3 or P2, evidence "box where I type my message keeps jumping".
- Message: "there is a child hurt at the crossing near our school" -> issue "Rail crossing injury", od "TFR", P1, High.
- Message: "I want to apply for a bursary" -> issue "Bursary application enquiry", od "Group CA", P3.

Stakeholder type: ${stakeholderType || 'Unknown'}
Province: ${province || (location ? location : 'Unknown')}
Organisation / sender: ${stakeholder || 'Unknown'}
AREA PICKED ON THE FORM (weak hint only): ${area || 'None'}
WHAT THE SENDER WROTE: ${JSON.stringify(senderText)}${historyBlock}

Return JSON with exactly these fields, in this order:
{
  "summary": string (one neutral sentence of what the sender wrote),
  "evidence": string (short exact quote from the sender's message),
  "issue": string (specific 2-6 word label),
  "od": one of ${JSON.stringify(ALLOWED_OD)},
  "risk": one of ${JSON.stringify(ALLOWED_RISK)},
  "sentiment": one of ${JSON.stringify(ALLOWED_SENTIMENT)},
  "priority": one of ${JSON.stringify(ALLOWED_PRIORITY)},
  "sla": string (e.g. "1 hour", "4 hours", "8 hours"),
  "owner": string (suggested owning team, e.g. "TFR Stakeholder Relations"),
  "duplicate": string (short note on whether this matches a prior theme, or "No strong match"),
  "score": integer 0-100 (reputational/operational risk score),
  "confidence": one of ["High", "Medium", "Low"] (how sure you are the issue label matches what they wrote),
  "reasoning": string (one sentence explaining the classification for an internal reviewer)
}`;

  // Generous budget: reasoning models spend part of it on hidden reasoning before the JSON answer.
  const text = await callOpenAI({ prompt, maxOutputTokens: 4000 });

  let parsed;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw e;
      parsed = JSON.parse(match[0]);
    } catch (e2) {
      const err = new Error('Malformed AI response');
      err.status = 502;
      throw err;
    }
  }

  if (!ALLOWED_OD.includes(parsed.od)) parsed.od = normaliseOd(parsed.od) || 'Group CA';
  if (!ALLOWED_RISK.includes(parsed.risk)) parsed.risk = 'Medium';
  if (!ALLOWED_SENTIMENT.includes(parsed.sentiment)) parsed.sentiment = 'Neutral';
  if (!ALLOWED_PRIORITY.includes(parsed.priority)) parsed.priority = 'P2';
  if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 100) {
    parsed.score = parsed.risk === 'High' ? 86 : parsed.risk === 'Medium' ? 58 : 24;
  }

  // Guard against hallucinated labels: the quoted evidence must really appear in what they wrote.
  const evidence = norm(parsed.evidence);
  if (!evidence || !norm(senderText).includes(evidence)) {
    parsed.confidence = 'Low';
    parsed.reasoning = `${parsed.reasoning || ''} (Quoted evidence not found in the message — please review the issue label.)`.trim();
  }
  if (!['High', 'Medium', 'Low'].includes(parsed.confidence)) parsed.confidence = 'Medium';

  return parsed;
}

module.exports = { classifyInteraction };