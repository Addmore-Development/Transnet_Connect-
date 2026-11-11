const { sbInsert, sbUpdate } = require('./_supabaseClient');
const { htmlToText } = require('./_htmlToText');
const { divisionFromPayload, normaliseOd, defaultOwner } = require('./_divisions');
const { newCaseRef } = require('./_caseRef');
const { parseAddress, friendlyName } = require('./_email');

const CHANNEL_CONFIG = {
  raw_emails: {
    channel: 'Email',
    toCaseFields: (raw) => ({
      stakeholder: 'General Public', // individual emails aren't tied to a known org — grouped generically
      name: friendlyName(raw.from_address) || 'Unknown sender', // the address itself is kept in contact_email
      type: 'Community',
      province: null,
      contact_email: parseAddress(raw.from_address),
      contact_phone: null, // emails carry no phone number
      message: htmlToText(raw.body_text || raw.body_html) || raw.subject,
    }),
  },
  raw_messages: {
    channel: 'SMS', // overridden per-row below (WhatsApp vs SMS)
    toCaseFields: (raw) => ({
      channel: raw.channel || 'SMS',
      stakeholder: 'General Public',
      name: raw.profile_name ? `${raw.profile_name} (${raw.from_number})` : raw.from_number || 'Unknown sender',
      type: 'Community',
      province: null,
      contact_email: null, // SMS / WhatsApp senders have no email address
      contact_phone: raw.from_number || null, // the number they messaged from
      message: raw.body_text || '[Media attachment]',
    }),
  },
  raw_webform: {
    channel: 'Web / QR',
    toCaseFields: (raw) => ({
      stakeholder: raw.organisation || 'General Public',
      name: raw.name || 'Anonymous',
      type: raw.stakeholder_type || 'Community',
      province: raw.province || null,
      contact_email: parseAddress(raw.email) || parseAddress(raw.payload && raw.payload.email),
      contact_phone: (raw.payload && typeof raw.payload.phone === 'string' && raw.payload.phone.trim()) || null,
      message: raw.message,
    }),
  },
};




/** Creates the case for a raw inbox row and marks the row processed (so it leaves the intake list). */
async function createCaseFromRaw({ table, raw, classification }) {
  const config = CHANNEL_CONFIG[table];
  const caseFields = config.toCaseFields(raw);

  // Routing is decided on the server, never trusted from the browser: the
  // enquirer's chosen division wins, otherwise the (validated) AI suggestion.
  const directed = table === 'raw_webform' ? divisionFromPayload(raw) : null;
  const od = directed || normaliseOd(classification.od) || 'Group CA';
  const owner = directed && normaliseOd(classification.od) !== directed ? defaultOwner(directed) : classification.owner;

  // Use the reference number the enquirer was already emailed; only mint a new one otherwise.
  const caseId = raw.reference || await newCaseRef();

  const [newCase] = await sbInsert('cases', [{
    id: caseId,
    created: new Date().toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    channel: config.channel,
    ...caseFields,
    issue: classification.issue,
    od,
    owner,
    risk: classification.risk,
    status: classification.risk === 'High' ? 'Escalated' : 'Open',
    sla: classification.sla,
    sentiment: classification.sentiment,
  }]);

  await sbUpdate(table, raw.id, { processed: true, case_id: caseId });
  return newCase;
}

module.exports = { CHANNEL_CONFIG, createCaseFromRaw };
