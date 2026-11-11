// Shared email helpers (Resend). Used by public/submit, cases/[id] and webhooks/email.
//
// Env vars:
//   RESEND_API_KEY   Resend API key (sending access is enough here)
//   RESEND_FROM      e.g. Transnet Connect <noreply@notifications.mhospitalitygroup.co.za>
//   RESEND_REPLY_TO  optional, e.g. info@mhospitalitygroup.co.za

/** "Name <a@b.com>" or "a@b.com" -> "a@b.com" (lower-case), or null if there is no valid address. */
function parseAddress(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/<([^<>\s]+@[^<>\s]+)>/) || value.match(/([^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

/** True for addresses we must never auto-reply to (loop / bounce protection). */
function isAutomatedSender(address) {
  const a = parseAddress(address);
  if (!a) return true;
  const local = a.split('@')[0];
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces|notifications?|auto-?reply)/.test(local)) return true;
  const own = parseAddress(process.env.RESEND_FROM);
  if (own && own === a) return true;
  if (a.endsWith('@notifications.mhospitalitygroup.co.za')) return true;
  return false;
}

/**
 * Turns whatever we stored as a contact "name" into something safe to greet.
 *   "Una Qamza <una@x.com>"   -> "Una Qamza"
 *   "Thandi (+27821234567)"   -> "Thandi"
 *   "una.qamza@gmail.com"     -> "Una Qamza"   (best guess from the address)
 *   "info@company.co.za", "Unknown sender", "Anonymous" -> ""  (greeting falls back to "Hello,")
 */
const GENERIC_LOCALS = /^(info|admin|support|sales|contact|enquir(y|ies)|hello|office|mail|team|accounts?|billing|help|service|reception|webmaster)$/i;
function friendlyName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.replace(/<[^<>]*>/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (/^(unknown sender|anonymous|general public)$/i.test(s)) return '';
  if (!s || s.includes('@')) {
    const addr = parseAddress(raw);
    if (!addr) return '';
    const local = addr.split('@')[0];
    if (GENERIC_LOCALS.test(local)) return '';
    s = local.replace(/\+.*$/, '').replace(/[._-]+/g, ' ').replace(/[0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length < 2) return '';
  }
  return s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').trim();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wrap(title, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <h2 style="border-bottom:3px solid #d62027;padding-bottom:8px">${esc(title)}</h2>${bodyHtml}
  <p style="color:#888;font-size:12px;margin-top:24px">Transnet Connect &bull; Stakeholder Management</p></div>`;
}

function acknowledgementEmail({ name: rawName, reference, divisionLabel }) {
  const name = friendlyName(rawName);
  const hi = name ? `Hi ${esc(name)},` : 'Hello,';
  const where = divisionLabel ? ` It has been directed to <b>${esc(divisionLabel)}</b>.` : '';
  return {
    subject: `We received your enquiry (${reference})`,
    html: wrap('We received your enquiry', `<p>${hi}</p><p>Thank you for contacting Transnet. Your reference number is <b>${esc(reference)}</b>.${where} Please quote it in any follow-up.</p>`),
    text: `${name ? `Hi ${name},` : 'Hello,'}\n\nThank you for contacting Transnet. Your reference number is ${reference}. Please quote it in any follow-up.`,
  };
}

function resolvedEmail({ name: rawName, reference, issue }) {
  const name = friendlyName(rawName);
  const hi = name ? `Hi ${esc(name)},` : 'Hello,';
  return {
    subject: `Your enquiry ${reference} has been resolved`,
    html: wrap('Your enquiry has been resolved', `<p>${hi}</p><p>Your enquiry <b>${esc(reference)}</b>${issue ? ` (${esc(issue)})` : ''} has been marked as resolved.</p>`),
    text: `${name ? `Hi ${name},` : 'Hello,'}\n\nYour enquiry ${reference}${issue ? ` (${issue})` : ''} has been marked as resolved.`,
  };
}

const STATUS_COPY = {
  'Open': {
    subject: 'is open',
    headline: 'Your enquiry is open',
    line: 'is open and waiting to be picked up by the team responsible.',
  },
  'In Progress': {
    subject: 'is now in progress',
    headline: 'Your enquiry is in progress',
    line: 'is now being worked on by the team responsible.',
  },
  'Escalated': {
    subject: 'has been escalated',
    headline: 'Your enquiry has been escalated',
    line: 'has been escalated for urgent attention by a senior team.',
  },
};

/** Sent every time a case moves to a new status (Resolved has its own wording in resolvedEmail). */
function statusUpdateEmail({ name: rawName, reference, issue, status }) {
  if (status === 'Resolved') return resolvedEmail({ name: rawName, reference, issue });
  const name = friendlyName(rawName);
  const copy = STATUS_COPY[status] || { subject: `is now ${status}`, headline: 'Your enquiry has been updated', line: `has been updated. Its status is now ${status}.` };
  const hi = name ? `Hi ${esc(name)},` : 'Hello,';
  const issuePart = issue ? ` (${esc(issue)})` : '';
  return {
    subject: `Your enquiry ${reference} ${copy.subject}`,
    html: wrap(copy.headline, `<p>${hi}</p><p>Your enquiry <b>${esc(reference)}</b>${issuePart} ${copy.line}</p><p>Current status: <b>${esc(status)}</b>. Please quote <b>${esc(reference)}</b> in any follow-up.</p>`),
    text: `${name ? `Hi ${name},` : 'Hello,'}\n\nYour enquiry ${reference}${issue ? ` (${issue})` : ''} ${copy.line}\nCurrent status: ${status}. Please quote ${reference} in any follow-up.`,
  };
}

/** Returns { sent: boolean, ... }. Never throws for "not configured". */
async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from || !to) {
    console.warn('[email] not sent — missing', !apiKey ? 'RESEND_API_KEY' : !from ? 'RESEND_FROM' : 'recipient');
    return { sent: false, reason: 'not configured or no recipient' };
  }

  const body = { from, to: [to], subject, html, text };
  if (process.env.RESEND_REPLY_TO) body.reply_to = process.env.RESEND_REPLY_TO;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = new Error(`Resend send failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const out = await res.json();
  console.log('[email] sent', subject, '->', to, out.id || '');
  return { sent: true, ...out };
}

module.exports = { parseAddress, isAutomatedSender, friendlyName, acknowledgementEmail, resolvedEmail, statusUpdateEmail, sendEmail };
