// /api/_caseRef.js
// One place that hands out case reference numbers (TC-2026-1043, ...).
// The number is reserved the moment an enquiry arrives, so the acknowledgement
// email can quote it, and the same number becomes the case id when an admin
// confirms the enquiry in the inbox.
//
// Needs supabase_resend_migration.sql to have been run (it creates next_case_ref()).

const { sbRpc } = require('./_supabaseClient');

async function newCaseRef() {
  const ref = await sbRpc('next_case_ref');
  if (typeof ref !== 'string' || !/^TC-\d{4}-\d+$/.test(ref)) {
    throw new Error(`next_case_ref() returned something unexpected: ${JSON.stringify(ref)}`);
  }
  return ref;
}

module.exports = { newCaseRef };
