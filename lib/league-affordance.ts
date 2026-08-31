// ── Skal «Blant venner»-fanen og liga-CTA-en vises? ─────────────────────────
// Ren logikk, uten I/O — testdekket i lib/league-affordance.test.ts, wiringen
// mot kallstedet i lib/league-affordance-wiring.test.ts.
//
// BAKGRUNNEN: fram til 31. august 2026 var ligastatusen på
// app/leaderboard/[id]/page.tsx en `useState(false)`. Både en kastet feil OG en
// !ok-status (som ikke engang treffer catch) etterlot den false, og false drev
// TO flater samtidig i motsatt retning:
//   • «Blant venner»-fanen forsvant
//   • CTA-en tentes: «Vil du konkurrere mot vennene dine? Opprett en liga
//     (Premium)»
// En bruker som HAR ligaer fikk altså solgt noe hun allerede hadde, fordi ett
// kall feilet. «Vet ikke» er ikke «har ikke» — samme invariant som
// `Loaded<T>` i lib/fetch-result.ts og `browseError` lenger oppe i samme fil.
//
// MODELLEN er hentet fra ligaBox i app/quiz/[id]/page.tsx: der er «feil» null
// (ingenting rendres) og «null ligaer» er `{ type: 'cta' }` — to ULIKE utfall
// som rendres ULIKT. Denne funksjonen sier det samme med husets delte form.
//
// HVA «VET IKKE» SKAL VISE: ingen av delene. Fanen kan vi ikke vise, for vi vet
// ikke om hun har ligavenner å fylle den med; CTA-en kan vi ikke vise, for vi
// vet ikke om hun mangler en liga. Én stille utelatelse er riktigere enn to
// påstander vi ikke har dekning for.
import type { Loaded } from './fetch-result'

export type LeagueAffordance = {
  showFriendsTab: boolean
  showLeagueCta: boolean
}

export function decideLeagueAffordance(input: {
  // ok:true + value=true → brukeren er medlem i minst én liga.
  // ok:true + value=false → bekreftet null ligaer.
  // ok:false → uavklart: ikke svart ennå, eller kallet feilet.
  leagues: Loaded<boolean>
  loggedIn: boolean
  orgMode: boolean
  authLoading: boolean
}): LeagueAffordance {
  const { leagues, loggedIn, orgMode, authLoading } = input

  // Org-modus holder org-opplevelsen adskilt fra de globale/liga-elementene,
  // og en utlogget har hverken ligaer eller noe sted å opprette dem fra.
  if (orgMode || !loggedIn) return { showFriendsTab: false, showLeagueCta: false }

  // Selve fiksen: uavklart ligastatus skal ikke tennes som «har ingen ligaer».
  if (!leagues.ok) return { showFriendsTab: false, showLeagueCta: false }

  return {
    showFriendsTab: leagues.value,
    // authLoading-leddet er uendret fra før: CTA-en har alltid ventet på at
    // sesjonsinnlastingen er ferdig, fanen har aldri gjort det.
    showLeagueCta: !leagues.value && !authLoading,
  }
}
