// scripts/gen-seed-migration.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/const QUESTIONS = (\[[\s\S]*?\n\]);/);
if (!match) throw new Error('QUESTIONS array not found in index.html');

// index.html defines QUESTIONS as a JS literal (single-quoted strings, unquoted
// keys) — evaluate it directly rather than re-implementing a JS parser.
const QUESTIONS = new Function(`return ${match[1]};`)();

if (QUESTIONS.length !== 36) {
  throw new Error(`Expected 36 seed questions, found ${QUESTIONS.length}`);
}

const seen = new Set();
for (const q of QUESTIONS) {
  if (seen.has(q.id)) throw new Error(`Duplicate id: ${q.id}`);
  seen.add(q.id);
  if (q.choices.length !== 3) throw new Error(`${q.id}: expected 3 choices`);
}

const sqlStr = s => `'${String(s).replace(/'/g, "''")}'`;
const unitFor = id => (id.startsWith('M') ? 'FSA-bootcamp' : 'FSA');

const values = QUESTIONS.map(q => {
  const choicesJson = JSON.stringify(q.choices).replace(/'/g, "''");
  return `  (${sqlStr(q.id)}, ${sqlStr(unitFor(q.id))}, ${sqlStr(q.topic)}, ${sqlStr(q.concept)}, ${sqlStr(q.stem)}, '${choicesJson}'::jsonb, ${q.answer}, ${sqlStr(q.why)})`;
}).join(',\n');

const sql = `insert into questions (id, unit, topic, concept, stem, choices, answer, why) values\n${values};\n`;

writeFileSync(new URL('../supabase/migrations/seed_v1_questions.sql.generated', import.meta.url), sql);
console.log(`Generated ${QUESTIONS.length} rows.`);
