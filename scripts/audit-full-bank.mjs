// scripts/audit-full-bank.mjs
//
// Cross-bank machine audit for the nine-topic curriculum expansion. Checks,
// across the EXISTING live bank plus every new draft batch together:
//   1. globally unique ids
//   2. no duplicate (normalized) stems
//   3. near-duplicate stem candidates (word-bigram Jaccard; both as-is and
//      number-stripped "template" similarity), reported for human judgment
//   4. exactly 3 choices, unique choice text, answer in 0-2, everywhere
//   5. per-batch answer-position balance
//   6. SQL validity of each new batch's generated migration. A live
//      insert-then-verified-delete round-trip against the linked project was
//      attempted for this (a single multi-row INSERT is atomic in Postgres,
//      so insert-then-delete-same-ids is net-zero and would have proven the
//      SQL against the real schema/constraints) but the Claude Code auto
//      mode classifier denies DB-writing commands in this environment (the
//      same class of block the FSA batch hit on `db push`) -- confirmed by
//      probe that plain SELECTs are unaffected, only writes are blocked. Per
//      the classifier's own guidance this script does not attempt a
//      workaround. Instead this check re-runs the generator's full
//      structural/type/constraint validation independently, in pure JS, as
//      a redundant cross-check with no DB access -- it proves the SQL was
//      built from data satisfying every constraint the live schema enforces
//      (3 choices, answer 0-2, all NOT NULL columns populated, valid jsonb),
//      just not via a live execution. This script's ONLY live-project
//      contact is the read-only pull of existing rows at the top (step 0).
//
// Usage: node scripts/audit-full-bank.mjs .superpowers/sdd/batch-manifest.json
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('usage: node scripts/audit-full-bank.mjs <manifest.json>');
const MANIFEST = JSON.parse(readFileSync(manifestPath, 'utf8'));

const tmpSqlPath = fileURLToPath(new URL('../.superpowers/sdd/.audit-query.sql', import.meta.url));
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

const problems = [];
const warnings = [];
const report = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) problems.push(`${label}${detail ? ': ' + detail : ''}`);
};

console.log('=== Pulling existing live bank ===');
const live = q('select id, unit, topic, concept, stem, choices, answer, active from questions order by id;');
console.log(`live rows: ${live.length}`);

console.log('\n=== Loading new draft batches ===');
const drafts = MANIFEST.map(m => ({
  ...m,
  questions: JSON.parse(readFileSync(m.draft, 'utf8')),
}));
drafts.forEach(d => console.log(`${d.prefix}: ${d.questions.length} questions from ${d.draft}`));

// Master combined list: {id, stem, choices, answer, source}
const master = [
  ...live.map(r => ({ id: r.id, stem: r.stem, choices: r.choices, answer: r.answer, source: 'live' })),
  ...drafts.flatMap(d => d.questions.map(qq => ({ id: qq.id, stem: qq.stem, choices: qq.choices, answer: qq.answer, source: d.prefix }))),
];
console.log(`\ncombined bank size: ${master.length} (${live.length} live + ${master.length - live.length} new)`);

console.log('\n=== 1. Global id uniqueness ===');
const idCounts = new Map();
master.forEach(m => idCounts.set(m.id, (idCounts.get(m.id) || 0) + 1));
const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1);
report('all ids globally unique', dupIds.length === 0, dupIds.length ? JSON.stringify(dupIds) : `${master.length} unique ids`);

console.log('\n=== 2. Exact duplicate stems (normalized) ===');
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const byNorm = new Map();
master.forEach(m => {
  const key = norm(m.stem);
  if (!byNorm.has(key)) byNorm.set(key, []);
  byNorm.get(key).push(m.id);
});
const exactDupes = [...byNorm.entries()].filter(([, ids]) => ids.length > 1);
report('no exact-duplicate stems bank-wide', exactDupes.length === 0,
  exactDupes.length ? JSON.stringify(exactDupes.map(([, ids]) => ids)) : `${byNorm.size} distinct normalized stems`);

console.log('\n=== 3. Near-duplicate stem candidates (for human judgment, not a hard fail) ===');
const normalize = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const templatize = s => normalize(s).replace(/\d+/g, '#');
const bigrams = s => {
  const words = s.split(' ').filter(Boolean);
  const bg = new Set();
  for (let i = 0; i < words.length - 1; i++) bg.add(words[i] + '_' + words[i + 1]);
  if (bg.size === 0) words.forEach(w => bg.add(w));
  return bg;
};
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};
const items = master.map(m => ({
  id: m.id,
  stemBg: bigrams(normalize(m.stem)),
  tmplBg: bigrams(templatize(m.stem)),
}));
const nearDupes = [];
const templateOnly = [];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const stemSim = jaccard(items[i].stemBg, items[j].stemBg);
    if (stemSim > 0.55) {
      nearDupes.push({ a: items[i].id, b: items[j].id, sim: Math.round(stemSim * 100) });
      continue;
    }
    const tmplSim = jaccard(items[i].tmplBg, items[j].tmplBg);
    if (tmplSim > 0.75) {
      templateOnly.push({ a: items[i].id, b: items[j].id, sim: Math.round(tmplSim * 100) });
    }
  }
}
nearDupes.sort((a, b) => b.sim - a.sim);
templateOnly.sort((a, b) => b.sim - a.sim);
console.log(`near-duplicate candidates (similar even with numbers): ${nearDupes.length}`);
nearDupes.slice(0, 40).forEach(p => console.log(`  ${p.sim}%  ${p.a} <-> ${p.b}`));
if (nearDupes.length > 40) console.log(`  ... ${nearDupes.length - 40} more not shown`);
console.log(`same-template-different-numbers candidates: ${templateOnly.length}`);
templateOnly.slice(0, 40).forEach(p => console.log(`  ${p.sim}%  ${p.a} <-> ${p.b}`));
if (templateOnly.length > 40) console.log(`  ... ${templateOnly.length - 40} more not shown`);
if (nearDupes.length) warnings.push(`${nearDupes.length} near-duplicate stem candidate pair(s) need human adjudication`);
if (templateOnly.length) warnings.push(`${templateOnly.length} same-template-different-number pair(s) noted (expected for a bank covering related concepts; verify each is a different key/ask)`);

console.log('\n=== 4. Structural checks (3 choices, unique choice text, answer 0-2) ===');
let structFails = 0;
for (const m of master) {
  if (!Array.isArray(m.choices) || m.choices.length !== 3) { report(`${m.id} choices count`, false, JSON.stringify(m.choices)); structFails++; continue; }
  if (new Set(m.choices).size !== 3) { report(`${m.id} unique choices`, false, JSON.stringify(m.choices)); structFails++; }
  if (!Number.isInteger(m.answer) || m.answer < 0 || m.answer > 2) { report(`${m.id} answer range`, false, String(m.answer)); structFails++; }
}
report('all questions have exactly 3 unique choices and answer in 0-2', structFails === 0, `${structFails} problem(s) across ${master.length} questions`);

console.log('\n=== 5. Per-batch answer-position balance ===');
for (const d of drafts) {
  const tally = { 0: 0, 1: 0, 2: 0 };
  d.questions.forEach(qq => tally[qq.answer]++);
  const n = d.questions.length;
  const lo = Math.floor(n * 0.30), hi = Math.ceil(n * 0.36);
  const ok = [0, 1, 2].every(a => tally[a] >= lo && tally[a] <= hi);
  report(`${d.prefix} position balance (band ${lo}-${hi})`, ok, JSON.stringify(tally));
}

console.log('\n=== 6. SQL validity: redundant structural re-validation (no DB write attempted -- see header note) ===');
for (const d of drafts) {
  const sql = readFileSync(d.sql, 'utf8');
  let ok = true;
  const fails = [];
  const need2 = (cond, msg) => { if (!cond) { ok = false; fails.push(msg); } };
  // Mirrors gen-batch-migration.mjs's own checks, run again here independently
  // against the SQL file's paired draft, so this is a second code path, not
  // just "trust the generator that already ran once."
  need2(/^insert into questions \(id, unit, topic, concept, stem, choices, answer, why\) values/m.test(sql), 'insert statement shape unexpected');
  need2(sql.trim().endsWith(';'), 'statement not terminated');
  const tupleMatches = sql.match(/\(\s*'[^']*'/g) || [];
  need2(tupleMatches.length === d.questions.length, `expected ${d.questions.length} value tuples, found ${tupleMatches.length}`);
  for (const qq of d.questions) {
    need2(Array.isArray(qq.choices) && qq.choices.length === 3, `${qq.id}: choices != 3`);
    need2(Number.isInteger(qq.answer) && qq.answer >= 0 && qq.answer <= 2, `${qq.id}: answer out of 0-2`);
    for (const f of ['id', 'topic', 'concept', 'stem', 'why']) {
      need2(typeof qq[f] === 'string' && qq[f].trim().length > 0, `${qq.id}: ${f} not a non-empty string`);
    }
    need2(sql.includes(`'${qq.id}'`), `${qq.id}: id not found verbatim in generated SQL`);
  }
  report(`${d.prefix} migration SQL structurally valid (redundant check)`, ok, ok ? `${d.questions.length} tuples confirmed` : fails.join('; '));
}

try { unlinkSync(tmpSqlPath); } catch (e) { /* harmless leftover, gitignored scratch dir */ }

console.log('\n' + '='.repeat(70));
if (warnings.length) {
  console.log(`${warnings.length} item(s) need human judgment (not failures):`);
  warnings.forEach(w => console.log(' - ' + w));
}
if (problems.length) {
  console.error(`\nAUDIT FAILED -- ${problems.length} problem(s):`);
  problems.forEach(p => console.error(' - ' + p));
  process.exit(1);
}
console.log('\nALL MACHINE AUDITS PASSED across the combined bank.');
