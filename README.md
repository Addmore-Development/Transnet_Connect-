# Transnet_Connect-

## Setup: logins, divisions and email

Environment variables (`.env` locally, Vercel > Project Settings > Environment Variables when deployed):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Database + creating logins (server only, never in the browser) |
| `SUPABASE_PUBLISHABLE_KEY` | Used by the server to sign users in and check their session |
| `RESEND_API_KEY`, `RESEND_FROM` | Auto-reply emails to people who submit a report |

Logins live in Supabase Auth. Each user's `app_metadata` decides what they can see:
`{"role":"admin"}` sees everything; `{"role":"division","division":"TFR"}` sees only cases directed to TFR.

- Create / update the accounts: `node scripts/create-division-users.js` (add `--domain=yourdomain.co.za`, `--reset-passwords`)
- Test email sending: `node scripts/test-resend.js you@example.com`
- In Supabase > Authentication, switch off "Allow new users to sign up".
