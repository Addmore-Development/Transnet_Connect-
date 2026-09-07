// /api/seed.js
// POST /api/seed -> wipes the cases table and reinserts the original demo
// dataset. Backs the "Reset demo data" button. Same 7 rows that used to
// live in app.js's seedCases constant.

const { sbDeleteAll, sbInsert } = require('./_supabaseClient');

const SEED_CASES = [
  { id: 'TC-2026-1042', created: '31 Aug 09:18', stakeholder: 'Ekurhuleni Community Forum', name: 'Thandi Mokoena', type: 'Community', channel: 'WhatsApp', issue: 'Rail crossing safety', od: 'TFR', owner: 'S. Molefe', risk: 'High', status: 'Escalated', sla: '42m', province: 'Gauteng', sentiment: 'Negative', message: 'Children crossing between stationary wagons. Recurring community complaint.' },
  { id: 'TC-2026-1041', created: '31 Aug 08:52', stakeholder: 'LogiPro SA', name: 'Marcus Dube', type: 'Customer', channel: 'Email', issue: 'Port access permit', od: 'TNPA', owner: 'P. Daniels', risk: 'Medium', status: 'In Progress', sla: '2h 14m', province: 'KwaZulu-Natal', sentiment: 'Neutral', message: 'Access permit still pending for Richards Bay.' },
  { id: 'TC-2026-1038', created: '31 Aug 07:44', stakeholder: 'National Freight Forum', name: 'Lerato Khumalo', type: 'Industry', channel: 'Contact Centre', issue: 'Rail capacity allocation', od: 'TFR', owner: 'R. Nkosi', risk: 'High', status: 'Open', sla: '1h 05m', province: 'Gauteng', sentiment: 'Negative', message: 'Member operators requesting clarity on allocation process.' },
  { id: 'TC-2026-1034', created: '30 Aug 16:10', stakeholder: 'Ubuntu Engineering', name: 'Sipho Ndlovu', type: 'Supplier', channel: 'Web / QR', issue: 'Supplier payment', od: 'TE', owner: 'A. Naidoo', risk: 'Medium', status: 'In Progress', sla: '4h 32m', province: 'Gauteng', sentiment: 'Negative', message: 'Payment overdue beyond agreed terms.' },
  { id: 'TC-2026-1029', created: '30 Aug 14:22', stakeholder: 'City of Cape Town', name: 'Helen Jacobs', type: 'Government', channel: 'Email', issue: 'Port-city coordination', od: 'TNPA', owner: 'M. Adams', risk: 'Low', status: 'Resolved', sla: 'Met', province: 'Western Cape', sentiment: 'Positive', message: 'Coordination request for upcoming precinct works.' },
  { id: 'TC-2026-1024', created: '30 Aug 11:09', stakeholder: 'KwaMashu Residents Assoc.', name: 'Nomusa Dlamini', type: 'Community', channel: 'WhatsApp', issue: 'Noise & train movements', od: 'TFR', owner: 'B. Mthembu', risk: 'Medium', status: 'Open', sla: '3h 40m', province: 'KwaZulu-Natal', sentiment: 'Negative', message: 'Night train movements affecting nearby residents.' },
  { id: 'TC-2026-1017', created: '29 Aug 15:36', stakeholder: 'RailWatch Media', name: 'Gugu Cele', type: 'Media', channel: 'Contact Centre', issue: 'Media query', od: 'Group CA', owner: 'T. Mokoena', risk: 'High', status: 'Escalated', sla: '25m', province: 'Gauteng', sentiment: 'Negative', message: 'Media query linked to freight derailment.' },
  { id: 'TC-2026-1011', created: '29 Aug 10:24', stakeholder: 'BlueRock Mining', name: 'James Nel', type: 'Customer', channel: 'Email', issue: 'Service reliability', od: 'TFR', owner: 'S. Molefe', risk: 'Medium', status: 'In Progress', sla: '5h 18m', province: 'Limpopo', sentiment: 'Neutral', message: 'Request for updated recovery plan and slot reliability.' },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await sbDeleteAll('cases');
    const inserted = await sbInsert('cases', SEED_CASES);
    return res.status(200).json({ reset: true, count: inserted.length });
  } catch (err) {
    console.error('seed endpoint error:', err.status, err.body || err.message);
    return res.status(502).json({ error: 'Database reset failed' });
  }
};
