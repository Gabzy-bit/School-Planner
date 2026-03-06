-- Create a single-row-per-user state table.
create table if not exists public.planner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable row level security.
alter table public.planner_state enable row level security;

-- Allow users to read only their own state.
create policy "read_own_planner_state"
on public.planner_state
for select
using (auth.uid() = user_id);

-- Allow users to insert only their own state.
create policy "insert_own_planner_state"
on public.planner_state
for insert
with check (auth.uid() = user_id);

-- Allow users to update only their own state.
create policy "update_own_planner_state"
on public.planner_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
