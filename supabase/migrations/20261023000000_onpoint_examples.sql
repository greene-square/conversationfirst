-- OnPoint answer bank: personal interview examples, scoped to a household.
-- Moved out of the client bundle so real career details are never public.

create table onpoint_examples (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  slug text not null,
  tags text[] not null default '{}',
  question_keywords text[] not null default '{}',
  lead text not null,
  context text not null default '',
  metrics text not null default '',
  category text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (household_id, slug)
);

alter table onpoint_examples enable row level security;

create policy "Users read household examples" on onpoint_examples
  for select using (user_in_household(household_id));
create policy "Users insert household examples" on onpoint_examples
  for insert with check (user_in_household(household_id));
create policy "Users update household examples" on onpoint_examples
  for update using (user_in_household(household_id))
  with check (user_in_household(household_id));
create policy "Users delete household examples" on onpoint_examples
  for delete using (user_in_household(household_id));

create index idx_onpoint_examples_household on onpoint_examples(household_id);
