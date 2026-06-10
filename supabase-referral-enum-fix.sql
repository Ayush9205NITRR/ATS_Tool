-- ============================================================
-- REQUIRED: Add 'referral' to the source_category enum
--
-- The candidates.source_category column is a Postgres ENUM.
-- 'referral' was not in the original enum, so saving a candidate
-- with Source = "Employee Referral" fails with:
--   invalid input value for enum source_category: "referral"
--
-- HOW TO RUN:
--   1. Open Supabase dashboard → SQL Editor
--   2. Paste ONLY the ALTER TYPE line below and run it alone
--      (ALTER TYPE ADD VALUE cannot run inside a transaction)
--   3. That's it — no restart needed.
-- ============================================================

ALTER TYPE public.source_category ADD VALUE IF NOT EXISTS 'referral';
