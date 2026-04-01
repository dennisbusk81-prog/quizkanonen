import { createClient } from '@supabase/supabase-js'

// Server-only — never import this file in 'use client' components.
// Uses SUPABASE_SERVICE_ROLE_KEY which is intentionally absent from the client bundle.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
