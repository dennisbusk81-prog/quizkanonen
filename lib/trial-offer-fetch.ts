import { decideTrialOffer, type TrialOffer } from '@/lib/trial-offer'

// Klient-siden av GET /api/premium/trial-offer. Skilt fra lib/trial-offer.ts
// slik at beslutningslogikken forblir ren og testbar uten fetch — samme
// oppdeling som premium-state / premium-state-io.
//
// Feilhåndteringen er bevisst asymmetrisk mot resten av appen: et feilet kall
// gir `{ show: false }`, ikke «ukjent → vis likevel». Grunnen er at dagtallet
// og eligibility kommer i SAMME svar, og uten svar har vi ikke noe tall å
// skrive i teksten. Da er dagens Premium-tekst det ærlige utfallet — flaten
// mister et tilbud, ikke en rettighet, og knappen finnes fortsatt på /premium.
export async function fetchTrialOffer(accessToken?: string | null): Promise<TrialOffer> {
  try {
    const res = await fetch('/api/premium/trial-offer', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
    if (!res.ok) return { show: false, days: null }
    const data = await res.json().catch(() => null)
    if (!data) return { show: false, days: null }
    return decideTrialOffer({
      trialDays: data.trialDays,
      // Alt annet enn en ekte boolean er UKJENT. En rute som svarer i en form
      // vi ikke kjenner igjen skal ikke kunne bety «ikke kvalifisert».
      eligible: typeof data.eligible === 'boolean' ? data.eligible : null,
    })
  } catch {
    return { show: false, days: null }
  }
}
