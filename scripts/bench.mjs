import { readFileSync } from 'node:fs';
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

async function profileBaseline(cases) {
  const { PIPELINE, REPORT_FILE } = await import(new URL('../baselines/makefun-site/vendor/makefun-site/index.js', import.meta.url).href);
  const { parseTemplate, TemplateError } = await import(new URL('../baselines/makefun-site/vendor/makefun-site/lib/template.js', import.meta.url).href);
  const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  const totals = new Map();
  const add = (name, us) => totals.set(name, (totals.get(name) ?? 0) + us);

  // Warmup
  const { build } = await import(new URL('../baselines/makefun-site/vendor/makefun-site/index.js', import.meta.url).href);
  for (const c of cases) build(c.input);

  const ROUNDS = 5;
  for (let r = 0; r < ROUNDS; r++) {
    for (const c of cases) {
      const input = c.input;
      let u0 = process.cpuUsage();
      const templates = new Map();
      const report = [];
      for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
        try {
          templates.set(name, parseTemplate(name, input.templates[name]));
        } catch (err) {
          if (!(err instanceof TemplateError)) throw err;
          report.push(err.message);
        }
      }
      let du = process.cpuUsage(u0);
      add('parseTemplates', du.user + du.system);

      const b = {
        input,
        base: input.site.base_url.replace(/\/+$/, ''),
        templates,
        sources: [],
        statics: [],
        bySource: new Map(),
        broken: new Set(),
        report,
        posts: [],
        tags: [],
        cards: new Map(),
        output: {},
      };
      for (const plugin of PIPELINE) {
        u0 = process.cpuUsage();
        plugin(b);
        du = process.cpuUsage(u0);
        add(plugin.name, du.user + du.system);
      }
      if (!b.output[REPORT_FILE]) throw new Error('missing report');
    }
  }

  console.log('\n=== Baseline Phase Profile (avg CPU us over 3 practice cases) ===');
  let sum = 0;
  const rows = [...totals.entries()].map(([k, v]) => [k, v / ROUNDS]);
  for (const [, v] of rows) sum += v;
  rows.sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(18)} ${v.toFixed(0).padStart(9)} us  (${((v / sum) * 100).toFixed(1)}%)`);
  }
  console.log(`  ${'TOTAL'.padEnd(18)} ${sum.toFixed(0).padStart(9)} us`);
}

async function benchInProcess(label, solveUrl, cases, expected, rounds = 9) {
  const { run } = await import(solveUrl);
  // Correctness + determinism check
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

  // Warmup
  for (const c of cases) run(c.input);

  const times = [];
  for (let r = 0; r < rounds; r++) {
    const u0 = process.cpuUsage();
    for (const c of cases) run(c.input);
    const du = process.cpuUsage(u0);
    times.push(du.user + du.system);
  }
  const tm = trimmedMean(times, 2);
  console.log(`[in-process] ${label.padEnd(16)} PASS  trimmed_mean=${tm.toFixed(0)} us  min=${Math.min(...times)} us  max=${Math.max(...times)} us`);
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
  console.log(`[subprocess] ${label.padEnd(16)} PASS  trimmed_mean=${tm.toFixed(0)} us  min=${Math.min(...times)} us  max=${Math.max(...times)} us`);
  return { label, trimmedMeanUs: tm, times };
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
      return;
    }
    if (canonical(actual) !== canonical(expected)) {
      console.error(`FUZZ FAIL canonical mismatch on fuzz-${i}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`FUZZ PASS: ${count}/${count} random sites identical (ref=${(refTotal / 1000).toFixed(1)}ms, opt=${(optTotal / 1000).toFixed(1)}ms, speedup=${(refTotal / optTotal).toFixed(2)}x)`);
}

const args = process.argv.slice(2);
const { cases, expected } = loadPractice();

if (args.includes('--profile-baseline')) {
  await profileBaseline(cases);
  await benchInProcess('baseline', new URL('../baselines/makefun-site/solve.js', import.meta.url).href, cases, expected, 9);
  benchSubprocess('baseline', join(ROOT, 'baselines/makefun-site/main.ts'), 9);
} else if (args.includes('--fuzz')) {
  const idx = args.indexOf('--fuzz');
  const n = Number(args[idx + 1] ?? 15);
  await runFuzz(n);
} else {
  const baseIn = await benchInProcess('baseline', new URL('../baselines/makefun-site/solve.js', import.meta.url).href, cases, expected, 9);
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
