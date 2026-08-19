import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Loaded } from '@/lib/fetch-result'

/**
 * Er brukeren Premium akkurat nå — inkludert grace-perioden etter tapt
 * org-Premium. Samme spørring og samme grace-beregning som
 * app/api/profile/premium-status/route.ts, som hittil har vært den eneste
 * stedet dette ble sjekket server-side. Trukket ut hit 26. juli 2026 fordi
 * svarfordelingens nye Premium-gate ellers ville blitt en fjerde,
 * lett-avvikende kopi av akkurat denne logikken.
 *
 * Returnerer Loaded<boolean> og ikke boolean (19. august 2026). Forgjengeren
 * `isUserPremium` leste aldri `error`: en transient DB-feil ga `data: null`,
 * og `data?.premium_status === true` gjorde «vet ikke» om til «ikke Premium».
 * En betalende kunde møtte da paywall — uten feilmelding, uten logg, og uten
 * noe som skilte det fra en helt vanlig gratisbruker. Se lib/fetch-result.ts:
 * et feilsvar er «vet ikke», ALDRI en verdi.
 *
 * Funksjonen er samtidig DØPT OM med vilje. En returtype-endring alene ville
 * ikke felt et glemt kallsted — `if (!(await isUserPremium(id)))` fortsetter å
 * kompilere med et objekt, og `{ ok: false }` er truthy, så en feil ville blitt
 * til «alle er Premium». Navnebyttet gjør ethvert gjenglemt kallsted til en
 * kompileringsfeil i stedet.
 */
export async function getUserPremium(userId: string): Promise<Loaded<boolean>> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, org_premium_grace_until')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error(`[premium-check] kunne ikke lese premium-status for ${userId}:`, error.message)
    return { ok: false }
  }

  const graceActive = !!data?.org_premium_grace_until
    && new Date(data.org_premium_grace_until) > new Date()

  return { ok: true, value: data?.premium_status === true || graceActive }
}
