import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function findFirstDiff(actual, expected, caseId) {
  if (actual === expected) return null;
  if (typeof actual !== 'object' || actual === null || typeof expected !== 'object' || expected === null) {
    return `${caseId}: type/value mismatch`;
  }
  const aKeys = Object.keys(actual).sort();
  const eKeys = Object.keys(expected).sort();
  const aSet = new Set(aKeys);
  const eSet = new Set(eKeys);
  for (const k of eKeys) if (!aSet.has(k)) return `${caseId}: missing key "${k}"`;
  for (const k of aKeys) if (!eSet.has(k)) return `${caseId}: extra key "${k}"`;
  for (const k of eKeys) {
    if (actual[k] !== expected[k]) {
      const a = String(actual[k]);
      const e = String(expected[k]);
      let pos = 0;
      while (pos < a.length && pos < e.length && a.charCodeAt(pos) === e.charCodeAt(pos)) pos++;
      return (
        `${caseId} [${k}]: diff at char ${pos} (len actual=${a.length}, expected=${e.length})\n` +
        `  actual:   ${JSON.stringify(a.slice(Math.max(0, pos - 40), pos + 80))}\n` +
        `  expected: ${JSON.stringify(e.slice(Math.max(0, pos - 40), pos + 80))}`
      );
    }
  }
  return null;
}

function trimmedMean(arr, trim = 2) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length > trim * 2 ? s.slice(trim, s.length - trim) : s;
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}

function loadPractice() {
  const cases = JSON.parse(readFileSync(join(ROOT, 'practice/input/cases.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(ROOT, 'practice/reference/expected.json'), 'utf8'));
  return { cases, expected };
}

async function benchInProcess(label, solveUrl, cases, expected, rounds = 9) {
  const { run } = await import(solveUrl);
  const out1 = cases.map((c) => run(c.input));
  const out2 = cases.map((c) => run(c.input));
  for (let i = 0; i < cases.length; i++) {
    const diff = findFirstDiff(out1[i], expected.cases[i].output, cases[i].id);
    if (diff) {
      console.error(`FAIL [${label}]: ${diff}`);
      process.exitCode = 1;
      return null;
    }
    if (JSON.stringify(out1[i]) !== JSON.stringify(out2[i])) {
      console.error(`FAIL [${label}]: non-deterministic on ${cases[i].id}`);
      process.exitCode = 1;
      return null;
    }
  }

  for (const c of cases) run(c.input);

  const times = [];
  for (let r = 0; r < rounds; r++) {
    const u0 = process.cpuUsage();
    for (const c of cases) run(c.input);
    const du = process.cpuUsage(u0);
    times.push(du.user + du.system);
  }
  const tm = trimmedMean(times, 2);
  console.log(
    `[in-process] ${label.padEnd(16)} PASS  trimmed_mean=${tm.toFixed(0)} us  min=${Math.min(...times)} us  max=${Math.max(...times)} us`
  );
  return { label, trimmedMeanUs: tm, times };
}

function benchSubprocess(label, mainTsPath, rounds = 9) {
  const inputDir = join(ROOT, 'practice/input');
  const outDir = join(tmpdir(), 'makefun-bench-out');
  const times = [];
  for (let r = 0; r < rounds + 1; r++) {
    const py = spawnSync(
      'python3',
      [
        '-c',
        `import os, resource, subprocess, sys
env = dict(os.environ)
env['MAKEFUN_INPUT_DIR'] = sys.argv[2]
env['MAKEFUN_OUTPUT_DIR'] = sys.argv[3]
os.makedirs(sys.argv[3], exist_ok=True)
r0 = resource.getrusage(resource.RUSAGE_CHILDREN)
p = subprocess.run([sys.argv[1], sys.argv[4]], env=env)
if p.returncode != 0: sys.exit(p.returncode)
r1 = resource.getrusage(resource.RUSAGE_CHILDREN)
us = int(round(((r1.ru_utime - r0.ru_utime) + (r1.ru_stime - r0.ru_stime)) * 1_000_000))
print(us)
`,
        process.execPath,
        inputDir,
        outDir,
        mainTsPath,
      ],
      { encoding: 'utf8' }
    );
    if (py.status !== 0) {
      console.error(`Subprocess bench failed for ${label}: ${py.stderr}`);
      process.exitCode = 1;
      return null;
    }
    const us = Number(py.stdout.trim());
    if (r > 0) times.push(us);
  }
  const tm = trimmedMean(times, 2);
  console.log(
    `[subprocess] ${label.padEnd(16)} PASS  trimmed_mean=${tm.toFixed(0)} us  min=${Math.min(...times)} us  max=${Math.max(...times)} us`
  );
  return { label, trimmedMeanUs: tm, times };
}

function buildEdgeCases() {
  const edge1 = {
    site: { title: 'Edge & "Site" <1>', base_url: 'https://edge.test/sub///', per_page: 2, recent: 3 },
    templates: {
      // Malformed templates to verify exact TemplateError messages
      'bad-var': 'Hello {{ unclosed',
      'bad-raw': 'Hello {{{ unclosed',
      'bad-tag': '{% if a',
      'bad-path': '{{ 123abc }}',
      'bad-unknown': '{% unknown %}',
      'bad-else': '{% else %}',
      'bad-double-else': '{% if a %}1{% else %}2{% else %}3{% endif %}',
      'bad-endfor': '{% endfor %}',
      'bad-mismatch': '{% if a %}{% endfor %}',
      'bad-unclosed': '{% for x in tags %}hi',
      // Recursive include depth test (INCLUDE_DEPTH = 8)
      rec: '[{% include "rec" %}]',
      // Shadowing, prototype safety, loop winning over element, arrays, booleans, standalone tags
      post:
        '  {% include "rec" %}  \n' +
        '{% include "missing-partial" %}\n' +
        'T={{ page.title }}|S={{ page.slug }}|D={{ page.date }}|DL={{ page.date_long }}|RM={{ page.reading_minutes }}|IP={{ page.is_post }}\n' +
        'PROTO={{ page.toString }}|{{ page.constructor }}|{{ page.tags.map }}|{{ page.tags.length }}|{{ toString }}\n' +
        'ARR={{ page.tags }}|BOOL={{ page.is_post }}|NULL={{ page.newer }}|OBJ={{ site }}\n' +
        'SHADOW:{% for page in recent %}[{{ page.title }}:{{ loop.index }}/{{ loop.length }}:{{ loop.first }}:{{ loop.last }}:{{ loop }}]{% endfor %}\n' +
        'LOOPWIN:{% for loop in page.tags %}[{{ loop.index }}:{{ loop.name }}]{% endfor %}\n' +
        'NEIGH:{% if page.newer %}{{ page.newer.title }}{% else %}NONE{% endif %}|{% if page.older %}{{ page.older.title }}{% else %}NONE{% endif %}\n' +
        'TOC:{% for h in page.toc %}{{ h.level }}:{{ h.id }}:{{{ h.html }}};{% endfor %}\n' +
        'BODY:\n{{{ page.content }}}',
      page:
        'PAGE={{ page.title }}|EX={{{ page.excerpt }}}|TAGS={% for t in page.tags %}{{ t.name }}({{ t.url }}),{% endfor %}\n{{{ page.content }}}',
      index:
        'IDX {{ pager.number }}/{{ pager.total }} {{ pager.url }} prev={{ pager.newer_url }} next={{ pager.older_url }}\n' +
        '{% for p in posts %}CARD:{{ p.title }}|{{ p.reading_minutes }}|{{ p.summary }}|{{{ p.excerpt }}}\n{% endfor %}' +
        '{% if not posts %}EMPTY{% endif %}',
      tag: 'TAG {{ tag.name }} ({{ tag.count }})\n{% for p in tag.posts %}{{ p.title }};{% endfor %}',
      tags: 'ALLTAGS:{% for t in tags %}{{ t.name }}={{ t.count }};{% endfor %}',
    },
    files: [
      // Refusal & error-priority cases
      { path: 'err-nofm.md', content: 'just text' },
      { path: 'err-only-dash.md', content: '---' },
      { path: 'err-unclosed-priority.md', content: '---\nbadline\nunknown: 1\n' },
      { path: 'err-notitle.md', content: '---\n---' },
      { path: 'err-badline.md', content: '---\ntitle:ok\n---\nhi' },
      { path: 'err-unknown.md', content: '---\nfoo: bar\ntitle: ok\n---\n' },
      { path: 'err-dup.md', content: '---\ntitle: a\ntitle: b\n---\n' },
      { path: 'err-emptyval.md', content: '---\ntitle:   \t \n---\n' },
      { path: 'err-emptyval2.md', content: '---\ntitle:\n---\n' },
      { path: 'err-quote-unclosed.md', content: '---\ntitle: "abc\n---\n' },
      { path: 'err-quote-stray.md', content: '---\ntitle: "a"b"\n---\n' },
      { path: 'err-quote-esc.md', content: '---\ntitle: "a\\nb"\n---\n' },
      { path: 'err-quote-trail-bs.md', content: '---\ntitle: "abc\\"\n---\n' },
      { path: 'err-bare-bracket.md', content: '---\ntitle: [nope]\n---\n' },
      { path: 'err-date-leap.md', content: '---\ntitle: d\ndate: 2025-02-29\n---\n' },
      { path: 'err-date-range.md', content: '---\ntitle: d\ndate: 1969-12-31\n---\n' },
      { path: 'err-tags-empty.md', content: '---\ntitle: t\ntags: [a, , b]\n---\n' },
      { path: 'err-tags-quote.md', content: '---\ntitle: t\ntags: ["a"]\n---\n' },
      { path: 'err-slug-65.md', content: `---\ntitle: s\nslug: ${'a'.repeat(65)}\n---\n` },
      { path: 'err-slug-dash.md', content: '---\ntitle: s\nslug: a--b\n---\n' },
      { path: 'err-layout-bad.md', content: '---\ntitle: l\nlayout: bad-var\n---\n' },
      { path: 'tags/own.md', content: '---\ntitle: own\n---\n' },
      { path: 'page/own.md', content: '---\ntitle: own\n---\n' },
      { path: 'posts/nodate.md', content: '---\ntitle: nodate\n---\n' },
      { path: 'posts/draft.md', content: '---\ntitle: draft\ndate: 2024-02-29\ndraft: true\n---\nbody' },
      // Valid rich Markdown & CRLF / lone CR & Unicode & reserved root slugs
      {
        path: 'root-posts.md',
        content: '---\r\ntitle: Posts\r\n---\r\nCollision with reserved root dir `posts`.\r',
      },
      {
        path: 'root-unicode.md',
        content:
          '---\n# comment line\n   \t  \ntitle: "Café \\"Zürich\\" \\\\ ' +
          'a'.repeat(55) +
          ' end"\nsummary: "Sum \\"1\\""\ntags: [  Only Page Tag , only-page-tag ]\n---\n' +
          '## Heading & *Em* **Strong**\n\n' +
          '## Heading & *Em* **Strong**\n\n' +
          '####### Not a heading\n# \n\n' +
          '> quote 1\n>   \n>quote 2\n\n' +
          '> \n>\n\n' +
          '```\n```\n\n' +
          '```\n\n```\n\n' +
          '```c++\n<a & "b" \'c\'>\n```\n\n' +
          '- item 1\n  cont 1\n  \tnot cont\n* item 2\n\n' +
          '5. five\n  cont five\n6. six\n\n' +
          '1234567890. too many digits\n\n' +
          '  indented para line  \n---  \n' +
          'inline: \\\\ \\` \\* \\_ \\[ \\] \\( \\) \\# \\+ \\- \\. \\! \\> \\a \\\n' +
          'spans: `` ``a` `x<y` **a *b* \\**c** **** ***x*** *a** *a***b* _u_\n' +
          'links: [ok](posts/p1.md#h) [](static.txt#f) [bad](no such) [empty]() [climb](../../x.md) [draft](posts/draft.md) [dup](posts/draft.md) [abs](/x) [frag](#y) [sch](custom+1.2-3:abc) [br\\[k\\]](static.txt)\n\n' +
          '```unclosed\nline1\n',
      },
      {
        path: 'posts/p1.md',
        content:
          '---\ntitle: "First Post"\ndate: 2024-02-29\ntags: [JS, js, Node.js]\ndraft: false\n---\n' +
          'First paragraph with [back](../root-unicode.md) and **bold**.\n\n' +
          '## Sec Two ##\n### Sec Three\n#### Sec Four\n',
      },
      {
        path: 'posts/p2.md',
        content: '---\ntitle: Second Post\ndate: 2024-02-29\ntags: []\nslug: ' + 'a'.repeat(64) + '\n---',
      },
      { path: 'static.txt', content: 'hello static' },
      { path: 'index.html', content: 'shadowed static!' },
      { path: 'posts/first-post/index.html', content: 'shadowed post!' },
    ],
  };

  // Edge case 2: completely empty site (0 posts, missing index/tag/tags templates)
  const edge2 = {
    site: { title: 'Empty', base_url: '', per_page: 5, recent: 3 },
    templates: { page: '{{ page.title }}:{{ page.reading_minutes }}' },
    files: [{ path: 'a.md', content: '---\ntitle: !!!\n---\n   \t\n' }],
  };

  return [
    { id: 'edge-rich', input: edge1 },
    { id: 'edge-empty', input: edge2 },
  ];
}

async function runEdgeTests() {
  const { run: refRun } = await import(new URL('../baselines/makefun-site/solve.js', import.meta.url).href);
  const { run: optRun } = await import(new URL('../solve.js', import.meta.url).href);
  const cases = buildEdgeCases();
  for (const c of cases) {
    const expected = refRun(JSON.parse(JSON.stringify(c.input)));
    const actual1 = optRun(JSON.parse(JSON.stringify(c.input)));
    const actual2 = optRun(JSON.parse(JSON.stringify(c.input)));
    const diff = findFirstDiff(actual1, expected, c.id);
    if (diff) {
      console.error(`EDGE FAIL: ${diff}`);
      process.exitCode = 1;
      return false;
    }
    if (canonical(actual1) !== canonical(expected)) {
      console.error(`EDGE FAIL canonical mismatch on ${c.id}`);
      process.exitCode = 1;
      return false;
    }
    if (JSON.stringify(actual1) !== JSON.stringify(actual2)) {
      console.error(`EDGE FAIL non-deterministic on ${c.id}`);
      process.exitCode = 1;
      return false;
    }
  }
  console.log(`EDGE PASS: ${cases.length}/${cases.length} comprehensive edge-case sites 100% byte-identical`);
  return true;
}

async function runFuzz(count) {
  const { generate } = await import(new URL('../program/generator/subject/sites.mjs', import.meta.url).href);
  const { streamFor } = await import(new URL('../program/generator/rng.ts', import.meta.url).href);
  const { run: refRun } = await import(new URL('../baselines/makefun-site/solve.js', import.meta.url).href);
  const { run: optRun } = await import(new URL('../solve.js', import.meta.url).href);

  const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  let refTotal = 0;
  let optTotal = 0;
  for (let i = 0; i < count; i++) {
    const input = generate(streamFor(seed, 'fuzz', i), i);
    const inputClone = JSON.parse(JSON.stringify(input));
    const u0 = process.cpuUsage();
    const expected = refRun(inputClone);
    const d0 = process.cpuUsage(u0);
    refTotal += d0.user + d0.system;

    const u1 = process.cpuUsage();
    const actual = optRun(input);
    const d1 = process.cpuUsage(u1);
    optTotal += d1.user + d1.system;

    const diff = findFirstDiff(actual, expected, `fuzz-${i}`);
    if (diff) {
      console.error(`FUZZ FAIL: ${diff}`);
      process.exitCode = 1;
      return false;
    }
    if (canonical(actual) !== canonical(expected)) {
      console.error(`FUZZ FAIL canonical mismatch on fuzz-${i}`);
      process.exitCode = 1;
      return false;
    }
  }
  console.log(
    `FUZZ PASS: ${count}/${count} random sites identical (ref=${(refTotal / 1000).toFixed(1)}ms, opt=${(optTotal / 1000).toFixed(1)}ms, speedup=${(refTotal / optTotal).toFixed(2)}x)`
  );
  return true;
}

function benchNullControl(rounds = 9) {
  const nullTs = join(tmpdir(), 'makefun-null-control.ts');
  writeFileSync(nullTs, 'export {};\n');
  const res = benchSubprocess('null-control', nullTs, rounds);
  rmSync(nullTs, { force: true });
  return res;
}

function runGeneratedScorerTest() {
  const dir = join(tmpdir(), 'makefun-gen-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'seed'), { recursive: true });
  mkdirSync(join(dir, 'out1'), { recursive: true });
  mkdirSync(join(dir, 'out2'), { recursive: true });
  mkdirSync(join(dir, 'scores'), { recursive: true });

  const seed = 'deadbeefcafebabe0123456789abcdefdeadbeefcafebabe0123456789abcdef';
  writeFileSync(
    join(dir, 'seed', 'seed.json'),
    JSON.stringify({ schema: 'agent-fun/instance-seed/v1', seed })
  );

  const draw = spawnSync(process.execPath, [join(ROOT, 'program/generator/draw.ts')], {
    env: { ...process.env, MAKEFUN_INPUT_DIR: join(dir, 'seed'), MAKEFUN_OUTPUT_DIR: join(dir, 'drawn') },
    encoding: 'utf8',
  });
  if (draw.status !== 0) {
    console.error('draw.ts failed:', draw.stderr);
    process.exitCode = 1;
    return false;
  }

  for (const outSub of ['out1', 'out2']) {
    const r = spawnSync(process.execPath, [join(ROOT, 'main.ts')], {
      env: { ...process.env, MAKEFUN_INPUT_DIR: join(dir, 'drawn/input'), MAKEFUN_OUTPUT_DIR: join(dir, outSub) },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.error('main.ts failed:', r.stderr);
      process.exitCode = 1;
      return false;
    }
  }

  const a1 = readFileSync(join(dir, 'out1/answers.json'));
  const a2 = readFileSync(join(dir, 'out2/answers.json'));
  if (!a1.equals(a2)) {
    console.error('GENERATED SEED DETERMINISM FAIL');
    process.exitCode = 1;
    return false;
  }

  const score = spawnSync(process.execPath, [join(ROOT, 'program/scorer/main.ts')], {
    env: {
      ...process.env,
      MAKEFUN_OUTPUT_DIR: join(dir, 'out1'),
      MAKEFUN_REFERENCE_DIR: join(dir, 'drawn/reference'),
      MAKEFUN_SCORES_DIR: join(dir, 'scores'),
    },
    encoding: 'utf8',
  });
  if (score.status !== 0) {
    console.error('scorer failed:', score.stderr);
    process.exitCode = 1;
    return false;
  }
  const scoresJson = JSON.parse(readFileSync(join(dir, 'scores/scores.json'), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  if (scoresJson.passed !== 1) {
    console.error('GENERATED SEED SCORER FAIL:', scoresJson);
    process.exitCode = 1;
    return false;
  }
  console.log(`DRAW+SCORER PASS: fresh seed ${scoresJson.cases_passed}/${scoresJson.cases_total} identical + deterministic`);
  return true;
}

const args = process.argv.slice(2);
const { cases, expected } = loadPractice();

if (args.includes('--edge')) {
  await runEdgeTests();
} else if (args.includes('--fuzz')) {
  const idx = args.indexOf('--fuzz');
  const n = Number(args[idx + 1] ?? 15);
  await runFuzz(n);
} else if (args.includes('--final')) {
  await runEdgeTests();
  await runFuzz(30);
  runGeneratedScorerTest();
  const baseIn = await benchInProcess(
    'baseline',
    new URL('../baselines/makefun-site/solve.js', import.meta.url).href,
    cases,
    expected,
    9
  );
  const optIn = await benchInProcess('optimized', new URL('../solve.js', import.meta.url).href, cases, expected, 9);
  if (baseIn && optIn) {
    console.log(`[in-process] speedup: ${(baseIn.trimmedMeanUs / optIn.trimmedMeanUs).toFixed(2)}x`);
  }
  const ctrl = benchNullControl(9);
  const baseSub = benchSubprocess('baseline', join(ROOT, 'baselines/makefun-site/main.ts'), 9);
  const optSub = benchSubprocess('optimized', join(ROOT, 'main.ts'), 9);
  if (ctrl && baseSub && optSub) {
    const netBase = baseSub.trimmedMeanUs - ctrl.trimmedMeanUs;
    const netOpt = optSub.trimmedMeanUs - ctrl.trimmedMeanUs;
    console.log(
      `[net-cpu]    baseline=${netBase.toFixed(0)} us  optimized=${netOpt.toFixed(0)} us  margin=${(netBase - netOpt).toFixed(0)} us  speedup=${(netBase / netOpt).toFixed(2)}x`
    );
  }
} else {
  const baseIn = await benchInProcess(
    'baseline',
    new URL('../baselines/makefun-site/solve.js', import.meta.url).href,
    cases,
    expected,
    9
  );
  const optIn = await benchInProcess('optimized', new URL('../solve.js', import.meta.url).href, cases, expected, 9);
  if (baseIn && optIn) {
    console.log(`[in-process] speedup: ${(baseIn.trimmedMeanUs / optIn.trimmedMeanUs).toFixed(2)}x`);
  }
  if (args.includes('--sub')) {
    const baseSub = benchSubprocess('baseline', join(ROOT, 'baselines/makefun-site/main.ts'), 9);
    const optSub = benchSubprocess('optimized', join(ROOT, 'main.ts'), 9);
    if (baseSub && optSub) {
      console.log(`[subprocess] speedup: ${(baseSub.trimmedMeanUs / optSub.trimmedMeanUs).toFixed(2)}x`);
    }
  }
}
