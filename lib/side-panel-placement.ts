// ── Sidepanelet under spilling: eksakt plassering eller bånd? ───────────────
//
// N-8, 4. september 2026. Høyre panel («Akkurat nå») i app/quiz/[id]/page.tsx
// tegnet ALLTID et bånd (`#57–60`) — det hadde aldri hatt en eksakt-gren.
// Da 2749d59 (23. august) ga rank-pillen og mellomskjermen «eksakt hvis
// serveren ga det, ellers bånd», ble panelets `interLow`/`interHigh` ikke
// rørt. Av tre plasseringsflater på samme skjerm var to premium-klar over og
// én ikke. En premium-bruker så det på egen skjerm 4. september og reagerte
// uoppfordret. Hullet peker feil vei: en betalende kunde fikk gratisvisningen.
//
// ── HVORFOR EN EGEN MODUL, OG IKKE EN TERNÆR I JSX-EN ───────────────────────
// Samme grunn som lib/archive-ranking-gates.ts: npm test kjører uten jsdom,
// og beslutningen bodde i en 5000-linjers klientkomponent der ingen test
// kunne felle den. Det ble MÅLT, ikke lest: hele panelets plasseringsvisning
// ble slått av med `{false ? (` på kallstedet, og 3050 tester forble grønne.
// Beslutningen bor derfor her som et rent predikat med begge retningene
// testet (lib/side-panel-placement.test.ts), og kallstedet voktes av en
// kildetekst-test (lib/side-panel-placement-wiring.test.ts). Ingen av de to
// holder alene.
//
// ── KILDEN ER interLiveRanking, IKKE liveRank ───────────────────────────────
// Pillens `liveRank` bærer allerede `{ exact, low, high }` ferdig gatet, og
// oppdateres per svar — fristende. Men fetchLiveRank er gatet på
// `quiz.show_live_placement` (lib/archive-ranking-gates.ts, G4), og panelet
// er det IKKE. På en quiz med det flagget av ville panelet blitt tomt.
// `interLiveRanking` settes i goToNext fra det samme /live-ranking-svaret som
// gir `interLow`/`interHigh`, så tall og bånd kommer fra samme øyeblikk.
//
// ── GATE PÅ DET VI FIKK, IKKE PÅ isPremium ──────────────────────────────────
// Paritetskontrakten fra 2749d59, som QuizInterlude allerede følger
// (components/QuizInterlude.tsx, «VILKÅRET ER `!liveRanking`, IKKE
// `!isPremium`»): serveren gater eksakt plassering på det signerte
// attempt-tokenet, og tokenet utstedes ved START. Kjøper noen premium midt i
// quizen, sier klientens isPremium «ja» mens serveren fortsatt sier «nei» —
// en isPremium-gate ville da vist «#» uten tall. `liveRanking` er selv
// premium-beviset: page.tsx setter den KUN når serveren faktisk sendte
// `userRank !== null`.
//
// `totalPlayers >= 2` speiler QuizInterlude sin egen terskel for den eksakte
// blokken. Én spiller i feltet er «#1», som er sant og meningsløst; panelet
// viser da det samme som mellomskjermen — ingenting eksakt.

// `userRank` er BEVISST nullbar her, selv om page.tsx sin state-type sier
// `number`: setteren (goToNext, «`userRank !== null` er paritetsvakten») skriver
// objektet kun når serveren faktisk ga et tall, så kombinasjonen «objekt, men
// null» kan ikke oppstå fra dagens kaller. Men det er en vakt hos SKRIVEREN,
// ikke i predikatet — og et objekt er truthy uansett hva feltet inneholder.
// Predikatet spør derfor selv, slik at en framtidig kaller som mater det med
// rå API-form (`userRank: number | null` fra /live-ranking) ikke kan få
// «#null» eller «#» rendret. Ingen eksakt → bånd, samme regel som ellers.
export type SidePanelLiveRanking = {
  totalPlayers: number
  userRank: number | null
}

export type SidePanelPlacement =
  | { kind: 'exact'; rank: number }
  | { kind: 'band'; low: number; high: number }
  | { kind: 'none' }

/**
 * Hva sidepanelet skal tegne som «Din plass».
 *
 * Rekkefølgen er bevisst: eksakt vinner over bånd når begge finnes, fordi
 * bånd er gratisvisningen og eksakt er det spilleren har betalt for — og
 * serveren har allerede avgjort at hun har krav på det.
 */
export function decideSidePanelPlacement(args: {
  /** Server-gatet eksakt plassering. `null`/`undefined` = serveren ga ingen. */
  liveRanking: SidePanelLiveRanking | null | undefined
  low: number | null
  high: number | null
}): SidePanelPlacement {
  const { liveRanking, low, high } = args
  // Tre ledd, alle nødvendige: objektet finnes, feltet er et tall, feltet er
  // stort nok. `typeof === 'number'` dekker både null og undefined — begge er
  // realistiske fra en JSON-nyttelast, og et objekt alene beviser ingen av dem.
  if (liveRanking && typeof liveRanking.userRank === 'number' && liveRanking.totalPlayers >= 2) {
    return { kind: 'exact', rank: liveRanking.userRank }
  }
  if (low !== null && high !== null) {
    return { kind: 'band', low, high }
  }
  return { kind: 'none' }
}
