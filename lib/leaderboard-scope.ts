// ── Lukket rom vs. åpen konkurranse ─────────────────────────────────────────
// Topplistene finnes i tre scope, men bare TO oppførsler, og skillet går ikke
// der navnene antyder:
//
//   'global'                    — den åpne konkurransen. Alle mot alle, hvem
//                                 som helst kan lese den, og trappen gjelder:
//                                 uinnlogget topp 3, gratis topp 10, Premium
//                                 alt (P-1, 23. august 2026).
//   'league' / 'organization'   — LUKKEDE ROM. Medlemskapet er verifisert
//                                 server-side før noe som helst leveres, noen
//                                 har betalt for at rommet skal finnes (en
//                                 liga krever Premium å opprette; en bedrift
//                                 har abonnement), og der ser alle medlemmer
//                                 alt. Ingen trapp, ingen banding, ingen
//                                 paywall på egen plassering.
//
// Funksjonen finnes fordi skillet lå spredt som `scope === 'organization'` på
// FEM steder, og liga var glemt på alle fem — innført 22. august 2026 med
// S1/S2, funnet 23. august. Symptomene var konkrete og målt:
//
//   • Ett svar bar to sannheter om samme person: `entries` inneholdt
//     kallerens egen rad med EKSAKT rank, mens `userEntry.rank` for samme
//     bruker var grovmalt til 10-båndets start (plass 3 → 1).
//   • Et gratis ligamedlem utenfor topp 10 fikk «Du er utenfor topp 10. Med
//     Premium ser du din nøyaktige plassering» — en betalingsmur inne i et
//     lukket rom, rett under en liste som viste alle ANDRES eksakte
//     plassering. Rutens egen kommentar påsto at gaten ikke endret noe
//     synlig for liga; målingen viste at den gjorde nettopp det.
//
// REGELEN: særbehandler du et lukket rom, spør gjennom denne funksjonen — ikke
// med en ny `|| scope === 'organization'`. Da kan ikke liga bli glemt en sjette
// gang. Merk at membership-GATINGEN (scope-gaten i /api/toppliste og
// /api/toppliste/history) allerede behandler de to likt og ikke skal endres —
// den handler om HVEM som slipper inn, ikke om hva et medlem får se.
//
// Tar `string` og ikke unionen, fordi kallerne på serversiden leser scope rått
// fra query-parameteren. Ugyldige verdier avvises av scope-gaten før dette
// spørsmålet i det hele tatt blir stilt.
export function isClosedRoom(scope: string): boolean {
  return scope === 'organization' || scope === 'league'
}
