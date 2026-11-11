

const DEFAULT_MODEL = 'gpt-6-luna';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2500];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiError(status, message, body) {
  const err = new Error(message);
  err.status = status;
  err.body = body;
  return err;
}

/** Turns an OpenAI failure into an error whose message is safe to show in the UI. */
function friendlyError(status, bodyText) {
  let code = '';
  try { code = (JSON.parse(bodyText).error || {}).code || ''; } catch (e) { /* not JSON */ }
  if (status === 401) return apiError(status, 'AI service is not configured correctly (check OPENAI_API_KEY).', bodyText);
  if (status === 429 && code === 'insufficient_quota') return apiError(status, 'AI quota exhausted — check billing on the OpenAI account.', bodyText);
  if (status === 429 || status === 503) return apiError(status, 'AI service is busy — please try again shortly.', bodyText);
  if (status === 404) return apiError(status, 'AI model not found (check OPENAI_MODEL).', bodyText);
  return apiError(status, `AI request failed (${status}).`, bodyText);
}

function retryDelay(response, attempt) {
  const header = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
  if (header > 0) return Math.min(header * 1000, 5000);
  return DEFAULT_RETRY_DELAYS_MS[attempt - 1] || 2500;
}

async function post(body) {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Sends one prompt and returns the model's text answer (a JSON string, since
 * we ask for JSON). Retries on rate-limit / overload errors. Throws an Error
 * with `.status` (and `.body` for logging) on final failure.
 */
async function callOpenAI({ prompt, maxOutputTokens }) {
  const body = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    // For reasoning models this budget covers the hidden reasoning as well as the
    // answer, so callers pass a generous number to avoid truncated JSON.
    max_completion_tokens: maxOutputTokens,
    response_format: { type: 'json_object' },
  };
  if (process.env.OPENAI_REASONING_EFFORT) body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT;

  let droppedJsonMode = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await post(body);
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw apiError(504, 'AI service timed out — please try again.', String(e));
      }
      throw apiError(502, 'Could not reach the AI service.', String(e));
    }

    if (response.ok) {
      const data = await response.json();
      const choice = data.choices && data.choices[0];
      const text = choice && choice.message && choice.message.content;
      if (choice && choice.finish_reason === 'length') {
        throw apiError(502, 'AI response was cut off — please try again.', JSON.stringify(data.usage || {}));
      }
      if (!text) {
        throw apiError(502, 'No text response from model', JSON.stringify(data));
      }
      return text;
    }

    const errText = await response.text();

    // If a model rejects JSON mode, retry once without it — our parsers cope with plain text JSON.
    if (response.status === 400 && !droppedJsonMode && /response_format/i.test(errText)) {
      droppedJsonMode = true;
      delete body.response_format;
      console.warn('OpenAI rejected response_format; retrying without JSON mode.');
      attempt--;
      continue;
    }

    let code = '';
    try { code = (JSON.parse(errText).error || {}).code || ''; } catch (e) { /* ignore */ }
    const retryable = (response.status === 429 && code !== 'insufficient_quota') || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw friendlyError(response.status, errText);

    const wait = retryDelay(response, attempt);
    console.warn(`OpenAI ${response.status} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${wait}ms...`);
    await sleep(wait);
  }
}

module.exports = { callOpenAI };