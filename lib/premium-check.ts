import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isPersonalGraceActive } from '@/lib/personal-grace'
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
 *
 * PERSONLIG karens (`personal_grace_until`, 17. august 2026) teller også som
 * dekning her — samme svar som decidePremiumState() gir (lib/premium-state.ts,
 * rad `personalGraceActive`). I normal drift er leddet dødt: cachen
 * `premium_status` står true under karensen. Men getPersonalGrace() i
 * lib/premium-state-io.ts returnerer null ved lesefeil, så en syncPremiumCache
 * som treffer en transient feil kan skrive `premium_status=false` mens
 * karensdatoen fortsatt står og gjelder — nøyaktig kanten org-leddet under
 * allerede verner mot. Uten dette leddet ville den brukeren møtt paywall midt
 * i dunning-perioden, uskillelig fra et reelt utløp.
 */
export async function getUserPremium(userId: string): Promise<Loaded<boolean>> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, org_premium_grace_until, personal_grace_until')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error(`[premium-check] kunne ikke lese premium-status for ${userId}:`, error.message)
    return { ok: false }
  }

  const now = new Date()
  const orgGraceActive = !!data?.org_premium_grace_until
    && new Date(data.org_premium_grace_until) > now
  const personalGraceActive = isPersonalGraceActive(data?.personal_grace_until, now)

  return { ok: true, value: data?.premium_status === true || orgGraceActive || personalGraceActive }
}
