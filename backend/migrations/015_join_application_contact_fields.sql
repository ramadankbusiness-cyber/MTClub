-- Add canonical contact fields for join applications.
-- Safe to run more than once; preserves existing records.
ALTER TABLE public.join_applications
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.join_applications
  ADD COLUMN IF NOT EXISTS academic_number TEXT;
