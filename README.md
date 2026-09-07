# Transnet Connect — Stakeholder Management Connector

Front-end prototype demonstrating a unified stakeholder engagement and intelligence platform.

## Open the prototype
1. Open `login.html` in Chrome or Edge.
2. Demo credentials: `demo@transnet.net` / `Transnet2026!`.
3. The demo login stores a local browser session and redirects into `index.html`.
4. Use **Sign out** in the top-right corner to return to the login page.

## Corporate colour treatment
The prototype uses Transnet's principal corporate colours:
- Transnet Red — Pantone 485 C — RGB 212 / 41 / 46 — `#D4292E`
- Transnet Green — Pantone 376 C — RGB 125 / 190 / 0 — `#7DBE00`

White and charcoal are used as supporting interface neutrals.

## Important
This is a front-end demonstration, not production authentication. A production implementation should use Transnet-approved SSO/MFA, identity management, audit logging, session controls, encryption, data residency and enterprise security standards.


## Questionnaire integration
- `index.html` now includes a **Questionnaire** tab in the internal platform.
- `questionnaire.html` provides a branded full-page public questionnaire view.
- Both embed the supplied Zoho Form URL and include a direct-open fallback link.
- In a production Zoho implementation, questionnaire responses can be routed through Zoho Flow/Creator into CRM, Desk cases and Analytics.
