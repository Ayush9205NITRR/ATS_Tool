-- ============================================================
-- ATS DATABASE SETUP v2
-- Includes: agency role, crash-proof trigger, RLS for agency,
--           all missing columns, helper RPCs, and a migration
--           section for upgrading an existing v1 database.
--
-- HOW TO USE:
--   New project  → run the entire file top-to-bottom.
--   Existing v1  → jump to the "=== MIGRATION (v1 → v2) ===" section
--                  at the bottom and run only that block.
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────
create type user_role        as enum ('super_admin','admin','hr_team','interviewer','agency');
create type source_category  as enum ('platform','agency','college');
create type candidate_status as enum ('active','rejected','hired','withdrawn');
create type job_status       as enum ('draft','open','paused','closed');
create type employment_type  as enum ('full_time','part_time','contract','internship');
create type recommendation   as enum ('strong_yes','yes','neutral','no','strong_no');

-- ─── TABLES ─────────────────────────────────────────────────

-- agencies (must exist before users so the FK compiles)
create table public.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- users (mirrors auth.users — ON DELETE CASCADE already covers auth→public)
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text not null,
  role       user_role not null default 'hr_team',
  agency_id  uuid references public.agencies(id) on delete set null,
  avatar_url text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- jobs
create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  department         text,
  location           text,
  employment_type    employment_type,
  status             job_status not null default 'open',
  description        text,
  pipeline_stages    jsonb not null default '["Applied","Screening","R1","R2","Offer","Hired","Rejected"]',
  hr_owner           uuid references public.users(id) on delete set null,
  jd_link            text,
  show_to_agency     boolean not null default false,
  allowed_agency_ids uuid[] not null default '{}',
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- candidates
create table public.candidates (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid references public.jobs(id) on delete set null,
  full_name             text not null,
  email                 text not null,
  phone                 text,
  resume_url            text,
  linkedin_url          text,
  current_stage         text not null default 'Applied',
  status                candidate_status not null default 'active',
  source_category       source_category not null default 'platform',
  source_name           text not null default '',
  agency_id             uuid references public.agencies(id) on delete set null,
  hr_owner              uuid references public.users(id) on delete set null,
  notes                 text,
  screening_notes       text,
  interview_notes       jsonb not null default '{}',
  interview_date        timestamptz,
  custom_data           jsonb not null default '{}',
  tags                  text[] not null default '{}',
  assigned_interviewers uuid[] not null default '{}',
  archived_at           timestamptz,
  archived_by           uuid references public.users(id) on delete set null,
  uploaded_by           uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- custom_fields
create table public.custom_fields (
  id                  uuid primary key default gen_random_uuid(),
  field_name          text not null unique,
  field_label         text not null,
  field_type          text not null default 'text',
  is_required         boolean not null default false,
  is_active           boolean not null default true,
  show_to_interviewer boolean not null default true,
  show_to_agency      boolean not null default true,
  show_in_columns     boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

-- email_templates
create table public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text not null,
  body       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- org_settings (single-row config store — key/value pairs)
create table public.org_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value      jsonb not null default 'null',
  updated_at timestamptz not null default now()
);

-- interview_feedback
create table public.interview_feedback (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete set null,
  interviewer_id uuid not null references public.users(id) on delete cascade,
  stage          text not null,
  overall_score  integer not null check (overall_score between 1 and 5),
  scores         jsonb not null default '{}',
  strengths      text,
  concerns       text,
  recommendation recommendation not null,
  submitted_at   timestamptz not null default now()
);

-- ─── AUTO-UPDATE updated_at ──────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function update_updated_at();

create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function update_updated_at();

create trigger trg_candidates_updated_at
  before update on public.candidates
  for each row execute function update_updated_at();

-- ─── CRASH-PROOF AUTH → PUBLIC SYNC TRIGGER ──────────────────
-- Fires after every INSERT on auth.users.
-- Uses nested EXCEPTION blocks so a bad metadata value (e.g. an
-- unrecognised role string) never prevents the auth user from being
-- created — it just falls back gracefully to 'hr_team'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   user_role;
  v_name   text;
begin
  -- Safely cast the role from metadata; fall back on any failure
  begin
    v_role := coalesce(
      nullif(trim(new.raw_user_meta_data->>'role'), '')::user_role,
      'hr_team'::user_role
    );
  exception when invalid_text_representation or others then
    v_role := 'hr_team'::user_role;
  end;

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.users (id, email, full_name, role, is_active)
  values (new.id, new.email, v_name, v_role, true)
  on conflict (id) do nothing;

  return new;
exception when others then
  -- Log the error but NEVER block the auth insert
  raise warning '[handle_new_user] skipped for %: %', new.email, sqlerrm;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── HELPER: current user's role ─────────────────────────────
create or replace function public.current_user_role()
returns user_role language sql security definer stable as $$
  select role from public.users where id = auth.uid();
$$;

-- ─── RPC: create_user_with_auth ──────────────────────────────
-- Called by SettingsPage to provision a new team member.
-- Inserts into auth.users (hashing the password); the trigger above
-- then syncs the profile into public.users automatically.
create or replace function public.create_user_with_auth(
  p_email     text,
  p_password  text,
  p_full_name text,
  p_role      text default 'hr_team'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_uid uuid;
begin
  if p_role not in ('super_admin','admin','hr_team','interviewer','agency') then
    raise exception 'Invalid role: %', p_role;
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'role', p_role),
    now(),
    now(),
    '', '', '', ''
  )
  returning id into new_uid;

  return new_uid;
exception
  when unique_violation then
    raise exception 'A user with email % already exists.', p_email;
end;
$$;

-- ─── RPC: update_user_password ───────────────────────────────
create or replace function public.update_user_password(
  user_id      uuid,
  new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  where id = user_id;
end;
$$;

-- ─── RPC: delete_user_with_auth ──────────────────────────────
-- Deletes from auth.users, which cascades to public.users.
-- All FK references from candidates/jobs use ON DELETE SET NULL,
-- so no FK constraint error is raised.
create or replace function public.delete_user_with_auth(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = user_id;
end;
$$;

-- ─── RPC: check_candidate_duplicate ─────────────────────────
create or replace function public.check_candidate_duplicate(
  p_email      text,
  p_phone      text,
  p_exclude_id uuid default null
)
returns table(existing_email text, existing_phone text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select c.email::text, c.phone::text
    from public.candidates c
    where (
      (p_email is not null and lower(c.email) = lower(p_email))
      or
      (p_phone is not null and regexp_replace(coalesce(c.phone,''),'\D','','g') = regexp_replace(p_phone,'\D','','g'))
    )
    and (p_exclude_id is null or c.id <> p_exclude_id);
end;
$$;

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
alter table public.agencies          enable row level security;
alter table public.users             enable row level security;
alter table public.jobs              enable row level security;
alter table public.candidates        enable row level security;
alter table public.custom_fields     enable row level security;
alter table public.email_templates   enable row level security;
alter table public.org_settings      enable row level security;
alter table public.interview_feedback enable row level security;

-- ── Agencies ──────────────────────────────────────────────────
create policy "agencies_read_all" on public.agencies
  for select using (auth.uid() is not null);

create policy "agencies_write_admin" on public.agencies
  for all using (current_user_role() in ('super_admin','admin'));

-- ── Users ─────────────────────────────────────────────────────
create policy "users_read_all" on public.users
  for select using (auth.uid() is not null);

-- super_admin and admin can create/update/delete users
create policy "users_write_admin" on public.users
  for all using (current_user_role() in ('super_admin','admin'));

-- every user can update their own profile
create policy "users_update_own" on public.users
  for update using (id = auth.uid());

-- ── Jobs ──────────────────────────────────────────────────────
-- Agency users see only jobs where show_to_agency = true
create policy "jobs_read_staff" on public.jobs
  for select using (
    auth.uid() is not null
    and current_user_role() in ('super_admin','admin','hr_team','interviewer')
  );

create policy "jobs_read_agency" on public.jobs
  for select using (
    current_user_role() = 'agency'
    and show_to_agency = true
  );

create policy "jobs_write_admin" on public.jobs
  for insert with check (current_user_role() in ('admin','super_admin'));

create policy "jobs_update_admin" on public.jobs
  for update using (current_user_role() in ('admin','super_admin'));

-- ── Candidates ────────────────────────────────────────────────
-- Admin / super_admin see everything
create policy "candidates_read_admin" on public.candidates
  for select using (current_user_role() in ('admin','super_admin'));

-- HR team sees all candidates
create policy "candidates_read_hr" on public.candidates
  for select using (current_user_role() = 'hr_team');

-- Interviewers see only candidates assigned to them
create policy "candidates_read_interviewer" on public.candidates
  for select using (
    current_user_role() = 'interviewer'
    and auth.uid() = any(assigned_interviewers)
  );

-- Agency users see ONLY candidates linked to their own agency
create policy "candidates_read_agency" on public.candidates
  for select using (
    current_user_role() = 'agency'
    and agency_id = (
      select agency_id from public.users where id = auth.uid()
    )
  );

-- Staff can insert candidates
create policy "candidates_insert_staff" on public.candidates
  for insert with check (current_user_role() in ('admin','super_admin','hr_team'));

-- Agency can insert ONLY candidates belonging to their own agency
create policy "candidates_insert_agency" on public.candidates
  for insert with check (
    current_user_role() = 'agency'
    and agency_id = (
      select agency_id from public.users where id = auth.uid()
    )
  );

-- Staff can update candidates
create policy "candidates_update_staff" on public.candidates
  for update using (current_user_role() in ('admin','super_admin','hr_team'));

-- Only super_admin can delete candidates
create policy "candidates_delete_super_admin" on public.candidates
  for delete using (current_user_role() = 'super_admin');

-- ── Custom fields ──────────────────────────────────────────────
create policy "custom_fields_read_all" on public.custom_fields
  for select using (auth.uid() is not null);

create policy "custom_fields_write_admin" on public.custom_fields
  for all using (current_user_role() in ('super_admin','admin'));

-- ── Email templates ────────────────────────────────────────────
create policy "email_templates_read_staff" on public.email_templates
  for select using (auth.uid() is not null);

create policy "email_templates_write_admin" on public.email_templates
  for all using (current_user_role() in ('super_admin','admin'));

-- ── Org settings ───────────────────────────────────────────────
create policy "org_settings_read_all" on public.org_settings
  for select using (auth.uid() is not null);

create policy "org_settings_write_admin" on public.org_settings
  for all using (current_user_role() in ('super_admin','admin'));

-- ── Interview feedback ─────────────────────────────────────────
create policy "feedback_read_own" on public.interview_feedback
  for select using (interviewer_id = auth.uid());

create policy "feedback_read_admin" on public.interview_feedback
  for select using (current_user_role() in ('admin','super_admin','hr_team'));

create policy "feedback_insert" on public.interview_feedback
  for insert with check (auth.uid() is not null);

-- ─── INDEXES ─────────────────────────────────────────────────
create index idx_candidates_job_id      on public.candidates(job_id);
create index idx_candidates_status      on public.candidates(status);
create index idx_candidates_stage       on public.candidates(current_stage);
create index idx_candidates_source      on public.candidates(source_category);
create index idx_candidates_uploaded_by on public.candidates(uploaded_by);
create index idx_candidates_agency      on public.candidates(agency_id);
create index idx_users_agency           on public.users(agency_id);
create index idx_feedback_candidate     on public.interview_feedback(candidate_id);
create index idx_feedback_interviewer   on public.interview_feedback(interviewer_id);

-- ─── DONE (fresh install) ────────────────────────────────────
-- After running this, create your first super_admin via Supabase Auth
-- Dashboard, then run:
--   UPDATE public.users SET role = 'super_admin' WHERE email = 'your@email.com';


-- ============================================================
-- === MIGRATION (v1 → v2) ====================================
-- Run ONLY if you already have a v1 database.
-- Execute these statements one at a time in the SQL Editor.
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction;
--       paste each statement individually, not as a batch.
-- ============================================================

-- Step 1: Extend the role enum
-- (run each ALTER separately — they cannot be in a transaction)
-- ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr_team';
-- ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agency';

-- Step 2: Create agencies table
-- CREATE TABLE IF NOT EXISTS public.agencies (
--   id         uuid primary key default gen_random_uuid(),
--   name       text not null,
--   created_at timestamptz not null default now()
-- );
-- ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "agencies_read_all"   ON public.agencies FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY "agencies_write_admin" ON public.agencies FOR ALL    USING (current_user_role() IN ('super_admin','admin'));

-- Step 3: Add missing columns to users
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agency_id uuid references public.agencies(id) on delete set null;

-- Step 4: Add missing columns to candidates
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS agency_id       uuid references public.agencies(id) on delete set null;
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS hr_owner        uuid references public.users(id) on delete set null;
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS interview_date  timestamptz;
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS screening_notes text;
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS interview_notes jsonb not null default '{}';
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS custom_data     jsonb not null default '{}';
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS archived_at     timestamptz;
-- ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS archived_by     uuid references public.users(id) on delete set null;

-- Step 5: Fix FK references on candidates/jobs so users can be deleted
-- ALTER TABLE public.candidates DROP CONSTRAINT IF EXISTS candidates_uploaded_by_fkey;
-- ALTER TABLE public.candidates ADD  CONSTRAINT candidates_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;
-- ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_created_by_fkey;
-- ALTER TABLE public.jobs ADD  CONSTRAINT jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- Step 6: Add missing columns to jobs
-- ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS hr_owner           uuid references public.users(id) on delete set null;
-- ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS jd_link            text;
-- ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS show_to_agency     boolean not null default false;
-- ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS allowed_agency_ids uuid[] not null default '{}';

-- Step 7: Create custom_fields table
-- CREATE TABLE IF NOT EXISTS public.custom_fields (
--   id                  uuid primary key default gen_random_uuid(),
--   field_name          text not null unique,
--   field_label         text not null,
--   field_type          text not null default 'text',
--   is_required         boolean not null default false,
--   is_active           boolean not null default true,
--   show_to_interviewer boolean not null default true,
--   show_to_agency      boolean not null default true,
--   show_in_columns     boolean not null default true,
--   sort_order          integer not null default 0,
--   created_at          timestamptz not null default now()
-- );
-- ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "custom_fields_read_all"   ON public.custom_fields FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY "custom_fields_write_admin" ON public.custom_fields FOR ALL    USING (current_user_role() IN ('super_admin','admin'));

-- Step 8: Replace the trigger with the crash-proof version
-- (paste the CREATE OR REPLACE FUNCTION public.handle_new_user() block from above)

-- Step 9: Create new RPCs
-- (paste each CREATE OR REPLACE FUNCTION block from above:
--  create_user_with_auth, update_user_password, delete_user_with_auth, check_candidate_duplicate)

-- Step 10: Drop outdated policies and add new ones
-- DROP POLICY IF EXISTS "candidates_insert_admin"   ON public.candidates;
-- DROP POLICY IF EXISTS "candidates_update_admin"   ON public.candidates;
-- DROP POLICY IF EXISTS "users_write_super_admin"   ON public.users;
-- DROP POLICY IF EXISTS "jobs_read_all"             ON public.jobs;
-- DROP POLICY IF EXISTS "jobs_write_admin"          ON public.jobs;
-- DROP POLICY IF EXISTS "jobs_update_admin"         ON public.jobs;
-- (then paste the new policy CREATE statements from above)

-- Step 11: Add indexes for new columns
-- CREATE INDEX IF NOT EXISTS idx_candidates_agency ON public.candidates(agency_id);
-- CREATE INDEX IF NOT EXISTS idx_users_agency      ON public.users(agency_id);
