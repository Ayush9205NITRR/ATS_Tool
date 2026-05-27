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
CREATE OR REPLACE FUNCTION public.set_candidate_stage(
  p_candidate_id  uuid,
  p_new_stage     text,
  p_new_status    text DEFAULT 'active'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.candidates
  SET current_stage = p_new_stage,
      status        = p_new_status::candidate_status,
      updated_at    = NOW()
  WHERE id = p_candidate_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_candidate_stage(uuid, text, text) TO authenticated;
