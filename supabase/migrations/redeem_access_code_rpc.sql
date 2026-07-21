-- UTDATERT (20. juli 2026): denne funksjonen er overstyrt av
-- 20260720000001_access_code_duration.sql. Ikke kjør denne filen på
-- nytt — den skriver til stripe_period_end, som ikke lenger brukes.

-- FIX 2 + FIX 3: Atomic access code redemption
--
-- Run this in Supabase SQL Editor before deploying the updated codes/redeem route.
--
-- The function atomically:
--   1. Increments used_count only if it is still below max_uses (FIX 2: eliminates TOCTOU race)
--   2. Updates the user's premium_status in the same transaction (FIX 3: no partial failure)
--
-- If the code is already exhausted, the function raises 'code_exhausted',
-- which the route handler catches and returns as HTTP 409.

CREATE OR REPLACE FUNCTION redeem_access_code(
  p_code_id   uuid,
  p_user_id   uuid,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated int;
BEGIN
  -- Atomically increment only when capacity remains
  UPDATE access_codes
     SET used_count = used_count + 1
   WHERE id = p_code_id
     AND used_count < max_uses;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  -- Grant premium in the same transaction — no partial-failure window
  UPDATE profiles
     SET premium_status    = true,
         premium_since     = NOW(),
         stripe_period_end = p_expires_at
   WHERE id = p_user_id;
END;
$$;
