import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Er brukeren Premium akkurat nå — inkludert grace-perioden etter tapt
 * org-Premium. Samme spørring og samme grace-beregning som
 * app/api/profile/premium-status/route.ts, som hittil har vært den eneste
 * stedet dette ble sjekket server-side. Trukket ut hit 26. juli 2026 fordi
 * svarfordelingens nye Premium-gate ellers ville blitt en fjerde,
 * lett-avvikende kopi av akkurat denne logikken.
 */
export async function isUserPremium(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, org_premium_grace_until')
    .eq('id', userId)
    .maybeSingle()

  const graceActive = !!data?.org_premium_grace_until
    && new Date(data.org_premium_grace_until) > new Date()

  return data?.premium_status === true || graceActive
}
