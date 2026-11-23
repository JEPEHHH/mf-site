const SLUG_BUF = Buffer.allocUnsafe(64);

export const SLUG_MAX = 64;

export function escapeHtml(text) {
  const len = text.length;
  let last = 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c < 34 || c > 62) continue;
    let rep;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    else continue;
    if (last === 0) out = text.slice(0, i) + rep;
    else out += text.slice(last, i) + rep;
    last = i + 1;
  }
  if (last === 0) return text;
  return last < len ? out + text.slice(last) : out;
}

export function escapeHtmlRange(text, start, end) {
  let last = start;
  let out = '';
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c < 34 || c > 62) continue;
    let rep;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    else continue;
    if (last === start) out = text.slice(start, i) + rep;
    else out += text.slice(last, i) + rep;
    last = i + 1;
  }
  if (last === start) return text.slice(start, end);
  return last < end ? out + text.slice(last, end) : out;
}

const COMBINING_MARKS = /\p{M}/gu;

function slugifyPlain(plain) {
  const len = plain.length;
  let n = 0;
  let gap = false;
  for (let i = 0; i < len; i++) {
    let c = plain.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      c += 32;
    } else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      if (n > 0) gap = true;
      continue;
    }
    if (gap) {
      if (n >= 63) break;
      SLUG_BUF[n++] = 45;
      gap = false;
    }
    SLUG_BUF[n++] = c;
    if (n === 64) break;
  }
  return n === 0 ? 'untitled' : SLUG_BUF.toString('latin1', 0, n);
}

export function slugify(text) {
  const len = text.length;
  let n = 0;
  let gap = false;
  for (let i = 0; i < len; i++) {
    let c = text.charCodeAt(i);
    if (c >= 128) {
      return slugifyPlain(text.normalize('NFKD').replace(COMBINING_MARKS, ''));
    }
    if (c >= 65 && c <= 90) {
      c += 32;
    } else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      if (n > 0) gap = true;
      continue;
    }
    if (gap) {
      if (n >= 63) break;
      SLUG_BUF[n++] = 45;
      gap = false;
    }
    SLUG_BUF[n++] = c;
    if (n === 64) break;
  }
  return n === 0 ? 'untitled' : SLUG_BUF.toString('latin1', 0, n);
}

export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  let out = `${slug}-2`;
  while (taken.has(out)) {
    n++;
    out = `${slug}-${n}`;
  }
  taken.add(out);
  return out;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function longDate(date) {
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${date.slice(0, 4)}`;
}
