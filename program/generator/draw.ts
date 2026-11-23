// The case generator (program/v1, node22): draws one instance from /input/seed.json (server/competitions/instance.ts
// instanceSeedFile: a drand round's seed) and writes it as
//
//   /output/input/cases.json          what an entry reads at /input: a JSON array of {id, input}, every case in order
//   /output/reference/expected.json   what the scorer reads at /reference: {format, oracle, groups, cases}, each case's
//                                     id, its group and the answer the oracle returns for it
//
// The cases: 3 generated cases (g-0001 onwards) and no corpus (the subject's corpus.json is empty), each drawn
// by the subject's generator (subject/sites.mjs: generate(rng, index)) from a stream of its own (rng.ts streamFor:
// the seed, "case" and its index). Every expected answer is what the oracle,
// makefun-site 1.0.0 vendored under vendor/makefun-site/, returns for the case's input
// (oracle.js run), written as JSON.
//
// cases.json is written before the oracle runs, and the oracle answers each case on a copy read back from those very
// bytes: an oracle that writes into its input cannot change what an entry is handed, and every expected answer is the
// oracle's for exactly the input an entry reads at /input.
//
// Pure: no clock, no network, no environment but the directories (MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for
// /input and /output outside a container), so two runs on one seed write the same bytes (grader/instance.ts draws twice
// and compares).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { streamFor, type Rng } from './rng.ts';

/** The oracle, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./oracle.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
/** The subject's generator, imported by its URL (a .mjs or .js module carries no types) and typed by its contract. */
const { generate } = (await import(new URL("./subject/sites.mjs", import.meta.url).href)) as {
  generate: (rng: Rng, index: number) => unknown;
};

export const EXPECTED_FORMAT = "makefun/speed-home/expected/v1";
/** How many generated cases a set holds. */
export const GENERATED = 3;

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const seedFile = JSON.parse(readFileSync(join(INPUT_DIR, 'seed.json'), 'utf8')) as { schema?: unknown; seed?: unknown };
if (seedFile.schema !== 'agent-fun/instance-seed/v1' || typeof seedFile.seed !== 'string' || !/^[0-9a-f]{64}$/.test(seedFile.seed)) {
  throw new Error('/input/seed.json is not an agent-fun/instance-seed/v1 seed');
}
const seed = seedFile.seed;

const pad = (n: number): string => String(n).padStart(4, '0');
const cases: { id: string; group: string; input: unknown }[] = [];
for (let i = 0; i < GENERATED; i++) cases.push({ id: `g-${pad(i + 1)}`, group: 'generated', input: generate(streamFor(seed, 'case', i), i) });

// What an entry reads, written first (the header); the oracle answers the copy read back from it.
const casesText = JSON.stringify(cases.map((c) => ({ id: c.id, input: c.input })));
mkdirSync(join(OUTPUT_DIR, 'input'), { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'input', 'cases.json'), casesText);
const handed = JSON.parse(casesText) as { id: string; input: unknown }[];

// Each answer as JSON reads it back (undefined as null), the form an entry's answers are compared in.
const answerOf = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const expected = {
  format: EXPECTED_FORMAT,
  oracle: { name: "makefun-site", version: "1.0.0" },
  groups: [
    { key: 'generated', title: 'Cases drawn from the seed' },
  ],
  cases: cases.map((c, i) => ({ id: c.id, group: c.group, output: answerOf(run(handed[i]!.input)) })),
};

mkdirSync(join(OUTPUT_DIR, 'reference'), { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'reference', 'expected.json'), JSON.stringify(expected));
