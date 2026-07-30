// scripts/gen-fsa-batch-migration.mjs
//
// Generates the FSA 50-question insert migration mechanically from the reviewed
// draft at .superpowers/sdd/task-6-batch-draft.json. Never hand-transcribe the
// rows: Task 2's seed migration drifted from its source in 11 of 36 rows and
// needed a follow-up fix migration (20260730010233_fix_v1_seed_quote_drift.sql).
//
// Usage: node scripts/gen-fsa-batch-migration.mjs <output.sql>
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node scripts/gen-fsa-batch-migration.mjs <output.sql>');

const src = new URL('../.superpowers/sdd/task-6-batch-draft.json', import.meta.url);
const QUESTIONS = JSON.parse(readFileSync(src, 'utf8'));

// ---- validation: refuse to generate anything that fails the authoring rules ----
const errs = [];
const need = (cond, msg) => { if (!cond) errs.push(msg); };

need(Array.isArray(QUESTIONS), 'draft is not an array');
need(QUESTIONS.length === 50, `expected 50 questions, found ${QUESTIONS.length}`);

const ids = QUESTIONS.map(q => q.id);
need(new Set(ids).size === ids.length, 'duplicate ids in draft');
for (let n = 1; n <= 50; n++) {
  const want = 'F' + String(n).padStart(2, '0');
  need(ids.includes(want), `missing id ${want}`);
}
need(ids.every(i => /^F\d\d$/.test(i)), 'an id is not F-prefixed two-digit');

const KEYS = ['id', 'topic', 'concept', 'stem', 'choices', 'answer', 'why'].sort();
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const stems = new Set();
for (const q of QUESTIONS) {
  need(JSON.stringify(Object.keys(q).sort()) === JSON.stringify(KEYS),
    `${q.id}: unexpected key set`);
  need(Array.isArray(q.choices) && q.choices.length === 3,
    `${q.id}: choices must have exactly 3 entries`);
  need(new Set(q.choices).size === 3, `${q.id}: duplicate choice text`);
  need(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 2,
    `${q.id}: answer out of range`);
  for (const f of ['topic', 'concept', 'stem', 'why']) {
    need(typeof q[f] === 'string' && q[f].trim(), `${q.id}: empty ${f}`);
  }
  need(!stems.has(norm(q.stem)), `${q.id}: duplicate stem`);
  stems.add(norm(q.stem));
}

const tally = { 0: 0, 1: 0, 2: 0 };
QUESTIONS.forEach(q => tally[q.answer]++);
for (const a of [0, 1, 2]) {
  need(tally[a] >= 15 && tally[a] <= 18, `answer:${a} count ${tally[a]} outside 15-18`);
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
  return `  (${sqlStr(q.id)}, 'FSA', ${sqlStr(q.topic)}, ${sqlStr(q.concept)}, ` +
         `${sqlStr(q.stem)}, '${choicesJson}'::jsonb, ${q.answer}, ${sqlStr(q.why)})`;
}).join(',\n');

const header = `-- FSA unit batch: 50 original CFA Level 1-style questions, ids F01-F50.
-- Topics: ${Object.entries(topics).map(([t, n]) => `${t} (${n})`).join(', ')}.
-- Answer positions: index 0 = ${tally[0]}, index 1 = ${tally[1]}, index 2 = ${tally[2]}.
--
-- DIFFICULTY MIX DEVIATION -- READ BEFORE COPYING THIS AS A PATTERN.
-- This batch is 36% definitional/conceptual (18 items) / 38% single-step
-- calculation (19) / 26% multi-step-or-GAAP-vs-IFRS (13), against the usual
-- ~40/40/20 target in claude-code-spec.md section Authoring rules (rule 6).
-- The deviation is deliberate and was reviewed and approved by Kevin: FSA
-- tests GAAP-vs-IFRS discrimination heavily, and 6 of the 13 hard-bucket
-- items are GAAP-vs-IFRS pairs (F04, F12, F15, F16, F24, F29) that are worth
-- more than the conceptual items they would displace. The remaining 7 are
-- multi-step calculations (F10, F23, F25, F28, F38, F41, F47).
-- THIS IS NOT A PRECEDENT. Future batches should target ~40/40/20 unless the
-- same reasoning genuinely applies to that unit -- do not read 36/38/26 here
-- as the standard.
--
-- Every calculation was worked by hand and then independently recomputed from
-- each stem's raw numbers by a separate script (69 recomputations covering
-- both keys and distractor values, 0 failures). Kevin independently
-- re-verified 5 samples, including F15, which is correctly keyed to a $0
-- impairment loss (the US GAAP undiscounted-cash-flow recoverability screen
-- is passed at 420,000 > 400,000).
--
-- Rows are generated mechanically by scripts/gen-fsa-batch-migration.mjs from
-- .superpowers/sdd/task-6-batch-draft.json -- not hand-transcribed. Task 2's
-- seed migration drifted from its source in 11 of 36 rows precisely because
-- of hand-copying; see 20260730010233_fix_v1_seed_quote_drift.sql.
`;

const sql = `${header}
insert into questions (id, unit, topic, concept, stem, choices, answer, why) values
${values};
`;

writeFileSync(OUT, sql);
console.log(`Generated ${QUESTIONS.length} rows -> ${OUT}`);
console.log(`answer tally: ${JSON.stringify(tally)}`);
console.log(`topics: ${JSON.stringify(topics)}`);
