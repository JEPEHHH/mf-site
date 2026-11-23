import { parseFrontMatter } from './lib/frontmatter.js';
import { renderMarkdown } from './lib/markdown.js';
import { compileTemplate, parseTemplate, TemplateError } from './lib/template.js';
import { longDate, slugify, uniqueSlug } from './lib/text.js';

const REPORT_FILE = 'build-report.txt';
const RESERVED = Object.freeze(['posts', 'tags', 'page']);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isWsCode(c) {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 160) return false;
  return (
    c === 0x00a0 ||
    c === 0xfeff ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0x1680
  );
}

function wordsOf(text) {
  const len = text.length;
  let count = 0;
  let inWord = false;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c > 32 && c < 160) {
      if (!inWord) {
        count++;
        inWord = true;
      }
    } else if (isWsCode(c)) {
      inWord = false;
    } else if (!inWord) {
      count++;
      inWord = true;
    }
  }
  return count;
}

// Fast check for /^[A-Za-z][A-Za-z0-9+.-]*:/
function hasScheme(target) {
  const len = target.length;
  if (len < 2) return false;
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < len; i++) {
    const c = target.charCodeAt(i);
    if (c === 58) return true;
    if (
      !(
        (c >= 97 && c <= 122) ||
        (c >= 65 && c <= 90) ||
        (c >= 48 && c <= 57) ||
        c === 43 ||
        c === 45 ||
        c === 46
      )
    ) {
      return false;
    }
  }
  return false;
}

function resolvePathParts(dirParts, rel) {
  const parts = dirParts.length === 0 ? [] : dirParts.slice();
  const len = rel.length;
  let start = 0;
  while (start <= len) {
    const slash = rel.indexOf('/', start);
    const end = slash === -1 ? len : slash;
    const segLen = end - start;
    if (segLen > 0) {
      if (segLen === 1 && rel.charCodeAt(start) === 46) {
        // "."
      } else if (segLen === 2 && rel.charCodeAt(start) === 46 && rel.charCodeAt(start + 1) === 46) {
        if (parts.length === 0) return null;
        parts.pop();
      } else {
        parts.push(rel.slice(start, end));
      }
    }
    if (slash === -1) break;
    start = slash + 1;
  }
  return parts.join('/');
}

function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function linkOf(s) {
  if (s === null) return null;
  return {
    title: s.data.title,
    url: s.url,
    date: s.dateStr,
    date_long: s.dateLong,
  };
}

function makeCard(s) {
  const refs = s.tagRefs;
  const cardTags = new Array(refs.length);
  for (let i = 0; i < refs.length; i++) {
    const t = refs[i];
    cardTags[i] = { name: t.name, slug: t.slug, url: t.url };
  }
  return {
    title: s.data.title,
    url: s.url,
    date: s.dateStr,
    date_long: s.dateLong,
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: cardTags,
  };
}

export function run(input) {
  const templates = new Map();
  const report = [];
  const tplNames = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < tplNames.length; i++) {
    const name = tplNames[i];
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  let base = input.site.base_url;
  let baseEnd = base.length;
  while (baseEnd > 0 && base.charCodeAt(baseEnd - 1) === 47) baseEnd--;
  if (baseEnd !== base.length) base = base.slice(0, baseEnd);

  const files = input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const p = f.path;
    if (p.length >= 3 && p.endsWith('.md')) {
      const content = f.content;
      const text = content.indexOf('\r') === -1 ? content : content.replace(/\r\n?/g, '\n');
      sources.push({
        path: p,
        text,
        data: null,
        body: '',
        post: false,
        layout: '',
        slug: '',
        outDir: '',
        url: '',
        html: '',
        toc: null,
        excerpt: '',
        newer: null,
        older: null,
        tagRefs: null,
        dateStr: '',
        dateLong: '',
      });
    } else {
      statics.push(f);
    }
  }

  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    const data = fm.data;
    s.data = data;
    s.body = fm.body;
    const isPost = s.path.startsWith('posts/');
    s.post = isPost;
    if (!isPost) {
      if (s.path.startsWith('tags/')) {
        report.push(`refused ${s.path}: tags/ is the generator's own`);
        continue;
      }
      if (s.path.startsWith('page/')) {
        report.push(`refused ${s.path}: page/ is the generator's own`);
        continue;
      }
    }
    if (isPost && data.date === undefined) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = data.layout ?? (isPost ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    if (data.date !== undefined) {
      s.dateStr = data.date;
      s.dateLong = longDate(data.date);
    }
    kept.push(s);
  }

  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = dir === '' ? new Set(RESERVED) : new Set();
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);

  const broken = new Set();
  let curPath = '';
  let curDirParts = [];
  const env = {
    link(target) {
      const c0 = target.charCodeAt(0);
      if (c0 === 47 || c0 === 35 || hasScheme(target)) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const resolved = rel === '' ? null : resolvePathParts(curDirParts, rel);
      if (resolved !== null) {
        const dest = bySource.get(resolved);
        if (dest !== undefined) return dest.url + frag;
        if (staticPaths.has(resolved)) return base + '/' + resolved + frag;
      }
      broken.add(`broken-link ${curPath} -> ${target}`);
      return target;
    },
  };

  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    curPath = s.path;
    const dir = dirOf(curPath);
    curDirParts = dir === '' ? [] : dir.split('/');
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = [];
  let pageCount = 0;
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].post) posts.push(kept[i]);
    else pageCount++;
  }
  posts.sort((x, y) => byCodeUnits(y.dateStr, x.dateStr) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  const tagSlugCache = new Map();
  const getTagSlug = (name) => {
    let sl = tagSlugCache.get(name);
    if (sl === undefined) {
      sl = slugify(name);
      tagSlugCache.set(name, sl);
    }
    return sl;
  };

  const bySlug = new Map();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const rawTags = p.data.tags;
    const refs = [];
    if (rawTags !== undefined && rawTags.length > 0) {
      const seen = new Set();
      for (let j = 0; j < rawTags.length; j++) {
        const name = rawTags[j];
        const slug = getTagSlug(name);
        if (seen.has(slug)) continue;
        seen.add(slug);
        let tag = bySlug.get(slug);
        if (tag === undefined) {
          tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] };
          bySlug.set(slug, tag);
        }
        tag.posts.push(p);
        refs.push(tag);
      }
    }
    p.tagRefs = refs;
  }

  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (s.post) continue;
    const rawTags = s.data.tags;
    const refs = [];
    if (rawTags !== undefined && rawTags.length > 0) {
      const seen = new Set();
      for (let j = 0; j < rawTags.length; j++) {
        const name = rawTags[j];
        const slug = getTagSlug(name);
        if (seen.has(slug)) continue;
        seen.add(slug);
        refs.push(bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
      }
    }
    s.tagRefs = refs;
  }

  const tagsList = [...bySlug.values()].sort(
    (x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug)
  );

  const cards = new Map();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    cards.set(p, makeCard(p));
  }

  const site = { title: input.site.title, base_url: base };
  const allTags = new Array(tagsList.length);
  for (let i = 0; i < tagsList.length; i++) {
    const t = tagsList[i];
    allTags[i] = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length };
  }
  const recentCount = Math.min(input.site.recent, posts.length);
  const recent = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) recent[i] = cards.get(posts[i]);

  const siteVars = { site, tags: allTags, recent };

  // Compile each used page layout lazily once per site
  const compiledPageLayouts = new Map();
  const getPageLayout = (layoutName) => {
    let fn = compiledPageLayouts.get(layoutName);
    if (fn === undefined) {
      fn = compileTemplate(layoutName, templates, siteVars, ['page']);
      compiledPageLayouts.set(layoutName, fn);
    }
    return fn;
  };

  const output = {};
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const card = s.post ? cards.get(s) : makeCard(s);
    const pageObj = {
      title: card.title,
      url: card.url,
      date: card.date,
      date_long: card.date_long,
      summary: card.summary,
      excerpt: card.excerpt,
      reading_minutes: card.reading_minutes,
      tags: card.tags,
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(s.newer),
      older: linkOf(s.older),
      is_post: s.post,
    };
    output[s.outDir + '/index.html'] = getPageLayout(s.layout)(pageObj);
  }

  const indexFn = compileTemplate('index', templates, siteVars, ['posts', 'pager']);
  if (indexFn !== null) {
    const per = input.site.per_page;
    const totalPages = Math.max(1, Math.ceil(posts.length / per));
    const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
    for (let k = 1; k <= totalPages; k++) {
      const start = (k - 1) * per;
      const end = Math.min(k * per, posts.length);
      const pagePosts = new Array(end - start);
      for (let j = start; j < end; j++) pagePosts[j - start] = cards.get(posts[j]);
      const pager = {
        number: k,
        total: totalPages,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === totalPages ? '' : indexUrl(k + 1),
      };
      output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = indexFn(pagePosts, pager);
    }
  }

  const tagFn = compileTemplate('tag', templates, siteVars, ['tag']);
  if (tagFn !== null) {
    for (let i = 0; i < tagsList.length; i++) {
      const t = tagsList[i];
      const tPosts = new Array(t.posts.length);
      for (let j = 0; j < t.posts.length; j++) tPosts[j] = cards.get(t.posts[j]);
      output['tags/' + t.slug + '/index.html'] = tagFn({
        name: t.name,
        slug: t.slug,
        url: t.url,
        count: t.posts.length,
        posts: tPosts,
      });
    }
  }

  const tagsFn = compileTemplate('tags', templates, siteVars, []);
  if (tagsFn !== null) {
    output['tags/index.html'] = tagsFn();
  }

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = [...report, ...broken].sort(byCodeUnits);
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tagsList.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = lines.join('\n') + '\n';

  return output;
}
