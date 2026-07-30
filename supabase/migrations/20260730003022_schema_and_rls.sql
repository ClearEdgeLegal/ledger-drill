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
