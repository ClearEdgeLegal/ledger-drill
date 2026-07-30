# LEDGER//DRILL v2 — Supabase Upgrade Spec

Turns the single-file drill app into a synced, multi-device product using Kevin's existing Supabase account. This is a Claude Code job — hand it this file plus `drill-engine/index.html` and `claude-code-spec.md`.

## What v2 buys (and what it doesn't)

Buys: (1) progress syncs across Braden's phone and laptop automatically — the v1 export/import dance disappears; (2) the question bank lives in a table, so new units ship by inserting rows, no redeploy of the app; (3) an attempt log Kevin can query — engagement and accuracy over time, visible without asking; (4) the future mock simulator and error-log-to-Professor loop get a data spine for free.

Doesn't buy: better learning. The scheduler and questions are identical. If Braden ends up using one device 95% of the time, v1 was already enough — this is infrastructure, not pedagogy.

Non-negotiable transparency rule: Braden is told, plainly, that his attempt data is visible to Kevin. An accountability layer he knows about is support; one he discovers is surveillance.

## Architecture

- Frontend: still ONE static HTML file on GitHub Pages. Add `@supabase/supabase-js` via CDN `<script>`. No framework, no build step.
- Auth: Supabase magic-link email (no passwords). First visit → enter email → click link → session persists in the browser. Show app name/email in the header with a sign-out.
- **Local-first, sync-behind:** localStorage remains the source of truth for instant loads and offline drilling. After each answered question, fire-and-forget an `attempts` insert and a `card_state` upsert. On app load (when online + signed in), pull remote `card_state` and merge per-card by `updated_at` (newest wins). This keeps the app fully usable on a plane and makes sync failures invisible rather than fatal.
- Questions: on load, fetch `questions where active = true`; cache in localStorage; fall back to cache (and the embedded seed batch) when offline.
- The anon public key ships in the client — that is normal and safe **only because RLS is on for every table**. Never disable RLS.

## Schema (run as a migration)

```sql
create table questions (
  id text primary key,
  unit text not null,             -- syllabus unit, e.g. 'FSA'
  topic text not null,
  concept text not null,
  stem text not null,
  choices jsonb not null,         -- array of exactly 3 strings
  answer smallint not null check (answer between 0 and 2),
  why text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table card_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  qid text not null references questions(id),
  box smallint not null default 0 check (box between 0 and 5),
  last_day integer,               -- days since epoch, matches client
  seen integer not null default 0,
  correct integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, qid)
);

create table attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  qid text not null references questions(id),
  was_correct boolean not null,
  answered_at timestamptz not null default now()
);

alter table questions enable row level security;
alter table card_state enable row level security;
alter table attempts enable row level security;

create policy "questions readable by signed-in users"
  on questions for select to authenticated using (true);

create policy "own card_state" on card_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "insert own attempts" on attempts
  for insert to authenticated with check (user_id = auth.uid());
create policy "read own attempts" on attempts
  for select to authenticated using (user_id = auth.uid());
```

Question writes (new units) go through the service role key — from Claude Code on Kevin's machine only, never in the client. Kevin reads the attempt log via the Supabase dashboard/SQL editor with queries like:

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

## Migration & question pipeline changes

1. Seed migration: insert the 36 v1 questions into `questions` (Claude Code extracts them from the QUESTIONS array — add a `unit` value of 'FSA-bootcamp'/'FSA').
2. The per-unit generation prompt in `claude-code-spec.md` changes its output format: instead of appending to the array, emit an `insert into questions ...` migration file. Same authoring rules, same QA (verify arithmetic, balance answer positions, unique ids).
3. Keep ~20 seed questions embedded in the HTML as the offline/first-load fallback.
4. One-time progress import: on first sign-in, if localStorage has v1 state and `card_state` is empty, push the local state up. Braden loses nothing.

## Claude Code kickoff prompt

> Read `supabase-upgrade-spec.md`, `claude-code-spec.md`, and `drill-engine/index.html`. Implement v2 exactly per the spec: create the migration SQL (schema + RLS + seed of the 36 existing questions), then modify index.html to add supabase-js via CDN, magic-link auth with signed-out and signed-in states, question fetch with localStorage/embedded fallback, local-first card-state merge by updated_at, fire-and-forget attempt logging, and the one-time v1 progress import. Environment: my Supabase project URL and anon key go in a small config block at the top of the file. Do not add a framework, a build step, or any table without RLS. When done, give me a test checklist covering: fresh sign-in, offline drilling, two-device merge, and a failed network mid-session.

Run the test checklist yourself on two browsers before sending Braden the link.

## Effort and cost

An evening in Claude Code. Supabase free tier covers this by orders of magnitude (one user, a few hundred rows a week). The only recurring cost is yours: when a unit opens, generate questions → run migration → done. No redeploys.
