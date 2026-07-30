// scripts/verify-batch-live.mjs
//
// Post-push verification of a single topic batch against the LIVE table.
// Generalized from verify-fsa-batch.mjs's pattern. Deliberately does NOT read
// the migration .sql file -- the only trustworthy check is the live table
// compared against the reviewed draft JSON (source of truth).
//
// Usage: node scripts/verify-batch-live.mjs --prefix=Q --unit="Quantitative Methods" --draft=.superpowers/sdd/q-batch-draft.json --expected-total=136
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=([\s\S]*)$/);
  if (!m) throw new Error(`bad arg: ${a}`);
  return [m[1], m[2]];
}));
for (const req of ['prefix', 'unit', 'draft', 'expected-total']) {
  if (!args[req]) throw new Error(`missing required --${req}`);
}
const PREFIX = args.prefix;
const UNIT = args.unit;
const EXPECTED_TOTAL = parseInt(args['expected-total'], 10);
const DRAFT = JSON.parse(readFileSync(args.draft, 'utf8'));

const tmpSqlPath = fileURLToPath(new URL('../.superpowers/sdd/.verify-query.sql', import.meta.url));
function q(sql) {
  writeFileSync(tmpSqlPath, sql, 'utf8');
  const out = execFileSync(
    'npx',
    ['--yes', 'supabase@latest', 'db', 'query', '--linked', '-f', tmpSqlPath],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true }
  );
  const start = out.indexOf('{');
  if (start === -1) throw new Error(`no JSON in CLI output:\n${out}`);
  return JSON.parse(out.slice(start)).rows;
}

const fails = [];
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`);
};

const esc = s => s.replace(/'/g, "''");

console.log(`--- 1. row counts (${PREFIX}) ---`);
const counts = q(
  `select (select count(*)::int from questions where id ~ '^${PREFIX}[0-9][0-9]$') as prefixed_ids, ` +
  `(select count(*)::int from questions where unit = '${esc(UNIT)}') as unit_count, ` +
  `(select count(*)::int from questions) as bank_total;`);
console.log(JSON.stringify(counts, null, 2));
check(`${PREFIX}-prefixed rows`, counts[0].prefixed_ids, 50);
check(`unit='${UNIT}' count`, counts[0].unit_count, 50);
check('bank total', counts[0].bank_total, EXPECTED_TOTAL);

console.log(`\n--- 2. answer-position tally (live, ${PREFIX}) ---`);
const tally = q(`select answer, count(*)::int as n from questions where unit = '${esc(UNIT)}' group by 1 order by 1;`);
console.log(JSON.stringify(tally, null, 2));
const draftTally = { 0: 0, 1: 0, 2: 0 };
DRAFT.forEach(d => draftTally[d.answer]++);
[0, 1, 2].forEach(a => {
  const row = tally.find(r => r.answer === a);
  check(`answer:${a} matches draft`, row ? row.n : 0, draftTally[a]);
});

console.log('\n--- 3. stem uniqueness across the FULL live bank ---');
const stemCheck = q('select count(*)::int as total, count(distinct stem)::int as distinct_stems from questions;');
console.log(JSON.stringify(stemCheck, null, 2));
check('no duplicate stems bank-wide', stemCheck[0].distinct_stems, stemCheck[0].total);

console.log(`\n--- 4. id integrity (${PREFIX}) ---`);
const liveIds = q(`select id from questions where unit = '${esc(UNIT)}' order by id;`).map(r => r.id);
check(`live ${PREFIX} ids exactly match draft ids`, liveIds, DRAFT.map(d => d.id).sort());

console.log(`\n--- 5. field-by-field content match vs the reviewed draft (${PREFIX}) ---`);
const live = q(`select id, unit, active, topic, concept, stem, choices, answer, why from questions where unit = '${esc(UNIT)}' order by id;`);
const byId = new Map(live.map(r => [r.id, r]));
let drift = 0;
for (const d of DRAFT) {
  const r = byId.get(d.id);
  if (!r) { fails.push(`${d.id}: missing from live table`); drift++; continue; }
  const cmp = [
    ['unit', r.unit, UNIT],
    ['active', r.active, true],
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
  try { unlinkSync(tmpSqlPath); } catch (e) {}
  process.exit(1);
}
console.log(`ALL LIVE CHECKS PASSED for ${PREFIX}: 50 rows, unit='${UNIT}', tally matches draft,`);
console.log('no duplicate stems bank-wide, zero field-level drift from source.');
try { unlinkSync(tmpSqlPath); } catch (e) { /* harmless leftover, gitignored scratch dir */ }
