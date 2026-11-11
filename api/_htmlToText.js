// Converts an email body (HTML or plain text) into clean plain text.
// Strips tags, drops <style>/<script>, keeps line breaks for block elements,
// and decodes common HTML entities. Safe to call on text that has no HTML.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function htmlToText(input) {
  if (!input) return '';
  let s = String(input);

  s = s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);

  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { htmlToText };
