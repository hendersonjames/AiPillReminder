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
