-- ============================================================
-- ATS DATABASE SETUP
-- Run this entire script in Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────
create type user_role         as enum ('super_admin', 'admin', 'interviewer');
create type source_category   as enum ('platform', 'agency', 'college');
create type candidate_status  as enum ('active', 'rejected', 'hired', 'withdrawn');
create type job_status        as enum ('draft', 'open', 'paused', 'closed');
create type employment_type   as enum ('full_time', 'part_time', 'contract', 'internship');
create type recommendation    as enum ('strong_yes', 'yes', 'neutral', 'no', 'strong_no');

-- ─── TABLES ─────────────────────────────────────────────────

-- users (mirrors auth.users)
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  full_name     text not null,
  role          user_role not null default 'interviewer',
  avatar_url    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- jobs
create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  department       text,
  location         text,
  employment_type  employment_type,
  status           job_status not null default 'open',
  description      text,
  pipeline_stages  jsonb not null default '["Applied","Screening","Interview","Offer","Hired","Rejected"]',
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- candidates
create table public.candidates (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid references public.jobs(id) on delete set null,
  full_name              text not null,
  email                  text not null,
  phone                  text,
  resume_url             text,
  linkedin_url           text,
  current_stage          text not null default 'Applied',
  status                 candidate_status not null default 'active',
  source_category        source_category not null,
  source_name            text not null,
  notes                  text,
  tags                   text[] not null default '{}',
  assigned_interviewers  uuid[] not null default '{}',
  uploaded_by            uuid references public.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- interview_feedback
create table public.interview_feedback (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references public.candidates(id) on delete cascade,
  job_id          uuid references public.jobs(id) on delete set null,
  interviewer_id  uuid not null references public.users(id),
  stage           text not null,
  overall_score   integer not null check (overall_score between 1 and 5),
  scores          jsonb not null default '{}',
  strengths       text,
  concerns        text,
  recommendation  recommendation not null,
  submitted_at    timestamptz not null default now()
);

-- ─── AUTO-UPDATE updated_at ──────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function update_updated_at();

create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function update_updated_at();

create trigger trg_candidates_updated_at
  before update on public.candidates
  for each row execute function update_updated_at();

-- ─── AUTO-CREATE USER PROFILE ON SIGNUP ──────────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'interviewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
alter table public.users              enable row level security;
alter table public.jobs               enable row level security;
alter table public.candidates         enable row level security;
alter table public.interview_feedback enable row level security;

-- Helper function: get current user's role
create or replace function public.current_user_role()
returns user_role as $$
  select role from public.users where id = auth.uid();
$$ language sql security definer stable;

-- ── USERS table policies ───────────────────────────────────
-- Anyone logged in can read all users (needed for assigning interviewers)
create policy "users_read_all" on public.users
  for select using (auth.uid() is not null);

-- Only super_admin can insert/update/delete users
create policy "users_write_super_admin" on public.users
  for all using (current_user_role() = 'super_admin');

-- Users can update their own profile
create policy "users_update_own" on public.users
  for update using (id = auth.uid());

-- ── JOBS table policies ────────────────────────────────────
-- All authenticated users can read jobs
create policy "jobs_read_all" on public.jobs
  for select using (auth.uid() is not null);

-- Admin and super_admin can create/update jobs
create policy "jobs_write_admin" on public.jobs
  for insert with check (current_user_role() in ('admin', 'super_admin'));

create policy "jobs_update_admin" on public.jobs
  for update using (current_user_role() in ('admin', 'super_admin'));

-- ── CANDIDATES table policies ──────────────────────────────
-- Admin + super_admin see ALL candidates
create policy "candidates_read_admin" on public.candidates
  for select using (current_user_role() in ('admin', 'super_admin'));

-- Interviewers see only candidates assigned to them
create policy "candidates_read_interviewer" on public.candidates
  for select using (
    current_user_role() = 'interviewer'
    and auth.uid() = any(assigned_interviewers)
  );

-- Admin + super_admin can insert candidates
create policy "candidates_insert_admin" on public.candidates
  for insert with check (current_user_role() in ('admin', 'super_admin'));

-- Admin + super_admin can update candidates
create policy "candidates_update_admin" on public.candidates
  for update using (current_user_role() in ('admin', 'super_admin'));

-- Only super_admin can delete
create policy "candidates_delete_super_admin" on public.candidates
  for delete using (current_user_role() = 'super_admin');

-- ── INTERVIEW FEEDBACK policies ────────────────────────────
-- Interviewers can read their own feedback
create policy "feedback_read_own" on public.interview_feedback
  for select using (interviewer_id = auth.uid());

-- Admin + super_admin read all feedback
create policy "feedback_read_admin" on public.interview_feedback
  for select using (current_user_role() in ('admin', 'super_admin'));

-- Any authenticated user with access can submit feedback
create policy "feedback_insert" on public.interview_feedback
  for insert with check (auth.uid() is not null);

-- Feedback cannot be updated or deleted (immutable record)

-- ─── USEFUL INDEXES ──────────────────────────────────────────
create index idx_candidates_job_id       on public.candidates(job_id);
create index idx_candidates_status       on public.candidates(status);
create index idx_candidates_stage        on public.candidates(current_stage);
create index idx_candidates_source       on public.candidates(source_category);
create index idx_candidates_uploaded_by  on public.candidates(uploaded_by);
create index idx_feedback_candidate      on public.interview_feedback(candidate_id);
create index idx_feedback_interviewer    on public.interview_feedback(interviewer_id);

-- ─── DONE ─────────────────────────────────────────────────────
-- Next: Create your first super_admin user in Supabase Auth dashboard,
-- then run: UPDATE public.users SET role = 'super_admin' WHERE email = 'your@email.com';
