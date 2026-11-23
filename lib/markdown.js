import { escapeHtml, escapeHtmlRange, slugify, uniqueSlug } from './text.js';

// 0 = normal, 1 = &, 2 = <, 3 = >, 4 = ", 5 = ', 6 = \, 7 = `, 8 = *, 9 = [
const INLINE_SPECIAL = new Uint8Array(97);
INLINE_SPECIAL[38] = 1; // &
INLINE_SPECIAL[60] = 2; // <
INLINE_SPECIAL[62] = 3; // >
INLINE_SPECIAL[34] = 4; // "
INLINE_SPECIAL[39] = 5; // '
INLINE_SPECIAL[92] = 6; // \
INLINE_SPECIAL[96] = 7; // `
INLINE_SPECIAL[42] = 8; // *
INLINE_SPECIAL[91] = 9; // [

// Backslash-escapable characters: \ ` * _ [ ] ( ) # + - . ! >
const ESCAPABLE = new Uint8Array(128);
ESCAPABLE[92] = 1; // \
ESCAPABLE[96] = 1; // `
ESCAPABLE[42] = 1; // *
ESCAPABLE[95] = 1; // _
ESCAPABLE[91] = 1; // [
ESCAPABLE[93] = 1; // ]
ESCAPABLE[40] = 1; // (
ESCAPABLE[41] = 1; // )
ESCAPABLE[35] = 1; // #
ESCAPABLE[43] = 1; // +
ESCAPABLE[45] = 1; // -
ESCAPABLE[46] = 1; // .
ESCAPABLE[33] = 1; // !
ESCAPABLE[62] = 1; // >

// Valid fence language chars: A-Z a-z 0-9 _ + -
const LANG_CHAR = new Uint8Array(128);
for (let c = 65; c <= 90; c++) LANG_CHAR[c] = 1;
for (let c = 97; c <= 122; c++) LANG_CHAR[c] = 1;
for (let c = 48; c <= 57; c++) LANG_CHAR[c] = 1;
LANG_CHAR[95] = 1; // _
LANG_CHAR[43] = 1; // +
LANG_CHAR[45] = 1; // -

const HAS_WS = /\s/;

function findUnescapedDoubleStar(s, from, end) {
  const limit = end - 1;
  for (let j = from; j < limit; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < end) {
        const n = s.charCodeAt(j + 1);
        if (n < 128 && ESCAPABLE[n]) {
          j++;
          continue;
        }
      }
    } else if (c === 42 && s.charCodeAt(j + 1) === 42) {
      return j;
    }
  }
  return -1;
}

function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < end) {
        const n = s.charCodeAt(j + 1);
        if (n < 128 && ESCAPABLE[n]) {
          j++;
          continue;
        }
      }
    } else if (c === 42) {
      if (j + 1 < end && s.charCodeAt(j + 1) === 42) {
        j++;
        continue;
      }
      return j;
    }
  }
  return -1;
}

function findUnescapedRightBracket(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < end) {
        const n = s.charCodeAt(j + 1);
        if (n < 128 && ESCAPABLE[n]) {
          j++;
          continue;
        }
      }
    } else if (c === 93) {
      return j;
    }
  }
  return -1;
}

function targetHasWhitespace(s, start, end) {
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c <= 32) {
      if (c === 32 || (c >= 9 && c <= 13)) return true;
    } else if (c >= 128) {
      return HAS_WS.test(s.slice(i, end));
    }
  }
  return false;
}

function renderInline(s, start, end, env) {
  let out = '';
  let last = start;
  let i = start;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c > 96 || c < 34) {
      i++;
      continue;
    }
    const kind = INLINE_SPECIAL[c];
    if (kind === 0) {
      i++;
      continue;
    }
    if (kind <= 5) {
      let rep;
      if (kind === 1) rep = '&amp;';
      else if (kind === 2) rep = '&lt;';
      else if (kind === 3) rep = '&gt;';
      else if (kind === 4) rep = '&quot;';
      else rep = '&#39;';
      if (last === start) out = s.slice(start, i) + rep;
      else out += s.slice(last, i) + rep;
      i++;
      last = i;
      continue;
    }
    if (kind === 6) {
      // Backslash
      if (i + 1 < end) {
        const n = s.charCodeAt(i + 1);
        if (n < 128 && ESCAPABLE[n]) {
          if (n === 62) {
            if (last === start) out = s.slice(start, i) + '&gt;';
            else out += s.slice(last, i) + '&gt;';
            i += 2;
            last = i;
          } else {
            if (last === start) out = s.slice(start, i);
            else out += s.slice(last, i);
            last = i + 1;
            i += 2;
          }
          continue;
        }
      }
      i++;
      continue;
    }
    if (kind === 7) {
      // Backtick
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && j < end) {
        const code = '<code>' + escapeHtmlRange(s, i + 1, j) + '</code>';
        if (last === start) out = s.slice(start, i) + code;
        else out += s.slice(last, i) + code;
        i = j + 1;
        last = i;
      } else {
        i++;
      }
      continue;
    }
    if (kind === 8) {
      // Asterisk
      if (i + 1 < end && s.charCodeAt(i + 1) === 42) {
        const j = findUnescapedDoubleStar(s, i + 2, end);
        if (j > i + 2) {
          const inner = '<strong>' + renderInline(s, i + 2, j, env) + '</strong>';
          if (last === start) out = s.slice(start, i) + inner;
          else out += s.slice(last, i) + inner;
          i = j + 2;
          last = i;
        } else {
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1, end);
      if (j > i + 1) {
        const inner = '<em>' + renderInline(s, i + 1, j, env) + '</em>';
        if (last === start) out = s.slice(start, i) + inner;
        else out += s.slice(last, i) + inner;
        i = j + 1;
        last = i;
      } else {
        i++;
      }
      continue;
    }
    // kind === 9: '['
    const k = findUnescapedRightBracket(s, i + 1, end);
    if (k !== -1 && k + 1 < end && s.charCodeAt(k + 1) === 40) {
      const m = s.indexOf(')', k + 2);
      if (m > k + 2 && m < end && !targetHasWhitespace(s, k + 2, m)) {
        const target = s.slice(k + 2, m);
        const href = escapeHtml(env.link(target));
        const inner = renderInline(s, i + 1, k, env);
        const linkHtml = '<a href="' + href + '">' + inner + '</a>';
        if (last === start) out = s.slice(start, i) + linkHtml;
        else out += s.slice(last, i) + linkHtml;
        i = m + 1;
        last = i;
        continue;
      }
    }
    i++;
  }
  if (last === start) return s.slice(start, end);
  return last < end ? out + s.slice(last, end) : out;
}

export function inline(s, env) {
  return renderInline(s, 0, s.length, env);
}

function isBlank(src, s, e) {
  for (let i = s; i < e; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Returns language end index (>= s + 3) if fence open, else -1.
function matchFenceOpen(src, s, e) {
  if (e - s < 3 || src.charCodeAt(s) !== 96 || src.charCodeAt(s + 1) !== 96 || src.charCodeAt(s + 2) !== 96) {
    return -1;
  }
  let p = s + 3;
  while (p < e) {
    const c = src.charCodeAt(p);
    if (c < 128 && LANG_CHAR[c]) p++;
    else break;
  }
  const langEnd = p;
  while (p < e) {
    const c = src.charCodeAt(p);
    if (c === 32 || c === 9) p++;
    else return -1;
  }
  return langEnd;
}

function isFenceClose(src, s, e) {
  if (e - s < 3 || src.charCodeAt(s) !== 96 || src.charCodeAt(s + 1) !== 96 || src.charCodeAt(s + 2) !== 96) {
    return false;
  }
  for (let p = s + 3; p < e; p++) {
    const c = src.charCodeAt(p);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Returns heading depth (1..6) if heading line, else 0. Sets module-free via return or small helper.
function isHeadingLine(src, s, e) {
  if (s >= e || src.charCodeAt(s) !== 35) return 0;
  let d = 1;
  while (d < 7 && s + d < e && src.charCodeAt(s + d) === 35) d++;
  if (d > 6 || s + d >= e) return 0;
  let p = s + d;
  const sp = src.charCodeAt(p);
  if (sp !== 32 && sp !== 9) return 0;
  p++;
  while (p < e) {
    const c = src.charCodeAt(p);
    if (c === 32 || c === 9) p++;
    else break;
  }
  return p < e ? d : 0;
}

function isHr(src, s, e) {
  if (e - s < 3) return false;
  const c0 = src.charCodeAt(s);
  if (c0 !== 45 && c0 !== 42) return false;
  if (src.charCodeAt(s + 1) !== c0 || src.charCodeAt(s + 2) !== c0) return false;
  for (let p = s + 3; p < e; p++) {
    const c = src.charCodeAt(p);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(src, s, e) {
  if (s >= e) return true;
  const c0 = src.charCodeAt(s);
  if (c0 === 32 || c0 === 9) return isBlank(src, s, e);
  if (c0 === 96) return matchFenceOpen(src, s, e) !== -1;
  if (c0 === 35) return isHeadingLine(src, s, e) !== 0;
  if (c0 === 45 || c0 === 42) return isHr(src, s, e);
  return false;
}

// Returns text start index (>= s + 3) if ordered list item, else -1.
function matchOrdered(src, s, e) {
  if (s >= e) return -1;
  let c = src.charCodeAt(s);
  if (c < 48 || c > 57) return -1;
  let p = s + 1;
  const limit = s + 9 < e ? s + 9 : e;
  while (p < limit) {
    c = src.charCodeAt(p);
    if (c >= 48 && c <= 57) p++;
    else break;
  }
  if (p + 1 < e && src.charCodeAt(p) === 46 && src.charCodeAt(p + 1) === 32) {
    return p + 2;
  }
  return -1;
}

function isContinued(src, s, e) {
  if (e - s < 3 || src.charCodeAt(s) !== 32 || src.charCodeAt(s + 1) !== 32) return false;
  let p = s + 2;
  while (p < e && src.charCodeAt(p) === 32) p++;
  if (p >= e) return false;
  const c = src.charCodeAt(p);
  if (c === 9 || c === 11 || c === 12 || c === 13) return false;
  if (c >= 128) return !HAS_WS.test(src[p]);
  return true;
}

export function renderMarkdown(src, env) {
  const len = src.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let out = '';

  let pos = 0;
  while (pos <= len) {
    let nl = src.indexOf('\n', pos);
    let lineEnd = nl === -1 ? len : nl;
    let nextPos = nl === -1 ? len + 1 : nl + 1;

    // 1. Blank line
    if (pos === lineEnd) {
      pos = nextPos;
      continue;
    }
    const c0 = src.charCodeAt(pos);
    if ((c0 === 32 || c0 === 9) && isBlank(src, pos, lineEnd)) {
      pos = nextPos;
      continue;
    }

    // 2. Fence
    if (c0 === 96) {
      const langEnd = matchFenceOpen(src, pos, lineEnd);
      if (langEnd !== -1) {
        const cls = langEnd === pos + 3 ? '' : ' class="language-' + src.slice(pos + 3, langEnd) + '"';
        pos = nextPos;
        const bodyStart = pos;
        let hasBody = false;
        let bodyEnd = pos;
        while (pos <= len) {
          nl = src.indexOf('\n', pos);
          lineEnd = nl === -1 ? len : nl;
          nextPos = nl === -1 ? len + 1 : nl + 1;
          if (isFenceClose(src, pos, lineEnd)) {
            pos = nextPos;
            break;
          }
          hasBody = true;
          bodyEnd = lineEnd;
          pos = nextPos;
        }
        if (hasBody) {
          out += '<pre><code' + cls + '>' + escapeHtmlRange(src, bodyStart, bodyEnd) + '\n</code></pre>\n';
        } else {
          out += '<pre><code' + cls + '></code></pre>\n';
        }
        continue;
      }
    }

    // 3. Heading
    if (c0 === 35) {
      const depth = isHeadingLine(src, pos, lineEnd);
      if (depth !== 0) {
        let ts = pos + depth + 1;
        while (ts < lineEnd) {
          const ch = src.charCodeAt(ts);
          if (ch === 32 || ch === 9) ts++;
          else break;
        }
        let te = lineEnd;
        while (te > ts) {
          const ch = src.charCodeAt(te - 1);
          if (ch === 32 || ch === 9) te--;
          else break;
        }
        const id = uniqueSlug(slugify(src.slice(ts, te)), ids);
        const html = renderInline(src, ts, te, env);
        out += '<h' + depth + ' id="' + id + '">' + html + '</h' + depth + '>\n';
        if (depth === 2 || depth === 3) toc.push({ level: depth, id, html });
        pos = nextPos;
        continue;
      }
    }

    // 4. Thematic break
    if ((c0 === 45 || c0 === 42) && isHr(src, pos, lineEnd)) {
      out += '<hr>\n';
      pos = nextPos;
      continue;
    }

    // 5. Blockquote
    if (c0 === 62) {
      let qBuf = '';
      let hasLine = false;
      while (pos <= len) {
        nl = src.indexOf('\n', pos);
        lineEnd = nl === -1 ? len : nl;
        nextPos = nl === -1 ? len + 1 : nl + 1;
        if (pos >= lineEnd || src.charCodeAt(pos) !== 62) break;
        let ls = pos + 1;
        if (ls < lineEnd && src.charCodeAt(ls) === 32) ls++;
        while (ls < lineEnd) {
          const ch = src.charCodeAt(ls);
          if (ch === 32 || ch === 9) ls++;
          else break;
        }
        let le = lineEnd;
        while (le > ls) {
          const ch = src.charCodeAt(le - 1);
          if (ch === 32 || ch === 9) le--;
          else break;
        }
        if (ls < le) {
          if (!hasLine) {
            qBuf = src.slice(ls, le);
            hasLine = true;
          } else {
            qBuf += '\n' + src.slice(ls, le);
          }
        }
        pos = nextPos;
      }
      if (!hasLine) {
        out += '<blockquote>\n</blockquote>\n';
      } else {
        out += '<blockquote>\n<p>' + renderInline(qBuf, 0, qBuf.length, env) + '</p>\n</blockquote>\n';
      }
      continue;
    }

    // 6. List (bullet or ordered)
    const isBullet = (c0 === 45 || c0 === 42) && lineEnd - pos >= 2 && src.charCodeAt(pos + 1) === 32;
    const ordTextStart = isBullet ? -1 : c0 >= 48 && c0 <= 57 ? matchOrdered(src, pos, lineEnd) : -1;
    if (isBullet || ordTextStart !== -1) {
      const isOrdered = ordTextStart !== -1;
      if (isOrdered) {
        let startNum = 0;
        for (let p = pos; p < ordTextStart - 2; p++) {
          startNum = startNum * 10 + (src.charCodeAt(p) - 48);
        }
        out += startNum !== 1 ? '<ol start="' + startNum + '">\n' : '<ol>\n';
      } else {
        out += '<ul>\n';
      }

      let curS = -1;
      let curE = -1;
      let curBuf = null;

      while (pos <= len) {
        nl = src.indexOf('\n', pos);
        lineEnd = nl === -1 ? len : nl;
        nextPos = nl === -1 ? len + 1 : nl + 1;

        let textStart = -1;
        if (pos < lineEnd) {
          const fc = src.charCodeAt(pos);
          if (isOrdered) {
            if (fc >= 48 && fc <= 57) textStart = matchOrdered(src, pos, lineEnd);
          } else {
            if ((fc === 45 || fc === 42) && lineEnd - pos >= 2 && src.charCodeAt(pos + 1) === 32) {
              textStart = pos + 2;
            }
          }
        }

        if (textStart !== -1) {
          if (curS !== -1) {
            out +=
              '<li>' +
              (curBuf !== null ? renderInline(curBuf, 0, curBuf.length, env) : renderInline(src, curS, curE, env)) +
              '</li>\n';
          }
          let ts = textStart;
          while (ts < lineEnd) {
            const ch = src.charCodeAt(ts);
            if (ch === 32 || ch === 9) ts++;
            else break;
          }
          let te = lineEnd;
          while (te > ts) {
            const ch = src.charCodeAt(te - 1);
            if (ch === 32 || ch === 9) te--;
            else break;
          }
          curS = ts;
          curE = te;
          curBuf = null;
          pos = nextPos;
        } else if (isContinued(src, pos, lineEnd)) {
          let ts = pos;
          while (ts < lineEnd) {
            const ch = src.charCodeAt(ts);
            if (ch === 32 || ch === 9) ts++;
            else break;
          }
          let te = lineEnd;
          while (te > ts) {
            const ch = src.charCodeAt(te - 1);
            if (ch === 32 || ch === 9) te--;
            else break;
          }
          if (curBuf === null) curBuf = src.slice(curS, curE) + '\n' + src.slice(ts, te);
          else curBuf += '\n' + src.slice(ts, te);
          pos = nextPos;
        } else {
          break;
        }
      }

      if (curS !== -1) {
        out +=
          '<li>' +
          (curBuf !== null ? renderInline(curBuf, 0, curBuf.length, env) : renderInline(src, curS, curE, env)) +
          '</li>\n';
      }
      out += isOrdered ? '</ol>\n' : '</ul>\n';
      continue;
    }

    // 7. Paragraph
    let firstTs = pos;
    while (firstTs < lineEnd) {
      const ch = src.charCodeAt(firstTs);
      if (ch === 32 || ch === 9) firstTs++;
      else break;
    }
    let firstTe = lineEnd;
    while (firstTe > firstTs) {
      const ch = src.charCodeAt(firstTe - 1);
      if (ch === 32 || ch === 9) firstTe--;
      else break;
    }
    let paraClean = firstTs === pos && firstTe === lineEnd;
    const paraStart = firstTs;
    let paraEnd = firstTe;
    let paraBuf = null;
    pos = nextPos;

    while (pos <= len) {
      nl = src.indexOf('\n', pos);
      lineEnd = nl === -1 ? len : nl;
      nextPos = nl === -1 ? len + 1 : nl + 1;
      if (endsParagraph(src, pos, lineEnd)) break;
      let ts = pos;
      while (ts < lineEnd) {
        const ch = src.charCodeAt(ts);
        if (ch === 32 || ch === 9) ts++;
        else break;
      }
      let te = lineEnd;
      while (te > ts) {
        const ch = src.charCodeAt(te - 1);
        if (ch === 32 || ch === 9) te--;
        else break;
      }
      if (paraClean && ts === pos && te === lineEnd) {
        paraEnd = lineEnd;
      } else {
        if (paraBuf === null) {
          paraBuf = src.slice(paraStart, paraEnd) + '\n' + src.slice(ts, te);
        } else {
          paraBuf += '\n' + src.slice(ts, te);
        }
        paraClean = false;
      }
      pos = nextPos;
    }

    const html =
      paraBuf !== null ? renderInline(paraBuf, 0, paraBuf.length, env) : renderInline(src, paraStart, paraEnd, env);
    if (excerpt === null) excerpt = html;
    out += '<p>' + html + '</p>\n';
  }

  return { html: out, toc, excerpt: excerpt === null ? '' : excerpt };
}
