-- ================================================================
-- ChronaCare: AI Pill Reminder — Database Schema
-- Run this in your Supabase SQL Editor
-- ================================================================

create extension if not exists "uuid-ossp";

-- ================================================================
-- PILLS TABLE
-- Stores all pills/medications for each user
-- ================================================================
create table if not exists public.pills (
  id text primary key, -- uses the app's existing timestamp-based ID
  user_id uuid references auth.users(id) on delete cascade not null,
  pill_name text not null,
  pill_data jsonb not null, -- full pill object (name, dosage, reminders, history, etc.)
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.pills enable row level security;

-- RLS Policies
create policy "Users can view their own pills"
  on public.pills for select
  using (auth.uid() = user_id);

create policy "Users can insert their own pills"
  on public.pills for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own pills"
  on public.pills for update
  using (auth.uid() = user_id);

create policy "Users can delete their own pills"
  on public.pills for delete
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function public.handle_pills_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger pills_updated_at
  before update on public.pills
  for each row execute function public.handle_pills_updated_at();

-- ================================================================
-- DONE! ChronaCare database is ready.
-- ================================================================
