export const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function parseStringValue(text, start, end, key) {
  const first = text.charCodeAt(start);
  if (first === 34) {
    if (end - start < 2 || text.charCodeAt(end - 1) !== 34) {
      return { error: `key "${key}": a quoted string is not closed` };
    }
    const innerStart = start + 1;
    const innerEnd = end - 1;
    let out = '';
    let last = innerStart;
    for (let i = innerStart; i < innerEnd; i++) {
      const c = text.charCodeAt(i);
      if (c === 92) {
        if (i + 1 >= innerEnd) {
          return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
        }
        const n = text.charCodeAt(i + 1);
        if (n !== 34 && n !== 92) {
          return { error: `key "${key}": a quoted string holds an escape other than \\" or \\\\` };
        }
        out += text.slice(last, i) + (n === 34 ? '"' : '\\');
        i++;
        last = i + 1;
      } else if (c === 34) {
        return { error: `key "${key}": a quoted string holds a stray quote` };
      }
    }
    if (last === innerStart) return { value: text.slice(innerStart, innerEnd) };
    return { value: last < innerEnd ? out + text.slice(last, innerEnd) : out };
  }
  if (first === 91) {
    return { error: `key "${key}": a bare string opens on [` };
  }
  return { value: text.slice(start, end) };
}

function parseDateValue(text, start, end) {
  if (end - start !== 10 || text.charCodeAt(start + 4) !== 45 || text.charCodeAt(start + 7) !== 45) {
    return null;
  }
  const y0 = text.charCodeAt(start) - 48;
  const y1 = text.charCodeAt(start + 1) - 48;
  const y2 = text.charCodeAt(start + 2) - 48;
  const y3 = text.charCodeAt(start + 3) - 48;
  const m0 = text.charCodeAt(start + 5) - 48;
  const m1 = text.charCodeAt(start + 6) - 48;
  const d0 = text.charCodeAt(start + 8) - 48;
  const d1 = text.charCodeAt(start + 9) - 48;
  if (
    (y0 | y1 | y2 | y3 | m0 | m1 | d0 | d1) < 0 ||
    y0 > 9 ||
    y1 > 9 ||
    y2 > 9 ||
    y3 > 9 ||
    m0 > 9 ||
    m1 > 9 ||
    d0 > 9 ||
    d1 > 9
  ) {
    return null;
  }
  const y = y0 * 1000 + y1 * 100 + y2 * 10 + y3;
  const mo = m0 * 10 + m1;
  const d = d0 * 10 + d1;
  if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return text.slice(start, end);
}

function parseTagsValue(text, start, end) {
  if (end - start < 2 || text.charCodeAt(start) !== 91 || text.charCodeAt(end - 1) !== 93) {
    return { error: 'key "tags": not a list [a, b]' };
  }
  const inner = text.slice(start + 1, end - 1);
  if (inner.trim() === '') return { value: [] };
  const tags = [];
  let segStart = 0;
  const len = inner.length;
  for (let i = 0; i <= len; i++) {
    if (i === len || inner.charCodeAt(i) === 44) {
      const t = inner.slice(segStart, i).trim();
      if (t.length === 0) {
        return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      for (let j = 0; j < t.length; j++) {
        const c = t.charCodeAt(j);
        if (c === 34 || c === 91 || c === 93) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      tags.push(t);
      segStart = i + 1;
    }
  }
  return { value: tags };
}

function isLayoutName(text, start, end) {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return end > start;
}

function isValidSlug(text, start, end) {
  const len = end - start;
  if (len === 0 || len > 64) return false;
  let prevDash = true;
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      prevDash = false;
    } else if (c === 45) {
      if (prevDash) return false;
      prevDash = true;
    } else {
      return false;
    }
  }
  return !prevDash;
}

export function parseFrontMatter(text) {
  const len = text.length;
  if (
    len < 3 ||
    text.charCodeAt(0) !== 45 ||
    text.charCodeAt(1) !== 45 ||
    text.charCodeAt(2) !== 45 ||
    (len > 3 && text.charCodeAt(3) !== 10)
  ) {
    return { error: 'no front matter' };
  }
  if (len === 3) return { error: 'the front matter is not closed' };

  // Find closing "---" line before validating lines (preserves exact error priority).
  let closeStart = -1;
  let bodyStart = len;
  let search = 3;
  while (true) {
    const idx = text.indexOf('\n---', search);
    if (idx === -1) return { error: 'the front matter is not closed' };
    const after = idx + 4;
    if (after === len || text.charCodeAt(after) === 10) {
      closeStart = idx + 1;
      bodyStart = after === len ? len : after + 1;
      break;
    }
    search = idx + 1;
  }

  const data = {};
  let pos = 4;
  let lineNum = 2;

  while (pos < closeStart) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 || nl > closeStart ? closeStart : nl;

    if (pos < lineEnd) {
      const first = text.charCodeAt(pos);
      if (first !== 35) {
        // Check if blank line (spaces and tabs only)
        let nonWs = pos;
        while (nonWs < lineEnd) {
          const ch = text.charCodeAt(nonWs);
          if (ch !== 32 && ch !== 9) break;
          nonWs++;
        }
        if (nonWs < lineEnd) {
          // Must match /^([a-z_]+):(?: (.*))?$/
          let kEnd = pos;
          while (kEnd < lineEnd) {
            const ch = text.charCodeAt(kEnd);
            if ((ch >= 97 && ch <= 122) || ch === 95) kEnd++;
            else break;
          }
          if (kEnd === pos || kEnd >= lineEnd || text.charCodeAt(kEnd) !== 58) {
            return { error: `line ${lineNum} is not "key: value"` };
          }
          let valStart;
          if (kEnd + 1 === lineEnd) {
            valStart = lineEnd;
          } else if (text.charCodeAt(kEnd + 1) === 32) {
            valStart = kEnd + 2;
          } else {
            return { error: `line ${lineNum} is not "key: value"` };
          }

          const key = text.slice(pos, kEnd);
          let valEnd = lineEnd;
          while (valEnd > valStart) {
            const ch = text.charCodeAt(valEnd - 1);
            if (ch === 32 || ch === 9) valEnd--;
            else break;
          }

          if (
            key !== 'title' &&
            key !== 'date' &&
            key !== 'tags' &&
            key !== 'draft' &&
            key !== 'layout' &&
            key !== 'slug' &&
            key !== 'summary'
          ) {
            return { error: `unknown key "${key}"` };
          }
          if (data[key] !== undefined) {
            return { error: `key "${key}" is given twice` };
          }
          if (valStart >= valEnd) {
            return { error: `key "${key}" has no value` };
          }

          if (key === 'title' || key === 'summary') {
            const s = parseStringValue(text, valStart, valEnd, key);
            if (s.error !== undefined) return s;
            data[key] = s.value;
          } else if (key === 'date') {
            const d = parseDateValue(text, valStart, valEnd);
            if (d === null) {
              return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
            }
            data.date = d;
          } else if (key === 'tags') {
            const t = parseTagsValue(text, valStart, valEnd);
            if (t.error !== undefined) return t;
            data.tags = t.value;
          } else if (key === 'draft') {
            const vLen = valEnd - valStart;
            if (vLen === 4 && text.startsWith('true', valStart)) data.draft = true;
            else if (vLen === 5 && text.startsWith('false', valStart)) data.draft = false;
            else return { error: 'key "draft": true or false' };
          } else if (key === 'layout') {
            if (!isLayoutName(text, valStart, valEnd)) return { error: 'key "layout": not a template name' };
            data.layout = text.slice(valStart, valEnd);
          } else {
            if (!isValidSlug(text, valStart, valEnd)) return { error: 'key "slug": not a slug' };
            data.slug = text.slice(valStart, valEnd);
          }
        }
      }
    }

    pos = lineEnd + 1;
    lineNum++;
  }

  if (data.title === undefined) return { error: 'no title' };
  return { data, body: text.slice(bodyStart) };
}
