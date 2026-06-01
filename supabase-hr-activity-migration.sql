-- ============================================================
-- HR ACTIVITY TRACKER — stage-change audit log
-- ============================================================
-- Tracks: who moved which candidate from which stage to which stage, and when.
-- Derived metrics:
--   "Profiles screened"    = rows where from_stage = 'Applied'
--   "Interviews scheduled" = rows where to_stage IN interview rounds

-- 1. Table
CREATE TABLE IF NOT EXISTS public.candidate_stage_history (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id uuid        NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  changed_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  from_stage   text,
  to_stage     text        NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csh_by_at       ON public.candidate_stage_history (changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_csh_candidate   ON public.candidate_stage_history (candidate_id);
CREATE INDEX IF NOT EXISTS idx_csh_changed_at  ON public.candidate_stage_history (changed_at DESC);

-- 2. RLS
ALTER TABLE public.candidate_stage_history ENABLE ROW LEVEL SECURITY;

-- HR sees only their own activity
DROP POLICY IF EXISTS "hr_own_history" ON public.candidate_stage_history;
CREATE POLICY "hr_own_history" ON public.candidate_stage_history
  FOR SELECT USING (changed_by = auth.uid());

-- Admin / super_admin / hr_team see everything
DROP POLICY IF EXISTS "admin_all_history" ON public.candidate_stage_history;
CREATE POLICY "admin_all_history" ON public.candidate_stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin', 'hr_team')
    )
  );

-- 3. Insert helper — SECURITY DEFINER bypasses RLS for writes
CREATE OR REPLACE FUNCTION public.log_stage_change(
  p_candidate_id uuid,
  p_from_stage   text,
  p_to_stage     text,
  p_changed_by   uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.candidate_stage_history (candidate_id, from_stage, to_stage, changed_by, changed_at)
  VALUES (p_candidate_id, p_from_stage, p_to_stage, p_changed_by, now());
$$;

-- 4. Aggregate query — role-aware: HR sees self, admin sees all
--    Returns one row per HR user who made at least one stage change in range.
CREATE OR REPLACE FUNCTION public.get_hr_activity(
  p_start_date timestamptz,
  p_end_date   timestamptz
)
RETURNS TABLE (
  changed_by   uuid,
  full_name    text,
  screened     bigint,
  interviews   bigint,
  total_moves  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_uid  uuid;
BEGIN
  v_uid  := auth.uid();
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;

  RETURN QUERY
  SELECT
    h.changed_by,
    u.full_name,
    -- Screened = moved OUT of Applied to a forward stage (not rejected/withdrawn directly)
    COUNT(*)            FILTER (WHERE h.from_stage = 'Applied'
                          AND h.to_stage NOT IN ('Rejected','Withdrawn')
                        )::bigint                                                    AS screened,
    -- Interviews = first entry into an interview round (not an inter-round promotion like R1→R2)
    COUNT(*)            FILTER (WHERE h.to_stage IN ('R1','R2','R3','CF (Virtual)','CF (In-Person)')
                          AND h.from_stage NOT IN ('R1','R2','R3','CF (Virtual)','CF (In-Person)')
                        )::bigint                                                    AS interviews,
    COUNT(*)::bigint                                                                  AS total_moves
  FROM public.candidate_stage_history h
  LEFT JOIN public.users u ON u.id = h.changed_by
  WHERE h.changed_at BETWEEN p_start_date AND p_end_date
    AND (
      v_role IN ('admin', 'super_admin')
      OR h.changed_by = v_uid
    )
  GROUP BY h.changed_by, u.full_name
  ORDER BY screened DESC, interviews DESC;
END;
$$;

-- Grant execute to authenticated users (explicit signatures to avoid ambiguity)
GRANT EXECUTE ON FUNCTION public.log_stage_change(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_activity(timestamptz, timestamptz) TO authenticated;
