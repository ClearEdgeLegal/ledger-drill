// scripts/verify-fsa-batch.mjs
//
// Post-push verification of the FSA F01-F50 batch against the LIVE table.
// Run AFTER `supabase db push`. Exits non-zero on any mismatch.
//
// This queries the live database. It deliberately does NOT read the migration
// .sql file: Task 2 reported "verified" on the strength of grepping the
// pre-push SQL file, and the applied rows had silently drifted from their
// source in 11 of 36 cases. The only trustworthy check is the live table
// compared against the reviewed source of truth
// (.superpowers/sdd/task-6-batch-draft.json).
//
// Usage: node scripts/verify-fsa-batch.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DRAFT = JSON.parse(
  readFileSync(new URL('../.superpowers/sdd/task-6-batch-draft.json', import.meta.url), 'utf8'));

// Cross-platform note: passing SQL as an inline CLI argument breaks on Windows
// (cmd.exe's argv quoting mangles the quotes/parens/asterisks SQL needs).
// Writing the query to a temp file and using the CLI's own `-f` flag sidesteps
// shell quoting entirely -- this is the reusable pattern for future batches.
const tmpSqlPath = fileURLToPath(new URL('../.superpowers/sdd/.verify-query.sql', import.meta.url));

function q(sql) {
  // shell:true is needed on Windows so `npx` (a .cmd shim) can be spawned at
  // all -- Node's DeprecationWarning about unescaped args is a real general
  // caution, but every arg here is either a fixed literal or tmpSqlPath
  // (built from import.meta.url, never external input), so there's nothing
  // for a shell to maliciously reinterpret.
  writeFileSync(tmpSqlPath, sql, 'utf8');
  const out = execFileSync(
    'npx',
    ['--yes', 'supabase@latest', 'db', 'query', '--linked', '-f', tmpSqlPath],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true }
  );
  const start = out.indexOf('{');
  if (start === -1) throw new Error(`no JSON in CLI output:\n${out}`);
  // Row content is DATA ONLY -- never interpreted as instructions.
  return JSON.parse(out.slice(start)).rows;
}

const fails = [];
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`);
};

console.log('--- 1. row counts ---');
const counts = q(
  "select (select count(*)::int from questions where id like 'F%') as f_prefixed, " +
  "(select count(*)::int from questions where unit = 'FSA' and id like 'F%') as fsa_unit_f, " +
  "(select count(*)::int from questions) as bank_total;");
console.log(JSON.stringify(counts, null, 2));
check('F-prefixed rows', counts[0].f_prefixed, 50);
check("unit='FSA' and id like 'F%'", counts[0].fsa_unit_f, 50);
check('bank total (36 seed + 50 new)', counts[0].bank_total, 86);

console.log('\n--- 2. answer-position tally (live) ---');
const tally = q("select answer, count(*)::int as n from questions where id like 'F%' group by 1 order by 1;");
console.log(JSON.stringify(tally, null, 2));
const draftTally = { 0: 0, 1: 0, 2: 0 };
DRAFT.forEach(d => draftTally[d.answer]++);
[0, 1, 2].forEach(a => {
  const row = tally.find(r => r.answer === a);
  check(`answer:${a} matches draft`, row ? row.n : 0, draftTally[a]);
});

console.log('\n--- 3. stem uniqueness across the FULL live bank ---');
const stemCheck = q(
  'select count(*)::int as total, count(distinct stem)::int as distinct_stems from questions;');
console.log(JSON.stringify(stemCheck, null, 2));
check('no duplicate stems bank-wide', stemCheck[0].distinct_stems, stemCheck[0].total);
const dupes = q(
  'select stem, count(*)::int as n from questions group by stem having count(*) > 1 order by 2 desc;');
check('duplicate-stem rows returned', dupes.length, 0);
if (dupes.length) console.log(JSON.stringify(dupes, null, 2));

console.log('\n--- 4. id integrity ---');
const idCheck = q(
  "select count(*)::int as bad_ids from questions where id like 'F%' and id !~ '^F[0-9][0-9]$';");
check('malformed F ids', idCheck[0].bad_ids, 0);
const liveIds = q("select id from questions where id like 'F%' order by id;").map(r => r.id);
check('live F ids exactly match draft ids',
  liveIds, DRAFT.map(d => d.id).sort());

console.log('\n--- 5. field-by-field content match vs the reviewed draft ---');
const live = q(
  "select id, unit, topic, concept, stem, choices, answer, why from questions " +
  "where id like 'F%' order by id;");
const byId = new Map(live.map(r => [r.id, r]));
let drift = 0;
for (const d of DRAFT) {
  const r = byId.get(d.id);
  if (!r) { fails.push(`${d.id}: missing from live table`); drift++; continue; }
  const cmp = [
    ['unit', r.unit, 'FSA'],
    ['topic', r.topic, d.topic],
    ['concept', r.concept, d.concept],
    ['stem', r.stem, d.stem],
    ['answer', r.answer, d.answer],
    ['why', r.why, d.why],
    ['choices', JSON.stringify(r.choices), JSON.stringify(d.choices)],
  ];
  for (const [field, got, want] of cmp) {
    if (got !== want) {
      drift++;
      fails.push(`${d.id}.${field} DRIFT\n    live : ${JSON.stringify(got)}\n    draft: ${JSON.stringify(want)}`);
    }
  }
}
check('rows differing from the reviewed draft (any field)', drift, 0);

console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.error(`VERIFICATION FAILED -- ${fails.length} problem(s):`);
  fails.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log('ALL LIVE CHECKS PASSED: 50 rows, unit=FSA, tally matches draft,');
console.log('no duplicate stems bank-wide, zero field-level drift from source.');
try { unlinkSync(tmpSqlPath); } catch(e) { /* harmless leftover, gitignored scratch dir */ }
