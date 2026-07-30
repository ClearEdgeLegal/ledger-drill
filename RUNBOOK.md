# LEDGER//DRILL — Runbook

Operational reference for running and extending the question bank. Written per Task 9 of the original v2 build plan (`docs/superpowers/plans/2026-07-29-supabase-sync-v2.md`), which specified this file but was never executed at the time — created now, during the nine-topic curriculum expansion.

## Bank inventory

**Live as of 2026-07-30:** 536 questions across 10 units (86 original + all 9 new topic batches). Full CFA Level I curriculum coverage.

| Unit | Count | Id prefix(es) | Status |
|---|---|---|---|
| FSA-bootcamp | 10 | M | Live (v1 seed) |
| FSA | 76 | I, B, C, F | Live (v1 seed + FSA batch) |
| Quantitative Methods | 50 | Q | Live |
| Economics | 50 | EC | Live |
| Corporate Issuers | 50 | CI | Live |
| Equity | 50 | E | Live |
| Fixed Income | 50 | FI | Live |
| Derivatives | 50 | D | Live |
| Alternatives | 50 | A | Live |
| Ethics | 50 | ET | Live |
| Portfolio Management | 50 | P | Live |
| **Total** | **536** | | |

This covers the full CFA Level I curriculum. Future work is refresh/correction of existing units, not new-unit generation, unless the syllabus itself changes.

## Shipping a new question batch

The pipeline used for all ten batches to date (F, Q, EC, CI, E, FI, D, A, ET, and P):

1. **Draft.** Write `{id, topic, concept, stem, choices, answer, why}` objects to `.superpowers/sdd/<prefix>-batch-draft.json` (lowercase prefix), following every rule in `claude-code-spec.md` §Authoring rules: 3 choices, misconception-encoding distractors, teaching explanations, balanced answer positions, verified arithmetic (hand-worked, then independently blind-recomputed from the stem's raw numbers — never trust the first pass), ~40/40/20 difficulty mix unless the unit's actual content structurally doesn't support it (document any deviation transparently, in the migration header, same as the FSA and Corporate Issuers batches — never silently pad calculations into content that doesn't call for them).
2. **Difficulty meta.** Write `.superpowers/sdd/<prefix>-batch-meta.json`: `[{id, difficulty}]` with difficulty in `conceptual` / `single-step` / `multi-step`, so the difficulty mix is machine-tabulated rather than hand-maintained prose.
3. **Generate the migration.** `npx supabase migration new <prefix>_batch_50`, then:
   ```
   node scripts/gen-batch-migration.mjs --prefix=<PREFIX> --unit="<Unit Name>" \
     --draft=.superpowers/sdd/<prefix>-batch-draft.json \
     --meta=.superpowers/sdd/<prefix>-batch-meta.json \
     --existing=.superpowers/sdd/existing-ids.json \
     --out=supabase/migrations/<the-new-timestamped-file>.sql
   ```
   This validates (50 entries, unique/correctly-prefixed ids, exact 7-key schema, 3 unique choices, answer 0-2, no duplicate stems, position tally in the 15-18 band) and refuses to emit SQL on any failure. Never hand-transcribe rows — the original seed migration drifted from its source in 11 of 36 rows from hand-copying (see `20260730010233_fix_v1_seed_quote_drift.sql`).
4. **Audit across the whole bank.** Refresh `existing-ids.json` (a live id pull), add the new batch to a manifest, run `node scripts/audit-full-bank.mjs <manifest>` — checks global id uniqueness, duplicate/near-duplicate stems bank-wide, structural validity, and per-batch position balance across the combined existing + new set.
5. **Review gate.** Present samples (5 minimum, with full worked arithmetic for every calculation question) plus the position/difficulty tables. Nothing applies until approved.
6. **Apply.** `npx supabase db push` (run from the main Claude Code session — the CLI's permission classifier blocks this specific command for subagents; it works directly). If migrations were generated out of strict timestamp order relative to what's already applied, `db push` may require `--include-all` — this only affects the CLI's own bookkeeping, not the data.
7. **Verify live.** `node scripts/verify-batch-live.mjs --prefix=<PREFIX> --unit="<Unit Name>" --draft=<draft.json> --expected-total=<N>` — field-by-field comparison of every live row against the reviewed draft, not just a row count. A green run is real evidence; nothing here is inferred from the pre-push file.
8. **Commit.** One migration file, one commit, per batch — individually revertible.

## Engagement queries

Run in the Supabase dashboard's SQL editor:

```sql
-- last 14 days of engagement
select date_trunc('day', answered_at) d, count(*) n,
       round(100.0 * avg(was_correct::int)) pct
from attempts group by 1 order by 1 desc limit 14;

-- weakest concepts, lifetime
select q.topic, q.concept, count(*) n,
       round(100.0 * avg(a.was_correct::int)) pct
from attempts a join questions q on q.id = a.qid
group by 1,2 having count(*) >= 5 order by pct asc limit 10;
```

## Cost ceiling — confirmed live, 2026-07-30

Fetched from current published docs, not training data:

**Supabase Free plan** ([supabase.com/pricing](https://supabase.com/pricing)): 500 MB database storage; 5 GB egress + 5 GB cached egress per month; 50,000 monthly active users; free projects pause after 1 week of inactivity (not a charge — just requires a manual unpause if Braden goes quiet for a week+); limited to 2 active free projects.

**GitHub Pages** ([docs.github.com](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)): published site size ≤1 GB; source repo recommended ≤1 GB; soft bandwidth limit 100 GB/month; soft build-frequency limit 10 builds/hour.

**This app's actual usage sits far under every one of those ceilings.** The full 536-question bank is under 500 KB of text; one student's attempt/card-state history, even after years of daily use, stays in the tens of MB at most — a small fraction of a percent of the 500 MB database cap. Monthly egress for one user's occasional syncs is measured in single-digit MB against a 5 GB allowance. `index.html` is a few hundred KB against GitHub's 1 GB site-size limit, and one user's traffic is negligible against 100 GB/month.

**Neither service upgrades to a paid plan or begins charging without Kevin explicitly changing the plan.** Nothing in this pipeline — drafting, auditing, applying migrations, or normal app usage — can generate a bill. The only operational (not financial) risk is the 1-week-inactivity pause on the free Supabase project, worth knowing about if the app goes unused for a stretch.
