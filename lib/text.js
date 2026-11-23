const SLUG_BUF = Buffer.allocUnsafe(64);

export const SLUG_MAX = 64;

const RE_ESC_TEST = /[&<>"']/;
const RE_ESC_G = /[&<>"']/g;
const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function replaceEsc(c) {
  return ESC_MAP[c];
}

export function escapeHtml(text) {
  if (!RE_ESC_TEST.test(text)) return text;
  return text.replace(RE_ESC_G, replaceEsc);
}

export function escapeHtmlRange(text, start, end) {
  const sub = text.slice(start, end);
  if (!RE_ESC_TEST.test(sub)) return sub;
  return sub.replace(RE_ESC_G, replaceEsc);
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
