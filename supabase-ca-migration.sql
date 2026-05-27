-- ============================================================
-- Cost Approval Migration
-- Run this in your Supabase SQL Editor (Database > SQL Editor)
--
-- Why: The candidates UPDATE RLS policy only allows admin/hr_team/super_admin.
-- Interviewers on the CA panel need to save their cost approval decision,
-- so we create a SECURITY DEFINER function that bypasses the RLS restriction
-- while still validating the caller is authorized (in the CA panel or is staff).
-- ============================================================

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
  -- Validate decision value
  IF p_decision NOT IN ('go_ahead', 'rework_required') THEN
    RAISE EXCEPTION 'Invalid decision value: %', p_decision;
  END IF;

  -- Get caller role
  v_caller_role := public.current_user_role();

  -- Authorization: must be staff or in the CA panel reviewer list
  IF v_caller_role NOT IN ('admin', 'super_admin', 'hr_team') THEN
    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO v_ca_cfg
    FROM public.app_settings WHERE key = 'cost_approval';

    v_panel_ids := COALESCE(v_ca_cfg->'reviewer_ids', '[]'::jsonb);

    IF NOT (v_panel_ids ? auth.uid()::text) THEN
      RAISE EXCEPTION 'Not authorized: you are not in the cost approval panel';
    END IF;
  END IF;

  -- Fetch current interview_notes
  SELECT COALESCE(interview_notes, '{}'::jsonb) INTO v_existing
  FROM public.candidates WHERE id = p_candidate_id;

  -- Build new CA entry
  v_ca_entry := jsonb_build_object(
    'text',      COALESCE(p_notes, ''),
    'author',    (SELECT full_name FROM public.users WHERE id = auth.uid()),
    'authorId',  auth.uid()::text,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decision',  p_decision
  );

  -- Append entry to cost_approval array
  v_new_notes := v_existing || jsonb_build_object(
    'cost_approval',
    COALESCE(v_existing->'cost_approval', '[]'::jsonb) || jsonb_build_array(v_ca_entry)
  );

  -- Update the candidate (SECURITY DEFINER bypasses RLS)
  UPDATE public.candidates
  SET interview_notes = v_new_notes,
      updated_at = NOW()
  WHERE id = p_candidate_id;

  RETURN v_new_notes;
END;
$$;

-- Grant execute to all authenticated users (function validates authorization internally)
GRANT EXECUTE ON FUNCTION public.submit_cost_approval(uuid, text, text) TO authenticated;

-- ── Discussion comments (CA panel + admin/HR can comment) ──────────────────
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

  -- Authorization: staff or CA panel
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
