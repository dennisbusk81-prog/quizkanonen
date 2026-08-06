// Hva skal en komponent gjøre når sesjonsoppslaget ved montering er ferdig —
// eller ga opp?
//
// BAKGRUNN (7. august 2026): SeasonLeaderboard kalte `supabase.auth.getSession()`
// uten tidsgrense og satte `sessionChecked` i .then(). Det var harmløst helt til
// scopede kall (org-/ligatoppliste) begynte å VENTE på det flagget: henger
// oppslaget bak auth-låsen, settes flagget aldri, hentingen fyrer aldri, og
// siden står i skjelettet for alltid. AuthListener har hatt sin egen 1500 ms
// sikkerhetsventil mot nøyaktig samme lås siden den ble skrevet.
//
// Funksjonen finnes som REN LOGIKK, ikke inline i komponenten, av samme grunn
// som lib/quiz-timeout-answer.ts: prosjektet har ingen jsdom, og en beslutning
// som bare finnes inne i en useEffect kan ikke mutasjonsbevises mot ekte
// produksjonskode. Se lib/session-check.test.ts.

import type { Session } from '@supabase/supabase-js'
import type { TimedOutcome } from './with-timeout'

export type SessionCheckDecision = {
  /**
   * ALLTID true. Uansett utfall slutter vi å vente — det er hele poenget:
   * ingen konsument skal kunne bli stående og vente på et svar som ikke kommer.
   */
  checked: true
  /**
   * true = kalleren skal skrive `session` til state.
   *
   * false ved timeout, og det er den viktige halvdelen. Et tidsavbrudd betyr
   * «vi vet ikke om du er innlogget», ikke «du er utlogget». Skrev vi `null`
   * her, ville en ekte innlogget bruker fått «Logg inn»-kortet servert av vår
   * egen tidsgrense — samme feilklasse som `{ ok: false }` vs. tom liste i
   * lib/fetch-result.ts. onAuthStateChange er uendret backup og setter
   * sesjonen når den lander.
   */
  applySession: boolean
  /** Kun meningsfull når `applySession` er true. */
  session: Session | null
}

export function decideSessionCheck(
  outcome: TimedOutcome<{ data: { session: Session | null } }>,
): SessionCheckDecision {
  if (!outcome.ok) return { checked: true, applySession: false, session: null }
  return { checked: true, applySession: true, session: outcome.value.data.session }
}
