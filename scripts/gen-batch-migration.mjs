// scripts/gen-batch-migration.mjs
//
// Generalized batch-migration generator for the nine-topic curriculum
// expansion (Q/EC/CI/E/FI/D/A/P/ET). Same contract as
// gen-fsa-batch-migration.mjs: validates a draft batch against every
// authoring rule and REFUSES to emit SQL if anything fails. Never
// hand-transcribe rows -- Task 2's original seed migration drifted from its
// source in 11 of 36 rows precisely because of hand-copying; see
// 20260730010233_fix_v1_seed_quote_drift.sql.
//
// Usage:
//   node scripts/gen-batch-migration.mjs \
//     --prefix=Q --unit="Quantitative Methods" \
//     --draft=.superpowers/sdd/q-batch-draft.json \
//     --out=supabase/migrations/<ts>_q_batch_50.sql \
//     [--meta=.superpowers/sdd/q-batch-meta.json] \
//     [--existing=.superpowers/sdd/existing-ids.json] \
//     [--count=50]
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=([\s\S]*)$/);
  if (!m) throw new Error(`bad arg: ${a}`);
  return [m[1], m[2]];
}));

for (const req of ['prefix', 'unit', 'draft', 'out']) {
  if (!args[req]) throw new Error(`missing required --${req}`);
}
const PREFIX = args.prefix;
const UNIT = args.unit;
const COUNT = args.count ? parseInt(args.count, 10) : 50;
const OUT = args.out;

const QUESTIONS = JSON.parse(readFileSync(args.draft, 'utf8'));
const META = args.meta ? JSON.parse(readFileSync(args.meta, 'utf8')) : null;
const EXISTING_IDS = args.existing ? JSON.parse(readFileSync(args.existing, 'utf8')) : [];

const errs = [];
const need = (cond, msg) => { if (!cond) errs.push(msg); };

need(Array.isArray(QUESTIONS), 'draft is not an array');
need(QUESTIONS.length === COUNT, `expected ${COUNT} questions, found ${QUESTIONS.length}`);

const idRe = new RegExp(`^${PREFIX}\\d\\d$`);
const ids = QUESTIONS.map(q => q.id);
need(new Set(ids).size === ids.length, 'duplicate ids in draft');
for (let n = 1; n <= COUNT; n++) {
  const want = PREFIX + String(n).padStart(2, '0');
  need(ids.includes(want), `missing id ${want}`);
}
need(ids.every(i => idRe.test(i)), `an id is not ${PREFIX}-prefixed two-digit (band: ${PREFIX}01-${PREFIX}${String(COUNT).padStart(2, '0')})`);

const existingSet = new Set(EXISTING_IDS);
for (const id of ids) need(!existingSet.has(id), `id ${id} collides with an existing bank id`);

const KEYS = ['id', 'topic', 'concept', 'stem', 'choices', 'answer', 'why'].sort();
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const stems = new Set();
for (const q of QUESTIONS) {
  need(JSON.stringify(Object.keys(q).sort()) === JSON.stringify(KEYS),
    `${q.id}: unexpected key set (got ${Object.keys(q).sort().join(',')})`);
  need(Array.isArray(q.choices) && q.choices.length === 3,
    `${q.id}: choices must have exactly 3 entries`);
  need(new Set(q.choices).size === 3, `${q.id}: duplicate choice text`);
  need(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 2,
    `${q.id}: answer out of range`);
  for (const f of ['topic', 'concept', 'stem', 'why']) {
    need(typeof q[f] === 'string' && q[f].trim(), `${q.id}: empty ${f}`);
  }
  const hasDoubleQuote = q.stem.includes('"') || q.why.includes('"') || q.choices.some(c => c.includes('"'));
  need(!hasDoubleQuote, `${q.id}: double-quote character present (escaping only doubles single quotes)`);
  need(!stems.has(norm(q.stem)), `${q.id}: duplicate stem within batch`);
  stems.add(norm(q.stem));
}

const tally = { 0: 0, 1: 0, 2: 0 };
QUESTIONS.forEach(q => tally[q.answer]++);
const bandLo = Math.floor(COUNT * 0.30);
const bandHi = Math.ceil(COUNT * 0.36);
for (const a of [0, 1, 2]) {
  need(tally[a] >= bandLo && tally[a] <= bandHi, `answer:${a} count ${tally[a]} outside ${bandLo}-${bandHi} band`);
}

let difficultyTally = null;
if (META) {
  need(Array.isArray(META) && META.length === COUNT, `meta file must have ${COUNT} entries, found ${Array.isArray(META) ? META.length : 'non-array'}`);
  if (Array.isArray(META)) {
    const metaIds = new Set(META.map(m => m.id));
    need(metaIds.size === META.length, 'duplicate ids in meta file');
    for (const id of ids) need(metaIds.has(id), `meta file missing difficulty tag for ${id}`);
    const VALID_DIFF = new Set(['conceptual', 'single-step', 'multi-step']);
    for (const m of META) need(VALID_DIFF.has(m.difficulty), `${m.id}: invalid difficulty "${m.difficulty}"`);
    difficultyTally = { conceptual: 0, 'single-step': 0, 'multi-step': 0 };
    META.forEach(m => { if (VALID_DIFF.has(m.difficulty)) difficultyTally[m.difficulty]++; });
  }
}

if (errs.length) {
  console.error('VALIDATION FAILED:');
  errs.forEach(e => console.error(' -', e));
  process.exit(1);
}

// ---- emit ----
const sqlStr = s => `'${String(s).replace(/'/g, "''")}'`;
const topics = {};
QUESTIONS.forEach(q => topics[q.topic] = (topics[q.topic] || 0) + 1);

const values = QUESTIONS.map(q => {
  const choicesJson = JSON.stringify(q.choices).replace(/'/g, "''");
  return `  (${sqlStr(q.id)}, ${sqlStr(UNIT)}, ${sqlStr(q.topic)}, ${sqlStr(q.concept)}, ` +
         `${sqlStr(q.stem)}, '${choicesJson}'::jsonb, ${q.answer}, ${sqlStr(q.why)})`;
}).join(',\n');

let diffLine = '';
if (difficultyTally) {
  const pct = k => Math.round(100 * difficultyTally[k] / COUNT);
  diffLine = `-- Difficulty mix (machine-tabulated from the batch meta file, not hand-maintained prose):\n` +
    `--   conceptual ${difficultyTally.conceptual} (${pct('conceptual')}%), single-step calc ${difficultyTally['single-step']} (${pct('single-step')}%), ` +
    `multi-step/discrimination ${difficultyTally['multi-step']} (${pct('multi-step')}%). Target ~40/40/20.\n`;
}

const header = `-- ${UNIT} unit batch: ${COUNT} original CFA Level 1-style questions, ids ${PREFIX}01-${PREFIX}${String(COUNT).padStart(2, '0')}.
-- Topics: ${Object.entries(topics).map(([t, n]) => `${t} (${n})`).join(', ')}.
-- Answer positions: index 0 = ${tally[0]}, index 1 = ${tally[1]}, index 2 = ${tally[2]}.
${diffLine}--
-- Rows are generated mechanically by scripts/gen-batch-migration.mjs from
-- ${args.draft} -- not hand-transcribed. (Task 2's original seed migration
-- drifted from its source in 11 of 36 rows precisely because of
-- hand-copying; see 20260730010233_fix_v1_seed_quote_drift.sql.)
`;

const sql = `${header}
insert into questions (id, unit, topic, concept, stem, choices, answer, why) values
${values};
`;

writeFileSync(OUT, sql);
console.log(`Generated ${QUESTIONS.length} rows -> ${OUT}`);
console.log(`answer tally: ${JSON.stringify(tally)}`);
console.log(`topics: ${JSON.stringify(topics)}`);
if (difficultyTally) console.log(`difficulty tally: ${JSON.stringify(difficultyTally)}`);
