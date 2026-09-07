# Adding real AI analysis — setup notes

## What changed
- `api/analyse.js` — new Vercel serverless function. Calls the Claude API
  server-side and returns a structured JSON classification for a single
  intake message. Supports `MOCK_AI=true` for free offline testing.
- `api/insights.js` — new Vercel serverless function. Takes the whole current
  `cases` array and returns commonalities, anomalies, an executive summary,
  and recommended actions across the full case set. Also supports
  `MOCK_AI=true`.
- `app.js` — the old `analyse()` (regex/keyword classifier) was renamed to
  `analyseLocal()` and kept as an offline fallback for the intake form. A new
  `analyse()` now calls `POST /api/analyse` and falls back to
  `analyseLocal()` on failure. A new "Generate insight" button on the
  Intelligence tab calls `POST /api/insights` and renders the result.
- `index.html` — added an AI insight panel to the Intelligence view, above
  the existing trend/sentiment/cluster panels.

## Deploying
1. Push this project to a GitHub repo (or import the folder directly) and
   connect it to a new Vercel project. Vercel auto-detects anything under
   `/api` as a serverless function — no framework or build step required
   for a static site like this one.
2. In the Vercel project settings → **Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
   Do this in the dashboard only — never commit the key or put it in
   `app.js`/any file that ships to the browser.
3. Deploy. The frontend calls `/api/analyse` as a relative path, so it
   works automatically on whatever domain Vercel assigns (or your custom
   domain) without any config changes in `app.js`.

## Testing locally
If you use the Vercel CLI:
```
npm i -g vercel
vercel dev
```
This runs both the static site and the `/api` functions locally and
proxies `/api/analyse` correctly. Opening `index.html` directly as a
`file://` URL will NOT work for the AI call (no server to hit) — it'll
just fall back to the local heuristic, which is fine for offline demos.

## Production hardening (before this goes near real Transnet data)
- Add auth to `/api/analyse` (this repo's login is client-side only —
  see the README's existing warning about SSO/MFA).
- Rate-limit the endpoint per user/session.
- Log requests/responses for audit purposes (no PII in logs beyond what's
  already in the case data).
- Consider caching identical/near-identical messages to control API cost.
