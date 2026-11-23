import { escapeHtml } from './text.js';

export const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

export class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function isSpacesTabs(src, start, end) {
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function tokenize(name, src) {
  const tokens = [];
  const len = src.length;
  let text = '';
  let i = 0;
  while (i < len) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === len - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next !== 123 && next !== 37) {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === 123) {
      const raw = open + 2 < len && src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') {
        tokens.push({ t: 'text', text });
        text = '';
      }
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = open === 0 ? 0 : src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? len : nl;
    const standalone = isSpacesTabs(src, lineStart, open) && isSpacesTabs(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') {
      tokens.push({ t: 'text', text });
      text = '';
    }
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? len : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) {
          throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        }
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) {
        body.push({ kind: 'include', name: m[1] });
      } else {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      }
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

const hasOwn = Object.hasOwn;

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function arrayTextOf(arr) {
  const len = arr.length;
  if (len === 0) return '';
  let out = rawVal(arr[0]);
  for (let i = 1; i < len; i++) {
    out += ', ' + rawVal(arr[i]);
  }
  return out;
}

function rawVal(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return '' + v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return arrayTextOf(v);
  return '';
}

function escVal(v) {
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number') return '' + v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return escapeHtml(arrayTextOf(v));
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function evalConstNodes(nodes, scope) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.kind) {
      case 'text':
        out += n.text;
        break;
      case 'var':
        out += escVal(lookup(scope, n.path));
        break;
      case 'raw':
        out += rawVal(lookup(scope, n.path));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) out += evalConstNodes(branch, scope);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          const vars = {
            [n.name]: xs[k],
            loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len },
          };
          out += evalConstNodes(n.body, { vars, parent: scope });
        }
        break;
      }
    }
  }
  return out;
}

function inlineIncludes(nodes, templates, depth) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'include') {
      if (depth < INCLUDE_DEPTH) {
        const t = templates.get(n.name);
        if (t !== undefined) {
          const expanded = inlineIncludes(t, templates, depth + 1);
          for (let j = 0; j < expanded.length; j++) out.push(expanded[j]);
        }
      }
    } else if (n.kind === 'if') {
      out.push({
        kind: 'if',
        not: n.not,
        path: n.path,
        then: inlineIncludes(n.then, templates, depth),
        else: n.else === null ? null : inlineIncludes(n.else, templates, depth),
      });
    } else if (n.kind === 'for') {
      out.push({
        kind: 'for',
        name: n.name,
        path: n.path,
        body: inlineIncludes(n.body, templates, depth),
      });
    } else {
      out.push(n);
    }
  }
  return out;
}

function isNodeConst(n, dynSet) {
  switch (n.kind) {
    case 'text':
      return true;
    case 'var':
    case 'raw':
      return !dynSet.has(n.path[0]);
    case 'if':
      return (
        !dynSet.has(n.path[0]) &&
        isListConst(n.then, dynSet) &&
        (n.else === null || isListConst(n.else, dynSet))
      );
    case 'for': {
      if (dynSet.has(n.path[0])) return false;
      let childDyn = dynSet;
      if (dynSet.has(n.name) || dynSet.has('loop')) {
        childDyn = new Set(dynSet);
        childDyn.delete(n.name);
        childDyn.delete('loop');
      }
      return isListConst(n.body, childDyn);
    }
    default:
      return false;
  }
}

function isListConst(nodes, dynSet) {
  for (let i = 0; i < nodes.length; i++) {
    if (!isNodeConst(nodes[i], dynSet)) return false;
  }
  return true;
}

function foldNodes(nodes, constScope, dynSet) {
  const out = [];
  let textAcc = '';
  const flushText = () => {
    if (textAcc !== '') {
      out.push({ kind: 'text', text: textAcc });
      textAcc = '';
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'text') {
      textAcc += n.text;
      continue;
    }
    if (isNodeConst(n, dynSet)) {
      textAcc += evalConstNodes([n], constScope);
      continue;
    }
    if (n.kind === 'if' && !dynSet.has(n.path[0])) {
      const v = truthy(lookup(constScope, n.path));
      const branch = v !== n.not ? n.then : n.else;
      if (branch !== null) {
        const folded = foldNodes(branch, constScope, dynSet);
        for (let j = 0; j < folded.length; j++) {
          if (folded[j].kind === 'text') textAcc += folded[j].text;
          else {
            flushText();
            out.push(folded[j]);
          }
        }
      }
      continue;
    }
    flushText();
    if (n.kind === 'if') {
      out.push({
        kind: 'if',
        not: n.not,
        path: n.path,
        then: foldNodes(n.then, constScope, dynSet),
        else: n.else === null ? null : foldNodes(n.else, constScope, dynSet),
      });
    } else if (n.kind === 'for') {
      const childDyn = new Set(dynSet);
      childDyn.add(n.name);
      childDyn.add('loop');
      out.push({
        kind: 'for',
        name: n.name,
        path: n.path,
        body: foldNodes(n.body, constScope, childDyn),
      });
    } else {
      out.push(n);
    }
  }
  flushText();
  return out;
}

// Properties that exist on Object.prototype or Array.prototype require Object.hasOwn checks.
const PROTO_PROPS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Array.prototype),
]);

/**
 * Compile template `name` specialized for `siteVars` ({ site, tags, recent }) and `dynKeys` (e.g. ['page']).
 * Returns a function `(dyn0, dyn1) => string` where parameters match `dynKeys` order.
 */
export function compileTemplate(name, templates, siteVars, dynKeys) {
  const rawNodes = templates.get(name);
  if (rawNodes === undefined) return null;

  const expanded = inlineIncludes(rawNodes, templates, 0);
  const constScope = { vars: siteVars, parent: null };
  const dynSet = new Set(dynKeys);
  const folded = foldNodes(expanded, constScope, dynSet);

  if (folded.length === 0) return () => '';
  if (folded.length === 1 && folded[0].kind === 'text') {
    const s = folded[0].text;
    return () => s;
  }

  const strings = [];
  const addStr = (s) => {
    const idx = strings.length;
    strings.push(s);
    return `_S[${idx}]`;
  };
  const memoMaps = [];

  let loopSeq = 0;
  let tempSeq = 0;
  const lines = ['let _o = "";'];

  const initMap = new Map();
  initMap.set('site', { kind: 'var', expr: '_site' });
  initMap.set('tags', { kind: 'var', expr: '_tags' });
  initMap.set('recent', { kind: 'var', expr: '_recent' });
  for (let i = 0; i < dynKeys.length; i++) {
    initMap.set(dynKeys[i], { kind: 'var', expr: `_d${i}` });
  }

  // Returns { expr, type: 'any' | 'num' | 'bool' | 'undef' | 'loop' }
  function emitPath(path, varMap) {
    const binding = varMap.get(path[0]);
    if (binding === undefined) return { expr: 'undefined', type: 'undef' };
    if (binding.kind === 'loop') {
      if (path.length === 1) return { expr: 'null', type: 'loop' };
      if (path.length === 2) {
        const p1 = path[1];
        if (p1 === 'index') return { expr: `(${binding.idx} + 1)`, type: 'num' };
        if (p1 === 'first') return { expr: `(${binding.idx} === 0)`, type: 'bool' };
        if (p1 === 'last') return { expr: `(${binding.idx} === ${binding.len} - 1)`, type: 'bool' };
        if (p1 === 'length') return { expr: binding.len, type: 'num' };
      }
      return { expr: 'undefined', type: 'undef' };
    }
    let expr = binding.expr;
    if (path.length === 1) return { expr, type: 'any' };
    if (path.length === 2) {
      const p1 = path[1];
      if (PROTO_PROPS.has(p1)) {
        return {
          expr: `(${expr} !== null && typeof ${expr} === "object" && _hasOwn(${expr}, ${JSON.stringify(p1)}) ? ${expr}[${JSON.stringify(p1)}] : undefined)`,
          type: 'any',
        };
      }
      return {
        expr: `(${expr} !== null && typeof ${expr} === "object" ? ${expr}.${p1} : undefined)`,
        type: 'any',
      };
    }
    // Deep path (>= 3 segments): bind temp variable cleanly
    const t = `_t${tempSeq++}`;
    let step = `(${t} = ${expr})`;
    for (let k = 1; k < path.length; k++) {
      const pk = path[k];
      const guard = PROTO_PROPS.has(pk)
        ? `${t} !== null && typeof ${t} === "object" && _hasOwn(${t}, ${JSON.stringify(pk)})`
        : `${t} !== null && typeof ${t} === "object"`;
      const access = PROTO_PROPS.has(pk) ? `${t}[${JSON.stringify(pk)}]` : `${t}.${pk}`;
      step = `((${step}), ${guard} ? (${t} = ${access}) : (${t} = undefined))`;
    }
    return { expr: step, type: 'any' };
  }

  function emitNodes(list, varMap, outVar) {
    let i = 0;
    while (i < list.length) {
      const n = list[i];
      if (n.kind === 'text' || n.kind === 'var' || n.kind === 'raw') {
        // Batch consecutive text/var/raw into a single += expression
        const parts = [];
        while (i < list.length && (list[i].kind === 'text' || list[i].kind === 'var' || list[i].kind === 'raw')) {
          const cur = list[i];
          if (cur.kind === 'text') {
            parts.push(addStr(cur.text));
          } else {
            const p = emitPath(cur.path, varMap);
            if (p.type === 'undef' || p.type === 'loop') {
              // writes ""
            } else if (p.type === 'num') {
              parts.push(p.expr);
            } else if (p.type === 'bool') {
              parts.push(`(${p.expr} ? "true" : "false")`);
            } else {
              parts.push(cur.kind === 'var' ? `_esc(${p.expr})` : `_raw(${p.expr})`);
            }
          }
          i++;
        }
        if (parts.length > 0) {
          lines.push(`${outVar} += ${parts.join(' + ')};`);
        }
        continue;
      }
      if (n.kind === 'if') {
        const p = emitPath(n.path, varMap);
        let cond;
        if (p.type === 'undef') cond = n.not ? 'true' : 'false';
        else if (p.type === 'loop') cond = n.not ? 'false' : 'true';
        else if (p.type === 'bool') cond = n.not ? `!${p.expr}` : p.expr;
        else if (p.type === 'num') cond = n.not ? `(${p.expr} === 0)` : `(${p.expr} !== 0)`;
        else cond = n.not ? `!_truthy(${p.expr})` : `_truthy(${p.expr})`;

        if (cond === 'true') {
          emitNodes(n.then, varMap, outVar);
        } else if (cond === 'false') {
          if (n.else !== null) emitNodes(n.else, varMap, outVar);
        } else {
          lines.push(`if (${cond}) {`);
          emitNodes(n.then, varMap, outVar);
          if (n.else !== null && n.else.length > 0) {
            lines.push('} else {');
            emitNodes(n.else, varMap, outVar);
          }
          lines.push('}');
        }
        i++;
        continue;
      }
      if (n.kind === 'for') {
        const p = emitPath(n.path, varMap);
        if (p.type === 'any') {
          const id = loopSeq++;
          const arrVar = `_a${id}`;
          const lenVar = `_l${id}`;
          const idxVar = `_i${id}`;
          const valVar = `_v${id}`;
          lines.push(`const ${arrVar} = ${p.expr};`);
          lines.push(`if (Array.isArray(${arrVar})) {`);
          lines.push(`const ${lenVar} = ${arrVar}.length;`);
          lines.push(`for (let ${idxVar} = 0; ${idxVar} < ${lenVar}; ${idxVar}++) {`);
          lines.push(`const ${valVar} = ${arrVar}[${idxVar}];`);
          const childMap = new Map(varMap);
          childMap.set(n.name, { kind: 'var', expr: valVar });
          childMap.set('loop', { kind: 'loop', idx: idxVar, len: lenVar });

          // Memoize outer loop items when body depends solely on item value + site constants
          let canMemo = false;
          if (outVar === '_o' && n.name !== 'loop' && n.body.length > 2) {
            const forbidden = new Set();
            for (const k of varMap.keys()) {
              if (k !== 'site' && k !== 'tags' && k !== 'recent') forbidden.add(k);
            }
            forbidden.add('loop');
            forbidden.delete(n.name);
            canMemo = isListConst(n.body, forbidden);
          }

          if (canMemo) {
            const mIdx = memoMaps.length;
            memoMaps.push(new Map());
            const mVar = `_M[${mIdx}]`;
            const cVar = `_c${id}`;
            lines.push(`let ${cVar} = (${valVar} !== null && typeof ${valVar} === "object") ? ${mVar}.get(${valVar}) : undefined;`);
            lines.push(`if (${cVar} === undefined) {`);
            lines.push(`${cVar} = "";`);
            emitNodes(n.body, childMap, cVar);
            lines.push(`if (${valVar} !== null && typeof ${valVar} === "object") ${mVar}.set(${valVar}, ${cVar});`);
            lines.push('}');
            lines.push(`${outVar} += ${cVar};`);
          } else {
            emitNodes(n.body, childMap, outVar);
          }
          lines.push('}');
          lines.push('}');
        }
        i++;
        continue;
      }
      i++;
    }
  }

  emitNodes(folded, initMap, '_o');

  const decls = [];
  for (let k = 0; k < tempSeq; k++) decls.push(`let _t${k};`);
  lines.push('return _o;');

  const dynParams = dynKeys.map((_, idx) => `_d${idx}`);
  const fnBody = (decls.length > 0 ? decls.join('') + '\n' : '') + lines.join('\n');
  const factory = new Function(
    '_S',
    '_M',
    '_site',
    '_tags',
    '_recent',
    '_esc',
    '_raw',
    '_truthy',
    '_hasOwn',
    `return function(${dynParams.join(',')}){\n${fnBody}\n};`
  );

  return factory(strings, memoMaps, siteVars.site, siteVars.tags, siteVars.recent, escVal, rawVal, truthy, hasOwn);
}

export function renderNodes(nodes, scope, ctx, depth) {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.text;
        break;
      case 'var':
        out += ctx.escape(rawVal(lookup(scope, n.path)));
        break;
      case 'raw':
        out += rawVal(lookup(scope, n.path));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) out += renderNodes(branch, scope, ctx, depth);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          const vars = {
            [n.name]: xs[k],
            loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len },
          };
          out += renderNodes(n.body, { vars, parent: scope }, ctx, depth);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) out += renderNodes(t, scope, ctx, depth + 1);
        break;
      }
    }
  }
  return out;
}
