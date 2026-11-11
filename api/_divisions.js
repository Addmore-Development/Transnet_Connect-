// /api/_divisions.js
// Single source of truth for Transnet operating divisions on the server.
// `code` is what gets stored in cases.od and in each division user's
// app_metadata.division; `label` is what people see.

const DIVISIONS = [
  { code: 'Group CA', label: 'Group Corporate Affairs' },
  { code: 'TFR', label: 'Transnet Freight Rail (TFR)' },
  { code: 'TRIM', label: 'Transnet Rail Infrastructure Manager (TRIM)' },
  { code: 'TNPA', label: 'Transnet National Ports Authority (TNPA)' },
  { code: 'TPT', label: 'Transnet Port Terminals (TPT)' },
  { code: 'TE', label: 'Transnet Engineering (TE)' },
  { code: 'TPL', label: 'Transnet Pipelines (TPL)' },
  { code: 'Property', label: 'Transnet Property' },
];

const CODES = DIVISIONS.map((d) => d.code);

// Older cases / AI output used these spellings.
const LEGACY = { 'te / scm': 'TE' };

function isDivisionCode(value) {
  return typeof value === 'string' && CODES.includes(value);
}

/** Maps any stored `od` value (including legacy ones) to a division code, or null. */
function normaliseOd(od) {
  if (typeof od !== 'string') return null;
  const trimmed = od.trim();
  if (CODES.includes(trimmed)) return trimmed;
  return LEGACY[trimmed.toLowerCase()] || null;
}

function labelFor(code) {
  const d = DIVISIONS.find((x) => x.code === code);
  return d ? d.label : code;
}

function defaultOwner(code) {
  return code === 'Group CA' ? 'Corporate Affairs Queue' : `${code} Stakeholder Relations`;
}

/** The division an enquirer picked on the public report form (stored in raw_webform.payload). */
function divisionFromPayload(raw) {
  let p = raw && raw.payload;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch (e) { p = null; }
  }
  return p && isDivisionCode(p.division) ? p.division : null;
}

/** Admins see every case; division users only see cases directed to their division. */
function canSeeCase(user, row) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return normaliseOd(row && row.od) === user.division;
}

module.exports = { DIVISIONS, CODES, isDivisionCode, normaliseOd, labelFor, defaultOwner, divisionFromPayload, canSeeCase };
