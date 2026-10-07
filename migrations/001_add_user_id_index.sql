-- Migration: Add user_id index for RLS performance
-- Status: RECOMMENDED but not required
-- Apply after: Code changes deployed
-- 
-- This migration improves RLS policy performance by adding an index on user_id.
-- The current code is compatible with or without this migration.
--
-- To apply: Run this SQL in your Supabase SQL Editor

-- Index for faster user_id lookups (RLS policies use auth.uid() = user_id)
CREATE INDEX IF NOT EXISTS idx_pills_user_id ON public.pills(user_id);

-- Note: The QA report (L5) recommended a composite primary key (user_id, id).
-- However, this would require:
--   1. Dropping the existing primary key
--   2. Recreating it as a composite key
--   3. Ensuring no duplicate (user_id, id) pairs exist
--
-- The current code uses upsert with onConflict: 'id', which works with the
-- existing schema. If you want to add the composite key for extra safety:
--
-- ALTER TABLE public.pills DROP CONSTRAINT pills_pkey;
-- ALTER TABLE public.pills ADD PRIMARY KEY (user_id, id);
--
-- This is optional since RLS already prevents cross-user access.
