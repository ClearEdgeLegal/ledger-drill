# LEDGER//DRILL — Claude Code Build Spec

This is the working spec for extending the drill engine in Claude Code. v1 (`drill-engine/index.html`) is a complete, working single-file app. Claude Code's jobs, in order of value: (1) grow the question bank as the course reaches each unit, (2) deploy to GitHub Pages so Braden has it on his phone, (3) build the companion tools when their phase arrives.

## Architecture (keep it this way)

- **One self-contained HTML file.** No framework, no build step, no backend. All CSS/JS inline; questions live in the `QUESTIONS` array inside the file. This survives being emailed, opened from a desktop, or hosted anywhere.
- **Why not external JSON?** `fetch()` fails on `file://` URLs, and Braden may run this by double-clicking the file. Embedding the bank keeps zero-setup portability. If the bank ever exceeds ~2,000 questions, revisit with a tiny build script that inlines JSON at commit time — not before.
- **Progress** is localStorage under key `ledger-drill-v1`, with export/import as JSON. Never change the state schema without writing a migration in the load path.
- **Scheduling** is Leitner: boxes 1–5 with intervals 1/3/7/14/30 days; wrong answer → Box 1; new cards enter at Box 1 on first answer. Session = all due reviews + up to 8 new, capped at 20.

## Question schema

```js
{
  id: 'F01',            // unique, stable forever (topic prefix + number)
  topic: 'Fixed Income',// display topic — matches syllabus unit names
  concept: 'Duration',  // sub-concept for the heatmap; keep to 2–3 words
  stem: '...',          // the question. CFA L1 style: concise vignette or direct ask
  choices: ['...','...','...'],  // EXACTLY 3 (CFA L1 format)
  answer: 1,            // index 0–2
  why: '...'            // explanation: why right is right AND why the tempting distractor tempts
}
```

ID prefixes in use: M (Accounting Mechanics), I (Income Statement), B (Balance Sheet), C (Cash Flow Statement). Assign new prefixes per unit: Q (Quant), F (Fixed Income), E (Equity), CI (Corporate Issuers), EC (Economics), D (Derivatives), A (Alternatives), P (Portfolio Mgmt), ET (Ethics).

## Authoring rules (enforce every batch)

1. **Original questions only.** Never reproduce or closely paraphrase CFA Institute, Kaplan/Schweser, or any prep provider's items. Same concepts, fresh numbers, fresh scenarios.
2. **Three choices, one defensibly correct**, distractors that encode *specific misconceptions* (the complement percentage, the forgotten salvage value, the cash-vs-accrual confusion) — never random wrong numbers.
3. **Balance answer positions** per batch: roughly a third each at index 0/1/2. Audit: `grep -o "answer:[0-9]" index.html | sort | uniq -c`.
4. **The `why` teaches.** One or two sentences: the reasoning, plus why the best distractor is tempting. This is the app's entire teaching surface.
5. **Calculation questions:** verify every number by hand before committing. A wrong key in a drill app poisons trust in the whole bank.
6. **Difficulty mix** per unit: ~40% definitional/conceptual, ~40% single-step calculation, ~20% multi-step or GAAP-vs-IFRS discrimination.
7. **Sanity checks** before commit: `node --check` on the extracted script; unique IDs; no duplicate stems.

## The generation prompt (rerun as each unit opens)

> The file `index.html` contains a `QUESTIONS` array — read the schema and the existing entries for style. Braden's CFA L1 course has just opened the unit **[UNIT NAME]** covering: **[paste the unit bullets from cfa-l1-syllabus.md]**. Write **50 original CFA Level 1–style questions** for this unit following every rule in `claude-code-spec.md` §Authoring rules: 3 choices, misconception-encoding distractors, teaching explanations, balanced answer positions, verified arithmetic, ~40/40/20 difficulty mix. Use ID prefix **[PREFIX]** starting at the next free number. Append them to the QUESTIONS array, run the sanity checks, and show me 5 sample questions with your arithmetic verification for the calculation ones.

Review the samples before accepting the batch — spot-check 2–3 calculations yourself.

## Deploy (do this once, early)

```
cd drill-engine
git init && git add . && git commit -m "LEDGER//DRILL v1"
gh repo create ledger-drill --public --source=. --push
gh api repos/{owner}/ledger-drill/pages -X POST -f build_type=workflow \
  || true  # or enable Pages from Settings → Pages → deploy from main branch
```

Result: `https://<user>.github.io/ledger-drill/` — Braden bookmarks it on his phone. Progress is per-browser (phone and laptop track separately); the export/import in the Data tab moves it between devices. That's a v1 limitation, accepted deliberately — syncing means a backend, and a backend isn't worth it yet.

## Update cadence

- **Per unit open** (see syllabus calendar): generate that unit's 50 questions, redeploy.
- **Phase 6 (May 2027):** generate a cross-topic "integration" batch — questions that need two topics at once (e.g., FSA numbers feeding an equity multiple).
- Braden should export progress before each redeploy as a habit; the app's state keys by question ID, so adding questions never disturbs existing progress.

## Roadmap — companion tools (build when their phase arrives)

1. **Transaction game** (build by Week 3, Aug 2026): stream of transactions; player assigns debit/credit accounts; the three statements render live and re-balance after every entry; equation A = L + E always visibly true. Levels: cash basics → accruals/deferrals → close the books into retained earnings. Single file, same aesthetic (fonts: Fraunces + IBM Plex Mono; palette: --bg #0C1210, --amber #E3A93C, --green #46B583, --red #D96257).
2. **Bond math visualizer** (build by Week 17, Nov 2026): sliders for coupon/maturity/yield; live price-yield curve; duration drawn as tangent line, convexity as the gap. Add a "shock" button: ±100bp, show estimated-vs-actual price change.
3. **Mock exam simulator** (build by Week 44, May 2027): 90-question timed halves, flag-and-return, per-topic diagnostics, error export as JSON that can be re-imported into LEDGER//DRILL as a review deck.

## What NOT to build

No accounts, no backend, no leaderboards, no badges/streak-guilt mechanics, no AI-chat inside the app (that's Professor's job, in the Claude Project). The app is the gym; keep it fast, dumb, and reliable.
