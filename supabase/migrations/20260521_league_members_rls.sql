-- ============================================================
-- RLS policies for league_members
--
-- Problem: the table had no explicit SELECT policy, so
-- authenticated users could only read their own row via the
-- default-deny behaviour (or an overly restrictive policy).
-- This meant the "Siste quiz"-tab on the liga page could only
-- match the logged-in user against other members.
--
-- Fix: allow any member to SELECT all rows in leagues they
-- belong to. INSERT is restricted to inserting yourself only.
-- All writes (UPDATE/DELETE) are service-role only.
-- ============================================================

ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies so this file is safe to re-run
DROP POLICY IF EXISTS "league_members_select_own"        ON public.league_members;
DROP POLICY IF EXISTS "league_members_select_comembers"  ON public.league_members;
DROP POLICY IF EXISTS "league_members_insert_self"       ON public.league_members;
DROP POLICY IF EXISTS "Users can view own league membership" ON public.league_members;

-- SELECT: a member can read all rows for leagues they belong to
CREATE POLICY "league_members_select_comembers"
  ON public.league_members FOR SELECT
  USING (
    league_id IN (
      SELECT league_id
      FROM   public.league_members
      WHERE  user_id = auth.uid()
    )
  );

-- INSERT: authenticated users may only add themselves
CREATE POLICY "league_members_insert_self"
  ON public.league_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE / DELETE: no policy → service role only
