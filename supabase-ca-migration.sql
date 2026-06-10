-- ============================================================
-- Cost Approval RPC Migration
-- Run this in Supabase SQL Editor (Database > SQL Editor)
--
-- SAFE TO RE-RUN: uses CREATE OR REPLACE, no policy creation
-- ============================================================

-- 1. RPC: Submit cost approval decision (bypasses RLS for CA panel interviewers)
CREATE OR REPLACE FUNCTION public.submit_cost_approval(
  p_candidate_id  uuid,
  p_decision      text,
  p_notes         text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_ca_entry   jsonb;
  v_new_notes  jsonb;
  v_ca_cfg     jsonb;
  v_panel_ids  jsonb;
  v_caller_role text;
BEGIN
  IF p_decision NOT IN ('go_ahead', 'rework_required') THEN
    RAISE EXCEPTION 'Invalid decision value: %', p_decision;
  END IF;

  v_caller_role := public.current_user_role();

  IF v_caller_role NOT IN ('admin', 'super_admin', 'hr_team') THEN
    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO v_ca_cfg
    FROM public.app_settings WHERE key = 'cost_approval';
    v_panel_ids := COALESCE(v_ca_cfg->'reviewer_ids', '[]'::jsonb);
    IF NOT (v_panel_ids ? auth.uid()::text) THEN
      RAISE EXCEPTION 'Not authorized: you are not in the cost approval panel';
    END IF;
  END IF;

  SELECT COALESCE(interview_notes, '{}'::jsonb) INTO v_existing
  FROM public.candidates WHERE id = p_candidate_id;

  v_ca_entry := jsonb_build_object(
    'text',      COALESCE(p_notes, ''),
    'author',    (SELECT full_name FROM public.users WHERE id = auth.uid()),
    'authorId',  auth.uid()::text,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decision',  p_decision
  );

  v_new_notes := v_existing || jsonb_build_object(
    'cost_approval',
    COALESCE(v_existing->'cost_approval', '[]'::jsonb) || jsonb_build_array(v_ca_entry)
  );

  UPDATE public.candidates
  SET interview_notes = v_new_notes,
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN v_new_notes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cost_approval(uuid, text, text) TO authenticated;

-- 2. RPC: Submit CA discussion comment (bypasses RLS for CA panel interviewers)
CREATE OR REPLACE FUNCTION public.submit_ca_comment(
  p_candidate_id  uuid,
  p_comment_text  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_comment    jsonb;
  v_new_notes  jsonb;
  v_ca_cfg     jsonb;
  v_panel_ids  jsonb;
  v_caller_role text;
BEGIN
  v_caller_role := public.current_user_role();

  IF v_caller_role NOT IN ('admin', 'super_admin', 'hr_team') THEN
    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO v_ca_cfg
    FROM public.app_settings WHERE key = 'cost_approval';
    v_panel_ids := COALESCE(v_ca_cfg->'reviewer_ids', '[]'::jsonb);
    IF NOT (v_panel_ids ? auth.uid()::text) THEN
      RAISE EXCEPTION 'Not authorized to comment on cost approval';
    END IF;
  END IF;

  SELECT COALESCE(interview_notes, '{}'::jsonb) INTO v_existing
  FROM public.candidates WHERE id = p_candidate_id;

  v_comment := jsonb_build_object(
    'text',      p_comment_text,
    'author',    (SELECT full_name FROM public.users WHERE id = auth.uid()),
    'authorId',  auth.uid()::text,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  v_new_notes := v_existing || jsonb_build_object(
    'cost_approval_comments',
    COALESCE(v_existing->'cost_approval_comments', '[]'::jsonb) || jsonb_build_array(v_comment)
  );

  UPDATE public.candidates
  SET interview_notes = v_new_notes,
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN v_new_notes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_ca_comment(uuid, text) TO authenticated;

-- 3. RPC: Save an interview note for any stage (bypasses RLS for assigned interviewers)
CREATE OR REPLACE FUNCTION public.submit_interview_note(
  p_candidate_id  uuid,
  p_section_key   text,
  p_note_text     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing  jsonb;
  v_entry     jsonb;
  v_new_notes jsonb;
BEGIN
  -- Any authenticated user who can reach the candidate can save a note
  SELECT COALESCE(interview_notes, '{}'::jsonb) INTO v_existing
  FROM public.candidates WHERE id = p_candidate_id;

  v_entry := jsonb_build_object(
    'text',      p_note_text,
    'author',    (SELECT full_name FROM public.users WHERE id = auth.uid()),
    'authorId',  auth.uid()::text,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  v_new_notes := v_existing || jsonb_build_object(
    p_section_key,
    COALESCE(v_existing->p_section_key, '[]'::jsonb) || jsonb_build_array(v_entry)
  );

  UPDATE public.candidates
  SET interview_notes = v_new_notes,
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN v_new_notes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_interview_note(uuid, text, text) TO authenticated;

-- 4. RPC: Advance or reject a candidate stage (bypasses RLS for assigned interviewers)
DROP FUNCTION IF EXISTS public.set_candidate_stage(uuid, text, text);
CREATE FUNCTION public.set_candidate_stage(
  p_candidate_id  uuid,
  p_new_stage     text,
  p_new_status    text DEFAULT 'active'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.candidate_status;
BEGIN
  v_status := p_new_status::public.candidate_status;
  UPDATE public.candidates
  SET current_stage  = p_new_stage,
      status         = v_status,
      interview_date = NULL,
      updated_at     = NOW()
  WHERE id = p_candidate_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_candidate_stage(uuid, text, text) TO authenticated;

-- ============================================================
-- 5. SCHEMA FIX — cost_approval_notes (text → jsonb) + 'rejected'
--    decision support
--
-- WHY THIS MATTERS:
-- handleStageChange() (CandidateProfilePage) and the Cost Approval
-- 3-state UI (Go Ahead / Re-work / Reject) write cost_approval_notes
-- as a JSON array of {text,author,authorId,timestamp} objects, and
-- write cost_approval_decision = 'rejected'. If this column is still
-- `text` (as originally added) and/or its CHECK constraint only
-- allows ('go_ahead','rework_required'), Postgres rejects the
-- UPDATE for ANY candidate that has existing cost-approval data —
-- the stage badge optimistically flips, then silently reverts
-- because the write failed. This is the "stage change doesn't save"
-- bug for candidates who have been through Cost Approval.
--
-- SAFE TO RE-RUN.
-- ============================================================

-- 5a. Make sure the cost-approval columns exist (jsonb from the start
--     for fresh installs that never ran the older text-column migration)
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS cost_approval_decision      text,
  ADD COLUMN IF NOT EXISTS cost_approval_notes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cost_approval_submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cost_approval_submitted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- 5b. Convert cost_approval_notes from text → jsonb if it was created
--     by the older migration (existing values are preserved)
DO $migrate_can$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'candidates'
      AND column_name = 'cost_approval_notes' AND data_type = 'text'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.candidates
        ALTER COLUMN cost_approval_notes DROP DEFAULT,
        ALTER COLUMN cost_approval_notes TYPE jsonb USING
          CASE WHEN cost_approval_notes IS NULL OR cost_approval_notes = '' THEN '[]'::jsonb
               ELSE cost_approval_notes::jsonb END,
        ALTER COLUMN cost_approval_notes SET DEFAULT '[]'::jsonb,
        ALTER COLUMN cost_approval_notes SET NOT NULL
    $sql$;
  END IF;
END
$migrate_can$;

-- 5c. Allow 'rejected' as a third cost-approval decision state
ALTER TABLE public.candidates DROP CONSTRAINT IF EXISTS candidates_cost_approval_decision_check;
ALTER TABLE public.candidates
  ADD CONSTRAINT candidates_cost_approval_decision_check
  CHECK (cost_approval_decision IS NULL OR cost_approval_decision IN ('go_ahead', 'rework_required', 'rejected'));

-- 6. submit_cost_approval RPC: accept 'rejected' (previously raised
--    "Invalid decision value: rejected", which made submitCostApproval()
--    throw before it could advance the stage to "{CA stage} Rejected"),
--    and stamp cost_approval_decision / submitted_at / submitted_by so
--    the decision badge on the profile page reflects the latest call.
CREATE OR REPLACE FUNCTION public.submit_cost_approval(
  p_candidate_id  uuid,
  p_decision      text,
  p_notes         text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_ca_entry   jsonb;
  v_new_notes  jsonb;
  v_ca_cfg     jsonb;
  v_panel_ids  jsonb;
  v_caller_role text;
BEGIN
  IF p_decision NOT IN ('go_ahead', 'rework_required', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision value: %', p_decision;
  END IF;

  v_caller_role := public.current_user_role();

  IF v_caller_role NOT IN ('admin', 'super_admin', 'hr_team') THEN
    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO v_ca_cfg
    FROM public.app_settings WHERE key = 'cost_approval';
    v_panel_ids := COALESCE(v_ca_cfg->'reviewer_ids', '[]'::jsonb);
    IF NOT (v_panel_ids ? auth.uid()::text) THEN
      RAISE EXCEPTION 'Not authorized: you are not in the cost approval panel';
    END IF;
  END IF;

  SELECT COALESCE(interview_notes, '{}'::jsonb) INTO v_existing
  FROM public.candidates WHERE id = p_candidate_id;

  v_ca_entry := jsonb_build_object(
    'text',      COALESCE(p_notes, ''),
    'author',    (SELECT full_name FROM public.users WHERE id = auth.uid()),
    'authorId',  auth.uid()::text,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decision',  p_decision
  );

  v_new_notes := v_existing || jsonb_build_object(
    'cost_approval',
    COALESCE(v_existing->'cost_approval', '[]'::jsonb) || jsonb_build_array(v_ca_entry)
  );

  UPDATE public.candidates
  SET interview_notes            = v_new_notes,
      cost_approval_decision     = p_decision,
      cost_approval_submitted_at = NOW(),
      cost_approval_submitted_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN v_new_notes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cost_approval(uuid, text, text) TO authenticated;

-- ============================================================
-- 7. OPTIONAL — Employee Referral source category
--
-- Only run this if saving/editing a candidate with
-- "Source = Employee Referral" fails with an error such as:
--   invalid input value for enum source_category: "referral"
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as
-- other statements, so select ONLY the line below and run it by
-- itself (do not run it together with the rest of this file):
--
--   ALTER TYPE public.source_category ADD VALUE IF NOT EXISTS 'referral';
-- ============================================================
