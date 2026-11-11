// POST /api/public/submit — public enquiry form (web / QR).
// Reserves a case reference number, stores the submission, and emails the
// enquirer an acknowledgement quoting that reference.
//
// Body: { firstName, lastName, email, phone, stakeholderType, province, location, area, category?, division?, message }
//   - The form is South Africa only: `province` must be one of the nine provinces and `location` is the city / town / area.
//   - `stakeholderType` is one of STAKEHOLDER_TYPES below.
//   - `division` is only sent when the person picked a specific operating division;
//     that choice then decides routing. For every other area it is omitted and the
//     AI / admin routes the enquiry when it is confirmed in the inbox.

const { sbInsert } = require('../_supabaseClient');
const { isDivisionCode, labelFor } = require('../_divisions');
const { newCaseRef } = require('../_caseRef');
const { sendEmail, parseAddress, acknowledgementEmail } = require('../_email');

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

const STAKEHOLDER_TYPES = ['Community', 'Customer', 'Government', 'Investor', 'Supplier', 'Media', 'Regulator', 'Employee', 'Parliamentary', 'Other'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const contactEmail = parseAddress(str(body.email, 254));
  const phone = str(body.phone, 30);
  const stakeholderType = str(body.stakeholderType, 40);
  const province = str(body.province, 80);
  const location = str(body.location, 120);
  const area = str(body.area, 120);
  const category = str(body.category, 120);
  const text = str(body.message, 4000);
  const division = body.division === undefined || body.division === null || body.division === '' ? null : body.division;

  if (!firstName || !lastName) return res.status(400).json({ error: 'Please enter your first name and last name.' });
  if (!contactEmail) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!STAKEHOLDER_TYPES.includes(stakeholderType)) return res.status(400).json({ error: 'Please select who this enquiry is from.' });
  if (!/^[0-9+()\-\s.]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (!PROVINCES.includes(province)) return res.status(400).json({ error: 'Please select the province you are from.' });
  if (location.length < 2) return res.status(400).json({ error: 'Please tell us the city, town or area you are from.' });

  if (!area) return res.status(400).json({ error: 'Please select your area of enquiry.' });
  if (!text) return res.status(400).json({ error: 'Please tell us about your enquiry.' });
  if (division !== null && !isDivisionCode(division)) {
    return res.status(400).json({ error: 'Unknown division selected.' });
  }

  // The classifier and the case view only see `message`, so put the chosen area/category in it.
  const context = [area, category].filter(Boolean).join(' › ');
  const message = `Area of enquiry: ${context}\nFrom: ${[location, province].filter(Boolean).join(', ')}\nStakeholder type: ${stakeholderType}\nPhone: ${phone}\n\n${text}`;

  // Reserve the reference first. If that fails we still save the enquiry (the
  // inbox will assign a number when it is confirmed) — we just can't quote one yet.
  let reference = null;
  try {
    reference = await newCaseRef();
  } catch (refErr) {
    console.error('[public/submit] could not reserve a reference number:', refErr.message, refErr.body || '');
  }

  try {
    await sbInsert('raw_webform', [{
      name: `${firstName} ${lastName}`,
      email: contactEmail,
      organisation: null,
      stakeholder_type: stakeholderType,
      province,
      location,
      message,
      reference,
      // `division` here is what routing reads (divisionFromPayload) — only set for operating divisions.
      payload: { firstName, lastName, email: contactEmail, phone, stakeholderType, province, location, area, category: category || null, division, message: text },
    }]);
  } catch (err) {
    console.error('[public/submit] failed to store submission:', err.status, err.body || err.message);
    return res.status(500).json({ error: 'Failed to submit — please try again.' });
  }

  // Must be awaited: on Vercel the function is frozen as soon as the response is sent.
  if (reference) {
    try {
      await sendEmail({
        to: contactEmail,
        ...acknowledgementEmail({ name: firstName, reference, divisionLabel: division ? labelFor(division) : null }),
      });
    } catch (mailErr) {
      console.error('[public/submit] acknowledgement email failed:', mailErr.message);
    }
  }

  return res.status(200).json({ ok: true, reference });
};
