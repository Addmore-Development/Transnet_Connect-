// /api/_geminiClient.js
// Shared helper for calling the Gemini API with automatic retry on
// transient 503 "model overloaded" errors, which are common on the free
// tier during peak demand and usually clear up within a second or two.
// Not a bug to "fix" once — this is expected, ongoing behavior of a free
// shared model, so the retry lives here permanently rather than being a
// one-off patch.

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Gemini's generateContent endpoint, retrying a couple of times on
 * 503 (model overloaded) with a short delay between attempts. Returns the
 * parsed response body on success. Throws an Error with `.status` and
 * `.body` set on final failure, so callers can log/respond appropriately.
 */
async function callGemini({ model, apiKey, prompt, maxOutputTokens }) {
  const maxAttempts = 3;
  const retryDelaysMs = [1000, 2500]; // wait 1s after attempt 1, 2.5s after attempt 2

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (response.ok) {
      return await response.json();
    }

    const errText = await response.text();
    lastError = new Error(`Gemini API error ${response.status}`);
    lastError.status = response.status;
    lastError.body = errText;

    // Only retry on 503 (overloaded) — other errors (401, 404, 400) won't
    // fix themselves on retry, so fail fast on those instead of wasting
    // free-tier quota on doomed repeat calls.
    if (response.status !== 503 || attempt === maxAttempts) {
      throw lastError;
    }

    console.warn(`Gemini 503 (attempt ${attempt}/${maxAttempts}), retrying in ${retryDelaysMs[attempt - 1]}ms...`);
    await sleep(retryDelaysMs[attempt - 1]);
  }

  throw lastError;
}

module.exports = { callGemini };
