-- Add stage_interviewers column to jobs table
-- Maps stage key (e.g. 'r1', 'r2') → array of user UUIDs who conduct that round.
-- Run once in Supabase SQL editor.

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS stage_interviewers JSONB NOT NULL DEFAULT '{}';
