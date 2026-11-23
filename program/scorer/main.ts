// The scorer (program/v1, node22). It runs after the entry, in a container of its own: the entry's outputs read-only
// at /output, the instance's reference read-only at /reference (expected.json, generator/draw.ts writes it: every
// case's id, group and the oracle's answer), and /scores writable.
//
// The entry's answer is /output/answers.json, a regular file (never through a link) holding a JSON array, one answer
// per case of /input/cases.json and in its order. Each case passes when its answer is the oracle's as a JSON value:
// the same type, strings code unit for code unit, numbers equal, arrays in order, objects with the same keys in any
// order and each value the same. No file, a file that is not JSON, or a value that is not an array of as many entries
// as there are cases passes no case.
//
// It writes
//   /scores/scores.json  {passed, cases_passed, cases_total}: passed 1 when every case passes, else 0 (the gate:
//                        harness.gate, which the timing heat runs behind), and the counts
//   /scores/checks.json  one row per group of expected.json's `groups`, in order: points its cases, earned those that
//                        pass, pass when all do, and when some fail the detail names the first of them and how many more
//                        failed. It never quotes the reference.
//
// A reference that does not read is the instance's fault: the scorer exits 1 and the grade is a scorer fault, never
// the entry's. Outside a container MAKEFUN_OUTPUT_DIR, MAKEFUN_REFERENCE_DIR and MAKEFUN_SCORES_DIR stand in for the
// mounts.

import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const REFERENCE_DIR = process.env.MAKEFUN_REFERENCE_DIR ?? '/reference';
const SCORES_DIR = process.env.MAKEFUN_SCORES_DIR ?? '/scores';

const EXPECTED_FORMAT = "makefun/speed-home/expected/v1";
const ANSWER_FILE = 'answers.json';
/** The most failing case ids one check's detail names before it counts the rest. */
const NAMED = 5;

interface Expected {
  format: string;
  groups: { key: string; title: string }[];
  cases: { id: string; group: string; output: unknown }[];
}

/** A JSON value with every object's keys in code-unit order: two values are equal when these strings are. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function readExpected(): Expected {
  const file = join(REFERENCE_DIR, 'expected.json');
  if (!lstatSync(file).isFile()) throw new Error('the reference expected.json is not a regular file');
  const v = JSON.parse(readFileSync(file, 'utf8')) as Partial<Expected>;
  if (v.format !== EXPECTED_FORMAT) throw new Error(`the reference expected.json is not ${EXPECTED_FORMAT}`);
  if (!Array.isArray(v.groups) || !Array.isArray(v.cases) || v.cases.length === 0) throw new Error('the reference expected.json lists no groups or no cases');
  const keys = new Set(v.groups.map((g) => g.key));
  for (const c of v.cases) if (typeof c.id !== 'string' || !keys.has(c.group)) throw new Error('the reference expected.json holds a malformed case');
  return v as Expected;
}

function readAnswers(count: number): { answers: unknown[] } | { why: string } {
  const file = join(OUTPUT_DIR, ANSWER_FILE);
  let isFile = false;
  try {
    isFile = lstatSync(file).isFile();
  } catch {
    return { why: `the entry wrote no /output/${ANSWER_FILE}` };
  }
  if (!isFile) return { why: `/output/${ANSWER_FILE} is not a regular file` };
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { why: `/output/${ANSWER_FILE} is not JSON` };
  }
  if (!Array.isArray(v)) return { why: `/output/${ANSWER_FILE} is not a JSON array` };
  if (v.length !== count) return { why: `/output/${ANSWER_FILE} holds ${v.length} entries for ${count} cases` };
  return { answers: v };
}

const expected = readExpected();
const read = readAnswers(expected.cases.length);
/** Each case's verdict: null when it passes, else why it does not. */
const verdicts: (string | null)[] = expected.cases.map((c, i) => {
  if ('why' in read) return read.why;
  return canonical(read.answers[i]) === canonical(c.output) ? null : 'its answer is not the oracle\'s';
});

const passedCount = verdicts.filter((v) => v === null).length;
const scores = { passed: passedCount === expected.cases.length ? 1 : 0, cases_passed: passedCount, cases_total: expected.cases.length };

const checks = expected.groups.map((g) => {
  const idx: number[] = [];
  expected.cases.forEach((c, i) => {
    if (c.group === g.key) idx.push(i);
  });
  const failed = idx.filter((i) => verdicts[i] !== null);
  const row: { key: string; group: string; title: string; points: number; earned: number; pass: boolean; detail?: string } = {
    key: g.key,
    group: g.key,
    title: g.title,
    points: idx.length,
    earned: idx.length - failed.length,
    pass: failed.length === 0,
  };
  if (failed.length > 0) {
    const first = failed[0]!;
    const others = failed.slice(1, NAMED).map((i) => expected.cases[i]!.id);
    const more = failed.length - 1 - others.length;
    const also = others.length === 0 ? '' : `; also ${others.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
    row.detail = `${expected.cases[first]!.id}: ${verdicts[first]}${also}`.slice(0, 2000);
  }
  return row;
});

mkdirSync(SCORES_DIR, { recursive: true });
writeFileSync(join(SCORES_DIR, 'scores.json'), `${JSON.stringify(scores)}\n`);
writeFileSync(join(SCORES_DIR, 'checks.json'), `${JSON.stringify(checks)}\n`);
